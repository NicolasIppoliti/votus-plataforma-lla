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

Version 2 keeps the legacy canonical/archive records unchanged under
``records`` and adds ``fetch_events``: one append-only event per invocation,
ordered by explicit monotonic ``sequence`` and identified by an opaque
``event_id``. Legacy top-level arrays remain readable and migrate on the next
production fetch without inventing events for history they never recorded.

Content drift still preserves each immutable artifact record and advances the
canonical id. Fetch events separately retain identical re-fetches, failures,
and the official drift/fiscalización re-export classification.

Failed re-fetches append an error event with no archive identity while the
latest successful canonical record remains available to ingestion.
"""

from __future__ import annotations

import fcntl
import json
import os
import re
import tempfile
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

type JSONValue = None | bool | int | float | str | list[JSONValue] | dict[str, JSONValue]
type ManifestRecord = dict[str, JSONValue]
type FetchEvent = dict[str, JSONValue]

MANIFEST_SCHEMA_VERSION = 2
ALLOWED_EVENT_CLASSIFICATIONS = {
    "ok": frozenset({"initial", "identical", "content_drift", "source_reexported"}),
    "error": frozenset({"fetch_error"}),
}


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


class FetchEventConflictError(ValueError):
    """One invocation id was reused for a different fetch outcome."""


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


def _validate_record_types(
    record: ManifestRecord, *, index: int | None = None, label: str | None = None
) -> None:
    label = label or (f"manifest record {index}" if index is not None else "manifest record")

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

    digest = record.get("sha256")
    if digest is not None and (
        not isinstance(digest, str)
        or len(digest) != 64
        or any(character not in "0123456789abcdefABCDEF" for character in digest)
    ):
        raise MalformedManifestError(f"{label} sha256 must be 64 hexadecimal characters or null")

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


def _read_document(path: Path) -> tuple[list[ManifestRecord], list[FetchEvent], bool]:
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
        return [], [], True
    except OSError as exc:
        raise MalformedManifestError(f"could not read manifest {path}: {exc}") from exc

    try:
        loaded: JSONValue = json.loads(raw_manifest)
    except json.JSONDecodeError as exc:
        raise MalformedManifestError(f"manifest {path} is not valid JSON: {exc}") from exc

    legacy = isinstance(loaded, list)
    if legacy:
        raw_records = loaded
        raw_events: JSONValue = []
    elif isinstance(loaded, dict):
        if loaded.get("schema_version") != MANIFEST_SCHEMA_VERSION:
            raise MalformedManifestError(
                f"manifest schema_version must be exactly {MANIFEST_SCHEMA_VERSION}"
            )
        raw_records = loaded.get("records")
        raw_events = loaded.get("fetch_events")
        if not isinstance(raw_records, list) or not isinstance(raw_events, list):
            raise MalformedManifestError(
                "versioned manifest records and fetch_events must both be JSON arrays"
            )
    else:
        raise MalformedManifestError("manifest top level must be a JSON array or versioned object")

    records: list[ManifestRecord] = []
    for index, record in enumerate(raw_records):
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
    events = _validate_fetch_events(raw_events)
    return records, events, legacy


def load_manifest(path: Path) -> list[ManifestRecord]:
    """Return canonical/archive records from legacy or versioned manifests."""
    records, _, _ = _read_document(path)
    return records


def _validate_fetch_events(raw_events: JSONValue) -> list[FetchEvent]:
    if not isinstance(raw_events, list):
        raise MalformedManifestError("fetch event history must be a JSON array")
    events: list[FetchEvent] = []
    seen_ids: set[str] = set()
    previous_sequence = 0
    for index, event in enumerate(raw_events):
        label = f"fetch event {index}"
        if not isinstance(event, dict):
            raise MalformedManifestError(f"{label} must be a JSON object")
        event_id = event.get("event_id")
        sequence = event.get("sequence")
        source_id = event.get("source_id")
        fetched_at = event.get("fetched_at")
        status = event.get("status")
        classification = event.get("classification")
        record = event.get("record")
        if not isinstance(event_id, str) or not event_id:
            raise MalformedManifestError(f"{label} event_id must be a non-empty string")
        if event_id in seen_ids:
            raise MalformedManifestError(f"fetch event history repeats event_id {event_id!r}")
        if (
            isinstance(sequence, bool)
            or not isinstance(sequence, int)
            or sequence <= previous_sequence
        ):
            raise MalformedManifestError("fetch event history sequence must be strictly increasing")
        if not isinstance(source_id, str) or not source_id:
            raise MalformedManifestError(f"{label} source_id must be a non-empty string")
        if not isinstance(fetched_at, str) or not fetched_at:
            raise MalformedManifestError(f"{label} fetched_at must be a non-empty string")
        if status not in ("ok", "error"):
            raise MalformedManifestError(f"{label} status must be exactly 'ok' or 'error'")
        if classification not in ALLOWED_EVENT_CLASSIFICATIONS[status]:
            raise MalformedManifestError(
                f"{label} status {status!r} contradicts classification {classification!r}"
            )
        if not isinstance(record, dict) or record.get("status") != status:
            raise MalformedManifestError(f"{label} record must carry the same status")
        _validate_record_types(record, label=f"{label} record")
        if record.get("id") != source_id:
            raise MalformedManifestError(f"{label} record id must match source_id")
        if status == "ok":
            digest = record.get("sha256")
            archived_path = record.get("archived_path")
            byte_count = record.get("bytes")
            if (
                not isinstance(digest, str)
                or len(digest) != 64
                or not isinstance(archived_path, str)
                or not archived_path
                or isinstance(byte_count, bool)
                or not isinstance(byte_count, int)
                or byte_count < 0
            ):
                raise MalformedManifestError(
                    f"{label} successful record needs sha256, archived_path, and bytes"
                )
        elif any(record.get(field) is not None for field in ("sha256", "archived_path", "bytes")):
            raise MalformedManifestError(
                f"{label} error record cannot claim sha256, archived_path, or bytes"
            )
        seen_ids.add(event_id)
        previous_sequence = sequence
        events.append(event)
    return events


def load_fetch_events(path: Path, source_id: str | None = None) -> list[FetchEvent]:
    """Return every validated event in stable append order."""
    _, events, _ = _read_document(path)
    return [event for event in events if source_id is None or event["source_id"] == source_id]


def fetch_event(events: list[FetchEvent], event_id: str) -> FetchEvent | None:
    matches = [event for event in events if event.get("event_id") == event_id]
    if len(matches) > 1:
        raise MalformedManifestError(f"fetch event history repeats event_id {event_id!r}")
    return matches[0] if matches else None


def normalized_fetch_evidence(record: ManifestRecord) -> ManifestRecord:
    """Remove observation time, retaining every field that describes the outcome."""
    return {key: value for key, value in record.items() if key != "fetched_at"}


def append_fetch_event(events: list[FetchEvent], event: FetchEvent) -> list[FetchEvent]:
    """Append one invocation, or accept an exact retry of that invocation."""
    existing = fetch_event(events, str(event.get("event_id", "")))
    if existing is not None:
        existing_outcome = {
            key: value for key, value in existing.items() if key not in ("sequence", "fetched_at")
        }
        incoming_outcome = {
            key: value for key, value in event.items() if key not in ("sequence", "fetched_at")
        }
        if existing_outcome != incoming_outcome:
            raise FetchEventConflictError(
                f"fetch invocation {event.get('event_id')!r} conflicts with its recorded outcome"
            )
        return events
    candidate = dict(event)
    candidate["sequence"] = int(events[-1]["sequence"]) + 1 if events else 1
    return _validate_fetch_events([*events, candidate])


@contextmanager
def manifest_lock(path: Path) -> Iterator[None]:
    """Serialize manifest read-modify-write transactions across processes."""
    path.parent.mkdir(parents=True, exist_ok=True)
    lock_path = path.with_name(f"{path.name}.lock")
    with lock_path.open("a", encoding="utf-8") as lock_file:
        fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(lock_file.fileno(), fcntl.LOCK_UN)


def save_manifest(
    path: Path,
    records: list[ManifestRecord],
    *,
    events: list[FetchEvent],
) -> None:
    """Atomically write canonical records with their explicit event history."""
    payload: JSONValue = {
        "schema_version": MANIFEST_SCHEMA_VERSION,
        "records": records,
        "fetch_events": _validate_fetch_events(events),
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    serialized = json.dumps(payload, indent=2, ensure_ascii=False) + "\n"
    descriptor, temporary_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as temporary:
            temporary.write(serialized)
            temporary.flush()
            os.fsync(temporary.fileno())
        os.replace(temporary_name, path)
    finally:
        if os.path.exists(temporary_name):
            os.unlink(temporary_name)


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
