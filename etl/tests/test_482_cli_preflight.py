"""#482 real CLI dispatch/archive-stream/loader regressions with a DB boundary double.

No claim of PostgreSQL durability: connection, projection receipts and SQL writes
are doubled; argparse, ingest orchestration, ZIP streaming, parser, loader and
jurisdiction-name validation are real. Fixtures are entirely synthetic/in memory.
"""

import io
import zipfile
from contextlib import contextmanager
from copy import deepcopy

import pytest
from test_national_preflight import COMPANION, source

from etl import __main__ as cli
from etl import db, projection_receipt
from etl.ingest import national

MUTATION = None  # Temporarily set only for the documented mutation RED runs.


class Connection:
    def __init__(self):
        self.state = {
            "rows": ["previous result"],
            "names": {},
            "archive": "previous archive",
            "receipt": "previous receipt",
            "completeness": "previous completeness",
        }
        self.initial = deepcopy(self.state)
        self.inserted = 0
        self.committed = False
        self.rolled_back = False
        self.closed = False

    @contextmanager
    def cursor(self):
        yield self

    def execute(self, sql, params=None):
        self.sql = sql

    def fetchone(self):
        return ("read committed",) if self.sql.startswith("show") else ("election",)

    @contextmanager
    def transaction(self):
        before = deepcopy(self.state)
        try:
            yield
        except BaseException:
            self.state = before
            raise

    def commit(self):
        self.committed = True

    def rollback(self):
        self.state = deepcopy(self.initial)
        self.rolled_back = True

    def close(self):
        self.closed = True


@pytest.fixture
def ingest(monkeypatch):
    conn = Connection()
    entry = {
        "id": "national/482-synthetic",
        "capability": "national",
        "election_year": 2025,
        "election_round": "legislativas",
        "mime": "application/zip",
        "filename": "fixture.zip",
    }
    monkeypatch.setattr(cli, "load_sources", lambda *a: {"national": [entry]})
    monkeypatch.setattr(cli, "load_manifest", lambda *a: [])
    monkeypatch.setattr(cli, "latest_ok_record", lambda *a: {"filename": "fixture.zip"})
    monkeypatch.setattr(cli, "archived_filename", lambda *a, **k: "fixture.zip")
    monkeypatch.setattr(cli, "archive_entry_from_evidence", lambda *a: "new archive")
    monkeypatch.setattr(
        cli, "project_archive_entry", lambda c, evidence: c.state.update(archive=evidence)
    )
    monkeypatch.setattr(cli.psycopg, "connect", lambda *a: conn)
    monkeypatch.setattr(projection_receipt, "fingerprint", lambda *a, **k: "fingerprint")
    monkeypatch.setattr(
        projection_receipt, "publish", lambda c, **k: c.state.update(receipt="new receipt")
    )
    monkeypatch.setattr(db, "lock_archive_entry_source_authority", lambda *a, **k: None)
    monkeypatch.setattr(db, "upsert_election", lambda *a, **k: "election")
    monkeypatch.setattr(db, "upsert_category", lambda *a, **k: "category")
    monkeypatch.setattr(
        db, "replace_official_mesa_completeness", lambda c, **k: c.state.update(completeness=k)
    )

    class Replacement:
        inserted = 0

        def insert(self, records):
            conn.state["rows"].extend(records)
            self.inserted += len(records)
            conn.inserted += len(records)

    def replace(*a, **k):
        conn.state["rows"] = []
        return Replacement()

    def jurisdictions(c, keys, *, names):
        for key, incoming in zip(keys, names):
            c.state["names"][key] = db._merge_jurisdiction_names(
                c.state["names"].get(key, national.JurisdictionNames()), incoming, key=key
            )
        return {key: key[-1] for key in keys}

    monkeypatch.setattr(db, "begin_result_rows_replacement", replace)
    monkeypatch.setattr(db, "batch_upsert_jurisdictions", jurisdictions)
    loader = national.load_national_rows
    monkeypatch.setattr(cli, "load_national_rows", lambda *a, **k: loader(*a, **k, batch_size=1))
    if MUTATION == "metadata":
        monkeypatch.setattr(db, "_merge_jurisdiction_names", lambda old, new, **k: new)
    if MUTATION == "eof":
        # Remove the final evidence row BEFORE preflight, simulating premature
        # classification that never sees the invalidating EOF candidate.
        iterator = cli.iter_national_rows

        def premature(stream, **kwargs):
            stream.seek(0)
            text = stream.read()
            return iterator(io.StringIO("\n".join(text.splitlines()[:-1]) + "\n"), **kwargs)

        monkeypatch.setattr(cli, "iter_national_rows", premature)

    def run(overrides, companion):
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w") as bundle:
            bundle.writestr("resultados.csv", source(*overrides).getvalue())
            if companion:
                bundle.writestr("localesDeVotacionyMesas.csv", COMPANION)
        monkeypatch.setattr(cli, "read_archived_source", lambda *a, **k: buffer.getvalue())
        code = cli.main(
            [
                "ingest",
                "--source",
                entry["id"],
                "--database-url",
                "postgresql://synthetic.invalid/unused",
                "--year",
                "2025",
                "--round",
                "legislativas",
                "--force-rebuild",
            ]
        )
        return code, conn

    return run


@pytest.mark.parametrize("tail", ["duplicate", "circuit", "companion"])
def test_cli_eof_ambiguity_excludes_every_affected_candidate(ingest, tail):
    rows = [{}, {"mesa_id": "2"}]
    if tail == "duplicate":
        rows.append({"votos_cantidad": "11"})
    else:
        # Two different parties on mesa 1 must BOTH disappear when its late
        # circuito conflict arrives (including non-positive-only evidence).
        rows.insert(1, {"agrupacion_id": "111"})
        rows.append(
            {
                "circuito_id": "00002",
                "agrupacion_id": "112",
                "votos_tipo": "BLANCO" if tail == "companion" else "POSITIVO",
            }
        )
    code, conn = ingest(rows, companion=tail != "duplicate")
    assert code == 0
    assert conn.committed and conn.closed and not conn.rolled_back
    assert [(r.jurisdiction_id, r.source_row_index) for r in conn.state["rows"]] == [
        (2, 1 if tail == "duplicate" else 2)
    ]


def test_cli_late_metadata_conflict_rolls_back_complete_ingestion(ingest, capsys):
    code, conn = ingest(
        [{}, {"mesa_id": "2"}, {"agrupacion_id": "111", "seccion_nombre": "Conflict"}], False
    )
    assert code == 1
    assert "refusing to overwrite" in capsys.readouterr().err
    assert conn.inserted == 2  # Failure really follows two successful batches.
    assert conn.rolled_back and conn.closed and not conn.committed
    assert conn.state == conn.initial  # rows, names, archive, receipt, completeness
