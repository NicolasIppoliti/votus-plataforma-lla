"""Reusable empirical mesa vote-vector matching (SPIKE step h, design D9.5).

Pure, no I/O — SPIKE driver scripts feed it already-parsed vectors so the
algorithm itself can be unit tested without touching personal data or large files.
"""

from __future__ import annotations

from dataclasses import dataclass, field


class VectorShapeError(ValueError):
    """Raised when a matching run does not have one shared vector dimension."""


def _distance(a: tuple[int, ...], b: tuple[int, ...]) -> int:
    return sum(abs(x - y) for x, y in zip(a, b))


def _validate_vector_shapes(
    local: dict[str, tuple[int, ...]], official: dict[str, tuple[int, ...]]
) -> None:
    local_dimensions = sorted({len(vector) for vector in local.values()})
    official_dimensions = sorted({len(vector) for vector in official.values()})
    if len(local_dimensions) > 1:
        raise VectorShapeError(f"local vector dimensions differ: {local_dimensions}")
    if len(official_dimensions) > 1:
        raise VectorShapeError(
            f"official vector dimensions differ: {official_dimensions}"
        )
    if (
        local_dimensions
        and official_dimensions
        and local_dimensions != official_dimensions
    ):
        raise VectorShapeError(
            f"local and official vector dimensions differ: "
            f"{local_dimensions[0]} != {official_dimensions[0]}"
        )


@dataclass
class MatchResult:
    assignments: dict[str, str | None]
    best_match_distance: dict[str, int]
    exact_match_count: int
    exact_match_denominator: int
    exact_match_rate: float
    injective: bool
    conflicts: list[tuple[str, tuple[str, ...]]] = field(default_factory=list)
    ambiguities: list[tuple[str, tuple[str, ...]]] = field(default_factory=list)
    unmappable_local_ids: list[str] = field(default_factory=list)

    def passes_threshold(self, threshold: float) -> bool:
        return (
            self.exact_match_denominator > 0
            and self.injective
            and not self.conflicts
            and not self.ambiguities
            and not self.unmappable_local_ids
            and self.exact_match_rate >= threshold
        )


def match_vote_vectors(
    local: dict[str, tuple[int, ...]],
    official: dict[str, tuple[int, ...]],
) -> MatchResult:
    """Match complete local vectors to nearest official candidates.

    Empty local input has a zero denominator and cannot pass a threshold. Empty
    official input leaves every local ID explicitly unmappable. Any dimension
    mismatch refuses the entire match before distance calculation.
    """
    _validate_vector_shapes(local, official)
    assignments = {local_id: None for local_id in sorted(local)}
    best_match_distance: dict[str, int] = {}
    ambiguities: list[tuple[str, tuple[str, ...]]] = []
    unmappable_local_ids: list[str] = []
    raw_exact_claims: dict[str, list[str]] = {}

    for local_id in sorted(local):
        local_vector = local[local_id]
        distances = {
            official_id: _distance(local_vector, official[official_id])
            for official_id in sorted(official)
        }
        if not distances:
            unmappable_local_ids.append(local_id)
            continue
        best_distance = min(distances.values())
        best_ids = tuple(
            official_id
            for official_id, distance in distances.items()
            if distance == best_distance
        )
        best_match_distance[local_id] = best_distance
        if len(best_ids) > 1:
            ambiguities.append((local_id, best_ids))
        elif best_distance == 0:
            raw_exact_claims.setdefault(best_ids[0], []).append(local_id)

    conflicts = [
        (official_id, tuple(local_ids))
        for official_id, local_ids in sorted(raw_exact_claims.items())
        if len(local_ids) > 1
    ]
    for official_id, local_ids in raw_exact_claims.items():
        if len(local_ids) == 1:
            assignments[local_ids[0]] = official_id

    exact_match_count = sum(
        assignment is not None for assignment in assignments.values()
    )
    exact_match_denominator = len(local)
    exact_match_rate = (
        exact_match_count / exact_match_denominator if exact_match_denominator else 0.0
    )
    injective = not conflicts and not ambiguities and not unmappable_local_ids
    return MatchResult(
        assignments=assignments,
        best_match_distance=best_match_distance,
        exact_match_count=exact_match_count,
        exact_match_denominator=exact_match_denominator,
        exact_match_rate=exact_match_rate,
        injective=injective,
        conflicts=conflicts,
        ambiguities=ambiguities,
        unmappable_local_ids=unmappable_local_ids,
    )
