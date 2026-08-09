from __future__ import annotations

import pytest

from etl.numeric import is_ascii_decimal, parse_source_int


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        (None, None),
        ("", None),
        ("   ", None),
        ("0", 0),
        (" 0012 ", 12),
        ("1_2", None),
        ("+12", None),
        ("-1", None),
        ("1.2", None),
        ("１２", None),
        ("²", None),
        ("twelve", None),
    ],
)
def test_parse_source_int_accepts_only_ascii_nonnegative_decimal_cells(
    raw: str | None, expected: int | None
) -> None:
    assert parse_source_int(raw) == expected


def test_parse_source_int_rejects_non_string_values_at_runtime() -> None:
    assert parse_source_int(12) is None


@pytest.mark.parametrize(
    ("raw", "expected"),
    [("0", True), (" 0012 ", True), ("", False), ("٢", False), ("１２", False)],
)
def test_ascii_decimal_predicate_is_the_shared_source_cell_shape_check(
    raw: object, expected: bool
) -> None:
    assert is_ascii_decimal(raw) is expected
