"""Unit tests for the archival orchestration core (etl.archive).

Uses a fake fetcher — no network I/O in this suite. Covers the
source-archive spec's immutability, sha256, and content-drift
requirements (D2, D8).
"""

import os
from collections.abc import Mapping
from datetime import UTC, datetime

import pytest

from etl.__main__ import fetch_source
from etl.archive import ArchiveIntegrityError, FetchResponse, archive_source, read_verified_archive
from etl.manifest import load_manifest
from etl.storage import LocalArchiveStore, sha256_of


class FakeFetcher:
    def __init__(self, responses: dict[str, FetchResponse | Exception]) -> None:
        self.responses = responses
        self.calls: list[str] = []

    def get(self, url: str, *, timeout: float, headers: dict[str, str]) -> FetchResponse:
        self.calls.append(url)
        outcome = self.responses[url]
        if isinstance(outcome, Exception):
            raise outcome
        return outcome


FIXED_NOW = datetime(2026, 8, 3, 20, 0, 0, tzinfo=UTC)


def _required_string(record: Mapping[str, object], field: str) -> str:
    value = record[field]
    assert isinstance(value, str), f"{field} must be a string in this valid-record test"
    return value


ENTRY = {
    "id": "national/2023-generales",
    "capability": "national",
    "source": "argentina.gob.ar",
    "source_url": "https://www.argentina.gob.ar/sites/default/files/2023_generales_1.zip",
    "mime": "application/zip",
    "notes": "2023 Elecciones Generales",
}


def test_first_fetch_creates_immutable_entry(tmp_path) -> None:
    """source-archive spec: 'First fetch of a registered source' — a new
    immutable archive entry is created, recording source URL and fetch
    timestamp."""
    data = b"PK\x03\x04 fake zip bytes"
    fetcher = FakeFetcher({ENTRY["source_url"]: FetchResponse(200, data)})
    local_store = LocalArchiveStore(root=tmp_path)

    result = archive_source(
        {**ENTRY, "filename": "2023-generales.zip"},
        fetcher=fetcher,
        local_store=local_store,
        now=FIXED_NOW,
    )

    digest = sha256_of(data)
    archived_file = tmp_path / "national" / f"2023-generales.{digest}.zip"
    assert result.record["status"] == "ok"
    assert result.record["source_url"] == ENTRY["source_url"]
    assert result.record["fetched_at"] == "2026-08-03T20:00:00Z"
    assert result.record["archived_path"] == f"{tmp_path.name}/national/{archived_file.name}"
    assert archived_file.read_bytes() == data


def test_refetch_never_mutates_prior_entry(tmp_path) -> None:
    """source-archive spec: 'Re-fetch never mutates a prior archive entry' —
    a re-fetch creates a new entry rather than overwriting; every previously
    archived entry stays byte-for-byte unchanged."""
    manifest_path = tmp_path / "archive-manifest.json"
    local_root = tmp_path / "archive"
    first_bytes = b"PK\x03\x04 version one"
    second_bytes = b"PK\x03\x04 version two, different content"

    sources = {"national": [{**ENTRY, "filename": "2023-generales.zip"}]}
    fetch_source(
        ENTRY["id"],
        sources=sources,
        fetcher=FakeFetcher({ENTRY["source_url"]: FetchResponse(200, first_bytes)}),
        local_root=local_root,
        manifest_path=manifest_path,
    )
    fetch_source(
        ENTRY["id"],
        sources=sources,
        fetcher=FakeFetcher({ENTRY["source_url"]: FetchResponse(200, second_bytes)}),
        local_root=local_root,
        manifest_path=manifest_path,
    )

    records = load_manifest(manifest_path)
    prior = next(r for r in records if str(r["id"]).startswith("national/2023-generales@"))
    canonical = next(r for r in records if r["id"] == "national/2023-generales")

    assert prior["sha256"] == sha256_of(first_bytes)
    assert canonical["sha256"] == sha256_of(second_bytes)
    assert prior["archived_path"] != canonical["archived_path"]
    assert (tmp_path / str(prior["archived_path"])).read_bytes() == first_bytes
    assert (tmp_path / str(canonical["archived_path"])).read_bytes() == second_bytes


def test_identical_content_reuses_archive_without_rewriting(tmp_path) -> None:
    data = b"PK\x03\x04 stable archive"
    fetcher = FakeFetcher({ENTRY["source_url"]: FetchResponse(200, data)})
    local_store = LocalArchiveStore(root=tmp_path / "archive")
    configured_entry = {**ENTRY, "filename": "results.tar.gz"}

    first = archive_source(
        configured_entry, fetcher=fetcher, local_store=local_store, now=FIXED_NOW
    )
    archived_file = tmp_path / str(first.record["archived_path"])
    fixed_timestamp_ns = 1_000_000_000
    os.utime(archived_file, ns=(fixed_timestamp_ns, fixed_timestamp_ns))

    second = archive_source(
        configured_entry, fetcher=fetcher, local_store=local_store, now=FIXED_NOW
    )

    assert second.record["archived_path"] == first.record["archived_path"]
    assert archived_file.name == f"results.{sha256_of(data)}.tar.gz"
    assert archived_file.stat().st_mtime_ns == fixed_timestamp_ns
    assert archived_file.read_bytes() == data


@pytest.mark.parametrize("digest", [None, "not-a-sha256", "0" * 63, "g" * 64])
def test_verified_archive_read_rejects_missing_or_invalid_manifest_digest(tmp_path, digest) -> None:
    local_store = LocalArchiveStore(root=tmp_path)
    local_store.write("national", "capture.csv", b"valid bytes")

    with pytest.raises(ArchiveIntegrityError, match="sha256"):
        read_verified_archive(
            local_store,
            capability="national",
            filename="capture.csv",
            expected_sha256=digest,
        )


def test_verified_archive_read_rejects_bytes_that_do_not_match_manifest(tmp_path) -> None:
    local_store = LocalArchiveStore(root=tmp_path)
    expected = b"original bytes"
    local_store.write("national", "capture.csv", b"modified but schema-valid bytes")

    with pytest.raises(ArchiveIntegrityError, match=sha256_of(expected)):
        read_verified_archive(
            local_store,
            capability="national",
            filename="capture.csv",
            expected_sha256=sha256_of(expected),
        )


def test_existing_content_address_with_wrong_bytes_refuses_overwrite(tmp_path) -> None:
    data = b"expected capture"
    digest = sha256_of(data)
    local_store = LocalArchiveStore(root=tmp_path / "archive")
    target = local_store.path_for("national", f"2023-generales.{digest}.zip")
    target.parent.mkdir(parents=True)
    corrupt_bytes = b"corrupt pre-existing bytes"
    target.write_bytes(corrupt_bytes)

    with pytest.raises(ArchiveIntegrityError, match=digest):
        archive_source(
            {**ENTRY, "filename": "2023-generales.zip"},
            fetcher=FakeFetcher({ENTRY["source_url"]: FetchResponse(200, data)}),
            local_store=local_store,
            now=FIXED_NOW,
        )

    assert target.read_bytes() == corrupt_bytes


@pytest.mark.parametrize(
    "filename",
    ["../escape.zip", "nested/file.zip", r"nested\file.zip", ".", "", "capture\0.zip"],
)
def test_configured_filename_must_be_a_safe_basename(tmp_path, filename) -> None:
    fetcher = FakeFetcher({ENTRY["source_url"]: FetchResponse(200, b"data")})

    with pytest.raises(ValueError, match="safe basename"):
        archive_source(
            {**ENTRY, "filename": filename},
            fetcher=fetcher,
            local_store=LocalArchiveStore(root=tmp_path),
            now=FIXED_NOW,
        )

    assert fetcher.calls == []


@pytest.mark.parametrize(
    "capability", ["../escaped", "national/extra", r"national\extra", ".", "..", ""]
)
def test_archive_source_rejects_an_unsafe_capability_before_fetch_or_write(
    tmp_path, capability: str
) -> None:
    fetcher = FakeFetcher({ENTRY["source_url"]: FetchResponse(200, b"data")})
    local_store = LocalArchiveStore(root=tmp_path / "archive")

    with pytest.raises(ValueError, match="capability"):
        archive_source(
            {**ENTRY, "capability": capability, "filename": "capture.zip"},
            fetcher=fetcher,
            local_store=local_store,
            now=FIXED_NOW,
        )

    assert fetcher.calls == []
    assert not (tmp_path / "escaped" / "capture.zip").exists()


def test_sha256_recorded_on_fetch(tmp_path) -> None:
    """source-archive spec: 'sha256 recorded on fetch'."""
    data = b"PK\x03\x04 electoral results"
    fetcher = FakeFetcher({ENTRY["source_url"]: FetchResponse(200, data)})
    local_store = LocalArchiveStore(root=tmp_path)

    result = archive_source(
        {**ENTRY, "filename": "2023-generales.zip"},
        fetcher=fetcher,
        local_store=local_store,
        now=FIXED_NOW,
    )

    assert result.record["sha256"] == sha256_of(data)


def test_drift_flagged_on_changed_hash(tmp_path) -> None:
    """source-archive spec: 'Re-fetch with changed content' — flagged as
    drift, surfaced (not just logged)."""
    manifest_path = tmp_path / "archive-manifest.json"
    local_root = tmp_path / "archive"

    sources = {"national": [{**ENTRY, "filename": "2023-generales.zip"}]}
    fetch_source(
        ENTRY["id"],
        sources=sources,
        fetcher=FakeFetcher({ENTRY["source_url"]: FetchResponse(200, b"first content")}),
        local_root=local_root,
        manifest_path=manifest_path,
    )
    fetch_source(
        ENTRY["id"],
        sources=sources,
        fetcher=FakeFetcher({ENTRY["source_url"]: FetchResponse(200, b"second, different")}),
        local_root=local_root,
        manifest_path=manifest_path,
    )

    records = load_manifest(manifest_path)
    canonical = next(r for r in records if r["id"] == "national/2023-generales")
    assert "drift" in _required_string(canonical, "notes").lower()


def test_no_drift_on_identical_refetch(tmp_path) -> None:
    """source-archive spec: 'Re-fetch with identical content' — recorded as
    a no-drift re-fetch, no drift flag raised."""
    manifest_path = tmp_path / "archive-manifest.json"
    local_root = tmp_path / "archive"
    same_bytes = b"PK\x03\x04 unchanged content"

    sources = {"national": [{**ENTRY, "filename": "2023-generales.zip"}]}
    fetch_source(
        ENTRY["id"],
        sources=sources,
        fetcher=FakeFetcher({ENTRY["source_url"]: FetchResponse(200, same_bytes)}),
        local_root=local_root,
        manifest_path=manifest_path,
    )
    fetch_source(
        ENTRY["id"],
        sources=sources,
        fetcher=FakeFetcher({ENTRY["source_url"]: FetchResponse(200, same_bytes)}),
        local_root=local_root,
        manifest_path=manifest_path,
    )

    records = load_manifest(manifest_path)
    assert len(records) == 1
    assert "drift" not in _required_string(records[0], "notes").lower()


def test_repeated_production_fetches_write_manifest_for_every_capability(tmp_path) -> None:
    fiscal_url = "https://example.test/fiscalizacion.csv"
    sources = {
        "national": [{**ENTRY, "filename": "2023-generales.zip"}],
        "fiscalizacion": [
            {
                "id": "fiscalizacion/2025-test",
                "source": "internal",
                "source_url": fiscal_url,
                "mime": "text/csv",
                "notes": "",
                "filename": "fiscalizacion.csv",
                "upload": "never",
            }
        ],
    }
    fetcher = FakeFetcher(
        {
            ENTRY["source_url"]: FetchResponse(200, b"national"),
            fiscal_url: FetchResponse(200, b"fiscalizacion"),
        }
    )
    manifest_path = tmp_path / "archive-manifest.json"
    local_root = tmp_path / "archive"

    for source_id in (ENTRY["id"], "fiscalizacion/2025-test"):
        fetch_source(
            source_id,
            sources=sources,
            fetcher=fetcher,
            local_root=local_root,
            manifest_path=manifest_path,
        )

    records = load_manifest(manifest_path)
    by_id = {str(record["id"]): record for record in records}
    assert set(by_id) == {"national/2023-generales", "fiscalizacion/2025-test"}
    for source_id, capability in (
        ("national/2023-generales", "national"),
        ("fiscalizacion/2025-test", "fiscalizacion"),
    ):
        archived_path = _required_string(by_id[source_id], "archived_path")
        assert (local_root / capability / archived_path.rsplit("/", 1)[-1]).exists()
