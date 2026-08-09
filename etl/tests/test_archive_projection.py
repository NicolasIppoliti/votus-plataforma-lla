"""Archive-manifest projection contracts at the production ingest boundary."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pytest

from etl import db
from etl.__main__ import ingest_source
from etl.storage import LocalArchiveStore


def _source(source_id: str, *, capability: str = "national") -> dict:
    source_kind = "fiscalizacion" if capability == "fiscalizacion" else "official"
    return {
        "id": source_id,
        "capability": capability,
        "source": "example.test",
        "source_url": f"https://example.test/{source_id}.csv",
        "mime": "text/csv",
        "notes": "verified fixture",
        "election_year": 2025,
        "election_round": "legislativas",
        "source_kind": source_kind,
    }


def _manifest(source: dict, payload: bytes = b"verified") -> dict:
    return {
        "id": source["id"],
        "capability": source["capability"],
        "source": source["source"],
        "source_url": source["source_url"],
        "archived_path": f"archive/{source['capability']}/fixture.csv",
        "sha256": hashlib.sha256(payload).hexdigest(),
        "mime": source["mime"],
        "bytes": len(payload),
        "fetched_at": "2026-08-09T12:00:00Z",
        "status": "ok",
        "notes": source["notes"],
    }


@pytest.mark.parametrize(
    ("capability", "expected_kind"),
    [("national", "official"), ("pba", "official"), ("fiscalizacion", "fiscalizacion")],
)
def test_one_mapping_boundary_preserves_source_kind_and_verified_fields(
    capability: str,
    expected_kind: str,
) -> None:
    source = _source(f"{capability}/projection", capability=capability)
    manifest = _manifest(source)

    projected = db.archive_entry_from_evidence(manifest, source)

    assert projected.id == manifest["id"]
    assert projected.source_url == manifest["source_url"]
    assert projected.sha256 == manifest["sha256"]
    assert projected.fetched_at == manifest["fetched_at"]
    assert projected.status == "ok"
    assert projected.source_kind == expected_kind


def test_mapping_refuses_manifest_and_registry_metadata_conflict() -> None:
    source = _source("national/conflict")
    manifest = _manifest(source) | {"source_url": "https://other.test/results.csv"}

    with pytest.raises(ValueError, match="source_url"):
        db.archive_entry_from_evidence(manifest, source)


def test_mapping_refuses_source_kind_that_contradicts_capability() -> None:
    source = _source("national/kind-conflict") | {"source_kind": "fiscalizacion"}

    with pytest.raises(ValueError, match="requires source_kind 'official'"):
        db.archive_entry_from_evidence(_manifest(source), source)


def test_mapping_uses_registry_notes_only_when_manifest_notes_are_absent() -> None:
    source = _source("national/notes-fallback")
    manifest = _manifest(source)
    manifest.pop("notes")

    projected = db.archive_entry_from_evidence(manifest, source)

    assert projected.notes == source["notes"]


class _Connection:
    def __init__(self) -> None:
        self.commits = 0
        self.rollbacks = 0
        self.closed = False

    def commit(self) -> None:
        self.commits += 1

    def rollback(self) -> None:
        self.rollbacks += 1

    def close(self) -> None:
        self.closed = True


def _archived_source(tmp_path: Path) -> tuple[str, dict[str, list[dict]], Path, Path]:
    source_id = "national/production-reachability"
    source = _source(source_id)
    payload = b"verified"
    local_root = tmp_path / "archive"
    manifest_path = tmp_path / "archive-manifest.json"
    LocalArchiveStore(root=local_root).write("national", "fixture.csv", payload)
    manifest_path.write_text(json.dumps([_manifest(source, payload)]), encoding="utf-8")
    return source_id, {"national": [source]}, local_root, manifest_path


def test_ingest_source_projects_archive_before_any_result_loader(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    source_id, sources, local_root, manifest_path = _archived_source(tmp_path)
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest[0]["notes"] = "fetch-time archive capture note"
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
    connection = _Connection()
    calls: list[str] = []
    projected_notes: list[str] = []
    monkeypatch.setattr("etl.__main__.psycopg.connect", lambda _dsn: connection)
    monkeypatch.setattr("etl.__main__.ingest_national", lambda *_args, **_kwargs: [])

    def project_archive(_conn, record: db.ArchiveEntryRecord) -> None:
        calls.append("archive")
        projected_notes.append(record.notes)

    monkeypatch.setattr("etl.__main__.project_archive_entry", project_archive, raising=False)
    monkeypatch.setattr(
        "etl.__main__.load_national_rows",
        lambda *_args, **_kwargs: calls.append("results") or 0,
    )

    ingest_source(
        source_id,
        database_url="postgresql://unused",
        year=2025,
        round_="legislativas",
        sources=sources,
        local_root=local_root,
        manifest_path=manifest_path,
    )

    assert calls == ["archive", "results"]
    assert projected_notes == ["fetch-time archive capture note"]
    assert connection.commits == 1


def test_projection_refusal_happens_before_result_loader_and_rolls_back(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    source_id, sources, local_root, manifest_path = _archived_source(tmp_path)
    connection = _Connection()
    result_loader_called = False
    monkeypatch.setattr("etl.__main__.psycopg.connect", lambda _dsn: connection)
    monkeypatch.setattr("etl.__main__.ingest_national", lambda *_args, **_kwargs: [])

    def refuse(*_args, **_kwargs) -> None:
        raise ValueError("archive metadata conflict")

    def load_results(*_args, **_kwargs) -> int:
        nonlocal result_loader_called
        result_loader_called = True
        return 0

    monkeypatch.setattr("etl.__main__.project_archive_entry", refuse, raising=False)
    monkeypatch.setattr("etl.__main__.load_national_rows", load_results)

    with pytest.raises(ValueError, match="archive metadata conflict"):
        ingest_source(
            source_id,
            database_url="postgresql://unused",
            year=2025,
            round_="legislativas",
            sources=sources,
            local_root=local_root,
            manifest_path=manifest_path,
        )

    assert result_loader_called is False
    assert connection.rollbacks == 1
    assert connection.commits == 0
