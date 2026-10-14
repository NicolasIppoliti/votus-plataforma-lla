"""Explicit local-only, owned-database national benchmark. Never runs implicitly."""

import argparse
import hashlib
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path
from statistics import median
from time import perf_counter_ns

import psycopg
from psycopg.conninfo import conninfo_to_dict, make_conninfo

from .__main__ import REPO_ROOT, find_source_entry, load_sources, registered_source_election
from .ingest_metrics import metrics_report
from .verify import DisposablePostgres


def statistics(samples):
    return {
        "median": median(samples),
        "min": min(samples),
        "max": max(samples),
        "runs": len(samples),
    }


def logical_fingerprint(dsn, source, year, round_):
    """Stream sorted full logical rows; omit generated UUIDs, never publish rows."""
    queries = {
        "results": """select jsonb_build_array(e.year, e.round, r.archive_entry_id,
            j.distrito_code, j.seccion_code, j.circuito_code, j.establecimiento_code,
            j.mesa_code, j.distrito_name, j.seccion_name, j.circuito_name,
            j.establecimiento_name, c.name, r.granularity, r.requested_granularity,
            r.list_id, r.votes, r.source_kind, r.source_row_index, r.mesa_tipo)::text
            from result_row r join jurisdiction j on j.id=r.jurisdiction_id
            join category c on c.id=r.category_id join election e on e.id=r.election_id
            where r.archive_entry_id=%s and e.year=%s and e.round=%s order by 1""",
        "expected": """select jsonb_build_array(e.year, e.round, r.archive_entry_id,
            r.distrito_code, r.seccion_code, r.mesa_code, r.mesa_tipo,
            r.electores, r.source_row_index)::text
            from official_expected_mesa r join election e on e.id=r.election_id
            where r.archive_entry_id=%s and e.year=%s and e.round=%s order by 1""",
        "statuses": """select jsonb_build_array(e.year, e.round, r.archive_entry_id,
            c.name, r.distrito_code, r.seccion_code, r.circuito_code, r.mesa_code,
            r.count_status)::text from official_mesa_count_status r
            join category c on c.id=r.category_id join election e on e.id=r.election_id
            where r.archive_entry_id=%s and e.year=%s and e.round=%s order by 1""",
        "quarantines": """select jsonb_build_array(e.year, e.round, r.archive_entry_id,
            r.scope, c.name, r.distrito_code, r.seccion_code, r.mesa_code, r.reason)::text
            from official_mesa_completeness_quarantine r
            left join category c on c.id=r.category_id join election e on e.id=r.election_id
            where r.archive_entry_id=%s and e.year=%s and e.round=%s order by 1""",
    }
    result = {}
    with psycopg.connect(dsn) as conn:
        for name, query in queries.items():
            digest = hashlib.sha256()
            count = 0
            with conn.cursor(name="benchmark_readback") as cur:
                cur.execute(query, (source, year, round_))
                for (value,) in cur:
                    digest.update(value.encode())
                    digest.update(b"\n")
                    count += 1
            result[name] = {"rows": count, "sha256": digest.hexdigest()}
    return result


def local_admin():
    dsn = os.environ.get("ETL_BENCH_ADMIN_DATABASE_URL")
    if not dsn:
        raise ValueError("explicit local maintenance connection required")
    values = conninfo_to_dict(dsn)
    # Reject service files, multi-host strings, ambient host/port/database settings,
    # hostname resolution and hostaddr overrides. Credentials remain in memory only.
    if (
        values.get("host") not in {"127.0.0.1", "::1"}
        or values.get("dbname") != "template1"
        or not values.get("port", "").isdigit()
        or any(key in values for key in ("service", "hostaddr"))
        or any(os.environ.get(key) for key in ("PGHOSTADDR", "PGSERVICE", "PGSERVICEFILE"))
    ):
        raise ValueError("benchmark requires explicit loopback host, port and template1")
    return dsn


def clone_schema(admin, database, schema_database):
    """Clone schema only: migrations creating cluster-wide roles cannot be replayed."""
    if schema_database in {"template0", "template1"}:
        raise ValueError("schema source must be an explicitly migrated local database")
    schema_dsn = make_conninfo(admin, dbname=schema_database)
    completed = subprocess.run(
        [
            "pg_dump",
            "--format=custom",
            "--schema-only",
            "--no-owner",
            "--schema=public",
            "--schema=workspace_api",
            "--schema=workspace_private",
        ],
        env={**os.environ, "PGDATABASE": schema_dsn},
        capture_output=True,
        check=True,
    )
    database._verify_target()
    subprocess.run(
        [
            "pg_restore",
            "--clean",
            "--if-exists",
            "--no-owner",
            "--exit-on-error",
            "--dbname",
            database.migration_dsn,
        ],
        input=completed.stdout,
        capture_output=True,
        check=True,
    )
    return hashlib.sha256(completed.stdout).hexdigest()


def run(args, admin, destination):
    entry = find_source_entry(load_sources(Path(args.sources_path)), args.source)
    if (
        entry is None
        or entry["capability"] != "national"
        or entry.get("source_kind", "official") != "official"
        or registered_source_election(entry) != (args.year, args.round)
    ):
        raise ValueError("benchmark requires a matching registered national official election")
    summary = {
        "version": 1,
        "kind": "national_ingest_benchmark",
        "status": "failed",
        "commit_returned": False,
        "cache": "uncontrolled OS cache; fresh database is not cold cache",
        "database_resources": {"cpus": args.database_cpus, "memory_mib": args.database_memory_mib},
        "repetitions": args.repetitions,
        "runs": [],
    }
    with metrics_report(
        destination,
        archive_root=Path(args.local_root),
        protected=(Path(args.manifest_path), Path(args.sources_path)),
    ) as envelope:
        envelope.data = summary
        reference = None
        reference_counts = None
        reference_context = None
        # Alternate control/profile order to reduce ordering bias. Every pair gets
        # a fresh owned DB cloned from the same migrated schema and role configuration.
        for repetition in range(args.repetitions):
            variants = ("control", "counts", "profiled")
            for variant in variants if repetition % 2 == 0 else tuple(reversed(variants)):
                instrumented = variant == "profiled"
                database = DisposablePostgres(admin)
                with database as dsn:
                    if database.migration_dsn is None:
                        raise ValueError("owned migration connection unavailable")
                    schema_sha = clone_schema(admin, database, args.schema_database)
                    database.grant_test_privileges()
                    for state in ("first_load", "reload"):
                        with tempfile.TemporaryDirectory(prefix="votus-benchmark-") as directory:
                            performance = Path(directory) / "performance.json"
                            counts = Path(directory) / "counts.json"
                            argv = [
                                "--sources-path",
                                args.sources_path,
                                "--manifest-path",
                                args.manifest_path,
                                "--local-root",
                                args.local_root,
                                "ingest",
                                "--source",
                                args.source,
                                "--year",
                                str(args.year),
                                "--round",
                                args.round,
                                "--database-url",
                                dsn,
                            ]
                            if instrumented:
                                argv.extend(["--performance-output", str(performance)])
                            if variant != "control":
                                argv.extend(["--metrics-output", str(counts)])
                            start = perf_counter_ns()
                            # A fresh interpreter makes lifetime RSS meaningful per run.
                            completed = subprocess.run(
                                [sys.executable, "-m", "etl", *argv],
                                cwd=REPO_ROOT / "etl",
                                stdout=subprocess.DEVNULL,
                                stderr=subprocess.DEVNULL,
                                check=False,
                                env={
                                    "PATH": os.environ.get("PATH", ""),
                                    "PYTHONPATH": str(REPO_ROOT / "etl"),
                                    "LANG": "C.UTF-8",
                                },
                            )
                            if completed.returncode != 0:
                                raise ValueError("ingestion failed")
                            job_wall = perf_counter_ns() - start
                            verification_start = perf_counter_ns()
                            fingerprint = logical_fingerprint(
                                dsn, args.source, args.year, args.round
                            )
                            verification_wall = perf_counter_ns() - verification_start
                            if reference is None:
                                reference = fingerprint
                            elif reference != fingerprint:
                                raise ValueError("full logical/completeness parity failed")
                            report = None
                            count_sha = None
                            if instrumented:
                                report = json.loads(performance.read_text())
                                if report["status"] != "succeeded" or not report["commit_returned"]:
                                    raise ValueError("profiled ingestion did not complete")
                                context = {
                                    key: report.get(key)
                                    for key in (
                                        "source_sha256",
                                        "code_revision",
                                        "code_dirty",
                                        "etl_code_sha256",
                                        "schema_fingerprint",
                                        "migration_files_sha256",
                                        "role",
                                        "versions",
                                        "batch_size",
                                        "database_settings",
                                        "instrumentation",
                                    )
                                }
                                if reference_context is None:
                                    reference_context = context
                                elif reference_context != context:
                                    raise ValueError("benchmark provenance changed between runs")
                            if variant != "control":
                                count_data = json.loads(counts.read_text())
                                count_sha = hashlib.sha256(
                                    json.dumps(count_data, sort_keys=True).encode()
                                ).hexdigest()
                                if reference_counts is None:
                                    reference_counts = count_sha
                                elif reference_counts != count_sha:
                                    raise ValueError("source accounting parity failed")
                            summary["runs"].append(
                                {
                                    "repetition": repetition + 1,
                                    "instrumented": instrumented,
                                    "variant": variant,
                                    "state": state,
                                    "schema_dump_sha256": schema_sha,
                                    "whole_job_wall_ns": job_wall,
                                    "verification_wall_ns": verification_wall,
                                    "logical": fingerprint,
                                    "count_metrics_sha256": count_sha,
                                    "performance": report,
                                }
                            )
        summary["statistics"] = {}
        for state in ("first_load", "reload"):
            groups = {}
            for variant in ("control", "counts", "profiled"):
                samples = [
                    entry["whole_job_wall_ns"]
                    for entry in summary["runs"]
                    if entry["state"] == state and entry["variant"] == variant
                ]
                groups[variant] = statistics(samples)
            groups["median_profiler_overhead_ratio"] = (
                groups["profiled"]["median"] / groups["counts"]["median"] - 1
            )
            groups["median_combined_overhead_ratio"] = (
                groups["profiled"]["median"] / groups["control"]["median"] - 1
            )
            summary["statistics"][state] = groups
        summary["status"] = "succeeded"
    return summary


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", required=True)
    parser.add_argument("--schema-database", required=True)
    parser.add_argument("--year", type=int, required=True)
    parser.add_argument("--round", required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--repetitions", type=int, choices=range(3, 10), default=3)
    parser.add_argument("--database-cpus", type=int, default=None)
    parser.add_argument("--database-memory-mib", type=int, default=None)
    parser.add_argument("--local-root", default=str(REPO_ROOT / "archive"))
    parser.add_argument("--manifest-path", default=str(REPO_ROOT / "archive-manifest.json"))
    parser.add_argument("--sources-path", default=str(REPO_ROOT / "etl" / "sources.yaml"))
    args = parser.parse_args(argv)
    try:
        admin = local_admin()
        run(args, admin, args.output)
    except (Exception, KeyboardInterrupt):
        # Never echo driver exceptions, connection details, rows or credentials.
        print(
            "benchmark failed or interrupted; details withheld; check owned cleanup",
            file=sys.stderr,
        )
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
