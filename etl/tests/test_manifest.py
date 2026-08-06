"""Unit tests for the provenance manifest helpers (etl.manifest).

Schema per design D2/D8 and the ``source-archive`` spec: every archived
fetch records URL, sha256, fetch timestamp and byte size (D2's immutable
manifest, committed alongside the gitignored ``archive/`` byte mirror).
"""

import json

import pytest

from etl.manifest import (
    REQUIRED_FIELDS,
    latest_ok_record,
    load_manifest,
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
    # The FULL timestamp, not just the date: two drifts on ONE calendar day
    # produced two records sharing the dated id, and `latest_ok_record`
    # refuses a duplicated id -- so the writer that maintains one-per-id was
    # what broke it, making that capture permanently unreadable.
    assert "national/2023-generales@2026-06-01T000000Z" in ids

    canonical = next(r for r in updated if r["id"] == "national/2023-generales")
    assert canonical["sha256"] == "b" * 64
    assert "drift" in canonical["notes"].lower()

    prior = next(
        r for r in updated if r["id"] == "national/2023-generales@2026-06-01T000000Z"
    )
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


def test_latest_ok_record_returns_the_single_record_upsert_left_for_the_id() -> None:
    """There is no "most recent" to choose, and choosing is what this stopped
    doing: `upsert_record` replaces by id, and `latest_ok_record` now refuses
    a manifest holding two records for one id. The drift capture is preserved
    under a DATED id, so the canonical id carries exactly one record.
    """
    records = upsert_record([], _record(fetched_at="2026-06-01T00:00:00Z", sha256="a" * 64))
    records = upsert_record(
        records, _record(fetched_at="2026-08-03T00:00:00Z", sha256="b" * 64)
    )

    found = latest_ok_record(records, "national/2023-generales")
    assert found is not None
    assert found["sha256"] == "b" * 64


def test_two_records_for_one_id_are_refused_not_picked_between() -> None:
    """`upsert_record` replaces by id, so a well-formed manifest holds one
    record per id. Scanning for the FIRST match silently chose between two
    archived copies of one source -- deciding which bytes reach `result_row`.
    """
    from etl.manifest import DuplicateManifestRecordError

    records = [
        {"id": "national/2025", "status": "ok", "sha256": "aaa"},
        {"id": "national/2025", "status": "ok", "sha256": "bbb"},
    ]

    with pytest.raises(DuplicateManifestRecordError):
        latest_ok_record(records, "national/2025")


def test_a_stale_error_record_does_not_mask_the_archived_copy() -> None:
    """The scan returned the first record for the id and answered `None` if it
    was not `ok`, so an `error` record sitting ahead of an `ok` one reported
    "never archived" for a source that IS archived.

    `upsert_record` never produces that pair -- a failed re-fetch PRESERVES
    the ok record and annotates it -- which is why the one-per-id invariant is
    the thing to check.
    """
    preserved = upsert_record(
        [_record(sha256="a" * 64)],
        _record(status="error", sha256=None, notes="502"),
    )

    current = latest_ok_record(preserved, "national/2023-generales")
    assert current is not None, "a failed re-fetch must not hide the archived copy"
    assert current["sha256"] == "a" * 64
    assert current["last_error"] == "502"
