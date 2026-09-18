# shadcn migration guidance for Votus

**Research date:** 2026-09-18

**Validated CLI:** `shadcn@4.21.0`
**Scope:** first-party shadcn documentation and the current Votus web workspace

## Answer

No wholesale-migration endorsement was found in the inspected first-party sources. The available official guidance is split across targeted upgrade and migration surfaces:

- the Tailwind v4/React 19 upgrade guide;
- the CLI `migrate` commands;
- `shadcn apply` for changing a preset in an existing project;
- monorepo/workspace guidance;
- CLI inspection flags (`--dry-run`, `--diff`, `--view`); and
- the MCP registry workflow.

The common operating model is progressive because shadcn components are copied into the repository and become application-owned code. Upstream explicitly warns that overwriting or reinstalling components can replace local modifications and recommends committing first, reviewing the generated changes, and reapplying local adaptations.

## First-party guidance

### 1. Components are owned source, not an opaque library

The Tailwind v4 guide explains that shadcn leaves the application with code it can maintain directly and recommends following official dependency upgrade paths. For existing Tailwind v4 projects, the same guide warns that `add --all --overwrite` overwrites local components, says to commit first, and requires reviewing and reapplying local changes afterward.

**Implication for Votus:** never use `add --all --overwrite` as a migration strategy. `Button` and `Sheet` already contain project-owned adaptations and provenance.

Source: [Tailwind v4 — Upgrade Your Project and dark-mode color migration](https://ui.shadcn.com/docs/tailwind-v4).

### 2. Inspect every component before writing

CLI v4 adds:

```sh
shadcn add <component> --dry-run
shadcn add <component> --diff
shadcn add <component> --view
```

The official changelog describes these as ways to inspect registry payloads before files are written and to compare an owned component with registry updates.

**Implication for Votus:** every migration slice should capture the dry run and diff for named primitives, then manually merge the result into project-owned components. Generated output is evidence, not authority.

Sources:

- [shadcn CLI reference](https://ui.shadcn.com/docs/cli)
- [March 2026 — shadcn/cli v4](https://ui.shadcn.com/docs/changelog/2026-03-cli-v4)

### 3. Use targeted migrations, not a global rewrite

The official CLI currently lists targeted migrations for:

- `cn`;
- icon libraries;
- base color;
- unified `radix-ui` imports; and
- RTL.

Most accept a specific path or glob. Unsupported imports or tokens are left in place and reported rather than guessed.

**Implication for Votus:** only run a migration when its current-state precondition is proven. Votus already uses the unified `radix-ui` package, Lucide, Tailwind 4, and a local `cn` helper, so those migrations are not automatically useful work.

Source: [shadcn CLI — migrate](https://ui.shadcn.com/docs/cli#migrate).

### 4. Applying a preset is intentionally broad

`shadcn apply` is the first-party path for changing a preset in an existing project. The April 2026 announcement says a full apply:

- reinstalls existing components;
- updates the theme and colors;
- updates CSS variables;
- updates fonts; and
- updates icons.

The CLI also supports limiting application to `theme` or `font`. In the validated `4.21.0` CLI, `apply` exposes no `--dry-run` or `--diff` option.

**Implication for Votus:** decode and review the preset first. Apply it only in an isolated work unit after a clean commit, initially with the smallest applicable part. A full preset apply must not share a commit with route migration.

Sources:

- [April 2026 — shadcn apply](https://ui.shadcn.com/docs/changelog/2026-04-shadcn-apply)
- [shadcn CLI — apply and preset](https://ui.shadcn.com/docs/cli#apply)

### 5. Run tools from the workspace that owns `components.json`

The monorepo guide requires each workspace to own a correct `components.json` and says component commands should run in the path of the app. Tailwind v4 projects leave the Tailwind config field empty.

Votus has:

```text
apps/web/components.json
apps/web/src/app/globals.css
```

The current CLI therefore has an explicit safe workspace form:

```sh
npx shadcn@4.21.0 <command> --cwd apps/web
```

In this session, the root-launched MCP registry query returned no configured registry names even though `apps/web/components.json` exists. Until a read-only MCP registry query succeeds against the web workspace, MCP output must not be used to install components. The CLI's `--cwd apps/web` path is currently the reliable fallback.

Sources:

- [Monorepo](https://ui.shadcn.com/docs/monorepo)
- [MCP Server](https://ui.shadcn.com/docs/mcp)
- [shadcn CLI](https://ui.shadcn.com/docs/cli)

## Recommended Votus migration protocol

For each bounded slice:

1. Start from a clean, committed branch and name the real production callers.
2. Record existing behavior through the real page, form, navigation, or browser seam.
3. Resolve the intended preset without applying it globally.
4. Inspect each named primitive with `--dry-run`, `--view`, and `--diff` using `--cwd apps/web`.
5. Produce RED at the existing public seam before replacing markup.
6. Add or manually merge only the required primitive files.
7. Keep Votus domain components as project-owned wrappers around primitives.
8. Preserve native controls where form submission, progressive enhancement, or deep-link behavior depends on their browser contract.
9. Run focused tests, typecheck, lint, responsive/browser checks, and the design detector.
10. Commit one independently reversible work unit.

## Practices to reject

- `add --all --overwrite` across the existing UI.
- A full `apply` mixed with route rewrites.
- Treating MCP installation output as reviewed code.
- Replacing `TableScroll`, evidence states, source separation, authorization, or electoral terminology with generic component semantics.
- Replacing native selects before proving form, URL, keyboard, and progressive-enhancement parity.
- Migrating components whose only callers are tests.
- Claiming migration completion from generated primitives that have no production caller.

## Proposed first implementation sequence

1. Resolve and record the approved preset code without applying it.
2. Prove workspace-aware CLI inspection and repair MCP discovery separately.
3. Characterize and migrate generic action buttons.
4. Add native `Input` and `Label` primitives for login and simple forms.
5. Introduce generic `Alert` and limited `Card` surfaces.
6. Place shadcn `Table` primitives below the project-owned `TableScroll` boundary, one route at a time.
7. Migrate route compositions before changing shell/navigation.
8. Implement the evidence-detail Sheet as a separate behavior change after component parity.

## Sources

- shadcn, [CLI](https://ui.shadcn.com/docs/cli), accessed 2026-09-18.
- shadcn, [Tailwind v4](https://ui.shadcn.com/docs/tailwind-v4), accessed 2026-09-18.
- shadcn, [Monorepo](https://ui.shadcn.com/docs/monorepo), accessed 2026-09-18.
- shadcn, [MCP Server](https://ui.shadcn.com/docs/mcp), accessed 2026-09-18.
- shadcn, [March 2026 — shadcn/cli v4](https://ui.shadcn.com/docs/changelog/2026-03-cli-v4), accessed 2026-09-18.
- shadcn, [April 2026 — shadcn apply](https://ui.shadcn.com/docs/changelog/2026-04-shadcn-apply), accessed 2026-09-18.
- shadcn, [February 2026 — Unified Radix UI Package](https://ui.shadcn.com/docs/changelog/2026-02-radix-ui), accessed 2026-09-18.
