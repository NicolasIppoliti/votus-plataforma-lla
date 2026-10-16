"""Synthetic-only checks for the #482 measurement-local counterfactual."""

import json
import runpy
from dataclasses import asdict
from pathlib import Path
from types import SimpleNamespace

import pytest
from test_national_preflight import COMPANION, source

from etl.ingest import national
from etl.ingest_metrics import IngestMetrics

RUNNER = Path(__file__).resolve().parents[2] / "docs/research/national-preflight-benchmark.py"


@pytest.mark.parametrize("companion", [None, COMPANION])
def test_forced_sweep_changes_work_not_ordered_rows_or_accounting(monkeypatch, companion):
    measured_iterator = runpy.run_path(str(RUNNER))["measured_iterator"]
    original = national._companion_key_from_natural_key
    calls = []

    def counted(key):
        calls.append(key)
        return original(key)

    monkeypatch.setattr(national, "_companion_key_from_natural_key", counted)
    outputs = []
    for variant in ("on", "off"):
        metrics = IngestMetrics()
        rows = list(
            measured_iterator(variant)(
                source({}, {"mesa_id": "2"}),
                archive_entry_id="national/482-synthetic",
                election_year=2025,
                election_round="legislativas",
                establecimientos_csv_bytes=companion,
                metrics=metrics,
            )
        )
        outputs.append(([asdict(row) for row in rows], metrics.data))
        assert len(calls) == (0 if variant == "on" else 2)
    assert outputs[0] == outputs[1]
    assert national.iter_national_rows is measured_iterator("on")


def test_child_fingerprints_include_reason_category_and_status(monkeypatch, capsys):
    runner = runpy.run_path(str(RUNNER))
    monkeypatch.setattr(Path, "open", lambda *a, **k: source({}, {"mesa_id": "2"}, {}))
    outputs = []
    for variant in ("on", "off"):
        runner["child"](
            SimpleNamespace(
                fast_path=variant,
                companion=None,
                fingerprint=True,
                member="synthetic.csv",
                source="national/482-synthetic",
                year=2025,
                round="legislativas",
            )
        )
        outputs.append(json.loads(capsys.readouterr().out))
    assert outputs[0] == outputs[1]
    for key in (
        "ordered_rows_sha256",
        "completeness_sha256",
        "status_sha256",
        "exclusions_sha256",
        "quarantine_sha256",
        "completeness_status_sha256",
    ):
        assert len(outputs[0][key]) == 64
    assert outputs[0]["exclusion_breakdown"]["ambiguous_categories"]
    assert outputs[0]["exclusion_breakdown"]["categories"]


def test_disk_guard_refuses_below_two_gib(monkeypatch):
    runner = runpy.run_path(str(RUNNER))
    monkeypatch.setattr(
        runner["shutil"], "disk_usage", lambda path: SimpleNamespace(free=2 * 1024**3 - 1)
    )
    with pytest.raises(RuntimeError, match="disk"):
        runner["check_disk"]()


def test_guard_drift_is_refused(monkeypatch):
    runner = runpy.run_path(str(RUNNER))
    monkeypatch.setattr(runner["inspect"], "getsource", lambda function: "def changed(): pass")
    with pytest.raises(RuntimeError, match="sweep guard changed"):
        runner["measured_iterator"]("off")
