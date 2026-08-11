# Apply Progress: Results Exploration UI
## PR1 — Official Explorer Vertical
**Status**: PR1 implementation and bounded E2E proof complete | **Mode**: Strict TDD
**Delivery / boundary**: auto-chain, stacked-to-main, PR1 official-only migration 0020/down, contracts, authenticated `/drilldown`, layout, and tests; PR2/PR3 untouched.
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
**Diagnosis / delta / remaining**: prior incomplete E2E evidence was fixture-only and is superseded by the passing bounded browser proof above; authored delta **1,500** (1,493 additions + 7 deletions, exclusions 0); 14 staged paths, `.gga` unchanged, zero residue; tasks 2.1–3.3 remain pending.
