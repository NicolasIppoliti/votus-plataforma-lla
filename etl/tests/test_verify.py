"""Fail-closed contract for the disposable Postgres ETL verification command."""

from __future__ import annotations

import signal
import subprocess
import sys
import uuid
from collections.abc import Callable
from functools import partial
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
    main,
    run_pytest,
    termination_as_interrupt,
)


def test_cli_emits_only_opted_in_fixed_stage_on_pytest_failure(monkeypatch, capsys) -> None:
    import etl.verify as verify

    class FakeDatabase:
        def __init__(self, _dsn: str) -> None:
            self.migration_dsn = "private-migration-url"
            self.cleaned = False

        def __enter__(self) -> str:
            return "private-test-url"

        def __exit__(self, *_args: object) -> None:
            self.cleaned = True

        def grant_test_privileges(self) -> None:
            pass

        def safe_error(self, _error: BaseException) -> str:
            return "redacted"

    instances: list[FakeDatabase] = []

    def create(dsn: str) -> FakeDatabase:
        instance = FakeDatabase(dsn)
        instances.append(instance)
        return instance

    monkeypatch.setattr(verify, "DisposablePostgres", create)
    monkeypatch.setattr(verify, "apply_migrations", lambda *_args: 1)

    def fail_pytest(*_args: object) -> None:
        raise RuntimeError("private-test-url")

    monkeypatch.setattr(verify, "run_pytest", fail_pytest)
    monkeypatch.setattr(sys, "argv", ["etl-verify"])
    monkeypatch.setenv("ETL_TEST_ADMIN_DATABASE_URL", "private-admin-url")
    for opted_in in (False, True):
        if opted_in:
            monkeypatch.setenv("ETL_VERIFY_STAGE_REPORT", "1")
        else:
            monkeypatch.delenv("ETL_VERIFY_STAGE_REPORT", raising=False)
        assert main() == 1
        output = capsys.readouterr().err
        assert ("E2E_ETL_STAGE pytest\n" in output) is opted_in
        assert "private-test-url" not in output
        assert "private-admin-url" not in output
        assert instances[-1].cleaned


@pytest.fixture
def pytest_cli(monkeypatch, capsys):
    """Drive the real CLI and pytest report reader with only external I/O replaced."""
    import etl.verify as verify

    class FakeDatabase:
        migration_dsn = "private-migration-url"
        identity = DatabaseIdentity.generate()
        cleaned = False
        failure = None
        cleanup_error = None

        def __enter__(self):
            return "private-test-url"

        def __exit__(self, _type, error, _traceback):
            self.failure = error
            self.cleaned = True
            if self.cleanup_error is not None:
                raise self.cleanup_error

        def grant_test_privileges(self):
            pass

        def safe_error(self, error):
            return str(error)

    database = FakeDatabase()

    def emit(*args, **kwargs):
        if args and str(args[0]).startswith("E2E_ETL_"):
            assert database.cleaned
        print(*args, **kwargs)

    monkeypatch.setattr(verify, "print", emit, raising=False)
    monkeypatch.setattr(verify, "DisposablePostgres", lambda _dsn: database)
    monkeypatch.setattr(verify, "apply_migrations", lambda *_args: 1)
    monkeypatch.setattr(sys, "argv", ["etl-verify"])
    monkeypatch.setenv("ETL_TEST_ADMIN_DATABASE_URL", "private-admin-url")
    reports = []

    def invoke(report, code=1, *, error=None, opted_in=True):
        database.cleaned = False

        def external_run(command, **kwargs):
            assert kwargs["env"] == {"ETL_TEST_DATABASE_URL": "private-test-url"}
            path = Path(
                next(arg.split("=", 1)[1] for arg in command if arg.startswith("--junitxml="))
            )
            reports.append(path)
            if report is not None:
                path.write_text(report, encoding="utf-8")
            if error is not None:
                raise error
            return subprocess.CompletedProcess(command, code)

        monkeypatch.setattr(verify, "run_pytest", partial(run_pytest, run=external_run))
        monkeypatch.setenv("ETL_VERIFY_STAGE_REPORT", "1" if opted_in else "0")
        result = main()
        output = capsys.readouterr()
        assert database.cleaned
        assert all(not path.exists() for path in reports)
        return result, output.err, output.out

    return invoke, database


def test_cli_reports_pytest_counts_after_cleanup_without_private_report(pytest_cli):
    invoke, _database = pytest_cli
    result, error, output = invoke(
        '<testsuites><testsuite tests="5" failures="1" errors="2" skipped="0">'
        '<testcase name="private-test-id"><failure>private-assertion private-dsn</failure>'
        "</testcase></testsuite></testsuites>"
    )
    assert result == 1
    assert "E2E_ETL_STAGE pytest\n" in error
    assert "E2E_ETL_PYTEST pytest_failed 1 5 0 3\n" in error
    assert "private-" not in error + output


@pytest.mark.parametrize(
    ("report", "code", "failure", "expected"),
    [
        (None, 5, None, "report_missing 5 - - -"),
        ("<private-broken", 1, None, "report_invalid 1 - - -"),
        ('<testsuite tests="private-count"/>', 1, None, "report_invalid 1 - - -"),
        (None, 1, OSError("private-runner-error"), "runner_error - - - -"),
        (None, 1, ValueError("private-unexpected-runner"), "unexpected - - - -"),
        (None, 1, KeyboardInterrupt("private-interrupt"), "interrupted - - - -"),
        (None, 1, InterruptedError("private-signal"), "interrupted - - - -"),
    ],
)
def test_cli_reports_safe_pytest_outcome_and_preserves_exception(
    pytest_cli, report, code, failure, expected
):
    invoke, database = pytest_cli
    result, error, output = invoke(report, code, error=failure)
    assert result == 1
    assert f"E2E_ETL_PYTEST {expected}\n" in error
    assert "private-" not in error + output
    if failure is not None:
        assert database.failure is failure


@pytest.mark.parametrize(
    ("report", "code", "expected"),
    [
        ('<testsuite tests="3" skipped="1" failures="1" errors="1"/>', 1, "skips_rejected 1 3 1 2"),
        ('<testsuite tests="1" failures="1"/>', 0, "pytest_failed 0 1 0 1"),
        ('<testsuite tests="0"/>', 5, "pytest_failed 5 0 0 0"),
        ('<testsuite tests="9007199254740991"/>', 255, "pytest_failed 255 9007199254740991 0 0"),
        ('<testsuite tests="9007199254740992"/>', -9, "pytest_failed - - 0 0"),
        ('<testsuite tests="-1"/>', 256, "pytest_failed - - 0 0"),
        ('<testsuite tests="2" skipped="-1"/>', 1, "skips_rejected 1 2 - 0"),
        (
            '<testsuite tests="2" failures="9007199254740991" errors="1"/>',
            1,
            "pytest_failed 1 2 0 -",
        ),
    ],
)
def test_cli_bounds_pytest_evidence_and_preserves_failure_precedence(
    pytest_cli, report, code, expected
):
    invoke, _database = pytest_cli
    result, error, _output = invoke(report, code)
    assert result == 1
    assert f"E2E_ETL_PYTEST {expected}\n" in error


@pytest.mark.parametrize("opted_in", [False, True])
def test_cli_never_emits_pytest_evidence_on_success(pytest_cli, opted_in):
    invoke, _database = pytest_cli
    result, error, output = invoke('<testsuite tests="1"/>', 0, opted_in=opted_in)
    assert result == 0
    assert "1 executed, 0 skipped" in output
    assert "E2E_ETL_" not in error


def test_cli_pytest_opt_out_is_redacted_without_diagnostic(pytest_cli):
    invoke, _database = pytest_cli
    result, error, output = invoke(None, error=RuntimeError("private-error"), opted_in=False)
    assert result == 1
    assert "E2E_ETL_" not in error
    assert "private-" not in error + output


def test_cli_cleanup_replacement_does_not_emit_stale_pytest_evidence(pytest_cli):
    invoke, database = pytest_cli
    database.cleanup_error = RuntimeError("cleanup failed")
    result, error, _output = invoke('<testsuite tests="2" failures="1"/>')
    assert result == 1
    assert "E2E_ETL_STAGE owned_database_cleanup\n" in error
    assert "E2E_ETL_PYTEST" not in error


@pytest.mark.parametrize(
    "report", ['<testsuite tests="2" failures="1"/>', '<testsuite tests="1"/>']
)
def test_cli_report_cleanup_replacement_discards_counts(pytest_cli, monkeypatch, report):
    import etl.verify as verify

    original_temporary_directory = verify.tempfile.TemporaryDirectory
    failure = OSError("private-report-cleanup")

    class FailingCleanup(original_temporary_directory):
        def __exit__(self, *args):
            super().__exit__(*args)
            raise failure

    monkeypatch.setattr(verify.tempfile, "TemporaryDirectory", FailingCleanup)
    invoke, database = pytest_cli
    result, error, output = invoke(report, 1 if "failures" in report else 0)
    assert result == 1
    assert database.failure is failure
    assert "E2E_ETL_PYTEST unexpected - - - -\n" in error
    assert "private-" not in error + output


def test_cli_pytest_system_exit_keeps_identity_and_cleanup(pytest_cli):
    invoke, database = pytest_cli
    failure = SystemExit(7)
    with pytest.raises(SystemExit) as caught:
        invoke(None, error=failure)
    assert caught.value is failure
    assert database.failure is failure
    assert database.cleaned


def test_cli_reports_migration_identity_on_opted_in_failure(monkeypatch, capsys) -> None:
    import etl.verify as verify

    class FakeDatabase:
        migration_dsn = "private-migration-url"

        def __init__(self, _dsn: str) -> None:
            pass

        def __enter__(self) -> str:
            return "private-test-url"

        def __exit__(self, *_args: object) -> None:
            pass

        def safe_error(self, _error: BaseException) -> str:
            return "redacted"

    monkeypatch.setattr(verify, "DisposablePostgres", FakeDatabase)
    monkeypatch.setattr(sys, "argv", ["etl-verify"])
    monkeypatch.setenv("ETL_TEST_ADMIN_DATABASE_URL", "private-admin-url")
    monkeypatch.setattr(
        verify,
        "apply_migrations",
        lambda *_args: (_ for _ in ()).throw(
            verify.MigrationApplyError("0022_results_exploration_scale.sql", "42710")
        ),
    )
    for opted_in in (False, True):
        if opted_in:
            monkeypatch.setenv("ETL_VERIFY_STAGE_REPORT", "1")
        else:
            monkeypatch.delenv("ETL_VERIFY_STAGE_REPORT", raising=False)
        assert main() == 1
        output = capsys.readouterr().err
        marker = "E2E_ETL_MIGRATION 0022_results_exploration_scale.sql 42710\n"
        assert (marker in output) is opted_in
        assert ("E2E_ETL_STAGE apply_migrations\n" in output) is opted_in
        assert "private-" not in output


@pytest.mark.parametrize("failure_point", ["connect", "enter", "exit"])
@pytest.mark.parametrize("state", ["42710", "invalid-private-state"])
def test_cli_redacts_migration_connection_and_commit_failures(
    monkeypatch, capsys, tmp_path: Path, failure_point: str, state: str
) -> None:
    import psycopg

    import etl.verify as verify

    class PrivateFailure(psycopg.Error):
        @property
        def sqlstate(self) -> str:
            return state

    class FakeConnection:
        def __enter__(self):
            if failure_point == "enter":
                raise PrivateFailure("private-driver-text private-dsn")
            return self

        def __exit__(self, *_args: object) -> None:
            if failure_point == "exit":
                raise PrivateFailure("private-driver-text private-dsn")

        def execute(self, _sql: bytes) -> None:
            pass

    def connect(_dsn: str) -> FakeConnection:
        if failure_point == "connect":
            raise PrivateFailure("private-driver-text private-dsn")
        return FakeConnection()

    class FakeDatabase:
        migration_dsn = "private-dsn"
        cleaned = False

        def __init__(self, _dsn: str) -> None:
            pass

        def __enter__(self) -> str:
            return "private-test-dsn"

        def __exit__(self, *_args: object) -> None:
            self.cleaned = True

        def safe_error(self, error: BaseException) -> str:
            return str(error)

    migration = tmp_path / "0001_safe.sql"
    migration.write_text("select 1;", encoding="utf-8")
    database = FakeDatabase("unused")
    monkeypatch.setattr(verify, "DisposablePostgres", lambda _dsn: database)
    monkeypatch.setattr(verify, "_migration_files", lambda _path: [migration])
    original_apply = verify.apply_migrations
    monkeypatch.setattr(
        verify, "apply_migrations", lambda dsn, paths: original_apply(dsn, paths, connect=connect)
    )
    monkeypatch.setattr(sys, "argv", ["etl-verify"])
    monkeypatch.setenv("ETL_TEST_ADMIN_DATABASE_URL", "private-admin-dsn")
    monkeypatch.setenv("ETL_VERIFY_STAGE_REPORT", "1")
    assert main() == 1
    output = capsys.readouterr().err
    assert "private-" not in output
    assert "E2E_ETL_STAGE apply_migrations\n" in output
    assert f"E2E_ETL_MIGRATION 0001_safe.sql {state if state == '42710' else '-'}\n" in output
    assert database.cleaned


@pytest.mark.parametrize(
    "message",
    [
        "unexpected SQL migration entry: private-person.sql",
        "failed to read migration file: private-person.sql",
    ],
)
def test_cli_redacts_unvalidated_migration_filename(monkeypatch, capsys, message: str) -> None:
    import etl.verify as verify

    class FakeDatabase:
        migration_dsn = "private-migration-dsn"

        def __init__(self, _dsn: str) -> None:
            pass

        def __enter__(self) -> str:
            return "private-test-dsn"

        def __exit__(self, *_args: object) -> None:
            pass

        def safe_error(self, error: BaseException) -> str:
            return str(error)

    def fail(_dsn: str, _migrations: Path) -> int:
        raise RuntimeError(message)

    monkeypatch.setattr(verify, "DisposablePostgres", FakeDatabase)
    monkeypatch.setattr(verify, "apply_migrations", fail)
    monkeypatch.setattr(sys, "argv", ["etl-verify"])
    monkeypatch.setenv("ETL_TEST_ADMIN_DATABASE_URL", "private-admin-dsn")
    monkeypatch.setenv("ETL_VERIFY_STAGE_REPORT", "1")

    assert verify.main() == 1
    output = capsys.readouterr().err
    assert "E2E_ETL_STAGE apply_migrations\n" in output
    assert "E2E_ETL_MIGRATION" not in output
    assert "private-" not in output
    assert "migration preparation failed; details redacted" in output


def test_cli_labels_cleanup_failure_after_successful_pytest(monkeypatch, capsys) -> None:
    import etl.verify as verify

    class FakeDatabase:
        migration_dsn = "private-migration-url"

        def __init__(self, _dsn: str) -> None:
            pass

        def __enter__(self) -> str:
            return "private-test-url"

        def __exit__(self, *_args: object) -> None:
            raise RuntimeError("private-cleanup-url")

        def grant_test_privileges(self) -> None:
            pass

        def safe_error(self, _error: BaseException) -> str:
            return "redacted"

    monkeypatch.setattr(verify, "DisposablePostgres", FakeDatabase)
    monkeypatch.setattr(verify, "apply_migrations", lambda *_args: 1)
    monkeypatch.setattr(verify, "run_pytest", lambda *_args: verify.PytestResult(1, 0))
    monkeypatch.setattr(sys, "argv", ["etl-verify"])
    monkeypatch.setenv("ETL_TEST_ADMIN_DATABASE_URL", "private-admin-url")
    monkeypatch.setenv("ETL_VERIFY_STAGE_REPORT", "1")
    assert main() == 1
    output = capsys.readouterr().err
    assert "E2E_ETL_STAGE owned_database_cleanup\n" in output
    assert "private-" not in output


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
            if "array_agg" not in lowered:
                return _Result((True, False, False, False, False, False, False, False))
            expected_memberships = (
                [
                    "etl_writer:false:true:true",
                    "results_exploration_executor:false:true:true",
                ]
                if self.roles[name] == "scoped-memberships"
                else []
            )
            return _Result(
                (
                    True,
                    False,
                    False,
                    False,
                    False,
                    False,
                    expected_memberships,
                    False,
                )
            )
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
        if lowered.startswith("grant etl_writer to"):
            assert "with inherit true, set true" in lowered
            return _Result()
        if lowered.startswith("grant results_exploration_executor to"):
            assert "with inherit true, set true" in lowered
            name = statement.rsplit('"', 2)[1]
            self.roles[name] = "scoped-memberships"
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
        if statement == "select current_user":
            return _Result((self.user,))
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


@pytest.mark.parametrize("opted_in", [False, True])
def test_cli_reports_safe_grant_operation_without_driver_text(
    monkeypatch: pytest.MonkeyPatch, capsys, opted_in: bool
) -> None:
    import psycopg

    from etl import verify

    connections = _Connections()
    database = DisposablePostgres(
        "postgresql://admin:maintenance-value@127.0.0.1/template1",
        identity=_identity(),
        connect=connections,
        secret_factory=lambda: "disposable-value",
    )
    original_execute = connections.admin.execute

    def execute(query: QueryNoTemplate, params: Params | None = None) -> _Result:
        if _query_text(query).startswith("grant etl_writer to"):
            raise psycopg.errors.InsufficientPrivilege("private-driver-text private-person")
        return original_execute(query, params)

    monkeypatch.setattr(connections.admin, "execute", execute)
    monkeypatch.setattr(verify, "DisposablePostgres", lambda _: database)
    monkeypatch.setattr(verify, "apply_migrations", lambda *_: 1)
    monkeypatch.setattr(verify, "run_pytest", lambda *_: pytest.fail("pytest must not start"))
    monkeypatch.setattr(sys, "argv", ["etl-verify"])
    monkeypatch.setenv("ETL_TEST_ADMIN_DATABASE_URL", database.admin_dsn)
    monkeypatch.setenv("ETL_VERIFY_STAGE_REPORT", "1" if opted_in else "0")

    assert verify.main() == 1
    output = capsys.readouterr().err
    assert "private-" not in output
    assert "privilege preparation failed; details redacted" in output
    assert ("E2E_ETL_STAGE grant_test_privileges\n" in output) is opted_in
    assert ("E2E_ETL_GRANT grant_etl_membership database 42501\n" in output) is opted_in
    assert connections.admin.databases == {}
    assert connections.admin.roles == {}


@pytest.fixture
def grant_cli(monkeypatch: pytest.MonkeyPatch):
    from etl import verify

    connections = _Connections()
    database = DisposablePostgres(
        "postgresql://admin:maintenance-value@127.0.0.1/template1",
        identity=_identity(),
        connect=connections,
        secret_factory=lambda: "disposable-value",
    )
    events: list[str] = []
    monkeypatch.setattr(verify, "DisposablePostgres", lambda _: database)
    monkeypatch.setattr(verify, "apply_migrations", lambda *_: events.append("migrations") or 1)
    monkeypatch.setattr(
        verify,
        "run_pytest",
        lambda *_: events.append("pytest") or verify.PytestResult(executed=1, skipped=0),
    )
    monkeypatch.setattr(sys, "argv", ["etl-verify"])
    monkeypatch.setenv("ETL_TEST_ADMIN_DATABASE_URL", database.admin_dsn)
    monkeypatch.setenv("ETL_VERIFY_STAGE_REPORT", "1")
    return database, connections, events


@pytest.mark.parametrize(
    ("operation", "statement", "admin"),
    [
        ("grant_database", "grant connect, create, temporary on database", True),
        ("grant_etl_membership", "grant etl_writer to", True),
        ("grant_results_membership", "grant results_exploration_executor to", True),
        ("verify_role", "select rolcanlogin", True),
        ("grant_public_schema", "grant usage, create on schema public", False),
        ("grant_verification_schema", "grant usage on schema votus_verification", False),
        ("grant_marker_read", "grant select on table votus_verification", False),
        ("grant_public_tables", "grant all privileges on all tables", False),
        ("grant_public_sequences", "grant all privileges on all sequences", False),
        ("grant_public_functions", "grant all privileges on all functions", False),
        ("register_scope", "insert into workspace_private.section_scope", False),
        ("create_public_policies", "do $$", False),
        ("verify_target_marker", "select current_database(), current_user", False),
    ],
)
def test_cli_identifies_each_grant_statement_without_changing_cleanup(
    monkeypatch: pytest.MonkeyPatch, capsys, grant_cli, operation: str, statement: str, admin: bool
) -> None:
    import psycopg

    database, connections, events = grant_cli
    connection_type = _AdminConnection if admin else _TargetConnection
    original = connection_type.execute
    failure = psycopg.errors.InsufficientPrivilege("private-sql private-person")
    failed = False

    def execute(self, query, params=None):
        nonlocal failed
        if events and not failed and _query_text(query).strip().startswith(statement):
            failed = True
            raise failure
        return original(self, query, params)

    monkeypatch.setattr(connection_type, "execute", execute)
    assert main() == 1
    output = capsys.readouterr().err
    assert f"E2E_ETL_GRANT {operation} database 42501\n" in output
    assert "E2E_ETL_STAGE grant_test_privileges\n" in output
    assert "private-" not in output
    assert events == ["migrations"]
    assert not database.created_by_this_run and not database.role_created_by_this_run
    assert connections.admin.databases == connections.admin.roles == {}


@pytest.mark.parametrize(
    ("phase", "point", "operation"),
    [
        ("admin", "connect", "connect_admin"),
        ("admin", "close", "close_admin"),
        ("migration", "connect", "migration_connection"),
        ("migration", "enter", "migration_connection"),
        ("migration", "exit", "migration_connection"),
        ("target", "connect", "target_connection"),
        ("target", "enter", "target_connection"),
        ("target", "exit", "target_connection"),
    ],
)
def test_cli_reports_grant_connection_lifecycle_failures(
    monkeypatch: pytest.MonkeyPatch, capsys, grant_cli, phase: str, point: str, operation: str
) -> None:
    import psycopg

    database, connections, events = grant_cli
    failed = False

    def fail_if_selected(selected: str) -> None:
        nonlocal failed
        if events and not failed and selected == phase:
            failed = True
            raise psycopg.errors.ConnectionFailure("private-connection-text")

    if point == "connect":
        original_connect = _Connections.__call__

        def connect(self, dsn, *, autocommit=False):
            selected = (
                "admin" if autocommit else ("target" if dsn == database.target_dsn else "migration")
            )
            fail_if_selected(selected)
            return original_connect(self, dsn, autocommit=autocommit)

        monkeypatch.setattr(_Connections, "__call__", connect)
    else:
        connection_type = _AdminConnection if phase == "admin" else _TargetConnection
        method = "close" if point == "close" else f"__{point}__"
        original = getattr(connection_type, method)

        def lifecycle(self, *args):
            selected = (
                "admin"
                if isinstance(self, _AdminConnection)
                else ("migration" if self.user == "admin" else "target")
            )
            fail_if_selected(selected)
            return original(self, *args)

        monkeypatch.setattr(connection_type, method, lifecycle)

    assert main() == 1
    output = capsys.readouterr().err
    assert f"E2E_ETL_GRANT {operation} database 08006\n" in output
    assert "private-" not in output
    assert events == ["migrations"]
    assert connections.admin.databases == connections.admin.roles == {}


@pytest.mark.parametrize(
    "guard", ["validate_state", "validate_target_dsn", "verify_role", "verify_target_marker"]
)
def test_cli_reports_grant_safety_guards_without_private_rows(
    monkeypatch: pytest.MonkeyPatch, capsys, grant_cli, guard: str
) -> None:
    from etl import verify

    database, connections, events = grant_cli
    if guard in ("validate_state", "validate_target_dsn"):

        def migrate(*_):
            events.append("migrations")
            if guard == "validate_state":
                database.admin = connections.admin
            else:
                database.target_dsn = None
            return 1

        monkeypatch.setattr(verify, "apply_migrations", migrate)
    else:
        connection_type = _AdminConnection if guard == "verify_role" else _TargetConnection
        original = connection_type.execute

        def execute(self, query, params=None):
            text = _query_text(query)
            if events and (
                "array_agg" in text if guard == "verify_role" else "current_user" in text
            ):
                return _Result(("private-catalog-row",) * 8)
            return original(self, query, params)

        monkeypatch.setattr(connection_type, "execute", execute)

    assert main() == 1
    output = capsys.readouterr().err
    assert f"E2E_ETL_GRANT {guard} safety -\n" in output
    assert "private-" not in output
    assert events == ["migrations"]
    assert connections.admin.databases == connections.admin.roles == {}


@pytest.mark.parametrize(
    ("kind", "state", "category", "reported_state"),
    [
        ("database", "42501", "database", "42501"),
        ("database", "invalid-private-state", "database", "-"),
        ("database", "42p01", "database", "-"),
        ("database", None, "database", "-"),
        ("spoofed", "42501", "unexpected", "-"),
        ("safety", None, "safety", "-"),
        ("keyboard", None, "interrupted", "-"),
        ("signal", None, "interrupted", "-"),
        ("system_exit", None, None, None),
    ],
)
def test_cli_grant_categories_preserve_exception_identity_and_signal_behavior(
    monkeypatch: pytest.MonkeyPatch,
    capsys,
    grant_cli,
    kind: str,
    state: str | None,
    category: str | None,
    reported_state: str | None,
) -> None:
    import psycopg

    _, connections, events = grant_cli
    error_type = {
        "database": psycopg.Error,
        "spoofed": RuntimeError,
        "safety": UnsafeDatabaseError,
        "keyboard": KeyboardInterrupt,
        "signal": InterruptedError,
        "system_exit": SystemExit,
    }[kind]
    failure = error_type("private-driver-text")
    if kind in ("database", "spoofed"):
        failure.sqlstate = state
    original_execute = _TargetConnection.execute
    original_exit = _TargetConnection.__exit__
    propagated: list[BaseException] = []

    def execute(self, query, params=None):
        if _query_text(query).startswith("insert into workspace_private.section_scope"):
            raise failure
        return original_execute(self, query, params)

    def exit_connection(self, exc_type, exc_value, traceback):
        if exc_value is not None:
            assert exc_type is type(failure)
            propagated.append(exc_value)
        return original_exit(self, exc_type, exc_value, traceback)

    monkeypatch.setattr(_TargetConnection, "execute", execute)
    monkeypatch.setattr(_TargetConnection, "__exit__", exit_connection)
    prior_handler = signal.getsignal(signal.SIGTERM)
    if kind == "system_exit":
        with pytest.raises(SystemExit) as caught:
            main()
        assert caught.value is failure
    else:
        assert main() == 1
    output = capsys.readouterr().err
    if category is None:
        assert "E2E_ETL_GRANT" not in output
    else:
        assert f"E2E_ETL_GRANT register_scope {category} {reported_state}\n" in output
    assert "private-" not in output
    assert propagated == [failure]
    assert signal.getsignal(signal.SIGTERM) is prior_handler
    assert events == ["migrations"]
    assert connections.admin.databases == connections.admin.roles == {}


@pytest.mark.parametrize(
    "replacement", ["admin_close", "migration_exit", "target_exit", "owned_cleanup"]
)
def test_cli_grant_replacement_errors_do_not_reuse_earlier_operation(
    monkeypatch: pytest.MonkeyPatch, capsys, grant_cli, replacement: str
) -> None:
    import psycopg

    _, connections, events = grant_cli
    primary = psycopg.errors.InsufficientPrivilege("private-grant-failure")
    replacing = psycopg.errors.ConnectionFailure("cleanup failed")
    first_failed = False
    replaced = False
    admin = replacement in ("admin_close", "owned_cleanup")
    statement = (
        "grant etl_writer to"
        if admin
        else (
            "grant usage, create on schema public"
            if replacement == "migration_exit"
            else "select current_database(), current_user"
        )
    )
    connection_type = _AdminConnection if admin else _TargetConnection
    original_execute = connection_type.execute

    def execute(self, query, params=None):
        nonlocal first_failed, replaced
        text = _query_text(query)
        if text.startswith(statement):
            first_failed = True
            raise primary
        if replacement == "owned_cleanup" and text.startswith("drop database"):
            replaced = True
            raise replacing
        return original_execute(self, query, params)

    monkeypatch.setattr(connection_type, "execute", execute)
    if replacement != "owned_cleanup":
        method = "close" if admin else "__exit__"
        original_lifecycle = getattr(connection_type, method)

        def lifecycle(self, *args):
            nonlocal replaced
            if first_failed and not replaced:
                replaced = True
                raise replacing
            return original_lifecycle(self, *args)

        monkeypatch.setattr(connection_type, method, lifecycle)

    assert main() == 1
    output = capsys.readouterr().err
    assert first_failed and replaced
    assert "private-" not in output
    if replacement == "owned_cleanup":
        assert "E2E_ETL_STAGE owned_database_cleanup\n" in output
        assert "E2E_ETL_GRANT" not in output
    else:
        operation = {
            "admin_close": "close_admin",
            "migration_exit": "migration_connection",
            "target_exit": "target_connection",
        }[replacement]
        assert f"E2E_ETL_GRANT {operation} database 08006\n" in output
        assert connections.admin.databases == connections.admin.roles == {}
    assert sum(text.startswith("drop database") for text, _ in connections.admin.statements) == (
        0 if replacement == "owned_cleanup" else 1
    )
    assert events == ["migrations"]


def test_cli_success_has_no_grant_failure_marker(capsys, grant_cli) -> None:
    _, connections, events = grant_cli
    assert main() == 0
    assert "E2E_ETL_GRANT" not in capsys.readouterr().err
    assert events == ["migrations", "pytest"]
    assert connections.admin.databases == connections.admin.roles == {}


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
    assert any(
        "insert into workspace_private.section_scope" in statement.lower()
        for target in connections.targets
        for statement in target.executed
    )
    assert grants == [
        f'grant connect, create, temporary on database "{identity.name}" to "{identity.role_name}"',
        f'grant etl_writer to "{identity.role_name}" with inherit true, set true',
        f'grant results_exploration_executor to "{identity.role_name}" with inherit true, set true',
        f'grant usage, create on schema public to "{identity.role_name}"',
        f'grant usage on schema votus_verification to "{identity.role_name}"',
        f'grant select on table votus_verification.ownership_marker to "{identity.role_name}"',
        f'grant all privileges on all tables in schema public to "{identity.role_name}"',
        f'grant all privileges on all sequences in schema public to "{identity.role_name}"',
        f'grant all privileges on all functions in schema public to "{identity.role_name}"',
        "grant workspace_admin_owner to "
        f'"votus_etl_scope_{identity.token.hex}" with inherit false, set true',
        f'grant "votus_etl_scope_{identity.token.hex}" to "admin" with inherit false, set true',
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
    assert any(
        "shobj_description" in statement.lower() for statement, _ in connections.admin.statements
    )


def test_failure_between_create_and_marker_refuses_unmarked_database_cleanup() -> None:
    connections = _Connections()
    connections.admin.fail_comment = True
    identity = _identity()

    with pytest.raises(BaseExceptionGroup) as caught:
        DisposablePostgres(
            "postgresql://user:secret@localhost/template1",
            identity=identity,
            connect=connections,
        ).open()

    messages = [str(error) for error in caught.value.exceptions]
    assert any("comment install failed" in message for message in messages)
    assert any("database comment marker" in message for message in messages)
    assert identity.name in connections.admin.databases


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

    with pytest.raises(UnsafeDatabaseError, match="comment marker"):
        database.close()
    assert identity.name in connections.admin.databases

    connections.admin.databases[identity.name] = identity.marker
    database.close()
    database.close()
    drops = [s for s, _ in connections.admin.statements if s.lower().startswith("drop database")]
    assert len(drops) == 1


def test_apply_migrations_reports_collision_in_shared_role_catalog(tmp_path: Path) -> None:
    import psycopg

    from etl.verify import MigrationApplyError

    migrations = tmp_path / "migrations"
    migrations.mkdir()
    (migrations / "0001_create_role.sql").write_text("CREATE ROLE disposable_role;")
    roles: set[str] = set()

    class FakeConnection:
        def __enter__(self):
            return self

        def __exit__(self, *_args: object) -> None:
            pass

        def execute(self, _query: bytes) -> None:
            if "disposable_role" in roles:
                raise psycopg.errors.DuplicateObject("private DSN and SQL")
            roles.add("disposable_role")

    def connect(_dsn: str) -> FakeConnection:
        return FakeConnection()

    assert apply_migrations("disposable-one", migrations, connect=connect) == 1
    with pytest.raises(MigrationApplyError) as caught:
        apply_migrations("disposable-two", migrations, connect=connect)
    assert caught.value.filename == "0001_create_role.sql"
    assert caught.value.sqlstate == "42710"
    assert isinstance(caught.value.__cause__, psycopg.errors.DuplicateObject)


def test_apply_migrations_requires_a_complete_mixed_version_sequence_and_executes_every_file(
    tmp_path: Path,
) -> None:
    migrations = tmp_path / "migrations"
    migrations.mkdir()
    (migrations / "0001_first.sql").write_text("select 1;", encoding="utf-8")
    (migrations / "0002_second.sql").write_text("select 2;", encoding="utf-8")
    (migrations / "20260824193650_third.sql").write_text("select 3;", encoding="utf-8")
    connections = _Connections()
    identity = _identity()
    connections.admin.databases[identity.name] = identity.marker

    applied = apply_migrations(
        "dbname=" + identity.name,
        migrations,
        connect=connections,
    )

    assert applied == 3
    assert [target.executed for target in connections.targets] == [
        ["select 1;"],
        ["select 2;"],
        ["select 3;"],
    ]

    (migrations / "0002_second.sql").unlink()
    (migrations / "0003_gap.sql").write_text("select 4;", encoding="utf-8")
    with pytest.raises(RuntimeError, match="contiguous"):
        apply_migrations("dbname=" + identity.name, migrations, connect=connections)

    (migrations / "20260824193650_duplicate.sql").write_text("select 5;", encoding="utf-8")
    with pytest.raises(RuntimeError, match="versions must be unique"):
        apply_migrations("dbname=" + identity.name, migrations, connect=connections)


def test_apply_migrations_rejects_unexpected_sql_entries_before_connecting(
    tmp_path: Path,
) -> None:
    migrations = tmp_path / "migrations"
    migrations.mkdir()
    (migrations / "0001_first.sql").write_text("select 1;", encoding="utf-8")
    (migrations / "migration_typo.sql").write_text("select 2;", encoding="utf-8")
    connections = _Connections()

    with pytest.raises(RuntimeError, match="unexpected SQL migration entry"):
        apply_migrations("dbname=votus_etl_verify_test", migrations, connect=connections)

    assert connections.dsns == []


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
    connections.fail_marker_install = True
    connections.admin.fail_drop = True

    with pytest.raises(BaseExceptionGroup) as caught:
        DisposablePostgres(
            "postgresql://user:secret@localhost/template1",
            identity=_identity(),
            connect=connections,
        ).open()

    messages = [str(error) for error in caught.value.exceptions]
    assert any("marker install failed" in message for message in messages)
    assert any("drop failed" in message for message in messages)


@pytest.mark.parametrize("case", [None, "success", "ledger", "sql"])
@pytest.mark.parametrize("proof_fails", [False, True])
def test_command_runs_only_selected_proof_or_full_default_and_cleans_up(
    monkeypatch: pytest.MonkeyPatch, capsys, case: str | None, proof_fails: bool
) -> None:
    from etl import verify

    connections = _Connections()
    database = DisposablePostgres(
        "postgresql://admin:maintenance-value@127.0.0.1/template1",
        identity=_identity(),
        connect=connections,
        secret_factory=lambda: "disposable-value",
    )
    events: list[str] = []
    monkeypatch.setenv("ETL_TEST_ADMIN_DATABASE_URL", database.admin_dsn)
    monkeypatch.setattr(
        sys, "argv", ["etl-verify", *(["--migration-atomicity", case] if case else [])]
    )
    monkeypatch.setattr(verify, "DisposablePostgres", lambda _: database)

    def proof(owned: DisposablePostgres, migrations: Path, selected: str) -> None:
        assert selected == case
        assert owned is database and owned.created_by_this_run
        assert owned.admin is None
        assert migrations.name == "migrations"
        events.append("proof")
        if proof_fails:
            raise RuntimeError("migration_atomicity:ledger:rollback=0")

    def migrate(dsn: str, migrations: Path) -> int:
        assert dsn == database.migration_dsn
        events.append("migrations")
        return 1

    def pytest_child(dsn: str, root: Path) -> verify.PytestResult:
        assert "maintenance-value" not in dsn
        assert database.identity.role_name in dsn
        assert database.admin is None
        events.append("restricted_pytest")
        return verify.PytestResult(executed=1, skipped=0)

    grant = database.grant_test_privileges

    def grant_after_migrations() -> None:
        events.append("grants")
        grant()

    monkeypatch.setattr(database, "grant_test_privileges", grant_after_migrations)
    monkeypatch.setattr(verify, "run_migration_atomicity", proof, raising=False)
    monkeypatch.setattr(verify, "apply_migrations", migrate)
    monkeypatch.setattr(verify, "run_pytest", pytest_child)

    assert verify.main() == (1 if case and proof_fails else 0)
    expected = ["proof"] if case else ["migrations", "grants", "restricted_pytest"]
    assert events == expected
    assert connections.admin.databases == {}
    assert connections.admin.roles == {}
    output = capsys.readouterr()
    assert "maintenance-value" not in output.out + output.err
    assert "disposable-value" not in output.out + output.err


@pytest.mark.parametrize(
    "arguments", [["--migration-atomicity"], ["--migration-atomicity", "other"]]
)
def test_command_rejects_missing_or_invalid_proof_case_before_provisioning(
    monkeypatch: pytest.MonkeyPatch, arguments: list[str]
) -> None:
    from etl import verify

    monkeypatch.setattr(sys, "argv", ["etl-verify", *arguments])
    monkeypatch.setattr(verify, "DisposablePostgres", lambda _: pytest.fail("provisioned"))
    with pytest.raises(SystemExit) as caught:
        verify.main()
    assert caught.value.code == 2


def test_command_isolates_cli_credentials_and_cleans_up_on_wrong_cli_version(
    monkeypatch: pytest.MonkeyPatch, capsys
) -> None:
    from etl import migration_atomicity, verify

    connections = _Connections()
    database = DisposablePostgres(
        "postgresql://postgres:maintenance-value@127.0.0.1:54322/template1",
        connect=connections,
    )
    monkeypatch.setenv("ETL_TEST_ADMIN_DATABASE_URL", database.admin_dsn)
    monkeypatch.setenv("GITHUB_ACTIONS", "true")
    monkeypatch.setenv("POSTGRES_CONTAINER", "a" * 64)
    monkeypatch.setenv("SUPABASE_ACCESS_TOKEN", "unrelated-value")
    monkeypatch.setattr(sys, "argv", ["etl-verify", "--migration-atomicity", "success"])
    monkeypatch.setattr(verify, "DisposablePostgres", lambda _: database)
    monkeypatch.setattr(migration_atomicity.shutil, "which", lambda _: "/synthetic/supabase")
    children = []

    def cli_child(command, **kwargs):
        assert command == ["/synthetic/supabase", "--version"]
        env = kwargs["env"]
        assert set(env) == {"PATH", "HOME", "XDG_CONFIG_HOME", "XDG_CACHE_HOME", "PGPASSWORD"}
        assert env["PGPASSWORD"] == "maintenance-value"
        assert Path(env["HOME"]) == kwargs["cwd"]
        assert kwargs["stdin"] == subprocess.DEVNULL and kwargs["shell"] is False
        assert kwargs["capture_output"] is True
        children.append(command)
        return subprocess.CompletedProcess(command, 1, "", "maintenance-value unrelated-value")

    monkeypatch.setattr(migration_atomicity.subprocess, "run", cli_child)

    assert verify.main() == 1
    assert len(children) == 1
    assert connections.admin.databases == connections.admin.roles == {}
    output = capsys.readouterr()
    assert "migration_atomicity:cli_pin=0" in output.err
    assert "maintenance-value" not in output.out + output.err
    assert "unrelated-value" not in output.out + output.err


def test_command_is_reachable_from_the_installed_package_entry_point(tmp_path: Path) -> None:
    entry_point = Path(sys.executable).with_name("etl-verify")
    assert entry_point.is_file()

    completed = subprocess.run(
        [str(entry_point)],
        cwd=tmp_path,
        env={},
        capture_output=True,
        check=False,
        text=True,
    )

    assert completed.returncode == 2
    assert completed.stdout == ""
    assert "ETL_TEST_ADMIN_DATABASE_URL must name a reachable 'template1'" in completed.stderr
