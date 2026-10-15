"""Exact-expression migration and real resolver plan contracts for #481."""

import json
import os
from pathlib import Path

import psycopg
import pytest

from etl.db import MERGE_KEY_SQL

ROOT = Path(__file__).resolve().parents[2]
MIGRATION = "20261015100000_jurisdiction_merge_key_index"


def test_index_matches_the_resolver_expression_without_changing_grants():
    forward = (ROOT / "supabase/migrations" / f"{MIGRATION}.sql").read_text()
    down = (ROOT / "supabase/migrations/down" / f"{MIGRATION}.down.sql").read_text()
    # Alias removal must be the only difference from the production expression.
    expression = MERGE_KEY_SQL.replace("j.", "")
    assert f"(({expression}))" in forward
    assert "create index jurisdiction_merge_key_idx" in forward.lower()
    assert "unique" not in forward.lower()
    assert "analyze public.jurisdiction" in forward.lower()
    assert "drop index public.jurisdiction_merge_key_idx" in down.lower()
    for statement in (forward.lower(), down.lower()):
        assert "grant " not in statement
        assert "revoke " not in statement


class RecordingConnection:
    """Delegate writes unchanged and retain the actual lookup, not a facsimile."""

    autocommit = False

    def __init__(self, conn):
        self.conn = conn
        self.lookup = None

    def cursor(self):
        recorder = self

        class Cursor:
            def __enter__(self):
                self.cursor = recorder.conn.cursor()
                self.cursor.__enter__()
                return self

            def __exit__(self, *args):
                return self.cursor.__exit__(*args)

            def execute(self, query, params=None):
                text = query if isinstance(query, str) else query.as_string(recorder.conn)
                if "left join jurisdiction j" in text:
                    recorder.lookup = (text, params)
                return self.cursor.execute(query, params)

            def __getattr__(self, name):
                return getattr(self.cursor, name)

        return Cursor()


def test_writer_statistics_privileges():
    """Observe existing grants without changing roles, ACLs or live statistics."""
    dsn = os.environ.get(
        "ETL_TEST_DATABASE_URL", "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
    )
    try:
        conn = psycopg.connect(dsn, connect_timeout=2)
    except psycopg.OperationalError:
        pytest.skip("local ETL test database unavailable")
    with conn:
        row = conn.execute(
            """select r.rolsuper,
            pg_has_role(r.oid, c.relowner, 'USAGE'),
            has_table_privilege(r.oid, c.oid, 'MAINTAIN'),
            current_setting('autovacuum'),
            current_setting('autovacuum_analyze_threshold'),
            current_setting('autovacuum_analyze_scale_factor'), c.reloptions
            from pg_roles r cross join pg_class c
            where r.rolname = 'etl_writer' and c.oid = 'public.jurisdiction'::regclass"""
        ).fetchone()
        assert row is not None
        print(
            "WRITER STATISTICS PRIVILEGES (superuser, owner-membership, MAINTAIN, "
            "autovacuum, analyze-threshold, analyze-scale-factor, table-options):",
            row,
        )


def _nodes(plan):
    yield plan
    for child in plan.get("Plans", []):
        yield from _nodes(child)


def test_real_resolver_plans_on_populated_dimension():
    from etl.db import batch_upsert_jurisdictions

    dsn = os.environ.get(
        "ETL_TEST_DATABASE_URL", "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
    )
    try:
        conn = psycopg.connect(dsn, connect_timeout=2)
    except psycopg.OperationalError:
        pytest.skip("local ETL test database unavailable")
    with conn:
        # Shadow only this session's table; never mutate the live dimension.
        conn.execute(
            "create temp table jurisdiction "
            "(like public.jurisdiction including defaults including indexes)"
        )
        # Exercise a migrated empty dimension first, including repeated hits.
        conn.execute("savepoint empty_candidate")
        migration = (ROOT / "supabase/migrations" / f"{MIGRATION}.sql").read_text()
        conn.execute(migration.replace("public.jurisdiction", "pg_temp.jurisdiction"))
        from etl.db import JurisdictionNameConflictError
        from etl.jurisdiction import JurisdictionNames

        alias = ("2", "27", "1", "Escaped|fixture\\", None)
        canonical = ("02", "027", "00001", "Escaped|fixture\\", None)
        original = batch_upsert_jurisdictions(conn, [alias])[alias]
        assert (
            batch_upsert_jurisdictions(
                conn, [canonical], names=[JurisdictionNames(establecimiento="Fixture school")]
            )[canonical]
            == original
        )
        assert batch_upsert_jurisdictions(conn, [alias])[alias] == original
        with pytest.raises(JurisdictionNameConflictError):
            batch_upsert_jurisdictions(
                conn, [alias], names=[JurisdictionNames(establecimiento="Changed school")]
            )
        conn.execute(
            """insert into jurisdiction
            (distrito_code, seccion_code, circuito_code, establecimiento_code, mesa_code)
            values (%s, %s, %s, %s, %s)""",
            canonical,
        )
        with pytest.raises(RuntimeError, match="more than one jurisdiction"):
            batch_upsert_jurisdictions(conn, [canonical])
        growing = RecordingConnection(conn)
        keys = [("02", "027", "00001", "Plan fixture", i) for i in range(1, 33)]
        batch_upsert_jurisdictions(growing, keys)
        conn.execute(
            """insert into jurisdiction
            (distrito_code, seccion_code, circuito_code, establecimiento_code, mesa_code)
            select '02', '027', '00001', 'Plan fixture', i
            from generate_series(33, 108141) i"""
        )
        growing_query, growing_params = growing.lookup
        growing_plans = {}
        for state in ("fresh_after_growth", "analyzed_after_growth"):
            if state == "analyzed_after_growth":
                conn.execute("analyze jurisdiction")
            growing_plans[state] = conn.execute(
                "explain (analyze, buffers, format json) " + growing_query, growing_params
            ).fetchone()[0][0]
        print("GROWING FIRST LOAD PLANS:", json.dumps(growing_plans))
        conn.execute("rollback to savepoint empty_candidate")
        recorded = RecordingConnection(conn)
        first = batch_upsert_jurisdictions(recorded, keys)
        assert batch_upsert_jurisdictions(recorded, keys) == first
        conn.execute(
            """insert into jurisdiction
            (distrito_code, seccion_code, circuito_code, establecimiento_code, mesa_code)
            select '02', '027', '00001', 'Plan fixture', i
            from generate_series(33, 108141) i"""
        )
        conn.execute("analyze jurisdiction")
        print(
            "CONDITIONS:",
            conn.execute(
                """select current_setting('server_version_num'), rolsuper, rolbypassrls,
            current_setting('work_mem'), current_setting('shared_buffers'),
            current_setting('fsync'), current_setting('full_page_writes'),
            current_setting('synchronous_commit')
            from pg_roles where rolname = current_user"""
            ).fetchone(),
        )
        print("PSYCOPG:", psycopg.__version__)
        query, params = recorded.lookup
        before = conn.execute(
            "explain (analyze, buffers, format json) " + query, params
        ).fetchone()[0][0]
        assert any(n["Node Type"] == "Seq Scan" for n in _nodes(before["Plan"]))
        migration = (ROOT / "supabase/migrations" / f"{MIGRATION}.sql").read_text()
        # Apply the exact forward migration to the isolated session dimension.
        ddl, analyze = migration.rsplit("analyze public.jurisdiction;", 1)
        assert not analyze.strip()
        conn.execute(ddl.replace("public.jurisdiction", "pg_temp.jurisdiction"))
        fresh = conn.execute("explain (analyze, buffers, format json) " + query, params).fetchone()[
            0
        ][0]
        conn.execute("analyze jurisdiction")
        evidence = {"before": before, "fresh_expression_statistics": fresh}
        for mode in ("force_custom_plan", "force_generic_plan"):
            conn.execute(f"set local plan_cache_mode = {mode}")
            # Psycopg prepares the actual production SQL with its native parameters.
            for _ in range(2):
                assert conn.execute(query, params, prepare=True).fetchall()
            prepared = conn.execute(
                "select name, custom_plans, generic_plans from pg_prepared_statements "
                "where statement like '%left join jurisdiction j%'"
            ).fetchall()
            assert len(prepared) == 1
            assert prepared[0][1 if mode == "force_custom_plan" else 2] >= 2
            # EXPLAIN EXECUTE is needed: explaining a new parameterized EXPLAIN
            # statement would not prove the prepared production query's plan.
            from psycopg import sql

            plan = conn.execute(
                sql.SQL("explain (analyze, buffers, format json) execute {} ({})").format(
                    sql.Identifier(prepared[0][0]),
                    sql.SQL(", ").join(sql.Literal(p) for p in params),
                )
            ).fetchone()[0][0]
            evidence[mode] = plan
            assert any(
                n.get("Index Name") == "jurisdiction_merge_key_idx" for n in _nodes(plan["Plan"])
            ), json.dumps(plan)
        print("RESOLVER SQL:", query)
        print("PARAMETERS:", json.dumps(params))
        print("PLANS:", json.dumps(evidence))
        print(
            "SUMMARY:",
            json.dumps(
                {
                    name: {
                        "execution_ms": plan["Execution Time"],
                        "local_hits": plan["Plan"]["Local Hit Blocks"],
                        "local_reads": plan["Plan"]["Local Read Blocks"],
                        "local_writes": plan["Plan"]["Local Written Blocks"],
                    }
                    for name, plan in {**growing_plans, **evidence}.items()
                }
            ),
        )
        conn.rollback()
