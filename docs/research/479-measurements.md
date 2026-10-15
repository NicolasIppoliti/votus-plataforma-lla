# Issue #479 — local measurement attempt

## Cluster-isolation repair (latest; supersedes preparation blockers below)

**Partial: cluster isolation works; three-repetition measurements remain blocked by disk.**

The ordinary ETL release gate receives a fresh PostgreSQL 17 service container for
 each matrix job (`.github/workflows/release-gates.yml`). Its bootstrap creates
`anon`, `authenticated`, and `etl_writer` before `etl-verify`. The e2e release gate
uses separately owned Supabase project containers and ownership-checked cleanup.
A fresh database alone cannot isolate migration 0022's cluster-global role.

The benchmark now creates one uniquely named PostgreSQL 17 container per variant,
using the ordinary gate's pinned image with `--pull=never`, explicit loopback port
publication, and the same initial roles. It reuses `DisposablePostgres` and
`apply_migrations`; no applied migration or shared role is changed. Container cleanup
checks the unique ownership label and removes only that container and its volumes,
including when startup or migration fails. TCP readiness avoids mistaking the
image's temporary initialization socket server for its final server. Free disk is
checked before each cluster and each ingestion invocation.

### Observed tests and real runs

- CLI isolation RED: **3 failed, 4 passed**, before cluster implementation.
- CLI GREEN: **7 passed**. Additional TCP-readiness regression RED: **1 failed,
  7 passed**; final GREEN: **8 passed**.
- From `etl/`, shared-venv `ruff check .`: **passed**; `ruff format --check .`:
  **101 files already formatted**. Initial lint/format failures were repaired manually.
- Both real attempts used source `national/2025-legislativas`, round `legislativas`,
  three requested repetitions, and the main checkout's read-only archive. A foreground
  wrapper checked free disk every two seconds, terminating only its ingestion child
  below **2 GiB**, then unwound owned database/container contexts.
- `479-benchmark-2025-isolated.json`: **one control first load and one control reload**
  completed. All **74 migrations** applied. First-load whole-job wall **300.532 s**;
  reload **16.035 s**. Separate logical verification **74.188 s / 54.001 s**.
  Both reads matched exactly: **2,276,730 result rows**, **108,992 expected mesas**,
  **134,853 statuses**, **0 completeness quarantine rows**. Full-row hashes are in
  the JSON. The attempt stopped during subsequent work; its precise failure cause
  was not captured. These two observations are not three-repetition statistics.
- `479-benchmark-2025-isolated-tcp.json`: after the TCP readiness correction, the
  disk monitor stopped the first ingestion below the reserve; **zero completed runs**.
  The diagnostic traceback identified the monitor's disk-reserve exception.
- Median/range across three repetitions, profiled phase times, RSS, profiler overhead,
  and count-report/reason parity: **not measured**. No historical INSERT comparison
  or extrapolation is claimed. The requested measurement AC remains unmet.
- Initial free disk **6.66 GiB**; final **4.12 GiB** after cleanup (other concurrent
  disk consumers were present). Both attempts left **no benchmark-labeled containers**.
  The explicitly authorized old `votus-etl-bench` container and its volumes were also
  removed. No shared Supabase container was touched. **2023 PASO was not run**;
  the user must free space before larger benchmarks.

### Reuse for #482

`BenchmarkCluster` is an importable context manager returning an explicit loopback
maintenance conninfo including the dynamically allocated **port**. A probe can use
that context and the existing `DisposablePostgres` / `apply_migrations` boundary.
Pass the resulting target DSN explicitly to `pg_dump --dbname <dsn>`; do not invoke
pg_dump without connection parameters or let it select the default socket. No #482
files were edited. The benchmark still validates its legacy maintenance environment
variable, although that connection is not used to access the shared cluster.


## Migration-boundary repair follow-up (latest)

**Partial: RED/GREEN repair implemented; measurements still blocked before ingestion.**
This section supersedes earlier statements that implementation edits were disallowed
or that schema cloning remains the active path. Historical evidence below is retained.

- `etl/etl/benchmark.py` now calls the ordinary gate's `verify.apply_migrations`
  directly on each `DisposablePostgres.migration_dsn`, then grants the writer role.
  The dump/restore implementation and required `--schema-database` option are removed.
  Envelopes record `migration_count`, not a misleading dump hash; profiled successful
  runs would still record schema and migration-file fingerprints.
- RED observed before implementation: focused pytest **2 failed, 4 passed** because
  the real CLI still required `--schema-database`. The entry-point test now asserts
  use of the gate's migration boundary for every owned target.
- GREEN: **7 passed** after adding migration-failure cleanup/no-ingest coverage as
  well as the existing logical-parity rejection and successful controls/reloads cases.
- Checks from `etl/`, using `PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=.` and
  `/Users/nicolasmateoippoliti/dev/votus-plataforma-lla/etl/.venv/bin/python`:
  `-m pytest -p no:cacheprovider tests/test_ingest_benchmark.py -q` passed;
  `-m ruff check etl/benchmark.py tests/test_ingest_benchmark.py` passed;
  `-m ruff format --check etl/benchmark.py tests/test_ingest_benchmark.py` passed
  after manually adding one missing blank line (initial format check failed).

### Real plain-container attempt

Foreground Python invoked `benchmark.main` with source
`national/2025-legislativas`, year `2025`, round `legislativas`, repetitions `3`,
read-only archive root `/Users/nicolasmateoippoliti/dev/votus-plataforma-lla/archive`,
and output `docs/research/479-benchmark-2025-migrations.json`. Maintenance DSN was
`postgresql://postgres@127.0.0.1:55432/template1` (trust authentication).
The wrapper checked free disk before each ingestion child and monitored every two
seconds, interrupting only its owned child below **2 GiB**; this supersedes all older
reserve thresholds. No ingestion child was reached. Disk before attempt: **4.1 GiB**.

The attempt exited **1** with `runs: []`. A bounded diagnostic using the same owned
DB context and migration function reproduced:

```text
Owned target created
Migration failure: 0022_results_exploration_scale.sql 42710
```

Migration 0022 unconditionally executes `create role results_exploration_executor`.
A read-only catalog query confirmed that role already exists in the plain cluster.
Fresh databases do not isolate cluster-wide roles, and `DisposablePostgres` does not
remove this shared role. Therefore even an initially empty cluster would need an
explicit role-lifecycle solution for repeated fresh migration targets. No roles were
dropped, migrations modified, errors ignored, or second migration runner introduced.
The prior gate pass does not establish repeatability in this now-used cluster.
Resolving shared-role ownership/lifecycle requires a separately authorized change;
this worker has not treated the role as disposable task-owned state.

### Numbers and AC disposition

- First loads / reloads completed: **0 / 0**. Median/range, ingestion versus
  verification times, RSS and logical category/list/source/completeness/reason parity:
  **not measured**, not zero. No comparison with a historical INSERT baseline claimed.
- Schema preparation uses the requested single migration boundary, but end-to-end
  plain-container preparation and repeat measurement ACs remain **unmet** due to the
  observed migration collision. No new ordinary full-gate run is claimed.
- 2023 deliberately skipped: PASO CSV **3,756,022,182 bytes** (3.76 GB), plus database
  and WAL, cannot fit the approximately **3.9 GiB** starting budget while retaining
  **2 GiB**. No 2023 extrapolation or extraction performed.
- Final disk **4.1 GiB**. Read-only catalog query returned **no
  `votus_etl_verify_%` databases** after both attempts. Container left running.
  Pre-existing untracked reports preserved. No commit/push.


## Outcome

**Incomplete: no ingestion measurements; ordinary PostgreSQL gate now passes.**
The later plain-Postgres run below supersedes the earlier Supabase gate failure.
Benchmark schema preparation remains blocked. These are observed tooling/schema
blockers, not inferred performance results. No shared database objects, archives, or
implementation files were changed. No commit/push performed.

## Environment

- Branch `perf/479-measurements`, HEAD `6554344`; initial working tree clean.
- Apple M4, 10 logical CPUs, 17,179,869,184 bytes RAM (16 GiB).
- Python **3.13.12**, Psycopg **3.3.6**, using
  `/Users/nicolasmateoippoliti/dev/votus-plataforma-lla/etl/.venv/bin/python` with
  `PYTHONPATH=.` from `etl/` and bytecode writes disabled.
- PostgreSQL **17.6**, aarch64-unknown-linux-gnu, GCC 15.2.0, 64-bit.
- Existing container `supabase_db_votus-plataforma-lla`, port 54322.
  Docker `NanoCpus=0`, `Memory=0`: no explicit container limits, **not** a measurement
  of Docker VM resources. Database CPU/RAM allocation otherwise unverified.
- Local DB_URL captured in memory from `supabase status -o env` in the main checkout;
  credentials never written to this document or scripts. Maintenance connection:
  `postgresql://postgres:<local>@127.0.0.1:54322/template1`.
- `pg_dump`, `pg_restore`: `/opt/homebrew/opt/libpq/bin/`.
- Disk checked before every attempted run: initially 6.3 GiB, then 5.8/5.7 GiB,
  subsequently 6.7 GiB available. No observed check was below 3 GiB.
- Temporary scripts/directories owned by this task: `/tmp/votus-479-run.py`,
  `/tmp/votus-479-gate.py`, `/tmp/votus-479-temp`. No archive extraction occurred.

## Commands and preparation

Environment inspection:

```sh
git status --short; git branch --show-current; df -h /; gh issue view 479 --comments
gh issue view 479 --json title,body,comments; git rev-parse --show-toplevel; test -d .codegraph && printf 'codegraph present\n'; command -v codegraph
git log -5 --oneline; git ls-files docs/research etl/etl/benchmark.py etl/tests/test_ingest_benchmark.py; gh issue view 479 --json closedByPullRequestsReferences
git status --short; df -h /; command -v pg_dump; command -v pg_restore; command -v docker; sysctl -n machdep.cpu.brand_string hw.ncpu hw.memsize; docker exec supabase_db_votus-plataforma-lla psql -U postgres -d template1 -Atc 'select version()'
```

An initial password-free host connection probe failed with `fe_sendauth: no password
supplied`. This authentication limitation was **resolved** by the user's authorization
to capture the local CLI DB_URL; it is not the remaining blocker.

The task-owned benchmark wrapper captures CLI stdout without displaying it, converts
DB_URL to a loopback `template1` maintenance DSN, sets `TMPDIR`, and calls
`etl.benchmark.run` directly so preparation errors can be diagnosed without exposing
connection strings. Arguments: source `national/2025-legislativas`, year 2025,
round `legislativas`, three repetitions, schema database from DB_URL, registry and
manifest from this worktree, read-only archive root
`/Users/nicolasmateoippoliti/dev/votus-plataforma-lla/archive`. Database resources are
left unspecified rather than invented. It checks free bytes before each subprocess.
The repository tool owns disposable database creation and cleanup.

Exact foreground invocation, repeated after the corrections below:

```sh
df -h /; cd etl && PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=. /Users/nicolasmateoippoliti/dev/votus-plataforma-lla/etl/.venv/bin/python /tmp/votus-479-run.py
```

### Observed benchmark blockers

1. Initial wrapper used `round=generales`; registry validation correctly rejected it
   before database setup. Corrected to the registry's `legislativas`.
2. `clone_schema` passes a connection string as the `PGDATABASE` environment variable
   without a `pg_dump --dbname` argument. First attempt tried the default local socket
   `/tmp/.s.PGSQL.5432`, which does not exist.
3. Supplying explicit loopback PGHOST/PGPORT/PGUSER/PGPASSWORD in memory exposed the
   underlying issue: `pg_dump` treated the full conninfo as a literal database name and
   reported that database does not exist. Credential-bearing text was redacted before
   display. An intervening retry also hit the report writer's correct refusal to
   overwrite an existing output; subsequent attempts used distinct output names.
4. To get beyond dump connection setup **without editing production tooling**, the
   wrapper added `--dbname <same conninfo>` to the dump subprocess only. Dump succeeded,
   but restore then failed in `clone_schema`:

   ```text
   pg_restore: error: could not execute query: ERROR: schema "workspace_private" does not exist
   Command was: DROP POLICY IF EXISTS workspace_review_ingest_owner_section_select ON workspace_private.section_scope;
   ```

   This is the final observed benchmark blocker. The existing `--clean --if-exists
   --exit-on-error` restore into a fresh disposable database fails before schema load.
   No constraints or indexes were disabled to bypass it. No fixture ownership claim
   was established. `docs/research/jurisdiction-index.md` is absent in this checkout.

Retained failed envelopes, each `runs: []`:
`479-benchmark-2025.json`, `479-benchmark-2025-attempt2.json`,
`479-benchmark-2025-attempt3.json`. They contain no successful measurement samples.

## ETL PostgreSQL gate

The wrapper captures the same local URL, sets `ETL_TEST_ADMIN_DATABASE_URL` to the
loopback `template1` DSN and `ETL_VERIFY_STAGE_REPORT=1`, checks disk, then executes:

```sh
python -c 'from etl.verify import main; raise SystemExit(main())'
```

using the required interpreter, `PYTHONPATH=.`, and task-owned TMPDIR. Exact wrapper invocation:

```sh
df -h /; cd etl && PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=. /Users/nicolasmateoippoliti/dev/votus-plataforma-lla/etl/.venv/bin/python /tmp/votus-479-gate.py
```

Observed exit **1**:

```text
E2E_ETL_STAGE apply_migrations
E2E_ETL_MIGRATION 0022_results_exploration_scale.sql 42710
ETL verification failed: migration execution failed; details redacted
```

SQLSTATE 42710 is duplicate object; the exact object was not exposed by the gate.
No tests executed: this is **not** a zero-skip gate pass. An earlier invocation of
`python -m etl.verify` returned 0 with no output because that module has no main guard;
that no-op is explicitly excluded from verification evidence.

Cleanup verification:

```sh
df -h /; docker exec supabase_db_votus-plataforma-lla psql -U postgres -d template1 -Atc "select datname from pg_database where datname like 'votus_etl_verify_%' order by datname"; git status --short
```

Returned no disposable database names; final free space **6.7 GiB**. Repository tooling
cleaned its databases. Temporary scripts remain task-owned; no extracted source or dump
files remain from the benchmark (dump bytes were held in memory).

## Acceptance criteria disposition

> Drive national 2023 generales/PASO and 2025 plus other callers of the shared writer. Compare complete logical data, category/list/source totals, completeness and per-reason accounting, not only global vote totals.

**Unmet in this task.** No ingestion reached. No parity or per-category/list/source/reason
numbers available. Existing benchmark fingerprints complete result/completeness rows and
compares count-report hashes between variants; this alone would not establish parity
against a historical INSERT baseline or exercise non-national callers.

> Repeat comparable local first loads and reloads and report median/range, exact source/schema/role/resources, ingestion versus verification time and RSS. Keep all target indexes/constraints active.

**Unmet, blocked by schema preparation.** Planned three repetitions; completed **0 first
loads / 0 reloads**. Median, range, ingestion time, verification time and peak RSS are
**not measured**. Source SHA, target schema fingerprint and writer-role provenance were
not reached. No historical issue figures are relabeled as new results.

2023 runs were not attempted: the common schema blocker applies first. Additionally,
`paso-scale-evidence.md` documents approximately 3.7 GB extraction plus 8.3 GB initial DB
storage and reload doubling, incompatible with the observed 5.7–6.7 GiB free space and
3 GiB reserve. No 2023 performance extrapolation is made.

> Keep the implementation within the normal review budget or split reviewable layers before delivery; run the required ETL PostgreSQL gate with zero skips.

**Ordinary gate now met:** the later plain-Postgres run passed 74 migrations and 2,072
tests with zero skips. Earlier Supabase failure remains below as historical diagnostic
evidence, not the current gate disposition. No implementation changes made. Benchmark
schema preparation still needs repair, not fabricated measurement evidence.

The other four ACs concern pre-implementation RED, column/scope semantics, EOF/PASO
classification and rollback/empty-scope isolation. They are not newly verified here.
Issue metadata returned `comments: []` and no closing PR references, so the requested
merged-PR evidence could not be reconstructed from those responses alone. Empty metadata
is not proof that implementation was not merged.

## Plain PostgreSQL follow-up (latest evidence)

The parent provisioned and owns `votus-etl-bench`, loopback port **55432**, using the CI
image `public.ecr.aws/docker/library/postgres:17@sha256:d74eeac9a635390a49bc21bd49fccd973de707e2a53a76ac49b552b8712ec46f`,
trust authentication and the workflow's initial role setup. Parent owns container removal
and Git delivery. The updated disk reserve is **1.5 GiB**, superseding the earlier 3 GiB
threshold for this follow-up. No container lifecycle commands were run by this worker.

Observed server version: **PostgreSQL 17.11 (Debian 17.11-1.pgdg13+2)**,
aarch64-unknown-linux-gnu, GCC 14.2.0, 64-bit. Docker CPU/memory limits are both zero
(unlimited at container level; VM resources unverified). Host/Python remain as above.

### Ordinary gate: PASS

Exact command:

```sh
df -h /; cd etl && PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=. TMPDIR=/tmp/votus-479-temp PYTEST_ADDOPTS='-p no:cacheprovider' ETL_TEST_ADMIN_DATABASE_URL=postgresql://postgres@127.0.0.1:55432/template1 ETL_VERIFY_STAGE_REPORT=1 /Users/nicolasmateoippoliti/dev/votus-plataforma-lla/etl/.venv/bin/python -c 'from etl.verify import main; raise SystemExit(main())'
```

- Free disk before command: **3.7 GiB**.
- **74 migrations; 2,072 executed; 0 skipped; exit 0.**
- Partition 1: 2,048 passed, 24 deselected, 43.79 s, one expected duplicate-ZIP-name warning.
- Partition 2: 24 passed, 2,048 deselected, 4.38 s.
- Disjoint partitions together execute all 2,072 tests. Deselection is not skipping.
- Tool reported cleanup of `votus_etl_verify_8daaaa3a47e848d481536834cb9c67b7`.
- This is the ordinary gate, not the three separate migration-atomicity matrix cases.

### 2025 benchmark: preparation failed, no samples

Free disk before each attempt: **3.6 GiB**. Requested three repetitions, first load and
reload. `etl.benchmark.run` was invoked from a foreground Python heredoc with the same
registered source/year/round and read-only archive arguments documented above, targeting
`postgresql://postgres@127.0.0.1:55432/template1`. No ingest subprocess was reached.

Because the benchmark needs an existing migrated schema database and the gate cleans its
own target, the wrapper attempted a read-only schema dump of the already-migrated local
Supabase database, restoring into each owned plain-Postgres target. This is **not** a
fresh CI-schema migration, and no successful benchmark result is asserted for it.

The wrapper's operative dump/restore commands were:

```sh
pg_dump --format=custom --schema-only --no-owner --schema=public --schema=workspace_api --schema=workspace_private --dbname '<local DB_URL captured in memory>'
pg_restore --no-owner --exit-on-error --dbname '<owned disposable migration DSN>'
```

It passed dump bytes directly in memory. This sidestepped the original tool's conninfo
PGDATABASE bug and did not use destructive `--clean`. Restore stopped because fresh
PostgreSQL already has schema `public`. In the second attempt `--exit-on-error` was
omitted **for diagnosis only**; the wrapper would accept only that single expected
preexisting-public-schema error, and reject every other restore error. It observed
**51 restore errors**, including:

```text
ERROR: schema "public" already exists
ERROR: role "service_role" does not exist
ERROR: role "supabase_admin" does not exist
```

It rejected this restore and exited 1. No missing grants were ignored, roles synthesized,
constraints disabled, or measurements taken against a partially restored schema.
The benchmark's role grants and ingestion were never reached. The SQL dumps and local
credentials were not persisted. Failed envelopes:
`479-benchmark-2025-plain.json`, `479-benchmark-2025-plain-attempt2.json`.

For any ingest child, the wrapper was configured to check free space every two seconds,
send SIGINT below 1.5 GiB, then kill only that child if it failed to exit within 30 seconds.
This watchdog never activated because schema preparation failed first.

**Remaining technical blocker:** the repository benchmark has no path here to preserve
and clone the plain gate's migrated target before cleanup. Its existing schema-clone
function additionally fails on conninfo handling and clean restore. A reliable next run
needs a migrated plain schema source retained during benchmarking and a corrected clone
path. No such tooling fixes are permitted by this task's current docs/JSON-only surfaces.
The passed gate does not prove that this separate clone path works.

### 2023: skipped for space

Read-only ZIP-directory inspection (no extraction) found:

| Source | Main result CSV uncompressed bytes |
| --- | ---: |
| 2025 legislativas | 457,673,045 |
| 2023 generales | 1,084,616,664 |
| 2023 PASO | 3,756,022,182 |

At **3.6 GiB** free and a **1.5 GiB** reserve, PASO extraction alone exceeds the available
budget; its previously measured database footprint is additional. Generales was also
skipped: its extraction would consume about half the remaining budget before database
and WAL growth, and the common schema blocker already prevents a valid run. This is a
capacity/risk decision, not a measured generales database-size claim.

### Final ledger and cleanup

- Successful 2025 ingestion runs: **0**; first/reload repeat count **0/0**.
- Median/range, ingestion versus verification time, RSS: **not measured**.
- Logical category/list/source/completeness/per-reason parity: **not measured**.
- Final disk: **3.6 GiB**, above reserve.
- Query on plain container returned **no `votus_etl_verify_%` databases**:

```sh
df -h /; docker exec votus-etl-bench psql -U postgres -d template1 -Atc "select datname from pg_database where datname like 'votus_etl_verify_%' order by datname"; git status --short
```

Container remains running for parent-owned removal; no commit/push performed.

## Test discipline

Documentation/measurement-only investigation: no behavior change and no meaningful
RED/GREEN. Tooling defects were diagnosed, not fixed; the task does not claim test-first
implementation evidence or completion of issue #479.
