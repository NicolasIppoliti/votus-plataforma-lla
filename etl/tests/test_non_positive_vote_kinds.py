"""Issue #408 contracts through the production national parser entrypoint.

Identity/header fields come from the committed national fixtures. Non-positive
rows below are synthetic shape probes, not claimed archive extracts or section
totals: 2023 PASO list numbers apply only to positive rows, and non-positive
agrupacion/list cells are empty or source sentinel 0. Both representations must
remain party-less, including zero-vote evidence.
"""

from __future__ import annotations

import csv
import io
import uuid
from dataclasses import replace
from pathlib import Path

import psycopg
import pytest

from etl import db, projection_receipt
from etl.ingest.national import iter_national_rows, load_national_rows
from etl.jurisdiction import JurisdictionNames

FIXTURES = Path(__file__).parent / "fixtures"
KINDS = ("POSITIVO", "EN BLANCO", "NULO", "IMPUGNADO", "RECURRIDO", "COMANDO")


def source_text(
    *, year: int, kinds: tuple[str, ...], sentinel: str = "", round_: str = "paso"
) -> io.StringIO:
    name = "national_2023_sample.csv" if year == 2023 else "national_2025_sample.csv"
    with (FIXTURES / name).open(newline="", encoding="utf-8-sig") as handle:
        reader = csv.DictReader(handle)
        fields = reader.fieldnames
        assert fields is not None
        template = next(reader)
    rows = []
    for index, kind in enumerate(kinds):
        row = dict(template)
        row["votos_tipo"] = kind
        row["votos_cantidad"] = str(index)
        # The legacy 2025 fixture predates verification of lista_numero;
        # measured 2025 positive rows always leave that field empty.
        if (year == 2025 or round_ == "generales") and "lista_numero" in fields:
            row["lista_numero"] = ""
        if kind != "POSITIVO":
            row["agrupacion_id"] = sentinel
            if "lista_numero" in fields:
                row["lista_numero"] = sentinel
        rows.append(row)
    stream = io.StringIO()
    writer = csv.DictWriter(stream, fieldnames=fields)
    writer.writeheader()
    writer.writerows(rows)
    stream.seek(0)
    return stream


@pytest.mark.parametrize(
    "year,round_", [(2023, "paso"), (2023, "generales"), (2025, "legislativas")]
)
@pytest.mark.parametrize("sentinel", ["", "0"])
def test_parser_preserves_each_vote_kind_without_attributing_it_to_a_party(
    year: int, round_: str, sentinel: str
) -> None:
    rows = list(
        iter_national_rows(
            source_text(year=year, kinds=KINDS, sentinel=sentinel, round_=round_),
            archive_entry_id=f"national/{year}-{round_}",
            election_year=year,
            election_round=round_,
        )
    )
    assert len(rows) == len(KINDS)
    assert {row.vote_kind for row in rows} == set(KINDS)
    positive = [row for row in rows if row.vote_kind == "POSITIVO"]
    assert len(positive) == 1
    assert positive[0].list_id is not None
    assert all(row.list_id is None for row in rows if row.vote_kind != "POSITIVO")
    assert {row.vote_kind: row.result.votes for row in rows} == {
        kind: index for index, kind in enumerate(KINDS)
    }


def test_non_positive_kinds_do_not_collide_in_ambiguity_quarantine() -> None:
    rows = list(
        iter_national_rows(
            source_text(year=2023, kinds=KINDS[1:]),
            archive_entry_id="national/2023-paso",
            election_year=2023,
            election_round="paso",
        )
    )
    assert len(rows) == 5
    assert all(row.list_id is None for row in rows)
    assert len({row.vote_kind for row in rows}) == 5


def test_loader_persists_each_kind_idempotently_and_receipt_detects_kind_only_changes() -> None:
    # Exercise the real writer and checksum against the local database, applying
    # this migration only inside this test's rolled-back transaction.
    from test_ingest_national import _require_ephemeral_postgres

    conn = _require_ephemeral_postgres()
    try:
        if (
            conn.execute(
                "select 1 from information_schema.columns "
                "where table_schema='public' and table_name='result_row' "
                "and column_name='vote_kind'"
            ).fetchone()
            is None
        ):
            migration = (
                Path(__file__).parents[2]
                / "supabase/migrations/20261015300000_non_positive_vote_kinds.sql"
            ).read_text()
            conn.execute(migration.removeprefix("begin;\n").removesuffix("commit;\n"))
        source = f"national/kinds-{uuid.uuid4()}"
        conn.execute(
            "insert into archive_entry "
            "(id,capability,source,source_url,mime,fetched_at,status,source_kind) "
            "values (%s,'national','test','https://example.invalid/kinds','text/csv',now(),'ok','official')",
            (source,),
        )
        rows = [
            replace(
                row,
                result=replace(row.result, category=source),
                jurisdiction_names=JurisdictionNames(),
            )
            for row in iter_national_rows(
                source_text(year=2025, kinds=KINDS),
                archive_entry_id=source,
                election_year=2025,
                election_round="legislativas",
            )
        ]
        election_id = db.upsert_election(conn, year=2025, round_="legislativas")
        for _ in range(2):
            assert (
                load_national_rows(
                    conn, rows, year=2025, round_="legislativas", archive_entry_id=source
                )
                == 6
            )
            assert conn.execute(
                "select vote_kind,list_id,votes from result_row "
                "where archive_entry_id=%s order by vote_kind",
                (source,),
            ).fetchall() == sorted((row.vote_kind, row.list_id, row.result.votes) for row in rows)
        down = (
            (
                Path(__file__).parents[2]
                / "supabase/migrations/down/20261015300000_non_positive_vote_kinds.down.sql"
            )
            .read_text()
            .removeprefix("begin;\n")
            .removesuffix("commit;\n")
        )
        with pytest.raises(psycopg.errors.RaiseException, match="cannot downgrade"):
            with conn.transaction():
                conn.execute(down)
        projection_receipt.publish(
            conn, archive_entry_id=source, election_id=election_id, identity="kinds"
        )
        assert (
            projection_receipt.reusable(
                conn, archive_entry_id=source, election_id=election_id, identity="kinds"
            )
            is not None
        )
        conn.execute(
            "update result_row set vote_kind='POSITIVO' "
            "where archive_entry_id=%s and vote_kind='COMANDO'",
            (source,),
        )
        assert (
            projection_receipt.reusable(
                conn, archive_entry_id=source, election_id=election_id, identity="kinds"
            )
            is None
        )
    finally:
        conn.rollback()
        conn.close()


def test_vote_kind_parser_and_writer_are_fingerprint_dependencies(monkeypatch) -> None:
    raw = source_text(year=2025, kinds=KINDS).getvalue().encode()
    before = projection_receipt.fingerprint(
        raw, year=2025, round_="legislativas", source_kind="official"
    )
    read_bytes = Path.read_bytes
    for relative in ("ingest/national.py", "db.py"):
        dependency = Path(projection_receipt.__file__).parent / relative
        with monkeypatch.context() as patch:
            patch.setattr(
                Path,
                "read_bytes",
                lambda path: (
                    read_bytes(path) + (b"\n# transform changed" if path == dependency else b"")
                ),
            )
            assert (
                projection_receipt.fingerprint(
                    raw, year=2025, round_="legislativas", source_kind="official"
                )
                != before
            )


def test_curated_collection_reaches_only_positive_party_keys(tmp_path) -> None:
    from test_cli import FakeFetcher

    from etl import __main__ as cli

    source_id = "national/kind-collection"
    sources = {
        "national": [
            {
                "id": source_id,
                "source": "example.test",
                "mime": "text/csv",
                "source_url": "https://example.invalid/kinds.csv",
                "notes": "synthetic kinds",
                "election_year": 2025,
                "election_round": "legislativas",
                "filename": "kinds.csv",
            }
        ]
    }
    local_root = tmp_path / "archive"
    manifest_path = tmp_path / "manifest.json"
    cli.fetch_source(
        source_id,
        sources=sources,
        fetcher=FakeFetcher(payload=source_text(year=2025, kinds=KINDS).getvalue().encode()),
        local_root=local_root,
        manifest_path=manifest_path,
    )
    keys = cli.collect_national_party_keys(
        sources, local_root=local_root, manifest_path=manifest_path
    )
    assert len(keys) == 1
    assert all(key[-1] is not None for key in keys)


@pytest.mark.owned_database
def test_vote_kind_migration_down_and_reapply_preserve_positive_evidence(owned_database) -> None:
    # Restoring function definitions requires their original owners, including
    # postgres in the CI bootstrap. Keep this in the administrative test phase,
    # never grant a superuser role to the ordinary verification login.
    root = Path(__file__).parents[2] / "supabase/migrations"
    forward = (root / "20261015300000_non_positive_vote_kinds.sql").read_text()
    down = (root / "down/20261015300000_non_positive_vote_kinds.down.sql").read_text()
    with owned_database.connect() as conn:
        before = conn.execute("select count(*),sum(votes) from result_row").fetchone()
        if (
            conn.execute(
                "select 1 from information_schema.columns where table_schema='public' "
                "and table_name='result_row' and column_name='vote_kind'"
            ).fetchone()
            is None
        ):
            conn.execute(forward.removeprefix("begin;\n").removesuffix("commit;\n"))
        conn.execute(down.removeprefix("begin;\n").removesuffix("commit;\n"))
        assert (
            conn.execute(
                "select 1 from information_schema.columns where table_schema='public' "
                "and table_name='result_row' and column_name='vote_kind'"
            ).fetchone()
            is None
        )
        conn.execute(forward.removeprefix("begin;\n").removesuffix("commit;\n"))
        assert conn.execute("select count(*),sum(votes) from result_row").fetchone() == before
        conn.rollback()


def test_unknown_vote_kind_is_reported_as_a_reason_not_persisted(capsys) -> None:
    rows = list(
        iter_national_rows(
            source_text(year=2023, kinds=("UNKNOWN",)),
            archive_entry_id="national/2023-paso",
            election_year=2023,
            election_round="paso",
        )
    )
    assert rows == []
    assert "votos_tipo='UNKNOWN'" in capsys.readouterr().err
