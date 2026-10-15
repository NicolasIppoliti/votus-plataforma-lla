"""Opt-in, bounded client observations, independent of count metrics.

Only fixed keys and numerical/catalog fingerprints are published. Never capture
SQL, arguments, exceptions, environment variables, source rows or connection URLs.
"""

import hashlib
import os
import platform
import resource
import subprocess
import sys
from contextlib import contextmanager
from contextvars import ContextVar
from functools import wraps
from time import perf_counter_ns, process_time_ns

import psycopg

from .ingest_metrics import metrics_report

PHASES = (
    "archive_read_hash",
    "extraction",
    "completeness",
    "preflight",
    "active_emission",
    "jurisdiction_resolution",
    "scoped_delete",
    "result_writes",
    "commit",
    "other",
)
_CURRENT = ContextVar("ingest_performance", default=None)


def current():
    return _CURRENT.get()


class Performance:
    def __init__(self):
        self.data = {
            "version": 1,
            "kind": "national_ingest_performance",
            "status": "failed",
            "commit_returned": False,
            "source_sha256": None,
            "code_revision": None,
            "code_dirty": None,
            "etl_code_sha256": None,
            "schema_fingerprint": None,
            "database_settings": None,
            "migration_files_sha256": None,
            "role": None,
            "load_state": None,
            "batch_size": 1000,
            "versions": {
                "python": platform.python_version(),
                "psycopg": psycopg.__version__,
                "client_os": platform.system(),
                "client_arch": platform.machine(),
            },
            "resources": {
                "client_logical_cpus": os.cpu_count(),
                "database_cpu_limit": None,
                "database_memory_limit_bytes": None,
            },
            "instrumentation": "exclusive-stack-v1; no SQL/plan/IO/WAL capture",
            "verification": {"performed": False, "wall_ns": None},
            "phases": {name: {"wall_ns": 0, "client_cpu_ns": 0, "calls": 0} for name in PHASES},
            "ingest_wall_ns": 0,
            "client_cpu_ns": 0,
            "process_lifetime_peak_rss_bytes": None,
        }
        self.stack = []

    def tick(self):
        now = perf_counter_ns(), process_time_ns()
        if self.stack:
            bucket = self.data["phases"][self.stack[-1]]
            bucket["wall_ns"] += now[0] - self.last[0]
            bucket["client_cpu_ns"] += now[1] - self.last[1]
        self.last = now

    def switch(self, name):
        self.tick()
        self.stack[-1] = name
        self.data["phases"][name]["calls"] += 1

    @contextmanager
    def phase(self, name):
        self.tick()
        self.stack.append(name)
        self.data["phases"][name]["calls"] += 1
        try:
            yield
        finally:
            self.tick()
            self.stack.pop()

    def provenance(self, root):
        try:
            revision = subprocess.run(
                ["git", "rev-parse", "HEAD"],
                cwd=root,
                capture_output=True,
                text=True,
                check=True,
                timeout=5,
            ).stdout.strip()
            if len(revision) == 40 and all(c in "0123456789abcdef" for c in revision):
                self.data["code_revision"] = revision
            self.data["code_dirty"] = (
                subprocess.run(
                    ["git", "status", "--porcelain", "--untracked-files=normal"],
                    cwd=root,
                    capture_output=True,
                    check=True,
                    timeout=5,
                ).stdout
                != b""
            )
        except (OSError, subprocess.SubprocessError):
            pass
        code = sorted((root / "etl" / "etl").rglob("*.py"))
        if code:
            digest = hashlib.sha256()
            for path in code:
                digest.update(str(path.relative_to(root)).encode())
                digest.update(path.read_bytes())
            self.data["etl_code_sha256"] = digest.hexdigest()
        migrations = sorted((root / "supabase" / "migrations").glob("*.sql"))
        if migrations:
            digest = hashlib.sha256()
            for path in migrations:
                digest.update(path.name.encode())
                digest.update(path.read_bytes())
            self.data["migration_files_sha256"] = digest.hexdigest()

    def database_context(self, conn, source_id, year, round_):
        # Fixed catalog query: no role name, host, database name or SQL text in output.
        with conn.cursor() as cur:
            cur.execute(
                """select current_setting('server_version_num')::int,
                r.rolsuper, r.rolbypassrls,
                jsonb_build_object(
                    'fsync', current_setting('fsync'),
                    'full_page_writes', current_setting('full_page_writes'),
                    'synchronous_commit', current_setting('synchronous_commit'),
                    'shared_buffers', current_setting('shared_buffers'),
                    'work_mem', current_setting('work_mem')),
                exists(select 1 from result_row rr join election e on e.id=rr.election_id
                       where rr.archive_entry_id=%s and e.year=%s and e.round=%s),
                (select md5(coalesce(string_agg(definition, E'\\n' order by definition), ''))
                 from (
                   select 'index:' || indexdef as definition
                   from pg_indexes where schemaname='public'
                   union all
                   select 'column:' || table_name || ':' || column_name || ':' ||
                          data_type || ':' || is_nullable || ':' || coalesce(column_default, '')
                   from information_schema.columns where table_schema='public'
                   union all
                   select 'constraint:' || c.relname || ':' || pg_get_constraintdef(k.oid)
                   from pg_constraint k join pg_class c on c.oid=k.conrelid
                   join pg_namespace n on n.oid=c.relnamespace where n.nspname='public'
                 ) definitions)
                from pg_roles r where r.rolname=current_user""",
                (source_id, year, round_),
            )
            version, superuser, bypassrls, settings, populated, fingerprint = cur.fetchone()
        self.data["database_settings"] = settings
        self.data["versions"]["postgres_server_version_num"] = version
        self.data["role"] = {"superuser": superuser, "bypassrls": bypassrls}
        self.data["load_state"] = "reload" if populated else "first_load"
        self.data["schema_fingerprint"] = fingerprint


@contextmanager
def phase(name):
    profiler = current()
    if profiler is None:
        yield
    else:
        with profiler.phase(name):
            yield


def timed(name):
    def decorate(fn):
        @wraps(fn)
        def wrapped(*args, **kwargs):
            if current() is None:
                return fn(*args, **kwargs)
            with phase(name):
                return fn(*args, **kwargs)

        return wrapped

    return decorate


def active_emission(fn):
    """Time next(), never the suspension across yield. First next runs preflight."""

    @wraps(fn)
    def wrapped(*args, **kwargs):
        if current() is None:
            yield from fn(*args, **kwargs)
            return
        iterator = fn(*args, **kwargs)
        first = True
        try:
            while True:
                with phase("preflight" if first else "active_emission"):
                    try:
                        item = next(iterator)
                    except StopIteration:
                        return
                first = False
                yield item
        finally:
            iterator.close()

    return wrapped


def emission_started():
    if current() is not None:
        current().switch("active_emission")


@contextmanager
def performance_report(path, *, archive_root, protected, root):
    # Reuse the established exclusive-create/protected-input/publication contract,
    # but publish a separate document, never modifying version-1 count metrics.
    with metrics_report(path, archive_root=archive_root, protected=protected) as envelope:
        profiler = Performance()
        envelope.data = profiler.data
        profiler.provenance(root)
        token = _CURRENT.set(profiler)
        try:
            yield profiler
        except KeyboardInterrupt:
            profiler.data["status"] = "interrupted"
            raise
        finally:
            _CURRENT.reset(token)
            rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
            profiler.data["process_lifetime_peak_rss_bytes"] = (
                rss if sys.platform == "darwin" else rss * 1024
            )


@contextmanager
def ingest_span():
    profiler = current()
    if profiler is None:
        yield
        return
    try:
        with profiler.phase("other"):
            yield
    finally:
        profiler.data["ingest_wall_ns"] = sum(
            p["wall_ns"] for p in profiler.data["phases"].values()
        )
        profiler.data["client_cpu_ns"] = sum(
            p["client_cpu_ns"] for p in profiler.data["phases"].values()
        )


def profile_ingest(fn):
    @wraps(fn)
    def wrapped(*args, **kwargs):
        with ingest_span():
            result = fn(*args, **kwargs)
        if current() is not None:
            current().data["status"] = "succeeded"
        return result

    return wrapped
