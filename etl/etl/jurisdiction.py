"""Normalized jurisdiction hierarchy model (`jurisdiction-model` spec).

Electoral jurisdictions form an explicit hierarchy: distrito -> sección ->
circuito -> establecimiento -> mesa. Every normalized result row is
attributable to exactly one level of this hierarchy (`granularity`), and a
row at a coarser level MUST NOT populate the finer levels it does not
have — the "Explicit jurisdiction hierarchy" requirement's fabrication
ban, enforced structurally here rather than left to caller discipline.
"""

from __future__ import annotations

from dataclasses import dataclass

# Levels ordered coarsest-first; index also doubles as "how many of the
# lineage fields below distrito are legitimately populated".
GRANULARITY_LEVELS: tuple[str, ...] = (
    "distrito",
    "seccion",
    "circuito",
    "establecimiento",
    "mesa",
)

# Fields that populate LOWER-than granularity would fabricate data. Keyed
# by the granularity that must NOT carry a value for that field.
_FIELD_ALLOWED_FROM_LEVEL = {
    "seccion": 1,
    "circuito": 2,
    "establecimiento": 3,
    "mesa": 4,
}


class GranularityFabricationError(ValueError):
    """Raised when a lineage field below the row's granularity is set."""


@dataclass(frozen=True)
class ResultRow:
    """One normalized electoral result at a single, explicit granularity.

    Lineage fields below ``granularity`` are always ``None`` — never a
    fabricated or inferred placeholder (jurisdiction-model spec).
    """

    granularity: str
    distrito: str
    seccion: str | None
    circuito: str | None
    establecimiento: str | None
    mesa: int | None
    category: str
    list_id: str | None
    votes: int


def make_result_row(
    *,
    granularity: str,
    distrito: str,
    seccion: str | None = None,
    circuito: str | None = None,
    establecimiento: str | None = None,
    mesa: int | None = None,
    category: str,
    list_id: str | None,
    votes: int,
) -> ResultRow:
    """Construct a `ResultRow`, rejecting any fabricated lower-level field.

    A field is "fabricated" when it is populated for a `granularity` that
    does not reach that level — e.g. passing `mesa=1` alongside
    `granularity="distrito"`.
    """
    if granularity not in GRANULARITY_LEVELS:
        raise ValueError(
            f"unknown granularity {granularity!r}; must be one of {GRANULARITY_LEVELS}"
        )

    level_index = GRANULARITY_LEVELS.index(granularity)
    candidates = {
        "seccion": seccion,
        "circuito": circuito,
        "establecimiento": establecimiento,
        "mesa": mesa,
    }
    for field_name, value in candidates.items():
        allowed_from = _FIELD_ALLOWED_FROM_LEVEL[field_name]
        if value is not None and level_index < allowed_from:
            raise GranularityFabricationError(
                f"granularity {granularity!r} (distrito-level or coarser) "
                f"MUST NOT carry a {field_name!r} value; got {value!r}"
            )

    return ResultRow(
        granularity=granularity,
        distrito=distrito,
        seccion=seccion,
        circuito=circuito,
        establecimiento=establecimiento,
        mesa=mesa,
        category=category,
        list_id=list_id,
        votes=votes,
    )
