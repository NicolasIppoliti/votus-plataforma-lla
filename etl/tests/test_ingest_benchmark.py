"""DB-free contracts for the explicit local benchmark entry point."""

import json
from pathlib import Path
from types import SimpleNamespace

import pytest


def test_benchmark_cli_rejects_nonlocal_before_database_access(monkeypatch, capsys):
    from etl.benchmark import main

    monkeypatch.setenv("ETL_BENCH_ADMIN_DATABASE_URL", "host=remote.invalid dbname=template1")
    assert (
        main(
            [
                "--source",
                "national/2025-legislativas",
                "--year",
                "2025",
                "--round",
                "generales",
                "--output",
                "unused.json",
            ]
        )
        == 1
    )
    assert "remote.invalid" not in capsys.readouterr().err


def test_benchmark_rejects_non_national_before_output_or_setup(monkeypatch, tmp_path):
    import etl.benchmark as benchmark

    touched = []
    sources = tmp_path / "sources.json"
    sources.write_text(
        json.dumps(
            {
                "geography": [
                    {
                        "id": "synthetic",
                        "source": "synthetic",
                        "source_url": "https://example.invalid",
                        "election_year": 2025,
                        "election_round": "generales",
                    }
                ]
            }
        )
    )
    monkeypatch.setattr(benchmark, "local_admin", lambda: "private-admin")
    monkeypatch.setattr(benchmark, "DisposablePostgres", lambda *args: touched.append(True))
    output = tmp_path / "summary.json"
    assert (
        benchmark.main(
            [
                "--source",
                "synthetic",
                "--year",
                "2025",
                "--round",
                "generales",
                "--sources-path",
                str(sources),
                "--output",
                str(output),
            ]
        )
        == 1
    )
    assert not touched
    assert not output.exists()


def test_cluster_waits_for_tcp_and_removes_only_owned_container(monkeypatch):
    import etl.benchmark as benchmark

    commands = []

    def execute(argv, **kwargs):
        commands.append(argv)
        if "pg_isready" in argv:
            assert argv[-4:] == ["-h", "127.0.0.1", "-U", "postgres"]
        output = ""
        if "port" in argv:
            output = "127.0.0.1:55555"
        if "inspect" in argv:
            output = cluster.name
        return SimpleNamespace(returncode=0, stdout=output)

    monkeypatch.setattr(benchmark.subprocess, "run", execute)
    cluster = benchmark.BenchmarkCluster()
    with cluster as dsn:
        assert "port=55555" in dsn
    assert commands[-1] == ["docker", "rm", "--force", "--volumes", cluster.name]
    assert "--pull=never" in commands[0]


@pytest.mark.parametrize("samples", [[3, 1, 2], [2, 2, 2]])
def test_benchmark_statistics(samples):
    from etl.benchmark import statistics

    assert statistics(samples) == {"median": 2, "min": min(samples), "max": max(samples), "runs": 3}


@pytest.mark.parametrize("parity", [True, False, "migration_failure"])
def test_benchmark_cli_runs_controls_reloads_parity_and_cleanup(monkeypatch, tmp_path, parity):
    import etl.benchmark as benchmark

    calls = []
    cleaned = []

    class Owned:
        migration_dsn = "private-migration"

        def __init__(self, dsn):
            assert dsn == "isolated-admin"

        def __enter__(self):
            return "private-writer"

        def __exit__(self, *args):
            cleaned.append(True)

        def grant_test_privileges(self):
            pass

    def execute(argv, **kwargs):
        calls.append(argv)
        if "--performance-output" in argv:
            Path(argv[argv.index("--performance-output") + 1]).write_text(
                json.dumps({"status": "succeeded", "commit_returned": True})
            )
        if "--metrics-output" in argv:
            Path(argv[argv.index("--metrics-output") + 1]).write_text('{"version": 1}')
        return SimpleNamespace(returncode=0)

    def fingerprint(*args):
        return {"synthetic": "hash" if parity else str(len(calls))}

    monkeypatch.setattr(benchmark, "local_admin", lambda: "private-admin")
    clusters = []

    class Cluster:
        def __enter__(self):
            clusters.append("start")
            return "isolated-admin"

        def __exit__(self, *args):
            clusters.append("stop")

    monkeypatch.setattr(benchmark, "BenchmarkCluster", Cluster, raising=False)
    monkeypatch.setattr(benchmark, "DisposablePostgres", Owned)
    migrations = []

    def migrate(dsn, path):
        migrations.append((dsn, path))
        if parity == "migration_failure":
            raise RuntimeError("private migration failure")
        return 74

    monkeypatch.setattr(benchmark, "apply_migrations", migrate)
    monkeypatch.setattr(
        benchmark,
        "load_sources",
        lambda *args: {
            "national": [{"id": "synthetic", "election_year": 2025, "election_round": "generales"}],
        },
    )
    monkeypatch.setattr(benchmark, "logical_fingerprint", fingerprint)
    monkeypatch.setattr(benchmark.subprocess, "run", execute)
    output = tmp_path / "summary.json"
    result = benchmark.main(
        [
            "--source",
            "synthetic",
            "--year",
            "2025",
            "--round",
            "generales",
            "--output",
            str(output),
        ]
    )
    assert migrations == [
        ("private-migration", benchmark.REPO_ROOT / "supabase" / "migrations")
    ] * len(cleaned)
    report = json.loads(output.read_text())
    if parity == "migration_failure":
        assert result == 1
        assert report["status"] == "failed"
        assert not calls
        assert len(cleaned) == 1
    elif parity:
        assert result == 0
        assert report["status"] == "succeeded"
        assert len(calls) == 18
        assert len(cleaned) == 9
        assert sum("--performance-output" in argv for argv in calls) == 6
        assert sum("--metrics-output" in argv for argv in calls) == 12
    else:
        assert result == 1
        assert report["status"] == "failed"
        assert len(calls) == 2
        assert len(cleaned) == 1
    assert clusters == [item for _ in cleaned for item in ("start", "stop")]
    assert "private" not in output.read_text()
