"""RED tests for the empirical mesa vote-vector matching used by SPIKE step (h).

This module is deliberately generic and uses synthetic vote vectors only —
it must never import or embed real fiscalización data (which carries
personal-data-adjacent provenance and is read directly from an external,
uncommitted file during the SPIKE driver script, never here).
"""

from vote_vector_match import match_vote_vectors


def test_exact_match_is_found_for_identical_vectors():
    local = {"1": (10, 20, 5)}
    official = {"0001": (10, 20, 5), "0002": (1, 1, 1)}

    result = match_vote_vectors(local, official)

    assert result.assignments["1"] == "0001"
    assert result.exact_match_count == 1
    assert result.injective is True
    assert result.conflicts == []


def test_matching_is_injective_two_locals_never_map_to_same_official():
    # Two locals are each closest to the same official vector; only the
    # exact/best one may claim it, the loser must not silently double-map.
    local = {"1": (10, 20, 5), "2": (10, 20, 5)}
    official = {"0001": (10, 20, 5)}

    result = match_vote_vectors(local, official)

    claimed = [v for v in result.assignments.values() if v is not None]
    assert len(claimed) == len(set(claimed)), (
        "injective: no official mesa claimed twice"
    )
    assert result.injective is False
    assert len(result.conflicts) == 1


def test_no_conflict_when_each_local_has_a_distinct_best_match():
    local = {"1": (10, 20, 5), "2": (0, 0, 0)}
    official = {"0001": (10, 20, 5), "0002": (0, 0, 0)}

    result = match_vote_vectors(local, official)

    assert result.assignments["1"] == "0001"
    assert result.assignments["2"] == "0002"
    assert result.injective is True
    assert result.conflicts == []


def test_distance_distribution_is_reported_for_every_local_mesa():
    local = {"1": (10, 20, 5), "2": (0, 0, 1)}
    official = {"0001": (10, 20, 5), "0002": (0, 0, 0)}

    result = match_vote_vectors(local, official)

    assert set(result.best_match_distance.keys()) == {"1", "2"}
    assert result.best_match_distance["1"] == 0
    assert result.best_match_distance["2"] == 1


def test_pass_threshold_helper_reports_exact_match_rate():
    local = {str(i): (i, 0, 0) for i in range(10)}
    official = {
        f"{i:04d}": (i, 0, 0) for i in range(9)
    }  # mesa 9 has no official counterpart

    result = match_vote_vectors(local, official)

    assert result.exact_match_count == 9
    assert result.exact_match_rate == 9 / 10
    assert result.passes_threshold(0.9) is True  # >= threshold passes (D9.5: "≥ 90 %")
    assert result.passes_threshold(0.90001) is False
