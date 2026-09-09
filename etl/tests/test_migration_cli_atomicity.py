"""Pure safety/reachability checks; the real atomicity proof runs inside etl-verify.

These tests do NOT stand in for the CLI/Postgres rollback observations in CI.
"""

from pathlib import Path

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
        run_migration_atomicity(owned, Path("unused"))

    assert connections == []


def test_release_gate_reaches_real_cli_proof_with_its_own_pinned_service() -> None:
    root = Path(__file__).resolve().parents[2]
    workflow = yaml.safe_load((root / ".github/workflows/release-gates.yml").read_text())
    job = workflow["jobs"]["etl-release"]
    assert job["services"]["postgres"]["image"] == "postgres:17"
    cli = next(step for step in job["steps"] if step.get("uses", "").startswith("supabase/"))
    assert cli["uses"] == "supabase/setup-cli@3c2f5e2ae34c34e428e8e206e2c4d21fa2d20fbf"
    assert cli["with"]["version"] == "2.116.0"
    gate = next(step for step in job["steps"] if step.get("name") == "Run disposable ETL gate")
    assert "uv run --project etl etl-verify --migration-atomicity" in gate["run"]
    assert gate["env"]["POSTGRES_CONTAINER"] == "${{ job.services.postgres.id }}"
    e2e = workflow["jobs"]["e2e-release"]
    e2e_cli = next(step for step in e2e["steps"] if step.get("uses", "").startswith("supabase/"))
    assert e2e_cli["with"]["version"] == "2.112.0"
