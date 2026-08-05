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
    with conn.cursor() as cur:
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
                    archive_entry_id, source_row_index
                ) values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
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
                    )
                    for record in records
                ],
            )
    return len(records)
