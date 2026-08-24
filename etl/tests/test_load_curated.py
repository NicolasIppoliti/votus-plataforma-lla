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
import yaml

from etl.crosswalk import CrosswalkTable, MesaStability, load_crosswalk
from etl.db import load_crosswalk_rows, load_party_map_rows
from etl.party_map import (
    CanonicalPartyDeclaration,
    PartyMappingEntry,
    PartyMappingTable,
    load_party_map,
)

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


_PartyKey = tuple[int, str, str, str]


class _PartyProjectionCursor:
    rowcount = 0

    def __init__(self) -> None:
        self.canonical: dict[str, str] = {}
        self.list_identity: dict[_PartyKey, str] = {}
        self.party_mapping: dict[_PartyKey, str] = {}

    def __enter__(self) -> _PartyProjectionCursor:
        return self

    def __exit__(self, _exc_type: object, _exc: object, _traceback: object) -> None:
        return None

    def execute(self, query: object, params: object | None = None) -> None:
        statement = str(query).lower()
        assert isinstance(params, tuple)
        if "insert into party_canonical" in statement:
            canonical_id, display_name = params
            assert isinstance(canonical_id, str)
            assert isinstance(display_name, str)
            self.canonical[canonical_id] = display_name
            self.rowcount = 1
            return
        if "insert into list_identity" in statement:
            year, jurisdiction, category, list_id, source_name = params
            assert isinstance(year, int)
            assert isinstance(jurisdiction, str)
            assert isinstance(category, str)
            assert isinstance(list_id, str)
            assert isinstance(source_name, str)
            self.list_identity[(year, jurisdiction, category, list_id)] = source_name
            self.rowcount = 1
            return
        if "insert into party_mapping" in statement:
            year, jurisdiction, category, list_id, canonical_id, _verified, _source = params
            assert isinstance(year, int)
            assert isinstance(jurisdiction, str)
            assert isinstance(category, str)
            assert isinstance(list_id, str)
            assert isinstance(canonical_id, str)
            self.party_mapping[(year, jurisdiction, category, list_id)] = canonical_id
            self.rowcount = 1
            return
        if "delete from party_mapping" in statement:
            desired = self._desired_mapping_keys(params)
            self.rowcount = self._delete_stale(self.party_mapping, desired)
            return
        if "delete from list_identity" in statement:
            desired = self._desired_mapping_keys(params)
            self.rowcount = self._delete_stale(self.list_identity, desired)
            return
        if "delete from party_canonical" in statement:
            desired_ids = params[0]
            assert isinstance(desired_ids, list)
            desired = set()
            for canonical_id in desired_ids:
                assert isinstance(canonical_id, str)
                desired.add(canonical_id)
            stale = set(self.canonical) - desired
            for canonical_id in stale:
                del self.canonical[canonical_id]
            self.rowcount = len(stale)
            return
        raise AssertionError(f"unexpected SQL in party projection fake: {statement}")

    @staticmethod
    def _desired_mapping_keys(params: tuple[object, ...]) -> set[_PartyKey]:
        years, jurisdictions, categories, list_ids = params
        assert isinstance(years, list)
        assert isinstance(jurisdictions, list)
        assert isinstance(categories, list)
        assert isinstance(list_ids, list)
        desired: set[_PartyKey] = set()
        for year, jurisdiction, category, list_id in zip(
            years, jurisdictions, categories, list_ids, strict=True
        ):
            assert isinstance(year, int)
            assert isinstance(jurisdiction, str)
            assert isinstance(category, str)
            assert isinstance(list_id, str)
            desired.add((year, jurisdiction, category, list_id))
        return desired

    @staticmethod
    def _delete_stale(rows: dict[_PartyKey, str], desired: set[_PartyKey]) -> int:
        stale = set(rows) - desired
        for key in stale:
            del rows[key]
        return len(stale)


class _PartyProjectionConnection:
    def __init__(self) -> None:
        self.projection = _PartyProjectionCursor()

    def cursor(self) -> _PartyProjectionCursor:
        return self.projection


def _load_synthetic_party_map(
    tmp_path: Path,
    *,
    filename: str,
    canonical_parties: list[dict[str, object]],
    mappings: list[dict[str, object]],
) -> PartyMappingTable:
    path = tmp_path / filename
    path.write_text(
        yaml.safe_dump(
            {"canonical_parties": canonical_parties, "mappings": mappings},
            sort_keys=False,
        ),
        encoding="utf-8",
    )
    return load_party_map(path)


def test_declared_canonical_display_and_source_spelling_project_to_distinct_tables(
    tmp_path: Path,
) -> None:
    table = _load_synthetic_party_map(
        tmp_path,
        filename="party-map.yaml",
        canonical_parties=[
            {"id": "PARENT", "display_name": "Public Canonical Label"},
        ],
        mappings=[
            {
                "year": 2025,
                "jurisdiction": "national",
                "category": "DIPUTADO NACIONAL",
                "list_id": "100",
                "canonical_party": "PARENT",
                "party_name": "Exact Source Spelling",
            }
        ],
    )
    conn = _PartyProjectionConnection()

    summary = load_party_map_rows(conn, table)

    assert conn.projection.canonical == {"PARENT": "Public Canonical Label"}
    assert conn.projection.list_identity == {
        (2025, "national", "DIPUTADO NACIONAL", "100"): "Exact Source Spelling"
    }
    assert conn.projection.party_mapping == {
        (2025, "national", "DIPUTADO NACIONAL", "100"): "PARENT"
    }
    assert summary.party_canonical.loaded == 1
    assert summary.list_identity.loaded == 1
    assert summary.party_mapping.loaded == 1


def test_party_projection_is_order_independent_and_declaration_updates_idempotently(
    tmp_path: Path, capsys
) -> None:
    declarations: list[dict[str, object]] = [
        {"id": "PARENT", "display_name": "Public Canonical Label"},
        {"id": "OTHER", "display_name": "Other Canonical Label"},
    ]
    mappings: list[dict[str, object]] = [
        {
            "year": 2023,
            "jurisdiction": "national",
            "category": "DIPUTADO NACIONAL",
            "list_id": "100",
            "canonical_party": "PARENT",
            "party_name": "Older Source Spelling",
        },
        {
            "year": 2025,
            "jurisdiction": "national",
            "category": "DIPUTADO NACIONAL",
            "list_id": "101",
            "canonical_party": "PARENT",
            "party_name": "Newer Source Spelling",
        },
        {
            "year": 2025,
            "jurisdiction": "national",
            "category": "DIPUTADO NACIONAL",
            "list_id": "102",
            "canonical_party": "OTHER",
            "party_name": "Other Source Spelling",
        },
    ]
    first = _load_synthetic_party_map(
        tmp_path,
        filename="first.yaml",
        canonical_parties=declarations,
        mappings=mappings,
    )
    reordered = _load_synthetic_party_map(
        tmp_path,
        filename="reordered.yaml",
        canonical_parties=list(reversed(declarations)),
        mappings=list(reversed(mappings)),
    )
    updated_declarations: list[dict[str, object]] = [
        {"id": "OTHER", "display_name": "Other Canonical Label"},
        {"id": "PARENT", "display_name": "Updated Canonical Label"},
    ]
    updated = _load_synthetic_party_map(
        tmp_path,
        filename="updated.yaml",
        canonical_parties=updated_declarations,
        mappings=list(reversed(mappings)),
    )
    conn = _PartyProjectionConnection()

    load_party_map_rows(conn, first)
    assert conn.projection.canonical == {
        "PARENT": "Public Canonical Label",
        "OTHER": "Other Canonical Label",
    }

    load_party_map_rows(conn, reordered)
    assert conn.projection.canonical == {
        "PARENT": "Public Canonical Label",
        "OTHER": "Other Canonical Label",
    }
    assert (
        conn.projection.list_identity[(2023, "national", "DIPUTADO NACIONAL", "100")]
        == "Older Source Spelling"
    )
    assert (
        conn.projection.list_identity[(2025, "national", "DIPUTADO NACIONAL", "101")]
        == "Newer Source Spelling"
    )

    first_update = load_party_map_rows(conn, updated)
    second_update = load_party_map_rows(conn, updated)

    assert conn.projection.canonical == {
        "PARENT": "Updated Canonical Label",
        "OTHER": "Other Canonical Label",
    }
    assert first_update.party_canonical.loaded == 2
    assert second_update.party_canonical.loaded == 2
    assert capsys.readouterr().err == ""


def test_real_party_projection_loads_exact_president_and_pba_category_sets() -> None:
    table = load_party_map(CURATED / "party_map.yaml")
    conn = _PartyProjectionConnection()

    summary = load_party_map_rows(conn, table)

    assert summary.party_canonical.loaded == 30
    assert summary.list_identity.loaded == 83
    assert summary.party_mapping.loaded == 83
    for count in (summary.party_canonical, summary.list_identity, summary.party_mapping):
        assert count.deleted_by_reason == {"absent_from_desired_projection": 0}
    assert {
        list_id
        for year, jurisdiction, category, list_id in conn.projection.party_mapping
        if (year, jurisdiction, category) == (2023, "national", "PRESIDENTE Y VICE")
    } == {"132", "133", "134", "135", "136"}
    assert {
        list_id
        for year, jurisdiction, category, list_id in conn.projection.party_mapping
        if (year, jurisdiction, category) == (2025, "coronel_rosales_municipal", "CONCEJALES")
    } == {"2206", "2200", "2201", "2207", "2204", "962", "2203", "2202"}
    assert {
        list_id
        for year, jurisdiction, category, list_id in conn.projection.party_mapping
        if (year, jurisdiction, category) == (2025, "pba_provincial", "DIPUTADOS PROVINCIALES")
    } == {
        "2206",
        "2200",
        "2201",
        "2207",
        "2204",
        "2203",
        "2202",
        "1006",
        "1003",
        "1008",
        "2208",
        "959",
        "963",
        "974",
        "980",
    }


def test_tigre_curated_projection_persists_exact_identities_idempotently() -> None:
    table = load_party_map(CURATED / "party_map.yaml")
    conn = _PartyProjectionConnection()

    first = load_party_map_rows(conn, table)
    first_snapshot = (
        dict(conn.projection.canonical),
        dict(conn.projection.list_identity),
        dict(conn.projection.party_mapping),
    )
    second = load_party_map_rows(conn, table)

    assert first.party_canonical.loaded == second.party_canonical.loaded == 30
    assert first.list_identity.loaded == second.list_identity.loaded == 83
    assert first.party_mapping.loaded == second.party_mapping.loaded == 83
    assert first_snapshot == (
        conn.projection.canonical,
        conn.projection.list_identity,
        conn.projection.party_mapping,
    )
    assert conn.projection.canonical["ACCION_COMUNAL_TIGRE"] == (
        "ACCION COMUNAL DEL PARTIDO DE TIGRE"
    )
    assert conn.projection.canonical["OPCION_VECINAL_TIGRE"] == (
        "OPCION VECINAL PARA EL PROGRESO DE TIGRE"
    )
    senate_ids = {
        "2200",
        "2206",
        "2204",
        "1006",
        "2201",
        "2207",
        "974",
        "980",
        "1003",
        "959",
        "2202",
        "1008",
        "2203",
        "2208",
        "963",
    }
    council_ids = {
        "2200",
        "2206",
        "2204",
        "1006",
        "2201",
        "2207",
        "2205",
        "974",
        "980",
        "1003",
        "959",
        "193",
        "2203",
        "981",
        "2208",
    }
    for jurisdiction, category, expected_ids in (
        ("pba_provincial", "SENADORES PROVINCIALES", senate_ids),
        ("tigre_municipal", "CONCEJALES", council_ids),
    ):
        keys = {
            key
            for key in conn.projection.party_mapping
            if key[:3] == (2025, jurisdiction, category)
        }
        assert {key[3] for key in keys} == expected_ids
        assert keys <= conn.projection.list_identity.keys()
    action_key = (2025, "tigre_municipal", "CONCEJALES", "193")
    option_key = (2025, "tigre_municipal", "CONCEJALES", "981")
    assert conn.projection.list_identity[action_key] == "ACCION COMUNAL DEL PARTIDO DE TIGRE"
    assert conn.projection.party_mapping[action_key] == "ACCION_COMUNAL_TIGRE"
    assert conn.projection.list_identity[option_key] == "OPCION VECINAL PARA EL PROGRESO DE TIGRE"
    assert conn.projection.party_mapping[option_key] == "OPCION_VECINAL_TIGRE"


def test_explicit_empty_party_projection_deletes_the_replacement_snapshot(tmp_path: Path) -> None:
    conn = _PartyProjectionConnection()
    key = (2025, "national", "DIPUTADO NACIONAL", "100")
    conn.projection.canonical["STALE"] = "Stale Canonical Label"
    conn.projection.list_identity[key] = "Stale Source Spelling"
    conn.projection.party_mapping[key] = "STALE"
    empty = _load_synthetic_party_map(
        tmp_path,
        filename="empty.yaml",
        canonical_parties=[],
        mappings=[],
    )

    summary = load_party_map_rows(conn, empty)

    assert conn.projection.canonical == {}
    assert conn.projection.list_identity == {}
    assert conn.projection.party_mapping == {}
    assert summary.party_canonical.loaded == 0
    assert summary.party_canonical.deleted == 1
    assert summary.list_identity.loaded == 0
    assert summary.list_identity.deleted == 1
    assert summary.party_mapping.loaded == 0
    assert summary.party_mapping.deleted == 1
    for count in (summary.party_canonical, summary.list_identity, summary.party_mapping):
        assert count.deleted_by_reason == {"absent_from_desired_projection": 1}


# ---------------------------------------------------------------------------
# 15.1 -- party_canonical rows created once per canonical party
# ---------------------------------------------------------------------------


def test_party_canonical_rows_created_once_per_canonical_party(pg_conn: psycopg.Connection) -> None:
    canonical_id = f"TEST_PARTY_{uuid.uuid4().hex[:8]}"
    table = PartyMappingTable(
        canonical_parties=(
            CanonicalPartyDeclaration(id=canonical_id, display_name="TEST PARTY NAME"),
        ),
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
        ),
    )

    load_party_map_rows(pg_conn, table)
    load_party_map_rows(pg_conn, table)  # re-run: must not duplicate

    with pg_conn.cursor() as cur:
        cur.execute("select count(*) from party_canonical where id = %s", (canonical_id,))
        row = cur.fetchone()
        assert row is not None
        (count,) = row

    assert count == 1


# ---------------------------------------------------------------------------
# 15.2 -- party_mapping keyed by (year, jurisdiction, category, list_id)
# ---------------------------------------------------------------------------


def test_party_mapping_keyed_by_year_jurisdiction_category_list_id(
    pg_conn: psycopg.Connection,
) -> None:
    """Every dimension of the party-mapping natural key is load-bearing.

    The same list id under a different year, jurisdiction, or category must
    persist independently instead of colliding on a partial key.
    """
    marker = uuid.uuid4().hex[:8]
    canonical_ids = tuple(f"TEST_{suffix}_{marker}" for suffix in "ABCD")
    table = PartyMappingTable(
        canonical_parties=tuple(
            CanonicalPartyDeclaration(id=canonical_id, display_name=f"PARTY {suffix}")
            for canonical_id, suffix in zip(canonical_ids, "ABCD", strict=True)
        ),
        entries=(
            _fake_entry(
                year=2023,
                jurisdiction="national",
                category="DIPUTADO NACIONAL",
                list_id="999",
                canonical_party=canonical_ids[0],
                party_name="PARTY A",
            ),
            _fake_entry(
                year=2025,
                jurisdiction="national",
                category="DIPUTADO NACIONAL",
                list_id="999",
                canonical_party=canonical_ids[1],
                party_name="PARTY B",
            ),
            _fake_entry(
                year=2023,
                jurisdiction="pba_provincial",
                category="DIPUTADO NACIONAL",
                list_id="999",
                canonical_party=canonical_ids[2],
                party_name="PARTY C",
            ),
            _fake_entry(
                year=2023,
                jurisdiction="national",
                category="PRESIDENTE Y VICE",
                list_id="999",
                canonical_party=canonical_ids[3],
                party_name="PARTY D",
            ),
        ),
    )

    load_party_map_rows(pg_conn, table)

    with pg_conn.cursor() as cur:
        cur.execute(
            "select year, jurisdiction, category, canonical_party_id "
            "from party_mapping where list_id = %s and canonical_party_id = any(%s) "
            "order by year, jurisdiction, category",
            ("999", list(canonical_ids)),
        )
        rows = cur.fetchall()

    assert rows == [
        (2023, "national", "DIPUTADO NACIONAL", canonical_ids[0]),
        (2023, "national", "PRESIDENTE Y VICE", canonical_ids[3]),
        (2023, "pba_provincial", "DIPUTADO NACIONAL", canonical_ids[2]),
        (2025, "national", "DIPUTADO NACIONAL", canonical_ids[1]),
    ]


# ---------------------------------------------------------------------------
# 15.3 -- 135 (2023 PASO) and 20135 (2023 generales) resolve to ONE
# canonical party, loaded from the REAL curated file.
# ---------------------------------------------------------------------------


def test_same_party_across_three_id_spaces_resolves_to_one_canonical(
    pg_conn: psycopg.Connection,
) -> None:
    """Measured fact: LLA changes identifier across three national sources.

    PASO 2023 uses 135, generales 2023 uses 20135 for DIPUTADO NACIONAL,
    and legislativas 2025 uses 110. All three MUST resolve to one canonical
    party once loaded.
    """
    table = load_party_map(CURATED / "party_map.yaml")

    load_party_map_rows(pg_conn, table)

    with pg_conn.cursor() as cur:
        cur.execute(
            "select year, list_id, canonical_party_id from party_mapping "
            "where jurisdiction = 'national' and category = 'DIPUTADO NACIONAL' "
            "and ((year = 2023 and list_id in ('135', '20135')) "
            "or (year = 2025 and list_id = '110'))"
        )
        rows = {(year, list_id): canonical_party_id for year, list_id, canonical_party_id in cur}

    canonical_ids = {
        rows.get((2023, "135")),
        rows.get((2023, "20135")),
        rows.get((2025, "110")),
    }
    assert None not in canonical_ids
    assert len(canonical_ids) == 1


# ---------------------------------------------------------------------------
# 15.4 -- an unverified mapping is loaded but flagged, never silently
# promoted to verified.
# ---------------------------------------------------------------------------


def test_unverified_mapping_is_loaded_but_flagged(pg_conn: psycopg.Connection) -> None:
    canonical_id = f"TEST_UNVERIFIED_{uuid.uuid4().hex[:8]}"
    table = PartyMappingTable(
        canonical_parties=(
            CanonicalPartyDeclaration(id=canonical_id, display_name="UNCONFIRMED PARTY"),
        ),
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
        ),
    )

    load_party_map_rows(pg_conn, table)

    with pg_conn.cursor() as cur:
        cur.execute(
            "select verified from party_mapping where canonical_party_id = %s", (canonical_id,)
        )
        row = cur.fetchone()
        assert row is not None
        (verified,) = row

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


def test_omitted_mesa_projection_preserves_existing_rows(pg_conn: psycopg.Connection) -> None:
    marker = uuid.uuid4().hex
    stability = MesaStability(circuito=f"C-{marker}", mesa=1, present_2023=True, present_2025=True)
    table = CrosswalkTable(jurisdictions=())
    load_crosswalk_rows(
        pg_conn,
        table,
        mesa_stabilities=((f"D-{marker}", f"S-{marker}", stability),),
    )

    summary = load_crosswalk_rows(pg_conn, table)

    with pg_conn.cursor() as cur:
        cur.execute(
            "select distrito_code, seccion_code, circuito_code, mesa_code "
            "from mesa_crosswalk where distrito_code = %s and seccion_code = %s",
            (f"D-{marker}", f"S-{marker}"),
        )
        assert cur.fetchall() == [(f"D-{marker}", f"S-{marker}", f"C-{marker}", 1)]
    assert summary.mesa_crosswalk.operation == "no-op"
    assert summary.mesa_crosswalk.loaded == 0
    assert summary.mesa_crosswalk.deleted == 0
    assert summary.mesa_crosswalk.deleted_by_reason == {}


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

    first = load_crosswalk_rows(pg_conn, table, mesa_stabilities=stabilities)
    idempotent = load_crosswalk_rows(pg_conn, table, mesa_stabilities=stabilities)

    assert first.mesa_crosswalk.operation == "replacement"
    assert first.mesa_crosswalk.loaded == 2
    assert first.mesa_crosswalk.deleted_by_reason == {
        "absent_from_desired_projection": first.mesa_crosswalk.deleted
    }
    assert idempotent.mesa_crosswalk.operation == "replacement"
    assert idempotent.mesa_crosswalk.loaded == 2
    assert idempotent.mesa_crosswalk.deleted == 0
    assert idempotent.mesa_crosswalk.deleted_by_reason == {"absent_from_desired_projection": 0}

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
