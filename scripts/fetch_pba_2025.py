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
fetch implementation, it is the actual canonical CLI invocation whose OUTPUT
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

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "etl"))

import etl.__main__ as cli  # noqa: E402

SOURCES_PATH = REPO_ROOT / "etl" / "sources.yaml"
LOCAL_ROOT = REPO_ROOT / "archive"
MANIFEST_PATH = REPO_ROOT / "archive-manifest.json"


def main() -> int:
    sources = cli.load_sources(SOURCES_PATH)
    exit_code = 0
    for entry in sources.get("pba", []):
        result = cli.main(
            [
                "--sources-path",
                str(SOURCES_PATH),
                "--local-root",
                str(LOCAL_ROOT),
                "--manifest-path",
                str(MANIFEST_PATH),
                "fetch",
                "--source",
                entry["id"],
            ]
        )
        exit_code = max(exit_code, result)
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
