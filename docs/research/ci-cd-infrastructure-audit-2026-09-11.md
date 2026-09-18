# CI/CD audit: shorten feedback without weakening release evidence

Audit date: **2026-09-11 UTC** · Repository baseline: **`e33b2b0`**.

> **Historical snapshot — not a current benchmark.** Measurements below belong to the audit baseline `e33b2b0` and were **not recomputed**. Current-main source at `10db8e1` implements scope wiring, fail-closed aggregation, and separate SQL/browser jobs. No measured speedup is attributed to those changes.

## Executive decision

**Keep the implemented scope wiring and split SQL/browser lanes; measure their current behavior before further tuning.**
Historical successful PR feedback was **443 seconds p50 / 480 seconds p90**.
The combined E2E job dominated that sample; this does not establish today's critical path.
GGA removal was reported complete in the audited clone; that historical local proof is not evidence about other clones.

The next changes should be small, independently reviewable work units:
1. Collect a new comparable sample for the implemented scope selection and split lanes.
2. Add PR-only supersession cancellation, without cancelling main/deployment work.
3. Verify actual merge and deployment enforcement with the repository owner.
4. Profile existing Supabase/SQL substeps before further tuning; lane separation is already implemented.

Do not introduce Nx, Turbo, a hook framework, self-hosted runners, shards, or a custom CD system by default.
No tests, builds, installations, remote mutations, or production access were performed to write this report.
Recommendations below are proposals, not approval to change billing, branch settings, or deployment traffic.

## Evidence and confidence

**High** means directly observed source, structured timing, or an explicit API response.
**Medium** means a bounded inference from those observations; **unknown** means not established.
Parent-collected remote observations and primary-source retrievals are identified as such.
Unless explicitly labeled current-main, source anchors and observations refer to the baseline checkout, except removed GGA files. Historical line numbers must not be read as current-source locations.
Current-main checks below are source inspection only; existing tests were read, not executed, and hosted settings were not rechecked.

| Evidence set | Scope and limitation |
|---|---|
| GitHub runs/jobs | Last 40 Release gates runs; created between Sep 9 03:39:08Z and Sep 11 17:18:11Z |
| Structured E2E timing | Latest eight successful runs, plus nine failed E2E runs |
| Local source | Workflow, classifier, gate runtime, Playwright configuration, ETL wrapper, SQL fixture |
| Control plane | Parent's read-only GitHub API observations; no Vercel dashboard or domain inspection |
| Official guidance | S1–S11 below, retrieved and verified by parent on Sep 11 |

The 40-run sample includes code evolution: **24 matrix ETL runs and 16 older single-job runs**.
It is an operational snapshot, not a controlled experiment or a single-architecture benchmark.
The available CodeGraph index could not be queried: MCP exploration was unavailable and the CLI was absent.
Targeted source reads were used instead; no index changes were attempted.

## Measured baseline

### Workflow elapsed time, not the API update timestamp

Elapsed time is `max(job.completed_at) - run.createdAt`, including initial waiting.
P50 is the midpoint median; p90 uses nearest rank, `ceil(0.9 × n)` in sorted observations.
Do not use the `updatedAt` proxy present in the summary JSON: it includes reporting delay.

| Cohort | n | p50 seconds | p90 seconds |
|---|---:|---:|---:|
| Successful pull requests | 20 | 443 | 480 |
| Successful main pushes | 8 | 438 | 488 |
| Failed pull requests | 12 | 428 | 450 |

Overall conclusions: **28 successes, 12 failures, zero cancellations**.
The 30% failed-run share is not a flake rate: changes, defects, and infrastructure failures are not separated.
All-job queue delay across **272 jobs** is **3 seconds p50 / 4 seconds p90**.
This does not exclude initial workflow waiting: run `34384500008` started over 21 minutes after creation.
Typical queue delay is small; tail workflow admission delay remains a separate diagnostic dimension.

### Job and step execution

These durations include all conclusions; early failures can shorten observations.
Parallel job durations must not be summed to estimate workflow wall time.

| Job or step | n | p50 seconds | p90 seconds |
|---|---:|---:|---:|
| E2E job | 40 | 425 | 470 |
| Web static job | 40 | 52.5 | 61 |
| ETL ordinary, baseline matrix | 24 | 59.5 | 67 |
| ETL atomicity success, baseline matrix | 24 | 38 | 48 |
| ETL atomicity ledger, baseline matrix | 24 | 37 | 48 |
| ETL atomicity SQL, baseline matrix | 24 | 37.5 | 48 |
| ETL older single job, historical only | 16 | 54.5 | 61 |
| Scope job | 40 | 8 | 11 |
| Aggregate `verify` | 40 | 3.5 | 4 |
| E2E gate command within E2E job | 40 | 371 | 400 |
| Chromium and OS dependency installation | 40 | 28 | 36 |

### Inside the gate: latest eight successful runs

| Existing phase | Median seconds | Interpretation |
|---|---:|---|
| Supabase startup | 135.24 | Largest measured phase; includes network/start/publication work |
| Playwright | 105.73 | Browser execution phase, not isolated per-spec attribution |
| pgTAP | 89.09 | Includes setup, multiple proofs, and SQL cleanup |
| Cleanup | 14.13 | Owned environment teardown; not dispensable overhead |
| Production Next build | 13.67 | Already one build |
| Next server lifecycle | 4.08 | Multiple scenario servers sharing that build |
| Port preflight | 3.02 | Isolation and readiness preparation |
| Migrations | 2.71 | Incremental application to disposable stack |
| Rollback/reapply | 2.33 | Release correctness proof |

These medians are not additive guarantees or predicted savings from removing a phase.
The three largest measured phases justify instrumentation priority, not indiscriminate test removal.

### Failures: location is not cause

| Failing job/phase | Observations | Meaning |
|---|---:|---|
| E2E job | 9 | Seven Playwright-phase, one pgTAP-phase, one preflight-phase failure |
| Web static job | 5 | Failing test steps; root causes not established here |
| ETL jobs across sampled names | 5 | Failed job observations, including overlapping matrix cases |
| Aggregate `verify` | 12 | Consequences of upstream failures, not 12 additional incidents |

Counts overlap within runs; do not add them into independent incident totals.
Retain failing spec/assertion identifiers and bounded diagnostics before deciding whether retries are warranted.
A Playwright-phase failure does not establish browser flakiness, and a pgTAP-phase failure does not establish scale-fixture fault.

## Historical, current, and remaining flow

```text
HISTORICAL BASELINE e33b2b0
commit -> local Git commit (GGA-only hook removed in this clone)
PR/main event -> scope (diagnostic only)
             -> web-static --------------------\
             -> ETL matrix ----------------------+-> always verify -> check result
             -> disposable E2E -----------------/
                Supabase -> migrations/status -> SQL proofs/cleanup -> rollback
                -> one Next build -> five scenario servers -> serial browser -> teardown
main push -> Vercel integration -> successful deployment record
                                  actual domain-promotion/check dependency unknown

CURRENT MAIN 10db8e1 (source-verified, not remeasured)
PR -> validated conservative scope -> selected web-static / ETL matrix
                                  -> selected browser + SQL jobs -> always fail-closed verify
main push -> explicit --all -> all four gates -> verify

REMAINING, NOT IMPLEMENTED OR VERIFIED HERE
PR -> supersession cancellation scoped to that PR only
Vercel -> owner-verified deployment checks -> domain assignment after same-SHA verify
current workflow -> new comparable measurements and substep profiling
```

Current SQL and browser jobs are selected together by the `e2e-release` scope gate and run on separate runners.
This source wiring does not by itself establish proof completeness, hosted enforcement, or a latency improvement.

## Findings and decisions

### F1. Scope wiring and aggregate safety — implemented in current main

At the baseline, scope was diagnostic only. Current-main `.github/workflows/release-gates.yml:11–12, 39–59` publishes validated canonical gates.
Job selection consumes them at lines 61–63, 91–93, 151–153, and 191–193.
The aggregate at lines 220–255 uses `always()`, requires scope success, rejects noncanonical output, and checks both E2E lane results.
`apps/web/e2e/ci-path-scope.test.ts:153–243` exercises workflow shell boundaries, lane commands, invalid contracts, and unexpected results; inspected, not rerun.
`apps/web/scripts/ci-path-scope.ts:83–99, 120–151` conservatively classifies changes.
Parent exercised its real stdin CLI: a synthetic ETL modification selected `etl-only`; a docs modification selected `all/unknown`.
Those paths were classifier inputs, not assertions that example files exist.

**Decision:** retain the implemented contract and its output validation and selected-job assertions (units 1b/1c implemented).
Keep the workflow itself always triggered; top-level path filters can leave a required check Pending [S1].
Unknown, mixed, root/shared, SQL, lockfile, workflow, deletion, and rename changes must remain full-gate cases.
Scope failure, missing output, malformed output, unexpected skips, cancellation, and selected-job failure must not pass `verify`.
Only an explicitly unselected job may be intentionally skipped.

ETL-only selection can remove the E2E critical path; a **two-minute PR goal is a hypothesis**, not a measured result.
Web-only selection mostly saves ETL runner work: E2E still determines elapsed time.
A docs-only fast lane needs a separately reviewed contract because docs include operational and specification controls.

### F2. SQL/browser separation — implemented; current bottleneck unmeasured

`apps/web/scripts/e2e-release-gate.ts:70–71, 959–978` already excludes **ten services**:
`realtime`, `storage-api`, `imgproxy`, `mailpit`, `postgres-meta`, `studio`, `edge-runtime`, `logflare`, `vector`, `supavisor`.
Recommending those exclusions as a missing optimization would be incorrect.
The startup command uses `--ignore-health-check`; Supabase documents that it may exit successfully with unhealthy services [S5].
Subsequent migration/status validation and real DB/Auth/browser operations form additional checks.
Assess whether they establish bounded readiness for every required service before changing the flag; port publication alone is not readiness.

`apps/web/scripts/e2e-release-gate.ts:1019–1061` charges setup, pgTAP execution, and SQL cleanup to the same timing phase.
`apps/web/scripts/e2e-gate-runtime.ts:296–379` lists the setup, proof sequence, and cleanup.
The scale fixture contains a 12,000-jurisdiction corpus at `supabase/tests/results_exploration_scale_setup.sql:24–42`.
It also creates a **separate 78,962-jurisdiction / 581,400-official-row corpus** at lines 142–160, plus other fixtures.
Thus neither 12,000 jurisdictions nor 581,400 rows is a total for the entire setup file.
The fixture temporarily relaxes source-kind constraints at lines 89–96; adjacency, fail-stop behavior, and owned teardown matter.

Current-main `.github/workflows/release-gates.yml:179, 217` invokes `--lane browser` and `--lane sql` in separate jobs; lines 220–255 require both selected results. Unit 4 is implemented, not a future lane-split proposal.

**Decision:** remeasure the split workflow and time individual proof labels/startup substeps before attributing the historical 89-second SQL phase to scale setup.
Scale-fixture dominance is **unmeasured**, not an established root cause.
Do not move partially cleaned or weakened database state into a concurrent browser lane.

### F3. Some named SQL proofs are absent from the gate plan — high confidence, bounded claim

`supabase/tests/rls_anonymous_denied.sql` and `supabase/tests/rls_write_role.sql` exist.
Neither appears in the explicit pgTAP plan at `apps/web/scripts/e2e-gate-runtime.ts:305–371`.
A tracked filename search found historical notes, source comments, and the files themselves, but no explicit execution call.
This is a **named-proof reachability gap**, not proof that anonymous denial or write-role behavior is entirely untested.
Other planned workspace/results suites exercise related authorization contracts.

**Decision:** retain this baseline finding as an unverified follow-up: map each required semantic assertion to the current release entry points before changing proof selection further. Lane separation alone does not close this finding.
Wire missing necessary proofs, or demonstrate and document equivalent reached assertions without blindly duplicating suites.
Test the real gate plan and CLI selection, not only helper imports or a brittle fixed count of individual tests.

### F4. ETL CI does not silently accept skipped integrations — discarded hypothesis

`etl/etl/verify.py:609–629` supplies `ETL_TEST_DATABASE_URL`, requests JUnit output with `-rs`, and rejects **any skip**.
Its actual CLI calls this path at lines 696–704; the workflow invokes `etl-verify`, not raw optional pytest.
The wrapper also establishes a marked disposable database and checks cleanup/ownership.
Local plain pytest behavior is not evidence of release-gate behavior.
**Decision:** retain this fail-closed wrapper and its ordinary/atomicity cases; do not replace it with a weaker command.

### F5. Build/browser tuning — secondary in the historical sample; remeasure split lanes

`apps/web/scripts/e2e-release-gate.ts:1113–1154` builds once and starts the scenario servers from that build.
`apps/web/playwright.config.ts:10–17` sets `fullyParallel: false`, one worker, and shared setup/teardown.
`apps/web/e2e/gate-contract.ts:18–27` identifies eight canonical specs.
Parent's coarse inventory found about 68 Vitest files, 23 ETL test files, and two Python spike tests; these are not coverage percentages.
Real Auth/Supabase/Postgres exercise the full path, with some RPC mocks for error states; do not describe everything as mocked or mock-free.
Production build/start already follows Next.js guidance [S6]; typechecking is already separate in web-static.

Current-main browser and SQL commands are separate (workflow lines 179, 217); this is not browser sharding or evidence of faster builds.
**Decision:** retain the baseline caution: keep one browser worker until independent fixture ownership is proven [S3]. Current tuning priority requires a new comparable sample.
Sharding multiplies setup across machines and is not the first optimization for this gate [S4].
Do not lead with browser binary caching: Playwright explicitly discourages it [S3].
Consider `.next/cache` only after dominant phases; a cache is not a trusted deployment artifact [S7].

### F6. Caching/version hygiene is mostly sound — high confidence on configuration

The workflow uses SHA-pinned actions, read-only contents permission, non-persisted checkout credentials, and frozen pnpm installs.
It pins uv `0.8.8`, setup-uv action `v7.6.0`, and Supabase CLI `2.112.0` for E2E versus `2.116.0` for ETL.
The pinned setup-uv source defaults include `**/uv.lock` and `**/pyproject.toml`, with `prune-cache: true` [S8].
**The nested `etl/uv.lock` is covered: a missing nested cache key is a discarded hypothesis.**
Cache hit effectiveness remains unmeasured; version convergence is a separate compatibility change, not a promised speedup.

### F7. No concurrency policy; savings are preventative, not measured — high confidence

The current-main workflow still has no concurrency declaration; the historical sample contains zero cancellations.
Use workflow-unique, PR-specific grouping and cancel superseded PR work only [S2].
Avoid placing all main runs in one concurrency group merely with `cancel-in-progress: false`:
default pending replacement can still discard waiting work.
Keep main/deployment sequencing explicit and non-cancelling; preserve owned cleanup on interrupted PR jobs.
No obsolete-work duration or monetary saving has been demonstrated by this audit.

### F8. Merge and deployment enforcement require owner verification — high confidence on observations

Parent's rulesets and main branch-protection API reads both returned HTTP 403:
“Upgrade to GitHub Pro or make this repository public to enable this feature.”
Installed protection was therefore **not verified**; this is an observed plan constraint, not an authorization to change repository visibility [S11].
The workflow inventory contained Release gates and Dependency Graph, not a separately verified CD gate.

| SHA | Vercel successful deployment ID | Success time, Sep 11 UTC | Matching CI run | Last job completed |
|---|---:|---|---:|---|
| `e33b2b0` | 6398194845 | 17:18:43Z | 34626912700 | 17:26:13Z |
| `df70bc5` | 6394156242 | 13:32:37Z | 34604841995 | 13:40:07Z |
| `f0e7f86` | 6387499000 | 06:06:52Z | 34568548842 | 06:13:25Z |

These records came from `vercel[bot]`, named Production, but had `production_environment=false`.
For the first row CI began at 17:18:11Z: deployment success preceded completion by several minutes.
**This proves ordering of records, not that users received unverified production traffic.**
Domain aliases, traffic assignment, selected checks, and Vercel plan/project availability were not inspected.
Prefer native deployment checks holding custom-domain assignment until same-commit `verify` passes, if available [S10].
Confirm the exact check identity is unique; a prior SHA or another PR's success cannot authorize promotion.
Force Promote is a documented bypass and needs an explicit owner policy, not silent use.

## Historical clone-local completed work: GGA removal

Parent removed tracked `.gga` (75 lines), tracked `.opencode/agent/gga-reviewer.md` (19 lines), and the local-only `.git/hooks/pre-commit`.
The local hook contained only `GGA_PROVIDER=codex gga run`; no unrelated hook commands were removed.
Effective `core.hooksPath`, including inherited configuration, was absent; this clone used `.git/hooks`.
Parent observed RED with a temporary fake-GGA sentinel, then GREEN by replaying a real commit in a disposable repository.
The proof script was session-local and is not a durable reproducibility artifact; it was not rerun for this refresh.
No actual GGA/model/network invocation or actual repository commit occurred; independent verification found no blockers, exactly two tracked deletions (94 lines), and only 14 sample hooks remaining.
A tracked non-archive file-reference sweep returned zero active references; three historical archive files were retained.
The global CLI, Git recovery evidence, and history were intentionally untouched.
The removed configuration's 300-second timeout was a bound, **not measured commit latency**.
Other existing clones must inspect and remove their GGA-only hook themselves; pulling tracked deletions cannot remove local hooks.
No persistent test or new hook framework is warranted solely to test a local hook deletion [S9].
Prefer optional cheap staged/focused checks and deliberate local commands; do not make full E2E or LLM review mandatory on every commit or push.

## Prioritized implementation units and gates

Implemented rows record current source status, not new performance evidence. Open rows are separate reviewable changes; do not bundle settings changes with test orchestration refactors.
All executable follow-up work requires strict RED-before-implementation and focused GREEN evidence.

| Unit | Change and acceptance evidence | Stop or rollback criterion |
|---|---|---|
| 0 — complete | Retain GGA deletion and parent proof; document other-clone caveat | If a clone has unrelated hook commands, stop and preserve them |
| 1a — baseline | Preserve bounded phase records and cohort definitions; validate elapsed calculations against actual job completion | Reject proxy timestamps, mixed ETL architectures, or fabricated savings |
| 1b — implemented | Current-main scope wiring and existing tests cover real classifier CLI plus workflow/aggregate behavior: ETL-only, web-only, mixed, unknown, SQL, locks, root, rename/delete, malformed/missing output | Any selected skip/failure/cancellation producing green: restore all-jobs selection |
| 1c — implemented | Current-main stable always-running `verify` checks both lanes; retain tests that assert selected success and only intentional unselected skips; test scope failure and each matrix failure | Missing/Pending aggregate or fail-open result blocks changes; preserve atomic consistency with 1b |
| 1d — PR concurrency | Two commits on one PR supersede correctly; distinct PRs remain independent; main runs retained; interrupted resources cleaned | Cross-PR cancellation, dropped main work, or orphaned owned resources: remove new concurrency policy |
| 2 — deployment control | Owner verifies plan/settings and domain assignment; pending/failed same-SHA `verify` holds production promotion; passing current SHA releases it | Inability to prove hold: owner explicitly pauses promotion; never silently bypass checks |
| 3a — unverified baseline follow-up | Map required authorization, source-kind, migration, and scale assertions to current gate entry points; close necessary named-proof gaps | Missing reached safety assertion blocks further proof-selection changes |
| 3b — substep profiling | Add bounded timings for existing startup/proof labels, including failure/not-started status; preserve result and cleanup behavior | Diagnostics expose sensitive data or alter gate outcome: remove instrumentation change |
| 4 — implemented; measurement open | Separate SQL/browser jobs and commands, selected together and required by `verify`; verify proof mapping and collect comparable timings | Lost proof, weakened isolation, or measured regression requires a separately reviewed workflow correction |

Preserve source-kind separation through **default query, aggregate, and rendered page**, not one substitute assertion.
Preserve real Auth/RLS, Hare versus D'Hondt by level, nine PBA seats per election, election-aware idempotency, and quarantine reason/category counts.
Keep full main/crosscutting coverage; safety and scale contracts must not become nightly-only.
Reduced runtime modes already exist in `apps/web/scripts/e2e-gate-runtime.ts:394–409, 462–495`; reuse only after validating what each reaches.

Evaluate each performance change with a comparable **20-run before/after sample**, controlled application SHA where feasible.
Record workflow/config revision, event, scope, conclusion, runner, cache state, elapsed time, runner work, phases, and cancellations separately.
Do not run uncontrolled full gates merely to fill a sample; schedule evidence collection with the owner.
Treat the ETL-only two-minute goal as provisional; full-gate targets follow profiling rather than subtraction of unrelated medians.

## Explicit unknowns and owner decisions

- Exact failure root causes, repeatability, and per-spec durations; no flakiness diagnosis is justified yet.
- Startup pull versus initialization/readiness cost, SQL substep costs, and cache hit effectiveness.
- Frequency of truly ETL-only/web-only changes and superseded PR work; expected total savings cannot be priced yet.
- Whether all required named SQL assertions have equivalent reached coverage elsewhere.
- Private-repository protection entitlement, configured required check identity, and Vercel deployment-check availability.
- Actual production domain assignment and traffic timing; approve settings/billing decisions before changing them.

## Primary-source references and claim mapping

All sources below were verified by parent on **2026-09-11**; living documentation may change.
Quoted fragments are short excerpts; remaining descriptions summarize applicability to this repository.

- **S1 — GitHub required checks:** https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks
  Workflow path/branch skips leave checks “Pending”; conditional job skips report success. Use `always()`/`needs` and explicit aggregate assertions. Add `merge_group` only if adopting merge queue.
- **S2 — GitHub concurrency:** https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency
  `cancel-in-progress` cancels active same-group work; pending replacement also matters. Supports PR-only grouping, not a claim of measured savings.
- **S3 — Playwright CI:** https://playwright.dev/docs/ci
  “recommend setting workers to 1 in CI environments”; “Caching browser binaries is not recommended.” Supports retaining serial ownership and avoiding cache-first tuning.
- **S4 — Playwright sharding:** https://playwright.dev/docs/test-sharding
  Sharding distributes execution across machines. It does not remove this repository's per-machine Supabase/setup cost.
- **S5 — Supabase start:** https://supabase.com/docs/reference/cli/supabase-start
  Supports service exclusions; full stack recommends at least 7 GB RAM. `--ignore-health-check` can exit zero with unhealthy services; ten exclusions already exist here.
- **S6 — Next.js Playwright:** https://nextjs.org/docs/app/guides/testing/playwright
  Recommends testing production code through build/start; the gate already complies.
- **S7 — Next.js CI cache:** https://nextjs.org/docs/app/guides/ci-build-caching
  Persist `.next/cache`; Vercel automatically caches builds. This is secondary to the measured startup/SQL/browser phases.
- **S8 — uv GitHub integration:** https://docs.astral.sh/uv/guides/integration/github/
  Built-in setup-uv caching and locked installation guidance. Version-specific authority: https://github.com/astral-sh/setup-uv/blob/v7.6.0/action.yml confirms nested lockfile globs and default pruning.
- **S9 — Git hooks:** https://git-scm.com/docs/githooks
  Pre-commit runs during `git commit` and can be bypassed. Local hooks are developer assistance, not central enforcement.
- **S10 — Vercel deployment checks:** https://vercel.com/docs/deployment-checks
  Selected GitHub checks can hold production custom-domain assignment; Force Promote bypasses the hold. Project/plan availability remains unverified.
- **S11 — GitHub protected branches:** https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches
  Private protection availability depends on an applicable paid plan. The observed 403 is a constraint; making this private repository public is not recommended.

## Bounded reproducibility appendix

The parent used session-local run/job, elapsed-summary, and phase-timing inputs; these are not durable repository artifacts. Sanitized historical aggregate results are preserved above, but raw inputs were not available for recomputation in this refresh.
Do not copy raw SQL failures, credentials, Auth state, or hosted database contents into this report.
Join run `databaseId` to each job's `run_id`; the jobs JSON wrapper's `run` is not a scalar identifier.
Recompute elapsed from maximum completion minus creation; group by event/conclusion and keep ETL architectures separate.
For successful phase medians, filter the eight successful timing records and divide `durationMs` by 1,000.

Read-only follow-up checks: `git diff --check`; inspect the exact source anchors above; inspect the workflow-selected proof plan.
Filename search used: `git grep -n -F -e rls_anonymous_denied.sql -e rls_write_role.sql`.
Its matches are documentation/comments, not evidence that these files are explicitly executed by CI.
The report writer did not rerun the GGA proof, classifier, application, ETL, or E2E suites.
This refresh changes only the audit and its local task evidence; workflow/runtime behavior and roadmap scope are unchanged.

## Key learnings

1. A scope classifier saves nothing until the workflow consumes its decision safely.
2. Phase failure location is evidence, not a root-cause or flakiness diagnosis.
3. Release wrappers can enforce stronger guarantees than their underlying test commands.
4. Deployment success records do not establish production domain-promotion timing.
5. Large synthetic fixtures need substep measurements before assigning bottleneck causality.
