"""Ley 5109 entry-point regressions; golden seats supplied from official JEBA PDFs."""

import json
import sys
from fractions import Fraction
from pathlib import Path

import pytest

from etl import dine_municipal_panel as cli

JEBA = Path(__file__).resolve().parents[2] / "curated/slice-09-jeba-definitive-totals.json"
GOLDEN = [
    (2015, {"135": 5, "382": 3, "138": 1}),
    (2017, {"508": 5, "809": 2, "503": 1, "501": 1}),
    (2019, {"135": 6, "136": 2, "809": 1}),
    (2021, {"506": 5, "507": 2, "809": 2}),
    (2023, {"134": 3, "132": 3, "135": 3}),
    (2025, {"2206": 5, "2200": 2, "2201": 2}),
]


def invoke(monkeypatch, capsys, year, *extra):
    monkeypatch.setattr(
        sys,
        "argv",
        ["dine_municipal_panel", "seats", "--jeba", str(JEBA), "--year", str(year), *extra],
    )
    code = cli.main()
    output = capsys.readouterr()
    return code, output


@pytest.mark.parametrize("year,expected", GOLDEN)
def test_official_pdf_seats_through_real_cli(monkeypatch, capsys, year, expected):
    """Source: archive/pba/YEAR027.<sha>.pdf page 1, printed seats/quotient.

    Exact per-year archived paths and sha256 citations are committed in each
    election's source.archived_path in the curated JEBA file, not HTML components.
    """
    code, output = invoke(monkeypatch, capsys, year)
    assert code == 0
    result = json.loads(output.out)
    election = next(e for e in json.loads(JEBA.read_text())["elections"] if e["year"] == year)
    assert result["seats"] == {
        o["list_id"]: expected.get(o["list_id"], 0) for o in election["offers"]
    }
    quotient = Fraction(sum(o["votes"] for o in election["offers"]), 9)
    assert result["quotient"] == str(quotient)
    assert result["quotient_float"] == float(quotient)
    assert sum(result["seats"].values()) == 9
    if year == 2015:
        assert result["quotient"] == "34762/9"
    if year == 2017:
        assert result["quotient"] == "4001"


@pytest.mark.parametrize(
    "year,extra", [(1900, ()), (2015, ("--seats", "0")), (2015, ("--seats", "-1"))]
)
def test_cli_rejects_unknown_year_or_nonpositive_seats(monkeypatch, capsys, year, extra):
    code, output = invoke(monkeypatch, capsys, year, *extra)
    assert code == 2
    assert "error:" in output.err


def allocate(votes, seats):
    from etl.hare_seats import allocate_seats

    return allocate_seats(votes, seats)


def test_art110_halving_and_overflow():
    result = allocate({str(i): 100 + i for i in range(12)}, 9)
    assert result["rules"]["art110_halvings"] == 1
    assert result["rules"]["art110_overflow"] is True
    assert result["quotient"] == str(Fraction(1266, 18))
    assert result["seats"] == {str(i): int(i >= 3) for i in range(12)}
    assert len(result["eligible_list_ids"]) == 12


def test_repeated_halving():
    result = allocate({str(i): i + 100 for i in range(40)}, 9)
    assert result["rules"]["art110_halvings"] == 2
    assert sum(result["seats"].values()) == 9


def test_art110_reduced_divisor_without_overflow():
    votes = {"a": 102, "b": 101, "c": 100, **{str(i): 40 for i in range(20)}}
    result = allocate(votes, 9)
    assert result["quotient"] == "1103/18"
    assert result["eligible_list_ids"] == ["a", "b", "c"]
    assert result["seats"] == {k: {"a": 5, "b": 2, "c": 2}.get(k, 0) for k in votes}
    assert result["rules"] == dict(
        quotient=True, residue=True, completion=True, art110_halvings=1, art110_overflow=False
    )


def test_residue_tie_prefers_more_votes():
    result = allocate({"a": 25, "b": 15, "c": 10}, 5)
    assert result["seats"] == {"a": 3, "b": 1, "c": 1}
    assert result["rules"]["residue"] is True


@pytest.mark.parametrize(
    "votes,seats", [({"a": 15, "b": 15, "c": 10}, 4), ({str(i): 10 for i in range(12)}, 9)]
)
def test_equal_votes_raise_explicit_ambiguous_tie(votes, seats):
    with pytest.raises(ValueError, match="ambiguous_tie"):
        allocate(votes, seats)


def test_completion_and_exclusion_below_quotient():
    result = allocate({"a": 60, "b": 9, "c": 9, "d": 9, "e": 9, "f": 4}, 5)
    assert result["seats"] == {"a": 5, "b": 0, "c": 0, "d": 0, "e": 0, "f": 0}
    assert result["eligible_list_ids"] == ["a"]
    assert result["rules"]["completion"] is True


@pytest.mark.parametrize(
    "votes,seats",
    [({}, 9), ({"a": 0}, 9), ({"a": -1}, 9), ({"a": 1.5}, 9), ({"a": True}, 9), ({"a": 1}, 0)],
)
def test_invalid_inputs(votes, seats):
    with pytest.raises(ValueError):
        allocate(votes, seats)
