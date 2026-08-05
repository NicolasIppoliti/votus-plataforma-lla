#!/usr/bin/env python3
"""fetch_pba_2025.py
14d, task 14.10: a deliberate, one-off runtime step that fetches the five
registered PBA `sources.yaml` entries under design D10's full etiquette
contract -- serial (concurrency 1), >=4s apart, an identifying User-Agent,
TLS verification on (never bypassed), registered paths only, bounded
retry then stop, and a halt-and-escalate re-check on `robots.txt` before
anything else is fetched.

Every constraint this exercises is already covered by
`etl/tests/test_ingest_pba.py` against fakes -- this script is not a new
unit-tested code path, it is the actual, real invocation whose OUTPUT
(archived bytes under `archive/pba/`, new `archive-manifest.json`
entries) is this task's recorded evidence. A fetch failure for any entry
IS the finding to report, not something to retry past the bounded backoff
or paper over.

Run once, manually, from the repo root:

    cd etl && uv run python ../scripts/fetch_pba_2025.py
"""

from __future__ import annotations

import sys
from pathlib import Path

import yaml

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "etl"))

from etl.http_client import (  # noqa: E402
    PolicedHostFetcher,
    RequestsFetcher,
    check_robots_txt_still_absent,
)
from etl.ingest.pba import PBA_HOST, PBA_HOST_POLICY, archive_pba_source  # noqa: E402
from etl.manifest import load_manifest, save_manifest, upsert_record  # noqa: E402
from etl.storage import LocalArchiveStore  # noqa: E402

SOURCES_PATH = REPO_ROOT / "etl" / "sources.yaml"
LOCAL_ROOT = REPO_ROOT / "archive"
MANIFEST_PATH = REPO_ROOT / "archive-manifest.json"


def main() -> int:
    sources = yaml.safe_load(SOURCES_PATH.read_text(encoding="utf-8"))
    # `archive_source` (etl/etl/archive.py) requires each entry to carry its
    # own `capability` key -- `sources.yaml` groups entries under a
    # top-level `pba:` key instead, the same shape `__main__.py::load_sources`
    # /`find_source_entry` already normalizes for the CLI's own `fetch`/
    # `ingest` commands.
    pba_entries = [{**entry, "capability": "pba"} for entry in sources["pba"]]

    transport = RequestsFetcher()

    # D10 constraint 8: re-check, before fetching anything, that
    # robots.txt has not started returning 200. Raises and halts the
    # whole run if it has -- never parses and proceeds.
    check_robots_txt_still_absent(transport, PBA_HOST)

    policed = PolicedHostFetcher(transport, PBA_HOST_POLICY)
    local_store = LocalArchiveStore(root=LOCAL_ROOT)
    records = load_manifest(MANIFEST_PATH)

    exit_code = 0
    for entry in pba_entries:
        result = archive_pba_source(
            entry, fetcher=policed, local_store=local_store, records=records
        )
        records = upsert_record(records, result.record)
        save_manifest(MANIFEST_PATH, records)

        status = result.record["status"]
        print(f"{entry['id']}: {status} -> {result.record.get('archived_path')}")
        if status != "ok":
            exit_code = 1
            print(f"  FAILURE (this is the finding): {result.record.get('notes')}")

    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
