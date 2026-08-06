"""Tests for `etl.party_map` (party-identity-mapping spec, Phase 7).

Covers the curated `(year, jurisdiction, category, list_id)` mapping key
and the three measured facts that make `list_id` alone unsafe (Engram
#1417): national `agrupacion_id` is per-election (135 -> 110), 2025's
`lista_numero` is empty for every agrupación (Boleta Única), and PBA
municipal's 22xx family is a scheme unrelated to national ids.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from etl.ingest.national import ingest_national
from etl.jurisdiction import make_result_row
from etl.party_map import (
    PartyMappingEntry,
    PartyMappingTable,
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
    csv_bytes = (FIXTURES / "national_2025_027_diputados_sample.csv").read_bytes()
    rows = ingest_national(csv_bytes, archive_entry_id="national-2025-diputados-027")
    lla_rows = [row for row in rows if row.list_id == "110"]
    assert lla_rows, "fixture must contain at least one agrupacion_id=110 (LLA) row"
    # The fixture's `lista_numero` column is empty for agrupacion_id 110 --
    # `NationalRow` never even carries a `lista_numero` field, which is the
    # point: nothing downstream can depend on a column that does not exist.
    assert not hasattr(lla_rows[0], "lista_numero")

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
