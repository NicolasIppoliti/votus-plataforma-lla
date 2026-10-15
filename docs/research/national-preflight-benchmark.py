"""DB-free #482 measurement; fresh processes, streaming ZIP extraction and rows.

Run from etl/ with the selected worktree's environment. Output is exclusive-create.
Extracted public source members are retained under /tmp (no cleanup operation).
Timings exclude extraction, imports and parity hashing. A separate untimed child
hashes every ordered emitted field, completeness, metrics and exclusion report.
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import platform
import resource
import shutil
import statistics
import subprocess
import sys
import tempfile
import time
import zipfile
from contextlib import redirect_stderr
from dataclasses import asdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "etl"))

from etl.ingest.national import build_national_completeness, iter_national_rows  # noqa: E402
from etl.ingest_metrics import IngestMetrics  # noqa: E402


class Scans:
    def __init__(self, stream):
        self.stream = stream
        self.scans = 0

    def __iter__(self):
        self.scans += 1
        return iter(self.stream)

    def seek(self, *args):
        return self.stream.seek(*args)


def canonical(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=True, separators=(",", ":")).encode()


def child(args):
    companion = Path(args.companion).read_bytes() if args.companion else None
    metrics = IngestMetrics() if args.fingerprint else None
    report = io.StringIO()
    digest = hashlib.sha256()
    count = 0
    with Path(args.member).open(encoding="utf-8-sig", newline="") as stream:
        scans = Scans(stream)
        with redirect_stderr(report):
            wall = time.perf_counter()
            cpu = time.process_time()
            for row in iter_national_rows(
                scans,
                archive_entry_id=args.source,
                election_year=args.year,
                election_round=args.round,
                establecimientos_csv_bytes=companion,
                metrics=metrics,
            ):
                count += 1
                if args.fingerprint:
                    digest.update(canonical(asdict(row)) + b"\n")
            cpu = time.process_time() - cpu
            wall = time.perf_counter() - wall
        parser_scans = scans.scans
        if args.fingerprint:
            with redirect_stderr(report):
                completeness = build_national_completeness(
                    scans, establecimientos_csv_bytes=companion, source_label=args.source
                )
    rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    result = {
        "wall_seconds": wall,
        "cpu_seconds": cpu,
        "peak_rss_bytes": rss if sys.platform == "darwin" else rss * 1024,
        "rows": count,
        "parser_scans": parser_scans,
    }
    if args.fingerprint:
        result = {
            "rows": count,
            "ordered_rows_sha256": digest.hexdigest(),
            "completeness_sha256": hashlib.sha256(canonical(asdict(completeness))).hexdigest(),
            "metrics_sha256": hashlib.sha256(canonical(metrics.data)).hexdigest(),
            "stderr_sha256": hashlib.sha256(report.getvalue().encode()).hexdigest(),
            "parser_scans": parser_scans,
            "total_scans_with_completeness": scans.scans,
        }
    print(json.dumps(result))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive")
    parser.add_argument("--output")
    parser.add_argument("--source", required=True)
    parser.add_argument("--year", required=True, type=int)
    parser.add_argument("--round", required=True)
    parser.add_argument("--repetitions", type=int, default=3)
    parser.add_argument("--member")
    parser.add_argument("--companion")
    parser.add_argument("--fingerprint", action="store_true")
    args = parser.parse_args()
    if args.member:
        child(args)
        return
    if args.repetitions < 3:
        parser.error("at least three repetitions required")
    archive = Path(args.archive)
    with archive.open("rb") as stream:
        archive_sha = hashlib.file_digest(stream, "sha256").hexdigest()
    extracted = Path(tempfile.mkdtemp(prefix="votus-482-", dir="/tmp"))
    with zipfile.ZipFile(archive) as bundle:
        candidates = [
            name
            for name in bundle.namelist()
            if "resultados" in Path(name).name.lower() and not name.startswith("__MACOSX/")
        ]
        if len(candidates) != 1:
            raise ValueError("expected exactly one result member")
        members = candidates + [
            name for name in bundle.namelist() if Path(name).name == "localesDeVotacionyMesas.csv"
        ]
        for member in members:
            with bundle.open(member) as src, (extracted / Path(member).name).open("xb") as dst:
                shutil.copyfileobj(src, dst)
    command = [
        sys.executable,
        str(Path(__file__).resolve()),
        "--member",
        str(extracted / Path(candidates[0]).name),
        "--source",
        args.source,
        "--year",
        str(args.year),
        "--round",
        args.round,
    ]
    if len(members) > 1:
        command += ["--companion", str(extracted / Path(members[1]).name)]
    runs = []
    for index in range(args.repetitions):
        run = json.loads(subprocess.check_output(command, text=True))
        runs.append(run)
        print(f"run {index + 1}: {json.dumps(run)}", flush=True)
    parity = json.loads(subprocess.check_output(command + ["--fingerprint"], text=True))
    document = {
        "python": platform.python_version(),
        "platform": platform.platform(),
        "archive_sha256": archive_sha,
        "source": args.source,
        "conditions": "fresh subprocesses; warm/uncontrolled OS cache; no metrics in timed runs; companion when present; extraction/imports excluded; no DB",
        "runs": runs,
        "medians": {
            name: statistics.median(run[name] for run in runs)
            for name in ("wall_seconds", "cpu_seconds", "peak_rss_bytes")
        },
        "parity": parity,
    }
    with Path(args.output).open("x") as output:
        json.dump(document, output, indent=2)
        output.write("\n")
    print(json.dumps(document, indent=2), flush=True)


if __name__ == "__main__":
    main()
