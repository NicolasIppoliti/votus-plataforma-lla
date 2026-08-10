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
import io
import os
import uuid
from pathlib import Path

import psycopg
import pytest
import yaml

from etl.__main__ import fresh_review_items
from etl.crosswalk import FISCALIZACION_VOTE_COLUMNS
from etl.ingest.fiscalizacion import (
    FISCALIZACION_CATEGORY,
    FISCALIZACION_DISTRITO,
    FISCALIZACION_SECCION,
    FiscalizacionRow,
    FiscalizacionSchemaError,
    FiscalizacionUploadForbiddenError,
    _merge_wrapped_rows,
    _resolve_official_mesa,
    guard_local_mirror_only,
    load_fiscalizacion_rows,
    strip_personal_columns,
)
from etl.ingest.fiscalizacion import (
    ingest_fiscalizacion as _ingest_fiscalizacion,
)
from etl.party_map import load_party_map
from etl.review_item import ReviewItemRecord

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


def ingest_fiscalizacion(raw_csv: str | bytes, *, archive_entry_id: str):
    raw_bytes = raw_csv.encode("utf-8") if isinstance(raw_csv, str) else raw_csv
    return _ingest_fiscalizacion(raw_bytes, archive_entry_id=archive_entry_id)


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


def test_the_raw_escuela_string_is_preserved_exactly_as_written() -> None:
    """`escuela` keeps what the fiscal wrote, verbatim.

    There is no `escuela_normalized` companion any more: the folded form
    existed "only for matching" and nothing matched on it -- the accepted
    mesa-identity decision joins by MESA NUMBER. What matters is that the raw
    string is never rewritten, because it is what a human reads to find the
    row in the source.
    """
    text = (
        f"Escuela,Mesa,{VOTE_HEADER}\n"
        f"Escuela N\u00b0 3,9001," + ",".join(["1"] * len(FISCALIZACION_VOTE_COLUMNS)) + "\n"
        "  ESCUELA  N \u00ba 3 ,9002," + ",".join(["1"] * len(FISCALIZACION_VOTE_COLUMNS)) + "\n"
    )

    result = ingest_fiscalizacion(text, archive_entry_id="fiscalizacion/test")

    by_mesa = {row.mesa: row for row in result.rows}
    assert by_mesa[9001].escuela == "Escuela N\u00b0 3"
    assert by_mesa[9002].escuela == "  ESCUELA  N \u00ba 3 "


# ---------------------------------------------------------------------------
# 6.7 (threat matrix — personal-data-bearing source ingestion): no loaded
# column or review note contains a name
# ---------------------------------------------------------------------------


def test_no_loaded_column_or_review_note_contains_a_name() -> None:
    fake_given_name = "PRIVATE_CELL_A"
    fake_surname = "PRIVATE_CELL_B"
    row = (
        f"{fake_given_name},{fake_surname},ESCUELA TEST N7,Mesa 9,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0"
    )
    csv_text = _synthetic_csv([row], with_names=True)

    stripped = strip_personal_columns(csv_text.encode("utf-8"))
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


def test_personal_payload_is_never_decoded_or_sliced_into_a_value() -> None:
    sentinel = b"PRIVATE_CELL_MUST_STAY_OPAQUE"

    class MaterializationProbe(bytes):
        def decode(self, *_args, **_kwargs):
            raise AssertionError("raw personal-bearing CSV must not be decoded")

        def __getitem__(self, key):
            value = super().__getitem__(key)
            if isinstance(value, bytes) and sentinel in value:
                raise AssertionError("personal payload was sliced into a bytes value")
            return value

    raw = MaterializationProbe(
        b"Nombre,Escuela,Apellido,Mesa\n" + sentinel + b",SCHOOL,PRIVATE_CELL_B,1\n"
    )

    stripped = strip_personal_columns(raw)

    assert sentinel.decode("ascii") not in stripped
    assert list(csv.DictReader(stripped.splitlines())) == [{"Escuela": "SCHOOL", "Mesa": "1"}]


@pytest.mark.parametrize("line_ending", [b"\n", b"\r\n"])
def test_personal_projection_supports_quoted_rfc4180_shapes(line_ending: bytes) -> None:
    raw = (
        b"Nombre,Escuela,Apellido,Mesa"
        + line_ending
        + b'"PRIVATE,""QUOTED""\nCELL",SCHOOL,,7'
        + line_ending
    )

    stripped = strip_personal_columns(raw)
    rows = list(csv.DictReader(io.StringIO(stripped)))

    assert rows == [{"Escuela": "SCHOOL", "Mesa": "7"}]
    assert "PRIVATE" not in stripped


def test_malformed_personal_field_reports_shape_without_payload() -> None:
    raw = b'Nombre,Escuela,Mesa\n"PRIVATE_MALFORMED,SCHOOL,7\n'

    with pytest.raises(FiscalizacionSchemaError) as excinfo:
        strip_personal_columns(raw)

    message = str(excinfo.value)
    assert "row 1" in message and "column 1" in message
    assert "PRIVATE_MALFORMED" not in message


def test_personal_projection_rejects_unknown_columns_without_cell_values() -> None:
    raw = b"Escuela,Mesa,Unexpected\nSCHOOL,7,PRIVATE_UNKNOWN_VALUE\n"

    with pytest.raises(FiscalizacionSchemaError) as excinfo:
        strip_personal_columns(raw)

    message = str(excinfo.value)
    assert "1 unexpected header field at position 3" in message
    assert "Unexpected" not in message
    assert "PRIVATE_UNKNOWN_VALUE" not in message


@pytest.mark.parametrize(
    ("raw", "diagnosis"),
    [
        (b"PRIVATE_INVALID_\xff,Escuela,Mesa\n", "invalid UTF-8 in header column 1"),
        (b"Escuela,Mesa\nPRIVATE_INVALID_\xff,7\n", "invalid UTF-8 in retained CSV fields"),
    ],
)
def test_invalid_utf8_errors_do_not_disclose_payload(raw: bytes, diagnosis: str) -> None:
    with pytest.raises(FiscalizacionSchemaError) as excinfo:
        strip_personal_columns(raw)

    message = str(excinfo.value)
    assert message == diagnosis
    assert "PRIVATE_INVALID" not in message


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
        "capability": "fiscalizacion",
        "upload": "never",
    }
    guard_local_mirror_only(compliant_entry)  # must not raise

    misconfigured_entry = {"id": "fiscalizacion/2025-y", "capability": "fiscalizacion"}
    with pytest.raises(FiscalizacionUploadForbiddenError):
        guard_local_mirror_only(misconfigured_entry)

    capability_only_entry = {
        "id": "fiscalizacion/2025-capability-only",
        "capability": "fiscalizacion",
    }
    with pytest.raises(FiscalizacionUploadForbiddenError):
        guard_local_mirror_only(capability_only_entry)

    official_entry = {"id": "national/2023-generales", "capability": "national"}
    guard_local_mirror_only(official_entry)  # unaffected, must not raise

    sources = yaml.safe_load((REPO_ROOT / "etl" / "sources.yaml").read_text(encoding="utf-8"))
    real_entry = next(
        e for e in sources["fiscalizacion"] if e["id"] == "fiscalizacion/2025-coronel-rosales"
    )
    guard_local_mirror_only({**real_entry, "capability": "fiscalizacion"})


# ---------------------------------------------------------------------------
# 6.10 — reexport hash change recorded as info, not content_drift
# ---------------------------------------------------------------------------


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
            select list_id, votes, source_kind
            from result_row
            where archive_entry_id = %s
            order by list_id
            """,
            (archive_entry_id,),
        )
        return cur.fetchall()


def _jurisdiction_mesa(conn: psycopg.Connection, *, circuito: str, mesa: int) -> str:
    from etl import db

    return db.upsert_jurisdiction(
        conn,
        distrito=FISCALIZACION_DISTRITO,
        seccion=FISCALIZACION_SECCION,
        circuito=circuito,
        mesa=mesa,
    )


def _official_mesa(
    conn: psycopg.Connection,
    *,
    circuito: str,
    mesa: int,
    year: int = 2025,
    round_: str = "legislativas",
) -> str:
    """A mesa jurisdiction proven by an official result for one election."""
    from etl import db

    jurisdiction_id = _jurisdiction_mesa(conn, circuito=circuito, mesa=mesa)
    election_id = db.upsert_election(conn, year=year, round_=round_)
    category_id = db.upsert_category(conn, name=FISCALIZACION_CATEGORY)
    db.load_result_rows(
        conn,
        archive_entry_id=f"official-test-{year}-{round_}-{mesa}-{circuito}",
        election_id=election_id,
        records=[
            db.ResultRowRecord(
                election_id=election_id,
                jurisdiction_id=jurisdiction_id,
                category_id=category_id,
                granularity="mesa",
                list_id="official-test-list",
                votes=1,
                source_kind="official",
                archive_entry_id=f"official-test-{year}-{round_}-{mesa}-{circuito}",
                source_row_index=0,
            )
        ],
    )
    return jurisdiction_id


def test_wide_columns_map_to_one_result_row_per_list(pg_conn: psycopg.Connection) -> None:
    """12.8: the sheet is 17 wide vote columns per mesa; `result_row` is
    long, one row per list. The mapping goes through
    `curated/party_map.yaml` (never column position) -- so only the 15
    party columns become rows; `En blanco`/`Impugnado` have no curated
    `list_id` and are skipped rather than written under a fabricated id.
    """
    archive_entry_id = f"test-fiscalizacion-{uuid.uuid4()}"
    party_map = load_party_map(PARTY_MAP_PATH)
    _official_mesa(pg_conn, circuito="00248A", mesa=9001)
    row = FiscalizacionRow(
        mesa=9001,
        escuela="ESCUELA TEST",
        votes={column: index + 1 for index, column in enumerate(FISCALIZACION_VOTE_COLUMNS)},
        source_row_indices=(0,),
    )

    inserted, _review_items = load_fiscalizacion_rows(
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
    list_ids = {list_id for list_id, _, _ in snapshot}
    assert "110" in list_ids  # La Libertad Avanza -> ALIANZA LA LIBERTAD AVANZA


def test_blank_vote_cell_is_missing_not_zero_in_the_loaded_rows(
    pg_conn: psycopg.Connection,
) -> None:
    """12.9: a blank cell in the source CSV (`None` in `FiscalizacionRow.votes`)
    must produce NO `result_row` for that column -- never a zero-vote row.
    """
    archive_entry_id = f"test-fiscalizacion-{uuid.uuid4()}"
    party_map = load_party_map(PARTY_MAP_PATH)
    votes: dict[str, int | None] = {column: 5 for column in FISCALIZACION_VOTE_COLUMNS}
    votes["La Libertad Avanza"] = None  # blank cell, per the real source shape
    _official_mesa(pg_conn, circuito="00248A", mesa=9002)
    row = FiscalizacionRow(
        mesa=9002,
        escuela="ESCUELA TEST",
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
    assert "110" not in {list_id for list_id, _, _ in snapshot}
    assert len(snapshot) == 14, "14 party columns loaded, La Libertad Avanza's blank cell skipped"


def test_loaded_rows_carry_source_kind_fiscalizacion(pg_conn: psycopg.Connection) -> None:
    """12.10: loaded fiscalización rows always carry `source_kind =
    'fiscalizacion'` -- never `'official'`, which would make an internal
    provisional tally indistinguishable from the definitive escrutinio.
    """
    archive_entry_id = f"test-fiscalizacion-{uuid.uuid4()}"
    party_map = load_party_map(PARTY_MAP_PATH)
    _official_mesa(pg_conn, circuito="00248A", mesa=9003)
    row = FiscalizacionRow(
        mesa=9003,
        escuela="ESCUELA TEST",
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
    assert {source_kind for _, _, source_kind in snapshot} == {"fiscalizacion"}


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
    _official_mesa(pg_conn, circuito="00248A", mesa=9004)
    row = FiscalizacionRow(
        mesa=9004,
        escuela=f"ESCUELA TEST ({fake_given_name} {fake_surname} never stored here)",
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
    _official_mesa(pg_conn, circuito="00248A", mesa=9005)
    rows = [
        FiscalizacionRow(
            mesa=9005,
            escuela="ESCUELA TEST",
            votes={column: 2 for column in FISCALIZACION_VOTE_COLUMNS},
            source_row_indices=(0,),
        )
    ]

    first, _first_review_items = load_fiscalizacion_rows(
        pg_conn,
        rows,
        year=2025,
        round_="legislativas",
        party_map=party_map,
        archive_entry_id=archive_entry_id,
    )
    first_snapshot = _snapshot(pg_conn, archive_entry_id)

    second, _second_review_items = load_fiscalizacion_rows(
        pg_conn,
        rows,
        year=2025,
        round_="legislativas",
        party_map=party_map,
        archive_entry_id=archive_entry_id,
    )
    second_snapshot = _snapshot(pg_conn, archive_entry_id)

    assert first == second == 15
    assert first_snapshot == second_snapshot


def test_a_jurisdiction_shape_without_an_official_result_is_not_accepted(
    pg_conn: psycopg.Connection,
) -> None:
    archive_entry_id = f"test-fiscalizacion-{uuid.uuid4()}"
    party_map = load_party_map(PARTY_MAP_PATH)
    _jurisdiction_mesa(pg_conn, circuito="00248A", mesa=9009)
    row = FiscalizacionRow(
        mesa=9009,
        escuela="ESCUELA TEST",
        votes={column: 1 for column in FISCALIZACION_VOTE_COLUMNS},
        source_row_indices=(0,),
    )

    inserted, review_items = load_fiscalizacion_rows(
        pg_conn,
        [row],
        year=2025,
        round_="legislativas",
        party_map=party_map,
        archive_entry_id=archive_entry_id,
    )

    assert inserted == 0
    assert [item.kind for item in review_items] == ["mesa_absent_from_official_import"]


def test_official_result_from_another_election_does_not_authorize_the_mesa(
    pg_conn: psycopg.Connection,
) -> None:
    archive_entry_id = f"test-fiscalizacion-{uuid.uuid4()}"
    party_map = load_party_map(PARTY_MAP_PATH)
    _official_mesa(
        pg_conn,
        circuito="00248A",
        mesa=9014,
        year=2024,
        round_="legislativas",
    )
    row = FiscalizacionRow(
        mesa=9014,
        escuela="ESCUELA TEST",
        votes={column: 1 for column in FISCALIZACION_VOTE_COLUMNS},
        source_row_indices=(0,),
    )

    inserted, review_items = load_fiscalizacion_rows(
        pg_conn,
        [row],
        year=2025,
        round_="legislativas",
        party_map=party_map,
        archive_entry_id=archive_entry_id,
    )

    assert inserted == 0
    assert [item.kind for item in review_items] == ["mesa_absent_from_official_import"]


def test_unpadded_scope_codes_match_the_normalized_national_scheme(
    pg_conn: psycopg.Connection,
) -> None:
    archive_entry_id = f"test-fiscalizacion-{uuid.uuid4()}"
    party_map = load_party_map(PARTY_MAP_PATH)
    official_id = _official_mesa(pg_conn, circuito="00248A", mesa=9010)
    row = FiscalizacionRow(
        mesa=9010,
        escuela="ESCUELA TEST",
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
        distrito="2",
        seccion="27",
    )

    with pg_conn.cursor() as cur:
        cur.execute(
            "select distinct jurisdiction_id from result_row where archive_entry_id = %s",
            (archive_entry_id,),
        )
        used = [result[0] for result in cur.fetchall()]
    assert used == [official_id]


def test_a_fiscalizacion_mesa_reuses_the_official_jurisdiction_row(
    pg_conn: psycopg.Connection,
) -> None:
    """The same physical mesa must be ONE `jurisdiction` row.

    The loader upserted `(distrito, seccion, mesa)` with no circuito while the
    official import writes `(distrito, seccion, circuito, mesa)`, so every
    fiscalización mesa became a SECOND identity for a mesa that already
    existed -- joined to the first by nothing. `/fiscalizacion` could then
    never juxtapose: pinning either uuid yields one source kind only.
    """
    archive_entry_id = f"test-fiscalizacion-{uuid.uuid4()}"
    party_map = load_party_map(PARTY_MAP_PATH)
    official_id = _official_mesa(pg_conn, circuito="00248A", mesa=9011)
    row = FiscalizacionRow(
        mesa=9011,
        escuela="ESCUELA TEST",
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
            "select distinct jurisdiction_id from result_row where archive_entry_id = %s",
            (archive_entry_id,),
        )
        used = [row_[0] for row_ in cur.fetchall()]
    assert used == [official_id], "the fiscalización rows must land on the official mesa row"


def test_a_mesa_number_in_two_circuitos_is_quarantined_never_guessed(
    pg_conn: psycopg.Connection,
) -> None:
    """A mesa NUMBER does not identify a mesa.

    Within one partido the same `mesa_code` appears in more than one circuito
    (verified against the live 2025 national import: 8 of the 93 fiscalización
    mesas are in this shape). Picking either circuito would attribute a
    fiscal's tally to a mesa nobody established, so the rows are quarantined
    with their reason instead.
    """
    archive_entry_id = f"test-fiscalizacion-{uuid.uuid4()}"
    party_map = load_party_map(PARTY_MAP_PATH)
    _official_mesa(pg_conn, circuito="00248C", mesa=9012)
    _official_mesa(pg_conn, circuito="00248D", mesa=9012)
    row = FiscalizacionRow(
        mesa=9012,
        escuela="ESCUELA TEST",
        votes={column: 1 for column in FISCALIZACION_VOTE_COLUMNS},
        source_row_indices=(0,),
    )

    inserted, review_items = load_fiscalizacion_rows(
        pg_conn,
        [row],
        year=2025,
        round_="legislativas",
        party_map=party_map,
        archive_entry_id=archive_entry_id,
    )

    assert inserted == 0, "no row may be written under a guessed circuito"
    assert [item.kind for item in review_items] == ["ambiguous_mesa_circuito"]
    assert "9012" in review_items[0].subject_ref
    assert "00248C" in review_items[0].note and "00248D" in review_items[0].note


@pytest.mark.parametrize(
    ("matches", "kind", "migration_note"),
    [
        (
            [("official-a", "00248C"), ("official-b", "00248D")],
            "ambiguous_mesa_circuito",
            "mesa 9012 exists in 2 circuitos (00248C, 00248D), so the mesa number "
            "does not identify it; a fiscalización tally cannot be attributed to one of "
            "them without guessing",
        ),
        (
            [],
            "mesa_absent_from_official_import",
            "mesa 9012 carries fiscalización rows but the official import has no jurisdiction "
            "for it in distrito 02 seccion 027, so it cannot be placed without inventing one",
        ),
    ],
)
def test_migration_review_item_identity_is_seen_as_existing_by_runtime(
    pg_conn: psycopg.Connection,
    monkeypatch,
    matches: list[tuple[str, str]],
    kind: str,
    migration_note: str,
) -> None:
    """A migration-created observation must suppress the runtime duplicate.

    The transaction is rolled back by ``pg_conn`` so this test never changes the
    shared disposable database after the assertion.
    """
    import etl.db as db

    source_id = f"fiscalizacion/migration-identity-{uuid.uuid4()}"
    election_ref = "2025-legislativas"
    monkeypatch.setattr(db, "official_jurisdictions_for_mesa", lambda *args, **kwargs: matches)
    drafts = []

    assert (
        _resolve_official_mesa(
            pg_conn,
            election_id="unused-by-stub",
            distrito="2",
            seccion="27",
            mesa=9012,
            review_items=drafts,
        )
        is None
    )
    assert len(drafts) == 1
    runtime = ReviewItemRecord(
        kind=drafts[0].kind,
        severity=drafts[0].severity,
        subject_ref=f"{source_id} {election_ref} {drafts[0].subject_ref}",
        note=drafts[0].note,
    )
    migration = ReviewItemRecord(
        kind=kind,
        severity="warning",
        subject_ref=f"{source_id} {election_ref} 02-027-mesa-9012",
        note=migration_note,
    )
    assert runtime == migration

    with pg_conn.cursor() as cur:
        cur.execute(
            "insert into review_item (kind, severity, subject_ref, note) values (%s, %s, %s, %s)",
            (migration.kind, migration.severity, migration.subject_ref, migration.note),
        )

    assert fresh_review_items(pg_conn, [runtime]) == []


def test_a_mesa_absent_from_the_official_import_is_quarantined_not_invented(
    pg_conn: psycopg.Connection,
) -> None:
    """No official mesa, no placement.

    Creating a circuito-less jurisdiction here is what produced the duplicate
    identity in the first place; a mesa the official import does not carry is
    one this loader cannot place, and saying so is the whole point.
    """
    archive_entry_id = f"test-fiscalizacion-{uuid.uuid4()}"
    party_map = load_party_map(PARTY_MAP_PATH)
    row = FiscalizacionRow(
        mesa=9013,
        escuela="ESCUELA TEST",
        votes={column: 1 for column in FISCALIZACION_VOTE_COLUMNS},
        source_row_indices=(0,),
    )

    inserted, review_items = load_fiscalizacion_rows(
        pg_conn,
        [row],
        year=2025,
        round_="legislativas",
        party_map=party_map,
        archive_entry_id=archive_entry_id,
    )

    assert inserted == 0
    assert [item.kind for item in review_items] == ["mesa_absent_from_official_import"]


def test_reingesting_a_source_that_now_parses_to_zero_rows_clears_the_old_ones(
    pg_conn: psycopg.Connection,
) -> None:
    """D8 idempotency on the EMPTY input.

    The loader returned before `load_result_rows` when `rows` was empty, so the
    delete-by-`archive_entry_id` never ran: a source re-exported empty, or one
    whose every row is now quarantined, left the previous run's rows alive and
    indistinguishable from current. The non-empty path was the only one tested.
    """
    archive_entry_id = f"test-fiscalizacion-{uuid.uuid4()}"
    party_map = load_party_map(PARTY_MAP_PATH)
    _official_mesa(pg_conn, circuito="00248A", mesa=9006)
    row = FiscalizacionRow(
        mesa=9006,
        escuela="ESCUELA TEST",
        votes={column: 1 for column in FISCALIZACION_VOTE_COLUMNS},
        source_row_indices=(0,),
    )

    first, _ = load_fiscalizacion_rows(
        pg_conn,
        [row],
        year=2025,
        round_="legislativas",
        party_map=party_map,
        archive_entry_id=archive_entry_id,
    )
    assert first == 15

    second, _ = load_fiscalizacion_rows(
        pg_conn,
        [],
        year=2025,
        round_="legislativas",
        party_map=party_map,
        archive_entry_id=archive_entry_id,
    )

    assert second == 0
    assert _snapshot(pg_conn, archive_entry_id) == [], (
        "the previous run's rows must not survive a re-ingest that parses to none"
    )


def test_a_party_column_with_no_curated_mapping_is_reported_not_just_absent(
    pg_conn: psycopg.Connection,
) -> None:
    """Absence alone could not tell two very different things apart.

    `En blanco`/`Impugnado` carry no party identity and are EXPECTED to resolve
    to nothing. A curated typo drops a real party's entire fiscalización column
    and produced byte-identical output — a destructive filter hiding behind
    expected behaviour.
    """
    from dataclasses import replace as _replace

    archive_entry_id = f"test-fiscalizacion-{uuid.uuid4()}"
    party_map = load_party_map(PARTY_MAP_PATH)
    # One curated entry renamed: the column it served now matches nothing.
    broken = _replace(
        party_map,
        entries=[
            entry for entry in party_map.entries if entry.party_name != "ALIANZA LA LIBERTAD AVANZA"
        ],
    )
    _official_mesa(pg_conn, circuito="00248A", mesa=9007)
    row = FiscalizacionRow(
        mesa=9007,
        escuela="ESCUELA TEST",
        votes={column: 3 for column in FISCALIZACION_VOTE_COLUMNS},
        source_row_indices=(0,),
    )

    inserted, review_items = load_fiscalizacion_rows(
        pg_conn,
        [row],
        year=2025,
        round_="legislativas",
        party_map=broken,
        archive_entry_id=archive_entry_id,
    )

    assert inserted == 14, "the dropped column is one fewer row"
    unmapped = [item for item in review_items if item.kind == "unmapped_party"]
    assert [item.subject_ref for item in unmapped] == ["column La Libertad Avanza"]
    # `En blanco`/`Impugnado` resolve to nothing too, and are NOT reported.
    assert not any("En blanco" in item.subject_ref for item in review_items)


def test_an_empty_reingest_does_not_wipe_another_election_sharing_the_entry(
    pg_conn: psycopg.Connection,
) -> None:
    """The empty-input delete must stay SCOPED BY ELECTION.

    `load_result_rows` inferred the scope from the rows that survived, so with
    none it fell back to an unscoped delete. One archived file can hold several
    elections, and a source that now parses to nothing — every mesa ambiguous,
    a sheet re-exported empty — then wiped the OTHER election's rows sharing
    the entry. The scoped branch's own comment names that hazard; the empty
    case is the one that cannot state its scope from its rows.
    """
    archive_entry_id = f"test-fiscalizacion-{uuid.uuid4()}"
    party_map = load_party_map(PARTY_MAP_PATH)
    _official_mesa(pg_conn, circuito="00248A", mesa=9008, round_="paso")
    _official_mesa(pg_conn, circuito="00248A", mesa=9008, round_="generales")
    row = FiscalizacionRow(
        mesa=9008,
        escuela="ESCUELA TEST",
        votes={column: 1 for column in FISCALIZACION_VOTE_COLUMNS},
        source_row_indices=(0,),
    )

    # Two elections, ONE archive entry.
    paso, _ = load_fiscalizacion_rows(
        pg_conn,
        [row],
        year=2025,
        round_="paso",
        party_map=party_map,
        archive_entry_id=archive_entry_id,
    )
    generales, _ = load_fiscalizacion_rows(
        pg_conn,
        [row],
        year=2025,
        round_="generales",
        party_map=party_map,
        archive_entry_id=archive_entry_id,
    )
    assert paso == generales == 15

    # The generales sheet now parses to nothing.
    load_fiscalizacion_rows(
        pg_conn,
        [],
        year=2025,
        round_="generales",
        party_map=party_map,
        archive_entry_id=archive_entry_id,
    )

    with pg_conn.cursor() as cur:
        cur.execute(
            """
            select e.round, count(*)
            from result_row r join election e on e.id = r.election_id
            where r.archive_entry_id = %s
            group by 1
            """,
            (archive_entry_id,),
        )
        remaining = dict(cur.fetchall())

    assert remaining == {"paso": 15}, "the other election's rows must survive"


# ---------------------------------------------------------------------------
# Rule 2 — the hand-maintained sheet's shape is stated and CHECKED
# ---------------------------------------------------------------------------


def test_a_renamed_column_is_refused_by_name_not_raised_as_a_keyerror() -> None:
    """This is the source most likely to drift -- a human edits it -- and it
    was the only parser here with no shape check. A renamed column surfaced
    as a bare `KeyError` deep inside the merge, naming nothing and aborting
    before the quarantine breakdown is printed.
    """
    from etl.ingest.fiscalizacion import FiscalizacionSchemaError

    header = VOTE_HEADER.replace("La Libertad Avanza", "LLA")
    text = f"Escuela,Mesa,{header}\nEscuela 1,1," + ",".join(
        ["0"] * len(FISCALIZACION_VOTE_COLUMNS)
    )

    with pytest.raises(FiscalizacionSchemaError) as excinfo:
        ingest_fiscalizacion(text, archive_entry_id="fiscalizacion/test")

    assert "La Libertad Avanza" in str(excinfo.value)


def test_a_truncated_row_is_absorbed_as_a_blank_continuation_not_a_crash() -> None:
    """`csv.DictReader` fills a short row's missing trailing fields with
    `None`, which made `row["Mesa"].strip()` an `AttributeError` mid-parse --
    every good row in the sheet lost to one truncated line.

    It is NOT quarantined, and the name says so: carrying no values, it is
    indistinguishable from a legitimate wrapped continuation row, so D9.4
    rule 1 merges it into the row above. That merge adds nothing and loses
    nothing, and the row index stays attached.
    """
    full = ",".join(["1"] * len(FISCALIZACION_VOTE_COLUMNS))
    text = (
        f"Escuela,Mesa,{VOTE_HEADER}\n"
        f"Escuela 1,9001,{full}\n"
        "Escuela 1\n"  # truncated: every field after Escuela is missing
        f"Escuela 1,9002,{full}\n"
    )

    result = ingest_fiscalizacion(text, archive_entry_id="fiscalizacion/test")

    assert sorted(row.mesa for row in result.rows) == [9001, 9002]
    # It carries no values, so D9.4 rule 1 merges it into the row above as a
    # blank continuation -- a no-op that keeps its source row index attached
    # rather than a crash. Nothing is invented and nothing is lost.
    by_mesa = {row.mesa: row for row in result.rows}
    assert by_mesa[9001].source_row_indices == (0, 1)
    assert by_mesa[9002].source_row_indices == (2,)


def test_a_mesa_cell_with_no_digits_is_quarantined_not_fatal() -> None:
    """`int("")` killed the run on one typo'd cell. The mesa is unknowable,
    so its tallies cannot be placed -- but the row is kept with its index so
    a human can read it against the source.
    """
    full = ",".join(["1"] * len(FISCALIZACION_VOTE_COLUMNS))
    text = f"Escuela,Mesa,{VOTE_HEADER}\nEscuela 1,9001,{full}\nEscuela 1,sin numero,{full}\n"

    result = ingest_fiscalizacion(text, archive_entry_id="fiscalizacion/test")

    assert [row.mesa for row in result.rows] == [9001]
    assert [q.reason for q in result.quarantined] == ["unreadable_mesa"]
    assert result.quarantined[0].mesa is None


def test_a_huge_digit_only_mesa_cell_is_quarantined_not_fatal() -> None:
    full = ",".join(["1"] * len(FISCALIZACION_VOTE_COLUMNS))
    huge_mesa = "9" * 10_000
    text = f"Escuela,Mesa,{VOTE_HEADER}\nEscuela 1,9001,{full}\nEscuela 1,{huge_mesa},{full}\n"

    result = ingest_fiscalizacion(text, archive_entry_id="fiscalizacion/test")

    assert [row.mesa for row in result.rows] == [9001]
    assert [q.reason for q in result.quarantined] == ["unreadable_mesa"]
    assert result.quarantined[0].mesa is None


def test_an_unreadable_vote_cell_is_a_review_item_not_a_withheld_row() -> None:
    """The row IS loaded -- every readable column of it -- so counting it
    among the quarantined made `ingest_source` print it under "not written to
    result_row", which is false. A plausible withheld-row total whose
    distribution is wrong is exactly what rule 3 exists to catch.

    It is also its OWN kind, not `blank_vote_cell`: an empty cell is what the
    fiscal left, an unreadable one is a transcription a human can go fix
    against the source. Both land as `None`; only one is actionable.
    """
    cells = ["1"] * len(FISCALIZACION_VOTE_COLUMNS)
    cells[0] = "1O"  # a letter O, not a zero
    text = f"Escuela,Mesa,{VOTE_HEADER}\nEscuela 1,9001," + ",".join(cells) + "\n"

    result = ingest_fiscalizacion(text, archive_entry_id="fiscalizacion/test")

    assert result.quarantined == (), "the row is loaded, so nothing is withheld"
    assert [row.mesa for row in result.rows] == [9001]
    loaded = result.rows[0].votes
    assert loaded[FISCALIZACION_VOTE_COLUMNS[0]] is None, "missing, explicitly not zero"
    assert loaded[FISCALIZACION_VOTE_COLUMNS[1]] == 1, "the readable columns still load"

    kinds = {draft.kind for draft in result.review_items}
    assert "unreadable_vote_cell" in kinds
    assert "blank_vote_cell" not in kinds, "an unreadable cell is not a blank one"


@pytest.mark.parametrize("bad_value", ["1_2", "+12", "-1"])
def test_signed_and_permissive_python_vote_forms_are_unreadable_not_tallies(
    bad_value: str,
) -> None:
    cells = ["1"] * len(FISCALIZACION_VOTE_COLUMNS)
    cells[0] = bad_value
    text = f"Escuela,Mesa,{VOTE_HEADER}\nEscuela 1,9001," + ",".join(cells) + "\n"

    result = ingest_fiscalizacion(text, archive_entry_id="fiscalizacion/test")

    assert result.rows[0].votes[FISCALIZACION_VOTE_COLUMNS[0]] is None
    assert result.rows[0].votes[FISCALIZACION_VOTE_COLUMNS[1]] == 1
    assert result.quarantined == ()
    assert [draft.kind for draft in result.review_items] == ["unreadable_vote_cell"]


def test_two_rows_for_one_mesa_disagreeing_on_the_escuela_are_not_collapsed() -> None:
    """The identity check covered only the 17 vote columns, so two rows for
    one mesa with the same tallies and DIFFERENT schools collapsed to the
    first and the other school was discarded with no record.

    On a hand-maintained sheet the school name is the anchor a human uses to
    go back to the source, and `_merge_wrapped_rows` right above already
    requires the escuelas to match before merging -- the two paths disagreed
    on what "the same row" means. The review item called them "identical",
    which was true of their vote vectors and of nothing else.
    """
    full = ",".join(["1"] * len(FISCALIZACION_VOTE_COLUMNS))
    text = f"Escuela,Mesa,{VOTE_HEADER}\nEscuela 1,9001,{full}\nEscuela 7,9001,{full}\n"

    result = ingest_fiscalizacion(text, archive_entry_id="fiscalizacion/test")

    assert result.rows == (), "nothing may be picked between two disagreeing rows"
    assert {q.reason for q in result.quarantined} == {"duplicate_conflict"}
    assert "duplicate_collapsed" not in {d.kind for d in result.review_items}


def test_two_genuinely_identical_rows_for_one_mesa_still_collapse() -> None:
    """The collapse itself must survive the tightened identity: same mesa,
    same school, same tallies is one observation written twice."""
    full = ",".join(["1"] * len(FISCALIZACION_VOTE_COLUMNS))
    text = f"Escuela,Mesa,{VOTE_HEADER}\nEscuela 1,9001,{full}\nEscuela 1,9001,{full}\n"

    result = ingest_fiscalizacion(text, archive_entry_id="fiscalizacion/test")

    assert [row.mesa for row in result.rows] == [9001]
    assert result.quarantined == ()
    assert "duplicate_collapsed" in {d.kind for d in result.review_items}
    # BOTH source rows stay attached, so the collapse is traceable.
    assert result.rows[0].source_row_indices == (0, 1)


def test_a_typod_mesa_cell_is_quarantined_not_mined_for_digits() -> None:
    """It stripped every non-digit and kept what was left, so `"Mesa 1O"` --
    the letter-O typo this same parser refuses to guess at in a VOTE cell --
    became mesa 1, and `"13 bis"` became mesa 13.

    That is worse than a dropped row: a fiscal's tally lands on a mesa that
    exists and belongs to someone else.
    """
    full = ",".join(["1"] * len(FISCALIZACION_VOTE_COLUMNS))
    text = (
        f"Escuela,Mesa,{VOTE_HEADER}\n"
        f"Escuela 1,Mesa 9001,{full}\n"  # the documented prefix form still parses
        f"Escuela 1,9002,{full}\n"  # and so does a bare number
        f"Escuela 1,Mesa 1O,{full}\n"  # letter O
        f"Escuela 1,13 bis,{full}\n"
    )

    result = ingest_fiscalizacion(text, archive_entry_id="fiscalizacion/test")

    assert sorted(row.mesa for row in result.rows) == [9001, 9002]
    assert [q.reason for q in result.quarantined] == ["unreadable_mesa"] * 2


def test_a_non_party_column_is_not_reported_as_a_curated_typo() -> None:
    """`En blanco`/`Impugnado` carry no party identity to map -- they key on
    `votos_tipo` -- while a curated typo silently drops a real party's entire
    column. The guard telling those apart iterated
    `OFFICIAL_AGRUPACION_NAME_BY_COLUMN`, which does not contain the
    non-party columns at all, so it never fired and the distinction was made
    by nothing.
    """
    from etl.ingest.fiscalizacion import build_column_list_id_map

    party_map = load_party_map(PARTY_MAP_PATH)
    mapping, unresolved = build_column_list_id_map(party_map, year=2025)

    assert "En blanco" not in unresolved and "Impugnado" not in unresolved
    assert "En blanco" not in mapping and "Impugnado" not in mapping
    # And every column the loop now visits is accounted for one way or the other.
    for column in FISCALIZACION_VOTE_COLUMNS:
        assert (
            column in mapping
            or column in unresolved
            or column
            in (
                "En blanco",
                "Impugnado",
            )
        )


def test_a_continuation_row_never_lands_on_a_mesa_further_up_the_sheet() -> None:
    """The merge target was "whatever last landed in `merged`", not the row
    immediately above.

    A row quarantined as `unreadable_mesa` never enters `merged`, so ITS
    continuation row fell through to the previous good mesa. The escuela
    guard does not catch that -- one school carries many mesas, so the names
    match routinely -- and neither does the disjointness check, since a
    continuation row fills by construction the columns its parent left blank.
    A fiscal's trailing tallies landed on a mesa that belongs to someone else.
    """
    n = len(FISCALIZACION_VOTE_COLUMNS)
    first_half = ["7"] + [""] * (n - 1)
    second_half = [""] + ["3"] * (n - 1)

    text = (
        f"Escuela,Mesa,{VOTE_HEADER}\n"
        f"Escuela 1,9001," + ",".join(["1"] * n) + "\n"
        "Escuela 1,sin numero," + ",".join(first_half) + "\n"  # quarantined
        "Escuela 1,," + ",".join(second_half) + "\n"  # ITS continuation
    )

    result = ingest_fiscalizacion(text, archive_entry_id="fiscalizacion/test")

    assert [row.mesa for row in result.rows] == [9001]
    # Mesa 9001's tallies are untouched: nothing from the orphaned rows.
    assert all(value == 1 for value in result.rows[0].votes.values())
    assert result.rows[0].source_row_indices == (0,)
    assert sorted(q.reason for q in result.quarantined) == [
        "unmergeable_empty_mesa",
        "unreadable_mesa",
    ]


def test_two_curated_names_that_normalize_alike_are_refused_not_picked_between() -> None:
    """`_normalize_party_name` exists to MAKE spellings collide -- its
    docstring names "COALICIÓN CÍVICA - A.R.I." against "COALICION CIVICA -
    A.R.I." -- and the lookup it feeds was a dict comprehension, so two
    curated entries collapsing to one name silently kept the second.

    A curator adding `UNIÓN LIBERAL` beside an existing `UNION LIBERAL` with a
    different list id would send every tally to whichever line the YAML lists
    second, with `unresolved` empty and no review item fired.
    """
    from etl.ingest.fiscalizacion import build_column_list_id_map
    from etl.party_map import PartyMappingEntry, PartyMappingTable

    table = PartyMappingTable(
        entries=(
            PartyMappingEntry(
                year=2025,
                jurisdiction="national",
                category="DIPUTADO NACIONAL",
                list_id="900",
                party_name="UNION LIBERAL",
                canonical_party="UL",
            ),
            PartyMappingEntry(
                year=2025,
                jurisdiction="national",
                category="DIPUTADO NACIONAL",
                list_id="901",
                party_name="UNIÓN LIBERAL",
                canonical_party="UL",
            ),
        )
    )

    with pytest.raises(ValueError) as excinfo:
        build_column_list_id_map(table, year=2025)

    message = str(excinfo.value)
    assert "900" in message and "901" in message
    assert "refusing to choose" in message
