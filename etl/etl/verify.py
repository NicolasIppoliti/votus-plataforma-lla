"""Fail-closed ETL verification against a disposable sibling Postgres database."""

from __future__ import annotations

import argparse
import json
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
from dataclasses import dataclass, field
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


def _runner_record(value: str, keys: set[str]) -> dict[str, object]:
    def unique(pairs: list[tuple[str, object]]) -> dict[str, object]:
        result: dict[str, object] = {}
        for key, item in pairs:
            if key in result:
                raise ValueError("duplicate field")
            result[key] = item
        return result

    try:
        if not isinstance(value, str) or not 0 < len(value) <= 4096:
            raise ValueError("invalid size")
        result = json.loads(value, object_pairs_hook=unique)
        if not isinstance(result, dict) or set(result) != keys:
            raise ValueError("invalid fields")
        return result
    except (ValueError, TypeError, RecursionError):
        raise UnsafeDatabaseError("migration runner record is invalid") from None


@dataclass(frozen=True)
class MigrationRunner:
    """A parent-provisioned capability, never an ambient administrative credential."""

    role: str
    password: str = field(repr=False)
    marker: str
    oid: int

    @classmethod
    def from_json(cls, value: str) -> MigrationRunner:
        record = _runner_record(value, {"role", "password", "marker", "oid"})
        role, password, marker, oid = (record[key] for key in ("role", "password", "marker", "oid"))
        if (
            not isinstance(role, str)
            or re.fullmatch(r"votus_etl_runner_[0-9a-f]{32}", role) is None
            or not isinstance(password, str)
            or re.fullmatch(r"[A-Za-z0-9_-]{43}", password) is None
            or marker != f"votus-etl-runner:{uuid.UUID(hex=role.removeprefix('votus_etl_runner_'))}"
            or type(oid) is not int
            or not 0 < oid <= 2**32 - 1
        ):
            raise UnsafeDatabaseError("migration runner identity is invalid")
        return cls(role, password, marker, oid)

    @classmethod
    def from_target_json(cls, value: str, maintenance_dsn: str) -> MigrationRunner:
        record = _runner_record(value, {"dsn", "marker", "oid"})
        try:
            if not isinstance(record["dsn"], str):
                raise ValueError("invalid DSN")
            params = _connection_params(record["dsn"])
            runner = cls.from_json(
                json.dumps(
                    {
                        "role": params.get("user"),
                        "password": params.get("password"),
                        "marker": record["marker"],
                        "oid": record["oid"],
                    }
                )
            )
            if params != _connection_params(runner.target_dsn(maintenance_dsn)):
                raise ValueError("different target")
        except (ValueError, TypeError, UnsafeDatabaseError):
            raise UnsafeDatabaseError("migration runner target is invalid") from None
        return runner

    def target_dsn(self, maintenance_dsn: str) -> str:
        return make_conninfo(maintenance_dsn, user=self.role, password=self.password)

    def target_json(self, maintenance_dsn: str) -> str:
        return json.dumps(
            {"dsn": self.target_dsn(maintenance_dsn), "marker": self.marker, "oid": self.oid}
        )

    def verify(
        self,
        maintenance_dsn: str,
        identity: DatabaseIdentity,
        *,
        connect: _ConnectionFactory = psycopg.connect,
    ) -> None:
        identity.validate()
        params = _connection_params(maintenance_dsn)
        if params.get("dbname") != identity.name or params.get("user") != "postgres":
            raise UnsafeDatabaseError("migration runner requires the owned postgres target")
        with connect(self.target_dsn(maintenance_dsn)) as connection:
            row = connection.execute("""
                select r.oid, r.rolname, r.rolcanlogin, r.rolinherit, r.rolsuper,
                       r.rolcreatedb, r.rolcreaterole, r.rolreplication, r.rolbypassrls,
                       shobj_description(r.oid, 'pg_authid'), current_user, session_user,
                       coalesce((select array_agg(granted.rolname || ':' || m.admin_option::text
                                || ':' || m.inherit_option::text || ':' || m.set_option::text
                                order by granted.rolname)
                         from pg_auth_members m join pg_roles granted on granted.oid = m.roleid
                        where m.member = r.oid), array[]::text[])
                  from pg_roles r where r.rolname = current_user
            """).fetchone()
            if row != (
                self.oid,
                self.role,
                True,
                False,
                False,
                False,
                False,
                False,
                False,
                self.marker,
                self.role,
                self.role,
                ["postgres:false:false:true"],
            ):
                raise UnsafeDatabaseError("migration runner authority or ownership changed")
            connection.execute("set role postgres")
            row = connection.execute(
                "select current_database(), current_user, session_user, marker "
                "from votus_verification.ownership_marker"
            ).fetchone()
            if row != (identity.name, "postgres", self.role, identity.marker):
                raise UnsafeDatabaseError("migration runner cannot reach its owned target")


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
        self._owned_migration_runner: MigrationRunner | None = None
        self._grant_failure: tuple[BaseException, _GrantOperation] | None = None

    def prepare_migration_runner(self, external: str | None) -> MigrationRunner:
        migration_dsn = _require_dsn(self.migration_dsn, "migration")
        if external is not None:
            runner = MigrationRunner.from_json(external)
        else:
            with self.connect(self.admin_dsn) as admin:
                row = admin.execute(
                    "select current_user, rolsuper from pg_roles where rolname = current_user"
                ).fetchone()
                if row != ("postgres", True):
                    raise UnsafeDatabaseError(
                        "CI migration runner creation requires a superuser parent"
                    )
                role = f"votus_etl_runner_{self.identity.token.hex}"
                password = secrets.token_urlsafe(32)
                marker = f"votus-etl-runner:{self.identity.token}"
                admin.execute(
                    sql.SQL(
                        "create role {} login noinherit nosuperuser nocreatedb nocreaterole "
                        "noreplication nobypassrls password {}"
                    ).format(sql.Identifier(role), sql.Literal(password))
                )
                admin.execute(
                    sql.SQL("comment on role {} is {}").format(
                        sql.Identifier(role), sql.Literal(marker)
                    )
                )
                admin.execute(
                    sql.SQL(
                        "grant postgres to {} with admin false, inherit false, set true"
                    ).format(sql.Identifier(role))
                )
                row = admin.execute(
                    "select oid, shobj_description(oid, 'pg_authid') "
                    "from pg_roles where rolname = %s",
                    (role,),
                ).fetchone()
                if row is None or row[1] != marker:
                    raise UnsafeDatabaseError("CI migration runner creation was not confirmed")
                runner = MigrationRunner.from_json(
                    json.dumps(
                        {
                            "role": role,
                            "password": password,
                            "marker": marker,
                            "oid": row[0],
                        }
                    )
                )
                # Set before commit: cleanup also covers an ambiguous successful commit.
                self._owned_migration_runner = runner
        runner.verify(migration_dsn, self.identity, connect=self.connect)
        return runner

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
            if (
                not self.created_by_this_run
                and not self.role_created_by_this_run
                and self._owned_migration_runner is None
            ):
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
        if self._owned_migration_runner is not None:
            try:
                runner = self._owned_migration_runner
                row = self.admin.execute(
                    "select oid, shobj_description(oid, 'pg_authid') "
                    "from pg_roles where rolname = %s",
                    (runner.role,),
                ).fetchone()
                if row is not None:
                    if row != (runner.oid, runner.marker):
                        raise UnsafeDatabaseError(
                            "refusing cleanup because migration runner identity changed"
                        )
                    self.admin.execute(sql.SQL("drop role {}").format(sql.Identifier(runner.role)))
                    if (
                        self.admin.execute(
                            "select oid, shobj_description(oid, 'pg_authid') "
                            "from pg_roles where rolname = %s",
                            (runner.role,),
                        ).fetchone()
                        is not None
                    ):
                        raise RuntimeError("migration runner still exists after cleanup")
                self._owned_migration_runner = None
            except BaseException as error:
                errors.append(error)
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


def _run_pytest_phase(
    database_dsn: str,
    etl_root: Path,
    *,
    run: Callable[..., subprocess.CompletedProcess[str]] = subprocess.run,
    phase_env: dict[str, str] | None = None,
) -> PytestResult:
    env = {"ETL_TEST_DATABASE_URL": database_dsn, **(phase_env or {})}
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


def run_pytest(
    database_dsn: str,
    etl_root: Path,
    owned: DisposablePostgres,
    *,
    run: Callable[..., subprocess.CompletedProcess[str]] = subprocess.run,
) -> PytestResult:
    """Execute an exhaustive partition without giving ordinary tests maintenance access.

    The privileged child is trusted administrative test code, not a credential sandbox.
    Its only database input is the already-owned, identity-checked target.
    """
    owned.identity.validate()
    if (
        not owned.created_by_this_run
        or not owned.role_created_by_this_run
        or database_dsn != owned.target_dsn
        or not owned.migration_dsn
        or _connection_params(owned.migration_dsn).get("dbname") != owned.identity.name
        or _connection_params(database_dsn).get("user") != owned.identity.role_name
    ):
        raise UnsafeDatabaseError("pytest requires the active owned verification target")
    migration_runner = owned.prepare_migration_runner(os.environ.get("ETL_TEST_MIGRATION_RUNNER"))
    results: list[PytestResult] = []
    manifests: list[tuple[set[str], set[str]]] = []
    failures: list[BaseException] = []
    with tempfile.TemporaryDirectory(prefix="votus-etl-partition-") as directory:
        for phase in ("ordinary", "privileged"):
            manifest_path = Path(directory) / f"{phase}.json"
            phase_env = {
                "ETL_VERIFY_PHASE": phase,
                "ETL_VERIFY_COLLECTION_REPORT": str(manifest_path),
            }
            if phase == "privileged":
                phase_env.update(
                    ETL_TEST_OWNED_DATABASE_URL=owned.migration_dsn,
                    ETL_TEST_OWNED_DATABASE_MARKER=owned.identity.marker,
                    ETL_TEST_OWNED_MIGRATION_RUNNER=migration_runner.target_json(
                        owned.migration_dsn
                    ),
                )
            try:
                result = _run_pytest_phase(database_dsn, etl_root, run=run, phase_env=phase_env)
            except Exception as exc:
                diagnostic = getattr(exc, "pytest_diagnostic", None)
                if not isinstance(diagnostic, PytestDiagnostic) or diagnostic.outcome not in {
                    "pytest_failed",
                    "skips_rejected",
                }:
                    raise
                failures.append(exc)
                result = PytestResult(diagnostic.tests or 0, diagnostic.skipped or 0)
            results.append(result)
            try:
                payload = json.loads(manifest_path.read_text(encoding="utf-8"))
                groups = [payload[key] for key in ("all", "selected")]
                if not all(
                    isinstance(group, list)
                    and all(isinstance(item, str) and item for item in group)
                    and len(group) == len(set(group))
                    for group in groups
                ):
                    raise ValueError("invalid collection")
                complete, selected = map(set, groups)
                if not selected or not selected <= complete:
                    raise ValueError("invalid selection")
                if not failures and result.executed != len(selected):
                    raise ValueError("execution count mismatch")
                manifests.append((complete, selected))
            except (OSError, ValueError, KeyError, TypeError):
                failure = RuntimeError("pytest partition report is missing or inconsistent")
                failure.pytest_diagnostic = PytestDiagnostic("report_invalid")
                failures.append(failure)
                manifests.append((set(), set()))
        first, second = manifests
        if first[0] != second[0] or first[1] & second[1] or first[1] | second[1] != first[0]:
            failure = RuntimeError("pytest selections must be disjoint and exhaustive")
            failure.pytest_diagnostic = PytestDiagnostic("report_invalid")
            raise failure
        if failures:
            # Keep the first causal failure and its safe diagnostics, never raw reports.
            failure = failures[0]
            diagnostics = [getattr(item, "pytest_diagnostic", None) for item in failures]
            if all(
                isinstance(item, PytestDiagnostic) and item.tests is not None
                for item in diagnostics
            ):
                diagnostic = diagnostics[0]
                failure.pytest_diagnostic = PytestDiagnostic(
                    diagnostic.outcome,
                    diagnostic.exit_code,
                    sum(result.executed for result in results),
                    sum(result.skipped for result in results),
                    sum(item.failed or 0 for item in diagnostics),
                )
            raise failure
    return PytestResult(sum(result.executed for result in results), 0)


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
                    result = run_pytest(database_dsn, etl_root, database)
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
