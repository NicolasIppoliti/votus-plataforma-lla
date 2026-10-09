"""2027 scenario simulator for Coronel Rosales concejales (slice 9).

Base: JEBA definitive totals of the scenario's base year (2025). The scenario
declares how base offers relate to hypothetical next-election offers, using the
offer-correspondence relation schema, and one or more transfer assumptions:

- `persistence`: B1, the best reference measured by the backtest.
- `relation_type`: pooled relation-type rates applied with the same rules as
  relation_forecast, in exact fractions; every rate is explicit and adjustable
  (`--rate NAME.CLASS.FIELD=VALUE`).

The committed backtest verdict labels the output: transfers are "supuestos sin
validar" unless the final result is validated. User decision 2026-10-09:
persistence is the default scenario.
"""

import hashlib
import json
import sys
from argparse import ArgumentParser
from fractions import Fraction
from pathlib import Path

if __name__ == "__main__":
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from etl.forecast_baselines import core_mapping, election_votes, number, seat_result

NP = "__non_positive__"
FIELDS = {
    "continuing": ("R", "L", "E", "N"),
    "exit": ("X_c", "X_e", "X_n"),
    NP: ("A_c", "A_e", "A_n"),
}


def load(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def text(value):
    return (
        str(value.numerator) if value.denominator == 1 else f"{value.numerator}/{value.denominator}"
    )


def parse_rate(value, where):
    if not isinstance(value, str):
        raise ValueError(f"{where}: rate must be a decimal string")
    try:
        rate = Fraction(value)
    except (ValueError, ZeroDivisionError):
        raise ValueError(f"{where}: invalid rate {value!r}") from None
    if rate < 0:
        raise ValueError(f"{where}: negative rate")
    return rate


def parse_rates(rates, name):
    if not isinstance(rates, dict) or set(rates) != set(FIELDS):
        raise ValueError(f"{name}: rates need classes {sorted(FIELDS)}")
    for kind, fields in FIELDS.items():
        if set(rates[kind]) != set(fields):
            raise ValueError(f"{name}.{kind}: unknown rate set, expected {list(fields)}")
    return {
        kind: [parse_rate(rates[kind][f], f"{name}.{kind}.{f}") for f in fields]
        for kind, fields in FIELDS.items()
    }


def persistence(mapping):
    mapped, entries = mapping["mapped_shares"], mapping["entries"]
    if entries:
        return {
            k: v + (mapping["exit_mass"] / len(entries) if k in entries else 0)
            for k, v in mapped.items()
        }
    mass = sum(mapped.values())
    if not mass:
        raise ValueError("persistence needs a continuing offer or an entry")
    return {k: v / mass for k, v in mapped.items()}


def transfers(mapping, origin, rates):
    """Apply class rates row by row; counted fallbacks mirror relation_forecast."""
    destinations, entries = mapping["destinations"], mapping["entries"]
    continuing = [d for d in destinations if d not in entries]
    votes = dict.fromkeys(destinations + [NP], Fraction(0))
    fallbacks = dict.fromkeys(("entries_absent", "recipient_less", "unobserved_class"), Fraction(0))
    for o, v in origin.items():
        successors = mapping["mapped_origins"].get(o, {}).get("destinations", [])
        kind = NP if o == NP else "continuing" if successors else "exit"

        def give(mass, targets, weighted=False):
            weights = {d: mapping["mapped_shares"][d] if weighted else Fraction(1) for d in targets}
            total = sum(weights.values())
            if not total:
                votes[NP] += mass * v
                fallbacks["recipient_less"] += mass * v
            else:
                for d, weight in weights.items():
                    votes[d] += mass * v * weight / total

        scale = sum(rates[kind])
        if not scale:
            votes[NP] += v
            fallbacks["unobserved_class"] += v
            continue
        values = [r / scale for r in rates[kind]]
        if kind == "continuing":
            retention, leak, entry, nonpos = values
            give(retention, successors)
            targets = [d for d in continuing if d not in successors]
        else:
            leak, entry, nonpos = values
            targets = continuing
        if entries:
            give(entry, entries)
        else:
            fallbacks["entries_absent"] += entry * v
            leak += entry
        give(leak, targets, weighted=True)
        votes[NP] += nonpos * v
    return votes, fallbacks


def backtest_status(development_path, final_path):
    development, final = load(development_path), load(final_path)
    if final.get("development_sha256") != sha256(development_path):
        raise ValueError("final backtest result does not reference this development result")
    validated = final["validated"] is True
    means = {n: g["mean_tv"]["reference"] for n, g in development["gates"].items()}
    return dict(
        validated=validated,
        label="transferencias validadas" if validated else "supuestos sin validar",
        development_pass=development["development_pass"],
        development_mean_tv=dict(
            model=next(iter(development["gates"].values()))["mean_tv"]["model"],
            reference=means[development["reference"][0]],
            **means,
        ),
        final_tv={k: v["TV"] for k, v in final["result"].items() if k != "target"},
        development_sha256=sha256(development_path),
        final_sha256=sha256(final_path),
    )


def simulate(args):
    scenario = load(args.scenario)
    if scenario.get("schema_version") != 1:
        raise ValueError("unsupported scenario schema_version")
    if scenario.get("default") not in scenario["scenarios"]:
        raise ValueError("default scenario is not declared")
    data = load(args.jeba)
    base_year = scenario["base_year"]
    votes, positive = election_votes(data, base_year)
    electores = next(e for e in data["elections"] if e["year"] == base_year)["totals"].get(
        "electores"
    )
    if type(electores) is not int or electores < positive:
        raise ValueError("JEBA electores required and must cover positivos")
    relations = scenario["relations"]
    if any(NP in r["origins"] or NP in r["destinations"] for r in relations):
        raise ValueError("offer collides with non-positive category")
    try:
        mapping = core_mapping(
            dict(relations=relations), {k: Fraction(v, positive) for k, v in votes.items()}
        )
    except ValueError as error:
        raise ValueError(f"relations: {error} (every base offer needs coverage)") from None
    overrides = {}
    for item in args.rate:
        target, _, value = item.partition("=")
        name, _, rest = target.partition(".")
        kind, _, field = rest.partition(".")
        if scenario["scenarios"].get(name, {}).get("model") != "relation_type":
            raise ValueError(f"--rate {item}: {name!r} is not a relation_type scenario")
        if field not in FIELDS.get(kind, ()):
            raise ValueError(f"--rate {item}: unknown rate {kind}.{field}")
        overrides.setdefault(name, {}).setdefault(kind, {})[field] = value
    results = {}
    for name, spec in scenario["scenarios"].items():
        detail = {}
        if spec.get("model") == "persistence":
            shares = persistence(mapping)
        elif spec.get("model") == "relation_type":
            rates = {
                k: dict(spec["rates"][k], **overrides.get(name, {}).get(k, {}))
                for k in spec["rates"]
            }
            parsed = parse_rates(rates, name)
            forecast, fallbacks = transfers(mapping, {**votes, NP: electores - positive}, parsed)
            total = sum(v for d, v in forecast.items() if d != NP)
            if not total:
                raise ValueError(f"{name}: zero positive forecast")
            shares = {d: v / total for d, v in forecast.items() if d != NP}
            detail = dict(
                rates={k: {f: text(r) for f, r in zip(FIELDS[k], parsed[k])} for k in FIELDS},
                non_positive_votes=text(forecast[NP]),
                fallback_votes={k: text(v) for k, v in fallbacks.items()},
            )
        else:
            raise ValueError(f"{name}: unknown model {spec.get('model')!r}")
        results[name] = dict(
            model=spec["model"],
            shares={k: number(v) for k, v in shares.items()},
            seats=seat_result({k: v * positive for k, v in shares.items()}),
            **detail,
        )
    return dict(
        schema_version=1,
        base_year=base_year,
        target_year=scenario["target_year"],
        default=scenario["default"],
        scenario_sha256=sha256(args.scenario),
        status=backtest_status(args.backtest_development, args.backtest_final),
        entries=mapping["entries"],
        exit_origins=mapping["exit_origins"],
        scenarios=results,
    )


def main():
    parser = ArgumentParser(
        description="Simulate 2027 concejales scenarios from the JEBA 2025 base"
    )
    for flag in ("jeba", "scenario", "backtest-development", "backtest-final"):
        parser.add_argument("--" + flag, type=Path, required=True)
    parser.add_argument("--rate", action="append", default=[], metavar="NAME.CLASS.FIELD=VALUE")
    args = parser.parse_args()
    try:
        result = simulate(args)
    except (ValueError, OSError, KeyError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 2
    print(json.dumps(result, sort_keys=True, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
