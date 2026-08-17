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
from typing import overload

from .crosswalk import CrosswalkTable
from .numeric import is_ascii_decimal

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
PBA_DISTRITO_CODE_WIDTH = 3
SECCION_CODE_WIDTH = 3


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


def _zero_pad_numeric(raw: str | None, *, width: int) -> str | None:
    """Zero-pad a numeric administrative code to `width` digits.

    Falls back to the raw value unchanged for a non-numeric code, rather
    than raising — matching the tolerance the pre-Phase-17
    `_normalize_administrative_code` already established in
    `etl/etl/__main__.py` for the (unpadded) comparison direction.

    `TypeError` is caught alongside `ValueError` because the input is not
    guaranteed to be a string: `csv.DictReader` fills a SHORT row's missing
    trailing fields with `None`, and callers such as
    `collect_mesa_tipo_mapping` verify a column is PRESENT, not that it holds
    a value. Raising there would abort a whole backfill on one truncated row
    instead of letting it be counted and skipped.
    """
    if not is_ascii_decimal(raw):
        # `int()` is NOT the shape test. It accepts `"2_7"` (PEP 515 numeric
        # underscores) and yields 27 -- a real but WRONG seccion, canonicalized
        # confidently out of a malformed code. The shared ASCII predicate also
        # refuses Unicode digit classes that `isdigit()` would accept.
        return raw
    assert isinstance(raw, str)
    try:
        numeric = int(raw.strip())
    except ValueError:
        return raw
    return str(numeric).zfill(width)


def is_canonicalizable_code(raw: object) -> bool:
    """Whether the numeric-only normalizers can actually canonicalize `raw`.

    The normalizers pass an uncanonicalizable code through UNCHANGED, which
    leaves a caller unable to tell "already canonical" from "gave up": `"2A"`
    or `"O2"` goes through the single boundary untouched and then joins
    nothing downstream. This is the predicate that makes the give-up case
    countable at the call site.

    Surrounding whitespace is NOT a give-up: `" 2 "` canonicalizes to `"02"`.
    `"2_7"` is not -- Python's `int()` accepts it and would produce `"27"`, a
    real but wrong seccion. Unicode digit classes are also refused rather than
    normalized into a real ASCII code.
    """
    return is_ascii_decimal(raw)


def is_canonicalizable_circuito_code(raw: object) -> bool:
    """Whether ``raw`` matches DINE's circuito-specific code scheme.

    Circuitos are ASCII digits with an optional single trailing ASCII letter.
    The suffix is case-insensitive at input and canonicalized to uppercase.
    """
    if not isinstance(raw, str):
        return False
    stripped = raw.strip()
    if not stripped:
        return False
    numeric_part = stripped[:-1] if stripped[-1].isascii() and stripped[-1].isalpha() else stripped
    return bool(numeric_part) and numeric_part.isascii() and numeric_part.isdecimal()


@overload
def normalize_distrito_code(raw: str) -> str: ...


@overload
def normalize_distrito_code(raw: None) -> None: ...


def normalize_distrito_code(raw: str | None) -> str | None:
    """Canonicalize a national distrito code to its two-digit form."""
    return _zero_pad_numeric(raw, width=DISTRITO_CODE_WIDTH)


@overload
def normalize_pba_distrito_code(raw: str) -> str: ...


@overload
def normalize_pba_distrito_code(raw: None) -> None: ...


def normalize_pba_distrito_code(raw: str | None) -> str | None:
    """Canonicalize a PBA partido/distrito code to its three-digit form.

    PBA codes use a distinct scheme from national distrito codes. Numeric input
    is trimmed and zero-padded to three digits; values that cannot be
    canonicalized pass through unchanged like the other code normalizers.
    """
    return _zero_pad_numeric(raw, width=PBA_DISTRITO_CODE_WIDTH)


CIRCUITO_CODE_WIDTH = 5


@overload
def normalize_circuito_code(raw: str) -> str: ...


@overload
def normalize_circuito_code(raw: None) -> None: ...


def normalize_circuito_code(raw: str | None) -> str | None:
    """Canonicalize a circuito while preserving its distinct alphanumeric scheme.

    Numeric circuitos pad to five digits. A trailing ASCII letter occupies the
    fifth position, so only the numeric portion pads to four digits. Wider
    numeric portions are preserved rather than truncated.
    """
    if raw is None or not is_canonicalizable_circuito_code(raw):
        return raw
    stripped = raw.strip()
    if stripped[-1].isalpha():
        return stripped[:-1].zfill(CIRCUITO_CODE_WIDTH - 1) + stripped[-1].upper()
    return stripped.zfill(CIRCUITO_CODE_WIDTH)


@overload
def normalize_seccion_code(raw: str) -> str: ...


@overload
def normalize_seccion_code(raw: None) -> None: ...


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
