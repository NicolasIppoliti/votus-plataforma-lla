"""Credential-free tests for the explicit privileged fixture boundary."""

from __future__ import annotations

import json
import re
from contextlib import contextmanager

import psycopg
import pytest
from psycopg.conninfo import conninfo_to_dict, make_conninfo

from etl.verify import DatabaseIdentity, UnsafeDatabaseError


class FakeConnection:
    def __init__(self, identity):
        self.identity = identity
        self.closed = False
        self.current_user = "postgres"
        self.queries = []
        self.roles = {"postgres", "workspace_admin_owner"}
        self.memberships = {("workspace_admin_owner", "postgres"): (True, False, False)}
        self.fixture_rows = []
        self.committed = False
        self.rolled_back = False

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        self.closed = True

    @contextmanager
    def transaction(self):
        snapshot = (self.roles.copy(), self.memberships.copy(), self.fixture_rows.copy())
        try:
            yield
        except BaseException:
            self.roles, self.memberships, self.fixture_rows = snapshot
            self.rolled_back = True
            raise
        else:
            self.committed = True
        finally:
            self.current_user = "postgres"

    def execute(self, query, params=None):
        statement = query if isinstance(query, str) else query.as_string()
        self.queries.append((statement, params))
        if "ownership_marker" in statement:
            self.row = (self.identity.name, self.current_user, "postgres", self.identity.marker)
        elif "shobj_description" in statement:
            self.row = (self.identity.marker,)
        elif statement == "select current_user":
            self.row = (self.current_user,)
        elif statement.startswith("create role "):
            role = re.findall(r'"([^"]+)"', statement)[0]
            if role in self.roles:
                raise psycopg.errors.DuplicateObject("role already exists")
            assert statement.endswith(
                "nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls"
            )
            self.roles.add(role)
        elif statement.startswith("grant "):
            role, member = re.findall(r'"([^"]+)"', statement)
            assert statement.endswith("with inherit false, set true")
            self.memberships[role, member] = (False, False, True)
        elif statement.startswith("set local role "):
            role = re.findall(r'"([^"]+)"', statement)[0]
            if role != "postgres":
                assert any(
                    target == role
                    and options == (False, False, True)
                    and self.memberships.get((member, "postgres")) == (False, False, True)
                    for (target, member), options in self.memberships.items()
                )
            self.current_user = role
        elif statement.startswith("revoke "):
            role, member = re.findall(r'"([^"]+)"', statement)
            del self.memberships[role, member]
        elif statement.startswith("drop role "):
            role = re.findall(r'"([^"]+)"', statement)[0]
            assert all(role not in edge for edge in self.memberships)
            self.roles.remove(role)
        elif statement == "insert fixture row":
            self.fixture_rows.append(self.current_user)
        else:
            raise AssertionError(f"Unexpected SQL: {statement}")
        return self

    def fetchone(self):
        return self.row


def test_connect_uses_explicit_target_credentials_and_checks_owned_identity(monkeypatch):
    from owned_database import OwnedDatabase

    identity = DatabaseIdentity.generate()
    dsn = f"host=localhost dbname={identity.name} user=postgres password=fixture-only"
    connection = FakeConnection(identity)
    calls = []

    def connect(actual_dsn, *, autocommit):
        calls.append((actual_dsn, autocommit))
        return connection

    monkeypatch.setattr("psycopg.connect", connect)
    monkeypatch.setenv("PGDATABASE", "unrelated")
    monkeypatch.setenv("ETL_TEST_ADMIN_DATABASE_URL", "do-not-use")
    database = OwnedDatabase(dsn, identity.marker)
    with database.connect() as opened:
        assert opened is connection
        assert len(connection.queries) == 2
    assert calls == [(dsn, False)]
    assert connection.closed
    assert database.dsn == dsn
    assert database.maintenance_user == "postgres"


@pytest.mark.parametrize(
    "connection_fields",
    ["user=postgres", "host=localhost", "host=localhost user=postgres service=ambient"],
)
def test_missing_or_service_supplied_connection_identity_is_rejected_before_connect(
    monkeypatch, connection_fields
):
    from owned_database import OwnedDatabase

    identity = DatabaseIdentity.generate()
    monkeypatch.setattr("psycopg.connect", lambda *_args, **_kwargs: pytest.fail("connected"))
    with pytest.raises(UnsafeDatabaseError, match="explicit host and user"):
        OwnedDatabase(f"dbname={identity.name} {connection_fields}", identity.marker)


@pytest.fixture
def owned(monkeypatch):
    from owned_database import OwnedDatabase

    identity = DatabaseIdentity.generate()
    connection = FakeConnection(identity)
    monkeypatch.setattr("psycopg.connect", lambda *_args, **_kwargs: connection)
    database = OwnedDatabase(
        f"host=localhost dbname={identity.name} user=postgres password=fixture-only",
        identity.marker,
    )
    return database, connection


def test_owner_writes_commit_without_changing_existing_membership_options(owned):
    database, connection = owned
    original_roles = connection.roles.copy()
    original_memberships = connection.memberships.copy()
    with database.owner_connection("workspace_admin_owner") as elevated:
        assert elevated.execute("select current_user").fetchone() == ("workspace_admin_owner",)
        elevated.execute("insert fixture row")
        assert len(connection.roles - original_roles) == 1
    assert connection.fixture_rows == ["workspace_admin_owner"]
    assert connection.roles == original_roles
    assert connection.memberships == original_memberships
    assert connection.current_user == "postgres"
    assert connection.committed
    assert connection.closed


@pytest.mark.parametrize(
    "role", ["postgres", "unrelated_role", 'authenticated"; drop role postgres']
)
def test_non_fixture_role_is_rejected_before_opening_a_connection(owned, role):
    database, connection = owned
    with pytest.raises(UnsafeDatabaseError, match="not an allowed fixture role"):
        with database.owner_connection(role):
            pytest.fail("yielded disallowed role")
    assert connection.queries == []


@pytest.mark.parametrize(
    "role",
    [
        "workspace_bootstrap_owner",
        "workspace_bootstrap_caller",
        "workspace_context_owner",
        "workspace_query_owner",
        "workspace_admin_owner",
        "workspace_review_ingest_owner",
        "workspace_audit_owner",
        "workspace_platform_admin",
        "anon",
        "authenticated",
        "etl_writer",
        "service_role",
        "results_exploration_executor",
    ],
)
def test_known_fixture_subjects_are_selected_explicitly(owned, role):
    database, connection = owned
    with database.owner_connection(role) as selected:
        assert selected.execute("select current_user").fetchone() == (role,)
    assert connection.roles == {"postgres", "workspace_admin_owner"}
    assert connection.memberships == {("workspace_admin_owner", "postgres"): (True, False, False)}


@pytest.mark.parametrize("error", [RuntimeError("fixture failed"), KeyboardInterrupt()])
def test_fixture_failure_rolls_back_rows_bridge_and_memberships(owned, error):
    database, connection = owned
    original_roles = connection.roles.copy()
    original_memberships = connection.memberships.copy()
    with pytest.raises(type(error)) as caught:
        with database.owner_connection("workspace_admin_owner") as elevated:
            elevated.execute("insert fixture row")
            raise error
    assert caught.value is error
    assert connection.roles == original_roles
    assert connection.memberships == original_memberships
    assert connection.fixture_rows == []
    assert connection.rolled_back and not connection.committed
    assert connection.closed


@pytest.mark.parametrize(
    "failure_prefix",
    [
        "create role",
        'grant "workspace_admin_owner"',
        'grant "votus_etl_fixture_',
        'set local role "workspace_admin_owner"',
        'set local role "postgres"',
        'revoke "votus_etl_fixture_',
        'revoke "workspace_admin_owner"',
        "drop role",
    ],
)
def test_setup_and_cleanup_sql_failure_roll_back_only_new_authority(
    owned, monkeypatch, failure_prefix
):
    database, connection = owned
    original_roles = connection.roles.copy()
    original_memberships = connection.memberships.copy()
    execute = connection.execute
    denied = psycopg.errors.InsufficientPrivilege("fixture operation denied")

    def fail(query, params=None):
        statement = query if isinstance(query, str) else query.as_string()
        if statement.startswith(failure_prefix):
            raise denied
        return execute(query, params)

    monkeypatch.setattr(connection, "execute", fail)
    with pytest.raises(psycopg.errors.InsufficientPrivilege) as caught:
        with database.owner_connection("workspace_admin_owner") as elevated:
            elevated.execute("insert fixture row")
    assert caught.value is denied
    assert connection.roles == original_roles
    assert connection.memberships == original_memberships
    assert connection.fixture_rows == []
    assert connection.current_user == "postgres"
    assert connection.rolled_back and not connection.committed
    assert connection.closed


def test_bridge_name_collision_preserves_existing_role_and_memberships(owned, monkeypatch):
    database, connection = owned
    token = connection.identity.token
    bridge = f"votus_etl_fixture_{token.hex}"
    connection.roles.add(bridge)
    connection.memberships[bridge, "postgres"] = (True, True, False)
    original_roles = connection.roles.copy()
    original_memberships = connection.memberships.copy()
    monkeypatch.setattr("owned_database.uuid.uuid4", lambda: token)
    with pytest.raises(psycopg.errors.DuplicateObject):
        with database.owner_connection("workspace_admin_owner"):
            pytest.fail("yielded a colliding bridge")
    assert connection.roles == original_roles
    assert connection.memberships == original_memberships
    assert not any(query.startswith(("revoke", "drop")) for query, _ in connection.queries)
    assert connection.closed


@pytest.mark.parametrize("suppressed_role", ["workspace_admin_owner", "postgres"])
def test_unsuccessful_role_switch_or_restoration_rolls_back(owned, monkeypatch, suppressed_role):
    database, connection = owned
    execute = connection.execute

    def suppress_switch(query, params=None):
        statement = query if isinstance(query, str) else query.as_string()
        if statement == f'set local role "{suppressed_role}"':
            return connection
        return execute(query, params)

    monkeypatch.setattr(connection, "execute", suppress_switch)
    with pytest.raises(UnsafeDatabaseError, match="role"):
        with database.owner_connection("workspace_admin_owner") as elevated:
            elevated.execute("insert fixture row")
    assert connection.fixture_rows == []
    assert connection.roles == {"postgres", "workspace_admin_owner"}
    assert connection.current_user == "postgres"
    assert connection.rolled_back and connection.closed


@pytest.mark.parametrize(
    "mismatch", ["database", "current_user", "session_user", "marker", "comment"]
)
def test_mismatched_database_identity_is_rejected_before_fixture_sql(owned, monkeypatch, mismatch):
    database, connection = owned
    execute = connection.execute

    def mismatch_identity(query, params=None):
        cursor = execute(query, params)
        if "ownership_marker" in query and mismatch != "comment":
            position = ["database", "current_user", "session_user", "marker"].index(mismatch)
            row = list(connection.row)
            row[position] = "unrelated"
            connection.row = tuple(row)
        elif "shobj_description" in query and mismatch == "comment":
            connection.row = ("unrelated",)
        return cursor

    monkeypatch.setattr(connection, "execute", mismatch_identity)
    with pytest.raises(UnsafeDatabaseError, match="does not match"):
        with database.connect():
            pytest.fail("yielded unverified target")
    assert connection.closed
    assert not any(query.startswith("create") for query, _ in connection.queries)


@pytest.mark.parametrize("dbname", ["template1", "postgres", "votus_etl_verify_not-a-uuid"])
def test_nonowned_database_name_is_rejected_before_connect(monkeypatch, dbname):
    from owned_database import OwnedDatabase

    identity = DatabaseIdentity.generate()
    monkeypatch.setattr("psycopg.connect", lambda *_args, **_kwargs: pytest.fail("connected"))
    with pytest.raises(UnsafeDatabaseError):
        OwnedDatabase(f"host=localhost dbname={dbname} user=postgres", identity.marker)


@pytest.mark.parametrize("marker", ["", "not-a-marker", "votus-etl-verify:invalid", None])
def test_invalid_marker_is_rejected_before_connect(monkeypatch, marker):
    from owned_database import OwnedDatabase

    identity = DatabaseIdentity.generate()
    monkeypatch.setattr("psycopg.connect", lambda *_args, **_kwargs: pytest.fail("connected"))
    with pytest.raises(UnsafeDatabaseError):
        OwnedDatabase(f"host=localhost dbname={identity.name} user=postgres", marker)


def test_migration_level_does_not_require_private_table_privileges(monkeypatch):
    """Catalog presence is independent of information_schema's privilege filtering."""
    from contextlib import nullcontext
    from types import SimpleNamespace

    import test_migration_integration as migrations

    def execute(statement, _parameters=()):
        visible = "information_schema.columns" not in statement
        return SimpleNamespace(fetchone=lambda: (True, visible, False, True, True, True))

    connection = SimpleNamespace(execute=execute)
    monkeypatch.setattr(migrations.psycopg, "connect", lambda _dsn: nullcontext(connection))
    assert migrations._review_context_migration_level("explicit-owned-target") == 6


def test_migration_runner_rejects_malformed_record_without_ambient_fallback(owned, monkeypatch):
    database, connection = owned
    monkeypatch.setenv("ETL_TEST_MIGRATION_RUNNER", "do-not-use")
    with pytest.raises(UnsafeDatabaseError):
        database.migration_runner_dsn("not-json")
    assert connection.queries == []


@pytest.mark.parametrize(
    ("phase", "marked", "nodeid"),
    [
        (
            "ordinary",
            True,
            "tests/test_migration_integration.py::"
            "test_review_item_context_foundation_runs_as_supabase_temporary_login",
        ),
        (
            "privileged",
            False,
            "tests/test_migration_integration.py::"
            "test_review_item_context_foundation_runs_as_supabase_temporary_login",
        ),
        ("privileged", True, "tests/test_migration_integration.py::test_unrelated"),
        (
            "privileged",
            True,
            "tests/unrelated.py::"
            "test_review_item_context_foundation_runs_as_supabase_temporary_login",
        ),
    ],
)
def test_runner_fixture_rejects_nondesignated_requests_before_access(
    monkeypatch, phase, marked, nodeid
):
    from types import SimpleNamespace

    import conftest

    request = SimpleNamespace(
        node=SimpleNamespace(nodeid=nodeid, get_closest_marker=lambda _name: marked)
    )
    monkeypatch.setenv("ETL_VERIFY_PHASE", phase)
    monkeypatch.setenv("ETL_TEST_OWNED_MIGRATION_RUNNER", "must-not-be-read")
    with pytest.raises(pytest.fail.Exception, match="designated migration-session tests"):
        conftest.owned_migration_runner.__wrapped__(request, None)


@pytest.mark.parametrize(
    "name",
    [
        "test_review_item_context_foundation_runs_as_supabase_temporary_login",
        "test_remaining_review_context_migrations_run_as_supabase_temporary_login",
    ],
)
def test_designated_runner_fixture_requires_explicit_capability(monkeypatch, name):
    from types import SimpleNamespace

    import conftest

    request = SimpleNamespace(
        node=SimpleNamespace(
            nodeid=f"tests/test_migration_integration.py::{name}",
            get_closest_marker=lambda _name: True,
        )
    )
    monkeypatch.setenv("ETL_VERIFY_PHASE", "privileged")
    monkeypatch.delenv("ETL_TEST_OWNED_MIGRATION_RUNNER", raising=False)
    with pytest.raises(pytest.fail.Exception, match="explicit owned migration runner"):
        conftest.owned_migration_runner.__wrapped__(request, None)


def test_collection_rejects_migration_runner_capability_outside_privileged_phase(
    monkeypatch, tmp_path
):
    from types import SimpleNamespace

    import conftest

    monkeypatch.setenv("ETL_VERIFY_PHASE", "ordinary")
    monkeypatch.setenv("ETL_VERIFY_COLLECTION_REPORT", str(tmp_path / "collection.json"))
    monkeypatch.setenv("ETL_TEST_OWNED_MIGRATION_RUNNER", "explicit-capability")
    config = SimpleNamespace(hook=SimpleNamespace(pytest_deselected=lambda **_kwargs: None))
    with pytest.raises(pytest.UsageError, match="administrative test inputs"):
        conftest.pytest_collection_modifyitems(config, [])
    assert not (tmp_path / "collection.json").exists()


@pytest.fixture
def runner_target(owned, monkeypatch):
    database, ordinary_connection = owned
    role = "votus_etl_runner_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    marker = "votus-etl-runner:aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
    dsn = make_conninfo(database.dsn, user=role, password="R" * 43)
    record = {"dsn": dsn, "marker": marker, "oid": 30123}

    class RunnerConnection:
        def __init__(self):
            self.authority = (
                30123,
                role,
                True,
                False,
                False,
                False,
                False,
                False,
                False,
                marker,
                role,
                role,
                ["postgres:false:false:true"],
            )
            self.target = (
                ordinary_connection.identity.name,
                "postgres",
                role,
                ordinary_connection.identity.marker,
            )
            self.queries = []
            self.closed = False
            self.switched = False
            self.denied = False

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            self.closed = True

        def execute(self, statement):
            self.queries.append(statement)
            if "from pg_roles r where r.rolname = current_user" in statement:
                self.row = self.authority
            elif statement == "set role postgres":
                if self.denied:
                    raise psycopg.errors.InsufficientPrivilege("runner cannot assume postgres")
                self.switched = True
            elif "ownership_marker" in statement:
                assert self.switched
                self.row = self.target
            else:
                pytest.fail("unexpected runner query")
            return self

        def fetchone(self):
            return self.row

    connection = RunnerConnection()
    calls = []

    def connect(actual_dsn, **kwargs):
        calls.append((actual_dsn, kwargs))
        assert conninfo_to_dict(actual_dsn) == conninfo_to_dict(dsn)
        return connection

    monkeypatch.setattr("psycopg.connect", connect)
    return database, record, connection, calls


@pytest.mark.parametrize(
    "name",
    [
        "test_review_item_context_foundation_runs_as_supabase_temporary_login",
        "test_remaining_review_context_migrations_run_as_supabase_temporary_login",
    ],
)
def test_designated_fixture_authenticates_validated_runner_without_owning_its_lifecycle(
    runner_target, monkeypatch, name
):
    from types import SimpleNamespace

    import conftest

    database, record, connection, calls = runner_target
    request = SimpleNamespace(
        node=SimpleNamespace(
            nodeid=f"tests/test_migration_integration.py::{name}",
            get_closest_marker=lambda _name: True,
        )
    )
    monkeypatch.setenv("ETL_VERIFY_PHASE", "privileged")
    monkeypatch.setenv("ETL_TEST_OWNED_MIGRATION_RUNNER", json.dumps(record))
    result = conftest.owned_migration_runner.__wrapped__(request, database)
    assert conninfo_to_dict(result) == conninfo_to_dict(record["dsn"])
    assert len(calls) == 1 and calls[0][1] == {}
    assert connection.switched and connection.closed
    assert len(connection.queries) == 3
    assert not any(
        statement.lstrip().startswith(("create", "grant", "revoke", "drop"))
        for statement in connection.queries
    )


@pytest.mark.parametrize("kind", ["oid", "marker", "authority", "database", "session", "set_role"])
def test_runner_capability_cannot_bypass_live_identity_verification(runner_target, kind):
    database, record, connection, _calls = runner_target
    if kind in {"oid", "marker", "authority"}:
        row = list(connection.authority)
        position, value = {
            "oid": (0, 99999),
            "marker": (9, "unrelated"),
            "authority": (12, ["postgres:true:false:true"]),
        }[kind]
        row[position] = value
        connection.authority = tuple(row)
    elif kind in {"database", "session"}:
        row = list(connection.target)
        row[0 if kind == "database" else 2] = "unrelated"
        connection.target = tuple(row)
    else:
        connection.denied = True
    error = psycopg.errors.InsufficientPrivilege if kind == "set_role" else UnsafeDatabaseError
    with pytest.raises(error):
        database.migration_runner_dsn(json.dumps(record))
    assert connection.closed


@pytest.mark.parametrize("changed", [{"dbname": "template1"}, {"host": "unrelated"}])
def test_runner_dsn_must_name_the_same_explicit_owned_target(runner_target, changed):
    database, record, _connection, calls = runner_target
    record["dsn"] = make_conninfo(record["dsn"], **changed)
    with pytest.raises(UnsafeDatabaseError):
        database.migration_runner_dsn(json.dumps(record))
    assert calls == []
