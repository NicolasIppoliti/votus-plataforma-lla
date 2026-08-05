"""RED tests for the runtime CLI entrypoint (task 12a).

`tasks.md`'s own work-unit table names four runtime harnesses --
``uv run python -m etl fetch --source ...``, ``... ingest --source ...``,
``... validate-crosswalk``, ``... validate-curated`` -- that no numbered
task ever built before this phase. This file is the RED evidence that
proves each one now exists and behaves per its own promise: exit 0 on
success, non-zero on validation failure, and NEVER a silent no-op or a
silent default database connection.
"""

from __future__ import annotations

import hashlib
import io
import json
import os
import uuid
import zipfile
from dataclasses import dataclass, field
from pathlib import Path

import psycopg
import pytest
import yaml

from etl.__main__ import (
    MissingDatabaseUrlError,
    NationalResultsCsvNotFoundError,
    UnknownSourceError,
    collect_mesa_tipo_mapping,
    collect_national_jurisdiction_codes,
    collect_national_party_keys,
    fetch_source,
    find_unmapped_jurisdictions,
    find_unmapped_parties,
    ingest_source,
    main,
    resolve_national_results_bytes,
)
from etl.archive import FetchResponse
from etl.crosswalk import (
    FISCALIZACION_VOTE_COLUMNS,
    CrosswalkTable,
    JurisdictionCrosswalkEntry,
    load_crosswalk,
)
from etl.party_map import load_party_map
from etl.storage import LocalArchiveStore

REPO_ROOT = Path(__file__).parent.parent.parent
CROSSWALK_PATH = REPO_ROOT / "curated" / "crosswalk.yaml"
PARTY_MAP_PATH = REPO_ROOT / "curated" / "party_map.yaml"

FAKE_SOURCES = {
    "national": [
        {
            "id": "national/fake-test",
            "source": "example.test",
            "source_url": "https://example.test/results.zip",
            "mime": "application/zip",
            "notes": "fixture only, never fetched over the network",
            "filename": "fake-test.zip",
        }
    ]
}


@dataclass
class FakeFetcher:
    """No network at all -- returns canned bytes for every `.get()` call."""

    payload: bytes = b"fake-zip-bytes"
    calls: list[str] = field(default_factory=list)

    def get(
        self, url: str, *, timeout: float, headers: dict[str, str] | None = None
    ) -> FetchResponse:
        self.calls.append(url)
        return FetchResponse(status_code=200, content=self.payload, headers={})


# ---------------------------------------------------------------------------
# 12.1 -- fetch archives a registered source, no network
# ---------------------------------------------------------------------------


def test_fetch_subcommand_archives_a_registered_source(tmp_path: Path) -> None:
    fetcher = FakeFetcher()
    manifest_path = tmp_path / "archive-manifest.json"
    local_root = tmp_path / "archive"

    result = fetch_source(
        "national/fake-test",
        sources=FAKE_SOURCES,
        fetcher=fetcher,
        local_root=local_root,
        manifest_path=manifest_path,
    )

    assert result.record["status"] == "ok"
    assert result.record["id"] == "national/fake-test"
    assert (local_root / "national" / "fake-test.zip").read_bytes() == fetcher.payload
    assert manifest_path.exists()
    assert fetcher.calls == ["https://example.test/results.zip"]


# ---------------------------------------------------------------------------
# 12.2 -- an unregistered source name is an error, never a silent no-op
# ---------------------------------------------------------------------------


def test_fetch_rejects_an_unregistered_source_name(tmp_path: Path) -> None:
    fetcher = FakeFetcher()

    with pytest.raises(UnknownSourceError):
        fetch_source(
            "national/does-not-exist",
            sources=FAKE_SOURCES,
            fetcher=fetcher,
            local_root=tmp_path / "archive",
            manifest_path=tmp_path / "archive-manifest.json",
        )

    assert fetcher.calls == [], "an unregistered source must never reach the network"


# ---------------------------------------------------------------------------
# 12.6 -- ingest refuses to write without an explicit database URL
# ---------------------------------------------------------------------------


def test_ingest_refuses_to_write_without_an_explicit_database_url(tmp_path: Path) -> None:
    env_without_url = dict(os.environ)
    env_without_url.pop("ETL_DATABASE_URL", None)
    os_environ_backup = dict(os.environ)
    os.environ.clear()
    os.environ.update(env_without_url)
    try:
        with pytest.raises(MissingDatabaseUrlError):
            ingest_source(
                "national/fake-test",
                database_url=None,
                year=2025,
                round_="legislativas",
                sources=FAKE_SOURCES,
                local_root=tmp_path / "archive",
                manifest_path=tmp_path / "archive-manifest.json",
            )
    finally:
        os.environ.clear()
        os.environ.update(os_environ_backup)


# ---------------------------------------------------------------------------
# 12.3 -- ingest loads rows into result_row (real ephemeral Postgres)
# ---------------------------------------------------------------------------

TEST_DSN = os.environ.get(
    "ETL_TEST_DATABASE_URL", "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
)


def _require_ephemeral_postgres() -> None:
    try:
        conn = psycopg.connect(TEST_DSN, connect_timeout=2)
        conn.close()
        return None
    except psycopg.OperationalError as exc:
        pytest.skip(f"no ephemeral Postgres reachable at {TEST_DSN!r}: {exc}")


NATIONAL_CSV = (
    "distrito_id,seccion_id,circuito_id,mesa_id,cargo_nombre,agrupacion_id,"
    "votos_tipo,votos_cantidad,estado_final\n"
    "02,027,01,1,DIPUTADO NACIONAL,135,POSITIVO,120,definitivo\n"
    "02,027,01,1,DIPUTADO NACIONAL,134,POSITIVO,80,definitivo\n"
)


def test_ingest_subcommand_loads_rows_into_result_row(tmp_path: Path) -> None:
    _require_ephemeral_postgres()

    source_id = f"national/cli-test-{uuid.uuid4()}"
    sources = {
        "national": [
            {
                "id": source_id,
                "source": "example.test",
                "source_url": "https://example.test/cli-test.csv",
                "mime": "text/csv",
                "notes": "CLI integration fixture",
                "filename": "cli-test.csv",
            }
        ]
    }
    fetcher = FakeFetcher(payload=NATIONAL_CSV.encode("utf-8"))
    manifest_path = tmp_path / "archive-manifest.json"
    local_root = tmp_path / "archive"

    fetch_source(
        source_id,
        sources=sources,
        fetcher=fetcher,
        local_root=local_root,
        manifest_path=manifest_path,
    )

    conn = psycopg.connect(TEST_DSN)
    try:
        inserted = ingest_source(
            source_id,
            database_url=TEST_DSN,
            year=2025,
            round_="legislativas",
            sources=sources,
            local_root=local_root,
            manifest_path=manifest_path,
        )
        assert inserted == 2

        with conn.cursor() as cur:
            cur.execute(
                "select count(*) from result_row where archive_entry_id = %s", (source_id,)
            )
            (count,) = cur.fetchone()
        assert count == 2
    finally:
        with conn.cursor() as cur:
            cur.execute("delete from result_row where archive_entry_id = %s", (source_id,))
        conn.commit()
        conn.close()


def test_ingest_extracts_the_results_csv_from_a_zip_archived_national_source(
    tmp_path: Path,
) -> None:
    """A real registered national source is a ZIP (per `sources.yaml`), not
    a bare CSV -- `ingest` must extract the results member before parsing,
    the same `extract_zip_safely`-then-`ingest_national` path
    `tests/test_ingest_national.py::test_idempotent_reingest_via_real_fixture_zip`
    already proves at the parser level, exercised here end to end through
    the CLI (task 12d's real-pipeline proof needs exactly this path).
    """
    _require_ephemeral_postgres()

    import io
    import zipfile

    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("resultados2025.csv", NATIONAL_CSV)
        zf.writestr("ambitosElectorales.csv", "not,the,results,file\n")
    zip_bytes = buffer.getvalue()

    source_id = f"national/cli-zip-test-{uuid.uuid4()}"
    sources = {
        "national": [
            {
                "id": source_id,
                "source": "example.test",
                "source_url": "https://example.test/cli-zip-test.zip",
                "mime": "application/zip",
                "notes": "CLI ZIP-extraction fixture",
                "filename": "cli-zip-test.zip",
            }
        ]
    }
    fetcher = FakeFetcher(payload=zip_bytes)
    manifest_path = tmp_path / "archive-manifest.json"
    local_root = tmp_path / "archive"

    fetch_source(
        source_id,
        sources=sources,
        fetcher=fetcher,
        local_root=local_root,
        manifest_path=manifest_path,
    )

    conn = psycopg.connect(TEST_DSN)
    try:
        inserted = ingest_source(
            source_id,
            database_url=TEST_DSN,
            year=2025,
            round_="legislativas",
            sources=sources,
            local_root=local_root,
            manifest_path=manifest_path,
        )
        assert inserted == 2

        with conn.cursor() as cur:
            cur.execute(
                "select count(*) from result_row where archive_entry_id = %s", (source_id,)
            )
            (count,) = cur.fetchone()
        assert count == 2
    finally:
        with conn.cursor() as cur:
            cur.execute("delete from result_row where archive_entry_id = %s", (source_id,))
        conn.commit()
        conn.close()


# ---------------------------------------------------------------------------
# review_item persistence reaches production through `ingest_source`
# ---------------------------------------------------------------------------


FISCALIZACION_HEADER = (
    "Escuela,Mesa," + ",".join(FISCALIZACION_VOTE_COLUMNS) + "\n"
)


def _fiscalizacion_csv(rows: list[str]) -> str:
    return FISCALIZACION_HEADER + "".join(rows)


def test_ingest_persists_the_review_items_the_fiscalizacion_run_produced(
    tmp_path: Path,
) -> None:
    """Drives `ingest_source`, not the projection function.

    `insert_review_items` was fully implemented and fully tested with ZERO
    production callers, so every review item a real ingestion produced died in
    memory while `review_item.py` documented that function as "the only write
    path". A test that calls the projection proves nothing reaches it.
    """
    _require_ephemeral_postgres()

    zeros = ",".join(["0"] * (len(FISCALIZACION_VOTE_COLUMNS) - 1))
    # One blank vote cell: blank is MISSING, not zero, so ingestion raises a
    # `blank_vote_cell` review item -- the draft this test follows to the table.
    csv_text = _fiscalizacion_csv([f"ESCUELA TEST,Mesa 4242,,{zeros}\n"])

    source_id = f"fiscalizacion/cli-review-item-{uuid.uuid4()}"
    filename = "cli-review-item.csv"
    sources = {
        "fiscalizacion": [
            {
                "id": source_id,
                "source": "internal",
                "source_url": None,
                "mime": "text/csv",
                "notes": "CLI review-item fixture",
                "filename": filename,
                "upload": "never",
            }
        ]
    }
    manifest_path = tmp_path / "archive-manifest.json"
    local_root = tmp_path / "archive"
    # Written straight to the local mirror: fiscalización is upload-forbidden,
    # so there is no `fetch` path to produce it.
    LocalArchiveStore(root=local_root).write(
        "fiscalizacion", filename, csv_text.encode("utf-8")
    )
    manifest_path.write_text(
        json.dumps(
            [
                {
                    "id": source_id,
                    "status": "ok",
                    "archived_path": f"archive/fiscalizacion/{filename}",
                    "sha256": hashlib.sha256(csv_text.encode("utf-8")).hexdigest(),
                    "fetched_at": "2026-01-01T00:00:00Z",
                }
            ]
        ),
        encoding="utf-8",
    )

    conn = psycopg.connect(TEST_DSN)
    try:
        ingest_source(
            source_id,
            database_url=TEST_DSN,
            year=2025,
            round_="legislativas",
            sources=sources,
            local_root=local_root,
            manifest_path=manifest_path,
        )
        with conn.cursor() as cur:
            cur.execute(
                "select kind, severity from review_item where subject_ref = %s",
                (f"{source_id} mesa 4242",),
            )
            written = cur.fetchall()
    finally:
        with conn.cursor() as cur:
            cur.execute(
                "delete from review_item where subject_ref = %s",
                (f"{source_id} mesa 4242",),
            )
            cur.execute(
                "delete from result_row where archive_entry_id = %s", (source_id,)
            )
        conn.commit()
        conn.close()

    assert written == [("blank_vote_cell", "info")], (
        "the ingestion's review item must reach `review_item`, scoped by source "
        f"id so two sources observing the same mesa number stay distinct; got {written}"
    )


def test_a_distrito_level_code_with_no_seccion_resolves_through_its_distrito() -> None:
    """The coarser-than-seccion branch, which nothing exercised.

    The 2023 national file bundles ten categories down to MIEMBROS DE JUNTA
    COMUNAL, so rows with NO seccion are what actually runs against it. Every
    other test passes a pair with both halves populated.
    """
    crosswalk = CrosswalkTable(
        jurisdictions=(
            JurisdictionCrosswalkEntry(
                pba_distrito_code="027",
                national_distrito_code="02",
                national_seccion_code="027",
                name="Coronel de Marina Leonardo Rosales",
            ),
        )
    )

    mapped = find_unmapped_jurisdictions([("2", None)], crosswalk)
    unmapped = find_unmapped_jurisdictions([("7", None)], crosswalk)

    assert mapped == [], (
        "a distrito-level row whose DISTRITO is curated is mapped; requiring a "
        "seccion match would report every coarse row of the 2023 file unmapped"
    )
    assert len(unmapped) == 1, "an uncurated distrito must still be reported"
    assert "(sin seccion)" in unmapped[0].code, (
        "the report must not invent a seccion for a row that carries none; "
        f"got {unmapped[0].code!r}"
    )


def test_a_zip_with_no_results_member_raises_rather_than_returning_a_wrong_file(
    tmp_path: Path,
) -> None:
    """`NationalResultsCsvNotFoundError` was raised and never asserted."""
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as zf:
        zf.writestr("ambitosElectorales.csv", "not,the,results,file\n")
        # Substring-matches `mesa_id` without BEING it: the shape the parsed
        # field-set check exists to reject.
        zf.writestr("otro.csv", "mesa_id_original,distrito_id\n")

    with pytest.raises(NationalResultsCsvNotFoundError):
        resolve_national_results_bytes(buffer.getvalue(), extract_dir=tmp_path)


def test_a_zip_with_no_results_member_exits_nonzero_through_main(tmp_path: Path) -> None:
    """The CLI CONTRACT, not just the exception.

    "Exit codes: 0 on success, non-zero on any argument or validation failure"
    is the module's own promise; an archive whose schema drifted was ending in
    a traceback instead.
    """
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as zf:
        zf.writestr("ambitosElectorales.csv", "not,the,results,file\n")

    source_id = f"national/2025-bad-zip-{uuid.uuid4()}"
    filename = f"{uuid.uuid4().hex}.zip"
    local_root = tmp_path / "archive"
    LocalArchiveStore(root=local_root).write("national", filename, buffer.getvalue())
    sources_path = tmp_path / "sources.yaml"
    sources_path.write_text(
        yaml.safe_dump(
            {
                "national": [
                    {
                        "id": source_id,
                        "source": "example.test",
                        "source_url": "https://example.test/bad.zip",
                        "mime": "application/zip",
                        "notes": "schema-drift fixture",
                        "filename": filename,
                    }
                ]
            }
        ),
        encoding="utf-8",
    )
    manifest_path = tmp_path / "archive-manifest.json"
    manifest_path.write_text(
        json.dumps(
            [
                {
                    "id": source_id,
                    "status": "ok",
                    "archived_path": f"archive/national/{filename}",
                    "sha256": hashlib.sha256(buffer.getvalue()).hexdigest(),
                    "fetched_at": "2026-01-01T00:00:00Z",
                }
            ]
        ),
        encoding="utf-8",
    )
    crosswalk_path = tmp_path / "crosswalk.yaml"
    crosswalk_path.write_text(yaml.safe_dump({"jurisdictions": []}), encoding="utf-8")

    exit_code = main(
        _main_args(sources_path, local_root, manifest_path)
        + ["validate-crosswalk", "--crosswalk-path", str(crosswalk_path)]
    )

    assert exit_code == 1, "a drifted archive must exit nonzero, not raise"


# ---------------------------------------------------------------------------
# The subcommands are reachable THROUGH `main()`, not only as functions
# ---------------------------------------------------------------------------


def _archived_national_corpus(tmp_path: Path, csv_text: str) -> tuple[dict, Path, Path]:
    """One archived national source, wired the way `main()` expects to find it."""
    # Year-prefixed: `collect_national_party_keys` derives the year from the
    # first four digits of the id, so an id with none is excluded as unparseable.
    source_id = f"national/2025-main-test-{uuid.uuid4()}"
    filename = f"{uuid.uuid4().hex}.csv"
    local_root = tmp_path / "archive"
    manifest_path = tmp_path / "archive-manifest.json"
    LocalArchiveStore(root=local_root).write(
        "national", filename, csv_text.encode("utf-8")
    )
    sources_path = tmp_path / "sources.yaml"
    sources_path.write_text(
        yaml.safe_dump(
            {
                "national": [
                    {
                        "id": source_id,
                        "source": "example.test",
                        "source_url": "https://example.test/main-test.csv",
                        "mime": "text/csv",
                        "notes": "main() wiring fixture",
                        "filename": filename,
                    }
                ]
            }
        ),
        encoding="utf-8",
    )
    manifest_path.write_text(
        json.dumps(
            [
                {
                    "id": source_id,
                    "status": "ok",
                    "archived_path": f"archive/national/{filename}",
                    "sha256": hashlib.sha256(csv_text.encode("utf-8")).hexdigest(),
                    "fetched_at": "2026-01-01T00:00:00Z",
                }
            ]
        ),
        encoding="utf-8",
    )
    return sources_path, local_root, manifest_path


def _main_args(sources_path: Path, local_root: Path, manifest_path: Path) -> list[str]:
    return [
        "--sources-path",
        str(sources_path),
        "--local-root",
        str(local_root),
        "--manifest-path",
        str(manifest_path),
    ]


def test_validate_crosswalk_is_reachable_through_main(tmp_path: Path, capsys) -> None:
    """Drives `main(["validate-crosswalk", ...])`, not `find_unmapped_*`.

    Rule 1 names these two validate commands by name: their four tests
    exercised downstream pure functions and bypassed the archive-reading path
    they existed to cover. Deleting the `add_parser` call left the suite green.
    """
    sources_path, local_root, manifest_path = _archived_national_corpus(
        tmp_path, NATIONAL_CSV
    )
    # A crosswalk that maps NOTHING: the command must FAIL, so a green exit
    # cannot come from an empty corpus or a skipped read.
    crosswalk_path = tmp_path / "crosswalk.yaml"
    crosswalk_path.write_text(yaml.safe_dump({"jurisdictions": []}), encoding="utf-8")

    exit_code = main(
        _main_args(sources_path, local_root, manifest_path)
        + ["validate-crosswalk", "--crosswalk-path", str(crosswalk_path)]
    )

    output = capsys.readouterr()
    assert exit_code == 1, "an unmapped code must exit nonzero"
    assert "02" in output.out + output.err, (
        "the code read FROM THE ARCHIVE must appear in the report; "
        f"got {output.out + output.err!r}"
    )


def test_validate_curated_is_reachable_through_main(tmp_path: Path, capsys) -> None:
    """Same wiring proof for the second command rule 1 names."""
    sources_path, local_root, manifest_path = _archived_national_corpus(
        tmp_path, NATIONAL_CSV
    )
    party_map_path = tmp_path / "party_map.yaml"
    party_map_path.write_text(yaml.safe_dump({"parties": []}), encoding="utf-8")

    exit_code = main(
        _main_args(sources_path, local_root, manifest_path)
        + ["validate-curated", "--party-map-path", str(party_map_path)]
    )

    output = capsys.readouterr()
    assert exit_code == 1, "an unmapped list id must exit nonzero"
    assert "135" in output.out + output.err, (
        "the list id read FROM THE ARCHIVE must appear in the report; "
        f"got {output.out + output.err!r}"
    )


def test_ingest_is_reachable_through_main(tmp_path: Path) -> None:
    """`ingest` had no `main()`-driven test either."""
    _require_ephemeral_postgres()

    sources_path, local_root, manifest_path = _archived_national_corpus(
        tmp_path, NATIONAL_CSV
    )
    source_id = yaml.safe_load(sources_path.read_text())["national"][0]["id"]

    conn = psycopg.connect(TEST_DSN)
    try:
        exit_code = main(
            _main_args(sources_path, local_root, manifest_path)
            + [
                "ingest",
                "--source",
                source_id,
                "--database-url",
                TEST_DSN,
                "--year",
                "2025",
                "--round",
                "legislativas",
            ]
        )
        with conn.cursor() as cur:
            cur.execute(
                "select count(*) from result_row where archive_entry_id = %s",
                (source_id,),
            )
            (count,) = cur.fetchone()
    finally:
        with conn.cursor() as cur:
            cur.execute(
                "delete from result_row where archive_entry_id = %s", (source_id,)
            )
        conn.commit()
        conn.close()

    assert exit_code == 0, "a well-formed ingest must exit zero"
    assert count == 2, f"the CLI must write the archived rows; got {count}"


# ---------------------------------------------------------------------------
# 12.4 -- validate-crosswalk reports unmapped codes and exits nonzero
# ---------------------------------------------------------------------------


def test_validate_crosswalk_reports_unmapped_codes() -> None:
    crosswalk = load_crosswalk(CROSSWALK_PATH)

    codes = [("02", "027"), ("99", "999")]  # second pair has no curated entry
    unmapped = find_unmapped_jurisdictions(codes, crosswalk)

    assert len(unmapped) == 1
    assert unmapped[0].code == "99/999"


def test_validate_crosswalk_reports_nothing_when_every_code_resolves() -> None:
    crosswalk = load_crosswalk(CROSSWALK_PATH)

    unmapped = find_unmapped_jurisdictions([("02", "027")], crosswalk)

    assert unmapped == []


def test_validate_crosswalk_resolves_unpadded_codes_against_zero_padded_curated_entries() -> None:
    """Phase 16b: `curated/crosswalk.yaml` records national codes
    zero-padded (`"02"`/`"027"`, confirmed directly in the file for Coronel
    Rosales), but the real archived 2023 national CSV (see
    `tests/fixtures/national_2023_sample.csv`, sliced from the real archived
    2023 PASO source) carries them UNPADDED (`distrito_id=2`,
    `seccion_id=27`). `find_unmapped_jurisdictions` -> `resolve_national`
    compares by exact string equality with no normalization, the same bug
    Phase 15 found and fixed in `collect_national_mesa_codes`. If unfixed
    here, every real 2023 code is misreported as unmapped even though it
    IS curated.
    """
    crosswalk = load_crosswalk(CROSSWALK_PATH)

    unmapped = find_unmapped_jurisdictions([("2", "27")], crosswalk)

    assert unmapped == [], (
        "an unpadded national code with a zero-padded curated match must resolve, "
        f"not be reported unmapped: {unmapped}"
    )


# ---------------------------------------------------------------------------
# 12.5 -- validate-curated reports unmapped list ids and exits nonzero
# ---------------------------------------------------------------------------


def test_validate_curated_reports_unmapped_list_ids() -> None:
    party_map = load_party_map(PARTY_MAP_PATH)

    keys = [
        (2025, "national", "DIPUTADO NACIONAL", "110"),  # curated
        (2025, "national", "DIPUTADO NACIONAL", "999999"),  # not curated
    ]
    unmapped = find_unmapped_parties(keys, party_map)

    assert len(unmapped) == 1
    assert unmapped[0].list_id == "999999"


def test_validate_curated_reports_nothing_when_every_key_resolves() -> None:
    party_map = load_party_map(PARTY_MAP_PATH)

    unmapped = find_unmapped_parties([(2025, "national", "DIPUTADO NACIONAL", "110")], party_map)

    assert unmapped == []


def test_fetch_refuses_a_fiscalizacion_entry_without_upload_never(tmp_path) -> None:
    """`guard_local_mirror_only` must actually run, not merely exist.

    The guard was written in phase 6 and unit-tested, but its only appearance
    in production code was its own definition -- no call site anywhere. A
    guard that never runs is a false sense of safety, and this one protects
    the single personal-data-bearing source in the project.

    Wiring it into the fetch path makes the invariant structural: a
    fiscalización entry that loses its `upload: never` declaration fails
    immediately instead of being archived and only caught by a test that
    inspects the YAML.
    """
    from etl.ingest.fiscalizacion import FiscalizacionUploadForbiddenError

    sources = {
        "fiscalizacion": [
            {
                "id": "fiscalizacion/2025-coronel-rosales",
                "source_kind": "fiscalizacion",
                "local_path": "does-not-matter.csv",
                # `upload: never` deliberately absent
            }
        ]
    }

    with pytest.raises(FiscalizacionUploadForbiddenError):
        fetch_source(
            "fiscalizacion/2025-coronel-rosales",
            sources=sources,
            fetcher=FakeFetcher(),
            local_root=tmp_path / "archive",
            manifest_path=tmp_path / "archive-manifest.json",
        )


def test_collect_functions_read_a_real_zipped_archive_entry(tmp_path) -> None:
    """`validate-crosswalk` and `validate-curated` must read a ZIP archive
    entry the same way `ingest` does.

    Both collect helpers handed the archived bytes straight to
    `ingest_national`, which expects decoded CSV. Every registered national
    source is archived as a ZIP, so on real data both commands died with
    `UnicodeDecodeError: 'utf-8' codec can't decode byte 0x80`. `cmd_ingest`
    routes through `resolve_national_results_bytes` first; these two did not.

    The four existing tests for these commands never caught it because they
    exercise the downstream pure comparison functions and bypass the
    archive-reading path entirely.
    """
    import json
    import zipfile

    local_root = tmp_path / "archive"
    (local_root / "national").mkdir(parents=True)
    zip_path = local_root / "national" / "sample.zip"
    with zipfile.ZipFile(zip_path, "w") as zf:
        zf.writestr("resultados2025.csv", NATIONAL_CSV)

    manifest_path = tmp_path / "archive-manifest.json"
    manifest_path.write_text(
        json.dumps(
            [
                {
                    "id": "national/2025-legislativas",
                    "status": "ok",
                    "archived_path": "national/sample.zip",
                }
            ]
        )
    )

    sources = {"national": [{"id": "national/2025-legislativas"}]}

    codes = collect_national_jurisdiction_codes(
        sources, local_root=local_root, manifest_path=manifest_path
    )
    assert codes, "a zipped archive entry must yield jurisdiction codes, not crash"

    keys = collect_national_party_keys(
        sources, local_root=local_root, manifest_path=manifest_path
    )
    assert keys, "a zipped archive entry must yield party keys, not crash"


# ---------------------------------------------------------------------------
# 15.9 -- load-curated is reachable from the CLI, not merely importable
# ---------------------------------------------------------------------------


def test_load_curated_populates_every_curated_table(tmp_path: Path) -> None:
    """This project has shipped correct, tested, unreachable code seven
    times (Phase 15's own charter). This test drives `load-curated` through
    `main()` -- the real argv-parsing CLI entrypoint -- never by importing
    `load_curated`/`load_party_map_rows`/`load_crosswalk_rows` directly, so
    a subcommand that exists but was never wired into `build_parser` cannot
    pass this test."""
    _require_ephemeral_postgres()

    # `X`-prefixed so the marker is NOT numeric. `upsert_jurisdiction`
    # normalizes distrito through `_zero_pad_numeric` while the mapping key
    # below is used raw, so an all-digit marker with a leading zero would be
    # stored as `"1234567"` and looked up as `"01234567"` -- a join miss on
    # ~0.2% of runs, failing for a reason unrelated to the code under test.
    marker = f"X{uuid.uuid4().hex[:8]}"
    canonical_id = f"TESTCLI_{marker}"
    # Curated `crosswalk.yaml` uses zero-padded DINE-convention codes, while
    # the RAW national CSV `distrito_id`/`seccion_id` columns are UNPADDED
    # (measured against the real archived files, task 15.11) -- using
    # different padding on each side here exercises that exact real-world
    # mismatch, not a coincidentally-matching fixture.
    csv_distrito, csv_seccion = "90", "1"
    curated_distrito, curated_seccion = "090", "001"
    # What the curated file DECLARES is not what the tables store: every write
    # goes through `jurisdiction.py`, so a 3-digit distrito in the YAML lands as
    # the national 2-digit form. Asserting the raw curated strings would pass
    # only while the crosswalk tables kept their own idea of the code.
    stored_distrito, stored_seccion = "90", "001"
    pba_distrito = f"P{marker}"

    source_2023_id = f"national/2023-cli-load-{marker}"
    source_2025_id = f"national/2025-cli-load-{marker}"
    sources = {
        "national": [
            {
                "id": source_2023_id,
                "source": "example.test",
                "source_url": "https://example.test/2023.csv",
                "mime": "text/csv",
                "notes": "load-curated CLI reachability fixture",
                "filename": "2023.csv",
            },
            {
                "id": source_2025_id,
                "source": "example.test",
                "source_url": "https://example.test/2025.csv",
                "mime": "text/csv",
                "notes": "load-curated CLI reachability fixture",
                "filename": "2025.csv",
            },
        ]
    }
    sources_path = tmp_path / "sources.yaml"
    sources_path.write_text(yaml.safe_dump(sources), encoding="utf-8")

    manifest_path = tmp_path / "archive-manifest.json"
    local_root = tmp_path / "archive"

    csv_row = (
        "distrito_id,seccion_id,circuito_id,mesa_id,cargo_nombre,agrupacion_id,"
        "votos_tipo,votos_cantidad,estado_final\n"
        f"{csv_distrito},{csv_seccion},01,1,DIPUTADO NACIONAL,900001,POSITIVO,10,definitivo\n"
    )
    for source_id in (source_2023_id, source_2025_id):
        fetch_source(
            source_id,
            sources=sources,
            fetcher=FakeFetcher(payload=csv_row.encode("utf-8")),
            local_root=local_root,
            manifest_path=manifest_path,
        )

    party_map_path = tmp_path / "party_map.yaml"
    party_map_path.write_text(
        yaml.safe_dump(
            {
                "mappings": [
                    {
                        "year": 2025,
                        "jurisdiction": "national",
                        "category": "DIPUTADO NACIONAL",
                        "list_id": "900001",
                        "canonical_party": canonical_id,
                        "party_name": "TEST CLI PARTY",
                        "source": "fixture",
                    }
                ]
            }
        ),
        encoding="utf-8",
    )

    crosswalk_path = tmp_path / "crosswalk.yaml"
    crosswalk_path.write_text(
        yaml.safe_dump(
            {
                "jurisdictions": [
                    {
                        "pba_distrito": pba_distrito,
                        "national_distrito": curated_distrito,
                        "national_seccion": curated_seccion,
                        "name": "Test Distrito",
                    }
                ]
            }
        ),
        encoding="utf-8",
    )

    exit_code = main(
        [
            "--sources-path",
            str(sources_path),
            "--local-root",
            str(local_root),
            "--manifest-path",
            str(manifest_path),
            "load-curated",
            "--database-url",
            TEST_DSN,
            "--party-map-path",
            str(party_map_path),
            "--crosswalk-path",
            str(crosswalk_path),
        ]
    )

    assert exit_code == 0

    conn = psycopg.connect(TEST_DSN)
    try:
        with conn.cursor() as cur:
            cur.execute("select display_name from party_canonical where id = %s", (canonical_id,))
            party_row = cur.fetchone()

            cur.execute(
                "select source_name from list_identity where year = 2025 "
                "and jurisdiction = 'national' and category = 'DIPUTADO NACIONAL' "
                "and list_id = '900001'"
            )
            list_identity_row = cur.fetchone()

            cur.execute(
                "select canonical_party_id from party_mapping where year = 2025 "
                "and jurisdiction = 'national' and category = 'DIPUTADO NACIONAL' "
                "and list_id = '900001'"
            )
            party_mapping_row = cur.fetchone()

            cur.execute(
                "select name from jurisdiction_crosswalk where pba_distrito_code = %s",
                (pba_distrito,),
            )
            crosswalk_row = cur.fetchone()

            cur.execute(
                "select present_2023, present_2025, stable_across_years from mesa_crosswalk "
                "where distrito_code = %s and seccion_code = %s and mesa_code = 1",
                (stored_distrito, stored_seccion),
            )
            mesa_row = cur.fetchone()
    finally:
        with conn.cursor() as cur:
            cur.execute("delete from party_mapping where canonical_party_id = %s", (canonical_id,))
            cur.execute("delete from list_identity where list_id = '900001' and year = 2025")
            cur.execute("delete from party_canonical where id = %s", (canonical_id,))
            cur.execute(
                "delete from jurisdiction_crosswalk where pba_distrito_code = %s", (pba_distrito,)
            )
            cur.execute(
                "delete from mesa_crosswalk where distrito_code = %s and seccion_code = %s",
                (stored_distrito, stored_seccion),
            )
        conn.commit()
        conn.close()

    assert party_row == ("TEST CLI PARTY",)
    assert list_identity_row == ("TEST CLI PARTY",)
    assert party_mapping_row == (canonical_id,)
    assert crosswalk_row == ("Test Distrito",)
    # Same mesa fetched in both the 2023 and 2025 fixture files -> stable.
    assert mesa_row == (True, True, True)


def test_collect_mesa_tipo_mapping_collapses_source_rows_to_distinct_mesas() -> None:
    """`mesa_tipo` must be backfillable without re-parsing the whole corpus.

    The field was added late, so 16,5 million already-correct 2023 rows carry
    NULL. Re-ingesting to populate one column means re-parsing 13,6 million
    PASO rows — about 47 minutes, which this environment could not sustain
    across four attempts.

    But `mesa_tipo` is a property of the MESA, not of a result: mesa 9001 in
    distrito 02 / seccion 027 is EXTRANJEROS for every category and every
    list. So the distinct lineage->tipo mapping is a few hundred thousand
    tuples at most, and applying it is an UPDATE, not a reload.

    This test pins the pure part: extracting the distinct mapping from source
    rows, which is what makes the backfill cheap.
    """
    rows = [
        {"distrito_id": "02", "seccion_id": "027", "circuito_id": "00001",
         "mesa_id": "1", "mesa_tipo": "NATIVOS", "cargo_nombre": "A"},
        {"distrito_id": "2", "seccion_id": "27", "circuito_id": "00001",
         "mesa_id": "1", "mesa_tipo": "NATIVOS", "cargo_nombre": "B"},
        {"distrito_id": "02", "seccion_id": "027", "circuito_id": "00001",
         "mesa_id": "9001", "mesa_tipo": "EXTRANJEROS", "cargo_nombre": "A"},
        {"distrito_id": "02", "seccion_id": "027", "circuito_id": "00001",
         "mesa_id": "5", "cargo_nombre": "A"},
    ]

    mapping = collect_mesa_tipo_mapping(rows)

    # Codes are normalized to the curated, zero-padded canonical form
    # (Phase 17's single normalization boundary, `etl.jurisdiction`), so
    # `"02"`/`"027"` and `"2"`/`"27"` describe the same mesa rather than two.
    # Every code is normalized through `jurisdiction.py`'s boundary, circuito
    # included, so `2`/`27`/`1` and `02`/`027`/`00001` describe one mesa. A row
    # with no `mesa_tipo` contributes nothing and is counted, not dropped.
    # Values are SETS: a mesa's candidate tipos stay open until every archived
    # source has been read, because two files can disagree about one mesa and a
    # per-file collapse would hide it.
    assert mapping == {
        ("02", "027", "00001", 1): {"NATIVOS"},
        ("02", "027", "00001", 9001): {"EXTRANJEROS"},
    }, "four source rows must collapse to two distinct mesas"


def test_backfill_mesa_tipo_applies_the_mapping_through_the_real_update_path() -> None:
    """Applies the mapping to a real row and reads the value back.

    Asserting only that the join resolved proves the merge key works; it does
    not prove a single `result_row` was ever written. The UPDATE loop runs zero
    iterations when no row matches, so a test with no `result_row` passes
    whether the UPDATE works or not — the shape this file's own docstrings warn
    about.
    """
    _require_ephemeral_postgres()

    from etl.__main__ import apply_mesa_tipo_mapping
    from etl.db import upsert_category, upsert_election, upsert_jurisdiction

    # 8 hex chars, like the 15.9 test above. With 2 chars the space is 256
    # values, so a jurisdiction left behind by a crashed run collides and the
    # `resolved == 1` assertion fails for a reason unrelated to the code.
    marker = uuid.uuid4().hex[:8]
    archive_entry_id = f"test-mesa-tipo-{uuid.uuid4()}"
    with psycopg.connect(TEST_DSN) as conn:
        # Created through the WRITE BOUNDARY with unpadded codes, not raw SQL.
        # `upsert_jurisdiction` normalizes them, which is why the backfill's
        # padded merge key matches without compensating in SQL.
        mesa_jur = upsert_jurisdiction(
            conn, distrito=marker, seccion="27", circuito="1", mesa=4242
        )
        # A distrito-level row sharing the distrito. mesa_tipo is a property of
        # a MESA, so this must never bind a mesa lineage -- the scheme collision
        # that attributed 32.291 votes to a province.
        distrito_jur = upsert_jurisdiction(conn, distrito=marker, seccion="27")

        # Created, not assumed present. `select ... limit 1` on a freshly
        # migrated database returns `None` and fails as
        # `'NoneType' object is not subscriptable`, which describes nothing.
        election_id = upsert_election(conn, year=2025, round_="mesa-tipo-test")
        category_id = upsert_category(conn, name="MESA TIPO TEST")
        with conn.cursor() as cur:
            for jurisdiction_id in (mesa_jur, distrito_jur):
                cur.execute(
                    """
                    insert into result_row (election_id, jurisdiction_id, category_id,
                                            granularity, list_id, votes, source_kind,
                                            archive_entry_id, source_row_index)
                    values (%s,%s,%s,'mesa','TEST',1,'official',%s,0)
                    """,
                    (election_id, jurisdiction_id, category_id, archive_entry_id),
                )
        conn.commit()

        try:
            mapping = {(marker, "027", "00001", 4242): "EXTRANJEROS"}
            updated, resolved, _, unresolved = apply_mesa_tipo_mapping(
                conn, mapping, batch_size=10
            )

            with conn.cursor() as cur:
                cur.execute(
                    "select jurisdiction_id, mesa_tipo from result_row"
                    " where archive_entry_id = %s",
                    (archive_entry_id,),
                )
                written = dict(cur.fetchall())
        finally:
            with conn.cursor() as cur:
                cur.execute(
                    "delete from result_row where archive_entry_id = %s", (archive_entry_id,)
                )
                cur.execute(
                    "delete from jurisdiction where id = any(%s)", ([mesa_jur, distrito_jur],)
                )
            conn.commit()

    assert resolved == 1, (
        "exactly the mesa-level jurisdiction must resolve, never the "
        f"distrito-level one; got {resolved}"
    )
    assert updated == 1, f"exactly one row must be written; got {updated}"
    assert written[mesa_jur] == "EXTRANJEROS", "the mesa row must carry the mapped tipo"
    assert unresolved == [], f"the mapped mesa must bind; unresolved: {unresolved}"
    assert written[distrito_jur] is None, (
        "the distrito-level row must stay NULL: a partido total is not a mesa"
    )

def test_backfill_mesa_tipo_preserves_a_disagreement_across_sources() -> None:
    """One mesa cannot be both NATIVOS and EXTRANJEROS, and the disagreement
    must survive until every source has been read.

    Collapsing per file — or merging files with `dict.update` — is
    last-write-wins between the 2023 and 2025 sources: the very silent pick the
    accumulator exists to prevent. The caller raises once, over all sources.
    """
    shared: dict = {}
    collect_mesa_tipo_mapping(
        [{"distrito_id": "02", "seccion_id": "027", "circuito_id": "00001",
          "mesa_id": "1", "mesa_tipo": "NATIVOS"}],
        source_label="national/2023-generales",
        into=shared,
    )
    collect_mesa_tipo_mapping(
        [{"distrito_id": "02", "seccion_id": "027", "circuito_id": "00001",
          "mesa_id": "1", "mesa_tipo": "EXTRANJEROS"}],
        source_label="national/2025-legislativas",
        into=shared,
    )

    assert shared[("02", "027", "00001", 1)] == {"NATIVOS", "EXTRANJEROS"}, (
        "the second source must not overwrite the first; both candidates stay "
        "open for the caller's conflict check"
    )


def test_backfill_mesa_tipo_is_driven_through_main(tmp_path: Path) -> None:
    """Driven through `main()`, the real argv entry point.

    Importing `apply_mesa_tipo_mapping` proves the UPDATE works; it does not
    prove anyone can reach it. `backfill-mesa-tipo` could be dropped from
    `build_parser` and every other test here would still pass — the exact
    "correct, tested, unreachable" shape this project has hit repeatedly.

    Pointed at an empty source registry on purpose: the goal is to prove the
    subcommand is wired and reaches its own code, not to re-run a backfill over
    18 million rows.
    """
    empty_sources = tmp_path / "sources.yaml"
    empty_sources.write_text("national: []\n")

    exit_code = main(
        [
            "--sources-path",
            str(empty_sources),
            "backfill-mesa-tipo",
            "--database-url",
            TEST_DSN,
        ]
    )

    # Reaching the "nothing to map" refusal means argv parsing, subcommand
    # dispatch and the handler all ran. An unwired subcommand exits 2 from
    # argparse instead.
    assert exit_code == 1, (
        "an empty registry must reach the handler's own refusal, not an "
        f"argparse error; got {exit_code}"
    )
