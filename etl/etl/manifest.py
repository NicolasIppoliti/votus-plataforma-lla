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
the prior version is kept under an id containing its filename-safe fetch
timestamp and full sha256. If that identity has already been used, an
explicit numeric suffix preserves the repeated capture. The canonical id
is updated to the new capture.

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
import re
from pathlib import Path

type JSONValue = None | bool | int | float | str | list[JSONValue] | dict[str, JSONValue]
type ManifestRecord = dict[str, JSONValue]


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


_STRING_FIELDS = (
    "capability",
    "source",
    "mime",
    "fetched_at",
    "notes",
    "last_error_at",
    "election_round",
    "source_kind",
)
_NULLABLE_STRING_FIELDS = ("source_url", "archived_path", "sha256", "last_error")


def _validate_record_types(record: ManifestRecord, *, index: int | None = None) -> None:
    label = f"manifest record {index}" if index is not None else "manifest record"

    record_id = record.get("id")
    if not isinstance(record_id, str) or not record_id.strip():
        raise MalformedManifestError(f"{label} id must be a non-empty string")

    status = record.get("status")
    if not isinstance(status, str) or status not in ("ok", "error"):
        raise MalformedManifestError(f"{label} status must be exactly 'ok' or 'error'")

    for field in _STRING_FIELDS:
        if field in record and not isinstance(record[field], str):
            raise MalformedManifestError(f"{label} {field} must be a string")

    for field in _NULLABLE_STRING_FIELDS:
        if field in record and not isinstance(record[field], str | None):
            raise MalformedManifestError(f"{label} {field} must be a string or null")

    if "bytes" in record:
        byte_count = record["bytes"]
        if byte_count is not None and (
            isinstance(byte_count, bool) or not isinstance(byte_count, int) or byte_count < 0
        ):
            raise MalformedManifestError(f"{label} bytes must be a nonnegative integer or null")

    if "election_year" in record:
        election_year = record["election_year"]
        if isinstance(election_year, bool) or not isinstance(election_year, int):
            raise MalformedManifestError(f"{label} election_year must be an integer")


def load_manifest(path: Path) -> list[ManifestRecord]:
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
    try:
        raw_manifest = path.read_text(encoding="utf-8")
    except FileNotFoundError:
        return []
    except OSError as exc:
        raise MalformedManifestError(f"could not read manifest {path}: {exc}") from exc

    try:
        loaded: JSONValue = json.loads(raw_manifest)
    except json.JSONDecodeError as exc:
        raise MalformedManifestError(f"manifest {path} is not valid JSON: {exc}") from exc

    if not isinstance(loaded, list):
        raise MalformedManifestError("manifest top level must be a JSON array")

    records: list[ManifestRecord] = []
    for index, record in enumerate(loaded):
        if not isinstance(record, dict):
            raise MalformedManifestError(f"manifest record {index} must be a JSON object")
        missing = [field for field in ("id", "status") if field not in record]
        if missing:
            raise MalformedManifestError(
                f"manifest record {index} (id={record.get('id')!r}) is missing "
                f"{', '.join(missing)}; refusing to read an archive whose "
                "provenance record is incomplete"
            )
        _validate_record_types(record, index=index)
        records.append(record)
    return records


def save_manifest(path: Path, records: list[ManifestRecord]) -> None:
    """Write the manifest array as pretty-printed, UTF-8 JSON."""
    path.write_text(json.dumps(records, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


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


def _ensure_unique_record_ids(
    records: list[ManifestRecord], *, record_id: str | None = None
) -> None:
    counts: dict[str, int] = {}
    for record in records:
        candidate = record.get("id")
        if isinstance(candidate, str) and (record_id is None or candidate == record_id):
            counts[candidate] = counts.get(candidate, 0) + 1

    for candidate, count in counts.items():
        if count > 1:
            raise DuplicateManifestRecordError(
                f"the manifest holds {count} records for {candidate!r}; "
                "`upsert_record` keeps one per id, so this file was written by "
                "something else and there is no honest way to choose between them"
            )


def canonical_record(records: list[ManifestRecord], record_id: str) -> ManifestRecord | None:
    """Return the one canonical record for ``record_id`` regardless of status."""
    _ensure_unique_record_ids(records, record_id=record_id)
    matches = [record for record in records if record.get("id") == record_id]
    return matches[0] if matches else None


def latest_ok_record(records: list[ManifestRecord], record_id: str) -> ManifestRecord | None:
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
    current = canonical_record(records, record_id)
    return current if current is not None and current.get("status") == "ok" else None


def upsert_record(
    records: list[ManifestRecord],
    record: ManifestRecord,
    *,
    drift_label: str = "content drift",
) -> list[ManifestRecord]:
    """Insert or replace a record by ``id``, detecting content drift.

    See module docstring for the drift and failed-refetch rules.

    The record being written is validated against `REQUIRED_FIELDS` first.
    That tuple declares this file's schema and its only consumer was a test
    asserting a fixture dict the test itself had built -- so it documented a
    shape nothing enforced, and the one place that CAN enforce it is the
    single writer.
    """
    _ensure_unique_record_ids(records)

    missing = [field for field in REQUIRED_FIELDS if field not in record]
    if missing:
        raise MalformedManifestError(
            f"refusing to write a manifest record for {record.get('id')!r} missing "
            f"{', '.join(missing)}; this file is the archive's provenance and an "
            "incomplete record cannot be traced back to a fetch"
        )
    _validate_record_types(record)

    result: list[ManifestRecord] = []
    reserved_ids = {
        existing_id for existing in records if isinstance((existing_id := existing.get("id")), str)
    }
    replaced = False
    for existing in records:
        if existing["id"] != record["id"]:
            result.append(existing)
            continue

        replaced = True

        is_failed_overwrite = record.get("status") == "error" and existing.get("status") == "ok"
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
            fetched_at = existing.get("fetched_at")
            raw_stamp = fetched_at if isinstance(fetched_at, str) and fetched_at else "unknown"
            stamp = re.sub(r"[^A-Za-z0-9._-]", "", raw_stamp) or "unknown"
            historical_base = f"{existing['id']}@{stamp}-{existing['sha256']}"
            historical_id = historical_base
            suffix = 2
            while historical_id in reserved_ids:
                historical_id = f"{historical_base}-{suffix}"
                suffix += 1
            reserved_ids.add(historical_id)

            prior = dict(existing)
            prior["id"] = historical_id
            prior_note = prior.get("notes") or ""
            prior["notes"] = (
                f"{prior_note} [superseded by newer capture on {record.get('fetched_at')}]"
            ).strip()
            result.append(prior)

            record = dict(record)
            new_note = record.get("notes") or ""
            record["notes"] = f"{new_note} [{drift_label} detected vs prior capture]".strip()

        result.append(record)

    if not replaced:
        result.append(record)
    return result
