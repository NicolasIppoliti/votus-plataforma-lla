"""Pure safety/reachability checks; the real atomicity proof runs inside etl-verify.

These tests do NOT stand in for the CLI/Postgres rollback observations in CI.
"""

import json
from functools import partial
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock

import psycopg
import pytest
import yaml

from etl.migration_atomicity import AtomicityFailure, run_migration_atomicity
from etl.verify import DisposablePostgres


@pytest.mark.parametrize(
    ("ci", "container", "target", "created", "expected"),
    [
        ("false", "a" * 64, "127.0.0.1", True, "ci_service=0"),
        ("true", "", "127.0.0.1", True, "ci_service=0"),
        ("true", "a" * 64, "foreign.invalid", True, "owned_loopback=0"),
        ("true", "a" * 64, "127.0.0.1", False, "owned_loopback=0"),
        ("true", "a" * 64, "127.0.0.1 hostaddr=192.0.2.1", True, "owned_loopback=0"),
    ],
)
def test_proof_refuses_unowned_or_non_ci_targets_before_any_connection(
    monkeypatch: pytest.MonkeyPatch,
    ci: str,
    container: str,
    target: str,
    created: bool,
    expected: str,
) -> None:
    connections = []

    def reject_connection(*args, **kwargs):
        connections.append(True)
        raise AssertionError("connection must not be attempted")

    owned = DisposablePostgres(
        "host=127.0.0.1 port=54322 user=postgres dbname=template1",
        connect=reject_connection,
    )
    owned.created_by_this_run = created
    owned.marker_table_created = True
    owned.migration_dsn = f"host={target} port=54322 user=postgres dbname={owned.identity.name}"
    monkeypatch.setenv("GITHUB_ACTIONS", ci)
    monkeypatch.setenv("POSTGRES_CONTAINER", container)

    with pytest.raises(AtomicityFailure, match=expected):
        run_migration_atomicity(owned, Path("unused"), "success")

    assert connections == []


def test_release_gate_reaches_real_cli_proof_with_its_own_pinned_service() -> None:
    root = Path(__file__).resolve().parents[2]
    workflow = yaml.safe_load((root / ".github/workflows/release-gates.yml").read_text())
    job = workflow["jobs"]["etl-release"]
    assert job["services"]["postgres"]["image"] == (
        "postgres:17@sha256:d74eeac9a635390a49bc21bd49fccd973de707e2a53a76ac49b552b8712ec46f"
    )
    cli = next(step for step in job["steps"] if step.get("uses", "").startswith("supabase/"))
    assert cli["uses"] == "supabase/setup-cli@3c2f5e2ae34c34e428e8e206e2c4d21fa2d20fbf"
    assert cli["with"]["version"] == "${{ needs.scope.outputs.supabase }}"
    gate = next(step for step in job["steps"] if step.get("name") == "Run disposable ETL gate")
    assert job["strategy"] == {
        "fail-fast": False,
        "matrix": {"case": ["ordinary", "success", "ledger", "sql"]},
    }
    assert gate["env"]["ETL_CASE"] == "${{ matrix.case }}"
    assert 'if [ "$ETL_CASE" = "ordinary" ]; then' in gate["run"]
    assert "uv run --project etl --locked etl-verify\n" in gate["run"]
    assert (
        'uv run --project etl --locked etl-verify --migration-atomicity "$ETL_CASE"' in gate["run"]
    )
    assert gate["env"]["POSTGRES_CONTAINER"] == "${{ job.services.postgres.id }}"
    e2e = workflow["jobs"]["e2e-release"]
    e2e_cli = next(step for step in e2e["steps"] if step.get("uses", "").startswith("supabase/"))
    assert e2e_cli["with"]["version"] == "${{ needs.scope.outputs.supabase }}"


@pytest.mark.parametrize(
    ("reported_version", "returncode", "accepted"),
    [
        (None, 0, True),
        ("2.116.0", 0, True),
        ("2.117.0", 0, False),
        ("2.118.0", 0, False),
        ("2.118.0-beta.1", 0, False),
        ("", 0, False),
        ("SYNTHETIC_VERSION_CANARY", 0, False),
        (None, 1, False),
    ],
)
def test_public_proof_requires_manifest_cli_pin_before_database_fixture_creation(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
    tmp_path: Path,
    reported_version: str | None,
    returncode: int,
    accepted: bool,
) -> None:
    from etl import migration_atomicity as proof
    from etl import verify

    root = Path(__file__).resolve().parents[2]
    manifest = json.loads((root / "apps/web/package.json").read_text())
    selected_version = manifest["devDependencies"]["supabase"]
    stdout = selected_version if reported_version is None else reported_version
    owned = MagicMock(spec=DisposablePostgres)
    owned.admin_dsn = "host=127.0.0.1 port=54322 user=postgres dbname=template1"
    owned.identity = SimpleNamespace(name="synthetic_owned")
    owned.migration_dsn = "host=127.0.0.1 port=54322 user=postgres dbname=synthetic_owned"
    owned.created_by_this_run = owned.marker_table_created = True
    owned.admin = None
    fixture = MagicMock()
    fixture.return_value.__enter__.return_value = fixture.return_value
    scenario = MagicMock(return_value=True)
    cli = MagicMock(return_value=SimpleNamespace(returncode=returncode, stdout=stdout))
    monkeypatch.setenv("GITHUB_ACTIONS", "true")
    monkeypatch.setenv("POSTGRES_CONTAINER", "a" * 64)
    monkeypatch.setattr(verify, "DisposablePostgres", fixture)
    monkeypatch.setattr(proof, "_scenario", scenario)
    monkeypatch.setattr(proof.shutil, "which", lambda *a: "synthetic-cli")
    monkeypatch.setattr(proof.subprocess, "run", cli)

    if accepted:
        run_migration_atomicity(owned, tmp_path, "success")
        fixture.assert_called_once_with(owned.admin_dsn)
        scenario.assert_called_once_with(fixture.return_value, tmp_path, "synthetic-cli", "success")
        fixture.return_value.__exit__.assert_called_once()
    else:
        with pytest.raises(AtomicityFailure, match="migration_atomicity:cli_pin=0"):
            run_migration_atomicity(owned, tmp_path, "success")
        fixture.assert_not_called()
        scenario.assert_not_called()
    cli.assert_called_once()
    assert cli.call_args.args[0] == ["synthetic-cli", "--version"]
    output = capsys.readouterr()
    assert "SYNTHETIC_VERSION_CANARY" not in output.out + output.err


@pytest.mark.parametrize("case", ["success", "ledger", "sql"])
@pytest.mark.parametrize(
    ("stage", "sqlstate", "failure_kind"),
    [
        *[
            (stage, sqlstate, "database")
            for stage in (
                "fixture_creation",
                "files",
                "predecessors",
                "cli",
                "observer",
                "cleanup",
                "assertion_cleanup",
                "assertion_temp_cleanup",
                "complete",
            )
            for sqlstate in ("23514", "SYNTHETIC_DIAGNOSTIC_CANARY", None, 23514)
        ],
        *[("predecessors", "23514", kind) for kind in ("non_database", "os", "nested_database")],
    ],
)
def test_public_proof_reports_safe_stage_and_preserves_failure_and_cleanup(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
    case: str,
    stage: str,
    sqlstate: object,
    failure_kind: str,
) -> None:
    from etl import migration_atomicity as proof
    from etl import verify

    canary = "SYNTHETIC_DIAGNOSTIC_CANARY"
    failure = (
        OSError(canary)
        if stage == "assertion_temp_cleanup"
        else psycopg.errors.CheckViolation(canary)
    )
    if failure_kind != "database":
        failure = OSError(canary) if failure_kind == "os" else RuntimeError(canary)
        if failure_kind == "nested_database":
            failure.__cause__ = psycopg.errors.CheckViolation(canary)
    failure.sqlstate = sqlstate
    original_cause = failure.__cause__
    migration_failures = []
    state = {"case": "preflight", "applied": False}
    cleaned = []
    attempted = []
    temporary_cleaned = []

    def fail_at(current):
        trigger = "cleanup" if stage == "assertion_cleanup" else stage
        if state["case"] == case and current == trigger:
            raise failure

    owned = MagicMock(spec=DisposablePostgres)
    owned.admin_dsn = "host=127.0.0.1 port=54322 user=postgres dbname=template1"
    owned.identity = SimpleNamespace(name="synthetic_owned")
    owned.migration_dsn = "host=127.0.0.1 port=54322 user=postgres dbname=synthetic_owned"
    owned.created_by_this_run = owned.marker_table_created = True
    owned.admin = None

    def fixture(_dsn):
        state.update(case=case, applied=False)
        attempted.append(state["case"])
        resource = MagicMock()
        resource.migration_dsn = owned.migration_dsn
        resource.__enter__.side_effect = lambda *args: fail_at("fixture_creation")

        def cleanup(*args):
            cleaned.append(state["case"])
            fail_at("cleanup")

        resource.__exit__.side_effect = cleanup
        return resource

    path = MagicMock()
    path.__truediv__.return_value = path
    path.name = "0001_initial.sql"
    path.mkdir.side_effect = lambda **kwargs: fail_at("files")
    path.glob.return_value = [path]
    path.read_text.return_value = f"rename to {proof.PRESERVED}; as $$body$$;"
    connection = MagicMock()
    connection.__enter__.return_value = connection
    connection.info.server_version = 170000
    original = ("old results_exploration_official", "results_exploration_executor", [])

    def execute(query, params=None):
        if isinstance(query, bytes):
            fail_at("predecessors")
        if isinstance(query, str) and query.startswith("select"):
            fail_at("observer")
        row = None
        if params and "to_regprocedure" in query:
            if proof.PRESERVED in params[0]:
                row = (original[0].replace(proof.FUNCTION, proof.PRESERVED), *original[1:])
                row = row if state["applied"] else None
            else:
                row = ("body", *original[1:]) if state["applied"] else original
        elif params:
            row = (int(state["applied"]),)
        return SimpleNamespace(fetchone=lambda: row)

    def cli(args, **kwargs):
        if "--version" in args:
            return SimpleNamespace(returncode=0, stdout=proof.CLI_VERSION)
        fail_at("cli")
        if state["case"] == case and stage in ("assertion_cleanup", "assertion_temp_cleanup"):
            return SimpleNamespace(returncode=1, stdout=canary, stderr=canary)
        state["applied"] = state["case"] == "success"
        marker, code = (
            (proof.LEDGER_FAULT, "23514")
            if state["case"] == "ledger"
            else (proof.SQL_FAULT, "P0001")
        )
        return SimpleNamespace(
            returncode=int(not state["applied"]), stdout=f"{marker} SQLSTATE {code}", stderr=canary
        )

    connection.execute.side_effect = execute
    apply = partial(verify.apply_migrations, connect=lambda *a: connection)

    def observe_apply(*args):
        try:
            return apply(*args)
        except verify.MigrationApplyError as error:
            migration_failures.append(error)
            raise

    monkeypatch.setenv("GITHUB_ACTIONS", "true")
    monkeypatch.setenv("POSTGRES_CONTAINER", "a" * 64)
    monkeypatch.setattr(verify, "DisposablePostgres", fixture)
    monkeypatch.setattr(verify, "apply_migrations", observe_apply)
    monkeypatch.setattr(proof.psycopg, "connect", lambda *a: connection)
    monkeypatch.setattr(proof, "Path", lambda *a: path)
    monkeypatch.setattr(proof.shutil, "copyfile", lambda *a: None)
    monkeypatch.setattr(proof.shutil, "which", lambda *a: "synthetic-cli")
    temporary = MagicMock()

    def cleanup_temporary(*args):
        temporary_cleaned.append(state["case"])
        fail_at("assertion_temp_cleanup")

    temporary.return_value.__exit__.side_effect = cleanup_temporary
    monkeypatch.setattr(proof.tempfile, "TemporaryDirectory", temporary)
    monkeypatch.setattr(proof.subprocess, "run", cli)

    if stage == "complete":
        run_migration_atomicity(owned, path, case)
        assert attempted == cleaned == [case]
        assert temporary_cleaned == ["preflight", case]
        output = capsys.readouterr()
        assert canary not in output.out + output.err
        return

    with pytest.raises(AtomicityFailure) as caught:
        run_migration_atomicity(owned, path, case)

    label = "fixture_creation" if stage == "files" else stage
    if stage in ("assertion_cleanup", "assertion_temp_cleanup"):
        label = "cleanup"
    category = "os" if stage == "assertion_temp_cleanup" else "database"
    if failure_kind != "database":
        category = "unexpected"
    diagnostic = f"migration_atomicity:{case}:stage={label}:exception={category}"
    if category == "database" and sqlstate == "23514":
        diagnostic += ":sqlstate=23514"
    output = capsys.readouterr()
    assert diagnostic in output.out
    assert str(caught.value) == diagnostic
    assert canary not in output.out + output.err + str(caught.value)
    assert caught.value.__suppress_context__
    if stage == "predecessors":
        assert len(migration_failures) == 1
        wrapped = migration_failures[0]
        assert caught.value.__context__ is wrapped
        assert wrapped.__cause__ is failure
        assert failure.__cause__ is original_cause
        assert wrapped.filename == path.name
    assert attempted[-1] == case
    assert cleaned == (attempted[:-1] if stage == "fixture_creation" else attempted)
    if stage in ("assertion_cleanup", "assertion_temp_cleanup"):
        assert temporary_cleaned == ["preflight", *attempted]
        assertion = "cli" if case == "success" else "expected_fault"
        primary = f"migration_atomicity:{case}:{assertion}=0"
        assert primary in output.out
        assert output.out.index(primary) < output.out.index(diagnostic)
