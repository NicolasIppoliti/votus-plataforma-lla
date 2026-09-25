# Web development and disposable E2E

Return to the [maintainer guide](../../README.md) for ETL, CI and hosted boundaries.
Commands below run from the repository root.

## Prerequisites and development

Use Node.js **24.21.0** from [the shared pin](../../.node-version) and
**pnpm 12.3.4**, declared by [package.json](package.json) and used in
[CI](../../.github/workflows/release-gates.yml). Keep the committed lockfile;
a pnpm 10 lockfile parsing failure is not a reason to regenerate it.

The [root package](../../package.json) repeats the same package-manager pin so
Corepack can discover it from either directory. `engines.node` declares Node
`24.x` compatibility, not an exact runtime pin: Vercel manages minor and patch
updates within that major. Local release verification and CI require exactly
the version in `.node-version`; preflight rejects a mismatch before creating
resources. Vercel Preview uses Corepack to select the exact pnpm version.

Use the pinned invocation for every command, not only installation:

```sh
npm exec --yes --package=pnpm@12.3.4 -- pnpm --dir apps/web install --frozen-lockfile
npm exec --yes --package=pnpm@12.3.4 -- pnpm --dir apps/web dev
```

`dev` starts Next.js, not a database. Use separately approved local application
configuration and keep credentials out of Git and terminal output. Do not point
development at a hosted environment without separate authorization.

## Static checks and production build

```sh
npm exec --yes --package=pnpm@12.3.4 -- pnpm --dir apps/web lint
npm exec --yes --package=pnpm@12.3.4 -- pnpm --dir apps/web typecheck
npm exec --yes --package=pnpm@12.3.4 -- pnpm --dir apps/web test
npm exec --yes --package=pnpm@12.3.4 -- pnpm --dir apps/web build
```

CI's web-static job runs the first three checks. `build` runs typechecking and
[the production-build runner](scripts/production-build.ts); a build is not a
hosted deployment or a substitute for the release gate.

## Owned disposable release gate

The [gate runner](scripts/e2e-release-gate.ts) requires Docker running, the
project-local Supabase CLI **2.116.0**, and package-supported Playwright Chromium
installed. `pnpm install --frozen-lockfile` installs the declared CLI dependency;
run it through `pnpm --dir apps/web exec supabase`, not global Homebrew. All CI
lanes consume this same CLI pin. Preflight checks exact Node, pnpm and CLI
versions as well as the required isolation/cleanup flags before creating a stack.
Keep `SUPABASE_EXPERIMENTAL_STACK` unset: these gates verify the default Docker
backend and reject ambient selectors for unverified backends.

```sh
npm exec --yes --package=pnpm@12.3.4 -- pnpm --dir apps/web exec playwright install chromium
npm exec --yes --package=pnpm@12.3.4 -- pnpm --dir apps/web test:e2e:gate
```

The runner owns the disposable loopback stack, migration inventory checks, SQL
proofs, scenario servers, browser execution and cleanup. Let it allocate and
validate its own resources. Do not create a substitute database, supply hosted
URLs, unset safety guards or manually start scenario servers to bypass preflight.
Missing capabilities are a prerequisite failure, not permission to weaken isolation.

For a focused browser check against canonical specs:

```sh
npm exec --yes --package=pnpm@12.3.4 -- pnpm --dir apps/web test:e2e:focused -- e2e/root.spec.ts
```

The focused mode still uses the owned runner, but selects only the requested
browser specs. Bare `test:e2e` invokes Playwright directly and is not the recommended
replacement for an owned gate command.

The [gate plan](scripts/e2e-gate-runtime.ts) defines current production migration
versions, synthetic test-only migration and proof selection. See
[results-explorer operations](../../docs/results-exploration.md) for the historical
index proof and hosted boundary, not a second current migration inventory.

## SQL and browser lanes

The default full release gate remains the complete local release check:
one owned disposable database runs SQL proofs, both rollback/reapply proofs,
the synthetic 0039 browser grants, and all eight browser specs sequentially.

Explicit lanes run partial components, each with its own disposable stack:

```sh
npm exec --yes --package=pnpm@12.3.4 -- pnpm --dir apps/web test:e2e:gate --lane sql
npm exec --yes --package=pnpm@12.3.4 -- pnpm --dir apps/web test:e2e:gate --lane browser
```

- `sql`: all 13 pgTAP proofs, including scale setup and immediate post-plan cleanup,
  then both rollback/reapply proofs. No 0039 grants, build, or browser installation required.
- `browser`: both rollback/reapply proofs, then 0039 grants in that same database,
  one production build, five scenario servers, and the full eight-spec reporter.
  No pgTAP or scale fixtures.

Each lane reports success only after owned cleanup. Neither lane alone replaces
full release acceptance. CI runs independent `e2e-sql` and `e2e-release` (browser)
jobs under the same logical `e2e-release` path scope. The required `verify` aggregate
requires both to succeed when selected, or both to be skipped for ETL-only scope.
The default local gate remains full; no remote timing improvement is claimed.
Lanes cannot combine with focused or reduced-proof modes. Add `--inspect-plan` to
either command to inspect its inventory without starting services. Existing focused and reduced modes
are unchanged; `--scale-proof-only` is not the complete SQL lane.
