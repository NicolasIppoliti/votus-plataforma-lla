import json
import sys
from fractions import Fraction
from pathlib import Path

import pytest
from etl import dine_municipal_panel as cli

ROOT = Path(__file__).resolve().parents[2]


def run(monkeypatch, capsys, origin=None, destination=None, relations=None, pair=(2015, 2017)):
    if origin is not None:
        def election(year, votes):
            return dict(year=year, offers=[dict(list_id=k, votes=v) for k, v in votes.items()],
                        totals=dict(positivos=sum(votes.values())))
        data = dict(elections=[election(2015, origin), election(2017, destination)])
        corr = dict(pairs=[dict(origin_year=2015, destination_year=2017, relations=relations,
                               member_overlap=[dict(origin='x', destination='e')])])
        monkeypatch.setattr(Path, 'read_text', lambda p, **kw: json.dumps(
            data if p.name == 'totals' else corr))
        totals, correspondence = 'totals', 'corr'
    else:
        totals = str(ROOT / 'curated/slice-09-jeba-definitive-totals.json')
        correspondence = str(ROOT / 'curated/slice-09-offer-correspondence.json')
    monkeypatch.setattr(sys, 'argv', ['panel', 'baselines', '--jeba', totals,
        '--correspondence', correspondence, '--pair', *map(str, pair)])
    code = cli.main()
    output = capsys.readouterr()
    return code, json.loads(output.out) if code == 0 else output.err


def relation(kind, origins, destinations):
    return dict(type=kind, origins=origins.split(), destinations=destinations.split())


def shares(result, baseline):
    return {k: Fraction(v['exact']) for k, v in result[baseline]['shares'].items()}


def test_core_mapping_and_metrics(monkeypatch, capsys):
    relations = [relation('continuation', 'a', 'd'), relation('merge', 'b c', 'f'),
                 relation('split', 'b', 'f g'), relation('exit', 'x', ''),
                 relation('entry', '', 'e')]
    code, r = run(monkeypatch, capsys, dict(a=40, b=20, c=20, x=20),
                  dict(d=45, f=35, g=15, e=5), relations)
    assert code == 0
    assert shares(r, 'B1') == dict(d=Fraction(2, 5), f=Fraction(3, 10),
                                  g=Fraction(1, 10), e=Fraction(1, 5))
    assert shares(r, 'B2') == dict(d=Fraction(1, 2), f=Fraction(3, 8),
                                  g=Fraction(1, 8), e=0)
    assert Fraction(r['exit_mass']['exact']) == Fraction(1, 5)
    assert r['entries'] == ['e']
    assert r['mapped_origins']['b']['destinations'] == ['f', 'g']
    assert Fraction(r['B1']['TV']['exact']) == Fraction(3, 20)
    assert Fraction(r['B2']['TV']['exact']) == Fraction(3, 40)
    assert r['B1']['seat_error'] == 2
    # Observed d/f/g = 4/3/2; B2 = 5/3/1 (quota and residues).
    assert r['B2']['seat_error'] == 1
    assert r['best_baseline'] == 'B2'
    assert r['jeba_category_unauthenticated'] is True


def test_no_entries_renormalizes(monkeypatch, capsys):
    code, r = run(monkeypatch, capsys, dict(a=80, x=20), dict(d=100),
                  [relation('continuation', 'a', 'd'), relation('exit', 'x', '')])
    assert code == 0
    assert shares(r, 'B1') == shares(r, 'B2') == {'d': 1}
    assert r['best_baseline'] == 'tie'
    assert r['B1']['seat_error'] == 0


def test_fallback_and_ambiguous_tie(monkeypatch, capsys):
    code, r = run(monkeypatch, capsys, dict(x=100), dict(d=60, e=40),
                  [relation('exit', 'x', ''), relation('entry', '', 'd e')])
    assert code == 0
    assert shares(r, 'B2') == dict(d=Fraction(1, 2), e=Fraction(1, 2))
    assert r['B2']['fallback_equal_split'] is True
    for name in ('B1', 'B2'):
        assert r[name]['forecast_seats']['error'] == 'ambiguous_tie'
        assert r[name]['seat_error'] is None


@pytest.mark.parametrize('a', [2015, 2017, 2019, 2021, 2023])
def test_real_pairs(monkeypatch, capsys, a):
    code, r = run(monkeypatch, capsys, pair=(a, a + 2))
    assert code == 0
    for name in ('B1', 'B2'):
        assert sum(shares(r, name).values()) == 1
    assert r['jeba_category_unauthenticated'] is True


def test_invalid_pair(monkeypatch, capsys):
    code, error = run(monkeypatch, capsys, pair=(2015, 2019))
    assert code == 2
    assert 'invalid pair' in error
