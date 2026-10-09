"""2027 scenario simulator, driven through its CLI entry point."""

import hashlib
import json
import sys
from fractions import Fraction as F
from pathlib import Path

import pytest

from etl import scenario_2027 as cli

ROOT = Path(__file__).resolve().parents[2]
SCENARIO = ROOT / "curated/slice-09-scenario-2027.json"
FIXTURE = ROOT / "docs/research/slice-09-frozen-forecast-2023-2025.json"
BASE = dict(json.loads(SCENARIO.read_text(encoding="utf-8")))
VOTES_2025 = {
    "2206": 14550,
    "2200": 7300,
    "2201": 4540,
    "2207": 1788,
    "2204": 1512,
    "962": 1384,
    "2203": 1027,
    "2202": 190,
}


def run(monkeypatch, capsys, tmp_path, scenario=None, extra=()):
    path = SCENARIO
    if scenario is not None:
        path = tmp_path / "scenario.json"
        path.write_text(json.dumps(scenario), encoding="utf-8")
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "x",
            "--jeba",
            str(ROOT / "curated/slice-09-jeba-definitive-totals.json"),
            "--scenario",
            str(path),
            "--backtest-development",
            str(ROOT / "docs/research/slice-09-backtest-development.json"),
            "--backtest-final",
            str(ROOT / "docs/research/slice-09-backtest-final.json"),
            *extra,
        ],
    )
    code = cli.main()
    captured = capsys.readouterr()
    return code, (json.loads(captured.out) if code == 0 else captured.err)


def shares(result, name):
    return {k: F(v["exact"]) for k, v in result["scenarios"][name]["shares"].items()}


def test_default_is_unvalidated_persistence_of_2025(monkeypatch, capsys, tmp_path):
    code, r = run(monkeypatch, capsys, tmp_path)
    assert code == 0 and r["default"] == "persistencia" and r["target_year"] == 2027
    assert r["status"]["validated"] is False and r["status"]["label"] == "supuestos sin validar"
    assert (
        r["status"]["development_mean_tv"]["reference"] == r["status"]["development_mean_tv"]["B1"]
    )
    assert shares(r, "persistencia") == {k: F(v, 32291) for k, v in VOTES_2025.items()}
    seats = r["scenarios"]["persistencia"]["seats"]["seats"]
    assert {k: v for k, v in seats.items() if v} == {"2206": 5, "2200": 2, "2201": 2}
    assert sum(shares(r, "transferencias_ei").values()) == 1


def test_default_rates_come_from_the_frozen_model():
    fixture = FIXTURE.read_bytes()
    source = BASE["scenarios"]["transferencias_ei"]["rates_source"]
    assert hashlib.sha256(fixture).hexdigest() == source["sha256"]
    pooled = json.loads(fixture)["pooled_rates"]
    rates = BASE["scenarios"]["transferencias_ei"]["rates"]
    assert rates == {k: {f: repr(v) for f, v in pooled[k]["rates"].items()} for k in pooled}


def test_engine_reproduces_frozen_forecast_2023_to_2025(monkeypatch, capsys, tmp_path):
    fixture = json.loads(FIXTURE.read_bytes())
    correspondence = json.loads(
        (ROOT / "curated/slice-09-offer-correspondence.json").read_text(encoding="utf-8")
    )
    pair = next(p for p in correspondence["pairs"] if p["origin_year"] == 2023)
    scenario = dict(BASE, base_year=2023, target_year=2025, relations=pair["relations"])
    code, r = run(monkeypatch, capsys, tmp_path, scenario)
    assert code == 0
    for d, value in fixture["shares"].items():
        assert abs(float(shares(r, "transferencias_ei")[d]) - value["float"]) < 1e-12
    assert shares(r, "persistencia") == {
        k: F(v["exact"]) for k, v in fixture["baselines"]["B1"]["shares"].items()
    }


def test_rate_overrides_are_explicit_assumptions(monkeypatch, capsys, tmp_path):
    keep = ["--rate", "transferencias_ei.continuing.R=1"]
    for field in ("L", "E", "N"):
        keep += ["--rate", f"transferencias_ei.continuing.{field}=0"]
    keep += [
        "--rate",
        "transferencias_ei.__non_positive__.A_n=1",
        "--rate",
        "transferencias_ei.__non_positive__.A_c=0",
        "--rate",
        "transferencias_ei.__non_positive__.A_e=0",
    ]
    code, r = run(monkeypatch, capsys, tmp_path, extra=keep)
    assert code == 0 and shares(r, "transferencias_ei") == shares(r, "persistencia")
    assert r["scenarios"]["transferencias_ei"]["rates"]["continuing"]["R"] == "1"


def test_declared_merge_exit_and_entry(monkeypatch, capsys, tmp_path):
    relations = [
        dict(type="merge", origins=["2206", "2204"], destinations=["LLA27"]),
        dict(type="exit", origins=["962"], destinations=[]),
        dict(type="entry", origins=[], destinations=["NUEVA"]),
    ]
    relations += [
        dict(type="continuation", origins=[k], destinations=[k])
        for k in VOTES_2025
        if k not in ("2206", "2204", "962")
    ]
    scenario = dict(BASE, relations=relations)
    scenario["scenarios"] = dict(BASE["scenarios"])
    scenario["scenarios"]["transferencias_ei"] = dict(BASE["scenarios"]["transferencias_ei"])
    scenario["scenarios"]["transferencias_ei"]["rates"] = dict(
        BASE["scenarios"]["transferencias_ei"]["rates"], exit=dict(X_c="0", X_e="0", X_n="0")
    )
    code, r = run(monkeypatch, capsys, tmp_path, scenario)
    assert code == 0
    persisted = shares(r, "persistencia")
    assert persisted["LLA27"] == F(14550 + 1512, 32291) and persisted["NUEVA"] == F(1384, 32291)
    assert r["scenarios"]["transferencias_ei"]["fallback_votes"]["unobserved_class"] == "1384"


@pytest.mark.parametrize(
    "change, extra, message",
    [
        (
            dict(relations=[dict(type="continuation", origins=["2206"], destinations=["2206"])]),
            [],
            "coverage",
        ),
        (dict(default="otro"), [], "default scenario"),
        ({}, ["--rate", "transferencias_ei.exit.X_c=-1"], "negative rate"),
        ({}, ["--rate", "persistencia.exit.X_c=1"], "not a relation_type scenario"),
        ({}, ["--rate", "transferencias_ei.exit.Z=1"], "unknown rate"),
        ({}, ["--rate", "otro.exit.X_c=1"], "not a relation_type scenario"),
        (
            dict(
                relations=BASE["relations"]
                + [dict(type="entry", origins=[], destinations=["__non_positive__"])]
            ),
            [],
            "non-positive category",
        ),
    ],
)
def test_invalid_scenarios_fail_loudly(monkeypatch, capsys, tmp_path, change, extra, message):
    code, err = run(monkeypatch, capsys, tmp_path, dict(BASE, **change), extra)
    assert code == 2 and message in err


def test_backtest_files_must_belong_together(monkeypatch, capsys, tmp_path):
    other = tmp_path / "development.json"
    other.write_text("{}", encoding="utf-8")
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "x",
            "--jeba",
            str(ROOT / "curated/slice-09-jeba-definitive-totals.json"),
            "--scenario",
            str(SCENARIO),
            "--backtest-development",
            str(other),
            "--backtest-final",
            str(ROOT / "docs/research/slice-09-backtest-final.json"),
        ],
    )
    assert cli.main() == 2 and "development result" in capsys.readouterr().err


def test_mass_without_recipients_goes_to_non_positive(monkeypatch, capsys, tmp_path):
    relations = [
        dict(type="exit", origins=list(VOTES_2025), destinations=[]),
        dict(type="entry", origins=[], destinations=["NUEVA"]),
    ]
    code, r = run(monkeypatch, capsys, tmp_path, dict(BASE, relations=relations))
    assert code == 0 and shares(r, "persistencia") == {"NUEVA": 1} == shares(r, "transferencias_ei")
    assert F(r["scenarios"]["transferencias_ei"]["fallback_votes"]["recipient_less"]) > 0
