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
from vote_vector_match import VectorShapeError, match_vote_vectors


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


def _report(problems: tuple[InputProblem, ...]) -> None:
    print("--- local input problems ---")
    grouped: dict[str, list[InputProblem]] = defaultdict(list)
    for problem in sorted(
        problems,
        key=lambda item: (item.reason, item.mesa_id or "", item.source_row_index),
    ):
        grouped[problem.reason].append(problem)
    for reason, entries in grouped.items():
        print(f"{reason}: {len(entries)} problem(s)")
        for problem in entries[:5]:
            mesa = (
                f"mesa {problem.mesa_id}"
                if problem.mesa_id is not None
                else "unknown mesa"
            )
            print(f"  {mesa}, source row {problem.source_row_index}")
        if (omitted := len(entries) - 5) > 0:
            print(f"  omitted {omitted} additional problem(s)")


def load_official_vectors(rows_json_path: str) -> dict[str, tuple[int, ...]]:
    with open(rows_json_path, encoding="utf-8") as f:
        rows = json.load(f)

    by_mesa: dict[str, dict[str, int]] = {}
    for row in rows:
        mesa_id = row["mesa_id"]
        agrupacion = row["agrupacion_nombre"]
        votos_tipo = row["votos_tipo"]
        cantidad = int(row["votos_cantidad"] or 0)
        bucket = by_mesa.setdefault(mesa_id, {})
        if votos_tipo == "POSITIVO":
            bucket[agrupacion] = bucket.get(agrupacion, 0) + cantidad
        elif votos_tipo in ("EN BLANCO", "IMPUGNADO"):
            bucket[votos_tipo] = bucket.get(votos_tipo, 0) + cantidad

    vectors: dict[str, tuple[int, ...]] = {}
    for mesa_id, bucket in by_mesa.items():
        values = []
        for col in FISCALIZACION_VOTE_COLUMNS:
            if col in OFFICIAL_AGRUPACION_NAME_BY_COLUMN:
                values.append(bucket.get(OFFICIAL_AGRUPACION_NAME_BY_COLUMN[col], 0))
            else:
                values.append(bucket.get(OFFICIAL_VOTOS_TIPO_BY_COLUMN[col], 0))
        vectors[mesa_id] = tuple(values)
    return vectors


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

    official_vectors = load_official_vectors(args.official_json)
    print(f"official mesas: {len(official_vectors)}")

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
        print("  official validation pending PR2b")
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

    print(f"  diagnostic passes >=90% threshold: {result.passes_threshold(0.9)}")
    print("  official validation pending PR2b")
    print("  terminal verdict: REFUSED")
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
