# Operate the results explorers safely

## Publication and deployment boundary

Migration `0027_optimize_non_official_source_audit.sql` is published by the issue #53 base change. This issue #54 follow-up adds no migration: it independently proves the existing partial index for the coverage RPC and does not change an explorer function, grant, result, timeout, or web application behavior. Repository publication is not the same as applying 0027 to a hosted database.

This change does not run a hosted migration or deploy the web application. The existing release record says migrations 0020-0022 and their Vercel release were deployed on 2026-08-12; it is not evidence that migrations 0023-0027 are hosted. Apply 0027 only through the approved hosted release process after the preflight below.

## Reproduce the local proof

Run from the repository root with the [web prerequisites](../apps/web/README.md),
including pnpm 12.3.4 and the owned gate's Docker/Supabase capabilities:

```bash
uv --directory etl run pytest tests/test_migration_sql.py -q
npm exec --yes --package=pnpm@12.3.4 -- pnpm --dir apps/web exec vitest run e2e/release-gate-safety.test.ts e2e/scenario-ownership.test.ts
npm exec --yes --package=pnpm@12.3.4 -- pnpm --dir apps/web test:e2e:gate -- --release-proof-only
```

The disposable proof MUST report:

- exact canonical production migration inventory and a non-colliding isolated E2E-only service-role migration, as defined by `MIGRATION_VERSIONS` and `SYNTHETIC_MIGRATION` in the [current gate plan](../apps/web/scripts/e2e-gate-runtime.ts);
- pgTAP success for authenticated execution, anonymous denial, internal-function denial, RLS-visible reads, normalized identities, source isolation, and literal `is_random_sample = false`;
- a scale contract with many out-of-scope official rows, a tiny selected `02/001` scope, non-official rows elsewhere, unchanged official totals, and null/unsupported source kinds audited as `unknown`;
- an `EXPLAIN (ANALYZE, BUFFERS)` plan that names `result_row_non_official_scope_idx` for the selected source-exclusion audit;
- the current rollback/reapply proofs selected by that gate plan, including the historical 0027 index contract; inspect the [release SQL](../supabase/tests/results_exploration_release.sql) for its actual sequence rather than treating the original 0027-era chain as the whole current gate;
- restored authenticated grants, anonymous/internal denial, and zero owned Docker/workdir residue.

To inspect inventory without running a stack, open the gate plan's two constants
and compare them with the filenames directly under [forward migrations](../supabase/migrations/).
The [runner](../apps/web/scripts/e2e-release-gate.ts) validates that inventory before
execution and installs synthetic grants only in its owned test environment.
The current gate includes later numbered and timestamped migrations; the hosted
0027 procedure below remains a historical, migration-specific contract, not a
claim about today's deployed prefix. See [partial down coverage](../supabase/migrations/down/README.md).

Disposable timings describe only the fixture and current machine. They are not production latency guarantees.

## Backfill authoritative jurisdiction names

Deploy the ETL name-persistence code before scheduling any backfill. Existing hosted rows gain
`distrito_name`, `seccion_name`, and `circuito_name` only by replaying verified source archives
through that deployed ETL path. The replay preserves source spelling (including code-like circuit
names), normalized administrative codes, establishment names, and source isolation.

The hosted replay is a separate operational change and requires explicit authorization for the
target project and archive set. This code change does not mutate a hosted database, and operators
MUST NOT replace the replay with a hardcoded SQL name migration or a source-name lookup table.
If the ETL deployment is rolled back, stop the replay and retain the verified archives for a later
forward recovery; the explorer remains safe because absent or conflicting names render explicit
status labels rather than fabricated names.

## Hosted preflight

Use the approved direct, non-pooling Postgres connection. Never print or commit it. Before applying 0027, capture the following read-only evidence:

```sql
select version
from supabase_migrations.schema_migrations
order by version;

select
  to_regprocedure('public.results_exploration_official(uuid,uuid,text,text,text,text,integer,text)')
    as official_wrapper,
  to_regprocedure('public.results_exploration_official_0020(uuid,uuid,text,text,text,text,integer,text)')
    as official_internal,
  to_regclass('public.result_row_non_official_scope_idx') as existing_0027_index;

select c.reltuples::bigint as estimated_result_rows,
       s.n_live_tup,
       s.last_analyze,
       s.last_autoanalyze
from pg_class c
left join pg_stat_user_tables s on s.relid = c.oid
where c.oid = 'public.result_row'::regclass;

select source_kind, count(*)
from result_row
group by source_kind
order by source_kind nulls first;
```

Stop if the inventory is not the expected deployed prefix, either function identity is missing, the 0027 index already exists without matching migration history, statistics are unavailable/stale enough to invalidate the rollout estimate, or the source distribution differs materially from the corpus used to approve the change. Resolve drift before applying anything.

## Coordinate ETL writes

The canonical migration uses ordinary `CREATE INDEX`, not `CREATE INDEX CONCURRENTLY`. It allows reads but can wait on in-flight transactions and blocks writes to `result_row` while the index is built.

1. Pause every ETL writer that can insert, update, or delete `result_row`.
2. Confirm in-flight ETL transactions have committed or rolled back.
3. Apply only the expected canonical migration through the approved hosted migration mechanism.
4. Keep writers paused through `ANALYZE` and the post-apply checks.
5. Resume ETL only after the index definition, exact `02/001` plan, function identities, and access boundaries pass.

If the hosted table cannot tolerate this write pause, stop. Do not rewrite the canonical migration ad hoc; prepare a separately reviewed concurrent-index runbook.

## Post-apply verification

Refresh planner statistics before evaluating the plan:

```sql
analyze public.result_row;
analyze public.jurisdiction;
```

Verify the exact index contract and function identities:

```sql
select pg_get_indexdef('public.result_row_non_official_scope_idx'::regclass);

select
  to_regprocedure('public.results_exploration_official(uuid,uuid,text,text,text,text,integer,text)')
    as official_wrapper,
  to_regprocedure('public.results_exploration_official_0020(uuid,uuid,text,text,text,text,integer,text)')
    as official_internal;
```

`pg_get_indexdef` must show columns `(election_id, category_id, jurisdiction_id)` and predicate `source_kind IS DISTINCT FROM 'official'`. The predicate is intentional: it keeps null source kinds inside the exclusion audit rather than silently omitting them.

Capture the exact selected audit plan with approved election/category UUIDs substituted locally:

```sql
explain (analyze, buffers, format text)
select count(*)::bigint, coalesce(sum(rr.votes), 0)::bigint
from public.result_row rr
join public.jurisdiction j on j.id = rr.jurisdiction_id
where rr.election_id = '<approved-election-id>'::uuid
  and rr.category_id = '<approved-category-id>'::uuid
  and rr.source_kind is distinct from 'official'
  and j.distrito_code = '02'
  and j.seccion_code = '001';

explain (analyze, buffers, format text)
select public.results_exploration_official(
  '<approved-election-id>'::uuid,
  '<approved-category-id>'::uuid,
  '02', '001'
);
```

The direct audit plan must name `result_row_non_official_scope_idx`. Record unedited output with timestamp, project reference, row counts, planning/execution time, buffers, and index names. Confirm the wrapper's official totals match the pre-apply result and its `source_exclusions` still includes every fiscalizacion, unsupported, and null source row in the selected scope. Do not generalize the captured plan into a latency guarantee.

Finally verify:

- `authenticated` can execute the public explorer RPCs;
- `anon` cannot execute them;
- the preserved `results_exploration_official_0020` function remains inaccessible to `authenticated`, `anon`, and `public`;
- official totals contain only `source_kind = 'official'`;
- provenance and operational evidence contain no personal data.

## Rollback and reapply

Coordinate the same ETL write pause before changing the index. The 0027 rollback is exactly:

```text
supabase/migrations/down/0027_optimize_non_official_source_audit.down.sql
```

It drops only `result_row_non_official_scope_idx`. It does not rewrite electoral rows, alter explorer functions, change grants, or roll back migrations 0020-0026. After rollback, verify `to_regclass('public.result_row_non_official_scope_idx')` is null and both official function identities and their access boundaries are unchanged.

To recover, reapply only `0027_optimize_non_official_source_audit.sql`, run `ANALYZE` on `result_row` and `jurisdiction`, repeat the exact `02/001` plan and access checks, then resume ETL writes.

The broader disposable release proof intentionally rolls 0027 and the explorer migration chain backward and forward to prove integration. That test sequence is not an instruction to remove hosted explorer functions when only this performance index needs rollback.

## Independent coverage proof (#54)

The partial index is shared infrastructure: coverage's unsupported-source audit uses the same election/category/jurisdiction and non-official predicate as the issue #53 source-exclusion audit. Issue #54 now has its own production-shaped `2025 legislativas / DIPUTADO NACIONAL / 02/027` scale proof, public coverage RPC plan, and direct unsupported-source audit plan. The proof adds no second migration and does not claim that a hosted database is fixed. Applying migration 0027 through the approved hosted release process remains the runtime fix.

## Release status

| Boundary | Current state |
|---|---|
| 0027 repository publication | Included in the issue #53 base; no new migration in #54 |
| Independent #54 coverage scale and plan proof | Included in this follow-up |
| Disposable migration, scale, rollback/reapply, grants, auth/RLS proof | Required before merge |
| Hosted 0027 migration | Not performed by this change |
| Hosted web deployment | Not required; application behavior is unchanged |
| Production `02/001` plan capture | Required from an approved operator after hosted apply |
