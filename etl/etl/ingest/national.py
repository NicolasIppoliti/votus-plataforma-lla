"""National 2023/2025 ZIP ingestion (`electoral-ingestion` spec, national
subset; D8's idempotency; SPIKE 001 (b)/(c) verdicts).

One shared, NAME-based parser (never positional indexing — SPIKE (b) found
real column-order drift between 2023 and 2025) driven by whatever columns
the source CSV actually declares. `estado_final` (new in 2025) is read via
`.get()` so it is `None` for 2023 rows rather than defaulted to a guessed
status. Mesa ids are normalized to a canonical string form so the 2025
results file's unpadded (`"1"`) and `localesDeVotacionyMesas.csv`'s
zero-padded (`"00001"`) forms compare equal (SPIKE (c)).

Only `votos_tipo == "POSITIVO"` rows with a real `agrupacion_id` become
normalized list-vote rows — this is the "(mesa, list/agrupación, category)
combination" the spec scenario asks for. EN BLANCO/NULO/IMPUGNADO/
RECURRIDO rows (`agrupacion_id` empty or `"0"`) are out of this phase's
scope and are skipped, not silently mis-attributed to a list -- and every
such skip is COUNTED and reported per reason, in rows and in votes, because
a plausible-sounding exclusion is how a destructive filter survives review.
"""

from __future__ import annotations

import csv
import io
import sys
from dataclasses import dataclass

from etl import db
from etl.jurisdiction import ResultRow, make_result_row

REQUIRED_COLUMNS = (
    "distrito_id",
    "seccion_id",
    "circuito_id",
    "mesa_id",
    "cargo_nombre",
    "agrupacion_id",
    "votos_tipo",
    "votos_cantidad",
)


class NationalSchemaError(ValueError):
    """Raised when the source CSV does not declare a required column.

    Per the "BUP-era 2025 format handled or explicitly rejected" scenario:
    an unrecognized structure MUST fail loudly, not silently ingest partial
    or misaligned data.
    """


@dataclass(frozen=True)
class NationalRow:
    """A normalized national result row plus ingestion provenance.

    Wraps `jurisdiction.ResultRow` (the shared granularity model) with
    fields specific to this ingestion path: the 2025-only `estado_final`
    attribute, and the `(archive_entry_id, natural key)` D8 requires for
    idempotent re-ingestion.
    """

    result: ResultRow
    estado_final: str | None
    mesa_tipo: str | None
    archive_entry_id: str
    source_row_index: int
    # NO `natural_key` field. It was `(archive_entry_id, mesa_id, agrupacion_id,
    # cargo_nombre, votos_tipo)` — a SECOND, weaker idea of the key that nothing
    # read: `mesa_id` is globally unique in 2025 and NOT in 2023, so it collides
    # across distritos in that file, and the real dedup below groups on the full
    # `(distrito, seccion, circuito, mesa, category, list_id)` lineage while the
    # database's own constraint is
    # `(archive_entry_id, election_id, jurisdiction_id, category_id, list_id, source_kind)`.
    # Three ideas of one key, one of them wrong and unreachable.

    @property
    def mesa(self) -> int | None:
        return self.result.mesa

    @property
    def granularity(self) -> str:
        return self.result.granularity

    @property
    def category(self) -> str:
        return self.result.category

    @property
    def list_id(self) -> str | None:
        return self.result.list_id


def _normalize_mesa_id(raw: str | None) -> int | None:
    """Normalize a mesa id to a canonical, zero-padding-independent integer.

    SPIKE (c): `resultados2025.csv`'s `mesa_id` is unpadded while
    `localesDeVotacionyMesas.csv`'s is zero-padded to 5 digits. Comparing
    them as raw strings would treat `"1"` and `"00001"` as different mesas;
    comparing as integers makes the zero-padding irrelevant.

    Returns `None` when the cell holds no readable integer. `int("")` raised
    `ValueError` mid-loop and killed the run on one truncated line -- and
    `_report_exclusions` runs AFTER the loop, so the breakdown for every row
    already excluded died with it. `csv.DictReader` fills a truncated row's
    missing trailing fields with `None`, which both
    `__main__.find_unmapped_jurisdictions` and
    `ingest.fiscalizacion._merge_wrapped_rows` document as a live hazard.
    """
    return _parse_int(raw)


def _parse_int(raw: str | None) -> int | None:
    """The integer in `raw`, or `None` when there is not one to read."""
    try:
        return int((raw or "").strip())
    except (TypeError, ValueError):
        return None


def ingest_national(csv_bytes: bytes, *, archive_entry_id: str) -> list[NationalRow]:
    """Parse one archived national results CSV into normalized rows.

    Pure function of `(csv_bytes, archive_entry_id)`: calling it twice
    against the same bytes yields an identical list, which is the
    precondition D8's later transactional (delete-by-archive_entry_id,
    bulk insert) idempotency at the Postgres layer depends on.
    """
    # `utf-8-sig`, matching every other reader of these same bytes
    # (`__main__.resolve_national_results_bytes`, `official_mesa_votes_from_
    # national`, `cmd_backfill_mesa_tipo`). Plain `utf-8` left a BOM attached
    # to the first field name, so a BOM-bearing export cleared the ZIP-member
    # header probe and then died HERE as `NationalSchemaError: missing
    # required column(s): distrito_id` -- an encoding failure reported as
    # schema drift, which is exactly the misdiagnosis the probe refuses to
    # make. `utf-8-sig` decodes BOM-less bytes unchanged.
    reader = csv.DictReader(io.StringIO(csv_bytes.decode("utf-8-sig")))
    fieldnames = set(reader.fieldnames or ())
    missing = [col for col in REQUIRED_COLUMNS if col not in fieldnames]
    if missing:
        raise NationalSchemaError(
            "unrecognized national results structure — missing required "
            f"column(s): {', '.join(missing)}"
        )

    rows: list[NationalRow] = []
    # Rule 3: an exclusion is reported PER REASON, in rows AND in votes.
    # These two `continue`s used to be silent, and their plausibility is
    # exactly what would let a destructive filter survive: "non-POSITIVO"
    # sounds like nothing, but on the 2023 generales file it is every EN
    # BLANCO/NULO/IMPUGNADO/RECURRIDO row across ten categories, and if the
    # column ever drifted to `"Positivo"` the whole corpus would vanish
    # behind the same reassuring word.
    excluded_rows: dict[str, int] = {}
    excluded_votes: dict[str, int] = {}
    # A dropped row whose vote count will not parse is still a dropped row.
    # It is counted in rows under its own reason, so the votes total is never
    # quietly padded with a zero that stands in for a number nobody read.
    excluded_unparseable: dict[str, int] = {}

    def exclude(reason: str, raw_votes: str | None) -> None:
        excluded_rows[reason] = excluded_rows.get(reason, 0) + 1
        try:
            votes = int((raw_votes or "").strip())
        except (TypeError, ValueError):
            excluded_unparseable[reason] = excluded_unparseable.get(reason, 0) + 1
            return
        excluded_votes[reason] = excluded_votes.get(reason, 0) + votes

    for index, raw in enumerate(reader):
        agrupacion_id = (raw.get("agrupacion_id") or "").strip()
        votos_tipo = raw["votos_tipo"]
        if votos_tipo != "POSITIVO":
            exclude(f"votos_tipo={votos_tipo!r}", raw.get("votos_cantidad"))
            continue
        if not agrupacion_id:
            exclude("agrupacion_id empty", raw.get("votos_cantidad"))
            continue
        if agrupacion_id == "0":
            exclude('agrupacion_id "0"', raw.get("votos_cantidad"))
            continue

        # A list's identity is (agrupación, lista) -- NOT the agrupación alone.
        # In a PASO one agrupación fields several internal lists competing
        # against each other in the same mesa and cargo (agrupación 134 runs
        # `3005 A- CELESTE Y BLANCA` against `3006 B- JUSTA Y SOBERANA`), which
        # is the point of a primary. `lista_numero` is empty throughout the 2023
        # generales file, populated throughout the PASO, and populated for about
        # a quarter of the 2025 rows, so the composite degrades to the bare
        # agrupación id exactly where the source has no list to distinguish.
        lista_numero = (raw.get("lista_numero") or "").strip()
        list_id = f"{agrupacion_id}-{lista_numero}" if lista_numero else agrupacion_id

        mesa_id = _normalize_mesa_id(raw.get("mesa_id"))
        if mesa_id is None:
            exclude("unreadable mesa_id", raw.get("votos_cantidad"))
            continue
        votes = _parse_int(raw.get("votos_cantidad"))
        if votes is None:
            # A POSITIVO row whose vote count will not parse is EXCLUDED under
            # its own reason, never coerced to zero: a zero is a claim that
            # nobody voted for that list, which is not what an unreadable cell
            # says. Same rule `ingest.fiscalizacion` applies to a blank cell.
            exclude("unreadable votos_cantidad", None)
            continue
        result = make_result_row(
            granularity="mesa",
            distrito=raw["distrito_id"],
            seccion=raw["seccion_id"],
            circuito=raw["circuito_id"],
            mesa=mesa_id,
            category=raw["cargo_nombre"],
            list_id=list_id,
            votes=votes,
        )
        rows.append(
            NationalRow(
                result=result,
                estado_final=raw.get("estado_final") or None,
                # Phase 16a: `mesa_tipo` distinguishes a regular (`NATIVOS`)
                # mesa from a foreign-resident (`EXTRANJEROS`) one — the
                # latter votes in PBA provincial/municipal races but not
                # national ones, a real electoral fact that per-mesa
                # cross-year comparisons must be able to see. `.get()`
                # mirrors `estado_final`'s absent-column tolerance.
                mesa_tipo=raw.get("mesa_tipo") or None,
                archive_entry_id=archive_entry_id,
                source_row_index=index,
            )
        )

    _report_exclusions(excluded_rows, excluded_votes, excluded_unparseable)
    return _quarantine_ambiguous_rows(rows)


def _report_exclusions(
    rows_by_reason: dict[str, int],
    votes_by_reason: dict[str, int],
    unparseable_by_reason: dict[str, int],
) -> None:
    """Print the per-reason exclusion breakdown, in rows and in votes.

    Same shape and destination as `_quarantine_ambiguous_rows`'s report, so
    one ingest run reports every exclusion it made in one place.
    """
    if not rows_by_reason:
        return
    parts = []
    for reason, count in sorted(rows_by_reason.items(), key=lambda kv: -kv[1]):
        part = f"{reason}: {count} rows / {votes_by_reason.get(reason, 0)} votes"
        unparseable = unparseable_by_reason.get(reason, 0)
        if unparseable:
            part += f" ({unparseable} with an unparseable vote count, not summed)"
        parts.append(part)
    print(
        f"excluded {sum(rows_by_reason.values())} row(s) as out of scope for "
        f"normalized list votes -- {'; '.join(parts)}",
        file=sys.stderr,
    )


def _quarantine_ambiguous_rows(rows: list[NationalRow]) -> list[NationalRow]:
    """Drop rows whose natural key repeats within one file, and say so.

    The 2023 national file bundles ten categories, from PRESIDENTE Y VICE
    down to MIEMBROS DE JUNTA COMUNAL, and for the two most local ones its
    distrito/seccion/circuito/mesa lineage does not identify the municipio.
    The result is rows that are byte-identical across every column except
    `votos_cantidad`: measured on the real archived `2023-generales.zip`,
    5.051 natural keys repeat, 2.379 under INTENDENTE and 2.672 under
    MIEMBROS DE JUNTA COMUNAL. No national category is affected.

    They are genuinely indistinguishable in the source, so there is no
    correct way to pick one -- summing could double-count a mesa and
    choosing the first is arbitrary. They are therefore excluded and
    reported, never silently resolved.

    Before this, one such row aborted the entire ingest on a raw psycopg
    `UniqueViolation` against `result_row_natural_key`, discarding 2,7
    million good national rows with it.
    """
    by_key: dict[tuple, list[NationalRow]] = {}
    for row in rows:
        by_key.setdefault(
            (row.result.distrito, row.result.seccion, row.result.circuito,
             row.result.mesa, row.category, row.list_id),
            [],
        ).append(row)

    ambiguous = {k: v for k, v in by_key.items() if len(v) > 1}
    if not ambiguous:
        return rows

    dropped = sum(len(v) for v in ambiguous.values())
    # ROWS per category, matching the `dropped` total. It counted KEYS while
    # the headline counted rows, so a reader summing the breakdown got the
    # same number and concluded each key dropped exactly one row -- false the
    # moment a key repeats three times, and precisely the "large plausible
    # total" rule 3 exists to catch. Keys are reported too, separately.
    categories: dict[str, int] = {}
    keys_by_category: dict[str, int] = {}
    # VOTES too, like `_report_exclusions` in this same module. A quarantine
    # of 5.051 keys with unknown vote mass is the plausible-total shape rule 3
    # exists for: the count tells you how many rows went, never how much.
    votes_by_category: dict[str, int] = {}
    for key, group in ambiguous.items():
        categories[key[4]] = categories.get(key[4], 0) + len(group)
        keys_by_category[key[4]] = keys_by_category.get(key[4], 0) + 1
        votes_by_category[key[4]] = votes_by_category.get(key[4], 0) + sum(
            row.result.votes for row in group
        )
    breakdown = ", ".join(
        f"{name} {count} rows / {votes_by_category[name]} votes "
        f"across {keys_by_category[name]} keys"
        for name, count in sorted(categories.items(), key=lambda kv: -kv[1])
    )
    print(
        f"quarantined {dropped} rows across {len(ambiguous)} ambiguous natural keys "
        f"({breakdown}) -- indistinguishable in the source except by vote count, "
        "so no row was loaded for them",
        file=sys.stderr,
    )

    return [row for key, group in by_key.items() if len(group) == 1 for row in group]


# NO `resolve_jurisdictions` / `QuarantinedNationalRow` /
# `CrosswalkResolutionResult`, and no `resolve_national_party`. They were
# correct and tested and had no production caller, and wiring them in is not
# the fix — it is the bug they would have caused:
#
# `jurisdiction_crosswalk` is a PBA-to-national SCHEME TRANSLATOR. It carries
# exactly one curated entry (PBA distrito `027` -> national `02`/`027`),
# because PBA is the only source writing codes in a foreign scheme. National
# codes are ALREADY in the national scheme, so there is nothing to translate,
# and `crosswalk.resolve_national` returns `None` for every distrito except
# `02`/`027`. Requiring it here the way `load_pba_rows` does would have
# quarantined every national row outside Coronel Rosales -- 18.1 million of
# the 18.1 million loaded -- as "no curated entry", which is why the
# asymmetry with PBA is the correct shape and not an oversight.
#
# `resolve_national_party` / `resolve_pba_party` fed one thing: the
# `is_unmapped` column. That column is now gone (migration 0014); whether a
# list id resolves is answered by joining `party_mapping` at query time, so
# it stays correct when a list is curated AFTER ingestion instead of freezing
# a boolean that goes stale the moment `curated/party_map.yaml` changes.

def load_national_rows(
    conn, rows: list[NationalRow], *, year: int, round_: str, archive_entry_id: str
) -> int:
    """Task 8.5 (D8): resolve each row's election/category/jurisdiction ids
    and hand the batch to `db.load_result_rows`'s delete-by-
    `archive_entry_id`-then-bulk-insert transaction wrapper.

    All `rows` MUST share one `archive_entry_id` -- D8's idempotency key is
    scoped per archive entry, not per mixed batch. `year`/`round_` are
    caller-supplied (known from the archive entry, e.g. 2023 generales or
    2025 legislativas), never inferred from the rows themselves -- the same
    discipline `db.load_result_rows` applies to `election_id`, which it
    REQUIRES rather than deriving from whatever records happen to arrive.
    """
    # NO early return on an empty batch. `db.load_result_rows` is the
    # delete-then-insert PAIR, so skipping it skipped the DELETE: a source
    # that stops parsing -- a drifted header, a re-skinned page, a crosswalk
    # entry removed -- left the PREVIOUS run's rows alive and
    # indistinguishable from current, while the CLI printed "ingested 0 rows"
    # and exited 0. `load_fiscalizacion_rows` fixed exactly this; the fix did
    # not reach here.
    #
    # `archive_entry_id` is a REQUIRED argument rather than `rows[0]`'s,
    # because with zero rows the function cannot otherwise state its own
    # scope -- the same reason `load_fiscalizacion_rows` takes it.
    if any(row.archive_entry_id != archive_entry_id for row in rows):
        raise ValueError(
            "load_national_rows requires every row to carry the archive_entry_id given"
        )

    election_id = db.upsert_election(conn, year=year, round_=round_)
    category_cache: dict[str, str] = {}

    # Batched jurisdiction resolution (task 14.5): one round trip to
    # resolve every distinct mesa already in `jurisdiction`, one more to
    # bulk-insert whatever is missing -- replacing the SELECT-then-INSERT
    # per first-seen mesa `upsert_jurisdiction` cost here before (~109k
    # round trips at real national 2025 scale, spikes/003).
    jurisdiction_keys = [
        (row.result.distrito, row.result.seccion, row.result.circuito, None, row.result.mesa)
        for row in rows
    ]
    jurisdiction_ids = db.batch_upsert_jurisdictions(conn, jurisdiction_keys)

    records: list[db.ResultRowRecord] = []

    for row in rows:
        category_id = category_cache.get(row.category)
        if category_id is None:
            category_id = db.upsert_category(conn, name=row.category)
            category_cache[row.category] = category_id

        j_key = (
            row.result.distrito,
            row.result.seccion,
            row.result.circuito,
            None,
            row.result.mesa,
        )
        jurisdiction_id = jurisdiction_ids[j_key]

        records.append(
            db.ResultRowRecord(
                election_id=election_id,
                jurisdiction_id=jurisdiction_id,
                category_id=category_id,
                granularity=row.granularity,
                list_id=row.list_id,
                votes=row.result.votes,
                # HARDCODED, and no override parameter. It was
                # `source_kind: str = "official"`, a caller-settable kwarg no
                # caller ever set: a writable door into the one invariant
                # rule 5 says must never be crossed, with nothing in the write
                # path to refuse a fiscalización batch labelled official.
                # `load_fiscalizacion_rows` hardcodes its own kind for the
                # same reason.
                source_kind="official",
                archive_entry_id=row.archive_entry_id,
                source_row_index=row.source_row_index,
                mesa_tipo=row.mesa_tipo,
            )
        )

    return db.load_result_rows(
        conn,
        archive_entry_id=archive_entry_id,
        records=records,
        election_id=election_id,
    )
