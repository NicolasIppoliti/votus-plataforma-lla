"""Integration tests for the D8 idempotent-load transaction wrapper
(tasks 8.2/8.3), run against a real, ephemeral local Postgres --
`supabase db start` (migrations 0001-0006 applied automatically on first
start; see `supabase/migrations/`).

SKIP, never silently pass, when no Postgres is reachable -- e.g. a developer
without Docker running. `_require_ephemeral_postgres` below is the one place
that decides that; `test_unreachable_reason_names_the_dsn_and_the_remedy`
below asserts its message is explicit without needing Postgres to actually
be down.
"""

from __future__ import annotations

import os
import uuid

import psycopg
import pytest

from etl.db import insert_review_items
from etl.ingest.national import NationalRow, load_national_rows
from etl.jurisdiction import make_result_row
from etl.review_item import ReviewItemRecord

TEST_DSN = os.environ.get(
    "ETL_TEST_DATABASE_URL", "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
)


def unreachable_reason(dsn: str, error: Exception) -> str:
    """The exact SKIP message `_require_ephemeral_postgres` reports.

    A pure function so its content (naming the DSN and the remedy) is
    unit-testable on its own, independent of whether Postgres is actually
    reachable in the environment running this suite.
    """
    return (
        f"no ephemeral Postgres reachable at {dsn!r} (start one with `supabase db start`): {error}"
    )


def test_unreachable_reason_names_the_dsn_and_the_remedy() -> None:
    reason = unreachable_reason("postgresql://x/y", RuntimeError("boom"))
    assert "postgresql://x/y" in reason
    assert "supabase db start" in reason
    assert "boom" in reason


def _require_ephemeral_postgres() -> psycopg.Connection:
    try:
        return psycopg.connect(TEST_DSN, connect_timeout=2)
    except psycopg.OperationalError as exc:
        pytest.skip(unreachable_reason(TEST_DSN, exc))


@pytest.fixture
def pg_conn():
    conn = _require_ephemeral_postgres()
    try:
        yield conn
    finally:
        # Never commit -- every test's writes are discarded here, so the
        # ephemeral database stays clean between runs without needing a
        # dedicated teardown per table.
        conn.rollback()
        conn.close()


def _fixture_rows(archive_entry_id: str) -> list[NationalRow]:
    """Two mesas, two lists each -- enough to exercise upsert caching and
    the delete-then-insert wrapper without depending on a real CSV fixture.
    """
    rows: list[NationalRow] = []
    for mesa in (1, 2):
        for list_id, votes in (("135", 100 + mesa), ("134", 50 + mesa)):
            result = make_result_row(
                granularity="mesa",
                distrito="02",
                seccion="027",
                circuito="01",
                mesa=mesa,
                category="DIPUTADO NACIONAL",
                list_id=list_id,
                votes=votes,
            )
            rows.append(
                NationalRow(
                    result=result,
                    estado_final=None,
                    archive_entry_id=archive_entry_id,
                    source_row_index=len(rows),
                    natural_key=(
                        archive_entry_id,
                        mesa,
                        list_id,
                        "DIPUTADO NACIONAL",
                        "POSITIVO",
                    ),
                )
            )
    return rows


def _snapshot(conn: psycopg.Connection, archive_entry_id: str) -> set[tuple]:
    with conn.cursor() as cur:
        cur.execute(
            """
            select jurisdiction_id, category_id, list_id, votes, source_row_index
            from result_row
            where archive_entry_id = %s
            order by source_row_index
            """,
            (archive_entry_id,),
        )
        return set(cur.fetchall())


def test_ephemeral_postgres_reingest_matches_original(pg_conn: psycopg.Connection) -> None:
    """Task 8.2: re-running `load_national_rows` for the SAME archive entry
    with the SAME rows leaves `result_row` identical -- D8's
    delete-by-`archive_entry_id` step is what makes re-ingestion safe.
    """
    archive_entry_id = f"test-national-{uuid.uuid4()}"
    rows = _fixture_rows(archive_entry_id)

    inserted_first = load_national_rows(pg_conn, rows, year=2025, round_="legislativas")
    first_snapshot = _snapshot(pg_conn, archive_entry_id)

    inserted_second = load_national_rows(pg_conn, rows, year=2025, round_="legislativas")
    second_snapshot = _snapshot(pg_conn, archive_entry_id)

    assert inserted_first == inserted_second == len(rows)
    assert first_snapshot == second_snapshot
    assert len(second_snapshot) == len(rows)  # no accidental duplication


def test_drop_and_rebuild_equality(pg_conn: psycopg.Connection) -> None:
    """Task 8.3: truncate-then-replay (D8's "Rebuild = truncate + replay")
    reproduces the exact same `result_row` projection for the same archive
    entry as the original load.
    """
    archive_entry_id = f"test-national-{uuid.uuid4()}"
    rows = _fixture_rows(archive_entry_id)

    load_national_rows(pg_conn, rows, year=2025, round_="legislativas")
    original_snapshot = _snapshot(pg_conn, archive_entry_id)
    assert original_snapshot  # sanity: the fixture actually produced rows

    with pg_conn.cursor() as cur:
        cur.execute("truncate table result_row")
    assert _snapshot(pg_conn, archive_entry_id) == set()

    load_national_rows(pg_conn, rows, year=2025, round_="legislativas")
    rebuilt_snapshot = _snapshot(pg_conn, archive_entry_id)

    assert rebuilt_snapshot == original_snapshot


def test_insert_review_items_persists_mesa_tally_divergence(pg_conn: psycopg.Connection) -> None:
    """Task 11.19: `review_item` (`0007_review_item.sql`) is the first
    table that actually persists what `etl.review_item` projects from
    `MesaDivergence`/`ReviewItemDraft` -- this proves the write path works
    against a real Postgres, not just the pure projection logic already
    covered by `test_review_item.py`.
    """
    subject_ref = f"mesa:{uuid.uuid4()}"
    records = [
        ReviewItemRecord(
            kind="mesa_tally_divergence",
            severity="info",
            subject_ref=subject_ref,
            note="fiscalización/official divergence on 'La Libertad Avanza': "
            "fiscalización=55, official=57",
        )
    ]

    inserted = insert_review_items(pg_conn, records)

    with pg_conn.cursor() as cur:
        cur.execute(
            "select kind, severity, subject_ref, note, resolved_at from review_item"
            " where subject_ref = %s",
            (subject_ref,),
        )
        row = cur.fetchone()

    assert inserted == 1
    assert row == ("mesa_tally_divergence", "info", subject_ref, records[0].note, None)
