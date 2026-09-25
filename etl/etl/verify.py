"""Fail-closed ETL verification against a disposable sibling Postgres database."""

from __future__ import annotations

import argparse
import os
import re
import secrets
import signal
import subprocess
import sys
import tempfile
import uuid
import xml.etree.ElementTree as ET
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from types import FrameType, TracebackType
from typing import Literal, Protocol, Self, TypeVar

import psycopg
from psycopg import sql
from psycopg.abc import Params, QueryNoTemplate
from psycopg.conninfo import conninfo_to_dict, make_conninfo

from etl.migration_atomicity import run_migration_atomicity

NAME_PREFIX = "votus_etl_verify_"
MARKER_PREFIX = "votus-etl-verify:"
ADMIN_DATABASE = "template1"
_MIGRATION_FILE_PATTERN = re.compile(r"^(?P<version>[0-9]{4}|[0-9]{14})_.+\.sql$")
_TEST_ROLE_MEMBERSHIPS = (
    "etl_writer:false:true:true",
    "results_exploration_executor:false:true:true",
)
_cleanup_depth = 0
_deferred_signal: signal.Signals | None = None


class UnsafeDatabaseError(RuntimeError):
    """The requested operation does not satisfy the disposable identity contract."""


_DatabaseRow = tuple[object, ...]
_SignalHandler = Callable[[int, FrameType | None], object] | signal.Handlers | int | None
_RowT_co = TypeVar("_RowT_co", covariant=True)
_GrantOperation = Literal[
    "validate_state",
    "connect_admin",
    "grant_database",
    "grant_etl_membership",
    "grant_results_membership",
    "verify_role",
    "close_admin",
    "migration_connection",
    "grant_public_schema",
    "grant_verification_schema",
    "grant_marker_read",
    "grant_public_tables",
    "grant_public_sequences",
    "grant_public_functions",
    "register_scope",
    "create_public_policies",
    "validate_target_dsn",
    "target_connection",
    "verify_target_marker",
]


class _Cursor(Protocol[_RowT_co]):
    def fetchone(self) -> _RowT_co | None: ...


class _Connection(Protocol[_RowT_co]):
    def execute(
        self, query: QueryNoTemplate, params: Params | None = None
    ) -> _Cursor[_RowT_co]: ...

    def close(self) -> None: ...

    def __enter__(self) -> Self: ...

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc_val: BaseException | None,
        exc_tb: TracebackType | None,
    ) -> None: ...


class _ConnectionFactory(Protocol):
    def __call__(self, conninfo: str, *, autocommit: bool = False) -> _Connection[_DatabaseRow]: ...


def _require_admin(
    admin: _Connection[_DatabaseRow] | None,
) -> _Connection[_DatabaseRow]:
    if admin is None:
        raise UnsafeDatabaseError("administrative connection is unavailable")
    return admin


def _require_dsn(dsn: str | None, label: str) -> str:
    if dsn is None:
        raise UnsafeDatabaseError(f"{label} database URL is unavailable")
    return dsn


@dataclass(frozen=True)
class DatabaseIdentity:
    name: str
    marker: str
    token: uuid.UUID

    @property
    def role_name(self) -> str:
        return f"{NAME_PREFIX}role_{self.token.hex}"

    @classmethod
    def generate(cls) -> DatabaseIdentity:
        token = uuid.uuid4()
        return cls(
            name=f"{NAME_PREFIX}{token.hex}",
            marker=f"{MARKER_PREFIX}{token}",
            token=token,
        )

    def validate(self) -> None:
        expected_name = f"{NAME_PREFIX}{self.token.hex}"
        expected_marker = f"{MARKER_PREFIX}{self.token}"
        if self.name != expected_name or self.marker != expected_marker:
            raise UnsafeDatabaseError("database name or ownership marker is not disposable")
        if re.fullmatch(r"votus_etl_verify_[0-9a-f]{32}", self.name) is None:
            raise UnsafeDatabaseError("database name is outside the disposable identity contract")
        if re.fullmatch(r"votus_etl_verify_role_[0-9a-f]{32}", self.role_name) is None:
            raise UnsafeDatabaseError("role name is outside the disposable identity contract")


@dataclass(frozen=True)
class PytestResult:
    executed: int
    skipped: int


@dataclass(frozen=True)
class PytestDiagnostic:
    outcome: Literal[
        "skips_rejected",
        "pytest_failed",
        "report_missing",
        "report_invalid",
        "runner_error",
        "interrupted",
        "unexpected",
    ]
    exit_code: int | None = None
    tests: int | None = None
    skipped: int | None = None
    failed: int | None = None

    def marker(self) -> str:
        def bounded(value: int | None, maximum: int) -> str:
            return str(value) if type(value) is int and 0 <= value <= maximum else "-"

        return "E2E_ETL_PYTEST " + " ".join(
            [
                self.outcome,
                bounded(self.exit_code, 255),
                *(bounded(value, 2**53 - 1) for value in (self.tests, self.skipped, self.failed)),
            ]
        )


def _connection_params(dsn: str) -> dict[str, str]:
    try:
        return {key: str(value) for key, value in conninfo_to_dict(dsn).items()}
    except Exception as exc:
        raise UnsafeDatabaseError("administrative database URL is invalid") from exc


def _target_dsn(
    admin_dsn: str,
    database_name: str,
    *,
    user: str | None = None,
    password: str | None = None,
) -> str:
    params = _connection_params(admin_dsn)
    configured_database = params.get("dbname")
    if configured_database != ADMIN_DATABASE:
        raise UnsafeDatabaseError(
            f"administrative URL must name the {ADMIN_DATABASE!r} maintenance database"
        )
    params["dbname"] = database_name
    if user is not None:
        params["user"] = user
    if password is not None:
        params["password"] = password
    return make_conninfo(**params)


class DisposablePostgres:
    """Own one UUID-named database and refuse cleanup without its exact marker."""

    def __init__(
        self,
        admin_dsn: str,
        *,
        identity: DatabaseIdentity | None = None,
        connect: _ConnectionFactory = psycopg.connect,
        secret_factory: Callable[[], str] = lambda: secrets.token_urlsafe(32),
    ) -> None:
        self.admin_dsn = admin_dsn
        self.identity = identity or DatabaseIdentity.generate()
        self.connect = connect
        self.role_secret = secret_factory()
        self.admin: _Connection[_DatabaseRow] | None = None
        self.created_by_this_run = False
        self.role_created_by_this_run = False
        self.marker_table_created = False
        self.target_dsn: str | None = None
        self.migration_dsn: str | None = None
        self._grant_failure: tuple[BaseException, _GrantOperation] | None = None

    @contextmanager
    def _grant_operation(self, operation: _GrantOperation) -> Iterator[None]:
        try:
            yield
        except BaseException as error:
            # A surrounding connection exit keeps the inner operation only when
            # it propagates the same exception, not when commit/close replaces it.
            if self._grant_failure is None or self._grant_failure[0] is not error:
                self._grant_failure = (error, operation)
            raise

    def grant_failure_marker(self, error: BaseException) -> str | None:
        if self._grant_failure is None or self._grant_failure[0] is not error:
            return None
        state = "-"
        if isinstance(error, psycopg.Error):
            category = "database"
            if isinstance(error.sqlstate, str) and re.fullmatch(r"[0-9A-Z]{5}", error.sqlstate):
                state = error.sqlstate
        elif isinstance(error, UnsafeDatabaseError):
            category = "safety"
        elif isinstance(error, (KeyboardInterrupt, InterruptedError)):
            category = "interrupted"
        else:
            category = "unexpected"
        return f"E2E_ETL_GRANT {self._grant_failure[1]} {category} {state}"

    def safe_error(self, error: BaseException) -> str:
        message = str(error)
        sensitive = {self.admin_dsn, self.role_secret}
        sensitive.update(
            value
            for value in _connection_params(self.admin_dsn).values()
            if value and value in message
        )
        for value in sorted(sensitive, key=len, reverse=True):
            message = message.replace(value, "[redacted]")
        return message

    def _database_exists(self) -> bool:
        admin = _require_admin(self.admin)
        row = admin.execute(
            "select 1 from pg_database where datname = %s",
            (self.identity.name,),
        ).fetchone()
        return row == (1,)

    def _verify_database_comment(self) -> None:
        admin = _require_admin(self.admin)
        row = admin.execute(
            "select shobj_description(oid, 'pg_database') from pg_database where datname = %s",
            (self.identity.name,),
        ).fetchone()
        if row != (self.identity.marker,):
            raise UnsafeDatabaseError(
                "refusing cleanup because the database comment marker changed"
            )

    def _role_exists(self) -> bool:
        admin = _require_admin(self.admin)
        row = admin.execute(
            "select 1 from pg_roles where rolname = %s",
            (self.identity.role_name,),
        ).fetchone()
        return row == (1,)

    def _verify_global_roles_are_already_final(self) -> None:
        admin = _require_admin(self.admin)
        row = admin.execute(
            """
            select
              (select count(*) = 3
                 from pg_roles
                where rolname in ('anon', 'authenticated', 'etl_writer'))
              and coalesce(
                (select rolpassword is null and rolcanlogin and rolbypassrls
                        and not rolsuper
                        and not rolcreatedb
                        and not rolcreaterole
                        and not rolreplication
                   from pg_authid
                  where rolname = 'etl_writer'),
                false
              )
              and exists (
                select 1
                  from pg_auth_members membership
                  join pg_roles granted_role on granted_role.oid = membership.roleid
                  join pg_roles member_role on member_role.oid = membership.member
                 where granted_role.rolname = 'etl_writer'
                   and member_role.rolname = 'postgres'
              )
            """
        ).fetchone()
        if row != (True,):
            raise UnsafeDatabaseError(
                "migrations would change shared cluster roles; apply them only on an "
                "already-current local Supabase cluster"
            )

    def _verify_target(self) -> None:
        migration_dsn = _require_dsn(self.migration_dsn, "migration")
        with self.connect(migration_dsn) as connection:
            row = connection.execute(
                """
                select current_database(), marker
                from votus_verification.ownership_marker
                """
            ).fetchone()
        if row != (self.identity.name, self.identity.marker):
            raise UnsafeDatabaseError("connected database failed its disposable identity check")

    def _verify_role(self, *, expected_memberships: tuple[str, ...] = ()) -> None:
        admin = _require_admin(self.admin)
        row = admin.execute(
            """
            select rolcanlogin, rolsuper, rolcreatedb, rolcreaterole,
                   rolreplication, rolbypassrls,
                   coalesce(
                     (
                       select array_agg(
                                granted_role.rolname
                                || ':' || membership.admin_option::text
                                || ':' || membership.inherit_option::text
                                || ':' || membership.set_option::text
                                order by granted_role.rolname
                              )
                         from pg_auth_members membership
                         join pg_roles granted_role on granted_role.oid = membership.roleid
                        where membership.member = pg_authid.oid
                     ),
                     array[]::text[]
                   ),
                   exists (
                     select 1
                       from pg_database
                      where datname <> %s
                        and has_database_privilege(pg_authid.oid, oid, 'CREATE')
                   )
              from pg_authid
             where rolname = %s
            """,
            (self.identity.name, self.identity.role_name),
        ).fetchone()
        expected = (
            True,
            False,
            False,
            False,
            False,
            False,
            list(expected_memberships),
            False,
        )
        if row != expected:
            categories = None if row is None else row[6:]
            raise UnsafeDatabaseError(
                "disposable role privilege verification failed "
                f"(scoped memberships and cross-database CREATE: {categories})"
            )

    def open(self) -> str:
        self.identity.validate()
        self.migration_dsn = _target_dsn(self.admin_dsn, self.identity.name)
        self.target_dsn = _target_dsn(
            self.admin_dsn,
            self.identity.name,
            user=self.identity.role_name,
            password=self.role_secret,
        )
        self.admin = self.connect(self.admin_dsn, autocommit=True)
        try:
            self._verify_global_roles_are_already_final()
            self.admin.execute(
                sql.SQL(
                    "create role {} login password {} nosuperuser nocreatedb "
                    "nocreaterole noreplication nobypassrls"
                ).format(
                    sql.Identifier(self.identity.role_name),
                    sql.Literal(self.role_secret),
                )
            )
            self.role_created_by_this_run = True
            self.admin.execute(
                sql.SQL("comment on role {} is {}").format(
                    sql.Identifier(self.identity.role_name),
                    sql.Literal(self.identity.marker),
                )
            )
            self._verify_role()
            self.admin.execute(
                sql.SQL("create database {}").format(sql.Identifier(self.identity.name))
            )
            self.created_by_this_run = True
            self.admin.execute(
                sql.SQL("comment on database {} is {}").format(
                    sql.Identifier(self.identity.name),
                    sql.Literal(self.identity.marker),
                )
            )
            with self.connect(self.migration_dsn) as connection:
                connection.execute("create schema votus_verification")
                connection.execute(
                    "create table votus_verification.ownership_marker (marker text primary key)"
                )
                connection.execute(
                    "insert into votus_verification.ownership_marker (marker) values (%s)",
                    (self.identity.marker,),
                )
            self.marker_table_created = True
            self._verify_target()
            self.admin.close()
            self.admin = None
            return self.target_dsn
        except BaseException as original:
            cleanup_required = self.created_by_this_run
            if self.role_created_by_this_run:
                cleanup_required = True
            if cleanup_required:
                try:
                    self.close()
                except BaseException as cleanup_error:
                    raise BaseExceptionGroup(
                        "database setup failed and cleanup also failed",
                        [original, cleanup_error],
                    ) from None
            elif self.admin is not None:
                self.admin.close()
            raise

    def grant_test_privileges(self) -> None:
        self._grant_failure = None
        with self._grant_operation("validate_state"):
            migration_dsn = _require_dsn(self.migration_dsn, "migration")
            if self.admin is not None:
                raise UnsafeDatabaseError(
                    "administrative connection must be closed before granting test privileges"
                )
        with self._grant_operation("connect_admin"):
            admin = self.connect(self.admin_dsn, autocommit=True)
        self.admin = admin
        try:
            with self._grant_operation("grant_database"):
                admin.execute(
                    sql.SQL("grant connect, create, temporary on database {} to {}").format(
                        sql.Identifier(self.identity.name),
                        sql.Identifier(self.identity.role_name),
                    )
                )
            with self._grant_operation("grant_etl_membership"):
                admin.execute(
                    sql.SQL("grant etl_writer to {} with inherit true, set true").format(
                        sql.Identifier(self.identity.role_name)
                    )
                )
            with self._grant_operation("grant_results_membership"):
                admin.execute(
                    sql.SQL(
                        "grant results_exploration_executor to {} with inherit true, set true"
                    ).format(sql.Identifier(self.identity.role_name))
                )
            with self._grant_operation("verify_role"):
                self._verify_role(expected_memberships=_TEST_ROLE_MEMBERSHIPS)
        finally:
            with self._grant_operation("close_admin"):
                admin.close()
            self.admin = None

        with (
            self._grant_operation("migration_connection"),
            self.connect(migration_dsn) as connection,
        ):
            role = sql.Identifier(self.identity.role_name)
            with self._grant_operation("grant_public_schema"):
                connection.execute(
                    sql.SQL("grant usage, create on schema public to {}").format(role)
                )
            with self._grant_operation("grant_verification_schema"):
                connection.execute(
                    sql.SQL("grant usage on schema votus_verification to {}").format(role)
                )
            with self._grant_operation("grant_marker_read"):
                connection.execute(
                    sql.SQL(
                        "grant select on table votus_verification.ownership_marker to {}"
                    ).format(role)
                )
            with self._grant_operation("grant_public_tables"):
                connection.execute(
                    sql.SQL("grant all privileges on all tables in schema public to {}").format(
                        role
                    )
                )
            with self._grant_operation("grant_public_sequences"):
                connection.execute(
                    sql.SQL("grant all privileges on all sequences in schema public to {}").format(
                        role
                    )
                )
            with self._grant_operation("grant_public_functions"):
                connection.execute(
                    sql.SQL("grant all privileges on all functions in schema public to {}").format(
                        role
                    )
                )
            with self._grant_operation("register_scope"):
                current_role = connection.execute("select current_user").fetchone()
                if current_role is None or not isinstance(current_role[0], str):
                    raise UnsafeDatabaseError("maintenance role identity is unavailable")
                maintenance_role = sql.Identifier(current_role[0])
                bridge = sql.Identifier(f"votus_etl_scope_{self.identity.token.hex}")
                # A fresh transactional bridge leaves preexisting membership options intact.
                connection.execute(
                    sql.SQL(
                        "create role {} nologin noinherit nosuperuser nocreatedb "
                        "nocreaterole noreplication nobypassrls"
                    ).format(bridge)
                )
                connection.execute(
                    sql.SQL(
                        "grant workspace_admin_owner to {} with inherit false, set true"
                    ).format(bridge)
                )
                connection.execute(
                    sql.SQL("grant {} to {} with inherit false, set true").format(
                        bridge, maintenance_role
                    )
                )
                connection.execute("set local role workspace_admin_owner")
                connection.execute(
                    "insert into workspace_private.section_scope(distrito_code,seccion_code) "
                    "values('02','027') on conflict do nothing"
                )
                connection.execute(sql.SQL("set local role {}").format(maintenance_role))
                connection.execute(sql.SQL("revoke {} from {}").format(bridge, maintenance_role))
                connection.execute(sql.SQL("revoke workspace_admin_owner from {}").format(bridge))
                connection.execute(sql.SQL("drop role {}").format(bridge))
            with self._grant_operation("create_public_policies"):
                connection.execute(
                    sql.SQL(
                        """
                        do $$
                        declare table_name text;
                        begin
                          for table_name in
                            select relation.relname
                              from pg_class relation
                              join pg_namespace namespace on namespace.oid = relation.relnamespace
                             where namespace.nspname = 'public'
                               and relation.relkind in ('r', 'p')
                               and relation.relrowsecurity
                          loop
                            execute format(
                              'create policy %I on public.%I to %I using (true) with check (true)',
                              'votus_etl_verify_access', table_name, {}
                            );
                          end loop;
                        end
                        $$
                        """
                    ).format(sql.Literal(self.identity.role_name))
                )

        with self._grant_operation("validate_target_dsn"):
            target_dsn = _require_dsn(self.target_dsn, "test")
        with self._grant_operation("target_connection"), self.connect(target_dsn) as connection:
            with self._grant_operation("verify_target_marker"):
                row = connection.execute(
                    "select current_database(), current_user, marker "
                    "from votus_verification.ownership_marker"
                ).fetchone()
        with self._grant_operation("verify_target_marker"):
            if row != (self.identity.name, self.identity.role_name, self.identity.marker):
                raise UnsafeDatabaseError("disposable role cannot reach its marked database")

    def _close_once(self) -> None:
        if self.admin is None:
            if not self.created_by_this_run and not self.role_created_by_this_run:
                return
            self.admin = self.connect(self.admin_dsn, autocommit=True)
        self.identity.validate()
        errors: list[BaseException] = []
        if self.created_by_this_run and self._database_exists():
            try:
                self._verify_database_comment()
                if self.marker_table_created:
                    try:
                        self._verify_target()
                    except Exception as exc:
                        raise UnsafeDatabaseError(
                            "refusing cleanup because the database ownership marker changed"
                        ) from exc
                self.admin.execute(
                    sql.SQL("drop database {} with (force)").format(
                        sql.Identifier(self.identity.name)
                    )
                )
                if self._database_exists():
                    raise RuntimeError("disposable database still exists after cleanup")
                self.created_by_this_run = False
                self.marker_table_created = False
            except InterruptedError:
                raise
            except BaseException as error:
                errors.append(error)
        elif self.created_by_this_run:
            self.created_by_this_run = False

        if self.role_created_by_this_run and self._role_exists():
            try:
                self.admin.execute(
                    sql.SQL("drop role {}").format(sql.Identifier(self.identity.role_name))
                )
                if self._role_exists():
                    raise RuntimeError("disposable role still exists after cleanup")
                self.role_created_by_this_run = False
            except BaseException as error:
                errors.append(error)
        elif self.role_created_by_this_run:
            self.role_created_by_this_run = False
        self.admin.close()
        self.admin = None
        if len(errors) == 1:
            raise errors[0]
        if errors:
            raise BaseExceptionGroup("disposable cleanup failed", errors)

    def close(self) -> None:
        try:
            with _defer_signals_during_cleanup():
                for attempt in range(2):
                    try:
                        self._close_once()
                        break
                    except InterruptedError:
                        if attempt == 1:
                            raise
        except BaseException as cleanup_error:
            signal_error = _take_deferred_signal()
            if signal_error is not None:
                raise BaseExceptionGroup(
                    "signal received and cleanup failed",
                    [signal_error, cleanup_error],
                ) from None
            raise
        _raise_deferred_signal()

    def __enter__(self) -> str:
        return self.open()

    def __exit__(
        self,
        _exc_type: type[BaseException] | None,
        _exc_value: BaseException | None,
        _traceback: TracebackType | None,
    ) -> None:
        self.close()


def _migration_files(migrations: Path) -> list[Path]:
    if not migrations.is_dir():
        raise RuntimeError("migration path must be an existing directory")
    files = sorted(migrations.glob("*.sql"))
    matches = [(path, _MIGRATION_FILE_PATTERN.fullmatch(path.name)) for path in files]
    unexpected = next((path for path, match in matches if match is None), None)
    if unexpected is not None:
        raise RuntimeError(f"unexpected SQL migration entry: {unexpected.name}")
    non_file = next((path for path in files if not path.is_file()), None)
    if non_file is not None:
        raise RuntimeError(f"migration entry must be a regular file: {non_file.name}")
    versions = [match.group("version") for _, match in matches if match is not None]
    if len(versions) != len(set(versions)):
        raise RuntimeError("migration versions must be unique")
    numbers = [int(version) for version in versions if len(version) == 4]
    if not numbers or numbers != list(range(1, numbers[-1] + 1)):
        raise RuntimeError("migration numbers must form a complete contiguous sequence from 0001")
    return files


class MigrationApplyError(RuntimeError):
    """Bounded migration identity; the original database error remains chained privately."""

    def __init__(self, filename: str, sqlstate: str | None) -> None:
        self.filename = (
            filename
            if len(filename) <= 128
            and re.fullmatch(r"(?:[0-9]{4}|[0-9]{14})_[a-z0-9_]+\.sql", filename)
            else ""
        )
        self.sqlstate = (
            sqlstate
            if isinstance(sqlstate, str) and re.fullmatch(r"[0-9A-Z]{5}", sqlstate)
            else None
        )
        super().__init__("migration execution failed; details redacted")


def apply_migrations(
    database_dsn: str,
    migrations: Path,
    *,
    connect: _ConnectionFactory = psycopg.connect,
) -> int:
    files = _migration_files(migrations)
    for migration in files:
        try:
            migration_sql = migration.read_text(encoding="utf-8").encode("utf-8")
        except OSError as exc:
            raise RuntimeError(f"failed to read migration file: {migration.name}") from exc
        try:
            with connect(database_dsn) as connection:
                connection.execute(migration_sql)
        except Exception as exc:
            state = exc.sqlstate if isinstance(exc, psycopg.Error) else None
            raise MigrationApplyError(migration.name, state) from exc
    return len(files)


def _junit_count(suite: ET.Element, attribute: str) -> int:
    try:
        return int(suite.attrib.get(attribute, "0"))
    except ValueError as exc:
        raise RuntimeError(f"pytest produced a non-numeric JUnit {attribute!r} count") from exc


def _junit_counts(report_path: Path) -> tuple[int, int, int]:
    root = ET.parse(report_path).getroot()
    suites = (
        [root]
        if root.tag == "testsuite" or (root.tag == "testsuites" and "tests" in root.attrib)
        else list(root.findall("testsuite"))
    )
    tests = sum(_junit_count(suite, "tests") for suite in suites)
    skipped = sum(_junit_count(suite, "skipped") for suite in suites)
    failed = sum(
        _junit_count(suite, "failures") + _junit_count(suite, "errors") for suite in suites
    )
    return tests, skipped, failed


def run_pytest(
    database_dsn: str,
    etl_root: Path,
    *,
    run: Callable[..., subprocess.CompletedProcess[str]] = subprocess.run,
) -> PytestResult:
    env = {"ETL_TEST_DATABASE_URL": database_dsn}
    diagnostic = PytestDiagnostic("unexpected")
    body_failure: BaseException | None = None
    try:
        with tempfile.TemporaryDirectory(prefix="votus-etl-verify-") as temp_dir:
            try:
                report_path = Path(temp_dir) / "pytest.xml"
                command = [sys.executable, "-m", "pytest", "-rs", f"--junitxml={report_path}"]
                try:
                    completed = run(command, cwd=etl_root, env=env, check=False, text=True)
                except (OSError, subprocess.SubprocessError):
                    diagnostic = PytestDiagnostic("runner_error")
                    raise
                diagnostic = PytestDiagnostic("report_missing", completed.returncode)
                if not report_path.is_file():
                    raise RuntimeError("pytest did not produce its verification report")
                diagnostic = PytestDiagnostic("report_invalid", completed.returncode)
                tests, skipped, failed = _junit_counts(report_path)
                if skipped:
                    diagnostic = PytestDiagnostic(
                        "skips_rejected", completed.returncode, tests, skipped, failed
                    )
                    raise RuntimeError(f"ETL verification rejected {skipped} skipped test(s)")
                if completed.returncode != 0 or failed:
                    diagnostic = PytestDiagnostic(
                        "pytest_failed", completed.returncode, tests, skipped, failed
                    )
                    raise RuntimeError(
                        f"pytest failed with exit code {completed.returncode} "
                        f"and {failed} reported failure(s)"
                    )
            except BaseException as exc:
                body_failure = exc
                raise
        return PytestResult(executed=tests - skipped, skipped=skipped)
    except BaseException as exc:
        # Cleanup replacement must not inherit evidence from the displaced failure.
        if isinstance(exc, (KeyboardInterrupt, InterruptedError)):
            diagnostic = PytestDiagnostic("interrupted")
        elif exc is not body_failure:
            diagnostic = PytestDiagnostic("unexpected")
        # Preserve the original exception identity, traceback and interruption semantics.
        exc.pytest_diagnostic = diagnostic
        raise


@contextmanager
def _defer_signals_during_cleanup() -> Iterator[None]:
    global _cleanup_depth
    _cleanup_depth += 1
    try:
        yield
    finally:
        _cleanup_depth -= 1


def _raise_deferred_signal() -> None:
    deferred = _take_deferred_signal()
    if deferred is not None:
        raise deferred


def _take_deferred_signal() -> InterruptedError | None:
    global _deferred_signal
    if _deferred_signal is None:
        return None
    deferred = _deferred_signal
    _deferred_signal = None
    return InterruptedError(deferred.name)


def termination_as_interrupt(signum: int, _frame: FrameType | None) -> None:
    global _deferred_signal
    received = signal.Signals(signum)
    if _cleanup_depth:
        if _deferred_signal is None:
            _deferred_signal = received
        return
    raise InterruptedError(received.name)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--migration-atomicity",
        choices=("success", "ledger", "sql"),
        help="Run one real Supabase CLI proof on an isolated CI-owned Postgres service",
    )
    args = parser.parse_args()
    admin_dsn = os.environ.get("ETL_TEST_ADMIN_DATABASE_URL")
    if not admin_dsn:
        print(
            "error: ETL_TEST_ADMIN_DATABASE_URL must name a reachable 'template1' "
            "maintenance database with CREATE DATABASE privilege",
            file=sys.stderr,
        )
        return 2

    repo_root = Path(__file__).resolve().parents[2]
    etl_root = repo_root / "etl"
    migrations = repo_root / "supabase" / "migrations"
    database = DisposablePostgres(admin_dsn)
    previous_handlers: dict[signal.Signals, _SignalHandler] = {}
    handled_signals = [signal.SIGTERM]
    if hasattr(signal, "SIGHUP"):
        handled_signals.append(signal.SIGHUP)
    for handled in handled_signals:
        previous_handlers[handled] = signal.signal(handled, termination_as_interrupt)

    stage = "disposable_database_setup"
    body_failure: BaseException | None = None
    body_stage = stage
    try:
        with database as database_dsn:
            try:
                if args.migration_atomicity:
                    stage = "apply_migrations"
                    run_migration_atomicity(database, migrations, args.migration_atomicity)
                    summary = f"migration atomicity {args.migration_atomicity}"
                else:
                    stage = "apply_migrations"
                    migration_dsn = _require_dsn(database.migration_dsn, "migration")
                    migration_count = apply_migrations(migration_dsn, migrations)
                    stage = "grant_test_privileges"
                    database.grant_test_privileges()
                    stage = "pytest"
                    result = run_pytest(database_dsn, etl_root)
                    summary = (
                        f"{migration_count} migrations, "
                        f"{result.executed} executed, {result.skipped} skipped"
                    )
            except BaseException as exc:
                body_failure = exc
                body_stage = stage
                raise
            finally:
                stage = "owned_database_cleanup"
        print(f"ETL verification passed: {summary}; cleaned {database.identity.name}")
        return 0
    except (Exception, KeyboardInterrupt) as exc:
        # A body failure remains causal unless cleanup replaced it with a new exception.
        reported_stage = body_stage if exc is body_failure else stage
        if os.environ.get("ETL_VERIFY_STAGE_REPORT") == "1":
            print(f"E2E_ETL_STAGE {reported_stage}", file=sys.stderr)
            if (
                reported_stage == "apply_migrations"
                and isinstance(exc, MigrationApplyError)
                and exc.filename
            ):
                print(f"E2E_ETL_MIGRATION {exc.filename} {exc.sqlstate or '-'}", file=sys.stderr)
            if reported_stage == "grant_test_privileges":
                marker = database.grant_failure_marker(exc)
                if marker is not None:
                    print(marker, file=sys.stderr)
            if reported_stage == "pytest":
                diagnostic = getattr(exc, "pytest_diagnostic", None)
                if not isinstance(diagnostic, PytestDiagnostic):
                    diagnostic = PytestDiagnostic("unexpected")
                print(diagnostic.marker(), file=sys.stderr)
        if reported_stage == "pytest":
            detail = "pytest verification failed; details redacted"
        elif reported_stage == "grant_test_privileges":
            detail = "privilege preparation failed; details redacted"
        elif (
            not args.migration_atomicity
            and reported_stage == "apply_migrations"
            and not isinstance(exc, MigrationApplyError)
        ):
            detail = "migration preparation failed; details redacted"
        else:
            detail = database.safe_error(exc)
        print(f"ETL verification failed: {detail}", file=sys.stderr)
        return 1
    finally:
        for handled, previous in previous_handlers.items():
            signal.signal(handled, previous)
