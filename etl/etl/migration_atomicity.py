"""Real CLI regression proof, reachable only from the CI-owned verifier lifecycle.

Operator seam: Supabase 2.116.0 `db push --db-url ... --skip-vault --yes`.
Pinned source: github.com/supabase/cli/tree/v2.116.0.
Predecessors use the existing runner, not a second migration engine. Each fresh
CLI project contains only the pending migration, with an empty history matching
that inventory: predecessor schema is an imported baseline, not CLI history.
The CLI itself must apply the pending SQL AND insert its history row.
"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
import tempfile
from contextlib import ExitStack, contextmanager
from pathlib import Path
from typing import TYPE_CHECKING
from urllib.parse import quote

import psycopg
from psycopg.conninfo import conninfo_to_dict

if TYPE_CHECKING:
    from etl.verify import DisposablePostgres

CLI_VERSION = "2.116.0"
VERSION = "20260904035355"
MIGRATION = f"{VERSION}_add_official_category_name.sql"
FUNCTION = "results_exploration_official"
PRESERVED = f"{FUNCTION}_wrapper_{VERSION}"
SIGNATURE = "(uuid,uuid,text,text,text,text,integer,text)"
LEDGER_FAULT = "atomicity_reject_history"
SQL_FAULT = "atomicity_reject_sql"


class AtomicityFailure(RuntimeError):
    """Fixed diagnostics only; never expose CLI output, SQL, or connection details."""


@contextmanager
def _stage(case: str, stage: str):
    try:
        yield
    except AtomicityFailure:
        raise
    except Exception as error:
        from etl.verify import MigrationApplyError

        category = "unexpected"
        state = None
        if isinstance(error, psycopg.Error) or (
            isinstance(error, MigrationApplyError) and isinstance(error.__cause__, psycopg.Error)
        ):
            category = "database"
            state = error.sqlstate
        elif isinstance(error, subprocess.TimeoutExpired):
            category = "timeout"
        elif isinstance(error, OSError):
            category = "os"
        diagnostic = f"migration_atomicity:{case}:stage={stage}:exception={category}"
        if isinstance(state, str) and re.fullmatch(r"[0-9A-Z]{5}", state):
            diagnostic += f":sqlstate={state}"
        print(diagnostic)
        raise AtomicityFailure(diagnostic) from None


@contextmanager
def _resource(factory, case: str):
    with _stage(case, "cleanup"), ExitStack() as stack:
        with _stage(case, "fixture_creation"):
            resource = stack.enter_context(factory())
        yield resource


def _require(condition: bool, label: str) -> None:
    if not condition:
        print(f"migration_atomicity:{label}")
        raise AtomicityFailure(f"migration_atomicity:{label}")


def _snapshot(dsn: str) -> tuple:
    # Always a new observer connection, never the CLI's transaction/session.
    with psycopg.connect(dsn) as connection:
        function = connection.execute(
            "select pg_get_functiondef(p.oid), r.rolname, "
            "array(select a::text from unnest(p.proacl) a order by a::text) "
            "from pg_proc p join pg_roles r on r.oid=p.proowner "
            "where p.oid=to_regprocedure(%s)",
            (f"public.{FUNCTION}{SIGNATURE}",),
        ).fetchone()
        preserved = connection.execute(
            "select pg_get_functiondef(p.oid), r.rolname, "
            "array(select a::text from unnest(p.proacl) a order by a::text) "
            "from pg_proc p join pg_roles r on r.oid=p.proowner "
            "where p.oid=to_regprocedure(%s)",
            (f"public.{PRESERVED}{SIGNATURE}",),
        ).fetchone()
        history = connection.execute(
            "select count(*) from supabase_migrations.schema_migrations where version=%s",
            (VERSION,),
        ).fetchone()[0]
    return function, preserved, history


def _cli(binary: str, project: Path, params: dict[str, str], *, version: bool = False):
    # No inherited PG*, tokens, profile, project config, or owner password in argv.
    env = {
        "PATH": os.environ.get("PATH", ""),
        "HOME": str(project),
        "XDG_CONFIG_HOME": str(project / "config"),
        "XDG_CACHE_HOME": str(project / "cache"),
        "PGPASSWORD": params.get("password", ""),
    }
    url = (
        f"postgresql://{quote(params['user'], safe='')}@127.0.0.1:"
        f"{params['port']}/{quote(params['dbname'], safe='')}?sslmode=disable"
    )
    args = ["--version"] if version else ["db", "push", "--db-url", url, "--skip-vault", "--yes"]
    return subprocess.run(
        [binary, *args],
        cwd=project,
        env=env,
        shell=False,
        stdin=subprocess.DEVNULL,
        capture_output=True,
        text=True,
        check=False,
        timeout=120,
    )


def _scenario(database: DisposablePostgres, migrations: Path, binary: str, case: str) -> bool:
    from etl.verify import apply_migrations

    with _stage(case, "fixture_creation"):
        dsn = database.migration_dsn
        _require(database.created_by_this_run and dsn is not None, "ownership=0")
        database._verify_target()
        params = conninfo_to_dict(dsn)
    with _resource(
        lambda: tempfile.TemporaryDirectory(prefix="votus-cli-atomicity-"), case
    ) as directory:
        with _stage(case, "fixture_creation"):
            project = Path(directory)
            pending = project / "supabase" / "migrations"
            pending.mkdir(parents=True)
            (project / "supabase" / "config.toml").write_text(
                'project_id = "votus-atomicity"\n[db]\nmajor_version = 17\n', encoding="utf-8"
            )
            predecessors = project / "predecessors"
            predecessors.mkdir()
            for path in sorted(migrations.glob("*.sql")):
                if path.name < MIGRATION:
                    shutil.copyfile(path, predecessors / path.name)
        with _stage(case, "predecessors"):
            apply_migrations(dsn, predecessors)
        with _stage(case, "fixture_creation"), psycopg.connect(dsn) as connection:
            _require(connection.info.server_version // 10000 == 17, "postgres_version=0")
            # Match the pinned CLI's history schema; no fabricated/repair INSERT.
            connection.execute("create schema supabase_migrations")
            connection.execute(
                "create table supabase_migrations.schema_migrations "
                "(version text primary key, statements text[], name text)"
            )
            if case == "ledger":
                connection.execute(
                    "alter table supabase_migrations.schema_migrations "
                    "add constraint atomicity_reject_history "
                    "check (version <> '20260904035355')"
                )
        with _stage(case, "observer"):
            baseline = _snapshot(dsn)
        _require(baseline[0] is not None and baseline[1:] == (None, 0), f"{case}:baseline=0")
        with _stage(case, "fixture_creation"):
            source = (migrations / MIGRATION).read_text(encoding="utf-8")
        if case == "sql":
            # Fault follows the meaningful rename, inside a fixture COPY only.
            anchor = f"rename to {PRESERVED};"
            _require(source.count(anchor) == 1, "sql:injection_anchor=0")
            source = source.replace(
                anchor,
                anchor + "\ndo $$ begin raise exception 'atomicity_reject_sql'; end $$;",
                1,
            )
        with _stage(case, "fixture_creation"):
            (pending / MIGRATION).write_text(source, encoding="utf-8")
        with _stage(case, "cli"):
            completed = _cli(binary, project, params)
        with _stage(case, "observer"):
            after = _snapshot(dsn)
        if case == "success":
            _require(completed.returncode == 0, "success:cli=0")
            original, _, _ = baseline
            current, preserved, history = after
            _require(current is not None and preserved is not None, "success:functions=0")
            _require(
                current[0] != original[0]
                and source.split("as $$", 1)[1].split("$$;", 1)[0] in current[0]
                and current[1] == "results_exploration_executor"
                and current[1:] == original[1:]
                and preserved == (original[0].replace(FUNCTION, PRESERVED, 1), *original[1:])
                and history == 1,
                "success:definition_owner_acl_history=0",
            )
            with _stage(case, "cli"):
                repeated = _cli(binary, project, params)
            with _stage(case, "observer"):
                _require(repeated.returncode == 0 and _snapshot(dsn) == after, "success:repeat=0")
            print("migration_atomicity:success:history=1:repeat_unchanged=1")
            return True
        marker = LEDGER_FAULT if case == "ledger" else SQL_FAULT
        sqlstate = "23514" if case == "ledger" else "P0001"
        diagnostic = completed.stdout + completed.stderr
        _require(
            completed.returncode != 0
            and marker in diagnostic
            and f"SQLSTATE {sqlstate}" in diagnostic,
            f"{case}:expected_fault=0",
        )
        unchanged = after[0] == baseline[0]
        wrapper_absent = after[1] is None
        history_absent = after[2] == 0
        rollback = unchanged and wrapper_absent and history_absent
        print(
            f"migration_atomicity:{case}:fault=1:baseline_unchanged={int(unchanged)}:"
            f"wrapper_absent={int(wrapper_absent)}:history_absent={int(history_absent)}:"
            f"rollback={int(rollback)}"
        )
        return rollback


def _run_owned_proof(owned: DisposablePostgres, migrations: Path, case: str) -> None:
    from etl.verify import DisposablePostgres

    # This opt-in proof is for the job's owned service, never an operator DSN.
    _require(
        os.environ.get("GITHUB_ACTIONS") == "true"
        and re.fullmatch(r"[0-9a-f]{64}", os.environ.get("POSTGRES_CONTAINER", "")) is not None,
        "ci_service=0",
    )
    params = conninfo_to_dict(owned.migration_dsn or "")
    _require(
        owned.created_by_this_run
        and owned.marker_table_created
        and owned.admin is None
        and params.get("host") == "127.0.0.1"
        and params.get("port") == "54322"
        and params.get("user") == "postgres"
        and params.get("dbname") == owned.identity.name
        and set(params) <= {"host", "port", "user", "password", "dbname"},
        "owned_loopback=0",
    )
    owned._verify_target()
    binary = shutil.which("supabase")
    _require(binary is not None, "cli_available=0")
    with _resource(
        lambda: tempfile.TemporaryDirectory(prefix="votus-cli-version-"), "success"
    ) as directory:
        with _stage("success", "cli"):
            version = _cli(binary, Path(directory), params, version=True)
        _require(version.returncode == 0 and version.stdout.strip() == CLI_VERSION, "cli_pin=0")
    with _stage(case, "fixture_creation"):
        fixture = DisposablePostgres(owned.admin_dsn)
    with _resource(lambda: fixture, case):
        rollback = _scenario(fixture, migrations, binary, case)
    _require(rollback, "rollback=0")


def run_migration_atomicity(owned: DisposablePostgres, migrations: Path, case: str) -> None:
    try:
        _run_owned_proof(owned, migrations, case)
    except AtomicityFailure:
        raise
    except Exception:
        raise AtomicityFailure("migration_atomicity:setup_or_cleanup=0") from None
