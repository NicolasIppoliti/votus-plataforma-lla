"""Projection reuse is driven through production archive ingestion, never a mock DB."""

import io
import sys
import time
import uuid
import zipfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Barrier

import psycopg
import pytest
from test_cli import NATIONAL_CSV, TEST_DSN, FakeFetcher, _require_ephemeral_postgres

from etl import __main__ as cli
from etl import projection_receipt
from etl.ingest_metrics import IngestMetrics


@pytest.fixture(scope="module", autouse=True)
def receipt_schema():
    _require_ephemeral_postgres()
    migration = (
        Path(__file__).parents[2] / "supabase/migrations/20261015200000_projection_receipt.sql"
    ).read_text()
    with psycopg.connect(TEST_DSN) as conn:
        if conn.execute("select to_regclass('public.projection_receipt')").fetchone()[0] is None:
            conn.execute(migration)
        else:
            # Local incremental development may have installed the table before
            # its final role guards. Synchronize only this new table's revokes;
            # never reset the stack or touch unrelated schema/data/role attributes.
            guards = migration[migration.index("do $$ begin") : migration.index("end $$;") + 7]
            conn.execute(guards)


@pytest.fixture
def archived_source(tmp_path):
    ids = []

    def create(payload=NATIONAL_CSV.encode()):
        source_id = f"national/receipt-{uuid.uuid4()}"
        ids.append(source_id)
        sources = {
            "national": [
                {
                    "id": source_id,
                    "source": "example.test",
                    "source_url": "https://example.test/receipt.csv",
                    "mime": (
                        "application/zip" if zipfile.is_zipfile(io.BytesIO(payload)) else "text/csv"
                    ),
                    "election_year": 2025,
                    "election_round": "legislativas",
                    "notes": "receipt integration fixture",
                    "filename": source_id.split("/")[1] + ".csv",
                }
            ]
        }
        manifest = tmp_path / "manifest.json"
        archive = tmp_path / "archive"
        cli.fetch_source(
            source_id,
            sources=sources,
            fetcher=FakeFetcher(payload=payload),
            local_root=archive,
            manifest_path=manifest,
        )
        return source_id, dict(
            database_url=TEST_DSN,
            year=2025,
            round_="legislativas",
            sources=sources,
            local_root=archive,
            manifest_path=manifest,
        )

    yield create
    with psycopg.connect(TEST_DSN) as conn:
        for source_id in ids:
            for table in projection_receipt.TABLES:
                conn.execute(
                    psycopg.sql.SQL("delete from {} where archive_entry_id=%s").format(
                        psycopg.sql.Identifier(table)
                    ),
                    (source_id,),
                )
            conn.execute("delete from archive_entry where id=%s", (source_id,))


def zipped_fixture():
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("results.csv", NATIONAL_CSV)
    return output.getvalue()


def test_unchanged_replay_and_force_rebuild(archived_source, capsys, monkeypatch):
    source_id, kwargs = archived_source(zipped_fixture())
    assert cli.ingest_source(source_id, **kwargs) == 2
    assert "projection rebuilt" in capsys.readouterr().out
    with monkeypatch.context() as patch:

        def must_not_parse(*args, **kwargs):
            raise AssertionError("reuse must avoid extraction and parsing")

        patch.setattr(cli, "national_results_text", must_not_parse)
        metrics = IngestMetrics()
        assert cli.ingest_source(source_id, metrics=metrics, **kwargs) == 2
    assert "projection reused" in capsys.readouterr().out
    assert metrics.data["records_seen"] is None
    assert metrics.data["rows_emitted"] is None
    assert metrics.data["rows_written"] == 0
    assert metrics.data["rows_committed"] == 0
    assert cli.ingest_source(source_id, force_rebuild=True, **kwargs) == 2
    assert "projection rebuilt" in capsys.readouterr().out


@pytest.mark.parametrize("change", ["missing", "corrupt", "votes", "deleted", "completeness"])
def test_changed_or_missing_projection_rebuilds(archived_source, capsys, change):
    source_id, kwargs = archived_source()
    cli.ingest_source(source_id, **kwargs)
    capsys.readouterr()
    with psycopg.connect(TEST_DSN) as conn:
        statements = {
            "missing": "delete from projection_receipt where archive_entry_id=%s",
            "corrupt": (
                "update projection_receipt set projection='{}'::jsonb where archive_entry_id=%s"
            ),
            "votes": "update result_row set votes=votes+1 where archive_entry_id=%s",
            "deleted": "delete from result_row where archive_entry_id=%s",
            "completeness": (
                "insert into official_mesa_completeness_quarantine "
                "(archive_entry_id,election_id,scope,reason) "
                "select archive_entry_id,election_id,'status','receipt test' "
                "from projection_receipt where archive_entry_id=%s"
            ),
        }
        conn.execute(statements[change], (source_id,))
    assert cli.ingest_source(source_id, **kwargs) == 2
    assert "projection rebuilt" in capsys.readouterr().out
    assert cli.ingest_source(source_id, **kwargs) == 2
    assert "projection reused" in capsys.readouterr().out


def test_changed_transform_dependency_rebuilds(archived_source, capsys, monkeypatch):
    source_id, kwargs = archived_source()
    cli.ingest_source(source_id, **kwargs)
    capsys.readouterr()
    monkeypatch.setattr(
        projection_receipt, "TRANSFORM_FILES", (*projection_receipt.TRANSFORM_FILES, "__init__.py")
    )
    cli.ingest_source(source_id, **kwargs)
    assert "projection rebuilt" in capsys.readouterr().out
    cli.ingest_source(source_id, **kwargs)
    assert "projection reused" in capsys.readouterr().out


def test_receipt_rebuild_preserves_other_source_kind(archived_source):
    source_id, kwargs = archived_source()
    cli.ingest_source(source_id, **kwargs)
    with psycopg.connect(TEST_DSN) as conn:
        row_id = conn.execute(
            "select id from result_row where archive_entry_id=%s limit 1", (source_id,)
        ).fetchone()[0]
        conn.execute("update result_row set source_kind='fiscalizacion' where id=%s", (row_id,))
    cli.ingest_source(source_id, **kwargs)
    cli.ingest_source(source_id, **kwargs)
    with psycopg.connect(TEST_DSN) as conn:
        assert conn.execute(
            "select source_kind from result_row where id=%s", (row_id,)
        ).fetchone() == ("fiscalizacion",)
        assert conn.execute(
            "select count(*) from result_row where archive_entry_id=%s and source_kind='official'",
            (source_id,),
        ).fetchone() == (2,)


def test_changed_transform_to_empty_replaces_previous_rows(archived_source, monkeypatch, capsys):
    source_id, kwargs = archived_source()
    assert cli.ingest_source(source_id, **kwargs) == 2
    capsys.readouterr()
    monkeypatch.setattr(
        projection_receipt, "TRANSFORM_FILES", (*projection_receipt.TRANSFORM_FILES, "__init__.py")
    )
    monkeypatch.setattr(cli, "iter_national_rows", lambda *args, **kwargs: iter(()))
    assert cli.ingest_source(source_id, **kwargs) == 0
    assert "projection rebuilt" in capsys.readouterr().out
    assert cli.ingest_source(source_id, **kwargs) == 0
    assert "projection reused" in capsys.readouterr().out
    with psycopg.connect(TEST_DSN) as conn:
        assert conn.execute(
            "select count(*) from result_row where archive_entry_id=%s", (source_id,)
        ).fetchone() == (0,)


def test_empty_projection_reuses_verified_empty(archived_source, capsys):
    source_id, kwargs = archived_source(NATIONAL_CSV.replace(",POSITIVO,", ",EN BLANCO,").encode())
    assert cli.ingest_source(source_id, **kwargs) == 0
    assert "projection rebuilt" in capsys.readouterr().out
    assert cli.ingest_source(source_id, **kwargs) == 0
    assert "projection reused" in capsys.readouterr().out


@pytest.mark.parametrize("first_load", [True, False])
@pytest.mark.parametrize("failure", [RuntimeError, KeyboardInterrupt])
def test_late_failure_never_publishes_partial_receipt(
    archived_source, monkeypatch, first_load, failure
):
    source_id, kwargs = archived_source()
    if not first_load:
        cli.ingest_source(source_id, **kwargs)
    with psycopg.connect(TEST_DSN) as conn:
        before = conn.execute(
            "select projection from projection_receipt where archive_entry_id=%s", (source_id,)
        ).fetchall()
        rows = conn.execute(
            "select id,votes from result_row where archive_entry_id=%s order by id", (source_id,)
        ).fetchall()
    publish = projection_receipt.publish

    def fail_after_publish(*args, **kwargs):
        publish(*args, **kwargs)
        raise failure("late failure after receipt publication")

    monkeypatch.setattr(projection_receipt, "publish", fail_after_publish)
    with pytest.raises(failure, match="late failure"):
        cli.ingest_source(source_id, force_rebuild=True, **kwargs)
    with psycopg.connect(TEST_DSN) as conn:
        assert (
            conn.execute(
                "select projection from projection_receipt where archive_entry_id=%s", (source_id,)
            ).fetchall()
            == before
        )
        assert (
            conn.execute(
                "select id,votes from result_row where archive_entry_id=%s order by id",
                (source_id,),
            ).fetchall()
            == rows
        )


def test_concurrent_first_scope_has_one_rebuild_one_reuse(archived_source):
    source_id, kwargs = archived_source()
    barrier = Barrier(2)

    def run(_):
        barrier.wait(timeout=5)
        metrics = IngestMetrics()
        count = cli.ingest_source(source_id, metrics=metrics, **kwargs)
        return count, metrics.data["projection_outcome"]

    with ThreadPoolExecutor(max_workers=2) as executor:
        outcomes = list(executor.map(run, range(2)))
    assert sorted(outcomes) == [(2, "rebuilt"), (2, "reused")]


def test_measure_skip_rebuild_elapsed_and_disk(archived_source):
    payload = zipped_fixture()
    source_id, kwargs = archived_source(payload)
    cli.ingest_source(source_id, **kwargs)

    def size():
        with psycopg.connect(TEST_DSN) as conn:
            return conn.execute(
                "select sum(pg_total_relation_size(t::regclass)) from unnest(%s::text[]) t",
                (list(projection_receipt.TABLES) + ["projection_receipt"],),
            ).fetchone()[0]

    results = []
    for force in (True, False):
        before = size()
        start = time.perf_counter()
        cli.ingest_source(source_id, force_rebuild=force, **kwargs)
        results.append(
            ("rebuild" if force else "reuse", time.perf_counter() - start, int(before), int(size()))
        )
    with psycopg.connect(TEST_DSN) as conn:
        server = conn.execute("show server_version").fetchone()[0]
    print("MEASUREMENT", results)
    print(
        "CONDITIONS",
        sys.version.split()[0],
        psycopg.__version__,
        server,
        "archive_bytes",
        len(payload),
        "member_bytes",
        len(NATIONAL_CSV.encode()),
    )


def test_identity_covers_companions_members_election_and_kind():
    def archive(companion, name="results.csv"):
        output = io.BytesIO()
        with zipfile.ZipFile(output, "w") as zip_:
            zip_.writestr(name, NATIONAL_CSV)
            zip_.writestr("localesDeVotacionyMesas.csv", companion)
        return output.getvalue()

    def identify(raw, year=2025, kind="official"):
        return projection_receipt.fingerprint(
            raw, year=year, round_="legislativas", source_kind=kind
        )

    raw = archive("companion-a")
    identity = identify(raw)
    assert identity != identify(archive("companion-b"))
    assert identity != identify(archive("companion-a", "renamed.csv"))
    assert identity != identify(raw, year=2023)
    assert identity != identify(raw, kind="fiscalizacion")


def test_other_archive_scope_survives_rebuild(archived_source):
    first, first_kwargs = archived_source()
    second, second_kwargs = archived_source()
    cli.ingest_source(first, **first_kwargs)
    cli.ingest_source(second, **second_kwargs)
    with psycopg.connect(TEST_DSN) as conn:
        before = conn.execute(
            "select id,votes from result_row where archive_entry_id=%s order by id", (second,)
        ).fetchall()
    cli.ingest_source(first, force_rebuild=True, **first_kwargs)
    with psycopg.connect(TEST_DSN) as conn:
        assert (
            conn.execute(
                "select id,votes from result_row where archive_entry_id=%s order by id", (second,)
            ).fetchall()
            == before
        )


def test_receipt_grants_and_rls_are_etl_only(archived_source):
    source_id, kwargs = archived_source()
    cli.ingest_source(source_id, **kwargs)
    with psycopg.connect(TEST_DSN) as conn:
        for role in ("anon", "authenticated", "service_role"):
            if conn.execute("select to_regrole(%s)", (role,)).fetchone()[0] is not None:
                for privilege in ("select", "insert", "update", "delete"):
                    assert conn.execute(
                        "select has_table_privilege(%s,'public.projection_receipt',%s)",
                        (role, privilege),
                    ).fetchone() == (False,)
        for privilege in ("select", "insert", "update", "delete"):
            assert conn.execute(
                "select has_table_privilege('etl_writer','public.projection_receipt',%s)",
                (privilege,),
            ).fetchone() == (True,)
        conn.execute("set local role etl_writer")
        assert conn.execute(
            "select count(*) from projection_receipt where archive_entry_id=%s", (source_id,)
        ).fetchone() == (1,)


def test_import_resolves_inside_worktree():
    assert Path(cli.__file__).resolve().parents[1] == Path(__file__).resolve().parents[1]


def test_cli_force_flag_is_wired(archived_source, monkeypatch, capsys):
    source_id, kwargs = archived_source()
    monkeypatch.setattr(cli, "load_sources", lambda path: kwargs["sources"])
    args = [
        "--local-root",
        str(kwargs["local_root"]),
        "--manifest-path",
        str(kwargs["manifest_path"]),
        "ingest",
        "--source",
        source_id,
        "--year",
        "2025",
        "--round",
        "legislativas",
        "--database-url",
        TEST_DSN,
    ]
    assert cli.main(args) == 0
    assert "projection rebuilt" in capsys.readouterr().out
    assert cli.main(args) == 0
    assert "projection reused" in capsys.readouterr().out
    assert cli.main([*args, "--force-rebuild"]) == 0
    assert "projection rebuilt" in capsys.readouterr().out
