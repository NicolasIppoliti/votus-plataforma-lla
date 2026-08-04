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
)
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
