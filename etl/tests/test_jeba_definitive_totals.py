"""Offline contract for curated JEBA evidence; archives are not test inputs."""

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TOTALS = {"positivos", "blancos", "nulos", "total_published", "electores", "mesas"}


def test_jeba_definitive_totals_contract():
    data = json.loads((ROOT / "curated/slice-09-jeba-definitive-totals.json").read_text())
    records = {
        r["id"]: r for r in json.loads((ROOT / "archive-manifest.json").read_text())["records"]
    }
    assert data["schema_version"] == 1
    assert data["jurisdiction"] == {
        "jeba_distrito": "027",
        "dine_distrito": "02",
        "dine_seccion": "027",
    }
    assert [e["year"] for e in data["elections"]] == list(range(2015, 2026, 2))
    for election in data["elections"]:
        assert election["scope"] == "definitive"
        entries = [election, *election.get("components", {}).values()]
        for entry in entries:
            source = entry["source"]
            assert set(source) == {"id", "url", "archived_path", "sha256", "page"}
            assert re.fullmatch(r"[0-9a-f]{64}", source["sha256"])
            record = records[source["id"]]
            assert source["sha256"] == record["sha256"]
            assert source["url"] == record["source_url"]
            assert source["archived_path"] == record["archived_path"]
            assert set(entry["totals"]) == TOTALS
            assert set(entry["unknown_fields"]) == {
                k for k, v in entry["totals"].items() if v is None
            }
            for field in entry["unknown_fields"]:
                assert entry["totals"][field] is None
                assert entry["totals"][field] != 0
            assert entry["offers"]
            for offer in entry["offers"]:
                assert set(offer) == {"list_id", "label", "votes"}
                assert isinstance(offer["list_id"], str)
                assert isinstance(offer["label"], str) and offer["label"]
                assert type(offer["votes"]) is int and offer["votes"] >= 0
            total = sum(o["votes"] for o in entry["offers"])
            assert entry["checks"]["offers_sum"] == total
            assert entry["checks"]["offers_sum_equals_positivos"] is (
                total == entry["totals"]["positivos"]
            )
            assert "category_label_as_printed" in entry
            if entry["category_label_as_printed"] is None:
                assert entry["category_basis"]
            assert set(entry["extraction"]) == {"reader", "command", "notes"}
            assert all(entry["extraction"].values())
    latest = data["elections"][-1]
    assert set(latest["components"]) == {"argentinos", "extranjeros"}
    assert latest["discrepancies"] == [
        {
            "field": "mesas",
            "pdf": 154,
            "html_combined": 156,
            "argentinos": 154,
            "extranjeros": 2,
            "status": "unresolved",
        }
    ]
    assert latest["totals"]["mesas"] == 154
    assert latest["components"]["argentinos"]["totals"]["mesas"] == 154
    assert latest["components"]["extranjeros"]["totals"]["mesas"] == 2
