"""RED tests for the empirical mesa vote-vector matching used by SPIKE step (h).

This module is deliberately generic and uses synthetic vote vectors only —
it must never import or embed real fiscalización data (which carries
personal-data-adjacent provenance and is read directly from an external,
uncommitted file during the SPIKE driver script, never here).
"""

import pytest
from vote_vector_match import VectorShapeError, match_vote_vectors


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
    official = {f"{i:04d}": (i, 0, 0) for i in range(9)}

    result = match_vote_vectors(local, official)

    assert result.exact_match_count == 9
    assert result.exact_match_rate == 9 / 10
    assert result.passes_threshold(0.9) is True  # >= threshold passes (D9.5: "≥ 90 %")
    assert result.passes_threshold(0.90001) is False


def test_equal_best_candidates_are_ambiguous_independent_of_insertion_order():
    local = {"local": (1, 1)}
    official = {"z": (1, 1), "a": (1, 1)}

    result = match_vote_vectors(local, official)

    assert result.assignments == {"local": None}
    assert result.ambiguities == [("local", ("a", "z"))]
    assert result.injective is False
    assert result.exact_match_count == 0
    assert result.exact_match_denominator == 1
    assert result.passes_threshold(0) is False


@pytest.mark.parametrize(
    ("local", "official"),
    [
        ({"one": (1,), "two": (1, 2)}, {"official": (1,)}),
        ({"local": (1,)}, {"one": (1,), "two": (1, 2)}),
        ({"local": (1,)}, {"official": (1, 2)}),
    ],
)
def test_vector_shape_mismatches_refuse_the_entire_match(local, official):
    with pytest.raises(VectorShapeError):
        match_vote_vectors(local, official)


def test_no_official_candidates_are_sorted_unmappable_without_fake_distance():
    result = match_vote_vectors({"z": (1,), "a": (2,)}, {})

    assert result.assignments == {"a": None, "z": None}
    assert result.unmappable_local_ids == ["a", "z"]
    assert result.best_match_distance == {}
    assert result.injective is False
    assert result.exact_match_count == 0
    assert result.exact_match_denominator == 2
    assert result.passes_threshold(0) is False


def test_conflicts_and_output_collections_are_sorted_and_fail_closed():
    result = match_vote_vectors(
        {"z": (0,), "a": (0,), "missing": (9,)},
        {"official": (0,)},
    )

    assert result.assignments == {"a": None, "missing": None, "z": None}
    assert result.conflicts == [("official", ("a", "z"))]
    assert result.best_match_distance == {"a": 0, "missing": 9, "z": 0}
    assert result.exact_match_count == 0
    assert result.exact_match_denominator == 3
    assert result.injective is False
    assert result.passes_threshold(0) is False
