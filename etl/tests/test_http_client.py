"""Unit tests for the requests-based fetcher (etl.http_client).

Mocks ``requests.get``/``requests.head`` — no real network I/O in this
suite.

Includes:
- source-archive spec's fetch-failure-handling scenarios (2.6), exercised
  through ``archive_source`` since that is where "no partial entry" and
  "reports unavailable" are actually observable behaviour.
- the D10 threat-matrix tests (2.6c) for fetching a host with no declared
  permission (design D10: `www.juntaelectoral.gba.gov.ar`). The Phase 5
  fetcher that would actually register and call this host does not exist
  yet and is NOT built here; these tests exercise the general, reusable
  ``PolicedHostFetcher``/``HostPolicy`` contract in ``http_client`` using
  the real host name only as configuration data, never a real network
  call. All six D10 constraints listed in the task are testable at this
  contract level without the Phase 5 fetcher existing.
"""

import threading
import time
from unittest.mock import Mock, patch

import pytest
import requests

from etl.archive import FetchResponse, archive_source
from etl.http_client import (
    DEFAULT_USER_AGENT,
    HostPolicy,
    PolicedHostFetcher,
    RequestsFetcher,
    RobotsTxtAppearedError,
    UnregisteredPathError,
    check_robots_txt_still_absent,
)
from etl.manifest import latest_ok_record, upsert_record
from etl.storage import LocalArchiveStore, sha256_of

# ---------------------------------------------------------------------------
# RequestsFetcher — ported, unmodified semantics
# ---------------------------------------------------------------------------


def test_get_returns_fetch_response_on_success() -> None:
    fake_response = Mock(status_code=200, content=b"hello", headers={"Content-Type": "text/csv"})
    with patch("etl.http_client.requests.get", return_value=fake_response) as mocked:
        fetcher = RequestsFetcher()
        result = fetcher.get("https://example.org/f.csv", timeout=10, headers={"User-Agent": "x"})

    mocked.assert_called_once()
    assert result.status_code == 200
    assert result.content == b"hello"
    assert result.headers["Content-Type"] == "text/csv"


def test_get_retries_on_request_exception_then_succeeds() -> None:
    fake_response = Mock(status_code=200, content=b"ok", headers={})
    with (
        patch(
            "etl.http_client.requests.get",
            side_effect=[requests.ConnectionError("boom"), fake_response],
        ) as mocked,
        patch("etl.http_client.time.sleep") as mocked_sleep,
    ):
        fetcher = RequestsFetcher(max_retries=2, retry_delay_seconds=0.1)
        result = fetcher.get("https://example.org/f.csv", timeout=10, headers={})

    assert mocked.call_count == 2
    mocked_sleep.assert_called_once_with(0.1)
    assert result.content == b"ok"


def test_head_returns_status_code_only_without_downloading_body() -> None:
    fake_response = Mock(status_code=200, headers={"Content-Length": "88157604"})
    with patch("etl.http_client.requests.head", return_value=fake_response) as mocked:
        fetcher = RequestsFetcher()
        result = fetcher.head(
            "https://example.org/big.zip", timeout=10, headers={"User-Agent": "x"}
        )

    mocked.assert_called_once()
    assert result.status_code == 200
    assert result.headers["Content-Length"] == "88157604"


def test_get_retries_on_429_honoring_retry_after_header() -> None:
    throttled = Mock(status_code=429, content=b"", headers={"Retry-After": "3"})
    ok_response = Mock(status_code=200, content=b"ok", headers={})
    with (
        patch("etl.http_client.requests.get", side_effect=[throttled, ok_response]) as mocked,
        patch("etl.http_client.time.sleep") as mocked_sleep,
    ):
        fetcher = RequestsFetcher(max_retries=2, retry_delay_seconds=0.1)
        result = fetcher.get("https://example.org/f.pdf", timeout=10, headers={})

    assert mocked.call_count == 2
    mocked_sleep.assert_called_once_with(3.0)
    assert result.status_code == 200
    assert result.content == b"ok"


def test_get_raises_after_exhausting_retries() -> None:
    with (
        patch(
            "etl.http_client.requests.get",
            side_effect=requests.ConnectionError("boom"),
        ),
        patch("etl.http_client.time.sleep"),
    ):
        fetcher = RequestsFetcher(max_retries=2, retry_delay_seconds=0.1)
        with pytest.raises(requests.ConnectionError):
            fetcher.get("https://example.org/f.csv", timeout=10, headers={})


# ---------------------------------------------------------------------------
# 2.6 — fetch failure handling (source-archive spec)
# ---------------------------------------------------------------------------

ENTRY = {
    "id": "national/2023-generales",
    "capability": "national",
    "source": "argentina.gob.ar",
    "source_url": "https://www.argentina.gob.ar/sites/default/files/2023_generales_1.zip",
    "mime": "application/zip",
    "notes": "",
    "filename": "2023-generales.zip",
}


class _FakeFetcher:
    def __init__(self, outcome: FetchResponse | Exception) -> None:
        self.outcome = outcome

    def get(self, url: str, *, timeout: float, headers: dict[str, str]) -> FetchResponse:
        if isinstance(self.outcome, Exception):
            raise self.outcome
        return self.outcome


def test_fetch_failure_does_not_create_partial_entry(tmp_path) -> None:
    """source-archive spec: 'Source temporarily unreachable' — a failed
    re-fetch must not create a partial/corrupt archive entry, and the
    previously successful entry must remain untouched and usable."""
    local_store = LocalArchiveStore(root=tmp_path)
    good_bytes = b"PK\x03\x04 the real archived zip"

    ok_result = archive_source(
        ENTRY, fetcher=_FakeFetcher(FetchResponse(200, good_bytes)), local_store=local_store
    )
    records = upsert_record([], ok_result.record)

    failed_result = archive_source(
        ENTRY, fetcher=_FakeFetcher(FetchResponse(500, b"")), local_store=local_store
    )
    records = upsert_record(records, failed_result.record)

    # No partial/corrupt entry: the failed attempt's own record carries no
    # sha256 and no archived_path.
    assert failed_result.record["status"] == "error"
    assert failed_result.record["sha256"] is None
    assert failed_result.record["archived_path"] is None

    # The prior successful entry is untouched and still usable downstream.
    assert len(records) == 1
    preserved = records[0]
    assert preserved["status"] == "ok"
    assert preserved["archived_path"] is not None
    archived_filename = f"2023-generales.{sha256_of(good_bytes)}.zip"
    assert local_store.read("national", archived_filename) == good_bytes
    last_error = preserved.get("last_error")
    assert isinstance(last_error, str)
    assert "500" in last_error


def test_unreachable_source_reports_unavailable(tmp_path) -> None:
    """source-archive spec: 'Source has never been successfully fetched and
    is unreachable' — capability depending on this source's data must
    report unavailable, not substitute empty/default results."""
    local_store = LocalArchiveStore(root=tmp_path)

    failed_result = archive_source(
        ENTRY,
        fetcher=_FakeFetcher(ConnectionError("DNS failure")),
        local_store=local_store,
    )
    records = upsert_record([], failed_result.record)

    # The contract downstream ingestion relies on: no ok record exists for
    # this id, so latest_ok_record reports None (unavailable), never a
    # zero/default substitute.
    assert latest_ok_record(records, ENTRY["id"]) is None
    assert not local_store.exists("national", "2023-generales.zip")


# ---------------------------------------------------------------------------
# 2.6c — D10 threat matrix: fetching a host with no declared permission
# ---------------------------------------------------------------------------

PBA_HOST = "www.juntaelectoral.gba.gov.ar"


def test_pba_host_concurrency_capped_at_one() -> None:
    policy = HostPolicy(
        host=PBA_HOST,
        max_concurrency=1,
        min_delay_seconds=0.0,
        user_agent=DEFAULT_USER_AGENT,
        allowed_path_prefixes=("/",),
    )
    release = threading.Event()
    entered: list[str] = []

    class BlockingFetcher:
        def get(self, url: str, *, timeout: float, headers: dict[str, str]) -> FetchResponse:
            entered.append(url)
            release.wait(timeout=2)
            return FetchResponse(200, b"ok")

    fetcher = PolicedHostFetcher(BlockingFetcher(), policy, sleep=lambda _seconds: None)
    results: list[FetchResponse] = []

    def worker() -> None:
        results.append(fetcher.get(f"https://{PBA_HOST}/docs/x.pdf", timeout=5))

    first = threading.Thread(target=worker)
    first.start()
    time.sleep(0.05)  # let the first request acquire the semaphore and block
    assert len(entered) == 1

    second = threading.Thread(target=worker)
    second.start()
    time.sleep(0.05)  # the second request must still be waiting for the slot
    assert len(entered) == 1

    release.set()
    first.join(timeout=2)
    second.join(timeout=2)

    assert len(entered) == 2
    assert len(results) == 2


def test_pba_host_delay_honours_politeness_seconds() -> None:
    sleeps: list[float] = []
    clock_values = iter([0.0, 0.0, 1.0, 1.0])

    class FakeFetcher:
        def get(self, url: str, *, timeout: float, headers: dict[str, str]) -> FetchResponse:
            return FetchResponse(200, b"ok")

    policy = HostPolicy(
        host=PBA_HOST,
        max_concurrency=5,
        min_delay_seconds=4.0,
        user_agent=DEFAULT_USER_AGENT,
        allowed_path_prefixes=("/docs/",),
    )
    fetcher = PolicedHostFetcher(
        FakeFetcher(), policy, sleep=sleeps.append, clock=lambda: next(clock_values)
    )

    fetcher.get(f"https://{PBA_HOST}/docs/one.pdf", timeout=5)
    fetcher.get(f"https://{PBA_HOST}/docs/two.pdf", timeout=5)

    # elapsed = 1.0 - 0.0 = 1.0s; remaining = 4.0 - 1.0 = 3.0s
    assert sleeps == [3.0]


def test_pba_host_uses_identifying_user_agent() -> None:
    captured: dict[str, str] = {}

    class FakeFetcher:
        def get(self, url: str, *, timeout: float, headers: dict[str, str]) -> FetchResponse:
            captured.update(headers)
            return FetchResponse(200, b"ok")

    policy = HostPolicy(
        host=PBA_HOST,
        max_concurrency=5,
        min_delay_seconds=0.0,
        user_agent=DEFAULT_USER_AGENT,
        allowed_path_prefixes=("/docs/",),
    )
    fetcher = PolicedHostFetcher(FakeFetcher(), policy, sleep=lambda _seconds: None)

    fetcher.get(f"https://{PBA_HOST}/docs/x.pdf", timeout=5)

    assert captured["User-Agent"] == DEFAULT_USER_AGENT
    # Identifying, per the existing convention — never a spoofed browser UA.
    assert "Votus" in captured["User-Agent"]
    assert "Chrome" not in captured["User-Agent"]
    assert "Mozilla" not in captured["User-Agent"]


def test_pba_host_refuses_unregistered_path() -> None:
    calls: list[str] = []

    class FakeFetcher:
        def get(self, url: str, *, timeout: float, headers: dict[str, str]) -> FetchResponse:
            calls.append(url)
            return FetchResponse(200, b"ok")

    policy = HostPolicy(
        host=PBA_HOST,
        max_concurrency=5,
        min_delay_seconds=0.0,
        user_agent=DEFAULT_USER_AGENT,
        allowed_path_prefixes=("/docs/", "/resultados-generales/"),
    )
    fetcher = PolicedHostFetcher(FakeFetcher(), policy, sleep=lambda _seconds: None)

    with pytest.raises(UnregisteredPathError):
        fetcher.get(f"https://{PBA_HOST}/some-crawled-path.html", timeout=5)

    # The underlying transport must never be reached for an unregistered path.
    assert calls == []


def test_pba_host_tls_failure_is_a_hard_error_not_bypassed() -> None:
    """D10 constraint 1: certificate verification stays ON; a TLS failure is
    a hard error, never bypassed. Testable at the RequestsFetcher contract
    level (no Phase 5 fetcher needed): an SSL error must propagate, and the
    fetcher must never pass ``verify=False`` to silence it.
    """
    with (
        patch(
            "etl.http_client.requests.get",
            side_effect=requests.exceptions.SSLError("certificate verify failed"),
        ) as mocked,
        patch("etl.http_client.time.sleep"),
    ):
        fetcher = RequestsFetcher(max_retries=1, retry_delay_seconds=0)
        with pytest.raises(requests.exceptions.SSLError):
            fetcher.get(f"https://{PBA_HOST}/docs/x.pdf", timeout=5, headers={})

    # verify=False would silently bypass certificate validation; assert it
    # was never passed (requests defaults to verify=True when omitted).
    for call in mocked.call_args_list:
        assert call.kwargs.get("verify") is not False


def test_pba_host_halts_run_if_robots_txt_ever_returns_200() -> None:
    """D10 constraint 8: if robots.txt ever starts returning 200 on a host
    that had none at policy-decision time, halt and surface it for a fresh
    policy decision rather than parsing and proceeding.
    """

    class RobotsAppearedFetcher:
        def get(self, url: str, *, timeout: float, headers: dict[str, str]) -> FetchResponse:
            assert url == f"https://{PBA_HOST}/robots.txt"
            return FetchResponse(200, b"User-agent: *\nDisallow: /")

    with pytest.raises(RobotsTxtAppearedError):
        check_robots_txt_still_absent(RobotsAppearedFetcher(), host=PBA_HOST)


def test_pba_host_robots_txt_still_absent_does_not_halt() -> None:
    """Complement to the above: a 404 (the current, verified state per D10)
    must NOT raise — only an actual 200 triggers the halt."""

    class RobotsAbsentFetcher:
        def get(self, url: str, *, timeout: float, headers: dict[str, str]) -> FetchResponse:
            return FetchResponse(404, b"")

    check_robots_txt_still_absent(RobotsAbsentFetcher(), host=PBA_HOST)  # must not raise
