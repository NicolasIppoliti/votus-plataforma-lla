"""Explicit local-only, owned-database national benchmark. Never runs implicitly."""

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import uuid
from contextlib import ExitStack
from pathlib import Path
from statistics import median
from time import perf_counter_ns

import psycopg
from psycopg.conninfo import conninfo_to_dict

from .__main__ import REPO_ROOT, find_source_entry, load_sources, registered_source_election
from .ingest_metrics import metrics_report
from .verify import DisposablePostgres, apply_migrations


class BenchmarkCluster:
    """Fresh PostgreSQL 17 service, matching the ordinary release gate's cluster scope."""

    image = (
        "public.ecr.aws/docker/library/postgres:17@sha256:"
        "d74eeac9a635390a49bc21bd49fccd973de707e2a53a76ac49b552b8712ec46f"
    )

    def __init__(self):
        self.name = f"votus-etl-benchmark-{uuid.uuid4().hex}"
        self.created = False

    def command(self, *args):
        return subprocess.run(
            ["docker", *args], check=True, capture_output=True, text=True
        ).stdout.strip()

    def __enter__(self):
        if shutil.disk_usage(REPO_ROOT).free <= 2 * 1024**3:
            raise ValueError("benchmark requires more than 2 GiB free")
        # Never pull, reuse the gate's pinned local image. Create before starting so
        # cleanup never targets a pre-existing resource after a failed create.
        self.command(
            "create",
            "--pull=never",
            "--name",
            self.name,
            "--label",
            f"votus.benchmark.owner={self.name}",
            "-e",
            "POSTGRES_HOST_AUTH_METHOD=trust",
            "-p",
            "127.0.0.1::5432",
            self.image,
        )
        self.created = True
        try:
            self.command("start", self.name)
            for _ in range(120):
                ready = subprocess.run(
                    [
                        "docker",
                        "exec",
                        self.name,
                        "pg_isready",
                        "-h",
                        "127.0.0.1",
                        "-U",
                        "postgres",
                    ],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    check=False,
                )
                if ready.returncode == 0:
                    break
                time.sleep(0.5)
            else:
                raise ValueError("benchmark cluster did not become ready")
            self.command(
                "exec",
                self.name,
                "psql",
                "-U",
                "postgres",
                "-d",
                "template1",
                "-v",
                "ON_ERROR_STOP=1",
                "-c",
                "create role anon nologin; create role authenticated nologin; "
                "create role etl_writer login bypassrls password null; "
                "grant etl_writer to postgres;",
            )
            port = self.command("port", self.name, "5432/tcp").split(":")[-1]
            return f"host=127.0.0.1 port={int(port)} dbname=template1 user=postgres"
        except BaseException:
            self.__exit__(None, None, None)
            raise

    def __exit__(self, *args):
        if self.created:
            owner = self.command(
                "inspect",
                "--format",
                '{{index .Config.Labels "votus.benchmark.owner"}}',
                self.name,
            )
            if owner != self.name:
                raise ValueError("benchmark container ownership changed")
            self.command("rm", "--force", "--volumes", self.name)
            self.created = False


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
        # a fresh owned DB with the ordinary gate's migrations and role configuration.
        for repetition in range(args.repetitions):
            variants = ("control", "counts", "profiled")
            for variant in variants if repetition % 2 == 0 else tuple(reversed(variants)):
                instrumented = variant == "profiled"
                with ExitStack() as resources:
                    isolated_admin = resources.enter_context(BenchmarkCluster())
                    database = DisposablePostgres(isolated_admin)
                    dsn = resources.enter_context(database)
                    if database.migration_dsn is None:
                        raise ValueError("owned migration connection unavailable")
                    migration_count = apply_migrations(
                        database.migration_dsn, REPO_ROOT / "supabase" / "migrations"
                    )
                    database.grant_test_privileges()
                    for state in ("first_load", "reload"):
                        if shutil.disk_usage(REPO_ROOT).free <= 2 * 1024**3:
                            raise ValueError("benchmark requires more than 2 GiB free")
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
                                    "migration_count": migration_count,
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
