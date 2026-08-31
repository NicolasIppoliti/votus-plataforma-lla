"""Postgres write layer for the normalized `result_row` projection (D8).

Ingestion parsers (`etl.ingest.national`, `etl.ingest.pba`, ...) stay pure
functions of archived bytes -- this module is the only place that opens a
Postgres connection and issues writes, so the idempotency contract lives in
one spot instead of being re-implemented per source.

D8: "Load runs in one transaction per archive entry: delete-by-
`archive_entry_id`, then bulk insert. Rebuild = truncate + replay."
`load_result_rows` validates the archive's authoritative source kind before
that mutation pair. It does not commit; the caller controls the transaction
boundary (production ingestion commits after a successful load, tests roll back for
isolation between runs).
"""

from __future__ import annotations

import json
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from types import TracebackType
from typing import Literal, LiteralString, Protocol
from uuid import UUID

from psycopg import sql

from etl.crosswalk import CrosswalkTable, MesaStability
from etl.jurisdiction import (
    JurisdictionNames,
    normalize_circuito_code,
    normalize_distrito_code,
    normalize_seccion_code,
)
from etl.party_map import PartyMappingTable
from etl.review_item import ReviewItemRecord, validate_review_item_kind


class ArchiveEntryConflictError(ValueError):
    """Persisted provenance disagrees with verified archive/source evidence."""


class ArchiveEntryNotFoundError(ArchiveEntryConflictError):
    """A result-row replacement references no authoritative archive entry."""


class JurisdictionNameConflictError(ValueError):
    """Authoritative display metadata conflicts on one exact jurisdiction lineage."""


class MixedSourceKindBatchError(ValueError):
    """One result-row replacement batch contains more than one source kind."""


class ArchiveEntrySourceKindMismatchError(ArchiveEntryConflictError):
    """A result-row batch disagrees with its archive entry's authoritative source kind."""


class ReviewItemTransactionIsolationError(RuntimeError):
    """A review-item writer is running outside PostgreSQL READ COMMITTED."""


def lock_archive_entry_source_authority(
    conn,
    *,
    archive_entry_id: str,
    expected_source_kind: str | None = None,
) -> str:
    """Lock and return one archive entry's authoritative source kind.

    The row lock is transaction-scoped. Callers use this at their loader entry
    boundary so a missing or contradictory archive cannot be caught after
    election/category/jurisdiction writes and then accidentally committed.
    """
    with conn.cursor() as cur:
        # SHARE conflicts with UPDATE's NO KEY UPDATE row lock, so even a
        # non-key source_kind change waits until the caller commits or rolls back.
        # Lock only this archive row; unrelated archive entries remain writable.
        cur.execute(
            "select source_kind from archive_entry where id = %s for share",
            (archive_entry_id,),
        )
        archive_entry = cur.fetchone()

    if archive_entry is None:
        raise ArchiveEntryNotFoundError(
            f"archive_entry {archive_entry_id!r} does not exist; "
            "refusing before mutating loader projections"
        )

    authoritative_source_kind = archive_entry[0]
    if expected_source_kind is not None and expected_source_kind != authoritative_source_kind:
        raise ArchiveEntrySourceKindMismatchError(
            f"archive_entry {archive_entry_id!r} has authoritative "
            f"source_kind={authoritative_source_kind!r}, but the loader requires "
            f"source_kind={expected_source_kind!r}; refusing before mutating loader projections"
        )
    return authoritative_source_kind


_JURISDICTION_NAME_FIELDS: tuple[tuple[str, str], ...] = (
    ("distrito", "distrito_name"),
    ("seccion", "seccion_name"),
    ("circuito", "circuito_name"),
    ("establecimiento", "establecimiento_name"),
)
_JURISDICTION_WRITER_LOCK_SQL = "LOCK TABLE jurisdiction IN SHARE ROW EXCLUSIVE MODE"


def _lock_jurisdiction_writer(conn, cur) -> None:
    """Serialize jurisdiction writers until their caller commits or rolls back.

    Both jurisdiction entrypoints require a transaction-capable, non-autocommit
    connection. PostgreSQL table locks are transaction-scoped; an autocommit
    connection cannot retain this lock across the lineage read and write.
    """
    if getattr(conn, "autocommit", False):
        raise RuntimeError(
            "jurisdiction writers require a transaction; autocommit connections are unsupported"
        )
    cur.execute(_JURISDICTION_WRITER_LOCK_SQL)


def _lineage_shape(key: tuple[str, str | None, str | None, str | None, int | None]) -> str:
    levels = ("distrito", "seccion", "circuito", "establecimiento", "mesa")
    populated = [level for level, value in zip(levels, key) if value is not None]
    return f"exact {'/'.join(populated)} lineage"


def _merge_jurisdiction_names(
    existing: JurisdictionNames,
    incoming: JurisdictionNames,
    *,
    lineage_shape: str,
) -> JurisdictionNames:
    """Fill NULL names and reject different non-NULL evidence without leaking values."""
    merged: dict[str, str | None] = {}
    conflicting_columns: list[str] = []
    for field_name, column_name in _JURISDICTION_NAME_FIELDS:
        existing_value = getattr(existing, field_name)
        incoming_value = getattr(incoming, field_name)
        if (
            existing_value is not None
            and incoming_value is not None
            and existing_value != incoming_value
        ):
            conflicting_columns.append(column_name)
        merged[field_name] = existing_value if existing_value is not None else incoming_value

    if conflicting_columns:
        raise JurisdictionNameConflictError(
            f"jurisdiction name conflict for {lineage_shape}; conflicting field(s): "
            f"{', '.join(conflicting_columns)}; refusing to overwrite authoritative metadata"
        )
    return JurisdictionNames(**merged)


@dataclass(frozen=True)
class TableReplacementCount:
    loaded: int
    deleted: int
    operation: Literal["replacement", "no-op"] = "replacement"

    def __post_init__(self) -> None:
        if self.loaded < 0 or self.deleted < 0:
            raise ValueError("replacement counts must be non-negative")
        if self.operation == "no-op" and (self.loaded or self.deleted):
            raise ValueError("no-op table counts must both be zero")

    @property
    def deleted_by_reason(self) -> dict[str, int]:
        """Categorize the authoritative deletion total without duplicating it."""
        if self.operation == "no-op":
            return {}
        return {"absent_from_desired_projection": self.deleted}


@dataclass(frozen=True)
class PartyMapReplacementSummary:
    party_canonical: TableReplacementCount
    list_identity: TableReplacementCount
    party_mapping: TableReplacementCount


@dataclass(frozen=True)
class CrosswalkReplacementSummary:
    jurisdiction_crosswalk: TableReplacementCount
    mesa_crosswalk: TableReplacementCount


@dataclass(frozen=True)
class CuratedReplacementSummary:
    party_map: PartyMapReplacementSummary
    crosswalk: CrosswalkReplacementSummary


@dataclass(frozen=True)
class ArchiveEntryRecord:
    id: str
    capability: str
    source: str
    source_url: str
    archived_path: str
    sha256: str
    mime: str
    byte_count: int | None
    fetched_at: str
    status: str
    source_kind: str
    notes: str


def archive_entry_from_evidence(
    manifest_record: Mapping[str, object],
    source_entry: Mapping[str, object],
) -> ArchiveEntryRecord:
    """Map one hash-verified manifest record and its registered source once."""

    def registry_backed(field: str) -> object:
        manifest_value = manifest_record.get(field)
        source_value = source_entry.get(field)
        if field in manifest_record and manifest_value != source_value:
            raise ArchiveEntryConflictError(
                f"archive evidence conflict for {manifest_record.get('id')!r}: "
                f"manifest {field} does not match the registered source"
            )
        return manifest_value if field in manifest_record else source_value

    values = {
        field: registry_backed(field)
        for field in ("id", "capability", "source", "source_url", "mime")
    }
    for field, value in values.items():
        if not isinstance(value, str) or not value:
            raise ArchiveEntryConflictError(
                f"archive evidence for {manifest_record.get('id')!r} has no usable {field}"
            )
    notes = manifest_record["notes"] if "notes" in manifest_record else source_entry.get("notes")
    if not isinstance(notes, str):
        raise ArchiveEntryConflictError(
            f"archive evidence for {manifest_record.get('id')!r} has no usable notes"
        )

    status = manifest_record.get("status")
    if not isinstance(status, str) or status != "ok":
        raise ArchiveEntryConflictError(
            f"archive entry {values['id']!r} has status {status!r}; only verified ok entries ingest"
        )
    archived_path = manifest_record.get("archived_path")
    fetched_at = manifest_record.get("fetched_at")
    sha256 = manifest_record.get("sha256")
    if not isinstance(archived_path, str) or not archived_path:
        raise ArchiveEntryConflictError(f"archive entry {values['id']!r} has no archived_path")
    if not isinstance(fetched_at, str) or not fetched_at:
        raise ArchiveEntryConflictError(f"archive entry {values['id']!r} has no fetched_at")
    if (
        not isinstance(sha256, str)
        or len(sha256) != 64
        or any(character not in "0123456789abcdefABCDEF" for character in sha256)
    ):
        raise ArchiveEntryConflictError(f"archive entry {values['id']!r} has no valid sha256")

    byte_count = manifest_record.get("bytes")
    if byte_count is not None and (
        isinstance(byte_count, bool) or not isinstance(byte_count, int) or byte_count < 0
    ):
        raise ArchiveEntryConflictError(f"archive entry {values['id']!r} has invalid bytes")

    capability = str(values["capability"])
    expected_kind = "fiscalizacion" if capability == "fiscalizacion" else "official"
    for evidence_name, evidence in (
        ("manifest", manifest_record.get("source_kind", expected_kind)),
        ("registered source", source_entry.get("source_kind", expected_kind)),
    ):
        if evidence != expected_kind:
            raise ArchiveEntryConflictError(
                f"archive entry {values['id']!r} capability {capability!r} requires "
                f"source_kind {expected_kind!r}, but {evidence_name} declares {evidence!r}"
            )

    return ArchiveEntryRecord(
        id=str(values["id"]),
        capability=capability,
        source=str(values["source"]),
        source_url=str(values["source_url"]),
        archived_path=archived_path,
        sha256=sha256.lower(),
        mime=str(values["mime"]),
        byte_count=byte_count,
        fetched_at=fetched_at,
        status=status,
        source_kind=expected_kind,
        notes=notes,
    )


def project_archive_entry(conn, record: ArchiveEntryRecord) -> bool:
    """Insert immutable provenance once, reject conflicts, and synchronize mutable notes."""
    immutable_fields = (
        "capability",
        "source",
        "source_url",
        "archived_path",
        "sha256",
        "mime",
        "bytes",
        "fetched_at",
        "status",
        "source_kind",
    )
    immutable_values = (
        record.capability,
        record.source,
        record.source_url,
        record.archived_path,
        record.sha256,
        record.mime,
        record.byte_count,
        record.fetched_at,
        record.status,
        record.source_kind,
    )
    with conn.cursor() as cur:
        cur.execute(
            """
            select
              capability is not distinct from %s,
              source is not distinct from %s,
              source_url is not distinct from %s,
              archived_path is not distinct from %s,
              sha256 is not distinct from %s,
              mime is not distinct from %s,
              bytes is not distinct from %s,
              fetched_at is not distinct from %s::timestamptz,
              status is not distinct from %s,
              source_kind is not distinct from %s,
              notes is not distinct from %s
            from archive_entry
            where id = %s
            """,
            (*immutable_values, record.notes, record.id),
        )
        matches = cur.fetchone()
        if matches is not None:
            immutable_matches = matches[:-1]
            notes_match = matches[-1]
            conflicting_fields = [
                field
                for field, matches_field in zip(immutable_fields, immutable_matches)
                if not matches_field
            ]
            if conflicting_fields:
                raise ArchiveEntryConflictError(
                    f"archive_entry {record.id!r} conflicts on "
                    f"{', '.join(conflicting_fields)}; refusing to overwrite immutable provenance"
                )
            if not notes_match:
                cur.execute(
                    """
                    update archive_entry
                    set notes = %s
                    where id = %s
                    """,
                    (record.notes, record.id),
                )
            return False

        cur.execute(
            """
            insert into archive_entry (
              id, capability, source, source_url, archived_path, sha256,
              mime, bytes, fetched_at, status, source_kind, notes
            ) values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """,
            (record.id, *immutable_values, record.notes),
        )
    return True


@dataclass(frozen=True)
class ResultRowRecord:
    """One insert-ready `result_row` (all foreign keys already resolved).

    Deliberately flat and DB-shaped -- the mapping from a source-specific
    row type (`NationalRow`, `PbaRow`, ...) to this record is each
    ingestion entrypoint's job, not this module's.
    """

    election_id: str
    jurisdiction_id: str
    category_id: str
    granularity: str
    list_id: str | None
    votes: int
    source_kind: str
    archive_entry_id: str
    source_row_index: int
    requested_granularity: str | None = None
    # Phase 16a: `NATIVOS` | `EXTRANJEROS` | `None` (source column absent or
    # row not at mesa granularity) -- see migration 0011.
    mesa_tipo: str | None = None


def upsert_election(conn, *, year: int, round_: str) -> str:
    """Resolve or create the `election` row for `(year, round)`.

    `election` has no nullable columns in its unique key, so a plain
    `ON CONFLICT` upsert is safe (unlike `upsert_jurisdiction` below).
    """
    with conn.cursor() as cur:
        cur.execute(
            """
            insert into election (year, round) values (%s, %s)
            on conflict (year, round) do update set round = excluded.round
            returning id
            """,
            (year, round_),
        )
        return cur.fetchone()[0]


def upsert_category(conn, *, name: str) -> str:
    """Resolve or create the `category` row for the raw source category
    name (`jurisdiction-model`: kept verbatim, never mapped to an enum).
    """
    with conn.cursor() as cur:
        cur.execute(
            """
            insert into category (name) values (%s)
            on conflict (name) do update set name = excluded.name
            returning id
            """,
            (name,),
        )
        return cur.fetchone()[0]


def upsert_jurisdiction(
    conn,
    *,
    distrito: str,
    seccion: str | None = None,
    circuito: str | None = None,
    establecimiento: str | None = None,
    mesa: int | None = None,
    names: JurisdictionNames | None = None,
) -> str:
    """Resolve or create the `jurisdiction` row for one lineage tuple.

    `jurisdiction`'s unique constraint spans four NULLABLE columns
    (`seccion_code`, `circuito_code`, `establecimiento_code`, `mesa_code` --
    coarser rows legitimately leave the finer ones `NULL` per the
    jurisdiction-model's no-fabrication rule). Postgres treats `NULL` as
    never equal to `NULL` for unique-constraint conflict detection, so a
    plain `ON CONFLICT (...)` upsert silently INSERTS A DUPLICATE every time
    for any row with a `NULL` in that key (discovered running this against
    real Postgres for the first time in Phase 8) -- it would defeat D8's
    idempotency for every PBA distrito-level row, which has all four `NULL`.
    A `SELECT ... IS NOT DISTINCT FROM` lookup treats `NULL = NULL` as a
    match, so it is used here instead of `ON CONFLICT`.

    Phase 17: this is the single normalization boundary every writer funnels
    through -- `distrito`/`seccion` are canonicalized to the curated,
    zero-padded form (`etl.jurisdiction.normalize_distrito_code` /
    `normalize_seccion_code`) BEFORE the lookup or insert, so a caller that
    still passes national ingestion's raw unpadded `"2"`/`"27"` resolves to
    the SAME row as fiscalización's already-padded `"02"`/`"027"` instead of
    creating a second, format-only duplicate.

    The writer takes a transaction-scoped table lock before its lineage
    lookup. Callers must use a non-autocommit connection and finish the
    surrounding transaction; repeated calls in that transaction safely
    reacquire the same lock.
    """
    distrito = normalize_distrito_code(distrito)
    seccion = normalize_seccion_code(seccion)
    # Circuito goes through the boundary too. Leaving it out meant
    # `jurisdiction.py` declared itself the single normalization boundary while
    # one of its three codes was written raw, forcing every reader to
    # compensate — two independent ideas of the same code, which is what
    # produced Coronel Rosales as three identities.
    circuito = normalize_circuito_code(circuito)
    key = (distrito, seccion, circuito, establecimiento, mesa)
    incoming_names = names or JurisdictionNames()
    with conn.cursor() as cur:
        _lock_jurisdiction_writer(conn, cur)
        cur.execute(
            """
            select id, distrito_name, seccion_name, circuito_name, establecimiento_name
            from jurisdiction
            where distrito_code = %s
              and seccion_code is not distinct from %s
              and circuito_code is not distinct from %s
              and establecimiento_code is not distinct from %s
              and mesa_code is not distinct from %s
            """,
            key,
        )
        found = cur.fetchone()
        if found is not None:
            jurisdiction_id = found[0]
            existing_names = JurisdictionNames(
                distrito=found[1],
                seccion=found[2],
                circuito=found[3],
                establecimiento=found[4],
            )
            merged_names = _merge_jurisdiction_names(
                existing_names,
                incoming_names,
                lineage_shape=_lineage_shape(key),
            )
            if merged_names != existing_names:
                cur.execute(
                    """
                    update jurisdiction
                    set distrito_name = %s,
                        seccion_name = %s,
                        circuito_name = %s,
                        establecimiento_name = %s
                    where id = %s
                    """,
                    (
                        merged_names.distrito,
                        merged_names.seccion,
                        merged_names.circuito,
                        merged_names.establecimiento,
                        jurisdiction_id,
                    ),
                )
            return jurisdiction_id

        cur.execute(
            """
            insert into jurisdiction (
                distrito_code, seccion_code, circuito_code, establecimiento_code, mesa_code,
                distrito_name, seccion_name, circuito_name, establecimiento_name
            ) values (%s, %s, %s, %s, %s, %s, %s, %s, %s)
            returning id
            """,
            (
                *key,
                incoming_names.distrito,
                incoming_names.seccion,
                incoming_names.circuito,
                incoming_names.establecimiento,
            ),
        )
        return cur.fetchone()[0]


class _OfficialJurisdictionCursor(Protocol):
    """Typed view of the one database query used to resolve official mesas."""

    def __enter__(self) -> _OfficialJurisdictionCursor: ...

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc_value: BaseException | None,
        traceback: TracebackType | None,
    ) -> bool | None: ...

    def execute(
        self,
        query: str,
        params: tuple[str, str | None, int, str],
    ) -> object: ...

    def fetchall(self) -> Sequence[tuple[object, str | None]]: ...


class _OfficialJurisdictionConnection(Protocol):
    def cursor(self) -> _OfficialJurisdictionCursor: ...


def official_jurisdictions_for_mesa(
    conn: _OfficialJurisdictionConnection,
    *,
    election_id: str,
    distrito: str,
    seccion: str,
    mesa: int,
) -> list[tuple[str, str | None]]:
    """Every jurisdiction row the OFFICIAL import created for one mesa number,
    as `(id, circuito_code)` ordered by circuito.

    A mesa NUMBER does not identify a mesa: within one partido the same
    `mesa_code` appears under more than one circuito (8 of the 93 fiscalización
    mesas, against the live 2025 national import). Callers must decide, and
    the only honest decisions are "exactly one" or "refuse".
    """
    # NORMALIZED, like `upsert_jurisdiction` right above. A reader on the same
    # table skipping the single boundary is normalization per call site — what
    # produced Coronel Rosales as three identities. `load_fiscalizacion_rows`
    # takes distrito/seccion as kwargs, so a caller passing national
    # ingestion's unpadded "2"/"27" (which the 2023 file really carries) would
    # match zero rows and every mesa would be quarantined as absent from the
    # official import: a padding problem reported as a data problem.
    distrito = normalize_distrito_code(distrito)
    seccion = normalize_seccion_code(seccion)
    with conn.cursor() as cur:
        cur.execute(
            """
            select j.id, j.circuito_code
            from jurisdiction j
            where j.distrito_code is not distinct from %s
              -- `is not distinct from`, not `=`. `normalize_seccion_code`
              -- returns `None` for an absent seccion, and Postgres never
              -- treats NULL as equal to NULL, so plain equality matched ZERO rows for
              -- a null-seccion mesa: every such mesa would be quarantined as
              -- "absent from the official import" while its jurisdiction sat
              -- right there. `_resolve_official_mesa` already anticipates a
              -- null seccion in its own subject_ref, so the caller expects
              -- what this predicate could not answer. Same NULL semantics
              -- `upsert_jurisdiction` uses on this table.
              and j.seccion_code is not distinct from %s
              and j.mesa_code = %s
              and j.circuito_code is not null
              and exists (
                select 1
                from result_row rr
                where rr.jurisdiction_id = j.id
                  and rr.election_id = %s
                  and rr.source_kind = 'official'
              )
            order by j.circuito_code
            """,
            (distrito, seccion, mesa, election_id),
        )
        return [(str(row[0]), row[1]) for row in cur.fetchall()]


JurisdictionKey = tuple[str, str | None, str | None, str | None, int | None]
"""`(distrito, seccion, circuito, establecimiento, mesa)` -- the same
lineage tuple `upsert_jurisdiction` resolves one at a time."""


# One definition of the NULL-safe lineage key, used by every large join that
# would otherwise need four `IS NOT DISTINCT FROM` predicates (rule 10).
# Each component is tagged as NULL (`N`) or present (`P...`) BEFORE escaping
# backslashes and separators. This preserves the semantic difference between
# SQL NULL and an empty string while keeping one reversible, hash-joinable key.
def _tagged_escape_sql(column: LiteralString) -> LiteralString:
    """Encode one SQL value exactly like `merge_key`'s Python helper."""
    return (
        f"case when {column} is null then 'N' else "
        f"replace(replace('P' || {column}::text, '\\', '\\\\'), '|', '\\|') end"
    )


# EVERY component uses the same encoding, including integer `mesa_code`.
# Text fields may contain either reserved character; tagging and escaping the
# complete component makes the concatenation injective without changing the
# parameterized runtime values or the hash-join query shape.
MERGE_KEY_SQL: LiteralString = (
    f"{_tagged_escape_sql('j.distrito_code')} || '|'"
    f" || {_tagged_escape_sql('j.seccion_code')} || '|'"
    f" || {_tagged_escape_sql('j.circuito_code')} || '|'"
    f" || {_tagged_escape_sql('j.establecimiento_code')} || '|'"
    f" || {_tagged_escape_sql('j.mesa_code')}"
)


def merge_key(
    distrito: str | None,
    seccion: str | None,
    circuito: str | None,
    establecimiento: str | None,
    mesa: int | None,
) -> str:
    """Python side of `MERGE_KEY_SQL` -- the two MUST agree character for
    character, which is why they live next to each other.

    Every component is tagged NULL/present before escaping, matching the SQL.
    The tag is part of the escaped component, so `None`, `""`, separators, and
    backslashes all retain distinct reversible encodings.
    """

    def encode(value: str | int | None) -> str:
        tagged = "N" if value is None else f"P{value}"
        return tagged.replace("\\", "\\\\").replace("|", "\\|")

    return "|".join(
        (
            encode(distrito),
            encode(seccion),
            encode(circuito),
            encode(establecimiento),
            encode(mesa),
        )
    )


def batch_upsert_jurisdictions(
    conn,
    keys: Sequence[JurisdictionKey],
    *,
    names: Sequence[JurisdictionNames] | None = None,
) -> dict[JurisdictionKey, str]:
    """Resolve or create every `jurisdiction` row for a batch of lineage
    tuples in a bounded number of round trips, instead of one SELECT-then-INSERT
    round trip per distinct tuple (task 14.4/14.5 -- ~109k distinct mesas,
    5m53s at real national 2025 scale, measured in
    `spikes/003-first-end-to-end-run.md`; `load_national_rows`'s per-call
    cache only avoids a REPEAT round trip for an already-seen mesa within
    the same run, so the first occurrence of each distinct mesa still cost
    one synchronous SELECT immediately followed by one INSERT on a
    cache miss).

    Preserves `upsert_jurisdiction`'s `IS NOT DISTINCT FROM` NULL semantics
    exactly: migration 0002's unique key spans four NULLABLE columns, and
    Postgres never considers `NULL = NULL` for a plain `ON CONFLICT` --
    every row with a `NULL` in that key (e.g. every PBA distrito-level row,
    which has all four `NULL`) would otherwise be duplicated on every call,
    the exact bug `upsert_jurisdiction`'s docstring already documents.

    Returns a mapping from EVERY key in `keys`, AS PASSED BY THE CALLER
    (order-preserving de-dup happens internally), to its resolved
    `jurisdiction.id` -- so an existing caller that still indexes the
    returned dict by its own original (possibly unpadded) key keeps working
    unchanged.

    Phase 17: `distrito`/`seccion` are canonicalized to the curated,
    zero-padded form (same normalization boundary as `upsert_jurisdiction`
    above) for every round trip below, so `("2", "27", ...)` and
    `("02", "027", ...)` resolve to the SAME `jurisdiction` row instead of
    two rows for what is the same real mesa. The ORIGINAL, un-normalized
    keys are what the returned mapping is keyed by.

    Like the single writer, this function requires a non-autocommit
    connection and holds one shared transaction-scoped writer lock until
    the caller commits or rolls back. The lock adds one round trip; lineage
    resolution and insertion remain bulk operations.
    """
    original_keys = list(keys)
    incoming_names = [JurisdictionNames() for _ in original_keys] if names is None else list(names)
    if len(incoming_names) != len(original_keys):
        raise ValueError("batch jurisdiction names must align one-for-one with lineage keys")

    normalized_keys = [
        (
            normalize_distrito_code(distrito),
            normalize_seccion_code(seccion),
            normalize_circuito_code(circuito),
            establecimiento,
            mesa,
        )
        for distrito, seccion, circuito, establecimiento, mesa in original_keys
    ]
    distinct_keys = list(dict.fromkeys(normalized_keys))
    if not distinct_keys:
        return {}

    # Merge duplicate normalized lineages field by field. Complementary NULL/
    # non-NULL metadata combines; different non-NULL evidence refuses instead
    # of whichever row happened to appear first or last winning silently.
    names_by_normalized_key: dict[JurisdictionKey, JurisdictionNames] = {}
    for normalized_key, row_names in zip(normalized_keys, incoming_names):
        previous = names_by_normalized_key.get(normalized_key)
        names_by_normalized_key[normalized_key] = (
            row_names
            if previous is None
            else _merge_jurisdiction_names(
                previous,
                row_names,
                lineage_shape=_lineage_shape(normalized_key),
            )
        )

    distritos = [key[0] for key in distinct_keys]
    seccions = [key[1] for key in distinct_keys]
    circuitos = [key[2] for key in distinct_keys]
    establecimientos = [key[3] for key in distinct_keys]
    mesas = [key[4] for key in distinct_keys]

    resolved: dict[JurisdictionKey, str] = {}
    missing: list[JurisdictionKey] = []

    with conn.cursor() as cur:
        _lock_jurisdiction_writer(conn, cur)
        # Round trip 1 -- resolve every tuple that already has a
        # `jurisdiction` row. `unnest(...) with ordinality` expands the
        # five parallel arrays back into one row per input tuple (matching
        # by NULL-safe `IS NOT DISTINCT FROM`, not `=`), so a single query
        # replaces one SELECT per distinct tuple.
        # ONE NULL-safe text key (`merge_key` / `MERGE_KEY_SQL` above), not
        # four `is not distinct from` predicates: across several nullable
        # columns that is not hash-joinable and degrades to a nested loop,
        # which at this call site's ~109k distinct mesas is the shape rule 10
        # warns about.
        merge_keys = [merge_key(*key) for key in distinct_keys]
        resolve_existing = sql.SQL(
            """
            select v.distrito, v.seccion, v.circuito, v.establecimiento, v.mesa,
                   j.id, j.distrito_name, j.seccion_name,
                   j.circuito_name, j.establecimiento_name
            from unnest(%s::text[], %s::text[], %s::text[], %s::text[], %s::int[],
                        %s::text[])
                 with ordinality as v(distrito, seccion, circuito, establecimiento, mesa,
                                      merge_key, idx)
            left join jurisdiction j
              on {} = v.merge_key
            order by v.idx
            """
        ).format(sql.SQL(MERGE_KEY_SQL))
        cur.execute(
            resolve_existing,
            (distritos, seccions, circuitos, establecimientos, mesas, merge_keys),
        )
        # A `left join` yields ONE ROW PER MATCH, so a tuple with two
        # `jurisdiction` rows comes back twice. Assigning straight into
        # `resolved` would keep whichever arrived last and say nothing --
        # rule 4's silent pick. Duplicates for exactly these NULL-bearing keys
        # are not hypothetical: this docstring records that the pre-Phase-8
        # `ON CONFLICT` inserted one on every call for any key with a NULL.
        # Collect the distinct ids per key and refuse when there is more
        # than one, the way `apply_mesa_tipo_mapping` refuses a mesa with two
        # tipos.
        matches: dict[JurisdictionKey, set[str]] = {}
        existing_names: dict[JurisdictionKey, JurisdictionNames] = {}
        for (
            distrito,
            seccion,
            circuito,
            establecimiento,
            mesa,
            jurisdiction_id,
            distrito_name,
            seccion_name,
            circuito_name,
            establecimiento_name,
        ) in cur.fetchall():
            key = (distrito, seccion, circuito, establecimiento, mesa)
            if jurisdiction_id is None:
                missing.append(key)
            else:
                matches.setdefault(key, set()).add(jurisdiction_id)
                existing_names[key] = JurisdictionNames(
                    distrito=distrito_name,
                    seccion=seccion_name,
                    circuito=circuito_name,
                    establecimiento=establecimiento_name,
                )

        ambiguous = {key: ids for key, ids in matches.items() if len(ids) > 1}
        if ambiguous:
            key, ids = next(iter(sorted(ambiguous.items())))
            raise RuntimeError(
                f"{len(ambiguous)} lineage tuple(s) match more than one jurisdiction "
                f"row; refusing to pick one arbitrarily. First: {key} -> "
                f"{sorted(ids)}"
            )
        for key, ids in matches.items():
            resolved[key] = next(iter(ids))

        pending_name_updates: list[tuple[str, JurisdictionNames]] = []
        for key, incoming in names_by_normalized_key.items():
            existing = existing_names.get(key)
            if existing is None:
                continue
            merged = _merge_jurisdiction_names(
                existing,
                incoming,
                lineage_shape=_lineage_shape(key),
            )
            if merged != existing:
                pending_name_updates.append((resolved[key], merged))

        # Round trip 2 -- bulk-insert every tuple with no existing row.
        # Safe without `ON CONFLICT`: `missing` is already de-duplicated
        # (derived from `distinct_keys` above, itself de-duplicated), and
        # the shared transaction-scoped lock excludes every competing
        # jurisdiction writer until this caller commits or rolls back.
        if missing:
            cur.execute(
                """
                insert into jurisdiction (
                    distrito_code, seccion_code, circuito_code, establecimiento_code, mesa_code,
                    distrito_name, seccion_name, circuito_name, establecimiento_name
                )
                select * from unnest(%s::text[], %s::text[], %s::text[], %s::text[], %s::int[],
                                     %s::text[], %s::text[], %s::text[], %s::text[])
                returning distrito_code, seccion_code, circuito_code, establecimiento_code,
                          mesa_code, id
                """,
                (
                    [key[0] for key in missing],
                    [key[1] for key in missing],
                    [key[2] for key in missing],
                    [key[3] for key in missing],
                    [key[4] for key in missing],
                    [names_by_normalized_key[key].distrito for key in missing],
                    [names_by_normalized_key[key].seccion for key in missing],
                    [names_by_normalized_key[key].circuito for key in missing],
                    [names_by_normalized_key[key].establecimiento for key in missing],
                ),
            )
            for (
                distrito,
                seccion,
                circuito,
                establecimiento,
                mesa,
                jurisdiction_id,
            ) in cur.fetchall():
                resolved[(distrito, seccion, circuito, establecimiento, mesa)] = jurisdiction_id

        if pending_name_updates:
            cur.executemany(
                """
                update jurisdiction
                set distrito_name = %s,
                    seccion_name = %s,
                    circuito_name = %s,
                    establecimiento_name = %s
                where id = %s
                """,
                [
                    (
                        row_names.distrito,
                        row_names.seccion,
                        row_names.circuito,
                        row_names.establecimiento,
                        jurisdiction_id,
                    )
                    for jurisdiction_id, row_names in pending_name_updates
                ],
            )

    return {
        original_key: resolved[normalized_key]
        for original_key, normalized_key in zip(original_keys, normalized_keys)
    }


def load_result_rows(
    conn,
    *,
    archive_entry_id: str,
    records: Sequence[ResultRowRecord],
    election_id: str,
) -> int:
    """D8's idempotent load: delete every existing `result_row` for
    `archive_entry_id`, then bulk-insert `records`, in the caller's
    currently open transaction.

    Calling this twice with the same `archive_entry_id` and an identical
    `records` sequence leaves `result_row` in the same state both times
    (task 8.2) -- the delete makes re-ingestion safe regardless of how many
    times, or in what order relative to other archive entries, it runs.
    Truncating `result_row` and calling this again reproduces the same
    projection (task 8.3, "rebuild = truncate + replay"). Before either
    mutation, the referenced `archive_entry` must exist and any non-empty
    batch must exactly match its authoritative `source_kind`.
    """
    # The election is a PARAMETER, not inferred from the surviving rows. The
    # empty-`records` branch used to fall back to an UNSCOPED delete, so a
    # source that now parses to nothing — every mesa ambiguous, a sheet
    # re-exported empty — wiped every OTHER election's rows sharing the entry.
    # That is the exact hazard the scoped branch's own comment describes, and
    # the empty case is the one that cannot state its scope from its rows.
    # EXACTLY the declared election, and every record must belong to it.
    # Unioning the records' own elections into the delete scope let a caller
    # widen the blast radius without saying so: one stray record carrying a
    # different election silently deleted that OTHER election's rows for this
    # archive entry. The scope a caller declares is the scope it gets, and a
    # record outside it is refused rather than quietly expanding it.
    foreign = sorted({r.election_id for r in records} - {election_id})
    if foreign:
        raise ValueError(
            f"load_result_rows was given election_id={election_id!r} but "
            f"{len(foreign)} record(s) carry a different election "
            f"({', '.join(foreign)}); refusing rather than widening the delete scope"
        )

    foreign_archive_entries = sorted(
        {record.archive_entry_id for record in records} - {archive_entry_id}
    )
    if foreign_archive_entries:
        raise ValueError(
            f"load_result_rows expected archive_entry_id={archive_entry_id!r} but "
            "record(s) carry offending archive_entry_id(s) "
            f"{', '.join(repr(value) for value in foreign_archive_entries)}; "
            "refusing before deleting or inserting rows"
        )

    source_kinds = sorted({record.source_kind for record in records})
    if len(source_kinds) > 1:
        raise MixedSourceKindBatchError(
            "load_result_rows requires one source_kind per replacement batch; "
            f"received {', '.join(source_kinds)}; refusing before deleting or inserting rows"
        )

    lock_archive_entry_source_authority(
        conn,
        archive_entry_id=archive_entry_id,
        expected_source_kind=source_kinds[0] if source_kinds else None,
    )

    with conn.cursor() as cur:
        # Scoped by election, not just by archive entry: one archived file may
        # hold several elections (the PBA open-data catalogue publishes
        # 2005-2023 in a single CSV), and an unscoped delete would wipe every
        # other election's rows that share the entry. ALWAYS scoped now — there
        # is no records-derived fallback to lose the scope in.
        cur.execute(
            "delete from result_row where archive_entry_id = %s and election_id = %s",
            (archive_entry_id, election_id),
        )
        if records:
            cur.executemany(
                """
                insert into result_row (
                    election_id, jurisdiction_id, category_id, granularity,
                    requested_granularity,
                    list_id, votes, source_kind,
                    archive_entry_id, source_row_index, mesa_tipo
                ) values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                [
                    (
                        record.election_id,
                        record.jurisdiction_id,
                        record.category_id,
                        record.granularity,
                        record.requested_granularity,
                        record.list_id,
                        record.votes,
                        record.source_kind,
                        record.archive_entry_id,
                        record.source_row_index,
                        record.mesa_tipo,
                    )
                    for record in records
                ],
            )
    return len(records)


def load_party_map_rows(conn, table: PartyMappingTable) -> PartyMapReplacementSummary:
    """Load `curated/party_map.yaml` (already parsed into `table` by
    `etl.party_map.load_party_map`) into `party_canonical`, `list_identity`
    and `party_mapping` (Phase 15, tasks 15.1-15.5).

    Idempotent by plain `ON CONFLICT` upsert -- unlike `upsert_jurisdiction`,
    none of these three tables' natural keys contain a nullable column
    (`party_canonical.id` is a `text primary key`; `list_identity` and
    `party_mapping` both key on `(year, jurisdiction, category, list_id)`,
    all `not null`), so Postgres's `NULL <> NULL` upsert pitfall documented
    on `upsert_jurisdiction` does not apply here.

    `party_canonical` is projected solely from the explicit canonical parent
    declarations. Mapping `party_name` values remain exact source spellings and
    feed only `list_identity.source_name`; their order can never select or
    update a canonical display label.
    """
    with conn.cursor() as cur:
        for declaration in table.canonical_parties:
            cur.execute(
                """
                insert into party_canonical (id, display_name)
                values (%s, %s)
                on conflict (id) do update set display_name = excluded.display_name
                """,
                (declaration.id, declaration.display_name),
            )

        for entry in table.entries:
            cur.execute(
                """
                insert into list_identity (year, jurisdiction, category, list_id, source_name)
                values (%s, %s, %s, %s, %s)
                on conflict (year, jurisdiction, category, list_id)
                do update set source_name = excluded.source_name
                """,
                (entry.year, entry.jurisdiction, entry.category, entry.list_id, entry.party_name),
            )
            cur.execute(
                """
                insert into party_mapping (
                    year, jurisdiction, category, list_id, canonical_party_id, verified, source
                ) values (%s, %s, %s, %s, %s, %s, %s)
                on conflict (year, jurisdiction, category, list_id)
                do update set
                    canonical_party_id = excluded.canonical_party_id,
                    verified = excluded.verified,
                    source = excluded.source
                """,
                (
                    entry.year,
                    entry.jurisdiction,
                    entry.category,
                    entry.list_id,
                    entry.canonical_party,
                    entry.verified,
                    entry.source,
                ),
            )

        desired_keys = [
            (entry.year, entry.jurisdiction, entry.category, entry.list_id)
            for entry in table.entries
        ]
        key_parameters = (
            [key[0] for key in desired_keys],
            [key[1] for key in desired_keys],
            [key[2] for key in desired_keys],
            [key[3] for key in desired_keys],
        )
        cur.execute(
            sql.SQL(
                """
                delete from party_mapping as current
                where not exists (
                    select 1
                    from unnest(%s::int[], %s::text[], %s::text[], %s::text[])
                         as desired(year, jurisdiction, category, list_id)
                    where desired.year = current.year
                      and desired.jurisdiction = current.jurisdiction
                      and desired.category = current.category
                      and desired.list_id = current.list_id
                )
                """
            ),
            key_parameters,
        )
        party_mapping_deleted = cur.rowcount
        cur.execute(
            sql.SQL(
                """
                delete from list_identity as current
                where not exists (
                    select 1
                    from unnest(%s::int[], %s::text[], %s::text[], %s::text[])
                         as desired(year, jurisdiction, category, list_id)
                    where desired.year = current.year
                      and desired.jurisdiction = current.jurisdiction
                      and desired.category = current.category
                      and desired.list_id = current.list_id
                )
                """
            ),
            key_parameters,
        )
        list_identity_deleted = cur.rowcount
        cur.execute(
            """
            delete from party_canonical as current
            where not exists (
                select 1 from unnest(%s::text[]) as desired(id)
                where desired.id = current.id
            )
            """,
            ([declaration.id for declaration in table.canonical_parties],),
        )
        party_canonical_deleted = cur.rowcount

    return PartyMapReplacementSummary(
        party_canonical=TableReplacementCount(
            loaded=len(table.canonical_parties),
            deleted=party_canonical_deleted,
        ),
        list_identity=TableReplacementCount(
            loaded=len(table.entries),
            deleted=list_identity_deleted,
        ),
        party_mapping=TableReplacementCount(
            loaded=len(table.entries),
            deleted=party_mapping_deleted,
        ),
    )


def load_crosswalk_rows(
    conn,
    table: CrosswalkTable,
    mesa_stabilities: Sequence[tuple[str, str, MesaStability]] | None = None,
) -> CrosswalkReplacementSummary:
    """Load `curated/crosswalk.yaml` (already parsed into `table` by
    `etl.crosswalk.load_crosswalk`) into `jurisdiction_crosswalk`, plus any
    supplied per-mesa stability records into `mesa_crosswalk` (Phase 15,
    tasks 15.6-15.8).

    `mesa_stabilities` is `(distrito_code, seccion_code, MesaStability)`
    triples. `MesaStability` carries the exact normalized circuito/mesa pair;
    the caller supplies its distrito/seccion scope. Omitting the projection
    leaves `mesa_crosswalk` unchanged; supplying any sequence, including an
    explicit empty sequence, replaces it in full. `compute_mesa_stability` MUST
    NOT default a code to "stable" (jurisdiction-model spec); this loader does
    not recompute stability, it only persists whatever the caller computed.

    Idempotent by plain `ON CONFLICT`: `jurisdiction_crosswalk` keys on
    `pba_distrito_code` (not null, migration 0003) and `mesa_crosswalk` keys on
    `(distrito_code, seccion_code, circuito_code, mesa_code)`.
    """
    with conn.cursor() as cur:
        for jurisdiction in table.jurisdictions:
            cur.execute(
                """
                insert into jurisdiction_crosswalk (
                    pba_distrito_code, national_distrito_code, national_seccion_code, name
                ) values (%s, %s, %s, %s)
                on conflict (pba_distrito_code) do update set
                    national_distrito_code = excluded.national_distrito_code,
                    national_seccion_code = excluded.national_seccion_code,
                    name = excluded.name
                """,
                (
                    # Through the SAME boundary as `jurisdiction`. A curated
                    # file writing `national_seccion: "27"` would otherwise key
                    # `jurisdiction_crosswalk` on `"27"` while `jurisdiction`
                    # holds `"027"` -- the same real place under two identities
                    # joined by nothing, one table over from where it already
                    # happened. `pba_distrito_code` is deliberately NOT
                    # normalized: it belongs to PBA's own scheme, where `"027"`
                    # is a partido, and padding it to a national width is the
                    # scheme collision this crosswalk exists to translate.
                    jurisdiction.pba_distrito_code,
                    normalize_distrito_code(jurisdiction.national_distrito_code),
                    normalize_seccion_code(jurisdiction.national_seccion_code),
                    jurisdiction.name,
                ),
            )

        normalized_mesa_stabilities = (
            []
            if mesa_stabilities is None
            else [
                (
                    normalize_distrito_code(distrito_code),
                    normalize_seccion_code(seccion_code),
                    normalize_circuito_code(stability.circuito),
                    stability,
                )
                for distrito_code, seccion_code, stability in mesa_stabilities
            ]
        )
        for distrito_code, seccion_code, circuito_code, stability in normalized_mesa_stabilities:
            cur.execute(
                """
                insert into mesa_crosswalk (
                    distrito_code, seccion_code, circuito_code, mesa_code,
                    present_2023, present_2025, stable_across_years
                ) values (%s, %s, %s, %s, %s, %s, %s)
                on conflict (distrito_code, seccion_code, circuito_code, mesa_code)
                do update set
                    present_2023 = excluded.present_2023,
                    present_2025 = excluded.present_2025,
                    stable_across_years = excluded.stable_across_years
                """,
                (
                    distrito_code,
                    seccion_code,
                    circuito_code,
                    stability.mesa,
                    stability.present_2023,
                    stability.present_2025,
                    stability.stable,
                ),
            )

        cur.execute(
            """
            delete from jurisdiction_crosswalk as current
            where not exists (
                select 1 from unnest(%s::text[]) as desired(pba_distrito_code)
                where desired.pba_distrito_code = current.pba_distrito_code
            )
            """,
            ([entry.pba_distrito_code for entry in table.jurisdictions],),
        )
        jurisdiction_crosswalk_deleted = cur.rowcount
        if mesa_stabilities is None:
            mesa_crosswalk_deleted = 0
        else:
            cur.execute(
                """
                delete from mesa_crosswalk as current
                where not exists (
                    select 1
                    from unnest(%s::text[], %s::text[], %s::text[], %s::int[])
                         as desired(distrito_code, seccion_code, circuito_code, mesa_code)
                    where desired.distrito_code = current.distrito_code
                      and desired.seccion_code = current.seccion_code
                      and desired.circuito_code = current.circuito_code
                      and desired.mesa_code = current.mesa_code
                )
                """,
                (
                    [row[0] for row in normalized_mesa_stabilities],
                    [row[1] for row in normalized_mesa_stabilities],
                    [row[2] for row in normalized_mesa_stabilities],
                    [row[3].mesa for row in normalized_mesa_stabilities],
                ),
            )
            mesa_crosswalk_deleted = cur.rowcount

    return CrosswalkReplacementSummary(
        jurisdiction_crosswalk=TableReplacementCount(
            loaded=len(table.jurisdictions),
            deleted=jurisdiction_crosswalk_deleted,
        ),
        mesa_crosswalk=TableReplacementCount(
            loaded=len(normalized_mesa_stabilities),
            deleted=mesa_crosswalk_deleted,
            operation="no-op" if mesa_stabilities is None else "replacement",
        ),
    )


def insert_review_items(conn, records: Sequence[ReviewItemRecord]) -> int:
    """Insert observations that are not already active and return the inserted count.

    Active observation identity is the NULL-safe textual tuple plus its closed,
    exact structured section scope, with `resolved_at is null`. Replaying an
    identical active observation is an explicitly idempotent, already-active
    suppression, including duplicates inside one input batch. A resolved row is
    history, not active identity, so an identical recurrence inserts a new row.

    The transaction-scoped advisory lock serializes every application writer
    through the lookup-and-insert statement. Correctness requires PostgreSQL READ
    COMMITTED so a writer that waited for the lock receives a fresh statement
    snapshot and sees the prior writer's commit. Callers must commit or roll back
    the non-autocommit transaction; the function verifies the server's actual
    current transaction isolation and never changes it. The return value counts
    only rows actually inserted, never the input length.
    """
    records = tuple(records)
    if not records:
        return 0
    for record in records:
        validate_review_item_kind(record.kind)
    records = tuple(dict.fromkeys(records))
    if getattr(conn, "autocommit", False):
        raise RuntimeError(
            "review item writers require a transaction; autocommit connections are unsupported"
        )

    with conn.cursor() as cur:
        cur.execute("show transaction_isolation")
        isolation_row = cur.fetchone()
        isolation = isolation_row[0] if isolation_row and len(isolation_row) == 1 else None
        if isolation != "read committed":
            observed = isolation if isolation is not None else "unknown"
            raise ReviewItemTransactionIsolationError(
                "review item insertion requires read committed transaction isolation; "
                f"PostgreSQL reports {observed!r}; refusing without changing isolation"
            )

        def candidate(record: ReviewItemRecord) -> dict[str, object]:
            projected: dict[str, object] = {
                "kind": record.kind,
                "severity": record.severity,
                "subject_ref": record.subject_ref,
                "note": record.note,
                "distrito_codes": [scope.distrito_code for scope in record.section_scopes],
                "seccion_codes": [scope.seccion_code for scope in record.section_scopes],
            }
            if record.context is not None:
                context = dict(record.context.__dict__)
                for identifier in ("election_id", "category_id"):
                    if isinstance(context[identifier], UUID):
                        context[identifier] = str(context[identifier])
                projected.update(context)
            return projected

        inserted = 0
        for explicit_context, function, context_columns in (
            (False, "record_review_item", ""),
            (
                True,
                "record_review_item_v2",
                ", context_role text, source_kind text, archive_availability text, "
                "election_year integer, election_id uuid, category_id uuid, archive_entry_id text",
            ),
        ):
            candidates = [
                candidate(record)
                for record in records
                if (record.context is not None) is explicit_context
            ]
            if not candidates:
                continue
            context_arguments = (
                ", context_role, source_kind, archive_availability, election_year, "
                "election_id, category_id, archive_entry_id"
                if explicit_context
                else ""
            )
            cur.execute(
                f"""
                with candidates as (
                    select distinct * from jsonb_to_recordset(%s::jsonb) as candidate(
                        kind text, severity text, subject_ref text, note text,
                        distrito_codes text[], seccion_codes text[]{context_columns}
                    )
                )
                select 1 from candidates where workspace_private.{function}(
                    kind, severity, subject_ref, note, distrito_codes, seccion_codes
                    {context_arguments}
                )
                """,
                (json.dumps(candidates),),
            )
            inserted += len(cur.fetchall())
        return inserted
