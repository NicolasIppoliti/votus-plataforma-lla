"""Small owned-database proofs for #479 and #481; no source archives."""

from contextlib import contextmanager
from dataclasses import replace

import pytest
from test_integration_idempotent import (
    _fixture_rows,
    _record_archive_entry,
    _stored_result_records,
)
from test_jurisdiction_index import MIGRATION, ROOT

from etl.db import load_result_rows
from etl.ingest.national import load_national_rows


def test_boundary_migration_assets_exist():
    """Keep the ordinary partition focused on the same migration assets."""
    assert (ROOT / "supabase/migrations" / f"{MIGRATION}.sql").is_file()
    assert (ROOT / "supabase/migrations/down" / f"{MIGRATION}.down.sql").is_file()


class InjectedInterruption(KeyboardInterrupt):
    pass


class InterruptingConnection:
    """Delegate real SQL and interrupt only after an observed completed boundary."""

    def __init__(self, conn, boundary):
        self.conn = conn
        self.boundary = boundary
        self.observed = []

    def __getattr__(self, name):
        return getattr(self.conn, name)

    @contextmanager
    def cursor(self):
        owner = self
        with self.conn.cursor() as real:

            class Cursor:
                def __getattr__(self, name):
                    return getattr(real, name)

                def execute(self, query, params=None):
                    result = real.execute(query, params)
                    if "delete from result_row" in query.lower():
                        owner.observed.append("delete")
                        assert real.rowcount > 0
                        if owner.boundary == "delete":
                            raise InjectedInterruption("after DELETE")
                    return result

                @contextmanager
                def copy(self, query):
                    with real.copy(query) as copy:
                        yield copy
                    # COPY has exited successfully, not merely accepted write_row calls.
                    staging = query.split()[1]
                    assert staging.startswith("pg_temp.result_rows_")
                    real.execute(f"select count(*) from {staging}")
                    assert real.fetchone()[0] > 0
                    owner.observed.append("copy")
                    if owner.boundary == "copy":
                        raise InjectedInterruption("after COPY")

            yield Cursor()


@pytest.mark.owned_database
@pytest.mark.parametrize("boundary", ["delete", "copy"])
def test_shared_writer_interruption_restores_complete_projection(owned_database, boundary):
    with owned_database.connect() as conn:
        archives = [
            f"national/boundary-{boundary}-{scope}" for scope in ("target", "other", "fiscal")
        ]
        for archive in archives:
            kind = "fiscalizacion" if archive == archives[2] else "official"
            _record_archive_entry(conn, archive, source_kind=kind)
            # Establish real dimensions via the production loader, then use its shared writer.
            if kind == "official":
                load_national_rows(
                    conn,
                    _fixture_rows(archive),
                    year=2025,
                    round_="legislativas",
                    archive_entry_id=archive,
                )
        target = _stored_result_records(conn, archives[0])
        load_result_rows(
            conn,
            archive_entry_id=archives[2],
            election_id=target[0].election_id,
            records=[
                replace(row, archive_entry_id=archives[2], source_kind="fiscalizacion")
                for row in target
            ],
        )
        # Same archive, different election is another independent replacement scope.
        load_national_rows(
            conn,
            _fixture_rows(archives[0]),
            year=2023,
            round_="generales",
            archive_entry_id=archives[0],
        )

        def snapshot():
            return conn.execute("select * from result_row order by id").fetchall()

        before = snapshot()
        assert all(_stored_result_records(conn, archive) for archive in archives)
        assert len({r.election_id for r in _stored_result_records(conn, archives[0])}) == 2
        interrupted = InterruptingConnection(conn, boundary)
        with pytest.raises(InjectedInterruption), conn.transaction():
            load_result_rows(
                interrupted,
                archive_entry_id=archives[0],
                election_id=target[0].election_id,
                records=[replace(row, votes=row.votes + 99) for row in target],
            )
        assert interrupted.observed == (["delete"] if boundary == "delete" else ["delete", "copy"])
        assert snapshot() == before
        conn.rollback()


@pytest.mark.owned_database
def test_merge_key_index_forward_down_reapply_preserves_grants(owned_database):
    forward = (ROOT / "supabase/migrations" / f"{MIGRATION}.sql").read_text()
    down = (ROOT / "supabase/migrations/down" / f"{MIGRATION}.down.sql").read_text()
    with owned_database.connect() as conn:

        def state():
            return conn.execute(
                "select to_regclass('public.jurisdiction_merge_key_idx'), relacl "
                "from pg_class where oid = 'public.jurisdiction'::regclass"
            ).fetchone()

        initial_index, grants = state()
        assert initial_index is not None
        assert grants is not None
        # The owned fixture has all forwards applied. Return to the pre-index state first.
        conn.execute(down)
        assert state() == (None, grants)
        conn.execute(forward)
        assert state() == (initial_index, grants)
        conn.execute(down)
        assert state() == (None, grants)
        conn.execute(forward)
        assert state() == (initial_index, grants)
        conn.rollback()
