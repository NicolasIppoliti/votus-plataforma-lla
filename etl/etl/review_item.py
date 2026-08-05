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
