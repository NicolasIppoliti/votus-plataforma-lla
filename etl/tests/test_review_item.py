"""etl.review_item: projecting in-memory review-queue records into
insert-ready `review_item` rows (design.md D7/D9.5, task 11.19).

`review_item` (`supabase/migrations/0007_review_item.sql`) is the FIRST
table that actually persists `MesaDivergence` records
`etl.crosswalk.join_fiscalizacion_identity` has been producing in memory
since Phase 4. These tests are pure (no Postgres) — the write path itself
is covered by `test_integration_idempotent.py`.
"""

from __future__ import annotations

from etl.crosswalk import MesaDivergence
from etl.ingest.fiscalizacion import ReviewItemDraft
from etl.review_item import mesa_divergences_to_review_items, review_item_draft_to_record


def test_expected_category_divergence_excluded_from_review_items() -> None:
    """D9.5: Impugnado/En blanco is an EXPECTED category-definition
    difference between a fiscal's provisional judgement and the definitive
    escrutinio, and "MUST NOT render as drift" — no `review_item` row is
    created for it at all, at any severity.
    """
    divergences = [
        MesaDivergence(mesa=13, column="Impugnado", fiscalizacion_value=2, official_value=0),
        MesaDivergence(mesa=13, column="En blanco", fiscalizacion_value=1, official_value=3),
    ]

    items = mesa_divergences_to_review_items(divergences)

    assert items == []


def test_genuine_divergence_becomes_mesa_tally_divergence_review_item() -> None:
    """A divergence on a genuine party column is informational (D9.5: never
    a join failure) — recorded as `mesa_tally_divergence`, severity `info`.
    """
    divergences = [
        MesaDivergence(
            mesa=42, column="La Libertad Avanza", fiscalizacion_value=55, official_value=57
        ),
    ]

    items = mesa_divergences_to_review_items(divergences)

    assert len(items) == 1
    item = items[0]
    assert item.kind == "mesa_tally_divergence"
    assert item.severity == "info"
    assert item.subject_ref == "mesa:42"
    assert "La Libertad Avanza" in (item.note or "")
    assert "55" in (item.note or "")
    assert "57" in (item.note or "")


def test_review_item_draft_projects_verbatim() -> None:
    """`etl.ingest.fiscalizacion.ReviewItemDraft` already carries exactly
    the fields `review_item` needs — projection is a straight field copy,
    never a re-derivation.
    """
    draft = ReviewItemDraft(
        kind="duplicate_collapsed",
        severity="info",
        subject_ref="mesa:15",
        note="collapsed 3 identical duplicate rows",
    )

    record = review_item_draft_to_record(draft)

    assert record.kind == draft.kind
    assert record.severity == draft.severity
    assert record.subject_ref == draft.subject_ref
    assert record.note == draft.note
