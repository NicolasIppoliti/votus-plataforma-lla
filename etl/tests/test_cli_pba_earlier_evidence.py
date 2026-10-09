"""Additional historical references through the production CLI and SHA boundary."""

import json

from test_cli_pba_pdf_evidence import YEARS
from test_cli_pba_pdf_evidence import archive_case as _archive_case

from etl.__main__ import main

archive_case = _archive_case


def test_real_main_earlier_references_are_explicit_and_failures_are_counted(
    archive_case,
    capsys,
):
    args, _, _, _, _ = archive_case
    assert main(args) == 1
    default = json.loads(capsys.readouterr().out)
    assert [item["year"] for item in default["sources"]] == list(YEARS)

    assert main([*args, "--include-earlier"]) == 1
    output = capsys.readouterr()
    assert output.err == ""
    report = json.loads(output.out)
    assert [item["year"] for item in report["sources"]] == [2011, 2013, *YEARS]
    assert [item["status"] for item in report["sources"][:2]] == [
        "registry_source_missing",
        "registry_source_missing",
    ]
    assert report["failure_counts"] == {
        "registry_source_missing": 2,
        "manifest_record_missing": 5,
    }
    assert report["historical_reference_scope"] == {
        "additional_years": [2011, 2013],
        "current_pilot_years": list(YEARS),
        "expanded_pilot_review": "pending",
    }


def test_real_main_additional_missing_references_do_not_change_current_pilot_cohort(
    archive_case,
    capsys,
):
    args, manifest, _, record, _ = archive_case
    records = [
        {
            **record,
            "id": f"pba/{year}-resultados-027",
            "election_year": year,
            "source_url": f"https://example.invalid/{year}.pdf",
        }
        for year in YEARS
    ]
    manifest.write_text(json.dumps(records))

    assert main([*args, "--include-html", "--include-earlier"]) == 1
    report = json.loads(capsys.readouterr().out)
    origins = report["suitability"]["eligibility"]["origins"]
    assert [origin["target_year"] for origin in origins] == [2021, 2023, 2025]
    for origin in origins:
        assert min(origin["prior_years"]) == 2015
        assert "source_artifact_unavailable" not in origin["reasons"]
        assert origin["scores"] is None
    assert report["suitability"]["model_evaluated"] is False


def test_real_main_reports_reopened_documentary_review_before_any_scores(
    archive_case,
    capsys,
):
    args, _, _, _, _ = archive_case
    assert main([*args, "--include-html", "--include-earlier"]) == 1
    suitability = json.loads(capsys.readouterr().out)["suitability"]
    assert suitability["status"] == "evidence_review_in_progress"
    assert suitability["forecast_ready"] is False and suitability["model_evaluated"] is False
    eligibility = suitability["eligibility"]
    assert eligibility["review_status"] == "reopened_with_additional_documentary_evidence"
    for origin in eligibility["origins"]:
        assert origin["status"] == "review_pending" and origin["scores"] is None
        assert "territory_continuity_unverified" not in origin["reasons"]
        assert "origin_availability_unverified" not in origin["reasons"]
        assert "origin_available_series_review_pending" in origin["reasons"]
    assert suitability["gates"]["historical_category_and_round"] == "documentary_review_pending"
    assert suitability["gates"]["territory_continuity"] == (
        "identity_and_stability_assumption_review_pending"
    )
    assert suitability["gates"]["origin_specific_availability"] == "dated_evidence_review_pending"


def test_real_main_records_refined_policy_and_fixed_candidate_before_scores(
    archive_case,
    capsys,
):
    args, _, _, _, _ = archive_case
    assert main([*args, "--include-html", "--include-earlier"]) == 1
    protocol = json.loads(capsys.readouterr().out)["suitability"]["protocol"]
    policy = protocol["alliance_policy"]
    assert policy["status"] == "approved" and policy["approved_at"] == "2026-10-01T21:49:00Z"
    assert policy["approval_message"] == "Sentinel_a287e668c3d0819183d6d080cc76bc0d"
    assert policy["continuity"] == "documented_before_origin"
    assert policy["fusion"] == "sum_distinct_documented_antecedents"
    assert policy["split"] == "no_invented_vote_allocation"
    assert policy["residual"] == "documented_nonparticipation_observed_zero"
    assert policy["unmapped"] == "unresolved_not_nonparticipation"
    assert policy["new_list_forecast"] == "zero_only_for_verified_new_identity"
    assert policy["observed_lists"] == "individual_coordinates_never_pooled"
    assert protocol["candidate"] == {
        "id": "mean_last_three",
        "window": 3,
        "weighting": "equal_by_election",
        "frozen_before_scores_at": "2026-10-01T21:57:16Z",
        "alignment": "same_approved_policy_as_benchmarks",
        "retuning": "none",
        "source_validation_outcome_exposure": "disclosed",
    }
