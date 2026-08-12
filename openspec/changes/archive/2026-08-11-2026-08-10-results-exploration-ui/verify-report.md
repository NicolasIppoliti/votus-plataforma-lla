```yaml
schema: gentle-ai.verify-result/v1
evidence_revision: sha256:1e9c5de6d928cfc392595aba0423cc4c0d3b9871980863ecd59794b68987df92
verdict: pass
blockers: 0
critical_findings: 0
requirements: 5/5
scenarios: 10/10
test_command: pnpm --dir apps/web test:e2e:gate
test_exit_code: 0
test_output_hash: sha256:526b3dad3860b3468a0c1129aeefdac7b66a958b934330217a47b78b62436094
build_command: pnpm --dir apps/web build
build_exit_code: 0
build_output_hash: sha256:0ce02cd532cdb83c1b9d5bc9448bd9dac7d0b61c1ee09e0a76dc6c6480a25f79
```

## Verification Report

**Change**: `2026-08-10-results-exploration-ui`
**Branch**: `feat/43-results-release-proof`
**Version**: N/A
**Mode**: Strict TDD
**Current evidence revision**: `sha256:1e9c5de6d928cfc392595aba0423cc4c0d3b9871980863ecd59794b68987df92`

### Historical failure and remediation trace

- Supersedes the authoritative failed verification at `sha256:4904053b85e727537fc91205a783f2ac4fff96b9b9a116b219d4b1841f29d655` after maintainer-authorized remediation.
- The prior blockers were preserved: browser navigation bypassed the selector hierarchy, and the 2025 section-wide official school party-vote breakdown was absent.
- Current verification independently re-read proposal, both specs, design, all 12 tasks, apply-progress, current implementation, and tests. Apply claims were not treated as proof.
- The native remediation token remains with the orchestrator and was not settled by verification.

### Completeness

| Metric | Value |
|---|---:|
| Requirements | 5 |
| Scenarios | 10 |
| Tasks total | 12 |
| Tasks complete | 12 |
| Tasks incomplete | 0 |

### Build and test execution

| Check | Exact command | Exit | Result | Output SHA-256 |
|---|---|---:|---|---|
| Static SQL contracts | `uv --directory etl run pytest tests/test_migration_sql.py -q` | 0 | 34 passed | `b4f728bad9ced722361c3724fdeaa8d83c5c29135b3f61067d3fbf616228f5df` |
| Focused web/harness | `pnpm --dir apps/web exec vitest run e2e/release-gate-safety.test.ts e2e/scenario-ownership.test.ts src/lib/results/exploration.test.ts src/lib/results/coverage.test.ts 'src/app/(authenticated)/drilldown/page.test.tsx' 'src/app/(authenticated)/fiscalizacion/page.test.tsx' 'src/app/(authenticated)/layout.test.tsx'` | 0 | 7 files, 171 passed | `26abb2073535872b90ab052531ccb50028176f2b08ba129dbeb225abcbca6ed5` |
| Full web | `pnpm --dir apps/web test` | 0 | 28 files, 374 passed | `a90e5b1d3649baa39dfea1d8b3e417b997b8f333508d1e723b49548039bed807` |
| Lint | `pnpm --dir apps/web lint` | 0 | No warnings/errors | `2527c068ed06206c1fd593aeb16403d339140a939372408f2632b662739fd882` |
| TypeScript 7 | `pnpm --dir apps/web typecheck` | 0 | Version 7.0.2 | `aa8f0a799bd9d3b2ed60dff0a5fa71942961534d11b5d465d6a883c56778e64d` |
| Production build | `pnpm --dir apps/web build` | 0 | Next.js build passed; dynamic `/drilldown` and `/fiscalizacion` routes emitted | `0ce02cd532cdb83c1b9d5bc9448bd9dac7d0b61c1ee09e0a76dc6c6480a25f79` |
| Disposable DB/browser gate | `pnpm --dir apps/web test:e2e:gate` | 0 | pgTAP 56/56; scale 4/4; rollback/reapply passed; Playwright 8/8, 0 skipped; cleanup passed | `526b3dad3860b3468a0c1129aeefdac7b66a958b934330217a47b78b62436094` |

Coverage analysis was skipped because the project config exposes no coverage command or threshold.

### Runtime database, scale, and rollback evidence

- pgTAP passed 56/56 through disposable Postgres with authenticated execution, anonymous denial, official/fiscalización isolation, normalized `02/027`, complete hierarchy refusals, 2023 school refusal, composite school identities, party votes, mesa counts, provenance, and literal `is_random_sample = false`.
- Scale passed 4/4 over 120,000 representative official rows: coverage 465.499 ms, facets 284.430 ms, official 1,110.860 ms, schools 191.156 ms; all returned one bounded payload row within local budgets. These are local disposable measurements, not production claims.
- Rollback/reapply passed `0022-down,0021-down,0020-down,0020-up,0021-up,0022-up`, migration inventory 22, authenticated execute, anonymous denial, and typed responses from all four RPCs after forward apply.

### Spec compliance matrix

| Requirement | Scenario | Passing runtime evidence | Result |
|---|---|---|---|
| Navigate without identifiers | Operator reaches a mesa result from a cold start | `e2e/provenance.spec.ts` starts from authenticated dashboard navigation and submits Election → Category → Distrito → Sección → Circuito → Establecimiento → Mesa/level; asserts the exact complete-parent URL, mesa votes, provenance, reload, and a separate malformed deep-link refusal | ✅ COMPLIANT |
| Navigate without identifiers | Unreachable combination is refused | pgTAP typed `no_rows`/`selection_invalid`; Playwright repeated-parameter refusal; page never renders a zero result | ✅ COMPLIANT |
| Vote breakdown at selected level | Sección total aggregates mesas | pgTAP exact section sum, canonical/unmapped parties, source level, source audit, and mesa count; browser section result renders | ✅ COMPLIANT |
| Vote breakdown at selected level | Distrito-only source is not projected onto mesas | pgTAP returns `source_unavailable` and counts the included distrito row | ✅ COMPLIANT |
| Escuela breakdown availability | Escuela breakdown for 2025 | pgTAP and browser list multiple schools by `(circuito, establecimiento)`, with per-party official votes, shares, mesa counts, source audit, provenance, exclusions, conflict refusal, and bounded payload behavior | ✅ COMPLIANT |
| Escuela breakdown availability | 2023 school breakdown refused honestly | pgTAP, repository, and page return `source_unavailable` with source-limitation reason, never an empty vote list | ✅ COMPLIANT |
| Fiscalización as coverage | Coverage names uncovered mesas | pgTAP and Playwright render covered/uncovered mesa identities and school coverage | ✅ COMPLIANT |
| Fiscalización as coverage | Coverage is not read as a result | Playwright follows an uncovered mesa to positive official votes and confirms fiscalización votes do not enter the official figure | ✅ COMPLIANT |
| Coverage denominator declares scope | Denominator follows selected sección | pgTAP derives the denominator from official mesas in the exact election/section; parser/page retain scope and literal non-random status | ✅ COMPLIANT |
| Coverage denominator declares scope | Denominator cannot be stated | pgTAP and Playwright return `denominator_unavailable` and never show a numerator-only figure | ✅ COMPLIANT |

**Compliance summary**: 10/10 scenarios and 5/5 requirements compliant.

### Remediation-specific independent proof

| Blocker | Current source evidence | Current runtime evidence | Status |
|---|---|---|---|
| Cold-start mesa traversal | `ResultsExplorationRepository.official` calls `requireCompleteHierarchy` before RPC; mesa requires sección, circuito, and establecimiento through the transitive checks. The page normalizes blank selectors as absent and submits GET facets progressively. Deep-link SSR remains separately covered. | Playwright drove every selector from authenticated navigation and reached the mesa with all parents in the RPC-backed URL; pgTAP independently rejects orphan hierarchy combinations. | ✅ RESOLVED |
| 2025 section-wide school breakdown | `results_exploration_schools` is a stable security-invoker RPC restricted to `authenticated`, filters official mesa rows, groups by composite circuit/school identity, preserves canonical and unmapped parties, audits rows/votes, reports exclusions, refuses conflicting names, carries archive IDs, and caps the payload at 500 schools. The page renders all returned schools with party votes/shares and mesa counts. | pgTAP proves three same-code schools remain distinct and validates party votes/mesa counts; Playwright renders `(00001,E1)` and `(00002,E1)` with 33,333 official votes and distinct coverage/link identities; scale and rollback/reapply pass. | ✅ RESOLVED |

### Correctness and prior invariant regression matrix

| Area | Status | Evidence |
|---|---|---|
| Official source isolation | ✅ | SQL filters `source_kind = 'official'`; row-derived audit; parser and page fail closed; browser excludes fiscalización votes. |
| Fiscalización opt-in and separation | ✅ | Dedicated coverage route only; uncovered means no presence, never zero votes; official link remains separate. |
| Composite school identity | ✅ | `(circuito_code, establecimiento_code)` in SQL grouping, conflict checks, parser uniqueness, rendering keys/labels, and links. |
| Provenance and audit | ✅ | Official/fiscalización archive IDs, source/denominator audits, per-school archive IDs, and browser provenance assertions pass. |
| Quarantine/exclusions visibility | ✅ | Missing complete school identity is reported by reason with rows and votes; no silent drop or first-row selection. |
| Canonical/unmapped parties | ✅ | Canonical mapping is verified; unresolved list IDs remain explicit with votes rather than becoming bare identifiers. |
| 2023/2025 source shape | ✅ | 2025 school identity is available; registered 2023 sources return an honest source limitation. |
| PBA normalization/granularity | ✅ | Exact normalized `02/027` section reporting and distrito-to-mesa projection refusal pass pgTAP. |
| Coverage denominator/non-random | ✅ local | Numerator and denominator derive from the same official scope; every coverage contract carries literal `false`. Hosted 93/153 remains unverified. |
| Auth/RLS/grants | ✅ local | Security-invoker RPCs execute for authenticated and deny anon after rollback/reapply. |
| Personal data | ✅ | Reviewed change fixtures and artifacts contain synthetic identities only; fiscal names are not introduced. |
| Query bounds | ✅ local | Server-side RPCs avoid row transfer; local 120,000-row plans pass explicit budgets; school response has a 500-school refusal bound. |

### Design coherence

| Decision | Followed? | Notes |
|---|---|---|
| Read-only Postgres RPC boundary | ✅ | Facets, official aggregation, section schools, and coverage remain server-side and authenticated. |
| Extend reachable `/drilldown` and `/fiscalizacion` routes | ✅ | Authenticated navigation and dynamic routes are runtime-driven. |
| Complete selector parents | ✅ | Web refuses before official RPC; SQL independently refuses incomplete lower scopes. |
| Preserve normalized lineage/source isolation | ✅ | Exact code comparison and source audits remain intact. |
| Reuse provenance/refusal behavior | ✅ | Existing components and explicit typed refusals are rendered. |

### TDD compliance

| Check | Result | Details |
|---|---|---|
| TDD evidence reported | ✅ | Apply-progress preserves RED/GREEN/VERIFY evidence for 1.1–3.3 and R.1–R.3. |
| All tasks have executable evidence | ✅ | 12/12 tasks map to existing static, Vitest, pgTAP, scale, rollback, build, or browser checks. |
| RED ordering documented | ✅ | Prior failures remain preserved, including the two independent verification blockers and remediation REDs. |
| GREEN confirmed now | ✅ | Every applicable command was independently re-executed once and passed. |
| Triangulation adequate | ✅ | Boundary, SSR, real Postgres, scale, rollback, and real browser layers cover the critical outcomes. |
| Safety nets | ✅ | Existing suites and pre-remediation failures are recorded before corrections. |

### Test layer distribution

| Layer | Tests | Files | Tools |
|---|---:|---:|---|
| Focused unit/SSR/harness | 171 | 7 | Vitest + server rendering |
| Database integration/scale | 60 | 2 | pgTAP + real Postgres plans |
| E2E | 8 | 8 | Playwright + disposable Supabase + production Next build |
| Full web regression | 374 | 28 | Vitest |

### Changed-file coverage

Coverage analysis skipped — no coverage command or threshold is configured.

### Assertion quality

**Assertion quality**: ✅ No tautologies, ghost loops, assertion-free production paths, smoke-only scenario claims, or prior selector-bypass assertions remain in the reviewed change tests. Critical scenarios are covered through production entry points at runtime.

### Quality metrics

**Linter**: ✅ no errors or warnings
**Type checker**: ✅ TypeScript 7.0.2, no errors
**Build**: ✅ passed; Next.js emitted the existing `middleware` deprecation warning

### Issues found

**CRITICAL**: None.
**WARNING**: Hosted migrations 0020–0022, hosted auth/RLS smoke, production `EXPLAIN (ANALYZE, BUFFERS)`, the actual hosted 93/153 denominator, Vercel behavior, and production UI remain explicitly unverified because no deployment or production mutation was authorized. This local-readiness boundary is not a blocker.
**SUGGESTION**: Migrate the unrelated existing Next.js `middleware` convention to `proxy` in a separate change.

### Cleanup and workspace integrity

- Disposable gate reported cleanup complete; Playwright passed 8/8 with zero skips.
- Owned `votus-e2e-*` containers, volumes, and temporary workdirs: 0.
- Generated `apps/web/next-env.d.ts` restored to `sha256:7ad303e40d4fddf44f156129e397511953a71481c5cfd86b1862649aaaf240cc`.
- `.gga` remained `sha256:2dedf2f3dd5e488847fb850492b4e2977e4582c37ddd4d35dffb7252d0b03e8f`.
- Verification mutated no source, test, migration, configuration, commit, branch, remote, deployment, or production state.

### Evidence and settle disposition

- Evidence revision preimage is the exact staged implementation diff excluding `verify-report.md`, followed in declared command order by the exact static, focused, full-web, lint, TS7, build, and disposable-gate outputs. Its digest is `sha256:1e9c5de6d928cfc392595aba0423cc4c0d3b9871980863ecd59794b68987df92`.
- Historical failed evidence `sha256:4904053b85e727537fc91205a783f2ac4fff96b9b9a116b219d4b1841f29d655` is superseded, not erased.
- This report is authoritative PASS evidence with zero blockers and is eligible for orchestrator settlement; verification does not settle the retained native token.

### Exact staged delta

After admission and staging this exact report, the index contains **22 paths, 1386 additions, 43 deletions**. The report contributes **175 added lines**; the implementation/artifact snapshot excluding this report is 21 paths, 1,211 additions, and 43 deletions.

### Verdict

**PASS**

All five requirements and ten scenarios have passing runtime coverage. The two historical blockers are independently resolved, prior official/fiscalización invariants remain green, cleanup is complete, and only explicitly out-of-scope hosted production verification remains.
