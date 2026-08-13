"""Fail-closed contract for the disposable Postgres ETL verification command."""

from __future__ import annotations

import signal
import subprocess
import tomllib
import uuid
from collections.abc import Callable
from pathlib import Path
from types import TracebackType

import pytest
from psycopg import sql
from psycopg.abc import Params, QueryNoTemplate

from etl.verify import (
    DatabaseIdentity,
    DisposablePostgres,
    UnsafeDatabaseError,
    apply_migrations,
    run_pytest,
    termination_as_interrupt,
)


def _query_text(query: QueryNoTemplate) -> str:
    if isinstance(query, bytes):
        return query.decode("utf-8")
    if isinstance(query, sql.Composable):
        return query.as_string()
    return str(query)


class _Result:
    def __init__(self, row: tuple[object, ...] | None = None) -> None:
        self._row = row

    def fetchone(self) -> tuple[object, ...] | None:
        return self._row


class _AdminConnection:
    def __init__(self) -> None:
        self.databases: dict[str, str] = {}
        self.database_owners: dict[str, str] = {}
        self.roles: dict[str, str] = {}
        self.statements: list[tuple[str, Params | None]] = []
        self.closed = False
        self.global_roles_safe = True
        self.elevated_role_attribute: str | None = None
        self.fail_comment = False
        self.fail_create_database = False
        self.signal_on_drop: Callable[[], None] | None = None
        self.interrupt_drop_once = False
        self.fail_drop = False
        self.fail_drop_role = False

    def execute(self, query: QueryNoTemplate, params: Params | None = None) -> _Result:
        statement = _query_text(query)
        self.statements.append((statement, params))
        lowered = statement.lower()
        if "from pg_authid" in lowered and params is not None:
            assert isinstance(params, tuple)
            name = str(params[-1])
            if name not in self.roles:
                return _Result()
            return _Result((True, False, False, False, False, False, False, False))
        if "from pg_roles" in lowered and "pg_auth_members" in lowered:
            if isinstance(params, tuple):
                name = str(params[0])
                return _Result(None if name not in self.roles else (1,))
            elevated_is_rejected = (
                self.elevated_role_attribute is not None
                and f"not {self.elevated_role_attribute}" in lowered
            )
            return _Result((self.global_roles_safe and not elevated_is_rejected,))
        if "from pg_roles" in lowered:
            assert isinstance(params, tuple)
            name = str(params[0])
            return _Result(None if name not in self.roles else (1,))
        if lowered.startswith("create role"):
            name = statement.split('"')[1]
            if name in self.roles:
                raise RuntimeError("role already exists")
            self.roles[name] = ""
            return _Result()
        if lowered.startswith("comment on role"):
            name = statement.split('"')[1]
            self.roles[name] = statement.rsplit(" is ", 1)[1].strip("'")
            return _Result()
        if lowered.startswith("create database"):
            if self.fail_create_database:
                raise RuntimeError("database create failed")
            name = statement.split('"')[1]
            if name in self.databases:
                raise RuntimeError("database already exists")
            self.databases[name] = ""
            quoted = statement.split('"')
            if len(quoted) > 3:
                self.database_owners[name] = quoted[3]
            return _Result()
        if lowered.startswith("comment on database"):
            if self.fail_comment:
                raise RuntimeError("comment install failed")
            name = statement.split('"')[1]
            self.databases[name] = statement.rsplit(" is ", 1)[1].strip("'")
            return _Result()
        if "from pg_database" in lowered:
            assert isinstance(params, tuple)
            name = str(params[0])
            if "shobj_description" in lowered:
                marker = self.databases.get(name)
                return _Result(None if marker is None else (marker,))
            return _Result(None if name not in self.databases else (1,))
        if lowered.startswith("drop database"):
            if self.signal_on_drop is not None:
                callback = self.signal_on_drop
                self.signal_on_drop = None
                callback()
            if self.interrupt_drop_once:
                self.interrupt_drop_once = False
                raise InterruptedError("SIGTERM")
            if self.fail_drop:
                raise RuntimeError("drop failed")
            name = statement.split('"')[1]
            self.databases.pop(name, None)
            self.database_owners.pop(name, None)
            return _Result()
        if lowered.startswith("drop role"):
            if self.fail_drop_role:
                raise RuntimeError("role drop failed")
            name = statement.split('"')[1]
            self.roles.pop(name, None)
            return _Result()
        if lowered.startswith("grant connect, create, temporary on database"):
            return _Result()
        raise AssertionError(f"unexpected SQL: {statement}")

    def close(self) -> None:
        self.closed = True

    def __enter__(self) -> _AdminConnection:
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc_val: BaseException | None,
        exc_tb: TracebackType | None,
    ) -> None:
        self.close()


class _TargetConnection:
    def __init__(
        self,
        name: str,
        marker: str,
        *,
        user: str = "admin",
        fail_marker_install: bool = False,
    ) -> None:
        self.name = name
        self.marker = marker
        self.user = user
        self.fail_marker_install = fail_marker_install
        self.executed: list[str] = []
        self.closed = False

    def __enter__(self) -> _TargetConnection:
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc_val: BaseException | None,
        exc_tb: TracebackType | None,
    ) -> None:
        self.close()

    def execute(self, query: QueryNoTemplate, params: Params | None = None) -> _Result:
        statement = _query_text(query)
        if self.fail_marker_install and statement == "create schema votus_verification":
            raise RuntimeError("marker install failed")
        if "current_database()" in statement:
            if "current_user" in statement:
                return _Result((self.name, self.user, self.marker))
            return _Result((self.name, self.marker))
        self.executed.append(statement)
        return _Result()

    def close(self) -> None:
        self.closed = True


class _Connections:
    def __init__(self) -> None:
        self.admin = _AdminConnection()
        self.targets: list[_TargetConnection] = []
        self.fail_marker_install = False
        self.dsns: list[str] = []

    def __call__(
        self, conninfo: str, *, autocommit: bool = False
    ) -> _AdminConnection | _TargetConnection:
        self.dsns.append(conninfo)
        if autocommit:
            return self.admin
        from psycopg.conninfo import conninfo_to_dict

        params = conninfo_to_dict(conninfo)
        name = params.get("dbname")
        if not isinstance(name, str):
            raise AssertionError("test connection requires a string dbname")
        marker = self.admin.databases[name]
        user_param = params.get("user")
        if user_param is None:
            user = "admin"
        elif isinstance(user_param, str):
            user = user_param
        else:
            raise AssertionError("test connection requires a string user")
        target = _TargetConnection(
            name,
            marker,
            user=user,
            fail_marker_install=self.fail_marker_install,
        )
        self.targets.append(target)
        return target


def _identity(number: int = 1) -> DatabaseIdentity:
    token = uuid.UUID(int=number)
    return DatabaseIdentity(
        name=f"votus_etl_verify_{token.hex}",
        marker=f"votus-etl-verify:{token}",
        token=token,
    )


def test_identity_is_unique_and_rejects_names_or_markers_outside_the_contract() -> None:
    first = DatabaseIdentity.generate()
    second = DatabaseIdentity.generate()

    first.validate()
    second.validate()
    assert first != second

    with pytest.raises(UnsafeDatabaseError):
        DatabaseIdentity(name="postgres", marker=first.marker, token=first.token).validate()
    with pytest.raises(UnsafeDatabaseError):
        DatabaseIdentity(name=first.name, marker="shared-project", token=first.token).validate()


def test_missing_admin_state_fails_closed_with_an_explicit_error() -> None:
    database = DisposablePostgres(
        "postgresql://user:secret@localhost/template1",
        connect=_Connections(),
    )

    with pytest.raises(UnsafeDatabaseError, match="administrative connection"):
        database._database_exists()


def test_missing_migration_dsn_fails_closed_with_an_explicit_error() -> None:
    database = DisposablePostgres(
        "postgresql://user:secret@localhost/template1",
        connect=_Connections(),
    )

    with pytest.raises(UnsafeDatabaseError, match="migration database URL"):
        database._verify_target()


def test_grants_refuse_an_open_admin_connection_with_an_explicit_error() -> None:
    connections = _Connections()
    database = DisposablePostgres(
        "postgresql://user:secret@localhost/template1",
        connect=connections,
    )
    database.migration_dsn = "dbname=votus_etl_verify_test"
    database.admin = connections.admin

    with pytest.raises(UnsafeDatabaseError, match="must be closed"):
        database.grant_test_privileges()


def test_missing_target_dsn_fails_closed_with_an_explicit_error() -> None:
    connections = _Connections()
    database = DisposablePostgres(
        "postgresql://user:secret@localhost/template1",
        identity=_identity(),
        connect=connections,
    )
    database.open()
    database.target_dsn = None

    try:
        with pytest.raises(UnsafeDatabaseError, match="test database URL"):
            database.grant_test_privileges()
    finally:
        database.close()


def test_provision_refuses_a_non_maintenance_database_before_connecting() -> None:
    connections = _Connections()

    with pytest.raises(UnsafeDatabaseError, match="maintenance database"):
        DisposablePostgres(
            "postgresql://user:secret@localhost/protected_project",
            connect=connections,
        ).open()

    assert connections.admin.statements == []


def test_provision_refuses_cluster_role_mutation_before_creating_a_database() -> None:
    connections = _Connections()
    connections.admin.global_roles_safe = False

    with pytest.raises(UnsafeDatabaseError, match="shared cluster roles"):
        DisposablePostgres(
            "postgresql://user:secret@localhost/template1",
            connect=connections,
        ).open()

    assert connections.admin.databases == {}


@pytest.mark.parametrize(
    "attribute",
    ["rolsuper", "rolcreatedb", "rolcreaterole", "rolreplication"],
)
def test_provision_refuses_each_elevated_etl_writer_attribute(attribute: str) -> None:
    connections = _Connections()
    connections.admin.elevated_role_attribute = attribute
    database = DisposablePostgres(
        "postgresql://user:secret@localhost/template1",
        connect=connections,
    )

    try:
        with pytest.raises(UnsafeDatabaseError, match="shared cluster roles"):
            database.open()
    finally:
        database.close()

    assert connections.admin.databases == {}


def test_provision_creates_a_marked_unique_sibling_and_never_logs_the_dsn(capsys) -> None:
    connections = _Connections()
    identity = _identity()
    database = DisposablePostgres(
        "postgresql://user:secret@localhost/template1",
        identity=identity,
        connect=connections,
    )

    target_dsn = database.open()

    assert identity.name in connections.admin.databases
    assert connections.admin.databases[identity.name] == identity.marker
    assert identity.name in target_dsn
    assert capsys.readouterr() == ("", "")
    assert connections.admin.closed, "template1 must not stay locked during pytest"
    database.close()


def test_provision_creates_a_non_elevated_login_role_and_isolated_database() -> None:
    connections = _Connections()
    identity = _identity()
    database = DisposablePostgres(
        "postgresql://admin:maintenance-value@localhost/template1",
        identity=identity,
        connect=connections,
        secret_factory=lambda: "disposable-value",
    )

    child_dsn = database.open()

    role_statements = [
        statement
        for statement, _ in connections.admin.statements
        if statement.lower().startswith("create role")
    ]
    assert len(role_statements) == 1
    assert all(
        clause in role_statements[0].lower()
        for clause in (
            "login",
            "nosuperuser",
            "nocreatedb",
            "nocreaterole",
            "noreplication",
            "nobypassrls",
        )
    )
    assert identity.name not in connections.admin.database_owners
    assert f"user={identity.role_name}" in child_dsn
    assert "password=disposable-value" in child_dsn
    assert "maintenance-value" not in child_dsn
    database.close()


def test_database_create_failure_cleans_created_role_without_deleting_any_database() -> None:
    connections = _Connections()
    connections.admin.fail_create_database = True
    identity = _identity()

    with pytest.raises(RuntimeError, match="database create failed"):
        DisposablePostgres(
            "postgresql://admin:maintenance-value@localhost/template1",
            identity=identity,
            connect=connections,
            secret_factory=lambda: "disposable-value",
        ).open()

    assert identity.role_name not in connections.admin.roles
    assert connections.admin.databases == {}


def test_post_migration_grants_are_complete_and_role_remains_cluster_unprivileged() -> None:
    connections = _Connections()
    identity = _identity()
    database = DisposablePostgres(
        "postgresql://admin:maintenance-value@localhost/template1",
        identity=identity,
        connect=connections,
        secret_factory=lambda: "disposable-value",
    )
    database.open()

    database.grant_test_privileges()

    grants = [
        statement.lower()
        for statement, _ in connections.admin.statements
        if statement.lower().startswith("grant")
    ] + [
        statement.lower()
        for target in connections.targets
        for statement in target.executed
        if statement.lower().startswith("grant")
    ]
    assert grants == [
        f'grant connect, create, temporary on database "{identity.name}" to "{identity.role_name}"',
        f'grant usage, create on schema public to "{identity.role_name}"',
        f'grant usage on schema votus_verification to "{identity.role_name}"',
        f'grant select on table votus_verification.ownership_marker to "{identity.role_name}"',
        f'grant all privileges on all tables in schema public to "{identity.role_name}"',
        f'grant all privileges on all sequences in schema public to "{identity.role_name}"',
        f'grant all privileges on all functions in schema public to "{identity.role_name}"',
    ]
    policy_statement = next(
        statement
        for target in connections.targets
        for statement in target.executed
        if "create policy" in statement.lower()
    )
    policy_sql = " ".join(policy_statement.lower().split())
    assert "relation.relrowsecurity" in policy_sql
    assert "using (true) with check (true)" in policy_sql
    assert identity.role_name in policy_sql
    database.close()


def test_preexisting_role_is_never_deleted_when_create_refuses_it() -> None:
    connections = _Connections()
    identity = _identity()
    connections.admin.roles[identity.role_name] = "preexisting"

    with pytest.raises(RuntimeError, match="role already exists"):
        DisposablePostgres(
            "postgresql://admin:maintenance-value@localhost/template1",
            identity=identity,
            connect=connections,
            secret_factory=lambda: "disposable-value",
        ).open()

    assert connections.admin.roles[identity.role_name] == "preexisting"
    assert not any(
        statement.lower().startswith("drop role") for statement, _ in connections.admin.statements
    )


def test_cleanup_continues_to_role_and_aggregates_both_drop_failures() -> None:
    connections = _Connections()
    identity = _identity()
    database = DisposablePostgres(
        "postgresql://admin:maintenance-value@localhost/template1",
        identity=identity,
        connect=connections,
        secret_factory=lambda: "disposable-value",
    )
    database.open()
    connections.admin.fail_drop = True
    connections.admin.fail_drop_role = True

    with pytest.raises(BaseExceptionGroup) as caught:
        database.close()

    assert [str(error) for error in caught.value.exceptions] == [
        "drop failed",
        "role drop failed",
    ]
    cleanup = [
        statement.lower()
        for statement, _ in connections.admin.statements
        if statement.lower().startswith("drop")
    ]
    assert cleanup[-2].startswith("drop database")
    assert cleanup[-1].startswith("drop role")


def test_reported_setup_and_cleanup_errors_never_include_credentials() -> None:
    connections = _Connections()
    connections.admin.fail_create_database = True
    database = DisposablePostgres(
        "postgresql://admin:maintenance-value@localhost/template1",
        identity=_identity(),
        connect=connections,
        secret_factory=lambda: "disposable-value",
    )

    with pytest.raises(RuntimeError) as caught:
        database.open()

    reported = database.safe_error(caught.value)
    assert "maintenance-value" not in reported
    assert "disposable-value" not in reported


def test_provision_failure_after_create_uses_comment_marker_for_cleanup() -> None:
    connections = _Connections()
    connections.fail_marker_install = True
    identity = _identity()

    with pytest.raises(RuntimeError, match="marker install failed"):
        DisposablePostgres(
            "postgresql://user:secret@localhost/template1",
            identity=identity,
            connect=connections,
        ).open()

    assert identity.name not in connections.admin.databases


def test_failure_between_create_and_marker_keeps_original_error_and_cleans_database() -> None:
    connections = _Connections()
    connections.admin.fail_comment = True
    identity = _identity()

    with pytest.raises(RuntimeError, match="comment install failed"):
        DisposablePostgres(
            "postgresql://user:secret@localhost/template1",
            identity=identity,
            connect=connections,
        ).open()

    assert identity.name not in connections.admin.databases


def test_preexisting_database_is_never_deleted_when_create_refuses_it() -> None:
    connections = _Connections()
    identity = _identity()
    connections.admin.databases[identity.name] = "preexisting"
    database = DisposablePostgres(
        "postgresql://user:secret@localhost/template1",
        identity=identity,
        connect=connections,
    )

    with pytest.raises(RuntimeError, match="already exists"):
        database.open()

    assert connections.admin.databases[identity.name] == "preexisting"
    assert not any(
        statement.lower().startswith("drop database")
        for statement, _ in connections.admin.statements
    )


@pytest.mark.parametrize("failure", [RuntimeError("failed"), KeyboardInterrupt()])
def test_context_cleanup_runs_on_failure_and_interruption(failure: BaseException) -> None:
    connections = _Connections()
    identity = _identity()

    with pytest.raises(type(failure)):
        with DisposablePostgres(
            "postgresql://user:secret@localhost/template1",
            identity=identity,
            connect=connections,
        ):
            raise failure

    assert identity.name not in connections.admin.databases
    assert any(
        statement.lower().startswith("drop database")
        for statement, _ in connections.admin.statements
    )


def test_cleanup_is_idempotent_and_refuses_a_changed_ownership_marker() -> None:
    connections = _Connections()
    identity = _identity()
    database = DisposablePostgres(
        "postgresql://user:secret@localhost/template1",
        identity=identity,
        connect=connections,
    )
    database.open()
    connections.admin.databases[identity.name] = "shared-project"

    with pytest.raises(UnsafeDatabaseError, match="ownership marker"):
        database.close()
    assert identity.name in connections.admin.databases

    connections.admin.databases[identity.name] = identity.marker
    database.close()
    database.close()
    drops = [s for s, _ in connections.admin.statements if s.lower().startswith("drop database")]
    assert len(drops) == 1


def test_apply_migrations_requires_a_complete_sequence_and_executes_every_file(
    tmp_path: Path,
) -> None:
    migrations = tmp_path / "migrations"
    migrations.mkdir()
    (migrations / "0001_first.sql").write_text("select 1;", encoding="utf-8")
    (migrations / "0002_second.sql").write_text("select 2;", encoding="utf-8")
    connections = _Connections()
    identity = _identity()
    connections.admin.databases[identity.name] = identity.marker

    applied = apply_migrations(
        "dbname=" + identity.name,
        migrations,
        connect=connections,
    )

    assert applied == 2
    assert [target.executed for target in connections.targets] == [["select 1;"], ["select 2;"]]

    (migrations / "0002_second.sql").unlink()
    (migrations / "0003_third.sql").write_text("select 3;", encoding="utf-8")
    with pytest.raises(RuntimeError, match="contiguous"):
        apply_migrations("dbname=" + identity.name, migrations, connect=connections)


def test_apply_migrations_rejects_non_file_entries_before_connecting(tmp_path: Path) -> None:
    migrations = tmp_path / "migrations"
    migrations.mkdir()
    (migrations / "0001_not_a_file.sql").mkdir()
    connections = _Connections()

    with pytest.raises(RuntimeError, match="regular file"):
        apply_migrations("dbname=votus_etl_verify_test", migrations, connect=connections)

    assert connections.dsns == []


def test_pytest_rejects_skips_even_when_pytest_exits_zero(tmp_path: Path) -> None:
    def fake_run(command: list[str], **kwargs: object) -> subprocess.CompletedProcess[str]:
        report_arg = next(value for value in command if value.startswith("--junitxml="))
        Path(report_arg.split("=", 1)[1]).write_text(
            '<testsuites tests="2" failures="0" skipped="1"><testsuite>'
            '<testcase name="db"><skipped message="unavailable"/></testcase>'
            "</testsuite></testsuites>",
            encoding="utf-8",
        )
        return subprocess.CompletedProcess(command, 0)

    with pytest.raises(RuntimeError, match="1 skipped"):
        run_pytest("dbname=votus_etl_verify_test", tmp_path, run=fake_run)


def test_pytest_rejects_non_numeric_junit_counts(tmp_path: Path) -> None:
    def fake_run(command: list[str], **kwargs: object) -> subprocess.CompletedProcess[str]:
        report_arg = next(value for value in command if value.startswith("--junitxml="))
        Path(report_arg.split("=", 1)[1]).write_text(
            '<testsuites tests="invalid" failures="0" errors="0" skipped="0"/>',
            encoding="utf-8",
        )
        return subprocess.CompletedProcess(command, 0)

    with pytest.raises(RuntimeError, match="non-numeric JUnit 'tests' count"):
        run_pytest("dbname=votus_etl_verify_test", tmp_path, run=fake_run)


def test_pytest_reports_executed_and_skipped_counts(tmp_path: Path) -> None:
    def fake_run(command: list[str], **kwargs: object) -> subprocess.CompletedProcess[str]:
        report_arg = next(value for value in command if value.startswith("--junitxml="))
        Path(report_arg.split("=", 1)[1]).write_text(
            '<testsuites tests="3" failures="0" errors="0" skipped="0"/>',
            encoding="utf-8",
        )
        return subprocess.CompletedProcess(command, 0)

    result = run_pytest("dbname=votus_etl_verify_test", tmp_path, run=fake_run)

    assert result.executed == 3
    assert result.skipped == 0


def test_pytest_child_receives_only_the_disposable_database_dsn(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("ETL_TEST_ADMIN_DATABASE_URL", "admin-secret")
    monkeypatch.setenv("ETL_TEST_ADMIN_USERNAME", "admin-user")
    monkeypatch.setenv("ETL_TEST_ADMIN_PASSWORD", "admin-password")
    monkeypatch.setenv("PGPASSWORD", "password-secret")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "cloud-secret")

    def fake_run(command: list[str], **kwargs: object) -> subprocess.CompletedProcess[str]:
        env = kwargs["env"]
        assert isinstance(env, dict)
        assert set(env) == {"ETL_TEST_DATABASE_URL"}
        assert env["ETL_TEST_DATABASE_URL"] == (
            "postgresql://postgres:test-secret@127.0.0.1:54322/votus_etl_verify_test"
        )
        report_arg = next(value for value in command if value.startswith("--junitxml="))
        Path(report_arg.split("=", 1)[1]).write_text(
            '<testsuites tests="1" failures="0" errors="0" skipped="0"/>',
            encoding="utf-8",
        )
        return subprocess.CompletedProcess(command, 0)

    run_pytest(
        "postgresql://postgres:test-secret@127.0.0.1:54322/votus_etl_verify_test",
        tmp_path,
        run=fake_run,
    )


def test_signal_handler_turns_termination_into_a_cleanup_safe_interruption() -> None:
    with pytest.raises(InterruptedError, match="SIGTERM"):
        termination_as_interrupt(signal.SIGTERM, None)


def test_signal_interruption_inside_context_cleans_the_database() -> None:
    connections = _Connections()
    identity = _identity()

    with pytest.raises(InterruptedError, match="SIGTERM"):
        with DisposablePostgres(
            "postgresql://user:secret@localhost/template1",
            identity=identity,
            connect=connections,
        ):
            termination_as_interrupt(signal.SIGTERM, None)

    assert identity.name not in connections.admin.databases
    assert identity.role_name not in connections.admin.roles


def test_signal_during_drop_is_deferred_until_cleanup_finishes() -> None:
    connections = _Connections()
    identity = _identity()
    database = DisposablePostgres(
        "postgresql://user:secret@localhost/template1",
        identity=identity,
        connect=connections,
    )
    database.open()
    connections.admin.signal_on_drop = lambda: termination_as_interrupt(signal.SIGTERM, None)

    with pytest.raises(InterruptedError, match="SIGTERM"):
        database.close()

    assert identity.name not in connections.admin.databases
    assert identity.role_name not in connections.admin.roles


def test_cleanup_retries_one_interrupted_drop_then_succeeds() -> None:
    connections = _Connections()
    identity = _identity()
    database = DisposablePostgres(
        "postgresql://user:secret@localhost/template1",
        identity=identity,
        connect=connections,
    )
    database.open()
    connections.admin.interrupt_drop_once = True

    database.close()

    drops = [s for s, _ in connections.admin.statements if s.lower().startswith("drop database")]
    assert len(drops) == 2
    assert identity.name not in connections.admin.databases


def test_signal_and_cleanup_failure_are_reported_separately_without_stale_signal() -> None:
    connections = _Connections()
    identity = _identity()
    database = DisposablePostgres(
        "postgresql://user:secret@localhost/template1",
        identity=identity,
        connect=connections,
    )
    database.open()
    connections.admin.signal_on_drop = lambda: termination_as_interrupt(signal.SIGTERM, None)
    connections.admin.fail_drop = True

    with pytest.raises(BaseExceptionGroup) as caught:
        database.close()

    messages = [str(error) for error in caught.value.exceptions]
    assert any("SIGTERM" in message for message in messages)
    assert any("drop failed" in message for message in messages)
    connections.admin.fail_drop = False
    database.close()
    assert identity.name not in connections.admin.databases


def test_setup_and_cleanup_failure_are_reported_as_separate_causes() -> None:
    connections = _Connections()
    connections.admin.fail_comment = True
    connections.admin.fail_drop = True

    with pytest.raises(BaseExceptionGroup) as caught:
        DisposablePostgres(
            "postgresql://user:secret@localhost/template1",
            identity=_identity(),
            connect=connections,
        ).open()

    messages = [str(error) for error in caught.value.exceptions]
    assert any("comment install failed" in message for message in messages)
    assert any("drop failed" in message for message in messages)


def test_command_is_reachable_from_the_installed_package_entry_point() -> None:
    project = tomllib.loads(
        (Path(__file__).parent.parent / "pyproject.toml").read_text(encoding="utf-8")
    )

    assert project["project"]["scripts"]["etl-verify"] == "etl.verify:main"
