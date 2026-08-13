"""HTTP fetcher used by the archival pipeline (see ``archive.py``).

``RequestsFetcher`` wraps ``requests`` with a small retry loop and a
generous timeout, since some sources are large (electoral ZIPs) or slow
(Wayback Machine mirrors). Ported from the sibling ``lla-coronel-rosales``
project with unmodified semantics. Certificate verification is never
disabled anywhere in this module — no code path passes ``verify=False``.

"""

from __future__ import annotations

import datetime as dt
import threading
import time
from dataclasses import dataclass
from email.utils import parsedate_to_datetime
from urllib.parse import urljoin, urlparse

import requests

from .archive import FetchResponse

DEFAULT_USER_AGENT = (
    "VotusElectoralAnalysis/1.0 "
    "(+internal electoral analysis tool; archival bot for official-source "
    "provenance tracking)"
)


def _retry_after_delay(retry_after: str | None, fallback: float) -> float:
    if retry_after is None:
        return fallback
    try:
        delay = float(retry_after)
    except ValueError:
        try:
            parsed = parsedate_to_datetime(retry_after)
            parsed = parsed.replace(tzinfo=parsed.tzinfo if parsed.tzinfo is not None else dt.UTC)
            delay = (parsed - dt.datetime.now(dt.UTC)).total_seconds()
        except (TypeError, ValueError):
            return fallback
    return max(delay, fallback) if 0 <= delay < 1e309 else fallback


@dataclass
class RequestsFetcher:
    def get(
        self, url: str, *, timeout: float = 60, headers: dict[str, str] | None = None
    ) -> FetchResponse:
        response = requests.get(url, timeout=timeout, headers=headers or {}, allow_redirects=False)
        return FetchResponse(
            status_code=response.status_code,
            content=response.content,
            headers=dict(response.headers),
        )


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
    max_attempts: int = 3
    max_redirect_hops: int = 5


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

    def get(
        self, url: str, *, timeout: float, headers: dict[str, str] | None = None
    ) -> FetchResponse:
        self._enforce_registered_path(url)
        with self._semaphore:
            delay = 0.0
            for attempt in range(self._policy.max_attempts):
                last_attempt = attempt + 1 == self._policy.max_attempts
                try:
                    response = self._request_with_redirects(url, timeout, delay)
                except requests.RequestException as exc:
                    if last_attempt:
                        raise exc
                    continue
                retryable = response.status_code == 429 or response.status_code >= 500
                if last_attempt or not retryable:
                    return response
                delay = _retry_after_delay(
                    response.headers.get("Retry-After"), self._policy.min_delay_seconds
                )
        raise AssertionError("max_attempts must be positive")

    def _request_with_redirects(self, url: str, timeout: float, delay: float) -> FetchResponse:
        visited = {url}
        for hop in range(self._policy.max_redirect_hops + 1):
            self._enforce_delay(delay if hop == 0 else 0.0)
            response = self._fetcher.get(
                url, timeout=timeout, headers={"User-Agent": self._policy.user_agent}
            )
            if response.status_code not in {301, 302, 303, 307, 308}:
                return response
            location = response.headers.get("Location")
            if not isinstance(location, str) or not location:
                raise UnregisteredPathError(f"invalid redirect Location: {location!r}")
            try:
                target = urljoin(url, location)
                self._enforce_registered_path(target)
            except ValueError as exc:
                raise UnregisteredPathError(f"invalid redirect Location: {location!r}") from exc
            if target in visited or hop == self._policy.max_redirect_hops:
                raise UnregisteredPathError("redirect loop or hop limit exceeded")
            visited.add(target)
            url = target
        raise AssertionError("unreachable")

    def _enforce_registered_path(self, url: str) -> None:
        parsed = urlparse(url)
        if parsed.scheme != "https" or parsed.netloc != self._policy.host:
            raise UnregisteredPathError(f"unregistered HTTPS host in {url!r}")
        allowed = any(
            parsed.path.startswith(path) if path.endswith("/") else parsed.path == path
            for path in self._policy.allowed_path_prefixes
        )
        if not allowed:
            raise UnregisteredPathError(f"path {parsed.path!r} is not in the allowlist")

    def _enforce_delay(self, retry_after_delay: float = 0.0) -> None:
        with self._delay_lock:
            now = self._clock()
            if self._last_request_at is not None:
                required = max(self._policy.min_delay_seconds, retry_after_delay)
                elapsed = now - self._last_request_at
                remaining = required - elapsed
                if remaining > 0:
                    self._sleep(remaining)
                    now += remaining
            self._last_request_at = now


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
