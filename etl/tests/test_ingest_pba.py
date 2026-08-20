"""RED tests for PBA provincial/municipal 2025 ingestion (`electoral-ingestion`
spec, PBA subset; D10's etiquette layer applied to a real, discovered fetcher
target; D6/D7's degradation-is-explicit requirement).

Fixture: `fixtures/pba_distrito_027_2025_sample.html` is a REAL bytes slice
of `escrutinio-definitivo-2025/distrito_027.html` (see
`spikes/002-pba-2025-paths.md` for the full navigation trail and every
confirmed URL/status/content-type), trimmed to the `<section
class="election-header">` through the closing `</table>` — the CSS/JS noise
around it is dropped, the header block and results table are byte-identical
to what the live host served this session. It is a distrito-level TOTAL: the
source page itself reports one already-scrutinized aggregate per (distrito,
category), never a mesa breakdown — SPIKE 002 confirmed no mesa-level PBA
HTML source exists, only this distrito aggregate and four "bancas" PDFs,
which this module never parses (PDF/telegrama OCR extraction is explicitly
out of scope per the spec).
"""

from __future__ import annotations

import hashlib
import os
import uuid
from pathlib import Path
from unittest.mock import patch

import psycopg
import pytest
import requests

from etl import db
from etl.archive import ArchiveIntegrityError, FetchResponse
from etl.crosswalk import CrosswalkTable, JurisdictionCrosswalkEntry
from etl.http_client import (
    PolicedHostFetcher,
    UnregisteredPathError,
)
from etl.ingest.pba import (
    _UNREADABLE,
    PBA_ALLOWED_PATHS,
    PBA_HOST,
    PBA_HOST_POLICY,
    PbaSchemaError,
    _parse_votes,
    archive_pba_source,
    ingest_pba,
    load_pba_rows,
    resolve_pba_jurisdictions,
)
from etl.jurisdiction import JurisdictionNames, QuarantinedPbaDistrito, resolve_pba_distrito_code
from etl.storage import LocalArchiveStore

FIXTURES = Path(__file__).parent / "fixtures"


def _read(name: str) -> bytes:
    return (FIXTURES / name).read_bytes()


# ---------------------------------------------------------------------------
# 5.1 — distrito-level totals ingested without fabricating lower levels
# ---------------------------------------------------------------------------


def test_distrito_level_totals_ingested_without_fabricating_lower_levels() -> None:
    result = ingest_pba(
        _read("pba_distrito_027_2025_sample.html"),
        archive_entry_id="pba/2025-distrito-027",
        requested_granularity="distrito",
    )
    rows = result.rows
    assert not result.quarantined

    assert rows, "expected at least one normalized row from the real fixture table"
    for row in rows:
        assert row.granularity == "distrito"
        assert row.result.distrito == "027"
        assert row.jurisdiction_names.distrito == "CORONEL ROSALES"
        assert row.jurisdiction_names.seccion is None
        # jurisdiction.make_result_row structurally forbids these; assert the
        # PBA parser never even attempts to pass a lower-level value.
        assert row.result.seccion is None
        assert row.result.circuito is None
        assert row.result.establecimiento is None
        assert row.result.mesa is None

    # La Libertad Avanza, list 2206, is present for both in-scope categories
    # with the real measured vote totals from spikes/002-pba-2025-paths.md.
    lla_rows = {(r.category, r.votes) for r in rows if r.list_id == "2206"}
    assert ("DIPUTADOS PROVINCIALES", 15254) in lla_rows
    assert ("CONCEJALES", 14550) in lla_rows

    # List 962 (AGRUPACION MUNICIPAL PRIMERO ROSALES) ran only for CONCEJALES
    # (the source table shows "-" for its Diputados Prov. column) — the
    # parser MUST NOT invent a DIPUTADOS PROVINCIALES row for it.
    list_962_categories = {r.category for r in rows if r.list_id == "962"}
    assert list_962_categories == {"CONCEJALES"}


# ---------------------------------------------------------------------------
# 5.2 — no PBA source available reports unavailable, not zero
# ---------------------------------------------------------------------------


def test_no_archived_source_refuses_before_any_write(tmp_path: Path) -> None:
    """Spec: "No PBA source available for a given category" -- report it as
    unavailable, never substitute a zero-filled or estimated figure.

    Driven through `ingest_source`, the ONLY path production takes. This was
    covered by `load_pba_distrito_totals` raising `PbaSourceUnavailable`, a
    function with no production caller; the live refusal, on the live path,
    had no test at all.
    """
    from etl.__main__ import UnknownSourceError, ingest_source

    sources = {
        "pba": [
            {
                "id": "pba/2025-distrito-027",
                "capability": "pba",
                "url": f"https://{PBA_HOST}{PBA_ALLOWED_PATHS[0]}",
            }
        ]
    }
    manifest_path = tmp_path / "manifest.json"
    manifest_path.write_text("[]", encoding="utf-8")

    with pytest.raises(UnknownSourceError) as excinfo:
        ingest_source(
            "pba/2025-distrito-027",
            # A URL that would fail to connect: the refusal must happen
            # BEFORE any connection is opened, so reaching Postgres at all
            # would itself be the failure.
            database_url="postgresql://votus-refusal-must-precede-connect/nowhere",
            year=2025,
            round_="generales",
            sources=sources,
            local_root=tmp_path / "archive",
            manifest_path=manifest_path,
        )

    assert "no archived copy" in str(excinfo.value)


def test_a_different_record_id_is_never_substituted(tmp_path: Path) -> None:
    from etl.__main__ import UnknownSourceError, ingest_source

    sources = {
        "pba": [
            {
                "id": "pba/2025-distrito-027",
                "capability": "pba",
                "url": f"https://{PBA_HOST}{PBA_ALLOWED_PATHS[0]}",
            }
        ]
    }
    manifest_path = tmp_path / "manifest.json"
    # An "ok" record for a DIFFERENT id. Nothing may fall back to it.
    manifest_path.write_text(
        '[{"id": "pba/2025-distrito-999", "status": "ok",'
        ' "archived_path": "archive/pba/distrito_999.html", "sha256": "' + "d" * 64 + '"}]',
        encoding="utf-8",
    )

    with pytest.raises(UnknownSourceError) as excinfo:
        ingest_source(
            "pba/2025-distrito-027",
            database_url="postgresql://votus-refusal-must-precede-connect/nowhere",
            year=2025,
            round_="generales",
            sources=sources,
            local_root=tmp_path / "archive",
            manifest_path=manifest_path,
        )

    assert "no archived copy" in str(excinfo.value)


# ---------------------------------------------------------------------------
# 5.3 — mesa requested but only distrito available marks degradation
# ---------------------------------------------------------------------------


def test_mesa_requested_but_only_distrito_available_marks_degradation() -> None:
    result = ingest_pba(
        _read("pba_distrito_027_2025_sample.html"),
        archive_entry_id="pba/2025-distrito-027",
        requested_granularity="mesa",
    )
    rows = result.rows

    assert rows
    for row in rows:
        # Degradation is a first-class attribute of the row itself, never
        # log-only (task 5.6 / electoral-ingestion "Granularity degradation
        # is explicit, never silent").
        assert row.requested_granularity == "mesa"
        assert row.degraded_from == "mesa"
        assert row.granularity == "distrito"


def test_no_degradation_flag_when_requested_granularity_matches_actual() -> None:
    result = ingest_pba(
        _read("pba_distrito_027_2025_sample.html"),
        archive_entry_id="pba/2025-distrito-027",
        requested_granularity="distrito",
    )
    rows = result.rows

    assert rows
    for row in rows:
        assert row.requested_granularity == "distrito"
        assert row.degraded_from is None


# ---------------------------------------------------------------------------
# 5.3a — D10 threat matrix: fetching a host with no declared permission
# (complements the 6 general-contract tests already covered in
# test_http_client.py::2.6c; these 4 exercise etl.ingest.pba's actual
# production wiring — the real host, the real discovered paths, and the
# archive-first-caching / bounded-backoff behaviour specific to Phase 5).
# ---------------------------------------------------------------------------


def test_fetcher_pinned_to_www_host_cert_verification_on_no_dash_k() -> None:
    assert PBA_HOST_POLICY.host == PBA_HOST == "www.juntaelectoral.gba.gov.ar"
    # The apex (no "www") is never used anywhere in this module's config —
    # D10 recorded a TLS failure there (self-signed certificate).
    # `not startswith("juntaelectoral")` was a tautology: any `www.`-prefixed
    # value passes it, including a wrong one. Pin the prefix instead.
    assert PBA_HOST.startswith("www."), (
        f"the apex host has a self-signed certificate (D10); got {PBA_HOST!r}"
    )

    with (
        patch(
            "etl.http_client.requests.get",
            side_effect=requests.exceptions.SSLError("certificate verify failed"),
        ) as mocked,
        patch("etl.http_client.time.sleep"),
    ):
        from etl.http_client import RequestsFetcher

        policed = PolicedHostFetcher(RequestsFetcher(), PBA_HOST_POLICY, sleep=lambda _s: None)
        with pytest.raises(requests.exceptions.SSLError):
            policed.get(f"https://{PBA_HOST}{PBA_ALLOWED_PATHS[0]}", timeout=5)

    for call in mocked.call_args_list:
        assert call.kwargs.get("verify") is not False


def test_fetcher_bounded_to_registered_paths_only_no_crawling() -> None:
    calls: list[str] = []

    class FakeFetcher:
        def get(self, url: str, *, timeout: float, headers: dict[str, str]) -> FetchResponse:
            calls.append(url)
            return FetchResponse(200, b"<html></html>")

    policed = PolicedHostFetcher(FakeFetcher(), PBA_HOST_POLICY, sleep=lambda _s: None)

    # A registered path (from spikes/002-pba-2025-paths.md) succeeds.
    policed.get(f"https://{PBA_HOST}{PBA_ALLOWED_PATHS[0]}", timeout=5)
    assert calls == [f"https://{PBA_HOST}{PBA_ALLOWED_PATHS[0]}"]

    # An unregistered, crawled-looking path is refused before the transport
    # is ever reached — no crawling, no directory enumeration.
    with pytest.raises(UnregisteredPathError):
        policed.get(f"https://{PBA_HOST}/escrutinio-definitivo-2025/distrito_099.html", timeout=5)
    assert calls == [f"https://{PBA_HOST}{PBA_ALLOWED_PATHS[0]}"]  # unchanged


ENTRY = {
    "id": "pba/2025-distrito-027",
    "capability": "pba",
    "source": PBA_HOST,
    "source_url": f"https://{PBA_HOST}{PBA_ALLOWED_PATHS[0]}",
    "mime": "text/html",
    "notes": "",
    "filename": "distrito_027.html",
}


def test_fetcher_caches_and_does_not_refetch_existing_archive_entry(tmp_path: Path) -> None:
    local_store = LocalArchiveStore(root=tmp_path)
    cached_bytes = b"cached PBA page"
    local_store.write("pba", "distrito_027.html", cached_bytes)
    existing_record = {
        "id": ENTRY["id"],
        "capability": "pba",
        "source": PBA_HOST,
        "source_url": ENTRY["source_url"],
        "archived_path": "archive/pba/distrito_027.html",
        "sha256": hashlib.sha256(cached_bytes).hexdigest(),
        "mime": "text/html",
        "bytes": 6640,
        "fetched_at": "2025-09-08T12:00:00Z",
        "status": "ok",
        "notes": "",
    }

    calls: list[str] = []

    class NeverCalledFetcher:
        def get(
            self, url: str, *, timeout: float, headers: dict[str, str] | None = None
        ) -> FetchResponse:
            calls.append(url)
            raise AssertionError("the network must never be touched for a cached entry")

    result = archive_pba_source(
        ENTRY,
        fetcher=PolicedHostFetcher(NeverCalledFetcher(), PBA_HOST_POLICY, sleep=lambda _s: None),
        local_store=local_store,
        records=[existing_record],
    )

    assert calls == []
    assert result.record == existing_record


def test_fetcher_refuses_missing_cached_archive_without_network(tmp_path: Path) -> None:
    local_store = LocalArchiveStore(root=tmp_path)
    existing_record = {
        "id": ENTRY["id"],
        "capability": "pba",
        "archived_path": "archive/pba/distrito_027.html",
        "sha256": hashlib.sha256(b"missing cached page").hexdigest(),
        "status": "ok",
    }
    calls: list[str] = []

    class NeverCalledFetcher:
        def get(
            self, url: str, *, timeout: float, headers: dict[str, str] | None = None
        ) -> FetchResponse:
            calls.append(url)
            raise AssertionError("a missing cache must be refused without network healing")

    with pytest.raises(ArchiveIntegrityError, match="cannot be read"):
        archive_pba_source(
            ENTRY,
            fetcher=PolicedHostFetcher(
                NeverCalledFetcher(), PBA_HOST_POLICY, sleep=lambda _s: None
            ),
            local_store=local_store,
            records=[existing_record],
        )

    assert calls == []


def test_fetcher_refuses_invalid_cached_archive_without_network(tmp_path: Path) -> None:
    local_store = LocalArchiveStore(root=tmp_path)
    local_store.write("pba", "distrito_027.html", b"modified cached page")
    existing_record = {
        "id": ENTRY["id"],
        "capability": "pba",
        "source": PBA_HOST,
        "source_url": ENTRY["source_url"],
        "archived_path": "archive/pba/distrito_027.html",
        "sha256": hashlib.sha256(b"original cached page").hexdigest(),
        "status": "ok",
    }
    calls: list[str] = []

    class NeverCalledFetcher:
        def get(
            self, url: str, *, timeout: float, headers: dict[str, str] | None = None
        ) -> FetchResponse:
            calls.append(url)
            raise AssertionError("an invalid cache must be refused without network healing")

    with pytest.raises(ArchiveIntegrityError, match=existing_record["sha256"]):
        archive_pba_source(
            ENTRY,
            fetcher=PolicedHostFetcher(
                NeverCalledFetcher(), PBA_HOST_POLICY, sleep=lambda _s: None
            ),
            local_store=local_store,
            records=[existing_record],
        )

    assert calls == []


@pytest.mark.parametrize("status", [429, 503])
def test_fetcher_backs_off_and_stops_after_3_attempts_on_429_or_5xx(status: int) -> None:
    """Both statuses the name promises.

    Only `503` was ever served. `429` is rate limiting with its own
    `Retry-After` semantics, so "429 or 5xx" in the name described behaviour
    no assertion exercised.
    """
    local_store_calls: list[str] = []

    class AlwaysUnavailableFetcher:
        def get(self, url: str, *, timeout: float, headers: dict[str, str]) -> FetchResponse:
            local_store_calls.append(url)
            return FetchResponse(status, b"")

    policed = PolicedHostFetcher(AlwaysUnavailableFetcher(), PBA_HOST_POLICY, sleep=lambda _s: None)

    import tempfile

    with tempfile.TemporaryDirectory() as tmp:
        local_store = LocalArchiveStore(root=Path(tmp))
        result = archive_pba_source(
            ENTRY,
            fetcher=policed,
            local_store=local_store,
            records=[],
        )

    assert len(local_store_calls) == 3, "must stop after exactly 3 attempts, never retry through it"
    assert result.record["status"] == "error"
    assert result.record["sha256"] is None
    assert result.record["archived_path"] is None


# ---------------------------------------------------------------------------
# 17.5/17.3 — PBA distrito codes resolved through jurisdiction_crosswalk
# before any jurisdiction is created; an uncurated code is quarantined.
# ---------------------------------------------------------------------------


TEST_DSN = os.environ.get(
    "ETL_TEST_DATABASE_URL", "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
)


def _require_ephemeral_postgres() -> psycopg.Connection:
    try:
        return psycopg.connect(TEST_DSN, connect_timeout=2)
    except psycopg.OperationalError as exc:
        pytest.skip(f"no ephemeral Postgres reachable at {TEST_DSN!r}: {exc}")


def _loader_mutation_counts(conn: psycopg.Connection) -> tuple[int, int, int, int]:
    with conn.cursor() as cur:
        cur.execute(
            """
            select
              (select count(*) from election),
              (select count(*) from category),
              (select count(*) from jurisdiction),
              (select count(*) from result_row)
            """
        )
        counts = cur.fetchone()
    assert counts is not None
    return counts


def _record_archive_authority(
    conn: psycopg.Connection, *, archive_entry_id: str, source_kind: str
) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            insert into archive_entry (
                id, capability, source, source_url, mime, fetched_at, status, source_kind
            ) values (%s, 'integration-test', 'integration-test', %s, 'text/html', now(), 'ok', %s)
            """,
            (archive_entry_id, f"https://example.invalid/{archive_entry_id}", source_kind),
        )


def _project_official_pba_archive_entry(conn: psycopg.Connection, *, archive_entry_id: str) -> None:
    from etl import db

    payload = _read("pba_distrito_027_2025_sample.html")
    source_entry = {
        "id": archive_entry_id,
        "capability": "pba",
        "source": PBA_HOST,
        "source_url": f"https://{PBA_HOST}{PBA_ALLOWED_PATHS[0]}",
        "mime": "text/html",
        "notes": "Verified public PBA HTML test fixture.",
        "source_kind": "official",
    }
    manifest_record = {
        **source_entry,
        "archived_path": "archive/pba/distrito_027.html",
        "sha256": hashlib.sha256(payload).hexdigest(),
        "bytes": len(payload),
        "fetched_at": "2025-09-08T12:00:00Z",
        "status": "ok",
    }
    db.project_archive_entry(
        conn,
        db.archive_entry_from_evidence(manifest_record, source_entry),
    )


_CROSSWALK = CrosswalkTable(
    jurisdictions=(
        JurisdictionCrosswalkEntry(
            pba_distrito_code="027",
            national_distrito_code="02",
            national_seccion_code="027",
            name="Coronel de Marina Leonardo Rosales",
        ),
    )
)


@pytest.mark.parametrize(
    ("authoritative_source_kind", "expected_error"),
    [
        ("fiscalizacion", db.ArchiveEntrySourceKindMismatchError),
        (None, db.ArchiveEntryNotFoundError),
    ],
)
def test_load_pba_rows_refuses_invalid_archive_authority_before_any_upstream_mutation(
    authoritative_source_kind: str | None,
    expected_error: type[Exception],
) -> None:
    conn = _require_ephemeral_postgres()
    archive_entry_id = f"pba/loader-authority-{uuid.uuid4()}"
    rows = list(
        ingest_pba(
            _read("pba_distrito_027_2025_sample.html"),
            archive_entry_id=archive_entry_id,
            requested_granularity="distrito",
        ).rows
    )
    try:
        if authoritative_source_kind is not None:
            _record_archive_authority(
                conn,
                archive_entry_id=archive_entry_id,
                source_kind=authoritative_source_kind,
            )
        before = _loader_mutation_counts(conn)

        with pytest.raises(expected_error):
            load_pba_rows(
                conn,
                rows,
                year=2098,
                round_=f"archive-authority-{uuid.uuid4()}",
                crosswalk=_CROSSWALK,
                archive_entry_id=archive_entry_id,
            )

        assert _loader_mutation_counts(conn) == before
    finally:
        conn.rollback()
        conn.close()


def test_load_pba_rows_surfaces_a_quarantined_distrito_instead_of_dropping_it(
    capsys,
) -> None:
    """The WRITE path's quarantine, not the resolver's.

    `resolve_pba_jurisdictions` is proven to quarantine an uncurated code, but
    nothing proved `load_pba_rows` REPORTS it. Silently returning a smaller
    inserted count is exactly the silent-data-loss shape: the caller sees a
    plausible number and no indication that rows were withheld.
    """
    conn = _require_ephemeral_postgres()

    archive_entry_id = f"pba/quarantine-test-{uuid.uuid4()}"
    parse_result = ingest_pba(
        _read("pba_distrito_027_2025_sample.html"),
        archive_entry_id=archive_entry_id,
        requested_granularity="distrito",
    )
    rows = list(parse_result.rows)
    _project_official_pba_archive_entry(conn, archive_entry_id=archive_entry_id)
    try:
        inserted = load_pba_rows(
            conn,
            rows,
            year=2025,
            round_="legislativas",
            crosswalk=CrosswalkTable(jurisdictions=()),
            archive_entry_id=archive_entry_id,
        )
        with conn.cursor() as cur:
            cur.execute(
                "select count(*) from result_row where archive_entry_id = %s",
                (archive_entry_id,),
            )
            count_row = cur.fetchone()
            assert count_row is not None
            (written,) = count_row
    finally:
        with conn.cursor() as cur:
            cur.execute("delete from result_row where archive_entry_id = %s", (archive_entry_id,))
        conn.commit()
        conn.close()

    reported = capsys.readouterr().err
    assert inserted == 0 and written == 0, (
        "an uncurated PBA distrito must never be written under its own code space"
    )
    assert f"quarantined {len(rows)} PBA row(s)" in reported, (
        f"the withheld rows must be reported, not just absent; got {reported!r}"
    )
    assert "027" in reported, "the report must name the distrito that failed to resolve"
    assert f"no curated crosswalk entry for PBA distrito '027': {len(rows)}" in reported


def test_load_pba_rows_passes_the_translated_partido_name_to_the_db_boundary(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    parse_result = ingest_pba(
        _read("pba_distrito_027_2025_sample.html"),
        archive_entry_id="pba/name-boundary",
        requested_granularity="distrito",
    )
    captured: list[tuple[str, str | None, JurisdictionNames | None]] = []

    monkeypatch.setattr(
        "etl.ingest.pba.db.lock_archive_entry_source_authority",
        lambda *_args, **_kwargs: "official",
    )
    monkeypatch.setattr("etl.ingest.pba.db.upsert_election", lambda *_args, **_kwargs: "election")
    monkeypatch.setattr(
        "etl.ingest.pba.db.upsert_category", lambda _conn, *, name: f"category:{name}"
    )

    def capture_jurisdiction(_conn, *, distrito, seccion=None, names=None, **_kwargs):
        captured.append((distrito, seccion, names))
        return "jurisdiction"

    monkeypatch.setattr("etl.ingest.pba.db.upsert_jurisdiction", capture_jurisdiction)
    monkeypatch.setattr(
        "etl.ingest.pba.db.load_result_rows",
        lambda _conn, **kwargs: len(kwargs["records"]),
    )

    inserted = load_pba_rows(
        object(),
        list(parse_result.rows),
        year=2025,
        round_="legislativas",
        crosswalk=_CROSSWALK,
        archive_entry_id="pba/name-boundary",
    )

    assert inserted == len(parse_result.rows)
    assert len(captured) == 1, "all rows share one translated jurisdiction lineage"
    distrito, seccion, names = captured[0]
    assert (distrito, seccion) == ("02", "027")
    assert names is not None
    assert names.distrito is None
    assert names.seccion == "CORONEL ROSALES"


def test_load_pba_rows_writes_the_translated_national_lineage(tmp_path) -> None:
    """The WRITE path, not the resolver, is what can corrupt the database.

    `resolve_pba_distrito_code` being correct and tested says nothing about
    what reaches `jurisdiction`: `db.upsert_jurisdiction` normalizes its
    `distrito` with `normalize_distrito_code`, which turns PBA's `"027"` into
    `"27"` -- a code that exists in neither scheme. Nothing at that boundary
    checks which scheme it was handed, so this asserts the translation
    happened BEFORE the write.
    """
    conn = _require_ephemeral_postgres()

    archive_entry_id = f"pba/load-test-{uuid.uuid4()}"
    parse_result = ingest_pba(
        _read("pba_distrito_027_2025_sample.html"),
        archive_entry_id=archive_entry_id,
        requested_granularity="distrito",
    )
    rows = list(parse_result.rows)
    _project_official_pba_archive_entry(conn, archive_entry_id=archive_entry_id)
    try:
        inserted = load_pba_rows(
            conn,
            rows,
            year=2025,
            round_="legislativas",
            crosswalk=_CROSSWALK,
            archive_entry_id=archive_entry_id,
        )
        assert inserted > 0, "sanity: the fixture must produce rows"
        with conn.cursor() as cur:
            cur.execute(
                """
                select distinct j.distrito_code, j.seccion_code,
                           j.distrito_name, j.seccion_name
                  from result_row r join jurisdiction j on j.id = r.jurisdiction_id
                 where r.archive_entry_id = %s
                """,
                (archive_entry_id,),
            )
            lineages = cur.fetchall()
            cur.execute(
                """
                select distinct granularity, requested_granularity
                  from result_row
                 where archive_entry_id = %s
                """,
                (archive_entry_id,),
            )
            granularities = cur.fetchall()
    finally:
        with conn.cursor() as cur:
            cur.execute("delete from result_row where archive_entry_id = %s", (archive_entry_id,))
        conn.commit()
        conn.close()

    assert lineages == [("02", "027", None, "CORONEL ROSALES")], (
        "the write must carry the NATIONAL pair and assign the PBA partido label "
        "to canonical seccion_name, never to national distrito 02; "
        f"got {lineages}"
    )
    assert granularities == [("seccion", "seccion")], (
        "a fulfilled PBA distrito request becomes the same normalized seccion "
        "level as the translated result; it must not render as degraded"
    )


def test_resolve_pba_jurisdictions_translates_to_the_national_distrito_code() -> None:
    parse_result = ingest_pba(
        _read("pba_distrito_027_2025_sample.html"),
        archive_entry_id="pba/2025-distrito-027",
        requested_granularity="distrito",
    )
    rows = list(parse_result.rows)
    assert rows and all(row.result.distrito == "027" for row in rows), (
        "sanity: ingest_pba itself still carries PBA's own, untranslated code"
    )

    result = resolve_pba_jurisdictions(rows, _CROSSWALK)

    assert not result.quarantined
    assert len(result.resolved) == len(rows)
    assert all(row.result.distrito == "02" for row in result.resolved), (
        "every resolved row must carry the national distrito code, never PBA's own 027"
    )
    # The SECCION is the half that was dropped. Asserting the distrito alone
    # passes for exactly the bug that attributed 32.291 Coronel Rosales votes
    # to the whole province, and it is asserted here rather than only in the
    # Postgres-gated write test, which skips when no database is reachable.
    assert all(row.result.seccion == "027" for row in result.resolved), (
        "the partido must survive as the national seccion; a distrito-only "
        "lineage is the province, not Coronel Rosales"
    )
    assert all(row.jurisdiction_names.distrito is None for row in result.resolved)
    assert all(row.jurisdiction_names.seccion == "CORONEL ROSALES" for row in result.resolved), (
        "the source-native partido label becomes canonical seccion_name only after translation"
    )
    assert all(row.result.granularity == "seccion" for row in result.resolved), (
        "a PBA partido total is a seccion-level figure once translated"
    )
    assert all(row.requested_granularity == "seccion" for row in result.resolved), (
        "a fulfilled source-native distrito request must translate with the result"
    )
    assert all(row.degraded_from is None for row in result.resolved)
    # Everything else about each row is preserved verbatim.
    assert {row.list_id for row in result.resolved} == {row.list_id for row in rows}
    assert {row.votes for row in result.resolved} == {row.votes for row in rows}


def test_resolve_pba_jurisdictions_quarantines_an_uncurated_distrito_code() -> None:
    parse_result = ingest_pba(
        _read("pba_distrito_027_2025_sample.html"),
        archive_entry_id="pba/2025-distrito-027",
        requested_granularity="distrito",
    )
    rows = list(parse_result.rows)
    empty_crosswalk = CrosswalkTable(jurisdictions=())

    result = resolve_pba_jurisdictions(rows, empty_crosswalk)

    assert result.resolved == ()
    assert len(result.quarantined) == len(rows)
    assert all(q.distrito == "027" for q in result.quarantined)
    assert all(len(q.rows) == 1 for q in result.quarantined)
    assert all("027" in q.reason for q in result.quarantined)


def test_pba_partido_total_identifies_the_partido_not_the_whole_province() -> None:
    """A PBA partido total identifies Coronel Rosales, not all of Buenos Aires.

    The two schemes collide on the word "distrito": PBA's distrito `027` is a
    PARTIDO, while the national scheme's distrito `02` is the PROVINCE and
    Coronel Rosales is its seccion `027`. `jurisdiction_crosswalk` says exactly
    that -- PBA `027` maps to national `02` / `027`.

    Resolving only the distrito half and discarding the seccion stores a
    partido total as a province-wide figure. Measured live after phase 17:
    32.291 CONCEJALES votes -- verifiably Coronel Rosales's valid-vote
    denominator, since the official cuociente 3.587,8888880 times 9 seats
    equals exactly that -- sat under `distrito_code='02', seccion_code=NULL`,
    attributed to the whole province.

    The fabrication ban forbids inventing FINER levels a row does not have.
    It does not forbid a row from identifying which place it describes.
    """
    crosswalk = CrosswalkTable(
        jurisdictions=(
            JurisdictionCrosswalkEntry(
                pba_distrito_code="027",
                national_distrito_code="02",
                national_seccion_code="027",
                name="Coronel de Marina Leonardo Rosales",
            ),
        ),
    )

    resolved = resolve_pba_distrito_code("027", crosswalk)

    assert not isinstance(resolved, QuarantinedPbaDistrito), (
        "a curated PBA distrito must resolve, not quarantine"
    )
    assert resolved == ("02", "027"), (
        "the resolver must yield BOTH the province and the partido; yielding "
        f"the province alone attributes the figure to all of Buenos Aires: got {resolved!r}"
    )


# ---------------------------------------------------------------------------
# Rule 3 — every dropped cell/row is reported, and a SHORT ROW is named
# ---------------------------------------------------------------------------


def test_list_id_column_must_be_declared_first_before_rows_are_processed() -> None:
    source = _read("pba_distrito_027_2025_sample.html")
    html = source.replace(b"<th>Lista</th>", b"<th>Party</th><th>Lista</th>", 1)
    with pytest.raises(PbaSchemaError, match=r"first list-id header.*Lista"):
        ingest_pba(html, archive_entry_id="pba/test")


@pytest.mark.parametrize(
    ("second_votes", "reason"),
    [
        (b"15.254", "exact_duplicate_semantic_result"),
        (b"15.255", "conflicting_duplicate_semantic_result"),
    ],
)
def test_duplicate_semantic_result_rows_are_structurally_quarantined(
    second_votes: bytes, reason: str, capsys
) -> None:
    source = _read("pba_distrito_027_2025_sample.html")
    row = source.split(b"<tbody>", 1)[1].split(b"</tr>", 1)[0] + b"</tr>"
    duplicate = row.replace(b"15.254", second_votes, 1).replace(b"14.550", b"-", 1)

    result = ingest_pba(source.replace(row, row + duplicate, 1), archive_entry_id="pba/test")

    accepted_2206 = [
        (row.category, row.votes, row.source_row_index)
        for row in result.rows
        if row.list_id == "2206"
    ]
    assert accepted_2206 == [("CONCEJALES", 14550, 0)]
    duplicate_quarantine = [q for q in result.quarantined if q.reason == reason]
    assert len(duplicate_quarantine) == 1
    quarantined = duplicate_quarantine[0]
    assert quarantined.archive_entry_id == "pba/test"
    assert quarantined.distrito == "027"
    assert quarantined.category == "DIPUTADOS PROVINCIALES"
    assert quarantined.list_id == "2206"
    assert quarantined.source_row_indices == (0, 1)
    assert [row.votes for row in quarantined.rows] == [15254, int(second_votes.replace(b".", b""))]
    assert not [
        row
        for row in result.rows
        if row.list_id == "2206" and row.category == "DIPUTADOS PROVINCIALES"
    ], "a duplicate semantic key must emit no accepted row"
    report = capsys.readouterr().err
    assert f"{reason}: 2" in report
    assert "('027', 'DIPUTADOS PROVINCIALES', '2206'): source rows 0, 1" in report


def test_duplicate_recognized_category_headers_are_schema_drift() -> None:
    html = (
        b"<html><body>"
        b'<span class="detail-value-big">027 - CORONEL ROSALES</span>'
        b"<table><thead><tr><th>Lista</th><th>Diputados Prov. Tit.</th>"
        b"<th>Diputados Provinciales</th><th>Concejales Titulares</th>"
        b"</tr></thead><tbody>"
        b"<tr><td>2206</td><td>1.000</td><td>2.000</td><td>3.000</td></tr>"
        b"</tbody></table></body></html>"
    )

    with pytest.raises(PbaSchemaError, match=r"DIPUTADOS PROVINCIALES.*2.*3"):
        ingest_pba(html, archive_entry_id="pba/test")


@pytest.mark.parametrize(
    ("category_header", "missing_category", "recognized_category"),
    [
        ("Diputados Prov. Tit.", "CONCEJALES", "DIPUTADOS PROVINCIALES"),
        ("Concejales Titulares", "DIPUTADOS PROVINCIALES", "CONCEJALES"),
    ],
)
def test_incomplete_category_schema_is_refused_before_partial_rows_are_returned(
    category_header: str, missing_category: str, recognized_category: str
) -> None:
    html = (
        "<html><body>"
        '<span class="detail-value-big">027 - CORONEL ROSALES</span>'
        f"<table><thead><tr><th>Lista</th><th>{category_header}</th></tr></thead>"
        "<tbody><tr><td>2206</td><td>1.000</td></tr></tbody></table>"
        "</body></html>"
    ).encode()

    with pytest.raises(PbaSchemaError) as excinfo:
        ingest_pba(html, archive_entry_id="pba/test")

    message = str(excinfo.value)
    assert missing_category in message
    assert recognized_category in message


def test_a_short_row_is_reported_as_schema_drift_not_folded_into_the_expected_drops(
    capsys,
) -> None:
    """The three drops in this parser are not equivalent. A summary row and a
    `"-"` cell are expected; a row that does not reach a column the header
    declared is MALFORMED HTML -- schema drift arriving as absence. Under one
    shared total the drift is invisible, because the expected count is always
    non-zero and always looks fine.
    """
    html = (
        b"<html><body>"
        b'<span class="detail-value-big">027 - CORONEL ROSALES</span>'
        b"<table><thead><tr><th>Lista</th><th>Diputados Prov. Tit.</th>"
        b"<th>Concejales Titulares</th></tr></thead><tbody>"
        # a normal row
        b"<tr><td>2206</td><td>1.000</td><td>2.000</td></tr>"
        # a summary row: empty list-id cell
        b"<tr><td></td><td>9.999</td><td>9.999</td></tr>"
        # a list absent from the second category
        b"<tr><td>962</td><td>500</td><td>-</td></tr>"
        # a SHORT row: the Concejales column the header declared is missing
        b"<tr><td>2207</td><td>300</td></tr>"
        b"</tbody></table></body></html>"
    )

    result = ingest_pba(html, archive_entry_id="pba/test")
    rows = result.rows

    assert len(rows) == 4  # 2206 x2, 962 x1, 2207 x1
    report = capsys.readouterr().err
    assert "summary row (empty list-id cell): 1" in report
    assert 'list absent from this category ("-" or empty cell): 1' in report
    assert "short row (declared category column missing): 1" in report
    # And it says WHICH column vanished, which is what makes it actionable.
    assert "missing the column(s) for CONCEJALES" in report


def test_the_write_path_reports_the_granularity_it_could_not_honour(capsys) -> None:
    """Rule 4: degradation MUST be visible.

    `ingest_pba` computed `degraded_from` and `load_pba_rows` read it
    nowhere. On the only production path -- `ingest_source` calls
    `ingest_pba` with its default `requested_granularity="mesa"` -- every row
    is degraded, so every row's degradation was announced to nobody. The
    parser-level assertion above passed the whole time.
    """
    conn = _require_ephemeral_postgres()

    archive_entry_id = f"pba/degraded-test-{uuid.uuid4()}"
    parse_result = ingest_pba(
        _read("pba_distrito_027_2025_sample.html"),
        archive_entry_id=archive_entry_id,
        requested_granularity="mesa",  # what production actually asks for
    )
    rows = list(parse_result.rows)
    assert all(row.degraded_from == "mesa" for row in rows), "sanity"
    capsys.readouterr()  # discard the parser's own report
    _project_official_pba_archive_entry(conn, archive_entry_id=archive_entry_id)

    try:
        load_pba_rows(
            conn,
            rows,
            year=2025,
            round_="legislativas",
            crosswalk=_CROSSWALK,
            archive_entry_id=archive_entry_id,
        )
        with conn.cursor() as cur:
            cur.execute(
                """
                select distinct granularity, requested_granularity
                  from result_row
                 where archive_entry_id = %s
                """,
                (archive_entry_id,),
            )
            granularities = cur.fetchall()
    finally:
        with conn.cursor() as cur:
            cur.execute("delete from result_row where archive_entry_id = %s", (archive_entry_id,))
        conn.commit()
        conn.close()

    report = capsys.readouterr().err
    assert "requested at mesa granularity" in report
    assert "source-native PBA distrito total" in report
    assert "stored as national seccion 02/027" in report
    assert "none was fabricated" in report
    assert granularities == [("seccion", "mesa")], (
        "the database must retain the requested mesa level beside the actual "
        "normalized seccion level so the UI can disclose the degradation"
    )


def test_an_unreadable_vote_cell_is_counted_apart_from_an_absent_one(capsys) -> None:
    """`None` already means "this list did not run in this category" -- a real
    electoral fact. A cell nobody can read is a different fact, and it used to
    be a `ValueError` that destroyed the whole page's parse along with the
    breakdown for everything already excluded.
    """
    html = (
        b"<html><body>"
        b'<span class="detail-value-big">027 - CORONEL ROSALES</span>'
        b"<table><thead><tr><th>Lista</th><th>Diputados Prov. Tit.</th>"
        b"<th>Concejales Titulares</th></tr></thead><tbody>"
        b"<tr><td>2206</td><td>1.000</td><td>1O</td></tr>"
        b"<tr><td>962</td><td>500</td><td>-</td></tr>"
        b"</tbody></table></body></html>"
    )

    result = ingest_pba(html, archive_entry_id="pba/test")

    assert len(result.rows) == 2, "the readable figures on both rows still load"
    assert len(result.quarantined) == 1
    quarantined = result.quarantined[0]
    assert quarantined.archive_entry_id == "pba/test"
    assert quarantined.distrito == "027"
    assert quarantined.category == "CONCEJALES"
    assert quarantined.list_id == "2206"
    assert quarantined.source_row_indices == (0,)
    assert quarantined.reason == "unreadable_vote_cell"
    assert quarantined.raw_cell_shapes == ("length=2; character_classes=ascii_letter,digit",)
    assert quarantined.rows == ()
    report = capsys.readouterr().err
    assert "unreadable_vote_cell: 1" in report
    assert 'list absent from this category ("-" or empty cell): 1' in report


@pytest.mark.parametrize("raw", ["1_2", "+12", "-1", "1.2", "12.34", ".123", "123."])
def test_malformed_spanish_locale_vote_cells_are_unreadable(raw: str) -> None:
    assert _parse_votes(raw) is _UNREADABLE


@pytest.mark.parametrize(
    ("raw", "expected"),
    [("0", 0), ("12", 12), ("1.234", 1234), ("12.345.678", 12345678)],
)
def test_spanish_locale_vote_cells_accept_plain_digits_and_canonical_grouping(
    raw: str, expected: int
) -> None:
    assert _parse_votes(raw) == expected


def test_malformed_spanish_locale_vote_cell_uses_the_existing_exclusion_reason(capsys) -> None:
    html = (
        b"<html><body>"
        b'<span class="detail-value-big">027 - CORONEL ROSALES</span>'
        b"<table><thead><tr><th>Lista</th><th>Diputados Prov. Tit.</th>"
        b"<th>Concejales Titulares</th></tr></thead><tbody>"
        b"<tr><td>2206</td><td>1.2</td><td>2.000</td></tr>"
        b"</tbody></table></body></html>"
    )

    result = ingest_pba(html, archive_entry_id="pba/test")
    assert [(row.category, row.votes) for row in result.rows] == [("CONCEJALES", 2000)]
    assert [row.reason for row in result.quarantined] == ["unreadable_vote_cell"]
    assert "unreadable_vote_cell: 1" in capsys.readouterr().err


def test_a_reingest_whose_rows_all_quarantine_clears_the_old_ones() -> None:
    """The concrete failure: `pba/2025-distrito-027` loads 30 rows against a
    curated crosswalk; the `027` entry is later removed; the re-ingest
    quarantines every row, prints the quarantine, and returns 0 -- and the 30
    old rows stay live and read as current by every query, while the CLI says
    "ingested 0 rows" and exits 0.

    `db.load_result_rows` is the delete-then-insert PAIR. Returning early
    skipped the delete.
    """
    conn = _require_ephemeral_postgres()

    archive_entry_id = f"pba/empty-reingest-{uuid.uuid4()}"
    parse_result = ingest_pba(
        _read("pba_distrito_027_2025_sample.html"),
        archive_entry_id=archive_entry_id,
        requested_granularity="distrito",
    )
    rows = list(parse_result.rows)
    _project_official_pba_archive_entry(conn, archive_entry_id=archive_entry_id)

    def loaded() -> int:
        with conn.cursor() as cur:
            cur.execute(
                "select count(*) from result_row where archive_entry_id = %s",
                (archive_entry_id,),
            )
            count_row = cur.fetchone()
            assert count_row is not None
            return count_row[0]

    try:
        load_pba_rows(
            conn,
            rows,
            year=2025,
            round_="legislativas",
            crosswalk=_CROSSWALK,
            archive_entry_id=archive_entry_id,
        )
        assert loaded() > 0, "sanity: the first load must write rows"

        # The curated entry is gone, so every row quarantines.
        load_pba_rows(
            conn,
            rows,
            year=2025,
            round_="legislativas",
            crosswalk=CrosswalkTable(jurisdictions=()),
            archive_entry_id=archive_entry_id,
        )
        assert loaded() == 0, "the stale rows must not survive a fully-quarantined re-ingest"
    finally:
        with conn.cursor() as cur:
            cur.execute("delete from result_row where archive_entry_id = %s", (archive_entry_id,))
        conn.commit()
        conn.close()
