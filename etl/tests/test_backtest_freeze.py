"""The slice 9 backtest freeze must match the committed bytes it declares."""
import ast
from fractions import Fraction
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
FREEZE = ROOT / 'curated/slice-09-backtest-freeze.json'


def load():
    return json.loads(FREEZE.read_text(encoding='utf-8'))


def test_every_frozen_file_matches_its_sha256():
    freeze = load()
    files = {**freeze['code']['files'], **freeze['inputs'], **freeze['documents']}
    assert files, 'freeze declares no files'
    for path, expected in files.items():
        assert hashlib.sha256((ROOT / path).read_bytes()).hexdigest() == expected, path


def etl_import_closure(entry):
    """Every etl/etl module reachable from entry through etl.* imports."""
    seen, pending = set(), [entry]
    while pending:
        path = pending.pop()
        if path in seen:
            continue
        seen.add(path)
        for node in ast.walk(ast.parse((ROOT / path).read_text(encoding='utf-8'))):
            names = []
            if isinstance(node, ast.ImportFrom):
                module = f'etl.{node.module or ""}'.rstrip('.') if node.level else node.module or ''
                names = [module] + [f'{module}.{a.name}' for a in node.names]
            elif isinstance(node, ast.Import):
                names = [a.name for a in node.names]
            for name in names:
                parts = name.split('.')
                if parts[0] == 'etl' and len(parts) == 2:
                    candidate = f'etl/etl/{parts[1]}.py'
                    if (ROOT / candidate).is_file():
                        pending.append(candidate)
    return seen


def test_freeze_covers_every_forecast_cli_input():
    freeze = load()
    for name in ('dine-jeba-offer-map', 'forecast-recipe', 'jeba-definitive-totals',
                 'mesa-alignment-rules', 'mesa-panel-inputs', 'offer-correspondence',
                 'transfer-recipe'):
        assert f'curated/slice-09-{name}.json' in freeze['inputs']
    closure = etl_import_closure('etl/etl/dine_municipal_panel.py')
    assert closure - freeze['code']['files'].keys() == set()
    assert len(freeze['derived']['panel']['sha256']) == 64


def test_cuts_are_rolling_origin_and_2025_is_single_final():
    freeze = load()
    cuts = freeze['development_cuts']
    assert [c['target'] for c in cuts] == [2019, 2021, 2023]
    final = freeze['final_test']
    assert final['target'] == 2025 and final['measurements_allowed'] == 1
    for cut in cuts + [final]:
        origin, target = cut['pair']
        assert target == cut['target'] and origin == target - 2
        training = [tuple(p) for p in cut['train']]
        assert training == [(y, y + 2) for y in range(2015, origin, 2)]


def test_gates_match_goal_thresholds():
    gates = load()['gates']
    assert Fraction(gates['relative_mean_tv_max_ratio']) == Fraction(85, 100)
    assert Fraction(gates['absolute_mean_tv_min_gain']) == Fraction(1, 100)
    assert gates['cut_wins_required'] == 'strict_majority'
    assert Fraction(gates['max_cut_tv_loss']) == Fraction(2, 100)
    assert gates['seat_error_mean'] == 'not_worse_than_reference'
    assert gates['absolute_tv_is_gate'] is False
    confirmation = load()['final_confirmation']
    assert Fraction(confirmation['max_tv_loss']) == Fraction(2, 100)
    assert confirmation['seat_error'] == 'not_worse_than_reference'
