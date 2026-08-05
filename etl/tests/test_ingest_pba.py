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

from pathlib import Path
from unittest.mock import patch

import pytest
import requests

from etl.archive import FetchResponse
from etl.crosswalk import CrosswalkTable, JurisdictionCrosswalkEntry
from etl.http_client import (
    PolicedHostFetcher,
    UnregisteredPathError,
)
from etl.ingest.pba import (
    PBA_ALLOWED_PATHS,
    PBA_HOST,
    PBA_HOST_POLICY,
    PbaFetchExhaustedError,
    PbaSourceUnavailable,
    archive_pba_source,
    ingest_pba,
    load_pba_distrito_totals,
    resolve_pba_jurisdictions,
)
from etl.jurisdiction import QuarantinedPbaDistrito, resolve_pba_distrito_code
from etl.storage import LocalArchiveStore

FIXTURES = Path(__file__).parent / "fixtures"


def _read(name: str) -> bytes:
    return (FIXTURES / name).read_bytes()


# ---------------------------------------------------------------------------
# 5.1 — distrito-level totals ingested without fabricating lower levels
# ---------------------------------------------------------------------------


def test_distrito_level_totals_ingested_without_fabricating_lower_levels() -> None:
    rows = ingest_pba(
        _read("pba_distrito_027_2025_sample.html"),
        archive_entry_id="pba/2025-distrito-027",
        requested_granularity="distrito",
    )

    assert rows, "expected at least one normalized row from the real fixture table"
    for row in rows:
        assert row.granularity == "distrito"
        assert row.result.distrito == "027"
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


def test_no_source_available_reports_unavailable_not_zero(tmp_path: Path) -> None:
    local_store = LocalArchiveStore(root=tmp_path)

    with pytest.raises(PbaSourceUnavailable):
        load_pba_distrito_totals(
            [],  # no archive entries at all for this record id
            local_store,
            record_id="pba/2025-distrito-027",
        )


def test_no_source_available_does_not_substitute_a_prior_years_record(tmp_path: Path) -> None:
    local_store = LocalArchiveStore(root=tmp_path)
    # A record for a DIFFERENT record id must never be silently substituted.
    records = [
        {
            "id": "pba/2025-distrito-999",
            "status": "ok",
            "archived_path": "archive/pba/distrito_999.html",
            "sha256": "deadbeef",
        }
    ]

    with pytest.raises(PbaSourceUnavailable):
        load_pba_distrito_totals(records, local_store, record_id="pba/2025-distrito-027")


# ---------------------------------------------------------------------------
# 5.3 — mesa requested but only distrito available marks degradation
# ---------------------------------------------------------------------------


def test_mesa_requested_but_only_distrito_available_marks_degradation() -> None:
    rows = ingest_pba(
        _read("pba_distrito_027_2025_sample.html"),
        archive_entry_id="pba/2025-distrito-027",
        requested_granularity="mesa",
    )

    assert rows
    for row in rows:
        # Degradation is a first-class attribute of the row itself, never
        # log-only (task 5.6 / electoral-ingestion "Granularity degradation
        # is explicit, never silent").
        assert row.degraded_from == "mesa"
        assert row.granularity == "distrito"


def test_no_degradation_flag_when_requested_granularity_matches_actual() -> None:
    rows = ingest_pba(
        _read("pba_distrito_027_2025_sample.html"),
        archive_entry_id="pba/2025-distrito-027",
        requested_granularity="distrito",
    )

    assert rows
    for row in rows:
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
    assert not PBA_HOST.startswith("juntaelectoral")

    with (
        patch(
            "etl.http_client.requests.get",
            side_effect=requests.exceptions.SSLError("certificate verify failed"),
        ) as mocked,
        patch("etl.http_client.time.sleep"),
    ):
        from etl.http_client import RequestsFetcher

        policed = PolicedHostFetcher(
            RequestsFetcher(max_retries=1), PBA_HOST_POLICY, sleep=lambda _s: None
        )
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
    existing_record = {
        "id": ENTRY["id"],
        "capability": "pba",
        "source": PBA_HOST,
        "source_url": ENTRY["source_url"],
        "archived_path": "archive/pba/distrito_027.html",
        "sha256": "cafef00d",
        "mime": "text/html",
        "bytes": 6640,
        "fetched_at": "2025-09-08T12:00:00Z",
        "status": "ok",
        "notes": "",
    }

    calls: list[str] = []

    class NeverCalledFetcher:
        def get(self, url: str, *, timeout: float) -> FetchResponse:
            calls.append(url)
            raise AssertionError("the network must never be touched for a cached entry")

    result = archive_pba_source(
        ENTRY,
        fetcher=NeverCalledFetcher(),
        local_store=local_store,
        records=[existing_record],
    )

    assert calls == []
    assert result.record == existing_record


def test_fetcher_backs_off_and_stops_after_3_attempts_on_429_or_5xx() -> None:
    local_store_calls: list[str] = []

    class AlwaysUnavailableFetcher:
        def get(self, url: str, *, timeout: float, headers: dict[str, str]) -> FetchResponse:
            local_store_calls.append(url)
            return FetchResponse(503, b"")

    policed = PolicedHostFetcher(
        AlwaysUnavailableFetcher(), PBA_HOST_POLICY, sleep=lambda _s: None
    )

    import tempfile

    with tempfile.TemporaryDirectory() as tmp:
        local_store = LocalArchiveStore(root=Path(tmp))
        result = archive_pba_source(
            ENTRY,
            fetcher=policed,
            local_store=local_store,
            records=[],
            sleep=lambda _s: None,
        )

    assert len(local_store_calls) == 3, "must stop after exactly 3 attempts, never retry through it"
    assert result.record["status"] == "error"
    assert result.record["sha256"] is None
    assert result.record["archived_path"] is None


def test_pba_fetch_exhausted_error_message_names_the_url() -> None:
    class AlwaysUnavailableFetcher:
        def get(self, url: str, *, timeout: float, headers: dict[str, str]) -> FetchResponse:
            return FetchResponse(429, b"")

    policed = PolicedHostFetcher(
        AlwaysUnavailableFetcher(), PBA_HOST_POLICY, sleep=lambda _s: None
    )

    from etl.ingest.pba import _PolicedBackoffFetcher

    backoff = _PolicedBackoffFetcher(policed=policed, sleep=lambda _s: None)
    with pytest.raises(PbaFetchExhaustedError):
        backoff.get(
            f"https://{PBA_HOST}{PBA_ALLOWED_PATHS[0]}", timeout=5, headers={}
        )


# ---------------------------------------------------------------------------
# 17.5/17.3 — PBA distrito codes resolved through jurisdiction_crosswalk
# before any jurisdiction is created; an uncurated code is quarantined.
# ---------------------------------------------------------------------------

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


def test_resolve_pba_jurisdictions_translates_to_the_national_distrito_code() -> None:
    rows = ingest_pba(
        _read("pba_distrito_027_2025_sample.html"),
        archive_entry_id="pba/2025-distrito-027",
        requested_granularity="distrito",
    )
    assert rows and all(row.result.distrito == "027" for row in rows), (
        "sanity: ingest_pba itself still carries PBA's own, untranslated code"
    )

    result = resolve_pba_jurisdictions(rows, _CROSSWALK)

    assert not result.quarantined
    assert len(result.resolved) == len(rows)
    assert all(row.result.distrito == "02" for row in result.resolved), (
        "every resolved row must carry the national distrito code, "
        "never PBA's own 027"
    )
    # Everything else about each row is preserved verbatim.
    assert {row.list_id for row in result.resolved} == {row.list_id for row in rows}
    assert {row.votes for row in result.resolved} == {row.votes for row in rows}


def test_resolve_pba_jurisdictions_quarantines_an_uncurated_distrito_code() -> None:
    rows = ingest_pba(
        _read("pba_distrito_027_2025_sample.html"),
        archive_entry_id="pba/2025-distrito-027",
        requested_granularity="distrito",
    )
    empty_crosswalk = CrosswalkTable(jurisdictions=())

    result = resolve_pba_jurisdictions(rows, empty_crosswalk)

    assert result.resolved == ()
    assert len(result.quarantined) == len(rows)
    assert all(q.row.result.distrito == "027" for q in result.quarantined)
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
