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
from collections.abc import Iterable
from dataclasses import dataclass

from etl import db
from etl.jurisdiction import (
    ResultRow,
    is_canonicalizable_circuito_code,
    is_canonicalizable_code,
    make_result_row,
    normalize_circuito_code,
)
from etl.numeric import parse_source_int

REQUIRED_IDENTITY_COLUMNS = ("distrito_id", "seccion_id", "circuito_id", "mesa_id")
REQUIRED_ESTABLECIMIENTO_COLUMNS = (
    "distrito_id",
    "seccion_id",
    "mesa_id",
    "localvotacion_codigo",
    "localvotacion_nombre",
)
SUPPORTED_MESA_TIPOS = frozenset({"NATIVOS", "EXTRANJEROS"})

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
    """Raised when the national source violates the supported schema contract.

    Per the "BUP-era 2025 format handled or explicitly rejected" scenario:
    an unrecognized structure MUST fail loudly, not silently ingest partial
    or misaligned data.
    """


def validate_mesa_tipo(raw: object, *, source_label: str, source_row_index: int) -> str | None:
    """Return an exact supported mesa type, preserving a genuinely absent value."""
    if raw is None or raw == "":
        return None
    if not isinstance(raw, str) or raw not in SUPPORTED_MESA_TIPOS:
        raise NationalSchemaError(
            f"{source_label}: unsupported mesa_tipo {raw!r} at source row "
            f"{source_row_index}; expected one of NATIVOS, EXTRANJEROS, or an absent value"
        )
    return raw


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
    establecimiento_name: str | None = None
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

    @property
    def establecimiento(self) -> str | None:
        return self.result.establecimiento


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
    """The strict source integer in `raw`, or `None` when unreadable."""
    return parse_source_int(raw)


def extract_raw_mesa_identities_from_text(
    csv_text: Iterable[str],
) -> set[tuple[str, str, str, int]]:
    """Distinct distrito/seccion/circuito/mesa identities, before any filtering.

    Reads row by row from an open text stream, so peak memory is bounded by
    the widest row rather than by the file. There is deliberately no
    bytes-taking sibling: the only production caller holds the 2023 PASO
    member, which is 3,76 GB uncompressed, and decoding that in one
    allocation is what made `load-curated` unrunnable.
    """
    reader = csv.DictReader(csv_text)
    fieldnames = set(reader.fieldnames or ())
    missing = [column for column in REQUIRED_IDENTITY_COLUMNS if column not in fieldnames]
    if missing:
        raise NationalSchemaError(
            "unrecognized national results identity structure — missing required "
            f"column(s): {', '.join(missing)}"
        )

    identities: set[tuple[str, str, str, int]] = set()
    excluded: dict[str, int] = {}

    def exclude(reason: str) -> None:
        excluded[reason] = excluded.get(reason, 0) + 1

    for raw in reader:
        raw_distrito = raw.get("distrito_id")
        distrito = raw_distrito.strip() if isinstance(raw_distrito, str) else ""
        if not distrito:
            exclude("absent distrito_id")
            continue
        if not is_canonicalizable_code(distrito):
            exclude("unreadable distrito_id")
            continue

        codes: dict[str, str] = {}
        invalid = False
        for field, predicate in (
            ("seccion_id", is_canonicalizable_code),
            ("circuito_id", is_canonicalizable_circuito_code),
        ):
            raw_code = raw.get(field)
            code = raw_code.strip() if isinstance(raw_code, str) else ""
            if not code:
                exclude(f"absent {field}")
                invalid = True
            elif not predicate(code):
                exclude(f"unreadable {field}")
                invalid = True
            else:
                codes[field] = code
        if invalid:
            continue

        raw_mesa = raw.get("mesa_id")
        if not isinstance(raw_mesa, str) or not raw_mesa.strip():
            exclude("absent mesa_id")
            continue
        mesa = _normalize_mesa_id(raw_mesa)
        if mesa is None:
            exclude("unreadable mesa_id")
            continue

        identities.add((distrito, codes["seccion_id"], codes["circuito_id"], mesa))

    if excluded:
        breakdown = "; ".join(
            f"{reason}: {count} row(s)" for reason, count in sorted(excluded.items())
        )
        print(
            f"excluded {sum(excluded.values())} raw mesa identity row(s) -- {breakdown}",
            file=sys.stderr,
        )
    return identities


def ingest_national(
    csv_bytes: bytes,
    *,
    archive_entry_id: str,
    election_year: int,
    election_round: str,
    establecimientos_csv_bytes: bytes | None = None,
) -> list[NationalRow]:
    """Parse one archived national results CSV into normalized rows.

    Pure function of the source bytes, provenance, and explicit registered
    election metadata: calling it twice
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

    establecimientos, conflicting_establecimientos = _parse_establecimientos(
        establecimientos_csv_bytes,
        source_label=archive_entry_id,
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
    circuits_by_companion_key: dict[tuple[int, int, int], set[str]] = {}

    def exclude(reason: str, raw_votes: str | None) -> None:
        excluded_rows[reason] = excluded_rows.get(reason, 0) + 1
        votes = parse_source_int(raw_votes)
        if votes is None:
            excluded_unparseable[reason] = excluded_unparseable.get(reason, 0) + 1
            return
        excluded_votes[reason] = excluded_votes.get(reason, 0) + votes

    for index, raw in enumerate(reader):
        if establecimientos_csv_bytes is not None:
            distrito_identity = _parse_int(raw.get("distrito_id"))
            seccion_identity = _parse_int(raw.get("seccion_id"))
            mesa_identity = _parse_int(raw.get("mesa_id"))
            raw_circuito = raw.get("circuito_id")
            if (
                distrito_identity is not None
                and seccion_identity is not None
                and mesa_identity is not None
                and is_canonicalizable_circuito_code(raw_circuito)
            ):
                circuito_identity = normalize_circuito_code(raw_circuito)
                assert circuito_identity is not None
                circuits_by_companion_key.setdefault(
                    (distrito_identity, seccion_identity, mesa_identity), set()
                ).add(circuito_identity)

        mesa_tipo = validate_mesa_tipo(
            raw.get("mesa_tipo"),
            source_label=archive_entry_id,
            source_row_index=index,
        )
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

        invalid_code_field = next(
            (
                field
                for field, predicate in (
                    ("distrito_id", is_canonicalizable_code),
                    ("seccion_id", is_canonicalizable_code),
                    ("circuito_id", is_canonicalizable_circuito_code),
                )
                if not predicate(raw.get(field))
            ),
            None,
        )
        if invalid_code_field is not None:
            exclude(f"unreadable {invalid_code_field}", raw.get("votos_cantidad"))
            continue

        # A list's identity is (agrupación, lista) -- NOT the agrupación alone.
        # In a PASO one agrupación fields several internal lists competing
        # against each other in the same mesa and cargo (agrupación 134 runs
        # `3005 A- CELESTE Y BLANCA` against `3006 B- JUSTA Y SOBERANA`), which
        # is the point of a primary. `lista_numero` is empty throughout the 2023
        # generales file, populated throughout the PASO, and empty on measured
        # 2025 legislativas POSITIVO rows. Other explicit election combinations
        # retain the general composite behavior without claiming a measured shape.
        lista_numero = (raw.get("lista_numero") or "").strip()
        election = (election_year, election_round)
        requires_empty = election in {(2023, "generales"), (2025, "legislativas")}
        requires_nonempty = election == (2023, "paso")
        if (requires_empty and lista_numero) or (requires_nonempty and not lista_numero):
            expected = "empty" if requires_empty else "nonempty"
            raise NationalSchemaError(
                f"{archive_entry_id}: election {election_year}/{election_round} source row "
                f"{index} requires lista_numero to be {expected}; received {lista_numero!r}"
            )
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
        establecimiento: str | None = None
        establecimiento_name: str | None = None
        if establecimientos_csv_bytes is not None:
            distrito_id = _parse_int(raw.get("distrito_id"))
            seccion_id = _parse_int(raw.get("seccion_id"))
            assert distrito_id is not None and seccion_id is not None
            mesa_key = (distrito_id, seccion_id, mesa_id)
            if mesa_key in conflicting_establecimientos:
                exclude(
                    "conflicting establecimiento companion metadata",
                    raw.get("votos_cantidad"),
                )
                continue
            metadata = establecimientos.get(mesa_key)
            if metadata is None:
                exclude("missing establecimiento companion match", raw.get("votos_cantidad"))
                continue
            establecimiento, establecimiento_name = metadata
        result = make_result_row(
            granularity="mesa",
            distrito=raw["distrito_id"],
            seccion=raw["seccion_id"],
            circuito=raw["circuito_id"],
            establecimiento=establecimiento,
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
                mesa_tipo=mesa_tipo,
                establecimiento_name=establecimiento_name,
                archive_entry_id=archive_entry_id,
                source_row_index=index,
            )
        )

    ambiguous_companion_keys = {
        key for key, circuits in circuits_by_companion_key.items() if len(circuits) > 1
    }
    if ambiguous_companion_keys:
        unambiguous_rows: list[NationalRow] = []
        for row in rows:
            distrito = _parse_int(row.result.distrito)
            seccion = _parse_int(row.result.seccion)
            assert distrito is not None and seccion is not None and row.mesa is not None
            if (distrito, seccion, row.mesa) in ambiguous_companion_keys:
                exclude(
                    "ambiguous result circuits for establecimiento companion",
                    str(row.result.votes),
                )
            else:
                unambiguous_rows.append(row)
        rows = unambiguous_rows

    _report_exclusions(excluded_rows, excluded_votes, excluded_unparseable)
    return _quarantine_ambiguous_rows(rows)


def _parse_establecimientos(
    csv_bytes: bytes | None,
    *,
    source_label: str,
) -> tuple[dict[tuple[int, int, int], tuple[str, str]], set[tuple[int, int, int]]]:
    """Read the optional companion using its measured distrito/seccion/mesa key.

    The hash-matching 2025 source has 108,992 unique normalized mesa keys and
    maps each establecimiento code to exactly one name. Both assumptions are
    checked here; registered 2023 sources have no companion and remain unknown.
    """
    if csv_bytes is None:
        return {}, set()

    reader = csv.DictReader(io.StringIO(csv_bytes.decode("utf-8-sig")))
    fieldnames = set(reader.fieldnames or ())
    missing = [column for column in REQUIRED_ESTABLECIMIENTO_COLUMNS if column not in fieldnames]
    if missing:
        raise NationalSchemaError(
            f"{source_label}: unrecognized establecimiento companion structure — missing "
            f"required column(s): {', '.join(missing)}"
        )

    by_mesa: dict[tuple[int, int, int], tuple[str, str]] = {}
    conflicts: set[tuple[int, int, int]] = set()
    names_by_code: dict[str, set[str]] = {}
    keys_by_code: dict[str, set[tuple[int, int, int]]] = {}
    excluded: dict[str, int] = {}
    for raw in reader:
        distrito = _parse_int(raw.get("distrito_id"))
        seccion = _parse_int(raw.get("seccion_id"))
        mesa = _parse_int(raw.get("mesa_id"))
        if distrito is None or seccion is None or mesa is None:
            reason = "unreadable distrito/seccion/mesa identity"
            excluded[reason] = excluded.get(reason, 0) + 1
            continue
        code = (raw.get("localvotacion_codigo") or "").strip()
        name = (raw.get("localvotacion_nombre") or "").strip()
        if not code or not name:
            reason = "absent establecimiento code or name"
            excluded[reason] = excluded.get(reason, 0) + 1
            continue

        key = (distrito, seccion, mesa)
        metadata = (code, name)
        names_by_code.setdefault(code, set()).add(name)
        keys_by_code.setdefault(code, set()).add(key)
        existing = by_mesa.get(key)
        if existing is not None and existing != metadata:
            conflicts.add(key)
        else:
            by_mesa[key] = metadata

    for code, names in names_by_code.items():
        if len(names) > 1:
            conflicts.update(keys_by_code[code])

    if excluded:
        breakdown = "; ".join(
            f"{reason}: {count} row(s)" for reason, count in sorted(excluded.items())
        )
        print(
            f"excluded {sum(excluded.values())} establecimiento companion row(s) — {breakdown}",
            file=sys.stderr,
        )
    if conflicts:
        print(
            f"quarantined {len(conflicts)} establecimiento companion mesa key(s) — "
            "conflicting metadata",
            file=sys.stderr,
        )
    return by_mesa, conflicts


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
            (
                row.result.distrito,
                row.result.seccion,
                row.result.circuito,
                row.result.mesa,
                row.category,
                row.list_id,
            ),
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
        (
            row.result.distrito,
            row.result.seccion,
            row.result.circuito,
            row.establecimiento,
            row.result.mesa,
        )
        for row in rows
    ]
    jurisdiction_names = {
        key: row.establecimiento_name
        for key, row in zip(jurisdiction_keys, rows)
        if row.establecimiento_name is not None
    }
    jurisdiction_ids = db.batch_upsert_jurisdictions(
        conn,
        jurisdiction_keys,
        establecimiento_names=jurisdiction_names,
    )

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
            row.establecimiento,
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
