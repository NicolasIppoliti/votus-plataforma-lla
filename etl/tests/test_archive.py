"""Unit tests for the archival orchestration core (etl.archive).

Uses a fake fetcher — no network I/O in this suite. Covers the
source-archive spec's immutability, sha256, and content-drift
requirements (D2, D8).
"""

import json
import os
from collections.abc import Mapping
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from threading import Barrier

import pytest

from etl.__main__ import fetch_source
from etl.archive import ArchiveIntegrityError, FetchResponse, archive_source, read_verified_archive
from etl.manifest import load_fetch_events, load_manifest
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

FISCALIZACION_ENTRY = {
    "id": "fiscalizacion/current-coronel-rosales",
    "capability": "fiscalizacion",
    "source": "local-file",
    "source_url": "https://example.test/fiscalizacion.csv",
    "mime": "text/csv",
    "notes": "synthetic shape-only fixture",
    "filename": "fiscalizacion.csv",
    "election_year": 2025,
    "election_round": "legislativas",
    "source_kind": "fiscalizacion",
    "upload": "never",
}


def _fetch(sources, fetcher, local_root, manifest_path, invocation_id=None, source_id=ENTRY["id"]):
    return fetch_source(
        source_id,
        sources=sources,
        fetcher=fetcher,
        local_root=local_root,
        manifest_path=manifest_path,
        invocation_id=invocation_id,
    )


def _artifact_snapshot(root):
    return {
        path.relative_to(root).as_posix(): sha256_of(path.read_bytes())
        for path in root.rglob("*")
        if path.is_file()
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


def test_identical_refetches_append_ordered_events_and_reuse_one_artifact(tmp_path) -> None:
    manifest_path = tmp_path / "archive-manifest.json"
    local_root = tmp_path / "archive"
    payload = b"identical"
    sources = {"national": [{**ENTRY, "filename": "same.zip"}]}

    for invocation_id in ("fetch-a", "fetch-b"):
        _fetch(
            sources,
            FakeFetcher({ENTRY["source_url"]: FetchResponse(200, payload)}),
            local_root,
            manifest_path,
            invocation_id,
        )

    events = load_fetch_events(manifest_path, ENTRY["id"])
    assert [event["event_id"] for event in events] == ["fetch-a", "fetch-b"]
    assert [event["sequence"] for event in events] == [1, 2]
    assert [event["classification"] for event in events] == ["initial", "identical"]
    assert events[0]["fetched_at"] == events[1]["fetched_at"]
    assert len(list((local_root / "national").iterdir())) == 1


def test_failure_and_changed_content_events_preserve_canonical_success(tmp_path) -> None:
    manifest_path = tmp_path / "archive-manifest.json"
    local_root = tmp_path / "archive"
    sources = {"national": [{**ENTRY, "filename": "history.zip"}]}
    outcomes = (
        ("ok-1", FetchResponse(200, b"first")),
        ("failed", FetchResponse(503, b"ignored")),
        ("ok-2", FetchResponse(200, b"changed")),
    )
    for invocation_id, outcome in outcomes:
        _fetch(
            sources,
            FakeFetcher({ENTRY["source_url"]: outcome}),
            local_root,
            manifest_path,
            invocation_id,
        )

    events = load_fetch_events(manifest_path, ENTRY["id"])
    assert [event["classification"] for event in events] == [
        "initial",
        "fetch_error",
        "content_drift",
    ]
    assert events[1]["record"]["sha256"] is None
    assert events[1]["record"]["bytes"] is None
    canonical = next(
        record for record in load_manifest(manifest_path) if record["id"] == ENTRY["id"]
    )
    assert canonical["sha256"] == sha256_of(b"changed")


def test_invocation_retry_is_idempotent_but_distinct_invocations_are_not(tmp_path) -> None:
    manifest_path = tmp_path / "archive-manifest.json"
    local_root = tmp_path / "archive"
    sources = {"national": [{**ENTRY, "filename": "retry.zip"}]}
    fetcher = FakeFetcher({ENTRY["source_url"]: FetchResponse(200, b"same")})

    for invocation_id in ("same-invocation", "same-invocation", "different-invocation"):
        _fetch(sources, fetcher, local_root, manifest_path, invocation_id)

    assert fetcher.calls == [ENTRY["source_url"]] * 3
    assert [event["event_id"] for event in load_fetch_events(manifest_path)] == [
        "same-invocation",
        "different-invocation",
    ]


@pytest.mark.parametrize(
    ("attempt", "shared", "event_count"),
    [
        (FetchResponse(200, b"changed"), False, 1),
        (FetchResponse(200, b"shared"), True, 2),
        (FetchResponse(503, b"failure"), False, 1),
    ],
)
def test_invocation_conflict_preserves_manifest_and_artifacts(
    tmp_path, attempt: FetchResponse, shared: bool, event_count: int
) -> None:
    manifest_path = tmp_path / "archive-manifest.json"
    local_root = tmp_path / "archive"
    other = {**ENTRY, "id": "national/other", "filename": "evidence.zip"}
    sources = {"national": [{**ENTRY, "filename": "evidence.zip"}, other]}
    _fetch(
        sources,
        FakeFetcher({ENTRY["source_url"]: FetchResponse(200, b"first")}),
        local_root,
        manifest_path,
        "same-id",
    )
    if shared:
        _fetch(
            sources,
            FakeFetcher({other["source_url"]: attempt}),
            local_root,
            manifest_path,
            "shared-owner",
            other["id"],
        )
    manifest_before = manifest_path.read_bytes()
    artifacts_before = _artifact_snapshot(local_root)

    with pytest.raises(ValueError, match="invocation.*conflicts"):
        _fetch(
            sources,
            FakeFetcher({ENTRY["source_url"]: attempt}),
            local_root,
            manifest_path,
            "same-id",
        )

    assert manifest_path.read_bytes() == manifest_before
    assert _artifact_snapshot(local_root) == artifacts_before
    assert load_manifest(manifest_path)[0]["status"] == "ok"
    assert len(load_fetch_events(manifest_path)) == event_count


@pytest.mark.parametrize("preexisting", [False, True])
def test_manifest_save_failure_rolls_back_only_new_artifacts(
    tmp_path, monkeypatch: pytest.MonkeyPatch, preexisting: bool
) -> None:
    manifest_path = tmp_path / "archive-manifest.json"
    local_root = tmp_path / "archive"
    payload = b"atomic"
    sources = {"national": [{**ENTRY, "filename": "atomic.zip"}]}
    if preexisting:
        digest = sha256_of(payload)
        LocalArchiveStore(local_root).write("national", f"atomic.{digest}.zip", payload)
    before = _artifact_snapshot(local_root)

    def fail_save(*_args, **_kwargs):
        raise OSError("manifest failed")

    monkeypatch.setattr("etl.__main__.save_manifest", fail_save)
    with pytest.raises(OSError, match="manifest failed"):
        _fetch(
            sources,
            FakeFetcher({ENTRY["source_url"]: FetchResponse(200, payload)}),
            local_root,
            manifest_path,
        )

    assert _artifact_snapshot(local_root) == before


def test_manifest_and_rollback_failures_are_both_reported(tmp_path, monkeypatch) -> None:
    local_root = tmp_path / "archive"

    def fail_save(*_args, **_kwargs):
        raise OSError("manifest failed")

    def fail_unlink(self, *_args, **_kwargs):
        raise OSError("rollback failed")

    monkeypatch.setattr("etl.__main__.save_manifest", fail_save)
    monkeypatch.setattr(type(local_root), "unlink", fail_unlink)
    with pytest.raises(ExceptionGroup) as excinfo:
        _fetch(
            {"national": [{**ENTRY, "filename": "dual.zip"}]},
            FakeFetcher({ENTRY["source_url"]: FetchResponse(200, b"dual")}),
            local_root,
            tmp_path / "archive-manifest.json",
        )

    causes = {str(error) for error in excinfo.value.exceptions}
    assert causes == {"manifest failed", "rollback failed"}


def test_concurrent_distinct_invocations_append_without_lost_history(tmp_path) -> None:
    manifest_path = tmp_path / "archive-manifest.json"
    local_root = tmp_path / "archive"
    sources = {"national": [{**ENTRY, "filename": "concurrent.zip"}]}
    barrier = Barrier(2)

    class ConcurrentFetcher:
        def __init__(self, payload: bytes) -> None:
            self.payload = payload

        def get(self, *_args, **_kwargs):
            barrier.wait()
            return FetchResponse(200, self.payload)

    def run(invocation_id: str, payload: bytes) -> None:
        _fetch(sources, ConcurrentFetcher(payload), local_root, manifest_path, invocation_id)

    with ThreadPoolExecutor(max_workers=2) as executor:
        futures = [
            executor.submit(run, "concurrent-a", b"a"),
            executor.submit(run, "concurrent-b", b"b"),
        ]
        for future in futures:
            future.result()

    events = load_fetch_events(manifest_path)
    assert [event["sequence"] for event in events] == [1, 2]
    assert {event["event_id"] for event in events} == {"concurrent-a", "concurrent-b"}
    assert {event["classification"] for event in events} == {"initial", "content_drift"}


def test_changed_fiscalizacion_hash_is_an_informational_reexport(tmp_path) -> None:
    manifest_path = tmp_path / "archive-manifest.json"
    local_root = tmp_path / "archive"
    sources = {"fiscalizacion": [FISCALIZACION_ENTRY]}

    fetch_source(
        FISCALIZACION_ENTRY["id"],
        sources=sources,
        fetcher=FakeFetcher(
            {FISCALIZACION_ENTRY["source_url"]: FetchResponse(200, b"sheet-shape-v1")}
        ),
        local_root=local_root,
        manifest_path=manifest_path,
    )
    changed = fetch_source(
        FISCALIZACION_ENTRY["id"],
        sources=sources,
        fetcher=FakeFetcher(
            {FISCALIZACION_ENTRY["source_url"]: FetchResponse(200, b"sheet-shape-v2")}
        ),
        local_root=local_root,
        manifest_path=manifest_path,
    )

    assert [(item.kind, item.severity) for item in changed.review_items] == [
        ("source_reexported", "info")
    ]
    assert load_fetch_events(manifest_path)[-1]["classification"] == "source_reexported"
    canonical = next(
        record
        for record in load_manifest(manifest_path)
        if record["id"] == FISCALIZACION_ENTRY["id"]
    )
    assert "source re-export" in _required_string(canonical, "notes").lower()
    assert "content drift" not in _required_string(canonical, "notes").lower()


def test_identical_fiscalizacion_hash_has_no_reexport_item(tmp_path) -> None:
    manifest_path = tmp_path / "archive-manifest.json"
    local_root = tmp_path / "archive"
    sources = {"fiscalizacion": [FISCALIZACION_ENTRY]}
    payload = b"same-sheet-shape"

    first = fetch_source(
        FISCALIZACION_ENTRY["id"],
        sources=sources,
        fetcher=FakeFetcher({FISCALIZACION_ENTRY["source_url"]: FetchResponse(200, payload)}),
        local_root=local_root,
        manifest_path=manifest_path,
    )
    second = fetch_source(
        FISCALIZACION_ENTRY["id"],
        sources=sources,
        fetcher=FakeFetcher({FISCALIZACION_ENTRY["source_url"]: FetchResponse(200, payload)}),
        local_root=local_root,
        manifest_path=manifest_path,
    )

    assert first.review_items == second.review_items == ()
    assert len(load_manifest(manifest_path)) == 1


def test_changed_official_hash_remains_content_drift_warning(tmp_path) -> None:
    manifest_path = tmp_path / "archive-manifest.json"
    local_root = tmp_path / "archive"
    official = {
        **ENTRY,
        "election_year": 2023,
        "election_round": "generales",
        "filename": "2023-generales.zip",
    }
    sources = {"national": [official]}

    fetch_source(
        ENTRY["id"],
        sources=sources,
        fetcher=FakeFetcher({ENTRY["source_url"]: FetchResponse(200, b"official-v1")}),
        local_root=local_root,
        manifest_path=manifest_path,
    )
    changed = fetch_source(
        ENTRY["id"],
        sources=sources,
        fetcher=FakeFetcher({ENTRY["source_url"]: FetchResponse(200, b"official-v2")}),
        local_root=local_root,
        manifest_path=manifest_path,
    )

    assert [(item.kind, item.severity) for item in changed.review_items] == [
        ("content_drift", "warning")
    ]
    assert load_fetch_events(manifest_path)[-1]["classification"] == "content_drift"
    assert all(item.kind != "source_reexported" for item in changed.review_items)
    canonical = next(
        record for record in load_manifest(manifest_path) if record["id"] == ENTRY["id"]
    )
    assert "content drift" in _required_string(canonical, "notes").lower()


@pytest.mark.parametrize(
    ("changed_field", "changed_value"),
    [
        ("election_year", 2026),
        ("election_round", "paso"),
        ("source_kind", "official"),
    ],
)
def test_refetch_refuses_cross_identity_hash_comparison_before_archive_mutation(
    tmp_path, changed_field: str, changed_value: object
) -> None:
    manifest_path = tmp_path / "archive-manifest.json"
    local_root = tmp_path / "archive"
    source_id = FISCALIZACION_ENTRY["id"]
    first_sources = {"fiscalizacion": [FISCALIZACION_ENTRY]}
    fetch_source(
        source_id,
        sources=first_sources,
        fetcher=FakeFetcher(
            {FISCALIZACION_ENTRY["source_url"]: FetchResponse(200, b"identity-v1")}
        ),
        local_root=local_root,
        manifest_path=manifest_path,
    )
    manifest_before = manifest_path.read_bytes()
    files_before = sorted(path.name for path in (local_root / "fiscalizacion").iterdir())
    changed_entry = {**FISCALIZACION_ENTRY, changed_field: changed_value}

    with pytest.raises(ValueError, match="identity.*refus"):
        fetch_source(
            source_id,
            sources={"fiscalizacion": [changed_entry]},
            fetcher=FakeFetcher(
                {FISCALIZACION_ENTRY["source_url"]: FetchResponse(200, b"identity-v2")}
            ),
            local_root=local_root,
            manifest_path=manifest_path,
        )

    assert manifest_path.read_bytes() == manifest_before
    assert sorted(path.name for path in (local_root / "fiscalizacion").iterdir()) == files_before


def test_a_different_registered_source_identity_is_not_compared(tmp_path) -> None:
    manifest_path = tmp_path / "archive-manifest.json"
    local_root = tmp_path / "archive"
    other = {**FISCALIZACION_ENTRY, "id": "fiscalizacion/current-other-source"}
    sources = {"fiscalizacion": [FISCALIZACION_ENTRY, other]}

    fetch_source(
        FISCALIZACION_ENTRY["id"],
        sources=sources,
        fetcher=FakeFetcher({FISCALIZACION_ENTRY["source_url"]: FetchResponse(200, b"source-one")}),
        local_root=local_root,
        manifest_path=manifest_path,
    )
    result = fetch_source(
        other["id"],
        sources=sources,
        fetcher=FakeFetcher({other["source_url"]: FetchResponse(200, b"source-two")}),
        local_root=local_root,
        manifest_path=manifest_path,
    )

    assert result.review_items == ()
    assert {record["id"] for record in load_manifest(manifest_path)} == {
        FISCALIZACION_ENTRY["id"],
        other["id"],
    }


def test_refetch_refuses_malformed_prior_hash_before_archive_mutation(tmp_path) -> None:
    manifest_path = tmp_path / "archive-manifest.json"
    local_root = tmp_path / "archive"
    sources = {"fiscalizacion": [FISCALIZACION_ENTRY]}
    fetch_source(
        FISCALIZACION_ENTRY["id"],
        sources=sources,
        fetcher=FakeFetcher(
            {FISCALIZACION_ENTRY["source_url"]: FetchResponse(200, b"verified-v1")}
        ),
        local_root=local_root,
        manifest_path=manifest_path,
    )
    records = load_manifest(manifest_path)
    records[0]["sha256"] = "not-a-sha256"
    manifest_path.write_text(json.dumps(records), encoding="utf-8")
    manifest_before = manifest_path.read_bytes()
    files_before = sorted(path.name for path in (local_root / "fiscalizacion").iterdir())

    with pytest.raises(ValueError, match="sha256.*hexadecimal"):
        fetch_source(
            FISCALIZACION_ENTRY["id"],
            sources=sources,
            fetcher=FakeFetcher(
                {FISCALIZACION_ENTRY["source_url"]: FetchResponse(200, b"verified-v2")}
            ),
            local_root=local_root,
            manifest_path=manifest_path,
        )

    assert manifest_path.read_bytes() == manifest_before
    assert sorted(path.name for path in (local_root / "fiscalizacion").iterdir()) == files_before


@pytest.mark.parametrize(
    ("changed_field", "changed_value", "capability"),
    [
        ("election_year", 2026, "fiscalizacion"),
        ("election_round", "paso", "fiscalizacion"),
        ("source_kind", None, "national"),
    ],
)
def test_failed_prior_refuses_explicit_identity_conflict_before_archive_mutation(
    tmp_path, changed_field: str, changed_value: object, capability: str
) -> None:
    manifest_path = tmp_path / "archive-manifest.json"
    local_root = tmp_path / "archive"
    source_id = FISCALIZACION_ENTRY["id"]
    failed = fetch_source(
        source_id,
        sources={"fiscalizacion": [FISCALIZACION_ENTRY]},
        fetcher=FakeFetcher(
            {FISCALIZACION_ENTRY["source_url"]: FetchResponse(503, b"failed-shape")}
        ),
        local_root=local_root,
        manifest_path=manifest_path,
    )
    assert failed.record["status"] == "error"
    manifest_before = manifest_path.read_bytes()
    changed_entry = dict(FISCALIZACION_ENTRY)
    if changed_field == "source_kind":
        changed_entry.pop("source_kind")
        changed_entry.pop("upload")
    else:
        changed_entry[changed_field] = changed_value
    new_bytes = b"successful-shape"

    with pytest.raises(ValueError, match="identity.*refus"):
        fetch_source(
            source_id,
            sources={capability: [changed_entry]},
            fetcher=FakeFetcher({FISCALIZACION_ENTRY["source_url"]: FetchResponse(200, new_bytes)}),
            local_root=local_root,
            manifest_path=manifest_path,
        )

    assert manifest_path.read_bytes() == manifest_before
    expected_archive = local_root / capability / f"fiscalizacion.{sha256_of(new_bytes)}.csv"
    assert not expected_archive.exists()


def test_matching_failed_prior_produces_no_false_hash_classification(tmp_path) -> None:
    manifest_path = tmp_path / "archive-manifest.json"
    local_root = tmp_path / "archive"
    sources = {"fiscalizacion": [FISCALIZACION_ENTRY]}
    failed = fetch_source(
        FISCALIZACION_ENTRY["id"],
        sources=sources,
        fetcher=FakeFetcher(
            {FISCALIZACION_ENTRY["source_url"]: FetchResponse(503, b"failed-shape")}
        ),
        local_root=local_root,
        manifest_path=manifest_path,
    )
    assert failed.record["status"] == "error"

    successful = fetch_source(
        FISCALIZACION_ENTRY["id"],
        sources=sources,
        fetcher=FakeFetcher(
            {FISCALIZACION_ENTRY["source_url"]: FetchResponse(200, b"successful-shape")}
        ),
        local_root=local_root,
        manifest_path=manifest_path,
    )

    assert successful.review_items == ()
    records = load_manifest(manifest_path)
    assert len(records) == 1
    assert records[0]["status"] == "ok"
    assert "drift" not in _required_string(records[0], "notes").lower()
    assert "re-export" not in _required_string(records[0], "notes").lower()


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
