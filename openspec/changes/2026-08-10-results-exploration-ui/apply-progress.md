# Apply Progress: Results Exploration UI
## PR1 — Official Explorer Vertical
**Status**: PR1 implementation and bounded E2E proof complete | **Mode**: Strict TDD
**Delivery / boundary**: auto-chain, stacked-to-main, PR1 official-only migration 0020/down, contracts, authenticated `/drilldown`, layout, and tests; PR2/PR3 were untouched at PR1 closure.
**Latest GGA correction**: enforce complete selector parents at the authenticated RPC and validate aggregate party totals/shares before render; no commit/push/PR/merge/deploy.
**Settle evidence SHA-256**: `6a11260afcec63a27d2b37911ea5de7d662a3b6c7867f452b5c35aa580fc05ea`.
## Preserved Attempt and Reviewer History
| Attempt | Historical result | Evidence / disposition |
|---|---|---|
| `wu1-data-boundary/evidence-r1` | 23 migration, 103 web, 31 pgTAP, 8 E2E; 1,094 lines | `dcbf7a09a3ad9120d551532e13cbf160bc61b6fe66b81a26b1594ba4f92d41eb`; rejected unreachable slice. |
| `wu1-data-boundary/evidence-r2` | 24 migration, 108 web, 41 pgTAP, 8 E2E; 1,479 lines | `31652ed60fec7f3f8e5d51b6a937d4ce609f5d6f41880cf19c4e200d49ad388f`; rejected incomplete correction. |
| `pr1-official-explorer-vertical/evidence-r1` | 24 migration, 42 web, 40 pgTAP, 8 E2E; 1,463 lines | `3b81436ed4f0f58760189c1e7a24a53721189fdf6d6200bc0d4c2aea8ba540d1`; superseded. |
| `pr1-official-explorer-final-correction` | 24 migration, 44 web, 43 pgTAP, 8 E2E; 1,494 lines | `f417747b29bf521926944a1ea2a8e5bd74d697f16e3efb32c307bf18e334a42c`; superseded by latest findings. |
| `pr1-selector-payload-invariants` | Focused/runtime/quality passed; E2E stopped on TS2379 before browser execution | `99d3d41446a86c0863b8905e8fcda4bb6fc97d9087116bc4b77ccac9ebfdcbd5`; fixture corrected, then superseded by bounded E2E proof. Prior closures: Engram #1988/#1995 and #2007/#2013. |
## Completed Tasks
- [x] 1.1 RED — prior normalized-level/source-audit evidence preserved; new static SQL failed 1/26, web failed 4/46, and staged-baseline pgTAP failed hierarchy tests 14–17 of 30.
- [x] 1.2 GREEN — RPC rejects orphan circuito/establecimiento/mesa selectors; parser requires party vote sum and SQL-precision shares, including zero totals.
- [x] 1.3 VERIFY — static SQL 26/26, focused web 50/50, runtime pgTAP 30/30, lint/TS7/build pass; authorized disposable E2E continuation passed 8/8 with zero skips and cleanup.
## TDD Cycle Evidence
| Task | Safety Net | RED | GREEN / TRIANGULATE | REFACTOR |
|---|---|---|---|---|
| 1.1 | static 25/25; web 42/42 | SQL 1 failed; web 4 failed; pgTAP 4/30 failed | all hierarchy selectors plus non-global 2023 mesa fixture pass | single transitive parent-chain guard |
| 1.2 | covered by 1.1 | inconsistent totals/shares rendered | exact sums, rounded decimal shares, zero/null behavior pass | BigInt rounding check avoids float drift |
| 1.3 | focused suites green | E2E exposed exact-optional fixture error | TS 7.0.2/build passed after correction; bounded continuation then passed 8/8 | generated `next-env.d.ts` restored; no production change |
## Work Unit Evidence
| Evidence | Exact result |
|---|---|
| Focused | `uv --directory etl run pytest tests/test_migration_sql.py -q` → 26 passed; `pnpm --dir apps/web exec vitest run src/lib/results/exploration.test.ts 'src/app/(authenticated)/drilldown/page.test.tsx' 'src/app/(authenticated)/layout.test.tsx'` → 3 files, 50 passed |
| Runtime | Disposable Supabase RED → 4/30 failed (tests 14–17); GREEN → 30/30 PASS; owned containers/volumes/workdirs → 0 |
| Quality | `pnpm --dir apps/web lint` exit 0; `pnpm --dir apps/web typecheck` → TS 7.0.2 exit 0; `pnpm --dir apps/web build` exit 0; staged/unstaged diff checks exit 0 |
| E2E | Authorized continuation invoked `pnpm --dir apps/web test:e2e:gate` exactly once → exit 0: 8 passed, 0 skipped, disposable stack cleaned; generated `next-env.d.ts` restored |
| Rollback | Revert hierarchy/parser/tests and drop 0020 via its down migration without touching PR2/PR3; `.gga` remains SHA-256 `2dedf2f3dd5e488847fb850492b4e2977e4582c37ddd4d35dffb7252d0b03e8f` |
**Diagnosis / delta / remaining**: prior incomplete E2E evidence was fixture-only and is superseded by the passing bounded browser proof above; authored delta **1,500** (1,493 additions + 7 deletions, exclusions 0); 14 staged paths, `.gga` unchanged, zero residue. This is preserved PR1 closure evidence; cumulatively PR1 and PR2 are complete, and only tasks 3.1–3.3 remain pending.

## PR2 — Coverage Explorer Vertical (Complete)
**Status**: implementation, focused/runtime SQL proof, and final bounded browser proof complete; task 2.3 is complete | **Mode**: Strict TDD
**Delivery / boundary**: auto-chain, stacked-to-main, PR2 coverage-only migration 0021/down, contracts, authenticated `/fiscalizacion` coverage entry, and tests. PR2 touched `apps/web/e2e/service-role-grants.sql` and `apps/web/e2e/scenario-ownership.test.ts` solely as a verification-harness correction required to prove the new coverage browser journey. Those two corrections do not consume or claim PR3 release/scale scope; tasks 3.1–3.3 remain untouched and pending.
**Harness disposition**: the one authorized disposable E2E invocation reached and passed the 44-test pgTAP gate, then Playwright finished 7 passed / 1 failed (`fiscalizacion.spec.ts`). The fixture used non-numeric synthetic administrative codes, so the production normalization boundary refused it before coverage rendered. A RED ownership test reproduced that exact defect; the fixture now uses normalized `82/827`, and focused tests pass, but the browser gate was not invoked a second time because this apply was authorized for exactly one invocation.
**Verification-only continuation**: one separately authorized invocation against the corrected fixture exited 1 with `8 discovered, passed=7, failed=1, suite=failed, non-passing=[e2e/fiscalizacion.spec.ts:failed]`; output was redacted by the release gate. No rerun was performed. Generated `apps/web/next-env.d.ts` was restored, and disposable Docker/workdir residue is zero.
**Bounded root-cause diagnostic and correction**: one diagnostic invocation ran the unchanged disposable DB/auth gate while locally inheriting only the Playwright child output; production redaction remained unchanged. The exact failure occurred before page navigation: `withResultFixture` could neither insert nor clean up `archive_entry` because `service_role` had no object-level grant on that table. A focused RED grant-contract test failed 1/21 on missing `public.archive_entry`; adding that one table to the existing fixture grant made the focused harness pass 27/27. No second browser invocation was run, so this is not final E2E proof.
**Final verification-only continuation**: after the proven grant correction, exactly one authorized invocation of `pnpm --dir apps/web test:e2e:gate` exited 0 with `8 passed, 0 skipped, disposable stack cleaned`. No rerun occurred. Generated `apps/web/next-env.d.ts` was restored to SHA-256 `7ad303e40d4fddf44f156129e397511953a71481c5cfd86b1862649aaaf240cc`; the gate workdir is absent and no owned Docker residue remains.

### Completed Tasks
- [x] 2.1 RED — static migration tests failed 3/29 because 0021/down did not exist; web failed with the missing coverage module plus two production-entry assertions; pgTAP coverage assertions were authored before migration 0021.
- [x] 2.2 GREEN — scope-derived official denominators, covered/uncovered mesas, partial/unavailable schools, literal non-random contracts, source/denominator audits, provenance checks, exclusions, and official deep links pass focused tests; the legacy fixed denominator is isolated to legacy UUID tally links.
- [x] 2.3 VERIFY — static/focused/pgTAP/lint/TypeScript 7/build pass; after the exact fixture-grant correction, the single final disposable browser gate passed 8/8 with zero skips and cleanup.

### TDD Cycle Evidence
| Task | Safety Net | RED | GREEN / TRIANGULATE | REFACTOR |
|---|---|---|---|---|
| 2.1 | migration 26/26; existing web 84/84 | static 3/29 failed; missing module plus 2 page assertions failed | 29/29 static; coverage/page and harness suites 109/109 | one typed parser validates all figures and audits |
| 2.2 | covered by 2.1 | denominator/provenance/audit/refusal states absent | covered, uncovered, zero-presence, partial school, unavailable identity, and malformed payload cases pass | fixed denominator retained only behind explicit legacy UUID links |
| 2.3 | focused grant suites 26/26 | Diagnostic Playwright output proved missing `archive_entry` service-role grant; grant-contract test failed 1/21 | one-table grant correction; grant/harness tests 27/27, full focused set 110/110, final browser gate 8/8 | fixture grant matches every mutated table; generated `next-env.d.ts` restored |

### Work Unit Evidence
| Evidence | Exact result |
|---|---|
| Focused | `uv --directory etl run pytest tests/test_migration_sql.py -q` → 29 passed; `pnpm --dir apps/web exec vitest run src/lib/results/coverage.test.ts 'src/app/(authenticated)/fiscalizacion/page.test.tsx' e2e/scenario-ownership.test.ts e2e/release-gate-safety.test.ts` → 4 files, 110 passed |
| Runtime SQL | The disposable E2E gate advanced past `supabase test db supabase/tests/results_exploration.sql`; plan 44 completed successfully before Playwright started. Coverage proves 1/2 mesas, partial school coverage, denominator refusal, source isolation, positive official votes behind an uncovered mesa, authenticated execution, and anonymous denial. |
| Quality | `pnpm --dir apps/web lint` exit 0; `pnpm --dir apps/web typecheck` → TypeScript 7.0.2 exit 0; `pnpm --dir apps/web build` exit 0; generated `next-env.d.ts` restored |
| Diagnostic browser harness | Exactly one diagnostic invocation of the unchanged disposable gate → 8 discovered, 7 passed, 1 failed. Visible assertion: `failed to seed archive entries: permission denied for table archive_entry`, followed by the same cleanup permission denial. The run reached Playwright only after disposable migrations, pgTAP, auth, and production servers succeeded; production redaction code was not changed. No post-correction browser invocation was run. |
| Final browser harness | Exactly one final post-correction invocation: `pnpm --dir apps/web test:e2e:gate` → exit 0, 8 passed, 0 skipped, disposable stack cleaned; coverage-to-official navigation, source separation, denominator labels, and literal non-random coverage contracts passed through the real entry point. No rerun. |
| Rollback | Remove `public.archive_entry` from `e2e/service-role-grants.sql` and its ownership assertion to revert only this correction; the broader PR2 rollback still drops `results_exploration_coverage(uuid, uuid, text, text)` through `0021_results_coverage.down.sql` and reverts coverage files without removing PR1. |

**Diagnosis / closure**: `service_role` bypassed RLS but not table privileges; the exact one-table grant mismatch is corrected, focused checks remain green, and the final browser proof passes. The exact PR2 delta is **1,248** changed lines (**1,182 additions + 66 deletions**), with **0 exclusions** and all 17 intended paths staged. `.gga` remains SHA-256 `2dedf2f3dd5e488847fb850492b4e2977e4582c37ddd4d35dffb7252d0b03e8f`; zero disposable residue. PR1 and PR2 are complete; only PR3 remains pending, and its release/scale tasks are untouched.

### PR2 GGA correction — complete school identity
**Root cause**: migration 0021 grouped and conflict-checked schools by `establecimiento_code` alone, although jurisdiction ownership is `(circuito_code, establecimiento_code)`. Same codes could merge across circuits or trigger a false global name conflict.
**RED**: static SQL 1/30 failed; focused web 2/91 failed; direct disposable pgTAP failed on `source_inconsistent` and independent school figures.
**GREEN / triangulation**: conflict detection, grouping, per-school provenance, RPC output, typed parser, consistency checks, rendered labels/keys and official-result links now carry circuito identity. Runtime fixtures prove three `E1` schools across circuits: different names do not conflict and repeated names do not merge.
**Evidence**: static SQL 30/30; focused web 111/111; disposable pgTAP 48/48; lint exit 0; TypeScript 7.0.2 exit 0; build exit 0; one final `test:e2e:gate` invocation passed 8/8 with zero skips and cleanup.
**Work unit / rollback**: revert only the circuito-school additions in migration 0021, coverage parser/page, owned fixtures/tests, and this history; broader PR2 rollback remains the 0021 down migration.
**Current staged snapshot**: **1,407 changed lines** (**1,331 additions + 76 deletions**); 0 excluded; 17 intended paths staged; `.gga` SHA-256 `2dedf2f3dd5e488847fb850492b4e2977e4582c37ddd4d35dffb7252d0b03e8f`; zero disposable residue. Tasks 2.1–2.3 remain complete; 3.1–3.3 remain pending.
