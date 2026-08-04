"""Scaffolding smoke test.

Proves the uv/pytest runner is wired correctly before any production
ETL code exists. Intentionally trivial: Phase 1 only establishes the
test runner, per tasks.md task 1.1.
"""


def test_pytest_runner_is_wired() -> None:
    assert 2 + 2 == 4
