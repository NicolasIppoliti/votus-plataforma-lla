"""Runtime entrypoint for the ETL pipeline (task 12a).

Before this module existed, `tasks.md`'s own work-unit table already
promised four runtime harnesses that no numbered task ever built:

    uv run python -m etl fetch --source <id>
    uv run python -m etl ingest --source <id> --database-url <dsn> --year <y> --round <r>
    uv run python -m etl validate-crosswalk
    uv run python -m etl validate-curated

This is where they actually live. Every public function below is
independently testable with fakes -- `fetch_source`/`ingest_source` accept
an injected `Fetcher`/database URL rather than reaching for a real network
or connection themselves, so `tests/test_cli.py` never needs a subprocess.

Exit codes: 0 on success, non-zero on any argument or validation failure.
"""

from __future__ import annotations

import argparse
import contextlib
import csv
import io
import json
import os
import sys
import tempfile
import uuid
import zipfile
from collections.abc import Iterable, Iterator, Mapping
from dataclasses import dataclass, replace
from datetime import UTC, datetime
from pathlib import Path
from typing import TextIO

import psycopg
import yaml

from .archive import (
    ArchiveIntegrityError,
    ArchiveResult,
    Fetcher,
    FetchResponse,
    archive_source,
    read_verified_archive,
)
from .crosswalk import (
    CURATED_NAME_TABLE_SCOPE,
    OFFICIAL_AGRUPACION_NAME_BY_COLUMN,
    CrosswalkTable,
    FiscalizacionMesaRow,
    IncompleteOfficialMesaError,
    MesaStability,
    OfficialMesaVotes,
    QuarantinedJurisdiction,
    compute_mesa_stability,
    join_fiscalizacion_identity,
    load_crosswalk,
)
from .db import (
    CuratedReplacementSummary,
    archive_entry_from_evidence,
    insert_review_items,
    load_crosswalk_rows,
    load_party_map_rows,
    project_archive_entry,
    upsert_category,
    upsert_election,
)
from .http_client import (
    RequestsFetcher,
    RobotsTxtAppearedError,
    check_robots_txt_still_absent,
)
from .ingest.fiscalizacion import (
    FISCALIZACION_CATEGORY,
    FISCALIZACION_DISTRITO,
    FISCALIZACION_SECCION,
    FiscalizacionRow,
    FiscalizacionSchemaError,
    FiscalizacionUploadForbiddenError,
    QuarantinedFiscalizacionRow,
    guard_local_mirror_only,
    ingest_fiscalizacion,
)
from .ingest.national import (
    REQUIRED_COLUMNS,
    REQUIRED_ESTABLECIMIENTO_COLUMNS,
    NationalSchemaError,
    extract_raw_mesa_identities_from_text,
    iter_national_rows,
    load_national_rows,
    validate_mesa_tipo,
)
from .ingest.pba import (
    PbaSchemaError,
    ingest_pba,
    load_pba_rows,
    pba_parser_quarantine_review_kind,
)
from .ingest_metrics import IngestMetrics, MetricsReportError, metrics_report
from .jurisdiction import (
    is_canonicalizable_circuito_code,
    is_canonicalizable_code,
    normalize_circuito_code,
    normalize_distrito_code,
    normalize_seccion_code,
)
from .manifest import (
    DuplicateManifestRecordError,
    FetchEventConflictError,
    MalformedManifestError,
    append_fetch_event,
    canonical_record,
    fetch_event,
    latest_ok_record,
    load_fetch_events,
    load_manifest,
    manifest_lock,
    normalized_fetch_evidence,
    save_manifest,
    upsert_record,
)
from .numeric import parse_source_int
from .party_map import PartyMappingTable, UnmappedListId, load_party_map
from .review_item import (
    ReviewItemContext,
    ReviewItemRecord,
    ReviewItemSectionScope,
    mesa_divergences_to_review_items,
    review_item_draft_to_record,
    review_scope_breakdown,
    source_archive_identity,
    source_refetch_review_items,
    validate_prior_source_identity,
)
from .storage import LocalArchiveStore, extract_zip_safely, sha256_of

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
DEFAULT_SOURCES_PATH = REPO_ROOT / "etl" / "sources.yaml"
DEFAULT_LOCAL_ROOT = REPO_ROOT / "archive"
DEFAULT_MANIFEST_PATH = REPO_ROOT / "archive-manifest.json"
DEFAULT_CROSSWALK_PATH = REPO_ROOT / "curated" / "crosswalk.yaml"
DEFAULT_PARTY_MAP_PATH = REPO_ROOT / "curated" / "party_map.yaml"
SUPPORTED_SOURCE_CAPABILITIES = frozenset({"national", "pba", "fiscalizacion", "geography"})

# Never a hardcoded fallback DSN -- see `resolve_database_url` (task 12.6).
DATABASE_URL_ENV_VAR = "ETL_DATABASE_URL"


class AmbiguousSourceError(ValueError):
    """Raised when one `--source` id is registered under several capabilities.

    Split out from `UnknownSourceError`: the id EXISTS, which is the opposite
    of what that name says, and the capability it resolves to selects the
    ingest branch.
    """


class MalformedManifestRecordError(ValueError):
    """Raised when an archive record is present but unusable — no
    `archived_path` to read.

    Split out from `UnknownSourceError` for the same reason: the source is
    registered and archived, so a name saying it is unknown sends the operator
    to the wrong file.
    """


class SourcesValidationError(ValueError):
    """Raised when ``sources.yaml`` is not a capability-to-entry-list mapping."""


class SourceElectionValidationError(ValueError):
    """Raised when an ingest request does not match its registered election."""


class PbaIngestMimeValidationError(ValueError):
    """Raised when a registered PBA source is archival reference material only."""


class UnknownSourceError(ValueError):
    """Raised when `--source` names no entry in `sources.yaml`.

    Per task 12.2: an unrecognized source id is always an error, never a
    silent no-op.
    """


class LocalFileValidationError(ValueError):
    """Raised when fetch local-file arguments do not match the source transport."""


class MissingDatabaseUrlError(RuntimeError):
    """Raised by `ingest` when no explicit database URL is available.

    `ingest` MUST NEVER silently fall back to a default DSN (task 12.6) --
    unlike a developer's local Postgres, a guessed default is exactly how a
    write could land through an unintended, more privileged connection.
    """


# ---------------------------------------------------------------------------
# Shared source lookup
# ---------------------------------------------------------------------------


def load_sources(path: Path = DEFAULT_SOURCES_PATH) -> dict[str, list[dict]]:
    """Load and minimally validate ``sources.yaml`` at its trust boundary."""
    loaded = yaml.safe_load(path.read_text(encoding="utf-8"))
    if loaded is None:
        return {}
    if not isinstance(loaded, Mapping):
        raise SourcesValidationError("sources.yaml top level must be a mapping")

    sources: dict[str, list[dict]] = {}
    for capability, entries in loaded.items():
        if not isinstance(capability, str):
            raise SourcesValidationError("sources.yaml capability names must be strings")
        if capability not in SUPPORTED_SOURCE_CAPABILITIES:
            raise SourcesValidationError(
                f"sources.yaml capability {capability!r} is unsupported; expected one of "
                f"{sorted(SUPPORTED_SOURCE_CAPABILITIES)}"
            )
        if not isinstance(entries, list):
            raise SourcesValidationError(
                f"sources.yaml capability {capability!r} must contain a list of entries"
            )
        for index, entry in enumerate(entries):
            if not isinstance(entry, Mapping):
                raise SourcesValidationError(
                    f"sources.yaml capability {capability!r} entry {index} must be a mapping"
                )
            source_id = entry.get("id")
            if not isinstance(source_id, str) or not source_id.strip():
                raise SourcesValidationError(
                    f"sources.yaml capability {capability!r} entry {index} id "
                    "must be a non-empty string"
                )
            source = entry.get("source")
            if not isinstance(source, str) or not source.strip():
                raise SourcesValidationError(
                    f"sources.yaml capability {capability!r} entry {index} source "
                    "must be a non-empty string"
                )
            source_url = entry.get("source_url")
            if not isinstance(source_url, str) or not source_url.strip():
                raise SourcesValidationError(
                    f"sources.yaml capability {capability!r} entry {index} source_url "
                    "must be a non-empty string"
                )
            mime = entry.get("mime")
            if not isinstance(mime, str) or not mime.strip():
                raise SourcesValidationError(
                    f"sources.yaml capability {capability!r} entry {index} mime "
                    "must be a non-empty string"
                )
            if not isinstance(entry.get("notes"), str):
                raise SourcesValidationError(
                    f"sources.yaml capability {capability!r} entry {index} notes must be a string"
                )
            if capability == "fiscalizacion":
                if entry.get("source_kind") != "fiscalizacion":
                    raise SourcesValidationError(
                        f"sources.yaml capability {capability!r} entry {index} source_kind "
                        "must be exactly 'fiscalizacion'"
                    )
                if entry.get("upload") != "never":
                    raise SourcesValidationError(
                        f"sources.yaml capability {capability!r} entry {index} upload "
                        "must be exactly 'never'"
                    )
            if capability == "geography":
                if "election_year" in entry or "election_round" in entry:
                    raise SourcesValidationError("geography entries must be election-free")
                continue
            try:
                registered_source_election(entry)
            except SourcesValidationError as exc:
                raise SourcesValidationError(
                    f"sources.yaml capability {capability!r} entry {index}: {exc}"
                ) from exc
        sources[capability] = list(entries)
    return sources


def find_source_entry(sources: dict[str, list[dict]], source_id: str) -> dict | None:
    """Find one entry by `id` across every capability family, or `None`."""
    # EVERY match, then refuse if there are two: the returned `capability`
    # selects the ingest branch, so an id registered under two families routed
    # to whichever `sources.yaml` happened to list first --
    # `resolve_national_results_bytes` refuses the same shape for ZIP members.
    matches = [
        {**entry, "capability": capability}
        for capability, entries in sources.items()
        for entry in entries
        if entry["id"] == source_id
    ]
    if len(matches) > 1:
        raise AmbiguousSourceError(
            f"{source_id!r} is registered under {len(matches)} capabilities "
            f"({', '.join(sorted(m['capability'] for m in matches))}); refusing to pick one"
        )
    return matches[0] if matches else None


# ---------------------------------------------------------------------------
# fetch
# ---------------------------------------------------------------------------


def fetch_source(
    source_id: str,
    *,
    sources: dict[str, list[dict]],
    fetcher: Fetcher,
    local_root: Path,
    manifest_path: Path,
    local_file: Path | None = None,
    invocation_id: str | None = None,
) -> ArchiveResult:
    """Archive one registered source by id.

    Raises `UnknownSourceError` for an unregistered id (task 12.2) --
    never a silent no-op.
    """
    entry = find_source_entry(sources, source_id)
    if entry is None:
        raise UnknownSourceError(f"no registered source with id {source_id!r}")

    # The guard runs BEFORE anything is fetched or written. It was defined and
    # unit-tested in phase 6 but had no call site anywhere in production code,
    # so the single personal-data-bearing source in this project was protected
    # only by a test that read the YAML -- not by the code path that acts on it.
    # A fiscalización entry that loses its `upload: never` declaration now fails
    # here, before its bytes exist on disk.
    guard_local_mirror_only(entry)
    event_id = str(uuid.uuid4()) if invocation_id is None else invocation_id
    if not isinstance(event_id, str) or not event_id.strip():
        raise ValueError("fetch invocation id must be a non-empty opaque string")
    event_id = event_id.strip()
    invoked_at = datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")

    source_url = entry.get("source_url")
    is_local_source = isinstance(source_url, str) and source_url.startswith("local://")
    local_bytes: bytes | None = None
    if is_local_source:
        if local_file is None:
            raise LocalFileValidationError(f"local source {source_id!r} requires --local-file")
        if not local_file.is_file():
            raise LocalFileValidationError(
                f"local source {source_id!r} requires a regular readable file"
            )
        try:
            local_bytes = local_file.read_bytes()
        except OSError as exc:
            raise LocalFileValidationError(
                f"local source {source_id!r} requires a regular readable file"
            ) from exc
    elif local_file is not None:
        raise LocalFileValidationError(
            f"--local-file is only valid for local:// sources, not {source_id!r}"
        )

    pba_fetcher = None

    if entry.get("capability") == "pba":
        # THROUGH D10's etiquette. `archive_pba_source` was implemented and
        # tested with no production caller, so the archive-first cache and the
        # bounded-backoff wrapper around the policed fetcher never ran for a
        # real PBA fetch: this CLI hit the host directly, every time, however
        # many times.
        from etl.http_client import PolicedHostFetcher

        from .ingest.pba import PBA_HOST_POLICY

        # Re-check on EVERY invocation, including an archive-cache hit. A newly
        # published robots.txt is a policy change, so it must halt before source
        # access or any archive/manifest mutation.
        check_robots_txt_still_absent(fetcher, PBA_HOST_POLICY.host)
        pba_fetcher = PolicedHostFetcher(fetcher, PBA_HOST_POLICY)

    local_store = LocalArchiveStore(root=local_root)
    staged_artifacts: dict[tuple[str, str], bytes] = {}

    class StagedArchiveStore:
        root = local_store.root

        def path_for(self, capability: str, filename: str) -> Path:
            return local_store.path_for(capability, filename)

        def exists(self, capability: str, filename: str) -> bool:
            return (capability, filename) in staged_artifacts or local_store.exists(
                capability, filename
            )

        def read(self, capability: str, filename: str) -> bytes:
            staged = staged_artifacts.get((capability, filename))
            return staged if staged is not None else local_store.read(capability, filename)

        def write(self, capability: str, filename: str, data: bytes) -> Path:
            target = local_store.path_for(capability, filename)
            staged_artifacts[(capability, filename)] = data
            return target

    staged_store = StagedArchiveStore()

    def promote_staged_artifacts(protected_paths: set[str]) -> list[tuple[Path, str]]:
        promoted: list[tuple[Path, str]] = []
        for (capability, filename), data in staged_artifacts.items():
            target = local_store.path_for(capability, filename)
            target.parent.mkdir(parents=True, exist_ok=True)
            digest = sha256_of(data)
            if target.exists():
                existing_digest = sha256_of(target.read_bytes())
                if existing_digest != digest:
                    raise ArchiveIntegrityError(
                        f"archive target {filename!r} claims sha256 {digest} but contains "
                        f"bytes with sha256 {existing_digest}; refusing to overwrite"
                    )
                continue
            descriptor, temporary_name = tempfile.mkstemp(
                prefix=f".{target.name}.", dir=target.parent
            )
            try:
                with os.fdopen(descriptor, "wb") as temporary:
                    temporary.write(data)
                    temporary.flush()
                    os.fsync(temporary.fileno())
                try:
                    os.link(temporary_name, target)
                    archive_path = f"{local_store.root.name}/{capability}/{filename}"
                    if archive_path not in protected_paths:
                        promoted.append((target, digest))
                except FileExistsError:
                    existing_digest = sha256_of(target.read_bytes())
                    if existing_digest != digest:
                        raise ArchiveIntegrityError(
                            f"archive target {filename!r} claims sha256 {digest} but contains "
                            f"bytes with sha256 {existing_digest}; refusing to overwrite"
                        )
            finally:
                if os.path.exists(temporary_name):
                    os.unlink(temporary_name)
        return promoted

    records = load_manifest(manifest_path)
    previous = canonical_record(records, source_id)
    identity = source_archive_identity(entry)
    # Identity is known before transport. Refuse a canonical id that changed
    # election, round, or kind before writing another immutable archive file.
    validate_prior_source_identity(previous, identity)
    verified_previous = (
        previous if previous is not None and previous.get("status") == "ok" else None
    )
    if entry.get("capability") == "pba":
        from .ingest.pba import archive_pba_source

        if pba_fetcher is None:
            raise RuntimeError("PBA fetcher initialization failed")
        # The POLICED fetcher, not the bare one: `archive_pba_source` wraps it
        # in bounded backoff, and `PolicedHostFetcher` is what enforces the path
        # allowlist, the serial cap and the minimum delay. Passing the raw
        # fetcher would have kept the etiquette layer inert in a different way.
        result = archive_pba_source(
            entry,
            fetcher=pba_fetcher,
            local_store=staged_store,
            records=records,
        )
    elif local_bytes is not None:
        local_payload: bytes = local_bytes

        class LocalBytesFetcher:
            def get(self, url: str, *, timeout: float, headers: dict[str, str]) -> FetchResponse:
                if url != source_url:
                    raise LocalFileValidationError("local archive transport mismatch")
                return FetchResponse(status_code=200, content=local_payload, headers={})

        result = archive_source(
            entry,
            fetcher=LocalBytesFetcher(),
            local_store=staged_store,
        )
    else:
        result = archive_source(entry, fetcher=fetcher, local_store=staged_store)

    record = dict(result.record)
    if identity is not None:
        record.update(identity.manifest_fields())
    with manifest_lock(manifest_path):
        records = load_manifest(manifest_path)
        events = load_fetch_events(manifest_path)
        prior_event = fetch_event(events, event_id)
        if prior_event is not None:
            if prior_event.get("source_id") != source_id:
                raise FetchEventConflictError(
                    f"fetch invocation {event_id!r} already belongs to another source"
                )
            prior_record = prior_event.get("record")
            if not isinstance(prior_record, dict):
                raise MalformedManifestError(f"fetch event {event_id!r} has no usable record")
            if normalized_fetch_evidence(prior_record) != normalized_fetch_evidence(record):
                raise FetchEventConflictError(
                    f"fetch invocation {event_id!r} conflicts with its recorded evidence"
                )
            promote_staged_artifacts({str(prior_record.get("archived_path"))})
            return replace(result, record=prior_record, review_items=())
        protected_paths = {
            str(item.get("archived_path"))
            for item in [*records, *(event["record"] for event in events)]
            if item.get("archived_path") is not None
        }
        previous = canonical_record(records, source_id)
        validate_prior_source_identity(previous, identity)
        verified_previous = (
            previous if previous is not None and previous.get("status") == "ok" else None
        )
        review_items = source_refetch_review_items(verified_previous, record, identity)
        drift_label = (
            "source re-export"
            if any(item.kind == "source_reexported" for item in review_items)
            else "content drift"
        )
        classification = "fetch_error"
        if record.get("status") == "ok":
            if verified_previous is None:
                classification = "initial"
            elif verified_previous.get("sha256") == record.get("sha256"):
                classification = "identical"
            elif any(item.kind == "source_reexported" for item in review_items):
                classification = "source_reexported"
            else:
                classification = "content_drift"
        records = upsert_record(records, record, drift_label=drift_label)
        events = append_fetch_event(
            events,
            {
                "event_id": event_id,
                "sequence": 0,
                "source_id": source_id,
                "fetched_at": invoked_at,
                "status": str(record["status"]),
                "classification": classification,
                "record": record,
            },
        )
        promoted = promote_staged_artifacts(protected_paths)
        try:
            save_manifest(manifest_path, records, events=events)
        except Exception as save_error:
            rollback_errors: list[Exception] = []
            for target, digest in promoted:
                try:
                    actual_digest = sha256_of(target.read_bytes())
                    if actual_digest != digest:
                        raise ArchiveIntegrityError(f"rollback sha256 mismatch for {target.name!r}")
                    target.unlink()
                except Exception as rollback_error:
                    rollback_errors.append(rollback_error)
            if rollback_errors:
                raise ExceptionGroup(
                    "manifest persistence and artifact rollback both failed",
                    [save_error, *rollback_errors],
                )
            raise
    return replace(result, record=record, review_items=review_items)


def cmd_fetch(args: argparse.Namespace) -> int:
    sources = load_sources(Path(args.sources_path))
    try:
        result = fetch_source(
            args.source,
            sources=sources,
            fetcher=RequestsFetcher(),
            local_root=Path(args.local_root),
            manifest_path=Path(args.manifest_path),
            local_file=Path(args.local_file) if args.local_file is not None else None,
            invocation_id=args.invocation_id,
        )
    except (
        UnknownSourceError,
        AmbiguousSourceError,
        DuplicateManifestRecordError,
        FetchEventConflictError,
        MalformedManifestError,
        MalformedManifestRecordError,
        FiscalizacionUploadForbiddenError,
        LocalFileValidationError,
        RobotsTxtAppearedError,
    ) as exc:
        # The personal-data guard is the one failure an operator is MOST likely
        # to hit by accident, and it was the only one exiting with a traceback
        # instead of an exit code.
        print(f"error: {exc}", file=sys.stderr)
        return 1

    if result.record["status"] != "ok":
        print(f"error: fetch failed for {args.source!r}: {result.record['notes']}", file=sys.stderr)
        return 1

    if result.review_items:
        counts: dict[tuple[str, str], int] = {}
        for item in result.review_items:
            key = (item.kind, item.severity)
            counts[key] = counts.get(key, 0) + 1
        print("review items by reason:", file=sys.stderr)
        for (kind, severity), count in sorted(counts.items()):
            print(f"  {kind} ({severity}): {count} review item(s)", file=sys.stderr)

    print(f"archived {args.source} -> {result.record['archived_path']}")
    return 0


def cmd_validate_partido_geometry(args: argparse.Namespace) -> int:
    from .partido_geometry import inspect_partido_geometry, rejected_geometry

    entry = find_source_entry(load_sources(Path(args.sources_path)), args.source)
    if entry is None:
        raise UnknownSourceError(f"no registered source with id {args.source!r}")
    record = latest_ok_record(load_manifest(Path(args.manifest_path)), args.source)
    if record is None:
        print(json.dumps(rejected_geometry(entry, {}, "missing_snapshot"), sort_keys=True))
        return 1
    if entry["capability"] != "geography" or entry.get("reference_kind") != "partido_geometry":
        reason = ("unsupported_capability" if entry["capability"] != "geography"
                  else "unsupported_reference_kind")
        print(json.dumps(rejected_geometry(entry, record, reason), sort_keys=True))
        return 1
    try:
        payload = read_archived_source(
            entry, manifest_record=record, capability=entry["capability"],
            local_store=LocalArchiveStore(root=Path(args.local_root)),
            filename=archived_filename(record, source_id=args.source),
        )
    except ArchiveIntegrityError:
        result = rejected_geometry(entry, record, "archive_integrity")
    else:
        result = inspect_partido_geometry(
            payload, entry, record, load_crosswalk(DEFAULT_CROSSWALK_PATH)
        )
    print(json.dumps(result, sort_keys=True))
    return 0 if result["counts"]["accepted"] == 1 else 1


def cmd_archive_history(args: argparse.Namespace) -> int:
    try:
        events = load_fetch_events(Path(args.manifest_path), args.source)
    except MalformedManifestError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    status_counts: dict[str, int] = {}
    classification_counts: dict[str, int] = {}
    for event in events:
        status = str(event["status"])
        classification = str(event["classification"])
        status_counts[status] = status_counts.get(status, 0) + 1
        classification_counts[classification] = classification_counts.get(classification, 0) + 1
        print(
            f"{event['sequence']} {event['event_id']} {event['fetched_at']} "
            f"{event['source_id']} {status} {classification}"
        )
    for status, count in sorted(status_counts.items()):
        print(f"status {status}: {count}")
    for classification, count in sorted(classification_counts.items()):
        print(f"classification {classification}: {count}")
    return 0


# ---------------------------------------------------------------------------
# ingest
# ---------------------------------------------------------------------------


def resolve_database_url(explicit: str | None) -> str:
    """Resolve the database URL from `--database-url` or the
    `ETL_DATABASE_URL` env var. Never falls back to a hardcoded DSN
    (task 12.6) -- absence of both is a hard error, not a guess.
    """
    url = explicit or os.environ.get(DATABASE_URL_ENV_VAR)
    if not url:
        raise MissingDatabaseUrlError(
            "ingest requires an explicit database URL (--database-url or "
            f"${DATABASE_URL_ENV_VAR}); refusing to silently default to a "
            "superuser connection"
        )
    return url


@dataclass(frozen=True)
class NationalArchiveCsvs:
    results: bytes
    establecimientos: bytes | None


@dataclass(frozen=True)
class NationalArchivePaths:
    """Which extracted members carry the national schema, before any read.

    `results is None` marks the bare-CSV passthrough: `raw_bytes` was not a
    ZIP at all, so there is no member on disk to point at.
    """

    results: Path | None
    establecimientos: Path | None


def resolve_national_archive_csvs(raw_bytes: bytes, *, extract_dir: Path) -> NationalArchiveCsvs:
    """Read the members `resolve_national_archive_paths` selected, fully.

    Kept as the bytes-returning face of one selection: every call site that
    parses after `extract_dir` is gone depends on being handed data rather
    than a view into a directory that no longer exists. Callers that can
    consume the member as a stream should use `national_results_text`
    instead -- the 2023 PASO member is 3,76 GB and does not belong in memory.
    """
    paths = resolve_national_archive_paths(raw_bytes, extract_dir=extract_dir)
    if paths.results is None:
        return NationalArchiveCsvs(results=raw_bytes, establecimientos=None)
    return NationalArchiveCsvs(
        results=paths.results.read_bytes(),
        establecimientos=(
            paths.establecimientos.read_bytes() if paths.establecimientos is not None else None
        ),
    )


def resolve_national_archive_paths(raw_bytes: bytes, *, extract_dir: Path) -> NationalArchivePaths:
    """Select the results and optional establecimiento CSV members, without reading them.

    A registered national source is archived as a ZIP (`sources.yaml`),
    with the results file's own name differing across years
    (`resultados2025.csv` in 2025, `ResultadosElectorales.csv` in 2023) and
    packaged alongside unrelated CSVs (`ambitosElectorales.csv`,
    `localesDeVotacionyMesas.csv`). Rather than hardcode either filename,
    this extracts the whole archive (`storage.extract_zip_safely`, the
    same safe-extraction path `tests/test_ingest_national.py` already
    exercises) and picks the one CSV member whose header declares every
    column `ingest.national.REQUIRED_COLUMNS` needs, plus at most one member
    matching the measured 2025 establecimiento companion shape.

    `raw_bytes` that is not a ZIP at all (a bare CSV, e.g. a test fixture)
    passes through unchanged.
    """
    if not zipfile.is_zipfile(io.BytesIO(raw_bytes)):
        return NationalArchivePaths(results=None, establecimientos=None)

    extracted = extract_zip_safely(raw_bytes, extract_dir)
    # Every member and why it was rejected. The raise below used to name the
    # columns it wanted and nothing about what it looked at, so a renamed
    # column or a `.txt` export produced a schema verdict with no way to see
    # that the file was there all along.
    rejected: list[tuple[str, str]] = []
    matches: list[Path] = []
    establecimiento_matches: list[Path] = []
    for path in extracted:
        if path.suffix.lower() != ".csv":
            rejected.append((path.name, "not a .csv member"))
            continue
        # `utf-8-sig`, not `utf-8`: a BOM would make the first field
        # `"\ufeffdistrito_id"`, the field-set check fail, and a perfectly
        # valid national CSV raise `NationalResultsCsvNotFoundError`. The
        # committed 2023/2025 files carry no BOM; the next export may.
        #
        # And NOT `errors="ignore"`: dropping an undecodable byte can eat a
        # character out of `distrito_id`, after which this reports "no member
        # matches the expected schema" -- a schema verdict on what is really an
        # encoding failure. A member that will not decode is skipped as such.
        try:
            with path.open("r", encoding="utf-8-sig") as handle:
                header_fields = set(next(csv.reader(handle), []))
        except UnicodeDecodeError as exc:
            rejected.append((path.name, f"not valid UTF-8 ({exc.reason})"))
            continue
        # PARSED field names, not a substring scan of the raw header line:
        # `"mesa_id" in header` is also true for a file whose only mesa column
        # is `mesa_id_original`, and the 2023 and 2025 files already differ in
        # shape, so the next one will too.
        if set(REQUIRED_COLUMNS) <= header_fields:
            matches.append(path)
            continue
        if set(REQUIRED_ESTABLECIMIENTO_COLUMNS) <= header_fields:
            establecimiento_matches.append(path)
            continue
        missing = sorted(set(REQUIRED_COLUMNS) - header_fields)
        rejected.append((path.name, f"header lacks {', '.join(missing)}"))

    # EVERY match, then refuse if there are two. Returning the first was a
    # silent pick between a re-export and the original, or between a full file
    # and a partial slice -- and `collapse()` in this same module refuses
    # rather than choose between two tallies for one key.
    def report_rejected() -> None:
        # ONE report, used by all three exits. It ran on the no-match path
        # only, so a member rejected as "not valid UTF-8" -- the exact
        # encoding-versus-schema misdiagnosis this function exists to prevent
        # -- vanished whenever another member matched; then a copy was
        # inlined into the two-match branch, which made two ideas of one
        # report, the shape this file refuses everywhere else.
        for name, reason in rejected:
            print(f"  {name}: {reason}", file=sys.stderr)

    if len(matches) > 1:
        report_rejected()
        raise NationalResultsCsvNotFoundError(
            f"{len(matches)} members of the archived ZIP declare the national results "
            f"schema ({', '.join(sorted(p.name for p in matches))}); refusing to pick one"
        )
    if len(establecimiento_matches) > 1:
        report_rejected()
        raise NationalResultsCsvNotFoundError(
            f"{len(establecimiento_matches)} members of the archived ZIP declare the national "
            "establecimiento companion schema "
            f"({', '.join(sorted(p.name for p in establecimiento_matches))}); refusing to pick one"
        )
    if matches:
        if rejected:
            print(
                f"  selected {matches[0].name}; {len(rejected)} other member(s) were "
                "examined and not used:",
                file=sys.stderr,
            )
            report_rejected()
        return NationalArchivePaths(
            results=matches[0],
            establecimientos=(establecimiento_matches[0] if establecimiento_matches else None),
        )

    report_rejected()
    raise NationalResultsCsvNotFoundError(
        f"no member of the archived ZIP matches the expected national results "
        f"schema (looked for columns: {', '.join(REQUIRED_COLUMNS)}); "
        f"examined {len(rejected)} member(s), each reported above"
    )


def resolve_national_results_bytes(raw_bytes: bytes, *, extract_dir: Path) -> bytes:
    """Return only the results member for result-only validation call sites."""
    return resolve_national_archive_csvs(raw_bytes, extract_dir=extract_dir).results


class NationalResultsCsvNotFoundError(ValueError):
    """Raised when a ZIP-archived national source has no member whose
    header matches `ingest.national.REQUIRED_COLUMNS` (task 12d)."""


def archived_filename(record: dict, *, source_id: str) -> str:
    """The local mirror filename an archive record points at.

    One derivation, not seven. A record with no `archived_path` used to yield
    `""` and die inside `LocalArchiveStore.read` with a message about a missing
    file rather than about a malformed manifest entry.
    """
    archived_path = record.get("archived_path") or ""
    if not archived_path:
        raise MalformedManifestRecordError(
            f"the archive record for {source_id!r} declares no `archived_path`"
        )
    return archived_path.rsplit("/", 1)[-1]


def read_archived_source(
    entry: dict,
    *,
    manifest_record: dict,
    capability: str,
    local_store: LocalArchiveStore,
    filename: str,
) -> bytes:
    """Read one archived source's bytes THROUGH the personal-data guard.

    The guard has to sit on every read path, not on the one that happens to be
    remembered: `fetch_source` ran it, `cmd_validate_fiscalizacion` ran it, and
    `ingest_source` read the same archived copy without it -- so an entry that
    lost `upload: never` was still ingestible. This is the single boundary all
    three now go through.
    """
    guard_local_mirror_only(entry)
    return read_verified_archive(
        local_store,
        capability=capability,
        filename=filename,
        expected_sha256=manifest_record.get("sha256"),
    )


def ingest_source(
    source_id: str,
    *,
    database_url: str | None,
    year: int,
    round_: str,
    sources: dict[str, list[dict]],
    local_root: Path,
    manifest_path: Path,
    party_map_path: Path = DEFAULT_PARTY_MAP_PATH,
    crosswalk_path: Path = DEFAULT_CROSSWALK_PATH,
    metrics: IngestMetrics | None = None,
) -> int:
    """Load one already-archived source's parsed rows into `result_row`.

    The registered election is validated before archive or database access, so
    an operator cannot ingest immutable bytes under a different election label.
    """
    entry = find_source_entry(sources, source_id)
    if entry is None:
        raise UnknownSourceError(f"no registered source with id {source_id!r}")
    capability = entry["capability"]
    if metrics is not None:
        if capability != "national" or entry.get("source_kind", "official") != "official":
            raise ValueError("metrics require national official ingestion")
        registered_year, registered_round = registered_source_election(entry)
        metrics.data["scope"] = {
            "source_id": source_id,
            "year": registered_year,
            "round": registered_round,
            "capability": "national",
            "source_kind": "official",
        }
    resolved_url: str | None = None
    if capability != "pba":
        resolved_url = resolve_database_url(database_url)

    records = load_manifest(manifest_path)
    archived = latest_ok_record(records, source_id)
    if archived is None:
        raise UnknownSourceError(
            f"no archived copy of {source_id!r} -- run `fetch --source {source_id}` first"
        )

    registered_year, registered_round = registered_source_election(entry)
    if registered_year != year or registered_round != round_:
        raise SourceElectionValidationError(
            f"source {source_id!r} expected election "
            f"{registered_year}/{registered_round}; received {year}/{round_}"
        )
    if capability == "pba":
        if entry.get("mime") != "text/html":
            raise PbaIngestMimeValidationError(
                f"PBA source {source_id!r} has MIME {entry.get('mime')!r}; ingest requires "
                "exactly 'text/html' (other registered formats are archival references only)"
            )
        resolved_url = resolve_database_url(database_url)

    local_store = LocalArchiveStore(root=local_root)
    filename = archived_filename(archived, source_id=entry["id"])
    raw_bytes = read_archived_source(
        entry,
        manifest_record=archived,
        capability=capability,
        local_store=local_store,
        filename=filename,
    )

    if resolved_url is None:
        raise MissingDatabaseUrlError("database URL resolution produced no value")
    conn = psycopg.connect(resolved_url)
    try:
        project_archive_entry(conn, archive_entry_from_evidence(archived, entry))
        if capability == "national":
            with national_results_text(raw_bytes) as results_text:
                rows = iter_national_rows(
                    results_text,
                    archive_entry_id=source_id,
                    election_year=registered_year,
                    election_round=registered_round,
                    establecimientos_csv_bytes=results_text.establecimientos_csv_bytes,
                    metrics=metrics,
                )
                inserted = load_national_rows(
                    conn,
                    rows,
                    year=year,
                    round_=round_,
                    archive_entry_id=source_id,
                )
        elif capability == "pba":
            parse_result = ingest_pba(raw_bytes, archive_entry_id=source_id)
            # The CALLER's crosswalk, not a hardcoded default: validating
            # against a candidate file and then ingesting against a different
            # one silently breaks the guarantee `validate-crosswalk` gives.
            crosswalk = load_crosswalk(crosswalk_path)
            inserted = load_pba_rows(
                conn,
                list(parse_result.rows),
                year=year,
                round_=round_,
                crosswalk=crosswalk,
                archive_entry_id=source_id,
            )

            # Parser quarantine is operational data, not stderr. Persist one
            # review item per semantic quarantine group while retaining every
            # source-row index and only safe vote evidence.
            quarantine_records = []
            for quarantined in parse_result.quarantined:
                evidence = [
                    "source rows "
                    + ", ".join(str(index) for index in quarantined.source_row_indices)
                ]
                if quarantined.rows:
                    evidence.append(
                        "votes " + ", ".join(str(row.votes) for row in quarantined.rows)
                    )
                if quarantined.raw_cell_shapes:
                    evidence.append("raw cell shapes " + ", ".join(quarantined.raw_cell_shapes))
                quarantine_records.append(
                    ReviewItemRecord(
                        kind=pba_parser_quarantine_review_kind(quarantined.reason),
                        severity="warning",
                        subject_ref=(
                            f"{source_id} {year}-{round_} distrito:{quarantined.distrito} "
                            f"category:{quarantined.category} "
                            f"list:{quarantined.list_id or '(none)'}"
                        ),
                        note="; ".join(evidence),
                    )
                )
            recorded_review_items = insert_review_items(conn, quarantine_records)
            scope_counts = review_scope_breakdown(quarantine_records)
            print(
                "PBA review scope: "
                f"section_scoped={scope_counts['section_scoped']}, "
                f"platform_only={scope_counts['platform_only']}",
                file=sys.stderr,
            )
            if parse_result.quarantined:
                reason_counts: dict[str, int] = {}
                for quarantined in parse_result.quarantined:
                    reason_counts[quarantined.reason] = reason_counts.get(quarantined.reason, 0) + 1
                print(
                    f"PBA parser quarantine: {len(parse_result.quarantined)} group(s), "
                    f"{recorded_review_items} review item(s) recorded -- "
                    + "; ".join(
                        f"{reason}: {count}" for reason, count in sorted(reason_counts.items())
                    ),
                    file=sys.stderr,
                )
        elif capability == "fiscalizacion":
            # Imported lazily: `load_fiscalizacion_rows` lands in sub-unit 12b,
            # chained on top of this one -- 12a's own tests never exercise the
            # fiscalización capability, so the module must still import cleanly
            # before 12b's function exists.
            from .ingest.fiscalizacion import load_fiscalizacion_rows

            party_map = load_party_map(party_map_path)
            result = ingest_fiscalizacion(raw_bytes, archive_entry_id=source_id)
            load_result = load_fiscalizacion_rows(
                conn,
                result.rows,
                year=year,
                round_=round_,
                party_map=party_map,
                archive_entry_id=source_id,
            )
            inserted = load_result.inserted
            loader_review_items = load_result.review_items
            # Every draft this ingestion produced is PERSISTED here. Producing
            # them in memory and returning is the "correct, tested,
            # unreachable" shape: `insert_review_items` had no production
            # caller at all, so every collapsed duplicate and every blank vote
            # cell died with the process while `review_item.py` documented it
            # as "the only write path".
            # `subject_ref` is only `"mesa N"`, which is not unique across
            # sources. Scoping it by the archived source id is what makes the
            # dedupe below safe: without it, a SECOND fiscalización source
            # observing the same mesa number with the same note would have its
            # genuinely new observation discarded and reported as "already
            # present" -- a silent drop.
            # Scoped by source AND ELECTION. `subject_ref` carried the source
            # id alone, so ingesting the same sheet for `2025 paso` and then
            # `2025 generales` produced byte-identical rows: the second run's
            # genuinely new observations matched the first run's and were
            # dropped as "already present". Rule 10 names this exact shape --
            # a natural key omitting the election was a live corruption path.
            records = [
                replace(
                    review_item_draft_to_record(draft),
                    subject_ref=f"{source_id} {year}-{round_} {draft.subject_ref}",
                    section_scopes=(
                        ReviewItemSectionScope(FISCALIZACION_DISTRITO, FISCALIZACION_SECCION),
                    ),
                    contexts=(
                        ReviewItemContext(
                            "observed",
                            "fiscalizacion",
                            "available",
                            registered_year,
                            load_result.election_id,
                            load_result.category_id,
                            source_id,
                        ),
                    ),
                )
                # BOTH producers. The parser's drafts and the LOADER's — a mesa
                # whose circuito cannot be resolved is quarantined at load
                # time, and those drafts had no path out of the function at
                # all.
                for draft in [*result.review_items, *loader_review_items]
            ]
            # Submit every observation to the atomic write boundary. It owns
            # in-batch and active-observation dedupe, so a row resolved after an
            # earlier read can recur instead of being lost to a stale prefilter.
            recorded_review_items = insert_review_items(conn, records)

            # The quarantine, REPORTED. `ingest_fiscalizacion` produced these
            # and nothing read them, so every duplicate-conflict and
            # unmergeable-empty row died with the process while `load_pba_rows`
            # right next door reported its own. Per REASON, never one total: a
            # large plausible number is how the PASO quarantine discarded
            # 6.462.906 legitimate rows and looked fine doing it.
            if result.quarantined:
                by_reason: dict[str, list[QuarantinedFiscalizacionRow]] = {}
                for row in result.quarantined:
                    by_reason.setdefault(row.reason, []).append(row)
                print(
                    f"quarantined {len(result.quarantined)} fiscalización row(s), "
                    "not written to result_row:",
                    file=sys.stderr,
                )
                for reason, quarantined_rows in sorted(by_reason.items()):
                    named = sorted(r.mesa for r in quarantined_rows if r.mesa is not None)
                    # THE SOURCE ROW INDICES, which the quarantine record
                    # carries precisely so a human can find the line. Printed
                    # only the mesa numbers, `unreadable_mesa` and
                    # `unmergeable_empty_mesa` -- both `mesa=None` by
                    # construction -- rendered as a bare count, which this
                    # file elsewhere calls "visible and not actionable".
                    lines = sorted(i for r in quarantined_rows for i in r.source_row_indices)
                    print(
                        f"  {reason}: {len(quarantined_rows)} row(s)"
                        + (f", mesas {', '.join(str(m) for m in named)}" if named else "")
                        + (f", source row(s) {', '.join(str(i) for i in lines)}" if lines else ""),
                        file=sys.stderr,
                    )

            scope_counts = review_scope_breakdown(records)
            print(
                "  review scope: "
                f"section_scoped={scope_counts['section_scoped']}, "
                f"platform_only={scope_counts['platform_only']}",
                file=sys.stderr,
            )
            print(
                f"  review items: {recorded_review_items} recorded, "
                f"{len(records) - recorded_review_items} not recorded",
                file=sys.stderr,
            )
        else:
            raise UnknownSourceError(f"unsupported capability {capability!r} for ingest")
        conn.commit()
        if metrics is not None:
            metrics.data["commit_returned"] = True
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
    return inserted


def cmd_ingest(args: argparse.Namespace) -> int:
    if getattr(args, "metrics_output", None) is None:
        return _cmd_ingest(args)
    try:
        with metrics_report(
            Path(args.metrics_output),
            archive_root=Path(args.local_root),
            protected=tuple(
                Path(path)
                for path in (
                    args.sources_path,
                    args.manifest_path,
                    args.crosswalk_path,
                    args.party_map_path,
                )
            ),
        ) as metrics:
            return _cmd_ingest(args, metrics)
    except MetricsReportError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1


def _cmd_ingest(args: argparse.Namespace, metrics: IngestMetrics | None = None) -> int:
    sources = load_sources(Path(args.sources_path))
    try:
        inserted = ingest_source(
            args.source,
            database_url=args.database_url,
            year=args.year,
            round_=args.round,
            sources=sources,
            local_root=Path(args.local_root),
            manifest_path=Path(args.manifest_path),
            crosswalk_path=Path(args.crosswalk_path),
            # Same reason as the crosswalk: validating against a candidate
            # party map and then ingesting against the repo default silently
            # breaks the guarantee `validate-curated` gives.
            party_map_path=Path(args.party_map_path),
            metrics=metrics,
        )
    except (
        UnknownSourceError,
        AmbiguousSourceError,
        MalformedManifestRecordError,
        DuplicateManifestRecordError,
        MalformedManifestError,
        MissingDatabaseUrlError,
        # `ValueError` LAST, and deliberately: `load_fiscalizacion_rows`
        # refuses a jurisdiction scheme that does not match the distrito/
        # seccion it is placing rows on, and `db.load_result_rows` refuses a
        # record carrying a foreign `election_id`. Both are validation
        # failures under this module's "non-zero, never a traceback"
        # contract, and both raised plain `ValueError` -- while
        # `NationalSchemaError` and `PbaSchemaError`, `ValueError` subclasses
        # listed above, already exit 1. The narrower names stay listed so the
        # intent of each is on the page.
        ValueError,
        NationalResultsCsvNotFoundError,
        NationalSchemaError,
        # Their exact twins, and every one of them was missing: a drifted
        # header in the HAND-MAINTAINED sheet -- the source most likely to
        # drift, because a human edits it -- and a re-skinned PBA page both
        # exited with a traceback instead of the exit 1 the module contract
        # promises. The guards existed; the entry point did not reach them.
        FiscalizacionSchemaError,
        PbaSchemaError,
        FiscalizacionUploadForbiddenError,
    ) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1

    if metrics is not None:
        metrics.data["status"] = "succeeded"
    print(f"ingested {inserted} rows from {args.source}")
    return 0


# ---------------------------------------------------------------------------
# validate-crosswalk
# ---------------------------------------------------------------------------


def find_unmapped_jurisdictions(
    codes: Iterable[tuple[str | None, str | None]], crosswalk: CrosswalkTable
) -> list[QuarantinedJurisdiction]:
    """Report every `(distrito, seccion)` pair with no curated crosswalk
    entry -- never silently ignored (task 12.4).

    Phase 16b: `codes` comes from the raw national CSVs, which the real
    archived 2023 file carries UNPADDED (`"2"`, `"27"`); `crosswalk`
    (`curated/crosswalk.yaml`) is zero-padded (`"02"`, `"027"`). Comparing
    verbatim would misreport every real 2023 code as unmapped even though it
    IS curated -- confirmed live, the same padding-independence
    `normalize_distrito_code`/`normalize_seccion_code` (Phase 17's single
    normalization boundary, `etl.jurisdiction`) already gives
    `collect_national_mesa_codes` (Phase 15). Applied on both sides here
    rather than inside `CrosswalkTable.resolve_national`, which stays a
    plain exact-match lookup used elsewhere against already-normalized keys.
    """
    unmapped: list[QuarantinedJurisdiction] = []
    seen: set[tuple[str | None, str | None]] = set()
    seen_uncanonical: set[tuple[str | None, str | None]] = set()
    for distrito, seccion in codes:
        normalized_distrito = normalize_distrito_code(distrito)
        normalized_seccion = normalize_seccion_code(seccion)
        # Deduped on the NORMALIZED pair. `("2","27")` and `("02","027")` are
        # both real and both present in the 2023/2025 corpus; deduping on the
        # raw pair reports one jurisdiction twice, under two different code
        # strings, as if they were two problems.
        if normalized_distrito is None:
            # NOT interpolated as the string "None", and NOT deduped with
            # every other unparseable distrito into one `(None, None)` key.
            # Both happened: the report named a jurisdiction nobody wrote
            # (`None/(sin seccion)`) and collapsed every distinct unreadable
            # code into a single line, so an operator could neither find the
            # jurisdiction nor tell how many problems there were. The RAW
            # spelling is what a human has to go look for here, because
            # there is no canonical form to show. Deduped on that raw
            # spelling, so one bad code repeated across a corpus is one
            # reported problem and two DIFFERENT bad codes stay two.
            if (distrito, seccion) in seen_uncanonical:
                continue
            seen_uncanonical.add((distrito, seccion))
            # `None` is ABSENT, not a code. Rendering it with `!r` printed
            # the literal string "None" as if it were the distrito -- the
            # same fabricated identifier this branch exists to stop.
            shown = "(sin distrito)" if distrito is None else repr(distrito)
            unmapped.append(
                QuarantinedJurisdiction(
                    code=f"{shown}/(codigo ilegible)",
                    reason=(
                        f"distrito code {shown} cannot be canonicalized, so it "
                        "resolves against no curated crosswalk entry"
                    ),
                )
            )
            continue

        key = (normalized_distrito, normalized_seccion)
        # The report identifies the jurisdiction by its CANONICAL codes. It
        # used the RAW first-seen spelling, so the same jurisdiction was named
        # `2/27` or `02/027` depending only on which archived file the corpus
        # happened to read first -- and the dedup two lines below already
        # decided they are one thing. Rule 8: normalize once, then use it.
        if key in seen:
            continue
        seen.add(key)
        if normalized_seccion is None:
            # WHY A ROW REACHES HERE, corrected. This said "the coarse rows of
            # the ten-category 2023 file", which is a data-shape claim the
            # corpus does not support: `iter_national_rows` builds every row at
            # `granularity="mesa"` from the required `seccion_id` column, and
            # all 18.170.843 loaded rows resolve to a jurisdiction with a
            # non-null `seccion_code` -- zero coarse rows, measured.
            #
            # The reachable cause is narrower: `csv.DictReader` fills a
            # TRUNCATED row's missing trailing fields with `None`, so a source
            # cut short mid-line yields `seccion_id is None`. No archived file
            # does this today; this is a guard against one that does, not a
            # description of one that exists.
            #
            # A missing seccion is incomplete. Crosswalk entries are partido-level
            # pairs; child existence is not evidence of an explicit distrito-only
            # scheme. Keep every child only to make an ambiguity report explicit.
            in_distrito = crosswalk.entries_in_distrito(normalized_distrito)
            if len(in_distrito) > 1:
                unmapped.append(
                    QuarantinedJurisdiction(
                        code=f"{normalized_distrito}/(sin seccion)",
                        reason=(
                            f"{len(in_distrito)} curated entries share national distrito "
                            f"{normalized_distrito} ("
                            + ", ".join(sorted(e.name for e in in_distrito))
                            + "); this row names no seccion, so it cannot be attributed "
                            "to one of them"
                        ),
                    )
                )
                continue
            resolved = False
        else:
            # THROUGH the table's own comparison. This loop was a second idea
            # of how a crosswalk entry's code compares, living outside the
            # boundary that owns it -- `resolve_national` now normalizes both
            # sides, so one table has one comparison semantics whichever
            # caller asks.
            resolved = (
                # The NORMALIZED values, matching the dedup key computed two
                # lines up. Passing the raw ones worked only because
                # `resolve_national` re-normalizes -- two representations
                # inside one loop.
                crosswalk.resolve_national(
                    distrito_code=normalized_distrito, seccion_code=normalized_seccion
                )
                is not None
            )
        if not resolved:
            shown_seccion = "(sin seccion)" if normalized_seccion is None else normalized_seccion
            unmapped.append(
                QuarantinedJurisdiction(
                    code=f"{normalized_distrito}/{shown_seccion}",
                    reason=(
                        # CANONICAL here too. `code` was fixed and this was
                        # not, so the same jurisdiction still produced two
                        # different reason strings depending only on which
                        # archived file the corpus read first -- the exact
                        # defect the fix above claims to have closed, closed
                        # halfway.
                        # `shown_*`, not `!r`: an absent seccion printed as
                        # the literal `seccion=None`, a code nobody wrote --
                        # the very thing the distrito branch above refuses,
                        # left half-closed here.
                        f"no curated crosswalk entry for complete distrito="
                        f"{normalized_distrito} seccion={shown_seccion}"
                    ),
                )
            )
    return unmapped


def national_csv_bytes(raw_bytes: bytes) -> bytes:
    """The national results CSV inside an archived ZIP, fully materialized.

    THE TEMP DIRECTORY'S LIFETIME LIVES HERE, once. Six call sites each
    opened their own `tempfile.TemporaryDirectory`, and four of them parsed
    the returned bytes AFTER the block exited -- surviving only because
    `resolve_national_results_bytes` reads the member into memory. That is
    one lifetime assumption per call site, and the day the passthrough
    returns a lazy handle instead, four of them break silently and two do
    not. Returning bytes makes the contract the signature: the caller is
    handed data, not a view into a directory that is already gone.
    """
    with tempfile.TemporaryDirectory(prefix="votus-etl-national-") as extract_dir:
        return resolve_national_results_bytes(raw_bytes, extract_dir=Path(extract_dir))


@dataclass
class NationalResultsTextStream:
    """Seekable result text plus the optional small companion from one selection."""

    handle: TextIO
    establecimientos_csv_bytes: bytes | None

    def __iter__(self):
        return iter(self.handle)

    def read(self, size: int = -1) -> str:
        return self.handle.read(size)

    def readline(self, size: int = -1) -> str:
        return self.handle.readline(size)

    def seek(self, offset: int, whence: int = 0) -> int:
        return self.handle.seek(offset, whence)

    def tell(self) -> int:
        return self.handle.tell()


@contextlib.contextmanager
def national_results_text(raw_bytes: bytes) -> Iterator[NationalResultsTextStream]:
    """The national results CSV as a text stream, never materialized.

    `national_csv_bytes` holds the whole decompressed member, which is the
    right contract for call sites that parse after the temp directory is
    gone. It is the wrong one for a pass that only walks rows: the 2023 PASO
    member decompresses to 3,76 GB, and decoding it for `csv` allocated a
    second copy of the same size, so `load-curated` peaked at 6,59 GB and was
    killed by the OS.

    THE TEMP DIRECTORY'S LIFETIME IS THE `with` BLOCK. The handle is only
    valid inside it -- that is the point, and it is why this is a context
    manager rather than a function returning a handle.
    """
    with tempfile.TemporaryDirectory(prefix="votus-etl-national-") as extract_dir:
        paths = resolve_national_archive_paths(raw_bytes, extract_dir=Path(extract_dir))
        if paths.results is None:
            # Bare CSV (a test fixture, not a registered archive). Wrapping the
            # bytes we already hold adds no second copy; decoding them would.
            yield NationalResultsTextStream(
                io.TextIOWrapper(io.BytesIO(raw_bytes), encoding="utf-8-sig", newline=""),
                None,
            )
            return
        establecimientos_csv_bytes = (
            paths.establecimientos.read_bytes() if paths.establecimientos is not None else None
        )
        with paths.results.open("r", encoding="utf-8-sig", newline="") as handle:
            yield NationalResultsTextStream(handle, establecimientos_csv_bytes)


def collect_national_jurisdiction_codes(
    sources: dict[str, list[dict]], *, local_root: Path, manifest_path: Path
) -> list[tuple[str, str | None]]:
    """Gather every distinct `(distrito, seccion)` actually present in
    already-archived national sources -- the real codes an `ingest` run
    would need the crosswalk to resolve."""
    records = load_manifest(manifest_path)
    local_store = LocalArchiveStore(root=local_root)
    codes: set[tuple[str, str | None]] = set()
    # Split by REASON: "never fetched" and "manifest says ok but the local
    # mirror has no such file" are different failures -- one needs a fetch, the
    # other means the archive drifted -- and one shared counter hides which.
    skipped_not_archived = 0
    skipped_missing_file = 0
    sources_seen = 0
    for entry in sources.get("national", []):
        archived = latest_ok_record(records, entry["id"])
        sources_seen += 1
        if archived is None:
            skipped_not_archived += 1
            continue
        filename = archived_filename(archived, source_id=entry["id"])
        if not local_store.exists("national", filename):
            skipped_missing_file += 1
            continue
        raw_bytes = read_archived_source(
            entry,
            manifest_record=archived,
            capability="national",
            local_store=local_store,
            filename=filename,
        )
        election_year, election_round = registered_source_election(entry)
        with national_results_text(raw_bytes) as results_text:
            for row in iter_national_rows(
                results_text,
                archive_entry_id=entry["id"],
                election_year=election_year,
                election_round=election_round,
            ):
                distrito = row.result.distrito
                if distrito is None:
                    raise NationalSchemaError(
                        f"{entry['id']}: parser invariant violated: national source row "
                        f"{row.source_row_index} has no distrito"
                    )
                # `seccion` stays `None` for coarser-than-seccion rows: absence is
                # not the empty string. See `find_unmapped_jurisdictions`.
                codes.add((distrito, row.result.seccion))
    if skipped_not_archived:
        print(
            f"  {skipped_not_archived} of {sources_seen} registered source(s) have "
            "no successful archive record and were excluded",
            file=sys.stderr,
        )
    if skipped_missing_file:
        print(
            f"  {skipped_missing_file} of {sources_seen} registered source(s) are "
            "recorded as archived but absent from the local mirror and were excluded",
            file=sys.stderr,
        )
    if skipped_not_archived + skipped_missing_file == sources_seen:
        # Same guard `collect_national_party_keys` already carries. Without it
        # `validate-crosswalk` prints "all 0 archived jurisdiction code(s)
        # resolve" and exits 0 over an EMPTY corpus -- green, plausible, and
        # describing nothing.
        print(
            "  no archived national source was read; this result describes an "
            "empty corpus, not a clean one",
            file=sys.stderr,
        )
    # `or ""` on BOTH halves. The seccion half had it and the distrito half
    # did not, so a truncated row -- `csv.DictReader` fills missing trailing
    # fields with `None`, the hazard named in three places here -- raised
    # `TypeError: '<' not supported between 'NoneType' and 'str'` inside the
    # sort. `validate-crosswalk` died with a traceback, and the `None`-distrito
    # handler downstream never ran, while the module contract promises a
    # non-zero EXIT on a validation failure, not a stack trace.
    return sorted(codes, key=lambda pair: (pair[0] or "", pair[1] or ""))


def collect_mesa_tipo_mapping(
    rows, *, source_label: str = "(unnamed source)", into: dict | None = None
) -> dict[tuple[str, str, str, int], set[str]]:
    """Collapse source rows to the distinct `(lineage) -> mesa_tipo` mapping.

    `mesa_tipo` is a property of the MESA, not of a result: mesa 9001 in
    distrito 02 / seccion 027 is EXTRANJEROS for every category and every
    list. Collapsing to distinct mesas turns a 13,6-million-row reload into a
    few hundred thousand tuples, which is what makes backfilling a
    late-added column an UPDATE rather than a re-ingest.
    """
    # Verified against the real archived 2023 generales and 2025 legislativas
    # files: both carry `distrito_id`, `seccion_id`, `circuito_id`, `mesa_id`
    # and `mesa_tipo`, with `circuito_id` 5 characters wide in every row. A
    # source missing any of them is reported, not crashed on, because the two
    # national files already differ in shape and a third will differ again.
    required = ("distrito_id", "seccion_id", "circuito_id", "mesa_id", "mesa_tipo")
    locator_sample_cap = 5
    unknown_category = "(unknown category)"
    # Finite labels measured across the 13-category `national/2023-generales`
    # archive member `2023_Generales/ResultadoElectorales_2023_Generales.csv`.
    # Repository-verified 2025 spellings are the included singular forms
    # `DIPUTADO NACIONAL` and `SENADOR NACIONAL`; this claims no exact-string
    # coverage for PASO or balotaje. Unknown source text is never echoed.
    diagnostic_categories = frozenset(
        {
            "CONCEJAL",
            "DIPUTADO NACIONAL",
            "DIPUTADO PROVINCIAL",
            "DIPUTADOS/AS DE LA CIUDAD AUTONOMA",
            "GOBERNADOR Y VICE",
            "INTENDENTE",
            "JEFE/A DE GOBIERNO",
            "MIEMBROS DE JUNTA COMUNAL",
            "PARLAMENTO MERCOSUR NACIONAL",
            "PARLAMENTO MERCOSUR REGIONAL",
            "PRESIDENTE Y VICE",
            "SENADOR NACIONAL",
            "SENADOR PROVINCIAL",
        }
    )
    reason_order = (
        "skipped_missing_column",
        "skipped_no_tipo",
        "skipped_absent_mesa_id",
        "skipped_bad_mesa_id",
        "skipped_incomplete_lineage",
        "skipped_uncanonical_code",
    )

    # Locators retain only field NAMES and the first five row positions in each
    # bounded bucket. `cargo_nombre` is source-controlled too, so the finite
    # vocabulary above is the only category text that can be exposed.
    exclusion_totals: dict[tuple[str, str], int] = {}
    exclusion_samples: dict[tuple[str, str], list[dict[str, object]]] = {}

    def safe_category(raw_category: object) -> str:
        if not isinstance(raw_category, str):
            return unknown_category
        category = " ".join(raw_category.split())
        return category if category in diagnostic_categories else unknown_category

    def record_exclusion(
        raw: Mapping,
        source_row_index: int,
        reason: str,
        *,
        missing_fields: Iterable[str] = (),
        invalid_fields: Iterable[str] = (),
    ) -> None:
        category = safe_category(raw.get("cargo_nombre"))
        key = (category, reason)
        exclusion_totals[key] = exclusion_totals.get(key, 0) + 1
        samples = exclusion_samples.setdefault(key, [])
        if len(samples) >= locator_sample_cap:
            return
        locator: dict[str, object] = {
            "source_label": source_label,
            "data_row_index": source_row_index,
            "category": category,
            "reason": reason,
        }
        missing_names = list(missing_fields)
        invalid_names = list(invalid_fields)
        if missing_names:
            locator["missing_fields"] = missing_names
        if invalid_names:
            locator["invalid_fields"] = invalid_names
        samples.append(locator)

    # Accumulates ACROSS sources when `into` is supplied. Merging per-file
    # results with `dict.update` afterwards is last-write-wins between the 2023
    # and 2025 files — the same silent pick the per-file set exists to prevent,
    # one loop up.
    candidates: dict[tuple[str, str, str, int], set[str]] = {} if into is None else into
    skipped_no_tipo = 0
    # Three causes, three counters. "The source does not publish the column at
    # all" and "scattered rows have a hole in the lineage" need opposite fixes
    # and are indistinguishable inside one `skipped_malformed` total.
    skipped_missing_column = 0
    skipped_absent_mesa_id = 0
    skipped_bad_mesa_id = 0
    skipped_incomplete_lineage = 0
    # A code the boundary could not canonicalize is NOT the same as a missing
    # one: it is present, wrong-shaped, and would pass through unchanged and
    # silently join nothing.
    skipped_uncanonical_code = 0
    for source_row_index, raw in enumerate(rows):
        missing = [column for column in required if column not in raw]
        if missing:
            skipped_missing_column += 1
            record_exclusion(
                raw,
                source_row_index,
                "skipped_missing_column",
                missing_fields=missing,
            )
            continue
        tipo = validate_mesa_tipo(
            raw.get("mesa_tipo"),
            source_label=source_label,
            source_row_index=source_row_index,
        )
        if tipo is None:
            # Counted, never silently dropped: a skip with no number looks
            # identical whether it discarded nothing or everything.
            skipped_no_tipo += 1
            record_exclusion(
                raw,
                source_row_index,
                "skipped_no_tipo",
                missing_fields=("mesa_tipo",),
            )
            continue
        raw_mesa = raw.get("mesa_id")
        if not isinstance(raw_mesa, str) or not raw_mesa.strip():
            skipped_absent_mesa_id += 1
            record_exclusion(
                raw,
                source_row_index,
                "skipped_absent_mesa_id",
                missing_fields=("mesa_id",),
            )
            continue
        mesa = parse_source_int(raw_mesa)
        if mesa is None:
            skipped_bad_mesa_id += 1
            record_exclusion(
                raw,
                source_row_index,
                "skipped_bad_mesa_id",
                invalid_fields=("mesa_id",),
            )
            continue
        # `required` proves the columns are PRESENT, not that they carry a
        # value. An empty `seccion_id` normalizes to `None`, and
        # `apply_mesa_tipo_mapping` renders `None` as `""` in the merge key --
        # so two different scopes would collapse into one lineage. A lineage
        # with a hole is not a lineage: report and skip.
        distrito = normalize_distrito_code(raw["distrito_id"])
        seccion = normalize_seccion_code(raw["seccion_id"])
        circuito = normalize_circuito_code(raw["circuito_id"])
        if not distrito or not seccion or not circuito:
            skipped_incomplete_lineage += 1
            missing_lineage_fields = [
                field_name
                for field_name, normalized in (
                    ("distrito_id", distrito),
                    ("seccion_id", seccion),
                    ("circuito_id", circuito),
                )
                if not normalized
            ]
            record_exclusion(
                raw,
                source_row_index,
                "skipped_incomplete_lineage",
                missing_fields=missing_lineage_fields,
            )
            continue
        canonicalizable = (
            ("distrito_id", is_canonicalizable_code(raw["distrito_id"])),
            ("seccion_id", is_canonicalizable_code(raw["seccion_id"])),
            (
                "circuito_id",
                is_canonicalizable_circuito_code(raw["circuito_id"]),
            ),
        )
        if not all(is_valid for _, is_valid in canonicalizable):
            skipped_uncanonical_code += 1
            record_exclusion(
                raw,
                source_row_index,
                "skipped_uncanonical_code",
                invalid_fields=[
                    field_name for field_name, is_valid in canonicalizable if not is_valid
                ],
            )
            continue

        key = (distrito, seccion, circuito, mesa)
        # A SET, not a last-write-wins assignment. Two source rows for one mesa
        # disagreeing on its tipo would otherwise collapse in memory before any
        # conflict check downstream could see them — the conflict has to be
        # caught where it happens, not one layer later.
        candidates.setdefault(key, set()).add(tipo)

    if (
        skipped_no_tipo
        or skipped_missing_column
        or skipped_absent_mesa_id
        or skipped_bad_mesa_id
        or skipped_incomplete_lineage
        or skipped_uncanonical_code
    ):
        print(
            f"  {source_label}: {skipped_no_tipo} rows carried no mesa_tipo, "
            f"{skipped_missing_column} lacked a required column, "
            f"{skipped_absent_mesa_id} had an absent mesa_id, "
            f"{skipped_bad_mesa_id} had an unreadable mesa_id, "
            f"{skipped_incomplete_lineage} had an incomplete lineage, "
            f"{skipped_uncanonical_code} carried a non-numeric code the "
            "normalizers cannot canonicalize",
            file=sys.stderr,
        )
        print(
            f"  mesa_tipo exclusion diagnostics for {source_label}: "
            f"locator_sample_cap={locator_sample_cap} "
            f"category_vocabulary_size={len(diagnostic_categories)}",
            file=sys.stderr,
        )
        reason_rank = {reason: index for index, reason in enumerate(reason_order)}
        for category, reason in sorted(
            exclusion_totals,
            key=lambda bucket: (bucket[0], reason_rank[bucket[1]]),
        ):
            total = exclusion_totals[(category, reason)]
            locators = exclusion_samples[(category, reason)]
            print(
                f"    category={category!r} reason={reason} total={total} "
                f"omitted_locators={total - len(locators)}",
                file=sys.stderr,
            )
            for locator in locators:
                optional_fields = ""
                if "missing_fields" in locator:
                    optional_fields += f" missing_fields={locator['missing_fields']!r}"
                if "invalid_fields" in locator:
                    optional_fields += f" invalid_fields={locator['invalid_fields']!r}"
                print(
                    f"    locator source_label={locator['source_label']!r} "
                    f"data_row_index={locator['data_row_index']} "
                    f"category={locator['category']!r} reason={locator['reason']}"
                    f"{optional_fields}",
                    file=sys.stderr,
                )

    return candidates


def source_year(entry_id: str) -> int | None:
    """Return a year encoded in a source id, only for consistency diagnostics."""
    digits = "".join(c for c in entry_id.split("/")[-1][:4] if c.isdigit())
    if len(digits) != 4:
        return None
    try:
        return int(digits)
    except ValueError:
        return None


def registered_source_election(entry: Mapping) -> tuple[int, str]:
    """Validate and return the election metadata authoritative for a source."""
    source_id = entry.get("id")
    election_year = entry.get("election_year")
    election_round = entry.get("election_round")
    if isinstance(election_year, bool) or not isinstance(election_year, int):
        raise SourcesValidationError(
            f"source {source_id!r} election_year must be an integer excluding booleans; "
            f"received {election_year!r}"
        )
    if not isinstance(election_round, str) or not election_round.strip():
        raise SourcesValidationError(
            f"source {source_id!r} election_round must be a non-empty string; "
            f"received {election_round!r}"
        )

    id_year = source_year(source_id) if isinstance(source_id, str) else None
    if id_year is not None and id_year != election_year:
        raise SourcesValidationError(
            f"source {source_id!r} id declares year {id_year}, but election_year "
            f"metadata declares {election_year}"
        )
    return election_year, election_round


@dataclass(frozen=True)
class NationalSourceReadabilityIssue:
    source_id: str
    reason: str
    detail: str


@dataclass(frozen=True)
class NationalSourceReadability:
    configured_source_ids: tuple[str, ...]
    readable_source_ids: tuple[str, ...]
    unavailable: tuple[NationalSourceReadabilityIssue, ...]

    @property
    def readable_count(self) -> int:
        return len(self.readable_source_ids)


def readable_national_sources(
    sources: dict[str, list[dict]],
    *,
    local_root: Path,
    manifest_path: Path,
    year: int | None = None,
) -> NationalSourceReadability:
    """Classify every in-scope national source at one archive-read boundary."""
    records = load_manifest(manifest_path)
    local_store = LocalArchiveStore(root=local_root)
    configured: list[str] = []
    readable: list[str] = []
    unavailable: list[NationalSourceReadabilityIssue] = []
    for entry in sources.get("national", []):
        election_year, _ = registered_source_election(entry)
        if year is not None and election_year != year:
            continue
        source_id = entry["id"]
        configured.append(source_id)
        archived = latest_ok_record(records, source_id)
        if archived is None:
            unavailable.append(
                NationalSourceReadabilityIssue(
                    source_id=source_id,
                    reason="no successful archive record",
                    detail="run fetch for this registered source",
                )
            )
            continue
        filename = archived_filename(archived, source_id=source_id)
        if not local_store.exists("national", filename):
            unavailable.append(
                NationalSourceReadabilityIssue(
                    source_id=source_id,
                    reason="archive file missing or unreadable",
                    detail=f"recorded artifact {filename!r} is absent from the local mirror",
                )
            )
            continue
        readable.append(source_id)
    return NationalSourceReadability(tuple(configured), tuple(readable), tuple(unavailable))


def report_national_source_readability(readability: NationalSourceReadability) -> None:
    by_reason: dict[str, list[NationalSourceReadabilityIssue]] = {}
    for issue in readability.unavailable:
        by_reason.setdefault(issue.reason, []).append(issue)
    for reason, issues in sorted(by_reason.items()):
        print(f"  {reason}: {len(issues)} source(s)", file=sys.stderr)
        for issue in issues:
            print(f"    {issue.source_id}: {issue.detail}", file=sys.stderr)


def cmd_validate_crosswalk(args: argparse.Namespace) -> int:
    sources = load_sources(Path(args.sources_path))
    try:
        readability = readable_national_sources(
            sources, local_root=Path(args.local_root), manifest_path=Path(args.manifest_path)
        )
    except (
        UnknownSourceError,
        MalformedManifestRecordError,
        DuplicateManifestRecordError,
        AmbiguousSourceError,
    ) as exc:
        # A malformed manifest entry is a validation failure like any other.
        # This call sat OUTSIDE the try below, so it exited with a traceback.
        print(f"error: {exc}", file=sys.stderr)
        return 1
    report_national_source_readability(readability)
    if readability.readable_count == 0:
        print(
            "no archived national source is readable; refusing to report coverage "
            "over an empty corpus -- run `fetch` first",
            file=sys.stderr,
        )
        return 1
    try:
        codes = collect_national_jurisdiction_codes(
            sources, local_root=Path(args.local_root), manifest_path=Path(args.manifest_path)
        )
    except (
        NationalResultsCsvNotFoundError,
        NationalSchemaError,
        FiscalizacionSchemaError,
        PbaSchemaError,
        UnknownSourceError,
        MalformedManifestRecordError,
        DuplicateManifestRecordError,
        MalformedManifestError,
        AmbiguousSourceError,
    ) as exc:
        # The module contract is "non-zero on any validation failure". A ZIP
        # whose schema drifted is a validation failure, not a crash — and
        # `iter_national_rows` raises `NationalSchemaError` for a header that
        # drifted a different way.
        print(f"error: {exc}", file=sys.stderr)
        return 1
    try:
        # INSIDE a try that names what this raises. `load_crosswalk` parses a
        # HAND-EDITED YAML -- the file most likely to drift -- and exited with
        # a `yaml` traceback while every archive-side failure in this same
        # function exited 1.
        crosswalk = load_crosswalk(Path(args.crosswalk_path))
        unmapped = find_unmapped_jurisdictions(codes, crosswalk)
    except (yaml.YAMLError, OSError, KeyError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1

    if unmapped:
        for item in unmapped:
            print(f"unmapped jurisdiction: {item.code} -- {item.reason}", file=sys.stderr)
        return 1

    print(f"crosswalk: all {len(codes)} archived jurisdiction code(s) resolve")
    return 0


# ---------------------------------------------------------------------------
# validate-curated
# ---------------------------------------------------------------------------


def find_unmapped_parties(
    keys: Iterable[tuple[int, str, str, str]], party_map: PartyMappingTable
) -> list[UnmappedListId]:
    """Report every `(year, jurisdiction, category, list_id)` key with no
    curated party mapping entry -- never silently ignored (task 12.5)."""
    unmapped: list[UnmappedListId] = []
    seen: set[tuple[int, str, str, str]] = set()
    for year, jurisdiction, category, list_id in keys:
        key = (year, jurisdiction, category, list_id)
        if key in seen:
            continue
        seen.add(key)
        resolved = party_map.resolve(
            year=year, jurisdiction=jurisdiction, category=category, list_id=list_id
        )
        if isinstance(resolved, UnmappedListId):
            unmapped.append(resolved)
    return unmapped


def collect_national_party_keys(
    sources: dict[str, list[dict]], *, local_root: Path, manifest_path: Path
) -> list[tuple[int, str, str, str]]:
    """Gather every distinct `(year, "national", category, list_id)` key
    actually present in already-archived national sources. The registered
    `election_year` metadata is authoritative; a parseable id year is checked
    only for disagreement.
    """
    records = load_manifest(manifest_path)
    local_store = LocalArchiveStore(root=local_root)
    # NEW keys contributed by each source. This counted rows "carrying no
    # list_id", a branch that could never fire: `iter_national_rows` excludes
    # every row whose `agrupacion_id` is empty or `"0"` BEFORE building
    # `list_id`, so `row.list_id` is never falsy and the counter was always
    # zero and its report never printed. The comment justifying it was also
    # wrong about the file -- `lista_numero` is empty throughout the 2023
    # generales export, but `list_id` is not: it degrades to the bare
    # `agrupacion_id`, which `iter_national_rows` documents.
    #
    # What the report was reaching for IS real and IS reachable: a source
    # contributing ZERO keys while `sources_read > 0` suppresses the
    # empty-corpus warning, so `validate-curated` prints "all N key(s)
    # resolve" over a corpus one whole file is missing from.
    keys_by_source: dict[str, int] = {}
    sources_read = 0
    keys: set[tuple[int, str, str, str]] = set()
    skipped_not_archived = 0
    skipped_missing_file = 0
    sources_seen = 0
    for entry in sources.get("national", []):
        year, election_round = registered_source_election(entry)

        archived = latest_ok_record(records, entry["id"])
        sources_seen += 1
        if archived is None:
            skipped_not_archived += 1
            continue
        filename = archived_filename(archived, source_id=entry["id"])
        if not local_store.exists("national", filename):
            skipped_missing_file += 1
            continue
        raw_bytes = read_archived_source(
            entry,
            manifest_record=archived,
            capability="national",
            local_store=local_store,
            filename=filename,
        )
        # What this source YIELDED, not what was new to the shared
        # accumulator. `len(keys)` deltas counted zero for a source whose
        # every key another source had already contributed -- and 2023 PASO
        # and 2023 generales key on the same `(year, "national", category,
        # list_id)` tuple, so whichever was read second reported "the corpus
        # is missing it" about a file read in full. A manufactured warning is
        # the same broken distribution as a hidden one.
        contributed: set[tuple[int, str, str, str]] = set()
        with national_results_text(raw_bytes) as results_text:
            for row in iter_national_rows(
                results_text,
                archive_entry_id=entry["id"],
                election_year=year,
                election_round=election_round,
            ):
                list_id = row.list_id

                if list_id is None:
                    raise NationalSchemaError(
                        f"{entry['id']}: parser invariant violated: national source row "
                        f"{row.source_row_index} has no list_id"
                    )
                contributed.add((year, "national", row.category, list_id))
        keys.update(contributed)
        keys_by_source[entry["id"]] = len(contributed)
        sources_read += 1

    # PER SOURCE, and only the ones that YIELDED nothing: a source read
    # without error that carries no key at all is indistinguishable, in the
    # totals, from one that was never read.
    for source_id, count in sorted(keys_by_source.items()):
        if count == 0:
            print(
                f"  {source_id}: read without error and carries NO curated "
                "key at all; the corpus this validates is missing it",
                file=sys.stderr,
            )
    # Per REASON, not one total: sources not archived and archived artifacts
    # missing from the mirror require different fixes, and either one alone still
    # lets `validate-curated` describe only a fraction of the registered corpus.
    if skipped_not_archived:
        print(
            f"  {skipped_not_archived} of {sources_seen} registered source(s) were "
            "not archived locally and were excluded",
            file=sys.stderr,
        )
    if skipped_missing_file:
        print(
            f"  {skipped_missing_file} of {sources_seen} registered source(s) are "
            "recorded as archived but absent from the local mirror and were excluded",
            file=sys.stderr,
        )

    if sources_read == 0:
        print(
            "  no archived national source was read; this result describes an "
            "empty corpus, not a clean one",
            file=sys.stderr,
        )
    return sorted(keys)


def cmd_validate_curated(args: argparse.Namespace) -> int:
    sources = load_sources(Path(args.sources_path))
    try:
        readability = readable_national_sources(
            sources, local_root=Path(args.local_root), manifest_path=Path(args.manifest_path)
        )
    except (
        UnknownSourceError,
        MalformedManifestRecordError,
        DuplicateManifestRecordError,
        AmbiguousSourceError,
    ) as exc:
        # A malformed manifest entry is a validation failure like any other.
        # This call sat OUTSIDE the try below, so it exited with a traceback.
        print(f"error: {exc}", file=sys.stderr)
        return 1
    report_national_source_readability(readability)
    if readability.readable_count == 0:
        print(
            "no archived national source is readable; refusing to report coverage "
            "over an empty corpus -- run `fetch` first",
            file=sys.stderr,
        )
        return 1
    try:
        keys = collect_national_party_keys(
            sources, local_root=Path(args.local_root), manifest_path=Path(args.manifest_path)
        )
    except (
        NationalResultsCsvNotFoundError,
        NationalSchemaError,
        FiscalizacionSchemaError,
        PbaSchemaError,
        UnknownSourceError,
        MalformedManifestRecordError,
        DuplicateManifestRecordError,
        MalformedManifestError,
        AmbiguousSourceError,
    ) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    try:
        # Same reason as `cmd_validate_crosswalk`'s: `party_map.yaml` is
        # hand-edited, so a malformed one is a validation failure and must
        # exit 1 like every archive-side failure above it, not raise `yaml`.
        party_map = load_party_map(Path(args.party_map_path))
        unmapped = find_unmapped_parties(keys, party_map)
    except (yaml.YAMLError, OSError, KeyError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1

    if unmapped:
        for item in unmapped:
            print(
                f"unmapped party: year={item.year} jurisdiction={item.jurisdiction} "
                f"category={item.category} list_id={item.list_id} -- {item.reason}",
                file=sys.stderr,
            )
        return 1

    print(f"curated party map: all {len(keys)} archived (year, category, list_id) key(s) resolve")
    return 0


# ---------------------------------------------------------------------------
# load-curated
# ---------------------------------------------------------------------------


def collect_national_mesa_codes(
    sources: dict[str, list[dict]],
    *,
    local_root: Path,
    manifest_path: Path,
    distrito_code: str,
    seccion_code: str,
    year: int,
) -> set[tuple[str, int]]:
    """Gather every distinct circuito/mesa pair observed in an already-archived
    national source for one `(distrito, seccion)` scope and one year.

    Reads the raw identity projection before list/vote filters or ambiguous-row
    quarantine. Every registered source for the requested year must be archived
    locally first, so the result can never represent a partial year corpus.
    """
    records = load_manifest(manifest_path)
    local_store = LocalArchiveStore(root=local_root)
    _require_complete_national_corpus(
        sources,
        records=records,
        local_store=local_store,
        years=(year,),
    )
    target_distrito = normalize_distrito_code(distrito_code)
    target_seccion = normalize_seccion_code(seccion_code)
    mesas: set[tuple[str, int]] = set()
    dropped: dict[str, int] = {}
    # Split by REASON: "never fetched" and "manifest says ok but the local
    # mirror has no such file" are different failures -- one needs a fetch, the
    # other means the archive drifted -- and one shared counter hides which.
    skipped_not_archived = 0
    skipped_missing_file = 0
    sources_seen = 0
    for entry in sources.get("national", []):
        entry_year, _ = registered_source_election(entry)
        if entry_year != year:
            continue

        # Counted only after the year filter: a source for another year is out of
        # scope, not missing.
        sources_seen += 1
        archived = latest_ok_record(records, entry["id"])
        if archived is None:
            skipped_not_archived += 1
            continue
        filename = archived_filename(archived, source_id=entry["id"])
        if not local_store.exists("national", filename):
            skipped_missing_file += 1
            continue
        raw_bytes = read_archived_source(
            entry,
            manifest_record=archived,
            capability="national",
            local_store=local_store,
            filename=filename,
        )
        # Streamed, not materialized: the 2023 PASO member is 3,76 GB and this
        # pass only walks rows. See `national_results_text`.
        with national_results_text(raw_bytes) as results_text:
            raw_identities = extract_raw_mesa_identities_from_text(results_text)
        for distrito, seccion, circuito, mesa in raw_identities:
            if normalize_distrito_code(distrito) != target_distrito:
                dropped["outside the requested distrito"] = (
                    dropped.get("outside the requested distrito", 0) + 1
                )
            elif normalize_seccion_code(seccion) != target_seccion:
                dropped["outside the requested seccion"] = (
                    dropped.get("outside the requested seccion", 0) + 1
                )
            else:
                normalized_circuito = normalize_circuito_code(circuito)
                if normalized_circuito is None:
                    raise NationalSchemaError(
                        f"raw mesa identity carried unreadable circuito {circuito!r}"
                    )
                mesas.add((normalized_circuito, mesa))

    if skipped_not_archived:
        print(
            f"  {skipped_not_archived} of {sources_seen} registered source(s) have "
            "no successful archive record and were excluded",
            file=sys.stderr,
        )
    if skipped_missing_file:
        print(
            f"  {skipped_missing_file} of {sources_seen} registered source(s) are "
            "recorded as archived but absent from the local mirror and were excluded",
            file=sys.stderr,
        )

    for reason, count in sorted(dropped.items()):
        print(f"  {year}: {count} row(s) not counted — {reason}", file=sys.stderr)
    return mesas


class MissingArchivedYearError(RuntimeError):
    """Raised when mesa stability lacks a complete registered source corpus."""


def _require_complete_national_corpus(
    sources: dict[str, list[dict]],
    *,
    records: list[dict],
    local_store: LocalArchiveStore,
    years: tuple[int, ...],
) -> None:
    unavailable: list[str] = []
    for year in years:
        entries = [
            entry
            for entry in sources.get("national", [])
            if registered_source_election(entry)[0] == year
        ]
        if not entries:
            unavailable.append(f"{year}: no registered national source")
            continue
        for entry in entries:
            archived = latest_ok_record(records, entry["id"])
            if archived is None:
                unavailable.append(f"{entry['id']}: no successful archive record")
                continue
            filename = archived_filename(archived, source_id=entry["id"])
            if not local_store.exists("national", filename):
                unavailable.append(
                    f"{entry['id']}: archived local artifact {filename!r} is missing"
                )

    if unavailable:
        raise MissingArchivedYearError(
            "national source corpus is incomplete; refusing to compute mesa stability: "
            + "; ".join(unavailable)
        )


def load_curated(
    *,
    database_url: str,
    sources: dict[str, list[dict]],
    local_root: Path,
    manifest_path: Path,
    party_map_path: Path,
    crosswalk_path: Path,
) -> CuratedReplacementSummary:
    """Load every curated table (task 15.10): `party_canonical`,
    `list_identity`, `party_mapping` from `party_map_path`, and
    `jurisdiction_crosswalk`/`mesa_crosswalk` from `crosswalk_path`.

    `mesa_crosswalk`'s presence-per-year is computed for every jurisdiction
    the crosswalk curates only after every registered 2023/2025 national source
    has a successful manifest record and an existing local artifact.

    A partial year corpus is refused, not computed. Missing source data yields
    an incomplete mesa set that `compute_mesa_stability` cannot distinguish
    from mesas that genuinely vanished, rendering unmeasured coverage as
    measured instability.
    """
    for entry in sources.get("national", []):
        registered_source_election(entry)

    records = load_manifest(manifest_path)
    local_store = LocalArchiveStore(root=local_root)

    _require_complete_national_corpus(
        sources,
        records=records,
        local_store=local_store,
        years=(2023, 2025),
    )

    party_map = load_party_map(party_map_path)
    crosswalk = load_crosswalk(crosswalk_path)

    mesa_stabilities: list[tuple[str, str, MesaStability]] = []
    # Split by cause, because the fixes are opposite ones.
    uncovered_absent: list[str] = []
    uncovered_wrong_seccion: list[str] = []
    for jurisdiction in crosswalk.jurisdictions:
        mesas_2023 = collect_national_mesa_codes(
            sources,
            local_root=local_root,
            manifest_path=manifest_path,
            distrito_code=jurisdiction.national_distrito_code,
            seccion_code=jurisdiction.national_seccion_code,
            year=2023,
        )
        mesas_2025 = collect_national_mesa_codes(
            sources,
            local_root=local_root,
            manifest_path=manifest_path,
            distrito_code=jurisdiction.national_distrito_code,
            seccion_code=jurisdiction.national_seccion_code,
            year=2025,
        )
        # The refusal was built PER YEAR; the harm is PER JURISDICTION. A
        # readable 2023 source proves a file exists, not that it carries rows
        # for THIS `(distrito, seccion)` -- and when it does not,
        # `compute_mesa_stability` writes every mesa as `present_2023=False,
        # stable_across_years=False`. Unmeasured, persisted as measured.
        if not mesas_2023 and not mesas_2025:
            # Covered in NEITHER year. `compute_mesa_stability` yields nothing,
            # so the jurisdiction vanishes from `mesa_crosswalk` while
            # `load-curated` prints "loaded N row(s)" and exits 0 -- unmeasured
            # coverage rendered as a clean load. Reported, not refused: a
            # curated jurisdiction the archive does not reach yet is a real
            # state, unlike the half-covered one below.
            # PER REASON. One list collapsed two causes with OPPOSITE fixes:
            # the archive genuinely does not reach this jurisdiction (fetch
            # more), versus the curated codes do not match what the archive
            # writes (fix `crosswalk.yaml`) -- the padding/scheme class of
            # defect that produced Coronel Rosales as three identities. Which
            # one it is, is answerable: does the corpus carry this DISTRITO
            # at all?
            in_corpus = collect_national_jurisdiction_codes(
                sources, local_root=local_root, manifest_path=manifest_path
            )
            target_distrito = normalize_distrito_code(jurisdiction.national_distrito_code)
            distrito_seen = any(normalize_distrito_code(d) == target_distrito for d, _ in in_corpus)
            label = f"{jurisdiction.national_distrito_code}/{jurisdiction.national_seccion_code}"
            if distrito_seen:
                seen_secciones = sorted(
                    {
                        normalize_seccion_code(s) or "(sin seccion)"
                        for d, s in in_corpus
                        if normalize_distrito_code(d) == target_distrito
                    }
                )
                uncovered_wrong_seccion.append(
                    f"{label} (the archive carries distrito "
                    f"{jurisdiction.national_distrito_code} with seccion(s) "
                    f"{', '.join(seen_secciones)})"
                )
            else:
                uncovered_absent.append(label)
            continue

        if bool(mesas_2023) != bool(mesas_2025):
            empty_year = 2023 if not mesas_2023 else 2025
            raise MissingArchivedYearError(
                f"jurisdiction {jurisdiction.national_distrito_code}/"
                f"{jurisdiction.national_seccion_code} has mesas in "
                f"{2025 if empty_year == 2023 else 2023} but none in {empty_year}; "
                "refusing to record every mesa as absent in a year the archive "
                "may simply not cover for this jurisdiction"
            )

        for stability in compute_mesa_stability(mesas_2023, mesas_2025):
            mesa_stabilities.append(
                (
                    jurisdiction.national_distrito_code,
                    jurisdiction.national_seccion_code,
                    stability,
                )
            )

    if uncovered_absent:
        print(
            f"  {len(uncovered_absent)} curated jurisdiction(s) get NO mesa_crosswalk "
            "row because the archive does not carry their distrito at all -- fetch "
            f"more sources: {', '.join(uncovered_absent)}",
            file=sys.stderr,
        )
    if uncovered_wrong_seccion:
        print(
            f"  {len(uncovered_wrong_seccion)} curated jurisdiction(s) get NO "
            "mesa_crosswalk row even though the archive DOES carry their distrito -- "
            "the curated seccion does not match what the archive writes, so fix "
            f"crosswalk.yaml: {'; '.join(uncovered_wrong_seccion)}",
            file=sys.stderr,
        )

    conn = psycopg.connect(database_url)
    try:
        party_map_summary = load_party_map_rows(conn, party_map)
        crosswalk_summary = load_crosswalk_rows(conn, crosswalk, mesa_stabilities=mesa_stabilities)

        # THE DISCONTINUITIES, SURFACED. `MesaStability.discontinuous` had no
        # production reader and `review_item`'s `mesa_discontinuity` kind had
        # no production writer, so the spec's "a code present in only one
        # year MUST be surfaced as a discontinuity, never silently dropped"
        # was delivered by nothing: `mesa_crosswalk.stable_across_years`
        # records the fact in a column nobody reports on.
        #
        # Production CLI year-level context writer, deduped like fiscalización
        # drafts: re-running `load-curated` must not append the same
        # observation again, and must not discard a genuinely new one.
        drafts = [
            ReviewItemRecord(
                kind="mesa_discontinuity",
                severity="warning",
                # THROUGH the boundary, and through the SAME builder every
                # other writer of this key uses. Built from the raw curated
                # YAML strings, a `national_seccion: "27"` wrote
                # `mesa_crosswalk` row `02/027` (which `load_crosswalk_rows`
                # normalizes three lines later) and `review_item` key
                # `02-27-mesa-N`. Two identities for one mesa, so the day the
                # curated padding is corrected every discontinuity appends again.
                subject_ref=(
                    f"{normalize_distrito_code(distrito)}-"
                    f"{normalize_seccion_code(seccion)}-circuito-"
                    f"{stability.circuito}-mesa-{stability.mesa}"
                ),
                note=(
                    f"mesa {stability.mesa} circuito {stability.circuito} in "
                    f"{distrito}/{seccion} is present in "
                    + ("2023 but not 2025" if stability.present_2023 else "2025 but not 2023")
                    + "; it is NOT stable across years and must not be compared as if it were"
                ),
                contexts=tuple(
                    ReviewItemContext(
                        "observed",
                        "official",
                        "unknown",
                        year,
                        None,
                        None,
                        None,
                        "source_archive_not_attributable",
                    )
                    for year in (2023, 2025)
                ),
            )
            for distrito, seccion, stability in mesa_stabilities
            if stability.discontinuous
        ]
        if drafts:
            recorded_review_items = insert_review_items(conn, drafts)
            print(
                f"  {len(drafts)} discontinuous mesa(s) recorded for review "
                f"({recorded_review_items} new, "
                f"{len(drafts) - recorded_review_items} not recorded)",
                file=sys.stderr,
            )

        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
    return CuratedReplacementSummary(
        party_map=party_map_summary,
        crosswalk=crosswalk_summary,
    )


def cmd_load_curated(args: argparse.Namespace) -> int:
    try:
        database_url = resolve_database_url(args.database_url)
    except MissingDatabaseUrlError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1

    sources = load_sources(Path(args.sources_path))
    try:
        counts = load_curated(
            database_url=database_url,
            sources=sources,
            local_root=Path(args.local_root),
            manifest_path=Path(args.manifest_path),
            party_map_path=Path(args.party_map_path),
            crosswalk_path=Path(args.crosswalk_path),
        )
    except (
        MissingArchivedYearError,
        NationalResultsCsvNotFoundError,
        NationalSchemaError,
        UnknownSourceError,
        MalformedManifestRecordError,
        AmbiguousSourceError,
    ) as exc:
        # Same contract as every other command: "non-zero on any validation
        # failure". `load_curated` reads the archive through
        # `collect_national_mesa_codes`, so a drifted ZIP reached it as a
        # traceback while its four sibling commands already exited 1.
        print(f"error: {exc}", file=sys.stderr)
        return 1

    for table_name, count in (
        ("party_canonical", counts.party_map.party_canonical),
        ("list_identity", counts.party_map.list_identity),
        ("party_mapping", counts.party_map.party_mapping),
        ("jurisdiction_crosswalk", counts.crosswalk.jurisdiction_crosswalk),
        ("mesa_crosswalk", counts.crosswalk.mesa_crosswalk),
    ):
        deleted_by_reason = (
            ",".join(
                f"{reason}:{deleted}" for reason, deleted in sorted(count.deleted_by_reason.items())
            )
            or "none"
        )
        print(
            f"{table_name}: operation={count.operation} loaded={count.loaded} "
            f"deleted={count.deleted} deleted_by_reason={deleted_by_reason}"
        )
    return 0


# ---------------------------------------------------------------------------
# validate-fiscalizacion — the D9.5 divergence path
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class OfficialMesaProjection:
    tallies: dict[int, OfficialMesaVotes]
    skipped: dict[str, int]
    review_items: tuple[ReviewItemRecord, ...]


def official_mesa_votes_from_national(
    csv_bytes: bytes,
    *,
    distrito: str,
    seccion: str,
    category: str,
    source_id: str,
    election_year: int,
    election_round: str,
) -> OfficialMesaProjection:
    """Project an archived national CSV onto per-mesa official tallies WITHIN
    ONE `(distrito, seccion, category)` scope.

    The scope is not optional. `mesa_id` is globally unique in the 2025
    national file and NOT in the 2023 one, so keying on it alone collapses two
    physically different mesas in two distritos into one entry. And the 2023
    file bundles ten categories from PRESIDENTE Y VICE down to MIEMBROS DE
    JUNTA COMUNAL, so without a category filter one mesa's ten tallies for the
    same agrupación overwrite each other and an arbitrary survivor is compared
    against fiscalización. Both produce a FABRICATED divergence, written to
    `review_item` as `info` for an operator to read as data.

    `agrupacion_nombre` is NOT in `ingest.national.REQUIRED_COLUMNS` -- present
    in the committed 2023 and 2025 files, guaranteed by nothing -- and the join
    is keyed on it, so its absence fails explicitly.

    Returns the tallies and a per-reason count of every row NOT used.
    """
    reader = csv.DictReader(io.StringIO(csv_bytes.decode("utf-8-sig")))
    fieldnames = reader.fieldnames or []
    for required in (
        "distrito_id",
        "seccion_id",
        "circuito_id",
        "mesa_id",
        "cargo_nombre",
        "votos_tipo",
        "votos_cantidad",
        "agrupacion_nombre",
    ):
        if required not in fieldnames:
            raise NationalSchemaError(
                f"the baseline source has no {required!r} column, which the "
                "divergence join needs; it cannot be compared"
            )

    target_distrito = normalize_distrito_code(distrito)
    target_seccion = normalize_seccion_code(seccion)

    # SETS, not assignment: two rows for one `(mesa, agrupacion)` inside a
    # single scope disagree about a fact, and last-write-wins picks one
    # silently. `collect_mesa_tipo_mapping` in this same file accumulates the
    # same way for the same reason.
    votes_by_mesa: dict[int, dict[str, set[int]]] = {}
    tipo_by_mesa: dict[int, dict[str, set[int]]] = {}
    skipped: dict[str, int] = {}
    # A mesa NUMBER does not identify a mesa: within one partido the same
    # `mesa_code` appears under more than one circuito — 8 of the 93
    # fiscalización mesas, against the live 2025 import, which is why
    # `db.official_jurisdictions_for_mesa` refuses them. Keying tallies on the
    # number alone merges two physically different mesas: equal tallies sum
    # silently, and differing ones surface as SCHEMA DRIFT on data that is
    # perfectly well-formed.
    #
    circuitos_by_mesa: dict[int, set[str]] = {}
    # Rows per mesa that CONTRIBUTED A TALLY. Counting every row that reached
    # the loop body double-counted the ones already skipped as
    # "votos_tipo not in the comparison vector", so the per-reason totals summed
    # to more than the rows read. Counting mesas instead under-reported the
    # largest exclusion by an order of magnitude. Neither total is truthful;
    # this one is.
    tallied_rows_by_mesa: dict[int, int] = {}
    evidence_by_mesa: dict[int, list[tuple[str, str, str, int]]] = {}
    known_official_names = frozenset(OFFICIAL_AGRUPACION_NAME_BY_COLUMN.values())

    def skip(reason: str) -> None:
        skipped[reason] = skipped.get(reason, 0) + 1

    for raw in reader:
        if normalize_distrito_code(raw["distrito_id"]) != target_distrito:
            skip("outside the requested distrito")
            continue
        if normalize_seccion_code(raw["seccion_id"]) != target_seccion:
            skip("outside the requested seccion")
            continue
        if raw["cargo_nombre"] != category:
            skip("a different category")
            continue

        votos_tipo = raw["votos_tipo"]
        official_name = raw["agrupacion_nombre"]
        if votos_tipo == "POSITIVO" and official_name not in known_official_names:
            raise NationalSchemaError(
                f"mesa {raw['mesa_id']} reports unknown official party name "
                f"{official_name!r} within distrito={target_distrito}, "
                f"seccion={target_seccion}, category={category!r}; refusing fiscal "
                "comparison because the curated official party-name mapping no "
                "longer matches the source"
            )

        mesa = parse_source_int(raw["mesa_id"])
        if mesa is None:
            skip("unreadable mesa_id")
            continue
        cantidad = parse_source_int(raw["votos_cantidad"])
        if cantidad is None:
            skip("unreadable votos_cantidad")
            continue

        contributes_tally = votos_tipo in ("POSITIVO", "EN BLANCO", "IMPUGNADO")

        if contributes_tally:
            # ONLY from rows that contribute a tally -- the same set
            # `tallied_rows_by_mesa` tracks. Accumulating from every row that
            # passed the distrito/seccion/category filter meant a NULO or
            # RECURRIDO row carrying a different circuito declared the mesa
            # ambiguous and dropped tallies that all sat in ONE circuito: a
            # fabricated ambiguity verdict on well-formed data, which is the
            # exact outcome this check exists to prevent.
            #
            # NORMALIZED, like every other administrative code read in this
            # file. Compared raw, `"248"` and `"00248"` -- the same circuito
            # written two ways, which is why `normalize_circuito_code` exists
            # -- counted as two, with the same fabricated result.
            raw_circuito = raw["circuito_id"]
            if not is_canonicalizable_circuito_code(raw_circuito):
                raise NationalSchemaError(
                    f"mesa {mesa} has missing, blank, or unreadable circuito_id "
                    f"{raw_circuito!r} within distrito={target_distrito}, "
                    f"seccion={target_seccion}, category={category!r}; refusing to "
                    "add a tally without circuito identity"
                )
            circuito = normalize_circuito_code(raw_circuito.strip())
            circuitos_by_mesa.setdefault(mesa, set()).add(circuito)
            evidence_by_mesa.setdefault(mesa, []).append(
                (circuito, votos_tipo, official_name.strip(), cantidad)
            )

        if votos_tipo == "POSITIVO":
            votes_by_mesa.setdefault(mesa, {}).setdefault(official_name, set()).add(cantidad)
            tallied_rows_by_mesa[mesa] = tallied_rows_by_mesa.get(mesa, 0) + 1
        elif votos_tipo in ("EN BLANCO", "IMPUGNADO"):
            tipo_by_mesa.setdefault(mesa, {}).setdefault(votos_tipo, set()).add(cantidad)
            tallied_rows_by_mesa[mesa] = tallied_rows_by_mesa.get(mesa, 0) + 1
        else:
            # NULO, RECURRIDO and anything else the source reports: not part of
            # the 17-column fiscalización vector, so not comparable — counted
            # rather than vanishing.
            skip(f"votos_tipo {votos_tipo!r} is not in the comparison vector")

    # DROPPED BEFORE the collapse, with their reason counted. Left in, an
    # ambiguous mesa's two circuitos disagree about a tally and `collapse`
    # reports that as schema drift — `validate-fiscalizacion` would exit 1 on
    # data that is perfectly well-formed.
    ambiguous = {mesa for mesa, circuitos in circuitos_by_mesa.items() if len(circuitos) > 1}
    review_items: list[ReviewItemRecord] = []
    for mesa in sorted(ambiguous):
        evidence = sorted(evidence_by_mesa.get(mesa, []))
        rendered_tallies = ", ".join(
            f"{circuito} {votos_tipo}"
            + (f" {official_name}" if official_name else "")
            + f"={cantidad}"
            for circuito, votos_tipo, official_name, cantidad in evidence
        )
        review_items.append(
            ReviewItemRecord(
                kind="ambiguous_official_mesa_identity",
                severity="warning",
                subject_ref=(
                    f"{source_id} {election_year}-{election_round} official "
                    f"[{target_distrito}/{target_seccion or '(sin seccion)'}/{category}] "
                    f"mesa-{mesa}"
                ),
                note=(
                    f"mesa {mesa} appears in circuitos "
                    f"{', '.join(sorted(circuitos_by_mesa[mesa]))}; "
                    f"{len(evidence)} official row(s) quarantined; tallies {rendered_tallies}"
                ),
            )
        )
        votes_by_mesa.pop(mesa, None)
        tipo_by_mesa.pop(mesa, None)
        for _ in range(tallied_rows_by_mesa.get(mesa, 0)):
            skip(
                "the mesa number appears under more than one circuito, so it does "
                "not identify one mesa"
            )
    if ambiguous:
        # NAMED, like every sibling report in this file (`unmatched_mesas`,
        # `collided_mesas`, `incomparable_mesas`, the quarantine breakdown).
        # A count with no identifiers is visible and not actionable: nobody
        # can go look at the mesas whose tallies were withheld, or check the
        # circuitos against the source.
        print(
            f"  {len(ambiguous)} mesa(s) withheld because their number appears under "
            "more than one circuito: "
            + ", ".join(
                f"mesa {mesa} in circuitos " + ", ".join(sorted(circuitos_by_mesa[mesa]))
                for mesa in sorted(ambiguous)
            ),
            file=sys.stderr,
        )

    def collapse(source: dict[int, dict[str, set[int]]], label: str) -> dict[int, dict[str, int]]:
        collapsed: dict[int, dict[str, int]] = {}
        for mesa, by_key in source.items():
            for key, values in by_key.items():
                if len(values) > 1:
                    raise NationalSchemaError(
                        f"mesa {mesa} reports {len(values)} different {label} tallies for "
                        f"{key!r} within one (distrito, seccion, category) scope: "
                        f"{sorted(values)}; refusing to pick one"
                    )
                collapsed.setdefault(mesa, {})[key] = next(iter(values))
        return collapsed

    votes = collapse(votes_by_mesa, "positive")
    tipos = collapse(tipo_by_mesa, "votos_tipo")

    return OfficialMesaProjection(
        tallies={
            mesa: OfficialMesaVotes(
                mesa=mesa,
                votes_by_agrupacion_name=votes.get(mesa, {}),
                votos_tipo_totals=tipos.get(mesa, {}),
            )
            for mesa in set(votes) | set(tipos)
        },
        skipped=skipped,
        review_items=tuple(review_items),
    )


def available_divergence_contexts(
    conn,
    *,
    election_year: int,
    election_round: str,
    category: str,
    fiscal_archive_id: str,
    official_archive_id: str,
) -> tuple[ReviewItemContext, ReviewItemContext]:
    """Resolve the one authoritative DB identity shared by both comparison sides."""
    with conn.cursor() as cur:
        cur.execute(
            """
            select e.id, c.id from election e cross join category c
            where e.year=%s and e.round=%s and c.name=%s
              and exists(
                select 1 from archive_entry
                where id=%s and status='ok' and source_kind='fiscalizacion'
              )
              and exists(
                select 1 from archive_entry
                where id=%s and status='ok' and source_kind='official'
              )
            """,
            (election_year, election_round, category, fiscal_archive_id, official_archive_id),
        )
        identity = cur.fetchone()
    if identity is None:
        raise ValueError(
            "divergence contexts require authoritative election, category, and archives"
        )
    election_id, category_id = map(str, identity)
    return (
        ReviewItemContext(
            "observed",
            "fiscalizacion",
            "available",
            election_year,
            election_id,
            category_id,
            fiscal_archive_id,
        ),  # noqa: E501
        ReviewItemContext(
            "comparison",
            "official",
            "available",
            election_year,
            election_id,
            category_id,
            official_archive_id,
        ),  # noqa: E501
    )


def cmd_validate_fiscalizacion(args: argparse.Namespace) -> int:
    """Compare fiscalización and official tallies by mesa identity.

    Actionable tally divergences become informational review-item candidates.
    Expected category-definition differences remain excluded from the queue and
    are reported separately. Divergences never turn a successful join into a
    command failure (D9.5).
    """
    # THE CHECK behind the name table's curated scope. `vector()` maps every
    # column through `OFFICIAL_AGRUPACION_NAME_BY_COLUMN`, curated for one
    # (distrito, seccion, category); outside it every name misses, every
    # column reads 0, and the run writes 17 fabricated divergences per mesa.
    # Refused the way `load_fiscalizacion_rows` refuses a scheme that does not
    # match the scope it writes to.
    curated_year, curated_distrito, curated_seccion, curated_category = CURATED_NAME_TABLE_SCOPE
    requested = (
        normalize_distrito_code(args.distrito),
        normalize_seccion_code(args.seccion),
        args.category,
    )
    if requested != (curated_distrito, curated_seccion, curated_category):
        print(
            f"error: the official party-name table is curated for "
            f"{curated_distrito}/{curated_seccion}/{curated_category}, and this run "
            f"asks for {requested[0]}/{requested[1]}/{requested[2]}; outside that "
            "scope every column would miss and every mesa would report 17 divergences "
            "that are not real",
            file=sys.stderr,
        )
        return 1
    review_scope = ReviewItemSectionScope(curated_distrito, curated_seccion)

    sources = load_sources(Path(args.sources_path))
    fiscalizacion_entry = find_source_entry(sources, args.source)
    if fiscalizacion_entry is None:
        print(f"error: no registered source with id {args.source!r}", file=sys.stderr)
        return 1
    if fiscalizacion_entry["capability"] != "fiscalizacion":
        print(
            f"error: {args.source!r} is registered under "
            f"{fiscalizacion_entry['capability']!r}, but this argument requires a "
            "'fiscalizacion' source",
            file=sys.stderr,
        )
        return 1

    baseline_entry = find_source_entry(sources, args.baseline)
    if baseline_entry is None:
        print(f"error: no registered source with id {args.baseline!r}", file=sys.stderr)
        return 1
    if baseline_entry["capability"] != "national":
        print(
            f"error: {args.baseline!r} is registered under "
            f"{baseline_entry['capability']!r}, but this argument requires a "
            "'national' source",
            file=sys.stderr,
        )
        return 1

    fiscalizacion_election = registered_source_election(fiscalizacion_entry)
    baseline_election = registered_source_election(baseline_entry)
    accepted_election = (curated_year, "legislativas")
    for role, source_id, election in (
        ("fiscalización source", args.source, fiscalizacion_election),
        ("official baseline", args.baseline, baseline_election),
    ):
        if election != accepted_election:
            print(
                f"error: {role} {source_id!r} has registered election "
                f"{election[0]}/{election[1]}, but validate-fiscalizacion accepts only "
                f"{accepted_election[0]}/{accepted_election[1]}",
                file=sys.stderr,
            )
            return 1
    if fiscalizacion_election != baseline_election:
        print(
            f"error: fiscalización source {args.source!r} is registered for "
            f"{fiscalizacion_election[0]}/{fiscalizacion_election[1]}, but baseline "
            f"{args.baseline!r} is registered for "
            f"{baseline_election[0]}/{baseline_election[1]}",
            file=sys.stderr,
        )
        return 1

    try:
        database_url = resolve_database_url(args.database_url)
    except MissingDatabaseUrlError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1

    records = load_manifest(Path(args.manifest_path))
    local_store = LocalArchiveStore(root=Path(args.local_root))

    def archived_bytes(source_id: str, capability: str) -> bytes | None:
        entry = find_source_entry(sources, source_id)
        if entry is None:
            print(f"error: no registered source with id {source_id!r}", file=sys.stderr)
            return None
        archived = latest_ok_record(records, source_id)
        if archived is None:
            print(f"error: no archived copy of {source_id!r} -- run `fetch` first", file=sys.stderr)
            return None
        # The capability comes from the ENTRY, not from the caller's literal.
        # Checking `exists("national", ...)` for a `--baseline` registered under
        # `pba` reported "absent from the local mirror" -- an archive-drift
        # verdict on what is really a wrong-capability argument.
        if entry["capability"] != capability:
            print(
                f"error: {source_id!r} is registered under {entry['capability']!r}, "
                f"but this argument requires a {capability!r} source",
                file=sys.stderr,
            )
            return None
        filename = archived_filename(archived, source_id=entry["id"])
        if not local_store.exists(entry["capability"], filename):
            print(
                f"error: {source_id!r} is recorded as archived but absent from the local mirror",
                file=sys.stderr,
            )
            return None
        return read_archived_source(
            entry,
            manifest_record=archived,
            capability=capability,
            local_store=local_store,
            filename=filename,
        )

    try:
        fiscalizacion_bytes = archived_bytes(args.source, "fiscalizacion")
        baseline_bytes = archived_bytes(args.baseline, "national")
    except (
        FiscalizacionUploadForbiddenError,
        MalformedManifestRecordError,
        AmbiguousSourceError,
    ) as exc:
        # Exit code, not a traceback -- `cmd_fetch` already learned this for
        # the same exception on its own read path.
        print(f"error: {exc}", file=sys.stderr)
        return 1
    if fiscalizacion_bytes is None or baseline_bytes is None:
        return 1

    result = ingest_fiscalizacion(
        fiscalizacion_bytes,
        archive_entry_id=args.source,
    )
    # Explicitly deferred to PR4: this comparison command has no loader-resolved
    # election/category IDs and must never invent or requery them for v2.
    parser_review_records = [
        replace(
            review_item_draft_to_record(draft),
            subject_ref=(
                f"{args.source} {fiscalizacion_election[0]}-"
                f"{fiscalizacion_election[1]} {draft.subject_ref}"
            ),
            section_scopes=(review_scope,),
        )
        for draft in result.review_items
    ]

    # Same quarantine `ingest_source` reports, reported here too: reading only
    # `result.rows` made the join describe a smaller corpus with no word about
    # what was withheld.
    if result.quarantined:
        by_reason: dict[str, list[QuarantinedFiscalizacionRow]] = {}
        for row in result.quarantined:
            by_reason.setdefault(row.reason, []).append(row)
        print(
            f"  {len(result.quarantined)} fiscalización row(s) were quarantined at "
            "ingestion and are not part of this comparison:",
            file=sys.stderr,
        )
        for reason, quarantined_rows in sorted(by_reason.items()):
            named = sorted(r.mesa for r in quarantined_rows if r.mesa is not None)
            # Same locator as `ingest_source`'s report: a reason whose rows all
            # carry `mesa=None` is otherwise a bare count.
            lines = sorted(i for r in quarantined_rows for i in r.source_row_indices)
            print(
                f"    {reason}: {len(quarantined_rows)} row(s)"
                + (f", mesas {', '.join(str(m) for m in named)}" if named else "")
                + (f", source row(s) {', '.join(str(i) for i in lines)}" if lines else ""),
                file=sys.stderr,
            )
    # PER ROW. A blank cell carries `None`, which cannot be compared against an
    # integer tally. Partitioned by row rather than by mesa: two rows for one
    # mesa, one complete and one blank, left the blank one excluded AND
    # unreported because its mesa number was in the comparable set.
    comparable_rows: list[tuple[FiscalizacionRow, dict[str, int]]] = []
    incomparable_mesas: list[int] = []
    for row in result.rows:
        votes: dict[str, int] = {}
        for column, value in row.votes.items():
            if value is None:
                incomparable_mesas.append(row.mesa)
                break
            votes[column] = value
        else:
            comparable_rows.append((row, votes))
    incomparable_mesas.sort()
    mesa_rows = [FiscalizacionMesaRow(mesa=row.mesa, votes=votes) for row, votes in comparable_rows]
    if incomparable_mesas:
        # PER REASON, not one name for two facts. A `None` vote is either a
        # cell the fiscal left EMPTY or one carrying something unreadable
        # ("1O", "n/d"), and the message named only the first -- so a
        # transcription error a human could go fix against the source was
        # reported as a blank the source genuinely has.
        #
        # NAMED, like the unmatched and collided mesas below: a bare count
        # says how much was withheld and never which, so nobody can go look.
        by_kind = {"blank_vote_cell": set(), "unreadable_vote_cell": set()}
        for draft in result.review_items:
            if draft.kind in by_kind:
                by_kind[draft.kind].add(draft.subject_ref)
        # EACH MESA IN EXACTLY ONE BUCKET. A mesa carrying one blank cell AND
        # one unreadable cell produced both draft kinds, so it landed in both
        # lists and the per-reason counts summed ABOVE the headline total --
        # a breakdown whose parts do not reconcile, which is how a wrong
        # distribution survives a plausible headline. Same correction
        # `_quarantine_ambiguous_rows` needed for rows-versus-keys.
        reasons: dict[str, list[int]] = {
            "blank vote cell": [],
            "unreadable vote cell": [],
            "both a blank and an unreadable vote cell": [],
        }
        for m in incomparable_mesas:
            blank = f"mesa {m}" in by_kind["blank_vote_cell"]
            unreadable = f"mesa {m}" in by_kind["unreadable_vote_cell"]
            if blank and unreadable:
                reasons["both a blank and an unreadable vote cell"].append(m)
            elif blank:
                reasons["blank vote cell"].append(m)
            elif unreadable:
                reasons["unreadable vote cell"].append(m)
        print(
            f"  {len(incomparable_mesas)} of {len(result.rows)} fiscalización row(s) "
            "cannot be compared; they are NOT counted as diverging:",
            file=sys.stderr,
        )
        for reason, mesas in reasons.items():
            if mesas:
                print(
                    f"    {reason}: {len(mesas)} row(s), mesas "
                    f"{', '.join(str(m) for m in sorted(mesas))}",
                    file=sys.stderr,
                )
        # A mesa carrying a `None` with no draft naming why would be an
        # unexplained withdrawal, so it is reported rather than left out of
        # the breakdown entirely.
        unexplained = [
            m for m in incomparable_mesas if not any(m in mesas for mesas in reasons.values())
        ]
        if unexplained:
            print(
                f"    reason not recorded: {len(unexplained)} row(s), mesas "
                f"{', '.join(str(m) for m in sorted(unexplained))}",
                file=sys.stderr,
            )

    try:
        csv_bytes = national_csv_bytes(baseline_bytes)

        official_projection = official_mesa_votes_from_national(
            csv_bytes,
            distrito=args.distrito,
            seccion=args.seccion,
            category=args.category,
            source_id=args.baseline,
            election_year=baseline_election[0],
            election_round=baseline_election[1],
        )
        official_by_mesa = official_projection.tallies
        baseline_skipped = official_projection.skipped

    except (
        NationalResultsCsvNotFoundError,
        NationalSchemaError,
        FiscalizacionSchemaError,
        PbaSchemaError,
        UnknownSourceError,
        MalformedManifestRecordError,
        DuplicateManifestRecordError,
        MalformedManifestError,
        AmbiguousSourceError,
    ) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1

    # PER REASON. A baseline row that was not used shifts the official side of
    # every comparison it belonged to, and the resulting divergence is written
    # as `info` for an operator to read as data.
    for reason, count in sorted(baseline_skipped.items()):
        print(f"  baseline: {count} row(s) not used — {reason}", file=sys.stderr)

    def persist_records(records_to_write: list[ReviewItemRecord]) -> dict[str, int]:
        records_by_kind: dict[str, list[ReviewItemRecord]] = {}
        for record in records_to_write:
            records_by_kind.setdefault(record.kind, []).append(record)

        conn = psycopg.connect(database_url)
        try:
            if "mesa_tally_divergence" in records_by_kind:
                for source_entry, source_id in (
                    (fiscalizacion_entry, args.source),
                    (baseline_entry, args.baseline),
                ):
                    archived = latest_ok_record(records, source_id)
                    if archived is None:
                        raise ValueError(f"divergence context archive {source_id!r} is unavailable")
                    project_archive_entry(conn, archive_entry_from_evidence(archived, source_entry))
                upsert_election(
                    conn, year=fiscalizacion_election[0], round_=fiscalizacion_election[1]
                )
                upsert_category(conn, name=args.category)
                contexts = available_divergence_contexts(
                    conn,
                    election_year=fiscalizacion_election[0],
                    election_round=fiscalizacion_election[1],
                    category=args.category,
                    fiscal_archive_id=args.source,
                    official_archive_id=args.baseline,
                )
                records_by_kind["mesa_tally_divergence"] = [
                    replace(record, contexts=contexts)
                    for record in records_by_kind["mesa_tally_divergence"]
                ]
            recorded_by_kind: dict[str, int] = {}
            for kind, kind_records in records_by_kind.items():
                recorded_by_kind[kind] = insert_review_items(conn, kind_records)
            conn.commit()
            return recorded_by_kind
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    if not official_by_mesa:
        # Quarantine evidence remains operationally reachable even when every
        # official row in the requested scope is ambiguous and the comparison
        # must fail for lack of a safe baseline.
        if official_projection.review_items:
            persist_records(
                [
                    replace(record, section_scopes=(review_scope,))
                    for record in official_projection.review_items
                ]
            )
        print(
            f"error: no baseline row matched distrito={args.distrito} "
            f"seccion={args.seccion} category={args.category!r}; there is nothing "
            "to compare against, which is not the same as agreeing",
            file=sys.stderr,
        )
        return 1

    try:
        join = join_fiscalizacion_identity(mesa_rows, official_by_mesa)
    except IncompleteOfficialMesaError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1

    # Reported per reason, never as one total, and NEVER as a reason to
    # exclude a mesa: an unmatched or colliding mesa is a crosswalk problem to
    # look at, not data to drop.
    if join.unmatched_mesas:
        print(
            f"  {len(join.unmatched_mesas)} fiscalización mesa(s) have no official "
            f"counterpart in {args.baseline}: "
            f"{', '.join(str(m) for m in sorted(join.unmatched_mesas))}",
            file=sys.stderr,
        )
    if join.collided_mesas:
        print(
            f"  {len(join.collided_mesas)} official mesa(s) were claimed by more than "
            f"one fiscalización row: {', '.join(str(m) for m in sorted(join.collided_mesas))}",
            file=sys.stderr,
        )

    # Scoped by source AND BASELINE: the same sheet compared against 2023 and
    # against 2025 yields different divergences for the same mesa, and a key
    # that named only the sheet made the second comparison look like a repeat
    # of the first.
    # The COMPARISON SCOPE is part of the key, not just the two sources.
    # `--distrito`/`--seccion`/`--category` are flags with defaults, so the
    # same sheet against the same baseline under a different category yields
    # different divergences for the same mesa -- and a key that named only the
    # two sources dropped the second run as "already present" whenever the note
    # text coincided. Same argument this file makes for `ingest_source`.
    # NORMALIZED, like every other writer of a `review_item` key here (see
    # `ingest.fiscalizacion.mesa_subject_ref`, and migration 0018 keying on
    # the STORED seccion_code). Built from the raw args, running this once as
    # `--distrito 02 --seccion 027` and again as `--distrito 2 --seccion 27`
    # produced two scopes for ONE comparison -- `official_mesa_votes_from_
    # national` normalizes internally, so both runs compare identically --
    # so every observation appended a second time.
    scope = (
        f"{normalize_distrito_code(args.distrito)}/"
        f"{normalize_seccion_code(args.seccion) or '(sin seccion)'}/"
        f"{args.category}"
    )
    divergence_projection = mesa_divergences_to_review_items(list(join.divergences))
    divergence_records = [
        replace(
            record,
            subject_ref=f"{args.source} vs {args.baseline} [{scope}] {record.subject_ref}",
            section_scopes=(review_scope,),
        )
        for record in divergence_projection.review_items
    ]
    records_to_write = [
        *parser_review_records,
        *(
            replace(record, section_scopes=(review_scope,))
            for record in official_projection.review_items
        ),
        *divergence_records,
    ]
    recorded_by_kind = persist_records(records_to_write)

    parser_counts: dict[str, int] = {}
    for record in parser_review_records:
        parser_counts[record.kind] = parser_counts.get(record.kind, 0) + 1
    for kind, count in sorted(parser_counts.items()):
        new_count = recorded_by_kind.get(kind, 0)
        print(
            f"  {kind}: {count} review item(s) ({new_count} new, {count - new_count} not recorded)",
            file=sys.stderr,
        )

    official_quarantine_count = len(official_projection.review_items)
    if official_quarantine_count:
        fresh_official_quarantines = recorded_by_kind.get("ambiguous_official_mesa_identity", 0)
        print(
            f"  ambiguous_official_mesa_identity: {official_quarantine_count} review item(s) "
            f"({fresh_official_quarantines} new, "
            f"{official_quarantine_count - fresh_official_quarantines} not recorded)",
            file=sys.stderr,
        )

    for exclusion in divergence_projection.exclusions:
        print(
            f"  expected exclusion: reason={exclusion.reason} "
            f"column={exclusion.column!r} count={exclusion.count}",
            file=sys.stderr,
        )

    observed_divergences = len(join.divergences)
    actionable_candidates = len(divergence_projection.review_items)
    expected_exclusions = sum(exclusion.count for exclusion in divergence_projection.exclusions)
    fresh_divergences = recorded_by_kind.get("mesa_tally_divergence", 0)
    print(
        f"joined {len(join.joined)} of {len(mesa_rows)} fiscalización mesa(s) to "
        f"{args.baseline}; divergence totals: observed={observed_divergences}, "
        f"actionable candidates={actionable_candidates}, "
        f"actually inserted new={fresh_divergences}, "
        f"active-not-recorded={actionable_candidates - fresh_divergences}, "
        f"expected exclusions={expected_exclusions}"
    )
    return 0


# ---------------------------------------------------------------------------
# argparse wiring
# ---------------------------------------------------------------------------


def positive_int(value: str) -> int:
    """Parse an argparse integer that must be greater than zero."""
    try:
        parsed = int(value)
    except ValueError as exc:
        raise argparse.ArgumentTypeError("must be a positive integer") from exc
    if parsed <= 0:
        raise argparse.ArgumentTypeError("must be a positive integer")
    return parsed


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="python -m etl", description=__doc__)
    parser.add_argument("--sources-path", default=str(DEFAULT_SOURCES_PATH))
    parser.add_argument("--local-root", default=str(DEFAULT_LOCAL_ROOT))
    parser.add_argument("--manifest-path", default=str(DEFAULT_MANIFEST_PATH))
    subparsers = parser.add_subparsers(dest="command", required=True)
    geometry = subparsers.add_parser("validate-partido-geometry")
    geometry.add_argument("--source", required=True)
    geometry.set_defaults(func=cmd_validate_partido_geometry)

    fetch_parser = subparsers.add_parser("fetch", help="Archive one registered source.")
    fetch_parser.add_argument("--source", required=True)
    fetch_parser.add_argument("--local-file", default=None)
    fetch_parser.add_argument("--invocation-id", default=None)
    fetch_parser.set_defaults(func=cmd_fetch)

    history_parser = subparsers.add_parser(
        "archive-history", help="List ordered source fetch events and aggregate counts."
    )
    history_parser.add_argument("--source", default=None)
    history_parser.set_defaults(func=cmd_archive_history)

    ingest_parser = subparsers.add_parser(
        "ingest", help="Load one archived source's rows into result_row."
    )
    ingest_parser.add_argument("--source", required=True)
    ingest_parser.add_argument("--metrics-output", type=Path, default=None)
    ingest_parser.add_argument("--database-url", default=None)
    ingest_parser.add_argument("--year", type=int, required=True)
    ingest_parser.add_argument("--round", dest="round", required=True)
    ingest_parser.add_argument("--crosswalk-path", default=str(DEFAULT_CROSSWALK_PATH))
    ingest_parser.add_argument("--party-map-path", default=str(DEFAULT_PARTY_MAP_PATH))
    ingest_parser.set_defaults(func=cmd_ingest)

    validate_crosswalk_parser = subparsers.add_parser(
        "validate-crosswalk", help="Report jurisdiction codes with no curated crosswalk entry."
    )
    validate_crosswalk_parser.add_argument("--crosswalk-path", default=str(DEFAULT_CROSSWALK_PATH))
    validate_crosswalk_parser.set_defaults(func=cmd_validate_crosswalk)

    validate_curated_parser = subparsers.add_parser(
        "validate-curated", help="Report party keys with no curated party mapping entry."
    )
    validate_curated_parser.add_argument("--party-map-path", default=str(DEFAULT_PARTY_MAP_PATH))
    validate_curated_parser.set_defaults(func=cmd_validate_curated)

    validate_fiscalizacion_parser = subparsers.add_parser(
        "validate-fiscalizacion",
        help="Join an archived fiscalización sheet to an official source by mesa "
        "identity, queue actionable divergences, and report expected exclusions.",
    )
    validate_fiscalizacion_parser.add_argument("--source", required=True)
    validate_fiscalizacion_parser.add_argument("--baseline", required=True)
    validate_fiscalizacion_parser.add_argument("--database-url", default=None)
    # The scope the baseline is read within. Defaults to the one the
    # fiscalización sheet covers; `mesa_id` is not unique across distritos in
    # the 2023 file and the 2023 file bundles ten categories, so comparing
    # without a scope compares against an arbitrary tally.
    validate_fiscalizacion_parser.add_argument("--distrito", default=FISCALIZACION_DISTRITO)
    validate_fiscalizacion_parser.add_argument("--seccion", default=FISCALIZACION_SECCION)
    validate_fiscalizacion_parser.add_argument("--category", default=FISCALIZACION_CATEGORY)
    validate_fiscalizacion_parser.set_defaults(func=cmd_validate_fiscalizacion)

    load_curated_parser = subparsers.add_parser(
        "load-curated",
        help="Load curated party-map and crosswalk YAML into party_canonical, "
        "list_identity, party_mapping, jurisdiction_crosswalk and mesa_crosswalk.",
    )
    load_curated_parser.add_argument("--database-url", default=None)
    load_curated_parser.add_argument("--party-map-path", default=str(DEFAULT_PARTY_MAP_PATH))
    load_curated_parser.add_argument("--crosswalk-path", default=str(DEFAULT_CROSSWALK_PATH))
    load_curated_parser.set_defaults(func=cmd_load_curated)

    backfill_parser = subparsers.add_parser(
        "backfill-mesa-tipo",
        help="Populate result_row.mesa_tipo from the archived sources without re-ingesting.",
    )
    backfill_parser.add_argument("--database-url", default=None)
    # Batched so progress commits incrementally: a single 16,5-million-row
    # UPDATE loses everything if the client dies, which it did.
    backfill_parser.add_argument("--batch-size", type=positive_int, default=1_500_000)
    backfill_parser.set_defaults(func=cmd_backfill_mesa_tipo)

    return parser


def apply_mesa_tipo_mapping(
    conn,
    mapping: dict[tuple[str, str, str, int], str],
    *,
    batch_size: int = 1_500_000,
):
    """Apply a lineage->mesa_tipo mapping to `result_row`, in batches.

    `mapping` values are ONE tipo each, and the annotation now says so.
    Untyped, it accepted `collect_mesa_tipo_mapping`'s `dict[..., set[str]]`
    verbatim -- `cmd_backfill_mesa_tipo` collapses the sets before calling and
    nothing enforced it, so a direct caller would have passed `set` objects
    into `%s::text[]` and written the repr of a set as a mesa_tipo.

    Extracted so the UPDATE path is testable at all. Its only prior
    coverage stopped at `parse_args` — the same shape as the two validate
    commands whose tests bypassed the archive path they existed to cover.

    Returns `(updated, resolved_jurisdictions, remaining_breakdown,
    unresolved_breakdown)`.
    """
    if batch_size <= 0:
        raise ValueError("batch_size must be positive")

    with conn.cursor() as cur:
        # Two steps, deliberately. Joining the lineage tuples straight onto
        # `result_row` makes Postgres re-resolve every mesa for each of the
        # 16,5 million rows; measured, that ran past 13 minutes without
        # finishing. Resolving the mapping to `jurisdiction_id` ONCE — a few
        # hundred thousand rows — turns the second step into an indexed join.
        # ONE set-based insert, not one lookup per tuple. Every mapping
        # component is required and normalized before this point, so ordinary
        # equality is both truthful and hash-joinable; establecimiento is an
        # optional ancestor published separately in 2025 and cannot be part of
        # this results-file mapping key.
        cur.execute(
            "create temporary table jur_tipo ("
            "jurisdiction_id uuid, tipo text, distrito text, seccion text, circuito text, mesa int)"
        )
        cur.execute(
            """
            insert into jur_tipo (jurisdiction_id, tipo, distrito, seccion, circuito, mesa)
            select j.id, v.tipo, v.distrito, v.seccion, v.circuito, v.mesa
              from unnest(%s::text[], %s::text[], %s::text[], %s::int[], %s::text[])
                   as v(distrito, seccion, circuito, mesa, tipo)
              join jurisdiction j
                on j.distrito_code = v.distrito
               and j.seccion_code = v.seccion
               and j.circuito_code = v.circuito
               and j.mesa_code = v.mesa
               -- mesa_tipo is a property of a MESA, so only mesa-level
               -- jurisdictions can carry it. Without this, a national
               -- lineage tuple could bind a PBA row, where `027` means a
               -- PARTIDO rather than a seccion — the scheme collision that
               -- attributed 32.291 Coronel Rosales votes to the province.
               and j.mesa_code is not null
            """,
            (
                [key[0] for key in mapping],
                [key[1] for key in mapping],
                [key[2] for key in mapping],
                [key[3] for key in mapping],
                list(mapping.values()),
            ),
        )
        # NO two-tipo conflict guard here. It grouped `jur_tipo` by
        # `jurisdiction_id` and refused `count(distinct tipo) > 1`, which needs
        # ONE jurisdiction row matched by two mapping keys carrying different
        # tipos — and the join is exact equality on the four required lineage
        # fields the row itself determines, so two distinct keys cannot match
        # one row. More than one establishment-specific jurisdiction may match
        # one source key, but all receive that mesa's single validated tipo.
        # Duplicate `jurisdiction` rows for one lineage do not reach it either:
        # they have different ids, so each carries one tipo.
        #
        # It was kept "defensive and deliberately without a test". Strict TDD
        # has no such exemption, and trying to drive it is what showed it could
        # not fire. `batch_upsert_jurisdictions` refuses the duplicate lineage
        # that would be the real hazard, and that refusal IS tested.
        cur.execute("select count(distinct jurisdiction_id) from jur_tipo")
        resolved_jurisdictions = cur.fetchone()[0]
        # Which mesas failed to bind, by scope. A bare total ("N matched no
        # jurisdiction") cannot distinguish a whole seccion that was never
        # ingested from scattered lineage mismatches inside one that was, and
        # those need opposite fixes. Same standard the per-source
        # `remaining_breakdown` below already applies.
        cur.execute("select distinct distrito, seccion, circuito, mesa from jur_tipo")
        resolved_keys = {tuple(row) for row in cur.fetchall()}
        unresolved: dict[tuple[str, str], int] = {}
        for key in mapping:
            if key not in resolved_keys:
                scope = (key[0] or "", key[1] or "")
                unresolved[scope] = unresolved.get(scope, 0) + 1
        unresolved_breakdown = sorted(unresolved.items())
        cur.execute("create index on jur_tipo (jurisdiction_id)")

        updated = 0
        while True:
            cur.execute(
                """
                with batch as (
                    select r.id from result_row r
                    join jur_tipo t on t.jurisdiction_id = r.jurisdiction_id
                    where r.mesa_tipo is null
                    limit %s
                )
                update result_row r set mesa_tipo = t.tipo
                  from jur_tipo t
                 where r.id in (select id from batch)
                   and t.jurisdiction_id = r.jurisdiction_id
                """,
                (batch_size,),
            )
            if cur.rowcount == 0:
                break
            updated += cur.rowcount
            conn.commit()
            print(f"  … {updated} rows", file=sys.stderr)

        cur.execute(
            """
            -- `result_row.archive_entry_id` carries the source id from
            -- `sources.yaml` (e.g. `national/2023-generales`), not a foreign
            -- key into `archive_entry`, so it IS the label. Joining on it
            -- against `archive_entry.id` matched nothing and referenced a
            -- column that does not exist.
            select r.archive_entry_id, count(*)
              from result_row r
             where r.mesa_tipo is null
             group by 1 order by 2 desc
            """
        )
        remaining_breakdown = cur.fetchall()
        conn.commit()
    return updated, resolved_jurisdictions, remaining_breakdown, unresolved_breakdown


def cmd_backfill_mesa_tipo(args: argparse.Namespace) -> int:
    """Populate `result_row.mesa_tipo` without re-ingesting the corpus.

    The column was added late, so already-correct rows carry NULL.
    Re-ingesting to fill one column means re-parsing 13,6 million PASO rows
    — about 47 minutes, which this environment could not sustain.

    But `mesa_tipo` is a property of the MESA: mesa 9001 in distrito 02 /
    seccion 027 is EXTRANJEROS for every category and every list. Collapsing
    the sources to the distinct lineage->tipo mapping is a few hundred
    thousand tuples, and applying it is an UPDATE joined on jurisdiction.
    """
    # Resolved BEFORE the archives are parsed, and reported as an exit code
    # rather than a traceback — matching `cmd_ingest` and `cmd_load_curated`.
    # Parsing 13,6 million rows first and only then discovering there is no
    # database URL burns minutes to reach an error known at argument time.
    try:
        database_url = resolve_database_url(args.database_url)
    except MissingDatabaseUrlError as exc:
        print(str(exc), file=sys.stderr)
        return 1

    sources = load_sources(Path(args.sources_path))
    records = load_manifest(Path(args.manifest_path))
    local_store = LocalArchiveStore(root=Path(args.local_root))

    candidates: dict[tuple[str, str, str, int], set[str]] = {}
    # Split by REASON: "never fetched" and "manifest says ok but the local
    # mirror has no such file" are different failures -- one needs a fetch, the
    # other means the archive drifted -- and one shared counter hides which.
    skipped_not_archived = 0
    skipped_missing_file = 0
    sources_seen = 0
    for entry in sources.get("national", []):
        archived = latest_ok_record(records, entry["id"])
        sources_seen += 1
        if archived is None:
            skipped_not_archived += 1
            continue
        try:
            filename = archived_filename(archived, source_id=entry["id"])
        except MalformedManifestRecordError as exc:
            # INSIDE the try that names this exception. It sat one line above,
            # so the handler was dead and the traceback live -- the same defect
            # `cmd_validate_crosswalk` already fixed.
            print(f"error: {exc}", file=sys.stderr)
            return 1
        if not local_store.exists("national", filename):
            skipped_missing_file += 1
            continue
        raw_bytes = read_archived_source(
            entry,
            manifest_record=archived,
            capability="national",
            local_store=local_store,
            filename=filename,
        )
        # Streamed for the same reason `collect_national_mesa_codes` is:
        # `collect_mesa_tipo_mapping` only walks rows, and materializing the
        # 3,76 GB 2023 PASO member plus its decoded copy is what made this
        # command unrunnable against the real corpus.
        #
        # The member is resolved inside the `try` and consumed outside it, so
        # the handler still covers exactly the resolution failures it always
        # covered -- widening it over `collect_mesa_tipo_mapping` would turn a
        # mapping-time schema error into this command's "error:" exit.
        #
        # `national_results_text` opens with `utf-8-sig` for the same BOM
        # reason as `resolve_national_results_bytes`: with `utf-8` every row
        # would miss `distrito_id` and land in `skipped_malformed`, emptying
        # the mapping and failing the backfill on a valid file.
        member = contextlib.ExitStack()
        try:
            results_text = member.enter_context(national_results_text(raw_bytes))
        except (
            NationalResultsCsvNotFoundError,
            NationalSchemaError,
            FiscalizacionSchemaError,
            PbaSchemaError,
            UnknownSourceError,
            MalformedManifestRecordError,
            DuplicateManifestRecordError,
            MalformedManifestError,
            AmbiguousSourceError,
        ) as exc:
            print(f"error: {exc}", file=sys.stderr)
            return 1
        with member:
            collect_mesa_tipo_mapping(
                csv.DictReader(results_text), source_label=entry["id"], into=candidates
            )

    if skipped_not_archived:
        print(
            f"  {skipped_not_archived} of {sources_seen} registered source(s) have "
            "no successful archive record and were excluded from the mapping",
            file=sys.stderr,
        )
    if skipped_missing_file:
        print(
            f"  {skipped_missing_file} of {sources_seen} registered source(s) are "
            "recorded as archived but absent from the local mirror and were "
            "excluded from the mapping",
            file=sys.stderr,
        )

    # One conflict check over EVERY source, not per file: mesa (02,027,00001,1)
    # being NATIVOS in 2023 and EXTRANJEROS in 2025 is exactly the disagreement
    # a per-file check cannot see.
    conflicts = {key: tipos for key, tipos in candidates.items() if len(tipos) > 1}
    if conflicts:
        print(
            f"{len(conflicts)} mesa(s) carry more than one mesa_tipo across the archived "
            "sources; refusing to pick one.",
            file=sys.stderr,
        )
        for key in sorted(conflicts):
            print(f"  {key} -> {sorted(conflicts[key])}", file=sys.stderr)
        return 1

    mapping = {key: next(iter(tipos)) for key, tipos in candidates.items()}
    if not mapping:
        print("no mesa_tipo mapping found in any archived national source", file=sys.stderr)
        return 1

    with psycopg.connect(database_url) as conn:
        (
            updated,
            resolved_jurisdictions,
            remaining_breakdown,
            unresolved_breakdown,
        ) = apply_mesa_tipo_mapping(conn, mapping, batch_size=args.batch_size)
    remaining = sum(count for _, count in remaining_breakdown)

    print(
        f"backfilled mesa_tipo on {updated} rows; {len(mapping)} distinct mesas mapped, "
        f"{resolved_jurisdictions} resolved to a jurisdiction"
    )
    if unresolved_breakdown:
        total_unresolved = sum(count for _, count in unresolved_breakdown)
        print(
            f"  {total_unresolved} mapped mesas matched no jurisdiction, by scope:",
            file=sys.stderr,
        )
        for (distrito, seccion), count in unresolved_breakdown:
            print(f"    distrito={distrito} seccion={seccion}: {count}", file=sys.stderr)
    # The remainder is REPORTED per source, never explained by assertion. It may
    # be a source that does not publish the field, or a lineage that failed to
    # match — those look identical in a single total.
    print(f"{remaining} rows still have no mesa_tipo:")
    for source, count in remaining_breakdown:
        print(f"  {source}: {count}")
    return 0


# THE module contract, in one place: "non-zero on any argument or validation
# failure", never a traceback. Eight `except` tuples each listed a different
# subset of these, so the SAME malformed manifest exited 1 from one command
# and raised from another -- and the calls that read the hand-maintained
# `sources.yaml`, `crosswalk.yaml` and `party_map.yaml` sat outside every
# handler, so the files most likely to drift were the ones least likely to
# produce an exit code.
VALIDATION_FAILURES = (
    UnknownSourceError,
    AmbiguousSourceError,
    MalformedManifestRecordError,
    DuplicateManifestRecordError,
    MalformedManifestError,
    MissingDatabaseUrlError,
    MissingArchivedYearError,
    ArchiveIntegrityError,
    NationalResultsCsvNotFoundError,
    FiscalizacionUploadForbiddenError,
    # `ValueError` covers `NationalSchemaError`, `PbaSchemaError`,
    # `FiscalizacionSchemaError` and the two bare-`ValueError` refusals in
    # `load_fiscalizacion_rows` and `db.load_result_rows` -- a scheme that
    # does not match the scope it writes to, and a record carrying a foreign
    # election. Every one of them is a validation failure.
    ValueError,
    # The hand-edited YAML files. `yaml.YAMLError` is not a `ValueError`,
    # and `OSError` covers a path that does not exist -- which for
    # `sources.yaml`/`crosswalk.yaml`/`party_map.yaml` is an argument failure.
    yaml.YAMLError,
    OSError,
    # NO `KeyError`. It is a PROGRAMMING bug here, not a validation failure:
    # `load_national_rows`'s `jurisdiction_ids[j_key]`,
    # `batch_upsert_jurisdictions`'s `resolved[normalized_key]` and
    # `join_fiscalizacion_identity`'s `row.votes[column]` all raise it when an
    # internal invariant breaks, and catching it here printed `error: '02'`,
    # which reads as a drifted source. That is the misdiagnosis this module
    # refuses everywhere else. A malformed curated YAML shape still exits 1:
    # the three call sites that parse those files catch `KeyError` themselves,
    # where the word means what it says.
)


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        return args.func(args)
    except VALIDATION_FAILURES as exc:
        # The BACKSTOP, at the one place every subcommand passes through.
        # The per-command handlers below still run first where they add
        # context; this catches what none of them wrapped -- `load_sources`
        # in every command, `load_manifest` in four, and `latest_ok_record`'s
        # duplicate refusal in three.
        print(f"error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
