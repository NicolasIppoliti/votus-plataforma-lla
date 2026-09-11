# UI tooling refresh: verified versions and installation policy

**Snapshot:** 2026-09-11
**Delivered #189 decision:** Impeccable is optional Pi-only local tooling, verified only when locally installed and with hooks disabled; it is not a clean-checkout or runtime dependency. The version notes below are dated research findings; the shadcn, tailwind-merge, and pnpm upgrades are planned follow-up #197, not delivered state.

## Version record

Do not conflate the three Impeccable version domains: the npm installer package is **4.1.0**, the installed agent skill is **4.3.1**, and the skill engine is **0.1.5**.

| Surface | Verified latest / installed version | Evidence |
| --- | --- | --- |
| `impeccable` npm installer | **4.1.0**; integrity `sha512-hnfdoUK/Xg3qPtL0/5xzh92qKOtmREOZloCmFgnC1nYh3M81ihwCQEL2QWKntYl8qg1OG+jQ7wubR634PgTDIw==` | [official npm registry](https://registry.npmjs.org/impeccable/latest) |
| Impeccable skill | **4.3.1**; tag `skill-v4.3.1`, commit `cd12f8660e2dde57b9615c8a6b8ea674101f9cfc`, released 2026-09-09 | [official GitHub release/tag](https://github.com/pbakaus/impeccable/releases/tag/skill-v4.3.1) · [commit](https://github.com/pbakaus/impeccable/commit/cd12f8660e2dde57b9615c8a6b8ea674101f9cfc) |
| Installed Impeccable copies | skill metadata reports **4.3.1**; `scripts/VERSION` reports engine **0.1.5** | installed files |
| `shadcn` | **4.21.0** — dated latest-version finding; planned follow-up #197 | [official npm registry](https://registry.npmjs.org/shadcn/latest) |
| `tailwindcss` | **4.3.3** | [official npm registry](https://registry.npmjs.org/tailwindcss/latest) |
| `@tailwindcss/postcss` | **4.3.3** | [official npm registry](https://registry.npmjs.org/%40tailwindcss%2Fpostcss/latest) |
| `clsx` | **2.1.1** | [official npm registry](https://registry.npmjs.org/clsx/latest) |
| `tailwind-merge` | **3.6.0** — dated latest-version finding; planned follow-up #197 | [official npm registry](https://registry.npmjs.org/tailwind-merge/latest) |
| `pnpm` | **12.3.4** — dated latest-version finding; planned follow-up #197 | [official npm registry](https://registry.npmjs.org/pnpm/latest) |

## Pre-change repository delta

- The delivered baseline remains current for Tailwind CSS, `@tailwindcss/postcss`, and `clsx`.
- `shadcn` **4.19.1**, `tailwind-merge` **3.5.0**, and CI pnpm **10.32.1** remain the delivered baseline. Their dated latest-version findings are planned follow-up #197, not part of #189.
- Superseded Impeccable 3.6 assumptions: tracked `.impeccable/provenance.json` and the corresponding `skills-lock.json` entry identified **3.6.0**, but neither provenance nor an installed Pi skill is required by a clean checkout.
- The manual installer generated **224 untracked paths** under `.agents/`, `.claude/`, `.github/`, `.opencode/`, and `.codex/`, plus ignored `.pi/` output. The adopted cleanup retains only the ignored local Pi copy and removes the parallel provider copies, hooks, and binaries.

## Installation-policy findings

Official Impeccable documentation says the installer detects providers and installation scope; project installations can add provider-native hooks. It offers `--no-hooks`. It treats `.impeccable/config.json` as shared only when needed and `.impeccable/config.local.json` as local/ignored. A local install updates through `npx impeccable update`; a submodule is the documented reproducible-vendoring option for teams. Sources: [installation/CLI](https://github.com/pbakaus/impeccable#installation) · [hooks](https://impeccable.style/docs/hooks).

Official shadcn MCP documentation permits `shadcn@latest`, but that moving executable conflicts with this repository's supply-chain policy. Pin the MCP/CLI invocation to **`shadcn@4.21.0`** instead. Source: [official shadcn MCP documentation](https://ui.shadcn.com/docs/mcp).

If #197 adopts pnpm 12, it intentionally writes a two-document `pnpm-lock.yaml` when the project pins pnpm 12 through `packageManager`: the first document records the resolved package manager and the last records the project dependency graph. Consumers must use a multi-document YAML reader. This is planned follow-up behavior, not the #189 lockfile policy. Source: [official pnpm lockfile documentation](https://pnpm.io/lockfile).

## Adopted #189 policy and delivered state

1. An optional `/.pi/skills/impeccable` installation is Pi-only local tooling; use no hooks. A clean checkout may omit it entirely.
2. The stale tracked `.impeccable/provenance.json` and its `skills-lock.json` entry are removed. No `.impeccable/` directory is required unless a future reviewed change needs shared configuration.
3. Generated non-Pi provider copies, hooks, and binaries are removed and narrowly ignored; the local Pi copy remains ignored.
4. A network-free clean-checkout test confirms no provider hook/binary/copy is required and no ignored/local installer artifact is necessary for normal project operation. The optional Pi skill is verified separately only when locally installed.
5. The dated `shadcn@4.21.0`, `tailwind-merge@3.6.0`, and pnpm `12.3.4` findings are planned follow-up #197. #189 retains `shadcn@4.19.1`, `tailwind-merge@3.5.0`, and CI pnpm `10.32.1`.

This is a policy record, not an authorization to run an installer, update dependencies, delete generated output, or perform network access.
