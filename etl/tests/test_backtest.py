"""Backtest CLI on a synthetic freeze; forecasts are canned, never real data."""

import hashlib
import json
import sys
from fractions import Fraction as F
from pathlib import Path

import pytest

from etl import backtest as cli
from etl import relation_forecast
from etl.forecast_baselines import number

ROOT = Path(__file__).resolve().parents[2]
REAL = json.loads((ROOT / "curated/slice-09-backtest-freeze.json").read_text(encoding="utf-8"))
NAMES = (
    "dine-jeba-offer-map",
    "forecast-recipe",
    "jeba-definitive-totals",
    "mesa-alignment-rules",
    "offer-correspondence",
    "transfer-recipe",
)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def make_freeze(tmp_path):
    inputs = {}
    for name in NAMES:
        path = tmp_path / f"curated/slice-09-{name}.json"
        path.parent.mkdir(exist_ok=True)
        path.write_bytes(name.encode())
        inputs[f"curated/slice-09-{name}.json"] = sha(name.encode())
    (tmp_path / "panel.json").write_bytes(b"panel")
    freeze = {
        k: REAL[k]
        for k in ("experiment_id", "development_cuts", "final_test", "gates", "final_confirmation")
    }
    freeze.update(
        code=dict(files={}),
        documents={},
        inputs=inputs,
        derived=dict(panel=dict(sha256=sha(b"panel"))),
    )
    path = tmp_path / "curated/slice-09-backtest-freeze.json"
    path.write_text(json.dumps(freeze), encoding="utf-8")
    return path


def output(model_tv, model_seats, b1, b2):
    result = dict(
        baselines={
            name: dict(TV=None if tv is None else number(F(tv)), seat_error=seats)
            for name, (tv, seats) in (("B1", b1), ("B2", b2))
        }
    )
    if model_tv is not None:
        result["TV"] = number(F(model_tv))
    result["seat_error"] = model_seats
    return result


def run(monkeypatch, capsys, tmp_path, canned, stage="development", extra=()):
    freeze = make_freeze(tmp_path)
    cuts = {c["target"]: c for c in REAL["development_cuts"] + [REAL["final_test"]]}

    def fake(ns):
        cut = cuts[ns.pair[1]]
        assert list(ns.pair) == cut["pair"]
        assert ns.train == [y for pair in cut["train"] for y in pair]
        assert ns.panel == str(tmp_path / "panel.json")
        for flag, name in (
            ("rules", "mesa-alignment-rules"),
            ("transfer_recipe", "transfer-recipe"),
            ("forecast_recipe", "forecast-recipe"),
            ("correspondence", "offer-correspondence"),
            ("jeba", "jeba-definitive-totals"),
            ("offer_map", "dine-jeba-offer-map"),
        ):
            assert getattr(ns, flag) == tmp_path / f"curated/slice-09-{name}.json"
        return canned[ns.pair[1]]

    monkeypatch.setattr(relation_forecast, "forecast", fake)
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "x",
            "--freeze",
            str(freeze),
            "--panel",
            str(tmp_path / "panel.json"),
            "--stage",
            stage,
            *extra,
        ],
    )
    code = cli.main()
    captured = capsys.readouterr()
    return code, (json.loads(captured.out) if code == 0 else captured.err)


PASSING = {
    2019: output("1/10", 1, ("15/100", 1), ("2/10", 2)),
    2021: output("1/10", 1, ("14/100", 2), ("2/10", 2)),
    2023: output("1/10", 1, ("16/100", 1), ("2/10", 2)),
}


def test_development_passes_against_globally_best_reference(monkeypatch, capsys, tmp_path):
    code, r = run(monkeypatch, capsys, tmp_path, PASSING)
    assert code == 0
    assert r["reference"] == ["B1"] and r["development_pass"] is True
    gates = r["gates"]["B1"]
    assert gates["mean_tv"] == dict(model="1/10", reference="3/20")
    assert gates["relative"] and gates["absolute"] and gates["majority"] and gates["max_loss"]
    assert gates["seats"] is True and gates["wins"] == 3
    assert [c["target"] for c in r["cuts"]] == [2019, 2021, 2023]
    assert r["panel_sha256"] == sha(b"panel") and len(r["freeze_sha256"]) == 64


@pytest.mark.parametrize(
    "model, reference, failed",
    [
        (["9/100"] * 3, ["10/100"] * 3, {"relative"}),
        (["5/100", "5/100", "20/100"], ["15/100", "15/100", "17/100"], {"max_loss"}),
        (["10/100", "17/100", "17/100"], ["30/100", "16/100", "16/100"], {"majority"}),
        (["4/100"] * 3, ["475/10000"] * 3, {"absolute"}),
        (["85/1000"] * 3, ["10/100"] * 3, set()),
        (["5/100"] * 3, ["6/100"] * 3, set()),
        (["5/100", "5/100", "17/100"], ["15/100"] * 3, set()),
    ],
)
def test_each_tv_gate_fails_alone(monkeypatch, capsys, tmp_path, model, reference, failed):
    canned = {
        t: output(m, 1, (r, 1), ("1", 9)) for t, m, r in zip((2019, 2021, 2023), model, reference)
    }
    code, r = run(monkeypatch, capsys, tmp_path, canned)
    gates = r["gates"]["B1"]
    assert {
        k for k in ("relative", "absolute", "majority", "max_loss", "seats") if not gates[k]
    } == failed
    assert r["development_pass"] is (not failed)


def test_tie_requires_passing_against_both_and_undefined_fails(monkeypatch, capsys, tmp_path):
    canned = {t: output("1/10", 1, ("2/10", 1), ("2/10", 0)) for t in (2019, 2021, 2023)}
    code, r = run(monkeypatch, capsys, tmp_path, canned)
    assert r["reference"] == ["B1", "B2"]
    assert r["gates"]["B1"]["seats"] is True and r["gates"]["B2"]["seats"] is False
    assert r["development_pass"] is False
    canned[2021] = output(None, None, ("2/10", 1), ("3/10", 1))
    code, r = run(monkeypatch, capsys, tmp_path, canned)
    assert code == 0 and r["undefined_cuts"] == [2021]
    assert not any(r["gates"]["B1"][k] for k in ("relative", "absolute", "majority", "seats"))


def write_development(monkeypatch, capsys, tmp_path, canned=PASSING):
    code, r = run(monkeypatch, capsys, tmp_path, canned)
    path = tmp_path / "development.json"
    path.write_text(json.dumps(r), encoding="utf-8")
    return path


@pytest.mark.parametrize(
    "final, validated",
    [
        (output("12/100", 2, ("11/100", 2), ("9/10", 9)), True),
        (output("14/100", 2, ("11/100", 2), ("9/10", 9)), False),
        (output("10/100", 3, ("11/100", 2), ("9/10", 9)), False),
        (output(None, None, ("11/100", 2), ("9/10", 9)), False),
    ],
)
def test_final_confirmation_uses_development_reference(
    monkeypatch, capsys, tmp_path, final, validated
):
    development = write_development(monkeypatch, capsys, tmp_path)
    code, r = run(
        monkeypatch,
        capsys,
        tmp_path,
        {**PASSING, 2025: final},
        "final",
        ["--development", str(development)],
    )
    assert code == 0 and r["target"] == 2025 and r["reference"] == ["B1"]
    assert r["validated"] is validated and r["development_pass"] is True


def test_final_is_not_validated_when_development_failed(monkeypatch, capsys, tmp_path):
    failing = {t: output("1/10", 5, ("15/100", 1), ("2/10", 2)) for t in (2019, 2021, 2023)}
    development = write_development(monkeypatch, capsys, tmp_path, failing)
    final = {**failing, 2025: output("1/10", 1, ("2/10", 1), ("2/10", 1))}
    code, r = run(
        monkeypatch, capsys, tmp_path, final, "final", ["--development", str(development)]
    )
    assert r["confirmation"]["B1"] is True and r["validated"] is False


def test_integrity_errors_stop_before_forecasting(monkeypatch, capsys, tmp_path):
    def never(ns):
        raise AssertionError("forecast must not run")

    make_freeze(tmp_path)
    (tmp_path / "curated/slice-09-transfer-recipe.json").write_bytes(b"changed")
    monkeypatch.setattr(relation_forecast, "forecast", never)
    freeze = tmp_path / "curated/slice-09-backtest-freeze.json"
    for panel, message in ((tmp_path / "panel.json", "frozen file changed"),):
        monkeypatch.setattr(
            sys,
            "argv",
            ["x", "--freeze", str(freeze), "--panel", str(panel), "--stage", "development"],
        )
        assert cli.main() == 2 and message in capsys.readouterr().err
    make_freeze(tmp_path)
    (tmp_path / "panel.json").write_bytes(b"other")
    assert cli.main() == 2 and "panel sha256 mismatch" in capsys.readouterr().err
    (tmp_path / "panel.json").write_bytes(b"panel")
    monkeypatch.setattr(sys, "argv", [*sys.argv[:-1], "final"])
    assert cli.main() == 2 and "--development is required" in capsys.readouterr().err
    stale = tmp_path / "stale.json"
    stale.write_text(json.dumps(dict(freeze_sha256="0" * 64, reference=["B1"])), encoding="utf-8")
    monkeypatch.setattr(sys, "argv", [*sys.argv, "--development", str(stale)])
    assert cli.main() == 2 and "different freeze" in capsys.readouterr().err


def test_undefined_reference_tv_is_an_error(monkeypatch, capsys, tmp_path):
    canned = dict(PASSING)
    canned[2023] = output("1/10", 1, (None, 1), ("2/10", 2))
    code, err = run(monkeypatch, capsys, tmp_path, canned)
    assert code == 2 and "undefined B1 TV for 2023" in err


def test_tied_reference_final_must_confirm_against_both(monkeypatch, capsys, tmp_path):
    tie = {t: output("1/10", 1, ("2/10", 1), ("2/10", 1)) for t in (2019, 2021, 2023)}
    development = write_development(monkeypatch, capsys, tmp_path, tie)
    final = {**tie, 2025: output("12/100", 2, ("11/100", 2), ("5/100", 2))}
    code, r = run(
        monkeypatch, capsys, tmp_path, final, "final", ["--development", str(development)]
    )
    assert r["reference"] == ["B1", "B2"] and r["development_pass"] is True
    assert r["confirmation"] == dict(B1=True, B2=False) and r["validated"] is False


def test_final_rejects_development_result_that_does_not_reproduce(monkeypatch, capsys, tmp_path):
    development = write_development(monkeypatch, capsys, tmp_path)
    tampered = json.loads(development.read_text(encoding="utf-8"))
    tampered["development_pass"] = False
    development.write_text(json.dumps(tampered), encoding="utf-8")
    code, err = run(
        monkeypatch,
        capsys,
        tmp_path,
        {**PASSING, 2025: PASSING[2023]},
        "final",
        ["--development", str(development)],
    )
    assert code == 2 and "does not reproduce" in err


def test_development_stage_rejects_development_option(monkeypatch, capsys, tmp_path):
    code, err = run(monkeypatch, capsys, tmp_path, PASSING, extra=["--development", "stale.json"])
    assert code == 2 and "--development is only valid for the final stage" in err


def test_style_amendment_rehashes_frozen_code_only_when_bound_to_the_freeze(
    monkeypatch, capsys, tmp_path
):
    freeze_path = make_freeze(tmp_path)
    code = tmp_path / "etl/etl/m.py"
    code.parent.mkdir(parents=True)
    code.write_bytes(b"x=1\n")
    freeze = json.loads(freeze_path.read_text(encoding="utf-8"))
    freeze["code"]["files"] = {"etl/etl/m.py": sha(b"x=1\n")}
    freeze_path.write_text(json.dumps(freeze), encoding="utf-8")
    code.write_bytes(b"x = 1\n")
    monkeypatch.setattr(relation_forecast, "forecast", lambda ns: PASSING[ns.pair[1]])
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "x",
            "--freeze",
            str(freeze_path),
            "--panel",
            str(tmp_path / "panel.json"),
            "--stage",
            "development",
        ],
    )
    assert cli.main() == 2 and "frozen file changed: etl/etl/m.py" in capsys.readouterr().err
    amendment = tmp_path / "curated/slice-09-backtest-freeze-amendment-1.json"

    def amend(original, freeze_sha=None):
        amendment.write_text(
            json.dumps(
                dict(
                    schema_version=1,
                    freeze_sha256=freeze_sha or sha(freeze_path.read_bytes()),
                    code_files={
                        "etl/etl/m.py": dict(
                            original_sha256=original, amended_sha256=sha(b"x = 1\n")
                        )
                    },
                )
            ),
            encoding="utf-8",
        )

    amend(sha(b"x=1\n"))
    assert cli.main() == 0 and json.loads(capsys.readouterr().out)["development_pass"] is True
    amend(sha(b"other"))
    assert cli.main() == 2 and "amendment does not match the freeze" in capsys.readouterr().err
    amend(sha(b"x=1\n"), freeze_sha="0" * 64)
    assert cli.main() == 2 and "amendment does not match the freeze" in capsys.readouterr().err
