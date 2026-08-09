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

from collections.abc import Mapping
from dataclasses import dataclass

from etl.crosswalk import MesaDivergence
from etl.ingest.fiscalizacion import ReviewItemDraft


@dataclass(frozen=True)
class ReviewItemRecord:
    """One insert-ready `review_item` row (`detected_at`/`resolved_at` are
    left to the table's Postgres defaults -- this module never backdates
    or resolves an item on ingestion)."""

    kind: str
    severity: str
    subject_ref: str
    note: str | None


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


def review_item_draft_to_record(draft: ReviewItemDraft) -> ReviewItemRecord:
    """Project a `ReviewItemDraft` (produced during fiscalización ingestion)
    into an insert-ready row -- a straight field copy, no re-derivation."""
    return ReviewItemRecord(
        kind=draft.kind,
        severity=draft.severity,
        subject_ref=draft.subject_ref,
        note=draft.note,
    )


def mesa_divergences_to_review_items(
    divergences: list[MesaDivergence],
) -> list[ReviewItemRecord]:
    """Project `MesaDivergence` records (`etl.crosswalk`) into `review_item`
    rows.

    D9.5: a diverging per-mesa tally is ALWAYS informational, never a join
    failure -- every produced item is `severity='info'`. The
    `Impugnado`/`En blanco` columns are an EXPECTED category-definition
    difference between a fiscal's provisional judgement and the definitive
    escrutinio; design.md states this explicitly "MUST NOT render as
    drift", so those columns are EXCLUDED here rather than inserted at a
    different severity -- no `review_item` row is ever created for one.
    """
    return [
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
        for divergence in divergences
        if not divergence.is_expected_category_difference
    ]
