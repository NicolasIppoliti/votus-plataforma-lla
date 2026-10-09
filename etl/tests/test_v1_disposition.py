"""Slice 9 v1 ideology experiment code is retired; its disposition stays documented."""

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RETIRED = (
    "etl/etl/pba_ideology_experiment.py",
    "etl/tests/test_cli_pba_ideology_experiment.py",
    "etl/tests/fixtures/ideology_v1_public_cases.json",
)
DISPOSITION = ROOT / "docs/research/slice-09-v1-disposition.md"


def test_v1_code_is_gone_and_unreferenced():
    for path in RETIRED:
        assert not (ROOT / path).exists(), path
    for source in (ROOT / "etl").rglob("*.py"):
        if source.name != Path(__file__).name:
            text = source.read_text(encoding="utf-8")
            assert (
                "pba_ideology_experiment" not in text and "ideology_v1_public_cases" not in text
            ), source


def test_disposition_names_every_retired_path_and_its_recovery_commit():
    text = DISPOSITION.read_text(encoding="utf-8")
    for path in RETIRED:
        assert f"`{path}`" in text
    assert "git show cfbb91c:" in text
    for doc in ("method", "source-dossier", "evidence-status-report"):
        banner = (ROOT / f"docs/research/slice-09-ideology-v1-{doc}.md").read_text(encoding="utf-8")
        assert "slice-09-v1-disposition.md" in banner.split("\n\n", 2)[1], doc
