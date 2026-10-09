"""Source-specific arithmetic must not repair unresolved council evidence."""

import hashlib
import json
from pathlib import Path

import pytest
import yaml
from test_cli_pba_html_evidence import HTML_ID, html_bytes, report_html
from test_cli_pba_html_evidence import html_case as html_case


def replace_source(args, source_id, data):
    registry, manifest = Path(args[1]), Path(args[5])
    sources = yaml.safe_load(registry.read_text())
    records = json.loads(manifest.read_text())
    record = next(item for item in records if item["id"] == source_id)
    (Path(args[3]) / record["archived_path"]).write_bytes(data)
    digest = hashlib.sha256(data).hexdigest()
    record["sha256"] = digest
    next(item for item in sources["pba"] if item["id"] == source_id)["expected_sha256"] = digest
    registry.write_text(yaml.safe_dump(sources))
    manifest.write_text(json.dumps(records))


def component_case(html_case):
    args, _ = html_case
    for suffix, replacements in (
        (
            "argentinos",
            {
                "52.755": "52.104",
                "156": "154",
                "20.000": "19.900",
                "12.291": "12.284",
                "32.291": "32.184",
                "2.150": "2.133",
                "34.441": "34.317",
            },
        ),
        (
            "extranjeros",
            {
                "52.755": "651",
                "156": "2",
                "20.000": "100",
                "12.291": "7",
                "32.291": "107",
                "2.150": "17",
                "34.441": "124",
            },
        ),
    ):
        data = html_bytes().decode()
        for before, after in replacements.items():
            data = data.replace(before, after)
        replace_source(args, f"{HTML_ID}-{suffix}", data.encode())
    return html_case


def test_real_main_reconciles_components_without_repairing_pdf_mesas(html_case, capsys):
    _, report = report_html(component_case(html_case), capsys)
    assert report["failure_counts"] == {}
    reconciliation = report["reconciliation"]
    for key in (
        "positive_votes",
        "blank_votes",
        "total_votes",
        "total_electors",
        "total_mesas",
        "counted_mesas",
    ):
        field = reconciliation["components"]["fields"][key]
        assert field["status"] == "matched"
        assert field["integrated"] == field["argentinos"] + field["extranjeros"]
    pdf = reconciliation["pdf_integrated"]
    for key in ("positive_votes", "blank_votes", "total_votes", "total_electors"):
        assert pdf["fields"][key]["status"] == "matched"
    assert pdf["fields"]["total_mesas"] == {
        "status": "conflict",
        "pdf": 154,
        "html": 156,
    }
    assert pdf["fields"]["null_votes"] == {
        "status": "unknown",
        "pdf": None,
        "html": None,
    }
    assert pdf["list_counts"]["status"] == "matched"
    assert reconciliation["components"]["list_counts"]["status"] == "matched"
    coverage = reconciliation["coverage"]
    assert coverage["status"] == "conflict" and coverage["cause"] == "unverified"
    assert coverage["pdf_matches_argentinos_mesas"] is True
    assert report["sources"][-1]["coverage_comparison"]["html_verified_by_command"] is True
    assert all(not item["council_series_accepted"] for item in report["sources"])
    assert report["suitability"]["status"] == "evidence_review_in_progress"
    assert report["suitability"]["forecast_ready"] is False
    assert report["suitability"]["target_type"] == "point_share_vector"


def test_real_main_keeps_component_disagreement_and_source_field_provenance(html_case, capsys):
    case = component_case(html_case)
    args, _ = case
    replace_source(args, f"{HTML_ID}-extranjeros", html_bytes().replace(b"32.291", b"108"))
    _, report = report_html(case, capsys)
    field = report["reconciliation"]["components"]["fields"]["positive_votes"]
    assert field["status"] == "conflict" and field["extranjeros"] == 108
    for source in report["html_sources"]:
        assert source["digest"]["verified"] is True
        assert source["provenance"]["archive_url"] == source["provenance"]["registered_url"]
        assert all(e["location"] for e in source["extraction"]["field_evidence"])
    assert report["reconciliation"]["coverage"]["cause"] == "unverified"


@pytest.mark.parametrize("missing", ["registry", "manifest"])
def test_real_main_missing_component_stays_unknown_not_zero(html_case, capsys, missing):
    case = component_case(html_case)
    args, _ = case
    source_id = f"{HTML_ID}-extranjeros"
    if missing == "registry":
        registry = Path(args[1])
        sources = yaml.safe_load(registry.read_text())
        sources["pba"] = [item for item in sources["pba"] if item["id"] != source_id]
        registry.write_text(yaml.safe_dump(sources))
    else:
        manifest = Path(args[5])
        records = json.loads(manifest.read_text())
        manifest.write_text(json.dumps([item for item in records if item["id"] != source_id]))
    _, report = report_html(case, capsys)
    field = report["reconciliation"]["components"]["fields"]["positive_votes"]
    assert field["status"] == "unknown" and field["extranjeros"] is None
    assert report["failure_counts"]
    assert report["suitability"]["forecast_ready"] is False


def test_real_main_reads_protected_legacy_html_without_rewriting_manifest(html_case, capsys):
    args, _ = html_case
    manifest = Path(args[5])
    records = json.loads(manifest.read_text())
    integrated = next(item for item in records if item["id"] == HTML_ID)
    missing = ["election_year", "election_round", "source_kind"]
    for field in missing:
        integrated.pop(field)
    manifest.write_text(json.dumps(records))
    before = manifest.read_bytes()
    item, report = report_html(html_case, capsys)
    assert item["status"] == "extracted" and item["digest"]["verified"] is True
    assert item["provenance"]["missing_manifest_identity_fields"] == missing
    assert all(f"manifest_provenance_missing:{field}" in item["uncertainties"] for field in missing)
    assert item["source_kind"] == "official"
    assert item["extraction"]["fields"]["total_mesas"] == 156
    assert manifest.read_bytes() == before
    assert report["suitability"]["forecast_ready"] is False


@pytest.mark.parametrize("source_id", [HTML_ID, HTML_ID + "-argentinos"])
def test_real_main_never_relaxes_present_or_component_identity(html_case, capsys, source_id):
    args, _ = html_case
    manifest = Path(args[5])
    records = json.loads(manifest.read_text())
    record = next(item for item in records if item["id"] == source_id)
    if source_id == HTML_ID:
        record["source_kind"] = "fiscalizacion"
        expected = "archive_provenance_mismatch:source_kind"
    else:
        record.pop("election_year")
        expected = "manifest_provenance_missing:election_year"
    manifest.write_text(json.dumps(records))
    _, report = report_html(html_case, capsys)
    item = next(item for item in report["html_sources"] if item["source_id"] == source_id)
    assert item["status"] == expected
    assert item["extraction"] is None and item["digest"]["verified"] is False


def test_real_main_applies_approved_protocol_without_scoring_unaccepted_periods(html_case, capsys):
    _, report = report_html(component_case(html_case), capsys)
    suitability = report["suitability"]
    protocol = suitability["protocol"]
    assert protocol["id"] == "slice09-point-pilot-v1" and protocol["status"] == "approved"
    assert protocol["mean_error_max_pp"] == 5
    assert protocol["worst_error_max_pp"] == 10
    assert protocol["improvement_min_percent"] == 10
    assert protocol["improvement_min_pp"] == 0.5
    assert protocol["initial_elections"] == protocol["minimum_valid_tests"] == 3
    assert protocol["benchmark_selection"] == "lower_global_mean_on_same_origins"
    eligibility = suitability["eligibility"]
    assert eligibility["basis"] == "documented_current_evidence_ledger"
    assert eligibility["automatic_historical_validation"] is False
    assert eligibility["eligible_count"] == 0 and eligibility["candidate_count"] == 3
    assert [origin["target_year"] for origin in eligibility["origins"]] == [2021, 2023, 2025]
    assert [
        (origin["last_election"], origin["last_same_type"]) for origin in eligibility["origins"]
    ] == [(2019, 2017), (2021, 2019), (2023, 2021)]
    assert all(
        origin["status"] == "review_pending" and origin["scores"] is None
        for origin in eligibility["origins"]
    )
    assert eligibility["reasons_by_origin_count"]["historical_source_series_not_accepted"] == 3
    assert eligibility["reasons_by_origin_count"]["origin_available_series_review_pending"] == 3
    assert eligibility["reasons_by_origin_count"]["list_crosswalk_unverified"] == 3
    assert suitability["status"] == "evidence_review_in_progress"
    assert suitability["forecast_ready"] is False and suitability["model_evaluated"] is False
