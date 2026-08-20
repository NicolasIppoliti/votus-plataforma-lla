"""etl.review_item: projecting in-memory review-queue records into
insert-ready `review_item` rows (design.md D7/D9.5, task 11.19).

`review_item` (`supabase/migrations/0007_review_item.sql`) is the FIRST
table that actually persists `MesaDivergence` records
`etl.crosswalk.join_fiscalizacion_identity` has been producing in memory
since Phase 4. These tests are pure (no Postgres) — the write path itself
is covered by `test_integration_idempotent.py`.
"""

from __future__ import annotations

import pytest

from etl.crosswalk import MesaDivergence
from etl.db import insert_review_items
from etl.ingest.fiscalizacion import ReviewItemDraft
from etl.review_item import (
    REVIEW_ITEM_KINDS,
    ReviewItemRecord,
    SourceArchiveIdentity,
    UndeclaredReviewKindError,
    mesa_divergences_to_review_items,
    review_item_draft_to_record,
    source_refetch_review_items,
)


def test_expected_category_divergence_excluded_from_review_items() -> None:
    """D9.5: Impugnado/En blanco is an EXPECTED category-definition
    difference between a fiscal's provisional judgement and the definitive
    escrutinio, and "MUST NOT render as drift" — no `review_item` row is
    created for it at all, at any severity.
    """
    divergences = [
        MesaDivergence(mesa=13, column="Impugnado", fiscalizacion_value=2, official_value=0),
        MesaDivergence(mesa=14, column="Impugnado", fiscalizacion_value=1, official_value=0),
        MesaDivergence(mesa=13, column="En blanco", fiscalizacion_value=1, official_value=3),
    ]

    projection = mesa_divergences_to_review_items(divergences)

    assert projection.review_items == ()
    assert [
        (exclusion.reason, exclusion.column, exclusion.count) for exclusion in projection.exclusions
    ] == [
        ("expected_category_definition_difference", "En blanco", 1),
        ("expected_category_definition_difference", "Impugnado", 2),
    ]


def test_mixed_divergences_reconcile_observed_actionable_and_excluded() -> None:
    divergences = [
        MesaDivergence(
            mesa=42, column="La Libertad Avanza", fiscalizacion_value=55, official_value=57
        ),
        MesaDivergence(mesa=42, column="Impugnado", fiscalizacion_value=2, official_value=0),
        MesaDivergence(mesa=42, column="En blanco", fiscalizacion_value=1, official_value=3),
    ]

    projection = mesa_divergences_to_review_items(divergences)

    assert len(divergences) == len(projection.review_items) + sum(
        exclusion.count for exclusion in projection.exclusions
    )
    assert [item.kind for item in projection.review_items] == ["mesa_tally_divergence"]
    assert all(item.severity == "info" for item in projection.review_items)


def test_genuine_divergence_becomes_mesa_tally_divergence_review_item() -> None:
    """A divergence on a genuine party column is informational (D9.5: never
    a join failure) — recorded as `mesa_tally_divergence`, severity `info`.
    """
    divergences = [
        MesaDivergence(
            mesa=42, column="La Libertad Avanza", fiscalizacion_value=55, official_value=57
        ),
    ]

    projection = mesa_divergences_to_review_items(divergences)

    assert projection.exclusions == ()
    assert len(projection.review_items) == 1
    item = projection.review_items[0]
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


def test_unknown_kind_is_refused_when_building_a_review_item_record() -> None:
    """The canonical record type refuses a kind the database constraint would reject."""
    with pytest.raises(ValueError, match="unmapped_planet"):
        ReviewItemRecord(
            kind="unmapped_planet",
            severity="warning",
            subject_ref="source:probe",
            note=None,
        )


def test_insert_review_items_refuses_a_duck_typed_unknown_kind_before_db_work() -> None:
    class InsertShapedRecord:
        kind = "unmapped_planet"
        severity = "warning"
        subject_ref = "source:probe"
        note = None

    class ConnectionThatMustNotBeUsed:
        def cursor(self):
            raise AssertionError("database work started before kind validation")

    with pytest.raises(UndeclaredReviewKindError, match="unmapped_planet"):
        insert_review_items(
            ConnectionThatMustNotBeUsed(),
            [InsertShapedRecord()],  # type: ignore[list-item]
        )


def test_every_declared_kind_builds_an_insert_ready_record() -> None:
    for kind in REVIEW_ITEM_KINDS:
        record = ReviewItemRecord(kind=kind, severity="info", subject_ref="s", note=None)
        assert record.kind == kind


def test_refetch_classification_uses_declared_kinds_for_both_source_kinds() -> None:
    """Both branches of the drift classification reach the guarded boundary.

    This is the exact drift the guard exists to catch: the literals live in a
    tuple-unpacked conditional, the shape an AST producer-scan silently skips.
    """
    previous = {"status": "ok", "sha256": "a" * 64}
    current = {"status": "ok", "sha256": "b" * 64}
    expected_by_source_kind = (
        ("fiscalizacion", "source_reexported"),
        ("official", "content_drift"),
    )
    for source_kind, expected in expected_by_source_kind:
        identity = SourceArchiveIdentity(
            source_id="probe",
            election_year=2025,
            election_round="general",
            source_kind=source_kind,
        )
        items = source_refetch_review_items(previous, current, identity)
        assert [item.kind for item in items] == [expected]
        assert expected in REVIEW_ITEM_KINDS
