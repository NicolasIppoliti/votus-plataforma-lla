# Operate the results explorers safely

The official-results and fiscalizacion-coverage explorers are deployed after migrations 0020-0022. The disposable release proof, hosted migration apply, and Vercel deployment completed on 2026-08-12. Production plan capture remains a separate read-only operator check.

## Reproduce the local proof

Run from the repository root:

```bash
uv --directory etl run pytest tests/test_migration_sql.py -q
pnpm --dir apps/web exec vitest run e2e/release-gate-safety.test.ts e2e/scenario-ownership.test.ts
node --experimental-strip-types apps/web/scripts/e2e-release-gate.ts --release-proof-only
```

The disposable proof MUST report:

- migration inventory `0001` through `0022` exactly;
- pgTAP success for authenticated execution, anonymous denial, RLS-visible reads, normalized `02/027` identity, source isolation, and literal `is_random_sample = false`;
- representative scale evidence for 120,000 official result rows across 12,000 mesas and schools, including actual planning time, execution time, shared hit blocks, and shared read blocks;
- rollback sequence `0022 down -> 0021 down -> 0020 down`, followed by `0020 up -> 0021 up -> 0022 up`;
- restored authenticated grants, anonymous denial, and zero owned Docker/workdir residue.

These timings describe the disposable fixture and current machine only. They MUST NOT be presented as production latency.

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

## Verify the hosted release

1. Confirm the target is the linked `votus-prod` project and that hosted migrations 0020-0022 are applied.
2. Confirm Vercel production serves the `main` deployment from `apps/web`.
3. Sign in through the hosted login and verify `/drilldown` and `/fiscalizacion` from the authenticated navigation, a copied deep link, a refusal, provenance, and coverage-to-official navigation.
4. If migrations or query plans change, rerun the read-only production plans below and record the unedited output with timestamp, project ref, row counts, planning/execution time, buffers, and index names.

## Read-only production plan capture

Obtain the direct non-pooling Postgres URL through the approved secret channel; never commit or print it. Then run:

```bash
psql "$POSTGRES_URL_NON_POOLING" -X -v ON_ERROR_STOP=1 <<'SQL'
select count(*) as result_rows from result_row;
select count(*) as jurisdictions from jurisdiction;

explain (analyze, buffers, format text)
select results_exploration_facets(
  '9dd2c13b-e026-47b5-9db5-191cfd368164'::uuid,
  '16d238ae-794f-4a8b-a062-6816d427a8bf'::uuid,
  '02', '027', null
);

explain (analyze, buffers, format text)
select results_exploration_official(
  '9dd2c13b-e026-47b5-9db5-191cfd368164'::uuid,
  '16d238ae-794f-4a8b-a062-6816d427a8bf'::uuid,
  '02', '027'
);

explain (analyze, buffers, format text)
select results_exploration_coverage(
  '9dd2c13b-e026-47b5-9db5-191cfd368164'::uuid,
  '16d238ae-794f-4a8b-a062-6816d427a8bf'::uuid,
  '02', '027'
);
SQL
```

Do not generalize a captured production plan into a latency guarantee. It is evidence for the observed corpus, indexes, and timestamp only.

## Rollback and forward recovery

Stop web rollout first. Against the approved target, execute the down artifacts in this order:

```text
supabase/migrations/down/0022_results_exploration_scale.down.sql
supabase/migrations/down/0021_results_coverage.down.sql
supabase/migrations/down/0020_results_exploration.down.sql
```

This drops only the PR3 scale index/coverage replacement, then coverage, then official explorer objects. It does not rewrite electoral rows. Re-apply 0020, 0021, and 0022 in ascending order before restoring the web deployment.

After either direction, verify:

- `authenticated` can execute every installed explorer RPC and `anon` cannot;
- official totals contain only `source_kind = 'official'`;
- fiscalizacion appears only as presence/coverage, always with `isRandomSample: false`;
- administrative codes remain normalized at the ingestion/database boundary;
- provenance and operational evidence contain no personal data.

## Release status

| Boundary | Current state |
|---|---|
| Disposable migrations, rollback/reapply, grants, auth/RLS | Passed |
| Representative high-cardinality plans | Passed locally; not a production benchmark |
| CI/disposable browser gate | Passed before merge |
| Hosted migrations 0020-0022 | Applied to `votus-prod` |
| Hosted Vercel release | Deployed from `main` |
| Production EXPLAIN/timing evidence | Pending read-only operator capture |
