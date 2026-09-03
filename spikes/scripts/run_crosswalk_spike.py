"""One-off SPIKE driver for task 0.9 (design D9.5) — NOT production code.

Reads the real fiscalización CSV directly from its external, uncommitted
path (never copied into the repo by this script) and the extracted national
2025 results CSV (also external, gitignored under archive/). It delegates
D9.4 parsing to production ingestion before projecting only safe per-mesa
vote vectors, then runs a non-authoritative `match_vote_vectors` diagnostic
against the official DINE per-mesa vote vectors for distrito 02 / seccion 027
(Coronel Rosales).

Production ingestion strips Nombre/Apellido from raw bytes before it creates
any downstream row; this script receives no personal-data values.

Usage:
    uv run --with pytest python run_crosswalk_spike.py \
        --fiscalizacion "<path to the real CSV>" \
        --official-json "<path to cr_diputado_nacional.json>"
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import defaultdict
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path

if __package__ is None:
    sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "etl"))

from etl.crosswalk import (
    FISCALIZACION_VOTE_COLUMNS,
    OFFICIAL_AGRUPACION_NAME_BY_COLUMN,
    OFFICIAL_VOTOS_TIPO_BY_COLUMN,
)
from etl.ingest.fiscalizacion import FiscalizacionSchemaError, ingest_fiscalizacion
from etl.jurisdiction import normalize_distrito_code, normalize_seccion_code
from vote_vector_match import VectorShapeError, match_vote_vectors

OFFICIAL_REQUIRED_FIELDS = frozenset(
    {
        "año",
        "eleccion_tipo",
        "distrito_id",
        "seccion_id",
        "mesa_id",
        "cargo_nombre",
        "agrupacion_nombre",
        "votos_tipo",
        "votos_cantidad",
    }
)
OFFICIAL_DIMENSION_BY_AGRUPACION = {
    value: key for key, value in OFFICIAL_AGRUPACION_NAME_BY_COLUMN.items()
}
OFFICIAL_DIMENSION_BY_VOTOS_TIPO = {
    value: key for key, value in OFFICIAL_VOTOS_TIPO_BY_COLUMN.items()
}


@dataclass(frozen=True, order=True)
class InputProblem:
    reason: str
    mesa_id: str | None
    source_row_index: int


@dataclass(frozen=True)
class LoaderResult:
    vectors: tuple[tuple[str, tuple[int, ...]], ...]
    problems: tuple[InputProblem, ...]


def load_fiscalizacion_vectors(path: str | Path) -> LoaderResult:
    """Project production parser output onto privacy-safe diagnostic inputs."""
    try:
        parsed = ingest_fiscalizacion(Path(path).read_bytes(), archive_entry_id="spike")
    except FiscalizacionSchemaError:
        return LoaderResult((), (InputProblem("local_parser_refused", None, -1),))

    problems = [
        InputProblem(
            quarantine.reason, str(quarantine.mesa) if quarantine.mesa else None, index
        )
        for quarantine in parsed.quarantined
        for index in quarantine.source_row_indices
    ]
    vectors = []
    for row in parsed.rows:
        mesa_id = str(row.mesa)
        source_row_index = row.source_row_indices[0]
        if any(row.votes[column] is None for column in FISCALIZACION_VOTE_COLUMNS):
            problems.append(
                InputProblem("incomplete_local_vector", mesa_id, source_row_index)
            )
            continue
        vectors.append(
            (mesa_id, tuple(row.votes[column] for column in FISCALIZACION_VOTE_COLUMNS))
        )
    return LoaderResult(tuple(vectors), tuple(problems))


def _report(problems: tuple[InputProblem, ...], heading: str = "local") -> None:
    print(f"--- {heading} input problems ---")
    grouped: dict[str, list[InputProblem]] = defaultdict(list)
    for problem in sorted(
        problems,
        key=lambda item: (item.reason, item.mesa_id or "", item.source_row_index),
    ):
        grouped[problem.reason].append(problem)
    for reason, entries in grouped.items():
        print(f"{reason}: {len(entries)} problem(s)")
        for problem in entries[:5]:
            mesa = f"mesa {problem.mesa_id}" if problem.mesa_id else "unknown mesa"
            row = (
                f", source row {problem.source_row_index}"
                if problem.source_row_index >= 0
                else ""
            )
            print(f"  {mesa}{row}")
        if (omitted := len(entries) - 5) > 0:
            print(f"  omitted {omitted} additional problem(s)")


def _official_quantity(value: object) -> tuple[int | None, str | None]:
    if value is None or isinstance(value, str) and not value.strip():
        return None, "missing_official_quantity"
    if isinstance(value, (bool, float)):
        return None, "malformed_official_quantity"
    if isinstance(value, int):
        return (value, "negative_official_quantity") if value < 0 else (value, None)
    if not isinstance(value, str):
        return None, "malformed_official_quantity"
    if value.startswith("-") and value[1:].isascii() and value[1:].isdecimal():
        return None, "negative_official_quantity"
    if not value.isascii() or not value.isdecimal():
        return None, "malformed_official_quantity"
    if len(value) > 19:
        return None, "malformed_official_quantity"
    return int(value), None


def _official_dimension(row: dict[str, object]) -> str | None:
    votos_tipo = row["votos_tipo"]
    mapping, value = (
        (OFFICIAL_DIMENSION_BY_AGRUPACION, row["agrupacion_nombre"])
        if votos_tipo == "POSITIVO"
        else (OFFICIAL_DIMENSION_BY_VOTOS_TIPO, votos_tipo)
    )
    return mapping.get(value) if isinstance(value, str) else None


def load_official_vectors(rows_json_path: str | Path) -> LoaderResult:
    try:
        with Path(rows_json_path).open(encoding="utf-8") as source:
            rows = json.load(source)
    except (OSError, UnicodeDecodeError, json.JSONDecodeError):
        return LoaderResult((), (InputProblem("official_schema_refusal", None, -1),))
    if not isinstance(rows, list):
        return LoaderResult((), (InputProblem("official_schema_refusal", None, -1),))

    by_mesa: dict[str, dict[str, int]] = {}
    invalid_mesas: set[str] = set()
    problems: list[InputProblem] = []
    for raw_row in rows:
        if (
            not isinstance(raw_row, dict)
            or not OFFICIAL_REQUIRED_FIELDS <= raw_row.keys()
        ):
            problems.append(InputProblem("official_schema_refusal", None, -1))
            continue
        mesa = raw_row["mesa_id"]
        if (
            not isinstance(mesa, str)
            or not 1 <= len(mesa) <= 5
            or not mesa.isascii()
            or not mesa.isdecimal()
            or not any(character != "0" for character in mesa)
        ):
            problems.append(InputProblem("malformed_official_mesa_id", None, -1))
            continue
        if (
            raw_row["año"] != 2025
            or raw_row["eleccion_tipo"] != "GENERALES"
            or not isinstance(raw_row["distrito_id"], str)
            or normalize_distrito_code(raw_row["distrito_id"]) != "02"
            or not isinstance(raw_row["seccion_id"], str)
            or normalize_seccion_code(raw_row["seccion_id"]) != "027"
            or raw_row["cargo_nombre"] != "DIPUTADO NACIONAL"
        ):
            problems.append(InputProblem("official_scope_mismatch", mesa, -1))
            invalid_mesas.add(mesa)
            by_mesa.setdefault(mesa, {})
            continue
        quantity, quantity_problem = _official_quantity(raw_row["votos_cantidad"])
        if quantity_problem:
            problems.append(InputProblem(quantity_problem, mesa, -1))
            invalid_mesas.add(mesa)
            by_mesa.setdefault(mesa, {})
            continue
        dimension = _official_dimension(raw_row)
        if dimension is None:
            problems.append(InputProblem("unmappable_official_row", mesa, -1))
            invalid_mesas.add(mesa)
            by_mesa.setdefault(mesa, {})
            continue
        bucket = by_mesa.setdefault(mesa, {})
        if dimension in bucket:
            problems.append(
                InputProblem("duplicate_official_dimension_conflict", mesa, -1)
            )
            invalid_mesas.add(mesa)
            continue
        assert quantity is not None
        bucket[dimension] = quantity

    vectors = []
    dimensions = set(FISCALIZACION_VOTE_COLUMNS)
    for mesa, bucket in sorted(by_mesa.items()):
        if set(bucket) != dimensions:
            problems.append(InputProblem("incomplete_official_vector", mesa, -1))
            invalid_mesas.add(mesa)
        if mesa not in invalid_mesas:
            vectors.append(
                (mesa, tuple(bucket[column] for column in FISCALIZACION_VOTE_COLUMNS))
            )
    return LoaderResult(tuple(vectors), tuple(problems))


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--fiscalizacion", required=True)
    parser.add_argument("--official-json", required=True)
    args = parser.parse_args(argv)

    local = load_fiscalizacion_vectors(args.fiscalizacion)
    local_vectors = dict(local.vectors)
    print(f"local mesas parsed (usable): {len(local_vectors)}")
    if local.problems:
        _report(local.problems)
        print("terminal verdict: REFUSED")
        return 1

    official = load_official_vectors(args.official_json)
    official_vectors = dict(official.vectors)
    print(f"official mesas parsed (usable): {len(official_vectors)}")
    if official.problems:
        _report(official.problems, "official")
        print("terminal verdict: REFUSED")
        return 2

    identity_hits = 0
    identity_same_id_present = 0
    for local_id, local_vector in local_vectors.items():
        if local_id in official_vectors:
            identity_same_id_present += 1
            if official_vectors[local_id] == local_vector:
                identity_hits += 1
    print(
        f"\n(i) identity hypothesis: {identity_same_id_present}/{len(local_vectors)} local mesas "
        f"have a same-numbered official counterpart; {identity_hits} of those match EXACTLY"
    )

    try:
        result = match_vote_vectors(local_vectors, official_vectors)
    except VectorShapeError as error:
        print("\n(ii) vector-distance matching (NON-AUTHORITATIVE):")
        print(f"  vector shape refusal: {error}")
        print("  terminal verdict: REFUSED")
        return 2

    print("\n(ii) vector-distance matching (NON-AUTHORITATIVE):")
    print(f"  ambiguities: {len(result.ambiguities)}")
    for ambiguity in result.ambiguities:
        print(f"    {ambiguity}")
    print(f"  exact-claim conflicts: {len(result.conflicts)}")
    for conflict in result.conflicts:
        print(f"    {conflict}")
    print(f"  unmappable local mesas: {len(result.unmappable_local_ids)}")
    for local_id in result.unmappable_local_ids:
        print(f"    {local_id}")
    print(f"  exact numerator: {result.exact_match_count}")
    print(f"  exact denominator: {result.exact_match_denominator}")
    print(f"  exact matches: {result.exact_match_rate:.1%}")
    print(f"  injective: {result.injective}")

    dist_counts: dict[int, int] = {}
    for distance in result.best_match_distance.values():
        dist_counts[distance] = dist_counts.get(distance, 0) + 1
    print("  candidate-only distance distribution (distance -> local mesa count):")
    for distance in sorted(dist_counts):
        print(f"    {distance}: {dist_counts[distance]}")

    passes_threshold = result.passes_threshold(0.9)
    print(f"  diagnostic passes >=90% threshold: {passes_threshold}")
    print(f"  terminal verdict: {'PASS' if passes_threshold else 'BLOCKED'}")
    return 0 if passes_threshold else 1


if __name__ == "__main__":
    raise SystemExit(main())
