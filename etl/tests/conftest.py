"""Explicit privileged-test partition for the owned verification harness."""

from __future__ import annotations

import json
import os
from pathlib import Path

import pytest

_MIGRATION_RUNNER_TESTS = frozenset(
    {
        "tests/test_migration_integration.py::"
        "test_review_item_context_foundation_runs_as_supabase_temporary_login",
        "tests/test_migration_integration.py::"
        "test_remaining_review_context_migrations_run_as_supabase_temporary_login",
    }
)


def pytest_collection_modifyitems(config, items):
    phase = os.environ.get("ETL_VERIFY_PHASE")
    admin_keys = ("ETL_TEST_OWNED_DATABASE_URL", "ETL_TEST_OWNED_DATABASE_MARKER")
    privileged_keys = (*admin_keys, "ETL_TEST_OWNED_MIGRATION_RUNNER")
    if phase not in {None, "ordinary", "privileged"}:
        raise pytest.UsageError("unknown owned verification phase")
    if phase != "privileged" and any(os.environ.get(key) for key in privileged_keys):
        raise pytest.UsageError("administrative test inputs require the privileged phase")
    if phase is None:
        return
    report = os.environ.get("ETL_VERIFY_COLLECTION_REPORT")
    if not report or (phase == "privileged" and not all(os.environ.get(key) for key in admin_keys)):
        raise pytest.UsageError("owned verification phase inputs are incomplete")
    complete = [item.nodeid for item in items]
    selected, deselected = [], []
    for item in items:
        privileged = bool(item.get_closest_marker("owned_database"))
        (selected if privileged == (phase == "privileged") else deselected).append(item)
    Path(report).write_text(
        json.dumps({"all": complete, "selected": [item.nodeid for item in selected]}),
        encoding="utf-8",
    )
    items[:] = selected
    config.hook.pytest_deselected(items=deselected)


@pytest.fixture
def owned_database(request):
    """Only explicitly designated trusted tests may request maintenance setup access."""
    from owned_database import OwnedDatabase

    if os.environ.get("ETL_VERIFY_PHASE") != "privileged" or not request.node.get_closest_marker(
        "owned_database"
    ):
        pytest.fail("owned database fixtures require the privileged test phase", pytrace=False)
    dsn = os.environ.get("ETL_TEST_OWNED_DATABASE_URL")
    marker = os.environ.get("ETL_TEST_OWNED_DATABASE_MARKER")
    if not dsn or not marker:
        pytest.fail("explicit owned database fixture inputs are required", pytrace=False)
    return OwnedDatabase(dsn, marker)


@pytest.fixture
def owned_migration_runner(request, owned_database):
    """Expose the parent-owned runner only to the two migration-session contracts."""
    if (
        os.environ.get("ETL_VERIFY_PHASE") != "privileged"
        or not request.node.get_closest_marker("owned_database")
        or request.node.nodeid not in _MIGRATION_RUNNER_TESTS
    ):
        pytest.fail(
            "owned migration runners require designated migration-session tests", pytrace=False
        )
    record = os.environ.get("ETL_TEST_OWNED_MIGRATION_RUNNER")
    if not record:
        pytest.fail("an explicit owned migration runner is required", pytrace=False)
    return owned_database.migration_runner_dsn(record)
