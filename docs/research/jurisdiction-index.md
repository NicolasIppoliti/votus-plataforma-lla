# Jurisdiction expression index: lookup evidence, not an ingest speedup

The smallest candidate for #481 is a non-unique B-tree index matching
`etl.db.MERGE_KEY_SQL` exactly. The forward migration also runs `ANALYZE` for
already-populated installations. The resolver, normalization boundary, metadata
reconciliation and transaction-scoped writer lock are unchanged. This is a
**partial acceptance dossier**: complete-source first-load/reload timings remain
blocked by the benchmark's owned test-grant phase described below (the TCP and
fresh-target restore failures have been fixed). The migration
is `20261015100000_jurisdiction_merge_key_index.sql` (not #425's colliding
`20261015000000` version). The exact web release-gate inventory includes it.

## Reproduce the plan check

From `etl/`, use the existing environment:

```sh
/Users/nicolasmateoippoliti/dev/votus-plataforma-lla/etl/.venv/bin/python -m pytest -q -s tests/test_jurisdiction_index.py
```

The DB-backed test uses the ordinary ETL test connection on local port 54322.
It creates a session-local `jurisdiction` table with the public table's defaults
and indexes, shadows that table only for this connection, and rolls everything
back. It never applies a migration to the live public table. No server reset,
cache flush, hosted connection or persisted business-data mutation is involved.

The recording connection delegates the real resolver's SQL unchanged. The test
prints its **exact SQL and parameters**, then `EXPLAIN (ANALYZE, BUFFERS, FORMAT
JSON)` output. For prepared queries it uses Psycopg's `prepare=True`, verifies
custom/generic counters in `pg_prepared_statements`, and explains `EXECUTE` of
that actual prepared statement. It does not substitute a smaller lookup query.

## Observed comparison

[Raw SQL, parameters, settings and complete plans](jurisdiction-index-plans.txt)
were captured with the command above. The identical 32-key lookup used a
108,141-row synthetic dimension, the same connection/role/settings and unchanged
server resource settings throughout. This is one ordered observation per
condition, not a repeated statistical benchmark or cold-cache comparison.

| Condition | Plan | Execution ms | Dimension rows visited | Root local buffers hit/read/written |
|---|---|---:|---:|---|
| Existing indexes, analyzed table | Hash right join / sequential scan | 44.871 | 108,141 per scan | 0 / 2,458 / 27 |
| Expression index, before expression ANALYZE | Nested loop / index scan | 0.131 | 32 | 89 / 39 / 0 |
| Expression index, ANALYZE, forced custom prepared plan | Nested loop / index scan | 0.072 | 32 | 128 / 0 / 0 |
| Expression index, ANALYZE, forced generic prepared plan | Nested loop / index scan | 0.068 | 32 | 128 / 0 / 0 |

PostgreSQL server version number: 170006. Psycopg: 3.3.6. Effective role:
non-superuser, BYPASSRLS. `work_mem=4MB`, `shared_buffers=128MB`; `fsync`,
`full_page_writes`, and `synchronous_commit` were on. Container CPU/memory limits
were not measured. These are local/temp buffers, **not public-table shared-buffer
measurements**. Index creation and ANALYZE warm caches. The baseline retained
existing tuple indexes, but the synthetic distribution is not the registered
national source distribution. Before ANALYZE, the index scan estimated 541 rows
per key; after ANALYZE it estimated one. Timings exclude migration/index build.

## Correctness coverage

The migrated empty-dimension path creates a NULL-mesa lineage, resolves a padded
alias to that same ID, enriches NULL metadata, resolves another hit, rejects a
later conflicting name, then rejects two persisted rows for that NULL-bearing
lineage. A savepoint rolls this candidate setup back before the populated
comparison. Existing jurisdiction tests cover the Python/SQL escaping contract,
all five lineage components and writer serialization. The migration contract
requires the exact resolver expression (only the table alias is removed), a
non-unique index, an explicit down migration, and no GRANT/REVOKE statements.

## Growing first load and existing ANALYZE privileges

The catalog check observed `etl_writer` is not superuser, is not a member of the
jurisdiction owner with USAGE, and does not have PG17 `MAINTAIN`. Migration 0009
provides DML only. **No runtime ANALYZE and no new grants were added.** This is
observational/structural verification, not a runtime behavior change requiring a
new RED through the loader.

In a separate savepoint, the test applies the index and ANALYZE to an empty
session-local dimension, exercises real resolver inserts/hits, then grows it to
108,143 rows (including two duplicate NULL-bearing correctness fixtures).
The exact resolver lookup before another ANALYZE still chose a hash right join
and sequential scan: **45.114 ms**, 108,143 rows visited, root local buffers
11 hit / 1,218 read / 890 written. After ANALYZE it chose the expression index:
**0.141 ms**, 32 probes, 86 hit / 42 read / 3 written. Full plans are in the raw
dossier. Growth is synthetic SQL, not a complete national loader run.

The live table has no reloptions overrides; autovacuum is on with analyze
threshold 50 and scale factor 0.1. Thus ordinary committed growth relies on
autoanalyze (or an already-authorized maintenance operator), not the ETL writer.
Autovacuum cannot analyze this test's temporary table, and cannot obtain usable
statistics for another transaction's uncommitted first-load rows. The retained
writer lock/transaction means no guaranteed statistics refresh mid-ingestion;
even an immediate reload may begin before automatic maintenance. Migration-time
ANALYZE is useful for existing installations, not a guarantee for fresh loads.

## Complete-ingest attempts and current blocker

The read-only registered ZIP exists at the supplied path (13,554,180 bytes).
Local tools are pg_dump/pg_restore 18.6; server is PostgreSQL 17.6. Docker reports
NanoCpus=0 and Memory=0 for the named database container (no per-container limits;
Docker VM/host limits were not measured). No CPU/memory values were invented in
the report.

The existing benchmark rejects `--repetitions 1` before DB setup (exit 2); its
supported minimum is three. The three-repetition before-index attempt exited 1
before the first ingestion. Its [failure report](jurisdiction-index-benchmark-before.json)
contains `runs: []`, `status: failed`, and `commit_returned: false`.

An [opt-in owned prerequisite diagnostic](test_jurisdiction_benchmark_environment.py)
repeated the benchmark's exact database setup/schema-clone functions and isolated
the failure to **pg_dump in clone_schema**, exit 1: it attempts a default Unix
socket that does not exist, not the supplied TCP endpoint. `clone_schema` puts a
conninfo string in `PGDATABASE` but supplies no `--dbname`, host or port argument
to pg_dump. On this installed toolchain that environment value does not select
the intended TCP connection. The [bounded diagnostic output](jurisdiction-index-benchmark-diagnostic.txt)
confirms both socket failure markers and that the owned database/login cleanup
flags were cleared by the harness after verified absence. It does not expose raw
stderr, credentials, names or source rows.

These original socket diagnostics are historical evidence, not the current
failure. The TCP handoff is now fixed RED-first: pg_dump receives `--dbname`
with the complete supplied TCP conninfo, matching pg_restore. Subprocess output
remains captured and the CLI never prints driver exceptions or credentials.
The unit regression checks both database-connected tool invocations, including
host/port/database/user/password preservation using synthetic credentials only.
There is no psql invocation in this benchmark.

Two subsequent fresh-target restore defects were also reproduced and fixed
RED-first:

- `pg_restore --clean --if-exists` attempted `DROP POLICY IF EXISTS` against
  absent workspace tables/schemas. The IF EXISTS applies to the policy, not its
  target relation. A fresh owned target needs creation, not application drops.
- Restoring source-role DEFAULT ACLs failed because the local maintenance role
  cannot alter the Supabase owners' defaults.

The clone now uses pg_restore's TOC selection: omit only CREATE SCHEMA public
(which the fresh target already has) and DEFAULT ACL entries (which govern
future source-owner objects, not restored objects). Preserve all existing-object
ACLs and custom schema creation. No public application schema is dropped. Unit
coverage asserts these exclusions and retention of workspace schemas/table ACLs.
This does not claim source ownership/default-ACL parity: restoration continues
using the existing `--no-owner` contract.

With those fixes, a new full three-repetition invocation still exits 1 before the
first ingest. The [current failed summary](jurisdiction-index-benchmark-before-tcp-fixed.json)
has `runs: []`. The [current owned diagnostic](jurisdiction-index-benchmark-diagnostic-current.txt)
passes schema clone, then observes **test grants: InsufficientPrivilege,
SQLSTATE 42501** and confirms owned DB/login absence after cleanup.
The failing repository statement in `DisposablePostgres.grant_test_privileges`
is the `section_scope` fixture insert after `SET LOCAL ROLE workspace_admin_owner`:
`permission denied for table section_scope`. Under the existing `--no-owner`
clone, that table is owned by the restoring maintenance role rather than the
source's workspace owner; the fixture relies on ownership authority not supplied
by explicit source-object ACLs. This is a separate ownership/test-harness mismatch,
not a jurisdiction resolver failure. No workspace grants, ownership transfer,
role-membership workaround or shared-cluster change was added to bypass it.

The diagnostic was run from `etl/` using the same interpreter and explicit local
maintenance environment as the benchmark:

```sh
JURISDICTION_BENCH_DIAGNOSTIC=1 python -m pytest -q -s ../docs/research/test_jurisdiction_benchmark_environment.py
```

The full attempts used `python -m etl.benchmark` with:

```text
--source national/2025-legislativas --year 2025 --round legislativas
--schema-database postgres
--local-root /Users/nicolasmateoippoliti/dev/votus-plataforma-lla/archive
--manifest-path ../archive-manifest.json --sources-path sources.yaml
--repetitions 3 --output ../docs/research/jurisdiction-index-benchmark-before-tcp-fixed.json
```

(The original output was `jurisdiction-index-benchmark-before.json`; the rejected
invocation used repetitions 1.) No before/after ingest measurement exists:
resolver calls/time and total ingest wall time are unavailable, and no after-index
full run was attempted after this shared setup failure. **Index use during a real
first load was not measured**, because no real first load began. The existing
synthetic first-load plans must not be represented as a substitute. The public
schema and running stack were left untouched. Correcting the cloned-workspace
ownership/test-grant mismatch and rerunning the comparison remain outstanding;
no hosted target, stack reset, manual schema replacement or grant workaround was
used.

## Still required before closing #481

- Run the [complete-source profiler comparison](../etl-performance-profiling.md)
  on an approved disposable target with the registered archive, identical batch
  size/role/resource limits, first load and reload. Capture resolver calls/time,
  full ingest wall time and output parity. None of those full-ingest measurements
  were made here: the authorized owned benchmark now passes schema cloning but
  fails at the scoped workspace test-fixture insert before any ingestion (above).
- Verify plans with production-sized batches, actual source distribution and
  statistics accumulated during a growing first load. The 32-key microquery
  does not establish these plans for the default 1,000-row batch.
- Account for the documented reliance on autoanalyze and the observed first-load
  sequential scan when interpreting full-run results; the existing writer lacks
  ANALYZE authority, so no runtime ANALYZE or grant change was introduced.
- Exercise the down migration in the privileged migration lane. Its presence and
  target are checked structurally here; live rollback/grant parity was not run.

No end-to-end speedup, complete acceptance, or production-readiness claim follows
from these lookup plans.
