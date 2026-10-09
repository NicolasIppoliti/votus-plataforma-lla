"""Standard-library-only administrative-code normalization boundary."""

from __future__ import annotations

from typing import overload

from .numeric import is_ascii_decimal

# DINE's fixed-width convention, matching `curated/crosswalk.yaml`
# (`national_distrito: "02"`, `national_seccion: "027"`): distrito codes run
# 01-24 nationwide, seccion codes run up to 3 digits within a distrito (the
# widest observed, Buenos Aires province's ~135 partidos).
DISTRITO_CODE_WIDTH = 2
PBA_DISTRITO_CODE_WIDTH = 3
SECCION_CODE_WIDTH = 3


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
