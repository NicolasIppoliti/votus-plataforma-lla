"""National <-> PBA jurisdiction crosswalk, cross-year mesa stability, and
the fiscalización mesa identity join (`jurisdiction-model` spec; design D9.5;
the ACCEPTED mesa-identity decision, Engram #1410).

Three independent concerns live here, all curator-reviewed rather than
auto-inferred at ingest time (jurisdiction-model: "The crosswalk MUST NOT be
inferred automatically from name-matching alone"):

1. `CrosswalkTable` / `resolve_jurisdiction`: PBA distrito code <-> national
   (DINE) distrito/seccion code, loaded from the curated
   `curated/crosswalk.yaml`. An unmapped code is QUARANTINED (returned as
   `QuarantinedJurisdiction` data, never silently assigned to an unrelated
   jurisdiction and never raised as a swallowed exception).
2. `compute_mesa_stability`: whether a mesa code observed in one archived
   year is also observed in the other, so a code present in only one year is
   reported as a discontinuity rather than silently dropped or substituted.
3. `join_fiscalizacion_identity`: joins fiscalización mesa rows to official
   mesa rows BY IDENTITY (mesa number), per the product-owner's ACCEPTED
   decision (Engram #1410) -- never by vote-vector matching, which was only
   ever a SPIKE-time diagnostic, not the production join strategy. A
   diverging per-mesa tally is recorded as an informational `MesaDivergence`
   and MUST NOT block the join; the `Impugnado`/`En blanco` columns
   specifically are modelled as an EXPECTED category-definition difference
   between a fiscal's provisional judgement and the definitive escrutinio,
   and are never counted as a "real" (non-expected) divergence.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml

# Ordered so index i of a fiscalización vector lines up with the matching
# official column. Reused verbatim from the SPIKE's recovered mapping
# (`spikes/scripts/run_crosswalk_spike.py::FISCALIZACION_VOTE_COLUMNS`) --
# the same 17-column shape the SPIKE validated against real data, not a
# fresh reinvention.
FISCALIZACION_VOTE_COLUMNS: tuple[str, ...] = (
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
)

# Fiscalización column -> official `agrupacion_nombre`. Reused verbatim from
# `spikes/scripts/run_crosswalk_spike.py::OFFICIAL_AGRUPACION_BY_COLUMN`
# (curated by inspecting the real DINE values for distrito 02 / seccion 027,
# cargo DIPUTADO NACIONAL) -- this is provisional curator input for Phase 7's
# `curated/party_map.yaml`, not a substitute for that phase's formal review.
OFFICIAL_AGRUPACION_NAME_BY_COLUMN: dict[str, str] = {
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

# "En blanco" / "Impugnado" match on `votos_tipo`, not `agrupacion_nombre`.
OFFICIAL_VOTOS_TIPO_BY_COLUMN: dict[str, str] = {
    "En blanco": "EN BLANCO",
    "Impugnado": "IMPUGNADO",
}

# Columns where a divergence is an EXPECTED category-definition difference
# between source kinds (a fiscal's provisional judgement at the table vs the
# definitive escrutinio's resolution) -- MUST NEVER be counted as generic
# tally drift (design D9.5 correction, Engram #1410).
EXPECTED_CATEGORY_DIVERGENCE_COLUMNS: frozenset[str] = frozenset({"En blanco", "Impugnado"})


# --- 1. PBA <-> national jurisdiction crosswalk ----------------------------


@dataclass(frozen=True)
class JurisdictionCrosswalkEntry:
    """One curated PBA-distrito <-> national-distrito/seccion mapping."""

    pba_distrito_code: str
    national_distrito_code: str
    national_seccion_code: str
    name: str


@dataclass(frozen=True)
class QuarantinedJurisdiction:
    """A jurisdiction code with no curated crosswalk entry.

    Returned as data -- never silently assigned to an unrelated
    jurisdiction, and never a swallowed exception (jurisdiction-model spec,
    "An unmapped jurisdiction code is encountered" scenario).
    """

    code: str
    reason: str


@dataclass(frozen=True)
class CrosswalkTable:
    jurisdictions: tuple[JurisdictionCrosswalkEntry, ...]

    def resolve_pba(self, pba_distrito_code: str) -> JurisdictionCrosswalkEntry | None:
        for entry in self.jurisdictions:
            if entry.pba_distrito_code == pba_distrito_code:
                return entry
        return None

    def resolve_national(
        self, *, distrito_code: str, seccion_code: str
    ) -> JurisdictionCrosswalkEntry | None:
        for entry in self.jurisdictions:
            if (
                entry.national_distrito_code == distrito_code
                and entry.national_seccion_code == seccion_code
            ):
                return entry
        return None


def load_crosswalk(path: Path) -> CrosswalkTable:
    """Load the curated `curated/crosswalk.yaml` jurisdiction mapping."""
    data: dict[str, Any] = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    entries = tuple(
        JurisdictionCrosswalkEntry(
            pba_distrito_code=str(j["pba_distrito"]),
            national_distrito_code=str(j["national_distrito"]),
            national_seccion_code=str(j["national_seccion"]),
            name=j["name"],
        )
        for j in data.get("jurisdictions", [])
    )
    return CrosswalkTable(jurisdictions=entries)


def resolve_jurisdiction(
    table: CrosswalkTable, *, pba_distrito_code: str
) -> JurisdictionCrosswalkEntry | QuarantinedJurisdiction:
    """Resolve a PBA distrito code, or quarantine it if uncurated."""
    entry = table.resolve_pba(pba_distrito_code)
    if entry is None:
        return QuarantinedJurisdiction(
            code=pba_distrito_code,
            reason=f"no curated crosswalk entry for PBA distrito {pba_distrito_code!r}",
        )
    return entry


# --- 2. Cross-year mesa code stability --------------------------------------


@dataclass(frozen=True)
class MesaStability:
    """Whether one mesa code was observed in each archived year.

    jurisdiction-model spec: stability MUST NOT be assumed by default, and a
    code present in only one year MUST be surfaced as a discontinuity, never
    silently dropped or substituted by a different mesa's data.
    """

    mesa: int
    present_2023: bool
    present_2025: bool

    @property
    def stable(self) -> bool:
        return self.present_2023 and self.present_2025

    @property
    def discontinuous(self) -> bool:
        return self.present_2023 != self.present_2025


def compute_mesa_stability(mesas_2023: set[int], mesas_2025: set[int]) -> list[MesaStability]:
    """Build a per-mesa stability record for every mesa seen in either year."""
    all_mesas = mesas_2023 | mesas_2025
    return [
        MesaStability(mesa=mesa, present_2023=mesa in mesas_2023, present_2025=mesa in mesas_2025)
        for mesa in sorted(all_mesas)
    ]


# --- 3. Fiscalización mesa identity join (Engram #1410) --------------------


@dataclass(frozen=True)
class FiscalizacionMesaRow:
    """One fiscalización mesa's normalized 17-value vote vector.

    `votes` keys are exactly `FISCALIZACION_VOTE_COLUMNS`. No personal data
    (`Nombre`/`Apellido`) is modelled here at all (D9.3) -- only `Escuela`
    is carried, as an establecimiento label.
    """

    mesa: int
    escuela: str
    votes: dict[str, int]


@dataclass(frozen=True)
class OfficialMesaVotes:
    """One official mesa's vote tallies, keyed the way the source reports
    them: by `agrupacion_nombre` for party lists, and by `votos_tipo` for
    the non-party categories (`EN BLANCO`, `IMPUGNADO`)."""

    mesa: int
    votes_by_agrupacion_name: dict[str, int]
    votos_tipo_totals: dict[str, int]

    def vector(self) -> dict[str, int]:
        """Project onto the same 17-column shape as a fiscalización row."""
        vector: dict[str, int] = {}
        for column, agrupacion_name in OFFICIAL_AGRUPACION_NAME_BY_COLUMN.items():
            vector[column] = self.votes_by_agrupacion_name.get(agrupacion_name, 0)
        for column, votos_tipo in OFFICIAL_VOTOS_TIPO_BY_COLUMN.items():
            vector[column] = self.votos_tipo_totals.get(votos_tipo, 0)
        return vector


@dataclass(frozen=True)
class MesaDivergence:
    """One column where a fiscalización tally differs from the official
    tally for an identity-matched mesa.

    ALWAYS informational (design D9.5 correction, Engram #1410): this is a
    fiscalización-data-quality signal for the D7 review queue, never a join
    failure and never a reason to exclude the mesa.
    """

    mesa: int
    column: str
    fiscalizacion_value: int
    official_value: int

    @property
    def is_expected_category_difference(self) -> bool:
        """True for `Impugnado`/`En blanco` -- a documented
        category-definition difference between a fiscal's provisional
        table-side judgement and the definitive escrutinio, not drift."""
        return self.column in EXPECTED_CATEGORY_DIVERGENCE_COLUMNS


@dataclass(frozen=True)
class FiscalizacionJoinResult:
    joined: tuple[tuple[FiscalizacionMesaRow, OfficialMesaVotes], ...]
    unmatched_mesas: tuple[int, ...]
    collided_mesas: tuple[int, ...]
    divergences: tuple[MesaDivergence, ...]


def join_fiscalizacion_identity(
    fiscalizacion_rows: list[FiscalizacionMesaRow],
    official_by_mesa: dict[int, OfficialMesaVotes],
) -> FiscalizacionJoinResult:
    """Join fiscalización rows to official rows BY MESA IDENTITY.

    Per the product owner's ACCEPTED decision (`confidence:
    accepted-by-maintainer`, `curated/crosswalk.yaml`, Engram #1410): the
    join key is same-numbered mesa identity, never a vote-vector match. A
    mesa whose tally diverges from the official record still joins; the
    divergence is recorded in `divergences` for the D7 review queue and MUST
    NEVER be treated as a reason to exclude that mesa or as a join failure.
    """
    joined: list[tuple[FiscalizacionMesaRow, OfficialMesaVotes]] = []
    unmatched: list[int] = []
    claims_per_official_mesa: dict[int, int] = {}
    divergences: list[MesaDivergence] = []

    for row in fiscalizacion_rows:
        official = official_by_mesa.get(row.mesa)
        if official is None:
            unmatched.append(row.mesa)
            continue

        claims_per_official_mesa[row.mesa] = claims_per_official_mesa.get(row.mesa, 0) + 1
        joined.append((row, official))

        official_vector = official.vector()
        for column in FISCALIZACION_VOTE_COLUMNS:
            fiscalizacion_value = row.votes[column]
            official_value = official_vector[column]
            if fiscalizacion_value != official_value:
                divergences.append(
                    MesaDivergence(
                        mesa=row.mesa,
                        column=column,
                        fiscalizacion_value=fiscalizacion_value,
                        official_value=official_value,
                    )
                )

    collided = tuple(mesa for mesa, count in claims_per_official_mesa.items() if count > 1)

    return FiscalizacionJoinResult(
        joined=tuple(joined),
        unmatched_mesas=tuple(unmatched),
        collided_mesas=collided,
        divergences=tuple(divergences),
    )
