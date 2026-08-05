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
from typing import Protocol

from .manifest import load_manifest, save_manifest, upsert_record
from .storage import LocalArchiveStore, sha256_of

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

    def get(
        self, url: str, *, timeout: float, headers: dict[str, str]
    ) -> FetchResponse: ...


@dataclass
class FetchResponse:
    status_code: int
    content: bytes
    headers: dict[str, str] = field(default_factory=dict)


@dataclass
class ArchiveResult:
    record: dict


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
    local_store: LocalArchiveStore,
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
            record=_empty_record(
                entry, fetched_at, f"{notes} [HTTP {response.status_code}]"
            )
        )

    data = response.content
    digest = sha256_of(data)
    filename = entry.get("filename") or entry["id"].split("/")[-1]
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


def run_archive_all(
    sources: dict[str, list[dict]],
    *,
    fetcher: Fetcher,
    local_root: Path,
    manifest_path: Path,
    sleep: object | None = None,
    now: datetime | None = None,
) -> list[dict]:
    """Archive every entry across every capability family, updating the manifest.

    ``sleep`` (defaults to ``time.sleep`` when ``None``) is injected so
    tests never actually pause; production callers get real politeness
    delays between sequential fetches for capabilities listed in
    ``POLITENESS_DELAY_SECONDS``.
    """
    import time

    sleep_fn = sleep or time.sleep
    local_store = LocalArchiveStore(root=local_root)
    records = load_manifest(manifest_path)
    for capability, entries in sources.items():
        delay = POLITENESS_DELAY_SECONDS.get(capability, 0)
        for index, entry in enumerate(entries):
            full_entry = {**entry, "capability": capability}
            result = archive_source(
                full_entry, fetcher=fetcher, local_store=local_store, now=now
            )
            records = upsert_record(records, result.record)
            if delay and index < len(entries) - 1:
                sleep_fn(delay)
    save_manifest(manifest_path, records)
    return records
