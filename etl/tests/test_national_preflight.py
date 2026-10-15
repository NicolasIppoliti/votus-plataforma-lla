"""Issue #482: EOF decisions must precede emission, including filtered rows.

Synthetic fixtures use the supported national headers. The full ordered dataclass,
completeness, metrics and stderr fingerprint was captured before optimization.
The transactional double exercises the real loader, not PostgreSQL durability.
"""

from __future__ import annotations

import csv
import hashlib
import io
import json
from contextlib import contextmanager
from dataclasses import asdict

import pytest

from etl import db
from etl.ingest import national
from etl.ingest_metrics import IngestMetrics

FIELDS = national.REQUIRED_COLUMNS + ("lista_numero", "estado_final", "mesa_tipo")


def source(*overrides):
    stream = io.StringIO()
    writer = csv.DictWriter(stream, fieldnames=FIELDS)
    writer.writeheader()
    for override in overrides:
        writer.writerow(
            dict(
                distrito_id="02",
                distrito_nombre=" Buenos Aires ",
                seccion_id="027",
                seccion_nombre=" Coronel Rosales ",
                circuito_id="00001",
                circuito_nombre="1",
                mesa_id="1",
                cargo_nombre="DIPUTADO NACIONAL",
                agrupacion_id="110",
                votos_tipo="POSITIVO",
                votos_cantidad="7",
                lista_numero="",
                estado_final="ESCRUTADO",
                mesa_tipo="NATIVOS",
            )
            | override
        )
    stream.seek(0)
    return stream


COMPANION = (
    b"distrito_id,seccion_id,mesa_id,localvotacion_codigo,localvotacion_nombre,"
    b"mesa_electores,mesa_tipo\n"
    b"02,027,1,100, Escuela ,300,NATIVOS\n"
    b"02,027,2,100, Escuela ,301,NATIVOS\n"
    b"02,027,3,100, Escuela ,302,NATIVOS\n"
)


def consume(stream, *, companion=None, year=2025, round_="legislativas"):
    metrics = IngestMetrics()
    completeness = national.build_national_completeness(
        stream, establecimientos_csv_bytes=companion, source_label="national/preflight-test"
    )
    rows = list(
        national.iter_national_rows(
            stream,
            archive_entry_id="national/preflight-test",
            election_year=year,
            election_round=round_,
            establecimientos_csv_bytes=companion,
            metrics=metrics,
        )
    )
    return rows, completeness, metrics.data


@pytest.mark.parametrize("tail", ["duplicate", "positive", "blank", "not_counted"])
def test_eof_classification_preserves_ordered_rows_completeness_and_accounting(tail, capsys):
    # Mesa 3 survives; a final row invalidates ALL earlier candidates for mesa 1.
    # Mesa 2 is non-positive-only and must still appear in completeness.
    last = {"votos_cantidad": "11"}
    companion = None if tail == "duplicate" else COMPANION
    if tail != "duplicate":
        last["circuito_id"] = "00002"
    if tail == "blank":
        last["votos_tipo"] = "EN BLANCO"
        last["agrupacion_id"] = ""
    if tail == "not_counted":
        last["estado_final"] = "NO ESCRUTADO"
    rows, completeness, metrics = consume(
        source(
            {},
            {"mesa_id": "3", "votos_cantidad": "13"},
            {"mesa_id": "1", "agrupacion_id": "111", "votos_cantidad": "17"},
            {"mesa_id": "2", "votos_tipo": "EN BLANCO", "agrupacion_id": ""},
            last,
        ),
        companion=companion,
    )
    assert [(row.mesa, row.list_id, row.source_row_index) for row in rows] == (
        [(3, "110", 1), (1, "111", 2)] if tail == "duplicate" else [(3, "110", 1)]
    )
    document = {
        "rows": [asdict(row) for row in rows],
        "completeness": asdict(completeness),
        "metrics": metrics,
        "stderr": capsys.readouterr().err,
    }
    fingerprint = hashlib.sha256(json.dumps(document, sort_keys=True).encode()).hexdigest()
    expected = {
        "duplicate": "0091301bd77cb49811ea5c52a7d552865f4006ffb7317efa3cc899c7aa9cbcf7",
        "positive": "a270d1611e963c3c08b8a1e843968ec2e19f7e009ba13fcb5083df5959c133f8",
        "blank": "6c66a12827959d9223d844962d215cf0279271d8a7f3c9edd2facfab5e480ded",
        "not_counted": "4e0b900cc984001410adaab1ae6af517049357fe7b4a01bfaeec7c7d404c189b",
    }
    assert fingerprint == expected[tail]


def test_paso_internal_lists_and_all_fields_survive_without_companion():
    rows, completeness, metrics = consume(
        source(
            {"lista_numero": "A", "estado_final": "", "mesa_tipo": ""},
            {"lista_numero": "B", "estado_final": "", "mesa_tipo": ""},
        ),
        year=2023,
        round_="paso",
    )
    assert [asdict(row) for row in rows] == [
        {
            "result": {
                "granularity": "mesa",
                "distrito": "02",
                "seccion": "027",
                "circuito": "00001",
                "establecimiento": None,
                "mesa": 1,
                "category": "DIPUTADO NACIONAL",
                "list_id": f"110-{internal}",
                "votes": 7,
            },
            "estado_final": None,
            "mesa_tipo": None,
            "archive_entry_id": "national/preflight-test",
            "source_row_index": index,
            "jurisdiction_names": {
                "distrito": "Buenos Aires",
                "seccion": "Coronel Rosales",
                "circuito": "00001",
                "establecimiento": None,
            },
        }
        for index, internal in enumerate(("A", "B"))
    ]
    assert completeness.unavailable_reason is not None
    assert metrics["first_pass"] == metrics["iteration"] == "complete"
    assert metrics["rows_emitted"] == 2


@pytest.mark.parametrize("companion", [None, COMPANION])
def test_empty_ambiguity_set_needs_no_candidate_companion_key_checks(monkeypatch, companion):
    checks = 0
    original = national._companion_key_from_natural_key

    def counted(key):
        nonlocal checks
        checks += 1
        return original(key)

    monkeypatch.setattr(national, "_companion_key_from_natural_key", counted)
    rows, _, _ = consume(source({}, {"mesa_id": "2"}), companion=companion)
    assert len(rows) == 2
    assert checks == 0


def test_late_metadata_conflict_rolls_back_prior_loader_batches(monkeypatch):
    class Connection:
        records = ["previous scoped result"]
        names = {}
        inserted_before_failure = 0
        rolled_back = False

        @contextmanager
        def transaction(self):
            before = self.records.copy(), self.names.copy()
            try:
                yield
            except BaseException:
                self.records, self.names = before
                self.rolled_back = True
                raise

    conn = Connection()

    class Replacement:
        inserted = 0

        def insert(self, records):
            conn.records.extend(records)
            self.inserted += len(records)
            conn.inserted_before_failure += len(records)

    def replace(*args, **kwargs):
        conn.records = []
        return Replacement()

    def jurisdictions(_conn, keys, *, names):
        for key, incoming in zip(keys, names):
            # Use the real DB boundary's metadata validation, not an injected error.
            conn.names[key] = db._merge_jurisdiction_names(
                conn.names.get(key, national.JurisdictionNames()), incoming, key=key
            )
        return dict.fromkeys(keys, "jurisdiction")

    monkeypatch.setattr(db, "lock_archive_entry_source_authority", lambda *a, **k: None)
    monkeypatch.setattr(db, "upsert_election", lambda *a, **k: "election")
    monkeypatch.setattr(db, "upsert_category", lambda *a, **k: "category")
    monkeypatch.setattr(db, "begin_result_rows_replacement", replace)
    monkeypatch.setattr(db, "batch_upsert_jurisdictions", jurisdictions)
    rows = national.iter_national_rows(
        source({}, {"mesa_id": "2"}, {"agrupacion_id": "111", "seccion_nombre": "Conflict"}),
        archive_entry_id="national/preflight-test",
        election_year=2025,
        election_round="legislativas",
    )
    with pytest.raises(db.JurisdictionNameConflictError, match="refusing to overwrite"):
        national.load_national_rows(
            conn,
            rows,
            year=2025,
            round_="legislativas",
            archive_entry_id="national/preflight-test",
            batch_size=1,
        )
    assert conn.inserted_before_failure == 2
    assert conn.rolled_back
    assert conn.records == ["previous scoped result"]
    assert conn.names == {}
