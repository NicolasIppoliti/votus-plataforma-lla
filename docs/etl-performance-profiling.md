# Profile national ingestion without changing count metrics

Use `ingest --performance-output NEW.json` to collect client phase/resource
observations through the real CLI. This is opt-in, **not a production benchmark
request**. Default stdout and the existing [count metrics](etl-ingest-metrics.md)
remain unchanged. Both report formats currently have independent `version: 1`
contracts; performance reports also identify `kind: national_ingest_performance`.

## Quick path: an already approved disposable target

Run from `etl/` with the pinned environment described in the root README. Supply
`ETL_DATABASE_URL` privately for an **owned disposable local database**, not a
hosted service. Do not paste its value into a report, terminal transcript or issue.

```sh
python -m etl --local-root /absolute/path/to/archive \
  --manifest-path ../archive-manifest.json --sources-path sources.yaml \
  ingest --source national/2025-legislativas --year 2025 --round legislativas \
  --performance-output /owned/results/new-performance.json \
  --metrics-output /owned/results/new-counts.json
```

The archive is read and hash-verified normally; it is never fetched or modified.
Use the registered year/round, not a guessed label. For 2023, run generales and
PASO separately; neither file shape nor performance is inferred from 2025.
Existing files, configured input paths and all paths under the archive root are
rejected before ingestion. The performance report must differ from the count
report. Reports are reserved with exclusive creation; no overwrite is offered.

## What the report means

`ingest_wall_ns` spans `ingest_source`, including connection/catalog/cleanup work.
Exclusive nanoseconds in `phases` partition that interval exactly, on success or
failure. Each phase records `wall_ns`, `client_cpu_ns` and `calls`.

| Phase | Boundary |
| --- | --- |
| `archive_read_hash` | Verified archive read, including SHA validation |
| `extraction` | National ZIP extraction and member selection |
| `completeness` | Completeness construction and database completeness replacement |
| `preflight` | Active first iterator pass through EOF ambiguity classification |
| `active_emission` | Active iterator emission, including exhaustion, never consumer suspension |
| `jurisdiction_resolution` | Bulk jurisdiction lookup/merge/write, including its serialization lock |
| `scoped_delete` | Scoped result DELETE and cursor lifetime, not archive-authority locking |
| `result_writes` | Batch validation, parameter construction and result insertion |
| `commit` | Final connection commit call |
| `other` | Manifest/election/reference work, metadata, batching, transaction exits, cleanup |

The stack charges nested work only to the innermost phase. The iterator is timed
around each `next()`, with an explicit switch after preflight. Time while the
consumer resolves jurisdictions or writes results cannot also be emission time.
Calls count instrumentation entries, not SQL statements or emitted rows.

**CPU means this Python process**, not PostgreSQL CPU. Wall time includes waits.
`process_lifetime_peak_rss_bytes` is the OS high-water mark, sampled after ingestion;
it includes imports/provenance and any earlier work in that interpreter. It is not
phase RSS, live allocation, server memory or a sum of phase peaks. macOS reports
bytes; Linux reports KiB and is converted to bytes.

Provenance includes verified source SHA, Git revision/dirty flag, an ETL Python
source fingerprint, migration-file fingerprint, public column/constraint/index
catalog fingerprint, server/Python/Psycopg versions, effective role privilege
flags, actual loader batch size, visible client CPU count, and nonprivileged
`fsync`, `full_page_writes`, `synchronous_commit`, `shared_buffers` and `work_mem`
settings. No role name,
source names/rows, exception text, SQL text, hostname, database name, DSN or
credentials are included. Fixed-size fingerprints avoid copying catalog text.
Migration files describe the checkout, **not proof of an applied migration ledger**;
the schema fingerprint provides complementary observed evidence, not full schema
DDL equivalence (functions, policies and grants are not part of that fingerprint).
`load_state` means presence/absence of prior results in this exact archive/election
scope; an earlier zero-row ingest cannot be distinguished from first load.
Database CPU/memory limits are unknown in a standalone report, not guessed from
client resources. Unreached observations remain null.

`status` is `succeeded`, `failed` or `interrupted` (KeyboardInterrupt).
`commit_returned` means precisely that the final commit call returned, **not** an
independent durability/rollback proof. Publication is outside the ingest
transaction; publication failure cannot undo a successful commit. SIGKILL, power
loss and filesystem failure can leave an incomplete reserved file. The profiler
does not install signal handlers or change existing transaction semantics.

`verification.performed: false` explicitly separates ingestion observations from
logical readback. Whole-job verification must be measured outside ingestion.

## Repeated benchmark: setup, run, cleanup

The repository-owned `python -m etl.benchmark` entry point runs fresh-database
first loads and identical reloads, with three variants per repetition:

1. **control:** no metrics or performance flags;
2. **counts:** existing count metrics only;
3. **profiled:** count metrics plus performance report.

Order reverses on alternating repetitions. Default three repetitions produce nine
owned databases and eighteen ingestion subprocesses; maximum nine repetitions
keeps the summary bounded. Every ingestion uses a fresh interpreter. Median/min/
max whole-job times are grouped by variant and first/reload state. Profiler
incremental overhead compares profiled versus counts; combined instrumentation
overhead compares profiled versus no-flags control. Negative ratios are possible
measurement noise, not evidence of negative profiler cost.

### Prerequisites and ownership checks

- Obtain an approved **isolated local Supabase cluster**, bootstrapped with the
  current roles and fully migrated reference schema, following the root README's
  local isolated verification prerequisites. Never point this at shared application
  infrastructure, a forwarded remote port or hosted Postgres. Provisioning the
  cluster is a separate operator action; this command does not provision it.
- Install/use the matching PostgreSQL `pg_dump` and `pg_restore` tools. The schema
  source is explicitly named by `--schema-database`. Only public/workspace API/
  private **schema**, never source business rows, is dumped. Keep the schema
  source and cluster roles unchanged throughout the comparison.
- Privately supply `ETL_BENCH_ADMIN_DATABASE_URL` with explicit loopback IP
  (`127.0.0.1` or `::1`), numeric port and `dbname=template1`. Service files,
  hostaddr overrides, hostnames and multihost strings are rejected. This is an
  administrative setup capability, not an ingestion destination.
- The existing `DisposablePostgres` harness verifies the already-final cluster
  role posture; creates UUID-named `votus_etl_verify_<32 hex>` databases and scoped
  login roles; and verifies the exact UUID-derived database name/marker in
  `votus_verification.ownership_marker` before schema restore. Cleanup verifies
  its creation ownership, database comment/marker and role identity before drop.
  The child CLI receives only the restricted test login with the harness's explicit
  grants/memberships, not the administrative setup capability as its connection.
- Schema cloning is intentional: forward migration 0022 creates a cluster-global
  role unconditionally, so replaying all migrations into sibling databases in an
  already migrated cluster is not a reproducible setup. The source schema's
  applied-migration ledger must match the intended checkout before starting;
  retain that operator check separately. Each run records the schema dump hash
  and profiled runs record the observed public catalog fingerprint.
- Record client machine/limits and database CPU/memory/durable-write settings in
  the run dossier. `--database-cpus` and `--database-memory-mib` are operator-supplied
  declarations, not discovered server telemetry. Keep indexes and constraints
  active. Ensure enough disk for extraction, dead tuples, indexes and readback
  sort/temp work, and agree on disk/RSS/time watchdog limits before a real run.

Example, from `etl/`, after these prerequisites are approved:

```sh
python -m etl.benchmark --source national/2025-legislativas \
  --year 2025 --round legislativas --schema-database postgres \
  --local-root /absolute/path/to/archive --manifest-path ../archive-manifest.json \
  --sources-path sources.yaml --repetitions 3 \
  --database-cpus 2 --database-memory-mib 4096 \
  --output /owned/results/new-benchmark.json
```

Use the unchanged registered ZIP (2025 SHA
`5fb19bb280af8895dc0bc2ac19d79e836fb4053b713a135357743bf35371ee4b`).
Benchmark summary `version: 1`, `kind: national_ingest_benchmark`, contains bounded
per-run observations, medians/ranges and overhead ratios. `whole_job_wall_ns`
includes interpreter startup, count instrumentation, provenance and publication;
`verification_wall_ns` is separate. DB setup/cleanup are outside both. A new
physical database does **not** mean cold OS/storage cache. No cache dropping or
server tuning is performed. Verification between runs itself warms caches.

Every run streams a complete sorted logical readback and compares counts/SHA-256
for results (all eleven persisted fields via logical election/category/complete
jurisdiction lineage and metadata, no generated IDs), expected mesas, count
statuses and completeness quarantine. Thus category/list/source totals cannot
change while only a global vote total stays equal. Count-enabled variants also
compare the complete canonical count document, including per-category/per-reason
accounting; the no-flags control has no source accounting observation of its own.
Readback publishes hashes/counts only. Mismatches abort without a successful
summary. This parity proves equivalent outputs across measured runs, not an
independent oracle for correctness.

The context manager cleans up each database/login on ordinary exit or exception.
A failed/interrupted summary is not proof of cleanup; SIGKILL or a failed identity
check may require operator recovery. Inventory remaining `votus_etl_verify_*`
objects and compare the exact ownership markers before any separately authorized
cleanup; **never bulk-drop by prefix**. The tool never deletes archives or report
files. Its owned DB cleanup does not remove the operator's schema source or local
cluster. Existing [PASO scoped scale proof](research/paso-scale-evidence.md) and the
full zero-skip ETL release gate remain separate requirements.

## Optional server evidence

No SQL statement, plan, IO or WAL observation is enabled or required. No production
grants/extensions/settings are requested. An operator may separately inspect the
owned disposable target after verifying the same exact marker; keep server
measurements outside client CPU/phase totals. For example, an explicitly approved
resolver SELECT may be inspected with `EXPLAIN (ANALYZE, BUFFERS, WAL, SETTINGS,
FORMAT JSON)` on that target only. ANALYZE executes its statement: never use this
as permission to execute arbitrary DML or to change production settings.

Publish only reviewed aggregate numeric counters and plan node types, never raw
plans, statement parameters, logs or connection details. Record whether plans,
statement statistics, IO timing or WAL tracking were enabled and repeat the
control with the identical observer setup. No such server evidence or real-source
speedup is claimed merely because the DB-free reporting tests pass.
