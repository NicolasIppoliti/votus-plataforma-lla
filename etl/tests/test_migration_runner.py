"""Credential-free public runner-capability boundary tests."""

import json
import subprocess
import uuid
from pathlib import Path
from types import SimpleNamespace

import pytest
from psycopg.conninfo import conninfo_to_dict, make_conninfo

from etl import verify

TOKEN = uuid.UUID(int=7)
ROLE = f"votus_etl_runner_{TOKEN.hex}"
MARKER = f"votus-etl-runner:{TOKEN}"
RECORD = {"role": ROLE, "password": "a" * 43, "marker": MARKER, "oid": 1234}


class Server:
    def __init__(self, *, superuser=True, mismatch=None):
        self.superuser = superuser
        self.mismatch = mismatch
        self.sql = []
        self.connections = []
        self.roles = {}

    def connect(self, dsn, **_kwargs):
        server = self
        params = conninfo_to_dict(dsn)
        server.connections.append(params)
        user = params["user"]

        class Connection:
            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

            def close(self):
                pass

            def execute(self, query, parameters=None):
                statement = query if isinstance(query, str) else query.as_string()
                server.sql.append(statement)
                lower = statement.lower()
                row = None
                if "rolsuper from pg_roles" in lower:
                    row = ("postgres", server.superuser)
                elif "create role" in lower:
                    name = statement.split('"')[1]
                    if name in server.roles:
                        raise RuntimeError("role collision")
                    server.roles[name] = (1234, None)
                elif "comment on role" in lower:
                    name = statement.split('"')[1]
                    marker = statement.split("'")[1]
                    server.roles[name] = (1234, marker)
                elif "select oid" in lower:
                    row = server.roles.get(parameters[0])
                elif "r.rolcanlogin" in lower:
                    role = user
                    marker = MARKER if role == ROLE else f"votus-etl-runner:{TOKEN}"
                    row = (
                        1234,
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
                    if server.mismatch == "oid":
                        row = (999, *row[1:])
                elif "from votus_verification.ownership_marker" in lower:
                    identity = verify.DatabaseIdentity.generate()
                    token = uuid.UUID(hex=params["dbname"].removeprefix(verify.NAME_PREFIX))
                    identity = verify.DatabaseIdentity(
                        params["dbname"], f"votus-etl-verify:{token}", token
                    )
                    row = (identity.name, "postgres", user, identity.marker)
                    if server.mismatch == "target":
                        row = ("wrong", *row[1:])
                elif "drop role" in lower:
                    server.roles.pop(statement.split('"')[1])
                return SimpleNamespace(fetchone=lambda: row)

        return Connection()


def owned(server):
    identity = verify.DatabaseIdentity(
        f"{verify.NAME_PREFIX}{TOKEN.hex}", f"{verify.MARKER_PREFIX}{TOKEN}", TOKEN
    )
    database = verify.DisposablePostgres(
        "host=127.0.0.1 port=54322 dbname=template1 user=postgres password=private-parent",
        identity=identity,
        connect=server.connect,
    )
    database.created_by_this_run = database.role_created_by_this_run = True
    database.migration_dsn = make_conninfo(database.admin_dsn, dbname=identity.name)
    database.target_dsn = make_conninfo(
        database.migration_dsn, user=identity.role_name, password="restricted"
    )
    return database


def child(command, **kwargs):
    env = kwargs["env"]
    phase = env["ETL_VERIFY_PHASE"]
    assert "ETL_TEST_MIGRATION_RUNNER" not in env
    if phase == "ordinary":
        assert "ETL_TEST_OWNED_MIGRATION_RUNNER" not in env
    else:
        runner = json.loads(env["ETL_TEST_OWNED_MIGRATION_RUNNER"])
        assert set(runner) == {"dsn", "marker", "oid"}
        assert conninfo_to_dict(runner["dsn"])["user"].startswith("votus_etl_runner_")
        assert "private-parent" not in runner["dsn"]
    Path(env["ETL_VERIFY_COLLECTION_REPORT"]).write_text(
        json.dumps({"all": ["a", "b"], "selected": ["a" if phase == "ordinary" else "b"]})
    )
    report = next(arg.split("=", 1)[1] for arg in command if arg.startswith("--junitxml="))
    Path(report).write_text('<testsuite tests="1"/>')
    return subprocess.CompletedProcess(command, 0)


def test_public_runner_forwards_only_verified_external_capability(tmp_path, monkeypatch):
    server = Server(superuser=False)
    database = owned(server)
    monkeypatch.setenv("ETL_TEST_MIGRATION_RUNNER", json.dumps(RECORD))
    assert verify.run_pytest(database.target_dsn, tmp_path, database, run=child).executed == 2
    assert not any("create role" in query or "drop role" in query for query in server.sql)


@pytest.mark.parametrize(
    "record",
    [
        "",
        "{}",
        '{"role":"x","role":"y"}',
        json.dumps({**RECORD, "oid": True}),
        json.dumps({**RECORD, "password": "short"}),
        json.dumps({**RECORD, "extra": "no"}),
    ],
)
def test_public_runner_rejects_malformed_external_without_fallback(tmp_path, monkeypatch, record):
    server = Server()
    database = owned(server)
    monkeypatch.setenv("ETL_TEST_MIGRATION_RUNNER", record)
    with pytest.raises(verify.UnsafeDatabaseError):
        verify.run_pytest(database.target_dsn, tmp_path, database, run=child)
    assert server.connections == []


@pytest.mark.parametrize("mismatch", ["oid", "target"])
def test_public_runner_rejects_changed_external_identity(tmp_path, monkeypatch, mismatch):
    server = Server(mismatch=mismatch)
    database = owned(server)
    monkeypatch.setenv("ETL_TEST_MIGRATION_RUNNER", json.dumps(RECORD))
    with pytest.raises(verify.UnsafeDatabaseError):
        verify.run_pytest(database.target_dsn, tmp_path, database, run=child)
    assert not any("create role" in query or "drop role" in query for query in server.sql)


def test_public_runner_requires_explicit_superuser_for_ci_creation(tmp_path, monkeypatch):
    server = Server(superuser=False)
    database = owned(server)
    monkeypatch.delenv("ETL_TEST_MIGRATION_RUNNER", raising=False)
    with pytest.raises(verify.UnsafeDatabaseError):
        verify.run_pytest(database.target_dsn, tmp_path, database, run=child)
    assert not any("create role" in query for query in server.sql)


def test_public_ci_runner_is_created_and_identity_guarded_cleanup_is_reachable(
    tmp_path, monkeypatch
):
    server = Server()
    database = owned(server)
    monkeypatch.delenv("ETL_TEST_MIGRATION_RUNNER", raising=False)
    monkeypatch.setattr(verify.secrets, "token_urlsafe", lambda _size: "a" * 43)
    assert verify.run_pytest(database.target_dsn, tmp_path, database, run=child).executed == 2
    assert server.roles == {ROLE: (1234, MARKER)}
    assert any("admin false, inherit false, set true" in query for query in server.sql)
    database.created_by_this_run = database.role_created_by_this_run = False
    database.close()
    assert server.roles == {}


def test_ci_runner_collision_never_authorizes_dropping_existing_role(tmp_path, monkeypatch):
    server = Server()
    server.roles[ROLE] = (999, "foreign")
    database = owned(server)
    monkeypatch.delenv("ETL_TEST_MIGRATION_RUNNER", raising=False)
    with pytest.raises(RuntimeError, match="collision"):
        verify.run_pytest(database.target_dsn, tmp_path, database, run=child)
    database.created_by_this_run = database.role_created_by_this_run = False
    database.close()
    assert server.roles == {ROLE: (999, "foreign")}


@pytest.mark.parametrize("replacement", [(999, MARKER), (1234, "foreign")])
def test_ci_runner_cleanup_refuses_changed_identity(tmp_path, monkeypatch, replacement):
    server = Server()
    database = owned(server)
    monkeypatch.delenv("ETL_TEST_MIGRATION_RUNNER", raising=False)
    monkeypatch.setattr(verify.secrets, "token_urlsafe", lambda _size: "a" * 43)
    verify.run_pytest(database.target_dsn, tmp_path, database, run=child)
    server.roles[ROLE] = replacement
    database.created_by_this_run = database.role_created_by_this_run = False
    with pytest.raises(verify.UnsafeDatabaseError):
        database.close()
    assert server.roles == {ROLE: replacement}


def test_external_runner_is_never_owned_by_python_cleanup(tmp_path, monkeypatch):
    server = Server(superuser=False)
    server.roles[ROLE] = (1234, MARKER)
    database = owned(server)
    monkeypatch.setenv("ETL_TEST_MIGRATION_RUNNER", json.dumps(RECORD))
    verify.run_pytest(database.target_dsn, tmp_path, database, run=child)
    database.created_by_this_run = database.role_created_by_this_run = False
    database.close()
    assert server.roles == {ROLE: (1234, MARKER)}
    assert not any("drop role" in query for query in server.sql)
