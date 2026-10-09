"""Arithmetic between verified published versions, without selecting a winner."""

from collections import Counter

FIELDS = (
    "positive_votes",
    "blank_votes",
    "null_votes",
    "total_votes",
    "total_electors",
    "total_mesas",
    "counted_mesas",
)
HTML_ID = "pba/2025-distrito-027"
PILOT_PROTOCOL = {
    "id": "slice09-point-pilot-v1",
    "status": "approved",
    "approved_at": "2026-10-01T18:29:00Z",
    "metric": "half_sum_absolute_percentage_share_error",
    "mean_aggregation": "unweighted_by_election",
    "mean_error_max_pp": 5,
    "worst_error_max_pp": 10,
    "improvement_min_percent": 10,
    "improvement_min_pp": 0.5,
    "initial_elections": 3,
    "minimum_valid_tests": 3,
    "benchmarks": ["last_election_persistence", "last_same_type_persistence"],
    "benchmark_selection": "lower_global_mean_on_same_origins",
    "scope": "experimental_pilot",
    "roster": "explicit_hypothetical_scenario",
    "source_validation_outcome_exposure": "disclosed",
    "alliance_policy": {
        "status": "approved",
        "approved_at": "2026-10-01T21:49:00Z",
        "approval_message": "Sentinel_a287e668c3d0819183d6d080cc76bc0d",
        "continuity": "documented_before_origin",
        "fusion": "sum_distinct_documented_antecedents",
        "split": "no_invented_vote_allocation",
        "residual": "documented_nonparticipation_observed_zero",
        "unmapped": "unresolved_not_nonparticipation",
        "new_list_forecast": "zero_only_for_verified_new_identity",
        "observed_lists": "individual_coordinates_never_pooled",
    },
    "candidate": {
        "id": "mean_last_three",
        "window": 3,
        "weighting": "equal_by_election",
        "frozen_before_scores_at": "2026-10-01T21:57:16Z",
        "alignment": "same_approved_policy_as_benchmarks",
        "retuning": "none",
        "source_validation_outcome_exposure": "disclosed",
    },
}


def _source(sources, source_id):
    matches = [item for item in sources if item["source_id"] == source_id]
    return matches[0] if len(matches) == 1 else None


def _extraction(source):
    if (
        source is not None
        and source["status"] == "extracted"
        and source["digest"]["verified"]
        and source["source_kind"] == "official"
    ):
        return source["extraction"]
    return None


def _field(source, field):
    extraction = _extraction(source)
    return extraction["fields"].get(field) if extraction else None


def _status(values, *, components=False):
    if any(value is None for value in values):
        return "unknown"
    expected = sum(values[1:]) if components else values[1]
    return "matched" if values[0] == expected else "conflict"


def _rows(source):
    extraction = _extraction(source)
    if extraction is None:
        return None, "source_unavailable"
    rows = extraction["list_rows"]
    if extraction["unparsed_table_rows"]:
        return None, "table_rows_unparsed"
    if not rows:
        return None, "list_table_empty"
    if len({row["list_id"] for row in rows}) != len(rows):
        return None, "list_id_repeated"
    # PDF category remains a separate semantic gate. HTML must name the column.
    if source["source_id"].startswith(HTML_ID) and extraction["category"] != "CONCEJALES":
        return None, "html_category_unverified"
    return {row["list_id"]: row["printed_votes"] for row in rows}, None


def _lists(named_sources, *, components=False):
    parsed = {name: _rows(source) for name, source in named_sources.items()}
    failures = {name: reason for name, (_, reason) in parsed.items() if reason}
    if failures:
        return {"status": "unknown", "reasons_by_source": failures, "rows": []}
    names = tuple(named_sources)
    maps = [parsed[name][0] for name in names]
    identities = [set(rows) for rows in maps]
    if any(ids != identities[0] for ids in identities[1:]):
        return {
            "status": "unknown",
            "reason": "list_identity_sets_differ",
            "list_ids_by_source": {name: sorted(rows) for name, rows in zip(names, maps)},
            "rows": [],
        }
    comparisons = []
    for list_id in sorted(identities[0]):
        values = [rows[list_id] for rows in maps]
        comparisons.append(
            {
                "list_id": list_id,
                "status": _status(values, components=components),
                **dict(zip(names, values)),
            }
        )
    return {
        "status": "conflict"
        if any(row["status"] == "conflict" for row in comparisons)
        else "matched",
        "rows": comparisons,
    }


def _positive_denominator(source):
    rows, reason = _rows(source)
    positive = _field(source, "positive_votes")
    if reason or positive is None:
        return {
            "status": "unknown",
            "reason": reason or "positive_votes_unknown",
            "printed_positive_votes": positive,
            "list_vote_sum": None,
        }
    total = sum(rows.values())
    return {
        "status": "matched" if total == positive else "conflict",
        "printed_positive_votes": positive,
        "list_vote_sum": total,
    }


def _pilot_eligibility(pdf_sources):
    """Report the current documentary ledger before considering scores.

    The initial six-year cohort remains pending review. New dated official
    evidence has reopened its documentary assessment; a joint municipal report
    and a declared territory assumption are not automatic exclusion criteria.
    Report each pending origin without treating it as a validated forecast.
    This is not an automatic validator of history, availability or alliances;
    the missing support is established by the separately reviewed evidence ledger.
    The extractor's non-acceptance flag is not independent proof of those gaps.
    """
    origins = []
    counts = Counter()
    for target, last, same_type in ((2021, 2019, 2017), (2023, 2021, 2019), (2025, 2023, 2021)):
        relevant = [source for source in pdf_sources if 2015 <= source["year"] <= target]
        unaccepted = sorted(
            source["year"] for source in relevant if not source["council_series_accepted"]
        )
        reasons = ["origin_available_series_review_pending", "list_crosswalk_unverified"]
        if unaccepted:
            reasons.append("historical_source_series_not_accepted")
        if len(relevant) != (target - 2015) // 2 + 1 or any(
            _extraction(source) is None for source in relevant
        ):
            reasons.append("source_artifact_unavailable")
        origins.append(
            {
                "target_year": target,
                "last_election": last,
                "last_same_type": same_type,
                "prior_years": sorted(
                    source["year"] for source in relevant if source["year"] < target
                ),
                "status": "review_pending",
                "unaccepted_source_years": unaccepted,
                "reasons": sorted(reasons),
                "scores": None,
            }
        )
        counts.update(reasons)
    return {
        "basis": "documented_current_evidence_ledger",
        "automatic_historical_validation": False,
        "review_status": "reopened_with_additional_documentary_evidence",
        "candidate_count": len(origins),
        "eligible_count": 0,
        "origins": origins,
        "reasons_by_origin_count": dict(sorted(counts.items())),
    }


def compare_evidence(pdf_sources, html_sources):
    pdf = _source(pdf_sources, "pba/2025-resultados-027")
    html = _source(html_sources, HTML_ID)
    argentinos = _source(html_sources, HTML_ID + "-argentinos")
    extranjeros = _source(html_sources, HTML_ID + "-extranjeros")
    pair = {"pdf": pdf, "html": html}
    components = {"integrated": html, "argentinos": argentinos, "extranjeros": extranjeros}
    pair_fields, component_fields = {}, {}
    for key in FIELDS:
        values = {name: _field(source, key) for name, source in pair.items()}
        pair_fields[key] = {"status": _status(tuple(values.values())), **values}
        values = {name: _field(source, key) for name, source in components.items()}
        component_fields[key] = {
            "status": _status(tuple(values.values()), components=True),
            **values,
        }
    pdf_mesas, html_mesas = _field(pdf, "total_mesas"), _field(html, "total_mesas")
    argentinos_mesas = _field(argentinos, "total_mesas")
    coverage = {
        "status": _status((pdf_mesas, html_mesas)),
        "cause": "unverified",
        "pdf_total_mesas": pdf_mesas,
        "html_total_mesas": html_mesas,
        "html_counted_mesas": _field(html, "counted_mesas"),
        "argentinos_total_mesas": argentinos_mesas,
        "extranjeros_total_mesas": _field(extranjeros, "total_mesas"),
        "pdf_matches_argentinos_mesas": (
            None if pdf_mesas is None or argentinos_mesas is None else pdf_mesas == argentinos_mesas
        ),
    }
    comparison = {
        "pdf_integrated": {"fields": pair_fields, "list_counts": _lists(pair)},
        "components": {
            "fields": component_fields,
            "list_counts": _lists(components, components=True),
        },
        "positive_denominators": {
            name: _positive_denominator(source) for name, source in {**pair, **components}.items()
        },
        "coverage": coverage,
        "field_provenance": {
            source["source_id"]: {
                "digest": source["digest"],
                "provenance": source["provenance"],
                "field_evidence": (_extraction(source) or {}).get("field_evidence", []),
            }
            for source in (pdf, html, argentinos, extranjeros)
            if source is not None
        },
    }
    eligibility = _pilot_eligibility(pdf_sources)
    suitability = {
        "status": "evidence_review_in_progress",
        "forecast_ready": False,
        "model_evaluated": False,
        "target_type": "point_share_vector",
        "protocol": dict(PILOT_PROTOCOL),
        "eligibility": eligibility,
        "target": {
            "year": 2027,
            "category": "CONCEJALES",
            "jurisdiction": "02/027",
            "denominator": "full_positive_votes",
            "scenario_roster": "required",
        },
        "gates": {
            "historical_category_and_round": "documentary_review_pending",
            "list_crosswalk": "unverified",
            "territory_continuity": "identity_and_stability_assumption_review_pending",
            "origin_specific_availability": "dated_evidence_review_pending",
            "temporal_evaluation": "not_performed_review_pending",
            "benchmark_acceptance": "approved_eligibility_unverified",
            "error_budget": "approved",
            "temporal_adequacy_criterion": "approved_eligibility_unverified",
            "coverage_reconciliation": coverage["status"],
        },
        "probabilistic_scoring": "not_applicable_to_point_target",
    }
    return comparison, suitability
