"""Slice 10 scenario artifact, generated through its CLI from the committed inputs."""

import hashlib
import json
import sys
from fractions import Fraction
from pathlib import Path

from etl import scenario_artifact as cli

ROOT = Path(__file__).resolve().parents[2]
INPUTS = {
    "--jeba": ROOT / "curated/slice-09-jeba-definitive-totals.json",
    "--scenario": ROOT / "curated/slice-09-scenario-2027.json",
    "--backtest-development": ROOT / "docs/research/slice-09-backtest-development.json",
    "--backtest-final": ROOT / "docs/research/slice-09-backtest-final.json",
}


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def run(monkeypatch, capsys, output_dir, **overrides):
    args = ["x"]
    for flag, path in {**INPUTS, **overrides}.items():
        args += [flag, str(path)]
    monkeypatch.setattr(sys, "argv", [*args, "--output-dir", str(output_dir)])
    code = cli.main()
    captured = capsys.readouterr()
    return code, (json.loads(captured.out) if code == 0 else captured.err)


def test_artifact_is_content_addressed_and_deterministic(monkeypatch, capsys, tmp_path):
    code, meta = run(monkeypatch, capsys, tmp_path)
    assert code == 0
    path = tmp_path / meta["filename"]
    assert meta["filename"] == f"rosales-concejales-2027.{meta['sha256']}.json"
    assert sha(path) == meta["sha256"] and path.stat().st_size == meta["bytes"]
    first = path.read_bytes()
    code, again = run(monkeypatch, capsys, tmp_path)
    assert code == 0 and again == meta and path.read_bytes() == first
    path.write_bytes(first.replace(b"2027", b"2031", 1))
    code, err = run(monkeypatch, capsys, tmp_path)
    assert code == 2 and "existing artifact content mismatch" in err


def test_artifact_carries_unvalidated_status_scenarios_and_provenance(
    monkeypatch, capsys, tmp_path
):
    code, meta = run(monkeypatch, capsys, tmp_path)
    artifact = json.loads((tmp_path / meta["filename"]).read_text(encoding="utf-8"))
    assert artifact["kind"] == "votus.scenario-artifact" and artifact["schema_version"] == 1
    assert artifact["territory"] == {"pba_distrito": "027", "name": "Coronel Rosales"}
    assert (artifact["category"], artifact["base_year"], artifact["target_year"]) == (
        "CONCEJALES",
        2025,
        2027,
    )
    assert artifact["status"]["validated"] is False
    assert artifact["status"]["label"] == "supuestos sin validar"
    assert artifact["default_scenario"] == "persistencia"
    assert [s["id"] for s in artifact["scenarios"]] == ["persistencia", "transferencias_ei"]
    for scenario in artifact["scenarios"]:
        rows = scenario["lists"]
        assert scenario["seat_status"] == "allocated" and scenario["total_seats"] == 9
        assert sum(row["seats"] for row in rows) == 9
        assert sum(Fraction(row["share_exact"]) for row in rows) == 1
        assert [row["seats"] for row in rows] == sorted((r["seats"] for r in rows), reverse=True)
    persistence = {r["list_id"]: r for r in artifact["scenarios"][0]["lists"]}
    assert persistence["2206"]["label"] == "ALIANZA LA LIBERTAD AVANZA"
    assert persistence["2206"]["share_exact"] == "14550/32291"
    assert persistence["2206"]["share_percent"] == "45.06"
    assert {k: r["seats"] for k, r in persistence.items() if r["seats"]} == {
        "2206": 5,
        "2200": 2,
        "2201": 2,
    }
    ei = artifact["scenarios"][1]
    declared = json.loads(INPUTS["--scenario"].read_text())["scenarios"]["transferencias_ei"]
    for kind, rates in declared["rates"].items():
        for field, value in rates.items():
            assert Fraction(ei["assumptions"]["rates"][kind][field]) == Fraction(value)
    backtest = artifact["backtest"]
    assert backtest["reference"] == "B1" and backtest["development_pass"] is False
    assert backtest["development_mean_tv_pp"] == {"model": "21.074", "reference": "17.245"}
    assert backtest["final_tv_pp"] == {"model": "22.557", "reference": "24.079"}
    sources = artifact["provenance"]["sources"]
    for flag, key in (
        ("--jeba", "jeba_totals"),
        ("--scenario", "scenario"),
        ("--backtest-development", "backtest_development"),
        ("--backtest-final", "backtest_final"),
    ):
        assert sources[key] == {
            "path": str(INPUTS[flag].relative_to(ROOT)),
            "sha256": sha(INPUTS[flag]),
        }


def test_mismatched_backtest_files_are_refused(monkeypatch, capsys, tmp_path):
    other = tmp_path / "development.json"
    other.write_text("{}", encoding="utf-8")
    code, err = run(monkeypatch, capsys, tmp_path / "out", **{"--backtest-development": other})
    assert code == 2 and "development result" in err
    assert not (tmp_path / "out").exists()


def test_committed_web_artifact_matches_regeneration(monkeypatch, capsys, tmp_path):
    committed = sorted((ROOT / "apps/web/data/scenarios").glob("rosales-concejales-2027.*.json"))
    code, meta = run(monkeypatch, capsys, tmp_path)
    assert code == 0 and [p.name for p in committed] == [meta["filename"]]
    assert committed[0].read_bytes() == (tmp_path / meta["filename"]).read_bytes()
