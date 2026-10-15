"""Explicit opt-in diagnostic of #481's local owned benchmark prerequisites."""

import os
import re

import pytest


@pytest.mark.skipif(
    os.environ.get("JURISDICTION_BENCH_DIAGNOSTIC") != "1",
    reason="explicit local benchmark diagnostic only",
)
def test_local_benchmark_prerequisites():
    import subprocess

    import psycopg

    from etl.benchmark import clone_schema, local_admin
    from etl.verify import DisposablePostgres, UnsafeDatabaseError

    stage = "owned database setup"
    database = None
    try:
        admin = local_admin()
        database = DisposablePostgres(admin)
        with database:
            stage = "schema clone"
            clone_schema(admin, database, "postgres")
            stage = "test grants"
            database.grant_test_privileges()
    except psycopg.Error as exc:
        print("BENCHMARK BLOCKER:", stage, type(exc).__name__, "SQLSTATE", exc.sqlstate)
    except UnsafeDatabaseError as exc:
        # Repository-defined bounded messages, never a server/DSN error string.
        print("BENCHMARK BLOCKER:", stage, type(exc).__name__, str(exc))
    except subprocess.CalledProcessError as exc:
        stderr = exc.stderr or b""
        if isinstance(stderr, bytes):
            stderr = stderr.decode(errors="replace")
        # Emit only fixed diagnostics, not statements, values or connection strings.
        known = [
            marker
            for marker in (
                'schema "auth" does not exist',
                'schema "extensions" does not exist',
                "permission denied",
                "must be owner",
                "already exists",
                "unrecognized configuration parameter",
                "unsupported version",
                "connection to server on socket",
                "No such file or directory",
                "Connection refused",
                "could not translate host name",
                "FATAL:",
            )
            if marker in stderr
        ]
        sqlstates = re.findall(r"SQLSTATE: ([0-9A-Z]{5})", stderr)
        error = re.search(r"ERROR:\s+([^\n]+)", stderr)
        if error:
            shape = re.sub(r"\"[^\"]*\"|'[^']*'", "<quoted>", error[1])
            print("SCHEMA ERROR SHAPE:", shape[:256])
            missing = re.search(r'schema "([a-z_]{1,63})" does not exist', error[1])
            if missing:
                print("MISSING SCHEMA IDENTIFIER:", missing[1])
            command = re.search(r"Command was: ([A-Z ]+)", stderr)
            if command:
                print("FAILING SCHEMA COMMAND KIND:", command[1])
        print(
            "BENCHMARK BLOCKER:",
            stage,
            type(exc).__name__,
            "tool",
            exc.cmd[0],
            "exit",
            exc.returncode,
            "known diagnostics",
            known,
            "sqlstates",
            sqlstates,
        )
    else:
        print("BENCHMARK PREREQUISITES: passed")
    finally:
        if database is not None:
            assert not database.created_by_this_run
            assert not database.role_created_by_this_run
            print("OWNED DIAGNOSTIC CLEANUP: database and role absence confirmed by harness")
