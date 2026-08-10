"""Fail-closed ETL verification against a disposable sibling Postgres database."""

from __future__ import annotations

import os
import re
import secrets
import signal
import subprocess
import sys
import tempfile
import uuid
import xml.etree.ElementTree as ET
from collections.abc import Callable
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from types import FrameType
from typing import LiteralString, Protocol, cast

import psycopg
from psycopg import sql
from psycopg.conninfo import conninfo_to_dict, make_conninfo

NAME_PREFIX = "votus_etl_verify_"
MARKER_PREFIX = "votus-etl-verify:"
ADMIN_DATABASE = "template1"
_cleanup_depth = 0
_deferred_signal: signal.Signals | None = None


class UnsafeDatabaseError(RuntimeError):
    """The requested operation does not satisfy the disposable identity contract."""


class _ConnectionFactory(Protocol):
    def __call__(self, dsn: str, *, autocommit: bool = False): ...


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
        self.admin = None
        self.created_by_this_run = False
        self.role_created_by_this_run = False
        self.marker_table_created = False
        self.target_dsn: str | None = None
        self.migration_dsn: str | None = None

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
        assert self.admin is not None
        row = self.admin.execute(
            "select 1 from pg_database where datname = %s",
            (self.identity.name,),
        ).fetchone()
        return row == (1,)

    def _role_exists(self) -> bool:
        assert self.admin is not None
        row = self.admin.execute(
            "select 1 from pg_roles where rolname = %s",
            (self.identity.role_name,),
        ).fetchone()
        return row == (1,)

    def _verify_global_roles_are_already_final(self) -> None:
        assert self.admin is not None
        row = self.admin.execute(
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
        assert self.migration_dsn is not None
        with self.connect(self.migration_dsn) as connection:
            row = connection.execute(
                """
                select current_database(), marker
                from votus_verification.ownership_marker
                """
            ).fetchone()
        if row != (self.identity.name, self.identity.marker):
            raise UnsafeDatabaseError("connected database failed its disposable identity check")

    def _verify_role(self) -> None:
        assert self.admin is not None
        row = self.admin.execute(
            """
            select rolcanlogin, rolsuper, rolcreatedb, rolcreaterole,
                   rolreplication, rolbypassrls,
                   exists (
                     select 1 from pg_auth_members where member = pg_authid.oid
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
        expected = (True, False, False, False, False, False, False, False)
        if row != expected:
            categories = None if row is None else row[6:]
            raise UnsafeDatabaseError(
                "disposable role privilege verification failed "
                f"(outbound memberships and cross-database CREATE: {categories})"
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
            if self.created_by_this_run or self.role_created_by_this_run:
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
        assert self.migration_dsn is not None
        assert self.admin is None
        self.admin = self.connect(self.admin_dsn, autocommit=True)
        try:
            self.admin.execute(
                sql.SQL("grant connect, create, temporary on database {} to {}").format(
                    sql.Identifier(self.identity.name),
                    sql.Identifier(self.identity.role_name),
                )
            )
            self._verify_role()
        finally:
            self.admin.close()
            self.admin = None

        with self.connect(self.migration_dsn) as connection:
            role = sql.Identifier(self.identity.role_name)
            connection.execute(sql.SQL("grant usage, create on schema public to {}").format(role))
            connection.execute(
                sql.SQL("grant usage on schema votus_verification to {}").format(role)
            )
            connection.execute(
                sql.SQL(
                    "grant select on table votus_verification.ownership_marker to {}"
                ).format(role)
            )
            connection.execute(
                sql.SQL("grant all privileges on all tables in schema public to {}").format(role)
            )
            connection.execute(
                sql.SQL("grant all privileges on all sequences in schema public to {}").format(role)
            )
            connection.execute(
                sql.SQL("grant all privileges on all functions in schema public to {}").format(role)
            )
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

        assert self.target_dsn is not None
        with self.connect(self.target_dsn) as connection:
            row = connection.execute(
                "select current_database(), current_user, marker "
                "from votus_verification.ownership_marker"
            ).fetchone()
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

    def __exit__(self, *_args: object) -> None:
        self.close()


def _migration_files(migrations: Path) -> list[Path]:
    files = sorted(migrations.glob("[0-9][0-9][0-9][0-9]_*.sql"))
    numbers = [int(path.name.split("_", 1)[0]) for path in files]
    if not numbers or numbers != list(range(1, numbers[-1] + 1)):
        raise RuntimeError("migration numbers must form a complete contiguous sequence from 0001")
    if len(numbers) != len(set(numbers)):
        raise RuntimeError("migration numbers must be unique")
    return files


def apply_migrations(
    database_dsn: str,
    migrations: Path,
    *,
    connect: _ConnectionFactory = psycopg.connect,
) -> int:
    files = _migration_files(migrations)
    for migration in files:
        migration_sql = cast(LiteralString, migration.read_text(encoding="utf-8"))
        with connect(database_dsn) as connection:
            connection.execute(sql.SQL(migration_sql))
    return len(files)


def _junit_counts(report_path: Path) -> tuple[int, int, int]:
    root = ET.parse(report_path).getroot()
    suites = (
        [root]
        if root.tag == "testsuite" or (root.tag == "testsuites" and "tests" in root.attrib)
        else list(root.findall("testsuite"))
    )
    tests = sum(int(suite.attrib.get("tests", "0")) for suite in suites)
    skipped = sum(int(suite.attrib.get("skipped", "0")) for suite in suites)
    failed = sum(
        int(suite.attrib.get("failures", "0")) + int(suite.attrib.get("errors", "0"))
        for suite in suites
    )
    return tests, skipped, failed


def run_pytest(
    database_dsn: str,
    etl_root: Path,
    *,
    run: Callable[..., subprocess.CompletedProcess[str]] = subprocess.run,
) -> PytestResult:
    env = {"ETL_TEST_DATABASE_URL": database_dsn}
    with tempfile.TemporaryDirectory(prefix="votus-etl-verify-") as temp_dir:
        report_path = Path(temp_dir) / "pytest.xml"
        command = [sys.executable, "-m", "pytest", "-rs", f"--junitxml={report_path}"]
        completed = run(command, cwd=etl_root, env=env, check=False, text=True)
        if not report_path.exists():
            raise RuntimeError("pytest did not produce its verification report")
        tests, skipped, failed = _junit_counts(report_path)
    if skipped:
        raise RuntimeError(f"ETL verification rejected {skipped} skipped test(s)")
    if completed.returncode != 0 or failed:
        raise RuntimeError(
            f"pytest failed with exit code {completed.returncode} and {failed} reported failure(s)"
        )
    return PytestResult(executed=tests - skipped, skipped=skipped)


@contextmanager
def _defer_signals_during_cleanup():
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
    previous_handlers: dict[signal.Signals, object] = {}
    handled_signals = [signal.SIGTERM]
    if hasattr(signal, "SIGHUP"):
        handled_signals.append(signal.SIGHUP)
    for handled in handled_signals:
        previous_handlers[handled] = signal.signal(handled, termination_as_interrupt)

    try:
        with database as database_dsn:
            assert database.migration_dsn is not None
            migration_count = apply_migrations(database.migration_dsn, migrations)
            database.grant_test_privileges()
            result = run_pytest(database_dsn, etl_root)
        print(
            f"ETL verification passed: {migration_count} migrations, "
            f"{result.executed} executed, {result.skipped} skipped; "
            f"cleaned {database.identity.name}"
        )
        return 0
    except (Exception, KeyboardInterrupt) as exc:
        print(f"ETL verification failed: {database.safe_error(exc)}", file=sys.stderr)
        return 1
    finally:
        for handled, previous in previous_handlers.items():
            signal.signal(handled, previous)
