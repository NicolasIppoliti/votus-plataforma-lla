"""Unit tests for the archival orchestration core (etl.archive).

Uses a fake fetcher — no network I/O in this suite. Covers the
source-archive spec's immutability, sha256, and content-drift
requirements (D2, D8).
"""

from datetime import UTC, datetime

from etl.archive import FetchResponse, archive_source, run_archive_all
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

    assert result.record["status"] == "ok"
    assert result.record["source_url"] == ENTRY["source_url"]
    assert result.record["fetched_at"] == "2026-08-03T20:00:00Z"
    assert (tmp_path / "national" / "2023-generales.zip").read_bytes() == data


def test_refetch_never_mutates_prior_entry(tmp_path) -> None:
    """source-archive spec: 'Re-fetch never mutates a prior archive entry' —
    a re-fetch creates a new entry rather than overwriting; every previously
    archived entry stays byte-for-byte unchanged."""
    manifest_path = tmp_path / "archive-manifest.json"
    local_root = tmp_path / "archive"
    first_bytes = b"PK\x03\x04 version one"
    second_bytes = b"PK\x03\x04 version two, different content"

    run_archive_all(
        {"national": [{**ENTRY, "filename": "2023-generales.zip"}]},
        fetcher=FakeFetcher({ENTRY["source_url"]: FetchResponse(200, first_bytes)}),
        local_root=local_root,
        manifest_path=manifest_path,
        now=FIXED_NOW,
    )
    first_archived = (local_root / "national" / "2023-generales.zip").read_bytes()
    assert first_archived == first_bytes

    later = datetime(2026, 8, 10, 12, 0, 0, tzinfo=UTC)
    run_archive_all(
        {"national": [{**ENTRY, "filename": "2023-generales.zip"}]},
        fetcher=FakeFetcher({ENTRY["source_url"]: FetchResponse(200, second_bytes)}),
        local_root=local_root,
        manifest_path=manifest_path,
        now=later,
    )

    records = load_manifest(manifest_path)
    prior = next(r for r in records if r["id"] == "national/2023-generales@2026-08-03")
    assert prior["sha256"] == sha256_of(first_bytes)

    canonical = next(r for r in records if r["id"] == "national/2023-generales")
    assert canonical["sha256"] == sha256_of(second_bytes)


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

    run_archive_all(
        {"national": [{**ENTRY, "filename": "2023-generales.zip"}]},
        fetcher=FakeFetcher({ENTRY["source_url"]: FetchResponse(200, b"first content")}),
        local_root=local_root,
        manifest_path=manifest_path,
        now=FIXED_NOW,
    )
    run_archive_all(
        {"national": [{**ENTRY, "filename": "2023-generales.zip"}]},
        fetcher=FakeFetcher({ENTRY["source_url"]: FetchResponse(200, b"second, different")}),
        local_root=local_root,
        manifest_path=manifest_path,
        now=datetime(2026, 8, 4, 0, 0, 0, tzinfo=UTC),
    )

    records = load_manifest(manifest_path)
    canonical = next(r for r in records if r["id"] == "national/2023-generales")
    assert "drift" in canonical["notes"].lower()


def test_no_drift_on_identical_refetch(tmp_path) -> None:
    """source-archive spec: 'Re-fetch with identical content' — recorded as
    a no-drift re-fetch, no drift flag raised."""
    manifest_path = tmp_path / "archive-manifest.json"
    local_root = tmp_path / "archive"
    same_bytes = b"PK\x03\x04 unchanged content"

    run_archive_all(
        {"national": [{**ENTRY, "filename": "2023-generales.zip"}]},
        fetcher=FakeFetcher({ENTRY["source_url"]: FetchResponse(200, same_bytes)}),
        local_root=local_root,
        manifest_path=manifest_path,
        now=FIXED_NOW,
    )
    run_archive_all(
        {"national": [{**ENTRY, "filename": "2023-generales.zip"}]},
        fetcher=FakeFetcher({ENTRY["source_url"]: FetchResponse(200, same_bytes)}),
        local_root=local_root,
        manifest_path=manifest_path,
        now=datetime(2026, 8, 4, 0, 0, 0, tzinfo=UTC),
    )

    records = load_manifest(manifest_path)
    assert len(records) == 1
    assert "drift" not in records[0]["notes"].lower()


def test_run_archive_all_writes_manifest_for_every_capability(tmp_path) -> None:
    sources = {
        "national": [
            {**ENTRY, "filename": "2023-generales.zip"},
            {
                "id": "national/2025-legislativas",
                "source": "datos.mininterior.gob.ar",
                "source_url": (
                    "https://datos.mininterior.gob.ar/dataset/x/resource/y/download/"
                    "elecciones_legislativas_2025.zip"
                ),
                "mime": "application/zip",
                "notes": "",
                "filename": "2025-legislativas.zip",
            },
        ]
    }
    fetcher = FakeFetcher(
        {
            ENTRY["source_url"]: FetchResponse(200, b"a"),
            sources["national"][1]["source_url"]: FetchResponse(200, b"b"),
        }
    )
    manifest_path = tmp_path / "archive-manifest.json"

    records = run_archive_all(
        sources,
        fetcher=fetcher,
        local_root=tmp_path / "archive",
        manifest_path=manifest_path,
        now=FIXED_NOW,
    )

    assert len(records) == 2
    assert load_manifest(manifest_path) == records
    ids = {r["id"] for r in records}
    assert ids == {"national/2023-generales", "national/2025-legislativas"}
