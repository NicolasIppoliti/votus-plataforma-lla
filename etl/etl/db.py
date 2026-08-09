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

import sys
from collections.abc import Sequence
from dataclasses import dataclass
from typing import LiteralString

from psycopg import sql

from etl.crosswalk import CrosswalkTable, MesaStability
from etl.jurisdiction import (
    normalize_circuito_code,
    normalize_distrito_code,
    normalize_seccion_code,
)
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

    Phase 17: this is the single normalization boundary every writer funnels
    through -- `distrito`/`seccion` are canonicalized to the curated,
    zero-padded form (`etl.jurisdiction.normalize_distrito_code` /
    `normalize_seccion_code`) BEFORE the lookup or insert, so a caller that
    still passes national ingestion's raw unpadded `"2"`/`"27"` resolves to
    the SAME row as fiscalización's already-padded `"02"`/`"027"` instead of
    creating a second, format-only duplicate.
    """
    distrito = normalize_distrito_code(distrito)
    seccion = normalize_seccion_code(seccion)
    # Circuito goes through the boundary too. Leaving it out meant
    # `jurisdiction.py` declared itself the single normalization boundary while
    # one of its three codes was written raw, forcing every reader to
    # compensate — two independent ideas of the same code, which is what
    # produced Coronel Rosales as three identities.
    circuito = normalize_circuito_code(circuito)
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


def official_jurisdictions_for_mesa(
    conn,
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
    """
    original_keys = list(keys)
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
        # ONE NULL-safe text key (`merge_key` / `MERGE_KEY_SQL` above), not
        # four `is not distinct from` predicates: across several nullable
        # columns that is not hash-joinable and degrades to a nested loop,
        # which at this call site's ~109k distinct mesas is the shape rule 10
        # warns about.
        merge_keys = [merge_key(*key) for key in distinct_keys]
        resolve_existing = sql.SQL(
            """
            select v.distrito, v.seccion, v.circuito, v.establecimiento, v.mesa, j.id
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
        for distrito, seccion, circuito, establecimiento, mesa, jurisdiction_id in cur.fetchall():
            key = (distrito, seccion, circuito, establecimiento, mesa)
            if jurisdiction_id is None:
                missing.append(key)
            else:
                matches.setdefault(key, set()).add(jurisdiction_id)

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
    projection (task 8.3, "rebuild = truncate + replay").
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
                    list_id, votes, source_kind,
                    archive_entry_id, source_row_index, mesa_tipo
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

    Choosing deterministically is not the same as choosing SILENTLY: every
    spelling that was NOT used is reported, so a curated typo introducing a
    second spelling is visible instead of being absorbed by the pick.
    """
    display_name_by_canonical_party: dict[str, str] = {}
    spellings_by_canonical_party: dict[str, list[str]] = {}
    for entry in table.entries:
        display_name_by_canonical_party.setdefault(entry.canonical_party, entry.party_name)
        seen = spellings_by_canonical_party.setdefault(entry.canonical_party, [])
        if entry.party_name not in seen:
            seen.append(entry.party_name)

    for canonical_party, spellings in sorted(spellings_by_canonical_party.items()):
        if len(spellings) > 1:
            chosen = display_name_by_canonical_party[canonical_party]
            discarded = [name for name in spellings if name != chosen]
            print(
                f"  canonical party {canonical_party!r} carries {len(spellings)} "
                f"source spellings; kept {chosen!r}, not shown: "
                f"{', '.join(repr(name) for name in discarded)}",
                file=sys.stderr,
            )

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
        cur.execute(
            """
            delete from party_canonical as current
            where not exists (
                select 1 from unnest(%s::text[]) as desired(id)
                where desired.id = current.id
            )
            """,
            (list(display_name_by_canonical_party),),
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
    triples. `MesaStability` carries the exact normalized circuito/mesa pair;
    the caller supplies its distrito/seccion scope. `compute_mesa_stability`
    MUST NOT default a code to "stable" (jurisdiction-model spec); this loader
    does not recompute stability, it only persists whatever the caller computed.

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

        normalized_mesa_stabilities = [
            (
                normalize_distrito_code(distrito_code),
                normalize_seccion_code(seccion_code),
                normalize_circuito_code(stability.circuito),
                stability,
            )
            for distrito_code, seccion_code, stability in mesa_stabilities
        ]
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
