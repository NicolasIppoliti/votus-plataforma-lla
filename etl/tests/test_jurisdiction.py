"""Tests for the normalized jurisdiction hierarchy model.

Covers `jurisdiction-model` spec, "Explicit jurisdiction hierarchy"
requirement: every stored result MUST be attributable to exactly one
level, and a coarser-granularity row MUST NOT fabricate the finer levels
it does not have (task 3.1).
"""

from __future__ import annotations

import pytest

from etl.jurisdiction import make_result_row


def test_mesa_row_records_full_lineage() -> None:
    row = make_result_row(
        granularity="mesa",
        distrito="02",
        seccion="027",
        circuito="00248",
        establecimiento="Escuela N.1",
        mesa=1,
        category="PRESIDENTE/A",
        list_id="134",
        votes=13,
    )

    assert row.granularity == "mesa"
    assert row.distrito == "02"
    assert row.seccion == "027"
    assert row.circuito == "00248"
    assert row.establecimiento == "Escuela N.1"
    assert row.mesa == 1


def test_distrito_row_does_not_fabricate_lower_levels() -> None:
    row = make_result_row(
        granularity="distrito",
        distrito="02",
        category="INTENDENTE",
        list_id="134",
        votes=1000,
    )

    assert row.granularity == "distrito"
    assert row.distrito == "02"
    # No sección/circuito/establecimiento/mesa data exists at this
    # granularity — the model MUST NOT invent placeholder values for them.
    assert row.seccion is None
    assert row.circuito is None
    assert row.establecimiento is None
    assert row.mesa is None


def test_distrito_row_rejects_a_fabricated_mesa_value() -> None:
    # Passing a mesa value alongside `granularity="distrito"` is a caller
    # bug, not data the model may silently store — the fabrication ban is
    # a structural constraint, not just a default.
    with pytest.raises(ValueError, match="distrito"):
        make_result_row(
            granularity="distrito",
            distrito="02",
            mesa=1,
            category="INTENDENTE",
            list_id="134",
            votes=1000,
        )
