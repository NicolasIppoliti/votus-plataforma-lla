"""Preregistered backtest runner and gate evaluator.

Reads curated/slice-09-backtest-freeze.json, refuses to forecast unless every
frozen file and the rebuilt panel match their SHA-256, runs the frozen cuts
through relation_forecast.forecast and evaluates the frozen gates with exact
fractions. The development stage reports gates on the rolling cuts; the final
stage needs that development result (same freeze) and confirms 2025 against
the reference chosen there. Undefined metrics fail every gate they feed.
"""
from argparse import ArgumentParser, Namespace
from fractions import Fraction
import hashlib
import json
from pathlib import Path
import sys

if __name__ == '__main__':
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from etl import relation_forecast

FLAGS = dict(rules='mesa-alignment-rules', transfer_recipe='transfer-recipe',
             forecast_recipe='forecast-recipe', correspondence='offer-correspondence',
             jeba='jeba-definitive-totals', offer_map='dine-jeba-offer-map')
REFERENCES = ('B1', 'B2')


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def verify(freeze_path, panel_path):
    root = Path(freeze_path).resolve().parents[1]
    freeze = json.loads(Path(freeze_path).read_text(encoding='utf-8'))
    files = {**freeze['code']['files'], **freeze['inputs'], **freeze['documents']}
    changed = sorted(p for p, expected in files.items() if sha256(root / p) != expected)
    if changed:
        raise ValueError('frozen file changed: ' + ', '.join(changed))
    if sha256(panel_path) != freeze['derived']['panel']['sha256']:
        raise ValueError('panel sha256 mismatch with freeze')
    return root, freeze


def exact(value):
    return None if value is None else Fraction(value['exact'])


def run_cut(cut, root, panel_path):
    paths = {}
    for flag, name in FLAGS.items():
        paths[flag] = root / f'curated/slice-09-{name}.json'
    args = Namespace(panel=str(panel_path), pair=list(cut['pair']),
                     train=[year for pair in cut['train'] for year in pair], **paths)
    result = relation_forecast.forecast(args)
    metrics = dict(model=dict(TV=exact(result.get('TV')), seat_error=result.get('seat_error')))
    for name in REFERENCES:
        baseline = result['baselines'][name]
        if baseline['TV'] is None:
            raise ValueError(f"undefined {name} TV for {cut['target']}")
        metrics[name] = dict(TV=exact(baseline['TV']), seat_error=baseline['seat_error'])
    return metrics


def text(value):
    return None if value is None else f'{value.numerator}/{value.denominator}'


def development_gates(cuts, reference, gates):
    model = [c['model']['TV'] for c in cuts]
    other = [c[reference]['TV'] for c in cuts]
    model_seats = [c['model']['seat_error'] for c in cuts]
    other_seats = [c[reference]['seat_error'] for c in cuts]
    defined = None not in model + other
    seats_defined = None not in model_seats + other_seats
    mean_model = sum(model) / len(model) if defined else None
    mean_other = sum(other) / len(other) if defined else None
    wins = sum(m < o for m, o in zip(model, other)) if defined else 0
    return dict(
        mean_tv=dict(model=text(mean_model), reference=text(mean_other)), wins=wins,
        relative=defined and mean_model <= Fraction(gates['relative_mean_tv_max_ratio']) * mean_other,
        absolute=defined and mean_other - mean_model >= Fraction(gates['absolute_mean_tv_min_gain']),
        majority=defined and 2 * wins > len(cuts),
        max_loss=defined and all(m - o <= Fraction(gates['max_cut_tv_loss']) for m, o in zip(model, other)),
        seats=seats_defined and sum(model_seats) <= sum(other_seats))


def confirmation(cut, reference, rule):
    model, other = cut['model'], cut[reference]
    if None in (model['TV'], other['TV'], model['seat_error'], other['seat_error']):
        return False
    return (model['TV'] - other['TV'] <= Fraction(rule['max_tv_loss'])
            and model['seat_error'] <= other['seat_error'])


def serial(target, metrics):
    return dict(target=target, **{k: dict(TV=text(v['TV']), seat_error=v['seat_error'])
                                  for k, v in metrics.items()})


def development_stage(root, freeze, panel, common):
    """Sums rank references like means: every reference covers the same cuts."""
    cuts = [run_cut(c, root, panel) for c in freeze['development_cuts']]
    means = {n: sum(c[n]['TV'] for c in cuts) for n in REFERENCES}
    best = min(means.values())
    reference = [n for n in REFERENCES if means[n] == best]
    gates = {n: development_gates(cuts, n, freeze['gates']) for n in reference}
    checks = ('relative', 'absolute', 'majority', 'max_loss', 'seats')
    return dict(common, stage='development', reference=reference, gates=gates,
                cuts=[serial(c['target'], m) for c, m in zip(freeze['development_cuts'], cuts)],
                undefined_cuts=[c['target'] for c, m in zip(freeze['development_cuts'], cuts)
                                if m['model']['TV'] is None],
                development_pass=all(g[k] for g in gates.values() for k in checks))


def backtest(args):
    root, freeze = verify(args.freeze, args.panel)
    freeze_sha = sha256(args.freeze)
    common = dict(experiment_id=freeze['experiment_id'], freeze_sha256=freeze_sha,
                  panel_sha256=sha256(args.panel), stage=args.stage)
    if args.stage == 'development':
        if args.development is not None:
            raise ValueError('--development is only valid for the final stage')
        return development_stage(root, freeze, args.panel, common)
    if args.development is None:
        raise ValueError('--development is required for the final stage')
    development = json.loads(Path(args.development).read_text(encoding='utf-8'))
    if development.get('freeze_sha256') != freeze_sha:
        raise ValueError('development result belongs to a different freeze')
    if development != development_stage(root, freeze, args.panel, common):
        raise ValueError('development result does not reproduce under this freeze')
    cut = freeze['final_test']
    metrics = run_cut(cut, root, args.panel)
    confirmed = {n: confirmation(metrics, n, freeze['final_confirmation'])
                 for n in development['reference']}
    return dict(common, target=cut['target'], reference=development['reference'],
                development_sha256=sha256(args.development),
                development_pass=development['development_pass'], confirmation=confirmed,
                result=serial(cut['target'], metrics),
                validated=development['development_pass'] and all(confirmed.values()))


def main():
    parser = ArgumentParser(description='Run the frozen preregistered slice 9 backtest')
    parser.add_argument('--freeze', type=Path, required=True)
    parser.add_argument('--panel', type=Path, required=True)
    parser.add_argument('--stage', choices=('development', 'final'), required=True)
    parser.add_argument('--development', type=Path)
    args = parser.parse_args()
    try:
        result = backtest(args)
    except (ValueError, OSError) as error:
        print(f'error: {error}', file=sys.stderr)
        return 2
    print(json.dumps(result, sort_keys=True, ensure_ascii=False))
    return 0


if __name__ == '__main__':
    sys.exit(main())
