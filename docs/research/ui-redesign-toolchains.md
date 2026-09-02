# UI redesign toolchain verification

**Decision:** use **shadcn/ui** as the component-code foundation and **Impeccable** as the design-quality workflow. Treat **Vercel `design.md` as a reference for composition and restraint, not as a brand/theme package**. Add **beUI** or **Transitions.dev** only for a specific interaction that survives accessibility, bundle, and maintenance review.

Research snapshot: **2026-09-01**. Counts are volatile. No package, skill, or MCP server was installed. `npx skills find` was not executed because `npx` may download and execute a package; the same public skills.sh search index and first-party skill pages were queried directly instead.

## Recommendation matrix

| Tool | Verified first-party agent surface | Runtime/code surface | Recommendation | Main caution |
| --- | --- | --- | --- | --- |
| [Impeccable](https://impeccable.style/) | Official skill, commands, npm CLI/installer, provider hooks; no official MCP found | Framework-aware design workflow and deterministic detector | **Adopt project-locally at the pinned `skill-v3.6.0` tag and commit; keep hooks and live mode disabled** | The installer can write agent folders, hook manifests, `.impeccable/*`, `PRODUCT.md`, and `DESIGN.md`; `npx impeccable` executes a moving npm artifact unless version-pinned |
| [Vercel `design.md`](https://vercel.com/design.md) | Official Vercel-hosted Markdown with skill frontmatter; no first-party installer, package, MCP, skills.sh entry, or source repository found | Guidance plus a hosted Vercel brand CSS foundation | **Reference only** for hierarchy, evidence, typography, restraint, and reduced motion | It explicitly targets **official Vercel-authored report websites** and requires Vercel identity assets; it is not a neutral product design system and has no license statement in the served Markdown/CSS |
| [shadcn/ui](https://ui.shadcn.com/) | Official skill in the canonical repo, npm CLI, local stdio MCP server, registry and agent documentation | Copies editable component source and dependencies into the app | **Adopt as the base** | Registry/CLI operations write source and config; third-party registries are separate trust domains; `@latest` is mutable |
| [beUI](https://beui.dev/) | Official skill, hosted HTTP MCP, agent guide, shadcn registry; no beUI runtime package | Copies React/Tailwind/Motion source plus per-component dependencies | **Selective use only** after inspecting each registry item | Live remote registry content can change; richer components add Motion and other dependencies; hosted MCP adds a remote trust boundary |
| [Transitions.dev](https://transitions.dev/) | Official skill(s), public npm CLIs, documented agent flow; no official MCP found | Portable CSS/JS snippets, optional React/TS recipes, and a live Refine tool | **Selective use only** for a named transition; prefer copied free snippets over Refine/Pro initially | skills.sh currently splits identity/counts across two first-party repositories; repository license metadata and website terms differ in shape; Refine can invoke an agent that edits code and consumes provider quota |

## What “official” means here

An artifact is classified as official only when the product website links to it, the repository owner is the product author/organization, or the package metadata points back to that owned repository. Search results alone are not proof.

- **Official:** `pbakaus/impeccable`, `shadcn-ui/ui` (also reachable through the historical `shadcn/ui` alias), `starc007/ui-components`, `Jakubantalik/transitions.dev`, `Jakubantalik/transitions-dev`, Vercel-owned `vercel.com/design.md`, and packages whose metadata points to those repositories.
- **Community/third-party:** similarly named skills from Smithery, personal “Vercel design” repositories, design-skill collections, forks, and wrappers. They were not promoted merely because skills.sh returned them.
- skills.sh search results are useful for **discovery and observed install counts**, but ownership was always checked against the first-party site/repository.

## 1. Impeccable

### Verified surfaces

| Surface | Finding |
| --- | --- |
| Agent skill | **Yes, official.** The product describes “1 skill, 23 commands,” publishes the skill in `pbakaus/impeccable`, and documents `npx skills add pbakaus/impeccable`. The repository also contains provider-specific builds for Claude Code, Codex, Cursor, Copilot, Gemini, OpenCode, Pi, and others. [Product site](https://impeccable.style/) · [official repository](https://github.com/pbakaus/impeccable) · [README installation](https://github.com/pbakaus/impeccable#installation) |
| Installer/CLI | **Yes.** `npx impeccable install`, `update`, `detect`, and related commands are first-party. The npm package exposes the `impeccable` binary and requires Node `>=22.18.0`. [npm metadata](https://registry.npmjs.org/impeccable/latest) · [CLI documentation](https://github.com/pbakaus/impeccable#cli) |
| npm package | **Yes:** `impeccable`, Apache-2.0. The package includes six direct dependencies and optional Puppeteer for URL/browser scanning. [package source](https://github.com/pbakaus/impeccable/blob/main/package.json) |
| MCP server | **No official MCP found** in the product docs, repository map, package metadata, or official install paths checked. Impeccable integrates through skills, commands, hooks, a CLI, and browser/live-mode scripts instead. |

### Adoption evidence

- Repository: **64,443 stars** at the snapshot; GitHub identifies the license as Apache-2.0. [GitHub API snapshot](https://api.github.com/repos/pbakaus/impeccable)
- skills.sh: the first-party `impeccable` skill showed **256,086 installs**; command skills in the same repository had separate counters. These counters should not be summed as unique users. [skills.sh search snapshot](https://skills.sh/api/search?q=impeccable&limit=100)
- npm: **494,145 downloads** for 2026-07-31 through 2026-08-29. [npm downloads snapshot](https://api.npmjs.org/downloads/point/last-month/impeccable)

### Supported environments and write effects

The core guidance/detector is frontend-oriented rather than tied to one UI framework. Live-mode adapters are present for Next.js, Nuxt, Astro, SvelteKit, TanStack Start, generic Vite, and static HTML. [framework adapters](https://github.com/pbakaus/impeccable/tree/main/skill/scripts/live/frameworks)

The recommended installer is not a read-only documentation copy. Depending on provider and scope it can:

- copy the skill into project or user-level agent directories;
- write provider-native hook manifests such as `.claude/settings.local.json`, `.cursor/hooks.json`, `.codex/hooks.json`, `.github/hooks/impeccable.json`, or `.grok/hooks/impeccable.json`;
- preserve and merge existing hook entries, or back up/replace malformed manifests only when `--force` is used;
- create/update `.impeccable/config.json` and machine-local `.impeccable/config.local.json`;
- later write `PRODUCT.md`, `DESIGN.md`, surface briefs, critique reports, screenshots, caches, and live-mode state. [official hook documentation](https://impeccable.style/docs/hooks) · [repository write-effects description](https://github.com/pbakaus/impeccable#design-hook)

### Supply-chain assessment

**Moderate by default; higher with hooks/live mode.** The source is public, highly adopted, Apache-2.0, and the npm package publishes an integrity hash/signature. However, `npx impeccable install` executes code and may install hooks that run on future agent edits. This project therefore pins the complete Pi skill project-locally at tag `skill-v3.6.0`, commit `858b9bbea637c1b3beaf89b2ff7a8c22163ee7ef`, records every installed file and its deterministic hash, and keeps hooks and live mode explicitly disabled. Future updates must repeat the same provenance and byte-verification process. Do not confuse the many community `impeccable` skills in search results with `pbakaus/impeccable`.

## 2. Vercel `design.md`

### Verified surfaces

| Surface | Finding |
| --- | --- |
| Agent skill | **Yes, first-party but URL-delivered.** `https://vercel.com/design.md` returns `text/markdown`, starts with skill frontmatter (`name: vercel-brand-guidelines`), and repeatedly refers to itself as “this skill.” [served Markdown](https://vercel.com/design.md) |
| Documented agent integration | **Yes, implicit.** The Markdown tells an agent how to preserve the caller's framework and how to resolve its companion asset from the skill URL. It is directly consumable as agent instructions, but Vercel does not document a dedicated install command on the checked design pages. [Vercel Design](https://vercel.com/design) · [skill integration section](https://vercel.com/design.md) |
| Installer/CLI/package | **No first-party installer, CLI, or npm package found for this artifact.** |
| MCP server | **No first-party MCP found for this artifact.** |
| skills.sh | **No Vercel-owned `vercel-brand-guidelines` result found.** Search returned unrelated/community brand skills, including similarly named Vercel-style packages; those are not substitutes for the Vercel-hosted document. [skills.sh search snapshot](https://skills.sh/api/search?q=vercel-brand-guidelines&limit=100) |

### Scope is narrower than the name suggests

The served skill says it is for an **“official Vercel-authored report website”** and requires unmistakable Vercel authorship through its shell, wordmark, triangle logo, Geist typography, and a namespaced Vercel Brand Guidelines (`vbg-*`) CSS API. It is optimized for reports, proposals, briefs, benchmarks, comparisons, narrative data pages, calculators, and decision pages—not a generic application shell or neutral product design system. [scope and priority rules](https://vercel.com/design.md)

For a non-Vercel platform redesign, copying the wordmark shell or presenting “official Vercel authorship” would be semantically wrong and may create brand/trademark risk. The valuable transferable layer is the document's design judgment: lead with the reader's job, establish one focal relationship, use evidence-led hierarchy, avoid generic card grids and decorative motion, preserve reduced motion, and keep responsive/accessibility checks explicit.

### Supported environments and write effects

The guidance tells the agent to preserve the host framework. It explicitly covers:

- existing Vercel/Geist projects;
- stock v0 or generic Next.js + Tailwind + shadcn projects;
- React 19 stylesheet linking;
- standalone semantic HTML/CSS/small JavaScript fallback.

Following the skill literally outside an existing Vercel project may add a link to `https://vercel.com/geist/vercel-brand.css`, copy that stylesheet into `assets/`, load Geist/Geist Mono, and use Vercel-hosted logo assets. The companion CSS was **108,893 bytes** at the snapshot and is mutable at the URL. [official CSS asset](https://vercel.com/geist/vercel-brand.css)

### License and supply-chain assessment

**Use as reading guidance only unless Vercel clarifies reuse.** Neither the served Markdown nor the top of the companion CSS states a software/content license. No repository or package provenance was exposed for this specific asset in the checked first-party pages. Linking the CSS also creates a production-time remote dependency; copying it creates a vendored code/brand asset requiring license and update ownership. The report therefore does **not** recommend a community mirror or an unofficial installer. For this redesign, extract neutral principles into the project's own design specification rather than shipping Vercel branding or `vbg-*` assets.

## 3. shadcn/ui

### Verified surfaces

| Surface | Finding |
| --- | --- |
| Agent skill | **Yes, official.** The canonical repository has `skills/shadcn/SKILL.md` plus rules, CLI, registry, customization, and MCP references. The skill is non-user-invocable and allows the official CLI commands. [official skill source](https://github.com/shadcn-ui/ui/tree/main/skills/shadcn) |
| Installer/CLI | **Yes.** `npx shadcn@latest init -t [framework]`, `add`, `view`, `search`, `docs`, `apply`, migrations, and registry tooling are first-party. [installation docs](https://ui.shadcn.com/docs/installation) · [CLI docs](https://ui.shadcn.com/docs/cli) |
| npm package | **Yes:** `shadcn`, MIT, Node `>=20.18.1`; package metadata includes npm signatures and SLSA provenance. [npm metadata](https://registry.npmjs.org/shadcn/latest) |
| MCP server | **Yes, official local stdio server.** `shadcn mcp` ships from the npm package. `npx shadcn@latest mcp init --client …` configures Claude Code, Cursor, VS Code, or OpenCode; Codex requires manual `~/.codex/config.toml`. [MCP documentation](https://ui.shadcn.com/docs/mcp) · [MCP source reference](https://github.com/shadcn-ui/ui/blob/main/skills/shadcn/mcp.md) |
| Registry/agent integration | **Yes.** MCP can search, view, get examples, produce add commands, and install registry items. Registries are configured in `components.json`; `@shadcn` is built in. [registry MCP docs](https://ui.shadcn.com/docs/registry/mcp) |

### Adoption evidence

- Repository: **122,680 stars**, MIT. [GitHub API snapshot](https://api.github.com/repos/shadcn-ui/ui)
- skills.sh showed **271,675 installs** under historical source `shadcn/ui` and **39,150** under `shadcn-ui/ui`. GitHub redirects the former repository identity to the latter, so these are duplicated/split counters and must not be summed as unique installs. [skills.sh search snapshot](https://skills.sh/api/search?q=shadcn&limit=100)
- npm: **33,325,648 downloads** for 2026-07-31 through 2026-08-29. [npm downloads snapshot](https://api.npmjs.org/downloads/point/last-month/shadcn)

### Supported frameworks and write effects

First-party installation currently names Next.js, Vite, TanStack Start, React Router, Astro, and Laravel. The repository also identifies React, Tailwind CSS, Base UI, Radix UI, React Aria, and TanStack in its supported ecosystem. [framework chooser](https://ui.shadcn.com/docs/installation) · [repository](https://github.com/shadcn-ui/ui)

`init` creates `components.json` and may configure CSS variables/theme tokens, aliases, the Tailwind CSS entry point, primitive base, icon library, and dependencies. `add` fetches registry JSON, writes component/util/hook source to the configured aliases, rewrites imports, and installs declared dependencies. Unlike a conventional sealed component package, the resulting code lives in the application and becomes the team's maintenance responsibility. [components.json contract](https://ui.shadcn.com/docs/components-json)

MCP initialization adds editor/client configuration (`.mcp.json`, `.cursor/mcp.json`, `.vscode/mcp.json`, `opencode.json`, or manual Codex config). Its tools can lead to source installation, so MCP access should be treated as code-write authority, not merely documentation search.

### Supply-chain assessment

**Best base, with registry discipline.** The canonical repo is mature, MIT, highly adopted, and the npm package has signatures/provenance. Still, `npx shadcn@latest` is a moving executable and registry items are mutable source payloads. This project pins the local MCP command to `shadcn@4.19.1`; future component operations must preview the exact payload, review every copied file and dependency, and allow only named registries. A community registry being shadcn-compatible does not make it shadcn-maintained.

### Installed pnpm policy

The project uses pnpm's explicit [`allowBuilds`](https://pnpm.io/settings#allowbuilds) map to deny lifecycle scripts for both `sharp` and `unrs-resolver`. Frozen installs run without `--ignore-scripts`, so the checked policy—not a blanket command flag—decides whether dependency scripts execute. The supply-chain gate required a one-command [`minimumReleaseAgeExclude`](https://pnpm.io/settings#minimumreleaseageexclude) exception for the exact locked `@alloc/quick-lru@5.3.0`; that exception is deliberately not persisted in repository configuration.

## 4. beUI

### Verified surfaces

| Surface | Finding |
| --- | --- |
| Agent skill | **Yes, official.** `npx skills add starc007/ui-components --skill beui`; the skill instructs agents to inspect the live registry and use exact `@beui` slugs. [agent guide](https://beui.dev/docs/ai-agents.md) · [skill source](https://github.com/starc007/ui-components/blob/main/skills/beui/SKILL.md) |
| Installer/CLI | **No standalone beUI installer.** First-party installation uses the shadcn CLI: `npx shadcn@latest add @beui/<slug>` or a direct `https://beui.dev/r/<slug>.json` URL. [README](https://github.com/starc007/ui-components#install-a-component) |
| Runtime package | **No.** The official skill explicitly says, “There is no `beui` runtime package.” Component source and dependencies are copied into the app. [skill source](https://github.com/starc007/ui-components/blob/main/skills/beui/SKILL.md) |
| MCP server | **Yes, official hosted HTTP MCP:** `https://mcp.beui.dev/mcp`. First-party tools are `list_components`, `search_components`, `get_component`, and `get_install_command`. [agent guide](https://beui.dev/docs/ai-agents.md) · [MCP source](https://github.com/starc007/ui-components/tree/main/mcp) |
| Agent-friendly endpoints | **Yes:** `llms.txt`, registry index/detail, raw source, Markdown docs, and shadcn registry JSON. [llms.txt](https://beui.dev/llms.txt) |

### Adoption evidence

- Repository: **1,375 stars**, MIT. [GitHub API snapshot](https://api.github.com/repos/starc007/ui-components)
- skills.sh: first-party `beui` showed **236 installs**; `beui-pro` showed 39 and is a licensed premium workflow, not the free component skill. [skills.sh search snapshot](https://skills.sh/api/search?q=beui&limit=100)
- There is no beUI runtime npm package to use as an adoption proxy.

### Supported frameworks and write effects

The official site targets **React and Next.js**, built with **Motion and Tailwind CSS**; the repository currently uses React 19, Next.js 16, and Tailwind CSS 4. [site metadata and description](https://beui.dev/) · [repository package](https://github.com/starc007/ui-components/blob/main/package.json)

A registry item can write several source files and add dependencies. For example, `animated-toast-stack` declares `clsx`, `lucide-react`, `motion`, and `tailwind-merge`, and writes the component plus `lib/ease.ts` and `lib/utils.ts`. This is inspectable before installation through the registry. [example registry item](https://beui.dev/r/animated-toast-stack.json)

Installing the skill changes agent skill configuration only. Connecting the hosted MCP changes client configuration and sends component queries to a remote service. The published MCP tools return component data/install commands; installation still occurs through the shadcn flow.

### Supply-chain assessment

**Acceptable for isolated components, not as the base system.** The source is public and MIT, but the registry is live, the adoption footprint is much smaller than shadcn's, and animated components can carry larger dependency/behavior surfaces. Pin the shadcn CLI, inspect the exact registry JSON and copied files, preserve reduced-motion behavior, and avoid adding duplicate utilities. Prefer direct registry inspection over granting a hosted MCP persistent access when only one or two components are needed.

## 5. Transitions.dev

### Verified surfaces

| Surface | Finding |
| --- | --- |
| Agent skill | **Yes, official.** The site documents `npx skills add Jakubantalik/transitions.dev`; the current monorepo contains `transitions-dev` and `transitions-polish` skills. [skill page](https://transitions.dev/skill.html) · [current skill source](https://github.com/Jakubantalik/transitions.dev/tree/main/skills) |
| Installer/CLI/package | **Yes.** `transitions-pro` installs free CSS recipes without an account and fetches Pro CSS/React recipes after browser sign-in. `transitions-refine` injects a live timeline/agent panel. Both are public npm packages tied to the first-party repository. [official README](https://github.com/Jakubantalik/transitions.dev#install-with-the-cli-npm) · [transitions-pro metadata](https://registry.npmjs.org/transitions-pro/latest) · [transitions-refine metadata](https://registry.npmjs.org/transitions-refine/latest) |
| MCP server | **No official MCP found** in the product site, current/standalone repositories, package metadata, or documented install flows checked. |
| Direct code integration | **Yes.** Copy/paste CSS from the site or skill, import `_root.css`, wire documented classes/state attributes, and add small JS orchestration where required. [skill source](https://github.com/Jakubantalik/transitions.dev/blob/main/skills/transitions-dev/SKILL.md) |

### Adoption evidence and identity uncertainty

- Current site/monorepo: **3,420 stars**. GitHub's API reports no root repository license metadata. [GitHub API snapshot](https://api.github.com/repos/Jakubantalik/transitions.dev)
- A separate first-party `Jakubantalik/transitions-dev` repository remains public with **43 stars** and MIT metadata. [standalone repository snapshot](https://api.github.com/repos/Jakubantalik/transitions-dev)
- skills.sh currently showed **4,112 installs** for `transitions-polish` from `jakubantalik/transitions.dev` and **1,633 installs** for `transitions-dev` from `jakubantalik/transitions-dev`. The official website's command points to the dot-named current monorepo, while skills.sh still indexes the standalone source separately. Do not sum these as unique users; verify the intended skill name immediately before any future install. [skills.sh search snapshot](https://skills.sh/api/search?q=transitions-dev&limit=20)
- npm: `transitions-pro` had **1,023** downloads and `transitions-refine` **790** for 2026-07-31 through 2026-08-29. [pro downloads](https://api.npmjs.org/downloads/point/last-month/transitions-pro) · [Refine downloads](https://api.npmjs.org/downloads/point/last-month/transitions-refine)

The repository README still describes an earlier number of transitions in several places while the current skill source lists 32. This appears to be documentation drift; the live skill source should be treated as the behavioral source, and the mismatch should be rechecked before adoption rather than guessed away.

### Supported frameworks, write effects, and licensing

The free skill is deliberately framework-independent: namespaced CSS selectors, semantic custom properties, no framework dependency, and `prefers-reduced-motion` guards. Some recipes add small DOM/JS orchestration; the CLI also offers React and TypeScript forms. Applying the skill can modify a global stylesheet, import `_root.css`, add classes/state attributes to markup, and add timing-aware JavaScript. [current skill](https://github.com/Jakubantalik/transitions.dev/blob/main/skills/transitions-dev/SKILL.md)

The website terms say:

- downloaded transitions may be used and modified in unlimited personal/commercial projects;
- the library itself may not be redistributed;
- the Refine tool and `transitions-pro` CLI are MIT;
- transition snippets use the website's specific license terms, **not** MIT. [terms and license](https://transitions.dev/terms.html)

This is more precise than GitHub's missing license metadata for the current root repository, but it means “MIT repository/package” must not be generalized to every Pro or free recipe payload.

### Supply-chain assessment

**Low-to-moderate for reviewed free snippets; high for live Refine/Pro automation.** Copied CSS is auditable and has no runtime package, but the agent skill can direct broad project scans/edits. `transitions-pro` fetches recipes from a remote API, and Pro uses browser authentication. Refine can inject a script, run a local relay, invoke the user's coding agent, edit source when suggestions are accepted, and consume provider quota even while polling. Start with one named, copied, reduced-motion-safe transition; avoid Refine until a recurring workflow justifies that authority and complexity.

## Recommended operating policy

1. **Base layer:** initialize and own shadcn/ui source with the MCP/CLI pinned to `shadcn@4.19.1` and an allowlist containing only `@shadcn` initially.
2. **Design direction:** use the project-local Impeccable skill pinned to `skill-v3.6.0` / `858b9bbea637c1b3beaf89b2ff7a8c22163ee7ef`; keep hooks and live mode disabled unless a separately reviewed change enables them.
3. **Dependency execution:** keep `sharp` and `unrs-resolver` lifecycle scripts denied; treat any future build-script permission or persisted release-age exception as a new supply-chain decision.
4. **Vercel influence:** translate the neutral principles from `design.md` into the project's own design document. Do not ship Vercel wordmarks, the `vbg-*` report shell, or the hosted brand CSS in a non-Vercel product.
5. **Motion budget:** first use native CSS/shadcn states. Add a beUI component when it replaces a complex, well-bounded interaction; add a Transitions.dev snippet when only a focused transition is needed. Do not adopt both for the same interaction.
6. **Every external add:** record source owner, exact version/commit or registry payload, files written, dependencies added, license, and a reviewed diff. Re-run accessibility, reduced-motion, keyboard, bundle, and responsive checks.
7. **MCP policy:** prefer temporary/manual discovery over persistent MCP configuration. If MCP is enabled, use shadcn's pinned local server for the base registry; add beUI's hosted server only when repeated component discovery warrants the remote trust boundary.

## Source quality notes

- First-party product sites and owned repositories were treated as authoritative for capabilities and install effects.
- npm registry metadata/download APIs and GitHub repository APIs were used for point-in-time package, license, provenance, and adoption signals.
- skills.sh was treated as a discovery/count index, not an ownership authority. Its duplicate shadcn aliases and split Transitions.dev repositories demonstrate why counts and names require first-party verification.
- Negative findings (“no official MCP/package/install command found”) are bounded to the official sites, linked repositories, package metadata, skills.sh index, and documented install flows checked on the snapshot date; they are not claims that no community implementation exists.
