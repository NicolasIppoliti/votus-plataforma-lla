"""Postgres write layer for the normalized `result_row` projection (D8).

Ingestion parsers (`etl.ingest.national`, `etl.ingest.pba`, ...) stay pure
functions of archived bytes -- this module is the only place that opens a
Postgres connection and issues writes, so the idempotency contract lives in
one spot instead of being re-implemented per source.

D8: "Load runs in one transaction per archive entry: delete-by-
`archive_entry_id`, then bulk insert. Rebuild = truncate + replay."
`load_result_rows` implements exactly that pair of statements and nothing
else -- it does not commit; the caller controls the transaction boundary
(production ingestion commits after a successful load, tests roll back for
isolation between runs).
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

from etl.crosswalk import CrosswalkTable, MesaStability
from etl.party_map import PartyMappingTable
from etl.review_item import ReviewItemRecord


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
    is_unmapped: bool
    archive_entry_id: str
    source_row_index: int
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
    """
    with conn.cursor() as cur:
        cur.execute(
            """
            select id from jurisdiction
            where distrito_code = %s
              and seccion_code is not distinct from %s
              and circuito_code is not distinct from %s
              and establecimiento_code is not distinct from %s
              and mesa_code is not distinct from %s
            """,
            (distrito, seccion, circuito, establecimiento, mesa),
        )
        found = cur.fetchone()
        if found is not None:
            return found[0]

        cur.execute(
            """
            insert into jurisdiction (
                distrito_code, seccion_code, circuito_code, establecimiento_code, mesa_code
            ) values (%s, %s, %s, %s, %s)
            returning id
            """,
            (distrito, seccion, circuito, establecimiento, mesa),
        )
        return cur.fetchone()[0]


JurisdictionKey = tuple[str, str | None, str | None, str | None, int | None]
"""`(distrito, seccion, circuito, establecimiento, mesa)` -- the same
lineage tuple `upsert_jurisdiction` resolves one at a time."""


def batch_upsert_jurisdictions(conn, keys: Sequence[JurisdictionKey]) -> dict[JurisdictionKey, str]:
    """Resolve or create every `jurisdiction` row for a batch of lineage
    tuples in TWO round trips total, instead of one SELECT-then-INSERT
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

    Returns a mapping from EVERY key in `keys` (order-preserving de-dup
    happens internally) to its resolved `jurisdiction.id`.
    """
    distinct_keys = list(dict.fromkeys(keys))
    if not distinct_keys:
        return {}

    distritos = [key[0] for key in distinct_keys]
    seccions = [key[1] for key in distinct_keys]
    circuitos = [key[2] for key in distinct_keys]
    establecimientos = [key[3] for key in distinct_keys]
    mesas = [key[4] for key in distinct_keys]

    resolved: dict[JurisdictionKey, str] = {}
    missing: list[JurisdictionKey] = []

    with conn.cursor() as cur:
        # Round trip 1 -- resolve every tuple that already has a
        # `jurisdiction` row. `unnest(...) with ordinality` expands the
        # five parallel arrays back into one row per input tuple (matching
        # by NULL-safe `IS NOT DISTINCT FROM`, not `=`), so a single query
        # replaces one SELECT per distinct tuple.
        cur.execute(
            """
            select v.distrito, v.seccion, v.circuito, v.establecimiento, v.mesa, j.id
            from unnest(%s::text[], %s::text[], %s::text[], %s::text[], %s::int[])
                 with ordinality as v(distrito, seccion, circuito, establecimiento, mesa, idx)
            left join jurisdiction j
              on j.distrito_code = v.distrito
             and j.seccion_code is not distinct from v.seccion
             and j.circuito_code is not distinct from v.circuito
             and j.establecimiento_code is not distinct from v.establecimiento
             and j.mesa_code is not distinct from v.mesa
            order by v.idx
            """,
            (distritos, seccions, circuitos, establecimientos, mesas),
        )
        for distrito, seccion, circuito, establecimiento, mesa, jurisdiction_id in cur.fetchall():
            key = (distrito, seccion, circuito, establecimiento, mesa)
            if jurisdiction_id is not None:
                resolved[key] = jurisdiction_id
            else:
                missing.append(key)

        # Round trip 2 -- bulk-insert every tuple with no existing row.
        # Safe without `ON CONFLICT`: `missing` is already de-duplicated
        # (derived from `distinct_keys` above, itself de-duplicated), and
        # this is a single-writer batch load, never a concurrent upsert.
        if missing:
            cur.execute(
                """
                insert into jurisdiction (
                    distrito_code, seccion_code, circuito_code, establecimiento_code, mesa_code
                )
                select * from unnest(%s::text[], %s::text[], %s::text[], %s::text[], %s::int[])
                returning distrito_code, seccion_code, circuito_code, establecimiento_code,
                          mesa_code, id
                """,
                (
                    [key[0] for key in missing],
                    [key[1] for key in missing],
                    [key[2] for key in missing],
                    [key[3] for key in missing],
                    [key[4] for key in missing],
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

    return {key: resolved[key] for key in keys}


def load_result_rows(conn, *, archive_entry_id: str, records: Sequence[ResultRowRecord]) -> int:
    """D8's idempotent load: delete every existing `result_row` for
    `archive_entry_id`, then bulk-insert `records`, in the caller's
    currently open transaction.

    Calling this twice with the same `archive_entry_id` and an identical
    `records` sequence leaves `result_row` in the same state both times
    (task 8.2) -- the delete makes re-ingestion safe regardless of how many
    times, or in what order relative to other archive entries, it runs.
    Truncating `result_row` and calling this again reproduces the same
    projection (task 8.3, "rebuild = truncate + replay").
    """
    election_ids = {record.election_id for record in records}

    with conn.cursor() as cur:
        if election_ids:
            # Scoped by election, not just by archive entry: one archived file may
            # hold several elections (the PBA open-data catalogue publishes
            # 2005-2023 in a single CSV), and an unscoped delete would wipe every
            # other election's rows that share the entry.
            cur.execute(
                "delete from result_row where archive_entry_id = %s "
                "and election_id = any(%s)",
                (archive_entry_id, list(election_ids)),
            )
        else:
            cur.execute(
                "delete from result_row where archive_entry_id = %s",
                (archive_entry_id,),
            )
        if records:
            cur.executemany(
                """
                insert into result_row (
                    election_id, jurisdiction_id, category_id, granularity,
                    list_id, votes, source_kind, is_unmapped,
                    archive_entry_id, source_row_index, mesa_tipo
                ) values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                [
                    (
                        record.election_id,
                        record.jurisdiction_id,
                        record.category_id,
                        record.granularity,
                        record.list_id,
                        record.votes,
                        record.source_kind,
                        record.is_unmapped,
                        record.archive_entry_id,
                        record.source_row_index,
                        record.mesa_tipo,
                    )
                    for record in records
                ],
            )
    return len(records)


def load_party_map_rows(conn, table: PartyMappingTable) -> dict[str, int]:
    """Load `curated/party_map.yaml` (already parsed into `table` by
    `etl.party_map.load_party_map`) into `party_canonical`, `list_identity`
    and `party_mapping` (Phase 15, tasks 15.1-15.5).

    Idempotent by plain `ON CONFLICT` upsert -- unlike `upsert_jurisdiction`,
    none of these three tables' natural keys contain a nullable column
    (`party_canonical.id` is a `text primary key`; `list_identity` and
    `party_mapping` both key on `(year, jurisdiction, category, list_id)`,
    all `not null`), so Postgres's `NULL <> NULL` upsert pitfall documented
    on `upsert_jurisdiction` does not apply here.

    `party_canonical.display_name` is populated from the FIRST entry (in
    `table.entries` order) that carries each `canonical_party` id -- a
    canonical party is a single concept, but the curated file legitimately
    repeats the same canonical id under several `(year, jurisdiction,
    category, list_id)` keys with source-observed `party_name` spellings
    that can differ (e.g. "LA LIBERTAD AVANZA" in 2023 vs "ALIANZA LA
    LIBERTAD AVANZA" in 2025); one display name has to be chosen, and doing
    it deterministically (first occurrence) beats an unordered `dict`
    write-wins race.
    """
    display_name_by_canonical_party: dict[str, str] = {}
    for entry in table.entries:
        display_name_by_canonical_party.setdefault(entry.canonical_party, entry.party_name)

    with conn.cursor() as cur:
        for canonical_party, display_name in display_name_by_canonical_party.items():
            cur.execute(
                """
                insert into party_canonical (id, display_name)
                values (%s, %s)
                on conflict (id) do update set display_name = excluded.display_name
                """,
                (canonical_party, display_name),
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

    return {
        "party_canonical": len(display_name_by_canonical_party),
        "list_identity": len(table.entries),
        "party_mapping": len(table.entries),
    }


def load_crosswalk_rows(
    conn,
    table: CrosswalkTable,
    mesa_stabilities: Sequence[tuple[str, str, MesaStability]] = (),
) -> dict[str, int]:
    """Load `curated/crosswalk.yaml` (already parsed into `table` by
    `etl.crosswalk.load_crosswalk`) into `jurisdiction_crosswalk`, plus any
    supplied per-mesa stability records into `mesa_crosswalk` (Phase 15,
    tasks 15.6-15.8).

    `mesa_stabilities` is `(distrito_code, seccion_code, MesaStability)`
    triples -- `etl.crosswalk.MesaStability` itself carries only a mesa
    number, not the jurisdiction it was observed in, so the caller (the
    `load-curated` CLI command, task 15.10/15.11) supplies the scope
    alongside each record. `compute_mesa_stability` MUST NOT default a
    code to "stable" (jurisdiction-model spec); this loader does not
    recompute stability, it only persists whatever the caller already
    computed.

    Idempotent by plain `ON CONFLICT`: `jurisdiction_crosswalk` keys on
    `pba_distrito_code` (not null, migration 0003) and `mesa_crosswalk`
    keys on `(distrito_code, seccion_code, mesa_code)` (all not null) --
    same no-nullable-key-column reasoning as `load_party_map_rows`.
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
                    jurisdiction.pba_distrito_code,
                    jurisdiction.national_distrito_code,
                    jurisdiction.national_seccion_code,
                    jurisdiction.name,
                ),
            )

        for distrito_code, seccion_code, stability in mesa_stabilities:
            cur.execute(
                """
                insert into mesa_crosswalk (
                    distrito_code, seccion_code, mesa_code,
                    present_2023, present_2025, stable_across_years
                ) values (%s, %s, %s, %s, %s, %s)
                on conflict (distrito_code, seccion_code, mesa_code) do update set
                    present_2023 = excluded.present_2023,
                    present_2025 = excluded.present_2025,
                    stable_across_years = excluded.stable_across_years
                """,
                (
                    distrito_code,
                    seccion_code,
                    stability.mesa,
                    stability.present_2023,
                    stability.present_2025,
                    stability.stable,
                ),
            )

    return {
        "jurisdiction_crosswalk": len(table.jurisdictions),
        "mesa_crosswalk": len(mesa_stabilities),
    }


def insert_review_items(conn, records: Sequence[ReviewItemRecord]) -> int:
    """Write path for `review_item` (task 11.19) -- the first table that
    actually persists what `etl.review_item` projects from `MesaDivergence`
    (`etl.crosswalk`, Phase 4) and `ReviewItemDraft`
    (`etl.ingest.fiscalizacion`, Phase 6). Unlike `load_result_rows`, there
    is no delete-by-`archive_entry_id` step here -- `review_item` has no
    natural idempotency key (a divergence note is an append-only observed
    event, not a rebuildable projection row), so the caller decides whether
    re-running a given ingestion should re-record its review items.
    """
    with conn.cursor() as cur:
        if records:
            cur.executemany(
                """
                insert into review_item (kind, severity, subject_ref, note)
                values (%s, %s, %s, %s)
                """,
                [
                    (record.kind, record.severity, record.subject_ref, record.note)
                    for record in records
                ],
            )
    return len(records)
