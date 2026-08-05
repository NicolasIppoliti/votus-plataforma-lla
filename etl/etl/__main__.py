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
import csv
import io
import os
import sys
import tempfile
import zipfile
from collections.abc import Iterable
from dataclasses import replace
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
from .db import (
    MERGE_KEY_SQL,
    insert_review_items,
    load_crosswalk_rows,
    load_party_map_rows,
    merge_key,
)
from .http_client import RequestsFetcher
from .ingest.fiscalizacion import (
    FiscalizacionUploadForbiddenError,
    guard_local_mirror_only,
    ingest_fiscalizacion,
)
from .ingest.national import REQUIRED_COLUMNS, ingest_national, load_national_rows
from .ingest.pba import ingest_pba, load_pba_rows
from .jurisdiction import (
    is_canonicalizable_code,
    normalize_circuito_code,
    normalize_distrito_code,
    normalize_seccion_code,
)
from .manifest import latest_ok_record, load_manifest, save_manifest, upsert_record
from .party_map import PartyMappingTable, UnmappedListId, load_party_map
from .review_item import review_item_draft_to_record
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
    except (UnknownSourceError, FiscalizacionUploadForbiddenError) as exc:
        # The personal-data guard is the one failure an operator is MOST likely
        # to hit by accident, and it was the only one exiting with a traceback
        # instead of an exit code.
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
        # `utf-8-sig`, not `utf-8`: a BOM would make the first field
        # `"\ufeffdistrito_id"`, the field-set check fail, and a perfectly
        # valid national CSV raise `NationalResultsCsvNotFoundError`. The
        # committed 2023/2025 files carry no BOM; the next export may.
        #
        # And NOT `errors="ignore"`: dropping an undecodable byte can eat a
        # character out of `distrito_id`, after which this reports "no member
        # matches the expected schema" -- a schema verdict on what is really an
        # encoding failure. A member that will not decode is skipped as such.
        try:
            with path.open("r", encoding="utf-8-sig") as handle:
                header_fields = set(next(csv.reader(handle), []))
        except UnicodeDecodeError as exc:
            print(
                f"  {path.name}: not valid UTF-8 ({exc.reason}); skipped as a "
                "candidate results file",
                file=sys.stderr,
            )
            continue
        # PARSED field names, not a substring scan of the raw header line:
        # `"mesa_id" in header` is also true for a file whose only mesa column
        # is `mesa_id_original`, and the 2023 and 2025 files already differ in
        # shape, so the next one will too.
        if set(REQUIRED_COLUMNS) <= header_fields:
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
    crosswalk_path: Path = DEFAULT_CROSSWALK_PATH,
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
            # The CALLER's crosswalk, not a hardcoded default: validating
            # against a candidate file and then ingesting against a different
            # one silently breaks the guarantee `validate-crosswalk` gives.
            crosswalk = load_crosswalk(crosswalk_path)
            inserted = load_pba_rows(conn, rows, year=year, round_=round_, crosswalk=crosswalk)
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
            # Every draft this ingestion produced is PERSISTED here. Producing
            # them in memory and returning is the "correct, tested,
            # unreachable" shape: `insert_review_items` had no production
            # caller at all, so every collapsed duplicate and every blank vote
            # cell died with the process while `review_item.py` documented it
            # as "the only write path".
            # `subject_ref` is only `"mesa N"`, which is not unique across
            # sources. Scoping it by the archived source id is what makes the
            # dedupe below safe: without it, a SECOND fiscalización source
            # observing the same mesa number with the same note would have its
            # genuinely new observation discarded and reported as "already
            # present" -- a silent drop.
            records = [
                replace(
                    review_item_draft_to_record(draft),
                    subject_ref=f"{source_id} {draft.subject_ref}",
                )
                for draft in result.review_items
            ]
            # `review_item` has no natural key and `subject_ref` is only
            # `"mesa N"`, so re-ingesting the same source would append the same
            # observations again. Re-running produces byte-identical drafts, so
            # skipping rows already present makes it idempotent without ever
            # discarding a NEW observation -- and the skip count is reported,
            # not swallowed.
            with conn.cursor() as cur:
                # EXACT match against the very subject_refs about to be
                # written -- not `like 'source %'`. `_` and `%` are LIKE
                # wildcards, so a source id such as `fiscalizacion/2025_cnel`
                # would match ANOTHER source's rows, pull them into `existing`,
                # and drop this source's genuinely new observation while
                # reporting it as "already present": the exact silent drop the
                # scoping exists to prevent.
                cur.execute(
                    "select kind, severity, subject_ref, note from review_item"
                    " where subject_ref = any(%s)",
                    ([record.subject_ref for record in records],),
                )
                existing = {tuple(row) for row in cur.fetchall()}
            fresh = [
                record
                for record in records
                if (record.kind, record.severity, record.subject_ref, record.note)
                not in existing
            ]
            insert_review_items(conn, fresh)
            print(
                f"  review items: {len(fresh)} recorded, "
                f"{len(records) - len(fresh)} already present",
                file=sys.stderr,
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
            crosswalk_path=Path(args.crosswalk_path),
            # Same reason as the crosswalk: validating against a candidate
            # party map and then ingesting against the repo default silently
            # breaks the guarantee `validate-curated` gives.
            party_map_path=Path(args.party_map_path),
        )
    except (
        UnknownSourceError,
        MissingDatabaseUrlError,
        NationalResultsCsvNotFoundError,
    ) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1

    print(f"ingested {inserted} rows from {args.source}")
    return 0


# ---------------------------------------------------------------------------
# validate-crosswalk
# ---------------------------------------------------------------------------


def find_unmapped_jurisdictions(
    codes: Iterable[tuple[str, str | None]], crosswalk: CrosswalkTable
) -> list[QuarantinedJurisdiction]:
    """Report every `(distrito, seccion)` pair with no curated crosswalk
    entry -- never silently ignored (task 12.4).

    Phase 16b: `codes` comes from the raw national CSVs, which the real
    archived 2023 file carries UNPADDED (`"2"`, `"27"`); `crosswalk`
    (`curated/crosswalk.yaml`) is zero-padded (`"02"`, `"027"`). Comparing
    verbatim would misreport every real 2023 code as unmapped even though it
    IS curated -- confirmed live, the same padding-independence
    `normalize_distrito_code`/`normalize_seccion_code` (Phase 17's single
    normalization boundary, `etl.jurisdiction`) already gives
    `collect_national_mesa_codes` (Phase 15). Applied on both sides here
    rather than inside `CrosswalkTable.resolve_national`, which stays a
    plain exact-match lookup used elsewhere against already-normalized keys.
    """
    unmapped: list[QuarantinedJurisdiction] = []
    seen: set[tuple[str, str]] = set()
    for distrito, seccion in codes:
        normalized_distrito = normalize_distrito_code(distrito)
        normalized_seccion = normalize_seccion_code(seccion)
        # Deduped on the NORMALIZED pair. `("2","27")` and `("02","027")` are
        # both real and both present in the 2023/2025 corpus; deduping on the
        # raw pair reports one jurisdiction twice, under two different code
        # strings, as if they were two problems.
        key = (normalized_distrito, normalized_seccion)
        if key in seen:
            continue
        seen.add(key)
        if normalized_seccion is None:
            # A coarser-than-seccion national row carries NO seccion. Coercing
            # it to `""` fabricates a code no source ever wrote, and
            # `normalize_seccion_code("")` cannot parse it, so it would match no
            # curated `"027"` and report every distrito-level row of the
            # ten-category 2023 file as unmapped under `"02/"`. Such a row is
            # mapped when its DISTRITO is curated.
            resolved = any(
                normalize_distrito_code(entry.national_distrito_code)
                == normalized_distrito
                for entry in crosswalk.jurisdictions
            )
        else:
            resolved = any(
                normalize_distrito_code(entry.national_distrito_code)
                == normalized_distrito
                and normalize_seccion_code(entry.national_seccion_code)
                == normalized_seccion
                for entry in crosswalk.jurisdictions
            )
        if not resolved:
            shown_seccion = "(sin seccion)" if seccion is None else seccion
            unmapped.append(
                QuarantinedJurisdiction(
                    code=f"{distrito}/{shown_seccion}",
                    reason=(
                        f"no curated crosswalk entry for distrito={distrito!r} "
                        f"seccion={seccion!r}"
                    ),
                )
            )
    return unmapped


def collect_national_jurisdiction_codes(
    sources: dict[str, list[dict]], *, local_root: Path, manifest_path: Path
) -> list[tuple[str, str | None]]:
    """Gather every distinct `(distrito, seccion)` actually present in
    already-archived national sources -- the real codes an `ingest` run
    would need the crosswalk to resolve."""
    records = load_manifest(manifest_path)
    local_store = LocalArchiveStore(root=local_root)
    codes: set[tuple[str, str | None]] = set()
    # Split by REASON: "never fetched" and "manifest says ok but the local
    # mirror has no such file" are different failures -- one needs a fetch, the
    # other means the archive drifted -- and one shared counter hides which.
    skipped_not_archived = 0
    skipped_missing_file = 0
    sources_seen = 0
    for entry in sources.get("national", []):
        archived = latest_ok_record(records, entry["id"])
        sources_seen += 1
        if archived is None:
            skipped_not_archived += 1
            continue
        filename = (archived.get("archived_path") or "").rsplit("/", 1)[-1]
        if not local_store.exists("national", filename):
            skipped_missing_file += 1
            continue
        raw_bytes = local_store.read("national", filename)
        with tempfile.TemporaryDirectory(prefix="votus-etl-validate-") as extract_dir:
            csv_bytes = resolve_national_results_bytes(
                raw_bytes, extract_dir=Path(extract_dir)
            )
        for row in ingest_national(csv_bytes, archive_entry_id=entry["id"]):
            # `seccion` stays `None` for coarser-than-seccion rows: absence is
            # not the empty string. See `find_unmapped_jurisdictions`.
            codes.add((row.result.distrito, row.result.seccion))
    if skipped_not_archived:
        print(
            f"  {skipped_not_archived} of {sources_seen} registered source(s) have "
            "no successful archive record and were excluded",
            file=sys.stderr,
        )
    if skipped_missing_file:
        print(
            f"  {skipped_missing_file} of {sources_seen} registered source(s) are "
            "recorded as archived but absent from the local mirror and were excluded",
            file=sys.stderr,
        )
    if skipped_not_archived + skipped_missing_file == sources_seen:
        # Same guard `collect_national_party_keys` already carries. Without it
        # `validate-crosswalk` prints "all 0 archived jurisdiction code(s)
        # resolve" and exits 0 over an EMPTY corpus -- green, plausible, and
        # describing nothing.
        print(
            "  no archived national source was read; this result describes an "
            "empty corpus, not a clean one",
            file=sys.stderr,
        )
    return sorted(codes, key=lambda pair: (pair[0], pair[1] or ""))


def collect_mesa_tipo_mapping(
    rows, *, source_label: str = "(unnamed source)", into: dict | None = None
) -> dict[tuple[str, str, str, int], set[str]]:
    """Collapse source rows to the distinct `(lineage) -> mesa_tipo` mapping.

    `mesa_tipo` is a property of the MESA, not of a result: mesa 9001 in
    distrito 02 / seccion 027 is EXTRANJEROS for every category and every
    list. Collapsing to distinct mesas turns a 13,6-million-row reload into a
    few hundred thousand tuples, which is what makes backfilling a
    late-added column an UPDATE rather than a re-ingest.
    """
    # Verified against the real archived 2023 generales and 2025 legislativas
    # files: both carry `distrito_id`, `seccion_id`, `circuito_id`, `mesa_id`
    # and `mesa_tipo`, with `circuito_id` 5 characters wide in every row. A
    # source missing any of them is reported, not crashed on, because the two
    # national files already differ in shape and a third will differ again.
    required = ("distrito_id", "seccion_id", "circuito_id", "mesa_id", "mesa_tipo")

    # Accumulates ACROSS sources when `into` is supplied. Merging per-file
    # results with `dict.update` afterwards is last-write-wins between the 2023
    # and 2025 files — the same silent pick the per-file set exists to prevent,
    # one loop up.
    candidates: dict[tuple[str, str, str, int], set[str]] = {} if into is None else into
    skipped_no_tipo = 0
    # Three causes, three counters. "The source does not publish the column at
    # all" and "scattered rows have a hole in the lineage" need opposite fixes
    # and are indistinguishable inside one `skipped_malformed` total.
    skipped_missing_column = 0
    skipped_bad_mesa_id = 0
    skipped_incomplete_lineage = 0
    # A code the boundary could not canonicalize is NOT the same as a missing
    # one: it is present, wrong-shaped, and would pass through unchanged and
    # silently join nothing.
    skipped_uncanonical_code = 0
    for raw in rows:
        missing = [column for column in required if column not in raw]
        if missing:
            skipped_missing_column += 1
            continue
        tipo = (raw.get("mesa_tipo") or "").strip()
        if not tipo:
            # Counted, never silently dropped: a skip with no number looks
            # identical whether it discarded nothing or everything.
            skipped_no_tipo += 1
            continue
        try:
            mesa = int(raw["mesa_id"])
        except (TypeError, ValueError):
            skipped_bad_mesa_id += 1
            continue
        # `required` proves the columns are PRESENT, not that they carry a
        # value. An empty `seccion_id` normalizes to `None`, and
        # `apply_mesa_tipo_mapping` renders `None` as `""` in the merge key --
        # so two different scopes would collapse into one lineage. A lineage
        # with a hole is not a lineage: report and skip.
        distrito = normalize_distrito_code(raw["distrito_id"])
        seccion = normalize_seccion_code(raw["seccion_id"])
        circuito = normalize_circuito_code(raw["circuito_id"])
        if not distrito or not seccion or not circuito:
            skipped_incomplete_lineage += 1
            continue
        if not all(
            is_canonicalizable_code(raw[column])
            for column in ("distrito_id", "seccion_id", "circuito_id")
        ):
            skipped_uncanonical_code += 1
            continue
        key = (distrito, seccion, circuito, mesa)
        # A SET, not a last-write-wins assignment. Two source rows for one mesa
        # disagreeing on its tipo would otherwise collapse in memory before any
        # conflict check downstream could see them — the conflict has to be
        # caught where it happens, not one layer later.
        candidates.setdefault(key, set()).add(tipo)

    if (
        skipped_no_tipo
        or skipped_missing_column
        or skipped_bad_mesa_id
        or skipped_incomplete_lineage
        or skipped_uncanonical_code
    ):
        print(
            f"  {source_label}: {skipped_no_tipo} rows carried no mesa_tipo, "
            f"{skipped_missing_column} lacked a required column, "
            f"{skipped_bad_mesa_id} had an unparseable mesa_id, "
            f"{skipped_incomplete_lineage} had an incomplete lineage, "
            f"{skipped_uncanonical_code} carried a non-numeric code the "
            "normalizers cannot canonicalize",
            file=sys.stderr,
        )

    return candidates


def source_year(entry_id: str) -> int | None:
    """The election year a registered source id declares, or `None`.

    ONE definition. The same four-line parse lived in
    `readable_national_sources`, `collect_national_party_keys` and
    `collect_national_mesa_codes` -- three independent ideas of "the year of a
    source", which is how two independent functions ended up with the same
    padding bug.
    """
    digits = "".join(c for c in entry_id.split("/")[-1][:4] if c.isdigit())
    if len(digits) != 4:
        return None
    return int(digits)


def readable_national_sources(
    sources: dict[str, list[dict]],
    *,
    local_root: Path,
    manifest_path: Path,
    year: int | None = None,
) -> int:
    """How many registered national sources are actually readable right now.

    Both validate commands answer "does the curated data cover the corpus?".
    Over an EMPTY corpus the honest answer is "unknown", not "yes" -- and both
    printed "all 0 ... resolve" and exited 0, which reads as coverage proven.
    """
    records = load_manifest(manifest_path)
    local_store = LocalArchiveStore(root=local_root)
    readable = 0
    for entry in sources.get("national", []):
        if year is not None and source_year(entry["id"]) != year:
            continue
        archived = latest_ok_record(records, entry["id"])
        if archived is None:
            continue
        filename = (archived.get("archived_path") or "").rsplit("/", 1)[-1]
        if local_store.exists("national", filename):
            readable += 1
    return readable


def cmd_validate_crosswalk(args: argparse.Namespace) -> int:
    sources = load_sources(Path(args.sources_path))
    if readable_national_sources(
        sources, local_root=Path(args.local_root), manifest_path=Path(args.manifest_path)
    ) == 0:
        print(
            "no archived national source is readable; refusing to report coverage "
            "over an empty corpus -- run `fetch` first",
            file=sys.stderr,
        )
        return 1
    try:
        codes = collect_national_jurisdiction_codes(
            sources, local_root=Path(args.local_root), manifest_path=Path(args.manifest_path)
        )
    except NationalResultsCsvNotFoundError as exc:
        # The module contract is "non-zero on any validation failure". A ZIP
        # whose schema drifted is a validation failure, not a crash.
        print(f"error: {exc}", file=sys.stderr)
        return 1
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
    skipped_no_list_id_by_source: dict[str, int] = {}
    sources_read = 0
    keys: set[tuple[int, str, str, str]] = set()
    skipped_not_archived = 0
    skipped_missing_file = 0
    skipped_no_year = 0
    sources_seen = 0
    for entry in sources.get("national", []):
        archived = latest_ok_record(records, entry["id"])
        sources_seen += 1
        if archived is None:
            skipped_not_archived += 1
            continue
        filename = (archived.get("archived_path") or "").rsplit("/", 1)[-1]
        if not local_store.exists("national", filename):
            skipped_missing_file += 1
            continue
        parsed_year = source_year(entry["id"])
        if parsed_year is None:
            skipped_no_year += 1
            continue
        year = parsed_year
        raw_bytes = local_store.read("national", filename)
        with tempfile.TemporaryDirectory(prefix="votus-etl-validate-") as extract_dir:
            csv_bytes = resolve_national_results_bytes(
                raw_bytes, extract_dir=Path(extract_dir)
            )
        for row in ingest_national(csv_bytes, archive_entry_id=entry["id"]):
            if row.list_id:
                keys.add((year, "national", row.category, row.list_id))
            else:
                skipped_no_list_id_by_source[entry["id"]] = (
                    skipped_no_list_id_by_source.get(entry["id"], 0) + 1
                )
        sources_read += 1

    # Both counted. `lista_numero` is empty throughout the 2023 generales file,
    # so dropping those rows silently would make this collect zero keys and let
    # `validate-curated` report "all 0 archived key(s) resolve" — green,
    # plausible, and excluding a whole file. A run that read no source at all
    # is likewise reported rather than passing as success.
    # PER SOURCE. `lista_numero` is empty throughout the 2023 generales file,
    # so one global total hides a whole file contributing ZERO keys while
    # `sources_read > 0` suppresses the empty-corpus warning and
    # `validate-curated` reports "all N key(s) resolve" over a corpus one file
    # is missing from.
    for source_id, count in sorted(skipped_no_list_id_by_source.items()):
        print(
            f"  {source_id}: {count} rows carried no list_id and were excluded",
            file=sys.stderr,
        )
    # Per REASON, not one total: "2 of 3 sources excluded" and "1 source has an
    # unparseable year" are different failures with different fixes, and either
    # one alone still lets `validate-curated` print a green "all N key(s)
    # resolve" over a fraction of the corpus.
    if skipped_not_archived:
        print(
            f"  {skipped_not_archived} of {sources_seen} registered source(s) were "
            "not archived locally and were excluded",
            file=sys.stderr,
        )
    if skipped_missing_file:
        print(
            f"  {skipped_missing_file} of {sources_seen} registered source(s) are "
            "recorded as archived but absent from the local mirror and were excluded",
            file=sys.stderr,
        )
    if skipped_no_year:
        print(
            f"  {skipped_no_year} of {sources_seen} registered source(s) carry no "
            "parseable year in their id and were excluded",
            file=sys.stderr,
        )
    if sources_read == 0:
        print(
            "  no archived national source was read; this result describes an "
            "empty corpus, not a clean one",
            file=sys.stderr,
        )
    return sorted(keys)


def cmd_validate_curated(args: argparse.Namespace) -> int:
    sources = load_sources(Path(args.sources_path))
    if readable_national_sources(
        sources, local_root=Path(args.local_root), manifest_path=Path(args.manifest_path)
    ) == 0:
        print(
            "no archived national source is readable; refusing to report coverage "
            "over an empty corpus -- run `fetch` first",
            file=sys.stderr,
        )
        return 1
    try:
        keys = collect_national_party_keys(
            sources, local_root=Path(args.local_root), manifest_path=Path(args.manifest_path)
        )
    except NationalResultsCsvNotFoundError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
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
    target_distrito = normalize_distrito_code(distrito_code)
    target_seccion = normalize_seccion_code(seccion_code)
    mesas: set[int] = set()
    # Split by REASON: "never fetched" and "manifest says ok but the local
    # mirror has no such file" are different failures -- one needs a fetch, the
    # other means the archive drifted -- and one shared counter hides which.
    skipped_not_archived = 0
    skipped_missing_file = 0
    sources_seen = 0
    for entry in sources.get("national", []):
        if source_year(entry["id"]) != year:
            continue
        # Counted only after the year filter: a source for another year is out of
        # scope, not missing.
        sources_seen += 1
        archived = latest_ok_record(records, entry["id"])
        if archived is None:
            skipped_not_archived += 1
            continue
        filename = (archived.get("archived_path") or "").rsplit("/", 1)[-1]
        if not local_store.exists("national", filename):
            skipped_missing_file += 1
            continue
        raw_bytes = local_store.read("national", filename)
        with tempfile.TemporaryDirectory(prefix="votus-etl-load-curated-") as extract_dir:
            csv_bytes = resolve_national_results_bytes(raw_bytes, extract_dir=Path(extract_dir))
        for row in ingest_national(csv_bytes, archive_entry_id=entry["id"]):
            if (
                normalize_distrito_code(row.result.distrito) == target_distrito
                and normalize_seccion_code(row.result.seccion) == target_seccion
                and row.mesa is not None
            ):
                mesas.add(row.mesa)
    if skipped_not_archived:
        print(
            f"  {skipped_not_archived} of {sources_seen} registered source(s) have "
            "no successful archive record and were excluded",
            file=sys.stderr,
        )
    if skipped_missing_file:
        print(
            f"  {skipped_missing_file} of {sources_seen} registered source(s) are "
            "recorded as archived but absent from the local mirror and were excluded",
            file=sys.stderr,
        )
    return mesas


class MissingArchivedYearError(RuntimeError):
    """Raised when mesa stability is requested for a year with no readable
    archived source -- absence of data is not evidence of instability."""


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
    archived on disk for 2023/2025 (task 15.11).

    A year with NO readable archived source is refused, not computed. An
    unread year yields an empty mesa set, which `compute_mesa_stability`
    cannot distinguish from a year whose mesas genuinely vanished: every mesa
    would be persisted as `present_2023=False, stable_across_years=False` --
    absence of a source rendered as measured instability, which the
    jurisdiction-model spec states MUST NOT be assumed.
    """
    party_map = load_party_map(party_map_path)
    crosswalk = load_crosswalk(crosswalk_path)

    for required_year in (2023, 2025):
        if (
            readable_national_sources(
                sources,
                local_root=local_root,
                manifest_path=manifest_path,
                year=required_year,
            )
            == 0
        ):
            raise MissingArchivedYearError(
                f"no archived national source is readable for {required_year}; "
                "refusing to compute mesa stability, which would record every "
                f"mesa as absent in {required_year} rather than unmeasured"
            )

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
    if readable_national_sources(
        sources, local_root=Path(args.local_root), manifest_path=Path(args.manifest_path)
    ) == 0:
        # `mesa_crosswalk`'s per-year presence is COMPUTED from the archived
        # corpus. With nothing archived, every mesa set is empty, no stability
        # row is emitted, and "loaded 0 row(s) into mesa_crosswalk" exits 0 --
        # stability UNKNOWN rendered as a clean load. Same refusal the two
        # validate commands make.
        print(
            "no archived national source is readable; refusing to compute mesa "
            "stability over an empty corpus -- run `fetch` first",
            file=sys.stderr,
        )
        return 1
    try:
        counts = load_curated(
            database_url=database_url,
            sources=sources,
            local_root=Path(args.local_root),
            manifest_path=Path(args.manifest_path),
            party_map_path=Path(args.party_map_path),
            crosswalk_path=Path(args.crosswalk_path),
        )
    except MissingArchivedYearError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1

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
    ingest_parser.add_argument("--crosswalk-path", default=str(DEFAULT_CROSSWALK_PATH))
    ingest_parser.add_argument("--party-map-path", default=str(DEFAULT_PARTY_MAP_PATH))
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

    backfill_parser = subparsers.add_parser(
        "backfill-mesa-tipo",
        help="Populate result_row.mesa_tipo from the archived sources without re-ingesting.",
    )
    backfill_parser.add_argument("--database-url", default=None)
    # Batched so progress commits incrementally: a single 16,5-million-row
    # UPDATE loses everything if the client dies, which it did.
    backfill_parser.add_argument("--batch-size", type=int, default=1_500_000)
    backfill_parser.set_defaults(func=cmd_backfill_mesa_tipo)

    return parser


def apply_mesa_tipo_mapping(conn, mapping, *, batch_size: int = 1_500_000):
    """Apply a lineage->mesa_tipo mapping to `result_row`, in batches.

    Extracted so the UPDATE path is testable at all. Its only prior
    coverage stopped at `parse_args` — the same shape as the two validate
    commands whose tests bypassed the archive path they existed to cover.

    Returns `(updated, resolved_jurisdictions, remaining_breakdown,
    unresolved_breakdown)`.
    """
    with conn.cursor() as cur:
        # Two steps, deliberately. Joining the lineage tuples straight onto
        # `result_row` makes Postgres re-resolve every mesa for each of the
        # 16,5 million rows; measured, that ran past 13 minutes without
        # finishing. Resolving the mapping to `jurisdiction_id` ONCE — a few
        # hundred thousand rows — turns the second step into an indexed join.
        # ONE set-based insert, not one lookup per tuple. `IS NOT DISTINCT
        # FROM` across several nullable columns is not hash-joinable and
        # degrades to a nested loop, so issuing it 163.000 times is the
        # shape rule 10 warns about. Collapsing the lineage to a single
        # NULL-safe text key restores a hash join.
        cur.execute(
            "create temporary table jur_tipo "
            "(jurisdiction_id uuid, tipo text, merge_key text)"
        )
        cur.execute(
            """
            insert into jur_tipo (jurisdiction_id, tipo, merge_key)
            select j.id, v.tipo, v.merge_key
              from unnest(%s::text[], %s::text[]) as v(merge_key, tipo)
              join jurisdiction j
                -- No lpad here. Both sides now go through
                -- `jurisdiction.py`'s normalizers -- the write boundary in
                -- `db.upsert_jurisdiction` pads all three codes, and the keys
                -- above use the same functions. Compensating in SQL would be a
                -- second idea of the same code, and `lpad` additionally
                -- TRUNCATES a wider value from the right where `zfill` never
                -- does, so the two would disagree on any longer code.
                -- `establecimiento_code` IS part of `jurisdiction`'s unique
                -- key, so it belongs in the merge key. The national sources
                -- publish no establecimiento column and every mesa-level row
                -- this backfill targets carries NULL there, but omitting the
                -- column would silently bind two mesa-level jurisdictions
                -- differing only by establecimiento to one key the day a
                -- source does publish it.
                on """
            + MERGE_KEY_SQL
            + """ = v.merge_key
               -- mesa_tipo is a property of a MESA, so only mesa-level
               -- jurisdictions can carry it. Without this, a national
               -- lineage tuple could bind a PBA row, where `027` means a
               -- PARTIDO rather than a seccion — the scheme collision that
               -- attributed 32.291 Coronel Rosales votes to the province.
               and j.mesa_code is not null
            """,
            (
                [merge_key(k[0], k[1], k[2], None, k[3]) for k in mapping],
                list(mapping.values()),
            ),
        )
        # Two lineage keys can resolve to ONE jurisdiction. Postgres would
        # then pick a `tipo` arbitrarily and say nothing — rule 4's silent
        # pick. Detect it and refuse rather than guess.
        cur.execute(
            """
            select jurisdiction_id, count(distinct tipo)
              from jur_tipo group by 1 having count(distinct tipo) > 1
            """
        )
        conflicts = cur.fetchall()
        if conflicts:
            raise RuntimeError(
                f"{len(conflicts)} jurisdiction(s) resolved to more than one mesa_tipo; "
                "refusing to pick one arbitrarily. First: "
                f"{conflicts[0][0]}"
            )
        cur.execute("select count(distinct jurisdiction_id) from jur_tipo")
        resolved_jurisdictions = cur.fetchone()[0]
        # Which mesas failed to bind, by scope. A bare total ("N matched no
        # jurisdiction") cannot distinguish a whole seccion that was never
        # ingested from scattered lineage mismatches inside one that was, and
        # those need opposite fixes. Same standard the per-source
        # `remaining_breakdown` below already applies.
        cur.execute("select distinct merge_key from jur_tipo")
        resolved_keys = {row[0] for row in cur.fetchall()}
        unresolved: dict[tuple[str, str], int] = {}
        for key in mapping:
            key_text = merge_key(key[0], key[1], key[2], None, key[3])
            if key_text not in resolved_keys:
                scope = (key[0] or "", key[1] or "")
                unresolved[scope] = unresolved.get(scope, 0) + 1
        unresolved_breakdown = sorted(unresolved.items())
        cur.execute("create index on jur_tipo (jurisdiction_id)")

        updated = 0
        while True:
            cur.execute(
                """
                with batch as (
                    select r.id from result_row r
                    join jur_tipo t on t.jurisdiction_id = r.jurisdiction_id
                    where r.mesa_tipo is null
                    limit %s
                )
                update result_row r set mesa_tipo = t.tipo
                  from jur_tipo t
                 where r.id in (select id from batch)
                   and t.jurisdiction_id = r.jurisdiction_id
                """,
                (batch_size,),
            )
            if cur.rowcount == 0:
                break
            updated += cur.rowcount
            conn.commit()
            print(f"  … {updated} rows", file=sys.stderr)

        cur.execute(
            """
            -- `result_row.archive_entry_id` carries the source id from
            -- `sources.yaml` (e.g. `national/2023-generales`), not a foreign
            -- key into `archive_entry`, so it IS the label. Joining on it
            -- against `archive_entry.id` matched nothing and referenced a
            -- column that does not exist.
            select r.archive_entry_id, count(*)
              from result_row r
             where r.mesa_tipo is null
             group by 1 order by 2 desc
            """
        )
        remaining_breakdown = cur.fetchall()
        conn.commit()
    return updated, resolved_jurisdictions, remaining_breakdown, unresolved_breakdown


def cmd_backfill_mesa_tipo(args: argparse.Namespace) -> int:
    """Populate `result_row.mesa_tipo` without re-ingesting the corpus.

    The column was added late, so already-correct rows carry NULL.
    Re-ingesting to fill one column means re-parsing 13,6 million PASO rows
    — about 47 minutes, which this environment could not sustain.

    But `mesa_tipo` is a property of the MESA: mesa 9001 in distrito 02 /
    seccion 027 is EXTRANJEROS for every category and every list. Collapsing
    the sources to the distinct lineage->tipo mapping is a few hundred
    thousand tuples, and applying it is an UPDATE joined on jurisdiction.
    """
    # Resolved BEFORE the archives are parsed, and reported as an exit code
    # rather than a traceback — matching `cmd_ingest` and `cmd_load_curated`.
    # Parsing 13,6 million rows first and only then discovering there is no
    # database URL burns minutes to reach an error known at argument time.
    try:
        database_url = resolve_database_url(args.database_url)
    except MissingDatabaseUrlError as exc:
        print(str(exc), file=sys.stderr)
        return 1

    sources = load_sources(Path(args.sources_path))
    records = load_manifest(Path(args.manifest_path))
    local_store = LocalArchiveStore(root=Path(args.local_root))

    candidates: dict[tuple[str, str, str, int], set[str]] = {}
    # Split by REASON: "never fetched" and "manifest says ok but the local
    # mirror has no such file" are different failures -- one needs a fetch, the
    # other means the archive drifted -- and one shared counter hides which.
    skipped_not_archived = 0
    skipped_missing_file = 0
    sources_seen = 0
    for entry in sources.get("national", []):
        archived = latest_ok_record(records, entry["id"])
        sources_seen += 1
        if archived is None:
            skipped_not_archived += 1
            continue
        filename = (archived.get("archived_path") or "").rsplit("/", 1)[-1]
        if not local_store.exists("national", filename):
            skipped_missing_file += 1
            continue
        raw_bytes = local_store.read("national", filename)
        try:
            with tempfile.TemporaryDirectory(prefix="votus-etl-backfill-") as extract_dir:
                csv_bytes = resolve_national_results_bytes(
                    raw_bytes, extract_dir=Path(extract_dir)
                )
        except NationalResultsCsvNotFoundError as exc:
            print(f"error: {exc}", file=sys.stderr)
            return 1
        # Same BOM reason as `resolve_national_results_bytes`: with `utf-8`
        # every row would miss `distrito_id` and land in `skipped_malformed`,
        # emptying the mapping and failing the backfill on a valid file.
        reader = csv.DictReader(io.StringIO(csv_bytes.decode("utf-8-sig")))
        collect_mesa_tipo_mapping(reader, source_label=entry["id"], into=candidates)

    if skipped_not_archived:
        print(
            f"  {skipped_not_archived} of {sources_seen} registered source(s) have "
            "no successful archive record and were excluded from the mapping",
            file=sys.stderr,
        )
    if skipped_missing_file:
        print(
            f"  {skipped_missing_file} of {sources_seen} registered source(s) are "
            "recorded as archived but absent from the local mirror and were "
            "excluded from the mapping",
            file=sys.stderr,
        )

    # One conflict check over EVERY source, not per file: mesa (02,027,00001,1)
    # being NATIVOS in 2023 and EXTRANJEROS in 2025 is exactly the disagreement
    # a per-file check cannot see.
    conflicts = {key: tipos for key, tipos in candidates.items() if len(tipos) > 1}
    if conflicts:
        key, tipos = next(iter(conflicts.items()))
        print(
            f"{len(conflicts)} mesa(s) carry more than one mesa_tipo across the archived "
            f"sources; refusing to pick one. First: {key} -> {sorted(tipos)}",
            file=sys.stderr,
        )
        return 1

    mapping = {key: next(iter(tipos)) for key, tipos in candidates.items()}
    if not mapping:
        print("no mesa_tipo mapping found in any archived national source", file=sys.stderr)
        return 1

    with psycopg.connect(database_url) as conn:
        (
            updated,
            resolved_jurisdictions,
            remaining_breakdown,
            unresolved_breakdown,
        ) = apply_mesa_tipo_mapping(
            conn, mapping, batch_size=args.batch_size
        )
    remaining = sum(count for _, count in remaining_breakdown)

    print(
        f"backfilled mesa_tipo on {updated} rows; {len(mapping)} distinct mesas mapped, "
        f"{resolved_jurisdictions} resolved to a jurisdiction"
    )
    if unresolved_breakdown:
        total_unresolved = sum(count for _, count in unresolved_breakdown)
        print(
            f"  {total_unresolved} mapped mesas matched no jurisdiction, by scope:",
            file=sys.stderr,
        )
        for (distrito, seccion), count in unresolved_breakdown:
            print(f"    distrito={distrito} seccion={seccion}: {count}", file=sys.stderr)
    # The remainder is REPORTED per source, never explained by assertion. It may
    # be a source that does not publish the field, or a lineage that failed to
    # match — those look identical in a single total.
    print(f"{remaining} rows still have no mesa_tipo:")
    for source, count in remaining_breakdown:
        print(f"  {source}: {count}")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
