"""Canonical PBA names exercised through archived-source ingestion and real SQL."""

import uuid
from pathlib import Path

import psycopg
import pytest
import yaml
from test_cli import TEST_DSN, FakeFetcher, _require_ephemeral_postgres

from etl import __main__ as cli
from etl.archive import FetchResponse
from etl.db import upsert_jurisdiction
from etl.ingest.pba import ingest_pba

ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture
def ingest_connection(monkeypatch):
    _require_ephemeral_postgres()

    class RollbackConnection(psycopg.Connection):
        # Exercise production SQL without publishing fixture changes to shared
        # canonical jurisdictions. Only transaction ownership is test-controlled.
        def commit(self):
            pass

        def close(self):
            pass

    conn = RollbackConnection.connect(TEST_DSN)
    monkeypatch.setattr(cli.psycopg, "connect", lambda *_args, **_kwargs: conn)
    try:
        yield conn
    finally:
        conn.rollback()
        psycopg.Connection.close(conn)


@pytest.mark.parametrize("case", ["canonical", "missing", "conflict"])
def test_archived_pba_names(ingest_connection, tmp_path, case):
    conn = ingest_connection
    source_id = f"pba/names-{uuid.uuid4()}"
    payload = (ROOT / "etl/tests/fixtures/pba_distrito_027_2025_sample.html").read_bytes()
    sources = {
        "pba": [
            {
                "id": source_id,
                "source": "www.juntaelectoral.gba.gov.ar",
                "source_url": "https://www.juntaelectoral.gba.gov.ar/escrutinio-definitivo-2025/distrito_027.html",
                "mime": "text/html",
                "election_year": 2025,
                "election_round": "provinciales",
                "notes": "public official fixture",
                "filename": "pba.html",
            }
        ]
    }
    manifest = tmp_path / "manifest.json"
    archive = tmp_path / "archive"

    class PbaFetcher(FakeFetcher):
        def get(self, url, **kwargs):
            if url.endswith("/robots.txt"):
                return FetchResponse(status_code=404, content=b"", headers={})
            return super().get(url, **kwargs)

    cli.fetch_source(
        source_id,
        sources=sources,
        fetcher=PbaFetcher(payload=payload),
        local_root=archive,
        manifest_path=manifest,
    )
    crosswalk = yaml.safe_load((ROOT / "curated/crosswalk.yaml").read_text())
    if case == "missing":
        for entry in crosswalk["jurisdictions"]:
            for key in ("national_distrito_name", "national_seccion_name", "names_source"):
                entry.pop(key, None)
    crosswalk_path = tmp_path / "crosswalk.yaml"
    crosswalk_path.write_text(yaml.safe_dump(crosswalk))
    kwargs = dict(
        database_url=TEST_DSN,
        year=2025,
        round_="provinciales",
        sources=sources,
        local_root=archive,
        manifest_path=manifest,
        crosswalk_path=crosswalk_path,
    )
    # Simulate the hosted null-name identity without changing its natural key.
    identity = upsert_jurisdiction(conn, distrito="02", seccion="027")
    conn.execute(
        "update jurisdiction set distrito_name=%s, seccion_name=null where id=%s",
        ("Conflicting province" if case == "conflict" else None, identity),
    )
    if case == "conflict":
        with pytest.raises(ValueError, match="conflict"):
            cli.ingest_source(source_id, **kwargs)
        return
    first = cli.ingest_source(source_id, **kwargs)
    parsed = ingest_pba(payload, archive_entry_id=source_id)
    assert first == len(parsed.rows) == 23
    query = (
        "select category_id, list_id, votes, granularity, requested_granularity "
        "from result_row where archive_entry_id=%s order by category_id, list_id"
    )
    before = conn.execute(query, (source_id,)).fetchall()
    assert cli.ingest_source(source_id, **kwargs) == first
    lineages = conn.execute(
        "select distinct j.id, j.distrito_code, j.seccion_code, j.distrito_name, "
        "j.seccion_name, j.circuito_code, j.establecimiento_code, j.mesa_code "
        "from result_row r join jurisdiction j on j.id=r.jurisdiction_id "
        "where r.archive_entry_id=%s",
        (source_id,),
    ).fetchall()
    after = conn.execute(query, (source_id,)).fetchall()
    expected = (
        (None, None) if case == "missing" else ("Buenos Aires", "Coronel de Marina L. Rosales")
    )
    assert lineages == [(identity, "02", "027", *expected, None, None, None)]
    assert before == after
    assert sum(row[2] for row in after) == sum(row.votes for row in parsed.rows)
    assert all(row[3:] == ("seccion", "mesa") for row in after)
