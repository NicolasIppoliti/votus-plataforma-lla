"""RED tests for the runtime CLI entrypoint (task 12a).

`tasks.md`'s own work-unit table names four runtime harnesses --
``uv run python -m etl fetch --source ...``, ``... ingest --source ...``,
``... validate-crosswalk``, ``... validate-curated`` -- that no numbered
task ever built before this phase. This file is the RED evidence that
proves each one now exists and behaves per its own promise: exit 0 on
success, non-zero on validation failure, and NEVER a silent no-op or a
silent default database connection.
"""

from __future__ import annotations

import contextlib
import csv
import hashlib
import io
import json
import os
import uuid
import zipfile
from dataclasses import dataclass, field
from pathlib import Path
from types import SimpleNamespace

import psycopg
import pytest
import yaml

from etl.__main__ import (
    MissingArchivedYearError,
    MissingDatabaseUrlError,
    NationalResultsCsvNotFoundError,
    NationalSchemaError,
    NationalSourceReadability,
    PbaIngestMimeValidationError,
    UnknownSourceError,
    collect_mesa_tipo_mapping,
    collect_national_jurisdiction_codes,
    collect_national_party_keys,
    fetch_source,
    find_unmapped_jurisdictions,
    find_unmapped_parties,
    ingest_source,
    load_curated,
    load_sources,
    main,
    resolve_national_results_bytes,
)
from etl.archive import ArchiveIntegrityError, FetchResponse
from etl.crosswalk import (
    FISCALIZACION_VOTE_COLUMNS,
    CrosswalkTable,
    JurisdictionCrosswalkEntry,
    load_crosswalk,
)
from etl.db import (
    CrosswalkReplacementSummary,
    PartyMapReplacementSummary,
    TableReplacementCount,
)
from etl.ingest.fiscalizacion import FiscalizacionSchemaError, ingest_fiscalizacion
from etl.manifest import load_fetch_events, load_manifest, save_manifest
from etl.party_map import PartyMappingTable, load_party_map
from etl.review_item import ReviewItemContext
from etl.storage import LocalArchiveStore

REPO_ROOT = Path(__file__).parent.parent.parent
CROSSWALK_PATH = REPO_ROOT / "curated" / "crosswalk.yaml"
PARTY_MAP_PATH = REPO_ROOT / "curated" / "party_map.yaml"

FAKE_SOURCES = {
    "national": [
        {
            "id": "national/fake-test",
            "source": "example.test",
            "source_url": "https://example.test/results.zip",
            "mime": "application/zip",
            "election_year": 2025,
            "election_round": "legislativas",
            "notes": "fixture only, never fetched over the network",
            "filename": "fake-test.zip",
        }
    ]
}


@dataclass
class FakeFetcher:
    """No network at all -- returns canned bytes for every `.get()` call."""

    payload: bytes = b"fake-zip-bytes"
    calls: list[str] = field(default_factory=list)

    def get(
        self, url: str, *, timeout: float, headers: dict[str, str] | None = None
    ) -> FetchResponse:
        self.calls.append(url)
        return FetchResponse(status_code=200, content=self.payload, headers={})


def test_validate_coronel_rosales_partido_geometry_is_reachable_through_main(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    payload = json.dumps({
        "type": "FeatureCollection",
        "crs": {"type": "name", "properties": {"name": "urn:ogc:def:crs:EPSG::4326"}},
        "features": [{
            "type": "Feature", "id": "Departamento.482",
            "properties": {"cca": "113", "cde": "06182", "nam": "Coronel Rosales"},
            "geometry": {"type": "MultiPolygon", "coordinates": [
                [[[-62.1, -38.9], [-62.0, -38.9], [-62.0, -38.8], [-62.1, -38.9]]]
            ]},
        }],
    }).encode()
    root = tmp_path / "archive"
    (root / "geography").mkdir(parents=True)
    (root / "geography" / "partido.json").write_bytes(payload)
    digest = hashlib.sha256(payload).hexdigest()
    manifest = tmp_path / "manifest.json"
    save_manifest(manifest, [{
        "id": "geography/arba-coronel-rosales-partido", "status": "ok",
        "sha256": digest, "archived_path": "archive/geography/partido.json",
        "fetched_at": "2026-09-22T00:00:00Z",
    }], events=[])
    assert main([
        "--local-root", str(root), "--manifest-path", str(manifest),
        "validate-partido-geometry", "--source", "geography/arba-coronel-rosales-partido",
    ]) == 0
    assert json.loads(capsys.readouterr().out) == {
        "counts": {"accepted": 1, "invalid": 0, "conflict": 0}, "reasons": {},
        "snapshot": {"source": "geography/arba-coronel-rosales-partido",
                     "sha256": digest, "timestamp": "2026-09-22T00:00:00Z"},
        "feature": "Departamento.482", "feature_type": "idera:Departamento",
        "geometry": "MultiPolygon", "crs": "EPSG:4326",
        "jurisdiction": {"pba_distrito": "027", "national_distrito": "02",
                         "national_seccion": "027"},
        "unsupported_depths": ["circuit", "establishment", "mesa"],
    }


def partido_cli_fixture(tmp_path: Path, *, features: list | None = None) -> tuple:
    source_id = "geography/arba-coronel-rosales-partido"
    document = {
        "type": "FeatureCollection",
        "crs": {"type": "name", "properties": {"name": "urn:ogc:def:crs:EPSG::4326"}},
        "features": features if features is not None else [{
            "type": "Feature", "id": "Departamento.482",
            "properties": {"cca": "113", "cde": "06182", "nam": "Coronel Rosales"},
            "geometry": {"type": "Polygon", "coordinates": [
                [[0, 0], [1, 0], [1, 1], [0, 0]]
            ]},
        }],
    }
    root = tmp_path / "archive"
    (root / "geography").mkdir(parents=True)
    archive = root / "geography" / "partido.json"
    payload = json.dumps(document).encode()
    archive.write_bytes(payload)
    record = {
        "id": source_id, "status": "ok", "sha256": hashlib.sha256(payload).hexdigest(),
        "archived_path": "archive/geography/partido.json", "fetched_at": "2026-09-22T00:00:00Z",
    }
    manifest = tmp_path / "manifest.json"
    save_manifest(manifest, [record], events=[])
    args = ["--local-root", str(root), "--manifest-path", str(manifest),
            "validate-partido-geometry", "--source", source_id]
    return document, record, archive, manifest, args


def partido_rejection(record: dict, reason: str, *, conflict: int = 0) -> dict:
    return {
        "counts": {"accepted": 0, "invalid": 0 if conflict else 1, "conflict": conflict},
        "reasons": {reason: conflict or 1},
        "snapshot": {"source": record["id"], "sha256": record.get("sha256"),
                     "timestamp": record["fetched_at"]},
        "feature": None, "feature_type": None, "geometry": None, "crs": None,
        "jurisdiction": None, "unsupported_depths": ["circuit", "establishment", "mesa"],
    }


@pytest.mark.parametrize("failure", ["missing", "corrupt"])
def test_partido_geometry_checksum_precedes_json(tmp_path, capsys, failure):
    _, record, archive, manifest, args = partido_cli_fixture(tmp_path)
    archive.write_bytes(b"not JSON")
    if failure == "missing":
        record.pop("sha256")
        save_manifest(manifest, [record], events=[])
    assert main(args) == 1
    assert json.loads(capsys.readouterr().out) == partido_rejection(record, "archive_integrity")


@pytest.mark.parametrize("count,reason", [(0, "missing_feature"), (2, "multiple_features")])
def test_partido_geometry_never_picks_first(tmp_path, capsys, count, reason):
    _, record, _, _, args = partido_cli_fixture(tmp_path, features=[{}] * count)
    assert main(args) == 1
    assert json.loads(capsys.readouterr().out) == partido_rejection(
        record, reason, conflict=count
    )


@pytest.mark.parametrize("field,value,reason", [
    ("crs", "EPSG:3857", "wrong_crs"),
    ("id", "Other.482", "wrong_feature_type"),
    ("cca", "027", "wrong_identity"),
    ("cde", "6182", "wrong_identity"),
    ("nam", "Other", "wrong_identity"),
    ("geometry", "Point", "wrong_geometry_type"),
    ("geometry", [], "wrong_geometry_type"),
    ("geometry", {}, "wrong_geometry_type"),
    ("geometry", 1, "wrong_geometry_type"),
])
def test_partido_geometry_rejects_wrong_evidence(tmp_path, capsys, field, value, reason):
    document, record, archive, manifest, args = partido_cli_fixture(tmp_path)
    feature = document["features"][0]
    if field == "crs":
        document["crs"]["properties"]["name"] = value
    elif field == "id":
        feature["id"] = value
    elif field == "geometry":
        feature["geometry"]["type"] = value
    else:
        feature["properties"][field] = value
    payload = json.dumps(document).encode()
    archive.write_bytes(payload)
    record["sha256"] = hashlib.sha256(payload).hexdigest()
    save_manifest(manifest, [record], events=[])
    assert main(args) == 1
    assert json.loads(capsys.readouterr().out) == partido_rejection(record, reason)


@pytest.mark.parametrize("change,reason", [
    ({"reference_kind": "circuit_geometry"}, "unsupported_reference_kind"),
    ({"capability": "national"}, "unsupported_capability"),
    ({"feature_type": "other:Departamento"}, "wrong_feature_type"),
    ({"pba_distrito_code": "182"}, "unmapped_jurisdiction"),
    ({"expected_identity": {}}, "invalid_source_metadata"),
])
def test_partido_geometry_checks_registered_contract(tmp_path, capsys, change, reason):
    _, record, _, _, args = partido_cli_fixture(tmp_path)
    entry = dict(load_sources()["geography"][0])
    capability = change.get("capability", "geography")
    entry.update({key: value for key, value in change.items() if key != "capability"})
    if capability == "national":
        entry.update(election_year=2025, election_round="legislativas")
    sources = tmp_path / "sources.yaml"
    sources.write_text(yaml.safe_dump({capability: [entry]}))
    assert main(["--sources-path", str(sources), *args]) == 1
    assert json.loads(capsys.readouterr().out) == partido_rejection(record, reason)


@pytest.mark.parametrize("coordinates", [
    [], [[]], [[[0, 0], [1, 0], [0, 0]]],
    [[[0, 0], [10**400, 0], [1, 1], [0, 0]]],
    [[[0, 0], [1, 0], [1, 1], [2, 2]]],
    [[[0, 0], [True, 0], [1, 1], [0, 0]]],
    [[[0, 0], [float("nan"), 0], [1, 1], [0, 0]]],
    [[[0, 0], [float("inf"), 0], [1, 1], [0, 0]]],
    [[[0, 0], ["1", 0], [1, 1], [0, 0]]],
    [[[0, 0], [1, 0, 3], [1, 1], [0, 0]]],
])
def test_partido_geometry_requires_finite_closed_rings(tmp_path, capsys, coordinates):
    document, record, archive, manifest, args = partido_cli_fixture(tmp_path)
    document["features"][0]["geometry"]["coordinates"] = coordinates
    payload = json.dumps(document).encode()
    archive.write_bytes(payload)
    record["sha256"] = hashlib.sha256(payload).hexdigest()
    save_manifest(manifest, [record], events=[])
    assert main(args) == 1
    assert json.loads(capsys.readouterr().out) == partido_rejection(record, "invalid_coordinates")


@pytest.mark.parametrize("payload,reason", [
    (b"not JSON", "invalid_json"),
    (b"[]", "invalid_feature_collection"),
    (b'{"type":"Feature","features":[]}', "invalid_feature_collection"),
    (b'{"type":"FeatureCollection","features":{}}', "invalid_feature_collection"),
    (b'{"type":"FeatureCollection","features":[null]}', "invalid_feature"),
    (b'{"type":"FeatureCollection","features":[{"type":"Other"}]}', "invalid_feature"),
])
def test_partido_geometry_rejects_malformed_documents(tmp_path, capsys, payload, reason):
    _, record, archive, manifest, args = partido_cli_fixture(tmp_path)
    archive.write_bytes(payload)
    record["sha256"] = hashlib.sha256(payload).hexdigest()
    save_manifest(manifest, [record], events=[])
    assert main(args) == 1
    assert json.loads(capsys.readouterr().out) == partido_rejection(record, reason)


def test_partido_geometry_reports_missing_snapshot(tmp_path, capsys):
    _, record, _, manifest, args = partido_cli_fixture(tmp_path)
    save_manifest(manifest, [], events=[])
    assert main(args) == 1
    record.update(sha256=None, fetched_at=None)
    assert json.loads(capsys.readouterr().out) == partido_rejection(record, "missing_snapshot")


@pytest.mark.parametrize("code", [None, ""])
def test_partido_geometry_requires_pba_metadata(tmp_path, capsys, code):
    _, record, _, _, args = partido_cli_fixture(tmp_path)
    entry = dict(load_sources()["geography"][0])
    if code is None:
        entry.pop("pba_distrito_code")
    else:
        entry["pba_distrito_code"] = code
    sources = tmp_path / "sources.yaml"
    sources.write_text(yaml.safe_dump({"geography": [entry]}))
    assert main(["--sources-path", str(sources), *args]) == 1
    assert json.loads(capsys.readouterr().out) == partido_rejection(
        record, "invalid_source_metadata"
    )


@pytest.mark.parametrize("field", ["election_year", "election_round"])
@pytest.mark.parametrize("value", [None, "", 2025, "legislativas"])
def test_sources_geography_rejects_election_metadata(tmp_path, field, value):
    from etl.__main__ import SourcesValidationError

    entry = dict(load_sources()["geography"][0])
    entry[field] = value
    sources = tmp_path / "sources.yaml"
    sources.write_text(yaml.safe_dump({"geography": [entry]}))
    with pytest.raises(SourcesValidationError, match="geography entries must be election-free"):
        load_sources(sources)


def test_partido_geometry_accepts_polygon_through_main(tmp_path, capsys):
    _, record, _, _, args = partido_cli_fixture(tmp_path)
    assert main(args) == 0
    assert json.loads(capsys.readouterr().out) == {
        "counts": {"accepted": 1, "invalid": 0, "conflict": 0}, "reasons": {},
        "snapshot": {"source": record["id"], "sha256": record["sha256"],
                     "timestamp": "2026-09-22T00:00:00Z"},
        "feature": "Departamento.482", "feature_type": "idera:Departamento",
        "geometry": "Polygon", "crs": "EPSG:4326",
        "jurisdiction": {"pba_distrito": "027", "national_distrito": "02",
                         "national_seccion": "027"},
        "unsupported_depths": ["circuit", "establishment", "mesa"],
    }


# ---------------------------------------------------------------------------
# 12.1 -- fetch archives a registered source, no network
# ---------------------------------------------------------------------------


def test_fetch_subcommand_archives_a_registered_source(tmp_path: Path) -> None:
    fetcher = FakeFetcher()
    manifest_path = tmp_path / "archive-manifest.json"
    local_root = tmp_path / "archive"

    result = fetch_source(
        "national/fake-test",
        sources=FAKE_SOURCES,
        fetcher=fetcher,
        local_root=local_root,
        manifest_path=manifest_path,
    )

    assert result.record["status"] == "ok"
    assert result.record["id"] == "national/fake-test"
    archived_path = result.record["archived_path"]
    assert isinstance(archived_path, str)
    assert (tmp_path / archived_path).read_bytes() == fetcher.payload
    assert manifest_path.exists()
    assert fetcher.calls == ["https://example.test/results.zip"]


# ---------------------------------------------------------------------------
# 12.2 -- an unregistered source name is an error, never a silent no-op
# ---------------------------------------------------------------------------


def test_fetch_local_fiscal_source_archives_without_network_and_is_idempotent(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    import etl.__main__ as cli

    source_id = "fiscalizacion/2025-local-cli"
    payload = b"Escuela,Mesa\nEscuela 1,1\n"
    local_file = tmp_path / "fiscal.csv"
    local_file.write_bytes(payload)
    sources_path = tmp_path / "sources.yaml"
    sources_path.write_text(
        yaml.safe_dump(
            {
                "fiscalizacion": [
                    {
                        "id": source_id,
                        "source": "local-file",
                        "source_url": "local://fiscalizacion/fiscal.csv",
                        "mime": "text/csv",
                        "notes": "local archive fixture",
                        "election_year": 2025,
                        "election_round": "legislativas",
                        "filename": "fiscal.csv",
                        "source_kind": "fiscalizacion",
                        "upload": "never",
                    }
                ]
            }
        ),
        encoding="utf-8",
    )
    local_root = tmp_path / "archive"
    manifest_path = tmp_path / "archive-manifest.json"
    fetcher = FakeFetcher()
    monkeypatch.setattr(cli, "RequestsFetcher", lambda: fetcher)
    command = _main_args(sources_path, local_root, manifest_path) + [
        "fetch",
        "--source",
        source_id,
        "--local-file",
        str(local_file),
    ]

    assert main(command) == 0
    assert main(command) == 0

    digest = hashlib.sha256(payload).hexdigest()
    archived = local_root / "fiscalizacion" / f"fiscal.{digest}.csv"
    assert archived.read_bytes() == payload
    records = load_manifest(manifest_path)
    assert len(records) == 1
    assert records[0]["sha256"] == digest
    assert records[0]["archived_path"] == f"archive/fiscalizacion/{archived.name}"
    assert fetcher.calls == []


@pytest.mark.parametrize(
    ("declaration", "expected_diagnostic"),
    [
        (
            {"upload": "never"},
            "error: sources.yaml capability 'fiscalizacion' entry 0 source_kind "
            "must be exactly 'fiscalizacion'\n",
        ),
        (
            {"source_kind": "official", "upload": "never"},
            "error: sources.yaml capability 'fiscalizacion' entry 0 source_kind "
            "must be exactly 'fiscalizacion'\n",
        ),
        (
            {"source_kind": "fiscalizacion"},
            "error: sources.yaml capability 'fiscalizacion' entry 0 upload "
            "must be exactly 'never'\n",
        ),
        (
            {"source_kind": "fiscalizacion", "upload": "r2"},
            "error: sources.yaml capability 'fiscalizacion' entry 0 upload "
            "must be exactly 'never'\n",
        ),
        (
            {"source_kind": "official", "upload": "r2"},
            "error: sources.yaml capability 'fiscalizacion' entry 0 source_kind "
            "must be exactly 'fiscalizacion'\n",
        ),
    ],
    ids=[
        "missing-source-kind",
        "official-source-kind",
        "missing-upload",
        "r2-upload",
        "source-kind-precedes-upload",
    ],
)
def test_fetch_rejects_invalid_fiscal_source_declarations_at_registry_boundary(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys,
    declaration: dict[str, str],
    expected_diagnostic: str,
) -> None:
    import etl.__main__ as cli

    source_id = "fiscalizacion/invalid-declaration"
    local_file = tmp_path / "fiscal.csv"
    local_file.write_bytes(b"must not be archived")
    sources_path = tmp_path / "sources.yaml"
    entry = {
        "id": source_id,
        "source": "local-file",
        "source_url": "local://fiscalizacion/fiscal.csv",
        "mime": "text/csv",
        "notes": "invalid declaration fixture",
        "election_year": 2025,
        "election_round": "legislativas",
        "filename": "fiscal.csv",
        **declaration,
    }
    sources_path.write_text(
        yaml.safe_dump({"fiscalizacion": [entry]}),
        encoding="utf-8",
    )
    local_root = tmp_path / "archive"
    manifest_path = tmp_path / "archive-manifest.json"
    original_manifest = b"[]\n"
    manifest_path.write_bytes(original_manifest)
    fetcher = FakeFetcher()
    monkeypatch.setattr(cli, "RequestsFetcher", lambda: fetcher)

    exit_code = main(
        _main_args(sources_path, local_root, manifest_path)
        + ["fetch", "--source", source_id, "--local-file", str(local_file)]
    )

    assert exit_code == 1
    assert capsys.readouterr().err == expected_diagnostic
    assert fetcher.calls == []
    assert not local_root.exists()
    assert manifest_path.read_bytes() == original_manifest


def test_fetch_cli_reports_changed_fiscalizacion_hash_per_reason(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys
) -> None:
    import etl.__main__ as cli

    source_id = "fiscalizacion/2025-reexport-cli"
    local_file = tmp_path / "fiscal.csv"
    sources_path = tmp_path / "sources.yaml"
    sources_path.write_text(
        yaml.safe_dump(
            {
                "fiscalizacion": [
                    {
                        "id": source_id,
                        "source": "local-file",
                        "source_url": "local://fiscalizacion/fiscal.csv",
                        "mime": "text/csv",
                        "notes": "re-export fixture",
                        "filename": "fiscal.csv",
                        "election_year": 2025,
                        "election_round": "legislativas",
                        "source_kind": "fiscalizacion",
                        "upload": "never",
                    }
                ]
            }
        ),
        encoding="utf-8",
    )
    local_root = tmp_path / "archive"
    manifest_path = tmp_path / "archive-manifest.json"
    monkeypatch.setattr(cli, "RequestsFetcher", lambda: FakeFetcher())
    command = _main_args(sources_path, local_root, manifest_path) + [
        "fetch",
        "--source",
        source_id,
        "--local-file",
        str(local_file),
    ]

    local_file.write_bytes(b"shape-only-export-v1")
    assert main(command) == 0
    capsys.readouterr()
    local_file.write_bytes(b"shape-only-export-v2")
    assert main(command) == 0

    reported = capsys.readouterr()
    assert "source_reexported (info): 1 review item(s)" in reported.err
    assert "content_drift" not in reported.err
    assert "archived fiscalizacion/2025-reexport-cli" in reported.out


def test_fetch_local_source_requires_a_local_file_argument(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys
) -> None:
    import etl.__main__ as cli

    source_id = "fiscalizacion/2025-local-missing"
    sources_path = tmp_path / "sources.yaml"
    sources_path.write_text(
        yaml.safe_dump(
            {
                "fiscalizacion": [
                    {
                        "id": source_id,
                        "source": "local-file",
                        "source_url": "local://fiscalizacion/fiscal.csv",
                        "mime": "text/csv",
                        "notes": "local-file requirement fixture",
                        "election_year": 2025,
                        "election_round": "legislativas",
                        "source_kind": "fiscalizacion",
                        "upload": "never",
                    }
                ]
            }
        ),
        encoding="utf-8",
    )
    fetcher = FakeFetcher()
    monkeypatch.setattr(cli, "RequestsFetcher", lambda: fetcher)

    exit_code = main(
        _main_args(sources_path, tmp_path / "archive", tmp_path / "manifest.json")
        + ["fetch", "--source", source_id]
    )

    assert exit_code == 1
    assert "--local-file" in capsys.readouterr().err
    assert fetcher.calls == []


def test_fetch_local_source_refuses_a_missing_file_without_disclosing_its_path(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys
) -> None:
    import etl.__main__ as cli

    source_id = "fiscalizacion/2025-local-absent"
    missing = tmp_path / "private-operator-path.csv"
    sources_path = tmp_path / "sources.yaml"
    sources_path.write_text(
        yaml.safe_dump(
            {
                "fiscalizacion": [
                    {
                        "id": source_id,
                        "source": "local-file",
                        "source_url": "local://fiscalizacion/fiscal.csv",
                        "mime": "text/csv",
                        "notes": "missing local-file fixture",
                        "election_year": 2025,
                        "election_round": "legislativas",
                        "source_kind": "fiscalizacion",
                        "upload": "never",
                    }
                ]
            }
        ),
        encoding="utf-8",
    )
    fetcher = FakeFetcher()
    monkeypatch.setattr(cli, "RequestsFetcher", lambda: fetcher)

    exit_code = main(
        _main_args(sources_path, tmp_path / "archive", tmp_path / "manifest.json")
        + ["fetch", "--source", source_id, "--local-file", str(missing)]
    )

    report = capsys.readouterr().err
    assert exit_code == 1
    assert "regular readable file" in report
    assert str(missing) not in report
    assert fetcher.calls == []


def test_fetch_http_source_rejects_local_file_before_network(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys
) -> None:
    import etl.__main__ as cli

    local_file = tmp_path / "not-for-http.csv"
    local_file.write_bytes(b"must not be used")
    sources_path = tmp_path / "sources.yaml"
    sources_path.write_text(yaml.safe_dump(FAKE_SOURCES), encoding="utf-8")
    fetcher = FakeFetcher()
    monkeypatch.setattr(cli, "RequestsFetcher", lambda: fetcher)

    exit_code = main(
        _main_args(sources_path, tmp_path / "archive", tmp_path / "manifest.json")
        + [
            "fetch",
            "--source",
            "national/fake-test",
            "--local-file",
            str(local_file),
        ]
    )

    assert exit_code == 1
    assert "only valid for local://" in capsys.readouterr().err
    assert fetcher.calls == []


def test_fetch_rejects_an_unregistered_source_name(tmp_path: Path) -> None:
    fetcher = FakeFetcher()

    with pytest.raises(UnknownSourceError):
        fetch_source(
            "national/does-not-exist",
            sources=FAKE_SOURCES,
            fetcher=fetcher,
            local_root=tmp_path / "archive",
            manifest_path=tmp_path / "archive-manifest.json",
        )

    assert fetcher.calls == [], "an unregistered source must never reach the network"


# ---------------------------------------------------------------------------
# 12.6 -- ingest refuses to write without an explicit database URL
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("year", "round_", "expected", "received"),
    [
        (2025, "generales", "2023", "2025"),
        (2023, "legislativas", "generales", "legislativas"),
    ],
)
def test_ingest_refuses_source_election_mismatch_before_archive_or_db_access(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    year: int,
    round_: str,
    expected: str,
    received: str,
) -> None:
    from etl.__main__ import SourceElectionValidationError

    sources = {
        "national": [
            {
                **FAKE_SOURCES["national"][0],
                "election_year": 2023,
                "election_round": "generales",
            }
        ]
    }
    manifest_path = tmp_path / "archive-manifest.json"
    manifest_path.write_text(
        json.dumps([{"id": "national/fake-test", "status": "ok"}]), encoding="utf-8"
    )
    monkeypatch.setattr(
        "etl.__main__.read_archived_source",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(
            AssertionError("election mismatch must fail before archive byte access")
        ),
    )
    monkeypatch.setattr(
        "etl.__main__.psycopg.connect",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(
            AssertionError("election mismatch must fail before database access")
        ),
    )

    with pytest.raises(SourceElectionValidationError) as excinfo:
        ingest_source(
            "national/fake-test",
            database_url="postgresql://must-not-connect/unused",
            year=year,
            round_=round_,
            sources=sources,
            local_root=tmp_path / "archive",
            manifest_path=manifest_path,
        )

    message = str(excinfo.value)
    assert "expected" in message and expected in message
    assert "received" in message and received in message


def test_pba_pdf_reference_is_not_ingestible_before_archive_parser_or_database_access(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    source_id = "pba/2025-reference-pdf"
    sources = {
        "pba": [
            {
                "id": source_id,
                "source": "example.test",
                "source_url": "https://example.test/reference.pdf",
                "mime": "application/pdf",
                "notes": "reference-only fixture",
                "election_year": 2025,
                "election_round": "provinciales",
            }
        ]
    }
    manifest_path = tmp_path / "manifest.json"
    manifest_path.write_text(
        json.dumps(
            [
                {
                    "id": source_id,
                    "status": "ok",
                    "archived_path": "archive/pba/reference.pdf",
                    "sha256": hashlib.sha256(b"archived reference").hexdigest(),
                }
            ]
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(
        "etl.__main__.read_archived_source",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(
            AssertionError("a reference-only PBA source must not be read for ingest")
        ),
    )
    monkeypatch.setattr(
        "etl.__main__.ingest_pba",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(
            AssertionError("a reference-only PBA source must not reach the parser")
        ),
    )
    monkeypatch.setattr(
        "etl.__main__.psycopg.connect",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(
            AssertionError("a reference-only PBA source must not reach the database")
        ),
    )

    with pytest.raises(PbaIngestMimeValidationError) as excinfo:
        ingest_source(
            source_id,
            database_url="postgresql://must-not-connect/unused",
            year=2025,
            round_="provinciales",
            sources=sources,
            local_root=tmp_path / "archive",
            manifest_path=manifest_path,
        )

    message = str(excinfo.value)
    assert source_id in message
    assert "application/pdf" in message
    assert "text/html" in message


def test_main_reports_archived_pba_pdf_as_a_clean_validation_failure(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys
) -> None:
    source_id = "pba/2025-reference-pdf"
    sources_path = tmp_path / "sources.yaml"
    sources_path.write_text(
        yaml.safe_dump(
            {
                "pba": [
                    {
                        "id": source_id,
                        "source": "example.test",
                        "source_url": "https://example.test/reference.pdf",
                        "mime": "application/pdf",
                        "notes": "reference-only CLI fixture",
                        "election_year": 2025,
                        "election_round": "provinciales",
                    }
                ]
            }
        ),
        encoding="utf-8",
    )
    manifest_path = tmp_path / "manifest.json"
    manifest_path.write_text(
        json.dumps(
            [
                {
                    "id": source_id,
                    "status": "ok",
                    "archived_path": "archive/pba/reference.pdf",
                    "sha256": hashlib.sha256(b"archived reference").hexdigest(),
                }
            ]
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(
        "etl.__main__.read_archived_source",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(
            AssertionError("main must refuse the PDF before archive access")
        ),
    )
    monkeypatch.setattr(
        "etl.__main__.ingest_pba",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(
            AssertionError("main must refuse the PDF before parser access")
        ),
    )
    monkeypatch.setattr(
        "etl.__main__.psycopg.connect",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(
            AssertionError("main must refuse the PDF before database access")
        ),
    )

    exit_code = main(
        _main_args(sources_path, tmp_path / "archive", manifest_path)
        + [
            "ingest",
            "--source",
            source_id,
            "--database-url",
            "postgresql://must-not-connect/unused",
            "--year",
            "2025",
            "--round",
            "provinciales",
        ]
    )

    assert exit_code == 1
    report = capsys.readouterr().err
    assert source_id in report
    assert "application/pdf" in report
    assert "text/html" in report
    assert "Traceback" not in report


def test_ingest_refuses_to_write_without_an_explicit_database_url(tmp_path: Path) -> None:
    env_without_url = dict(os.environ)
    env_without_url.pop("ETL_DATABASE_URL", None)
    os_environ_backup = dict(os.environ)
    os.environ.clear()
    os.environ.update(env_without_url)
    try:
        with pytest.raises(MissingDatabaseUrlError):
            ingest_source(
                "national/fake-test",
                database_url=None,
                year=2025,
                round_="legislativas",
                sources=FAKE_SOURCES,
                local_root=tmp_path / "archive",
                manifest_path=tmp_path / "archive-manifest.json",
            )
    finally:
        os.environ.clear()
        os.environ.update(os_environ_backup)


# ---------------------------------------------------------------------------
# 12.3 -- ingest loads rows into result_row (real ephemeral Postgres)
# ---------------------------------------------------------------------------

TEST_DSN = os.environ.get(
    "ETL_TEST_DATABASE_URL", "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
)


def _require_ephemeral_postgres() -> None:
    try:
        conn = psycopg.connect(TEST_DSN, connect_timeout=2)
        conn.close()
        return None
    except psycopg.OperationalError as exc:
        pytest.skip(f"no ephemeral Postgres reachable at {TEST_DSN!r}: {exc}")


NATIONAL_CSV = (
    "distrito_id,distrito_nombre,seccion_id,seccion_nombre,circuito_id,circuito_nombre,"
    "mesa_id,cargo_nombre,agrupacion_id,votos_tipo,votos_cantidad,estado_final\n"
    "02,BUENOS AIRES,027,CORONEL ROSALES,01,Circuito 01,1,DIPUTADO NACIONAL,"
    "135,POSITIVO,120,definitivo\n"
    "02,BUENOS AIRES,027,CORONEL ROSALES,01,Circuito 01,1,DIPUTADO NACIONAL,"
    "134,POSITIVO,80,definitivo\n"
)


def test_ingest_subcommand_loads_rows_into_result_row(tmp_path: Path) -> None:
    _require_ephemeral_postgres()

    source_id = f"national/cli-test-{uuid.uuid4()}"
    sources = {
        "national": [
            {
                "id": source_id,
                "source": "example.test",
                "source_url": "https://example.test/cli-test.csv",
                "mime": "text/csv",
                "election_year": 2025,
                "election_round": "legislativas",
                "notes": "CLI integration fixture",
                "filename": "cli-test.csv",
            }
        ]
    }
    fetcher = FakeFetcher(payload=NATIONAL_CSV.encode("utf-8"))
    manifest_path = tmp_path / "archive-manifest.json"
    local_root = tmp_path / "archive"

    fetch_source(
        source_id,
        sources=sources,
        fetcher=fetcher,
        local_root=local_root,
        manifest_path=manifest_path,
    )

    conn = psycopg.connect(TEST_DSN)
    try:
        inserted = ingest_source(
            source_id,
            database_url=TEST_DSN,
            year=2025,
            round_="legislativas",
            sources=sources,
            local_root=local_root,
            manifest_path=manifest_path,
        )
        assert inserted == 2

        second_inserted = ingest_source(
            source_id,
            database_url=TEST_DSN,
            year=2025,
            round_="legislativas",
            sources=sources,
            local_root=local_root,
            manifest_path=manifest_path,
        )
        assert second_inserted == 2

        with conn.cursor() as cur:
            cur.execute("select count(*) from result_row where archive_entry_id = %s", (source_id,))
            count_row = cur.fetchone()
            assert count_row == (2,), (
                f"ingest must persist exactly two result rows; got {count_row!r}"
            )
            cur.execute(
                # Exact column path used by web `fetchSourceRefs`.
                "select id, sha256, source_url, fetched_at from archive_entry where id = %s",
                (source_id,),
            )
            provenance_rows = cur.fetchall()
            assert len(provenance_rows) == 1
            projected = provenance_rows[0]
            assert projected[0] == source_id
            assert projected[1] == hashlib.sha256(NATIONAL_CSV.encode("utf-8")).hexdigest()
            assert projected[2] == sources["national"][0]["source_url"]
            assert projected[3] is not None
            cur.execute("select source_kind from archive_entry where id = %s", (source_id,))
            assert cur.fetchone() == ("official",)
    finally:
        with conn.cursor() as cur:
            cur.execute("delete from result_row where archive_entry_id = %s", (source_id,))
            cur.execute("delete from archive_entry where id = %s", (source_id,))
        conn.commit()
        conn.close()


def test_ingest_cli_streams_selected_national_member_into_real_db_without_unbounded_read(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    """The production CLI must keep the extracted results member file-backed."""
    _require_ephemeral_postgres()

    results_csv = NATIONAL_CSV + (
        "02,BUENOS AIRES,027,CORONEL ROSALES,01,Circuito 01,2,DIPUTADO NACIONAL,"
        "136,POSITIVO,70,definitivo\n"
    )
    companion_csv = (
        "distrito_id,seccion_id,localvotacion_codigo,localvotacion_nombre,mesa_id\n"
        "2,27,37974,INSTITUTO SUPERIOR DE FORM.DOCENTE N°79,00001\n"
        "2,27,37974,OTRO ESTABLECIMIENTO,00003\n"
        "2,27,88888,ESCUELA DOS,00002\n"
    )
    archive_buffer = io.BytesIO()
    with zipfile.ZipFile(archive_buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("resultados2025.csv", results_csv)
        archive.writestr("localesDeVotacionyMesas.csv", companion_csv)
        archive.writestr("ambitosElectorales.csv", "not,the,results,file\n")

    source_id = f"national/cli-stream-test-{uuid.uuid4()}"
    filename = f"{uuid.uuid4().hex}.zip"
    sources = {
        "national": [
            {
                "id": source_id,
                "source": "example.test",
                "source_url": "https://example.test/cli-stream-test.zip",
                "mime": "application/zip",
                "election_year": 2025,
                "election_round": "legislativas",
                "notes": "CLI streaming integration fixture",
                "filename": filename,
            }
        ]
    }
    sources_path = tmp_path / "sources.yaml"
    sources_path.write_text(yaml.safe_dump(sources), encoding="utf-8")
    manifest_path = tmp_path / "archive-manifest.json"
    local_root = tmp_path / "archive"
    fetch_source(
        source_id,
        sources=sources,
        fetcher=FakeFetcher(payload=archive_buffer.getvalue()),
        local_root=local_root,
        manifest_path=manifest_path,
    )

    original_read_bytes = Path.read_bytes
    original_open = Path.open

    class BoundedResultsText(io.TextIOBase):
        def __init__(self, wrapped: io.TextIOBase) -> None:
            self.wrapped = wrapped

        def read(self, size: int = -1) -> str:
            assert size >= 0, "selected results member was read without a bound"
            return self.wrapped.read(size)

        def readline(self, size: int = -1) -> str:
            return self.wrapped.readline(size)

        def __iter__(self):
            return self

        def __next__(self) -> str:
            return next(self.wrapped)

        def seek(self, offset: int, whence: int = 0) -> int:
            return self.wrapped.seek(offset, whence)

        def tell(self) -> int:
            return self.wrapped.tell()

        def close(self) -> None:
            self.wrapped.close()
            super().close()

    def guarded_read_bytes(path: Path) -> bytes:
        assert path.name != "resultados2025.csv", "selected results member used Path.read_bytes()"
        return original_read_bytes(path)

    def guarded_open(path: Path, *args, **kwargs):
        handle = original_open(path, *args, **kwargs)
        mode = args[0] if args else kwargs.get("mode", "r")
        if path.name == "resultados2025.csv" and "b" not in mode:
            return BoundedResultsText(handle)
        return handle

    monkeypatch.setattr(Path, "read_bytes", guarded_read_bytes)
    monkeypatch.setattr(Path, "open", guarded_open)
    args = _main_args(sources_path, local_root, manifest_path) + [
        "ingest",
        "--source",
        source_id,
        "--database-url",
        TEST_DSN,
        "--year",
        "2025",
        "--round",
        "legislativas",
    ]

    conn = psycopg.connect(TEST_DSN)
    try:
        assert main(args) == 0
        assert main(args) == 0
        with conn.cursor() as cur:
            cur.execute(
                """
                select rr.list_id, rr.votes, rr.source_kind, j.establecimiento_code
                  from result_row rr
                  join jurisdiction j on j.id = rr.jurisdiction_id
                 where rr.archive_entry_id = %s
                 order by rr.list_id
                """,
                (source_id,),
            )
            assert cur.fetchall() == [("136", 70, "official", "88888")]
        report = capsys.readouterr().err
        assert "establishment_code_multiple_names: 2 unique key(s)" in report
    finally:
        with conn.cursor() as cur:
            cur.execute("delete from result_row where archive_entry_id = %s", (source_id,))
            cur.execute("delete from archive_entry where id = %s", (source_id,))
        conn.commit()
        conn.close()


def test_ingest_refuses_conflicting_archive_projection_before_result_rows(tmp_path: Path) -> None:
    _require_ephemeral_postgres()
    source_id = f"national/cli-conflict-{uuid.uuid4()}"
    sources = {
        "national": [
            {
                "id": source_id,
                "source": "example.test",
                "source_url": "https://example.test/current.csv",
                "mime": "text/csv",
                "election_year": 2025,
                "election_round": "legislativas",
                "notes": "conflict fixture",
                "filename": "conflict.csv",
            }
        ]
    }
    manifest_path = tmp_path / "archive-manifest.json"
    local_root = tmp_path / "archive"
    fetch_source(
        source_id,
        sources=sources,
        fetcher=FakeFetcher(payload=NATIONAL_CSV.encode("utf-8")),
        local_root=local_root,
        manifest_path=manifest_path,
    )

    conn = psycopg.connect(TEST_DSN)
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                insert into archive_entry (
                  id, capability, source, source_url, archived_path, sha256,
                  mime, bytes, fetched_at, status, source_kind, notes
                ) values (%s, 'national', 'example.test', %s, null, null,
                          'text/csv', null, now(), 'ok', 'official', 'conflict fixture')
                """,
                (source_id, "https://example.test/conflicting.csv"),
            )
        conn.commit()

        with pytest.raises(ValueError, match="archive_entry.*conflict"):
            ingest_source(
                source_id,
                database_url=TEST_DSN,
                year=2025,
                round_="legislativas",
                sources=sources,
                local_root=local_root,
                manifest_path=manifest_path,
            )

        with conn.cursor() as cur:
            cur.execute("select count(*) from result_row where archive_entry_id = %s", (source_id,))
            assert cur.fetchone() == (0,)
    finally:
        with conn.cursor() as cur:
            cur.execute("delete from result_row where archive_entry_id = %s", (source_id,))
            cur.execute("delete from archive_entry where id = %s", (source_id,))
        conn.commit()
        conn.close()


def test_ingest_extracts_the_results_csv_from_a_zip_archived_national_source(
    tmp_path: Path,
) -> None:
    """A real registered national source is a ZIP (per `sources.yaml`), not
    a bare CSV -- `ingest` must extract the results member before parsing,
    the same `extract_zip_safely`-then-`iter_national_rows` path
    `tests/test_ingest_national.py::test_idempotent_reingest_via_real_fixture_zip`
    already proves at the parser level, exercised here end to end through
    the CLI (task 12d's real-pipeline proof needs exactly this path).
    """
    _require_ephemeral_postgres()

    import io
    import zipfile

    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("resultados2025.csv", NATIONAL_CSV)
        zf.writestr(
            "localesDeVotacionyMesas.csv",
            (
                "distrito_id,seccion_id,localvotacion_codigo,localvotacion_nombre,mesa_id\n"
                "2,27,37974,INSTITUTO SUPERIOR DE FORM.DOCENTE N°79,00001\n"
            ),
        )
        zf.writestr("ambitosElectorales.csv", "not,the,results,file\n")
    zip_bytes = buffer.getvalue()

    source_id = f"national/cli-zip-test-{uuid.uuid4()}"
    sources = {
        "national": [
            {
                "id": source_id,
                "source": "example.test",
                "source_url": "https://example.test/cli-zip-test.zip",
                "mime": "application/zip",
                "election_year": 2025,
                "election_round": "legislativas",
                "notes": "CLI ZIP-extraction fixture",
                "filename": "cli-zip-test.zip",
            }
        ]
    }
    fetcher = FakeFetcher(payload=zip_bytes)
    manifest_path = tmp_path / "archive-manifest.json"
    local_root = tmp_path / "archive"

    fetch_source(
        source_id,
        sources=sources,
        fetcher=fetcher,
        local_root=local_root,
        manifest_path=manifest_path,
    )

    conn = psycopg.connect(TEST_DSN)
    try:
        inserted = ingest_source(
            source_id,
            database_url=TEST_DSN,
            year=2025,
            round_="legislativas",
            sources=sources,
            local_root=local_root,
            manifest_path=manifest_path,
        )
        assert inserted == 2

        second_inserted = ingest_source(
            source_id,
            database_url=TEST_DSN,
            year=2025,
            round_="legislativas",
            sources=sources,
            local_root=local_root,
            manifest_path=manifest_path,
        )
        assert second_inserted == 2

        with conn.cursor() as cur:
            cur.execute(
                """
                select count(*), count(distinct j.id), min(j.establecimiento_code),
                       min(j.distrito_name), min(j.seccion_name), min(j.circuito_name),
                       min(j.establecimiento_name)
                  from result_row rr
                  join jurisdiction j on j.id = rr.jurisdiction_id
                 where rr.archive_entry_id = %s
                """,
                (source_id,),
            )
            persisted = cur.fetchone()
            assert persisted == (
                2,
                1,
                "37974",
                "BUENOS AIRES",
                "CORONEL ROSALES",
                "Circuito 01",
                "INSTITUTO SUPERIOR DE FORM.DOCENTE N°79",
            ), (
                "ZIP re-ingestion must preserve two rows under one fully sourced "
                f"establecimiento lineage; got {persisted!r}"
            )
    finally:
        with conn.cursor() as cur:
            cur.execute("delete from result_row where archive_entry_id = %s", (source_id,))
        conn.commit()
        conn.close()


# ---------------------------------------------------------------------------
# review_item persistence reaches production through `ingest_source`
# ---------------------------------------------------------------------------


FISCALIZACION_HEADER = "Escuela,Mesa," + ",".join(FISCALIZACION_VOTE_COLUMNS) + "\n"


def _fiscalizacion_csv(rows: list[str]) -> str:
    return FISCALIZACION_HEADER + "".join(rows)


def test_ingest_persists_the_review_items_the_fiscalizacion_run_produced(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys,
) -> None:
    """Drives `ingest_source`, not the projection function.

    `insert_review_items` was fully implemented and fully tested with ZERO
    production callers, so every review item a real ingestion produced died in
    memory while `review_item.py` documented that function as "the only write
    path". A test that calls the projection proves nothing reaches it.
    """
    _require_ephemeral_postgres()

    zeros = ",".join(["0"] * (len(FISCALIZACION_VOTE_COLUMNS) - 1))
    # One blank vote cell: blank is MISSING, not zero, so ingestion raises a
    # `blank_vote_cell` review item -- the draft this test follows to the table.
    private_cells = ("PRIVATE_CELL_C", "PRIVATE_CELL_D")
    csv_text = "Nombre,Apellido," + _fiscalizacion_csv(
        [f"{private_cells[0]},{private_cells[1]},ESCUELA TEST,Mesa 4242,,{zeros}\n"]
    )
    decoded: list[bytes] = []

    def decode_retained(data: bytes, *, context: str) -> str:
        del context
        decoded.append(bytes(data))
        assert all(cell.encode() not in data for cell in private_cells)
        return bytes(data).decode("utf-8")

    monkeypatch.setattr("etl.ingest.fiscalizacion._decode_utf8", decode_retained, raising=False)

    source_id = f"fiscalizacion/cli-review-item-{uuid.uuid4()}"
    filename = "cli-review-item.csv"
    sources = {
        "fiscalizacion": [
            {
                "id": source_id,
                "source": "internal",
                "source_url": f"local://{source_id}.csv",
                "mime": "text/csv",
                "election_year": 2025,
                "election_round": "legislativas",
                "source_kind": "fiscalizacion",
                "notes": "CLI review-item fixture",
                "filename": filename,
                "upload": "never",
            }
        ]
    }
    manifest_path = tmp_path / "archive-manifest.json"
    local_root = tmp_path / "archive"
    # Written straight to the local mirror: fiscalización is upload-forbidden,
    # so there is no `fetch` path to produce it.
    LocalArchiveStore(root=local_root).write("fiscalizacion", filename, csv_text.encode("utf-8"))
    manifest_path.write_text(
        json.dumps(
            [
                {
                    "id": source_id,
                    "status": "ok",
                    "archived_path": f"archive/fiscalizacion/{filename}",
                    "sha256": hashlib.sha256(csv_text.encode("utf-8")).hexdigest(),
                    "fetched_at": "2026-01-01T00:00:00Z",
                }
            ]
        ),
        encoding="utf-8",
    )

    conn = psycopg.connect(TEST_DSN)
    try:
        ingest_source(
            source_id,
            database_url=TEST_DSN,
            year=2025,
            round_="legislativas",
            sources=sources,
            local_root=local_root,
            manifest_path=manifest_path,
        )
        with conn.cursor() as cur:
            cur.execute(
                "select kind, severity, note, subject_ref from review_item "
                "where starts_with(subject_ref, %s) order by kind",
                (f"{source_id} ",),
            )
            written = cur.fetchall()
            cur.execute("select source_kind from archive_entry where id = %s", (source_id,))
            assert cur.fetchone() == ("fiscalizacion",)
        with psycopg.connect(TEST_DSN, user="postgres") as admin_conn, admin_conn.cursor() as cur:
            cur.execute(
                "select r.kind,c.context_role,c.source_kind,c.archive_availability,"
                "c.election_year,c.archive_entry_id,c.unknown_reason from review_item r "
                "join workspace_private.review_item_context c on c.review_item_id=r.id "
                "where starts_with(r.subject_ref,%s) order by r.kind",
                (f"{source_id} ",),
            )
            written_contexts = cur.fetchall()
    finally:
        with conn.cursor() as cur:
            cur.execute(
                # EVERY row this run wrote, not just the parser's. Mesa 4242
                # exists in no official jurisdiction, so the LOADER also emits
                # `mesa_absent_from_official_import` under a different
                # subject_ref, and that row leaked into the shared database on
                # every run. `starts_with`, not `like`: `_` and `%` are LIKE
                # wildcards and a source id carries both.
                "delete from review_item where starts_with(subject_ref, %s)",
                (f"{source_id} ",),
            )
            cur.execute("delete from result_row where archive_entry_id = %s", (source_id,))
            cur.execute("delete from archive_entry where id = %s", (source_id,))
        conn.commit()
        conn.close()

    assert [(kind, severity) for kind, severity, *_rest in written] == [
        ("blank_vote_cell", "info"),
        ("mesa_absent_from_official_import", "warning"),
    ], (
        "the ingestion's review item must reach `review_item`, scoped by source "
        f"id so two sources observing the same mesa number stay distinct; got {written}"
    )
    assert written_contexts == [
        (kind, "observed", "fiscalizacion", "available", 2025, source_id, None)
        for kind in ("blank_vote_cell", "mesa_absent_from_official_import")
    ]
    assert decoded
    captured = capsys.readouterr()
    output = captured.out + captured.err
    assert all(cell not in output and cell not in repr(written) for cell in private_cells)


def test_ingest_fiscalizacion_reports_the_authoritative_recorded_count(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys,
) -> None:
    source_id = "fiscalizacion/authoritative-review-count"
    payload = b"fixture"
    local_root = tmp_path / "archive"
    LocalArchiveStore(root=local_root).write("fiscalizacion", "fixture.csv", payload)
    manifest_path = tmp_path / "archive-manifest.json"
    manifest_path.write_text(
        json.dumps(
            [
                {
                    "id": source_id,
                    "status": "ok",
                    "archived_path": "archive/fiscalizacion/fixture.csv",
                    "sha256": hashlib.sha256(payload).hexdigest(),
                    "fetched_at": "2026-01-01T00:00:00Z",
                }
            ]
        ),
        encoding="utf-8",
    )
    sources = {
        "fiscalizacion": [
            {
                "id": source_id,
                "source": "internal",
                "source_url": "local://fixture.csv",
                "mime": "text/csv",
                "election_year": 2025,
                "election_round": "legislativas",
                "notes": "authoritative count fixture",
                "filename": "fixture.csv",
                "upload": "never",
            }
        ]
    }

    class FakeConnection:
        def commit(self) -> None:
            pass

        def rollback(self) -> None:
            pass

        def close(self) -> None:
            pass

    draft = SimpleNamespace(
        kind="blank_vote_cell",
        severity="info",
        subject_ref="mesa 1",
        note="one candidate",
    )
    candidates: list[object] = []
    monkeypatch.setattr("etl.__main__.psycopg.connect", lambda _url: FakeConnection())
    monkeypatch.setattr("etl.__main__.project_archive_entry", lambda *_args: None)
    monkeypatch.setattr("etl.__main__.load_party_map", lambda _path: object())
    monkeypatch.setattr(
        "etl.__main__.ingest_fiscalizacion",
        lambda *_args, **_kwargs: SimpleNamespace(rows=[], review_items=[draft], quarantined=[]),
    )
    monkeypatch.setattr(
        "etl.ingest.fiscalizacion.load_fiscalizacion_rows",
        lambda *_args, **_kwargs: SimpleNamespace(
            inserted=0,
            review_items=[],
            election_id="election-id",
            category_id="category-id",
        ),
    )
    monkeypatch.setattr(
        "etl.__main__.insert_review_items",
        lambda _conn, records: candidates.extend(records) or 0,
    )

    ingest_source(
        source_id,
        database_url="postgresql://not-opened/test",
        year=2025,
        round_="legislativas",
        sources=sources,
        local_root=local_root,
        manifest_path=manifest_path,
        party_map_path=tmp_path / "unused-party-map.yaml",
    )

    # fmt: off
    assert len(candidates) == 1
    assert [(scope.distrito_code, scope.seccion_code) for scope in candidates[0].section_scopes] == [("02", "027")]  # noqa: E501
    assert candidates[0].contexts == (ReviewItemContext("observed", "fiscalizacion", "available", 2025, "election-id", "category-id", source_id),)  # noqa: E501
    # fmt: on
    report = capsys.readouterr().err
    assert "review scope: section_scoped=1, platform_only=0" in report
    assert "review items: 0 recorded, 1 not recorded" in report


def test_ingest_submits_a_candidate_that_resolves_after_prefilter_before_insert(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys,
) -> None:
    from etl.db import insert_review_items as atomic_insert_review_items
    from etl.db import upsert_category, upsert_election
    from etl.ingest.fiscalizacion import FISCALIZACION_CATEGORY, FiscalizacionLoadResult

    _require_ephemeral_postgres()
    source_id = f"fiscalizacion/resolved-after-prefilter-{uuid.uuid4()}"
    payload = b"fixture"
    local_root = tmp_path / "archive"
    LocalArchiveStore(root=local_root).write("fiscalizacion", "fixture.csv", payload)
    manifest_path = tmp_path / "archive-manifest.json"
    manifest_path.write_text(
        json.dumps(
            [
                {
                    "id": source_id,
                    "status": "ok",
                    "archived_path": "archive/fiscalizacion/fixture.csv",
                    "sha256": hashlib.sha256(payload).hexdigest(),
                    "fetched_at": "2026-01-01T00:00:00Z",
                }
            ]
        ),
        encoding="utf-8",
    )
    sources = {
        "fiscalizacion": [
            {
                "id": source_id,
                "source": "internal",
                "source_url": "local://fixture.csv",
                "mime": "text/csv",
                "election_year": 2025,
                "election_round": "legislativas",
                "source_kind": "fiscalizacion",
                "notes": "stale prefilter fixture",
                "filename": "fixture.csv",
                "upload": "never",
            }
        ]
    }
    draft = SimpleNamespace(
        kind="blank_vote_cell",
        severity="info",
        subject_ref="mesa 1",
        note="one candidate",
    )
    subject_ref = f"{source_id} 2025-legislativas mesa 1"

    with psycopg.connect(TEST_DSN) as seed_conn, seed_conn.cursor() as cur:
        cur.execute(
            "insert into review_item (kind, severity, subject_ref, note) "
            "values ('blank_vote_cell', 'info', %s, 'one candidate')",
            (subject_ref,),
        )
        election_id = upsert_election(seed_conn, year=2025, round_="legislativas")
        category_id = upsert_category(seed_conn, name=FISCALIZACION_CATEGORY)
    load_result = FiscalizacionLoadResult(0, [], election_id, category_id)

    monkeypatch.setattr("etl.__main__.load_party_map", lambda _path: object())
    monkeypatch.setattr(
        "etl.__main__.ingest_fiscalizacion",
        lambda *_args, **_kwargs: SimpleNamespace(rows=[], review_items=[draft], quarantined=[]),
    )
    monkeypatch.setattr(
        "etl.ingest.fiscalizacion.load_fiscalizacion_rows",
        lambda *_args, **_kwargs: load_result,
    )

    def resolve_then_insert(conn, records) -> int:
        with psycopg.connect(TEST_DSN) as resolver_conn, resolver_conn.cursor() as cur:
            cur.execute(
                "update review_item set resolved_at = now() "
                "where subject_ref = %s and resolved_at is null",
                (subject_ref,),
            )
            assert cur.rowcount == 1
        return atomic_insert_review_items(conn, records)

    monkeypatch.setattr("etl.__main__.insert_review_items", resolve_then_insert)

    try:
        ingest_source(
            source_id,
            database_url=TEST_DSN,
            year=2025,
            round_="legislativas",
            sources=sources,
            local_root=local_root,
            manifest_path=manifest_path,
            party_map_path=tmp_path / "unused-party-map.yaml",
        )

        with psycopg.connect(TEST_DSN) as verify_conn, verify_conn.cursor() as cur:
            cur.execute(
                "select count(*), count(*) filter (where resolved_at is null) "
                "from review_item where subject_ref = %s",
                (subject_ref,),
            )
            assert cur.fetchone() == (2, 1), (
                "resolution committed before the authoritative insert statement must allow "
                "the submitted observation to recur"
            )
        assert "review items: 1 recorded, 0 not recorded" in capsys.readouterr().err
    finally:
        with psycopg.connect(TEST_DSN) as cleanup_conn, cleanup_conn.cursor() as cur:
            cur.execute("delete from review_item where subject_ref = %s", (subject_ref,))
            cur.execute("delete from archive_entry where id = %s", (source_id,))


@pytest.mark.parametrize(
    ("header", "expected_diagnosis"),
    [
        (
            "PRIVATE_UNKNOWN_HEADER,Escuela,Mesa\n",
            "1 unexpected header field at position 1",
        ),
        (
            "PRIVATE_DUPLICATE_HEADER,PRIVATE_DUPLICATE_HEADER,Escuela,Mesa\n",
            "1 duplicate header group involving 2 fields at positions 1, 2",
        ),
    ],
)
def test_validate_fiscalizacion_header_errors_never_disclose_source_tokens(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys,
    caplog: pytest.LogCaptureFixture,
    header: str,
    expected_diagnosis: str,
) -> None:
    sentinel = header.split(",", 1)[0]
    fiscalizacion_bytes = header.encode("utf-8")
    baseline_bytes = b"unused baseline"
    fiscalizacion_id = "fiscalizacion/private-header"
    baseline_id = "national/private-header-baseline"
    local_root = tmp_path / "archive"
    store = LocalArchiveStore(root=local_root)
    store.write("fiscalizacion", "fisc.csv", fiscalizacion_bytes)
    store.write("national", "nat.csv", baseline_bytes)

    sources_path = tmp_path / "sources.yaml"
    sources_path.write_text(
        yaml.safe_dump(
            {
                "fiscalizacion": [
                    {
                        "id": fiscalizacion_id,
                        "source": "internal",
                        "source_url": "local://fiscalizacion/fisc.csv",
                        "mime": "text/csv",
                        "election_year": 2025,
                        "election_round": "legislativas",
                        "notes": "private header fixture",
                        "filename": "fisc.csv",
                        "upload": "never",
                    }
                ],
                "national": [
                    {
                        "id": baseline_id,
                        "source": "example.test",
                        "source_url": "https://example.test/nat.csv",
                        "mime": "text/csv",
                        "election_year": 2025,
                        "election_round": "legislativas",
                        "notes": "private header baseline",
                        "filename": "nat.csv",
                    }
                ],
            }
        ),
        encoding="utf-8",
    )
    manifest_path = tmp_path / "archive-manifest.json"
    manifest_path.write_text(
        json.dumps(
            [
                {
                    "id": fiscalizacion_id,
                    "status": "ok",
                    "archived_path": "archive/fiscalizacion/fisc.csv",
                    "sha256": hashlib.sha256(fiscalizacion_bytes).hexdigest(),
                    "fetched_at": "2026-01-01T00:00:00Z",
                },
                {
                    "id": baseline_id,
                    "status": "ok",
                    "archived_path": "archive/national/nat.csv",
                    "sha256": hashlib.sha256(baseline_bytes).hexdigest(),
                    "fetched_at": "2026-01-01T00:00:00Z",
                },
            ]
        ),
        encoding="utf-8",
    )
    review_writes: list[object] = []
    monkeypatch.setattr(
        "etl.__main__.insert_review_items",
        lambda _conn, records: review_writes.extend(records),
    )

    with pytest.raises(FiscalizacionSchemaError) as excinfo:
        ingest_fiscalizacion(fiscalizacion_bytes, archive_entry_id=fiscalizacion_id)
    exit_code = main(
        _main_args(sources_path, local_root, manifest_path)
        + [
            "validate-fiscalizacion",
            "--source",
            fiscalizacion_id,
            "--baseline",
            baseline_id,
            "--database-url",
            "postgresql://unused/unused",
        ]
    )

    captured = capsys.readouterr()
    observable = "\n".join((str(excinfo.value), captured.out, captured.err, caplog.text))
    assert exit_code == 1
    assert expected_diagnosis in observable
    assert sentinel not in observable
    assert sentinel not in repr(review_writes)
    assert review_writes == []


def test_a_synthetic_truncated_row_does_not_borrow_a_curated_child_seccion() -> None:
    """A partido crosswalk entry cannot resolve its parent province identity."""
    crosswalk = CrosswalkTable(
        jurisdictions=(
            JurisdictionCrosswalkEntry(
                pba_distrito_code="027",
                national_distrito_code="02",
                national_seccion_code="027",
                name="Coronel de Marina Leonardo Rosales",
            ),
        )
    )

    incomplete = find_unmapped_jurisdictions([("2", None)], crosswalk)

    assert [entry.code for entry in incomplete] == ["02/(sin seccion)"]
    assert "no curated crosswalk entry" in incomplete[0].reason
    assert find_unmapped_jurisdictions([("2", "27")], crosswalk) == []


def test_a_zip_with_no_results_member_raises_rather_than_returning_a_wrong_file(
    tmp_path: Path,
) -> None:
    """`NationalResultsCsvNotFoundError` was raised and never asserted."""
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as zf:
        zf.writestr("ambitosElectorales.csv", "not,the,results,file\n")
        # Substring-matches `mesa_id` without BEING it: the shape the parsed
        # field-set check exists to reject.
        zf.writestr("otro.csv", "mesa_id_original,distrito_id\n")

    with pytest.raises(NationalResultsCsvNotFoundError):
        resolve_national_results_bytes(buffer.getvalue(), extract_dir=tmp_path)


def test_load_curated_refuses_a_jurisdiction_present_in_only_one_year(
    tmp_path: Path,
) -> None:
    """The refusal at the granularity where the harm happens.

    A readable 2023 source proves a FILE exists, not that it carries rows for
    the jurisdiction being curated. When it does not, every mesa was persisted
    as `present_2023=False, stable_across_years=False` -- absence of coverage
    recorded as measured instability, which the jurisdiction-model spec says
    MUST NOT be assumed.
    """
    _require_ephemeral_postgres()

    header = (
        "distrito_id,seccion_id,circuito_id,mesa_id,cargo_nombre,agrupacion_id,"
        "votos_tipo,votos_cantidad,estado_final\n"
    )
    # 2025 carries the curated jurisdiction; 2023 carries a DIFFERENT seccion,
    # so its file is readable and its mesa set for this jurisdiction is empty.
    csv_2025 = header + "90,001,01,1,DIPUTADO NACIONAL,900001,POSITIVO,10,definitivo\n"
    csv_2023 = header + "90,999,01,7,DIPUTADO NACIONAL,900001,POSITIVO,10,definitivo\n"

    local_root = tmp_path / "archive"
    store = LocalArchiveStore(root=local_root)
    store.write("national", "n2025.csv", csv_2025.encode("utf-8"))
    store.write("national", "n2023.csv", csv_2023.encode("utf-8"))

    sources = {
        "national": [
            {
                "id": "national/2025-onlyyear",
                "source": "example.test",
                "source_url": "https://example.test/n2025.csv",
                "mime": "text/csv",
                "election_year": 2025,
                "election_round": "legislativas",
                "notes": "fixture",
                "filename": "n2025.csv",
            },
            {
                "id": "national/2023-onlyyear",
                "source": "example.test",
                "source_url": "https://example.test/n2023.csv",
                "mime": "text/csv",
                "election_year": 2023,
                "election_round": "generales",
                "notes": "fixture",
                "filename": "n2023.csv",
            },
        ]
    }
    manifest_path = tmp_path / "archive-manifest.json"
    manifest_path.write_text(
        json.dumps(
            [
                {
                    "id": "national/2025-onlyyear",
                    "status": "ok",
                    "archived_path": "archive/national/n2025.csv",
                    "sha256": hashlib.sha256(csv_2025.encode("utf-8")).hexdigest(),
                    "fetched_at": "2026-01-01T00:00:00Z",
                },
                {
                    "id": "national/2023-onlyyear",
                    "status": "ok",
                    "archived_path": "archive/national/n2023.csv",
                    "sha256": hashlib.sha256(csv_2023.encode("utf-8")).hexdigest(),
                    "fetched_at": "2026-01-01T00:00:00Z",
                },
            ]
        ),
        encoding="utf-8",
    )

    party_map_path = tmp_path / "party_map.yaml"
    party_map_path.write_text(
        yaml.safe_dump({"canonical_parties": [], "mappings": []}), encoding="utf-8"
    )
    crosswalk_path = tmp_path / "crosswalk.yaml"
    crosswalk_path.write_text(
        yaml.safe_dump(
            {
                "jurisdictions": [
                    {
                        "pba_distrito": str(uuid.uuid4().int),
                        "national_distrito": "90",
                        "national_seccion": "001",
                        "name": "Only-one-year fixture",
                    }
                ]
            }
        ),
        encoding="utf-8",
    )

    with pytest.raises(MissingArchivedYearError, match="none in 2023"):
        load_curated(
            database_url=TEST_DSN,
            sources=sources,
            local_root=local_root,
            manifest_path=manifest_path,
            party_map_path=party_map_path,
            crosswalk_path=crosswalk_path,
        )


def test_an_id_registered_under_two_capabilities_is_refused() -> None:
    """The capability selects the ingest branch, so picking one is not free.

    Before the refusal, an id in two families routed to whichever
    `sources.yaml` happened to list first. Nothing pinned that, so a future
    `return matches[0]` would restore the silent pick.
    """
    from etl.__main__ import AmbiguousSourceError, find_source_entry

    sources = {
        "national": [{"id": "shared/id", "filename": "a.csv"}],
        "fiscalizacion": [{"id": "shared/id", "filename": "b.csv"}],
    }

    with pytest.raises(AmbiguousSourceError, match="refusing to pick one"):
        find_source_entry(sources, "shared/id")


def test_backfill_mesa_tipo_reports_bounded_exclusion_locators_by_category_and_reason_through_main(
    tmp_path: Path, capsys, monkeypatch
) -> None:
    """The CLI reports safe row locators without retaining every excluded row.

    The full-header fixtures model only repository-proven source shapes: archived
    2023 generales and 2025 legislativas. The separate drift fixture exercises a
    missing column; this test makes no PASO or balotaje shape claim.
    """
    full_header = (
        "distrito_id,seccion_id,circuito_id,mesa_id,cargo_nombre,agrupacion_id,"
        "votos_tipo,votos_cantidad,estado_final,mesa_tipo\n"
    )
    private_category_token = "PRIVATE_CATEGORY_TOKEN"
    public_2023_generales_categories = (
        "CONCEJAL",
        "DIPUTADO NACIONAL",
        "DIPUTADO PROVINCIAL",
        "DIPUTADOS/AS DE LA CIUDAD AUTONOMA",
        "GOBERNADOR Y VICE",
        "INTENDENTE",
        "JEFE/A DE GOBIERNO",
        "MIEMBROS DE JUNTA COMUNAL",
        "PARLAMENTO MERCOSUR NACIONAL",
        "PARLAMENTO MERCOSUR REGIONAL",
        "PRESIDENTE Y VICE",
        "SENADOR NACIONAL",
        "SENADOR PROVINCIAL",
    )
    csv_by_source = {
        "national/2023-generales-locators": (
            full_header
            + "02,027,00001,1,DIPUTADO NACIONAL,110,POSITIVO,10,definitivo,\n"
            + "".join(
                f"02,027,00001,public-{index},{category},110,POSITIVO,10,definitivo,NATIVOS\n"
                for index, category in enumerate(public_2023_generales_categories)
            )
        ),
        "national/2024-drifted-locators": (
            "distrito_id,seccion_id,circuito_id,mesa_id,cargo_nombre\n"
            "02,027,00001,2,DIPUTADO NACIONAL\n"
        ),
        "national/2025-legislativas-locators": full_header
        + "02,027,00001,,DIPUTADO NACIONAL,110,POSITIVO,10,definitivo,NATIVOS\n"
        + "".join(
            f"02,027,00001,private-{index},DIPUTADO NACIONAL,110,POSITIVO,10,definitivo,NATIVOS\n"
            for index in range(6)
        )
        + f"02,027,00001,private-token,{private_category_token},110,"
        "POSITIVO,10,definitivo,NATIVOS\n"
        + ",027,00001,3,,110,POSITIVO,10,definitivo,NATIVOS\n"
        + "2A,027,00001,4,SENADORES NACIONALES,110,POSITIVO,10,definitivo,NATIVOS\n",
    }

    local_root = tmp_path / "archive"
    store = LocalArchiveStore(root=local_root)
    source_entries = []
    manifest_records = []
    for source_id, csv_text in csv_by_source.items():
        year = int(source_id.split("/")[1][:4])
        filename = f"{year}.csv"
        store.write("national", filename, csv_text.encode("utf-8"))
        source_entries.append(
            {
                "id": source_id,
                "source": "example.test",
                "source_url": f"https://example.test/{filename}",
                "election_year": year,
                "election_round": (
                    "generales"
                    if year == 2023
                    else "legislativas"
                    if year == 2025
                    else "synthetic-drift"
                ),
                "mime": "text/csv",
                "notes": "bounded exclusion locator fixture",
                "filename": filename,
            }
        )
        manifest_records.append(
            {
                "id": source_id,
                "status": "ok",
                "archived_path": f"archive/national/{filename}",
                "sha256": hashlib.sha256(csv_text.encode("utf-8")).hexdigest(),
                "fetched_at": "2026-01-01T00:00:00Z",
            }
        )

    sources_path = tmp_path / "sources.yaml"
    sources_path.write_text(yaml.safe_dump({"national": source_entries}), encoding="utf-8")
    manifest_path = tmp_path / "archive-manifest.json"
    manifest_path.write_text(json.dumps(manifest_records), encoding="utf-8")
    monkeypatch.setattr(
        psycopg,
        "connect",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(
            AssertionError("an all-excluded corpus must not connect to PostgreSQL")
        ),
    )

    exit_code = main(
        _main_args(sources_path, local_root, manifest_path)
        + [
            "backfill-mesa-tipo",
            "--database-url",
            "postgresql://all-excluded-must-not-connect/nowhere",
        ]
    )

    reported = capsys.readouterr().err
    assert exit_code == 1
    assert (
        "national/2023-generales-locators: 1 rows carried no mesa_tipo, "
        "0 lacked a required column, 0 had an absent mesa_id, "
        "13 had an unreadable mesa_id" in reported
    )
    assert (
        "national/2024-drifted-locators: 0 rows carried no mesa_tipo, "
        "1 lacked a required column" in reported
    )
    assert (
        "national/2025-legislativas-locators: 0 rows carried no mesa_tipo, "
        "0 lacked a required column, 1 had an absent mesa_id, "
        "7 had an unreadable mesa_id, 1 had an incomplete lineage, "
        "1 carried a non-numeric code" in reported
    )
    assert (
        "category='PRESIDENTE Y VICE' reason=skipped_bad_mesa_id total=1 "
        "omitted_locators=0" in reported
    )
    assert (
        "mesa_tipo exclusion diagnostics for national/2025-legislativas-locators: "
        "locator_sample_cap=5 category_vocabulary_size=13" in reported
    )
    for category in public_2023_generales_categories:
        assert (
            f"category={category!r} reason=skipped_bad_mesa_id total=1 "
            "omitted_locators=0" in reported
        )
    assert (
        "category='DIPUTADO NACIONAL' reason=skipped_bad_mesa_id total=6 "
        "omitted_locators=1\n"
        "    locator source_label='national/2025-legislativas-locators' "
        "data_row_index=1 category='DIPUTADO NACIONAL' "
        "reason=skipped_bad_mesa_id invalid_fields=['mesa_id']\n"
        "    locator source_label='national/2025-legislativas-locators' "
        "data_row_index=2 category='DIPUTADO NACIONAL' "
        "reason=skipped_bad_mesa_id invalid_fields=['mesa_id']\n"
        "    locator source_label='national/2025-legislativas-locators' "
        "data_row_index=3 category='DIPUTADO NACIONAL' "
        "reason=skipped_bad_mesa_id invalid_fields=['mesa_id']\n"
        "    locator source_label='national/2025-legislativas-locators' "
        "data_row_index=4 category='DIPUTADO NACIONAL' "
        "reason=skipped_bad_mesa_id invalid_fields=['mesa_id']\n"
        "    locator source_label='national/2025-legislativas-locators' "
        "data_row_index=5 category='DIPUTADO NACIONAL' "
        "reason=skipped_bad_mesa_id invalid_fields=['mesa_id']" in reported
    )
    assert (
        "data_row_index=6 category='DIPUTADO NACIONAL' reason=skipped_bad_mesa_id" not in reported
    )
    assert (
        "category='DIPUTADO NACIONAL' reason=skipped_missing_column total=1 "
        "omitted_locators=0" in reported
    )
    assert "missing_fields=['mesa_tipo']" in reported
    assert (
        "category='DIPUTADO NACIONAL' reason=skipped_no_tipo total=1 omitted_locators=0" in reported
    )
    assert (
        "category='DIPUTADO NACIONAL' reason=skipped_absent_mesa_id total=1 "
        "omitted_locators=0" in reported
    )
    assert (
        "data_row_index=0 category='DIPUTADO NACIONAL' "
        "reason=skipped_absent_mesa_id missing_fields=['mesa_id']" in reported
    )
    assert "category='(unknown category)' reason=skipped_bad_mesa_id total=1" in reported
    assert (
        "data_row_index=7 category='(unknown category)' "
        "reason=skipped_bad_mesa_id invalid_fields=['mesa_id']" in reported
    )
    assert "category='(unknown category)' reason=skipped_incomplete_lineage total=1" in reported
    assert (
        "data_row_index=8 category='(unknown category)' "
        "reason=skipped_incomplete_lineage missing_fields=['distrito_id']" in reported
    )
    assert (
        "category='(unknown category)' reason=skipped_uncanonical_code total=1 "
        "omitted_locators=0" in reported
    )
    assert (
        "data_row_index=9 category='(unknown category)' "
        "reason=skipped_uncanonical_code invalid_fields=['distrito_id']" in reported
    )
    assert "SENADORES NACIONALES" not in reported
    assert private_category_token not in reported
    assert "private-" not in reported, "raw invalid mesa IDs must never enter diagnostics"


def test_a_mesa_tipo_disagreement_across_sources_exits_nonzero(
    tmp_path: Path, capsys, monkeypatch
) -> None:
    """The disagreement was PRESERVED and provably nothing acted on it.

    The accumulator test asserted the set stays open at `{NATIVOS,
    EXTRANJEROS}` — the input to the check — and stopped there. The refusal
    itself had no driver.

    No Postgres requirement: the refusal fires before `psycopg.connect`, so
    demanding a database made rule 4's silent-pick guard go unverified on any
    machine without one, while the suite reported green.
    """
    header = (
        "distrito_id,seccion_id,circuito_id,mesa_id,cargo_nombre,agrupacion_id,"
        "votos_tipo,votos_cantidad,estado_final,mesa_tipo\n"
    )
    later = "02,027,00002,5000,DIPUTADO NACIONAL,110,POSITIVO,10,definitivo,"
    earlier = "01,001,00001,100,DIPUTADO NACIONAL,110,POSITIVO,10,definitivo,"
    csv_a = header + later + "NATIVOS\n" + earlier + "EXTRANJEROS\n"
    csv_b = header + earlier + "NATIVOS\n" + later + "EXTRANJEROS\n"

    local_root = tmp_path / "archive"
    store = LocalArchiveStore(root=local_root)
    store.write("national", "a.csv", csv_a.encode("utf-8"))
    store.write("national", "b.csv", csv_b.encode("utf-8"))

    sources_path = tmp_path / "sources.yaml"
    sources_path.write_text(
        yaml.safe_dump(
            {
                "national": [
                    {
                        "id": "national/2025-tipo-a",
                        "source": "example.test",
                        "source_url": "https://example.test/a.csv",
                        "election_year": 2025,
                        "election_round": "legislativas",
                        "mime": "text/csv",
                        "notes": "conflict fixture",
                        "filename": "a.csv",
                    },
                    {
                        "id": "national/2025-tipo-b",
                        "source": "example.test",
                        "source_url": "https://example.test/b.csv",
                        "election_year": 2025,
                        "election_round": "legislativas",
                        "mime": "text/csv",
                        "notes": "conflict fixture",
                        "filename": "b.csv",
                    },
                ]
            }
        ),
        encoding="utf-8",
    )
    manifest_path = tmp_path / "archive-manifest.json"
    manifest_path.write_text(
        json.dumps(
            [
                {
                    "id": f"national/2025-tipo-{suffix}",
                    "status": "ok",
                    "archived_path": f"archive/national/{suffix}.csv",
                    "sha256": hashlib.sha256(text.encode("utf-8")).hexdigest(),
                    "fetched_at": "2026-01-01T00:00:00Z",
                }
                for suffix, text in (("a", csv_a), ("b", csv_b))
            ]
        ),
        encoding="utf-8",
    )

    mutation_calls = []

    def record_mutation(*args, **kwargs):
        mutation_calls.append((args, kwargs))
        return 0, 0, [], []

    monkeypatch.setattr(
        psycopg, "connect", lambda *_args, **_kwargs: contextlib.nullcontext(object())
    )
    monkeypatch.setattr("etl.__main__.apply_mesa_tipo_mapping", record_mutation)

    exit_code = main(
        _main_args(sources_path, local_root, manifest_path)
        # A URL that could never connect. Passing `TEST_DSN` let the test
        # pass whether or not the refusal precedes `psycopg.connect` -- the
        # very ordering its docstring asserts -- and would have failed on a
        # machine without Postgres for a reason the docstring says cannot
        # happen. Reaching the database at all is now itself the failure.
        + [
            "backfill-mesa-tipo",
            "--database-url",
            "postgresql://votus-refusal-must-precede-connect/nowhere",
        ]
    )

    reported = capsys.readouterr().err
    assert reported == (
        "2 mesa(s) carry more than one mesa_tipo across the archived sources; "
        "refusing to pick one.\n"
        "  ('01', '001', '00001', 100) -> ['EXTRANJEROS', 'NATIVOS']\n"
        "  ('02', '027', '00002', 5000) -> ['EXTRANJEROS', 'NATIVOS']\n"
    )
    assert mutation_calls == [], "conflicts must refuse before any backfill mutation"
    assert exit_code == 1, "a disagreement across sources must refuse, not pick"


def test_backfill_mesa_tipo_reaches_its_real_work_through_main(tmp_path: Path) -> None:
    """End to end through `main()`: archive read -> mapping -> UPDATE.

    The existing CLI test points at an empty registry and stops at the "nothing
    to map" refusal, so the archive-reading path this command exists for was
    driven only by direct imports — verbatim the shape rule 1 names for the two
    validate commands.
    """
    _require_ephemeral_postgres()

    from etl.db import upsert_category, upsert_election, upsert_jurisdiction

    # Numeric codes: `collect_mesa_tipo_mapping` refuses anything the
    # normalizers cannot canonicalize, so an `X`-prefixed marker would be
    # skipped as an uncanonical code. Isolation comes from the MESA number.
    mesa = 40000 + (uuid.uuid4().int % 9000)
    header = (
        "distrito_id,seccion_id,circuito_id,mesa_id,cargo_nombre,agrupacion_id,"
        "votos_tipo,votos_cantidad,estado_final,mesa_tipo\n"
    )
    csv_text = (
        header + f"97,027,00001,{mesa},DIPUTADO NACIONAL,110,POSITIVO,10,definitivo,EXTRANJEROS\n"
    )

    local_root = tmp_path / "archive"
    LocalArchiveStore(root=local_root).write("national", "tipo.csv", csv_text.encode("utf-8"))
    sources_path = tmp_path / "sources.yaml"
    sources_path.write_text(
        yaml.safe_dump(
            {
                "national": [
                    {
                        "id": "national/2025-tipo-real",
                        "source": "example.test",
                        "source_url": "https://example.test/tipo.csv",
                        "election_year": 2025,
                        "election_round": "legislativas",
                        "mime": "text/csv",
                        "notes": "backfill fixture",
                        "filename": "tipo.csv",
                    }
                ]
            }
        ),
        encoding="utf-8",
    )
    manifest_path = tmp_path / "archive-manifest.json"
    manifest_path.write_text(
        json.dumps(
            [
                {
                    "id": "national/2025-tipo-real",
                    "status": "ok",
                    "archived_path": "archive/national/tipo.csv",
                    "sha256": hashlib.sha256(csv_text.encode("utf-8")).hexdigest(),
                    "fetched_at": "2026-01-01T00:00:00Z",
                }
            ]
        ),
        encoding="utf-8",
    )

    archive_entry_id = f"backfill-cli-{uuid.uuid4()}"
    jurisdiction_id: str | None = None
    conn = psycopg.connect(TEST_DSN)
    try:
        jurisdiction_id = upsert_jurisdiction(
            conn, distrito="97", seccion="027", circuito="00001", mesa=mesa
        )
        election_id = upsert_election(conn, year=2025, round_="backfill-cli-test")
        category_id = upsert_category(conn, name="BACKFILL CLI TEST")
        with conn.cursor() as cur:
            cur.execute(
                """
                insert into result_row (election_id, jurisdiction_id, category_id,
                                        granularity, list_id, votes, source_kind,
                                        archive_entry_id, source_row_index)
                values (%s,%s,%s,'mesa','110',10,'official',%s,0)
                """,
                (election_id, jurisdiction_id, category_id, archive_entry_id),
            )
        conn.commit()

        exit_code = main(
            _main_args(sources_path, local_root, manifest_path)
            + ["backfill-mesa-tipo", "--database-url", TEST_DSN]
        )

        with conn.cursor() as cur:
            cur.execute(
                "select mesa_tipo from result_row where archive_entry_id = %s",
                (archive_entry_id,),
            )
            written = [row[0] for row in cur.fetchall()]
    finally:
        with conn.cursor() as cur:
            cur.execute("delete from result_row where archive_entry_id = %s", (archive_entry_id,))
            if jurisdiction_id is not None:
                cur.execute("delete from jurisdiction where id = %s", (jurisdiction_id,))
        conn.commit()
        conn.close()

    assert exit_code == 0, "a well-formed backfill must exit zero"
    assert written == ["EXTRANJEROS"], (
        f"the CLI must reach the UPDATE, not just the parser; got {written}"
    )


def test_ingest_drives_the_pba_branch_with_the_callers_crosswalk(tmp_path: Path) -> None:
    """The `capability == "pba"` branch had NO test, CLI or direct.

    `--crosswalk-path` was threaded through `ingest_source` specifically so a
    run validated against one crosswalk cannot ingest against another — and
    nothing proved the flag reached `load_pba_rows`.
    """
    _require_ephemeral_postgres()

    html = (Path(__file__).parent / "fixtures" / "pba_distrito_027_2025_sample.html").read_bytes()
    source_id = f"pba/2025-cli-{uuid.uuid4()}"
    local_root = tmp_path / "archive"
    LocalArchiveStore(root=local_root).write("pba", "d027.html", html)

    sources = {
        "pba": [
            {
                "id": source_id,
                "source": "juntaelectoral.gba.gov.ar",
                "source_url": "https://www.juntaelectoral.gba.gov.ar/x.html",
                "mime": "text/html",
                "election_year": 2025,
                "election_round": "provinciales",
                "notes": "CLI pba fixture",
                "filename": "d027.html",
            }
        ]
    }
    manifest_path = tmp_path / "archive-manifest.json"
    manifest_path.write_text(
        json.dumps(
            [
                {
                    "id": source_id,
                    "status": "ok",
                    "archived_path": "archive/pba/d027.html",
                    "sha256": hashlib.sha256(html).hexdigest(),
                    "fetched_at": "2026-01-01T00:00:00Z",
                }
            ]
        ),
        encoding="utf-8",
    )
    # The CALLER's crosswalk, not the repo default.
    crosswalk_path = tmp_path / "crosswalk.yaml"
    crosswalk_path.write_text(
        yaml.safe_dump(
            {
                "jurisdictions": [
                    {
                        "pba_distrito": "027",
                        "national_distrito": "02",
                        "national_seccion": "027",
                        "name": "Coronel de Marina Leonardo Rosales",
                    }
                ]
            }
        ),
        encoding="utf-8",
    )

    conn = psycopg.connect(TEST_DSN)
    try:
        inserted = ingest_source(
            source_id,
            database_url=TEST_DSN,
            year=2025,
            round_="provinciales",
            sources=sources,
            local_root=local_root,
            manifest_path=manifest_path,
            crosswalk_path=crosswalk_path,
        )
        with conn.cursor() as cur:
            cur.execute(
                """
                select distinct j.distrito_code, j.seccion_code
                  from result_row r join jurisdiction j on j.id = r.jurisdiction_id
                 where r.archive_entry_id = %s
                """,
                (source_id,),
            )
            lineages = cur.fetchall()
    finally:
        with conn.cursor() as cur:
            cur.execute("delete from result_row where archive_entry_id = %s", (source_id,))
        conn.commit()
        conn.close()

    assert inserted > 0, "the pba branch must write rows"
    # Translated through the SUPPLIED crosswalk: `027` is PBA's partido code,
    # and the national pair is distrito 02 / seccion 027.
    assert lineages == [("02", "027")], (
        f"the caller's crosswalk must reach `load_pba_rows`; got {lineages}"
    )


def test_ingest_source_reaches_the_registered_distrito_113_write_boundary(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Distrito 113 must be reachable through the real archive-first entry path."""
    import etl.__main__ as cli

    source_id = "pba/2025-distrito-113"
    html = (Path(__file__).parent / "fixtures" / "pba_distrito_113_2025_minimal.html").read_bytes()
    expected_sha256 = hashlib.sha256(html).hexdigest()
    local_root = tmp_path / "archive"
    LocalArchiveStore(root=local_root).write("pba", "distrito_113.html", html)
    manifest_path = tmp_path / "archive-manifest.json"
    manifest_path.write_text(
        json.dumps(
            [
                {
                    "id": source_id,
                    "status": "ok",
                    "archived_path": "archive/pba/distrito_113.html",
                    "sha256": expected_sha256,
                    "fetched_at": "2026-08-23T00:00:00Z",
                }
            ]
        ),
        encoding="utf-8",
    )

    verified_hashes: list[str | None] = []
    real_verified_read = cli.read_verified_archive

    def verified_read(*args, **kwargs):
        verified_hashes.append(kwargs.get("expected_sha256"))
        return real_verified_read(*args, **kwargs)

    class FakeConnection:
        def commit(self) -> None:
            pass

        def rollback(self) -> None:
            pass

        def close(self) -> None:
            pass

    projected_archives: list[tuple[str, str]] = []
    written_rows = []

    def reach_write_boundary(
        _conn, rows, *, year: int, round_: str, crosswalk, archive_entry_id: str
    ) -> int:
        approved = crosswalk.resolve_pba("113")
        assert approved is not None
        assert (
            approved.national_distrito_code,
            approved.national_seccion_code,
            approved.name,
        ) == ("02", "113", "TIGRE")
        assert (year, round_, archive_entry_id) == (2025, "provinciales", source_id)
        written_rows.extend(rows)
        return len(rows)

    monkeypatch.setattr(cli, "read_verified_archive", verified_read)
    monkeypatch.setattr(cli.psycopg, "connect", lambda _url: FakeConnection())
    monkeypatch.setattr(
        cli,
        "project_archive_entry",
        lambda _conn, record: projected_archives.append((record.id, record.source_kind)),
    )
    monkeypatch.setattr(cli, "load_pba_rows", reach_write_boundary)
    monkeypatch.setattr(cli, "insert_review_items", lambda _conn, _records: 0)

    inserted = ingest_source(
        source_id,
        database_url="postgresql://not-opened/test",
        year=2025,
        round_="provinciales",
        sources=load_sources(REPO_ROOT / "etl" / "sources.yaml"),
        local_root=local_root,
        manifest_path=manifest_path,
        crosswalk_path=CROSSWALK_PATH,
    )

    assert verified_hashes == [expected_sha256]
    assert projected_archives == [(source_id, "official")]
    assert inserted == len(written_rows) == 30
    assert {row.result.distrito for row in written_rows} == {"113"}
    assert {row.jurisdiction_names.distrito for row in written_rows} == {"TIGRE"}
    assert {
        category: {row.list_id for row in written_rows if row.category == category}
        for category in ("SENADORES PROVINCIALES", "CONCEJALES")
    } == {
        "SENADORES PROVINCIALES": {
            "2200",
            "2206",
            "2204",
            "1006",
            "2201",
            "2207",
            "974",
            "980",
            "1003",
            "959",
            "2202",
            "1008",
            "2203",
            "2208",
            "963",
        },
        "CONCEJALES": {
            "2200",
            "2206",
            "2204",
            "1006",
            "2201",
            "2207",
            "2205",
            "974",
            "980",
            "1003",
            "959",
            "193",
            "2203",
            "981",
            "2208",
        },
    }


def test_registered_distrito_113_ingest_persists_30_official_rows_idempotently(
    tmp_path: Path,
) -> None:
    """Issue #90: two real entry-point ingests leave one exact persisted projection."""
    source_id = "pba/2025-distrito-113"
    sources = load_sources(REPO_ROOT / "etl" / "sources.yaml")
    registered_source = next(
        (
            entry
            for capability_entries in sources.values()
            for entry in capability_entries
            if entry["id"] == source_id
        ),
        None,
    )
    assert registered_source is not None, (
        "production etl/sources.yaml must register distrito 113 before database setup"
    )
    _require_ephemeral_postgres()

    fixture = (
        Path(__file__).parent / "fixtures" / "pba_distrito_113_2025_minimal.html"
    ).read_bytes()
    fixture_sha256 = hashlib.sha256(fixture).hexdigest()
    local_root = tmp_path / "archive"
    LocalArchiveStore(root=local_root).write("pba", "distrito_113.html", fixture)
    manifest_path = tmp_path / "archive-manifest.json"
    manifest_path.write_text(
        json.dumps(
            [
                {
                    "id": source_id,
                    "status": "ok",
                    "archived_path": "archive/pba/distrito_113.html",
                    "sha256": fixture_sha256,
                    "fetched_at": "2026-08-23T00:00:00Z",
                }
            ]
        ),
        encoding="utf-8",
    )

    preexisting_election_ids = set()
    preexisting_category_ids = set()
    preexisting_jurisdiction_ids = set()
    persisted_election_ids = set()
    persisted_category_ids = set()
    persisted_jurisdiction_ids = set()
    conn = psycopg.connect(TEST_DSN)
    try:
        with conn.cursor() as cur:
            cur.execute(
                "select id from election where year = %s and round = %s",
                (2025, "provinciales"),
            )
            preexisting_election_ids = {row[0] for row in cur.fetchall()}
            cur.execute(
                "select id from category where name in (%s, %s)",
                ("SENADORES PROVINCIALES", "CONCEJALES"),
            )
            preexisting_category_ids = {row[0] for row in cur.fetchall()}
            cur.execute(
                """
                select id
                  from jurisdiction
                 where distrito_code = %s
                   and seccion_code = %s
                   and circuito_code is null
                   and establecimiento_code is null
                   and mesa_code is null
                """,
                ("02", "113"),
            )
            preexisting_jurisdiction_ids = {row[0] for row in cur.fetchall()}

        first_inserted = ingest_source(
            source_id,
            database_url=TEST_DSN,
            year=2025,
            round_="provinciales",
            sources=sources,
            local_root=local_root,
            manifest_path=manifest_path,
            crosswalk_path=CROSSWALK_PATH,
        )
        second_inserted = ingest_source(
            source_id,
            database_url=TEST_DSN,
            year=2025,
            round_="provinciales",
            sources=sources,
            local_root=local_root,
            manifest_path=manifest_path,
            crosswalk_path=CROSSWALK_PATH,
        )

        with conn.cursor() as cur:
            cur.execute(
                """
                select c.name, rr.list_id, rr.votes, rr.source_kind,
                       rr.election_id, rr.category_id, rr.jurisdiction_id
                  from result_row rr
                  join election e on e.id = rr.election_id
                  join category c on c.id = rr.category_id
                 where rr.archive_entry_id = %s
                   and e.year = 2025
                   and e.round = 'provinciales'
                 order by c.name, rr.list_id
                """,
                (source_id,),
            )
            persisted_rows = cur.fetchall()
            persisted_election_ids.update(row[4] for row in persisted_rows)
            persisted_category_ids.update(row[5] for row in persisted_rows)
            persisted_jurisdiction_ids.update(row[6] for row in persisted_rows)
            cur.execute(
                "select source_kind from archive_entry where id = %s",
                (source_id,),
            )
            archive_projection = cur.fetchone()
    finally:
        conn.rollback()
        with conn.cursor() as cur:
            cur.execute(
                """
                select election_id, category_id, jurisdiction_id
                  from result_row
                 where archive_entry_id = %s
                """,
                (source_id,),
            )
            for election_id, category_id, jurisdiction_id in cur.fetchall():
                persisted_election_ids.add(election_id)
                persisted_category_ids.add(category_id)
                persisted_jurisdiction_ids.add(jurisdiction_id)

            cur.execute("delete from result_row where archive_entry_id = %s", (source_id,))
            cur.execute("delete from archive_entry where id = %s", (source_id,))
            created_jurisdiction_ids = persisted_jurisdiction_ids - preexisting_jurisdiction_ids
            created_category_ids = persisted_category_ids - preexisting_category_ids
            created_election_ids = persisted_election_ids - preexisting_election_ids
            if created_jurisdiction_ids:
                cur.execute(
                    "delete from jurisdiction where id = any(%s)",
                    (list(created_jurisdiction_ids),),
                )
            if created_category_ids:
                cur.execute(
                    "delete from category where id = any(%s)",
                    (list(created_category_ids),),
                )
            if created_election_ids:
                cur.execute(
                    "delete from election where id = any(%s)",
                    (list(created_election_ids),),
                )
        conn.commit()
        conn.close()

    expected_category_counts = {"SENADORES PROVINCIALES": 15, "CONCEJALES": 15}
    category_absent_pairs = {
        ("SENADORES PROVINCIALES", "2205"),
        ("SENADORES PROVINCIALES", "193"),
        ("SENADORES PROVINCIALES", "981"),
        ("CONCEJALES", "2202"),
        ("CONCEJALES", "1008"),
        ("CONCEJALES", "963"),
    }
    persisted_category_lists = {(category, list_id) for category, list_id, *_rest in persisted_rows}

    assert first_inserted == second_inserted == 30
    assert len(persisted_rows) == 30, "re-ingestion must replace 30 rows, not append to 60"
    assert {
        category: sum(row_category == category for row_category, *_rest in persisted_rows)
        for category in expected_category_counts
    } == expected_category_counts
    assert category_absent_pairs.isdisjoint(persisted_category_lists), (
        "lists absent from a source category must not become fabricated persisted rows"
    )
    assert all(
        votes == 1 and source_kind == "official"
        for _, _, votes, source_kind, *_ids in persisted_rows
    )
    assert archive_projection == ("official",)


def test_distrito_113_hash_drift_refuses_before_database_access(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    import etl.__main__ as cli

    source_id = "pba/2025-distrito-113"
    fixture = (
        Path(__file__).parent / "fixtures" / "pba_distrito_113_2025_minimal.html"
    ).read_bytes()
    local_root = tmp_path / "archive"
    LocalArchiveStore(root=local_root).write("pba", "distrito_113.html", fixture + b"drift")
    manifest_path = tmp_path / "archive-manifest.json"
    manifest_path.write_text(
        json.dumps(
            [
                {
                    "id": source_id,
                    "status": "ok",
                    "archived_path": "archive/pba/distrito_113.html",
                    "sha256": hashlib.sha256(fixture).hexdigest(),
                }
            ]
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(
        cli.psycopg,
        "connect",
        lambda _url: (_ for _ in ()).throw(
            AssertionError("hash drift must precede database access")
        ),
    )

    with pytest.raises(ArchiveIntegrityError):
        ingest_source(
            source_id,
            database_url="postgresql://must-not-connect/test",
            year=2025,
            round_="provinciales",
            sources=load_sources(REPO_ROOT / "etl" / "sources.yaml"),
            local_root=local_root,
            manifest_path=manifest_path,
        )


def test_ingest_persists_pba_parser_quarantine_through_the_real_entrypoint(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys
) -> None:
    html = (
        (Path(__file__).parent / "fixtures" / "pba_distrito_027_2025_sample.html")
        .read_bytes()
        .replace(b"15.254", b"1O", 1)
    )
    source_id = f"pba/cli-parser-quarantine-{uuid.uuid4()}"
    local_root = tmp_path / "archive"
    LocalArchiveStore(root=local_root).write("pba", "d027.html", html)
    sources = {
        "pba": [
            {
                "id": source_id,
                "capability": "pba",
                "source": "juntaelectoral.gba.gov.ar",
                "source_url": "https://www.juntaelectoral.gba.gov.ar/d027.html",
                "mime": "text/html",
                "election_year": 2025,
                "election_round": "provinciales",
                "notes": "parser quarantine test",
                "filename": "d027.html",
            }
        ]
    }
    manifest_path = tmp_path / "archive-manifest.json"
    manifest_path.write_text(
        json.dumps(
            [
                {
                    "id": source_id,
                    "status": "ok",
                    "archived_path": "archive/pba/d027.html",
                    "sha256": hashlib.sha256(html).hexdigest(),
                    "fetched_at": "2026-01-01T00:00:00Z",
                }
            ]
        ),
        encoding="utf-8",
    )

    class FakeConnection:
        def commit(self) -> None:
            pass

        def rollback(self) -> None:
            pass

        def close(self) -> None:
            pass

    persisted = []
    accepted_rows = []
    monkeypatch.setattr("etl.__main__.psycopg.connect", lambda _url: FakeConnection())
    monkeypatch.setattr("etl.__main__.project_archive_entry", lambda *_args: None)
    monkeypatch.setattr("etl.__main__.load_crosswalk", lambda _path: object())

    def fake_load(_conn, rows, **_kwargs) -> int:
        accepted_rows.extend(rows)
        return len(rows)

    monkeypatch.setattr("etl.__main__.load_pba_rows", fake_load)
    monkeypatch.setattr(
        "etl.__main__.insert_review_items",
        lambda _conn, records: persisted.extend(records) or 0,
    )

    inserted = ingest_source(
        source_id,
        database_url="postgresql://not-opened/test",
        year=2025,
        round_="provinciales",
        sources=sources,
        local_root=local_root,
        manifest_path=manifest_path,
        crosswalk_path=tmp_path / "unused-crosswalk.yaml",
    )

    assert inserted == len(accepted_rows) > 0
    assert len(persisted) == 1
    record = persisted[0]
    assert record.kind == "pba_unreadable_vote_cell"
    assert record.severity == "warning"
    assert record.tenant_scope_state == "platform_only"
    assert source_id in record.subject_ref
    assert "distrito:027" in record.subject_ref
    assert "category:DIPUTADOS PROVINCIALES" in record.subject_ref
    assert "list:2206" in record.subject_ref
    assert "source rows 0" in record.note
    assert "length=2; character_classes=ascii_letter,digit" in record.note
    report = capsys.readouterr().err
    assert "review scope: section_scoped=0, platform_only=1" in report
    assert "PBA parser quarantine" in report
    assert "0 review item(s) recorded" in report
    assert "unreadable_vote_cell: 1" in report


def test_a_manifest_record_without_an_archived_path_exits_nonzero(tmp_path: Path, capsys) -> None:
    """A malformed manifest entry is a validation failure, not a crash.

    `archived_filename` was added so a record with no `archived_path` fails
    where the problem is, instead of dying inside `LocalArchiveStore.read`
    with a message about a missing file — but no command caught it, so it
    exited with a traceback.
    """
    source_id = "national/2025-no-path"
    sources_path = tmp_path / "sources.yaml"
    sources_path.write_text(
        yaml.safe_dump(
            {
                "national": [
                    {
                        "id": source_id,
                        "source": "example.test",
                        "source_url": "https://example.test/x.csv",
                        "mime": "text/csv",
                        "election_year": 2025,
                        "election_round": "legislativas",
                        "notes": "malformed-manifest fixture",
                        "filename": "x.csv",
                    }
                ]
            }
        ),
        encoding="utf-8",
    )
    manifest_path = tmp_path / "archive-manifest.json"
    manifest_path.write_text(
        json.dumps(
            [
                {
                    "id": source_id,
                    "status": "ok",
                    # `archived_path` deliberately absent.
                    "sha256": "0" * 64,
                    "fetched_at": "2026-01-01T00:00:00Z",
                }
            ]
        ),
        encoding="utf-8",
    )
    crosswalk_path = tmp_path / "crosswalk.yaml"
    crosswalk_path.write_text(yaml.safe_dump({"jurisdictions": []}), encoding="utf-8")

    exit_code = main(
        _main_args(sources_path, tmp_path / "archive", manifest_path)
        + ["validate-crosswalk", "--crosswalk-path", str(crosswalk_path)]
    )

    reported = capsys.readouterr().err
    assert "declares no `archived_path`" in reported, (
        f"the malformed-manifest refusal must be the one that fired; got {reported!r}"
    )
    assert exit_code == 1, "a malformed manifest entry must exit nonzero, not raise"


def test_load_curated_exits_nonzero_on_a_drifted_archive(tmp_path: Path, capsys) -> None:
    """`load-curated` reads the archive too, and was the one command still
    letting a schema drift escape as a traceback while its four siblings
    exited 1."""
    _require_ephemeral_postgres()

    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as zf:
        zf.writestr("ambitosElectorales.csv", "not,the,results,file\n")
    zip_bytes = buffer.getvalue()

    source_id = "national/2025-drifted"
    local_root = tmp_path / "archive"
    LocalArchiveStore(root=local_root).write("national", "drifted.zip", zip_bytes)
    sources_path = tmp_path / "sources.yaml"
    sources_path.write_text(
        yaml.safe_dump(
            {
                "national": [
                    {
                        "id": source_id,
                        "source": "example.test",
                        "source_url": "https://example.test/drifted.zip",
                        "mime": "application/zip",
                        "election_year": 2025,
                        "election_round": "legislativas",
                        "notes": "schema-drift fixture",
                        "filename": "drifted.zip",
                    },
                    # A 2023 entry so the per-year guard passes and the run
                    # reaches the archive read this test is about.
                    {
                        "id": "national/2023-drifted",
                        "source": "example.test",
                        "source_url": "https://example.test/drifted.zip",
                        "mime": "application/zip",
                        "election_year": 2023,
                        "election_round": "generales",
                        "notes": "schema-drift fixture",
                        "filename": "drifted.zip",
                    },
                ]
            }
        ),
        encoding="utf-8",
    )
    manifest_path = tmp_path / "archive-manifest.json"
    manifest_path.write_text(
        json.dumps(
            [
                {
                    "id": entry_id,
                    "status": "ok",
                    "archived_path": "archive/national/drifted.zip",
                    "sha256": hashlib.sha256(zip_bytes).hexdigest(),
                    "fetched_at": "2026-01-01T00:00:00Z",
                }
                for entry_id in (source_id, "national/2023-drifted")
            ]
        ),
        encoding="utf-8",
    )

    exit_code = main(
        _main_args(sources_path, local_root, manifest_path)
        + ["load-curated", "--database-url", TEST_DSN]
    )

    reported = capsys.readouterr().err
    assert "no member of the archived ZIP matches" in reported, (
        f"the schema-drift refusal must be the one that fired; got {reported!r}"
    )
    assert exit_code == 1, "a drifted archive must exit nonzero, not raise"


def test_a_zip_with_two_results_members_refuses_rather_than_picking(tmp_path: Path) -> None:
    """Two candidates is a choice, and this code does not get to make it.

    Returning the first match silently preferred whichever member the archive
    happened to list first — an original beside a re-export, or a full file
    beside a partial slice. `collapse()` in the same module refuses for the
    same reason; this branch had no test at all.
    """
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as zf:
        zf.writestr("resultados2025.csv", NATIONAL_CSV)
        zf.writestr("resultados2025_reexport.csv", NATIONAL_CSV)

    with pytest.raises(NationalResultsCsvNotFoundError, match="refusing to pick one"):
        resolve_national_results_bytes(buffer.getvalue(), extract_dir=tmp_path)


def test_one_mesa_reporting_two_tallies_for_one_party_refuses() -> None:
    """A scope where a `(mesa, agrupacion)` pair disagrees with itself.

    Accumulating into a set exists so this can be refused rather than resolved
    by last-write-wins; nothing asserted the refusal, so the next person to
    find the `set()` awkward would have restored the silent pick.
    """
    from etl.__main__ import official_mesa_votes_from_national

    csv_text = (
        "distrito_id,seccion_id,circuito_id,mesa_id,cargo_nombre,agrupacion_id,"
        "agrupacion_nombre,votos_tipo,votos_cantidad,estado_final\n"
        "02,027,01,1,DIPUTADO NACIONAL,110,ALIANZA LA LIBERTAD AVANZA,POSITIVO,120,definitivo\n"
        "02,027,01,1,DIPUTADO NACIONAL,110,ALIANZA LA LIBERTAD AVANZA,POSITIVO,999,definitivo\n"
    )

    with pytest.raises(NationalSchemaError, match="refusing to pick one"):
        official_mesa_votes_from_national(
            csv_text.encode("utf-8"),
            distrito="02",
            seccion="027",
            category="DIPUTADO NACIONAL",
            source_id="national/2025-official-fixture",
            election_year=2025,
            election_round="legislativas",
        )


@pytest.mark.parametrize(
    ("column", "raw", "reason"),
    [
        ("mesa_id", "-1", "unreadable mesa_id"),
        ("mesa_id", "+1", "unreadable mesa_id"),
        ("mesa_id", "1_2", "unreadable mesa_id"),
        ("mesa_id", "٢", "unreadable mesa_id"),
        ("votos_cantidad", "-1", "unreadable votos_cantidad"),
        ("votos_cantidad", "+1", "unreadable votos_cantidad"),
        ("votos_cantidad", "1_2", "unreadable votos_cantidad"),
        ("votos_cantidad", "１２", "unreadable votos_cantidad"),
    ],
)
def test_official_baseline_excludes_malformed_numeric_cells_by_exact_reason(
    column: str, raw: str, reason: str
) -> None:
    from etl.__main__ import official_mesa_votes_from_national

    malformed_mesa = raw if column == "mesa_id" else "2"
    malformed_votes = raw if column == "votos_cantidad" else "999"
    csv_text = (
        "distrito_id,seccion_id,circuito_id,mesa_id,cargo_nombre,votos_tipo,"
        "votos_cantidad,agrupacion_nombre\n"
        "02,027,00248,1,DIPUTADO NACIONAL,POSITIVO,10,ALIANZA LA LIBERTAD AVANZA\n"
        f"02,027,00248,{malformed_mesa},DIPUTADO NACIONAL,POSITIVO,"
        f"{malformed_votes},ALIANZA LA LIBERTAD AVANZA\n"
    )

    projection = official_mesa_votes_from_national(
        csv_text.encode("utf-8"),
        distrito="02",
        seccion="027",
        category="DIPUTADO NACIONAL",
        source_id="national/2025-official-fixture",
        election_year=2025,
        election_round="legislativas",
    )
    tallies = projection.tallies
    skipped = projection.skipped

    assert set(tallies) == {1}
    assert tallies[1].votes_by_agrupacion_name == {"ALIANZA LA LIBERTAD AVANZA": 10}
    assert skipped == {reason: 1}


def test_a_zip_with_no_results_member_exits_nonzero_through_main(tmp_path: Path, capsys) -> None:
    """The CLI CONTRACT, not just the exception.

    "Exit codes: 0 on success, non-zero on any argument or validation failure"
    is the module's own promise; an archive whose schema drifted was ending in
    a traceback instead.
    """
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as zf:
        zf.writestr("ambitosElectorales.csv", "not,the,results,file\n")

    source_id = f"national/2025-bad-zip-{uuid.uuid4()}"
    filename = f"{uuid.uuid4().hex}.zip"
    local_root = tmp_path / "archive"
    LocalArchiveStore(root=local_root).write("national", filename, buffer.getvalue())
    sources_path = tmp_path / "sources.yaml"
    sources_path.write_text(
        yaml.safe_dump(
            {
                "national": [
                    {
                        "id": source_id,
                        "source": "example.test",
                        "source_url": "https://example.test/bad.zip",
                        "mime": "application/zip",
                        "election_year": 2025,
                        "election_round": "legislativas",
                        "notes": "schema-drift fixture",
                        "filename": filename,
                    }
                ]
            }
        ),
        encoding="utf-8",
    )
    manifest_path = tmp_path / "archive-manifest.json"
    manifest_path.write_text(
        json.dumps(
            [
                {
                    "id": source_id,
                    "status": "ok",
                    "archived_path": f"archive/national/{filename}",
                    "sha256": hashlib.sha256(buffer.getvalue()).hexdigest(),
                    "fetched_at": "2026-01-01T00:00:00Z",
                }
            ]
        ),
        encoding="utf-8",
    )
    crosswalk_path = tmp_path / "crosswalk.yaml"
    crosswalk_path.write_text(yaml.safe_dump({"jurisdictions": []}), encoding="utf-8")

    exit_code = main(
        _main_args(sources_path, local_root, manifest_path)
        + ["validate-crosswalk", "--crosswalk-path", str(crosswalk_path)]
    )

    # By MESSAGE: `cmd_validate_crosswalk` returns 1 from the empty-corpus
    # refusal BEFORE it ever reads the ZIP, so the code alone would stay green
    # with the drift branch never running.
    reported = capsys.readouterr().err
    assert "no member of the archived ZIP matches" in reported, (
        f"the schema-drift refusal must be the one that fired; got {reported!r}"
    )
    assert exit_code == 1, "a drifted archive must exit nonzero, not raise"


def test_ingest_reports_the_fiscalizacion_rows_it_quarantined(tmp_path: Path) -> None:
    """`ingest_fiscalizacion` produces `quarantined`; nothing read it.

    Every `duplicate_conflict` and `unmergeable_empty_mesa` row died with the
    process. `load_pba_rows` right next door reports its own quarantine, so the
    silence was inconsistent as well as lossy — and a quarantine that reports
    nothing is the primitive that discarded 6.462.906 PASO rows.
    """
    _require_ephemeral_postgres()

    zeros = ",".join(["0"] * (len(FISCALIZACION_VOTE_COLUMNS) - 1))
    # Two rows for one mesa with CONFLICTING vote vectors: `_collapse_duplicates`
    # cannot merge them and quarantines both as `duplicate_conflict`.
    csv_text = _fiscalizacion_csv(
        [
            f"ESCUELA TEST,Mesa 4243,10,{zeros}\n",
            f"ESCUELA TEST,Mesa 4243,99,{zeros}\n",
        ]
    )

    source_id = f"fiscalizacion/cli-quarantine-{uuid.uuid4()}"
    filename = "cli-quarantine.csv"
    local_root = tmp_path / "archive"
    manifest_path = tmp_path / "archive-manifest.json"
    sources = {
        "fiscalizacion": [
            {
                "id": source_id,
                "source": "internal",
                "source_url": f"local://{source_id}.csv",
                "mime": "text/csv",
                "election_year": 2025,
                "election_round": "legislativas",
                "notes": "CLI quarantine fixture",
                "filename": filename,
                "upload": "never",
            }
        ]
    }
    LocalArchiveStore(root=local_root).write("fiscalizacion", filename, csv_text.encode("utf-8"))
    manifest_path.write_text(
        json.dumps(
            [
                {
                    "id": source_id,
                    "status": "ok",
                    "archived_path": f"archive/fiscalizacion/{filename}",
                    "sha256": hashlib.sha256(csv_text.encode("utf-8")).hexdigest(),
                    "fetched_at": "2026-01-01T00:00:00Z",
                }
            ]
        ),
        encoding="utf-8",
    )

    conn = psycopg.connect(TEST_DSN)
    captured = io.StringIO()
    try:
        with contextlib.redirect_stderr(captured):
            ingest_source(
                source_id,
                database_url=TEST_DSN,
                year=2025,
                round_="legislativas",
                sources=sources,
                local_root=local_root,
                manifest_path=manifest_path,
            )
    finally:
        with conn.cursor() as cur:
            cur.execute(  # `starts_with`, not `like`: `_` and `%` are LIKE wildcards and a
                # uuid-bearing source id carries `_`, so this could delete
                # ANOTHER test's rows from the shared database.
                "delete from review_item where starts_with(subject_ref, %s)",
                (f"{source_id} ",),
            )
            cur.execute("delete from result_row where archive_entry_id = %s", (source_id,))
        conn.commit()
        conn.close()

    reported = captured.getvalue()
    assert "quarantined" in reported, f"withheld rows must be reported; got {reported!r}"
    # PER REASON, not one plausible total.
    assert "duplicate_conflict" in reported, (
        f"the report must name why each row was withheld; got {reported!r}"
    )


def test_validate_fiscalizacion_persists_the_divergences_it_finds(tmp_path: Path) -> None:
    """Drives `main(["validate-fiscalizacion", ...])`.

    `join_fiscalizacion_identity` and `mesa_divergences_to_review_items` were
    both complete, both tested, and reachable from NOTHING — the whole D9.5
    divergence path existed only inside its own tests, so a diverging mesa was
    never recorded anywhere an operator would see it.
    """
    _require_ephemeral_postgres()

    fixtures = Path(__file__).parent / "fixtures"
    fiscalizacion_bytes = (fixtures / "fiscalizacion_2025_stripped_sample.csv").read_bytes()
    national_lines = (
        (fixtures / "national_2025_027_diputados_sample.csv")
        .read_text(encoding="utf-8")
        .splitlines(keepends=True)
    )
    # Preserve every official row, but make one mesa number belong to two
    # circuitos. The caller must persist this baseline quarantine alongside the
    # ordinary divergence records for the remaining comparable mesas.
    national_lines[1] = national_lines[1].replace(",00248,248,1,", ",00249,249,1,")
    national_bytes = "".join(national_lines).encode("utf-8")

    fiscalizacion_id = f"fiscalizacion/divergence-{uuid.uuid4()}"
    national_id = f"national/2025-divergence-{uuid.uuid4()}"
    local_root = tmp_path / "archive"
    store = LocalArchiveStore(root=local_root)
    store.write("fiscalizacion", "fisc.csv", fiscalizacion_bytes)
    store.write("national", "nat.csv", national_bytes)

    sources_path = tmp_path / "sources.yaml"
    sources_path.write_text(
        yaml.safe_dump(
            {
                "fiscalizacion": [
                    {
                        "id": fiscalizacion_id,
                        "source": "internal",
                        "source_kind": "fiscalizacion",
                        "source_url": "local://fiscalizacion/fisc.csv",
                        "mime": "text/csv",
                        "election_year": 2025,
                        "election_round": "legislativas",
                        "notes": "divergence fixture",
                        "filename": "fisc.csv",
                        "upload": "never",
                    }
                ],
                "national": [
                    {
                        "id": national_id,
                        "source": "example.test",
                        "source_url": "https://example.test/nat.csv",
                        "mime": "text/csv",
                        "election_year": 2025,
                        "election_round": "legislativas",
                        "notes": "divergence baseline",
                        "filename": "nat.csv",
                    }
                ],
            }
        ),
        encoding="utf-8",
    )
    manifest_path = tmp_path / "archive-manifest.json"
    manifest_path.write_text(
        json.dumps(
            [
                {
                    "id": fiscalizacion_id,
                    "status": "ok",
                    "archived_path": "archive/fiscalizacion/fisc.csv",
                    "sha256": hashlib.sha256(fiscalizacion_bytes).hexdigest(),
                    "fetched_at": "2026-01-01T00:00:00Z",
                },
                {
                    "id": national_id,
                    "status": "ok",
                    "archived_path": "archive/national/nat.csv",
                    "sha256": hashlib.sha256(national_bytes).hexdigest(),
                    "fetched_at": "2026-01-01T00:00:00Z",
                },
            ]
        ),
        encoding="utf-8",
    )

    conn = psycopg.connect(TEST_DSN)
    # fmt: off
    try:
        exit_code = main(
            _main_args(sources_path, local_root, manifest_path)
                + [
                    "validate-fiscalizacion",
                "--source",
                fiscalizacion_id,
                "--baseline",
                national_id,
                "--database-url",
                TEST_DSN,
            ]
        )
        with conn.cursor() as cur:
            cur.execute(
                # `starts_with`, not `like`, for the same reason the cleanup
                # below uses it: `_` is a LIKE wildcard and the source id
                # carries one, so this could read ANOTHER test's rows and
                # assert against them.
                "select kind, severity from review_item "
                "where starts_with(subject_ref, %s) or starts_with(subject_ref, %s)",
                (f"{fiscalizacion_id} ", f"{national_id} "),
            )
            written = cur.fetchall()
    finally:
        with conn.cursor() as cur:
            cur.execute(
                # `starts_with`, not `like`: `_` and `%` are LIKE wildcards and a
                # uuid-bearing source id carries `_`, so this could delete
                # ANOTHER test's rows from the shared database.
                "delete from review_item "
                "where starts_with(subject_ref, %s) or starts_with(subject_ref, %s)",
                (f"{fiscalizacion_id} ", f"{national_id} "),
            )
        conn.commit()
        conn.execute("delete from archive_entry where id=any(%s)", ([fiscalizacion_id, national_id],))  # noqa: E501
        conn.commit()
        conn.close()
    # fmt: on

    assert exit_code == 0, "remaining unambiguous identities must still be compared"
    assert written, "divergence and official quarantine evidence must reach review_item"
    assert {kind for kind, _ in written} == {
        "ambiguous_official_mesa_identity",
        "mesa_tally_divergence",
    }
    assert {severity for kind, severity in written if kind == "mesa_tally_divergence"} == {
        "info"
    }, "D9.5 divergences remain informational"
    assert {
        severity for kind, severity in written if kind == "ambiguous_official_mesa_identity"
    } == {"warning"}


def test_validate_fiscalizacion_reports_expected_exclusions_and_reconciled_totals(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys,
) -> None:
    import etl.__main__ as cli
    from etl.crosswalk import MesaDivergence

    fiscalizacion_id = "fiscalizacion/observability"
    baseline_id = "national/observability"
    sources = {
        "fiscalizacion": [
            {
                "id": fiscalizacion_id,
                "source": "internal",
                "source_url": "local://fiscalizacion/fixture.csv",
                "mime": "text/csv",
                "election_year": 2025,
                "election_round": "legislativas",
                "notes": "observability fixture",
                "upload": "never",
            }
        ],
        "national": [
            {
                "id": baseline_id,
                "source": "example.test",
                "source_url": "https://example.test/fixture.csv",
                "mime": "text/csv",
                "election_year": 2025,
                "election_round": "legislativas",
                "notes": "observability baseline",
            }
        ],
    }

    class FakeCursor:
        def __enter__(self):
            return self

        def __exit__(self, *_args) -> None:
            pass

        def execute(self, *_args) -> None:
            pass

        def fetchone(self):
            return ("election-id", "category-id")

    class FakeConnection:
        def cursor(self):
            return FakeCursor()

        def commit(self) -> None:
            pass

        def rollback(self) -> None:
            pass

        def close(self) -> None:
            pass

    candidates: list[object] = []
    monkeypatch.setattr(cli, "load_sources", lambda _path: sources)
    monkeypatch.setattr(cli, "load_manifest", lambda _path: [])
    monkeypatch.setattr(
        cli,
        "latest_ok_record",
        lambda _records, source_id: {
            "id": source_id,
            "status": "ok",
            "archived_path": "archive/fixture.csv",
            "fetched_at": "2026-01-01T00:00:00Z",
            "sha256": "0" * 64,
        },
    )
    monkeypatch.setattr(
        cli,
        "LocalArchiveStore",
        lambda **_kwargs: SimpleNamespace(exists=lambda *_args: True),
    )
    monkeypatch.setattr(cli, "read_archived_source", lambda *_args, **_kwargs: b"fixture")
    monkeypatch.setattr(
        cli,
        "ingest_fiscalizacion",
        lambda *_args, **_kwargs: SimpleNamespace(
            rows=[SimpleNamespace(mesa=42, votes={"La Libertad Avanza": 55})],
            review_items=[],
            quarantined=[],
        ),
    )
    monkeypatch.setattr(cli, "national_csv_bytes", lambda _bytes: b"baseline")
    monkeypatch.setattr(
        cli,
        "official_mesa_votes_from_national",
        lambda *_args, **_kwargs: cli.OfficialMesaProjection(
            tallies={42: object()}, skipped={}, review_items=()
        ),
    )
    monkeypatch.setattr(
        cli,
        "join_fiscalizacion_identity",
        lambda *_args, **_kwargs: SimpleNamespace(
            joined=((object(), object()),),
            unmatched_mesas=(),
            collided_mesas=(),
            divergences=(
                MesaDivergence(
                    mesa=42,
                    column="La Libertad Avanza",
                    fiscalizacion_value=55,
                    official_value=57,
                ),
                MesaDivergence(
                    mesa=42,
                    column="Impugnado",
                    fiscalizacion_value=2,
                    official_value=0,
                ),
                MesaDivergence(
                    mesa=42,
                    column="En blanco",
                    fiscalizacion_value=1,
                    official_value=3,
                ),
            ),
        ),
    )
    monkeypatch.setattr(cli.psycopg, "connect", lambda _url: FakeConnection())
    monkeypatch.setattr(cli, "project_archive_entry", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(cli, "upsert_election", lambda *_args, **_kwargs: "election-id")
    monkeypatch.setattr(cli, "upsert_category", lambda *_args, **_kwargs: "category-id")
    monkeypatch.setattr(
        cli,
        "insert_review_items",
        lambda _conn, records: candidates.extend(records) or len(records),
    )

    exit_code = cli.cmd_validate_fiscalizacion(
        SimpleNamespace(
            distrito=cli.FISCALIZACION_DISTRITO,
            seccion=cli.FISCALIZACION_SECCION,
            category=cli.FISCALIZACION_CATEGORY,
            sources_path=tmp_path / "sources.yaml",
            source=fiscalizacion_id,
            baseline=baseline_id,
            database_url="postgresql://not-opened/test",
            manifest_path=tmp_path / "manifest.json",
            local_root=tmp_path / "archive",
        )
    )

    captured = capsys.readouterr()
    assert exit_code == 0
    assert len(candidates) == 1
    assert [
        (scope.distrito_code, scope.seccion_code) for scope in candidates[0].section_scopes
    ] == [("02", "027")]
    assert candidates[0].contexts == (
        ReviewItemContext(
            "observed",
            "fiscalizacion",
            "available",
            2025,
            "election-id",
            "category-id",
            fiscalizacion_id,
        ),  # noqa: E501
        ReviewItemContext(
            "comparison", "official", "available", 2025, "election-id", "category-id", baseline_id
        ),  # noqa: E501
    )
    assert (
        "expected exclusion: reason=expected_category_definition_difference "
        "column='En blanco' count=1"
    ) in captured.err
    assert (
        "expected exclusion: reason=expected_category_definition_difference "
        "column='Impugnado' count=1"
    ) in captured.err
    assert (
        f"joined 1 of 1 fiscalización mesa(s) to {baseline_id}; divergence totals: "
        "observed=3, actionable candidates=1, actually inserted new=1, "
        "active-not-recorded=0, expected exclusions=2"
    ) in captured.out
    assert "3 diverging column(s) recorded" not in captured.out


def test_validate_fiscalizacion_persists_duplicate_collapsed_once(
    tmp_path: Path, capsys, monkeypatch: pytest.MonkeyPatch
) -> None:
    _require_ephemeral_postgres()

    fixtures = Path(__file__).parent / "fixtures"
    fiscal_lines = (
        (fixtures / "fiscalizacion_2025_stripped_sample.csv")
        .read_text(encoding="utf-8")
        .splitlines()
    )
    fiscal_lines.insert(2, fiscal_lines[1])
    fiscalizacion_bytes = ("\n".join(fiscal_lines) + "\n").encode("utf-8")
    national_bytes = (fixtures / "national_2025_027_diputados_sample.csv").read_bytes()
    fiscalizacion_id = f"fiscalizacion/duplicate-{uuid.uuid4()}"
    national_id = f"national/2025-duplicate-{uuid.uuid4()}"
    local_root = tmp_path / "archive"
    store = LocalArchiveStore(root=local_root)
    store.write("fiscalizacion", "fisc.csv", fiscalizacion_bytes)
    store.write("national", "nat.csv", national_bytes)
    sources_path = tmp_path / "sources.yaml"
    sources_path.write_text(
        yaml.safe_dump(
            {
                "fiscalizacion": [
                    {
                        "id": fiscalizacion_id,
                        "source": "internal",
                        "source_kind": "fiscalizacion",
                        "mime": "text/csv",
                        "notes": "canonical source fixture",
                        "source_url": "local://fiscalizacion/fixture.csv",
                        "election_year": 2025,
                        "election_round": "legislativas",
                        "filename": "fisc.csv",
                        "upload": "never",
                    }
                ],
                "national": [
                    {
                        "id": national_id,
                        "source": "example.test",
                        "mime": "text/csv",
                        "notes": "canonical source fixture",
                        "source_url": "https://example.test/nat.csv",
                        "election_year": 2025,
                        "election_round": "legislativas",
                        "filename": "nat.csv",
                    }
                ],
            }
        ),
        encoding="utf-8",
    )
    manifest_path = tmp_path / "archive-manifest.json"
    manifest_path.write_text(
        json.dumps(
            [
                {
                    "id": fiscalizacion_id,
                    "status": "ok",
                    "archived_path": "archive/fiscalizacion/fisc.csv",
                    "sha256": hashlib.sha256(fiscalizacion_bytes).hexdigest(),
                    "fetched_at": "2026-01-01T00:00:00Z",
                },
                {
                    "id": national_id,
                    "status": "ok",
                    "archived_path": "archive/national/nat.csv",
                    "sha256": hashlib.sha256(national_bytes).hexdigest(),
                    "fetched_at": "2026-01-01T00:00:00Z",
                },
            ]
        ),
        encoding="utf-8",
    )
    args = _main_args(sources_path, local_root, manifest_path) + [
        "validate-fiscalizacion",
        "--source",
        fiscalizacion_id,
        "--baseline",
        national_id,
        "--database-url",
        TEST_DSN,
    ]

    conn = psycopg.connect(TEST_DSN)
    try:
        assert main(args) == 0
        assert main(args) == 0
        with conn.cursor() as cur:
            cur.execute(
                "select count(*) from review_item where kind = 'duplicate_collapsed' "
                "and starts_with(subject_ref, %s) and resolved_at is null",
                (f"{fiscalizacion_id} ",),
            )
            written = cur.fetchone()
    finally:
        with conn.cursor() as cur:
            cur.execute(
                "delete from review_item where starts_with(subject_ref, %s)",
                (f"{fiscalizacion_id} ",),
            )
        conn.commit()
        conn.close()

    assert written == (1,)

    monkeypatch.setattr("etl.__main__.insert_review_items", lambda _conn, _records: 0)
    assert main(args) == 0
    report = capsys.readouterr().err
    assert "duplicate_collapsed: 1 review item(s)" in report
    assert "duplicate_collapsed: 1 review item(s) (0 new, 1 not recorded)" in report


def test_validate_fiscalizacion_refuses_a_baseline_scope_with_no_rows(
    tmp_path: Path, capsys
) -> None:
    """An empty scope is not agreement.

    `mesa_id` is not unique across distritos in the 2023 file and that file
    bundles ten categories, so the baseline is read within one
    `(distrito, seccion, category)` scope. A scope that matches nothing must
    refuse rather than compare against an empty official side, which would
    report every fiscalización mesa as unmatched.
    """
    _require_ephemeral_postgres()

    fixtures = Path(__file__).parent / "fixtures"
    fiscalizacion_bytes = (fixtures / "fiscalizacion_2025_stripped_sample.csv").read_bytes()
    # The baseline rewritten into ANOTHER distrito. The scope requested stays
    # the curated `02/027/DIPUTADO NACIONAL` -- asking for a different one is
    # refused earlier now, by the party-name-table scope check, so driving
    # this branch through `--category SENADOR NACIONAL` would test that
    # refusal instead of this one.
    national_text = (
        (fixtures / "national_2025_027_diputados_sample.csv")
        .read_text(encoding="utf-8")
        .replace(",BUENOS AIRES,", ",OTRO DISTRITO,")
        .replace("NORMAL,2,", "NORMAL,3,")
    )
    national_bytes = national_text.encode("utf-8")

    fiscalizacion_id = f"fiscalizacion/scope-{uuid.uuid4()}"
    national_id = f"national/2025-scope-{uuid.uuid4()}"
    local_root = tmp_path / "archive"
    store = LocalArchiveStore(root=local_root)
    store.write("fiscalizacion", "fisc.csv", fiscalizacion_bytes)
    store.write("national", "nat.csv", national_bytes)

    sources_path = tmp_path / "sources.yaml"
    sources_path.write_text(
        yaml.safe_dump(
            {
                "fiscalizacion": [
                    {
                        "id": fiscalizacion_id,
                        "source": "internal",
                        "source_kind": "fiscalizacion",
                        "source_url": "local://fiscalizacion/fisc.csv",
                        "mime": "text/csv",
                        "election_year": 2025,
                        "election_round": "legislativas",
                        "notes": "scope fixture",
                        "filename": "fisc.csv",
                        "upload": "never",
                    }
                ],
                "national": [
                    {
                        "id": national_id,
                        "source": "example.test",
                        "source_url": "https://example.test/nat.csv",
                        "mime": "text/csv",
                        "election_year": 2025,
                        "election_round": "legislativas",
                        "notes": "scope baseline",
                        "filename": "nat.csv",
                    }
                ],
            }
        ),
        encoding="utf-8",
    )
    manifest_path = tmp_path / "archive-manifest.json"
    manifest_path.write_text(
        json.dumps(
            [
                {
                    "id": fiscalizacion_id,
                    "status": "ok",
                    "archived_path": "archive/fiscalizacion/fisc.csv",
                    "sha256": hashlib.sha256(fiscalizacion_bytes).hexdigest(),
                    "fetched_at": "2026-01-01T00:00:00Z",
                },
                {
                    "id": national_id,
                    "status": "ok",
                    "archived_path": "archive/national/nat.csv",
                    "sha256": hashlib.sha256(national_bytes).hexdigest(),
                    "fetched_at": "2026-01-01T00:00:00Z",
                },
            ]
        ),
        encoding="utf-8",
    )

    exit_code = main(
        _main_args(sources_path, local_root, manifest_path)
        + [
            "validate-fiscalizacion",
            "--source",
            fiscalizacion_id,
            "--baseline",
            national_id,
            "--database-url",
            TEST_DSN,
        ]
    )

    # By MESSAGE. `cmd_validate_fiscalizacion` returns 1 from five earlier
    # paths, including a `NationalSchemaError` if the fixture ever loses
    # `agrupacion_nombre` — which is not in `REQUIRED_COLUMNS` and so is not
    # guaranteed. Asserting the code alone would keep this green while the
    # branch it names never ran.
    reported = capsys.readouterr().err
    assert "no baseline row matched distrito=" in reported, (
        f"the empty-scope refusal must be the one that fired; got {reported!r}"
    )
    assert exit_code == 1, "an empty baseline scope must refuse, not report agreement"


# ---------------------------------------------------------------------------
# The subcommands are reachable THROUGH `main()`, not only as functions
# ---------------------------------------------------------------------------


def _archived_national_corpus(tmp_path: Path, csv_text: str) -> tuple[Path, Path, Path]:
    """One archived national source, wired the way `main()` expects to find it."""
    # Year-prefixed: `collect_national_party_keys` derives the year from the
    # first four digits of the id, so an id with none is excluded as unparseable.
    source_id = f"national/2025-main-test-{uuid.uuid4()}"
    filename = f"{uuid.uuid4().hex}.csv"
    local_root = tmp_path / "archive"
    manifest_path = tmp_path / "archive-manifest.json"
    LocalArchiveStore(root=local_root).write("national", filename, csv_text.encode("utf-8"))
    sources_path = tmp_path / "sources.yaml"
    sources_path.write_text(
        yaml.safe_dump(
            {
                "national": [
                    {
                        "id": source_id,
                        "source": "example.test",
                        "source_url": "https://example.test/main-test.csv",
                        "mime": "text/csv",
                        "election_year": 2025,
                        "election_round": "legislativas",
                        "notes": "main() wiring fixture",
                        "filename": filename,
                    }
                ]
            }
        ),
        encoding="utf-8",
    )
    manifest_path.write_text(
        json.dumps(
            [
                {
                    "id": source_id,
                    "status": "ok",
                    "archived_path": f"archive/national/{filename}",
                    "sha256": hashlib.sha256(csv_text.encode("utf-8")).hexdigest(),
                    "fetched_at": "2026-01-01T00:00:00Z",
                }
            ]
        ),
        encoding="utf-8",
    )
    return sources_path, local_root, manifest_path


def _main_args(sources_path: Path, local_root: Path, manifest_path: Path) -> list[str]:
    return [
        "--sources-path",
        str(sources_path),
        "--local-root",
        str(local_root),
        "--manifest-path",
        str(manifest_path),
    ]


def _archived_national_zip_corpus(
    tmp_path: Path,
    *,
    election_year: int,
    election_round: str,
    member_name: str,
    lista_numero: str,
    agrupacion_id: str,
) -> tuple[Path, Path, Path]:
    source_id = f"national/{election_year}-{election_round}-{uuid.uuid4()}"
    filename = f"{uuid.uuid4().hex}.zip"
    csv_text = (
        "distrito_id,distrito_nombre,seccion_id,seccion_nombre,circuito_id,circuito_nombre,"
        "mesa_id,cargo_nombre,agrupacion_id,lista_numero,votos_tipo,votos_cantidad,estado_final\n"
        f"02,BUENOS AIRES,027,CORONEL ROSALES,01,Circuito 01,1,DIPUTADO NACIONAL,"
        f"{agrupacion_id},{lista_numero},POSITIVO,120,definitivo\n"
        "02,BUENOS AIRES,027,CORONEL ROSALES,01,Circuito 01,1,DIPUTADO NACIONAL,"
        "0,,EN BLANCO,4,definitivo\n"
    )
    archive_buffer = io.BytesIO()
    with zipfile.ZipFile(archive_buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr(member_name, csv_text)
        archive.writestr("ambitosElectorales.csv", "not,the,results,file\n")
    archive_bytes = archive_buffer.getvalue()
    local_root = tmp_path / "archive"
    LocalArchiveStore(root=local_root).write("national", filename, archive_bytes)
    sources_path = tmp_path / "sources.yaml"
    sources_path.write_text(
        yaml.safe_dump(
            {
                "national": [
                    {
                        "id": source_id,
                        "source": "example.test",
                        "source_url": "https://example.test/results.zip",
                        "notes": "streaming validator fixture",
                        "mime": "application/zip",
                        "election_year": election_year,
                        "election_round": election_round,
                        "filename": filename,
                    }
                ]
            }
        ),
        encoding="utf-8",
    )
    manifest_path = tmp_path / "archive-manifest.json"
    manifest_path.write_text(
        json.dumps(
            [
                {
                    "id": source_id,
                    "status": "ok",
                    "archived_path": f"archive/national/{filename}",
                    "sha256": hashlib.sha256(archive_bytes).hexdigest(),
                    "fetched_at": "2026-01-01T00:00:00Z",
                }
            ]
        ),
        encoding="utf-8",
    )
    return sources_path, local_root, manifest_path


def _guard_selected_member_reads(monkeypatch: pytest.MonkeyPatch, *, member_name: str) -> None:
    original_read_bytes = Path.read_bytes
    original_open = Path.open

    class BoundedResultsText(io.TextIOBase):
        def __init__(self, wrapped: io.TextIOBase) -> None:
            self.wrapped = wrapped

        def read(self, size: int = -1) -> str:
            assert size >= 0, "selected results member was read without a bound"
            return self.wrapped.read(size)

        def __next__(self) -> str:
            return next(self.wrapped)

        def seek(self, offset: int, whence: int = 0) -> int:
            return self.wrapped.seek(offset, whence)

        def close(self) -> None:
            self.wrapped.close()
            super().close()

    def guarded_read_bytes(path: Path) -> bytes:
        assert path.name != member_name, "selected results member used Path.read_bytes()"
        return original_read_bytes(path)

    def guarded_open(path: Path, *args, **kwargs):
        handle = original_open(path, *args, **kwargs)
        mode = args[0] if args else kwargs.get("mode", "r")
        if path.name == member_name and "b" not in mode:
            return BoundedResultsText(handle)
        return handle

    monkeypatch.setattr(Path, "read_bytes", guarded_read_bytes)
    monkeypatch.setattr(Path, "open", guarded_open)


def test_archive_history_cli_lists_order_and_status_classification_counts(
    tmp_path: Path, capsys
) -> None:
    manifest_path = tmp_path / "archive-manifest.json"
    manifest_path.write_text(
        json.dumps(
            {
                "schema_version": 2,
                "records": [],
                "fetch_events": [
                    {
                        "event_id": "one",
                        "sequence": 1,
                        "source_id": "national/test",
                        "fetched_at": "2026-08-10T00:00:00Z",
                        "status": "ok",
                        "classification": "initial",
                        "record": {
                            "id": "national/test",
                            "status": "ok",
                            "sha256": "a" * 64,
                            "archived_path": "archive/national/test.csv",
                            "bytes": 10,
                        },
                    },
                    {
                        "event_id": "two",
                        "sequence": 2,
                        "source_id": "national/test",
                        "fetched_at": "2026-08-10T00:00:00Z",
                        "status": "error",
                        "classification": "fetch_error",
                        "record": {
                            "id": "national/test",
                            "status": "error",
                            "sha256": None,
                            "archived_path": None,
                            "bytes": None,
                            "notes": "private row value",
                        },
                    },
                ],
            }
        ),
        encoding="utf-8",
    )

    exit_code = main(
        _main_args(tmp_path / "unused.yaml", tmp_path / "archive", manifest_path)
        + ["archive-history", "--source", "national/test"]
    )

    assert exit_code == 0
    output = capsys.readouterr().out
    assert output.index("one") < output.index("two")
    assert "status ok: 1" in output
    assert "status error: 1" in output
    assert "classification initial: 1" in output
    assert "classification fetch_error: 1" in output
    assert "private row value" not in output


@pytest.mark.parametrize(("fetch_status", "expected_exit"), [(200, 0), (404, 1)])
def test_fetch_pba_script_entrypoint_records_fetch_history(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    fetch_status: int,
    expected_exit: int,
) -> None:
    import runpy

    import etl.__main__ as cli
    import etl.http_client as http_client
    from etl.ingest.pba import PBA_ALLOWED_PATHS, PBA_HOST
    from etl.manifest import load_fetch_events

    script = tmp_path / "scripts" / "fetch_pba_2025.py"
    script.parent.mkdir()
    script.write_bytes((REPO_ROOT / "scripts" / script.name).read_bytes())
    etl_root = tmp_path / "etl"
    etl_root.mkdir()
    (etl_root / "sources.yaml").write_text(
        f"""pba:
  - id: pba/script-entrypoint
    source: {PBA_HOST}
    source_url: https://{PBA_HOST}{PBA_ALLOWED_PATHS[0]}
    mime: text/html
    notes: synthetic script entry-point fixture
    filename: script.html
    election_year: 2025
    election_round: provinciales
""",
        encoding="utf-8",
    )

    class ScriptFetcher:
        robots_appeared = False

        def get(self, url: str, **_kwargs):
            robots_status = 200 if self.robots_appeared else 404
            status = robots_status if url.endswith("/robots.txt") else fetch_status
            return FetchResponse(status_code=status, content=b"pba-script", headers={})

    fetcher = ScriptFetcher()
    monkeypatch.setattr(cli, "RequestsFetcher", lambda: fetcher)
    monkeypatch.setattr(http_client, "RequestsFetcher", lambda: fetcher)
    monkeypatch.setattr("sys.argv", [str(script)])

    with pytest.raises(SystemExit, match=str(expected_exit)):
        runpy.run_path(str(script), run_name="__main__")

    events = load_fetch_events(tmp_path / "archive-manifest.json")
    assert len(events) == 1
    assert events[0]["status"] == ("ok" if fetch_status == 200 else "error")
    fetcher.robots_appeared = True
    with pytest.raises(SystemExit, match="1"):
        runpy.run_path(str(script), run_name="__main__")


def test_fetch_cli_invocation_id_makes_retry_idempotent(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    import etl.__main__ as cli

    sources_path = tmp_path / "sources.yaml"
    sources_path.write_text(yaml.safe_dump(FAKE_SOURCES), encoding="utf-8")
    fetcher = FakeFetcher()
    monkeypatch.setattr(cli, "RequestsFetcher", lambda: fetcher)
    manifest_path = tmp_path / "archive-manifest.json"
    command = _main_args(sources_path, tmp_path / "archive", manifest_path) + [
        "fetch",
        "--source",
        "national/fake-test",
        "--invocation-id",
        "stable-cli-invocation",
    ]

    assert main(command) == main(command) == 0
    assert fetcher.calls == ["https://example.test/results.zip"] * 2
    from etl.manifest import load_fetch_events

    assert [event["event_id"] for event in load_fetch_events(manifest_path)] == [
        "stable-cli-invocation"
    ]


@pytest.mark.parametrize("invocation_id", ["", "   "])
def test_fetch_cli_rejects_blank_invocation_id_before_archive_mutation(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys,
    invocation_id: str,
) -> None:
    import etl.__main__ as cli

    sources_path = tmp_path / "sources.yaml"
    sources_path.write_text(yaml.safe_dump(FAKE_SOURCES), encoding="utf-8")
    fetcher = FakeFetcher()
    monkeypatch.setattr(cli, "RequestsFetcher", lambda: fetcher)
    local_root = tmp_path / "archive"
    manifest_path = tmp_path / "archive-manifest.json"

    exit_code = main(
        _main_args(sources_path, local_root, manifest_path)
        + [
            "fetch",
            "--source",
            "national/fake-test",
            "--invocation-id",
            invocation_id,
        ]
    )

    assert exit_code == 1
    assert "non-empty opaque string" in capsys.readouterr().err
    assert fetcher.calls == []
    assert not local_root.exists()
    assert not manifest_path.exists()


def test_fetch_cli_omitted_invocation_id_generates_one_event(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    import etl.__main__ as cli
    from etl.manifest import load_fetch_events

    sources_path = tmp_path / "sources.yaml"
    sources_path.write_text(yaml.safe_dump(FAKE_SOURCES), encoding="utf-8")
    fetcher = FakeFetcher()
    monkeypatch.setattr(cli, "RequestsFetcher", lambda: fetcher)
    manifest_path = tmp_path / "archive-manifest.json"

    exit_code = main(
        _main_args(sources_path, tmp_path / "archive", manifest_path)
        + ["fetch", "--source", "national/fake-test"]
    )

    assert exit_code == 0
    events = load_fetch_events(manifest_path)
    assert len(events) == 1
    assert isinstance(events[0]["event_id"], str) and events[0]["event_id"]


def test_fetch_cli_reports_malformed_history_without_a_traceback(tmp_path: Path, capsys) -> None:
    sources_path = tmp_path / "sources.yaml"
    sources_path.write_text(yaml.safe_dump(FAKE_SOURCES), encoding="utf-8")
    manifest_path = tmp_path / "archive-manifest.json"
    manifest_path.write_text(
        json.dumps({"schema_version": 2, "records": [], "fetch_events": "truncated"}),
        encoding="utf-8",
    )

    exit_code = main(
        _main_args(sources_path, tmp_path / "archive", manifest_path)
        + ["fetch", "--source", "national/fake-test"]
    )

    assert exit_code == 1
    assert "fetch_events must both be JSON arrays" in capsys.readouterr().err


def _archived_national_sources(
    tmp_path: Path, payloads: dict[str, bytes | None]
) -> tuple[Path, Path, Path]:
    sources = {
        "national": [
            {
                "id": source_id,
                "source": "example.test",
                "source_url": f"https://example.test/{source_id.rsplit('/', 1)[-1]}.csv",
                "mime": "text/csv",
                "election_year": int(source_id.split("/")[1][:4]),
                "election_round": (
                    "generales" if source_id.split("/")[1].startswith("2023") else "legislativas"
                ),
                "notes": "mesa stability fixture",
                "filename": f"{source_id.rsplit('/', 1)[-1]}.csv",
            }
            for source_id in payloads
        ]
    }
    sources_path = tmp_path / "sources.yaml"
    sources_path.write_text(yaml.safe_dump(sources), encoding="utf-8")
    local_root = tmp_path / "archive"
    manifest_path = tmp_path / "archive-manifest.json"
    for source_id, payload in payloads.items():
        if payload is not None:
            fetch_source(
                source_id,
                sources=sources,
                fetcher=FakeFetcher(payload=payload),
                local_root=local_root,
                manifest_path=manifest_path,
            )
    return sources_path, local_root, manifest_path


def test_ingest_refuses_schema_valid_bytes_modified_after_archival(
    tmp_path: Path, capsys, monkeypatch: pytest.MonkeyPatch
) -> None:
    sources_path, local_root, manifest_path = _archived_national_corpus(tmp_path, NATIONAL_CSV)
    source_id = yaml.safe_load(sources_path.read_text(encoding="utf-8"))["national"][0]["id"]
    archived_path = next((local_root / "national").iterdir())
    archived_path.write_text(NATIONAL_CSV.replace("120", "121"), encoding="utf-8")

    def forbidden_connect(*_args, **_kwargs):
        raise AssertionError("archive integrity must be checked before opening the database")

    monkeypatch.setattr("etl.__main__.psycopg.connect", forbidden_connect)
    exit_code = main(
        _main_args(sources_path, local_root, manifest_path)
        + [
            "ingest",
            "--source",
            source_id,
            "--database-url",
            "postgresql://unused",
            "--year",
            "2025",
            "--round",
            "legislativas",
        ]
    )

    assert exit_code == 1
    assert "sha256" in capsys.readouterr().err


def test_load_curated_refuses_any_registered_national_source_without_year_before_db_writes(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys
) -> None:
    sources_path = tmp_path / "sources.yaml"
    sources_path.write_text(
        yaml.safe_dump(
            {
                "national": [
                    {
                        "id": "national/2023-valid",
                        "source": "example",
                        "mime": "text/csv",
                        "notes": "canonical source fixture",
                        "source_url": "https://x",
                        "election_year": 2023,
                        "election_round": "generales",
                    },
                    {
                        "id": "national/2025-valid",
                        "source": "example",
                        "mime": "text/csv",
                        "notes": "canonical source fixture",
                        "source_url": "https://x",
                        "election_year": 2025,
                        "election_round": "legislativas",
                    },
                    {
                        "id": "national/unknown-year",
                        "source": "example",
                        "source_url": "https://x",
                        "mime": "text/csv",
                        "notes": "canonical source fixture",
                    },
                ]
            }
        ),
        encoding="utf-8",
    )
    calls: list[str] = []

    class FakeConnection:
        def commit(self) -> None:
            calls.append("commit")

        def rollback(self) -> None:
            calls.append("rollback")

        def close(self) -> None:
            calls.append("close")

    monkeypatch.setattr(
        "etl.__main__.readable_national_sources",
        lambda *_args, **_kwargs: NationalSourceReadability((), ("fixture",), ()),
    )
    monkeypatch.setattr(
        "etl.__main__.load_party_map",
        lambda _path: PartyMappingTable(canonical_parties=(), entries=()),
    )
    monkeypatch.setattr(
        "etl.__main__.load_crosswalk", lambda _path: CrosswalkTable(jurisdictions=())
    )
    monkeypatch.setattr(
        "etl.__main__.load_party_map_rows",
        lambda *_args, **_kwargs: calls.append("party loader") or {},
    )
    monkeypatch.setattr(
        "etl.__main__.load_crosswalk_rows",
        lambda *_args, **_kwargs: calls.append("crosswalk loader") or {},
    )
    monkeypatch.setattr(
        "etl.__main__.psycopg.connect",
        lambda *_args, **_kwargs: calls.append("connect") or FakeConnection(),
    )

    exit_code = main(
        [
            "--sources-path",
            str(sources_path),
            "--local-root",
            str(tmp_path / "archive"),
            "--manifest-path",
            str(tmp_path / "manifest.json"),
            "load-curated",
            "--database-url",
            "postgresql://unused",
        ]
    )

    assert exit_code == 1
    assert calls == []
    reported = capsys.readouterr().err
    assert "unknown-year" in reported
    assert "election_year" in reported


def test_load_curated_requires_every_registered_source_before_database_access(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys
) -> None:
    csv_bytes = NATIONAL_CSV.encode("utf-8")
    sources_path, local_root, manifest_path = _archived_national_sources(
        tmp_path,
        {
            "national/2023-readable": csv_bytes,
            "national/2023-missing": None,
            "national/2025-readable": csv_bytes,
            "national/2025-missing-file": None,
        },
    )
    manifest = load_manifest(manifest_path)
    manifest.append(
        {
            "id": "national/2025-missing-file",
            "status": "ok",
            "archived_path": "archive/national/absent.csv",
        }
    )
    save_manifest(manifest_path, manifest, events=load_fetch_events(manifest_path))
    party_map_path = tmp_path / "party-map.yaml"
    party_map_path.write_text("canonical_parties: []\nmappings: []\n", encoding="utf-8")
    crosswalk_path = tmp_path / "crosswalk.yaml"
    crosswalk_path.write_text("jurisdictions: []\n", encoding="utf-8")

    def forbidden_database_access(*_args, **_kwargs):
        raise AssertionError("incomplete source corpus must fail before database access")

    monkeypatch.setattr("etl.__main__.psycopg.connect", forbidden_database_access)
    monkeypatch.setattr("etl.__main__.load_party_map_rows", forbidden_database_access)
    monkeypatch.setattr("etl.__main__.load_crosswalk_rows", forbidden_database_access)

    exit_code = main(
        _main_args(sources_path, local_root, manifest_path)
        + [
            "load-curated",
            "--database-url",
            "postgresql://unused",
            "--party-map-path",
            str(party_map_path),
            "--crosswalk-path",
            str(crosswalk_path),
        ]
    )

    assert exit_code == 1
    reported = capsys.readouterr().err
    assert "national/2023-missing" in reported
    assert "no successful archive record" in reported
    assert "national/2025-missing-file" in reported
    assert "local artifact 'absent.csv' is missing" in reported


def test_load_curated_records_raw_mesa_presence_before_vote_filters(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    header = (
        b"distrito_id,seccion_id,circuito_id,mesa_id,cargo_nombre,agrupacion_id,"
        b"votos_tipo,votos_cantidad\n"
    )
    sources_path, local_root, manifest_path = _archived_national_sources(
        tmp_path,
        {
            "national/2023-raw-presence": (
                header + b"02,027,1,9001,DIPUTADO NACIONAL,,EN BLANCO,7\n"
            ),
            "national/2025-raw-presence": (
                header + b"02,027,1,9001,DIPUTADO NACIONAL,,POSITIVO,no-leible\n"
            ),
        },
    )
    party_map_path = tmp_path / "party-map.yaml"
    party_map_path.write_text("canonical_parties: []\nmappings: []\n", encoding="utf-8")
    crosswalk_path = tmp_path / "crosswalk.yaml"
    crosswalk_path.write_text(
        yaml.safe_dump(
            {
                "jurisdictions": [
                    {
                        "pba_distrito": "027",
                        "national_distrito": "02",
                        "national_seccion": "027",
                        "name": "Coronel Rosales",
                    }
                ]
            }
        ),
        encoding="utf-8",
    )
    captured_stabilities: list[tuple] = []

    class FakeConnection:
        def commit(self) -> None:
            pass

        def rollback(self) -> None:
            pass

        def close(self) -> None:
            pass

    monkeypatch.setattr("etl.__main__.psycopg.connect", lambda *_args, **_kwargs: FakeConnection())
    monkeypatch.setattr(
        "etl.__main__.load_party_map_rows",
        lambda *_args, **_kwargs: PartyMapReplacementSummary(
            party_canonical=TableReplacementCount(loaded=0, deleted=0),
            list_identity=TableReplacementCount(loaded=0, deleted=0),
            party_mapping=TableReplacementCount(loaded=0, deleted=0),
        ),
    )

    def capture_crosswalk(_conn, _crosswalk, *, mesa_stabilities):
        captured_stabilities.extend(mesa_stabilities)
        return CrosswalkReplacementSummary(
            jurisdiction_crosswalk=TableReplacementCount(loaded=1, deleted=0),
            mesa_crosswalk=TableReplacementCount(loaded=len(mesa_stabilities), deleted=0),
        )

    monkeypatch.setattr("etl.__main__.load_crosswalk_rows", capture_crosswalk)

    exit_code = main(
        _main_args(sources_path, local_root, manifest_path)
        + [
            "load-curated",
            "--database-url",
            "postgresql://unused",
            "--party-map-path",
            str(party_map_path),
            "--crosswalk-path",
            str(crosswalk_path),
        ]
    )

    assert exit_code == 0
    assert len(captured_stabilities) == 1
    distrito, seccion, stability = captured_stabilities[0]
    assert (distrito, seccion, stability.mesa) == ("02", "027", 9001)
    assert stability.present_2023 is True
    assert stability.present_2025 is True
    assert stability.stable is True


def test_load_curated_cli_records_year_level_contexts_in_deterministic_order(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys,
) -> None:
    manifest_path = tmp_path / "archive-manifest.json"
    manifest_path.write_text("[]\n", encoding="utf-8")
    sources_path = tmp_path / "sources.yaml"
    sources_path.write_text("{}\n", encoding="utf-8")

    class FakeConnection:
        def commit(self) -> None:
            pass

        def rollback(self) -> None:
            pass

        def close(self) -> None:
            pass

    jurisdiction = SimpleNamespace(
        national_distrito_code="02",
        national_seccion_code="027",
    )
    candidates: list[object] = []
    monkeypatch.setattr(
        "etl.__main__._require_complete_national_corpus",
        lambda *_args, **_kwargs: None,
    )
    monkeypatch.setattr(
        "etl.__main__.load_crosswalk",
        lambda _path: SimpleNamespace(jurisdictions=(jurisdiction,)),
    )
    monkeypatch.setattr("etl.__main__.load_party_map", lambda _path: object())
    monkeypatch.setattr(
        "etl.__main__.collect_national_mesa_codes",
        lambda *_args, year, **_kwargs: {("1", 1)} if year == 2023 else {("1", 1), ("1", 2)},
    )
    monkeypatch.setattr("etl.__main__.psycopg.connect", lambda _url: FakeConnection())
    monkeypatch.setattr(
        "etl.__main__.load_party_map_rows",
        lambda *_args: PartyMapReplacementSummary(
            party_canonical=TableReplacementCount(loaded=0, deleted=0),
            list_identity=TableReplacementCount(loaded=0, deleted=0),
            party_mapping=TableReplacementCount(loaded=0, deleted=0),
        ),
    )
    monkeypatch.setattr(
        "etl.__main__.load_crosswalk_rows",
        lambda *_args, **_kwargs: CrosswalkReplacementSummary(
            jurisdiction_crosswalk=TableReplacementCount(loaded=1, deleted=0),
            mesa_crosswalk=TableReplacementCount(loaded=2, deleted=0),
        ),
    )
    monkeypatch.setattr(
        "etl.__main__.insert_review_items",
        lambda _conn, records: candidates.extend(records) or 0,
    )

    exit_code = main(
        _main_args(sources_path, tmp_path / "archive", manifest_path)
        + ["load-curated", "--database-url", "postgresql://not-opened/test"]
    )

    assert exit_code == 0
    assert len(candidates) == 1
    assert candidates[0].contexts == (
        ReviewItemContext(
            "observed",
            "official",
            "unknown",
            2023,
            None,
            None,
            None,
            "source_archive_not_attributable",
        ),
        ReviewItemContext(
            "observed",
            "official",
            "unknown",
            2025,
            None,
            None,
            None,
            "source_archive_not_attributable",
        ),
    )
    assert "(0 new, 1 not recorded)" in capsys.readouterr().err


def test_validate_crosswalk_refuses_a_parser_row_without_distrito(
    tmp_path: Path, capsys, monkeypatch: pytest.MonkeyPatch
) -> None:
    sources_path, local_root, manifest_path = _archived_national_corpus(tmp_path, NATIONAL_CSV)
    malformed = SimpleNamespace(
        result=SimpleNamespace(distrito=None, seccion="027"),
        category="DIPUTADO NACIONAL",
        list_id="110",
        source_row_index=7,
    )
    monkeypatch.setattr("etl.__main__.iter_national_rows", lambda *_args, **_kwargs: [malformed])

    exit_code = main(_main_args(sources_path, local_root, manifest_path) + ["validate-crosswalk"])

    reported = capsys.readouterr().err
    assert exit_code == 1
    assert "parser invariant violated" in reported
    assert "distrito" in reported


def test_validate_curated_refuses_a_parser_row_without_list_id(
    tmp_path: Path, capsys, monkeypatch: pytest.MonkeyPatch
) -> None:
    sources_path, local_root, manifest_path = _archived_national_corpus(tmp_path, NATIONAL_CSV)
    malformed = SimpleNamespace(
        result=SimpleNamespace(distrito="02", seccion="027"),
        category="DIPUTADO NACIONAL",
        list_id=None,
        source_row_index=7,
    )
    monkeypatch.setattr("etl.__main__.iter_national_rows", lambda *_args, **_kwargs: [malformed])

    exit_code = main(_main_args(sources_path, local_root, manifest_path) + ["validate-curated"])

    reported = capsys.readouterr().err
    assert exit_code == 1
    assert "parser invariant violated" in reported
    assert "list_id" in reported


def test_fetch_is_reachable_through_main(tmp_path: Path, capsys) -> None:
    """`fetch` was the ONE subcommand with no `main()`-driven test.

    Deleting its `set_defaults(func=cmd_fetch)` left the whole suite green,
    because every fetch test called `fetch_source` directly — the same shape
    that let a badge ship with a production call site nobody exercised.

    Driven at its personal-data guard: a fiscalización entry is upload-forbidden,
    so this reaches `cmd_fetch`'s own error path rather than the network.
    """
    source_id = f"fiscalizacion/main-fetch-{uuid.uuid4()}"
    sources_path = tmp_path / "sources.yaml"
    sources_path.write_text(
        yaml.safe_dump(
            {
                "fiscalizacion": [
                    {
                        "id": source_id,
                        "source": "internal",
                        "source_url": "https://example.test/should-never-be-fetched.csv",
                        "election_year": 2025,
                        "election_round": "legislativas",
                        "mime": "text/csv",
                        "notes": "main() fetch fixture",
                        "filename": "nope.csv",
                        # `source_kind` is what the guard keys on -- the real
                        # `sources.yaml` entry carries it -- and `upload` is
                        # deliberately ABSENT, which is what it refuses.
                        "source_kind": "fiscalizacion",
                    }
                ]
            }
        ),
        encoding="utf-8",
    )

    exit_code = main(
        _main_args(sources_path, tmp_path / "archive", tmp_path / "archive-manifest.json")
        + ["fetch", "--source", source_id]
    )

    reported = capsys.readouterr().err
    assert exit_code == 1, f"the guard must exit nonzero, not raise; got {exit_code}"
    # The GUARD's own message: `cmd_fetch` also returns 1 for an unregistered
    # source, so the code alone would not say which path ran.
    assert "upload" in reported.lower(), (
        f"the personal-data guard must be the one that fired; got {reported!r}"
    )


def _unguarded_fiscalizacion_corpus(tmp_path: Path) -> tuple[Path, Path, Path, str]:
    """An archived fiscalización entry that LOST `upload: never`."""
    source_id = f"fiscalizacion/unguarded-{uuid.uuid4()}"
    local_root = tmp_path / "archive"
    LocalArchiveStore(root=local_root).write("fiscalizacion", "leak.csv", b"Escuela,Mesa\n")
    sources_path = tmp_path / "sources.yaml"
    sources_path.write_text(
        yaml.safe_dump(
            {
                "fiscalizacion": [
                    {
                        "id": source_id,
                        "source": "internal",
                        "source_url": "local://fiscalizacion/leak.csv",
                        "mime": "text/csv",
                        "election_year": 2025,
                        "election_round": "legislativas",
                        "notes": "guard fixture",
                        "filename": "leak.csv",
                        "source_kind": "fiscalizacion",
                        # `upload: never` deliberately absent.
                    }
                ],
                "national": [
                    {
                        "id": "national/2025-guard-not-reached",
                        "source": "example.test",
                        "mime": "text/csv",
                        "notes": "canonical source fixture",
                        "source_url": "https://example.test/baseline.csv",
                        "election_year": 2025,
                        "election_round": "legislativas",
                    }
                ],
            }
        ),
        encoding="utf-8",
    )
    manifest_path = tmp_path / "archive-manifest.json"
    manifest_path.write_text(
        json.dumps(
            [
                {
                    "id": source_id,
                    "status": "ok",
                    "archived_path": "archive/fiscalizacion/leak.csv",
                    "sha256": hashlib.sha256(b"Escuela,Mesa\n").hexdigest(),
                    "fetched_at": "2026-01-01T00:00:00Z",
                }
            ]
        ),
        encoding="utf-8",
    )
    return sources_path, local_root, manifest_path, source_id


def test_ingest_refuses_an_unguarded_fiscalizacion_entry(tmp_path: Path, capsys) -> None:
    """The guard's THIRD read path.

    `fetch_source` ran it and `validate-fiscalizacion` ran it; `ingest_source`
    read the same archived copy without it, so an entry that lost
    `upload: never` was still ingestible. Blocking one path is not blocking the
    others.
    """
    sources_path, local_root, manifest_path, source_id = _unguarded_fiscalizacion_corpus(tmp_path)

    exit_code = main(
        _main_args(sources_path, local_root, manifest_path)
        + [
            "ingest",
            "--source",
            source_id,
            "--database-url",
            TEST_DSN,
            "--year",
            "2025",
            "--round",
            "legislativas",
        ]
    )

    reported = capsys.readouterr().err
    assert exit_code == 1, f"the guard must exit nonzero, not raise; got {exit_code}"
    assert "upload" in reported.lower(), (
        f"the personal-data guard must be the one that fired; got {reported!r}"
    )


def test_validate_fiscalizacion_refuses_an_unguarded_entry(tmp_path: Path, capsys) -> None:
    """Same guard, the command's own read path, its own exit code."""
    sources_path, local_root, manifest_path, source_id = _unguarded_fiscalizacion_corpus(tmp_path)

    exit_code = main(
        _main_args(sources_path, local_root, manifest_path)
        + [
            "validate-fiscalizacion",
            "--source",
            source_id,
            "--baseline",
            "national/2025-guard-not-reached",
            "--database-url",
            TEST_DSN,
        ]
    )

    reported = capsys.readouterr().err
    assert exit_code == 1, f"the guard must exit nonzero, not raise; got {exit_code}"
    assert "upload" in reported.lower(), (
        f"the personal-data guard must be the one that fired; got {reported!r}"
    )


@pytest.mark.parametrize("command", ["validate-crosswalk", "validate-curated"])
def test_validate_commands_report_each_unavailable_source_reason_before_exit(
    tmp_path: Path, capsys, command: str
) -> None:
    sources_path = tmp_path / "sources.yaml"
    sources_path.write_text(
        yaml.safe_dump(
            {
                "national": [
                    {
                        "id": "national/2023-never-fetched",
                        "source": "example.test",
                        "mime": "text/csv",
                        "notes": "canonical source fixture",
                        "source_url": "https://example.test/2023.csv",
                        "election_year": 2023,
                        "election_round": "generales",
                    },
                    {
                        "id": "national/2025-missing-file",
                        "source": "example.test",
                        "mime": "text/csv",
                        "notes": "canonical source fixture",
                        "source_url": "https://example.test/2025.csv",
                        "election_year": 2025,
                        "election_round": "legislativas",
                    },
                ]
            }
        ),
        encoding="utf-8",
    )
    manifest_path = tmp_path / "archive-manifest.json"
    manifest_path.write_text(
        json.dumps(
            [
                {
                    "id": "national/2025-missing-file",
                    "status": "ok",
                    "archived_path": "archive/national/missing.csv",
                }
            ]
        ),
        encoding="utf-8",
    )

    exit_code = main(_main_args(sources_path, tmp_path / "archive", manifest_path) + [command])

    reported = capsys.readouterr().err
    assert exit_code == 1
    assert "no successful archive record: 1 source(s)" in reported
    assert "national/2023-never-fetched" in reported
    assert "archive file missing or unreadable: 1 source(s)" in reported
    assert "national/2025-missing-file" in reported


def test_validate_crosswalk_streams_selected_results_member_through_main(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys
) -> None:
    member_name = "ResultadosElectorales.csv"
    sources_path, local_root, manifest_path = _archived_national_zip_corpus(
        tmp_path,
        election_year=2023,
        election_round="paso",
        member_name=member_name,
        lista_numero="A",
        agrupacion_id="900",
    )
    crosswalk_path = tmp_path / "crosswalk.yaml"
    crosswalk_path.write_text(yaml.safe_dump({"jurisdictions": []}), encoding="utf-8")
    _guard_selected_member_reads(monkeypatch, member_name=member_name)

    exit_code = main(
        _main_args(sources_path, local_root, manifest_path)
        + ["validate-crosswalk", "--crosswalk-path", str(crosswalk_path)]
    )

    assert exit_code == 1
    reported = capsys.readouterr().err
    assert "unmapped jurisdiction: 02/027" in reported
    assert (
        "excluded 1 row(s) as out of scope for normalized list votes -- "
        "votos_tipo='EN BLANCO': 1 rows / 4 votes"
    ) in reported


def test_validate_crosswalk_is_reachable_through_main(tmp_path: Path, capsys) -> None:
    """Drives `main(["validate-crosswalk", ...])`, not `find_unmapped_*`.

    Rule 1 names these two validate commands by name: their four tests
    exercised downstream pure functions and bypassed the archive-reading path
    they existed to cover. Deleting the `add_parser` call left the suite green.
    """
    sources_path, local_root, manifest_path = _archived_national_corpus(tmp_path, NATIONAL_CSV)
    # A crosswalk that maps NOTHING: the command must FAIL, so a green exit
    # cannot come from an empty corpus or a skipped read.
    crosswalk_path = tmp_path / "crosswalk.yaml"
    crosswalk_path.write_text(yaml.safe_dump({"jurisdictions": []}), encoding="utf-8")

    exit_code = main(
        _main_args(sources_path, local_root, manifest_path)
        + ["validate-crosswalk", "--crosswalk-path", str(crosswalk_path)]
    )

    output = capsys.readouterr()
    assert exit_code == 1, "an unmapped code must exit nonzero"
    assert "02" in output.out + output.err, (
        f"the code read FROM THE ARCHIVE must appear in the report; got {output.out + output.err!r}"
    )


@pytest.mark.parametrize("loader", ["crosswalk", "party_map"])
def test_duplicate_curated_keys_exit_cleanly_through_main(
    tmp_path: Path, capsys, loader: str
) -> None:
    sources_path, local_root, manifest_path = _archived_national_corpus(tmp_path, NATIONAL_CSV)
    if loader == "crosswalk":
        entry = {
            "pba_distrito": "027",
            "national_distrito": "02",
            "national_seccion": "027",
            "name": "Coronel Rosales",
        }
        curated_path = tmp_path / "crosswalk.yaml"
        curated_path.write_text(yaml.safe_dump({"jurisdictions": [entry, entry]}), encoding="utf-8")
        command = ["validate-crosswalk", "--crosswalk-path", str(curated_path)]
    else:
        entry = {
            "year": 2025,
            "jurisdiction": "national",
            "category": "DIPUTADO NACIONAL",
            "list_id": "135",
            "canonical_party": "LLA",
            "party_name": "LA LIBERTAD AVANZA",
        }
        curated_path = tmp_path / "party_map.yaml"
        curated_path.write_text(
            yaml.safe_dump(
                {
                    "canonical_parties": [{"id": "LLA", "display_name": "LA LIBERTAD AVANZA"}],
                    "mappings": [entry, entry],
                }
            ),
            encoding="utf-8",
        )
        command = ["validate-curated", "--party-map-path", str(curated_path)]

    exit_code = main(_main_args(sources_path, local_root, manifest_path) + command)

    assert exit_code == 1
    reported = capsys.readouterr().err
    assert "error:" in reported
    assert "duplicate" in reported
    assert "Traceback" not in reported


@pytest.mark.parametrize(
    ("election_year", "election_round", "member_name", "lista_numero", "agrupacion_id", "list_id"),
    [
        (2023, "generales", "ResultadosElectorales.csv", "", "901", "901"),
        (2025, "legislativas", "resultados2025.csv", "", "902", "902"),
    ],
)
def test_validate_curated_streams_selected_results_member_through_main(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys,
    election_year: int,
    election_round: str,
    member_name: str,
    lista_numero: str,
    agrupacion_id: str,
    list_id: str,
) -> None:
    sources_path, local_root, manifest_path = _archived_national_zip_corpus(
        tmp_path,
        election_year=election_year,
        election_round=election_round,
        member_name=member_name,
        lista_numero=lista_numero,
        agrupacion_id=agrupacion_id,
    )
    party_map_path = tmp_path / "party_map.yaml"
    party_map_path.write_text(
        yaml.safe_dump({"canonical_parties": [], "mappings": []}), encoding="utf-8"
    )
    _guard_selected_member_reads(monkeypatch, member_name=member_name)

    exit_code = main(
        _main_args(sources_path, local_root, manifest_path)
        + ["validate-curated", "--party-map-path", str(party_map_path)]
    )

    assert exit_code == 1
    reported = capsys.readouterr().err
    assert f"unmapped party: year={election_year}" in reported
    assert f"list_id={list_id}" in reported
    assert (
        "excluded 1 row(s) as out of scope for normalized list votes -- "
        "votos_tipo='EN BLANCO': 1 rows / 4 votes"
    ) in reported


def test_validate_curated_is_reachable_through_main(tmp_path: Path, capsys) -> None:
    """Same wiring proof for the second command rule 1 names."""
    sources_path, local_root, manifest_path = _archived_national_corpus(tmp_path, NATIONAL_CSV)
    party_map_path = tmp_path / "party_map.yaml"
    party_map_path.write_text(
        yaml.safe_dump({"canonical_parties": [], "mappings": []}), encoding="utf-8"
    )

    exit_code = main(
        _main_args(sources_path, local_root, manifest_path)
        + ["validate-curated", "--party-map-path", str(party_map_path)]
    )

    output = capsys.readouterr()
    assert exit_code == 1, "an unmapped list id must exit nonzero"
    assert "135" in output.out + output.err, (
        "the list id read FROM THE ARCHIVE must appear in the report; "
        f"got {output.out + output.err!r}"
    )


def test_ingest_is_reachable_through_main(tmp_path: Path) -> None:
    """`ingest` had no `main()`-driven test either."""
    _require_ephemeral_postgres()

    sources_path, local_root, manifest_path = _archived_national_corpus(tmp_path, NATIONAL_CSV)
    source_id = yaml.safe_load(sources_path.read_text())["national"][0]["id"]

    conn = psycopg.connect(TEST_DSN)
    try:
        exit_code = main(
            _main_args(sources_path, local_root, manifest_path)
            + [
                "ingest",
                "--source",
                source_id,
                "--database-url",
                TEST_DSN,
                "--year",
                "2025",
                "--round",
                "legislativas",
            ]
        )
        with conn.cursor() as cur:
            cur.execute(
                "select count(*) from result_row where archive_entry_id = %s",
                (source_id,),
            )
            count_row = cur.fetchone()
            assert count_row == (2,), (
                f"the CLI must write exactly two archived rows; got {count_row!r}"
            )
    finally:
        with conn.cursor() as cur:
            cur.execute("delete from result_row where archive_entry_id = %s", (source_id,))
        conn.commit()
        conn.close()

    assert exit_code == 0, "a well-formed ingest must exit zero"


# ---------------------------------------------------------------------------
# 12.4 -- validate-crosswalk reports unmapped codes and exits nonzero
# ---------------------------------------------------------------------------


def test_validate_crosswalk_reports_unmapped_codes() -> None:
    crosswalk = load_crosswalk(CROSSWALK_PATH)

    codes = [("02", "027"), ("99", "999")]  # second pair has no curated entry
    unmapped = find_unmapped_jurisdictions(codes, crosswalk)

    assert len(unmapped) == 1
    assert unmapped[0].code == "99/999"


def test_validate_crosswalk_reports_nothing_when_every_code_resolves() -> None:
    crosswalk = load_crosswalk(CROSSWALK_PATH)

    unmapped = find_unmapped_jurisdictions([("02", "027")], crosswalk)

    assert unmapped == []


def test_validate_crosswalk_resolves_unpadded_codes_against_zero_padded_curated_entries() -> None:
    """Phase 16b: `curated/crosswalk.yaml` records national codes
    zero-padded (`"02"`/`"027"`, confirmed directly in the file for Coronel
    Rosales), but the real archived 2023 national CSV (see
    `tests/fixtures/national_2023_sample.csv`, sliced from the real archived
    2023 PASO source) carries them UNPADDED (`distrito_id=2`,
    `seccion_id=27`). `find_unmapped_jurisdictions` -> `resolve_national`
    compares by exact string equality with no normalization, the same bug
    Phase 15 found and fixed in `collect_national_mesa_codes`. If unfixed
    here, every real 2023 code is misreported as unmapped even though it
    IS curated.
    """
    crosswalk = load_crosswalk(CROSSWALK_PATH)

    unmapped = find_unmapped_jurisdictions([("2", "27")], crosswalk)

    assert unmapped == [], (
        "an unpadded national code with a zero-padded curated match must resolve, "
        f"not be reported unmapped: {unmapped}"
    )


# ---------------------------------------------------------------------------
# 12.5 -- validate-curated reports unmapped list ids and exits nonzero
# ---------------------------------------------------------------------------


def test_validate_curated_reports_unmapped_list_ids() -> None:
    party_map = load_party_map(PARTY_MAP_PATH)

    keys = [
        (2025, "national", "DIPUTADO NACIONAL", "110"),  # curated
        (2025, "national", "DIPUTADO NACIONAL", "999999"),  # not curated
    ]
    unmapped = find_unmapped_parties(keys, party_map)

    assert len(unmapped) == 1
    assert unmapped[0].list_id == "999999"


def test_validate_curated_reports_nothing_when_every_key_resolves() -> None:
    party_map = load_party_map(PARTY_MAP_PATH)

    unmapped = find_unmapped_parties([(2025, "national", "DIPUTADO NACIONAL", "110")], party_map)

    assert unmapped == []


def test_fetch_refuses_a_fiscalizacion_entry_without_upload_never(tmp_path) -> None:
    """`guard_local_mirror_only` must actually run, not merely exist.

    The guard was written in phase 6 and unit-tested, but its only appearance
    in production code was its own definition -- no call site anywhere. A
    guard that never runs is a false sense of safety, and this one protects
    the single personal-data-bearing source in the project.

    Wiring it into the fetch path makes the invariant structural: a
    fiscalización entry that loses its `upload: never` declaration fails
    immediately instead of being archived and only caught by a test that
    inspects the YAML.
    """
    from etl.ingest.fiscalizacion import FiscalizacionUploadForbiddenError

    sources = {
        "fiscalizacion": [
            {
                "id": "fiscalizacion/2025-coronel-rosales",
                "source_kind": "fiscalizacion",
                "local_path": "does-not-matter.csv",
                # `upload: never` deliberately absent
            }
        ]
    }

    with pytest.raises(FiscalizacionUploadForbiddenError):
        fetch_source(
            "fiscalizacion/2025-coronel-rosales",
            sources=sources,
            fetcher=FakeFetcher(),
            local_root=tmp_path / "archive",
            manifest_path=tmp_path / "archive-manifest.json",
        )


def test_collect_functions_read_a_real_zipped_archive_entry(tmp_path) -> None:
    """`validate-crosswalk` and `validate-curated` must read a ZIP archive
    entry the same way `ingest` does.

    Both collect helpers handed the archived bytes straight to the former
    bytes parser, which expected decoded CSV. Every registered national
    source is archived as a ZIP, so on real data both commands died with
    `UnicodeDecodeError: 'utf-8' codec can't decode byte 0x80`. `cmd_ingest`
    routes through `resolve_national_results_bytes` first; these two did not.

    The four existing tests for these commands never caught it because they
    exercise the downstream pure comparison functions and bypass the
    archive-reading path entirely.
    """
    import json
    import zipfile

    local_root = tmp_path / "archive"
    (local_root / "national").mkdir(parents=True)
    zip_path = local_root / "national" / "sample.zip"
    with zipfile.ZipFile(zip_path, "w") as zf:
        zf.writestr("resultados2025.csv", NATIONAL_CSV)

    manifest_path = tmp_path / "archive-manifest.json"
    manifest_path.write_text(
        json.dumps(
            [
                {
                    "id": "national/2025-legislativas",
                    "status": "ok",
                    "archived_path": "national/sample.zip",
                    "sha256": hashlib.sha256(zip_path.read_bytes()).hexdigest(),
                }
            ]
        )
    )

    sources = {
        "national": [
            {
                "id": "national/2025-legislativas",
                "election_year": 2025,
                "election_round": "legislativas",
            }
        ]
    }

    codes = collect_national_jurisdiction_codes(
        sources, local_root=local_root, manifest_path=manifest_path
    )
    assert codes, "a zipped archive entry must yield jurisdiction codes, not crash"

    keys = collect_national_party_keys(sources, local_root=local_root, manifest_path=manifest_path)
    assert keys, "a zipped archive entry must yield party keys, not crash"


# ---------------------------------------------------------------------------
# 15.9 -- load-curated is reachable from the CLI, not merely importable
# ---------------------------------------------------------------------------


class _RecordingCuratedCursor:
    rowcount = 0

    def __init__(self) -> None:
        self.calls: list[tuple[str, object | None]] = []

    def __enter__(self) -> _RecordingCuratedCursor:
        return self

    def __exit__(self, _exc_type: object, _exc: object, _traceback: object) -> None:
        return None

    def execute(self, query: object, params: object | None = None) -> None:
        self.calls.append((str(query).lower(), params))
        self.rowcount = 0


class _RecordingCuratedConnection:
    def __init__(self) -> None:
        self.recording_cursor = _RecordingCuratedCursor()
        self.commits = 0
        self.rollbacks = 0
        self.closes = 0

    def cursor(self) -> _RecordingCuratedCursor:
        return self.recording_cursor

    def commit(self) -> None:
        self.commits += 1

    def rollback(self) -> None:
        self.rollbacks += 1

    def close(self) -> None:
        self.closes += 1


def _empty_crosswalk_replacement_summary() -> CrosswalkReplacementSummary:
    return CrosswalkReplacementSummary(
        jurisdiction_crosswalk=TableReplacementCount(loaded=0, deleted=0),
        mesa_crosswalk=TableReplacementCount(loaded=0, deleted=0),
    )


def _curated_cli_args(tmp_path: Path, party_map_document: object) -> list[str]:
    sources_path = tmp_path / "sources.yaml"
    sources_path.write_text("national: []\n", encoding="utf-8")
    manifest_path = tmp_path / "archive-manifest.json"
    manifest_path.write_text("[]\n", encoding="utf-8")
    party_map_path = tmp_path / "party-map.yaml"
    party_map_path.write_text(yaml.safe_dump(party_map_document, sort_keys=False), encoding="utf-8")
    crosswalk_path = tmp_path / "crosswalk.yaml"
    crosswalk_path.write_text("jurisdictions: []\n", encoding="utf-8")
    return [
        "--sources-path",
        str(sources_path),
        "--local-root",
        str(tmp_path / "archive"),
        "--manifest-path",
        str(manifest_path),
        "load-curated",
        "--database-url",
        "postgresql://user:secret@example.test/votus",
        "--party-map-path",
        str(party_map_path),
        "--crosswalk-path",
        str(crosswalk_path),
    ]


def test_load_curated_cli_projects_declared_display_and_exact_source_spelling(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys
) -> None:
    connection = _RecordingCuratedConnection()
    monkeypatch.setattr(
        "etl.__main__._require_complete_national_corpus", lambda *_args, **_kwargs: None
    )
    monkeypatch.setattr("etl.__main__.psycopg.connect", lambda _url: connection)
    monkeypatch.setattr(
        "etl.__main__.load_crosswalk_rows",
        lambda *_args, **_kwargs: _empty_crosswalk_replacement_summary(),
    )
    args = _curated_cli_args(
        tmp_path,
        {
            "canonical_parties": [
                {"id": "PARENT", "display_name": "Public Canonical Label"},
            ],
            "mappings": [
                {
                    "year": 2025,
                    "jurisdiction": "national",
                    "category": "DIPUTADO NACIONAL",
                    "list_id": "100",
                    "canonical_party": "PARENT",
                    "party_name": "Exact Source Spelling",
                }
            ],
        },
    )

    exit_code = main(args)

    reported = capsys.readouterr()
    assert exit_code == 0
    assert reported.err == ""
    canonical_inserts = [
        params
        for statement, params in connection.recording_cursor.calls
        if "insert into party_canonical" in statement
    ]
    identity_inserts = [
        params
        for statement, params in connection.recording_cursor.calls
        if "insert into list_identity" in statement
    ]
    assert canonical_inserts == [("PARENT", "Public Canonical Label")]
    assert identity_inserts == [
        (2025, "national", "DIPUTADO NACIONAL", "100", "Exact Source Spelling")
    ]
    assert connection.commits == 1
    assert connection.rollbacks == 0
    assert connection.closes == 1


def test_load_curated_cli_rejects_malformed_declaration_before_database_access(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys
) -> None:
    connect_calls: list[str] = []

    def refuse_database_access(database_url: str) -> _RecordingCuratedConnection:
        connect_calls.append(database_url)
        raise AssertionError("psycopg.connect must not run for malformed canonical declarations")

    monkeypatch.setattr(
        "etl.__main__._require_complete_national_corpus", lambda *_args, **_kwargs: None
    )
    monkeypatch.setattr("etl.__main__.psycopg.connect", refuse_database_access)
    args = _curated_cli_args(
        tmp_path,
        {
            "canonical_parties": [
                {"id": "PARENT", "display_name": " Public Canonical Label"},
            ],
            "mappings": [
                {
                    "year": 2025,
                    "jurisdiction": "national",
                    "category": "DIPUTADO NACIONAL",
                    "list_id": "100",
                    "canonical_party": "PARENT",
                    "party_name": "Exact Source Spelling",
                }
            ],
        },
    )

    exit_code = main(args)

    reported = capsys.readouterr()
    assert exit_code == 1
    assert reported.out == ""
    assert reported.err == (
        "error: party_map.yaml canonical_parties entry 0 display_name "
        "must not have surrounding whitespace\n"
    )
    assert "Traceback" not in reported.err
    assert connect_calls == []


def test_load_curated_reports_per_table_replacement_counts_through_main(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys
) -> None:
    sources_path = tmp_path / "sources.yaml"
    sources_path.write_text("national: []\n", encoding="utf-8")
    summary = SimpleNamespace(
        party_map=SimpleNamespace(
            party_canonical=TableReplacementCount(loaded=3, deleted=2),
            list_identity=TableReplacementCount(loaded=4, deleted=1),
            party_mapping=TableReplacementCount(loaded=4, deleted=3),
        ),
        crosswalk=SimpleNamespace(
            jurisdiction_crosswalk=TableReplacementCount(loaded=5, deleted=4),
            mesa_crosswalk=TableReplacementCount(loaded=0, deleted=0, operation="no-op"),
        ),
    )
    monkeypatch.setattr("etl.__main__.load_curated", lambda **_kwargs: summary)

    exit_code = main(
        [
            "--sources-path",
            str(sources_path),
            "load-curated",
            "--database-url",
            "postgresql://user:secret@example.test/votus",
        ]
    )

    assert exit_code == 0
    assert capsys.readouterr().out.splitlines() == [
        "party_canonical: operation=replacement loaded=3 deleted=2 "
        "deleted_by_reason=absent_from_desired_projection:2",
        "list_identity: operation=replacement loaded=4 deleted=1 "
        "deleted_by_reason=absent_from_desired_projection:1",
        "party_mapping: operation=replacement loaded=4 deleted=3 "
        "deleted_by_reason=absent_from_desired_projection:3",
        "jurisdiction_crosswalk: operation=replacement loaded=5 deleted=4 "
        "deleted_by_reason=absent_from_desired_projection:4",
        "mesa_crosswalk: operation=no-op loaded=0 deleted=0 deleted_by_reason=none",
    ]


def test_load_curated_populates_every_curated_table(tmp_path: Path, capsys) -> None:
    """This project has shipped correct, tested, unreachable code seven
    times (Phase 15's own charter). This test drives `load-curated` through
    `main()` -- the real argv-parsing CLI entrypoint -- never by importing
    `load_curated`/`load_party_map_rows`/`load_crosswalk_rows` directly, so
    a subcommand that exists but was never wired into `build_parser` cannot
    pass this test."""
    _require_ephemeral_postgres()

    # `X`-prefixed so the marker is NOT numeric. `upsert_jurisdiction`
    # normalizes distrito through `_zero_pad_numeric` while the mapping key
    # below is used raw, so an all-digit marker with a leading zero would be
    # stored as `"1234567"` and looked up as `"01234567"` -- a join miss on
    # ~0.2% of runs, failing for a reason unrelated to the code under test.
    marker = f"X{uuid.uuid4().hex[:8]}"
    canonical_id = f"TESTCLI_{marker}"
    # Curated `crosswalk.yaml` uses zero-padded DINE-convention codes, while
    # the RAW national CSV `distrito_id`/`seccion_id` columns are UNPADDED
    # (measured against the real archived files, task 15.11) -- using
    # different padding on each side here exercises that exact real-world
    # mismatch, not a coincidentally-matching fixture.
    csv_distrito, csv_seccion = "90", "1"
    curated_distrito, curated_seccion = "090", "001"
    # What the curated file DECLARES is not what the tables store: every write
    # goes through `jurisdiction.py`, so a 3-digit distrito in the YAML lands as
    # the national 2-digit form. Asserting the raw curated strings would pass
    # only while the crosswalk tables kept their own idea of the code.
    stored_distrito, stored_seccion = "90", "001"
    pba_distrito = str(uuid.uuid4().int)

    source_2023_id = f"national/2023-cli-load-{marker}"
    source_2025_id = f"national/2025-cli-load-{marker}"
    sources = {
        "national": [
            {
                "id": source_2023_id,
                "source": "example.test",
                "source_url": "https://example.test/2023.csv",
                "mime": "text/csv",
                "election_year": 2023,
                "election_round": "generales",
                "notes": "load-curated CLI reachability fixture",
                "filename": "2023.csv",
            },
            {
                "id": source_2025_id,
                "source": "example.test",
                "source_url": "https://example.test/2025.csv",
                "mime": "text/csv",
                "election_year": 2025,
                "election_round": "legislativas",
                "notes": "load-curated CLI reachability fixture",
                "filename": "2025.csv",
            },
        ]
    }
    sources_path = tmp_path / "sources.yaml"
    sources_path.write_text(yaml.safe_dump(sources), encoding="utf-8")

    manifest_path = tmp_path / "archive-manifest.json"
    local_root = tmp_path / "archive"

    csv_row = (
        "distrito_id,seccion_id,circuito_id,mesa_id,cargo_nombre,agrupacion_id,"
        "votos_tipo,votos_cantidad,estado_final\n"
        f"{csv_distrito},{csv_seccion},01,1,DIPUTADO NACIONAL,900001,POSITIVO,10,definitivo\n"
    )
    for source_id in (source_2023_id, source_2025_id):
        fetch_source(
            source_id,
            sources=sources,
            fetcher=FakeFetcher(payload=csv_row.encode("utf-8")),
            local_root=local_root,
            manifest_path=manifest_path,
        )

    party_map_path = tmp_path / "party_map.yaml"
    party_map_path.write_text(
        yaml.safe_dump(
            {
                "canonical_parties": [{"id": canonical_id, "display_name": "TEST CLI PARTY"}],
                "mappings": [
                    {
                        "year": 2025,
                        "jurisdiction": "national",
                        "category": "DIPUTADO NACIONAL",
                        "list_id": "900001",
                        "canonical_party": canonical_id,
                        "party_name": "TEST CLI PARTY",
                        "source": "fixture",
                    }
                ],
            }
        ),
        encoding="utf-8",
    )

    crosswalk_path = tmp_path / "crosswalk.yaml"
    crosswalk_path.write_text(
        yaml.safe_dump(
            {
                "jurisdictions": [
                    {
                        "pba_distrito": pba_distrito,
                        "national_distrito": curated_distrito,
                        "national_seccion": curated_seccion,
                        "name": "Test Distrito",
                    }
                ]
            }
        ),
        encoding="utf-8",
    )

    capsys.readouterr()
    exit_code = main(
        [
            "--sources-path",
            str(sources_path),
            "--local-root",
            str(local_root),
            "--manifest-path",
            str(manifest_path),
            "load-curated",
            "--database-url",
            TEST_DSN,
            "--party-map-path",
            str(party_map_path),
            "--crosswalk-path",
            str(crosswalk_path),
        ]
    )

    assert exit_code == 0
    reported = capsys.readouterr().out.splitlines()
    expected_loaded = [
        ("party_canonical", 1),
        ("list_identity", 1),
        ("party_mapping", 1),
        ("jurisdiction_crosswalk", 1),
        ("mesa_crosswalk", 1),
    ]
    assert len(reported) == len(expected_loaded)
    for line, (table_name, loaded) in zip(reported, expected_loaded, strict=True):
        prefix = f"{table_name}: operation=replacement loaded={loaded} deleted="
        assert line.startswith(prefix)
        deleted, separator, reason_count = line.removeprefix(prefix).partition(
            " deleted_by_reason=absent_from_desired_projection:"
        )
        assert separator
        assert deleted.isdigit()
        assert reason_count == deleted

    conn = psycopg.connect(TEST_DSN)
    try:
        with conn.cursor() as cur:
            cur.execute("select display_name from party_canonical where id = %s", (canonical_id,))
            party_row = cur.fetchone()

            cur.execute(
                "select source_name from list_identity where year = 2025 "
                "and jurisdiction = 'national' and category = 'DIPUTADO NACIONAL' "
                "and list_id = '900001'"
            )
            list_identity_row = cur.fetchone()

            cur.execute(
                "select canonical_party_id from party_mapping where year = 2025 "
                "and jurisdiction = 'national' and category = 'DIPUTADO NACIONAL' "
                "and list_id = '900001'"
            )
            party_mapping_row = cur.fetchone()

            cur.execute(
                "select name from jurisdiction_crosswalk where pba_distrito_code = %s",
                (pba_distrito,),
            )
            crosswalk_row = cur.fetchone()

            cur.execute(
                "select present_2023, present_2025, stable_across_years from mesa_crosswalk "
                "where distrito_code = %s and seccion_code = %s and mesa_code = 1",
                (stored_distrito, stored_seccion),
            )
            mesa_row = cur.fetchone()
    finally:
        with conn.cursor() as cur:
            cur.execute("delete from party_mapping where canonical_party_id = %s", (canonical_id,))
            cur.execute("delete from list_identity where list_id = '900001' and year = 2025")
            cur.execute("delete from party_canonical where id = %s", (canonical_id,))
            cur.execute(
                "delete from jurisdiction_crosswalk where pba_distrito_code = %s", (pba_distrito,)
            )
            cur.execute(
                "delete from mesa_crosswalk where distrito_code = %s and seccion_code = %s",
                (stored_distrito, stored_seccion),
            )
        conn.commit()
        conn.close()

    assert party_row == ("TEST CLI PARTY",)
    assert list_identity_row == ("TEST CLI PARTY",)
    assert party_mapping_row == (canonical_id,)
    assert crosswalk_row == ("Test Distrito",)
    # Same mesa fetched in both the 2023 and 2025 fixture files -> stable.
    assert mesa_row == (True, True, True)


def test_collect_mesa_tipo_mapping_collapses_source_rows_to_distinct_mesas() -> None:
    """`mesa_tipo` must be backfillable without re-parsing the whole corpus.

    The field was added late, so 16,5 million already-correct 2023 rows carry
    NULL. Re-ingesting to populate one column means re-parsing 13,6 million
    PASO rows — about 47 minutes, which this environment could not sustain
    across four attempts.

    But `mesa_tipo` is a property of the MESA, not of a result: mesa 9001 in
    distrito 02 / seccion 027 is EXTRANJEROS for every category and every
    list. So the distinct lineage->tipo mapping is a few hundred thousand
    tuples at most, and applying it is an UPDATE, not a reload.

    This test pins the pure part: extracting the distinct mapping from source
    rows, which is what makes the backfill cheap.
    """
    rows = [
        {
            "distrito_id": "02",
            "seccion_id": "027",
            "circuito_id": "00001",
            "mesa_id": "1",
            "mesa_tipo": "NATIVOS",
            "cargo_nombre": "A",
        },
        {
            "distrito_id": "2",
            "seccion_id": "27",
            "circuito_id": "00001",
            "mesa_id": "1",
            "mesa_tipo": "NATIVOS",
            "cargo_nombre": "B",
        },
        {
            "distrito_id": "02",
            "seccion_id": "027",
            "circuito_id": "00001",
            "mesa_id": "9001",
            "mesa_tipo": "EXTRANJEROS",
            "cargo_nombre": "A",
        },
        {
            "distrito_id": "02",
            "seccion_id": "027",
            "circuito_id": "00001",
            "mesa_id": "5",
            "cargo_nombre": "A",
        },
    ]

    mapping = collect_mesa_tipo_mapping(rows)

    # Codes are normalized to the curated, zero-padded canonical form
    # (Phase 17's single normalization boundary, `etl.jurisdiction`), so
    # `"02"`/`"027"` and `"2"`/`"27"` describe the same mesa rather than two.
    # Every code is normalized through `jurisdiction.py`'s boundary, circuito
    # included, so `2`/`27`/`1` and `02`/`027`/`00001` describe one mesa. A row
    # with no `mesa_tipo` contributes nothing and is counted, not dropped.
    # Values are SETS: a mesa's candidate tipos stay open until every archived
    # source has been read, because two files can disagree about one mesa and a
    # per-file collapse would hide it.
    assert mapping == {
        ("02", "027", "00001", 1): {"NATIVOS"},
        ("02", "027", "00001", 9001): {"EXTRANJEROS"},
    }, "four source rows must collapse to two distinct mesas"


@pytest.mark.parametrize("mesa_tipo", ["DESCONOCIDO", "nativos", " NATIVOS ", "\tEXTRANJEROS", " "])
def test_collect_mesa_tipo_mapping_refuses_unsupported_nonblank_values(
    mesa_tipo: str,
) -> None:
    rows = [
        {
            "distrito_id": "02",
            "seccion_id": "027",
            "circuito_id": "00001",
            "mesa_id": "12",
            "mesa_tipo": mesa_tipo,
        }
    ]

    with pytest.raises(NationalSchemaError) as excinfo:
        collect_mesa_tipo_mapping(rows, source_label="national/mesa-tipo-contract")

    message = str(excinfo.value)
    assert repr(mesa_tipo) in message
    assert "source row 0" in message
    assert "national/mesa-tipo-contract" in message


@pytest.mark.parametrize("mesa_tipo", ["NATIVOS", "EXTRANJEROS"])
def test_collect_mesa_tipo_mapping_accepts_exact_supported_values(mesa_tipo: str) -> None:
    rows = [
        {
            "distrito_id": "02",
            "seccion_id": "027",
            "circuito_id": "00001",
            "mesa_id": "12",
            "mesa_tipo": mesa_tipo,
        }
    ]

    assert collect_mesa_tipo_mapping(rows) == {("02", "027", "00001", 12): {mesa_tipo}}


def test_collect_mesa_tipo_mapping_keeps_alphanumeric_circuito() -> None:
    rows = [
        {
            "distrito_id": "02",
            "seccion_id": "027",
            "circuito_id": "249a",
            "mesa_id": "12",
            "mesa_tipo": "NATIVOS",
        }
    ]

    assert collect_mesa_tipo_mapping(rows) == {("02", "027", "0249A", 12): {"NATIVOS"}}


def test_collect_mesa_tipo_mapping_rejects_malformed_ids_without_aliasing_a_mesa(
    capsys,
) -> None:
    base = {
        "distrito_id": "02",
        "seccion_id": "027",
        "circuito_id": "00001",
        "mesa_tipo": "NATIVOS",
    }
    rows = [
        {**base, "mesa_id": "12"},
        {**base, "mesa_id": "1_2"},
        {**base, "mesa_id": "+12"},
        {**base, "mesa_id": "-1"},
        {**base, "mesa_id": ""},
    ]

    assert collect_mesa_tipo_mapping(rows, source_label="national/test") == {
        ("02", "027", "00001", 12): {"NATIVOS"}
    }
    assert capsys.readouterr().err == (
        "  national/test: 0 rows carried no mesa_tipo, 0 lacked a required column, "
        "1 had an absent mesa_id, 3 had an unreadable mesa_id, "
        "0 had an incomplete lineage, 0 carried a non-numeric code the "
        "normalizers cannot canonicalize\n"
        "  mesa_tipo exclusion diagnostics for national/test: locator_sample_cap=5 "
        "category_vocabulary_size=13\n"
        "    category='(unknown category)' reason=skipped_absent_mesa_id total=1 "
        "omitted_locators=0\n"
        "    locator source_label='national/test' data_row_index=4 "
        "category='(unknown category)' reason=skipped_absent_mesa_id "
        "missing_fields=['mesa_id']\n"
        "    category='(unknown category)' reason=skipped_bad_mesa_id total=3 "
        "omitted_locators=0\n"
        "    locator source_label='national/test' data_row_index=1 "
        "category='(unknown category)' reason=skipped_bad_mesa_id "
        "invalid_fields=['mesa_id']\n"
        "    locator source_label='national/test' data_row_index=2 "
        "category='(unknown category)' reason=skipped_bad_mesa_id "
        "invalid_fields=['mesa_id']\n"
        "    locator source_label='national/test' data_row_index=3 "
        "category='(unknown category)' reason=skipped_bad_mesa_id "
        "invalid_fields=['mesa_id']\n"
    )


def test_backfill_mesa_tipo_applies_the_mapping_through_the_real_update_path() -> None:
    """Applies the mapping to a real row and reads the value back.

    Asserting only that the join resolved proves the merge key works; it does
    not prove a single `result_row` was ever written. The UPDATE loop runs zero
    iterations when no row matches, so a test with no `result_row` passes
    whether the UPDATE works or not — the shape this file's own docstrings warn
    about.
    """
    _require_ephemeral_postgres()

    from etl.__main__ import apply_mesa_tipo_mapping
    from etl.db import upsert_category, upsert_election, upsert_jurisdiction

    # 8 hex chars, like the 15.9 test above: with 2 the space is 256 values and
    # a jurisdiction left by a crashed run collides. `X`-prefixed so it is NOT
    # numeric -- `upsert_jurisdiction` normalizes distrito through
    # `_zero_pad_numeric` while the mapping key below is used raw, so an
    # all-digit hex with a leading zero (~0.4% of runs) would be stored as
    # "1234567" and looked up as "01234567".
    marker = f"X{uuid.uuid4().hex[:8]}"
    archive_entry_id = f"test-mesa-tipo-{uuid.uuid4()}"
    with psycopg.connect(TEST_DSN) as conn:
        # Created through the WRITE BOUNDARY with unpadded codes, not raw SQL.
        # `upsert_jurisdiction` normalizes them, which is why the backfill's
        # padded merge key matches without compensating in SQL.
        mesa_jur = upsert_jurisdiction(conn, distrito=marker, seccion="27", circuito="1", mesa=4242)
        # A distrito-level row sharing the distrito. mesa_tipo is a property of
        # a MESA, so this must never bind a mesa lineage -- the scheme collision
        # that attributed 32.291 votes to a province.
        distrito_jur = upsert_jurisdiction(conn, distrito=marker, seccion="27")

        # Created, not assumed present. `select ... limit 1` on a freshly
        # migrated database returns `None` and fails as
        # `'NoneType' object is not subscriptable`, which describes nothing.
        election_id = upsert_election(conn, year=2025, round_="mesa-tipo-test")
        category_id = upsert_category(conn, name="MESA TIPO TEST")
        with conn.cursor() as cur:
            for jurisdiction_id in (mesa_jur, distrito_jur):
                cur.execute(
                    """
                    insert into result_row (election_id, jurisdiction_id, category_id,
                                            granularity, list_id, votes, source_kind,
                                            archive_entry_id, source_row_index)
                    values (%s,%s,%s,'mesa','TEST',1,'official',%s,0)
                    """,
                    (election_id, jurisdiction_id, category_id, archive_entry_id),
                )
        conn.commit()

        try:
            mapping = {(marker, "027", "00001", 4242): "EXTRANJEROS"}
            updated, resolved, _, unresolved = apply_mesa_tipo_mapping(conn, mapping, batch_size=10)

            with conn.cursor() as cur:
                cur.execute(
                    "select jurisdiction_id, mesa_tipo from result_row where archive_entry_id = %s",
                    (archive_entry_id,),
                )
                written = dict(cur.fetchall())
        finally:
            with conn.cursor() as cur:
                cur.execute(
                    "delete from result_row where archive_entry_id = %s", (archive_entry_id,)
                )
                cur.execute(
                    "delete from jurisdiction where id = any(%s)", ([mesa_jur, distrito_jur],)
                )
            conn.commit()

    assert resolved == 1, (
        "exactly the mesa-level jurisdiction must resolve, never the "
        f"distrito-level one; got {resolved}"
    )
    assert updated == 1, f"exactly one row must be written; got {updated}"
    assert written[mesa_jur] == "EXTRANJEROS", "the mesa row must carry the mapped tipo"
    assert unresolved == [], f"the mapped mesa must bind; unresolved: {unresolved}"
    assert written[distrito_jur] is None, (
        "the distrito-level row must stay NULL: a partido total is not a mesa"
    )


def test_backfill_mesa_tipo_updates_only_the_matching_enriched_circuit() -> None:
    _require_ephemeral_postgres()

    from etl.__main__ import apply_mesa_tipo_mapping
    from etl.db import upsert_category, upsert_election, upsert_jurisdiction

    marker = f"X{uuid.uuid4().hex[:8]}"
    archive_entry_id = f"test-enriched-mesa-tipo-{uuid.uuid4()}"
    with psycopg.connect(TEST_DSN) as conn:
        enriched_jur = upsert_jurisdiction(
            conn,
            distrito=marker,
            seccion="27",
            circuito="1",
            establecimiento="37974",
            mesa=4242,
        )
        sibling_jur = upsert_jurisdiction(
            conn,
            distrito=marker,
            seccion="27",
            circuito="999",
            establecimiento="99999",
            mesa=4242,
        )
        election_id = upsert_election(conn, year=2025, round_="enriched-mesa-tipo-test")
        category_id = upsert_category(conn, name="ENRICHED MESA TIPO TEST")
        with conn.cursor() as cur:
            for jurisdiction_id in (enriched_jur, sibling_jur):
                cur.execute(
                    """
                    insert into result_row (election_id, jurisdiction_id, category_id,
                                            granularity, list_id, votes, source_kind,
                                            archive_entry_id, source_row_index)
                    values (%s,%s,%s,'mesa','TEST',1,'official',%s,0)
                    """,
                    (election_id, jurisdiction_id, category_id, archive_entry_id),
                )
        conn.commit()

        try:
            mapping = {(marker, "027", "00001", 4242): "EXTRANJEROS"}
            updated, resolved, _, unresolved = apply_mesa_tipo_mapping(conn, mapping, batch_size=10)
            with conn.cursor() as cur:
                cur.execute(
                    "select jurisdiction_id, mesa_tipo from result_row where archive_entry_id = %s",
                    (archive_entry_id,),
                )
                written = dict(cur.fetchall())
        finally:
            with conn.cursor() as cur:
                cur.execute(
                    "delete from result_row where archive_entry_id = %s", (archive_entry_id,)
                )
                cur.execute(
                    "delete from jurisdiction where id = any(%s)", ([enriched_jur, sibling_jur],)
                )
            conn.commit()

    assert resolved == 1
    assert updated == 1
    assert unresolved == []
    assert written[enriched_jur] == "EXTRANJEROS"
    assert written[sibling_jur] is None, "the sibling circuit must not inherit this mesa's tipo"


def test_backfill_mesa_tipo_preserves_a_disagreement_across_sources() -> None:
    """One mesa cannot be both NATIVOS and EXTRANJEROS, and the disagreement
    must survive until every source has been read.

    Collapsing per file — or merging files with `dict.update` — is
    last-write-wins between the 2023 and 2025 sources: the very silent pick the
    accumulator exists to prevent. The caller raises once, over all sources.
    """
    shared: dict = {}
    collect_mesa_tipo_mapping(
        [
            {
                "distrito_id": "02",
                "seccion_id": "027",
                "circuito_id": "00001",
                "mesa_id": "1",
                "mesa_tipo": "NATIVOS",
            }
        ],
        source_label="national/2023-generales",
        into=shared,
    )
    collect_mesa_tipo_mapping(
        [
            {
                "distrito_id": "02",
                "seccion_id": "027",
                "circuito_id": "00001",
                "mesa_id": "1",
                "mesa_tipo": "EXTRANJEROS",
            }
        ],
        source_label="national/2025-legislativas",
        into=shared,
    )

    assert shared[("02", "027", "00001", 1)] == {"NATIVOS", "EXTRANJEROS"}, (
        "the second source must not overwrite the first; both candidates stay "
        "open for the caller's conflict check"
    )


def test_backfill_mesa_tipo_is_driven_through_main(tmp_path: Path, capsys) -> None:
    """Driven through `main()`, the real argv entry point.

    Importing `apply_mesa_tipo_mapping` proves the UPDATE works; it does not
    prove anyone can reach it. `backfill-mesa-tipo` could be dropped from
    `build_parser` and every other test here would still pass — the exact
    "correct, tested, unreachable" shape this project has hit repeatedly.

    Pointed at an empty source registry on purpose: the goal is to prove the
    subcommand is wired and reaches its own code, not to re-run a backfill over
    18 million rows.
    """
    empty_sources = tmp_path / "sources.yaml"
    empty_sources.write_text("national: []\n")

    exit_code = main(
        [
            "--sources-path",
            str(empty_sources),
            # Pointed at THIS test's empty tree. Omitting them made the command
            # read the repo's real `archive-manifest.json` and `archive/`, so
            # the outcome depended on what the developer had fetched.
            "--local-root",
            str(tmp_path / "archive"),
            "--manifest-path",
            str(tmp_path / "archive-manifest.json"),
            "backfill-mesa-tipo",
            "--database-url",
            TEST_DSN,
        ]
    )

    # The HANDLER's own refusal, by its message. `exit_code == 1` alone is
    # reached by five earlier paths — a missing DSN, an unregistered source, a
    # missing archive record, a file absent from the mirror, a schema error —
    # so it proves dispatch happened, not that this code ran.
    reported = capsys.readouterr().err
    assert "no mesa_tipo mapping found" in reported, (
        "an empty registry must reach the handler's own refusal, not an "
        f"argparse error or an earlier guard; got exit={exit_code} err={reported!r}"
    )
    assert exit_code == 1


def test_ingest_persists_the_review_items_the_LOADER_produced(tmp_path: Path) -> None:
    """The loader's quarantine must reach `review_item` through the real CLI.

    `load_fiscalizacion_rows` returned its drafts behind an opt-in flag the
    production path never passed, so a mesa whose circuito cannot be resolved
    dropped its whole tally with no record — 8 of the 93 mesas, on every real
    ingest. Only the two unit tests passed the flag: the "correct, tested,
    unreachable" shape this suite already caught once for `insert_review_items`
    itself.
    """
    _require_ephemeral_postgres()

    votes = ",".join(["1"] * len(FISCALIZACION_VOTE_COLUMNS))
    # Mesa 8888 exists in NO official jurisdiction, so the loader cannot place
    # it without inventing one.
    csv_text = _fiscalizacion_csv([f"ESCUELA TEST,Mesa 8888,{votes}\n"])

    source_id = f"fiscalizacion/cli-loader-quarantine-{uuid.uuid4()}"
    filename = "cli-loader-quarantine.csv"
    sources = {
        "fiscalizacion": [
            {
                "id": source_id,
                "source": "internal",
                "source_url": f"local://{source_id}.csv",
                "mime": "text/csv",
                "election_year": 2025,
                "election_round": "legislativas",
                "source_kind": "fiscalizacion",
                "notes": "CLI loader-quarantine fixture",
                "filename": filename,
                "upload": "never",
            }
        ]
    }
    manifest_path = tmp_path / "archive-manifest.json"
    local_root = tmp_path / "archive"
    LocalArchiveStore(root=local_root).write("fiscalizacion", filename, csv_text.encode("utf-8"))
    manifest_path.write_text(
        json.dumps(
            [
                {
                    "id": source_id,
                    "status": "ok",
                    "archived_path": f"archive/fiscalizacion/{filename}",
                    "sha256": hashlib.sha256(csv_text.encode("utf-8")).hexdigest(),
                    "fetched_at": "2026-01-01T00:00:00Z",
                }
            ]
        ),
        encoding="utf-8",
    )

    conn = psycopg.connect(TEST_DSN)
    try:
        ingest_source(
            source_id,
            database_url=TEST_DSN,
            year=2025,
            round_="legislativas",
            sources=sources,
            local_root=local_root,
            manifest_path=manifest_path,
        )
        with conn.cursor() as cur:
            cur.execute(
                "select kind, note from review_item where subject_ref = %s",
                (f"{source_id} 2025-legislativas 02-027-mesa-8888",),
            )
            written = cur.fetchall()
            cur.execute(
                """
                select count(*) from result_row r
                join jurisdiction j on j.id = r.jurisdiction_id
                where r.archive_entry_id = %s and j.mesa_code = 8888
                """,
                (source_id,),
            )
            placed_row = cur.fetchone()
            assert placed_row is not None
            placed = placed_row[0]
            # DELETED, not rolled back. `ingest_source` opens its OWN connection
            # and commits, so this connection only ever read — rolling it back
            # undoes nothing and the run's rows accumulate in the shared
            # database after every test. Every sibling here deletes its own.
            cur.execute(
                # `starts_with`, not `like`: `_` and `%` are LIKE wildcards and a
                # uuid-bearing source id carries `_`, so this could delete
                # ANOTHER test's rows from the shared database.
                "delete from review_item where starts_with(subject_ref, %s)",
                (f"{source_id} ",),
            )
            cur.execute("delete from result_row where archive_entry_id = %s", (source_id,))
        conn.commit()
    finally:
        conn.close()

    assert [kind for kind, _ in written] == ["mesa_absent_from_official_import"]
    assert "cannot be placed without inventing one" in written[0][1]
    assert placed == 0, "no row may be written under an invented jurisdiction"


def test_a_mesa_number_in_two_circuitos_is_not_reported_as_schema_drift() -> None:
    """The same ambiguity the loader refuses, in the VALIDATION path.

    `official_mesa_votes_from_national` keyed tallies on the mesa number inside
    `(distrito, seccion)`, and within one partido that number appears under
    more than one circuito. Two physically different mesas merged: equal
    tallies summed silently, and differing ones surfaced as
    `NationalSchemaError` — `validate-fiscalizacion` exiting 1 reporting schema
    drift on data that is perfectly well-formed.
    """
    from etl.__main__ import official_mesa_votes_from_national

    header = (
        "distrito_id,seccion_id,circuito_id,mesa_id,cargo_nombre,votos_tipo,"
        "votos_cantidad,agrupacion_nombre\n"
    )
    csv_text = header + "".join(
        [
            # ONE mesa number, two circuitos, two different tallies.
            "02,027,00248C,142,DIPUTADO NACIONAL,POSITIVO,10,ALIANZA LA LIBERTAD AVANZA\n",
            "02,027,00248D,142,DIPUTADO NACIONAL,POSITIVO,40,ALIANZA LA LIBERTAD AVANZA\n",
            # An unambiguous mesa, to prove the scope still produces figures.
            "02,027,00248A,143,DIPUTADO NACIONAL,POSITIVO,7,ALIANZA LA LIBERTAD AVANZA\n",
        ]
    )

    projection = official_mesa_votes_from_national(
        csv_text.encode("utf-8"),
        distrito="02",
        seccion="027",
        category="DIPUTADO NACIONAL",
        source_id="national/2025-ambiguous-fixture",
        election_year=2025,
        election_round="legislativas",
    )
    tallies = projection.tallies
    skipped = projection.skipped

    assert 142 not in tallies, "an ambiguous mesa number cannot carry a tally"
    assert tallies[143].votes_by_agrupacion_name == {"ALIANZA LA LIBERTAD AVANZA": 7}
    assert any("more than one circuito" in reason for reason in skipped), (
        "the drop must be reported per reason, not silently absent"
    )
    assert len(projection.review_items) == 1
    review = projection.review_items[0]
    assert review.kind == "ambiguous_official_mesa_identity"
    assert review.severity == "warning"
    assert "national/2025-ambiguous-fixture" in review.subject_ref
    assert "2025-legislativas" in review.subject_ref
    assert "02/027" in review.subject_ref
    assert "mesa-142" in review.subject_ref
    assert review.note is not None
    assert "circuitos 00248C, 00248D" in review.note
    assert "2 official row(s)" in review.note
    assert "ALIANZA LA LIBERTAD AVANZA=10" in review.note
    assert "ALIANZA LA LIBERTAD AVANZA=40" in review.note
    # ROWS, and only the ones that contributed a tally. Counting mesas
    # under-reported the largest exclusion by an order of magnitude; counting
    # every row that reached the loop double-counted the ones already skipped
    # as outside the comparison vector, so the totals exceeded the rows read.
    ambiguous_rows = next(
        count for reason, count in skipped.items() if "more than one circuito" in reason
    )
    assert ambiguous_rows == 2, "mesa 142 contributed two tally rows, not one and not three"
    assert sum(skipped.values()) <= 3, "the per-reason totals cannot exceed the rows read"


def test_the_same_circuito_written_two_ways_is_not_a_fabricated_ambiguity() -> None:
    """The ambiguity check compared circuito codes RAW.

    `"248"` and `"00248"` are one circuito written two ways -- which is why
    `normalize_circuito_code` exists, and why the distrito and seccion
    comparisons beside it already normalize. Compared raw they counted as two,
    so the mesa was declared ambiguous, its tallies dropped, and its rows
    reported under "the mesa number appears under more than one circuito": a
    fabricated ambiguity verdict on well-formed data, the same class of defect
    as the padding bug that produced Coronel Rosales as three identities.
    """
    from etl.__main__ import official_mesa_votes_from_national

    header = (
        "distrito_id,seccion_id,circuito_id,mesa_id,cargo_nombre,votos_tipo,"
        "votos_cantidad,agrupacion_nombre\n"
    )
    csv_text = header + "".join(
        [
            # ONE circuito, written both ways, reporting the SAME tally --
            # which is what a re-export with different padding looks like.
            # Two DIFFERENT tallies under one circuito would be genuine drift,
            # and the collapse still refuses to pick between those.
            "02,027,248,144,DIPUTADO NACIONAL,POSITIVO,10,ALIANZA LA LIBERTAD AVANZA\n",
            "02,027,00248,144,DIPUTADO NACIONAL,POSITIVO,10,ALIANZA LA LIBERTAD AVANZA\n",
        ]
    )

    projection = official_mesa_votes_from_national(
        csv_text.encode("utf-8"),
        distrito="02",
        seccion="027",
        category="DIPUTADO NACIONAL",
        source_id="national/2025-official-fixture",
        election_year=2025,
        election_round="legislativas",
    )
    tallies = projection.tallies
    skipped = projection.skipped

    assert tallies[144].votes_by_agrupacion_name == {"ALIANZA LA LIBERTAD AVANZA": 10}
    assert not any("more than one circuito" in reason for reason in skipped)


def test_official_comparison_keeps_canonical_alphanumeric_circuito() -> None:
    from etl.__main__ import official_mesa_votes_from_national

    csv_text = (
        "distrito_id,seccion_id,circuito_id,mesa_id,cargo_nombre,votos_tipo,"
        "votos_cantidad,agrupacion_nombre\n"
        "02,027,249a,145,DIPUTADO NACIONAL,POSITIVO,10,ALIANZA LA LIBERTAD AVANZA\n"
        "02,027,0249A,145,DIPUTADO NACIONAL,EN BLANCO,2,\n"
    )

    projection = official_mesa_votes_from_national(
        csv_text.encode(),
        distrito="02",
        seccion="027",
        category="DIPUTADO NACIONAL",
        source_id="national/2025-official-fixture",
        election_year=2025,
        election_round="legislativas",
    )
    tallies = projection.tallies
    skipped = projection.skipped

    assert tallies[145].votes_by_agrupacion_name == {"ALIANZA LA LIBERTAD AVANZA": 10}
    assert tallies[145].votos_tipo_totals == {"EN BLANCO": 2}
    assert not any("more than one circuito" in reason for reason in skipped)


def test_a_withheld_ambiguous_mesa_is_named_with_its_circuitos(capsys) -> None:
    """The exclusion was counted and never identified. Every sibling report in
    this file names its mesas; a count with no identifiers is visible and not
    actionable -- nobody can go check the circuitos against the source.
    """
    from etl.__main__ import official_mesa_votes_from_national

    header = (
        "distrito_id,seccion_id,circuito_id,mesa_id,cargo_nombre,votos_tipo,"
        "votos_cantidad,agrupacion_nombre\n"
    )
    csv_text = header + "".join(
        [
            "02,027,00248,146,DIPUTADO NACIONAL,POSITIVO,10,ALIANZA LA LIBERTAD AVANZA\n",
            "02,027,00249,146,DIPUTADO NACIONAL,POSITIVO,40,ALIANZA LA LIBERTAD AVANZA\n",
        ]
    )

    official_mesa_votes_from_national(
        csv_text.encode("utf-8"),
        distrito="02",
        seccion="027",
        category="DIPUTADO NACIONAL",
        source_id="national/2025-official-fixture",
        election_year=2025,
        election_round="legislativas",
    )

    report = capsys.readouterr().err
    assert "mesa 146 in circuitos 00248, 00249" in report


@pytest.mark.parametrize("official_name", ["ALIANZA LIBERTAD AVANZA", "", "   "])
def test_official_comparison_refuses_unknown_or_blank_positive_party_names(
    official_name: str,
) -> None:
    from etl.__main__ import official_mesa_votes_from_national

    csv_text = (
        "distrito_id,seccion_id,circuito_id,mesa_id,cargo_nombre,votos_tipo,"
        "votos_cantidad,agrupacion_nombre\n"
        f"02,027,00248,147,DIPUTADO NACIONAL,POSITIVO,10,{official_name}\n"
    )

    with pytest.raises(NationalSchemaError) as excinfo:
        official_mesa_votes_from_national(
            csv_text.encode("utf-8"),
            distrito="02",
            seccion="027",
            category="DIPUTADO NACIONAL",
            source_id="national/2025-official-fixture",
            election_year=2025,
            election_round="legislativas",
        )

    message = str(excinfo.value)
    assert "mesa 147" in message
    assert repr(official_name) in message
    assert "official party name" in message


def test_a_missing_circuito_cell_refuses_the_official_comparison() -> None:
    """A compared tally without circuito identity cannot be attributed safely."""
    from etl.__main__ import official_mesa_votes_from_national

    header = (
        "distrito_id,seccion_id,circuito_id,mesa_id,cargo_nombre,votos_tipo,"
        "votos_cantidad,agrupacion_nombre\n"
    )
    csv_text = header + "".join(
        [
            "02,027,00248,147,DIPUTADO NACIONAL,POSITIVO,10,ALIANZA LA LIBERTAD AVANZA\n",
            "02,027,,147,DIPUTADO NACIONAL,EN BLANCO,2,\n",
        ]
    )

    with pytest.raises(NationalSchemaError) as excinfo:
        official_mesa_votes_from_national(
            csv_text.encode("utf-8"),
            distrito="02",
            seccion="027",
            category="DIPUTADO NACIONAL",
            source_id="national/2025-official-fixture",
            election_year=2025,
            election_round="legislativas",
        )

    message = str(excinfo.value)
    assert "mesa 147" in message
    assert "circuito_id" in message


def test_official_comparison_requires_the_circuito_column() -> None:
    from etl.__main__ import official_mesa_votes_from_national

    csv_text = (
        "distrito_id,seccion_id,mesa_id,cargo_nombre,votos_tipo,"
        "votos_cantidad,agrupacion_nombre\n"
        "02,027,147,DIPUTADO NACIONAL,POSITIVO,10,ALIANZA LA LIBERTAD AVANZA\n"
    )

    with pytest.raises(NationalSchemaError, match="circuito_id"):
        official_mesa_votes_from_national(
            csv_text.encode("utf-8"),
            distrito="02",
            seccion="027",
            category="DIPUTADO NACIONAL",
            source_id="national/2025-official-fixture",
            election_year=2025,
            election_round="legislativas",
        )


@pytest.mark.parametrize("circuito", ["   ", "2_7"])
def test_official_comparison_refuses_an_unreadable_circuito_before_adding_tally(
    circuito: str,
) -> None:
    from etl.__main__ import official_mesa_votes_from_national

    csv_text = (
        "distrito_id,seccion_id,circuito_id,mesa_id,cargo_nombre,votos_tipo,"
        "votos_cantidad,agrupacion_nombre\n"
        f"02,027,{circuito},148,DIPUTADO NACIONAL,POSITIVO,10,ALIANZA LA LIBERTAD AVANZA\n"
    )

    with pytest.raises(NationalSchemaError) as excinfo:
        official_mesa_votes_from_national(
            csv_text.encode("utf-8"),
            distrito="02",
            seccion="027",
            category="DIPUTADO NACIONAL",
            source_id="national/2025-official-fixture",
            election_year=2025,
            election_round="legislativas",
        )

    message = str(excinfo.value)
    assert "mesa 148" in message
    assert "circuito_id" in message


def test_validate_fiscalizacion_refuses_a_circuito_blind_baseline_before_review_writes(
    tmp_path: Path, capsys, monkeypatch: pytest.MonkeyPatch
) -> None:
    import etl.__main__ as cli

    fixtures = Path(__file__).parent / "fixtures"
    fiscalizacion_bytes = (fixtures / "fiscalizacion_2025_stripped_sample.csv").read_bytes()
    national_rows = list(
        csv.reader(
            io.StringIO(
                (fixtures / "national_2025_027_diputados_sample.csv").read_text(encoding="utf-8")
            )
        )
    )
    circuito_index = national_rows[0].index("circuito_id")
    for row in national_rows:
        row.pop(circuito_index)
    rendered = io.StringIO(newline="")
    csv.writer(rendered).writerows(national_rows)
    national_bytes = rendered.getvalue().encode("utf-8")

    fiscalizacion_id = f"fiscalizacion/missing-circuito-{uuid.uuid4()}"
    national_id = f"national/2025-missing-circuito-{uuid.uuid4()}"
    local_root = tmp_path / "archive"
    store = LocalArchiveStore(root=local_root)
    store.write("fiscalizacion", "fisc.csv", fiscalizacion_bytes)
    store.write("national", "nat.csv", national_bytes)
    sources_path = tmp_path / "sources.yaml"
    sources_path.write_text(
        yaml.safe_dump(
            {
                "fiscalizacion": [
                    {
                        "id": fiscalizacion_id,
                        "source": "internal",
                        "mime": "text/csv",
                        "notes": "canonical source fixture",
                        "source_url": "local://fiscalizacion/fixture.csv",
                        "election_year": 2025,
                        "election_round": "legislativas",
                        "filename": "fisc.csv",
                        "source_kind": "fiscalizacion",
                        "upload": "never",
                    }
                ],
                "national": [
                    {
                        "id": national_id,
                        "source": "example.test",
                        "mime": "text/csv",
                        "notes": "canonical source fixture",
                        "source_url": "https://example.test/nat.csv",
                        "election_year": 2025,
                        "election_round": "legislativas",
                        "filename": "nat.csv",
                    }
                ],
            }
        ),
        encoding="utf-8",
    )
    manifest_path = tmp_path / "archive-manifest.json"
    manifest_path.write_text(
        json.dumps(
            [
                {
                    "id": fiscalizacion_id,
                    "status": "ok",
                    "archived_path": "archive/fiscalizacion/fisc.csv",
                    "sha256": hashlib.sha256(fiscalizacion_bytes).hexdigest(),
                },
                {
                    "id": national_id,
                    "status": "ok",
                    "archived_path": "archive/national/nat.csv",
                    "sha256": hashlib.sha256(national_bytes).hexdigest(),
                },
            ]
        ),
        encoding="utf-8",
    )

    def forbidden_write(*_args, **_kwargs):
        raise AssertionError("schema refusal must happen before any review item write")

    monkeypatch.setattr(cli.psycopg, "connect", forbidden_write)
    monkeypatch.setattr(cli, "insert_review_items", forbidden_write)

    exit_code = main(
        _main_args(sources_path, local_root, manifest_path)
        + [
            "validate-fiscalizacion",
            "--source",
            fiscalizacion_id,
            "--baseline",
            national_id,
            "--database-url",
            "postgresql://must-not-connect/nowhere",
        ]
    )

    assert exit_code == 1
    reported = capsys.readouterr().err
    assert "circuito_id" in reported
    assert "error:" in reported


@pytest.mark.parametrize(
    ("baseline_defect", "expected_report"),
    [
        ("renamed party", "ALIANZA LIBERTAD AVANZA"),
        ("missing party tally", "LIBER.AR"),
    ],
)
def test_validate_fiscalizacion_refuses_an_invalid_official_vector_before_any_write(
    tmp_path: Path,
    capsys,
    monkeypatch: pytest.MonkeyPatch,
    baseline_defect: str,
    expected_report: str,
) -> None:
    import etl.__main__ as cli

    fixtures = Path(__file__).parent / "fixtures"
    fiscalizacion_bytes = (fixtures / "fiscalizacion_2025_stripped_sample.csv").read_bytes()
    national_text = (fixtures / "national_2025_027_diputados_sample.csv").read_text(
        encoding="utf-8"
    )
    if baseline_defect == "renamed party":
        national_text = national_text.replace(
            "ALIANZA LA LIBERTAD AVANZA", "ALIANZA LIBERTAD AVANZA", 1
        )
    else:
        lines = national_text.splitlines(keepends=True)
        national_text = "".join(
            line for line in lines if not (",1,NATIVOS," in line and ",LIBER.AR," in line)
        )
    national_bytes = national_text.encode("utf-8")

    fiscalizacion_id = f"fiscalizacion/invalid-vector-{uuid.uuid4()}"
    national_id = f"national/2025-invalid-vector-{uuid.uuid4()}"
    local_root = tmp_path / "archive"
    store = LocalArchiveStore(root=local_root)
    store.write("fiscalizacion", "fisc.csv", fiscalizacion_bytes)
    store.write("national", "nat.csv", national_bytes)
    sources_path = tmp_path / "sources.yaml"
    sources_path.write_text(
        yaml.safe_dump(
            {
                "fiscalizacion": [
                    {
                        "id": fiscalizacion_id,
                        "source": "internal",
                        "mime": "text/csv",
                        "notes": "canonical source fixture",
                        "source_url": "local://fiscalizacion/fixture.csv",
                        "election_year": 2025,
                        "election_round": "legislativas",
                        "filename": "fisc.csv",
                        "source_kind": "fiscalizacion",
                        "upload": "never",
                    }
                ],
                "national": [
                    {
                        "id": national_id,
                        "source": "example.test",
                        "mime": "text/csv",
                        "notes": "canonical source fixture",
                        "source_url": "https://example.test/nat.csv",
                        "election_year": 2025,
                        "election_round": "legislativas",
                        "filename": "nat.csv",
                    }
                ],
            }
        ),
        encoding="utf-8",
    )
    manifest_path = tmp_path / "archive-manifest.json"
    manifest_path.write_text(
        json.dumps(
            [
                {
                    "id": fiscalizacion_id,
                    "status": "ok",
                    "archived_path": "archive/fiscalizacion/fisc.csv",
                    "sha256": hashlib.sha256(fiscalizacion_bytes).hexdigest(),
                },
                {
                    "id": national_id,
                    "status": "ok",
                    "archived_path": "archive/national/nat.csv",
                    "sha256": hashlib.sha256(national_bytes).hexdigest(),
                },
            ]
        ),
        encoding="utf-8",
    )

    def forbidden_write(*_args, **_kwargs):
        raise AssertionError("party-name refusal must happen before database/review writes")

    monkeypatch.setattr(cli.psycopg, "connect", forbidden_write)
    monkeypatch.setattr(cli, "insert_review_items", forbidden_write)

    exit_code = main(
        _main_args(sources_path, local_root, manifest_path)
        + [
            "validate-fiscalizacion",
            "--source",
            fiscalizacion_id,
            "--baseline",
            national_id,
            "--database-url",
            "postgresql://must-not-connect/nowhere",
        ]
    )

    reported = capsys.readouterr().err
    assert exit_code == 1
    assert expected_report in reported
    assert "error:" in reported
    assert "Traceback" not in reported


def test_a_non_comparable_row_cannot_declare_a_mesa_ambiguous() -> None:
    """The circuito set was built from every row that passed the
    distrito/seccion/category filter -- including the NULO and RECURRIDO rows
    skipped moments later as "not in the comparison vector".

    So a mesa whose comparable rows all sit in ONE circuito had its tallies
    dropped because a non-comparable row carried a different one: a fabricated
    ambiguity verdict on well-formed data, which is precisely the outcome this
    check exists to prevent.
    """
    from etl.__main__ import official_mesa_votes_from_national

    header = (
        "distrito_id,seccion_id,circuito_id,mesa_id,cargo_nombre,votos_tipo,"
        "votos_cantidad,agrupacion_nombre\n"
    )
    csv_text = header + "".join(
        [
            "02,027,00248,145,DIPUTADO NACIONAL,POSITIVO,10,ALIANZA LA LIBERTAD AVANZA\n",
            "02,027,00248,145,DIPUTADO NACIONAL,EN BLANCO,2,\n",
            # A DIFFERENT circuito, on a row that contributes no tally.
            "02,027,00249,145,DIPUTADO NACIONAL,RECURRIDO,1,\n",
        ]
    )

    projection = official_mesa_votes_from_national(
        csv_text.encode("utf-8"),
        distrito="02",
        seccion="027",
        category="DIPUTADO NACIONAL",
        source_id="national/2025-official-fixture",
        election_year=2025,
        election_round="legislativas",
    )
    tallies = projection.tallies
    skipped = projection.skipped

    assert tallies[145].votes_by_agrupacion_name == {"ALIANZA LA LIBERTAD AVANZA": 10}
    assert not any("more than one circuito" in reason for reason in skipped)


def test_a_pba_fetch_goes_through_the_etiquette_layer(tmp_path: Path) -> None:
    """D10's etiquette must run for a real PBA fetch.

    `archive_pba_source` was implemented and tested with NO production caller,
    so `cmd_fetch` hit the host directly every time: no archive-first cache, no
    bounded backoff around the policed fetcher. The capability existed and the
    behaviour did not.

    `source` in `sources.yaml` is a HOST LABEL (`www.juntaelectoral.gba.gov.ar`);
    the family is the top-level key, which `find_source_entry` attaches as
    `capability`. Keying the branch on `source` would never have fired.
    """
    from etl.__main__ import fetch_source
    from etl.http_client import UnregisteredPathError
    from etl.ingest.pba import PBA_HOST_POLICY

    source_id = "pba/etiquette-check"
    sources = {
        "pba": [
            {
                "id": source_id,
                "source": "www.juntaelectoral.gba.gov.ar",
                "source_url": "https://www.juntaelectoral.gba.gov.ar/escrutinio-definitivo-2025/concejales_distri/2025027.pdf",
                "mime": "text/html",
                "notes": "etiquette fixture",
            }
        ]
    }
    manifest_path = tmp_path / "archive-manifest.json"
    manifest_path.write_text("[]", encoding="utf-8")

    calls: list[str] = []
    seen_headers: list[dict] = []

    class _RecordingFetcher:
        def get(self, url: str, *, timeout: float = 30.0, headers=None):
            calls.append(url)
            seen_headers.append(dict(headers or {}))
            from etl.http_client import FetchResponse

            status = 404 if url.endswith("/robots.txt") else 200
            return FetchResponse(status_code=status, headers={}, content=b"<html></html>")

    fetch_source(
        source_id,
        sources=sources,
        fetcher=_RecordingFetcher(),
        local_root=tmp_path / "archive",
        manifest_path=manifest_path,
    )
    assert calls == [
        "https://www.juntaelectoral.gba.gov.ar/robots.txt",
        sources["pba"][0]["source_url"],
    ]

    # SECOND call: source bytes are served from the archive, but the robots guard
    # still runs on every invocation before that cache return.
    fetch_source(
        source_id,
        sources=sources,
        fetcher=_RecordingFetcher(),
        local_root=tmp_path / "archive",
        manifest_path=manifest_path,
    )
    assert calls == [
        "https://www.juntaelectoral.gba.gov.ar/robots.txt",
        sources["pba"][0]["source_url"],
        "https://www.juntaelectoral.gba.gov.ar/robots.txt",
    ], "the cached invocation must re-check robots without re-fetching source bytes"

    # THE ETIQUETTE LAYER ITSELF, which this test's name promises and which
    # nothing here asserted: with only the cache pinned, deleting the
    # `PolicedHostFetcher`/`PBA_HOST_POLICY` wrapping in `fetch_source` and
    # passing the bare fetcher left the test green.
    #
    # The policy's User-Agent reached the host (D10 constraint 4)...
    assert seen_headers[1].get("User-Agent") == PBA_HOST_POLICY.user_agent

    # ...and a path outside the registered allowlist is REFUSED rather than
    # fetched (D10 constraint 7): a prefix would let the whole subtree be
    # crawled, which is exactly what the constraint forbids.
    off_allowlist = dict(sources["pba"][0])
    off_allowlist["id"] = "pba/off-allowlist"
    off_allowlist["source_url"] = (
        "https://www.juntaelectoral.gba.gov.ar/escrutinio-definitivo-2025/otro.html"
    )
    fetch_source(
        "pba/off-allowlist",
        sources={"pba": [off_allowlist]},
        fetcher=_RecordingFetcher(),
        local_root=tmp_path / "archive",
        manifest_path=manifest_path,
    )

    # The HOST WAS NEVER TOUCHED -- the refusal happens above the network --
    # and `archive_source` records it as a failed fetch rather than raising,
    # so the manifest carries WHY instead of the run dying with a traceback.
    assert calls[-1] == "https://www.juntaelectoral.gba.gov.ar/robots.txt"
    assert len(calls) == 4, "an unregistered source path must not reach the host"
    written = load_manifest(manifest_path)
    refused = [r for r in written if r["id"] == "pba/off-allowlist"]
    assert refused and refused[0]["status"] != "ok"
    assert isinstance(notes := refused[0]["notes"], str)
    assert UnregisteredPathError.__name__ in notes or "allowlist" in notes


def test_pba_fetch_rejects_missing_policed_fetcher_before_archive_or_manifest_mutation(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    import etl.http_client as http_client
    import etl.ingest.pba as pba

    source_id = "pba/missing-policed-fetcher"
    source_url = f"https://{pba.PBA_HOST_POLICY.host}{pba.PBA_ALLOWED_PATHS[0]}"
    sources = {
        "pba": [
            {
                "id": source_id,
                "source": pba.PBA_HOST_POLICY.host,
                "source_url": source_url,
                "mime": "text/html",
                "notes": "policed fetcher invariant fixture",
                "filename": "missing-policed-fetcher.html",
                "election_year": 2025,
                "election_round": "provinciales",
            }
        ]
    }
    manifest_path = tmp_path / "archive-manifest.json"
    original_manifest = b"[]"
    manifest_path.write_bytes(original_manifest)
    local_root = tmp_path / "archive"
    transport_calls: list[str] = []

    class _RobotsAbsentFetcher:
        def get(self, url: str, *, timeout: float = 30.0, headers=None):
            transport_calls.append(url)
            return FetchResponse(status_code=404, headers={}, content=b"")

    transport = _RobotsAbsentFetcher()
    constructor_calls: list[tuple[object, object]] = []

    def missing_policed_fetcher(fetcher: object, policy: object) -> None:
        constructor_calls.append((fetcher, policy))

    archive_calls: list[tuple[tuple[object, ...], dict[str, object]]] = []

    def record_archive_call(*args: object, **kwargs: object) -> None:
        archive_calls.append((args, kwargs))
        raise AssertionError("archive_pba_source must not receive a missing policed fetcher")

    monkeypatch.setattr(http_client, "PolicedHostFetcher", missing_policed_fetcher)
    monkeypatch.setattr(pba, "archive_pba_source", record_archive_call)

    with pytest.raises(RuntimeError, match="^PBA fetcher initialization failed$"):
        fetch_source(
            source_id,
            sources=sources,
            fetcher=transport,
            local_root=local_root,
            manifest_path=manifest_path,
        )

    assert constructor_calls == [(transport, pba.PBA_HOST_POLICY)]
    assert transport_calls == [f"https://{pba.PBA_HOST_POLICY.host}/robots.txt"]
    assert archive_calls == []
    assert manifest_path.read_bytes() == original_manifest
    assert not local_root.exists()


def test_pba_fetch_halts_before_source_or_archive_mutation_when_robots_appears(
    tmp_path: Path,
) -> None:
    from etl.http_client import FetchResponse, RobotsTxtAppearedError
    from etl.ingest.pba import PBA_HOST_POLICY

    source_id = "pba/robots-appeared"
    source_url = (
        "https://www.juntaelectoral.gba.gov.ar/escrutinio-definitivo-2025/"
        "concejales_distri/2025027.pdf"
    )
    sources = {
        "pba": [
            {
                "id": source_id,
                "source": PBA_HOST_POLICY.host,
                "source_url": source_url,
                "mime": "application/pdf",
                "notes": "robots refusal fixture",
            }
        ]
    }
    manifest_path = tmp_path / "archive-manifest.json"
    original_manifest = "[]"
    manifest_path.write_text(original_manifest, encoding="utf-8")
    calls: list[str] = []

    class _RobotsPresentFetcher:
        def get(self, url: str, *, timeout: float = 30.0, headers=None):
            calls.append(url)
            if not url.endswith("/robots.txt"):
                raise AssertionError("source request must not occur after robots returns 200")
            return FetchResponse(status_code=200, headers={}, content=b"User-agent: *")

    with pytest.raises(RobotsTxtAppearedError, match="halting"):
        fetch_source(
            source_id,
            sources=sources,
            fetcher=_RobotsPresentFetcher(),
            local_root=tmp_path / "archive",
            manifest_path=manifest_path,
        )

    assert calls == [f"https://{PBA_HOST_POLICY.host}/robots.txt"]
    assert manifest_path.read_text(encoding="utf-8") == original_manifest
    assert not (tmp_path / "archive").exists()


def test_pba_robots_appearance_exits_fetch_command_cleanly(
    tmp_path: Path, capsys, monkeypatch: pytest.MonkeyPatch
) -> None:
    from etl.http_client import FetchResponse
    from etl.ingest.pba import PBA_HOST_POLICY

    source_id = "pba/robots-cli"
    sources_path = tmp_path / "sources.yaml"
    sources_path.write_text(
        yaml.safe_dump(
            {
                "pba": [
                    {
                        "id": source_id,
                        "source": PBA_HOST_POLICY.host,
                        "source_url": (
                            "https://www.juntaelectoral.gba.gov.ar/"
                            "escrutinio-definitivo-2025/concejales_distri/2025027.pdf"
                        ),
                        "election_year": 2025,
                        "election_round": "provinciales",
                        "mime": "application/pdf",
                        "notes": "robots CLI refusal fixture",
                    }
                ]
            }
        ),
        encoding="utf-8",
    )
    manifest_path = tmp_path / "archive-manifest.json"
    manifest_path.write_text("[]", encoding="utf-8")

    class _RobotsPresentFetcher:
        def get(self, url: str, *, timeout: float = 30.0, headers=None):
            assert url.endswith("/robots.txt")
            return FetchResponse(status_code=200, headers={}, content=b"User-agent: *")

    monkeypatch.setattr("etl.__main__.RequestsFetcher", _RobotsPresentFetcher)

    exit_code = main(
        _main_args(sources_path, tmp_path / "archive", manifest_path)
        + ["fetch", "--source", source_id]
    )

    assert exit_code == 1
    assert "robots.txt now returns 200" in capsys.readouterr().err
    assert manifest_path.read_text(encoding="utf-8") == "[]"
    assert not (tmp_path / "archive").exists()


@pytest.mark.parametrize(
    ("content", "expected"),
    [
        ("- national/2025\n", "top level"),
        ("national:\n", "national"),
        ("national:\n  - not-a-mapping\n", "entry 0"),
    ],
)
def test_malformed_sources_shapes_exit_cleanly_through_main(
    tmp_path: Path, capsys, content: str, expected: str
) -> None:
    sources_path = tmp_path / "sources.yaml"
    sources_path.write_text(content, encoding="utf-8")
    manifest_path = tmp_path / "archive-manifest.json"
    manifest_path.write_text("[]", encoding="utf-8")

    exit_code = main(
        _main_args(sources_path, tmp_path / "archive", manifest_path) + ["validate-crosswalk"]
    )

    assert exit_code == 1
    reported = capsys.readouterr().err
    assert "error:" in reported
    assert expected in reported
    assert "TypeError" not in reported
    assert "Traceback" not in reported


def test_source_entry_missing_id_exits_cleanly_through_main(tmp_path: Path, capsys) -> None:
    sources_path = tmp_path / "sources.yaml"
    sources_path.write_text(
        yaml.safe_dump({"national": [{"source": "example.test"}]}), encoding="utf-8"
    )
    manifest_path = tmp_path / "archive-manifest.json"
    manifest_path.write_text("[]", encoding="utf-8")

    exit_code = main(
        _main_args(sources_path, tmp_path / "archive", manifest_path) + ["validate-crosswalk"]
    )

    assert exit_code == 1
    reported = capsys.readouterr().err
    assert "error:" in reported
    assert "id" in reported
    assert "KeyError" not in reported
    assert "Traceback" not in reported


def test_a_malformed_sources_file_exits_nonzero_instead_of_a_traceback(
    tmp_path: Path, capsys
) -> None:
    """`sources.yaml` is hand-maintained, and every subcommand parsed it
    OUTSIDE any handler -- so the file most likely to drift was the one least
    likely to produce an exit code, while the crosswalk parse one line later
    exited 1 with a message.

    Eight `except` tuples each listed a different subset of the same
    failures; the contract now lives in one place, at the one boundary every
    subcommand passes through.
    """
    sources_path = tmp_path / "sources.yaml"
    sources_path.write_text("national: [unclosed\n", encoding="utf-8")
    manifest_path = tmp_path / "archive-manifest.json"
    manifest_path.write_text("[]", encoding="utf-8")

    exit_code = main(
        _main_args(sources_path, tmp_path / "archive", manifest_path) + ["validate-crosswalk"]
    )

    assert exit_code == 1
    assert "error:" in capsys.readouterr().err


@pytest.mark.parametrize("manifest", ["{}", '["not-a-record"]'])
def test_malformed_manifest_shapes_exit_cleanly_through_main(
    tmp_path: Path, capsys, manifest: str
) -> None:
    sources_path = tmp_path / "sources.yaml"
    sources_path.write_text("national: []\n", encoding="utf-8")
    manifest_path = tmp_path / "archive-manifest.json"
    manifest_path.write_text(manifest, encoding="utf-8")

    exit_code = main(
        _main_args(sources_path, tmp_path / "archive", manifest_path) + ["validate-crosswalk"]
    )

    assert exit_code == 1
    reported = capsys.readouterr().err
    assert "manifest" in reported
    assert "TypeError" not in reported
    assert "Traceback" not in reported


def test_a_manifest_record_missing_status_exits_nonzero(tmp_path: Path, capsys) -> None:
    """`load_manifest` refuses a record missing the fields its readers
    dereference. That refusal reached the operator as a traceback from four
    commands and as exit 1 from the others -- the same defect, half-closed.
    """
    sources_path = tmp_path / "sources.yaml"
    sources_path.write_text(
        yaml.safe_dump(
            {
                "national": [
                    {
                        "id": "national/2025",
                        "source": "x",
                        "mime": "text/csv",
                        "notes": "canonical source fixture",
                        "source_url": "https://example.test/2025.csv",
                        "election_year": 2025,
                        "election_round": "legislativas",
                    }
                ]
            }
        ),
        encoding="utf-8",
    )
    manifest_path = tmp_path / "archive-manifest.json"
    manifest_path.write_text('[{"id": "national/2025"}]', encoding="utf-8")

    exit_code = main(
        _main_args(sources_path, tmp_path / "archive", manifest_path) + ["validate-crosswalk"]
    )

    assert exit_code == 1
    assert "status" in capsys.readouterr().err


def test_validate_fiscalizacion_uses_registered_baseline_metadata_and_refuses_mismatch(
    tmp_path: Path, capsys, monkeypatch: pytest.MonkeyPatch
) -> None:
    sources_path = tmp_path / "sources.yaml"
    sources_path.write_text(
        yaml.safe_dump(
            {
                "fiscalizacion": [
                    {
                        "id": "fiscalizacion/current",
                        "source": "internal",
                        "mime": "text/csv",
                        "notes": "canonical source fixture",
                        "source_url": "local://fiscalizacion/fixture.csv",
                        "election_year": 2025,
                        "election_round": "legislativas",
                        "source_kind": "fiscalizacion",
                        "upload": "never",
                    }
                ],
                "national": [
                    {
                        "id": "national/current-baseline",
                        "source": "example.test",
                        "mime": "text/csv",
                        "notes": "canonical source fixture",
                        "source_url": "https://example.test/current.csv",
                        "election_year": 2023,
                        "election_round": "generales",
                    }
                ],
            }
        ),
        encoding="utf-8",
    )

    def forbidden_connect(*_args, **_kwargs):
        raise AssertionError("baseline mismatch must refuse before database access")

    monkeypatch.setattr("etl.__main__.psycopg.connect", forbidden_connect)
    exit_code = main(
        _main_args(sources_path, tmp_path / "archive", tmp_path / "must-not-be-read.json")
        + [
            "validate-fiscalizacion",
            "--source",
            "fiscalizacion/current",
            "--baseline",
            "national/current-baseline",
            "--database-url",
            "postgresql://must-not-connect/nowhere",
        ]
    )

    assert exit_code == 1
    reported = capsys.readouterr().err
    assert "2025" in reported
    assert "2023" in reported
    assert "must-not-be-read" not in reported


@pytest.mark.parametrize(
    ("fiscal_year", "fiscal_round"),
    [(2023, "legislativas"), (2025, "paso")],
)
def test_validate_fiscalizacion_refuses_fiscal_source_election_mismatch_before_access(
    tmp_path: Path,
    capsys,
    monkeypatch: pytest.MonkeyPatch,
    fiscal_year: int,
    fiscal_round: str,
) -> None:
    sources_path = tmp_path / "sources.yaml"
    sources_path.write_text(
        yaml.safe_dump(
            {
                "fiscalizacion": [
                    {
                        "id": "fiscalizacion/current",
                        "source": "internal",
                        "mime": "text/csv",
                        "notes": "canonical source fixture",
                        "source_url": "local://fiscalizacion/fixture.csv",
                        "election_year": fiscal_year,
                        "election_round": fiscal_round,
                        "source_kind": "fiscalizacion",
                        "upload": "never",
                    }
                ],
                "national": [
                    {
                        "id": "national/current-baseline",
                        "source": "example.test",
                        "mime": "text/csv",
                        "notes": "canonical source fixture",
                        "source_url": "https://example.test/current.csv",
                        "election_year": 2025,
                        "election_round": "legislativas",
                    }
                ],
            }
        ),
        encoding="utf-8",
    )

    def forbidden_connect(*_args, **_kwargs):
        raise AssertionError("fiscal mismatch must refuse before database access")

    monkeypatch.setattr("etl.__main__.psycopg.connect", forbidden_connect)
    manifest_path = tmp_path / "must-not-be-read.json"
    exit_code = main(
        _main_args(sources_path, tmp_path / "archive", manifest_path)
        + [
            "validate-fiscalizacion",
            "--source",
            "fiscalizacion/current",
            "--baseline",
            "national/current-baseline",
            "--database-url",
            "postgresql://must-not-connect/nowhere",
        ]
    )

    assert exit_code == 1
    reported = capsys.readouterr().err
    assert "fiscalizacion/current" in reported
    assert f"{fiscal_year}/{fiscal_round}" in reported
    assert "2025/legislativas" in reported
    assert not manifest_path.exists()


def test_validate_fiscalizacion_refuses_a_scope_the_name_table_was_not_curated_for(
    tmp_path: Path, capsys
) -> None:
    """`OFFICIAL_AGRUPACION_NAME_BY_COLUMN` is curated for one
    (distrito, seccion, category). `--distrito/--seccion/--category` are free
    flags and nothing checked one against the other.

    Outside that scope every `agrupacion_nombre` misses, `vector()` returns 0
    for all 15 columns, and every joined mesa produces 17 FABRICATED
    divergences written to `review_item` as `info` for an operator to read as
    data. The refusal comes BEFORE any archive read, so a wrong scope costs
    nothing and writes nothing.
    """
    sources_path = tmp_path / "sources.yaml"
    sources_path.write_text(yaml.safe_dump({"national": []}), encoding="utf-8")
    manifest_path = tmp_path / "archive-manifest.json"
    manifest_path.write_text("[]", encoding="utf-8")

    exit_code = main(
        _main_args(sources_path, tmp_path / "archive", manifest_path)
        + [
            "validate-fiscalizacion",
            "--source",
            "fiscalizacion/whatever",
            "--baseline",
            "national/whatever",
            "--category",
            "SENADOR NACIONAL",
            "--database-url",
            "postgresql://votus-refusal-must-precede-connect/nowhere",
        ]
    )

    assert exit_code == 1
    reported = capsys.readouterr().err
    assert "curated for 02/027/DIPUTADO NACIONAL" in reported
    assert "not real" in reported


_MISSING_SOURCE_FIELD = object()


def _synthetic_registry_entry(capability: str) -> dict[str, object]:
    entry: dict[str, object] = {
        "id": f"{capability}/2025-registry-contract",
        "source": "registry.example",
        "source_url": "https://registry.example/results.csv",
        "mime": "text/csv",
        "notes": "synthetic registry contract fixture",
        "filename": "registry-contract.csv",
        "election_year": 2025,
        "election_round": "legislativas",
    }
    if capability == "pba":
        entry.update(
            {
                "source": "www.juntaelectoral.gba.gov.ar",
                "source_url": (
                    "https://www.juntaelectoral.gba.gov.ar/"
                    "escrutinio-definitivo-2025/concejales_distri/2025027.pdf"
                ),
                "mime": "application/pdf",
                "filename": "registry-contract.pdf",
                "election_round": "provinciales",
            }
        )
    elif capability == "fiscalizacion":
        entry.update(
            {
                "source": "local-file",
                "source_url": "local://fiscalizacion/registry-contract.csv",
                "source_kind": "fiscalizacion",
                "upload": "never",
            }
        )
    return entry


def _filesystem_snapshot(root: Path) -> dict[str, bytes | None]:
    return {
        path.relative_to(root).as_posix(): None if path.is_dir() else path.read_bytes()
        for path in root.rglob("*")
    }


@pytest.mark.parametrize("capability", ["national", "pba", "fiscalizacion"])
@pytest.mark.parametrize(
    ("field", "invalid_value", "diagnosis"),
    [
        pytest.param(
            "source_url", None, "source_url must be a non-empty string", id="source-url-null"
        ),
        pytest.param(
            "source_url", "   ", "source_url must be a non-empty string", id="source-url-blank"
        ),
        pytest.param(
            "mime", _MISSING_SOURCE_FIELD, "mime must be a non-empty string", id="mime-missing"
        ),
        pytest.param("mime", None, "mime must be a non-empty string", id="mime-null"),
        pytest.param("mime", "   ", "mime must be a non-empty string", id="mime-blank"),
        pytest.param("notes", _MISSING_SOURCE_FIELD, "notes must be a string", id="notes-missing"),
        pytest.param("notes", None, "notes must be a string", id="notes-null"),
    ],
)
def test_source_registry_required_metadata_is_rejected_at_the_common_cli_boundary(
    tmp_path: Path,
    capsys,
    monkeypatch: pytest.MonkeyPatch,
    capability: str,
    field: str,
    invalid_value: object,
    diagnosis: str,
) -> None:
    import etl.__main__ as cli

    source_id = f"{capability}/2025-registry-contract"
    entry = _synthetic_registry_entry(capability)
    private_registry_values = tuple(
        value
        for key in ("source", "source_url")
        if isinstance((value := entry[key]), str) and value.strip()
    )
    if invalid_value is _MISSING_SOURCE_FIELD:
        del entry[field]
    else:
        entry[field] = invalid_value

    sources_path = tmp_path / "sources.yaml"
    sources_path.write_text(yaml.safe_dump({capability: [entry]}), encoding="utf-8")
    local_file = tmp_path / "registry-contract.csv"
    local_file.write_bytes(b"synthetic,registry\n1,fixture\n")
    local_root = tmp_path / "archive"
    local_root.mkdir()
    (local_root / "preserved.txt").write_text("preserve me", encoding="utf-8")
    manifest_path = tmp_path / "archive-manifest.json"
    manifest_path.write_text("[]\n", encoding="utf-8")
    before = _filesystem_snapshot(tmp_path)
    fetcher = FakeFetcher()
    monkeypatch.setattr(cli, "RequestsFetcher", lambda: fetcher)
    command = _main_args(sources_path, local_root, manifest_path) + [
        "fetch",
        "--source",
        source_id,
    ]
    if capability == "fiscalizacion":
        command.extend(["--local-file", str(local_file)])

    exit_code = main(command)

    reported = capsys.readouterr()
    assert exit_code == 1
    assert reported.out == ""
    assert reported.err == (f"error: sources.yaml capability {capability!r} entry 0 {diagnosis}\n")
    assert all(value not in reported.err for value in private_registry_values)
    assert fetcher.calls == []
    assert _filesystem_snapshot(tmp_path) == before


def test_source_registry_allows_explicit_empty_notes_through_cli_archive(
    tmp_path: Path, capsys, monkeypatch: pytest.MonkeyPatch
) -> None:
    import etl.__main__ as cli

    entry = _synthetic_registry_entry("national")
    entry["notes"] = ""
    sources_path = tmp_path / "sources.yaml"
    sources_path.write_text(yaml.safe_dump({"national": [entry]}), encoding="utf-8")
    local_root = tmp_path / "archive"
    manifest_path = tmp_path / "archive-manifest.json"
    fetcher = FakeFetcher(payload=b"synthetic archive bytes")
    monkeypatch.setattr(cli, "RequestsFetcher", lambda: fetcher)

    exit_code = main(
        _main_args(sources_path, local_root, manifest_path)
        + ["fetch", "--source", "national/2025-registry-contract"]
    )

    reported = capsys.readouterr()
    assert exit_code == 0
    assert reported.err == ""
    assert fetcher.calls == ["https://registry.example/results.csv"]
    record = load_manifest(manifest_path)[0]
    assert record["notes"] == ""
    archived_path = record["archived_path"]
    assert isinstance(archived_path, str)
    assert (tmp_path / archived_path).read_bytes() == b"synthetic archive bytes"


@pytest.mark.parametrize(
    "entry",
    [
        {"id": "national/bad", "source_url": "https://example.test/x"},
        {"id": "national/bad", "source": "", "source_url": "https://example.test/x"},
        {"id": "national/bad", "source": 1, "source_url": "https://example.test/x"},
        {"id": "national/bad", "source": "example.test"},
        {"id": "national/bad", "source": "example.test", "source_url": 1},
    ],
)
def test_fetch_rejects_malformed_required_source_fields_through_main(
    tmp_path: Path, capsys, monkeypatch, entry: dict[str, object]
) -> None:
    import etl.__main__ as cli

    monkeypatch.setattr(
        cli,
        "fetch_source",
        lambda *args, **kwargs: (_ for _ in ()).throw(
            AssertionError("malformed sources must be rejected before fetch")
        ),
    )
    sources_path = tmp_path / "sources.yaml"
    sources_path.write_text(yaml.safe_dump({"national": [entry]}), encoding="utf-8")

    exit_code = main(
        _main_args(sources_path, tmp_path / "archive", tmp_path / "manifest.json")
        + ["fetch", "--source", "national/bad"]
    )

    reported = capsys.readouterr().err
    assert exit_code == 1
    assert "sources.yaml" in reported
    assert "Traceback" not in reported


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("election_year", True),
        ("election_year", "2025"),
        ("election_round", ""),
        ("election_round", "   "),
    ],
)
def test_sources_boundary_validates_election_metadata_when_present(
    tmp_path: Path, field: str, value: object
) -> None:
    from etl.__main__ import SourcesValidationError, load_sources

    entry: dict[str, object] = {
        "id": "national/test",
        "source": "example.test",
        "mime": "text/csv",
        "notes": "canonical source fixture",
        "source_url": "https://example.test/results.csv",
        "election_year": 2025,
        "election_round": "legislativas",
    }
    entry[field] = value
    path = tmp_path / "sources.yaml"
    path.write_text(yaml.safe_dump({"national": [entry]}), encoding="utf-8")

    with pytest.raises(SourcesValidationError, match=field):
        load_sources(path)


@pytest.mark.parametrize(
    "capability",
    ["unknown", "../escaped", "national/extra", r"national\extra", ".", "..", "", "   "],
)
def test_sources_boundary_accepts_only_supported_capability_families(
    tmp_path: Path, capability: str
) -> None:
    from etl.__main__ import SourcesValidationError, load_sources

    path = tmp_path / "sources.yaml"
    path.write_text(yaml.safe_dump({capability: []}), encoding="utf-8")

    with pytest.raises(SourcesValidationError, match="capability"):
        load_sources(path)


def test_registered_electoral_sources_declare_an_explicit_election() -> None:
    from etl.__main__ import load_sources

    sources = load_sources(REPO_ROOT / "etl" / "sources.yaml")

    for capability, entries in sources.items():
        for entry in entries:
            if capability == "geography":
                assert entry["reference_kind"] == "partido_geometry"
                assert "election_year" not in entry
                assert "election_round" not in entry
                continue
            assert isinstance(entry.get("election_year"), int)
            assert isinstance(entry.get("election_round"), str)
            assert entry["election_round"].strip()


def test_sources_boundary_rejects_disagreement_between_id_and_election_metadata(
    tmp_path: Path,
) -> None:
    from etl.__main__ import SourcesValidationError, load_sources

    path = tmp_path / "sources.yaml"
    path.write_text(
        yaml.safe_dump(
            {
                "national": [
                    {
                        "id": "national/2023-mislabeled",
                        "source": "example.test",
                        "mime": "text/csv",
                        "notes": "canonical source fixture",
                        "source_url": "https://example.test/results.csv",
                        "election_year": 2025,
                        "election_round": "legislativas",
                    }
                ]
            }
        ),
        encoding="utf-8",
    )

    with pytest.raises(SourcesValidationError, match="2023.*2025"):
        load_sources(path)


def test_curated_collection_uses_metadata_for_a_non_year_shaped_source_id(
    tmp_path: Path,
) -> None:
    source_id = "national/current-legislativas"
    sources = {
        "national": [
            {
                "id": source_id,
                "source": "example.test",
                "mime": "text/csv",
                "notes": "canonical source fixture",
                "source_url": "https://example.test/current.csv",
                "election_year": 2025,
                "election_round": "legislativas",
                "filename": "current.csv",
            }
        ]
    }
    local_root = tmp_path / "archive"
    manifest_path = tmp_path / "archive-manifest.json"
    fetch_source(
        source_id,
        sources=sources,
        fetcher=FakeFetcher(payload=NATIONAL_CSV.encode("utf-8")),
        local_root=local_root,
        manifest_path=manifest_path,
    )

    keys = collect_national_party_keys(
        sources,
        local_root=local_root,
        manifest_path=manifest_path,
    )

    assert keys
    assert {year for year, *_rest in keys} == {2025}


def test_sources_boundary_accepts_canonical_local_source_metadata(
    tmp_path: Path,
) -> None:
    from etl.__main__ import load_sources

    path = tmp_path / "sources.yaml"
    canonical = {
        "fiscalizacion": [
            {
                "id": "fiscalizacion/upload-forbidden",
                "source": "local",
                "mime": "text/csv",
                "notes": "canonical source fixture",
                "source_url": "local://fiscalizacion/fixture.csv",
                "election_year": 2025,
                "election_round": "legislativas",
                "source_kind": "fiscalizacion",
                "upload": "never",
            }
        ]
    }
    path.write_text(yaml.safe_dump(canonical), encoding="utf-8")

    assert load_sources(path) == canonical


@pytest.mark.parametrize(
    "election_fields",
    [{}, {"election_year": 2025}, {"election_round": "legislativas"}],
)
def test_sources_boundary_requires_complete_election_identity(
    tmp_path: Path, election_fields: dict[str, object]
) -> None:
    from etl.__main__ import SourcesValidationError, load_sources

    path = tmp_path / "sources.yaml"
    path.write_text(
        yaml.safe_dump(
            {
                "fiscalizacion": [
                    {
                        "id": "fiscalizacion/missing-election",
                        "source": "local",
                        "mime": "text/csv",
                        "notes": "canonical source fixture",
                        "source_url": "local://fiscalizacion/test.csv",
                        "source_kind": "fiscalizacion",
                        "upload": "never",
                        **election_fields,
                    }
                ]
            }
        ),
        encoding="utf-8",
    )

    with pytest.raises(SourcesValidationError, match="election_year|election_round"):
        load_sources(path)


def test_loaded_fiscalizacion_identity_reaches_reexport_classification(tmp_path: Path) -> None:
    from etl.__main__ import load_sources
    from etl.manifest import load_fetch_events

    source_id = "fiscalizacion/2025-registry-classification"
    source_url = "https://example.test/fiscal.csv"
    sources_path = tmp_path / "sources.yaml"
    sources_path.write_text(
        yaml.safe_dump(
            {
                "fiscalizacion": [
                    {
                        "id": source_id,
                        "source": "local",
                        "notes": "canonical source fixture",
                        "source_url": source_url,
                        "mime": "text/csv",
                        "filename": "fiscal.csv",
                        "source_kind": "fiscalizacion",
                        "upload": "never",
                        "election_year": 2025,
                        "election_round": "legislativas",
                    }
                ]
            }
        ),
        encoding="utf-8",
    )
    sources = load_sources(sources_path)
    manifest_path = tmp_path / "archive-manifest.json"
    for invocation_id, payload in (("first", b"v1"), ("second", b"v2")):
        fetch_source(
            source_id,
            sources=sources,
            fetcher=FakeFetcher(payload=payload),
            local_root=tmp_path / "archive",
            manifest_path=manifest_path,
            invocation_id=invocation_id,
        )

    assert load_fetch_events(manifest_path)[-1]["classification"] == "source_reexported"


def test_numeric_archived_path_is_a_clean_cli_validation_failure(tmp_path: Path, capsys) -> None:
    sources_path = tmp_path / "sources.yaml"
    sources_path.write_text(
        yaml.safe_dump(
            {
                "national": [
                    {
                        "id": "national/2025-numeric-path",
                        "source": "example.test",
                        "mime": "text/csv",
                        "notes": "canonical source fixture",
                        "source_url": "https://example.test/x.csv",
                        "election_year": 2025,
                        "election_round": "legislativas",
                    }
                ]
            }
        ),
        encoding="utf-8",
    )
    manifest_path = tmp_path / "archive-manifest.json"
    manifest_path.write_text(
        json.dumps(
            [
                {
                    "id": "national/2025-numeric-path",
                    "status": "ok",
                    "archived_path": 123,
                }
            ]
        ),
        encoding="utf-8",
    )

    exit_code = main(
        _main_args(sources_path, tmp_path / "archive", manifest_path) + ["validate-crosswalk"]
    )

    reported = capsys.readouterr().err
    assert exit_code == 1
    assert "archived_path" in reported
    assert "Traceback" not in reported


def test_party_map_string_boolean_is_a_clean_cli_validation_failure(
    tmp_path: Path, capsys, monkeypatch
) -> None:
    import etl.__main__ as cli

    sources_path = tmp_path / "sources.yaml"
    sources_path.write_text(yaml.safe_dump({"national": []}), encoding="utf-8")
    manifest_path = tmp_path / "archive-manifest.json"
    manifest_path.write_text("[]", encoding="utf-8")
    party_map_path = tmp_path / "party_map.yaml"
    party_map_path.write_text(
        yaml.safe_dump(
            {
                "canonical_parties": [{"id": "LLA", "display_name": "LA LIBERTAD AVANZA"}],
                "mappings": [
                    {
                        "year": 2025,
                        "jurisdiction": "national",
                        "category": "DIPUTADO NACIONAL",
                        "list_id": "110",
                        "canonical_party": "LLA",
                        "party_name": "LA LIBERTAD AVANZA",
                        "verified": "false",
                    }
                ],
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(
        cli,
        "readable_national_sources",
        lambda *args, **kwargs: NationalSourceReadability((), ("fixture",), ()),
    )
    monkeypatch.setattr(cli, "collect_national_party_keys", lambda *args, **kwargs: [])

    exit_code = main(
        _main_args(sources_path, tmp_path / "archive", manifest_path)
        + ["validate-curated", "--party-map-path", str(party_map_path)]
    )

    reported = capsys.readouterr().err
    assert exit_code == 1
    assert "verified must be a boolean" in reported
    assert "Traceback" not in reported


@pytest.mark.parametrize("batch_size", [0, -1])
def test_backfill_batch_size_rejects_nonpositive_values_through_main(
    tmp_path: Path, capsys, batch_size: int
) -> None:
    with pytest.raises(SystemExit) as excinfo:
        main(
            _main_args(tmp_path / "sources.yaml", tmp_path / "archive", tmp_path / "manifest.json")
            + ["backfill-mesa-tipo", "--batch-size", str(batch_size)]
        )

    assert excinfo.value.code == 2
    reported = capsys.readouterr().err
    assert "batch-size" in reported
    assert "positive" in reported
    assert "Traceback" not in reported


@pytest.mark.parametrize("batch_size", [0, -1])
def test_apply_mesa_tipo_mapping_rejects_nonpositive_batch_size_before_db_access(
    batch_size: int,
) -> None:
    from etl.__main__ import apply_mesa_tipo_mapping

    class ConnectionThatMustNotBeTouched:
        def cursor(self):
            raise AssertionError("invalid batch size must fail before database access")

    with pytest.raises(ValueError, match="batch_size must be positive"):
        apply_mesa_tipo_mapping(ConnectionThatMustNotBeTouched(), {}, batch_size=batch_size)


def _national_zip_of(row_count: int, *, distinct_mesas: int | None = None) -> tuple[bytes, int]:
    """A registered-shape national ZIP plus its uncompressed CSV size.

    `distinct_mesas` bounds how many identities the projection can return, so
    a memory assertion can separate "the file was copied" from "the result set
    is legitimately large".
    """
    import zipfile as _zipfile

    distinct = distinct_mesas if distinct_mesas is not None else row_count
    header = (
        "distrito_id,distrito_nombre,seccion_id,seccion_nombre,circuito_id,"
        "circuito_nombre,mesa_id,cargo_nombre,agrupacion_id,votos_tipo,votos_cantidad\n"
    )
    body = "".join(
        "02,Buenos Aires,027,Coronel Rosales,00248,Circuito 248,"
        f"{9000 + index % distinct},DIPUTADO NACIONAL,110,POSITIVO,7\n"
        for index in range(row_count)
    )
    csv_text = header + body
    buffer = io.BytesIO()
    with _zipfile.ZipFile(buffer, "w", _zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("ResultadosElectorales.csv", csv_text)
    return buffer.getvalue(), len(csv_text.encode("utf-8"))


def test_national_results_text_streams_without_materializing_the_member() -> None:
    """Peak memory must scale with the row, not with the decompressed file.

    The 2023 PASO member decompresses to 3,76 GB. `national_csv_bytes` holds
    it whole and `extract_raw_mesa_identities` then decoded a second copy, so
    `load-curated` needed 6,59 GB resident and was killed by the OS. Measured
    here rather than asserted structurally: a refactor that reintroduces a
    full-file buffer fails this even if the call shape still looks streaming.
    """
    import tracemalloc

    from etl.__main__ import national_results_text
    from etl.ingest.national import extract_raw_mesa_identities_from_text

    # Many rows, few identities: the returned set stays small, so anything
    # that shows up in the peak is a copy of the file rather than the answer.
    raw_bytes, uncompressed_size = _national_zip_of(400_000, distinct_mesas=50)

    tracemalloc.start()
    try:
        with national_results_text(raw_bytes) as handle:
            identities = extract_raw_mesa_identities_from_text(handle)
        _, peak = tracemalloc.get_traced_memory()
    finally:
        tracemalloc.stop()

    assert len(identities) == 50
    # The archived ZIP itself is already in memory (the caller read it), so the
    # floor is `len(raw_bytes)`; what must NOT appear is a copy of the
    # decompressed member on top of it.
    assert peak < len(raw_bytes) + uncompressed_size // 4


def test_national_results_text_reads_the_member_the_bytes_path_selects() -> None:
    """Streaming must resolve the same member `national_csv_bytes` picks.

    Selection and reading are now separate steps, so the risk is that the
    streaming path walks a different member of the same ZIP -- an unrelated
    companion CSV, say. Asserted against the member's own bytes rather than
    against a second identity projection, which would only prove the two
    parsers agree.
    """
    from etl.__main__ import national_csv_bytes, national_results_text
    from etl.ingest.national import extract_raw_mesa_identities_from_text

    raw_bytes, _ = _national_zip_of(500, distinct_mesas=25)

    with national_results_text(raw_bytes) as handle:
        streamed_text = handle.read()
    with national_results_text(raw_bytes) as handle:
        streamed_identities = extract_raw_mesa_identities_from_text(handle)

    assert streamed_text == national_csv_bytes(raw_bytes).decode("utf-8-sig")
    assert streamed_identities == {("02", "027", "00248", 9000 + index) for index in range(25)}


def test_national_results_text_streams_a_bare_csv_passthrough() -> None:
    from etl.__main__ import national_results_text
    from etl.ingest.national import extract_raw_mesa_identities_from_text

    csv_bytes = (
        b"distrito_id,seccion_id,circuito_id,mesa_id,cargo_nombre,agrupacion_id,"
        b"votos_tipo,votos_cantidad\n"
        b"02,027,0249A,9001,DIPUTADO NACIONAL,110,POSITIVO,7\n"
    )

    with national_results_text(csv_bytes) as handle:
        assert extract_raw_mesa_identities_from_text(handle) == {("02", "027", "0249A", 9001)}
