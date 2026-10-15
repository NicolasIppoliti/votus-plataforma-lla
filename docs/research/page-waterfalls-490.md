# Page waterfalls #490 — original blocked attempt

> Historical notes: the missing-helper blocker below has been resolved by the
> explicitly authorized local installation. See [current measurements and installation ledger](page-waterfalls.md)
> for the successful 80-sample baseline. The baseline JSON now contains that run;
> the candidate JSON remains an older blocked receipt. No optimization was promoted.

## Result

**No latency numbers were collected. Issue #490 remains incomplete.** Production
compilation works with the running stack's local configuration, but synthetic
workspace setup cannot use the existing e2e fixture helpers: neither helper is
installed in this stack. The runner fails closed before creating a user or
workspace. No stack reset, stop, migration, fixture installation or hosted request
was performed.

The baseline and candidate JSON files are **blocked-run receipts**, not benchmark
results and not evidence that a candidate was implemented:

- [`page-waterfalls-490-baseline.json`](page-waterfalls-490-baseline.json)
- [`page-waterfalls-490-candidate.json`](page-waterfalls-490-candidate.json)

| Measurement | Local | Hosted |
| --- | --- | --- |
| Requested samples per route/temperature | 10 | none |
| Collected successful samples | 0 | 0 |
| Cold/warm median and p95 TTFB | not collected | not collected |
| Navigation/filter-to-result median and p95 | not collected | not collected |
| Route call counts and measured critical path | not collected | not collected |
| DB network latency / isolated SQL timing | not collected / unavailable | not collected |

The issue's 13 RPC + 2 getUser count remains a **static hypothesis for one Panorama
path**, not an observed average or a claim about every route.

## Reproduction identity and exact blocker

- Inspection/build baseline SHA: `0dcd6a945b5ad74478c71c7250025fca51573d4e`.
- Branch: `perf/490-page-waterfalls`; instrumentation and runner are uncommitted
  changes on that SHA, not bytes contained in the SHA.
- Runtime: Node `v24.21.0`, Next.js `16.3.6`, TypeScript `7.0.2`.
- Environment: local Docker stack, DB container
  `supabase_db_votus-plataforma-lla` observed running. Local API publication was
  verified against the matching Kong container's loopback binding. No hosted
  measurement was attempted. The DB has no hosted region in this experiment.
- Planned corpus: existing public official results, 2023 generales versus 2025
  legislativas, `DIPUTADO NACIONAL`, distrito `02`, sección `027`, section level.
  A read-only aggregate confirmed official rows exist for both election/category
  combinations. No official data was rewritten or substituted with fiscalización.
- Planned workspace: a new synthetic user plus an organization with the existing
  e2e helper's section entitlement. Actual workspace state: **not created**.

The runner's read-only catalog preflight checks these exact public function names:

```sql
select count(*)
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'e2e_setup_authorized_fiscal_fixture',
    'e2e_cleanup_authorized_fiscal_fixture'
  );
```

Observed result: **0**, required result: **2**. These helper definitions live in
`apps/web/e2e/service-role-grants.sql`; that file also changes grants, roles and RLS
policies. It was **not executed against the running stack** to work around the
missing prerequisites. The runner deliberately does not install fixture schema
or invoke the release gate. Profiling requires an explicitly provisioned local
fixture environment with those helpers; this implementation does not silently
modify shared authorization policies.

## Instrumentation

Enable `VOTUS_PROFILE_SPANS=1` in the server environment. Other values leave it
disabled. It is not a public/client environment flag.

- Middleware overwrites incoming profiling headers with a fresh opaque trace UUID
  and a closed route label. It forwards that metadata to the render and exposes
  the generated trace UUID on successful responses for local sample correlation.
  This is a diagnostic request identifier, never an auth user/session identifier.
- Server spans use AsyncLocalStorage for parent edges, isolating concurrent
  requests. Independent layout/page roots share the middleware-generated request
  identifier. Epoch-relative monotonic start times plus durations preserve
  overlaps across middleware and render execution.
- Auth getUser checks remain independent in middleware and layout. Claims and
  every named RPC through the existing workspace adapter are timed in place.
- Panorama, drilldown and compare page-function evaluation have root spans.
  Panorama loading and validated drilldown evidence have child spans.
- Section, province and circuit reference geometry loaders are timed where they
  actually execute. Client-triggered geometry server actions are **separate HTTP
  requests**; the runner reports related requests separately rather than merging
  their authorization context with the document request.
- SessionMonitor is identified by the closed `/api/session` route label and has a
  separate count/timing summary, not part of page RPC counts.

Records contain only a fixed operation label, timing bounds, outcome, closed route
label and generated trace/parent identifiers. No arguments, results, exception
contents, query strings, headers, credentials, cookies or authorization identities
are serialized. The runner rejects extra JSON keys and unknown operation labels,
then replaces trace UUIDs with sample-local parent indexes in persisted waterfalls.
Diagnostic sink failures cannot change application control flow.

`outcome=ok` means the SDK promise resolved, **not** that authorization succeeded:
Supabase may resolve with an error field. Existing callers still evaluate those
fields. Page spans cover async component evaluation/data loading, **not the entire
React stream serialization or browser hydration**. SQL is not separately exposed
by these SDK calls. The report's `criticalEnvelopeMs` is the instrumented elapsed
envelope; `coveredMs` is the union of intervals, not a sum of nested work. Parent
edges and offsets reconstruct the observed span tree/overlap, not a proven SQL
execution DAG. Do not label that envelope a fully attributed critical path.

## Runner protocol

From `apps/web`:

```sh
node --experimental-strip-types scripts/profile-page-waterfalls.ts baseline 10
node --experimental-strip-types scripts/profile-page-waterfalls.ts candidate 10
```

Each invocation:

1. Resolves configuration from local Supabase status without printing it; checks
   the API is credential-free HTTP loopback and matches the expected container's
   publication. Credentials remain in memory.
2. Runs `pnpm build:next` with explicit local URL/anon configuration. The measured
   Next child receives no inherited service-role key. Only fixture setup and
   teardown can use the local admin client.
3. Checks the running DB and required fixture helpers before mutation. On this
   stack it stops here with `local_fixture_helpers_missing`.
4. When prerequisites exist, creates a unique synthetic user and section-scoped
   workspace through the existing fixture RPC, signs in through the actual login
   form, and switches organization through the actual UI/API. Auth storage state
   stays in memory, never on disk. Teardown targets only the returned fixture and
   newly created user; it does not find/delete pre-existing users.
5. For each route and each of n iterations (n bounded to 10–20), starts a fresh
   owned Next process on a free loopback port, captures a first visit and a repeat
   document request, then closes only the browser context/server it created.
   Fresh-process samples still inherit warm OS/Postgres caches; those are not
   flushed. Login readiness probes do not load an authenticated page.
6. For drilldown and compare, separately samples real primary Next Link
   navigation. Those links may enter selector state rather than the fully scoped
   document corpus; they are explicitly separate workload buckets. Navigation
   timing starts at the click, excluding the setup visit. This is not yet a
   verified filter-control-to-hydrated-result experiment.
7. Separates transport/render errors from successful quantiles. Reports n,
   arithmetic median, nearest-rank p95, per-operation call counts/timing, parent
   indexes, related requests and SessionMonitor activity. Raw logs, response
   bodies and stored credentials are never written to reports.
8. Writes only the two authorized `docs/research` report paths, capped at 4 MB
   each. No observation file is written under `/tmp`.

The post-preflight sign-in/sampling/cleanup branches remain **unexercised locally**
because fixture setup is unavailable. Response completion plus a visible main
region is not proof that hydrated evidence is complete. Error-vs-evidence
classification and true filter completion still need browser validation before
benchmark conclusions are drawn.

## Optimization disposition

**Do not promote request memoization. No prototype was attempted and no improvement
or measured rejection is claimed.** There is no measured baseline or real-route
revocation proof to support it.

A scoped call-site check also disproves the suggested workspace-selection reuse
opportunity in the current source: `loadWorkspaceSelection()` has one layout
caller and one `/api/workspace` caller, which are separate requests. None of the
three pages calls it. Wrapping that function with React `cache()` therefore has
**zero statically identified repeated calls within the target render**. This is a
call-site observation, not a latency measurement. Repeated claims verification in
workspace loaders remains a more plausible experiment, but its security and cost
must be measured before changing it.

Once the fixture environment is available, the remaining experiment must be
RED-first and use the same corpus/protocol. Drive the actual production routes
with expired/revoked sessions, revoked membership, disabled organizations, stale
revisions, organization switching and pending requests. Compare figures,
provenance, exclusions and source_kind. Existing mocked unit coverage is not a
substitute for that real-route security matrix. Keep bootstrap sequencing and
existing bundle parallelism. Reject a candidate that is unmeasured, worsens
cost/latency or weakens revocation. The `candidate` runner argument is a report
label, not an optimization enablement flag.

## Verification evidence

- Correlation RED: new metadata test failed against the previous helper because
  request/route/parent/start fields were missing; 2,069 other tests passed.
- Reporting RED: report tests failed to import the not-yet-existing helper;
  2,070 other tests passed.
- GREEN/triangulation: `pnpm exec vitest run` passed **105 files / 2,078 tests**.
  Request isolation, parent edges, incoming-header overwrite, SessionMonitor
  separation, privacy projection, quantiles, overlapping intervals and endpoint
  restrictions are covered by deterministic tests.
- Final `pnpm typecheck` and `pnpm lint` both passed.
- Direct `pnpm build:next` without local environment failed on missing public
  Supabase configuration. The runner supplies validated local configuration and
  its subsequent production build passed before the fixture preflight failed.
- No e2e gate was invoked and no optimization RED/GREEN evidence is claimed.
