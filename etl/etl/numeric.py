"""Strict numeric parsing at archived-source cell boundaries."""

from __future__ import annotations

import re

_ASCII_DECIMAL = re.compile(r"[0-9]+")


def is_ascii_decimal(raw: object) -> bool:
    """Whether ``raw`` is an ASCII decimal string after trimming."""
    return isinstance(raw, str) and _ASCII_DECIMAL.fullmatch(raw.strip()) is not None


def parse_source_int(raw: object) -> int | None:
    """Return an ASCII nonnegative integer from a source cell, or ``None``."""
    if not is_ascii_decimal(raw):
        return None
    assert isinstance(raw, str)
    stripped = raw.strip()
    try:
        return int(stripped)
    except ValueError:
        # Python limits decimal conversion length; an oversized source cell is
        # malformed input, not a reason to abort the ingestion report.
        return None
