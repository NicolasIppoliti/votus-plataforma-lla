"""Reusable empirical mesa vote-vector matching (SPIKE step h, design D9.5).

Given per-mesa vote vectors from two independent sources (a local/internal
numbering and an official/DINE numbering), find the best injective mapping
between them by nearest-vector distance, and report the exact-match rate,
injectivity, conflicts and the full best-match-distance distribution.

Pure, no I/O — SPIKE driver scripts feed it already-parsed vectors so the
algorithm itself can be unit tested without ever touching personal data or
large files.
"""

from __future__ import annotations

from dataclasses import dataclass, field


def _distance(a: tuple[int, ...], b: tuple[int, ...]) -> int:
    return sum(abs(x - y) for x, y in zip(a, b))


@dataclass
class MatchResult:
    assignments: dict[str, str | None]
    best_match_distance: dict[str, int]
    exact_match_count: int
    exact_match_rate: float
    injective: bool
    conflicts: list[tuple[str, tuple[str, ...]]] = field(default_factory=list)

    def passes_threshold(self, threshold: float) -> bool:
        return self.injective and not self.conflicts and self.exact_match_rate >= threshold


def match_vote_vectors(
    local: dict[str, tuple[int, ...]],
    official: dict[str, tuple[int, ...]],
) -> MatchResult:
    """Match each local mesa vector to its nearest official mesa vector.

    Reports the raw nearest-neighbour distance for every local mesa (the
    "best-match-distance distribution" required by design D9.5, so a benign
    non-zero divergence between fiscal tallies and the definitive escrutinio
    is visible rather than misread as "codes do not reconcile").

    Only EXACT (distance == 0) matches count toward the pass criterion.
    Injective: an official mesa claimed as an exact match by two or more
    local mesas is a genuine conflicting assignment — recorded, and none of
    the contenders is assigned it (never silently resolved).
    """
    raw_best: dict[str, tuple[str | None, int]] = {}
    for local_id, local_vec in local.items():
        best_official_id: str | None = None
        best_distance: int | None = None
        for official_id, official_vec in official.items():
            d = _distance(local_vec, official_vec)
            if best_distance is None or d < best_distance:
                best_distance = d
                best_official_id = official_id
        raw_best[local_id] = (best_official_id, best_distance if best_distance is not None else -1)

    best_match_distance = {local_id: dist for local_id, (_official_id, dist) in raw_best.items()}

    exact_claims: dict[str, list[str]] = {}
    for local_id, (official_id, dist) in raw_best.items():
        if official_id is not None and dist == 0:
            exact_claims.setdefault(official_id, []).append(local_id)

    assignments: dict[str, str | None] = {local_id: None for local_id in local}
    conflicts: list[tuple[str, tuple[str, ...]]] = []
    for official_id, local_ids in exact_claims.items():
        if len(local_ids) == 1:
            assignments[local_ids[0]] = official_id
        else:
            conflicts.append((official_id, tuple(sorted(local_ids))))

    exact_match_count = sum(1 for v in assignments.values() if v is not None)
    exact_match_rate = exact_match_count / len(local) if local else 0.0
    injective = len(conflicts) == 0

    return MatchResult(
        assignments=assignments,
        best_match_distance=best_match_distance,
        exact_match_count=exact_match_count,
        exact_match_rate=exact_match_rate,
        injective=injective,
        conflicts=conflicts,
    )
