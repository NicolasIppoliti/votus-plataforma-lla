"""Measure 2025 national mesa identity domains from a registered archive (#484).

Usage, from `etl/` with its pinned environment:

    .venv/bin/python ../spikes/scripts/mesa_identity_scan.py \
        ../archive/national/2025-legislativas.zip <scratch-dir>

Prints raw counts (every source row, before filtering) and accepted-row counts
(rows the production parser emits). Prints counts only, never identifiers.
"""

from __future__ import annotations

import hashlib
import io
import shutil
import sys
import tempfile
import zipfile

from etl.ingest.national import extract_raw_mesa_identities_from_text, iter_national_rows

RESULTS = "resultados2025.csv"
COMPANION = "localesDeVotacionyMesas.csv"


def main(archive: str, scratch: str) -> None:
    with open(archive, "rb") as handle:
        print("archive sha256", hashlib.sha256(handle.read()).hexdigest())
    z = zipfile.ZipFile(archive)
    with z.open(RESULTS) as f:
        text = io.TextIOWrapper(f, encoding="utf-8", newline="")
        raw = extract_raw_mesa_identities_from_text(text)
    print("raw: distrito/seccion/circuito/mesa identities", len(raw))
    print("raw: distinct mesa numbers", len({m for *_, m in raw}))
    print("raw: distinct distrito/mesa pairs", len({(d, m) for d, _, _, m in raw}))

    companion = z.read(COMPANION) if COMPANION in z.namelist() else None
    with tempfile.TemporaryFile(mode="w+", encoding="utf-8", newline="", dir=scratch) as tmp:
        with z.open(RESULTS) as f:
            shutil.copyfileobj(io.TextIOWrapper(f, encoding="utf-8", newline=""), tmp)
        tmp.seek(0)
        rows = 0
        mesas, pairs, lineages = set(), set(), set()
        for row in iter_national_rows(tmp, archive_entry_id="national/2025-legislativas",
                                      election_year=2025, election_round="legislativas",
                                      establecimientos_csv_bytes=companion):
            rows += 1
            r = row.result
            if r.mesa is None:
                continue
            mesas.add(r.mesa)
            pairs.add((r.distrito, r.mesa))
            lineages.add((r.distrito, r.seccion, r.circuito, r.establecimiento, r.mesa))
    print("accepted: rows", rows)
    print("accepted: distinct mesa numbers", len(mesas))
    print("accepted: distinct distrito/mesa pairs", len(pairs))
    print("accepted: distinct full lineages", len(lineages))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
