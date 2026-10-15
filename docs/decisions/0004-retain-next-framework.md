# 0004 — Retain Next.js; defer an executable Start comparison

Status: Proposed (ADR-only research outcome for #493; acceptance remains owner-owned).

Decision owner: Product owner. No migration, dependency upgrade, deployment, billing,
domain, traffic, Auth or database change is authorized by this record.

## Decision

**Keep Next.js App Router. Defer an executable TanStack Start comparison.** There
is no controlled equivalent-route result supporting a rewrite. Start has credible
typed-search and loader capabilities, but changing the router does not remove the
measured facet/RPC work. This is a risk/benefit decision under incomplete evidence,
not a finding that Next is faster or that Start cannot implement Votus.

The user narrowed this spike to an ADR only. No Start app, local route port,
installation, benchmark, production integration or hosted mutation was performed.
The executable acceptance criteria below remain explicitly deferred outside that
narrowed authorization; this document does **not** certify the original spike complete.

## Context

Issue [#493](https://github.com/NicolasIppoliti/votus-plataforma-lla/issues/493)
asks for an equivalent electoral route, not Next/Vercel versus Start/Workers.
Its prerequisites are #490 profiling and #491 hosting compatibility/cost research.
#491 remains open at inspection; its issue text is a requirement, not a measured
hosting result. ADR numbers 0002 and 0003 are reserved for #491 and #492; this is
0004 even though only 0001 exists in this checkout.

Repository inspection is at `b86591165a72aaf1a182a688aead49be6c289453` on
`docs/493-adr`. Local dependency declarations are Next **16.3.6**, React/React DOM
**19.3.0**, Node **24.x**, pnpm **12.6.0**, Zod **4.6.5**. These are declarations,
not newly installed or compatibility-tested versions. Python ETL is outside the
framework decision; no web-framework change promises faster ingestion.

### Surface inventory and migration estimate

Counts were obtained recursively from `apps/web/src` using Python `pathlib`:
`page.tsx`, `layout.tsx`, `route.ts`, top-of-file `use client`/`use server`,
`from 'next…'` imports and `.test.` filenames. Counts overlap; do not add them
as distinct affected files. Tests counted here are source tests, not a test run.

| Surface | Observed count / scope | Portable versus adaptation |
|---|---|---|
| Pages | 11: `/`, `/login`, `/drilldown`, `/compare`, `/dashboard`, `/evidencia`, `/fiscalizacion`, `/municipal`, `/review`, `/scenarios`, `/simulate` | Presentation and domain math are candidates for reuse; async RSC page composition, search-parameter entry points and metadata require adaptation. |
| Layouts | 2: root and authenticated | Shell CSS/markup reusable; request gates, SSR and nested route composition require adaptation. |
| HTTP routes | 11 `api/**/route.ts` | Preserve endpoint/request/response semantics, authorization and errors; translate handler integration. Includes fiscal coverage as well as results. |
| Server directives | 4 modules: sign-in, sign-out, context-actions, drilldown/circuit-geometry | Replace framework action transport/cookie/redirect semantics; do not expose server-only filesystem or claims logic to browser loaders. Four modules is not four exported functions. |
| Client boundaries | 34 modules in `src` | Most React/UI code is potentially portable, but router hooks, server-action calls, lazy maps and served-selection boundaries need audit. No claim all 34 need rewriting. |
| Explicit Next imports | 23 `.ts`/`.tsx` modules in `src` | A concrete lower-bound audit set, not the total migration size; conventions and configuration add work without imports. |
| Fonts | 2 `next/font/google` families in root layout | IBM Plex Sans/Mono, four weights each: preserve CSS variables, loading behavior and layout stability with a replacement build strategy. |
| Build | `next.config.ts`, package scripts, production-build/toolchain scripts, TS/Vitest/Playwright configuration | Next tracing, production artifacts, version checks and release gates need equivalent integration; retain independent typecheck. |
| Tests | 95 `.test.` source files; 8 `e2e/**/*.spec.ts` | Domain cases reusable; page/Next mocks and browser/server harnesses adapt. Counts do not establish passing tests or cross-framework parity. |
| File-backed artifacts | 5 traced route entries, 5 distinct included files in `next.config.ts` | Section derivative, Rosales reference, scenario JSON, province GeoJSON and archive manifest. Preserve filesystem/packaging and sha256/provenance behavior; `nodejs_compat` alone does not prove the files exist. |

Evidence paths: [package](../../apps/web/package.json),
[Next build/tracing](../../apps/web/next.config.ts),
[root/fonts](../../apps/web/src/app/layout.tsx),
[SSR cookies](../../apps/web/src/lib/supabase/server-client.ts),
[revisioned selection](../../apps/web/src/lib/workspace/selection.ts),
[RPC orchestration](../../apps/web/src/lib/workspace/context.ts),
[file-backed section](../../apps/web/src/lib/workspace/municipal-section-geometry.ts).
Pure result normalization, canonical selection/dependent-clear helpers, formatting,
statutory allocation and React markup are reuse candidates, not permission to
import `server-only` modules into universal loader code.

Planning estimate, **not measured effort or a commitment**: one experienced
maintainer familiar with this code, unchanged Supabase/corpus/Node platform,
no redesign and no production rollout. An isolated drilldown route plus login,
workspace shell and parity harness is roughly **8–15 engineer-days** (2–4 routing
and UI, 2–4 cookie/context/server transport, 3–5 parity/races, 1–2 measurement).
A whole-app migration is roughly **30–55 engineer-days**, including that pilot,
11 pages, 11 HTTP contracts, 2 layouts, 4 action modules, build/artifact integration
and test-harness adaptation; these are not additive file counts. Deployment,
unknown host-adapter work and operational observation are additional and unpriced.
No honest exact total affected-file count is available before a port; 23 explicitly
Next-importing modules plus convention entrypoints/configuration is the audit floor.

For planning, preserve **eight contract groups**: (1) canonical validated URL and
history, (2) dependent clearing and pending-selection visibility, (3) session/cookies
and independent gates, (4) workspace/revision concurrency, (5) authorized RPC shapes
and refusal states, (6) official versus fiscal separation/exclusion reporting,
(7) artifact hashes/provenance, (8) no-JS/accessible rendering and optional maps.
These are review groups, not a count of exported interfaces.

## Options

| Option | Benefit | Cost / disposition |
|---|---|---|
| Retain Next and investigate facet/query work first | Preserves reachable RSC, actions, Auth SSR and build gates; targets measured expensive work | Chosen. Manual URL/draft synchronization remains a maintenance cost. No optimization is implemented here. |
| Isolated stable Start, same Node/host/backend, without experimental RSC | Tests typed search/loaders against the actual route contract | Plausible future experiment, not executed or approved here. SSR/hydration boundaries and loader cache safety must be demonstrated. |
| Start on Workers versus existing Next elsewhere | Can investigate a combined product direction | Rejected as a framework benchmark: changes runtime, adapter and network/hosting together. Hosting belongs to #491. |
| Whole-app rewrite or experimental Start RSC for apparent parity | Might preserve some composition patterns | Rejected: no measured payback, experimental API and unnecessary scope/risk. |

Better Auth is neither a prerequisite for Start nor a reason to leave Next:
official integrations exist for both [S6, S7]. Keep Supabase Auth unchanged in any
controlled framework experiment; #492 owns the separate Auth investigation.

## Evidence (cited)

### Existing route and baseline

The real entrypoint is [drilldown/page.tsx](../../apps/web/src/app/(authenticated)/drilldown/page.tsx),
which composes authorized facets/evidence and explicit exclusion/refusal UI.
[DrilldownSelectionForm](../../apps/web/src/app/(authenticated)/drilldown/DrilldownSelectionForm.tsx)
already clears dependent selectors, canonicalizes URLs, pushes deliberate traversal,
replaces filters, restores `popstate`, and hides evidence until served selection
matches draft. That is a concrete maintenance argument for typed routing, not
proof that another router safely replaces it.

The #490 report was read **read-only from the other worktree**:
`/Users/nicolasmateoippoliti/dev/votus-plataforma-lla-worktrees/490/docs/research/page-waterfalls.md`.
Its eventual repository locator is `docs/research/page-waterfalls.md` on the #490
branch/PR; it is not present here. These figures are transcribed reported evidence,
not independently rerun measurements. The report identifies instrumentation on
SHA `0dcd6a945b5ad74478c71c7250025fca51573d4e`, Node **24.21.0**, synthetic authorized
workspace, public official 2023 generales / 2025 legislativas, DIPUTADO NACIONAL,
distrito **02**, sección **027**, and no hosted access. Exact election/archive IDs,
artifact receipt hashes, hardware and backend region/latency must be recovered
from the #490 receipts before a reproducible matched trial; the summary alone
is not a complete provenance fixture.

| Reported drilldown bucket | n | TTFB p50 / p95 ms | Instrumented envelope p50 / p95 ms |
|---|---:|---:|---:|
| Cold process | 10 | 149.44 / 162.55 | 1917.75 / 1975.61 |
| Warm document | 10 | 99.87 / 106.34 | 1841.63 / 1877.97 |
| Link navigation | 10 | 113.36 / 119.59 | 1637.70 / 1696.40 |

The complete report has 80 successful samples and zero classified errors across
three pages, not 80 equivalent drilldown samples. Cold means new process, not
flushed OS/DB caches. Warm facets cost **1668.50 / 1687.49 ms** per call versus
**129.10 / 131.65 ms** for drilldown evidence. Document drilldown makes **11 RPCs**.
Nested spans overlap; SDK time is not SQL-only time. Navigation click-to-main /
response-completion is **1786.67 / 1841.63 ms**, but enters selector state, not the
scoped evidence corpus. None of these numbers measures hydrated filter-to-evidence
latency. Streaming TTFB is not completed authorized evidence.

**Unknown/not measured here:** LCP, INP, hydrated filter-to-result, JS transfer,
SQL execution, CPU, RSS, serialization/hydration cost, map realization, build/HMR,
and every Start timing/error rate. No cold/warm framework deltas, TCO savings,
or security-parity pass can be calculated. The baseline supports investigating
facets first, not a causal claim that only SQL or only the router is responsible.

### Official capability checks

Primary sources were fetched for this research. TanStack/Cloudflare rendered
sites returned HTTP 403, so their official GitHub documentation sources were
used instead (not third-party summaries). Some initial guessed Router raw paths
returned 404; the official repository tree resolved the current paths below.
`latest` and `main` are moving references and must be rechecked before execution.

- **[S1]** [Start overview, official source](https://github.com/TanStack/router/blob/main/docs/start/framework/react/overview.md): explicitly says Start is stable; full-document SSR, streaming, server functions and Vite/Rsbuild are documented. Its marketing equivalence claims are not Votus benchmark evidence.
- **[S2]** [Start RSC guide, official source](https://github.com/TanStack/router/blob/main/docs/start/framework/react/guide/server-components.md): explicitly experimental and not enabled by default. Stable Start does not imply stable RSC parity with existing Next composition.
- **[S3]** [Official npm package metadata](https://registry.npmjs.org/@tanstack/react-start/latest): observed exact release **1.169.2**, Node `>=22.12.0`, peers include Vite `>=8.0.0` and React/React DOM `>=18.0.0 || >=19.0.0`. Local Node/React declarations fall within these ranges; this is not an install/build compatibility test. No Start dependency was added.
- **[S4]** [Router search validation](https://github.com/TanStack/router/blob/main/docs/router/guide/search-params.md) and [data loading](https://github.com/TanStack/router/blob/main/docs/router/guide/data-loading.md): `validateSearch`, deterministic serializable `loaderDeps`, cancellation signals and invalidation exist. Default stale data can render during background revalidation; `staleTime: 0` is **not** an authorization-cache isolation guarantee. `router.invalidate()` alone does not prove stale sensitive evidence cannot render.
- **[S5]** [Cloudflare Start integration, official source](https://github.com/cloudflare/cloudflare-docs/blob/production/src/content/docs/workers/framework-guides/web-apps/tanstack-start.mdx): documents Vite plugin integration, SSR environment, server entry and `nodejs_compat`; Rsbuild is not supported in that guide. This is an integration path, not proof of cookies, archive packaging, memory or latency parity. No documented deploy command was executed.
- **[S6]** [Better Auth + Next](https://www.better-auth.com/docs/integrations/next): documents Next integration and `nextCookies`.
- **[S7]** [Better Auth + TanStack](https://www.better-auth.com/docs/integrations/tanstack): documents `tanstackStartCookies`. Compatibility with both does not validate migration of existing Supabase sessions/claims/RLS.

## Consequences

No production code or gates change. Current URL/context UX work in **#433, #435,
#437, #438 and #442** remains owned there; a future prototype must consume those
contracts rather than invent a router-specific UX. [ADR 0001](0001-explorer-history-policy.md)
remains authoritative for push traversal / replace filter history. Manual router
synchronization remains, and a potentially useful Start design is left untested.
Keeping Next avoids immediate migration cost but does not solve the measured
facet delay or establish that the existing architecture is optimal.

### Acceptance-criterion disposition

| #493 criterion | ADR coverage / honest status |
|---|---|
| 1. Inventory, portability, counts and effort | Addressed above with counting method, overlapping file counts, entrypoint/contract totals and assumption-based ranges. Exact changed-file total awaits a port. |
| 2. Profiled real route, same DB/Auth/corpus/platform | #490 baseline consumed with provenance and limitations. Matched two-framework execution is deferred outside ADR-only authority; no cross-host attribution made. |
| 3. Isolated stable Start representative route | **Deferred/out of authorized ADR-only scope**, not satisfied by a hello-world or paper design. Future route must include validation, dependent clearing, deep links, history, navigation and optional map. |
| 4. Evidence/security/cache parity incl. tabs/in-flight | **Deferred/out of authorized ADR-only scope** for execution. Required matrix below; existing tests are not Start evidence. |
| 5. Full metric suite with cold/warm distributions | Existing #490 values reported above; missing metrics explicitly unknown. New benchmark/build/HMR execution is outside this ADR-only deliverable. |
| 6. Pre-agreed improvement threshold; keep/change/defer | Keep Next / defer execution decided with restrictions. No threshold was agreed with owner before this research and no comparison results were evaluated; proposed gate below requires future agreement, not retroactive approval. |
| 7. Reuse UX contracts, avoid fabricated migration | Addressed: preserve five named UX issues and ADR 0001, retain Next, no parallel router proposal or production migration. |

### Required parity matrix if separately authorized

A future trial uses the real drilldown route and the same Supabase Auth, database
snapshot, official source corpus, permissions, Node version, host resources,
backend network/region, artifact bytes and browser/device. If identical runtime
or host cannot be achieved, report combined-system effects, not a framework win.

| Scenario | Required assertion in both implementations |
|---|---|
| Valid/invalid URL, dependent clear, reload/deep link, push/replace and Back/Forward | Same canonical selection and refusal semantics; never silently coerce to another election/territory or show evidence for a draft. |
| Official evidence and optional map | Exact figures, lineage, unmapped identity labels, exclusion counts/reasons, provenance IDs/hashes, source_kind and map withheld/fallback behavior; camera does not change totals. Fiscal data never enters official aggregates. |
| denied / empty / unavailable / truncated | Preserve distinct statuses and bounded evidence; no silent empty success or undisclosed loss. |
| Organization switch, stale revision, expiry, logout | Revalidate on server; isolate any cache by verified session, organization, revision and canonical selection. URL-supplied organization is not authorization. Hide/retire old evidence before refresh; do not rely on background invalidation alone. |
| Two tabs and pending requests | Switch/revoke/logout in one while another navigates; delay and reorder responses across revisions and selections. Old completion, prefetch or cached result must not restore retired evidence. Cancellation is an optimization, not the security check. |
| Artifacts and boundaries | Verify bundled file hashes and provenance in the chosen runtime; browser bundle must exclude server filesystem/auth code. Retain independent request/render gates and accessible/no-JS behavior. |

Measure paired cold-process/warm-document, navigation and hydrated filter-to-evidence
buckets separately. Propose at least 30 samples per bucket, report n/median/p95,
raw receipts and errors, and distinguish process cold from DB/OS cache state.
Collect TTFB, LCP, INP (with real interactions), result latency, JS bytes, RPC
counts, SQL timings, CPU/RSS, build/HMR, serialization/hydration and map realization.
This protocol is a future requirement, not executed test evidence.

## What would change the decision

Before collecting a comparison, obtain owner agreement to a concrete threshold.
Suggested **unapproved** gate: all parity/security gates pass, no material regression
in LCP/INP/JS/errors/operations, and either at least **20% and 300 ms** reduction
in p95 hydrated filter-to-authorized-evidence latency on the identical backend,
or a credible measured maintenance/operating saving paying back the full migration
within **12 months**. Maintenance saving requires observed engineering tasks/time,
not fewer lines or fewer release gates. Evaluate cold/warm separately; no aggregate
win hiding a regression. Prices, engineering day rate, traffic and current hosting
cost remain unknown; no monetary payback is claimed.

Reopen only after #490 receipts are reproducibly available, #491 settles a feasible
controlled platform, the owner approves isolated executable work and the threshold,
and a stable pinned Start route demonstrates the matrix and metrics above. If
facet/query optimization leaves no plausible framework benefit, retain Next and
close the framework investigation without manufacturing a migration. A new ADR,
not this document, would authorize any bounded migration proposal.

## Verification

Documentation-only change: RED/GREEN behavior testing is inapplicable. Issue #493
and prerequisite #491 were read in full; existing ADR 0001 and the #490 report were
read. Inventory was calculated locally without running application scripts or
accessing secrets. Primary-source fetch successes and 403/404 limitations are
recorded above. No application tests, benchmarks, installers or hosted operations
were run. Review this record as evidence/decision scope, not an executable spike.
