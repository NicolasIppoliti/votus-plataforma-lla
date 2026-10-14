"""Owned release-gate coverage; never connect to an ambient application DSN."""

import uuid

import pytest

from etl.benchmark import logical_fingerprint
from etl.ingest_performance import Performance


@pytest.mark.owned_database
def test_performance_catalog_observation_needs_no_privileged_ingest_role(owned_database):
    profiler = Performance()
    with owned_database.connect() as conn:
        conn.execute("set local role etl_writer")
        profiler.database_context(conn, f"synthetic-profile-{uuid.uuid4()}", 2025, "legislativas")
    assert profiler.data["role"]["superuser"] is False
    assert profiler.data["load_state"] == "first_load"
    assert len(profiler.data["schema_fingerprint"]) == 32
    assert set(profiler.data["database_settings"]) == {
        "fsync",
        "full_page_writes",
        "synchronous_commit",
        "shared_buffers",
        "work_mem",
    }


@pytest.mark.owned_database
def test_benchmark_full_readback_queries_match_the_migrated_schema(owned_database):
    # The fixture proves exact target identity; only then hand its capability to
    # the readback connection. A nonexistent synthetic scope makes this read-only.
    with owned_database.connect():
        result = logical_fingerprint(
            owned_database.dsn, f"synthetic-profile-{uuid.uuid4()}", 2025, "legislativas"
        )
    assert set(result) == {"results", "expected", "statuses", "quarantines"}
    assert all(entry["rows"] == 0 for entry in result.values())
    assert all(len(entry["sha256"]) == 64 for entry in result.values())
