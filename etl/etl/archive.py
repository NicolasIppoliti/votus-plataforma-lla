"""Core archival pipeline: fetch -> sha256 -> manifest -> local mirror.

Ported from the sibling ``lla-coronel-rosales`` project's ``archive.py``
with unmodified core semantics (immutable append-only entries, sha256
recording, content-drift detection, failed-refetch preservation). Per
design D2, this project has no R2/bucket upload path — the local
``archive/`` mirror plus the committed ``archive-manifest.json`` are the
whole story, so the sibling's ``r2_store`` parameter and its
sibom-specific volatile-token normalization (not applicable to national
election ZIPs) are dropped rather than carried as dead code.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import TYPE_CHECKING, Protocol

from .storage import ArchiveStore, sha256_of

if TYPE_CHECKING:
    from .review_item import ReviewItemRecord

DEFAULT_USER_AGENT = (
    "VotusElectoralAnalysis/1.0 "
    "(+internal electoral analysis tool; archival bot for official-source "
    "provenance tracking)"
)

# Per-capability delay (seconds) applied between sequential fetches within a
# capability, to be polite to sources that may rate-limit rapid sequential
# requests. Keyed by capability (broad, per-family politeness); see
# http_client.HostPolicy for D10's stricter, per-host politeness contract.
# "pba" is D10 constraint 3's >=4s value, the single source of truth reused
# by etl.ingest.pba's HostPolicy.min_delay_seconds rather than a duplicated
# literal.
POLITENESS_DELAY_SECONDS: dict[str, float] = {"pba": 4.0}


class Fetcher(Protocol):
    """Minimal fetch surface, swappable with a fake in tests."""

    def get(self, url: str, *, timeout: float, headers: dict[str, str]) -> FetchResponse: ...


@dataclass
class FetchResponse:
    status_code: int
    content: bytes
    headers: dict[str, str] = field(default_factory=dict)


@dataclass
class ArchiveResult:
    record: dict
    review_items: tuple[ReviewItemRecord, ...] = ()


class ArchiveIntegrityError(RuntimeError):
    """Raised when a content-addressed archive path contains different bytes."""


class UnsafeArchiveFilenameError(ValueError):
    """Raised when a source filename is not a safe basename."""


def read_verified_archive(
    local_store: ArchiveStore,
    *,
    capability: str,
    filename: str,
    expected_sha256: object,
) -> bytes:
    """Read an archive artifact only when it matches its manifest digest."""
    if (
        not isinstance(expected_sha256, str)
        or len(expected_sha256) != 64
        or any(character not in "0123456789abcdefABCDEF" for character in expected_sha256)
    ):
        raise ArchiveIntegrityError(
            f"archive artifact {filename!r} has missing or invalid manifest sha256 "
            f"{expected_sha256!r}"
        )

    try:
        data = local_store.read(capability, filename)
    except OSError as exc:
        raise ArchiveIntegrityError(
            f"archive artifact {filename!r} cannot be read for sha256 verification: {exc}"
        ) from exc

    actual_sha256 = sha256_of(data)
    if actual_sha256 != expected_sha256.lower():
        raise ArchiveIntegrityError(
            f"archive artifact {filename!r} claims sha256 {expected_sha256} but contains "
            f"bytes with sha256 {actual_sha256}; refusing to consume it"
        )
    return data


def _safe_archive_basename(filename: object) -> str:
    if (
        not isinstance(filename, str)
        or not filename
        or filename in {".", ".."}
        or "\0" in filename
        or "/" in filename
        or "\\" in filename
        or Path(filename).name != filename
    ):
        raise UnsafeArchiveFilenameError(
            f"archive filename must be a non-empty safe basename, got {filename!r}"
        )
    return filename


def _content_addressed_filename(filename: str, digest: str) -> str:
    suffix = "".join(Path(filename).suffixes)
    stem = filename[: -len(suffix)] if suffix else filename
    return f"{stem}.{digest}{suffix}"


def _empty_record(entry: dict, fetched_at: str, note: str) -> dict:
    return {
        "id": entry["id"],
        "capability": entry["capability"],
        "source": entry["source"],
        "source_url": entry["source_url"],
        "archived_path": None,
        "sha256": None,
        "mime": entry.get("mime", "application/octet-stream"),
        "bytes": None,
        "fetched_at": fetched_at,
        "status": "error",
        "notes": note.strip(),
    }


def archive_source(
    entry: dict,
    *,
    fetcher: Fetcher,
    local_store: ArchiveStore,
    now: datetime | None = None,
) -> ArchiveResult:
    """Fetch one source entry and produce its manifest record.

    ``entry`` matches one ``etl/sources.yaml`` item plus an injected
    ``capability`` key: ``id``, ``source``, ``source_url``, ``mime``,
    ``notes``, ``capability``, and an optional ``filename`` (defaults to
    the last path segment of ``id``).
    """
    fetched_at = (now or datetime.now(UTC)).strftime("%Y-%m-%dT%H:%M:%SZ")
    capability = entry["capability"]
    source_url = entry["source_url"]
    notes = entry.get("notes", "")
    timeout = entry.get("timeout", 60)
    configured_filename = _safe_archive_basename(
        entry["filename"] if "filename" in entry else entry["id"].split("/")[-1]
    )
    # Validate both path components before any fetch. ``path_for`` is the final
    # filesystem boundary and must police direct callers as well as this pipeline.
    local_store.path_for(capability, configured_filename)

    try:
        response = fetcher.get(
            source_url, timeout=timeout, headers={"User-Agent": DEFAULT_USER_AGENT}
        )
    except Exception as exc:  # network error, DNS failure, timeout, etc.
        return ArchiveResult(
            record=_empty_record(entry, fetched_at, f"{notes} [fetch failed: {exc}]")
        )

    if response.status_code >= 400:
        return ArchiveResult(
            record=_empty_record(entry, fetched_at, f"{notes} [HTTP {response.status_code}]")
        )

    data = response.content
    digest = sha256_of(data)
    filename = _content_addressed_filename(configured_filename, digest)
    if local_store.exists(capability, filename):
        existing_digest = sha256_of(local_store.read(capability, filename))
        if existing_digest != digest:
            raise ArchiveIntegrityError(
                f"archive target {filename!r} claims sha256 {digest} but contains "
                f"bytes with sha256 {existing_digest}; refusing to overwrite"
            )
    else:
        local_store.write(capability, filename, data)

    # Portable, repo-relative path (never the absolute machine path), so the
    # manifest works identically for every developer/CI checkout.
    archived_path = f"{local_store.root.name}/{capability}/{filename}"

    record = {
        "id": entry["id"],
        "capability": capability,
        "source": entry["source"],
        "source_url": source_url,
        "archived_path": archived_path,
        "sha256": digest,
        "mime": entry.get("mime", "application/octet-stream"),
        "bytes": len(data),
        "fetched_at": fetched_at,
        "status": "ok",
        "notes": notes,
    }
    return ArchiveResult(record=record)
