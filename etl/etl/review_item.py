"""D7 review-queue projection (design.md D7/D9.5, task 11.19).

`review_item` (`supabase/migrations/0007_review_item.sql`) is the FIRST
table that actually PERSISTS review-queue records; before this phase every
producer (`etl.ingest.fiscalizacion.ReviewItemDraft`,
`etl.crosswalk.MesaDivergence`) only produced them in memory. This module
is the single place that projects those in-memory records into
insert-ready rows -- `etl.db.insert_review_items` is the only write path,
so the projection rule lives in one spot instead of being re-implemented
per producer.
"""

from __future__ import annotations

import re
from collections.abc import Mapping
from dataclasses import dataclass

from etl.crosswalk import MesaDivergence
from etl.ingest.fiscalizacion import ReviewItemDraft

REVIEW_ITEM_KINDS = frozenset(
    {
        "content_drift",
        "fetch_failure",
        "unmapped_party",
        "unmapped_jurisdiction",
        "mesa_discontinuity",
        "source_reexported",
        "duplicate_collapsed",
        "duplicate_conflict",
        "unmergeable_row",
        "blank_vote_cell",
        "mesa_tally_divergence",
        "ambiguous_mesa_circuito",
        "mesa_absent_from_official_import",
        "unreadable_vote_cell",
        "ambiguous_official_mesa_identity",
        "pba_conflicting_duplicate_semantic_result",
        "pba_exact_duplicate_semantic_result",
        "pba_unreadable_vote_cell",
    }
)
"""Every kind `review_item_kind_check` admits, declared once.

This is the Python half of a contract whose other half is a database constraint;
`test_0024_review_kind_allowlist_matches_the_declared_production_kinds` holds the two
in exact agreement. It exists because the previous guard inferred the kinds by scanning
producer source for `kind=` keyword arguments, which missed every literal written in
another shape -- and, being a subset check, passed anyway when it missed one.
"""


class UndeclaredReviewKindError(ValueError):
    """A record carried a kind `review_item_kind_check` would reject."""


def validate_review_item_kind(kind: str) -> None:
    """Reject a kind outside the shared Python/database review-item contract."""
    if kind not in REVIEW_ITEM_KINDS:
        raise UndeclaredReviewKindError(
            f"review item kind {kind!r} is not declared. Add it to "
            "REVIEW_ITEM_KINDS in etl/etl/review_item.py AND to review_item_kind_check "
            "in a new migration; the database rejects the insert otherwise."
        )


@dataclass(frozen=True, order=True)
class ReviewItemSectionScope:
    """One authoritative section identity, already normalized by its producer."""

    distrito_code: str
    seccion_code: str

    def __post_init__(self) -> None:
        if (
            re.fullmatch(r"[0-9]{2}", self.distrito_code) is None
            or re.fullmatch(r"[0-9]{3}", self.seccion_code) is None
        ):
            raise ValueError(
                "review item scope must be an exact canonical section "
                "(two-digit distrito, three-digit seccion)"
            )


@dataclass(frozen=True)
class ReviewItemContext:
    """Explicit provenance for the fiscal review writer v2 seam."""

    context_role: str
    source_kind: str
    archive_availability: str
    election_year: int
    election_id: str | None
    category_id: str | None
    archive_entry_id: str | None
    unknown_reason: str | None = None


@dataclass(frozen=True)
class ReviewItemRecord:
    """One insert-ready `review_item` row (`detected_at`/`resolved_at` are
    left to the table's Postgres defaults -- this module never backdates
    or resolves an item on ingestion).

    Construction validates normal producers early. The real write boundary validates
    again because Python typing cannot prevent a duck-typed object from reaching it.
    """

    kind: str
    severity: str
    subject_ref: str
    note: str | None
    section_scopes: tuple[ReviewItemSectionScope, ...] = ()
    contexts: tuple[ReviewItemContext, ...] = ()

    def __post_init__(self) -> None:
        validate_review_item_kind(self.kind)
        canonical = tuple(sorted(set(self.section_scopes)))
        if canonical != self.section_scopes:
            raise ValueError("review item section scopes must be unique and canonically ordered")
        if not isinstance(self.contexts, tuple):
            raise ValueError("review item contexts must be an immutable tuple")

    @property
    def tenant_scope_state(self) -> str:
        return "section_scoped" if self.section_scopes else "platform_only"


@dataclass(frozen=True)
class SourceArchiveIdentity:
    source_id: str
    election_year: int
    election_round: str
    source_kind: str

    def manifest_fields(self) -> dict[str, str | int]:
        return {
            "election_year": self.election_year,
            "election_round": self.election_round,
            "source_kind": self.source_kind,
        }


class SourceArchiveIdentityConflictError(ValueError):
    """A canonical manifest id points at a different registered identity."""


def source_archive_identity(entry: Mapping[str, object]) -> SourceArchiveIdentity | None:
    """Resolve the one identity used for refetch comparison.

    Legacy test/manifest entries without election metadata remain fetchable but
    cannot produce a typed refetch review item. Real registered sources carry
    both fields at the `load_sources` boundary.
    """
    year = entry.get("election_year")
    round_ = entry.get("election_round")
    if year is None and round_ is None:
        return None
    if isinstance(year, bool) or not isinstance(year, int):
        raise SourceArchiveIdentityConflictError(
            "source archive identity has no valid election year; refusing comparison"
        )
    if not isinstance(round_, str) or not round_.strip():
        raise SourceArchiveIdentityConflictError(
            "source archive identity has no valid election round; refusing comparison"
        )

    source_id = entry.get("id")
    capability = entry.get("capability")
    if not isinstance(source_id, str) or not source_id:
        raise SourceArchiveIdentityConflictError(
            "source archive identity has no source id; refusing comparison"
        )
    if not isinstance(capability, str):
        raise SourceArchiveIdentityConflictError(
            "source archive identity has no capability; refusing comparison"
        )

    source_kind = "fiscalizacion" if capability == "fiscalizacion" else "official"
    declared_kind = entry.get("source_kind", source_kind)
    if declared_kind != source_kind:
        raise SourceArchiveIdentityConflictError(
            f"source archive identity {source_id!r} capability {capability!r} requires "
            f"source_kind {source_kind!r}; refusing conflicting evidence"
        )
    return SourceArchiveIdentity(source_id, year, round_.strip(), source_kind)


def validate_prior_source_identity(
    previous: Mapping[str, object] | None,
    identity: SourceArchiveIdentity | None,
) -> None:
    """Refuse an explicit identity mismatch before new bytes are archived."""
    if previous is None or identity is None:
        return
    previous_sha = previous.get("sha256")
    if previous.get("status") == "ok" and (
        not isinstance(previous_sha, str)
        or len(previous_sha) != 64
        or any(character not in "0123456789abcdefABCDEF" for character in previous_sha)
    ):
        raise SourceArchiveIdentityConflictError(
            f"source archive identity {identity.source_id!r} has no verified sha256; "
            "refusing comparison"
        )
    fields = ("election_year", "election_round", "source_kind")
    present = [field in previous for field in fields]
    if not any(present):
        # Legacy canonical records predate these identity fields. Their exact id
        # is still the current manifest lookup key; the next successful fetch
        # writes the complete identity without claiming full fetch history.
        return
    if not all(present):
        raise SourceArchiveIdentityConflictError(
            f"source archive identity {identity.source_id!r} is incomplete in the manifest; "
            "refusing comparison"
        )
    previous_identity = (
        previous.get("id"),
        previous.get("election_year"),
        previous.get("election_round"),
        previous.get("source_kind"),
    )
    current_identity = (
        identity.source_id,
        identity.election_year,
        identity.election_round,
        identity.source_kind,
    )
    if previous_identity != current_identity:
        raise SourceArchiveIdentityConflictError(
            f"source archive identity {identity.source_id!r} conflicts with its prior "
            "manifest identity; refusing cross-election, cross-round, or cross-kind comparison"
        )


def source_refetch_review_items(
    previous: Mapping[str, object] | None,
    current: Mapping[str, object],
    identity: SourceArchiveIdentity | None,
) -> tuple[ReviewItemRecord, ...]:
    """Classify a verified same-identity hash change for operator review."""
    if previous is None or identity is None:
        return ()
    if previous.get("status") != "ok" or current.get("status") != "ok":
        return ()
    previous_sha = previous.get("sha256")
    current_sha = current.get("sha256")
    if not isinstance(previous_sha, str) or not isinstance(current_sha, str):
        raise SourceArchiveIdentityConflictError(
            f"source archive identity {identity.source_id!r} has no verified hashes; "
            "refusing comparison"
        )
    if previous_sha == current_sha:
        return ()

    kind, severity = (
        ("source_reexported", "info")
        if identity.source_kind == "fiscalizacion"
        else ("content_drift", "warning")
    )
    return (
        ReviewItemRecord(
            kind=kind,
            severity=severity,
            subject_ref=(
                f"source:{identity.source_id} election:"
                f"{identity.election_year}-{identity.election_round} "
                f"kind:{identity.source_kind}"
            ),
            note=f"verified sha256 changed from {previous_sha} to {current_sha}",
        ),
    )


def review_scope_breakdown(records: list[ReviewItemRecord]) -> dict[str, int]:
    """Return both closed states, including an explicit zero count."""
    return {
        state: sum(record.tenant_scope_state == state for record in records)
        for state in ("section_scoped", "platform_only")
    }


def review_item_draft_to_record(draft: ReviewItemDraft) -> ReviewItemRecord:
    """Project a `ReviewItemDraft` (produced during fiscalización ingestion)
    into an insert-ready row -- a straight field copy, no re-derivation."""
    return ReviewItemRecord(
        kind=draft.kind,
        severity=draft.severity,
        subject_ref=draft.subject_ref,
        note=draft.note,
    )


@dataclass(frozen=True)
class MesaDivergenceExclusion:
    reason: str
    column: str
    count: int


@dataclass(frozen=True)
class MesaDivergenceProjection:
    review_items: tuple[ReviewItemRecord, ...]
    exclusions: tuple[MesaDivergenceExclusion, ...]


def mesa_divergences_to_review_items(
    divergences: list[MesaDivergence],
) -> MesaDivergenceProjection:
    """Project actionable divergences and account for expected exclusions."""
    review_items: list[ReviewItemRecord] = []
    excluded_by_column: dict[str, int] = {}
    for divergence in divergences:
        if divergence.is_expected_category_difference:
            excluded_by_column[divergence.column] = excluded_by_column.get(divergence.column, 0) + 1
            continue
        review_items.append(
            ReviewItemRecord(
                kind="mesa_tally_divergence",
                severity="info",
                subject_ref=f"mesa:{divergence.mesa}",
                note=(
                    f"fiscalización/official divergence on {divergence.column!r}: "
                    f"fiscalización={divergence.fiscalizacion_value}, "
                    f"official={divergence.official_value}"
                ),
            )
        )

    return MesaDivergenceProjection(
        review_items=tuple(review_items),
        exclusions=tuple(
            MesaDivergenceExclusion(
                reason="expected_category_definition_difference",
                column=column,
                count=count,
            )
            for column, count in sorted(excluded_by_column.items())
        ),
    )
