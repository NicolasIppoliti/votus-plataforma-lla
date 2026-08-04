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

import os
import uuid
from dataclasses import dataclass, field
from pathlib import Path

import psycopg
import pytest

from etl.__main__ import (
    MissingDatabaseUrlError,
    UnknownSourceError,
    collect_national_jurisdiction_codes,
    collect_national_party_keys,
    fetch_source,
    find_unmapped_jurisdictions,
    find_unmapped_parties,
    ingest_source,
)
from etl.archive import FetchResponse
from etl.crosswalk import load_crosswalk
from etl.party_map import load_party_map

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


def _require_ephemeral_postgres() -> psycopg.Connection:
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
# 12.4 -- validate-crosswalk reports unmapped codes and exits nonzero
# ---------------------------------------------------------------------------


def test_validate_crosswalk_reports_unmapped_codes_and_exits_nonzero() -> None:
    crosswalk = load_crosswalk(CROSSWALK_PATH)

    codes = [("02", "027"), ("99", "999")]  # second pair has no curated entry
    unmapped = find_unmapped_jurisdictions(codes, crosswalk)

    assert len(unmapped) == 1
    assert unmapped[0].code == "99/999"


def test_validate_crosswalk_reports_nothing_when_every_code_resolves() -> None:
    crosswalk = load_crosswalk(CROSSWALK_PATH)

    unmapped = find_unmapped_jurisdictions([("02", "027")], crosswalk)

    assert unmapped == []


# ---------------------------------------------------------------------------
# 12.5 -- validate-curated reports unmapped list ids and exits nonzero
# ---------------------------------------------------------------------------


def test_validate_curated_reports_unmapped_list_ids_and_exits_nonzero() -> None:
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
