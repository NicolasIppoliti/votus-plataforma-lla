"""Reporting/control-flow tests, not PostgreSQL persistence or rollback evidence."""

import csv
import hashlib
import io
import json
import os
import socket
import tempfile
import zipfile
from contextlib import nullcontext
from pathlib import Path

import psycopg
import pytest

from etl.__main__ import main
from etl.ingest.national import iter_national_rows
from etl.ingest_metrics import IngestMetrics

DSN = "host=/nonexistent-votus-metrics-test dbname=synthetic connect_timeout=1"
HEADER = (
    "distrito_id,distrito_nombre,seccion_id,seccion_nombre,circuito_id,circuito_nombre,"
    "mesa_id,cargo_nombre,agrupacion_id,votos_tipo,votos_cantidad,lista_numero,mesa_tipo"
).split(",")


def row(**changes):
    values = dict(
        zip(
            HEADER,
            [
                "9",
                "Synthetic\nDistrict",
                "8",
                "Section",
                "7",
                "Circuit",
                "1",
                "CATEGORY",
                "44",
                "POSITIVO",
                "10",
                "A",
                "NATIVOS",
            ],
        )
    )
    return values | changes


def csv_bytes(rows):
    stream = io.StringIO(newline="")
    writer = csv.DictWriter(stream, fieldnames=HEADER)
    writer.writeheader()
    writer.writerows(rows)
    return stream.getvalue().encode()


@pytest.fixture(autouse=True)
def external_guards(monkeypatch, tmp_path):
    def forbidden(*args, **kwargs):
        raise AssertionError("unmocked external connection")

    monkeypatch.setattr(psycopg, "connect", forbidden)
    monkeypatch.setattr(socket, "create_connection", forbidden)
    monkeypatch.setattr(socket.socket, "connect", forbidden)
    monkeypatch.setattr(socket, "getaddrinfo", forbidden)
    monkeypatch.setattr(tempfile, "tempdir", str(tmp_path))


class Connection:
    """Stateless responses at the driver boundary; never executes or models SQL."""

    def __init__(self):
        self.connections = self.commits = self.rollbacks = self.batches = 0
        self.fail_batch = None
        self.after_commit = lambda: None

    def cursor(self):
        return nullcontext(self)

    def transaction(self):
        return nullcontext()

    def execute(self, query, params=()):
        text = " ".join((query if isinstance(query, str) else query.as_string()).split())
        self.response = None
        if text.startswith("select capability is not distinct"):
            return
        if text.startswith("select source_kind from archive_entry"):
            self.response = ("official",)
        elif text.startswith(("insert into election", "insert into category")):
            self.response = ("synthetic-id",)
        elif text.startswith("select v.distrito"):
            self.response = [
                (*key, "jurisdiction-id", None, None, None, None) for key in zip(*params[:5])
            ]
        else:
            assert text.startswith(
                (
                    "insert into archive_entry",
                    "delete from result_row",
                    "LOCK TABLE jurisdiction",
                )
            ), text

    def fetchone(self):
        return self.response

    def fetchall(self):
        return self.response

    def executemany(self, query, params):
        if "insert into result_row" in query:
            self.batches += 1
            if self.batches == self.fail_batch:
                raise psycopg.OperationalError("synthetic private exception detail")
        else:
            assert "update jurisdiction" in query

    def commit(self):
        self.commits += 1
        self.after_commit()

    def rollback(self):
        self.rollbacks += 1

    def close(self):
        pass


@pytest.fixture
def scenario(tmp_path, monkeypatch):
    def prepare(rows, *, capability="national", source_kind=None, payload=None):
        data = csv_bytes(rows) if payload is None else payload
        archive = tmp_path / "archive" / capability
        archive.mkdir(parents=True, exist_ok=True)
        source_file = archive / "synthetic.csv"
        source_file.write_bytes(data)
        source = {
            "id": "synthetic",
            "source": "synthetic",
            "source_url": "https://example.invalid",
            "mime": "text/csv",
            "notes": "",
            "election_year": 2023,
            "election_round": "paso",
        }
        if capability == "fiscalizacion":
            source.update(source_kind="fiscalizacion", upload="never")
        if source_kind is not None:
            source["source_kind"] = source_kind
        sources = tmp_path / "sources.yaml"
        sources.write_text(json.dumps({capability: [source]}))
        manifest = tmp_path / "manifest.json"
        manifest.write_text(
            json.dumps(
                [
                    source
                    | {
                        "capability": capability,
                        "archived_path": str(source_file),
                        "sha256": hashlib.sha256(data).hexdigest(),
                        "bytes": len(data),
                        "fetched_at": "2023-01-01T00:00:00Z",
                        "status": "ok",
                    }
                ]
            )
        )
        conn = Connection()

        def connect(dsn):
            assert dsn == DSN
            conn.connections += 1
            return conn

        monkeypatch.setattr(psycopg, "connect", connect)
        argv = [
            "--sources-path",
            str(sources),
            "--manifest-path",
            str(manifest),
            "--local-root",
            str(tmp_path / "archive"),
            "ingest",
            "--source",
            "synthetic",
            "--year",
            "2023",
            "--round",
            "paso",
            "--database-url",
            DSN,
            "--party-map-path",
            str(tmp_path / "party-map.yaml"),
            "--crosswalk-path",
            str(tmp_path / "crosswalk.yaml"),
        ]
        return argv, conn, tmp_path / "metrics.json"

    return prepare


def test_no_flag_cli_baseline(scenario, capsys):
    argv, conn, output = scenario([row()])
    assert main(argv) == 0
    assert capsys.readouterr() == ("ingested 1 rows from synthetic\n", "")
    assert (conn.commits, conn.rollbacks) == (1, 0)
    assert not output.exists()


def test_cli_json_counts_logical_records_once_and_preserves_paso_lists(scenario, capsys):
    argv, conn, output = scenario([row(), row(lista_numero="B")])
    assert main([*argv, "--metrics-output", str(output)]) == 0
    assert capsys.readouterr() == ("ingested 2 rows from synthetic\n", "")
    assert json.loads(output.read_text()) == {
        "version": 1,
        "scope": {
            "source_id": "synthetic",
            "year": 2023,
            "round": "paso",
            "capability": "national",
            "source_kind": "official",
        },
        "status": "succeeded",
        "commit_returned": True,
        "first_pass": "complete",
        "iteration": "complete",
        "records_seen": 2,
        "rows_emitted": 2,
        "candidate_keys": 2,
        "exclusions": {},
        "ambiguous_categories": {},
        "companion_conflicts": None,
        "categories": {
            "CATEGORY": {"records_seen": 2, "rows_emitted": 2, "exclusions": {}},
        },
    }
    assert (conn.commits, conn.rollbacks) == (1, 0)


def test_cli_reports_truncated_record_without_a_category(scenario):
    payload = csv_bytes([row()]) + b"9,District\n"
    argv, _, output = scenario([], payload=payload)
    assert main([*argv, "--metrics-output", str(output)]) == 0
    report = json.loads(output.read_text())
    assert report["categories"][""] == {
        "records_seen": 1,
        "rows_emitted": 0,
        "exclusions": {
            "votos_tipo=None": {"rows": 1, "parseable_votes": 0, "unreadable_vote_rows": 1},
        },
    }


def test_cli_preserves_raw_categories_and_reused_mesas_across_districts(scenario):
    argv, _, output = scenario(
        [
            row(agrupacion_id="135", lista_numero="3016"),
            row(agrupacion_id="135", lista_numero="3017"),
            row(distrito_id="10", agrupacion_id="135", lista_numero="3016"),
            row(cargo_nombre=" LOCAL CATEGORY "),
            row(cargo_nombre="EXCLUDED ONLY", votos_tipo="NULO", votos_cantidad="6"),
        ]
    )
    assert main([*argv, "--metrics-output", str(output)]) == 0
    report = json.loads(output.read_text())
    assert report["categories"] == {
        "CATEGORY": {"records_seen": 3, "rows_emitted": 3, "exclusions": {}},
        " LOCAL CATEGORY ": {"records_seen": 1, "rows_emitted": 1, "exclusions": {}},
        "EXCLUDED ONLY": {
            "records_seen": 1,
            "rows_emitted": 0,
            "exclusions": {
                "votos_tipo='NULO'": {
                    "rows": 1,
                    "parseable_votes": 6,
                    "unreadable_vote_rows": 0,
                },
            },
        },
    }
    assert report["ambiguous_categories"] == {}


def test_cli_reports_exclusion_subsets_and_ambiguous_categories(scenario, capsys):
    argv, _, output = scenario(
        [
            row(),
            row(lista_numero="B"),
            row(mesa_id="2", votos_cantidad="3"),
            row(mesa_id="2", votos_cantidad="4"),
            row(votos_tipo="EN BLANCO", votos_cantidad="5"),
            row(votos_tipo="EN BLANCO", votos_cantidad="unknown"),
            row(votos_cantidad="unknown"),
        ]
    )
    assert main(argv) == 0
    baseline_output = capsys.readouterr()
    assert main([*argv, "--metrics-output", str(output)]) == 0
    assert capsys.readouterr() == baseline_output
    report = json.loads(output.read_text())
    assert (report["records_seen"], report["rows_emitted"], report["candidate_keys"]) == (7, 2, 3)
    assert report["exclusions"] == {
        "votos_tipo='EN BLANCO'": {"rows": 2, "parseable_votes": 5, "unreadable_vote_rows": 1},
        "unreadable votos_cantidad": {"rows": 1, "parseable_votes": 0, "unreadable_vote_rows": 1},
    }
    assert report["ambiguous_categories"] == {"CATEGORY": {"rows": 2, "votes": 7, "keys": 1}}
    assert report["categories"] == {
        "CATEGORY": {
            "records_seen": 7,
            "rows_emitted": 2,
            "exclusions": {
                "votos_tipo='EN BLANCO'": {
                    "rows": 2,
                    "parseable_votes": 5,
                    "unreadable_vote_rows": 1,
                },
                "unreadable votos_cantidad": {
                    "rows": 1,
                    "parseable_votes": 0,
                    "unreadable_vote_rows": 1,
                },
                "ambiguous natural key": {
                    "rows": 2,
                    "parseable_votes": 7,
                    "unreadable_vote_rows": 0,
                },
            },
        },
    }


@pytest.mark.parametrize(
    "capability,kind",
    [
        ("pba", None),
        ("fiscalizacion", None),
        ("national", "fiscalizacion"),
    ],
)
def test_metrics_rejects_unsupported_scope_before_connection(scenario, capsys, capability, kind):
    argv, conn, output = scenario([], capability=capability, source_kind=kind)
    assert main([*argv, "--metrics-output", str(output)]) == 1
    assert capsys.readouterr() == ("", "error: metrics require national official ingestion\n")
    assert conn.connections == 0
    report = json.loads(output.read_text())
    assert report["scope"] is None
    assert report["records_seen"] is None
    assert report["commit_returned"] is False


def test_cli_companion_quarantines_have_separate_nonadditive_breakdowns(scenario):
    archive = io.BytesIO()
    with zipfile.ZipFile(archive, "w") as zipped:
        zipped.writestr(
            "results.csv",
            csv_bytes(
                [
                    row(),
                    row(mesa_id="2", votos_cantidad="3"),
                    row(mesa_id="2", circuito_id="8", votos_cantidad="4"),
                ]
            ),
        )
        zipped.writestr(
            "companion.csv",
            (
                "distrito_id,seccion_id,mesa_id,localvotacion_codigo,localvotacion_nombre\n"
                "9,8,1,E,First\n9,8,1,E,Second\n9,8,2,F,Third\n9,8,3,,\n"
            ),
        )
    argv, _, output = scenario([], payload=archive.getvalue())
    assert main([*argv, "--metrics-output", str(output)]) == 0
    report = json.loads(output.read_text())
    assert (report["records_seen"], report["rows_emitted"], report["candidate_keys"]) == (3, 0, 2)
    assert report["ambiguous_categories"] == {}
    assert report["exclusions"] == {
        "ambiguous result circuits for establecimiento companion": {
            "rows": 2,
            "parseable_votes": 7,
            "unreadable_vote_rows": 0,
        },
    }
    assert report["categories"] == {
        "CATEGORY": {
            "records_seen": 3,
            "rows_emitted": 0,
            "exclusions": {
                "mesa_metadata_conflict": {
                    "rows": 1,
                    "parseable_votes": 10,
                    "unreadable_vote_rows": 0,
                },
                "establishment_code_multiple_names": {
                    "rows": 1,
                    "parseable_votes": 10,
                    "unreadable_vote_rows": 0,
                },
                "ambiguous result circuits for establecimiento companion": {
                    "rows": 2,
                    "parseable_votes": 7,
                    "unreadable_vote_rows": 0,
                },
            },
        },
    }
    assert report["companion_conflicts"] == {
        "input_exclusions": {"absent establecimiento code or name": 1},
        "input_unique_conflict_keys": 1,
        "input_conflict_keys": {
            "mesa_metadata_conflict": 1,
            "establishment_code_multiple_names": 1,
        },
        "result_rows": 1,
        "result_votes": 10,
        "result_keys": 1,
        "result_reasons": {
            "mesa_metadata_conflict": {"rows": 1, "votes": 10},
            "establishment_code_multiple_names": {"rows": 1, "votes": 10},
        },
    }


@pytest.mark.parametrize(
    "case,expected",
    [
        ("empty", (0, "succeeded", "complete", "complete", 0, 0, 0, {})),
        ("header", (1, "failed", "not_started", "not_started", None, None, None, None)),
        ("partial", (1, "failed", "partial", "not_started", 2, None, 1, None)),
    ],
)
def test_cli_empty_and_schema_failures_distinguish_unknown_counts(scenario, case, expected):
    rows = [row(), row(mesa_tipo="UNSUPPORTED")] if case == "partial" else []
    argv, conn, output = scenario(rows, payload=b"unexpected\n" if case == "header" else None)
    result = main([*argv, "--metrics-output", str(output)])
    report = json.loads(output.read_text())
    assert (
        result,
        *(
            report[key]
            for key in (
                "status",
                "first_pass",
                "iteration",
                "records_seen",
                "rows_emitted",
                "candidate_keys",
                "ambiguous_categories",
            )
        ),
    ) == expected
    assert report["categories"] == (
        {}
        if case == "empty"
        else None
        if case == "header"
        else {
            "CATEGORY": {"records_seen": 2, "rows_emitted": None, "exclusions": {}},
        }
    )
    assert report["commit_returned"] is (case == "empty")
    assert (conn.commits, conn.rollbacks) == ((1, 0) if case == "empty" else (0, 1))


def test_late_batch_failure_preserves_first_pass_and_original_exception(scenario):
    argv, conn, output = scenario([row(mesa_id=str(i)) for i in range(1, 2002)])
    conn.fail_batch = 2
    with pytest.raises(psycopg.OperationalError, match="synthetic private exception detail"):
        main([*argv, "--metrics-output", str(output)])
    report = json.loads(output.read_text())
    assert (report["first_pass"], report["iteration"]) == ("complete", "partial")
    assert (report["records_seen"], report["rows_emitted"], report["candidate_keys"]) == (
        2001,
        2000,
        2001,
    )
    assert report["categories"] == {
        "CATEGORY": {"records_seen": 2001, "rows_emitted": 2000, "exclusions": {}},
    }
    assert report["status"] == "failed"
    assert report["commit_returned"] is False
    assert (conn.commits, conn.rollbacks) == (0, 1)
    assert "private exception detail" not in output.read_text()
    assert DSN not in output.read_text()


def test_public_iterator_second_pass_io_failure_keeps_partial_emission():
    class FailingStream(io.StringIO):
        seeks = 0

        def seek(self, *args):
            self.seeks += 1
            return super().seek(*args)

        def readline(self, *args):
            if self.seeks == 2 and self.tell() >= len(csv_bytes([row()]).decode()):
                raise OSError("synthetic second-pass failure")
            return super().readline(*args)

    metrics = IngestMetrics()
    iterator = iter_national_rows(
        FailingStream(csv_bytes([row(), row(lista_numero="B")]).decode()),
        archive_entry_id="synthetic",
        election_year=2023,
        election_round="paso",
        metrics=metrics,
    )
    assert metrics.data["records_seen"] is None
    assert next(iterator).list_id == "44-A"
    with pytest.raises(OSError, match="synthetic second-pass failure"):
        next(iterator)
    assert (metrics.data["first_pass"], metrics.data["iteration"]) == ("complete", "partial")
    assert (metrics.data["records_seen"], metrics.data["rows_emitted"]) == (2, 1)
    assert metrics.data["commit_returned"] is False


@pytest.mark.parametrize(
    "case",
    [
        "existing",
        "directory",
        "missing_parent",
        "denied",
        "archive",
        "archive_symlink",
        "sources",
        "manifest",
        "config",
        "dangling",
    ],
)
def test_unsafe_destinations_refuse_before_connection(scenario, tmp_path, monkeypatch, case):
    argv, conn, output = scenario([row()])
    if case == "existing":
        output.write_text("keep")
    elif case == "directory":
        output.mkdir()
    elif case == "missing_parent":
        output = tmp_path / "absent" / "report.json"
    elif case == "denied":
        original_open = Path.open

        def deny_report(path, *args, **kwargs):
            if path == output:
                raise PermissionError("synthetic denial")
            return original_open(path, *args, **kwargs)

        monkeypatch.setattr(Path, "open", deny_report)
    elif case in {"archive", "archive_symlink"}:
        parent = tmp_path / "archive"
        if case == "archive_symlink":
            parent = tmp_path / "alias"
            parent.symlink_to(tmp_path / "archive", target_is_directory=True)
        output = parent / "new.json"
    elif case in {"sources", "manifest"}:
        output = tmp_path / ("sources.yaml" if case == "sources" else "manifest.json")
    elif case == "config":
        argv += ["--party-map-path", str(output)]
    elif case == "dangling":
        output.symlink_to(tmp_path / "absent-target")
    before = output.read_bytes() if output.is_file() else None
    assert main([*argv, "--metrics-output", str(output)]) == 1
    assert conn.connections == 0
    if before is not None:
        assert output.read_bytes() == before
    elif case not in {"directory", "dangling"}:
        assert not output.exists()


@pytest.mark.parametrize("fail_loading", [False, True])
def test_publication_failure_never_rolls_back_a_returned_commit_or_masks_ingest(
    scenario,
    monkeypatch,
    capsys,
    fail_loading,
):
    argv, conn, output = scenario([row()])
    conn.fail_batch = 1 if fail_loading else None

    def unavailable(_fd):
        raise OSError("synthetic publication failure")

    monkeypatch.setattr(os, "fsync", unavailable)
    if fail_loading:
        with pytest.raises(psycopg.OperationalError, match="synthetic private exception detail"):
            main([*argv, "--metrics-output", str(output)])
    else:
        assert main([*argv, "--metrics-output", str(output)]) == 1
    captured = capsys.readouterr()
    observed = "false" if fail_loading else "true"
    assert captured.err == (
        f"error: metrics publication failed; commit_returned={observed} "
        "(application observation, not a rollback claim)\n"
    )
    assert captured.out == ("" if fail_loading else "ingested 1 rows from synthetic\n")
    assert (conn.commits, conn.rollbacks) == ((0, 1) if fail_loading else (1, 0))
    assert json.loads(output.read_text())["commit_returned"] is (not fail_loading)


@pytest.mark.parametrize("stage", ["connect", "commit", "close"])
def test_driver_failures_only_record_a_normally_returned_commit(scenario, monkeypatch, stage):
    argv, conn, output = scenario([row()])

    def fail(*args):
        raise psycopg.OperationalError("synthetic private failure")

    monkeypatch.setattr(psycopg if stage == "connect" else conn, stage, fail)
    with pytest.raises(psycopg.OperationalError, match="synthetic private failure"):
        main([*argv, "--metrics-output", str(output)])
    report = json.loads(output.read_text())
    assert report["status"] == "failed"
    assert report["commit_returned"] is (stage == "close")
    assert report["records_seen"] == (None if stage == "connect" else 1)
    assert report["iteration"] == ("not_started" if stage == "connect" else "complete")
    assert conn.rollbacks == (1 if stage == "commit" else 0)
    assert "private failure" not in output.read_text()


def test_rejected_election_reports_registered_scope_without_starting_database(scenario):
    argv, conn, output = scenario([row()])
    argv[argv.index("--year") + 1] = "2025"
    assert main([*argv, "--metrics-output", str(output)]) == 1
    report = json.loads(output.read_text())
    assert report["scope"]["year"] == 2023
    assert report["scope"]["round"] == "paso"
    assert report["records_seen"] is None
    assert report["status"] == "failed"
    assert conn.connections == 0
