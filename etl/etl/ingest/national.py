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
scope and are skipped, not silently mis-attributed to a list.
"""

from __future__ import annotations

import csv
import io
import sys
from dataclasses import dataclass

from etl import db
from etl.crosswalk import CrosswalkTable
from etl.jurisdiction import ResultRow, make_result_row
from etl.party_map import PartyMappingTable, PartyResolutionResult, resolve_party_for_rows

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
    natural_key: tuple[str, int, str, str, str]

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


def _normalize_mesa_id(raw: str) -> int:
    """Normalize a mesa id to a canonical, zero-padding-independent integer.

    SPIKE (c): `resultados2025.csv`'s `mesa_id` is unpadded while
    `localesDeVotacionyMesas.csv`'s is zero-padded to 5 digits. Comparing
    them as raw strings would treat `"1"` and `"00001"` as different mesas;
    comparing as integers makes the zero-padding irrelevant.
    """
    return int(raw)


def ingest_national(csv_bytes: bytes, *, archive_entry_id: str) -> list[NationalRow]:
    """Parse one archived national results CSV into normalized rows.

    Pure function of `(csv_bytes, archive_entry_id)`: calling it twice
    against the same bytes yields an identical list, which is the
    precondition D8's later transactional (delete-by-archive_entry_id,
    bulk insert) idempotency at the Postgres layer depends on.
    """
    reader = csv.DictReader(io.StringIO(csv_bytes.decode("utf-8")))
    fieldnames = set(reader.fieldnames or ())
    missing = [col for col in REQUIRED_COLUMNS if col not in fieldnames]
    if missing:
        raise NationalSchemaError(
            "unrecognized national results structure — missing required "
            f"column(s): {', '.join(missing)}"
        )

    rows: list[NationalRow] = []
    for index, raw in enumerate(reader):
        agrupacion_id = (raw.get("agrupacion_id") or "").strip()
        if raw["votos_tipo"] != "POSITIVO" or not agrupacion_id or agrupacion_id == "0":
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

        mesa_id = _normalize_mesa_id(raw["mesa_id"])
        result = make_result_row(
            granularity="mesa",
            distrito=raw["distrito_id"],
            seccion=raw["seccion_id"],
            circuito=raw["circuito_id"],
            mesa=mesa_id,
            category=raw["cargo_nombre"],
            list_id=list_id,
            votes=int(raw["votos_cantidad"]),
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
                natural_key=(
                    archive_entry_id,
                    mesa_id,
                    agrupacion_id,
                    raw["cargo_nombre"],
                    raw["votos_tipo"],
                ),
            )
        )

    return _quarantine_ambiguous_rows(rows)


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
    categories: dict[str, int] = {}
    for key in ambiguous:
        categories[key[4]] = categories.get(key[4], 0) + 1
    breakdown = ", ".join(
        f"{name} {count}" for name, count in sorted(categories.items(), key=lambda kv: -kv[1])
    )
    print(
        f"quarantined {dropped} rows across {len(ambiguous)} ambiguous natural keys "
        f"({breakdown}) -- indistinguishable in the source except by vote count, "
        "so no row was loaded for them",
        file=sys.stderr,
    )

    return [row for key, group in by_key.items() if len(group) == 1 for row in group]


@dataclass(frozen=True)
class QuarantinedNationalRow:
    """A parsed row whose distrito/seccion has no curated crosswalk entry.

    Stored as data alongside the reason, never silently dropped or assigned
    to an unrelated jurisdiction (jurisdiction-model spec, task 4.6).
    """

    row: NationalRow
    reason: str


@dataclass(frozen=True)
class CrosswalkResolutionResult:
    mapped: tuple[NationalRow, ...]
    quarantined: tuple[QuarantinedNationalRow, ...]


def resolve_jurisdictions(
    rows: list[NationalRow], crosswalk: CrosswalkTable
) -> CrosswalkResolutionResult:
    """Split ``rows`` into those whose (distrito, seccion) resolves against
    the curated crosswalk and those that do not.

    A national distrito/seccion code with no crosswalk entry is QUARANTINED,
    never silently assigned to whatever jurisdiction happens to share the
    code (jurisdiction-model spec, "An unmapped jurisdiction code is
    encountered" scenario).
    """
    mapped: list[NationalRow] = []
    quarantined: list[QuarantinedNationalRow] = []

    for row in rows:
        resolved = crosswalk.resolve_national(
            distrito_code=row.result.distrito, seccion_code=row.result.seccion or ""
        )
        if resolved is None:
            quarantined.append(
                QuarantinedNationalRow(
                    row=row,
                    reason=(
                        "no curated crosswalk entry for national distrito="
                        f"{row.result.distrito!r} seccion={row.result.seccion!r}"
                    ),
                )
            )
            continue
        mapped.append(row)

    return CrosswalkResolutionResult(mapped=tuple(mapped), quarantined=tuple(quarantined))


def resolve_national_party(
    rows: list[NationalRow], party_map: PartyMappingTable, *, year: int
) -> PartyResolutionResult:
    """Resolve each national row's canonical party via `party_map`
    (party-identity-mapping spec, task 7.8) -- jurisdiction is always
    ``"national"`` for this ingestion path. `year` is supplied by the
    caller (known from the archive entry, e.g. 2023 or 2025), never
    inferred from the row itself, so the SAME `agrupacion_id` value never
    resolves across years by accident (task 7.6a).
    """
    return resolve_party_for_rows(rows, party_map, year=year, jurisdiction="national")


def load_national_rows(
    conn, rows: list[NationalRow], *, year: int, round_: str, source_kind: str = "official"
) -> int:
    """Task 8.5 (D8): resolve each row's election/category/jurisdiction ids
    and hand the batch to `db.load_result_rows`'s delete-by-
    `archive_entry_id`-then-bulk-insert transaction wrapper.

    All `rows` MUST share one `archive_entry_id` -- D8's idempotency key is
    scoped per archive entry, not per mixed batch. `year`/`round_` are
    caller-supplied (known from the archive entry, e.g. 2023 generales or
    2025 legislativas), never inferred from the rows themselves, the same
    discipline `resolve_national_party` already applies.
    """
    if not rows:
        return 0
    archive_entry_id = rows[0].archive_entry_id
    if any(row.archive_entry_id != archive_entry_id for row in rows):
        raise ValueError("load_national_rows requires every row to share one archive_entry_id")

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
                source_kind=source_kind,
                is_unmapped=False,
                archive_entry_id=row.archive_entry_id,
                source_row_index=row.source_row_index,
                mesa_tipo=row.mesa_tipo,
            )
        )

    return db.load_result_rows(conn, archive_entry_id=archive_entry_id, records=records)
