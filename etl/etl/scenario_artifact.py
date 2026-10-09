"""Slice 10 scenario artifact: a deterministic, content-addressed snapshot of the
2027 Coronel Rosales CONCEJALES scenarios for read-only presentation.

The artifact is produced from `scenario_2027.simulate` and the committed Slice 9
backtest results. It carries list labels from the JEBA definitive totals, exact and
display shares, Hare seats, the unvalidated status and the SHA-256 of every input.
The file name embeds the SHA-256 of its exact bytes; regenerating writes the same
bytes, and different content under an existing name is refused.
"""

import hashlib
import json
import sys
from argparse import ArgumentParser, Namespace
from fractions import Fraction
from pathlib import Path

if __name__ == "__main__":
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from etl.scenario_2027 import load, simulate

ROOT = Path(__file__).resolve().parents[2]
NAMES = {
    "persistence": "Persistencia",
    "relation_type": "Transferencias estimadas por inferencia ecológica",
}
SOURCES = {
    "jeba": "jeba_totals",
    "scenario": "scenario",
    "backtest_development": "backtest_development",
    "backtest_final": "backtest_final",
}


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def decimal_text(value, places):
    """Round half to even with exact integers and keep trailing zeros."""
    scaled = round(Fraction(value) * 10**places)
    sign, digits = ("-" if scaled < 0 else ""), str(abs(scaled)).rjust(places + 1, "0")
    return f"{sign}{digits[:-places]}.{digits[-places:]}"


def source_entry(path):
    resolved = Path(path).resolve()
    if not resolved.is_relative_to(ROOT):
        raise ValueError(f"input outside the repository: {path}")
    return dict(path=resolved.relative_to(ROOT).as_posix(), sha256=sha256(resolved))


def scenario_entry(name, result, labels, default):
    allocation = result["seats"]
    seats = allocation.get("seats", {})
    rows = []
    for list_id, share in result["shares"].items():
        if list_id not in labels:
            raise ValueError(f"{name}: list {list_id} has no JEBA label")
        exact = Fraction(share["exact"])
        rows.append(
            dict(
                list_id=list_id,
                label=labels[list_id],
                share_exact=share["exact"],
                share_percent=decimal_text(exact * 100, 2),
                seats=seats.get(list_id, 0),
            )
        )
    rows.sort(key=lambda r: (-r["seats"], -Fraction(r["share_exact"]), r["list_id"]))
    entry = dict(
        id=name,
        name=NAMES[result["model"]],
        model=result["model"],
        default=name == default,
        seat_status="ambiguous_tie" if allocation.get("error") else "allocated",
        total_seats=sum(r["seats"] for r in rows),
        lists=rows,
    )
    if result["model"] == "relation_type":
        entry["assumptions"] = dict(rates=result["rates"], fallback_votes=result["fallback_votes"])
    return entry


def build(args):
    result = simulate(args)
    scenario = load(args.scenario)
    election = next(e for e in load(args.jeba)["elections"] if e["year"] == result["base_year"])
    labels = {offer["list_id"]: offer["label"] for offer in election["offers"]}
    status = result["status"]
    reference = load(args.backtest_development)["reference"][0]

    def pp(exact):
        return decimal_text(Fraction(exact) * 100, 3)

    return dict(
        kind="votus.scenario-artifact",
        schema_version=1,
        territory=dict(pba_distrito="027", name="Coronel Rosales"),
        category="CONCEJALES",
        base_year=result["base_year"],
        target_year=result["target_year"],
        seats_per_renewal=9,
        status=dict(validated=status["validated"], label=status["label"]),
        default_scenario=result["default"],
        scenarios=[
            scenario_entry(name, item, labels, result["default"])
            for name, item in result["scenarios"].items()
        ],
        backtest=dict(
            reference=reference,
            development_pass=status["development_pass"],
            development_mean_tv_pp=dict(
                model=pp(status["development_mean_tv"]["model"]),
                reference=pp(status["development_mean_tv"]["reference"]),
            ),
            final_tv_pp=dict(
                model=pp(status["final_tv"]["model"]),
                reference=pp(status["final_tv"][reference]),
            ),
        ),
        provenance=dict(
            generator="etl/etl/scenario_artifact.py",
            scenario_note=scenario["note"],
            sources={key: source_entry(getattr(args, attr)) for attr, key in SOURCES.items()},
        ),
    )


def write(artifact, output_dir):
    data = json.dumps(artifact, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
    payload = data.encode("utf-8")
    digest = hashlib.sha256(payload).hexdigest()
    filename = f"rosales-concejales-2027.{digest}.json"
    destination = Path(output_dir) / filename
    if destination.exists() and destination.read_bytes() != payload:
        raise ValueError("existing artifact content mismatch")
    Path(output_dir).mkdir(parents=True, exist_ok=True)
    destination.write_bytes(payload)
    return dict(filename=filename, sha256=digest, bytes=len(payload))


def main():
    parser = ArgumentParser(description="Write the Slice 10 scenario artifact")
    for flag in ("jeba", "scenario", "backtest-development", "backtest-final", "output-dir"):
        parser.add_argument("--" + flag, type=Path, required=True)
    args = parser.parse_args()
    try:
        meta = write(build(Namespace(**vars(args), rate=[])), args.output_dir)
    except (ValueError, OSError, KeyError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 2
    print(json.dumps(meta, sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())
