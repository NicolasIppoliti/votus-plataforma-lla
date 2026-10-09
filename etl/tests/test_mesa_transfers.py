import json
from pathlib import Path
import subprocess
import sys

import pytest

ROOT = Path(__file__).resolve().parents[2]
CLI = ROOT / 'etl/etl/dine_municipal_panel.py'
RECIPE = ROOT / 'curated/slice-09-transfer-recipe.json'
TRUTH = [[.7, .1, .1, .1], [.1, .6, .2, .1], [.1, .1, .7, .1], [.2, .2, .1, .5]]


def fixture(tmp_path, single=False, negative=False):
    elections = [dict(year=y, mesas=[], quarantined_mesas=[], is_proxy=False) for y in (2019, 2021)]
    for i in range(40):
        # Integer counts, full-rank compositions, exact integer destination counts.
        x = [100, 100, 100, 100]
        x[i % 4] += 600 + (i // 4) * 100
        y = [sum(x[r] * round(TRUTH[r][c] * 10) for r in range(4)) // 10 for c in range(4)]
        for election, counts in zip(elections, (x, y)):
            positive = {} if single else {str(k): dict(name=f'Offer {k}', votes=counts[k]) for k in range(3)}
            positivo = sum(v['votes'] for v in positive.values())
            election['mesas'].append(dict(circuito='00001', mesa=str(i+1), mesa_tipo='NATIVOS',
                electores=sum(counts), votes={'positivo': positivo}, positive=positive))
    if negative:
        elections[0]['mesas'][0]['votes']['positivo'] = 10001
    panel = tmp_path / 'panel.json'
    panel.write_text(json.dumps(dict(elections=elections)))
    rules = tmp_path / 'rules.json'
    rules.write_text(json.dumps(dict(schema_version=1, pairs=[[2019, 2021]],
        key=['circuito_identity_key', 'mesa_number', 'mesa_tipo'],
        max_relative_electores_change='1/10', basis='test declaration')))
    return panel, rules


def run(panel, rules, recipe=RECIPE, pair=('2019', '2021')):
    return subprocess.run([sys.executable, '-I', '-S', '-B', str(CLI), 'transfers',
        '--panel', str(panel), '--rules', str(rules), '--recipe', str(recipe), '--pair', *pair],
        capture_output=True, text=True)


def test_recovery_stochastic_and_deterministic(tmp_path):
    panel, rules = fixture(tmp_path)
    first = run(panel, rules)
    assert first.returncode == 0, first.stderr
    assert first.stdout == run(panel, rules).stdout
    result = json.loads(first.stdout)
    categories = ['0', '1', '2', '__non_positive__']
    for r, origin in enumerate(categories):
        row = result['matrix'][origin]
        assert sum(row.values()) == pytest.approx(1, abs=3e-9)
        for c, destination in enumerate(categories):
            assert row[destination] >= 0
            assert row[destination] == pytest.approx(TRUTH[r][c], abs=.02)
    assert result['mesas_used'] == 40
    assert result['converged']
    assert result['recipe']['accelerator'] == 'fista_with_monotone_restart'
    baseline_recipe = dict(result['recipe'], accelerator='none')
    baseline_path = tmp_path / 'baseline.json'
    baseline_path.write_text(json.dumps(baseline_recipe))
    response = run(panel, rules, recipe=baseline_path)
    assert response.returncode == 0, response.stderr
    baseline = json.loads(response.stdout)
    assert baseline['converged']
    assert result['iterations'] < baseline['iterations']
    assert result['iterations'] < result['recipe']['max_iter']
    assert result['recipe']['lipschitz'] == 'power_iteration'
    assert result['objective'] < 1e-10
    assert result['mesas_excluded_by_reason'] == {'not_aligned': 0, 'negative_non_positive': 0}
    for totals in result['destination_totals'].values():
        assert totals['implied'] == pytest.approx(totals['observed'], abs=.01)


def test_negative_non_positive_and_not_aligned(tmp_path):
    panel, rules = fixture(tmp_path, negative=True)
    data = json.loads(panel.read_text())
    removed = data['elections'][0]['mesas'].pop()
    removed['mesa'] = '100'
    removed['positive']['unknown'] = removed['positive'].pop('0')
    data['elections'][0]['mesas'].append(removed)
    panel.write_text(json.dumps(data))
    response = run(panel, rules)
    assert response.returncode == 0, response.stderr
    result = json.loads(response.stdout)
    assert result['mesas_used'] == 38
    assert result['mesas_excluded_by_reason'] == {'not_aligned': 2, 'negative_non_positive': 1}
    assert 'unknown' in result['matrix']


def test_known_lipschitz_bound_from_real_cli(tmp_path):
    panel, rules = fixture(tmp_path)
    data = json.loads(panel.read_text())
    for election in data['elections']:
        election['mesas'] = election['mesas'][:2]
        for record, electores, votes in zip(election['mesas'], (8, 2), (6, 1)):
            record.update(electores=electores, votes={'positivo': votes},
                          positive={'0': {'name': 'Offer 0', 'votes': votes}})
    panel.write_text(json.dumps(data))
    response = run(panel, rules)
    assert response.returncode == 0, response.stderr
    result = json.loads(response.stdout)
    # X^T W X = [[5, 2], [2, 1]]; eigenvalues = 3 +/- sqrt(8).
    largest = 3 + 8 ** .5
    assert result['lipschitz_bound'] >= largest
    assert result['lipschitz_bound'] == pytest.approx(largest * 1.05, rel=1e-12)
    assert result['step_size'] == pytest.approx(1 / result['lipschitz_bound'])
    assert result['converged']


def test_single_category(tmp_path):
    response = run(*fixture(tmp_path, single=True))
    assert response.returncode == 0, response.stderr
    assert json.loads(response.stdout)['matrix'] == {'__non_positive__': {'__non_positive__': 1.0}}


@pytest.mark.parametrize('change', ['pair', 'tol', 'max_iter', 'weighting', 'extra'])
def test_invalid_recipe_or_pair(tmp_path, change):
    panel, rules = fixture(tmp_path)
    if change == 'pair':
        response = run(panel, rules, pair=('2019', '2023'))
    else:
        recipe = json.loads(RECIPE.read_text())
        recipe[change] = {'tol': 'nan', 'max_iter': 0, 'weighting': 'destination', 'extra': True}[change]
        path = tmp_path / 'recipe.json'
        path.write_text(json.dumps(recipe))
        response = run(panel, rules, recipe=path)
    assert response.returncode == 2
    assert response.stderr.startswith('error: ')
    assert not response.stdout
