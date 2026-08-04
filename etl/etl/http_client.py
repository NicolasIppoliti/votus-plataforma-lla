"""HTTP fetcher used by the archival pipeline (see ``archive.py``).

``RequestsFetcher`` wraps ``requests`` with a small retry loop and a
generous timeout, since some sources are large (electoral ZIPs) or slow
(Wayback Machine mirrors). Ported from the sibling ``lla-coronel-rosales``
project with unmodified semantics. Certificate verification is never
disabled anywhere in this module — no code path passes ``verify=False``.

``HostPolicy`` / ``PolicedHostFetcher`` / ``check_robots_txt_still_absent``
are NEW additions for design D10: binding etiquette for fetching a host
with no declared programmatic permission (``www.juntaelectoral.gba.gov.ar``
today; the constraint mechanism itself is general and host-agnostic). This
module intentionally does NOT register that host or build a fetcher for
it — that is Phase 5, gated on a product-owner policy decision. What
exists here is the reusable, testable contract Phase 5 will configure.
"""

from __future__ import annotations

import threading
import time
from dataclasses import dataclass
from urllib.parse import urlparse

import requests

from .archive import FetchResponse

DEFAULT_USER_AGENT = (
    "VotusElectoralAnalysis/1.0 "
    "(+internal electoral analysis tool; archival bot for official-source "
    "provenance tracking)"
)


@dataclass
class RequestsFetcher:
    max_retries: int = 3
    retry_delay_seconds: float = 2.0

    def head(
        self, url: str, *, timeout: float = 30, headers: dict[str, str] | None = None
    ) -> FetchResponse:
        """Lightweight reachability check: no retries, no response body."""
        response = requests.head(
            url, timeout=timeout, headers=headers or {}, allow_redirects=True
        )
        return FetchResponse(
            status_code=response.status_code, content=b"", headers=dict(response.headers)
        )

    def get(
        self, url: str, *, timeout: float = 60, headers: dict[str, str] | None = None
    ) -> FetchResponse:
        last_exc: Exception | None = None
        for attempt in range(1, self.max_retries + 1):
            try:
                response = requests.get(
                    url, timeout=timeout, headers=headers or {}, allow_redirects=True
                )
            except requests.RequestException as exc:
                last_exc = exc
                if attempt < self.max_retries:
                    time.sleep(self.retry_delay_seconds)
                continue

            if response.status_code == 429 and attempt < self.max_retries:
                retry_after = response.headers.get("Retry-After")
                delay = float(retry_after) if retry_after else self.retry_delay_seconds
                time.sleep(delay)
                continue

            return FetchResponse(
                status_code=response.status_code,
                content=response.content,
                headers=dict(response.headers),
            )
        assert last_exc is not None
        raise last_exc


# ---------------------------------------------------------------------------
# D10 — etiquette constraints for a host with no declared permission
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class HostPolicy:
    """Etiquette constraints bound to one host (design D10).

    Absence of a declared permission (no robots.txt, no terms page) is
    treated as requiring stricter behaviour than the DINE bulk hosts, not
    as an invitation to fetch freely.
    """

    host: str
    max_concurrency: int
    min_delay_seconds: float
    user_agent: str
    allowed_path_prefixes: tuple[str, ...]


class UnregisteredPathError(Exception):
    """Raised when a policed fetch targets a path outside the host's
    registered allowlist (D10 constraint 7: bounded surface, no crawling).
    """


class RobotsTxtAppearedError(Exception):
    """Raised when a host that previously had no robots.txt starts serving
    one (HTTP 200) — D10 constraint 8: halt and escalate for a fresh
    policy decision rather than parsing and proceeding.
    """


class PolicedHostFetcher:
    """Wraps a ``Fetcher`` with D10's etiquette constraints for one host.

    Enforces, per request:
    - the path is inside the registered allowlist (constraint 7);
    - a per-host concurrency cap via a semaphore (constraint 2);
    - a minimum delay since the previous request to this host, reusing the
      same politeness-delay pattern as ``archive.POLITENESS_DELAY_SECONDS``
      (constraint 3);
    - the configured identifying User-Agent (constraint 4).

    Certificate verification (constraint 1) is a property of the wrapped
    ``Fetcher`` (``RequestsFetcher`` never disables it); this wrapper adds
    no separate TLS handling and therefore cannot bypass it either.
    """

    def __init__(
        self,
        fetcher,
        policy: HostPolicy,
        *,
        sleep=time.sleep,
        clock=time.monotonic,
    ) -> None:
        self._fetcher = fetcher
        self._policy = policy
        self._semaphore = threading.Semaphore(policy.max_concurrency)
        self._sleep = sleep
        self._clock = clock
        self._delay_lock = threading.Lock()
        self._last_request_at: float | None = None

    def get(self, url: str, *, timeout: float) -> FetchResponse:
        self._enforce_registered_path(url)
        with self._semaphore:
            self._enforce_delay()
            headers = {"User-Agent": self._policy.user_agent}
            return self._fetcher.get(url, timeout=timeout, headers=headers)

    def _enforce_registered_path(self, url: str) -> None:
        path = urlparse(url).path
        if not any(
            path.startswith(prefix) for prefix in self._policy.allowed_path_prefixes
        ):
            raise UnregisteredPathError(
                f"{path!r} is not in the registered allowlist for {self._policy.host}"
            )

    def _enforce_delay(self) -> None:
        with self._delay_lock:
            now = self._clock()
            if self._last_request_at is not None:
                elapsed = now - self._last_request_at
                remaining = self._policy.min_delay_seconds - elapsed
                if remaining > 0:
                    self._sleep(remaining)
            self._last_request_at = self._clock()


def check_robots_txt_still_absent(fetcher, host: str) -> None:
    """D10 constraint 8: re-check on each run that ``robots.txt`` has not
    started returning 200. Raises ``RobotsTxtAppearedError`` if it has;
    does nothing (no return value) otherwise.
    """
    response = fetcher.get(
        f"https://{host}/robots.txt", timeout=10, headers={"User-Agent": DEFAULT_USER_AGENT}
    )
    if response.status_code == 200:
        raise RobotsTxtAppearedError(
            f"https://{host}/robots.txt now returns 200; halting for a fresh "
            "policy decision instead of parsing and proceeding"
        )
