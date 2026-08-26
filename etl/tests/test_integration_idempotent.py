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

import json
import os
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace

import psycopg
import pytest

from etl.db import (
    ArchiveEntryNotFoundError,
    ArchiveEntrySourceKindMismatchError,
    ResultRowRecord,
    ReviewItemTransactionIsolationError,
    insert_review_items,
    load_result_rows,
    upsert_jurisdiction,
)
from etl.ingest.national import NationalRow, load_national_rows
from etl.jurisdiction import make_result_row
from etl.review_item import ReviewItemRecord, ReviewItemSectionScope

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


class _RecordingCursor:
    def __init__(
        self,
        statements: list[tuple[str, object]],
        archive_source_kind: str | None,
    ) -> None:
        self.statements = statements
        self.archive_source_kind = archive_source_kind
        self.last_query = ""

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback) -> None:
        return None

    def execute(self, query: str, params=None) -> None:
        self.last_query = query
        self.statements.append((query, params))

    def executemany(self, query: str, params) -> None:
        self.last_query = query
        self.statements.append((query, list(params)))

    def fetchone(self) -> tuple[str] | None:
        if "from archive_entry" in self.last_query:
            if self.archive_source_kind is None:
                return None
            return (self.archive_source_kind,)
        return ("read committed",)

    def fetchall(self) -> list[tuple[int]]:
        return [(1,)]


class _RecordingConnection:
    def __init__(self, *, archive_source_kind: str | None = "official") -> None:
        self.autocommit = False
        self.archive_source_kind = archive_source_kind
        self.statements: list[tuple[str, object]] = []
        self.commit_calls = 0
        self.cursor_calls = 0

    def cursor(self) -> _RecordingCursor:
        self.cursor_calls += 1
        return _RecordingCursor(self.statements, self.archive_source_kind)

    def commit(self) -> None:
        self.commit_calls += 1


def _result_record(*, archive_entry_id: str, source_kind: str = "official") -> ResultRowRecord:
    return ResultRowRecord(
        election_id="election-1",
        jurisdiction_id="jurisdiction-1",
        category_id="category-1",
        granularity="mesa",
        list_id="list-1",
        votes=12,
        source_kind=source_kind,
        archive_entry_id=archive_entry_id,
        source_row_index=0,
    )


def test_load_result_rows_refuses_a_foreign_archive_entry_before_any_sql() -> None:
    conn = _RecordingConnection()

    with pytest.raises(ValueError, match="expected-entry.*offending-entry"):
        load_result_rows(
            conn,
            archive_entry_id="expected-entry",
            election_id="election-1",
            records=[_result_record(archive_entry_id="offending-entry")],
        )

    assert conn.cursor_calls == 0
    assert conn.statements == []
    assert conn.commit_calls == 0


def test_load_result_rows_refuses_mixed_source_kinds_before_any_sql() -> None:
    conn = _RecordingConnection()

    with pytest.raises(ValueError, match="source_kind.*fiscalizacion.*official"):
        load_result_rows(
            conn,
            archive_entry_id="entry-1",
            election_id="election-1",
            records=[
                _result_record(archive_entry_id="entry-1"),
                _result_record(archive_entry_id="entry-1", source_kind="fiscalizacion"),
            ],
        )

    assert conn.cursor_calls == 0
    assert conn.statements == []
    assert conn.commit_calls == 0


def test_load_result_rows_refuses_source_kind_that_disagrees_with_archive_authority() -> None:
    conn = _RecordingConnection(archive_source_kind="official")

    with pytest.raises(
        ArchiveEntrySourceKindMismatchError,
        match="archive_entry.*source_kind.*official.*fiscalizacion",
    ):
        load_result_rows(
            conn,
            archive_entry_id="entry-1",
            election_id="election-1",
            records=[_result_record(archive_entry_id="entry-1", source_kind="fiscalizacion")],
        )

    assert conn.cursor_calls == 1
    assert len(conn.statements) == 1
    assert "select source_kind" in conn.statements[0][0]
    assert "from archive_entry" in conn.statements[0][0]
    assert conn.commit_calls == 0


def test_load_result_rows_refuses_a_missing_archive_entry_before_mutation() -> None:
    conn = _RecordingConnection(archive_source_kind=None)

    with pytest.raises(ArchiveEntryNotFoundError, match="archive_entry.*entry-1.*does not exist"):
        load_result_rows(
            conn,
            archive_entry_id="entry-1",
            election_id="election-1",
            records=[_result_record(archive_entry_id="entry-1")],
        )

    assert conn.cursor_calls == 1
    assert len(conn.statements) == 1
    assert "select source_kind" in conn.statements[0][0]
    assert "from archive_entry" in conn.statements[0][0]
    assert conn.commit_calls == 0


def test_load_result_rows_matching_archive_entry_keeps_delete_insert_idempotency_shape() -> None:
    conn = _RecordingConnection()
    record = _result_record(archive_entry_id="entry-1")

    assert (
        load_result_rows(
            conn,
            archive_entry_id="entry-1",
            election_id="election-1",
            records=[record],
        )
        == 1
    )
    first_statements = list(conn.statements)
    assert (
        load_result_rows(
            conn,
            archive_entry_id="entry-1",
            election_id="election-1",
            records=[record],
        )
        == 1
    )

    assert conn.statements == first_statements * 2
    assert "select source_kind" in first_statements[0][0]
    assert "from archive_entry" in first_statements[0][0]
    assert "delete from result_row" in first_statements[1][0]
    assert "insert into result_row" in first_statements[2][0]
    assert conn.commit_calls == 0


def test_load_result_rows_empty_batch_validates_archive_then_keeps_scoped_delete() -> None:
    conn = _RecordingConnection(archive_source_kind="fiscalizacion")

    assert (
        load_result_rows(
            conn,
            archive_entry_id="entry-1",
            election_id="election-1",
            records=[],
        )
        == 0
    )

    assert len(conn.statements) == 2
    assert "select source_kind" in conn.statements[0][0]
    assert "delete from result_row" in conn.statements[1][0]
    assert conn.statements[1][1] == ("entry-1", "election-1")


def test_load_result_rows_empty_batch_still_refuses_a_missing_archive() -> None:
    conn = _RecordingConnection(archive_source_kind=None)

    with pytest.raises(ArchiveEntryNotFoundError, match="archive_entry.*does not exist"):
        load_result_rows(
            conn,
            archive_entry_id="entry-1",
            election_id="election-1",
            records=[],
        )

    assert len(conn.statements) == 1
    assert "select source_kind" in conn.statements[0][0]


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
                    mesa_tipo="NATIVOS",
                    archive_entry_id=archive_entry_id,
                    source_row_index=len(rows),
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


def _record_archive_entry(
    conn: psycopg.Connection, archive_entry_id: str, *, source_kind: str = "official"
) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            insert into archive_entry (
                id, capability, source, source_url, mime, fetched_at, status, source_kind
            ) values (%s, 'integration-test', 'integration-test', %s, 'text/csv', now(), 'ok', %s)
            """,
            (archive_entry_id, f"https://example.invalid/{archive_entry_id}", source_kind),
        )


def _stored_result_records(
    conn: psycopg.Connection, archive_entry_id: str
) -> list[ResultRowRecord]:
    with conn.cursor() as cur:
        cur.execute(
            """
            select election_id, jurisdiction_id, category_id, granularity, list_id, votes,
                   source_kind, archive_entry_id, source_row_index, requested_granularity, mesa_tipo
            from result_row
            where archive_entry_id = %s
            order by source_row_index, list_id
            """,
            (archive_entry_id,),
        )
        return [ResultRowRecord(*row) for row in cur.fetchall()]


class _AuthorityPauseCursor:
    def __init__(
        self,
        cursor,
        *,
        archive_entry_id: str,
        authority_selected: threading.Event,
        continue_replacement: threading.Event,
    ) -> None:
        self._cursor = cursor
        self._archive_entry_id = archive_entry_id
        self._authority_selected = authority_selected
        self._continue_replacement = continue_replacement

    # pi-lens-ignore: python-sql-injection
    def execute(self, query, params=None):
        result = self._cursor.execute(query, params)
        if (
            isinstance(query, str)
            and "from archive_entry" in query.lower()
            and params == (self._archive_entry_id,)
        ):
            self._authority_selected.set()
            if not self._continue_replacement.wait(timeout=5):
                raise AssertionError("timed out while pausing after the archive authority read")
        return result

    def __enter__(self):
        self._cursor.__enter__()
        return self

    def __exit__(self, *exc_info):
        return self._cursor.__exit__(*exc_info)

    def __getattr__(self, name):
        return getattr(self._cursor, name)


class _AuthorityPauseConnection:
    def __init__(
        self,
        conn,
        *,
        archive_entry_id: str,
        authority_selected: threading.Event,
        continue_replacement: threading.Event,
    ) -> None:
        self._conn = conn
        self._archive_entry_id = archive_entry_id
        self._authority_selected = authority_selected
        self._continue_replacement = continue_replacement

    def cursor(self, *args, **kwargs):
        return _AuthorityPauseCursor(
            self._conn.cursor(*args, **kwargs),
            archive_entry_id=self._archive_entry_id,
            authority_selected=self._authority_selected,
            continue_replacement=self._continue_replacement,
        )

    def __getattr__(self, name):
        return getattr(self._conn, name)


def test_load_result_rows_locks_archive_authority_through_the_replacement_transaction() -> None:
    probe = _require_ephemeral_postgres()
    probe.close()
    archive_entry_id = f"national/source-authority-lock-{uuid.uuid4()}"
    authority_selected = threading.Event()
    continue_replacement = threading.Event()
    source_kind_update_started = threading.Event()
    source_kind_updated = threading.Event()
    rollback_source_kind_update = threading.Event()

    with psycopg.connect(TEST_DSN) as seed_conn:
        _record_archive_entry(seed_conn, archive_entry_id, source_kind="official")
        load_national_rows(
            seed_conn,
            _fixture_rows(archive_entry_id),
            year=2025,
            round_="legislativas",
            archive_entry_id=archive_entry_id,
        )
        replacements = [
            replace(record, votes=record.votes + 1)
            for record in _stored_result_records(seed_conn, archive_entry_id)
        ]

    def replace_rows() -> int:
        conn = psycopg.connect(TEST_DSN)
        try:
            paused_conn = _AuthorityPauseConnection(
                conn,
                archive_entry_id=archive_entry_id,
                authority_selected=authority_selected,
                continue_replacement=continue_replacement,
            )
            inserted = load_result_rows(
                paused_conn,
                archive_entry_id=archive_entry_id,
                election_id=replacements[0].election_id,
                records=replacements,
            )
            conn.commit()
            return inserted
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    def try_source_kind_update() -> None:
        conn = psycopg.connect(TEST_DSN)
        try:
            with conn.cursor() as cur:
                cur.execute("set role etl_writer")
                cur.execute("set local lock_timeout = '5s'")
                source_kind_update_started.set()
                cur.execute(
                    "update archive_entry set source_kind = 'fiscalizacion' where id = %s",
                    (archive_entry_id,),
                )
                assert cur.rowcount == 1
            source_kind_updated.set()
            if not rollback_source_kind_update.wait(timeout=5):
                raise AssertionError("timed out before rolling back the competing authority update")
        finally:
            conn.rollback()
            conn.close()

    executor = ThreadPoolExecutor(max_workers=2)
    update_completed_before_replacement = False
    try:
        replacement_future = executor.submit(replace_rows)
        assert authority_selected.wait(timeout=5), "the loader never reached its authority read"
        update_future = executor.submit(try_source_kind_update)
        assert source_kind_update_started.wait(timeout=5), "the updater never attempted its UPDATE"
        update_completed_before_replacement = source_kind_updated.wait(timeout=0.5)
        continue_replacement.set()
        assert replacement_future.result(timeout=5) == len(replacements)
        assert source_kind_updated.wait(timeout=5), "the updater stayed blocked after loader commit"
        rollback_source_kind_update.set()
        update_future.result(timeout=5)

        with psycopg.connect(TEST_DSN) as verify_conn:
            with verify_conn.cursor() as cur:
                cur.execute(
                    "select source_kind from archive_entry where id = %s", (archive_entry_id,)
                )
                assert cur.fetchone() == ("official",)
            assert _stored_result_records(verify_conn, archive_entry_id) == replacements

        assert not update_completed_before_replacement, (
            "a non-key source_kind UPDATE completed after the authority read but before "
            "result replacement; the authority row must stay locked through caller commit"
        )
    finally:
        continue_replacement.set()
        rollback_source_kind_update.set()
        executor.shutdown(wait=True)
        with psycopg.connect(TEST_DSN) as cleanup_conn:
            with cleanup_conn.cursor() as cur:
                cur.execute(
                    "delete from result_row where archive_entry_id = %s", (archive_entry_id,)
                )
                cur.execute("delete from archive_entry where id = %s", (archive_entry_id,))


def test_load_result_rows_does_not_lock_an_unrelated_archive_authority() -> None:
    probe = _require_ephemeral_postgres()
    probe.close()
    target_archive_entry_id = f"national/source-authority-target-{uuid.uuid4()}"
    unrelated_archive_entry_id = f"national/source-authority-unrelated-{uuid.uuid4()}"
    authority_selected = threading.Event()
    continue_replacement = threading.Event()

    with psycopg.connect(TEST_DSN) as seed_conn:
        _record_archive_entry(seed_conn, target_archive_entry_id, source_kind="official")
        _record_archive_entry(seed_conn, unrelated_archive_entry_id, source_kind="official")
        load_national_rows(
            seed_conn,
            _fixture_rows(target_archive_entry_id),
            year=2025,
            round_="legislativas",
            archive_entry_id=target_archive_entry_id,
        )
        replacements = _stored_result_records(seed_conn, target_archive_entry_id)

    def replace_rows() -> int:
        conn = psycopg.connect(TEST_DSN)
        try:
            paused_conn = _AuthorityPauseConnection(
                conn,
                archive_entry_id=target_archive_entry_id,
                authority_selected=authority_selected,
                continue_replacement=continue_replacement,
            )
            inserted = load_result_rows(
                paused_conn,
                archive_entry_id=target_archive_entry_id,
                election_id=replacements[0].election_id,
                records=replacements,
            )
            conn.commit()
            return inserted
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    executor = ThreadPoolExecutor(max_workers=1)
    try:
        replacement_future = executor.submit(replace_rows)
        assert authority_selected.wait(timeout=5), "the loader never reached its authority read"
        with psycopg.connect(TEST_DSN) as unrelated_conn:
            with unrelated_conn.cursor() as cur:
                cur.execute("set role etl_writer")
                cur.execute("set local lock_timeout = '500ms'")
                cur.execute(
                    "update archive_entry set source_kind = 'fiscalizacion' where id = %s",
                    (unrelated_archive_entry_id,),
                )
                assert cur.rowcount == 1
            unrelated_conn.rollback()
        continue_replacement.set()
        assert replacement_future.result(timeout=5) == len(replacements)
    finally:
        continue_replacement.set()
        executor.shutdown(wait=True)
        with psycopg.connect(TEST_DSN) as cleanup_conn:
            with cleanup_conn.cursor() as cur:
                cur.execute(
                    "delete from result_row where archive_entry_id = %s",
                    (target_archive_entry_id,),
                )
                cur.execute(
                    "delete from archive_entry where id = any(%s::text[])",
                    ([target_archive_entry_id, unrelated_archive_entry_id],),
                )


def test_load_result_rows_rejects_uniform_fiscalizacion_for_official_archive_unchanged(
    pg_conn: psycopg.Connection,
) -> None:
    archive_entry_id = f"national/source-authority-{uuid.uuid4()}"
    _record_archive_entry(pg_conn, archive_entry_id, source_kind="official")
    load_national_rows(
        pg_conn,
        _fixture_rows(archive_entry_id),
        year=2025,
        round_="legislativas",
        archive_entry_id=archive_entry_id,
    )
    before = _stored_result_records(pg_conn, archive_entry_id)
    fiscalizacion_records = [replace(record, source_kind="fiscalizacion") for record in before]

    with pytest.raises(
        ArchiveEntrySourceKindMismatchError,
        match="archive_entry.*source_kind.*official.*fiscalizacion",
    ):
        load_result_rows(
            pg_conn,
            archive_entry_id=archive_entry_id,
            election_id=before[0].election_id,
            records=fiscalizacion_records,
        )

    assert _stored_result_records(pg_conn, archive_entry_id) == before


def test_load_result_rows_rejects_missing_archive_entry_without_inserting(
    pg_conn: psycopg.Connection,
) -> None:
    seed_archive_entry_id = f"national/source-authority-seed-{uuid.uuid4()}"
    missing_archive_entry_id = f"national/source-authority-missing-{uuid.uuid4()}"
    _record_archive_entry(pg_conn, seed_archive_entry_id)
    load_national_rows(
        pg_conn,
        _fixture_rows(seed_archive_entry_id),
        year=2025,
        round_="legislativas",
        archive_entry_id=seed_archive_entry_id,
    )
    seed_records = _stored_result_records(pg_conn, seed_archive_entry_id)
    missing_records = [
        replace(record, archive_entry_id=missing_archive_entry_id) for record in seed_records
    ]

    with pytest.raises(ArchiveEntryNotFoundError, match="archive_entry.*does not exist"):
        load_result_rows(
            pg_conn,
            archive_entry_id=missing_archive_entry_id,
            election_id=seed_records[0].election_id,
            records=missing_records,
        )

    assert _stored_result_records(pg_conn, missing_archive_entry_id) == []
    assert _stored_result_records(pg_conn, seed_archive_entry_id) == seed_records


def test_ephemeral_postgres_reingest_matches_original(pg_conn: psycopg.Connection) -> None:
    """Task 8.2: re-running `load_national_rows` for the SAME archive entry
    with the SAME rows leaves `result_row` identical -- D8's
    delete-by-`archive_entry_id` step is what makes re-ingestion safe.
    """
    archive_entry_id = f"test-national-{uuid.uuid4()}"
    rows = _fixture_rows(archive_entry_id)
    _record_archive_entry(pg_conn, archive_entry_id)

    inserted_first = load_national_rows(
        pg_conn,
        rows,
        year=2025,
        round_="legislativas",
        archive_entry_id=archive_entry_id,
    )
    first_snapshot = _snapshot(pg_conn, archive_entry_id)

    inserted_second = load_national_rows(
        pg_conn,
        rows,
        year=2025,
        round_="legislativas",
        archive_entry_id=archive_entry_id,
    )
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
    _record_archive_entry(pg_conn, archive_entry_id)

    load_national_rows(
        pg_conn,
        rows,
        year=2025,
        round_="legislativas",
        archive_entry_id=archive_entry_id,
    )
    original_snapshot = _snapshot(pg_conn, archive_entry_id)
    assert original_snapshot  # sanity: the fixture actually produced rows

    with pg_conn.cursor() as cur:
        cur.execute("truncate table result_row")
    assert _snapshot(pg_conn, archive_entry_id) == set()

    load_national_rows(
        pg_conn,
        rows,
        year=2025,
        round_="legislativas",
        archive_entry_id=archive_entry_id,
    )
    rebuilt_snapshot = _snapshot(pg_conn, archive_entry_id)

    assert rebuilt_snapshot == original_snapshot


def test_insert_review_items_reports_actual_insert_count_at_boundary() -> None:
    conn = _RecordingConnection()
    record = ReviewItemRecord(
        kind="content_drift",
        severity="warning",
        subject_ref="source:test",
        note=None,
        section_scopes=(ReviewItemSectionScope("02", "027"),),
    )

    assert insert_review_items(conn, [record, record]) == 1
    query, params = conn.statements[-1]
    assert "workspace_private.record_review_item" in query
    candidates = json.loads(params[0])
    assert candidates == [
        {
            "kind": "content_drift",
            "severity": "warning",
            "subject_ref": "source:test",
            "note": None,
            "distrito_codes": ["02"],
            "seccion_codes": ["027"],
        }
    ]


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


def test_insert_review_items_suppresses_in_batch_and_sequential_active_replays(
    pg_conn: psycopg.Connection,
) -> None:
    subject_ref = f"active-replay:{uuid.uuid4()}"
    record = ReviewItemRecord(
        kind="content_drift",
        severity="warning",
        subject_ref=subject_ref,
        note=None,
    )

    assert insert_review_items(pg_conn, [record, record]) == 1
    assert insert_review_items(pg_conn, [record]) == 0

    with pg_conn.cursor() as cur:
        cur.execute(
            "select count(*) from review_item where subject_ref = %s and resolved_at is null",
            (subject_ref,),
        )
        assert cur.fetchone() == (1,)


def test_insert_review_items_preserves_resolved_history_and_inserts_a_recurrence(
    pg_conn: psycopg.Connection,
) -> None:
    subject_ref = f"resolved-recurrence:{uuid.uuid4()}"
    record = ReviewItemRecord(
        kind="content_drift",
        severity="warning",
        subject_ref=subject_ref,
        note=None,
    )

    assert insert_review_items(pg_conn, [record]) == 1
    with pg_conn.cursor() as cur:
        cur.execute(
            "update review_item set resolved_at = now() where subject_ref = %s",
            (subject_ref,),
        )

    assert insert_review_items(pg_conn, [record]) == 1
    with pg_conn.cursor() as cur:
        cur.execute(
            "select count(*), count(*) filter (where resolved_at is null) "
            "from review_item where subject_ref = %s",
            (subject_ref,),
        )
        assert cur.fetchone() == (2, 1)


def test_insert_review_items_rejects_autocommit_before_database_access() -> None:
    conn = _RecordingConnection()
    conn.autocommit = True
    record = ReviewItemRecord("content_drift", "warning", "autocommit:test", None)

    with pytest.raises(RuntimeError, match="require a transaction; autocommit"):
        insert_review_items(conn, [record])

    assert conn.cursor_calls == 0
    assert conn.statements == []


def test_insert_review_items_rejects_repeatable_read_before_insert_boundary() -> None:
    probe = _require_ephemeral_postgres()
    probe.close()
    subject_ref = f"repeatable-read-rejection:{uuid.uuid4()}"
    record = ReviewItemRecord("content_drift", "warning", subject_ref, None)

    conn = psycopg.connect(TEST_DSN)
    try:
        with conn.cursor() as cur:
            cur.execute("begin isolation level repeatable read")
            cur.execute("show transaction_isolation")
            assert cur.fetchone() == ("repeatable read",)

        with pytest.raises(ReviewItemTransactionIsolationError, match="requires read committed"):
            insert_review_items(conn, [record])

        with conn.cursor() as cur:
            cur.execute(
                "select count(*) from review_item where subject_ref = %s",
                (subject_ref,),
            )
            assert cur.fetchone() == (0,)
    finally:
        conn.rollback()
        conn.close()


def test_insert_review_items_rejects_serializable_before_insert_boundary() -> None:
    probe = _require_ephemeral_postgres()
    probe.close()
    subject_ref = f"serializable-rejection:{uuid.uuid4()}"
    record = ReviewItemRecord("content_drift", "warning", subject_ref, None)

    conn = psycopg.connect(TEST_DSN)
    try:
        with conn.cursor() as cur:
            cur.execute("begin isolation level serializable")
            cur.execute("show transaction_isolation")
            assert cur.fetchone() == ("serializable",)

        with pytest.raises(ReviewItemTransactionIsolationError, match="requires read committed"):
            insert_review_items(conn, [record])
        with conn.cursor() as cur:
            cur.execute(
                "select count(*) from review_item where subject_ref = %s",
                (subject_ref,),
            )
            assert cur.fetchone() == (0,)
    finally:
        conn.rollback()
        conn.close()


def test_insert_review_items_accepts_explicit_read_committed_transaction() -> None:
    probe = _require_ephemeral_postgres()
    probe.close()
    subject_ref = f"read-committed-success:{uuid.uuid4()}"
    record = ReviewItemRecord("content_drift", "warning", subject_ref, None)

    conn = psycopg.connect(TEST_DSN)
    try:
        with conn.cursor() as cur:
            cur.execute("begin isolation level read committed")
            cur.execute("show transaction_isolation")
            assert cur.fetchone() == ("read committed",)

        assert insert_review_items(conn, [record]) == 1
        with conn.cursor() as cur:
            cur.execute(
                "select count(*) from review_item where subject_ref = %s and resolved_at is null",
                (subject_ref,),
            )
            assert cur.fetchone() == (1,)
    finally:
        conn.rollback()
        conn.close()


def test_insert_review_items_serializes_concurrent_application_writers() -> None:
    probe = _require_ephemeral_postgres()
    probe.close()
    subject_ref = f"concurrent-active:{uuid.uuid4()}"
    record = ReviewItemRecord(
        kind="content_drift",
        severity="warning",
        subject_ref=subject_ref,
        note=None,
    )
    ready = threading.Barrier(2)

    def write_once() -> int:
        conn = psycopg.connect(TEST_DSN)
        try:
            with conn.cursor() as cur:
                cur.execute("begin isolation level read committed")
                cur.execute("show transaction_isolation")
                assert cur.fetchone() == ("read committed",)
            ready.wait(timeout=5)
            inserted = insert_review_items(conn, [record])
            conn.commit()
            return inserted
        finally:
            conn.close()

    try:
        with ThreadPoolExecutor(max_workers=2) as executor:
            counts = sorted(executor.map(lambda _index: write_once(), range(2)))
        assert counts == [0, 1]

        with psycopg.connect(TEST_DSN) as conn, conn.cursor() as cur:
            cur.execute(
                "select count(*) from review_item where subject_ref = %s and resolved_at is null",
                (subject_ref,),
            )
            assert cur.fetchone() == (1,)
    finally:
        with psycopg.connect(TEST_DSN) as conn, conn.cursor() as cur:
            cur.execute("delete from review_item where subject_ref = %s", (subject_ref,))


def test_two_elections_in_one_archive_entry_do_not_collide(
    pg_conn: psycopg.Connection,
) -> None:
    """`result_row`'s natural key must include `election_id`.

    D8 guarantees idempotency by `(archive_entry, natural key)`. The unique
    constraint written in migration 0002 was
    `(archive_entry_id, jurisdiction_id, category_id, list_id, source_kind)` --
    it omits `election_id`, even though the column is `not null` and ingestion
    always writes it.

    That holds only while one archived file contains exactly one election. It
    stops holding for a multi-year source, and one is already identified for
    this project: the PBA open-data catalogue publishes
    `elecciones-generales-2005-2023.csv`, nineteen years of results in a single
    file. Ingesting it would make a 2005 row and a 2023 row for the same
    jurisdiction, category and list collide as duplicates of one natural key,
    so the second silently overwrites the first.
    """
    archive_entry_id = f"test-multiyear-{uuid.uuid4()}"
    _record_archive_entry(pg_conn, archive_entry_id)

    rows_2023 = _fixture_rows(archive_entry_id)
    inserted_2023 = load_national_rows(
        pg_conn,
        rows_2023,
        year=2023,
        round_="generales",
        archive_entry_id=archive_entry_id,
    )

    rows_2025 = _fixture_rows(archive_entry_id)
    inserted_2025 = load_national_rows(
        pg_conn,
        rows_2025,
        year=2025,
        round_="legislativas",
        archive_entry_id=archive_entry_id,
    )

    with pg_conn.cursor() as cur:
        cur.execute(
            """
            select count(distinct election_id), count(*)
            from result_row
            where archive_entry_id = %s
            """,
            (archive_entry_id,),
        )
        count_row = cur.fetchone()
        assert count_row is not None
        distinct_elections, total_rows = count_row

    assert inserted_2023 == len(rows_2023)
    assert inserted_2025 == len(rows_2025)
    assert distinct_elections == 2, (
        f"both elections must survive in the same archive entry; only {distinct_elections} did"
    )
    assert total_rows == len(rows_2023) + len(rows_2025), (
        "rows from the two elections collided on a natural key that omits "
        f"election_id: expected {len(rows_2023) + len(rows_2025)}, got {total_rows}"
    )


class _CountingCursorProxy:
    """Wraps a real psycopg cursor, counting every `execute`/`executemany`
    call so a test can assert on the number of round trips a function
    issues without needing a network-level mock -- `pg_conn` stays a real
    ephemeral Postgres connection throughout.
    """

    def __init__(self, cursor, counter: dict[str, int]) -> None:
        self._cursor = cursor
        self._counter = counter

    def execute(self, *args, **kwargs):
        self._counter["count"] += 1
        return self._cursor.execute(*args, **kwargs)

    def executemany(self, *args, **kwargs):
        self._counter["count"] += 1
        return self._cursor.executemany(*args, **kwargs)

    def __enter__(self):
        return self

    def __exit__(self, *exc_info):
        return self._cursor.__exit__(*exc_info)

    def __getattr__(self, name):
        return getattr(self._cursor, name)


class _CountingConnectionProxy:
    """Wraps a real `psycopg.Connection`, handing out `_CountingCursorProxy`
    cursors so every `execute`/`executemany` call made through this
    connection is counted -- everything else (`commit`, `rollback`, ...)
    passes straight through to the real connection.
    """

    def __init__(self, conn) -> None:
        self._conn = conn
        self.counter: dict[str, int] = {"count": 0}

    def cursor(self, *args, **kwargs):
        return _CountingCursorProxy(self._conn.cursor(*args, **kwargs), self.counter)

    def __getattr__(self, name):
        return getattr(self._conn, name)


def test_padded_and_unpadded_national_codes_share_one_jurisdiction_row(
    pg_conn: psycopg.Connection,
) -> None:
    """Task 17.1/17.4, proven against real Postgres: `upsert_jurisdiction`
    resolves national ingestion's raw unpadded distrito/seccion (`"2"`/`"27"`)
    and fiscalización's curated padded form (`"02"`/`"027"`) to the SAME
    `jurisdiction.id` for the same real mesa, instead of the pre-fix
    behaviour (two distinct rows -- one of Coronel Rosales's three measured
    jurisdiction identities).
    """
    # A mesa number unlikely to collide with the real corpus already loaded
    # in this environment (`spikes/004-full-corpus-load.md`'s real data uses
    # ordinary mesa numbers well under this range).
    mesa = 900001

    unpadded_id = upsert_jurisdiction(
        pg_conn, distrito="2", seccion="27", circuito="00248", mesa=mesa
    )
    padded_id = upsert_jurisdiction(
        pg_conn, distrito="02", seccion="027", circuito="00248", mesa=mesa
    )

    assert unpadded_id == padded_id

    with pg_conn.cursor() as cur:
        cur.execute(
            "select count(*) from jurisdiction where circuito_code = %s and mesa_code = %s",
            ("00248", mesa),
        )
        count_row = cur.fetchone()
        assert count_row is not None
        (count,) = count_row
    assert count == 1, "expected exactly one jurisdiction row, not a padding-only duplicate"


def test_jurisdiction_resolution_is_batched_not_per_row(pg_conn: psycopg.Connection) -> None:
    """Task 14.4: the number of database round trips `load_national_rows`
    issues to resolve jurisdiction ids must be bounded by a SMALL CONSTANT,
    never proportional to the number of distinct mesas in the batch.

    This is the real, measured N+1 from `spikes/003-first-end-to-end-run.md`:
    ~109k distinct jurisdictions at real national 2025 scale, one
    SELECT-then-INSERT round trip per first-seen mesa, 5m53s wall-clock at
    13% CPU (latency-bound, not compute-bound). This test proves the shape
    of the fix with 50 distinct mesas -- large enough that a per-row
    pattern would trivially blow past any small constant, without needing
    real national-scale fixtures to prove it.
    """
    archive_entry_id = f"test-batched-{uuid.uuid4()}"
    distinct_mesa_count = 50
    rows: list[NationalRow] = []
    for mesa in range(1, distinct_mesa_count + 1):
        result = make_result_row(
            granularity="mesa",
            distrito="02",
            seccion="027",
            circuito="01",
            mesa=mesa,
            category="DIPUTADO NACIONAL",
            list_id="135",
            votes=10,
        )
        rows.append(
            NationalRow(
                result=result,
                estado_final=None,
                mesa_tipo="NATIVOS",
                archive_entry_id=archive_entry_id,
                source_row_index=len(rows),
            )
        )

    _record_archive_entry(pg_conn, archive_entry_id)
    counting_conn = _CountingConnectionProxy(pg_conn)
    inserted = load_national_rows(
        counting_conn,
        rows,
        year=2025,
        round_="legislativas",
        archive_entry_id=archive_entry_id,
    )

    assert inserted == distinct_mesa_count
    # A per-row SELECT-then-INSERT pattern would issue at least
    # 2 * distinct_mesa_count = 100 round trips just for jurisdiction
    # resolution. A batched resolution issues a small, fixed number of
    # round trips (election, category, jurisdiction-resolve,
    # jurisdiction-insert, result_row delete, result_row insert) that does
    # not grow with the number of distinct mesas.
    assert counting_conn.counter["count"] < 10, (
        f"expected a small, bounded number of round trips, got "
        f"{counting_conn.counter['count']} for {distinct_mesa_count} distinct mesas "
        "-- looks like a per-row SELECT-then-INSERT pattern is still present"
    )


def test_a_reingest_that_now_yields_no_national_rows_clears_the_old_ones(
    pg_conn: psycopg.Connection,
) -> None:
    """The delete-then-insert pair is the idempotency guarantee, and both
    halves must run even when the batch is empty.

    `load_national_rows` returned 0 on an empty batch WITHOUT calling
    `db.load_result_rows`, so the delete never ran: a source that stops
    parsing -- a re-skinned page, a drifted header, a crosswalk entry
    removed -- left the PREVIOUS run's rows alive and indistinguishable from
    current, while the CLI printed "ingested 0 rows" and exited 0.
    `load_fiscalizacion_rows` already fixed exactly this.
    """
    archive_entry_id = f"national/empty-reingest-{uuid.uuid4()}"
    rows = _fixture_rows(archive_entry_id)
    assert rows, "sanity: the fixture must produce rows"
    _record_archive_entry(pg_conn, archive_entry_id)

    try:
        load_national_rows(
            pg_conn,
            rows,
            year=2025,
            round_="legislativas",
            archive_entry_id=archive_entry_id,
        )
        with pg_conn.cursor() as cur:
            cur.execute(
                "select count(*) from result_row where archive_entry_id = %s",
                (archive_entry_id,),
            )
            count_row = cur.fetchone()
            assert count_row is not None
            assert count_row[0] > 0

        load_national_rows(
            pg_conn,
            [],
            year=2025,
            round_="legislativas",
            archive_entry_id=archive_entry_id,
        )
        with pg_conn.cursor() as cur:
            cur.execute(
                "select count(*) from result_row where archive_entry_id = %s",
                (archive_entry_id,),
            )
            count_row = cur.fetchone()
            assert count_row is not None
            assert count_row[0] == 0, "the stale rows must not survive"
    finally:
        with pg_conn.cursor() as cur:
            cur.execute("delete from result_row where archive_entry_id = %s", (archive_entry_id,))
            cur.execute("delete from archive_entry where id = %s", (archive_entry_id,))
        pg_conn.commit()


def test_an_empty_national_reingest_leaves_another_election_on_the_entry_alone(
    pg_conn: psycopg.Connection,
) -> None:
    """The delete is ELECTION-scoped, so clearing 2025 must not take 2023's
    rows on the same archive entry with it."""
    archive_entry_id = f"national/empty-scope-{uuid.uuid4()}"
    rows = _fixture_rows(archive_entry_id)
    _record_archive_entry(pg_conn, archive_entry_id)

    try:
        load_national_rows(
            pg_conn,
            rows,
            year=2023,
            round_="generales",
            archive_entry_id=archive_entry_id,
        )
        load_national_rows(
            pg_conn,
            rows,
            year=2025,
            round_="legislativas",
            archive_entry_id=archive_entry_id,
        )
        load_national_rows(
            pg_conn,
            [],
            year=2025,
            round_="legislativas",
            archive_entry_id=archive_entry_id,
        )

        with pg_conn.cursor() as cur:
            cur.execute(
                """
                select e.year, count(*)
                  from result_row r join election e on e.id = r.election_id
                 where r.archive_entry_id = %s
                 group by e.year
                """,
                (archive_entry_id,),
            )
            by_year = dict(cur.fetchall())
        assert by_year.get(2023, 0) > 0, "2023 must survive an empty 2025 re-ingest"
        assert by_year.get(2025, 0) == 0
    finally:
        with pg_conn.cursor() as cur:
            cur.execute("delete from result_row where archive_entry_id = %s", (archive_entry_id,))
            cur.execute("delete from archive_entry where id = %s", (archive_entry_id,))
        pg_conn.commit()
