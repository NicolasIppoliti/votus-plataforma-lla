import json
import sys
from fractions import Fraction
from pathlib import Path

import pytest
from etl import dine_municipal_panel as cli
from etl.forecast_baselines import total_variation

ROOT = Path(__file__).resolve().parents[2]
NP = '__non_positive__'
READ_TEXT = Path.read_text


def relation(kind, left, right):
    return dict(type=kind, origins=left.split(), destinations=right.split())


def run(monkeypatch, capsys, entries=True, electores=True, observed=True,
        late=False, unseen=False, application_exit=False, no_continuing=False, dine=False, missing=False, absent=None, six=False):
    transfer = json.loads(READ_TEXT(ROOT / 'curated/slice-09-transfer-recipe.json'))
    recipe = json.loads(READ_TEXT(ROOT / 'curated/slice-09-forecast-recipe.json'))
    votes = [dict(a=60, x=20), dict(b=50, e=30), dict(c=80)]
    relations = [[relation('continuation', 'a', 'b'), relation('exit', 'x', ''),
                  relation('entry', '', 'e')],
                 [relation('continuation', 'b', 'c'), relation('exit', 'e', '')],
                 [relation('continuation', 'c', 'd')]]
    if entries:
        relations[2].append(relation('entry', '', 'f'))
    if no_continuing:
        relations[0] = [relation('exit', 'a x', ''), relation('entry', '', 'b e')]
        relations[1] = [relation('exit', 'b e', ''), relation('entry', '', 'c')]
    if unseen or application_exit:
        if unseen:
            relations[0] = [relation('merge', 'a x', 'b'), relation('entry', '', 'e')]
            relations[1] = [relation('merge', 'b e', 'c')]
        relations[1].append(relation('entry', '', 'z'))
        votes[2] = dict(c=60, z=20)
        relations[2].append(relation('exit', 'z', ''))
    if six:
        votes = [dict(a=80), dict(b=80), dict(c=80)]
        relations = [[relation('continuation', 'a', 'b')], [relation('continuation', 'b', 'c')], [relation('split', 'c', 'd e f g h i')]]
    elections, totals = [], []
    for year, counts in zip((2015, 2017, 2019), votes):
        record = dict(circuito='00001', mesa='1', mesa_tipo='NATIVOS', electores=100,
                      votes=dict(positivo=80),
                      positive={k: dict(name=k, votes=v) for k, v in counts.items()})
        elections.append(dict(year=year, mesas=[record], quarantined_mesas=[], is_proxy=False))
        totals.append(dict(year=year, offers=[dict(list_id=k, votes=v) for k, v in counts.items()],
                           totals=dict(positivos=80, electores=100)))
    if six:
        for e, t in zip(elections, totals): e['mesas'][0]['electores'] = t['totals']['electores'] = 80
    if no_continuing:
        totals[-1]['totals']['electores'] = 80
    if not electores:
        del totals[-1]['totals']['electores']
    if observed:
        dest = dict(d=70, f=10) if entries else dict(d=80)
        totals.append(dict(year=2021, offers=[dict(list_id=k, votes=v) for k, v in dest.items()],
                           totals=dict(positivos=80)))
    offer_map = dict(schema_version=1, years={})
    for election, counts in zip(elections, votes):
        offer_map['years'][str(election['year'])] = [dict(dine_id='D'+k if dine else k,
            jeba_list_id=k, dine_label=k, jeba_label=k, basis='synthetic') for k in counts]
        if dine:
            record = election['mesas'][0]
            record['positive'] = {'D'+k: v for k, v in record['positive'].items()}
    if missing:
        offer_map['years']['2015'].pop(0)
    if absent:
        offer_map['years'][absent][0]['jeba_list_id'] = 'ghost'
    files = dict(offers=offer_map, panel=dict(elections=elections), jeba=dict(elections=totals),
                 correspondence=dict(pairs=[dict(origin_year=y, destination_year=y+2, relations=r)
                                             for y, r in zip((2015, 2017, 2019), relations)]),
                 rules=dict(schema_version=1, pairs=[[2015, 2017], [2017, 2019]],
                            key=['circuito_identity_key', 'mesa_number', 'mesa_tipo'],
                            max_relative_electores_change='1/10', basis='synthetic'),
                 transfer=transfer, recipe=recipe)
    monkeypatch.setattr(Path, 'read_text', lambda p, **kw: json.dumps(files[p.name]))
    argv = ['panel', 'forecast']
    for flag, name in [('panel', 'panel'), ('rules', 'rules'), ('transfer-recipe', 'transfer'),
                       ('forecast-recipe', 'recipe'), ('correspondence', 'correspondence'), ('jeba', 'jeba'), ('offer-map', 'offers')]:
        argv += ['--' + flag, name]
    argv += ['--pair', '2019', '2021', '--train', '2015', '2017', '2017', '2019']
    if late:
        argv[-2:] = ['2019', '2021']
    monkeypatch.setattr(sys, 'argv', argv)
    code = cli.main()
    output = capsys.readouterr()
    return code, json.loads(output.out) if code == 0 else output.err


def test_six_successors_rounding_residual(monkeypatch, capsys):
    from etl import relation_forecast; from functools import reduce
    monkeypatch.setattr(relation_forecast, 'sum', lambda xs, start=0: reduce(lambda a, b: a+b, xs, start), raising=False)
    code, result = run(monkeypatch, capsys, six=True, entries=False, observed=False)
    assert code == 0, result
    assert result['matrix']['c'][NP] == 0 and min(result['matrix']['c'].values()) == 0
    assert sum(result['matrix']['c'].values()) == pytest.approx(1)


def test_dine_crosswalk_and_missing_id(monkeypatch, capsys):
    code, result = run(monkeypatch, capsys, dine=True)
    assert code == 0, result
    assert result == run(monkeypatch, capsys)[1]
    code, error = run(monkeypatch, capsys, dine=True, missing=True)
    assert code == 2 and '2015' in error and 'Da' in error


@pytest.mark.parametrize('year, key', [('2015', 'a'), ('2017', 'b')])
def test_absent_translated_jeba_id(monkeypatch, capsys, year, key):
    code, error = run(monkeypatch, capsys, dine=True, absent=year)
    assert code == 2 and f'year {year}: JEBA id {key}' in error


def test_two_pair_pool_and_metrics(monkeypatch, capsys):
    code, result = run(monkeypatch, capsys)
    assert code == 0, result
    rates = result['pooled_rates']
    assert rates['continuing']['rates'] == pytest.approx(dict(R=7/11, L=0, E=9/55, N=.2))
    assert rates['exit']['rates'] == pytest.approx(dict(X_c=.68, X_e=.12, X_n=.2))
    assert rates[NP]['rates'] == pytest.approx(dict(A_c=.65, A_e=.15, A_n=.2))
    assert [rates[k]['origin_votes'] for k in ('continuing', 'exit', NP)] == [110, 50, 40]
    assert all(v['observations'] == 2 for v in rates.values())
    assert all(sum(row.values()) == 1 for row in result['matrix'].values())
    shares = {k: Fraction(str(v['float'])) for k, v in result['shares'].items()}
    assert result['TV']['float'] == pytest.approx(float(total_variation(shares, dict(d=Fraction(7, 8), f=Fraction(1, 8)))))
    assert 'B1' in result['baselines'] and 'B2' in result['baselines']
    assert result == run(monkeypatch, capsys)[1]


def test_absent_entries_and_recipient_fallback(monkeypatch, capsys):
    code, result = run(monkeypatch, capsys, entries=False)
    assert code == 0, result
    assert result['fallbacks']['entries_absent']['row_mass'] > 0
    assert result['fallbacks']['recipient_less']['votes'] > 0
    assert result['shares']['d']['float'] == 1


def test_exit_without_entries(monkeypatch, capsys):
    code, result = run(monkeypatch, capsys, entries=False, application_exit=True)
    assert code == 0, result
    assert result['matrix']['z']['d'] == pytest.approx(.8)
    assert result['fallbacks']['entries_absent']['votes'] > 0


def test_zero_positive_forecast(monkeypatch, capsys):
    code, result = run(monkeypatch, capsys, entries=False, no_continuing=True)
    assert code == 0, result
    assert result['zero_positive_forecast'] == 1 and result['shares'] is None
    assert 'TV' not in result and 'seat_error' not in result


def test_unobserved_exit_class(monkeypatch, capsys):
    code, result = run(monkeypatch, capsys, unseen=True)
    assert code == 0, result
    assert result['matrix']['z'][NP] == 1
    assert result['fallbacks']['unobserved_class']['votes'] == 20


@pytest.mark.parametrize('options, message', [({'late': True}, 'rolling-origin'),
                                              ({'electores': False}, 'electores')])
def test_errors(monkeypatch, capsys, options, message):
    code, error = run(monkeypatch, capsys, **options)
    assert code == 2 and message in error


def test_without_observed_outcome(monkeypatch, capsys):
    code, result = run(monkeypatch, capsys, observed=False)
    assert code == 0, result
    assert 'TV' not in result and 'seat_error' not in result and 'baselines' not in result
