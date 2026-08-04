"""Unit tests for the provenance manifest helpers (etl.manifest).

Schema per design D2/D8 and the ``source-archive`` spec: every archived
fetch records URL, sha256, fetch timestamp and byte size (D2's immutable
manifest, committed alongside the gitignored ``archive/`` byte mirror).
"""

import json

from etl.manifest import (
    REQUIRED_FIELDS,
    entries_for_source,
    latest_ok_record,
    load_manifest,
    ok_records_with_local_path,
    save_manifest,
    upsert_record,
)


def _record(**overrides: object) -> dict:
    base = {
        "id": "national/2023-generales",
        "capability": "national",
        "source": "argentina.gob.ar",
        "source_url": "https://www.argentina.gob.ar/sites/default/files/2023_generales_1.zip",
        "archived_path": "archive/national/2023-generales.zip",
        "sha256": "a" * 64,
        "mime": "application/zip",
        "bytes": 28028857,
        "fetched_at": "2026-08-03T20:00:00Z",
        "status": "ok",
        "notes": "",
    }
    base.update(overrides)
    return base


def test_load_manifest_returns_empty_list_when_missing(tmp_path) -> None:
    assert load_manifest(tmp_path / "archive-manifest.json") == []


def test_save_then_load_roundtrips(tmp_path) -> None:
    path = tmp_path / "archive-manifest.json"
    save_manifest(path, [_record()])

    loaded = load_manifest(path)
    assert loaded == [_record()]
    assert path.read_text(encoding="utf-8").endswith("]\n")


def test_required_fields_present_in_fixture_record() -> None:
    record = _record()
    for field in REQUIRED_FIELDS:
        assert field in record


def test_manifest_entry_created_per_fetch() -> None:
    """source-archive spec: 'Manifest entry created per fetch' — the
    manifest gains an entry with URL, sha256, timestamp and size."""
    updated = upsert_record([], _record())

    assert len(updated) == 1
    entry = updated[0]
    assert entry["source_url"] == _record()["source_url"]
    assert entry["sha256"] == "a" * 64
    assert entry["fetched_at"] == "2026-08-03T20:00:00Z"
    assert entry["bytes"] == 28028857


def test_manifest_queryable_by_source() -> None:
    """source-archive spec: 'Manifest queryable by source' — returns every
    archive entry for a URL, in fetch order."""
    first = _record(fetched_at="2026-08-01T00:00:00Z", sha256="a" * 64)
    records = upsert_record([], first)
    second_input = _record(
        id="national/2025-legislativas",
        source_url="https://datos.mininterior.gob.ar/legislativas2025.zip",
        fetched_at="2026-08-02T00:00:00Z",
        sha256="b" * 64,
    )
    records = upsert_record(records, second_input)

    matches = entries_for_source(records, first["source_url"])
    assert [r["id"] for r in matches] == ["national/2023-generales"]

    unrelated = entries_for_source(records, "https://example.org/never-archived.zip")
    assert unrelated == []


def test_upsert_inserts_new_record() -> None:
    result = upsert_record([], _record())
    assert len(result) == 1
    assert result[0]["id"] == "national/2023-generales"


def test_upsert_replaces_record_with_same_id_and_same_hash() -> None:
    existing = [_record(notes="first fetch")]
    updated = upsert_record(existing, _record(notes="second fetch, same content"))

    assert len(updated) == 1
    assert updated[0]["notes"] == "second fetch, same content"


def test_upsert_detects_content_drift_and_keeps_prior_version() -> None:
    existing = [_record(fetched_at="2026-06-01T00:00:00Z", sha256="a" * 64)]
    drifted = _record(fetched_at="2026-08-03T00:00:00Z", sha256="b" * 64)

    updated = upsert_record(existing, drifted)

    ids = {r["id"] for r in updated}
    assert "national/2023-generales" in ids
    assert "national/2023-generales@2026-06-01" in ids

    canonical = next(r for r in updated if r["id"] == "national/2023-generales")
    assert canonical["sha256"] == "b" * 64
    assert "drift" in canonical["notes"].lower()

    prior = next(r for r in updated if r["id"] == "national/2023-generales@2026-06-01")
    assert prior["sha256"] == "a" * 64
    assert "superseded" in prior["notes"].lower()


def test_upsert_does_not_flag_drift_when_prior_status_was_error() -> None:
    existing = [_record(status="error", sha256=None)]
    fresh = _record(status="ok", sha256="c" * 64)

    updated = upsert_record(existing, fresh)

    assert len(updated) == 1
    assert updated[0]["status"] == "ok"


def test_upsert_preserves_prior_ok_record_when_incoming_fetch_fails() -> None:
    existing = [_record(status="ok", sha256="a" * 64, archived_path="archive/national/f.zip")]
    failed_attempt = _record(
        status="error",
        sha256=None,
        archived_path=None,
        fetched_at="2026-08-04T00:00:00Z",
        notes="[HTTP 429]",
    )

    updated = upsert_record(existing, failed_attempt)

    assert len(updated) == 1
    preserved = updated[0]
    assert preserved["status"] == "ok"
    assert preserved["sha256"] == "a" * 64
    assert preserved["archived_path"] == "archive/national/f.zip"
    assert preserved.get("last_error")
    assert "429" in preserved["last_error"]
    assert preserved.get("last_error_at") == "2026-08-04T00:00:00Z"


def test_upsert_still_overwrites_when_prior_status_was_already_error() -> None:
    existing = [_record(status="error", sha256=None, notes="[HTTP 429]")]
    fresh_failure = _record(status="error", sha256=None, notes="[HTTP 500]")

    updated = upsert_record(existing, fresh_failure)

    assert len(updated) == 1
    assert updated[0]["notes"] == "[HTTP 500]"


def test_ok_records_with_local_path_returns_matching_records() -> None:
    records = [
        _record(id="a", status="ok", archived_path="archive/a.zip"),
        _record(id="b", status="ok", archived_path=None),
        _record(id="c", status="error", archived_path=None),
    ]
    result = ok_records_with_local_path(records)
    assert [r["id"] for r in result] == ["a"]


def test_ok_records_with_local_path_returns_empty_when_none_qualify() -> None:
    records = [
        _record(id="b", status="ok", archived_path=None),
        _record(id="c", status="error", archived_path="archive/c.zip"),
    ]
    assert ok_records_with_local_path(records) == []


def test_manifest_is_valid_json_array(tmp_path) -> None:
    path = tmp_path / "archive-manifest.json"
    save_manifest(path, [_record(), _record(id="other/id")])

    parsed = json.loads(path.read_text(encoding="utf-8"))
    assert isinstance(parsed, list)
    assert len(parsed) == 2


def test_latest_ok_record_returns_none_when_source_never_succeeded() -> None:
    """source-archive spec: 'Source has never been successfully fetched and
    is unreachable' — downstream code must be able to detect this and
    report data as unavailable rather than substituting empty/default
    results."""
    records = [_record(id="national/2023-generales", status="error", sha256=None)]

    assert latest_ok_record(records, "national/2023-generales") is None


def test_latest_ok_record_returns_most_recent_ok_entry() -> None:
    records = upsert_record([], _record(fetched_at="2026-06-01T00:00:00Z", sha256="a" * 64))
    records = upsert_record(
        records, _record(fetched_at="2026-08-03T00:00:00Z", sha256="b" * 64)
    )

    found = latest_ok_record(records, "national/2023-generales")
    assert found is not None
    assert found["sha256"] == "b" * 64
