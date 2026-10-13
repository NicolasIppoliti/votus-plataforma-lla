"""Independent CNE membership exercised through the real ETL CLI and database."""

import os
import uuid

import psycopg
import pytest
from test_cne_rosales_reference import ROWS, archive, workbook

from etl.__main__ import main


def args(root, election_id, dsn):
    return [
        "--local-root",
        str(root / "archive"),
        "--manifest-path",
        str(root / "archive-manifest.json"),
        "reconcile-cne-rosales-membership",
        "--election-id",
        str(election_id),
        "--database-url",
        dsn,
    ]


def test_reconciliation_quarantines_every_overlap_and_reports_all_reasons():
    from etl.circuit_membership import reconcile

    rows = [list(r) for r in ROWS]
    rows[1][7:9] = [4, 6]
    rows[2][2] = "9999"
    members, quarantines, reasons = reconcile(workbook(rows), set(range(1, 11)), {1: {"0248C"}})
    assert [m["mesa_code"] for m in members] == [2, 3, 5, 6]
    assert reasons == {
        "xlsx_mesa_not_in_catalogue": 0,
        "catalogue_mesa_not_covered": 2,
        "unrecognized_xlsx_circuit": 2,
        "xlsx_status_circuit_mismatch": 1,
        "overlapping_or_duplicate_ranges": 1,
    }
    assert {q["mesa_code"] for q in quarantines} == {1, 4, 8, 9}
    assert members[0]["circuito_code"] == "00248"


def test_reconciliation_never_uses_status_as_expected_membership():
    from etl.circuit_membership import reconcile

    members, quarantines, reasons = reconcile(
        workbook(ROWS), {1, 2, 3, 4, 5, 6, 7, 8, 10}, {1: {"248", "248C"}}
    )
    assert reasons["xlsx_mesa_not_in_catalogue"] == 1
    assert reasons["catalogue_mesa_not_covered"] == 1
    assert reasons["xlsx_status_circuit_mismatch"] == 1
    assert {q["mesa_code"] for q in quarantines} == {1, 9}
    assert len(members) == 7
    # A missing status does not remove a mesa from the independent denominator.
    assert any(m["mesa_code"] == 2 for m in members)
    assert {m["circuito_code"] for m in members} == {"00248", "0248C", "00249"}


def test_cli_checks_archive_before_database(tmp_path, capsys):
    records = archive(tmp_path)
    path = tmp_path / records[0]["archived_path"]
    path.write_bytes(path.read_bytes() + b"corrupt")
    assert main(args(tmp_path, uuid.uuid4(), "postgresql://invalid.invalid/db")) == 1
    assert "checksum_mismatch" in capsys.readouterr().err


def test_real_cli_replaces_scoped_membership_and_quarantine_idempotently(tmp_path, capsys):
    dsn = os.environ.get("ETL_TEST_DATABASE_URL")
    if not dsn:
        pytest.skip("requires etl-verify managed database")
    archive(tmp_path)
    source = f"national/membership-test-{uuid.uuid4()}"
    with psycopg.connect(dsn) as conn:
        election_id = conn.execute(
            "insert into election(year,round) values(2025,'legislativas') "
            "on conflict(year,round) do update set year=excluded.year returning id"
        ).fetchone()[0]
        category_id = conn.execute(
            "insert into category(name) values('MEMBERSHIP TEST') returning id"
        ).fetchone()[0]
        for mesa in range(1, 10):
            conn.execute(
                "insert into official_expected_mesa values(%s,%s,'02','027',%s,'NATIVOS',300,%s)",
                (election_id, source, mesa, mesa),
            )
            circuit = "00248" if mesa <= 4 else "0248C" if mesa <= 7 else "00249"
            conn.execute(
                "insert into official_mesa_count_status"
                " values(%s,%s,%s,'02','027',%s,%s,'counted')",
                (election_id, source, category_id, circuit, mesa),
            )
    try:
        for _ in range(2):
            assert main(args(tmp_path, election_id, dsn)) == 0
            with psycopg.connect(dsn) as conn:
                assert (
                    conn.execute(
                        "select count(*) from official_mesa_circuit_membership"
                        " where election_id=%s",
                        (election_id,),
                    ).fetchone()[0]
                    == 9
                )
        assert '"persisted": 9' in capsys.readouterr().err
        records = archive(tmp_path)
        path = tmp_path / records[0]["archived_path"]
        path.write_bytes(path.read_bytes() + b"corrupt")
        assert main(args(tmp_path, election_id, dsn)) == 1
        with psycopg.connect(dsn) as conn:
            assert (
                conn.execute(
                    "select count(*) from official_mesa_circuit_membership where election_id=%s",
                    (election_id,),
                ).fetchone()[0]
                == 9
            )
        # A duplicate range conflicts even if it names exactly the same circuit.
        archive(tmp_path, locales=workbook([*ROWS, ROWS[0]]))
        assert main(args(tmp_path, election_id, dsn)) == 0
        with psycopg.connect(dsn) as conn:
            assert (
                conn.execute(
                    "select count(*) from official_mesa_circuit_membership where election_id=%s",
                    (election_id,),
                ).fetchone()[0]
                == 5
            )
            assert (
                conn.execute(
                    "select count(*) from official_mesa_circuit_membership_quarantine"
                    " where election_id=%s",
                    (election_id,),
                ).fetchone()[0]
                == 4
            )
        assert '"overlapping_or_duplicate_ranges": 4' in capsys.readouterr().err
        # A competing archive is never deleted or silently overridden. Its PK
        # conflict rolls back BOTH replacement tables, including quarantines.
        archive(tmp_path)
        with psycopg.connect(dsn) as conn:
            conn.execute(
                "insert into official_mesa_circuit_membership"
                " values(%s,'geography/other','02','027','00248','248',1,2)",
                (election_id,),
            )
        with pytest.raises(psycopg.errors.UniqueViolation):
            main(args(tmp_path, election_id, dsn))
        with psycopg.connect(dsn) as conn:
            assert (
                conn.execute(
                    "select count(*) from official_mesa_circuit_membership where election_id=%s",
                    (election_id,),
                ).fetchone()[0]
                == 6
            )
            assert (
                conn.execute(
                    "select count(*) from official_mesa_circuit_membership_quarantine"
                    " where election_id=%s",
                    (election_id,),
                ).fetchone()[0]
                == 4
            )
    finally:
        with psycopg.connect(dsn) as conn:
            for table in (
                "official_mesa_circuit_membership_quarantine",
                "official_mesa_circuit_membership",
            ):
                conn.execute(f"delete from {table} where election_id=%s", (election_id,))
            for table in ("official_expected_mesa", "official_mesa_count_status"):
                conn.execute(f"delete from {table} where archive_entry_id=%s", (source,))
            conn.execute("delete from category where id=%s", (category_id,))
