"""Runtime entrypoint for the ETL pipeline (task 12a).

Before this module existed, `tasks.md`'s own work-unit table already
promised four runtime harnesses that no numbered task ever built:

    uv run python -m etl fetch --source <id>
    uv run python -m etl ingest --source <id> --database-url <dsn> --year <y> --round <r>
    uv run python -m etl validate-crosswalk
    uv run python -m etl validate-curated

This is where they actually live. Every public function below is
independently testable with fakes -- `fetch_source`/`ingest_source` accept
an injected `Fetcher`/database URL rather than reaching for a real network
or connection themselves, so `tests/test_cli.py` never needs a subprocess.

Exit codes: 0 on success, non-zero on any argument or validation failure.
"""

from __future__ import annotations

import argparse
import io
import os
import sys
import tempfile
import zipfile
from collections.abc import Iterable
from pathlib import Path

import psycopg
import yaml

from .archive import ArchiveResult, Fetcher, archive_source
from .crosswalk import (
    CrosswalkTable,
    MesaStability,
    QuarantinedJurisdiction,
    compute_mesa_stability,
    load_crosswalk,
)
from .db import load_crosswalk_rows, load_party_map_rows
from .http_client import RequestsFetcher
from .ingest.fiscalizacion import guard_local_mirror_only, ingest_fiscalizacion
from .ingest.national import REQUIRED_COLUMNS, ingest_national, load_national_rows
from .ingest.pba import ingest_pba, load_pba_rows
from .manifest import latest_ok_record, load_manifest, save_manifest, upsert_record
from .party_map import PartyMappingTable, UnmappedListId, load_party_map
from .storage import LocalArchiveStore, extract_zip_safely

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
DEFAULT_SOURCES_PATH = REPO_ROOT / "etl" / "sources.yaml"
DEFAULT_LOCAL_ROOT = REPO_ROOT / "archive"
DEFAULT_MANIFEST_PATH = REPO_ROOT / "archive-manifest.json"
DEFAULT_CROSSWALK_PATH = REPO_ROOT / "curated" / "crosswalk.yaml"
DEFAULT_PARTY_MAP_PATH = REPO_ROOT / "curated" / "party_map.yaml"

# Never a hardcoded fallback DSN -- see `resolve_database_url` (task 12.6).
DATABASE_URL_ENV_VAR = "ETL_DATABASE_URL"


class UnknownSourceError(ValueError):
    """Raised when `--source` names no entry in `sources.yaml`.

    Per task 12.2: an unrecognized source id is always an error, never a
    silent no-op.
    """


class MissingDatabaseUrlError(RuntimeError):
    """Raised by `ingest` when no explicit database URL is available.

    `ingest` MUST NEVER silently fall back to a default DSN (task 12.6) --
    unlike a developer's local Postgres, a guessed default is exactly how a
    write could land through an unintended, more privileged connection.
    """


# ---------------------------------------------------------------------------
# Shared source lookup
# ---------------------------------------------------------------------------


def load_sources(path: Path = DEFAULT_SOURCES_PATH) -> dict[str, list[dict]]:
    """Load `sources.yaml`'s capability -> entries mapping."""
    return yaml.safe_load(path.read_text(encoding="utf-8")) or {}


def find_source_entry(sources: dict[str, list[dict]], source_id: str) -> dict | None:
    """Find one entry by `id` across every capability family, or `None`."""
    for capability, entries in sources.items():
        for entry in entries:
            if entry["id"] == source_id:
                return {**entry, "capability": capability}
    return None


# ---------------------------------------------------------------------------
# fetch
# ---------------------------------------------------------------------------


def fetch_source(
    source_id: str,
    *,
    sources: dict[str, list[dict]],
    fetcher: Fetcher,
    local_root: Path,
    manifest_path: Path,
) -> ArchiveResult:
    """Archive one registered source by id.

    Raises `UnknownSourceError` for an unregistered id (task 12.2) --
    never a silent no-op.
    """
    entry = find_source_entry(sources, source_id)
    if entry is None:
        raise UnknownSourceError(f"no registered source with id {source_id!r}")

    # The guard runs BEFORE anything is fetched or written. It was defined and
    # unit-tested in phase 6 but had no call site anywhere in production code,
    # so the single personal-data-bearing source in this project was protected
    # only by a test that read the YAML -- not by the code path that acts on it.
    # A fiscalización entry that loses its `upload: never` declaration now fails
    # here, before its bytes exist on disk.
    guard_local_mirror_only(entry)

    local_store = LocalArchiveStore(root=local_root)
    records = load_manifest(manifest_path)
    result = archive_source(entry, fetcher=fetcher, local_store=local_store)
    records = upsert_record(records, result.record)
    save_manifest(manifest_path, records)
    return result


def cmd_fetch(args: argparse.Namespace) -> int:
    sources = load_sources(Path(args.sources_path))
    try:
        result = fetch_source(
            args.source,
            sources=sources,
            fetcher=RequestsFetcher(),
            local_root=Path(args.local_root),
            manifest_path=Path(args.manifest_path),
        )
    except UnknownSourceError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1

    if result.record["status"] != "ok":
        print(f"error: fetch failed for {args.source!r}: {result.record['notes']}", file=sys.stderr)
        return 1

    print(f"archived {args.source} -> {result.record['archived_path']}")
    return 0


# ---------------------------------------------------------------------------
# ingest
# ---------------------------------------------------------------------------


def resolve_database_url(explicit: str | None) -> str:
    """Resolve the database URL from `--database-url` or the
    `ETL_DATABASE_URL` env var. Never falls back to a hardcoded DSN
    (task 12.6) -- absence of both is a hard error, not a guess.
    """
    url = explicit or os.environ.get(DATABASE_URL_ENV_VAR)
    if not url:
        raise MissingDatabaseUrlError(
            "ingest requires an explicit database URL (--database-url or "
            f"${DATABASE_URL_ENV_VAR}); refusing to silently default to a "
            "superuser connection"
        )
    return url


def resolve_national_results_bytes(raw_bytes: bytes, *, extract_dir: Path) -> bytes:
    """Return the national results CSV bytes `ingest_national` expects.

    A registered national source is archived as a ZIP (`sources.yaml`),
    with the results file's own name differing across years
    (`resultados2025.csv` in 2025, `ResultadosElectorales.csv` in 2023) and
    packaged alongside unrelated CSVs (`ambitosElectorales.csv`,
    `localesDeVotacionyMesas.csv`). Rather than hardcode either filename,
    this extracts the whole archive (`storage.extract_zip_safely`, the
    same safe-extraction path `tests/test_ingest_national.py` already
    exercises) and picks the one CSV member whose header declares every
    column `ingest_national.REQUIRED_COLUMNS` needs.

    `raw_bytes` that is not a ZIP at all (a bare CSV, e.g. a test fixture)
    passes through unchanged.
    """
    if not zipfile.is_zipfile(io.BytesIO(raw_bytes)):
        return raw_bytes

    extracted = extract_zip_safely(raw_bytes, extract_dir)
    for path in extracted:
        if path.suffix.lower() != ".csv":
            continue
        with path.open("r", encoding="utf-8", errors="ignore") as handle:
            header = handle.readline()
        if all(column in header for column in REQUIRED_COLUMNS):
            return path.read_bytes()

    raise NationalResultsCsvNotFoundError(
        "no member of the archived ZIP matches the expected national results "
        f"schema (looked for columns: {', '.join(REQUIRED_COLUMNS)})"
    )


class NationalResultsCsvNotFoundError(ValueError):
    """Raised when a ZIP-archived national source has no member whose
    header matches `ingest.national.REQUIRED_COLUMNS` (task 12d)."""


def ingest_source(
    source_id: str,
    *,
    database_url: str | None,
    year: int,
    round_: str,
    sources: dict[str, list[dict]],
    local_root: Path,
    manifest_path: Path,
    party_map_path: Path = DEFAULT_PARTY_MAP_PATH,
) -> int:
    """Load one already-archived source's parsed rows into `result_row`.

    Resolves (and validates) the database URL BEFORE touching the archive
    or opening any connection, so a missing URL never reaches even a
    partial write attempt (task 12.6).
    """
    resolved_url = resolve_database_url(database_url)

    entry = find_source_entry(sources, source_id)
    if entry is None:
        raise UnknownSourceError(f"no registered source with id {source_id!r}")
    capability = entry["capability"]

    records = load_manifest(manifest_path)
    archived = latest_ok_record(records, source_id)
    if archived is None:
        raise UnknownSourceError(
            f"no archived copy of {source_id!r} -- run `fetch --source {source_id}` first"
        )

    local_store = LocalArchiveStore(root=local_root)
    filename = (archived.get("archived_path") or "").rsplit("/", 1)[-1]
    raw_bytes = local_store.read(capability, filename)

    conn = psycopg.connect(resolved_url)
    try:
        if capability == "national":
            with tempfile.TemporaryDirectory(prefix="votus-etl-ingest-") as extract_dir:
                csv_bytes = resolve_national_results_bytes(
                    raw_bytes, extract_dir=Path(extract_dir)
                )
                rows = ingest_national(csv_bytes, archive_entry_id=source_id)
            inserted = load_national_rows(conn, rows, year=year, round_=round_)
        elif capability == "pba":
            rows = ingest_pba(raw_bytes, archive_entry_id=source_id)
            inserted = load_pba_rows(conn, rows, year=year, round_=round_)
        elif capability == "fiscalizacion":
            # Imported lazily: `load_fiscalizacion_rows` lands in sub-unit 12b,
            # chained on top of this one -- 12a's own tests never exercise the
            # fiscalización capability, so the module must still import cleanly
            # before 12b's function exists.
            from .ingest.fiscalizacion import load_fiscalizacion_rows

            party_map = load_party_map(party_map_path)
            result = ingest_fiscalizacion(raw_bytes.decode("utf-8"), archive_entry_id=source_id)
            inserted = load_fiscalizacion_rows(
                conn,
                result.rows,
                year=year,
                round_=round_,
                party_map=party_map,
                archive_entry_id=source_id,
            )
        else:
            raise UnknownSourceError(f"unsupported capability {capability!r} for ingest")
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
    return inserted


def cmd_ingest(args: argparse.Namespace) -> int:
    sources = load_sources(Path(args.sources_path))
    try:
        inserted = ingest_source(
            args.source,
            database_url=args.database_url,
            year=args.year,
            round_=args.round,
            sources=sources,
            local_root=Path(args.local_root),
            manifest_path=Path(args.manifest_path),
        )
    except (UnknownSourceError, MissingDatabaseUrlError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1

    print(f"ingested {inserted} rows from {args.source}")
    return 0


# ---------------------------------------------------------------------------
# validate-crosswalk
# ---------------------------------------------------------------------------


def find_unmapped_jurisdictions(
    codes: Iterable[tuple[str, str]], crosswalk: CrosswalkTable
) -> list[QuarantinedJurisdiction]:
    """Report every `(distrito, seccion)` pair with no curated crosswalk
    entry -- never silently ignored (task 12.4).

    Phase 16b: `codes` comes from the raw national CSVs, which the real
    archived 2023 file carries UNPADDED (`"2"`, `"27"`); `crosswalk`
    (`curated/crosswalk.yaml`) is zero-padded (`"02"`, `"027"`). Comparing
    verbatim would misreport every real 2023 code as unmapped even though it
    IS curated -- confirmed live, the same padding-independence
    `_normalize_administrative_code` already gives `collect_national_mesa_codes`
    (Phase 15). Applied on both sides here rather than inside
    `CrosswalkTable.resolve_national`, which stays a plain exact-match lookup
    used elsewhere against already-normalized keys.
    """
    unmapped: list[QuarantinedJurisdiction] = []
    seen: set[tuple[str, str]] = set()
    for distrito, seccion in codes:
        key = (distrito, seccion)
        if key in seen:
            continue
        seen.add(key)
        normalized_distrito = _normalize_administrative_code(distrito)
        normalized_seccion = _normalize_administrative_code(seccion)
        resolved = any(
            _normalize_administrative_code(entry.national_distrito_code) == normalized_distrito
            and _normalize_administrative_code(entry.national_seccion_code) == normalized_seccion
            for entry in crosswalk.jurisdictions
        )
        if not resolved:
            unmapped.append(
                QuarantinedJurisdiction(
                    code=f"{distrito}/{seccion}",
                    reason=(
                        f"no curated crosswalk entry for distrito={distrito!r} "
                        f"seccion={seccion!r}"
                    ),
                )
            )
    return unmapped


def collect_national_jurisdiction_codes(
    sources: dict[str, list[dict]], *, local_root: Path, manifest_path: Path
) -> list[tuple[str, str]]:
    """Gather every distinct `(distrito, seccion)` actually present in
    already-archived national sources -- the real codes an `ingest` run
    would need the crosswalk to resolve."""
    records = load_manifest(manifest_path)
    local_store = LocalArchiveStore(root=local_root)
    codes: set[tuple[str, str]] = set()
    for entry in sources.get("national", []):
        archived = latest_ok_record(records, entry["id"])
        if archived is None:
            continue
        filename = (archived.get("archived_path") or "").rsplit("/", 1)[-1]
        if not local_store.exists("national", filename):
            continue
        raw_bytes = local_store.read("national", filename)
        with tempfile.TemporaryDirectory(prefix="votus-etl-validate-") as extract_dir:
            csv_bytes = resolve_national_results_bytes(
                raw_bytes, extract_dir=Path(extract_dir)
            )
        for row in ingest_national(csv_bytes, archive_entry_id=entry["id"]):
            codes.add((row.result.distrito, row.result.seccion or ""))
    return sorted(codes)


def collect_mesa_tipo_mapping(rows) -> dict[tuple[str, str, str, int], str]:
    """Collapse source rows to the distinct `(lineage) -> mesa_tipo` mapping.

    `mesa_tipo` is a property of the MESA, not of a result: mesa 9001 in
    distrito 02 / seccion 027 is EXTRANJEROS for every category and every
    list. Collapsing to distinct mesas turns a 13,6-million-row reload into a
    few hundred thousand tuples, which is what makes backfilling a
    late-added column an UPDATE rather than a re-ingest.
    """
    mapping: dict[tuple[str, str, str, int], str] = {}
    for raw in rows:
        tipo = (raw.get("mesa_tipo") or "").strip()
        if not tipo:
            continue
        mapping[(
            _normalize_administrative_code(raw["distrito_id"]),
            _normalize_administrative_code(raw["seccion_id"]),
            raw["circuito_id"],
            int(raw["mesa_id"]),
        )] = tipo
    return mapping


def cmd_validate_crosswalk(args: argparse.Namespace) -> int:
    sources = load_sources(Path(args.sources_path))
    codes = collect_national_jurisdiction_codes(
        sources, local_root=Path(args.local_root), manifest_path=Path(args.manifest_path)
    )
    crosswalk = load_crosswalk(Path(args.crosswalk_path))
    unmapped = find_unmapped_jurisdictions(codes, crosswalk)

    if unmapped:
        for item in unmapped:
            print(f"unmapped jurisdiction: {item.code} -- {item.reason}", file=sys.stderr)
        return 1

    print(f"crosswalk: all {len(codes)} archived jurisdiction code(s) resolve")
    return 0


# ---------------------------------------------------------------------------
# validate-curated
# ---------------------------------------------------------------------------


def find_unmapped_parties(
    keys: Iterable[tuple[int, str, str, str]], party_map: PartyMappingTable
) -> list[UnmappedListId]:
    """Report every `(year, jurisdiction, category, list_id)` key with no
    curated party mapping entry -- never silently ignored (task 12.5)."""
    unmapped: list[UnmappedListId] = []
    seen: set[tuple[int, str, str, str]] = set()
    for year, jurisdiction, category, list_id in keys:
        key = (year, jurisdiction, category, list_id)
        if key in seen:
            continue
        seen.add(key)
        resolved = party_map.resolve(
            year=year, jurisdiction=jurisdiction, category=category, list_id=list_id
        )
        if isinstance(resolved, UnmappedListId):
            unmapped.append(resolved)
    return unmapped


def collect_national_party_keys(
    sources: dict[str, list[dict]], *, local_root: Path, manifest_path: Path
) -> list[tuple[int, str, str, str]]:
    """Gather every distinct `(year, "national", category, list_id)` key
    actually present in already-archived national sources. `year` is parsed
    from each source id's leading 4 digits (e.g. `national/2025-legislativas`),
    matching the convention every registered national entry already follows.
    """
    records = load_manifest(manifest_path)
    local_store = LocalArchiveStore(root=local_root)
    keys: set[tuple[int, str, str, str]] = set()
    for entry in sources.get("national", []):
        archived = latest_ok_record(records, entry["id"])
        if archived is None:
            continue
        filename = (archived.get("archived_path") or "").rsplit("/", 1)[-1]
        if not local_store.exists("national", filename):
            continue
        year_digits = "".join(c for c in entry["id"].split("/")[-1][:4] if c.isdigit())
        if len(year_digits) != 4:
            continue
        year = int(year_digits)
        raw_bytes = local_store.read("national", filename)
        with tempfile.TemporaryDirectory(prefix="votus-etl-validate-") as extract_dir:
            csv_bytes = resolve_national_results_bytes(
                raw_bytes, extract_dir=Path(extract_dir)
            )
        for row in ingest_national(csv_bytes, archive_entry_id=entry["id"]):
            if row.list_id:
                keys.add((year, "national", row.category, row.list_id))
    return sorted(keys)


def cmd_validate_curated(args: argparse.Namespace) -> int:
    sources = load_sources(Path(args.sources_path))
    keys = collect_national_party_keys(
        sources, local_root=Path(args.local_root), manifest_path=Path(args.manifest_path)
    )
    party_map = load_party_map(Path(args.party_map_path))
    unmapped = find_unmapped_parties(keys, party_map)

    if unmapped:
        for item in unmapped:
            print(
                f"unmapped party: year={item.year} jurisdiction={item.jurisdiction} "
                f"category={item.category} list_id={item.list_id} -- {item.reason}",
                file=sys.stderr,
            )
        return 1

    print(f"curated party map: all {len(keys)} archived (year, category, list_id) key(s) resolve")
    return 0


# ---------------------------------------------------------------------------
# load-curated
# ---------------------------------------------------------------------------


def _normalize_administrative_code(raw: str) -> str:
    """Normalize a distrito/seccion code to a zero-padding-independent form.

    MEASURED against the real archived files (task 15.11): the raw national
    CSVs' `distrito_id`/`seccion_id` columns are UNPADDED (`"2"`, `"27"`),
    while `curated/crosswalk.yaml` follows the DINE zero-padded convention
    (`"02"`, `"027"`) that `curated/party_map.yaml`'s comments and this
    project's own test fixtures also use. Comparing the two verbatim silently
    matches nothing -- exactly the same class of bug `ingest.national`'s
    `_normalize_mesa_id` already exists to prevent for mesa ids. Falls back
    to the raw string unchanged for a non-numeric code rather than raising.
    """
    try:
        return str(int(raw))
    except ValueError:
        return raw


def collect_national_mesa_codes(
    sources: dict[str, list[dict]],
    *,
    local_root: Path,
    manifest_path: Path,
    distrito_code: str,
    seccion_code: str,
    year: int,
) -> set[int]:
    """Gather every distinct mesa code observed in an already-archived
    national source for one `(distrito, seccion)` scope and one year.

    Reuses the same archived-file parsing path
    `collect_national_jurisdiction_codes`/`collect_national_party_keys`
    already exercise for `validate-crosswalk`/`validate-curated` -- this is
    `mesa_crosswalk`'s per-year presence input (task 15.11), computed from
    the REAL archived corpus rather than assumed or hand-authored in YAML
    (jurisdiction-model spec: stability "MUST NOT be assumed by default").
    """
    records = load_manifest(manifest_path)
    local_store = LocalArchiveStore(root=local_root)
    target_distrito = _normalize_administrative_code(distrito_code)
    target_seccion = _normalize_administrative_code(seccion_code)
    mesas: set[int] = set()
    for entry in sources.get("national", []):
        year_digits = "".join(c for c in entry["id"].split("/")[-1][:4] if c.isdigit())
        if len(year_digits) != 4 or int(year_digits) != year:
            continue
        archived = latest_ok_record(records, entry["id"])
        if archived is None:
            continue
        filename = (archived.get("archived_path") or "").rsplit("/", 1)[-1]
        if not local_store.exists("national", filename):
            continue
        raw_bytes = local_store.read("national", filename)
        with tempfile.TemporaryDirectory(prefix="votus-etl-load-curated-") as extract_dir:
            csv_bytes = resolve_national_results_bytes(raw_bytes, extract_dir=Path(extract_dir))
        for row in ingest_national(csv_bytes, archive_entry_id=entry["id"]):
            if (
                _normalize_administrative_code(row.result.distrito) == target_distrito
                and _normalize_administrative_code(row.result.seccion or "") == target_seccion
                and row.mesa is not None
            ):
                mesas.add(row.mesa)
    return mesas


def load_curated(
    *,
    database_url: str,
    sources: dict[str, list[dict]],
    local_root: Path,
    manifest_path: Path,
    party_map_path: Path,
    crosswalk_path: Path,
) -> dict[str, int]:
    """Load every curated table (task 15.10): `party_canonical`,
    `list_identity`, `party_mapping` from `party_map_path`, and
    `jurisdiction_crosswalk`/`mesa_crosswalk` from `crosswalk_path`.

    `mesa_crosswalk`'s presence-per-year is computed for every jurisdiction
    the crosswalk curates, from whichever national sources are ALREADY
    archived on disk for 2023/2025 (task 15.11) -- a jurisdiction with no
    archived source for one year simply gets an empty set for that year,
    never a crash.
    """
    party_map = load_party_map(party_map_path)
    crosswalk = load_crosswalk(crosswalk_path)

    mesa_stabilities: list[tuple[str, str, MesaStability]] = []
    for jurisdiction in crosswalk.jurisdictions:
        mesas_2023 = collect_national_mesa_codes(
            sources,
            local_root=local_root,
            manifest_path=manifest_path,
            distrito_code=jurisdiction.national_distrito_code,
            seccion_code=jurisdiction.national_seccion_code,
            year=2023,
        )
        mesas_2025 = collect_national_mesa_codes(
            sources,
            local_root=local_root,
            manifest_path=manifest_path,
            distrito_code=jurisdiction.national_distrito_code,
            seccion_code=jurisdiction.national_seccion_code,
            year=2025,
        )
        for stability in compute_mesa_stability(mesas_2023, mesas_2025):
            mesa_stabilities.append(
                (
                    jurisdiction.national_distrito_code,
                    jurisdiction.national_seccion_code,
                    stability,
                )
            )

    conn = psycopg.connect(database_url)
    try:
        counts = load_party_map_rows(conn, party_map)
        counts.update(load_crosswalk_rows(conn, crosswalk, mesa_stabilities=mesa_stabilities))
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
    return counts


def cmd_load_curated(args: argparse.Namespace) -> int:
    try:
        database_url = resolve_database_url(args.database_url)
    except MissingDatabaseUrlError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1

    sources = load_sources(Path(args.sources_path))
    counts = load_curated(
        database_url=database_url,
        sources=sources,
        local_root=Path(args.local_root),
        manifest_path=Path(args.manifest_path),
        party_map_path=Path(args.party_map_path),
        crosswalk_path=Path(args.crosswalk_path),
    )

    for table_name, count in counts.items():
        print(f"loaded {count} row(s) into {table_name}")
    return 0


# ---------------------------------------------------------------------------
# argparse wiring
# ---------------------------------------------------------------------------


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="python -m etl", description=__doc__)
    parser.add_argument("--sources-path", default=str(DEFAULT_SOURCES_PATH))
    parser.add_argument("--local-root", default=str(DEFAULT_LOCAL_ROOT))
    parser.add_argument("--manifest-path", default=str(DEFAULT_MANIFEST_PATH))
    subparsers = parser.add_subparsers(dest="command", required=True)

    fetch_parser = subparsers.add_parser("fetch", help="Archive one registered source.")
    fetch_parser.add_argument("--source", required=True)
    fetch_parser.set_defaults(func=cmd_fetch)

    ingest_parser = subparsers.add_parser(
        "ingest", help="Load one archived source's rows into result_row."
    )
    ingest_parser.add_argument("--source", required=True)
    ingest_parser.add_argument("--database-url", default=None)
    ingest_parser.add_argument("--year", type=int, required=True)
    ingest_parser.add_argument("--round", dest="round", required=True)
    ingest_parser.set_defaults(func=cmd_ingest)

    validate_crosswalk_parser = subparsers.add_parser(
        "validate-crosswalk", help="Report jurisdiction codes with no curated crosswalk entry."
    )
    validate_crosswalk_parser.add_argument("--crosswalk-path", default=str(DEFAULT_CROSSWALK_PATH))
    validate_crosswalk_parser.set_defaults(func=cmd_validate_crosswalk)

    validate_curated_parser = subparsers.add_parser(
        "validate-curated", help="Report party keys with no curated party mapping entry."
    )
    validate_curated_parser.add_argument("--party-map-path", default=str(DEFAULT_PARTY_MAP_PATH))
    validate_curated_parser.set_defaults(func=cmd_validate_curated)

    load_curated_parser = subparsers.add_parser(
        "load-curated",
        help="Load curated party-map and crosswalk YAML into party_canonical, "
        "list_identity, party_mapping, jurisdiction_crosswalk and mesa_crosswalk.",
    )
    load_curated_parser.add_argument("--database-url", default=None)
    load_curated_parser.add_argument("--party-map-path", default=str(DEFAULT_PARTY_MAP_PATH))
    load_curated_parser.add_argument("--crosswalk-path", default=str(DEFAULT_CROSSWALK_PATH))
    load_curated_parser.set_defaults(func=cmd_load_curated)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
