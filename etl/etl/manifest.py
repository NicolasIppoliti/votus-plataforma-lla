"""Provenance manifest (``archive-manifest.json``) read/write helpers.

Ported from the sibling ``lla-coronel-rosales`` project with unmodified
core semantics (immutability, content-drift detection, failed-refetch
preservation), adapted to this project's schema (no R2 upload path — D2
scopes the archive to filesystem + manifest only, so ``archived_url`` is
dropped)::

    {
      "id": str,               # stable slug, referenced by sources.yaml
      "capability": str,       # e.g. "national"
      "source": str,           # host label
      "source_url": str,
      "archived_path": str | None,  # local mirror path, repo-relative
      "sha256": str | None,         # None only when status == "error"
      "mime": str,
      "bytes": int | None,
      "fetched_at": str,       # ISO-8601 UTC
      "status": "ok" | "error",
      "notes": str,
    }

Content-drift handling (source-archive spec, "Re-fetch with changed
content" scenario): when ``upsert_record`` receives a record whose
``sha256`` differs from the existing "ok" record sharing the same ``id``,
the prior version is kept under a dated id (``{id}@{fetched_at date}``) so
it remains retrievable, and the canonical id is updated to the new
capture.

Failed re-fetch handling (source-archive spec, "Source temporarily
unreachable" scenario): when ``upsert_record`` receives a ``status:
"error"`` record (``sha256`` is always ``None`` for these) for an ``id``
whose existing record is ``status: "ok"``, the existing "ok" record is
PRESERVED AS-IS (never overwritten with the failed attempt's ``None``
fields). The failure is instead recorded on the preserved record via two
additive fields, ``last_error`` and ``last_error_at``, so the failure is
still visible without destroying the previously archived copy or its
``archived_path``/``sha256``. If the existing record was ALREADY
``status: "error"`` (no archived copy to protect), the newest failure
simply replaces it.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

REQUIRED_FIELDS = (
    "id",
    "capability",
    "source",
    "source_url",
    "sha256",
    "mime",
    "fetched_at",
    "status",
    "notes",
)


def load_manifest(path: Path) -> list[dict[str, Any]]:
    """Load the manifest array, or an empty list if it does not exist yet."""
    if not path.exists():
        return []
    return json.loads(path.read_text(encoding="utf-8"))


def save_manifest(path: Path, records: list[dict[str, Any]]) -> None:
    """Write the manifest array as pretty-printed, UTF-8 JSON."""
    path.write_text(
        json.dumps(records, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )


def entries_for_source(
    records: list[dict[str, Any]], source_url: str
) -> list[dict[str, Any]]:
    """Return every archive entry recorded for ``source_url``, in fetch order.

    source-archive spec, "Manifest queryable by source" scenario. Records
    are appended in fetch order by ``upsert_record``, so filtering
    preserves that order without a separate sort.
    """
    return [r for r in records if r.get("source_url") == source_url]


def latest_ok_record(
    records: list[dict[str, Any]], record_id: str
) -> dict[str, Any] | None:
    """Return the current ``status: "ok"`` record for ``record_id``, or
    ``None`` if that source has never been successfully archived.

    source-archive spec, "Source has never been successfully fetched and
    is unreachable" scenario: downstream ingestion uses this to report data
    as unavailable rather than substituting empty or default results.
    """
    for record in records:
        if record.get("id") == record_id:
            return record if record.get("status") == "ok" else None
    return None


def ok_records_with_local_path(
    records: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Return every ``status: "ok"`` record that declares an ``archived_path``."""
    return [
        record
        for record in records
        if record.get("status") == "ok" and record.get("archived_path")
    ]


def upsert_record(
    records: list[dict[str, Any]], record: dict[str, Any]
) -> list[dict[str, Any]]:
    """Insert or replace a record by ``id``, detecting content drift.

    See module docstring for the drift and failed-refetch rules.
    """
    result: list[dict[str, Any]] = []
    replaced = False
    for existing in records:
        if existing["id"] != record["id"]:
            result.append(existing)
            continue

        replaced = True

        is_failed_overwrite = (
            record.get("status") == "error" and existing.get("status") == "ok"
        )
        if is_failed_overwrite:
            preserved = dict(existing)
            preserved["last_error"] = record.get("notes") or None
            preserved["last_error_at"] = record.get("fetched_at")
            result.append(preserved)
            continue

        is_drift = (
            existing.get("status") == "ok"
            and existing.get("sha256")
            and record.get("sha256")
            and existing["sha256"] != record["sha256"]
        )
        if is_drift:
            date = (existing.get("fetched_at") or "")[:10] or "unknown"
            prior = dict(existing)
            prior["id"] = f"{existing['id']}@{date}"
            prior_note = prior.get("notes") or ""
            prior["notes"] = (
                f"{prior_note} [superseded by newer capture on "
                f"{record.get('fetched_at')}]"
            ).strip()
            result.append(prior)

            record = dict(record)
            new_note = record.get("notes") or ""
            record["notes"] = f"{new_note} [content drift detected vs prior capture]".strip()

        result.append(record)

    if not replaced:
        result.append(record)
    return result
