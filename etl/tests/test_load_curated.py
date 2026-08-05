"""Integration tests for the curated-table loaders (Phase 15, tasks
15.1-15.8), run against a real, ephemeral local Postgres -- same
`_require_ephemeral_postgres` SKIP contract as `test_integration_idempotent.py`.

The curated YAML files (`curated/party_map.yaml`, `curated/crosswalk.yaml`)
are already parsed by `etl.party_map.load_party_map` and
`etl.crosswalk.load_crosswalk`. Nothing loaded them into Postgres before
this phase -- `party_mapping`, `party_canonical`, `list_identity`,
`jurisdiction_crosswalk` and `mesa_crosswalk` were all measured empty live.
`load_party_map_rows`/`load_crosswalk_rows` (this file's GREEN target,
`etl/etl/db.py`) close that gap, following D8's idempotent-load precedent
(`load_result_rows`: delete/replace via natural key, never accumulate
duplicates on re-run).
"""

from __future__ import annotations

import os
import uuid
from pathlib import Path

import psycopg
import pytest

from etl.crosswalk import CrosswalkTable, MesaStability, load_crosswalk
from etl.db import load_crosswalk_rows, load_party_map_rows
from etl.party_map import PartyMappingEntry, PartyMappingTable, load_party_map

TEST_DSN = os.environ.get(
    "ETL_TEST_DATABASE_URL", "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
)

CURATED = Path(__file__).parent.parent.parent / "curated"


def _require_ephemeral_postgres() -> psycopg.Connection:
    try:
        return psycopg.connect(TEST_DSN, connect_timeout=2)
    except psycopg.OperationalError as exc:
        pytest.skip(f"no ephemeral Postgres reachable at {TEST_DSN!r}: {exc}")


@pytest.fixture
def pg_conn():
    conn = _require_ephemeral_postgres()
    try:
        yield conn
    finally:
        # Never commit -- every test's writes are rolled back, matching
        # test_integration_idempotent.py's isolation strategy.
        conn.rollback()
        conn.close()


def _fake_entry(
    *,
    year: int,
    jurisdiction: str,
    category: str,
    list_id: str,
    canonical_party: str,
    party_name: str,
    verified: bool = True,
) -> PartyMappingEntry:
    return PartyMappingEntry(
        year=year,
        jurisdiction=jurisdiction,
        category=category,
        list_id=list_id,
        canonical_party=canonical_party,
        party_name=party_name,
        source="test fixture",
        verified=verified,
    )


# ---------------------------------------------------------------------------
# 15.1 -- party_canonical rows created once per canonical party
# ---------------------------------------------------------------------------


def test_party_canonical_rows_created_once_per_canonical_party(pg_conn: psycopg.Connection) -> None:
    canonical_id = f"TEST_PARTY_{uuid.uuid4().hex[:8]}"
    table = PartyMappingTable(
        entries=(
            _fake_entry(
                year=2023,
                jurisdiction="national",
                category="DIPUTADO NACIONAL",
                list_id="1",
                canonical_party=canonical_id,
                party_name="TEST PARTY NAME",
            ),
            _fake_entry(
                year=2025,
                jurisdiction="national",
                category="DIPUTADO NACIONAL",
                list_id="2",
                canonical_party=canonical_id,
                party_name="TEST PARTY NAME",
            ),
        )
    )

    load_party_map_rows(pg_conn, table)
    load_party_map_rows(pg_conn, table)  # re-run: must not duplicate

    with pg_conn.cursor() as cur:
        cur.execute("select count(*) from party_canonical where id = %s", (canonical_id,))
        (count,) = cur.fetchone()

    assert count == 1


# ---------------------------------------------------------------------------
# 15.2 -- party_mapping keyed by (year, jurisdiction, category, list_id)
# ---------------------------------------------------------------------------


def test_party_mapping_keyed_by_year_jurisdiction_category_list_id(
    pg_conn: psycopg.Connection,
) -> None:
    """The SAME `list_id` under two different (year, jurisdiction) keys
    must persist as two DISTINCT `party_mapping` rows -- never deduped or
    collided on `list_id` alone (party-identity-mapping spec)."""
    marker = uuid.uuid4().hex[:8]
    canonical_a = f"TEST_A_{marker}"
    canonical_b = f"TEST_B_{marker}"
    table = PartyMappingTable(
        entries=(
            _fake_entry(
                year=2023,
                jurisdiction="national",
                category="DIPUTADO NACIONAL",
                list_id="999",
                canonical_party=canonical_a,
                party_name="PARTY A",
            ),
            _fake_entry(
                year=2025,
                jurisdiction="national",
                category="DIPUTADO NACIONAL",
                list_id="999",
                canonical_party=canonical_b,
                party_name="PARTY B",
            ),
        )
    )

    load_party_map_rows(pg_conn, table)

    with pg_conn.cursor() as cur:
        cur.execute(
            "select year, canonical_party_id from party_mapping where list_id = %s "
            "and canonical_party_id in (%s, %s) order by year",
            ("999", canonical_a, canonical_b),
        )
        rows = cur.fetchall()

    assert rows == [(2023, canonical_a), (2025, canonical_b)]


# ---------------------------------------------------------------------------
# 15.3 -- 135 (2023 PASO) and 20135 (2023 generales) resolve to ONE
# canonical party, loaded from the REAL curated file.
# ---------------------------------------------------------------------------


def test_same_party_across_three_id_spaces_resolves_to_one_canonical(
    pg_conn: psycopg.Connection,
) -> None:
    """Measured fact: LLA is `agrupacion_id` 135 in the 2023 PASO national
    file and `agrupacion_id` 20135 in the 2023 generales national file (a
    5-digit id space -- `2` + the PASO id). Both MUST resolve to the same
    canonical party once loaded, proving the curated reconciliation this
    phase exists for."""
    table = load_party_map(CURATED / "party_map.yaml")

    load_party_map_rows(pg_conn, table)

    with pg_conn.cursor() as cur:
        cur.execute(
            "select list_id, canonical_party_id from party_mapping "
            "where year = 2023 and jurisdiction = 'national' "
            "and category = 'DIPUTADO NACIONAL' and list_id in ('135', '20135')"
        )
        rows = dict(cur.fetchall())

    assert rows.get("135") is not None
    assert rows.get("20135") is not None
    assert rows["135"] == rows["20135"]


# ---------------------------------------------------------------------------
# 15.4 -- an unverified mapping is loaded but flagged, never silently
# promoted to verified.
# ---------------------------------------------------------------------------


def test_unverified_mapping_is_loaded_but_flagged(pg_conn: psycopg.Connection) -> None:
    canonical_id = f"TEST_UNVERIFIED_{uuid.uuid4().hex[:8]}"
    table = PartyMappingTable(
        entries=(
            _fake_entry(
                year=2025,
                jurisdiction="national",
                category="DIPUTADO NACIONAL",
                list_id="777",
                canonical_party=canonical_id,
                party_name="UNCONFIRMED PARTY",
                verified=False,
            ),
        )
    )

    load_party_map_rows(pg_conn, table)

    with pg_conn.cursor() as cur:
        cur.execute(
            "select verified from party_mapping where canonical_party_id = %s", (canonical_id,)
        )
        (verified,) = cur.fetchone()

    assert verified is False


# ---------------------------------------------------------------------------
# 15.6 -- jurisdiction_crosswalk rows loaded from the curated YAML
# ---------------------------------------------------------------------------


def test_jurisdiction_crosswalk_rows_loaded_from_curated_yaml(pg_conn: psycopg.Connection) -> None:
    table = load_crosswalk(CURATED / "crosswalk.yaml")

    load_crosswalk_rows(pg_conn, table)
    load_crosswalk_rows(pg_conn, table)  # idempotent re-run

    with pg_conn.cursor() as cur:
        cur.execute(
            "select national_distrito_code, national_seccion_code, name "
            "from jurisdiction_crosswalk where pba_distrito_code = %s",
            ("027",),
        )
        rows = cur.fetchall()

    assert rows == [("02", "027", "Coronel de Marina Leonardo Rosales")]


# ---------------------------------------------------------------------------
# 15.7 -- mesa_crosswalk carries presence per year and the stability flag
# ---------------------------------------------------------------------------


def test_mesa_crosswalk_carries_presence_per_year_and_stability_flag(
    pg_conn: psycopg.Connection,
) -> None:
    marker = uuid.uuid4().int % 900000
    stable_mesa = marker + 1
    discontinuous_mesa = marker + 2
    table = CrosswalkTable(jurisdictions=())

    stabilities = [
        (
            "TESTDIST",
            "TESTSEC",
            MesaStability(mesa=stable_mesa, present_2023=True, present_2025=True),
        ),
        (
            "TESTDIST",
            "TESTSEC",
            MesaStability(mesa=discontinuous_mesa, present_2023=True, present_2025=False),
        ),
    ]

    load_crosswalk_rows(pg_conn, table, mesa_stabilities=stabilities)

    with pg_conn.cursor() as cur:
        cur.execute(
            "select mesa_code, present_2023, present_2025, stable_across_years "
            "from mesa_crosswalk where distrito_code = %s and seccion_code = %s "
            "order by mesa_code",
            ("TESTDIST", "TESTSEC"),
        )
        rows = cur.fetchall()

    assert rows == [
        (stable_mesa, True, True, True),
        (discontinuous_mesa, True, False, False),
    ]
