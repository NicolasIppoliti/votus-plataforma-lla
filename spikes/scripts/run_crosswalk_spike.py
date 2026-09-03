"""One-off SPIKE driver for task 0.9 (design D9.5) — NOT production code.

Reads the real fiscalización CSV directly from its external, uncommitted
path (never copied into the repo by this script) and the extracted national
2025 results CSV (also external, gitignored under archive/), applies the
D9.4 merge-then-validate + collapse rule to get 93 per-mesa vote vectors,
then calls the tested `match_vote_vectors` against the official DINE
per-mesa vote vectors for distrito 02 / seccion 027 (Coronel Rosales).

This script never writes personal data (Nombre/Apellido) anywhere — it
reads them only to perform the merge (a name-continuity check) and discards
them immediately after building the vote vector.

Usage:
    uv run --with pytest python run_crosswalk_spike.py \
        --fiscalizacion "<path to the real CSV>" \
        --official-json "<path to cr_diputado_nacional.json>"
"""

from __future__ import annotations

import argparse
import csv
import json
from collections import OrderedDict

from vote_vector_match import match_vote_vectors

# Ordered so index i of the fiscalización vector lines up with index i of
# the official vector built by `_official_vectors_from_rows`.
FISCALIZACION_VOTE_COLUMNS = [
    "La Libertad Avanza",
    "Nuevo Buenos Aires",
    "Liber.AR",
    "Frente de Izquierda",
    "Frente Patriota Federal",
    "Union Liberal",
    "Fuerza Patria",
    "Coalicion Civica",
    "Proyecto Sur",
    "Propuesta Federal",
    "Provincias Unidas",
    "Potencia",
    "Union Federal",
    "Nuevos Aires",
    "Movimiento Socialista",
    "En blanco",
    "Impugnado",
]

# Curated by inspecting the real DINE `agrupacion_nombre` / `votos_tipo`
# values for distrito 02 / seccion 027, cargo DIPUTADO NACIONAL (task 0.9
# evidence). Order matches FISCALIZACION_VOTE_COLUMNS above.
OFFICIAL_AGRUPACION_BY_COLUMN = {
    "La Libertad Avanza": "ALIANZA LA LIBERTAD AVANZA",
    "Nuevo Buenos Aires": "PARTIDO NUEVO BUENOS AIRES",
    "Liber.AR": "LIBER.AR",
    "Frente de Izquierda": "FRENTE DE IZQUIERDA Y DE TRABAJADORES - UNIDAD",
    "Frente Patriota Federal": "FRENTE PATRIOTA FEDERAL",
    "Union Liberal": "UNIÓN LIBERAL",
    "Fuerza Patria": "ALIANZA FUERZA PATRIA",
    "Coalicion Civica": "COALICIÓN CÍVICA - A.R.I.",
    "Proyecto Sur": "MOVIMIENTO POLÍTICO SOCIAL Y CULTURAL PROYECTO SUR",
    "Propuesta Federal": "PROPUESTA FEDERAL PARA EL CAMBIO",
    "Provincias Unidas": "ALIANZA PROVINCIAS UNIDAS",
    "Potencia": "ALIANZA POTENCIA",
    "Union Federal": "ALIANZA UNIÓN FEDERAL",
    "Nuevos Aires": "ALIANZA NUEVOS AIRES",
    "Movimiento Socialista": "MOVIMIENTO AVANZADA SOCIALISTA",
}
# "En blanco" / "Impugnado" are matched on votos_tipo, not agrupacion_nombre.
OFFICIAL_VOTOS_TIPO_BY_COLUMN = {
    "En blanco": "EN BLANCO",
    "Impugnado": "IMPUGNADO",
}


def _parse_local_mesa_number(raw_mesa: str) -> int | None:
    # e.g. "Mesa 52" -> 52
    digits = "".join(ch for ch in raw_mesa if ch.isdigit())
    return int(digits) if digits else None


def load_fiscalizacion_vectors(
    path: str,
) -> tuple[dict[str, tuple[int, ...]], list[str]]:
    """Apply D9.4 merge-then-validate + collapse, return {local_mesa_id: vector}.

    Returns (vectors, notes) — notes records merges/collapses/quarantines for
    the SPIKE findings doc, never any name.
    """
    with open(path, newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))

    notes: list[str] = []
    merged: list[dict[str, str]] = []
    pending: dict[str, str] | None = None

    for row in rows:
        mesa_raw = (row.get("Mesa") or "").strip()
        if mesa_raw:
            if pending is not None:
                merged.append(pending)
            pending = dict(row)
        else:
            # Continuation row: merge non-empty trailing columns into pending.
            if pending is None:
                notes.append(
                    "quarantined: empty-Mesa row with no preceding row to merge into"
                )
                continue
            for col in FISCALIZACION_VOTE_COLUMNS:
                if (row.get(col) or "").strip() and not (
                    pending.get(col) or ""
                ).strip():
                    pending[col] = row[col]
            notes.append(f"merged continuation row into Mesa {pending.get('Mesa')}")
    if pending is not None:
        merged.append(pending)

    # Collapse identical duplicate Mesa rows; quarantine conflicting ones.
    by_mesa: OrderedDict[int, list[dict[str, str]]] = OrderedDict()
    for row in merged:
        mesa_num = _parse_local_mesa_number(row.get("Mesa") or "")
        if mesa_num is None:
            notes.append("quarantined: unparseable Mesa value")
            continue
        by_mesa.setdefault(mesa_num, []).append(row)

    vectors: dict[str, tuple[int, ...]] = {}
    for mesa_num, mesa_rows in by_mesa.items():
        vecs = []
        has_blank_cell = False
        for row in mesa_rows:
            values = []
            for col in FISCALIZACION_VOTE_COLUMNS:
                cell = (row.get(col) or "").strip()
                if cell == "":
                    has_blank_cell = True
                    values.append(None)
                else:
                    values.append(int(cell))
            vecs.append(tuple(values))
        distinct = {v for v in vecs if None not in v}
        if len(vecs) > 1:
            if len(distinct) <= 1 and not has_blank_cell:
                notes.append(
                    f"collapsed {len(vecs)} identical duplicate rows for Mesa {mesa_num}"
                )
            elif len(distinct) > 1:
                notes.append(
                    f"quarantined: conflicting duplicate rows for Mesa {mesa_num}"
                )
                continue
        if has_blank_cell:
            notes.append(
                f"Mesa {mesa_num}: blank vote cell present, excluded from exact-match vector"
            )
            continue
        vectors[str(mesa_num)] = vecs[0]

    return vectors, notes


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
            if col in OFFICIAL_AGRUPACION_BY_COLUMN:
                values.append(bucket.get(OFFICIAL_AGRUPACION_BY_COLUMN[col], 0))
            else:
                values.append(bucket.get(OFFICIAL_VOTOS_TIPO_BY_COLUMN[col], 0))
        vectors[mesa_id] = tuple(values)
    return vectors


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--fiscalizacion", required=True)
    parser.add_argument("--official-json", required=True)
    args = parser.parse_args()

    local_vectors, notes = load_fiscalizacion_vectors(args.fiscalizacion)
    official_vectors = load_official_vectors(args.official_json)

    print(f"local mesas parsed (usable, no blank cells): {len(local_vectors)}")
    print(f"official mesas: {len(official_vectors)}")
    print("--- parse notes (no personal data) ---")
    for n in notes:
        print(" ", n)

    # (i) identity hypothesis: local N == DINE mesa_id N within the district.
    # NOTE: resultados2025.csv's mesa_id is unpadded ("1", not "00001") while
    # localesDeVotacionyMesas.csv zero-pads ("00057") — a real cross-file
    # schema inconsistency, recorded in the SPIKE findings (task 0.3/0.9).
    identity_hits = 0
    identity_same_id_present = 0
    for local_id in local_vectors:
        if local_id in official_vectors:
            identity_same_id_present += 1
            if official_vectors[local_id] == local_vectors[local_id]:
                identity_hits += 1
    print(
        f"\n(i) identity hypothesis: {identity_same_id_present}/{len(local_vectors)} local mesas "
        f"have a same-numbered official counterpart; {identity_hits} of those match EXACTLY"
    )

    # (ii) independent vector-distance matching.
    result = match_vote_vectors(local_vectors, official_vectors)
    print("\n(ii) vector-distance matching:")
    print(
        f"  exact matches: {result.exact_match_count}/{len(local_vectors)} ({result.exact_match_rate:.1%})"
    )
    print(f"  injective: {result.injective}")
    print(f"  conflicts: {result.conflicts}")
    print(f"  passes >=90% threshold: {result.passes_threshold(0.9)}")

    dist_counts: dict[int, int] = {}
    for d in result.best_match_distance.values():
        dist_counts[d] = dist_counts.get(d, 0) + 1
    print("\n  best-match-distance distribution (distance -> count of local mesas):")
    for d in sorted(dist_counts):
        print(f"    {d}: {dist_counts[d]}")


if __name__ == "__main__":
    main()
