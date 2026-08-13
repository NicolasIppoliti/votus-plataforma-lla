from pathlib import Path

REPO_ROOT = Path(__file__).parent.parent.parent
MIGRATIONS = REPO_ROOT / "supabase" / "migrations"
SQL_TESTS = REPO_ROOT / "supabase" / "tests"


def test_0023_binds_successful_coverage_payload_to_requested_scope() -> None:
    sql = (MIGRATIONS / "0023_results_coverage_scope_binding.sql").read_text().lower()

    assert "pg_get_functiondef" in sql
    assert "'election_id', p_election_id::text" in sql
    assert "'category_id', p_category_id::text" in sql
    assert "security invoker" in sql
    assert "search_path=public, pg_temp" in sql
    assert "create or replace function results_exploration_coverage(" not in sql


def test_0023_down_removes_only_scope_binding_augmentation() -> None:
    sql = (MIGRATIONS / "down" / "0023_results_coverage_scope_binding.down.sql").read_text().lower()

    assert "pg_get_functiondef" in sql
    assert "regexp_matches" in sql
    assert "regexp_replace" in sql
    assert "return result;" in sql
    assert "drop function" not in sql
    assert "\\ir ../0022_results_exploration_scale.sql" not in sql


def test_0023_release_proof_rolls_back_and_reapplies_contract_and_grants() -> None:
    sql = (SQL_TESTS / "results_coverage_scope_binding_release.sql").read_text().lower()
    down = "\\ir ../migrations/down/0023_results_coverage_scope_binding.down.sql"
    up = "\\ir ../migrations/0023_results_coverage_scope_binding.sql"

    assert sql.index(down) < sql.index(up)
    assert "insert into election (id, year, round)" in sql
    assert "insert into category (id, name)" in sql
    for evidence in ("election_id", "category_id", "authenticated", "anon", "prosecdef"):
        assert evidence in sql
