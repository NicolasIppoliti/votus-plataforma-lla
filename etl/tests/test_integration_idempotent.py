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

from etl.db import insert_review_items, upsert_jurisdiction
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
                    mesa_tipo="NATIVOS",
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

    rows_2023 = _fixture_rows(archive_entry_id)
    inserted_2023 = load_national_rows(
        pg_conn, rows_2023, year=2023, round_="generales"
    )

    rows_2025 = _fixture_rows(archive_entry_id)
    inserted_2025 = load_national_rows(
        pg_conn, rows_2025, year=2025, round_="legislativas"
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
        distinct_elections, total_rows = cur.fetchone()

    assert inserted_2023 == len(rows_2023)
    assert inserted_2025 == len(rows_2025)
    assert distinct_elections == 2, (
        "both elections must survive in the same archive entry; "
        f"only {distinct_elections} did"
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
        (count,) = cur.fetchone()
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
                natural_key=(
                    archive_entry_id,
                    mesa,
                    "135",
                    "DIPUTADO NACIONAL",
                    "POSITIVO",
                ),
            )
        )

    counting_conn = _CountingConnectionProxy(pg_conn)
    inserted = load_national_rows(counting_conn, rows, year=2025, round_="legislativas")

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
