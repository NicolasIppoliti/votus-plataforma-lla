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
from collections.abc import Callable, Iterable, Iterator
from contextlib import nullcontext
from dataclasses import dataclass
from typing import TextIO

from etl import db
from etl.ingest_metrics import IngestMetrics
from etl.jurisdiction import (
    JurisdictionNames,
    ResultRow,
    is_canonicalizable_circuito_code,
    is_canonicalizable_code,
    make_result_row,
    normalize_circuito_code,
    normalize_circuito_name,
    normalize_distrito_code,
    normalize_seccion_code,
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
    "distrito_nombre",
    "seccion_id",
    "seccion_nombre",
    "circuito_id",
    "circuito_nombre",
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
    jurisdiction_names: JurisdictionNames = JurisdictionNames()
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

    @property
    def establecimiento_name(self) -> str | None:
        return self.jurisdiction_names.establecimiento


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


CompanionKey = tuple[str, str, int]


def _national_companion_key(
    distrito_id: object,
    seccion_id: object,
    mesa_id: object,
) -> CompanionKey | None:
    """Return the canonical national key shared by every companion operation."""
    if not is_canonicalizable_code(distrito_id) or not is_canonicalizable_code(seccion_id):
        return None
    if not isinstance(distrito_id, str) or not isinstance(seccion_id, str):
        return None
    mesa = _normalize_mesa_id(str(mesa_id)) if isinstance(mesa_id, (str, int)) else None
    if mesa is None:
        return None
    distrito = normalize_distrito_code(distrito_id)
    seccion = normalize_seccion_code(seccion_id)
    assert distrito is not None and seccion is not None
    return distrito, seccion, mesa


def _parse_establecimientos(
    csv_bytes: bytes | None,
    *,
    source_label: str,
    metrics: IngestMetrics | None = None,
) -> tuple[dict[CompanionKey, tuple[str, str]], dict[CompanionKey, frozenset[str]]]:
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

    by_mesa: dict[CompanionKey, tuple[str, str]] = {}
    metadata_by_key: dict[CompanionKey, set[tuple[str, str]]] = {}
    names_by_code: dict[str, set[str]] = {}
    keys_by_code: dict[str, set[CompanionKey]] = {}
    excluded: dict[str, int] = {}
    if metrics is not None:
        metrics.data["companion_conflicts"] = {
            "input_exclusions": excluded,
            "input_unique_conflict_keys": None,
            "input_conflict_keys": None,
            "result_rows": None,
            "result_votes": None,
            "result_keys": None,
            "result_reasons": None,
        }
    for raw in reader:
        key = _national_companion_key(
            raw.get("distrito_id"), raw.get("seccion_id"), raw.get("mesa_id")
        )
        if key is None:
            reason = "unreadable distrito/seccion/mesa identity"
            excluded[reason] = excluded.get(reason, 0) + 1
            continue
        code = (raw.get("localvotacion_codigo") or "").strip()
        name = (raw.get("localvotacion_nombre") or "").strip()
        if not code or not name:
            reason = "absent establecimiento code or name"
            excluded[reason] = excluded.get(reason, 0) + 1
            continue

        metadata = (code, name)
        by_mesa.setdefault(key, metadata)
        metadata_by_key.setdefault(key, set()).add(metadata)
        names_by_code.setdefault(code, set()).add(name)
        keys_by_code.setdefault(code, set()).add(key)

    conflict_reasons: dict[CompanionKey, set[str]] = {}
    for key, metadata in metadata_by_key.items():
        if len(metadata) > 1:
            conflict_reasons.setdefault(key, set()).add("mesa_metadata_conflict")
    for code, names in names_by_code.items():
        if len(names) > 1:
            for key in keys_by_code[code]:
                conflict_reasons.setdefault(key, set()).add("establishment_code_multiple_names")

    if excluded:
        breakdown = "; ".join(
            f"{reason}: {count} row(s)" for reason, count in sorted(excluded.items())
        )
        print(
            f"excluded {sum(excluded.values())} establecimiento companion row(s) — {breakdown}",
            file=sys.stderr,
        )
    frozen_conflict_reasons = {key: frozenset(reasons) for key, reasons in conflict_reasons.items()}
    counts = {}
    if frozen_conflict_reasons:
        counts = {
            reason: sum(reason in reasons for reasons in frozen_conflict_reasons.values())
            for reason in sorted(
                {reason for reasons in frozen_conflict_reasons.values() for reason in reasons}
            )
        }
        parts = [f"{reason}: {count} unique key(s)" for reason, count in counts.items()]
        overlap = sum(len(reasons) > 1 for reasons in frozen_conflict_reasons.values())
        if overlap:
            parts.append(f"overlap: {overlap} unique key(s)")
        print(
            f"quarantined {len(frozen_conflict_reasons)} unique establecimiento companion "
            f"mesa key(s) — {'; '.join(parts)}",
            file=sys.stderr,
        )
    if metrics is not None:
        metrics.data["companion_conflicts"].update(
            input_unique_conflict_keys=len(frozen_conflict_reasons),
            input_conflict_keys=counts,
        )
    return by_mesa, frozen_conflict_reasons


def _report_exclusions(
    rows_by_reason: dict[str, int],
    votes_by_reason: dict[str, int],
    unparseable_by_reason: dict[str, int],
) -> None:
    """Print the per-reason exclusion breakdown, in rows and in votes.

    Same shape and destination as duplicate-key quarantine reporting, so one
    ingest run reports every exclusion it made in one place.
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


NaturalKey = tuple[str, str | None, str | None, int | None, str, str | None]


@dataclass(slots=True)
class _NaturalKeyStats:
    count: int
    votes: int


def _national_reader(csv_text: TextIO) -> csv.DictReader:
    reader = csv.DictReader(csv_text)
    fieldnames = set(reader.fieldnames or ())
    missing = [column for column in REQUIRED_COLUMNS if column not in fieldnames]
    if missing:
        raise NationalSchemaError(
            "unrecognized national results structure — missing required "
            f"column(s): {', '.join(missing)}"
        )
    return reader


def _candidate_from_raw(
    raw: dict[str, str | None],
    *,
    index: int,
    archive_entry_id: str,
    election_year: int,
    election_round: str,
    establecimientos: dict[CompanionKey, tuple[str, str]],
    conflicting_establecimientos: dict[CompanionKey, frozenset[str]],
    has_companion: bool,
    exclude: Callable[[str, str | None], None],
    record_companion_conflict: Callable[[CompanionKey, frozenset[str], int], None],
) -> NationalRow | None:
    mesa_tipo = validate_mesa_tipo(
        raw.get("mesa_tipo"),
        source_label=archive_entry_id,
        source_row_index=index,
    )
    agrupacion_id = (raw.get("agrupacion_id") or "").strip()
    votos_tipo = raw["votos_tipo"]
    if votos_tipo != "POSITIVO":
        exclude(f"votos_tipo={votos_tipo!r}", raw.get("votos_cantidad"))
        return None
    if not agrupacion_id:
        exclude("agrupacion_id empty", raw.get("votos_cantidad"))
        return None
    if agrupacion_id == "0":
        exclude('agrupacion_id "0"', raw.get("votos_cantidad"))
        return None

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
        return None

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
        return None
    votes = _parse_int(raw.get("votos_cantidad"))
    if votes is None:
        exclude("unreadable votos_cantidad", None)
        return None

    establecimiento: str | None = None
    establecimiento_name: str | None = None
    if has_companion:
        mesa_key = _national_companion_key(raw.get("distrito_id"), raw.get("seccion_id"), mesa_id)
        assert mesa_key is not None
        conflict_reasons = conflicting_establecimientos.get(mesa_key)
        if conflict_reasons is not None:
            record_companion_conflict(mesa_key, conflict_reasons, votes)
            return None
        metadata = establecimientos.get(mesa_key)
        if metadata is None:
            exclude("missing establecimiento companion match", raw.get("votos_cantidad"))
            return None
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
    return NationalRow(
        result=result,
        estado_final=raw.get("estado_final") or None,
        mesa_tipo=mesa_tipo,
        jurisdiction_names=JurisdictionNames(
            distrito=raw["distrito_nombre"],
            seccion=raw["seccion_nombre"],
            circuito=normalize_circuito_name(raw["circuito_nombre"], raw["circuito_id"]),
            establecimiento=establecimiento_name,
        ),
        archive_entry_id=archive_entry_id,
        source_row_index=index,
    )


def _natural_key(row: NationalRow) -> NaturalKey:
    return (
        row.result.distrito,
        row.result.seccion,
        row.result.circuito,
        row.result.mesa,
        row.category,
        row.list_id,
    )


def _companion_key_from_natural_key(key: NaturalKey) -> CompanionKey:
    companion_key = _national_companion_key(key[0], key[1], key[3])
    assert companion_key is not None
    return companion_key


def _report_companion_result_conflicts(
    stats_by_key: dict[CompanionKey, _NaturalKeyStats],
    conflict_reasons_by_key: dict[CompanionKey, frozenset[str]],
) -> None:
    if not stats_by_key:
        return
    total_rows = sum(stats.count for stats in stats_by_key.values())
    total_votes = sum(stats.votes for stats in stats_by_key.values())
    reason_rows: dict[str, int] = {}
    reason_votes: dict[str, int] = {}
    overlap_rows = 0
    overlap_votes = 0
    for key, stats in stats_by_key.items():
        reasons = conflict_reasons_by_key[key]
        for reason in reasons:
            reason_rows[reason] = reason_rows.get(reason, 0) + stats.count
            reason_votes[reason] = reason_votes.get(reason, 0) + stats.votes
        if len(reasons) > 1:
            overlap_rows += stats.count
            overlap_votes += stats.votes
    parts = [
        f"{reason}: {reason_rows[reason]} row(s) / {reason_votes[reason]} votes"
        for reason in sorted(reason_rows)
    ]
    if overlap_rows:
        parts.append(f"overlap: {overlap_rows} row(s) / {overlap_votes} votes")
    print(
        f"quarantined {total_rows} result row(s) / {total_votes} votes across "
        f"{len(stats_by_key)} conflicted establecimiento companion mesa key(s) — "
        f"{'; '.join(parts)}",
        file=sys.stderr,
    )


def _report_ambiguous_natural_keys(
    stats_by_key: dict[NaturalKey, _NaturalKeyStats], ambiguous_keys: set[NaturalKey]
) -> None:
    if not ambiguous_keys:
        return
    categories: dict[str, int] = {}
    keys_by_category: dict[str, int] = {}
    votes_by_category: dict[str, int] = {}
    for key, stats in stats_by_key.items():
        if key not in ambiguous_keys:
            continue
        category = key[4]
        categories[category] = categories.get(category, 0) + stats.count
        keys_by_category[category] = keys_by_category.get(category, 0) + 1
        votes_by_category[category] = votes_by_category.get(category, 0) + stats.votes
    dropped = sum(categories.values())
    breakdown = ", ".join(
        f"{name} {count} rows / {votes_by_category[name]} votes "
        f"across {keys_by_category[name]} keys"
        for name, count in sorted(categories.items(), key=lambda item: -item[1])
    )
    print(
        f"quarantined {dropped} rows across {len(ambiguous_keys)} ambiguous natural keys "
        f"({breakdown}) -- indistinguishable in the source except by vote count, "
        "so no row was loaded for them",
        file=sys.stderr,
    )


def iter_national_rows(
    csv_text: TextIO,
    *,
    archive_entry_id: str,
    election_year: int,
    election_round: str,
    establecimientos_csv_bytes: bytes | None = None,
    metrics: IngestMetrics | None = None,
) -> Iterator[NationalRow]:
    """Validate a seekable national CSV in pass one, then emit rows in pass two."""
    establecimientos, conflicting_establecimientos = _parse_establecimientos(
        establecimientos_csv_bytes,
        source_label=archive_entry_id,
        metrics=metrics,
    )
    excluded_rows: dict[str, int] = {}
    excluded_votes: dict[str, int] = {}
    excluded_unparseable: dict[str, int] = {}
    companion_conflict_stats: dict[CompanionKey, _NaturalKeyStats] = {}

    def exclude(reason: str, raw_votes: str | None) -> None:
        excluded_rows[reason] = excluded_rows.get(reason, 0) + 1
        votes = parse_source_int(raw_votes)
        if metrics is not None:
            metrics.record_exclusion(reason, votes, category=raw.get("cargo_nombre") or "")
        if votes is None:
            excluded_unparseable[reason] = excluded_unparseable.get(reason, 0) + 1
        else:
            excluded_votes[reason] = excluded_votes.get(reason, 0) + votes

    def record_companion_conflict(key: CompanionKey, reasons: frozenset[str], votes: int) -> None:
        stats = companion_conflict_stats.get(key)
        if stats is None:
            companion_conflict_stats[key] = _NaturalKeyStats(count=1, votes=votes)
        else:
            stats.count += 1
            stats.votes += votes
        if metrics is not None:
            companion = metrics.data["companion_conflicts"]
            companion["result_rows"] += 1
            companion["result_votes"] += votes
            companion["result_keys"] = len(companion_conflict_stats)
            for reason in reasons:
                metrics.record_category_exclusion(raw.get("cargo_nombre") or "", reason, votes)
                bucket = companion["result_reasons"].setdefault(reason, {"rows": 0, "votes": 0})
                bucket["rows"] += 1
                bucket["votes"] += votes

    csv_text.seek(0)
    circuits_by_companion_key: dict[CompanionKey, set[str]] = {}
    stats_by_key: dict[NaturalKey, _NaturalKeyStats] = {}
    reader = _national_reader(csv_text)
    if metrics is not None:
        metrics.data.update(
            first_pass="partial",
            records_seen=0,
            candidate_keys=0,
            exclusions={},
            categories={},
        )
        if metrics.data["companion_conflicts"] is not None:
            metrics.data["companion_conflicts"].update(
                result_rows=0,
                result_votes=0,
                result_keys=0,
                result_reasons={},
            )
    for index, raw in enumerate(reader):
        if metrics is not None:
            metrics.data["records_seen"] += 1
            # Empty and absent source categories share the unnamed bucket; never trim names.
            category = metrics.data["categories"].setdefault(
                raw.get("cargo_nombre") or "",
                {"records_seen": 0, "rows_emitted": None, "exclusions": {}},
            )
            category["records_seen"] += 1
        if establecimientos_csv_bytes is not None:
            companion_key = _national_companion_key(
                raw.get("distrito_id"), raw.get("seccion_id"), raw.get("mesa_id")
            )
            raw_circuito = raw.get("circuito_id")
            if companion_key is not None and is_canonicalizable_circuito_code(raw_circuito):
                circuito = normalize_circuito_code(raw_circuito)
                assert circuito is not None
                circuits_by_companion_key.setdefault(companion_key, set()).add(circuito)
        row = _candidate_from_raw(
            raw,
            index=index,
            archive_entry_id=archive_entry_id,
            election_year=election_year,
            election_round=election_round,
            establecimientos=establecimientos,
            conflicting_establecimientos=conflicting_establecimientos,
            has_companion=establecimientos_csv_bytes is not None,
            exclude=exclude,
            record_companion_conflict=record_companion_conflict,
        )
        if row is None:
            continue
        key = _natural_key(row)
        stats = stats_by_key.get(key)
        if stats is None:
            stats_by_key[key] = _NaturalKeyStats(count=1, votes=row.result.votes)
        else:
            stats.count += 1
            stats.votes += row.result.votes
        if metrics is not None:
            metrics.data["candidate_keys"] = len(stats_by_key)

    ambiguous_companion_keys = {
        key for key, circuits in circuits_by_companion_key.items() if len(circuits) > 1
    }
    for key, stats in stats_by_key.items():
        if _companion_key_from_natural_key(key) in ambiguous_companion_keys:
            if metrics is not None:
                metrics.record_exclusion(
                    "ambiguous result circuits for establecimiento companion",
                    stats.votes,
                    stats.count,
                    category=key[4],
                )
            excluded_rows["ambiguous result circuits for establecimiento companion"] = (
                excluded_rows.get("ambiguous result circuits for establecimiento companion", 0)
                + stats.count
            )
            excluded_votes["ambiguous result circuits for establecimiento companion"] = (
                excluded_votes.get("ambiguous result circuits for establecimiento companion", 0)
                + stats.votes
            )
    ambiguous_natural_keys = {
        key
        for key, stats in stats_by_key.items()
        if stats.count > 1 and _companion_key_from_natural_key(key) not in ambiguous_companion_keys
    }
    if metrics is not None:
        categories = metrics.data["ambiguous_categories"] = {}
        for key in ambiguous_natural_keys:
            metrics.record_category_exclusion(
                key[4], "ambiguous natural key", stats_by_key[key].votes, stats_by_key[key].count
            )
            bucket = categories.setdefault(key[4], {"rows": 0, "votes": 0, "keys": 0})
            bucket["rows"] += stats_by_key[key].count
            bucket["votes"] += stats_by_key[key].votes
            bucket["keys"] += 1
    _report_exclusions(excluded_rows, excluded_votes, excluded_unparseable)
    _report_companion_result_conflicts(companion_conflict_stats, conflicting_establecimientos)
    _report_ambiguous_natural_keys(stats_by_key, ambiguous_natural_keys)

    if metrics is not None:
        metrics.data.update(first_pass="complete", iteration="partial", rows_emitted=0)
        for category in metrics.data["categories"].values():
            category["rows_emitted"] = 0
    csv_text.seek(0)
    for index, raw in enumerate(_national_reader(csv_text)):
        row = _candidate_from_raw(
            raw,
            index=index,
            archive_entry_id=archive_entry_id,
            election_year=election_year,
            election_round=election_round,
            establecimientos=establecimientos,
            conflicting_establecimientos=conflicting_establecimientos,
            has_companion=establecimientos_csv_bytes is not None,
            exclude=lambda _reason, _votes: None,
            record_companion_conflict=lambda _key, _reasons, _votes: None,
        )
        if row is None:
            continue
        companion_key = _national_companion_key(row.result.distrito, row.result.seccion, row.mesa)
        assert companion_key is not None
        if companion_key in ambiguous_companion_keys:
            continue
        if _natural_key(row) in ambiguous_natural_keys:
            continue
        if metrics is not None:
            metrics.data["rows_emitted"] += 1
            metrics.data["categories"][raw.get("cargo_nombre") or ""]["rows_emitted"] += 1
        yield row
    if metrics is not None:
        metrics.data["iteration"] = "complete"


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
    conn,
    rows: Iterable[NationalRow],
    *,
    year: int,
    round_: str,
    archive_entry_id: str,
    batch_size: int = 1_000,
) -> int:
    """Atomically replace one archive scope while preserving lazy row streaming."""
    transaction = conn.transaction() if hasattr(conn, "transaction") else nullcontext()
    with transaction:
        return _load_national_rows(
            conn,
            rows,
            year=year,
            round_=round_,
            archive_entry_id=archive_entry_id,
            batch_size=batch_size,
        )


def _load_national_rows(
    conn,
    rows: Iterable[NationalRow],
    *,
    year: int,
    round_: str,
    archive_entry_id: str,
    batch_size: int = 1_000,
) -> int:
    """Resolve and insert national rows in bounded transaction-local batches.

    The replacement scope is deleted once before the first insert-only batch.

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
    if batch_size <= 0:
        raise ValueError("national result-row batch_size must be positive")

    db.lock_archive_entry_source_authority(
        conn,
        archive_entry_id=archive_entry_id,
        expected_source_kind="official",
    )
    election_id = db.upsert_election(conn, year=year, round_=round_)
    replacement = db.begin_result_rows_replacement(
        conn,
        archive_entry_id=archive_entry_id,
        election_id=election_id,
        source_kind="official",
    )
    category_cache: dict[str, str] = {}
    iterator = iter(rows)

    while True:
        batch: list[NationalRow] = []
        try:
            for _ in range(batch_size):
                batch.append(next(iterator))
        except StopIteration:
            pass
        if not batch:
            break
        if any(row.archive_entry_id != archive_entry_id for row in batch):
            raise ValueError(
                "load_national_rows requires every row to carry the archive_entry_id given"
            )

        jurisdiction_keys = [
            (
                row.result.distrito,
                row.result.seccion,
                row.result.circuito,
                row.establecimiento,
                row.result.mesa,
            )
            for row in batch
        ]
        jurisdiction_ids = db.batch_upsert_jurisdictions(
            conn,
            jurisdiction_keys,
            names=[row.jurisdiction_names for row in batch],
        )
        result_records: list[db.ResultRowRecord] = []
        for row in batch:
            category_id = category_cache.get(row.category)
            if category_id is None:
                category_id = db.upsert_category(conn, name=row.category)
                category_cache[row.category] = category_id
            jurisdiction_id = jurisdiction_ids[
                (
                    row.result.distrito,
                    row.result.seccion,
                    row.result.circuito,
                    row.establecimiento,
                    row.result.mesa,
                )
            ]
            result_records.append(
                db.ResultRowRecord(
                    election_id=election_id,
                    jurisdiction_id=jurisdiction_id,
                    category_id=category_id,
                    granularity=row.granularity,
                    list_id=row.list_id,
                    votes=row.result.votes,
                    source_kind="official",
                    archive_entry_id=row.archive_entry_id,
                    source_row_index=row.source_row_index,
                    mesa_tipo=row.mesa_tipo,
                )
            )
        replacement.insert(result_records)
        if len(batch) < batch_size:
            break

    return replacement.inserted
