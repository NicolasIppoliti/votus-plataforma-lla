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


class MalformedManifestError(ValueError):
    """Raised when a manifest record is missing a field this project reads."""


def load_manifest(path: Path) -> list[dict[str, Any]]:
    """Load the manifest array, or an empty list if it does not exist yet.

    Every record is CHECKED for the fields the READERS here dereference --
    `id` and `status` -- once at this boundary rather than by each of the
    eight call sites deciding for itself what it can rely on. A record
    missing them made `latest_ok_record` answer "never archived" for a
    source that is archived.
    
    Deliberately NOT the whole of `REQUIRED_FIELDS`: that is the schema
    `upsert_record` WRITES (and now validates on the way out), and demanding
    it on the way in would refuse a hand-written record this code reads
    perfectly well. `archived_path` is not here either -- it has its own
    named refusal in `__main__.archived_filename`, where it is read.
    """
    if not path.exists():
        return []
    records = json.loads(path.read_text(encoding="utf-8"))
    for index, record in enumerate(records):
        missing = [field for field in ("id", "status") if field not in record]
        if missing:
            raise MalformedManifestError(
                f"manifest record {index} (id={record.get('id')!r}) is missing "
                f"{', '.join(missing)}; refusing to read an archive whose "
                "provenance record is incomplete"
            )
    return records


def save_manifest(path: Path, records: list[dict[str, Any]]) -> None:
    """Write the manifest array as pretty-printed, UTF-8 JSON."""
    path.write_text(
        json.dumps(records, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )


# NO `entries_for_source` and NO `ok_records_with_local_path`. Both were
# correct, both tested, neither had a production caller: every archive read
# in this project goes through `latest_ok_record` plus
# `__main__.archived_filename`.
#
# `entries_for_source` was written for the source-archive spec's "manifest
# queryable by source" scenario, and that scenario is satisfied by the
# manifest being a plain JSON array on disk -- a helper nobody calls delivers
# no queryability. If a `status` subcommand is ever added to report the
# archived corpus, it can reintroduce whichever shape it actually needs,
# tested through that entry point.

class DuplicateManifestRecordError(ValueError):
    """Raised when one source id carries more than one manifest record.

    `upsert_record` maintains one-per-id; more than one means the file was
    written by something else, and choosing between two archived copies would
    silently decide which bytes get ingested.
    """


def latest_ok_record(
    records: list[dict[str, Any]], record_id: str
) -> dict[str, Any] | None:
    """Return the current ``status: "ok"`` record for ``record_id``, or
    ``None`` if that source has never been successfully archived.

    source-archive spec, "Source has never been successfully fetched and
    is unreachable" scenario: downstream ingestion uses this to report data
    as unavailable rather than substituting empty or default results.

    `upsert_record` REPLACES by id, so a well-formed manifest holds at most
    one record per id. That invariant is now CHECKED rather than assumed:
    scanning for the first match and returning it silently picked between two
    archived copies of one source -- deciding which bytes reach `result_row`
    -- and, worse, a stale `error` record ahead of a later `ok` one made this
    answer "never archived" for a source that IS archived. Every other
    two-candidate site in this codebase refuses rather than chooses.
    """
    matches = [record for record in records if record.get("id") == record_id]
    if len(matches) > 1:
        raise DuplicateManifestRecordError(
            f"the manifest holds {len(matches)} records for {record_id!r}; "
            "`upsert_record` keeps one per id, so this file was written by "
            "something else and there is no honest way to choose between them"
        )
    if not matches:
        return None
    return matches[0] if matches[0].get("status") == "ok" else None


def upsert_record(
    records: list[dict[str, Any]], record: dict[str, Any]
) -> list[dict[str, Any]]:
    """Insert or replace a record by ``id``, detecting content drift.

    See module docstring for the drift and failed-refetch rules.

    The record being written is validated against `REQUIRED_FIELDS` first.
    That tuple declares this file's schema and its only consumer was a test
    asserting a fixture dict the test itself had built -- so it documented a
    shape nothing enforced, and the one place that CAN enforce it is the
    single writer.
    """
    missing = [field for field in REQUIRED_FIELDS if field not in record]
    if missing:
        raise MalformedManifestError(
            f"refusing to write a manifest record for {record.get('id')!r} missing "
            f"{', '.join(missing)}; this file is the archive's provenance and an "
            "incomplete record cannot be traced back to a fetch"
        )

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
            # The FULL timestamp, not `fetched_at[:10]`. Two content drifts on
            # one calendar date produced two records sharing the dated id, and
            # `latest_ok_record` now REFUSES a duplicated id -- so the single
            # writer that maintains the one-per-id invariant was the thing
            # that broke it, making that archived capture permanently
            # unreadable. Colons are stripped so the id stays filename-safe.
            stamp = (existing.get("fetched_at") or "unknown").replace(":", "")
            prior = dict(existing)
            prior["id"] = f"{existing['id']}@{stamp}"
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
