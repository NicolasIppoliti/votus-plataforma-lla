"""Focused authenticated administrative-fixture proof on a parent-owned local stack."""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
from pathlib import Path

import psycopg
import pytest
from test_verify_scope import owned_admin_dsn  # noqa: F401

# Imported fixture is intentionally requested by its registered name.
from etl import verify


@pytest.mark.parametrize(
    "node",
    [
        "tests/test_migration_integration.py::test_workspace_context_selection_switching_and_session_isolation"
    ],
)
def test_authenticated_fixture_through_public_setup(
    owned_admin_dsn: str,  # noqa: F811
    monkeypatch: pytest.MonkeyPatch,
    capsys,
    node: str,
) -> None:
    reached = False
    identities = []

    def focused(dsn: str, etl_root: Path, owned: verify.DisposablePostgres):
        nonlocal reached
        reached = True
        identities.append(owned.identity)
        owned._verify_target()
        with psycopg.connect(owned.migration_dsn) as connection:
            before = connection.execute(
                "select roleid,member,grantor,admin_option,inherit_option,set_option "
                "from pg_auth_members order by 1,2,3"
            ).fetchall()
        with tempfile.TemporaryDirectory(prefix="votus-auth-fixture-") as directory:
            report = Path(directory) / "collection.json"

            def selected(command, **kwargs):
                return subprocess.run([*command, node], **kwargs)

            result = verify._run_pytest_phase(
                dsn,
                etl_root,
                run=selected,
                phase_env={
                    "ETL_VERIFY_PHASE": "privileged",
                    "ETL_VERIFY_COLLECTION_REPORT": str(report),
                    "ETL_TEST_OWNED_DATABASE_URL": owned.migration_dsn,
                    "ETL_TEST_OWNED_DATABASE_MARKER": owned.identity.marker,
                },
            )
            assert json.loads(report.read_text()) == {"all": [node], "selected": [node]}
        with psycopg.connect(owned.migration_dsn) as connection:
            assert (
                connection.execute(
                    "select roleid,member,grantor,admin_option,inherit_option,set_option "
                    "from pg_auth_members order by 1,2,3"
                ).fetchall()
                == before
            )
        assert result == verify.PytestResult(1, 0)
        return result

    monkeypatch.setenv("ETL_TEST_ADMIN_DATABASE_URL", owned_admin_dsn)
    monkeypatch.setattr(sys, "argv", ["etl-verify"])
    monkeypatch.setattr(verify, "run_pytest", focused)
    assert verify.main() == 0
    assert reached
    output = capsys.readouterr()
    assert "1 executed, 0 skipped" in output.out
    with psycopg.connect(owned_admin_dsn) as connection:
        for identity in identities:
            assert (
                connection.execute(
                    "select 1 from pg_database where datname=%s", (identity.name,)
                ).fetchone()
                is None
            )
            assert (
                connection.execute(
                    "select 1 from pg_roles where rolname=%s", (identity.role_name,)
                ).fetchone()
                is None
            )
