"""RED tests for internal LLA fiscalización spreadsheet ingestion
(`electoral-ingestion` spec, fiscalización subset; design D9.4's ordered
contract; D9.3's personal-data strip).

Two kinds of test data are used, deliberately:

- `fixtures/fiscalizacion_2025_full_sample.csv` is the REAL Coronel Rosales
  105-row spreadsheet with `Nombre`/`Apellido` already removed before
  commit (D9.3) -- used for the full-convergence assertion (6.14) and the
  "committed fixture has no name columns" threat test (6.8). It sits
  ALONGSIDE Phase 4's `fiscalizacion_2025_stripped_sample.csv` (a smaller
  4-row excerpt already committed for the crosswalk-join tests) rather than
  extending that file in place -- Phase 4's tests parse every vote cell as
  a plain `int` and have no wrapped-continuation or blank-cell handling, so
  growing that file to the full sheet (which has both) would silently break
  already-green Phase 4 tests.
- Every other test below builds a small SYNTHETIC CSV snippet inline, with
  invented placeholder names (never a real surname from the source sheet)
  when a test specifically needs a `Nombre`/`Apellido` column to prove
  stripping actually happens. This keeps the only committed CSV fixture
  100% personal-data-free while still exercising the strip step for real.
"""

from __future__ import annotations

import csv
import os
import uuid
from pathlib import Path

import psycopg
import pytest
import yaml

from etl.crosswalk import FISCALIZACION_VOTE_COLUMNS
from etl.ingest.fiscalizacion import (
    FiscalizacionRow,
    FiscalizacionUploadForbiddenError,
    _merge_wrapped_rows,
    classify_reexport_drift,
    guard_local_mirror_only,
    ingest_fiscalizacion,
    load_fiscalizacion_rows,
    strip_personal_columns,
)
from etl.party_map import load_party_map

FIXTURES = Path(__file__).parent / "fixtures"
REPO_ROOT = Path(__file__).parent.parent.parent
VOTE_HEADER = ",".join(FISCALIZACION_VOTE_COLUMNS)
PARTY_MAP_PATH = REPO_ROOT / "curated" / "party_map.yaml"

TEST_DSN = os.environ.get(
    "ETL_TEST_DATABASE_URL", "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
)


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
        conn.rollback()
        conn.close()


def _real_fixture_text() -> str:
    return (FIXTURES / "fiscalizacion_2025_full_sample.csv").read_text(encoding="utf-8")


def _synthetic_csv(rows: list[str], *, with_names: bool = False) -> str:
    header = "Escuela,Mesa," + VOTE_HEADER
    if with_names:
        header = "Nombre,Apellido," + header
    return "\n".join([header, *rows]) + "\n"


# ---------------------------------------------------------------------------
# 6.2 — wrapped continuation row merged, not quarantined
# ---------------------------------------------------------------------------


def test_wrapped_continuation_row_merged_not_quarantined() -> None:
    # Mirrors the real shape (Engram #1389): the parent row leaves its last
    # six vote columns blank; the continuation row (empty Mesa) carries
    # exactly those six.
    parent = "ESCUELA TEST N1,Mesa 13,116,3,0,7,0,0,60,3,2,5,13,,,,,,"
    continuation = "ESCUELA TEST N1,,,,,,,,,,,,,12,0,0,1,3,0"
    result = ingest_fiscalizacion(
        _synthetic_csv([parent, continuation]), archive_entry_id="fiscalizacion/test"
    )

    assert not result.quarantined, "a valid wrapped continuation must never be quarantined"
    assert len(result.rows) == 1
    row = result.rows[0]
    assert row.mesa == 13
    assert row.source_row_indices == (0, 1)
    assert row.votes["Potencia"] == 12
    assert row.votes["Impugnado"] == 0
    assert row.votes["La Libertad Avanza"] == 116


# ---------------------------------------------------------------------------
# 6.3 — identical duplicate rows collapsed
# ---------------------------------------------------------------------------


def test_identical_duplicate_rows_collapsed() -> None:
    identical = "ESCUELA TEST N2,Mesa 68,130,3,3,13,1,0,53,2,0,5,4,1,1,0,2,0,0"
    result = ingest_fiscalizacion(
        _synthetic_csv([identical, identical]), archive_entry_id="fiscalizacion/test"
    )

    assert not result.quarantined
    assert len(result.rows) == 1
    assert result.rows[0].source_row_indices == (0, 1)
    collapse_items = [i for i in result.review_items if i.kind == "duplicate_collapsed"]
    assert len(collapse_items) == 1
    assert collapse_items[0].severity == "info"
    assert "68" in collapse_items[0].subject_ref


# ---------------------------------------------------------------------------
# 6.4 — conflicting duplicate quarantined (never dropped); unmergeable
# empty-Mesa row quarantined
# ---------------------------------------------------------------------------


def test_conflicting_duplicate_is_quarantined_not_dropped() -> None:
    row_a = "ESCUELA TEST N3,Mesa 15,136,2,0,15,3,0,40,3,3,5,10,7,0,0,2,8,0"
    row_b = "ESCUELA TEST N3,Mesa 15,140,2,0,15,3,0,40,3,3,5,10,7,0,0,2,8,0"
    result = ingest_fiscalizacion(_synthetic_csv([row_a, row_b]), archive_entry_id="test")

    assert result.rows == (), "a genuine conflict must not silently join a row"
    assert len(result.quarantined) == 2
    for entry in result.quarantined:
        assert entry.reason == "duplicate_conflict"
        assert entry.mesa == 15


def test_unmergeable_empty_mesa_row_is_quarantined() -> None:
    # No preceding row shares "ESCUELA TEST N5" at all, so this empty-Mesa
    # row has nothing valid to merge into.
    orphan_continuation = "ESCUELA TEST N5,,,,,,,,,,,,,1,0,0,0,0,0"
    result = ingest_fiscalizacion(_synthetic_csv([orphan_continuation]), archive_entry_id="test")

    assert result.rows == ()
    assert len(result.quarantined) == 1
    assert result.quarantined[0].reason == "unmergeable_empty_mesa"


# ---------------------------------------------------------------------------
# 6.5 — blank vote cell is missing, not zero
# ---------------------------------------------------------------------------


def test_blank_vote_cell_is_missing_not_zero() -> None:
    row = "ESCUELA TEST N6,Mesa 60,93,1,1,10,7,0,60,0,5,5,3,3,2,1,1,5,"
    result = ingest_fiscalizacion(_synthetic_csv([row]), archive_entry_id="test")

    assert len(result.rows) == 1
    assert result.rows[0].votes["Impugnado"] is None
    assert result.rows[0].votes["Impugnado"] != 0

    blank_items = [i for i in result.review_items if i.kind == "blank_vote_cell"]
    assert len(blank_items) == 1
    assert blank_items[0].severity == "info"


# ---------------------------------------------------------------------------
# 6.6 — Escuela normalized for matching only; raw string preserved
# ---------------------------------------------------------------------------


def test_escuela_normalized_for_matching_raw_string_preserved() -> None:
    row_a = "ESCUELA EP N°23/ES N°9,Mesa 1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0"
    row_b = "escuela ep nº23/es n °9,Mesa 2,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0"
    result = ingest_fiscalizacion(_synthetic_csv([row_a, row_b]), archive_entry_id="test")

    by_mesa = {row.mesa: row for row in result.rows}
    assert by_mesa[1].escuela == "ESCUELA EP N°23/ES N°9"  # raw preserved verbatim
    assert by_mesa[2].escuela == "escuela ep nº23/es n °9"
    assert by_mesa[1].escuela_normalized == by_mesa[2].escuela_normalized


# ---------------------------------------------------------------------------
# 6.7 (threat matrix — personal-data-bearing source ingestion): no loaded
# column or review note contains a name
# ---------------------------------------------------------------------------


def test_no_loaded_column_or_review_note_contains_a_name() -> None:
    fake_given_name = "Testigo Sintetico Uno"
    fake_surname = "Apellido Sintetico Dos"
    row = (
        f"{fake_given_name},{fake_surname},ESCUELA TEST N7,Mesa 9,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0"
    )
    csv_text = _synthetic_csv([row], with_names=True)

    stripped = strip_personal_columns(csv_text)
    assert fake_given_name not in stripped
    assert fake_surname not in stripped
    assert "Nombre" not in stripped.splitlines()[0].split(",")
    assert "Apellido" not in stripped.splitlines()[0].split(",")

    result = ingest_fiscalizacion(csv_text, archive_entry_id="test")
    assert len(result.rows) == 1
    row_obj = result.rows[0]
    assert fake_given_name not in row_obj.escuela
    assert fake_surname not in row_obj.escuela
    for item in result.review_items:
        assert fake_given_name not in item.note
        assert fake_surname not in item.note
    for quarantined in result.quarantined:
        assert fake_given_name not in quarantined.note
        assert fake_surname not in quarantined.note


# ---------------------------------------------------------------------------
# 6.8 (threat matrix): committed fixture has no name columns
# ---------------------------------------------------------------------------


def test_committed_fixture_has_no_name_columns() -> None:
    reader = csv.reader(_real_fixture_text().splitlines())
    header = next(reader)
    assert "Nombre" not in header
    assert "Apellido" not in header
    assert header[0] == "Escuela"
    assert header[1] == "Mesa"


# ---------------------------------------------------------------------------
# 6.9 (threat matrix): fiscalización entries never reach the remote uploader
# ---------------------------------------------------------------------------


def test_fiscalizacion_entries_never_reach_the_remote_uploader() -> None:
    compliant_entry = {
        "id": "fiscalizacion/2025-x",
        "source_kind": "fiscalizacion",
        "upload": "never",
    }
    guard_local_mirror_only(compliant_entry)  # must not raise

    misconfigured_entry = {"id": "fiscalizacion/2025-y", "source_kind": "fiscalizacion"}
    try:
        guard_local_mirror_only(misconfigured_entry)
        raise AssertionError("expected FiscalizacionUploadForbiddenError")
    except FiscalizacionUploadForbiddenError:
        pass

    official_entry = {"id": "national/2023-generales", "source_kind": "official"}
    guard_local_mirror_only(official_entry)  # unaffected, must not raise

    sources = yaml.safe_load((REPO_ROOT / "etl" / "sources.yaml").read_text(encoding="utf-8"))
    real_entry = next(
        e for e in sources["fiscalizacion"] if e["id"] == "fiscalizacion/2025-coronel-rosales"
    )
    guard_local_mirror_only(real_entry)  # the committed entry must itself comply


# ---------------------------------------------------------------------------
# 6.10 — reexport hash change recorded as info, not content_drift
# ---------------------------------------------------------------------------


def test_reexport_hash_change_recorded_as_info_not_content_drift() -> None:
    assert classify_reexport_drift(source_kind="fiscalizacion") == ("source_reexported", "info")
    assert classify_reexport_drift(source_kind="official") == ("content_drift", "warning")


# ---------------------------------------------------------------------------
# 6.14 — REFACTOR: real fixture converges 105 -> 99 -> 93 as documented
# ---------------------------------------------------------------------------


def test_real_fixture_converges_to_93_unique_mesas_with_documented_totals() -> None:
    raw_text = _real_fixture_text()
    data_rows = list(csv.DictReader(raw_text.splitlines()))
    assert len(data_rows) == 105

    # Intermediate stage (white-box, D9.4 rule 1 only): merging the 6 wrapped
    # continuation rows into their parent yields exactly 99 rows.
    merged, merge_quarantine = _merge_wrapped_rows(data_rows)
    assert merge_quarantine == []
    assert len(merged) == 99

    result = ingest_fiscalizacion(raw_text, archive_entry_id="fiscalizacion/test")

    no_conflicts_msg = "the real sheet's duplicates are all identical, not conflicting"
    assert result.quarantined == (), no_conflicts_msg
    assert len(result.rows) == 93  # collapsing the 5 identical-duplicate groups: 99 -> 93

    total_votes = 0
    lla_votes = 0
    fuerza_patria_votes = 0
    blank_cells = 0
    for row in result.rows:
        for column, value in row.votes.items():
            if value is None:
                blank_cells += 1
                continue
            total_votes += value
            if column == "La Libertad Avanza":
                lla_votes += value
            if column == "Fuerza Patria":
                fuerza_patria_votes += value

    assert blank_cells == 4
    assert total_votes == 20_797
    assert lla_votes == 12_578
    assert fuerza_patria_votes == 4_165
    assert round(lla_votes / total_votes * 100, 2) == 60.48
    assert round(fuerza_patria_votes / total_votes * 100, 2) == 20.03


# ---------------------------------------------------------------------------
# 12b — Fiscalización Postgres loader (real ephemeral Postgres)
# ---------------------------------------------------------------------------


def _snapshot(conn: psycopg.Connection, archive_entry_id: str) -> list[tuple]:
    with conn.cursor() as cur:
        cur.execute(
            """
            select list_id, votes, source_kind, is_unmapped
            from result_row
            where archive_entry_id = %s
            order by list_id
            """,
            (archive_entry_id,),
        )
        return cur.fetchall()


def test_wide_columns_map_to_one_result_row_per_list(pg_conn: psycopg.Connection) -> None:
    """12.8: the sheet is 17 wide vote columns per mesa; `result_row` is
    long, one row per list. The mapping goes through
    `curated/party_map.yaml` (never column position) -- so only the 15
    party columns become rows; `En blanco`/`Impugnado` have no curated
    `list_id` and are skipped rather than written under a fabricated id.
    """
    archive_entry_id = f"test-fiscalizacion-{uuid.uuid4()}"
    party_map = load_party_map(PARTY_MAP_PATH)
    row = FiscalizacionRow(
        mesa=1,
        escuela="ESCUELA TEST",
        escuela_normalized="ESCUELA TEST",
        votes={column: index + 1 for index, column in enumerate(FISCALIZACION_VOTE_COLUMNS)},
        source_row_indices=(0,),
    )

    inserted = load_fiscalizacion_rows(
        pg_conn,
        [row],
        year=2025,
        round_="legislativas",
        party_map=party_map,
        archive_entry_id=archive_entry_id,
    )

    snapshot = _snapshot(pg_conn, archive_entry_id)
    assert inserted == 15, "17 columns minus En blanco/Impugnado (no curated list_id) == 15"
    assert len(snapshot) == 15
    list_ids = {list_id for list_id, _, _, _ in snapshot}
    assert "110" in list_ids  # La Libertad Avanza -> ALIANZA LA LIBERTAD AVANZA


def test_blank_vote_cell_is_missing_not_zero_in_the_loaded_rows(
    pg_conn: psycopg.Connection,
) -> None:
    """12.9: a blank cell in the source CSV (`None` in `FiscalizacionRow.votes`)
    must produce NO `result_row` for that column -- never a zero-vote row.
    """
    archive_entry_id = f"test-fiscalizacion-{uuid.uuid4()}"
    party_map = load_party_map(PARTY_MAP_PATH)
    votes = {column: 5 for column in FISCALIZACION_VOTE_COLUMNS}
    votes["La Libertad Avanza"] = None  # blank cell, per the real source shape
    row = FiscalizacionRow(
        mesa=2,
        escuela="ESCUELA TEST",
        escuela_normalized="ESCUELA TEST",
        votes=votes,
        source_row_indices=(0,),
    )

    load_fiscalizacion_rows(
        pg_conn,
        [row],
        year=2025,
        round_="legislativas",
        party_map=party_map,
        archive_entry_id=archive_entry_id,
    )

    snapshot = _snapshot(pg_conn, archive_entry_id)
    assert "110" not in {list_id for list_id, _, _, _ in snapshot}
    assert len(snapshot) == 14, "14 party columns loaded, La Libertad Avanza's blank cell skipped"


def test_loaded_rows_carry_source_kind_fiscalizacion(pg_conn: psycopg.Connection) -> None:
    """12.10: loaded fiscalización rows always carry `source_kind =
    'fiscalizacion'` -- never `'official'`, which would make an internal
    provisional tally indistinguishable from the definitive escrutinio.
    """
    archive_entry_id = f"test-fiscalizacion-{uuid.uuid4()}"
    party_map = load_party_map(PARTY_MAP_PATH)
    row = FiscalizacionRow(
        mesa=3,
        escuela="ESCUELA TEST",
        escuela_normalized="ESCUELA TEST",
        votes={column: 1 for column in FISCALIZACION_VOTE_COLUMNS},
        source_row_indices=(0,),
    )

    load_fiscalizacion_rows(
        pg_conn,
        [row],
        year=2025,
        round_="legislativas",
        party_map=party_map,
        archive_entry_id=archive_entry_id,
    )

    snapshot = _snapshot(pg_conn, archive_entry_id)
    assert snapshot, "sanity: the fixture actually produced rows"
    assert {source_kind for _, _, source_kind, _ in snapshot} == {"fiscalizacion"}


def test_fiscalizacion_load_never_writes_a_fiscal_name(pg_conn: psycopg.Connection) -> None:
    """12.11: no personal-data column (`Nombre`/`Apellido`) reaches any
    table. `FiscalizacionRow` never carries a name field at all (D9.3), so
    this asserts the structural invariant end to end: neither the inserted
    `result_row` rows nor the `jurisdiction` row created for this mesa
    contain the fake fiscal's name used only to prove the absence.
    """
    fake_given_name = "Testigo Sintetico Tres"
    fake_surname = "Apellido Sintetico Cuatro"
    archive_entry_id = f"test-fiscalizacion-{uuid.uuid4()}"
    party_map = load_party_map(PARTY_MAP_PATH)
    row = FiscalizacionRow(
        mesa=4,
        escuela=f"ESCUELA TEST ({fake_given_name} {fake_surname} never stored here)",
        escuela_normalized="ESCUELA TEST",
        votes={column: 1 for column in FISCALIZACION_VOTE_COLUMNS},
        source_row_indices=(0,),
    )

    load_fiscalizacion_rows(
        pg_conn,
        [row],
        year=2025,
        round_="legislativas",
        party_map=party_map,
        archive_entry_id=archive_entry_id,
    )

    with pg_conn.cursor() as cur:
        cur.execute(
            """
            select column_name from information_schema.columns
            where table_schema = 'public' and table_name in ('result_row', 'jurisdiction')
            """
        )
        columns = [name for (name,) in cur.fetchall()]
        for column in columns:
            assert "nombre" not in column.lower() and "apellido" not in column.lower()

        cur.execute(
            "select jurisdiction_id, votes, list_id, source_kind, archive_entry_id, "
            "source_row_index from result_row where archive_entry_id = %s",
            (archive_entry_id,),
        )
        for db_row in cur.fetchall():
            for value in db_row:
                assert fake_given_name not in str(value)
                assert fake_surname not in str(value)

        cur.execute(
            "select distrito_code, seccion_code, circuito_code, mesa_code from jurisdiction"
        )
        for db_row in cur.fetchall():
            for value in db_row:
                assert fake_given_name not in str(value)
                assert fake_surname not in str(value)


def test_fiscalizacion_reingest_is_idempotent_per_d8(pg_conn: psycopg.Connection) -> None:
    """12.12: reuses `db.py::load_result_rows`, so D8's election-scoped
    idempotency (migration 0008) applies to fiscalización the same way it
    already applies to national/PBA -- re-running with the same
    `archive_entry_id` and rows leaves `result_row` identical.
    """
    archive_entry_id = f"test-fiscalizacion-{uuid.uuid4()}"
    party_map = load_party_map(PARTY_MAP_PATH)
    rows = [
        FiscalizacionRow(
            mesa=5,
            escuela="ESCUELA TEST",
            escuela_normalized="ESCUELA TEST",
            votes={column: 2 for column in FISCALIZACION_VOTE_COLUMNS},
            source_row_indices=(0,),
        )
    ]

    first = load_fiscalizacion_rows(
        pg_conn, rows, year=2025, round_="legislativas", party_map=party_map,
        archive_entry_id=archive_entry_id,
    )
    first_snapshot = _snapshot(pg_conn, archive_entry_id)

    second = load_fiscalizacion_rows(
        pg_conn, rows, year=2025, round_="legislativas", party_map=party_map,
        archive_entry_id=archive_entry_id,
    )
    second_snapshot = _snapshot(pg_conn, archive_entry_id)

    assert first == second == 15
    assert first_snapshot == second_snapshot
