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
TRANSLATED via `jurisdiction_crosswalk` (`resolve_pba_distrito_code` below),
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

# DINE's fixed-width convention, matching `curated/crosswalk.yaml`
# (`national_distrito: "02"`, `national_seccion: "027"`): distrito codes run
# 01-24 nationwide, seccion codes run up to 3 digits within a distrito (the
# widest observed, Buenos Aires province's ~135 partidos).
DISTRITO_CODE_WIDTH = 2
SECCION_CODE_WIDTH = 3


def _zero_pad_numeric(raw: str, *, width: int) -> str:
    """Zero-pad a numeric administrative code to `width` digits.

    Falls back to the raw string unchanged for a non-numeric code, rather
    than raising — matching the tolerance the pre-Phase-17
    `_normalize_administrative_code` already established in
    `etl/etl/__main__.py` for the (unpadded) comparison direction.
    """
    try:
        return str(int(raw)).zfill(width)
    except ValueError:
        return raw


def normalize_distrito_code(raw: str) -> str:
    """Canonicalize a distrito code to the curated, zero-padded form.

    `"2"` and `"02"` both normalize to `"02"` — the single source of truth
    for what "the same distrito" means at every write boundary.
    """
    return _zero_pad_numeric(raw, width=DISTRITO_CODE_WIDTH)


def normalize_seccion_code(raw: str | None) -> str | None:
    """Canonicalize a seccion code to the curated, zero-padded form.

    `None` passes through unchanged — a coarser-than-seccion `ResultRow`
    legitimately carries no seccion value at all (the fabrication ban this
    module already enforces), and normalizing `None` would be meaningless.
    """
    if raw is None:
        return None
    return _zero_pad_numeric(raw, width=SECCION_CODE_WIDTH)


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
) -> str | QuarantinedPbaDistrito:
    """Resolve a PBA-native distrito code (e.g. `"027"`) to the national
    numbering scheme's canonical, zero-padded distrito code (e.g. `"02"`),
    via the curated `jurisdiction_crosswalk` (task 17.5).

    PBA's own distrito code is a DIFFERENT numbering scheme from the
    national one — `curated/crosswalk.yaml`'s single entry happens to map
    PBA `"027"` to national distrito `"02"` / seccion `"027"`, three
    different-looking strings for the same real jurisdiction. This function
    resolves only the distrito half: a PBA source publishes distrito-level
    totals (`electoral-ingestion` spec), and `make_result_row` structurally
    forbids a distrito-granularity `ResultRow` from also carrying a seccion
    value (the fabrication ban above) — the resolved national seccion is
    still available on the crosswalk entry itself for a caller that needs
    it for something other than constructing the `ResultRow`.

    An uncurated PBA distrito code is quarantined as data (task 17.3),
    never silently written as a new jurisdiction under PBA's own code space.
    """
    entry = crosswalk.resolve_pba(pba_distrito_code)
    if entry is None:
        return QuarantinedPbaDistrito(
            pba_distrito_code=pba_distrito_code,
            reason=f"no curated crosswalk entry for PBA distrito {pba_distrito_code!r}",
        )
    return normalize_distrito_code(entry.national_distrito_code)
