"""Explicit real-Postgres regression; never collected by the inner ETL suite."""

from __future__ import annotations

import os
import sys
import uuid
from pathlib import Path

import psycopg
import pytest
from psycopg import sql
from psycopg.conninfo import conninfo_to_dict

from etl import verify


@pytest.fixture
def owned_admin_dsn() -> str:
    """Require a parent-provisioned local stack, not an ambient test database."""
    dsn = os.environ.get("D16_OWNED_ADMIN_DSN")
    token = os.environ.get("D16_OWNED_STACK_TOKEN")
    if not dsn or not token:
        pytest.fail("explicit owned local database inputs are required", pytrace=False)
    try:
        marker = f"votus-d16:{uuid.UUID(token)}"
        params = conninfo_to_dict(dsn)
    except (ValueError, psycopg.Error):
        pytest.fail("owned database inputs are invalid", pytrace=False)
    if (
        params.get("host") not in {"127.0.0.1", "::1"}
        or params.get("dbname") != "template1"
        or params.get("hostaddr", params["host"]) != params["host"]
        or params.get("service")
        or params.get("options")
    ):
        pytest.fail("owned database must use loopback/template1 directly", pytrace=False)
    with psycopg.connect(dsn) as connection:
        row = connection.execute(
            "select current_database(), current_user=session_user, "
            "r.rolsuper,r.rolcreatedb,r.rolcreaterole, "
            "shobj_description(d.oid,'pg_database') "
            "from pg_roles r join pg_database d on d.datname='postgres' "
            "where r.rolname=current_user"
        ).fetchone()
    if row != ("template1", True, False, True, True, marker):
        pytest.fail("owned marker or non-superuser maintenance identity mismatch", pytrace=False)
    return dsn


def memberships(connection: psycopg.Connection) -> list[tuple]:
    return connection.execute(
        "select granted.rolname,member.rolname,grantor.rolname, "
        "m.admin_option,m.inherit_option,m.set_option from pg_auth_members m "
        "join pg_roles granted on granted.oid=m.roleid "
        "join pg_roles member on member.oid=m.member "
        "join pg_roles grantor on grantor.oid=m.grantor order by 1,2,3,4,5,6"
    ).fetchall()


def inspect_scope(connection: psycopg.Connection) -> list[tuple]:
    """Borrow a fresh inspection bridge only in a rolled-back transaction."""
    bridge = sql.Identifier(f"votus_scope_inspect_{uuid.uuid4().hex}")
    try:
        connection.execute(sql.SQL("create role {} nologin noinherit").format(bridge))
        connection.execute(
            sql.SQL(
                "grant workspace_review_ingest_owner to {} with inherit false, set true"
            ).format(bridge)
        )
        connection.execute(
            sql.SQL("grant {} to current_user with inherit false, set true").format(bridge)
        )
        connection.execute("set local role workspace_review_ingest_owner")
        return connection.execute(
            "select distrito_code,seccion_code from workspace_private.section_scope order by 1,2"
        ).fetchall()
    finally:
        connection.rollback()


@pytest.mark.parametrize("case", ["success", "insert_failure", "bridge_collision"])
def test_main_registers_scope_without_changing_existing_authority(
    owned_admin_dsn: str,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture,
    case: str,
) -> None:
    """Real setup preserves authority on success, SQL failure and role collision."""
    original_apply = verify.apply_migrations
    before: list[tuple] = []
    state: dict[str, str] = {}
    reached_pytest = False
    observed_roles: list[tuple] = []
    rollback_proof: list[tuple] = []
    collision_role: tuple | None = None
    original_database = verify.DisposablePostgres

    class RoleObservingConnection(psycopg.Connection):
        def __enter__(self):
            self.initial_role = self.execute("select current_user").fetchone()
            return super().__enter__()

        def __exit__(self, exc_type, exc_val, exc_tb):
            try:
                if exc_type is None:
                    observed_roles.append(
                        (self.initial_role, self.execute("select current_user").fetchone())
                    )
            finally:
                super().__exit__(exc_type, exc_val, exc_tb)
            if exc_type is not None and state.get("migration_dsn"):
                # Observe the real context manager's rollback, never replace it.
                with psycopg.connect(state["migration_dsn"]) as connection:
                    rollback_proof.append((memberships(connection), inspect_scope(connection)))

    def observed_database(dsn: str) -> verify.DisposablePostgres:
        return original_database(dsn, connect=RoleObservingConnection.connect)

    def observe_migrations(dsn: str, directory: Path) -> int:
        nonlocal collision_role
        count = original_apply(dsn, directory)
        state["migration_dsn"] = dsn
        with psycopg.connect(dsn) as connection:
            row = connection.execute("select current_database(),current_user").fetchone()
            assert row is not None
            state["database"], state["maintenance"] = row
            token = state["database"].removeprefix(verify.NAME_PREFIX)
            state["test_role"] = f"{verify.NAME_PREFIX}role_{token}"
            state["bridge"] = f"votus_etl_scope_{token}"
            if case == "insert_failure":
                bridge = sql.Identifier(f"votus_scope_failure_{uuid.uuid4().hex}")
                maintenance = sql.Identifier(state["maintenance"])
                connection.execute(sql.SQL("create role {} nologin noinherit").format(bridge))
                connection.execute(
                    sql.SQL(
                        "grant workspace_admin_owner to {} with inherit false, set true"
                    ).format(bridge)
                )
                connection.execute(
                    sql.SQL("grant {} to {} with inherit false, set true").format(
                        bridge, maintenance
                    )
                )
                connection.execute("set local role workspace_admin_owner")
                connection.execute(
                    "alter table workspace_private.section_scope "
                    "add constraint d16_reject_seed check (false)"
                )
                connection.execute(sql.SQL("set local role {}").format(maintenance))
                connection.execute(sql.SQL("revoke {} from {}").format(bridge, maintenance))
                connection.execute(sql.SQL("revoke workspace_admin_owner from {}").format(bridge))
                connection.execute(sql.SQL("drop role {}").format(bridge))
            elif case == "bridge_collision":
                connection.execute(
                    sql.SQL("create role {} nologin noinherit").format(
                        sql.Identifier(state["bridge"])
                    )
                )
                collision_role = connection.execute(
                    "select oid,rolname,rolcanlogin,rolinherit,rolsuper,rolcreatedb,"
                    "rolcreaterole,rolreplication,rolbypassrls from pg_roles where rolname=%s",
                    (state["bridge"],),
                ).fetchone()
            connection.commit()
            before.extend(memberships(connection))
            owner_edges = [
                row
                for row in before
                if row[0] == "workspace_admin_owner" and row[1] == state["maintenance"]
            ]
            assert owner_edges
            assert all(row[3:] == (True, False, False) for row in owner_edges)
            assert inspect_scope(connection) == []
        return count

    def assert_ready(dsn: str, _etl_root: Path) -> verify.PytestResult:
        nonlocal reached_pytest
        reached_pytest = True
        role = conninfo_to_dict(dsn)["user"]
        state["test_role"] = role
        assert observed_roles
        assert all(initial == final for initial, final in observed_roles)
        with psycopg.connect(state["migration_dsn"]) as connection:
            after = memberships(connection)
            assert [row for row in after if row[1] != role] == before
            assert [row for row in after if row[1] == role] == [
                ("etl_writer", role, state["maintenance"], False, True, True),
                ("results_exploration_executor", role, state["maintenance"], False, True, True),
            ]
            assert (
                connection.execute(
                    "select rolname from pg_roles where rolname like 'votus_etl_scope_%'"
                ).fetchall()
                == []
            )
            assert inspect_scope(connection) == [("02", "027")]
            assert connection.execute("select current_user").fetchone() == (state["maintenance"],)
        with psycopg.connect(dsn) as connection:
            assert connection.execute(
                "select rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls "
                "from pg_roles where rolname=current_user"
            ).fetchone() == (False, False, False, False, False)
            with pytest.raises(psycopg.errors.InsufficientPrivilege):
                connection.execute(
                    "insert into workspace_private.section_scope(distrito_code,seccion_code) "
                    "values ('02','028')"
                )
            connection.rollback()
        return verify.PytestResult(executed=1, skipped=0)

    monkeypatch.setattr(verify, "apply_migrations", observe_migrations)
    monkeypatch.setattr(verify, "DisposablePostgres", observed_database)
    monkeypatch.setattr(verify, "run_pytest", assert_ready)
    monkeypatch.setattr(sys, "argv", ["etl-verify"])
    monkeypatch.setenv("ETL_TEST_ADMIN_DATABASE_URL", owned_admin_dsn)
    monkeypatch.setenv("ETL_VERIFY_STAGE_REPORT", "1")
    result = verify.main()
    output = capsys.readouterr()
    with psycopg.connect(owned_admin_dsn) as connection:
        assert (
            connection.execute(
                "select datname from pg_database where datname like 'votus_etl_verify_%'"
            ).fetchall()
            == []
        )
        remaining_roles = connection.execute(
            "select rolname from pg_roles where rolname like 'votus_etl_verify_role_%' "
            "or rolname like 'votus_etl_scope_%' or rolname like 'votus_scope_inspect_%' "
            "or rolname like 'votus_scope_failure_%'"
        ).fetchall()
        expected_roles = [(state["bridge"],)] if case == "bridge_collision" else []
        assert remaining_roles == expected_roles
        assert memberships(connection) == [row for row in before if row[0] != state["test_role"]]
        if case == "bridge_collision":
            assert (
                connection.execute(
                    "select oid,rolname,rolcanlogin,rolinherit,rolsuper,rolcreatedb,"
                    "rolcreaterole,rolreplication,rolbypassrls from pg_roles where rolname=%s",
                    (state["bridge"],),
                ).fetchone()
                == collision_role
            )
    if case == "success":
        assert result == 0, output.err
        assert reached_pytest
    else:
        assert result == 1, output.err
        assert not reached_pytest
        sqlstate = "23514" if case == "insert_failure" else "42710"
        assert f"E2E_ETL_GRANT register_scope database {sqlstate}\n" in output.err
        assert len(rollback_proof) == 1
        restored_memberships, restored_scope = rollback_proof[0]
        assert restored_scope == []
        assert [row for row in restored_memberships if row[1] != state["test_role"]] == before
