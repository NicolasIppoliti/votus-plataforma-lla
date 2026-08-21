"""Tests for `etl.party_map` (party-identity-mapping spec, Phase 7).

Covers the curated `(year, jurisdiction, category, list_id)` mapping key
and the three measured facts that make `list_id` alone unsafe (Engram
#1417): national `agrupacion_id` is per-election (135 -> 110), 2025's
`lista_numero` is empty for every agrupación (Boleta Única), and PBA
municipal's 22xx family is a scheme unrelated to national ids.
"""

from __future__ import annotations

import csv
import json
import os
import re
import uuid
from pathlib import Path

import psycopg
import pytest
import yaml

from etl.db import load_party_map_rows
from etl.ingest.national import ingest_national
from etl.ingest.pba import ingest_pba
from etl.jurisdiction import make_result_row
from etl.party_map import (
    CanonicalPartyDeclaration,
    DuplicatePartyMappingKeyError,
    PartyMappingEntry,
    PartyMappingTable,
    PartyMapValidationError,
    UnmappedListId,
    load_party_map,
)

# The `curated/party_map.yaml` label PBA municipal lists are curated under.
# It lived in `ingest.pba` as a constant no production code read once
# `resolve_pba_party` was deleted; it is a fact about the curated file, and
# this is the test that asserts what it is for.
PBA_PARTY_MAP_JURISDICTION = "coronel_rosales_municipal"


FIXTURES = Path(__file__).parent / "fixtures"
CURATED = Path(__file__).parent.parent.parent / "curated"


def _load_party_map_table() -> PartyMappingTable:
    return load_party_map(CURATED / "party_map.yaml")


def _canonical_party(
    canonical_id: str = "LLA", display_name: str = "LA LIBERTAD AVANZA"
) -> dict[str, object]:
    return {"id": canonical_id, "display_name": display_name}


def _party_mapping(
    *,
    year: int = 2025,
    list_id: str = "110",
    canonical_party: object = "LLA",
    party_name: object = "ALIANZA LA LIBERTAD AVANZA",
) -> dict[str, object]:
    return {
        "year": year,
        "jurisdiction": "national",
        "category": "DIPUTADO NACIONAL",
        "list_id": list_id,
        "canonical_party": canonical_party,
        "party_name": party_name,
    }


def _write_party_map(path: Path, document: object) -> Path:
    path.write_text(yaml.safe_dump(document, sort_keys=False), encoding="utf-8")
    return path


def _valid_party_map_document() -> dict[str, object]:
    return {
        "canonical_parties": [_canonical_party()],
        "mappings": [_party_mapping()],
    }


@pytest.mark.parametrize(
    ("document", "missing_field"),
    [
        ({}, "canonical_parties"),
        ({"mappings": []}, "canonical_parties"),
        ({"canonical_parties": []}, "mappings"),
    ],
)
def test_party_map_requires_both_top_level_sections(
    tmp_path: Path, document: dict[str, object], missing_field: str
) -> None:
    path = _write_party_map(tmp_path / "party_map.yaml", document)

    with pytest.raises(PartyMapValidationError) as excinfo:
        load_party_map(path)

    message = str(excinfo.value)
    assert missing_field in message
    assert "missing" in message


@pytest.mark.parametrize(
    ("document", "diagnosis"),
    [
        (
            {"canonical_parties": "not-a-list", "mappings": []},
            "canonical_parties must be a list",
        ),
        (
            {"canonical_parties": [], "mappings": "not-a-list"},
            "mappings must be a list",
        ),
        (
            {"canonical_parties": ["not-a-mapping"], "mappings": []},
            "canonical_parties entry 0 must be a mapping",
        ),
        (
            {"canonical_parties": [], "mappings": ["not-a-mapping"]},
            "mappings entry 0 must be a mapping",
        ),
    ],
)
def test_party_map_sections_are_lists_of_mappings(
    tmp_path: Path, document: dict[str, object], diagnosis: str
) -> None:
    path = _write_party_map(tmp_path / "party_map.yaml", document)

    with pytest.raises(PartyMapValidationError) as excinfo:
        load_party_map(path)

    assert diagnosis in str(excinfo.value)


@pytest.mark.parametrize("location", ["top-level", "canonical-party", "mapping"])
def test_party_map_rejects_unknown_fields(tmp_path: Path, location: str) -> None:
    document = _valid_party_map_document()
    if location == "top-level":
        document["unexpected"] = True
    elif location == "canonical-party":
        declarations = document["canonical_parties"]
        assert isinstance(declarations, list)
        declaration = declarations[0]
        assert isinstance(declaration, dict)
        declaration["unexpected"] = True
    else:
        mappings = document["mappings"]
        assert isinstance(mappings, list)
        mapping = mappings[0]
        assert isinstance(mapping, dict)
        mapping["unexpected"] = True
    path = _write_party_map(tmp_path / "party_map.yaml", document)

    with pytest.raises(PartyMapValidationError) as excinfo:
        load_party_map(path)

    message = str(excinfo.value)
    assert "unknown" in message
    assert "unexpected" in message


@pytest.mark.parametrize("field", ["id", "display_name"])
def test_canonical_party_declaration_requires_both_fields(tmp_path: Path, field: str) -> None:
    document = _valid_party_map_document()
    declarations = document["canonical_parties"]
    assert isinstance(declarations, list)
    declaration = declarations[0]
    assert isinstance(declaration, dict)
    del declaration[field]
    path = _write_party_map(tmp_path / "party_map.yaml", document)

    with pytest.raises(PartyMapValidationError) as excinfo:
        load_party_map(path)

    message = str(excinfo.value)
    assert "canonical_parties entry 0" in message
    assert field in message
    assert "missing" in message


@pytest.mark.parametrize(
    ("field", "value", "diagnosis"),
    [
        ("id", None, "must be a non-empty string"),
        ("id", 7, "must be a non-empty string"),
        ("id", "", "must be a non-empty string"),
        ("id", "   ", "must be a non-empty string"),
        ("id", " LLA", "must not have surrounding whitespace"),
        ("id", "LLA ", "must not have surrounding whitespace"),
        ("display_name", None, "must be a non-empty string"),
        ("display_name", 7, "must be a non-empty string"),
        ("display_name", "", "must be a non-empty string"),
        ("display_name", "   ", "must be a non-empty string"),
        ("display_name", " LA LIBERTAD AVANZA", "must not have surrounding whitespace"),
        ("display_name", "LA LIBERTAD AVANZA ", "must not have surrounding whitespace"),
    ],
)
def test_canonical_party_declaration_rejects_invalid_text(
    tmp_path: Path, field: str, value: object, diagnosis: str
) -> None:
    document = _valid_party_map_document()
    declarations = document["canonical_parties"]
    assert isinstance(declarations, list)
    declaration = declarations[0]
    assert isinstance(declaration, dict)
    declaration[field] = value
    path = _write_party_map(tmp_path / "party_map.yaml", document)

    with pytest.raises(PartyMapValidationError) as excinfo:
        load_party_map(path)

    message = str(excinfo.value)
    assert f"canonical_parties entry 0 {field}" in message
    assert diagnosis in message


@pytest.mark.parametrize(
    ("second_display_name", "diagnosis"),
    [
        ("LA LIBERTAD AVANZA", "duplicate canonical party id"),
        ("A DIFFERENT LABEL", "conflicting canonical party declaration"),
    ],
)
def test_canonical_party_declaration_rejects_duplicate_ids(
    tmp_path: Path, second_display_name: str, diagnosis: str
) -> None:
    document = _valid_party_map_document()
    document["canonical_parties"] = [
        _canonical_party(),
        _canonical_party(display_name=second_display_name),
    ]
    path = _write_party_map(tmp_path / "party_map.yaml", document)

    with pytest.raises(PartyMapValidationError) as excinfo:
        load_party_map(path)

    message = str(excinfo.value)
    assert diagnosis in message
    assert "LLA" in message


def test_party_mapping_must_reference_a_declared_canonical_party(tmp_path: Path) -> None:
    document = _valid_party_map_document()
    document["mappings"] = [_party_mapping(canonical_party="UNDECLARED")]
    path = _write_party_map(tmp_path / "party_map.yaml", document)

    with pytest.raises(PartyMapValidationError) as excinfo:
        load_party_map(path)

    message = str(excinfo.value)
    assert "mappings entry 0 canonical_party" in message
    assert "UNDECLARED" in message
    assert "not declared" in message


def test_every_canonical_party_declaration_must_be_used(tmp_path: Path) -> None:
    document = _valid_party_map_document()
    document["canonical_parties"] = [
        _canonical_party(),
        _canonical_party("UNUSED", "UNUSED PARTY"),
    ]
    path = _write_party_map(tmp_path / "party_map.yaml", document)

    with pytest.raises(PartyMapValidationError) as excinfo:
        load_party_map(path)

    message = str(excinfo.value)
    assert "canonical party declaration" in message
    assert "UNUSED" in message
    assert "not used" in message


_MISSING_PARTY_MAPPING_FIELD = object()


@pytest.mark.parametrize(
    ("field", "value", "diagnosis"),
    [
        ("jurisdiction", " national", "jurisdiction must not have surrounding whitespace"),
        ("jurisdiction", "national ", "jurisdiction must not have surrounding whitespace"),
        ("category", " DIPUTADO NACIONAL", "category must not have surrounding whitespace"),
        ("category", "DIPUTADO NACIONAL ", "category must not have surrounding whitespace"),
        ("list_id", " 110", "list_id must not have surrounding whitespace"),
        ("list_id", "110 ", "list_id must not have surrounding whitespace"),
        ("canonical_party", _MISSING_PARTY_MAPPING_FIELD, "missing canonical_party"),
        ("canonical_party", None, "canonical_party must be a non-empty string"),
        ("canonical_party", "", "canonical_party must be a non-empty string"),
        ("canonical_party", "   ", "canonical_party must be a non-empty string"),
        ("canonical_party", " LLA", "canonical_party must not have surrounding whitespace"),
        ("canonical_party", "LLA ", "canonical_party must not have surrounding whitespace"),
        ("party_name", _MISSING_PARTY_MAPPING_FIELD, "missing party_name"),
        ("party_name", None, "party_name must be a non-empty string"),
        ("party_name", "", "party_name must be a non-empty string"),
        ("party_name", "   ", "party_name must be a non-empty string"),
        ("party_name", " SOURCE", "party_name must not have surrounding whitespace"),
        ("party_name", "SOURCE ", "party_name must not have surrounding whitespace"),
    ],
)
def test_party_mapping_rejects_invalid_identity_text(
    tmp_path: Path, field: str, value: object, diagnosis: str
) -> None:
    mapping = _party_mapping()
    if value is _MISSING_PARTY_MAPPING_FIELD:
        del mapping[field]
    else:
        mapping[field] = value
    document = {
        "canonical_parties": [_canonical_party()],
        "mappings": [mapping],
    }
    path = _write_party_map(tmp_path / "party_map.yaml", document)

    with pytest.raises(PartyMapValidationError) as excinfo:
        load_party_map(path)

    assert diagnosis in str(excinfo.value)


def test_explicit_empty_party_map_is_an_intentional_replacement_snapshot(tmp_path: Path) -> None:
    path = _write_party_map(
        tmp_path / "party_map.yaml",
        {"canonical_parties": [], "mappings": []},
    )

    table = load_party_map(path)

    assert table.canonical_parties == ()
    assert table.entries == ()


def test_mapping_reorder_cannot_choose_the_canonical_display_name(tmp_path: Path) -> None:
    declarations = [_canonical_party()]
    mappings = [
        _party_mapping(year=2023, list_id="135", party_name="LA LIBERTAD AVANZA"),
        _party_mapping(year=2025, list_id="110", party_name="ALIANZA LA LIBERTAD AVANZA"),
    ]
    first_path = _write_party_map(
        tmp_path / "first.yaml",
        {"canonical_parties": declarations, "mappings": mappings},
    )
    reversed_path = _write_party_map(
        tmp_path / "reversed.yaml",
        {"canonical_parties": declarations, "mappings": list(reversed(mappings))},
    )

    first = load_party_map(first_path)
    reversed_table = load_party_map(reversed_path)

    assert first.canonical_parties == reversed_table.canonical_parties
    assert tuple(entry.party_name for entry in first.entries) == (
        "LA LIBERTAD AVANZA",
        "ALIANZA LA LIBERTAD AVANZA",
    )
    assert tuple(entry.party_name for entry in reversed_table.entries) == (
        "ALIANZA LA LIBERTAD AVANZA",
        "LA LIBERTAD AVANZA",
    )


def test_party_map_loader_reports_database_deletion_counts_for_replacement_snapshots() -> None:
    class Cursor:
        rowcount = -1

        def __init__(self, deletion_counts: dict[str, int]) -> None:
            self.deletion_counts = deletion_counts

        def __enter__(self) -> Cursor:
            return self

        def __exit__(self, _exc_type: object, _exc: object, _traceback: object) -> None:
            return None

        def execute(self, query: object, _params: object | None = None) -> None:
            statement = str(query)
            self.rowcount = 1
            for table_name, deleted in self.deletion_counts.items():
                if f"delete from {table_name}" in statement:
                    self.rowcount = deleted
                    return

    class Connection:
        def __init__(self, deletion_counts: dict[str, int]) -> None:
            self._cursor = Cursor(deletion_counts)

        def cursor(self) -> Cursor:
            return self._cursor

    entry = PartyMappingEntry(
        year=2025,
        jurisdiction="replacement-test",
        category="TEST",
        list_id="1",
        canonical_party="replacement-party",
        party_name="Replacement Party",
    )
    declaration = CanonicalPartyDeclaration(
        id=entry.canonical_party, display_name="Replacement Party"
    )
    cases = (
        (
            PartyMappingTable(canonical_parties=(declaration,), entries=(entry,)),
            {"party_canonical": 7, "list_identity": 5, "party_mapping": 3},
            1,
        ),
        (
            PartyMappingTable(canonical_parties=(), entries=()),
            {"party_canonical": 17, "list_identity": 13, "party_mapping": 11},
            0,
        ),
    )

    for table, deletion_counts, loaded in cases:
        result = load_party_map_rows(Connection(deletion_counts), table)

        assert result.party_canonical.loaded == loaded
        assert result.party_canonical.deleted == deletion_counts["party_canonical"]
        assert result.list_identity.loaded == loaded
        assert result.list_identity.deleted == deletion_counts["list_identity"]
        assert result.party_mapping.loaded == loaded
        assert result.party_mapping.deleted == deletion_counts["party_mapping"]
        for table_name, count in (
            ("party_canonical", result.party_canonical),
            ("list_identity", result.list_identity),
            ("party_mapping", result.party_mapping),
        ):
            assert count.deleted_by_reason == {
                "absent_from_desired_projection": deletion_counts[table_name]
            }


def test_party_map_loader_replaces_the_curated_projection_and_empty_input_clears_it() -> None:
    dsn = os.environ.get(
        "ETL_TEST_DATABASE_URL", "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
    )
    try:
        conn = psycopg.connect(dsn, connect_timeout=2)
    except psycopg.OperationalError as exc:
        pytest.skip(f"no ephemeral Postgres reachable at {dsn!r}: {exc}")

    token = uuid.uuid4().hex
    desired = PartyMappingEntry(
        year=2025,
        jurisdiction=f"desired-{token}",
        category="TEST",
        list_id="1",
        canonical_party=f"desired-party-{token}",
        party_name="Desired Party",
    )
    stale = PartyMappingEntry(
        year=2023,
        jurisdiction=f"stale-{token}",
        category="TEST",
        list_id="2",
        canonical_party=f"stale-party-{token}",
        party_name="Stale Party",
    )
    desired_declaration = CanonicalPartyDeclaration(
        id=desired.canonical_party, display_name="Desired Party"
    )
    stale_declaration = CanonicalPartyDeclaration(
        id=stale.canonical_party, display_name="Stale Party"
    )

    try:
        load_party_map_rows(
            conn,
            PartyMappingTable(
                canonical_parties=(desired_declaration, stale_declaration),
                entries=(desired, stale),
            ),
        )
        with conn.cursor() as cur:
            cur.execute("select count(*) from archive_entry")
            archive_count = cur.fetchone()
            cur.execute("select count(*) from election")
            election_count = cur.fetchone()
            cur.execute("select count(*) from result_row")
            result_count = cur.fetchone()

        replacement = load_party_map_rows(
            conn,
            PartyMappingTable(canonical_parties=(desired_declaration,), entries=(desired,)),
        )
        assert replacement.party_canonical.loaded == 1
        assert replacement.party_canonical.deleted == 1
        assert replacement.list_identity.loaded == 1
        assert replacement.list_identity.deleted == 1
        assert replacement.party_mapping.loaded == 1
        assert replacement.party_mapping.deleted == 1
        for count in (
            replacement.party_canonical,
            replacement.list_identity,
            replacement.party_mapping,
        ):
            assert count.deleted_by_reason == {"absent_from_desired_projection": 1}
        with conn.cursor() as cur:
            cur.execute(
                "select jurisdiction, list_id from party_mapping order by jurisdiction, list_id"
            )
            assert cur.fetchall() == [(desired.jurisdiction, desired.list_id)]
            cur.execute(
                "select jurisdiction, list_id from list_identity order by jurisdiction, list_id"
            )
            assert cur.fetchall() == [(desired.jurisdiction, desired.list_id)]
            cur.execute("select id from party_canonical order by id")
            assert cur.fetchall() == [(desired.canonical_party,)]

        empty = load_party_map_rows(conn, PartyMappingTable(canonical_parties=(), entries=()))
        assert empty.party_canonical.loaded == 0
        assert empty.party_canonical.deleted == 1
        assert empty.list_identity.loaded == 0
        assert empty.list_identity.deleted == 1
        assert empty.party_mapping.loaded == 0
        assert empty.party_mapping.deleted == 1
        for count in (empty.party_canonical, empty.list_identity, empty.party_mapping):
            assert count.deleted_by_reason == {"absent_from_desired_projection": 1}
        with conn.cursor() as cur:
            for table_name in ("party_mapping", "list_identity", "party_canonical"):
                cur.execute(f"select count(*) from {table_name}")
                assert cur.fetchone() == (0,)
            cur.execute("select count(*) from archive_entry")
            assert cur.fetchone() == archive_count
            cur.execute("select count(*) from election")
            assert cur.fetchone() == election_count
            cur.execute("select count(*) from result_row")
            assert cur.fetchone() == result_count
    finally:
        conn.rollback()
        conn.close()


@pytest.mark.parametrize(
    "content",
    [
        "- not-a-mapping\n",
        "canonical_parties: []\nmappings: not-a-list\n",
        "canonical_parties: []\nmappings:\n  - not-a-mapping\n",
    ],
)
def test_party_map_loader_rejects_invalid_yaml_shapes(tmp_path: Path, content: str) -> None:
    path = tmp_path / "party_map.yaml"
    path.write_text(content, encoding="utf-8")

    with pytest.raises(PartyMapValidationError, match="party_map.yaml"):
        load_party_map(path)


@pytest.mark.parametrize(
    ("field", "value", "message"),
    [
        ("year", True, "year must be an integer"),
        ("year", "2025", "year must be an integer"),
        ("jurisdiction", 1, "jurisdiction must be a non-empty string"),
        ("category", "", "category must be a non-empty string"),
        ("list_id", False, "list_id must be a non-empty string"),
        ("canonical_party", None, "canonical_party must be a non-empty string"),
        ("party_name", [], "party_name must be a non-empty string"),
        ("source", 1, "source must be a string or null"),
        ("verified", "false", "verified must be a boolean"),
    ],
)
def test_party_map_loader_rejects_wrong_field_types(
    tmp_path: Path, field: str, value: object, message: str
) -> None:
    entry = {
        "year": 2025,
        "jurisdiction": "national",
        "category": "DIPUTADO NACIONAL",
        "list_id": "110",
        "canonical_party": "LLA",
        "party_name": "LA LIBERTAD AVANZA",
        field: value,
    }
    path = tmp_path / "party_map.yaml"
    path.write_text(
        yaml.safe_dump({"canonical_parties": [_canonical_party()], "mappings": [entry]}),
        encoding="utf-8",
    )

    with pytest.raises(PartyMapValidationError, match=message):
        load_party_map(path)


def test_party_map_loader_preserves_explicit_false_and_nullable_source(tmp_path: Path) -> None:
    entry = {
        "year": 2025,
        "jurisdiction": "national",
        "category": "DIPUTADO NACIONAL",
        "list_id": "110",
        "canonical_party": "LLA",
        "party_name": "LA LIBERTAD AVANZA",
        "source": None,
        "verified": False,
    }
    path = tmp_path / "party_map.yaml"
    path.write_text(
        yaml.safe_dump({"canonical_parties": [_canonical_party()], "mappings": [entry]}),
        encoding="utf-8",
    )

    loaded = load_party_map(path).entries[0]

    assert loaded.source is None
    assert loaded.verified is False


def test_party_map_loader_rejects_duplicate_natural_key(tmp_path: Path) -> None:
    entry = {
        "year": 2025,
        "jurisdiction": "national",
        "category": "DIPUTADO NACIONAL",
        "list_id": "110",
        "canonical_party": "LLA",
        "party_name": "LA LIBERTAD AVANZA",
    }
    path = tmp_path / "party_map.yaml"
    path.write_text(
        yaml.safe_dump(
            {
                "canonical_parties": [
                    _canonical_party(),
                    _canonical_party("OTHER", "OTHER PARTY"),
                ],
                "mappings": [entry, {**entry, "canonical_party": "OTHER"}],
            }
        ),
        encoding="utf-8",
    )

    with pytest.raises(DuplicatePartyMappingKeyError, match="duplicate"):
        load_party_map(path)


# --- 7.1 -------------------------------------------------------------------


def test_lla_solo_list_135_mapped_2023_municipal() -> None:
    """VERIFIED against the primary 2023 municipal escrutinio document (not
    borrowed from the national scheme): LLA ran solo as list 135 in the
    2023 Coronel Rosales municipal (Concejales) race."""
    table = _load_party_map_table()

    resolved = table.resolve(
        year=2023, jurisdiction="coronel_rosales_municipal", category="CONCEJALES", list_id="135"
    )

    assert isinstance(resolved, PartyMappingEntry)
    assert resolved.canonical_party == "LLA"
    assert resolved.party_name == "LA LIBERTAD AVANZA"


# --- 7.2 -------------------------------------------------------------------


def test_lla_pro_alliance_distinct_from_2023_lla() -> None:
    """The 2025 "Alianza La Libertad Avanza" (LLA+PRO) is a DISTINCT
    canonical party from the 2023 solo LLA list, even though both trace to
    the same real-world lineage -- the spec's "LLA+PRO alliance mapped
    separately for 2025" scenario."""
    table = _load_party_map_table()

    lla_2023 = table.resolve(
        year=2023, jurisdiction="coronel_rosales_municipal", category="CONCEJALES", list_id="135"
    )
    lla_pro_2025 = table.resolve(
        year=2025, jurisdiction="coronel_rosales_municipal", category="CONCEJALES", list_id="2206"
    )

    assert isinstance(lla_2023, PartyMappingEntry)
    assert isinstance(lla_pro_2025, PartyMappingEntry)
    assert lla_2023.canonical_party == "LLA"
    assert lla_pro_2025.canonical_party == "LLA_PRO_ALLIANCE"
    assert lla_2023.canonical_party != lla_pro_2025.canonical_party


# --- 7.3 -------------------------------------------------------------------


def test_local_only_list_962_mapped_without_national_counterpart() -> None:
    """List 962 (AGRUPACION MUNICIPAL PRIMERO ROSALES) exists only in the
    2023 Coronel Rosales municipal category and has no national or
    provincial counterpart -- "Local-only lists are representable"."""
    table = _load_party_map_table()

    local_entry = table.resolve(
        year=2023, jurisdiction="coronel_rosales_municipal", category="CONCEJALES", list_id="962"
    )
    national_lookup = table.resolve(
        year=2023, jurisdiction="national", category="DIPUTADO NACIONAL", list_id="962"
    )

    assert isinstance(local_entry, PartyMappingEntry)
    assert local_entry.canonical_party == "PRIMERO_ROSALES"
    assert isinstance(national_lookup, UnmappedListId)


# --- 7.4 -------------------------------------------------------------------


def test_an_unmapped_list_id_is_refused_by_name_and_year_not_silently_matched() -> None:
    """The name is the specification, and this one used to promise a rollup
    exclusion the body never drove: it built a `ResultRow`, never rolled
    anything up, and asserted only on `resolve`. What it actually pins --
    and what matters -- is that an uncurated list id comes back as
    `UnmappedListId` naming the id and the year, never silently matched to
    a party that happens to share the number in another year.
    """
    table = _load_party_map_table()
    result = make_result_row(
        granularity="mesa",
        distrito="02",
        seccion="027",
        circuito="1",
        mesa=1,
        category="DIPUTADO NACIONAL",
        list_id="701",
        votes=10,
    )

    # `PartyMappingTable.resolve` is the live entry point -- the row-batch
    # wrapper this used to call fed the `is_unmapped` column, which never had
    # a production writer and is gone (migration 0014).
    resolved = table.resolve(
        year=2025,
        jurisdiction="national",
        category=result.category,
        list_id=result.list_id or "",
    )

    assert isinstance(resolved, UnmappedListId)
    assert "701" in resolved.reason
    assert "2025" in resolved.reason


# --- 7.5 -------------------------------------------------------------------


def test_unmapped_row_never_falls_back_to_different_year_or_jurisdiction() -> None:
    """List 135 IS mapped for (2023, national, ...), but a 2025 national row
    referencing the same raw list_id value MUST NOT fall back to that 2023
    entry -- the exact key must match, or the row is unmapped."""
    table = _load_party_map_table()

    still_2023 = table.resolve(
        year=2023, jurisdiction="national", category="DIPUTADO NACIONAL", list_id="135"
    )
    wrong_year = table.resolve(
        year=2025, jurisdiction="national", category="DIPUTADO NACIONAL", list_id="135"
    )
    wrong_jurisdiction = table.resolve(
        year=2023,
        jurisdiction="coronel_rosales_municipal",
        # The id that IS curated for 2023/national/DIPUTADO NACIONAL. Using an
        # id curated nowhere returned `UnmappedListId` whether or not a
        # jurisdiction fallback existed, so the half of this test's name about
        # jurisdiction was driven by nothing -- the year half already reuses
        # its mapped id for exactly this reason.
        category="DIPUTADO NACIONAL",
        list_id="135",
    )

    assert isinstance(still_2023, PartyMappingEntry)
    assert still_2023.canonical_party == "LLA"
    assert isinstance(wrong_year, UnmappedListId)
    assert isinstance(wrong_jurisdiction, UnmappedListId)


# --- 7.6a --------------------------------------------------------------


def test_agrupacion_id_is_not_a_cross_year_party_key() -> None:
    """LLA's national `agrupacion_id` CHANGED 135 (2023) -> 110 (2025).
    Resolution goes through the full key, never `agrupacion_id` alone:
    2023's 135 and 2025's 135 are NOT the same lookup -- a stale key with
    the right list id but the wrong year still fails, even though 2025's
    real LLA identifier (110) resolves via its OWN correct key. (Phase 15,
    task 15.3: 2025's national list 110 is now RECONCILED to the SAME
    canonical party as 2023's 135/20135 -- the point is the lookup is
    exact-key-only, not that the parties must differ.)"""
    table = _load_party_map_table()

    lla_2023 = table.resolve(
        year=2023, jurisdiction="national", category="DIPUTADO NACIONAL", list_id="135"
    )
    stale_135_in_2025 = table.resolve(
        year=2025, jurisdiction="national", category="DIPUTADO NACIONAL", list_id="135"
    )
    lla_2025 = table.resolve(
        year=2025, jurisdiction="national", category="DIPUTADO NACIONAL", list_id="110"
    )

    assert isinstance(lla_2023, PartyMappingEntry) and lla_2023.canonical_party == "LLA"
    assert isinstance(stale_135_in_2025, UnmappedListId)
    assert isinstance(lla_2025, PartyMappingEntry)
    assert lla_2025.canonical_party == "LLA"


# --- 7.6b --------------------------------------------------------------


def test_empty_lista_numero_in_2025_is_not_treated_as_missing_data() -> None:
    """`lista_numero` is empty for every agrupación in the real 2025 source
    (Boleta Única) -- resolution MUST succeed using only `list_id`
    (agrupacion_id), never requiring `lista_numero`. Exercised against the
    REAL 2025 distrito-027 fixture, whose `lista_numero` column is
    genuinely empty end to end, not synthesized for this test."""
    fixture_path = FIXTURES / "national_2025_027_diputados_sample.csv"
    with fixture_path.open(encoding="utf-8", newline="") as source:
        positive_rows = [row for row in csv.DictReader(source) if row["votos_tipo"] == "POSITIVO"]
    assert positive_rows, "fixture must retain primary-source positive rows"
    assert {row["lista_numero"] for row in positive_rows} == {""}

    csv_bytes = fixture_path.read_bytes()
    rows = ingest_national(
        csv_bytes,
        archive_entry_id="national-2025-diputados-027",
        election_year=2025,
        election_round="legislativas",
    )
    lla_rows = [row for row in rows if row.list_id == "110"]
    assert lla_rows, "fixture must contain at least one agrupacion_id=110 (LLA) row"
    table = _load_party_map_table()

    for row in lla_rows:
        resolved = table.resolve(
            year=2025, jurisdiction="national", category=row.category, list_id=row.list_id or ""
        )
        assert not isinstance(resolved, UnmappedListId)
        assert resolved.canonical_party == "LLA"


# --- 7.6c --------------------------------------------------------------


def test_pba_municipal_scheme_never_resolved_against_national_ids() -> None:
    """PBA municipal's 22xx list family is unrelated to either national
    scheme. Cross-scheme resolution MUST fail loudly (unmapped), never
    silently match a numerically similar or coincidentally equal id from
    the other scheme."""
    table = _load_party_map_table()

    national_id_under_municipal = table.resolve(
        year=2025, jurisdiction=PBA_PARTY_MAP_JURISDICTION, category="CONCEJALES", list_id="110"
    )
    municipal_id_under_national = table.resolve(
        year=2025, jurisdiction="national", category="DIPUTADO NACIONAL", list_id="2206"
    )

    assert isinstance(national_id_under_municipal, UnmappedListId)
    assert isinstance(municipal_id_under_national, UnmappedListId)

    # A PBA row's own category and list id, resolved under the PBA
    # jurisdiction label: never silently retried under "national" as a
    # fallback, which is what would make the 22xx family collide with the
    # numerically similar national agrupación ids.
    municipal_row = make_result_row(
        granularity="distrito", distrito="027", category="CONCEJALES", list_id="110", votes=1
    )
    assert isinstance(
        table.resolve(
            year=2025,
            jurisdiction=PBA_PARTY_MAP_JURISDICTION,
            category=municipal_row.category,
            list_id=municipal_row.list_id or "",
        ),
        UnmappedListId,
    )


# --- regression: the real curated file loads and resolves ------------------


def test_national_2023_president_primary_source_identities_are_curated_exactly() -> None:
    with (FIXTURES / "national_2023_president_party_ids.csv").open(
        encoding="utf-8", newline=""
    ) as fixture:
        fixture_rows = list(csv.DictReader(fixture))
    expected_rows = [
        {
            "source_id": "national/2023-generales",
            "archive_sha256": "2562b18c741ba5740d264e5328f206cb25f709ed0a4f8cf962f301e423e79c6b",
            "round": "generales",
            "category": "PRESIDENTE Y VICE",
            "list_id": list_id,
            "party_name": party_name,
            "lista_numero": "",
        }
        for list_id, party_name in (
            ("132", "JUNTOS POR EL CAMBIO"),
            ("133", "HACEMOS POR NUESTRO PAIS"),
            ("134", "UNION POR LA PATRIA"),
            ("135", "LA LIBERTAD AVANZA"),
            ("136", "FRENTE DE IZQUIERDA Y DE TRABAJADORES - UNIDAD"),
        )
    ] + [
        {
            "source_id": "national/2023-balotaje",
            "archive_sha256": "6d63298575984a9639cc51ed3fb60def789ceab0a4ae9b1b1003571f2b4fa530",
            "round": "balotaje",
            "category": "PRESIDENTE Y VICE",
            "list_id": list_id,
            "party_name": party_name,
            "lista_numero": "",
        }
        for list_id, party_name in (
            ("134", "UNION POR LA PATRIA"),
            ("135", "LA LIBERTAD AVANZA"),
        )
    ]
    assert fixture_rows == expected_rows

    manifest = json.loads((CURATED.parent / "archive-manifest.json").read_text(encoding="utf-8"))
    manifest_sha_by_id = {entry["id"]: entry["sha256"] for entry in manifest}
    expected_archives = {
        "national/2023-generales": (
            "2562b18c741ba5740d264e5328f206cb25f709ed0a4f8cf962f301e423e79c6b"
        ),
        "national/2023-balotaje": (
            "6d63298575984a9639cc51ed3fb60def789ceab0a4ae9b1b1003571f2b4fa530"
        ),
    }
    assert {source_id: manifest_sha_by_id[source_id] for source_id in expected_archives} == (
        expected_archives
    )
    assert {(row["source_id"], row["archive_sha256"]) for row in fixture_rows} == set(
        expected_archives.items()
    )

    table = _load_party_map_table()
    expected_canonical_party = {
        "132": "JXC",
        "133": "HXNP",
        "134": "UP",
        "135": "LLA",
        "136": "FIT",
    }
    source_archive_by_round = {
        "generales": "2023-generales.zip",
        "balotaje": "2023-balotaje.zip",
    }
    for row in fixture_rows:
        resolved = table.resolve(
            year=2023,
            jurisdiction="national",
            category=row["category"],
            list_id=row["list_id"],
        )
        assert isinstance(resolved, PartyMappingEntry)
        assert resolved.party_name == row["party_name"]
        assert resolved.canonical_party == expected_canonical_party[row["list_id"]]
        assert source_archive_by_round[row["round"]] in (resolved.source or "")


def test_real_curated_party_map_declares_all_public_canonical_labels() -> None:
    table = _load_party_map_table()

    assert len(table.entries) == 53
    labels = {declaration.id: declaration.display_name for declaration in table.canonical_parties}
    assert labels == {
        "JXC": "JUNTOS POR EL CAMBIO",
        "HXNP": "HACEMOS POR NUESTRO PAIS",
        "UP": "UNION POR LA PATRIA",
        "LLA": "LA LIBERTAD AVANZA",
        "FIT": "FRENTE DE IZQUIERDA",
        "PRIMERO_ROSALES": "AGRUPACION MUNICIPAL PRIMERO ROSALES",
        "FRENTE_PATRIOTA_FEDERAL": "FRENTE PATRIOTA FEDERAL",
        "FUERZA_PATRIA": "ALIANZA FUERZA PATRIA",
        "NUEVO_BUENOS_AIRES": "PARTIDO NUEVO BUENOS AIRES",
        "LIBER_AR": "LIBER.AR",
        "PROPUESTA_FEDERAL": "PROPUESTA FEDERAL PARA EL CAMBIO",
        "PROVINCIAS_UNIDAS": "ALIANZA PROVINCIAS UNIDAS",
        "POTENCIA": "ALIANZA POTENCIA",
        "NUEVOS_AIRES": "ALIANZA NUEVOS AIRES",
        "MOVIMIENTO_SOCIALISTA": "MOVIMIENTO AVANZADA SOCIALISTA",
        "PROYECTO_SUR": "MOVIMIENTO POLITICO SOCIAL Y CULTURAL PROYECTO SUR",
        "UNION_LIBERAL": "UNION LIBERAL",
        "COALICION_CIVICA": "COALICION CIVICA - A.R.I.",
        "UNION_FEDERAL": "ALIANZA UNION FEDERAL",
        "LLA_PRO_ALLIANCE": "ALIANZA LA LIBERTAD AVANZA",
        "UNION_Y_LIBERTAD": "ALIANZA UNION Y LIBERTAD",
        "SOMOS_BUENOS_AIRES": "ALIANZA SOMOS BUENOS AIRES",
        "ES_CON_VOS": "ALIANZA ES CON VOS ES CON NOSOTROS",
        "PARTIDO_LIBERTARIO": "PARTIDO LIBERTARIO",
        "CONSTRUYENDO_PORVENIR": "CONSTRUYENDO PORVENIR",
        "VALORES_REPUBLICANOS": "VALORES REPUBLICANOS",
        "POLITICA_OBRERA": "PARTIDO POLITICA OBRERA",
        "TIEMPO_DE_TODOS": "PARTIDO TIEMPO DE TODOS",
    }


def test_real_curated_party_map_has_exact_primary_source_category_coverage() -> None:
    table = _load_party_map_table()

    grouped = {
        (entry.year, entry.jurisdiction, entry.category, entry.list_id): entry
        for entry in table.entries
    }
    assert len(grouped) == len(table.entries)

    def category_entries(jurisdiction: str, category: str) -> dict[str, PartyMappingEntry]:
        return {
            entry.list_id: entry
            for entry in table.entries
            if entry.year == 2025
            and entry.jurisdiction == jurisdiction
            and entry.category == category
        }

    presidente = {
        entry.list_id: entry
        for entry in table.entries
        if entry.year == 2023
        and entry.jurisdiction == "national"
        and entry.category == "PRESIDENTE Y VICE"
    }
    assert {list_id: entry.canonical_party for list_id, entry in presidente.items()} == {
        "132": "JXC",
        "133": "HXNP",
        "134": "UP",
        "135": "LLA",
        "136": "FIT",
    }
    balotaje_lists = {
        list_id for list_id, entry in presidente.items() if "balotaje" in (entry.source or "")
    }
    assert balotaje_lists == {"134", "135"}

    pba_source = (FIXTURES / "pba_distrito_027_2025_sample.html").read_bytes()
    pba_rows = ingest_pba(
        pba_source,
        archive_entry_id="pba/2025-distrito-027",
        requested_granularity="distrito",
    ).rows
    source_ids_by_category: dict[str, set[str]] = {}
    for row in pba_rows:
        source_ids_by_category.setdefault(row.category, set()).add(row.list_id or "")
    source_names = dict(
        re.findall(
            r"<tr><td>(\d+)</td><td>([^<]+)</td>",
            pba_source.decode("utf-8"),
        )
    )

    concejales = category_entries("coronel_rosales_municipal", "CONCEJALES")
    assert set(concejales) == source_ids_by_category["CONCEJALES"]
    assert {list_id: entry.canonical_party for list_id, entry in concejales.items()} == {
        "2206": "LLA_PRO_ALLIANCE",
        "2200": "FUERZA_PATRIA",
        "2201": "POTENCIA",
        "2207": "UNION_Y_LIBERTAD",
        "2204": "SOMOS_BUENOS_AIRES",
        "962": "PRIMERO_ROSALES",
        "2203": "FIT",
        "2202": "ES_CON_VOS",
    }
    assert {list_id: entry.party_name for list_id, entry in concejales.items()} == {
        list_id: source_names[list_id] for list_id in source_ids_by_category["CONCEJALES"]
    }

    diputados = category_entries("pba_provincial", "DIPUTADOS PROVINCIALES")
    assert set(diputados) == source_ids_by_category["DIPUTADOS PROVINCIALES"]
    assert {list_id: entry.canonical_party for list_id, entry in diputados.items()} == {
        "2206": "LLA_PRO_ALLIANCE",
        "2200": "FUERZA_PATRIA",
        "2201": "POTENCIA",
        "2207": "UNION_Y_LIBERTAD",
        "2204": "SOMOS_BUENOS_AIRES",
        "2203": "FIT",
        "2202": "ES_CON_VOS",
        "1006": "PARTIDO_LIBERTARIO",
        "1003": "CONSTRUYENDO_PORVENIR",
        "1008": "VALORES_REPUBLICANOS",
        "2208": "UNION_LIBERAL",
        "959": "MOVIMIENTO_SOCIALISTA",
        "963": "FRENTE_PATRIOTA_FEDERAL",
        "974": "POLITICA_OBRERA",
        "980": "TIEMPO_DE_TODOS",
    }
    assert {list_id: entry.party_name for list_id, entry in diputados.items()} == {
        list_id: source_names[list_id]
        for list_id in source_ids_by_category["DIPUTADOS PROVINCIALES"]
    }


@pytest.mark.parametrize(
    ("year", "jurisdiction", "category", "list_id", "expected_party"),
    [
        (2023, "national", "DIPUTADO NACIONAL", "135", "LLA"),
        (2023, "national", "DIPUTADO NACIONAL", "20135", "LLA"),
        (2025, "national", "DIPUTADO NACIONAL", "110", "LLA"),
        (2025, "coronel_rosales_municipal", "CONCEJALES", "2206", "LLA_PRO_ALLIANCE"),
        (2023, "coronel_rosales_municipal", "CONCEJALES", "962", "PRIMERO_ROSALES"),
    ],
)
def test_real_curated_party_map_resolves_seeded_entries(
    year: int, jurisdiction: str, category: str, list_id: str, expected_party: str
) -> None:
    table = _load_party_map_table()
    resolved = table.resolve(
        year=year, jurisdiction=jurisdiction, category=category, list_id=list_id
    )
    assert isinstance(resolved, PartyMappingEntry)
    assert resolved.canonical_party == expected_party
