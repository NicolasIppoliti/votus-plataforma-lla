"""Explicit maintenance access for trusted tests on an owned disposable database.

This is a fixture safety boundary, not a sandbox for maintenance credentials.
Ordinary application connections must continue using their restricted test DSN.
"""

from __future__ import annotations

import uuid
from collections.abc import Iterator
from contextlib import contextmanager

import psycopg
from psycopg import sql

from etl.verify import (
    MARKER_PREFIX,
    DatabaseIdentity,
    MigrationRunner,
    UnsafeDatabaseError,
    _connection_params,
)

_FIXTURE_ROLES = frozenset(
    {
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
    }
)


class OwnedDatabase:
    def __init__(self, migration_dsn: str, marker: str) -> None:
        params = _connection_params(migration_dsn)
        if not params.get("host") or not params.get("user") or params.get("service"):
            raise UnsafeDatabaseError(
                "owned fixtures require explicit host and user without service"
            )
        try:
            token = uuid.UUID(marker.removeprefix(MARKER_PREFIX))
        except (ValueError, AttributeError):
            raise UnsafeDatabaseError("invalid owned fixture marker") from None
        self._identity = DatabaseIdentity(params.get("dbname", ""), marker, token)
        self._identity.validate()
        self._dsn = migration_dsn
        self._maintenance_user = params.get("user", "")

    @property
    def dsn(self) -> str:
        return self._dsn

    @property
    def maintenance_user(self) -> str:
        return self._maintenance_user

    def migration_runner_dsn(self, record: str) -> str:
        """Validate the explicit parent-owned runner without taking its lifecycle."""
        runner = MigrationRunner.from_target_json(record, self._dsn)
        runner.verify(self._dsn, self._identity, connect=psycopg.connect)
        return runner.target_dsn(self._dsn)

    @contextmanager
    def connect(self, *, autocommit: bool = False) -> Iterator[psycopg.Connection]:
        """Open only the named target and prove its identity before fixture SQL."""
        with psycopg.connect(self._dsn, autocommit=autocommit) as connection:
            row = connection.execute(
                "select current_database(), current_user, session_user, marker "
                "from votus_verification.ownership_marker"
            ).fetchone()
            if row != (
                self._identity.name,
                self._maintenance_user,
                self._maintenance_user,
                self._identity.marker,
            ):
                raise UnsafeDatabaseError("owned fixture connection identity does not match")
            comment = connection.execute(
                "select shobj_description(oid, 'pg_database') from pg_database where datname = %s",
                (self._identity.name,),
            ).fetchone()
            if comment != (self._identity.marker,):
                raise UnsafeDatabaseError("owned fixture database comment does not match")
            yield connection

    @contextmanager
    def owner_connection(self, role: str) -> Iterator[psycopg.Connection]:
        """Borrow SET authority without rewriting preexisting membership options."""
        if role not in _FIXTURE_ROLES:
            raise UnsafeDatabaseError("requested role is not an allowed fixture role")
        with self.connect(autocommit=True) as connection, connection.transaction():
            bridge = sql.Identifier(f"votus_etl_fixture_{uuid.uuid4().hex}")
            owner = sql.Identifier(role)
            maintenance = sql.Identifier(self._maintenance_user)
            connection.execute(
                sql.SQL(
                    "create role {} nologin noinherit nosuperuser nocreatedb "
                    "nocreaterole noreplication nobypassrls"
                ).format(bridge)
            )
            connection.execute(
                sql.SQL("grant {} to {} with inherit false, set true").format(owner, bridge)
            )
            connection.execute(
                sql.SQL("grant {} to {} with inherit false, set true").format(bridge, maintenance)
            )
            connection.execute(sql.SQL("set local role {}").format(owner))
            if connection.execute("select current_user").fetchone() != (role,):
                raise UnsafeDatabaseError("owned fixture role switch did not take effect")
            # On error the transaction rolls back the bridge and both fresh edges.
            # Do not try cleanup SQL inside a potentially aborted transaction.
            yield connection
            connection.execute(sql.SQL("set local role {}").format(maintenance))
            if connection.execute("select current_user").fetchone() != (self._maintenance_user,):
                raise UnsafeDatabaseError("owned fixture maintenance role was not restored")
            connection.execute(sql.SQL("revoke {} from {}").format(bridge, maintenance))
            connection.execute(sql.SQL("revoke {} from {}").format(owner, bridge))
            connection.execute(sql.SQL("drop role {}").format(bridge))
