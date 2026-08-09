"""Unit tests for the provenance manifest helpers (etl.manifest).

Schema per design D2/D8 and the ``source-archive`` spec: every archived
fetch records URL, sha256, fetch timestamp and byte size (D2's immutable
manifest, committed alongside the gitignored ``archive/`` byte mirror).
"""

import json
from collections.abc import Mapping
from pathlib import Path
from unittest.mock import patch

import pytest

from etl.manifest import (
    REQUIRED_FIELDS,
    ManifestRecord,
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


def _required_string(record: Mapping[str, object], field: str) -> str:
    value = record[field]
    assert isinstance(value, str), f"{field} must be a string in this valid-record test"
    return value


def test_load_manifest_returns_empty_list_when_missing(tmp_path) -> None:
    assert load_manifest(tmp_path / "archive-manifest.json") == []


def test_load_manifest_wraps_invalid_json_with_path_context(tmp_path) -> None:
    from etl.manifest import MalformedManifestError

    path = tmp_path / "archive-manifest.json"
    path.write_text("not valid JSON", encoding="utf-8")

    with pytest.raises(MalformedManifestError, match=str(path)) as excinfo:
        load_manifest(path)

    assert isinstance(excinfo.value.__cause__, json.JSONDecodeError)


def test_load_manifest_wraps_read_errors_with_path_context(tmp_path) -> None:
    from etl.manifest import MalformedManifestError

    path = tmp_path / "archive-manifest.json"
    path.touch()
    read_error = OSError("permission denied")

    with (
        patch.object(Path, "read_text", side_effect=read_error),
        pytest.raises(MalformedManifestError, match=str(path)) as excinfo,
    ):
        load_manifest(path)

    assert excinfo.value.__cause__ is read_error


@pytest.mark.parametrize("payload", [{}, ["not-a-record"]])
def test_load_manifest_rejects_non_array_or_non_mapping_records(tmp_path, payload) -> None:
    from etl.manifest import MalformedManifestError

    path = tmp_path / "archive-manifest.json"
    path.write_text(json.dumps(payload), encoding="utf-8")

    with pytest.raises(MalformedManifestError):
        load_manifest(path)


def test_save_then_load_roundtrips(tmp_path) -> None:
    path = tmp_path / "archive-manifest.json"
    save_manifest(path, [_record()])

    loaded = load_manifest(path)
    assert loaded == [_record()]
    assert path.read_text(encoding="utf-8").endswith("]\n")


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("id", ""),
        ("id", 123),
        ("status", "pending"),
        ("status", 1),
        ("capability", 1),
        ("source", False),
        ("source_url", 1),
        ("archived_path", 123),
        ("sha256", False),
        ("mime", None),
        ("bytes", -1),
        ("bytes", True),
        ("fetched_at", 1),
        ("notes", []),
        ("last_error", 500),
        ("last_error_at", None),
    ],
)
def test_load_manifest_rejects_wrong_types_for_known_fields(
    tmp_path: Path, field: str, value: object
) -> None:
    from etl.manifest import MalformedManifestError

    path = tmp_path / "archive-manifest.json"
    path.write_text(json.dumps([_record(**{field: value})]), encoding="utf-8")

    with pytest.raises(MalformedManifestError, match=field):
        load_manifest(path)


def test_load_manifest_accepts_legacy_minimal_records_and_nullable_fields(tmp_path: Path) -> None:
    path = tmp_path / "archive-manifest.json"
    records = [
        {"id": "legacy/error", "status": "error"},
        {
            "id": "legacy/nullable",
            "status": "error",
            "source_url": None,
            "archived_path": None,
            "sha256": None,
            "bytes": None,
            "last_error": None,
            "last_error_at": "2026-08-04T00:00:00Z",
        },
    ]
    path.write_text(json.dumps(records), encoding="utf-8")

    assert load_manifest(path) == records


def test_upsert_rejects_wrong_types_at_the_writer_boundary() -> None:
    from etl.manifest import MalformedManifestError

    with pytest.raises(MalformedManifestError, match="bytes"):
        upsert_record([], _record(bytes=True))


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

    ids = {_required_string(r, "id") for r in updated}
    assert "national/2023-generales" in ids
    historical_id = f"national/2023-generales@2026-06-01T000000Z-{'a' * 64}"
    assert historical_id in ids

    canonical = next(r for r in updated if r["id"] == "national/2023-generales")
    assert canonical["sha256"] == "b" * 64
    assert "drift" in _required_string(canonical, "notes").lower()

    prior = next(r for r in updated if r["id"] == historical_id)
    assert prior["sha256"] == "a" * 64
    assert "superseded" in _required_string(prior, "notes").lower()


def test_repeated_same_second_drifts_preserve_every_capture_with_unique_readable_ids() -> None:
    fetched_at = "2026-08-03T20:00:00Z"
    canonical_id = "national/2023-generales"
    captures = [
        ("a" * 64, "archive/national/a.zip"),
        ("b" * 64, "archive/national/b.zip"),
        ("a" * 64, "archive/national/a-again.zip"),
        ("c" * 64, "archive/national/c.zip"),
    ]

    records: list[ManifestRecord] = []
    for sha256, archived_path in captures:
        records = upsert_record(
            records,
            _record(fetched_at=fetched_at, sha256=sha256, archived_path=archived_path),
        )

    ids = [_required_string(record, "id") for record in records]
    assert len(ids) == len(set(ids)) == len(captures)
    stamp = "2026-08-03T200000Z"
    expected = {
        f"{canonical_id}@{stamp}-{'a' * 64}": ("a" * 64, "archive/national/a.zip"),
        f"{canonical_id}@{stamp}-{'b' * 64}": ("b" * 64, "archive/national/b.zip"),
        f"{canonical_id}@{stamp}-{'a' * 64}-2": (
            "a" * 64,
            "archive/national/a-again.zip",
        ),
        canonical_id: ("c" * 64, "archive/national/c.zip"),
    }
    assert set(ids) == set(expected)
    for record_id, (sha256, archived_path) in expected.items():
        found = latest_ok_record(records, record_id)
        assert found is not None
        assert found["sha256"] == sha256
        assert found["archived_path"] == archived_path


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
    assert "429" in _required_string(preserved, "last_error")
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
    records = upsert_record(records, _record(fetched_at="2026-08-03T00:00:00Z", sha256="b" * 64))

    found = latest_ok_record(records, "national/2023-generales")
    assert found is not None
    assert found["sha256"] == "b" * 64


def test_upsert_refuses_existing_duplicate_ids_before_building_a_result() -> None:
    from etl.manifest import DuplicateManifestRecordError

    duplicate_id = "national/2023-generales"
    records = [
        _record(id=duplicate_id, sha256="a" * 64),
        _record(id=duplicate_id, sha256="b" * 64),
    ]

    with pytest.raises(
        DuplicateManifestRecordError,
        match=r"2 records for 'national/2023-generales'",
    ):
        upsert_record(records, _record(id=duplicate_id, sha256="c" * 64))

    assert records[0]["sha256"] == "a" * 64
    assert records[1]["sha256"] == "b" * 64


def test_upsert_refuses_duplicate_ids_unrelated_to_the_incoming_record() -> None:
    from etl.manifest import DuplicateManifestRecordError

    records = [
        _record(id="other/duplicate", sha256="a" * 64),
        _record(id="other/duplicate", sha256="b" * 64),
    ]

    with pytest.raises(
        DuplicateManifestRecordError,
        match=r"2 records for 'other/duplicate'",
    ):
        upsert_record(records, _record(id="new/canonical", sha256="c" * 64))


def test_two_records_for_one_id_are_refused_not_picked_between() -> None:
    """`upsert_record` replaces by id, so a well-formed manifest holds one
    record per id. Scanning for the FIRST match silently chose between two
    archived copies of one source -- deciding which bytes reach `result_row`.
    """
    from etl.manifest import DuplicateManifestRecordError

    records: list[ManifestRecord] = [
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
