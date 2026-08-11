# Tasks: Results Exploration UI
> Planning reset: two pre-commit reviews rejected prior horizontal WU1 under the reachability rule. The maintainer explicitly authorized a native reset; PR1 and PR2 are complete, and only PR3 remains pending.
## Review Workload Forecast
| Field | Value |
|---|---|
| Estimated authored changes | 2,600–3,600 lines total; each PR ≤1,500 target |
| 400-line / 1,500-line risk | High / Medium |
| Split | Official explorer → coverage explorer → release proof |
| Delivery / chain | auto-chain / stacked-to-main |
Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High
1500-line budget risk: Medium
### Autonomous Work Units
| Unit | Exact boundary | Focused test command | Runtime evidence | Rollback boundary |
|---|---|---|---|---|
| PR1 | Official-only `0020` SQL/down, repository/contracts, `/drilldown`, layout, and their tests; base `main` | `uv --directory etl run pytest tests/test_migration_sql.py -q && pnpm --dir apps/web test -- exploration.test.ts drilldown/page.test.tsx` | Authenticated cold start → copied deep link renders identical official figures | Drop official `0020` objects; revert official repository, drilldown, layout |
| PR2 | Coverage-only `0021` SQL/down, repository/contracts, `/fiscalizacion`, and their tests; base `main` after PR1. Includes only the `service-role-grants.sql` and `scenario-ownership.test.ts` verification-harness corrections required to prove the new coverage browser journey; no PR3 release/scale scope. | `uv --directory etl run pytest tests/test_migration_sql.py -q && pnpm --dir apps/web test -- coverage.test.ts fiscalizacion/page.test.tsx` | Authenticated covered/uncovered escuela and mesa → official-result link | Drop coverage `0021` objects; revert coverage repository/page and the two isolated verification-harness corrections |
| PR3 | E2E fixtures/specs, scale indexes if proven, release docs, production proof; base `main` after PR2 | `pnpm --dir apps/web test:e2e:gate` | Read-only production `EXPLAIN (ANALYZE, BUFFERS)` | Revert evidence/docs; drop only PR3 indexes |
## Phase 1: PR1 — Official Explorer End-to-End
- [x] 1.1 RED: add failing static SQL, runtime pgTAP, repository, and `/drilldown` entry tests for auth/RLS, official isolation, exact normalized `02/027` PBA reporting, row-derived source audit, identity, levels, figures, provenance, deep links, and refusals.
- [x] 1.2 GREEN: implement official-only `0020` SQL/down, repository, `/drilldown`, and layout reachability; derive PBA reporting from normalized lineage plus provenance and reject any non-official aggregate audit before rendering.
- [x] 1.3 VERIFY: run focused tests and authenticated cold-start/deep-link harness; record exact results, anonymous denial, payload/refusal states, authored line count, and rollback proof.
## Phase 2: PR2 — Coverage Explorer End-to-End
- [x] 2.1 RED: add failing SQL, pgTAP, `coverage.test.ts`, and `fiscalizacion/page.test.tsx` cases for scope-derived denominators, complete circuito/establecimiento school identity, covered/uncovered/partial mesas and escuelas, unavailable identity, denominator refusal, positive official votes behind uncovered coverage, and literal `isRandomSample: false`.
- [x] 2.2 GREEN: implement coverage-only `0021` SQL/down, `apps/web/src/lib/results/coverage.ts`, and `fiscalizacion/page.tsx`; preserve circuito in school grouping, conflicts, provenance, typed parsing, selectors and links, and state that uncovered never means zero or missing official votes.
- [x] 2.3 VERIFY: run focused static SQL/web/pgTAP, lint, TypeScript 7, build, diff checks and one final disposable E2E; record source isolation, independent same-code school denominators, all `isRandomSample` values, authored line count, and rollback proof.
## Phase 3: PR3 — Release, Scale, and Proof
- [ ] 3.1 RED: extend `apps/web/e2e/fiscalizacion.spec.ts` and `provenance.spec.ts` with failing reachable journeys for auth, deep links, provenance, refusals, source separation, and coverage-to-official navigation; add SQL plan-budget assertions before any index.
- [ ] 3.2 GREEN: update owned E2E fixtures and `docs/results-exploration.md`; add a separately droppable performance migration only when the RED plan evidence requires it.
- [ ] 3.3 VERIFY: run lint, typecheck, unit, build, and E2E gates; record read-only production plans, buffers, row counts, timings, index use, authored line count, and rollback procedure.
