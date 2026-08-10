"""National <-> PBA jurisdiction crosswalk, cross-year mesa stability, and
the fiscalización mesa identity join (`jurisdiction-model` spec; design D9.5;
the ACCEPTED mesa-identity decision, Engram #1410).

Three independent concerns live here, all curator-reviewed rather than
auto-inferred at ingest time (jurisdiction-model: "The crosswalk MUST NOT be
inferred automatically from name-matching alone"):

1. `CrosswalkTable`: PBA distrito code <-> national
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

from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path

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
# The scope `OFFICIAL_AGRUPACION_NAME_BY_COLUMN` was curated for, as a value
# rather than only as prose in the comment above it. `cmd_validate_fiscalizacion`
# exposes --distrito/--seccion/--category as free flags and nothing checked the
# requested scope against this one: pointed at another distrito or at SENADOR
# NACIONAL, every `agrupacion_nombre` misses, `vector()` returns 0 for all 15
# columns, and every joined mesa produces 17 FABRICATED divergences written to
# `review_item` as `info` for an operator to read as data.
CURATED_NAME_TABLE_SCOPE: tuple[int, str, str, str] = (
    2025,
    "02",
    "027",
    "DIPUTADO NACIONAL",
)

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


class CrosswalkValidationError(ValueError):
    """Raised when curated crosswalk YAML has an invalid trust-boundary shape."""


class DuplicateCrosswalkKeyError(CrosswalkValidationError):
    """Raised when a curated crosswalk natural key appears more than once."""


class IncompleteOfficialMesaError(ValueError):
    """Raised when an official mesa lacks a required comparison tally."""


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
        """The curated entry for one PBA distrito code, or `None`.

        PRODUCTION CALLER: `etl.jurisdiction.resolve_pba_distrito_code`, which
        wraps this lookup with the `QuarantinedPbaDistrito` refusal and is
        what `ingest.pba.resolve_pba_jurisdictions` calls for every PBA row.
        Named here because the caller lives in another module, and the
        deleted `resolve_jurisdiction` below looked identical from inside
        this file -- the difference between the two was exactly whether
        anything called them.
        """
        from .jurisdiction import normalize_pba_distrito_code

        target = normalize_pba_distrito_code(pba_distrito_code)
        for entry in self.jurisdictions:
            if normalize_pba_distrito_code(entry.pba_distrito_code) == target:
                return entry
        return None

    def entries_in_distrito(self, distrito_code: str | None) -> list[JurisdictionCrosswalkEntry]:
        """EVERY curated entry whose national distrito matches, normalized.

        The coarse question ("this row names no seccion -- is its distrito
        curated?") gets its own method returning ALL matches, because the only
        honest answers are "none", "exactly one" and "more than one, so it
        cannot be attributed". Folded into `resolve_national`, it returned the
        first match and its seccion/name would have been read as the row's.
        """
        from .jurisdiction import normalize_distrito_code

        target = normalize_distrito_code(distrito_code)
        return [
            entry
            for entry in self.jurisdictions
            if normalize_distrito_code(entry.national_distrito_code) == target
        ]

    def resolve_national(
        self, *, distrito_code: str, seccion_code: str
    ) -> JurisdictionCrosswalkEntry | None:
        """Resolve a national (distrito, seccion) pair, normalizing BOTH sides.

        Rule 8: the comparison lives behind ONE boundary. It was an exact
        text match here while `__main__.find_unmapped_jurisdictions`
        normalized both sides itself before calling in -- two ideas of how a
        crosswalk entry's code compares, for one table, so `"2"/"27"` and
        `"02"/"027"` resolved or did not depending on which caller asked.
        Normalizing is idempotent, so a caller passing already-canonical
        codes is unaffected.

        `seccion_code` is REQUIRED. A row carrying no seccion is a different
        question -- "is its distrito curated?" -- whose only honest answers
        are none, exactly one, and more than one, so it belongs to
        `entries_in_distrito`, which hands back every match instead of
        picking. Passing `None` here is refused rather than quietly matching
        nothing, which would read as "not curated" for a distrito that is.
        """
        from .jurisdiction import normalize_distrito_code, normalize_seccion_code

        target_distrito = normalize_distrito_code(distrito_code)
        target_seccion = normalize_seccion_code(seccion_code)
        if target_seccion is None:
            raise TypeError(
                "seccion_code=None: call `entries_in_distrito` instead, which "
                "returns every match rather than picking one"
            )
        for entry in self.jurisdictions:
            if (
                normalize_distrito_code(entry.national_distrito_code) == target_distrito
                and normalize_seccion_code(entry.national_seccion_code) == target_seccion
            ):
                return entry
        return None


def load_crosswalk(path: Path) -> CrosswalkTable:
    """Load and validate the curated jurisdiction mapping at the YAML boundary."""
    data: object = yaml.safe_load(path.read_text(encoding="utf-8"))
    if data is None:
        data = {}
    if not isinstance(data, Mapping):
        raise CrosswalkValidationError("crosswalk.yaml top level must be a mapping")

    raw_entries = data.get("jurisdictions", [])
    if not isinstance(raw_entries, list):
        raise CrosswalkValidationError("crosswalk.yaml jurisdictions must be a list")

    from .jurisdiction import (
        is_canonicalizable_code,
        normalize_distrito_code,
        normalize_pba_distrito_code,
        normalize_seccion_code,
    )

    entries: list[JurisdictionCrosswalkEntry] = []
    seen_pba: set[str] = set()
    seen_national: set[tuple[str | None, str | None]] = set()
    required = ("pba_distrito", "national_distrito", "national_seccion", "name")
    for index, raw_entry in enumerate(raw_entries):
        if not isinstance(raw_entry, Mapping):
            raise CrosswalkValidationError(
                f"crosswalk.yaml jurisdictions entry {index} must be a mapping"
            )
        missing = [field for field in required if field not in raw_entry]
        if missing:
            raise CrosswalkValidationError(
                f"crosswalk.yaml jurisdictions entry {index} is missing {', '.join(missing)}"
            )

        validated: dict[str, str] = {}
        for field in required:
            value = raw_entry[field]
            if not isinstance(value, str) or not value.strip():
                raise CrosswalkValidationError(
                    f"crosswalk.yaml jurisdictions entry {index} field {field!r} "
                    "must be a non-empty string"
                )
            validated[field] = value

        for field in ("pba_distrito", "national_distrito", "national_seccion"):
            if not is_canonicalizable_code(validated[field]):
                raise CrosswalkValidationError(
                    f"crosswalk.yaml jurisdictions entry {index} field {field!r} "
                    f"must be a digit-canonicalizable code, got {validated[field]!r}"
                )

        entry = JurisdictionCrosswalkEntry(
            pba_distrito_code=normalize_pba_distrito_code(validated["pba_distrito"]),
            national_distrito_code=normalize_distrito_code(validated["national_distrito"]),
            national_seccion_code=normalize_seccion_code(validated["national_seccion"]),
            name=validated["name"],
        )
        national_key = (
            normalize_distrito_code(entry.national_distrito_code),
            normalize_seccion_code(entry.national_seccion_code),
        )
        if entry.pba_distrito_code in seen_pba:
            raise DuplicateCrosswalkKeyError(
                "crosswalk.yaml duplicate PBA distrito key "
                f"{entry.pba_distrito_code!r} at entry {index}"
            )
        if national_key in seen_national:
            raise DuplicateCrosswalkKeyError(
                "crosswalk.yaml duplicate normalized national key "
                f"{national_key!r} at entry {index}"
            )
        seen_pba.add(entry.pba_distrito_code)
        seen_national.add(national_key)
        entries.append(entry)

    return CrosswalkTable(jurisdictions=tuple(entries))


# NO `resolve_jurisdiction`. It resolved a PBA distrito code or returned a
# `QuarantinedJurisdiction`, was correct and tested, and had no production
# caller: `ingest.pba.resolve_pba_jurisdictions` -- the path every PBA row
# actually takes -- translates through `jurisdiction.resolve_pba_distrito_code`
# and quarantines with `QuarantinedPbaDistrito`. Two resolvers for one
# question, and the tested one was the unreachable one.


# --- 2. Cross-year mesa code stability --------------------------------------


@dataclass(frozen=True)
class MesaStability:
    """Whether one normalized circuito/mesa pair was observed in each year.

    jurisdiction-model spec: stability MUST NOT be assumed by default, and a
    code present in only one year MUST be surfaced as a discontinuity, never
    silently dropped or substituted by a different mesa's data.
    """

    mesa: int
    present_2023: bool
    present_2025: bool
    circuito: str = "00000"

    def __post_init__(self) -> None:
        # Lazy import avoids the existing jurisdiction -> crosswalk type dependency.
        from etl.jurisdiction import normalize_circuito_code

        normalized = normalize_circuito_code(self.circuito)
        if normalized is None:
            raise ValueError("MesaStability circuito cannot be absent")
        object.__setattr__(self, "circuito", normalized)

    @property
    def stable(self) -> bool:
        return self.present_2023 and self.present_2025

    @property
    def discontinuous(self) -> bool:
        return self.present_2023 != self.present_2025


def compute_mesa_stability(
    mesas_2023: set[tuple[str, int]], mesas_2025: set[tuple[str, int]]
) -> list[MesaStability]:
    """Build stability for each exact normalized circuito/mesa identity."""

    def normalize(pairs: set[tuple[str, int]]) -> set[tuple[str, int]]:
        # Lazy import avoids the existing jurisdiction -> crosswalk type dependency.
        from etl.jurisdiction import normalize_circuito_code

        normalized: set[tuple[str, int]] = set()
        for circuito, mesa in pairs:
            circuito_code = normalize_circuito_code(circuito)
            if circuito_code is None:
                raise ValueError(f"circuito {circuito!r} cannot be normalized")
            normalized.add((circuito_code, mesa))
        return normalized

    normalized_2023 = normalize(mesas_2023)
    normalized_2025 = normalize(mesas_2025)
    return [
        MesaStability(
            circuito=circuito,
            mesa=mesa,
            present_2023=(circuito, mesa) in normalized_2023,
            present_2025=(circuito, mesa) in normalized_2025,
        )
        for circuito, mesa in sorted(normalized_2023 | normalized_2025)
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
    # NO `escuela`. It was set on every row and read by nothing:
    # `join_fiscalizacion_identity` joins by MESA NUMBER, per the accepted
    # decision (Engram #1410), so the school name had no part in the join it
    # was carried for. Same argument that removed `escuela_normalized` from
    # `FiscalizacionRow`, one dataclass over. The RAW string still lives on
    # `FiscalizacionRow`, where the personal-data guard asserts against it.
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
        required_names = frozenset(OFFICIAL_AGRUPACION_NAME_BY_COLUMN.values())
        required_types = frozenset(OFFICIAL_VOTOS_TIPO_BY_COLUMN.values())
        missing_names = sorted(required_names - self.votes_by_agrupacion_name.keys())
        missing_types = sorted(required_types - self.votos_tipo_totals.keys())
        if missing_names or missing_types:
            missing = []
            if missing_names:
                missing.append(f"agrupacion_nombre keys {missing_names}")
            if missing_types:
                missing.append(f"votos_tipo keys {missing_types}")
            raise IncompleteOfficialMesaError(
                f"mesa {self.mesa} has an incomplete official comparison vector; missing "
                + " and ".join(missing)
            )

        vector: dict[str, int] = {}
        for column, agrupacion_name in OFFICIAL_AGRUPACION_NAME_BY_COLUMN.items():
            vector[column] = self.votes_by_agrupacion_name[agrupacion_name]
        for column, votos_tipo in OFFICIAL_VOTOS_TIPO_BY_COLUMN.items():
            vector[column] = self.votos_tipo_totals[votos_tipo]
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
