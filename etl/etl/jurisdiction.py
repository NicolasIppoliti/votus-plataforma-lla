"""Normalized jurisdiction hierarchy model (`jurisdiction-model` spec).

Electoral jurisdictions form an explicit hierarchy: distrito -> sección ->
circuito -> establecimiento -> mesa. Every normalized result row is
attributable to exactly one level of this hierarchy (`granularity`), and a
row at a coarser level MUST NOT populate the finer levels it does not
have — the "Explicit jurisdiction hierarchy" requirement's fabrication
ban, enforced structurally here rather than left to caller discipline.

Phase 17 — single administrative-code normalization boundary. Coronel
Rosales was measured live as THREE separate jurisdiction identities: national
ingestion writes the raw CSV's UNPADDED `distrito_id`/`seccion_id` (`"2"`,
`"27"`), fiscalización writes the curated PADDED form (`"02"`, `"027"`), and
PBA writes its OWN distrito code (`"027"`) verbatim instead of resolving it
through `jurisdiction_crosswalk` — three call sites, each with its own idea
of "the code", instead of one normalization boundary. `normalize_distrito_code`
/ `normalize_seccion_code` below are that boundary's canonical transform
(curated PADDED form, matching `curated/*.yaml` and `jurisdiction_crosswalk`,
since changing those would be the larger blast radius).

Deliberately NOT applied inside `make_result_row` itself: a `ResultRow`'s
`distrito` is not always yet a NATIONAL administrative code at construction
time — `ingest.pba.ingest_pba` builds one from PBA's OWN distrito code
(`"027"`), which lives in an entirely different numbering scheme and must be
TRANSLATED via `jurisdiction_crosswalk` (`resolve_pba_distrito_code` below,
which returns the national `(distrito, seccion)` PAIR, never the distrito
alone),
never merely re-padded (blindly zero-padding PBA's `"027"` to a 2-digit
width silently produces `"27"` — a real but WRONG national code, national
seccion 027's own distrito-adjacent digits, not distrito 02 at all).
Normalization therefore lives at the two points that are guaranteed to
already hold a genuine national code: `etl.db.upsert_jurisdiction` /
`batch_upsert_jurisdictions` (the actual write boundary every ingestion path
funnels through) and the return value of `resolve_pba_distrito_code` itself
(translation output, not raw PBA input).
"""

from __future__ import annotations

from dataclasses import dataclass

# Names re-exported for callers that import them from jurisdiction (`X as X`).
from .admin_codes import (
    CIRCUITO_CODE_WIDTH as CIRCUITO_CODE_WIDTH,
)
from .admin_codes import (
    DISTRITO_CODE_WIDTH as DISTRITO_CODE_WIDTH,
)
from .admin_codes import (
    PBA_DISTRITO_CODE_WIDTH as PBA_DISTRITO_CODE_WIDTH,
)
from .admin_codes import (
    SECCION_CODE_WIDTH as SECCION_CODE_WIDTH,
)
from .admin_codes import (
    _zero_pad_numeric as _zero_pad_numeric,
)
from .admin_codes import (
    is_canonicalizable_circuito_code,
    normalize_circuito_code,
    normalize_distrito_code,
    normalize_seccion_code,
)
from .admin_codes import (
    is_canonicalizable_code as is_canonicalizable_code,
)
from .admin_codes import (
    normalize_pba_distrito_code as normalize_pba_distrito_code,
)
from .crosswalk import CrosswalkTable

# Levels ordered coarsest-first; index also doubles as "how many of the
# lineage fields below distrito are legitimately populated".
GRANULARITY_LEVELS: tuple[str, ...] = (
    "distrito",
    "seccion",
    "circuito",
    "establecimiento",
    "mesa",
)


def normalize_jurisdiction_name(raw: str | None) -> str | None:
    """Normalize authoritative display metadata without rewriting its meaning.

    Source spelling, case, and accents are evidence and remain untouched. Only
    outer whitespace is removed; an empty result represents absent metadata as
    ``None`` so callers cannot accidentally persist a whitespace-only name.
    """
    if raw is None:
        return None
    normalized = raw.strip()
    return normalized or None


def normalize_circuito_name(
    raw_name: str | None,
    authoritative_code: str | None,
) -> str | None:
    """Canonicalize a circuito name only when the source proves it is the code.

    Human or malformed names remain authoritative display evidence. A code-like
    name is canonicalized only when it identifies the exact authoritative
    circuito, including any alpha suffix.
    """
    normalized_name = normalize_jurisdiction_name(raw_name)
    if normalized_name is None or not is_canonicalizable_circuito_code(normalized_name):
        return normalized_name

    canonical_name = normalize_circuito_code(normalized_name)
    if canonical_name == normalize_circuito_code(authoritative_code):
        return canonical_name
    return normalized_name


@dataclass(frozen=True)
class JurisdictionNames:
    """Typed display-name metadata carried beside one jurisdiction lineage."""

    distrito: str | None = None
    seccion: str | None = None
    circuito: str | None = None
    establecimiento: str | None = None

    def __post_init__(self) -> None:
        for field_name in ("distrito", "seccion", "circuito", "establecimiento"):
            object.__setattr__(
                self,
                field_name,
                normalize_jurisdiction_name(getattr(self, field_name)),
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
        # Phase 17: NOT normalized here — see the module docstring. A
        # `ResultRow`'s `distrito` is a genuine national code by the time it
        # reaches `etl.db.upsert_jurisdiction` (this project's only actual
        # write boundary), which applies `normalize_distrito_code` /
        # `normalize_seccion_code` itself; applying it here too would
        # corrupt `ingest.pba`'s pre-crosswalk-resolution PBA-scheme value.
        distrito=distrito,
        seccion=seccion,
        circuito=circuito,
        establecimiento=establecimiento,
        mesa=mesa,
        category=category,
        list_id=list_id,
        votes=votes,
    )


# ---------------------------------------------------------------------------
# Phase 17 (17.5/17.3) — PBA distrito code resolution through the curated
# jurisdiction_crosswalk, and quarantine for an uncurated code.
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class QuarantinedPbaDistrito:
    """A PBA-native distrito code with no curated crosswalk entry.

    Returned as data — never silently written as a new jurisdiction island
    under PBA's own numbering scheme (task 17.3), and never a swallowed
    exception, matching `etl.crosswalk.QuarantinedJurisdiction`'s shape for
    the same class of problem on the national side.
    """

    pba_distrito_code: str
    reason: str


def resolve_pba_distrito_code(
    pba_distrito_code: str, crosswalk: CrosswalkTable
) -> tuple[str, str | None] | QuarantinedPbaDistrito:
    """Resolve a PBA-native distrito code (e.g. `"027"`) to the national
    numbering scheme's canonical, zero-padded distrito code (e.g. `"02"`),
    via the curated `jurisdiction_crosswalk` (task 17.5).

    PBA's own distrito code is a DIFFERENT numbering scheme from the
    national one — `curated/crosswalk.yaml`'s single entry happens to map
    PBA `"027"` to national distrito `"02"` / seccion `"027"`, three
    different-looking strings for the same real jurisdiction. BOTH halves
    are returned as `(national_distrito, national_seccion)`: a PBA partido
    total is a SECCION-level figure in the national scheme, and returning the
    distrito alone attributed 32.291 Coronel Rosales votes to the whole of
    Buenos Aires. The caller (`ingest.pba.resolve_pba_jurisdictions`)
    re-derives the granularity as `"seccion"` when a seccion comes back, so
    `make_result_row`'s fabrication ban is satisfied without dropping it.

    An uncurated PBA distrito code is quarantined as data (task 17.3),
    never silently written as a new jurisdiction under PBA's own code space.
    """
    entry = crosswalk.resolve_pba(pba_distrito_code)
    if entry is None:
        return QuarantinedPbaDistrito(
            pba_distrito_code=pba_distrito_code,
            reason=f"no curated crosswalk entry for PBA distrito {pba_distrito_code!r}",
        )
    return (
        normalize_distrito_code(entry.national_distrito_code),
        normalize_seccion_code(entry.national_seccion_code),
    )
