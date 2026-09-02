# Design System — Votus

## Product Context

- **What this is:** An authenticated electoral-analysis platform that combines immutable public official results, explicitly opt-in internal fiscalización evidence, review workflows, cross-election comparison, and hypothetical 2027 scenarios.
- **Primary user:** Electoral analyst/operator. Leadership consumes an executive briefing as a secondary progressive-disclosure layer.
- **Space:** Internal political and electoral analysis.
- **Project type:** Data-dense internal web application and decision-support dashboard.
- **Memorable posture:** A serious electoral situation room: information-rich, clearly hierarchical, fast to operate, and trustworthy.

## Approved Direction

- **Name:** Command Ledger
- **Aesthetic:** Editorial Operative — industrial discipline for data, editorial hierarchy for decisions.
- **Decoration:** Intentional and minimal. Typography, hairline borders, tonal surfaces, and evidence structure do the visual work.
- **Theme:** Light-first analytical surfaces inside a deep graphite application shell. No theme selector in the initial redesign.
- **Layout:** Grid-disciplined analytical routes with controlled asymmetry on the operational briefing.
- **Brand posture:** Analytically neutral. LLA identity may appear in institutional context but must not become data semantics.
- **Approved prototype screens:** Authenticated shell + operational briefing, and official comparison dense route.

## Design Principles

1. **Evidence stays beside the figure it qualifies.** Provenance, coverage, granularity, exclusions, truncation, and source kind cannot be detached into unrelated footers.
2. **Denied is not empty.** Empty, denied, unavailable, truncated, technical error, and loading states share structure but never meaning or disclosure behavior.
3. **Tables are canonical.** Visualizations accelerate interpretation but do not replace exact values or accessible alternatives.
4. **Density follows the task.** Briefing and shell are calm; exploration and comparison are compact; simulation balances controls and technical evidence.
5. **Navigation is visible wayfinding.** Search and command palettes may accelerate navigation but never replace the persistent sidebar.
6. **Official and fiscalización remain unmistakably separate.** They can be juxtaposed but never visually or numerically collapsed into one source.
7. **No decorative dashboard language.** Avoid generic KPI grids, pie charts, gauges, gradients, blobs, oversized radii, and motion without explanatory value.

## Information Architecture

### Global shell

- **Desktop:** Persistent `15rem` sidebar and `4rem` topbar.
- **Mobile:** Sidebar becomes a drawer; workspace context remains visible in the topbar.
- **Topbar responsibility:** Active workspace, authorization/verification state, workspace switch, account actions.
- **Sidebar responsibility:** Product identity, domain navigation, current-route indication, and source-separation reminder.

### Navigation groups

- **Situation**
  - Operational briefing — `/`
- **Official Results**
  - Explore — `/drilldown`
  - Compare — `/compare`
  - Municipal — `/municipal`
- **Fiscalización**
  - Coverage and results — `/fiscalizacion`
- **Scenarios**
  - 2027 simulation — `/simulate`
- **Operations**
  - Data review — `/review`

`/dashboard` redirects to `/`. Compare and Municipal are visible navigation destinations. Review indicators must not expose counts when the user cannot access evidence.

## Typography

- **Display and body:** IBM Plex Sans.
- **Machine evidence:** IBM Plex Mono.
- **Loading:** Self-hosted or `next/font`; never rely on system availability or a runtime third-party font request.
- **Data:** Use tabular numerals for electoral totals, percentages, deltas, and seat counts.
- **Mono usage:** IDs, hashes, administrative codes, archive references, compact status labels, and diagnostic evidence only.

### Type scale

| Token | Size / line-height | Usage |
| --- | --- | --- |
| `display` | `3rem / 0.98` | Briefing focal statement on large screens |
| `h1` | `2.25rem / 1.05` | Route title |
| `h2` | `1.5rem / 1.2` | Major section |
| `h3` | `1rem / 1.3` | Panel and table section |
| `body` | `0.875rem / 1.55` | Primary explanatory copy |
| `small` | `0.75rem / 1.45` | Secondary copy |
| `label` | `0.6875rem / 1.2` | Controls and metadata |
| `micro` | `0.625rem / 1.2` | Compact machine evidence only |

Mobile display and route headings step down one level; body copy never drops below `0.8125rem` for dense analytical surfaces.

## Color

### Core palette

| Token | Value | Meaning |
| --- | --- | --- |
| `--shell` | `#121B1E` | Sidebar and deep application chrome |
| `--canvas` | `#F4F3EE` | Warm analytical background |
| `--surface` | `#FFFFFF` | Primary work surface |
| `--surface-muted` | `#E9ECE8` | Filter bars and secondary groupings |
| `--ink` | `#162124` | Primary text |
| `--muted-ink` | `#556366` | Secondary text; AA on canvas |
| `--border` | `#D2D9D5` | Hairline structure |
| `--accent` | `#0B6B63` | Product action and active navigation |
| `--accent-strong` | `#084F4A` | Hover/pressed action |

### Source and semantic palette

| Token | Value | Meaning |
| --- | --- | --- |
| `--official` | `#245A92` | Official source identity |
| `--fiscalizacion` | `#9A5A13` | Fiscalización source identity |
| `--simulation` | `#6A4C93` | Hypothetical scenario identity |
| `--success` | `#237A57` | Verified/successful state |
| `--danger` | `#B42318` | Technical failure or destructive warning |
| `--warning-ink` | `#7A4D00` | Warning text |
| `--warning-surface` | `#FFF4DB` | Warning surface |

Color is never the only carrier of meaning. Every source/status color is paired with text, structure, or iconography. Do not use party colors as chart or state semantics.

## Spacing and Shape

- **Base unit:** `4px`.
- **Scale:** `2, 4, 8, 12, 16, 24, 32, 48, 64px`.
- **Shell/briefing density:** Comfortable, primarily `16–32px` grouping.
- **Analytical density:** Compact, primarily `6–12px` cells and control gaps.
- **Radii:** `3px` compact, `6px` standard surface, `10px` overlay/large composition, `9999px` badges only.
- **Borders:** `1px` by default; `2–3px` rails only when expressing source/evidence association.
- **Shadows:** Overlays, drawers, dialogs, and popovers only. Base panels use borders and tonal contrast.

## Responsive Layout

- **Minimum supported viewport:** `320px` without page-level horizontal overflow.
- **Mobile:** Full product capability, not a read-only subset.
- **Tables:** Exact tables remain available inside labelled, focusable horizontal-scroll regions.
- **Comparison:** Side A and Side B stack before controls or values are compressed.
- **Forms:** Progressive selectors stack into obvious groups while preserving field names, query parameters, focus behavior, and deep links.
- **Simulation:** Fully functional on mobile, while desktop remains the preferred deep-analysis environment.
- **Touch targets:** At least `44×44px`.

## Component Architecture

### shadcn/ui foundation

Use a pinned shadcn CLI version and allow only the canonical `@shadcn` registry initially. Source is copied into the repository and becomes project-owned.

Expected primitives:

- Button, Input, Label, Select, Checkbox
- Sheet for mobile navigation
- Dialog and AlertDialog
- Popover and Command for optional navigation acceleration
- Tabs and Collapsible for evidence disclosure
- Table primitives, Tooltip, Skeleton
- Alert only as a primitive; domain state semantics remain project-owned

### Project-owned deep components

- `ApplicationShell`
- `SituationSidebar`
- `WorkspaceTopbar`
- `OperationalBriefing`
- `EvidenceState`
- `EvidenceRail`
- `SourceBadge`
- `GranularityBadge`
- `TableRegion`
- `SideBySideSelector`
- `ComparisonSummary`
- `ExactResultTable`
- `ProvenanceBlock`
- `CoverageDisclosure`
- `ReviewAttention`

Do not hide domain semantics behind generic card or alert APIs. Components should expose a small, explicit contract and own substantial internal behavior.

## Evidence States

| State | Required behavior |
| --- | --- |
| Loading | Stable skeleton geometry; no fictitious numbers |
| Empty | Confirms a valid authorized query returned no rows |
| Denied | Explains access refusal without counts, provenance, percentages, or partial figures |
| Unavailable | Explains why the source cannot answer the selected question |
| Truncated / incomplete | Names bounded omissions and never presents partial figures as complete |
| Technical error | Provides an actionable retry/continuation and operational reference |

A shared presentation layer may unify spacing and hierarchy, but copy, iconography, disclosure, retries, and figure suppression remain variant-specific.

## Data Visualization

- Exact-value tables are the canonical representation.
- Horizontal bars support distribution and seat allocation.
- Delta bars/markers support cross-election comparison.
- Time series require a genuine temporal dimension.
- No pie charts, gauges, decorative KPI visualizations, or animated numbers.
- Every chart includes an accessible table or textual equivalent.
- Official and fiscalización can be juxtaposed but cannot share an aggregated series.
- Provenance, coverage, exclusions, and source kind remain adjacent to the visualization.

## Motion

- **Approach:** Minimal-functional.
- **Duration:** `120–180ms` for focus, hover, menus, drawer, filter continuity, evidence expansion, and row reordering.
- **No global page transitions.**
- **No animated totals, parallax, decorative blobs, or pulsing skeletons.**
- Use native CSS first.
- Use one reviewed Transitions.dev snippet only when it improves a named interaction.
- Use one beUI component only when it replaces a bounded complex interaction better than shadcn.
- `prefers-reduced-motion` removes every nonessential transition and animation.

## Copy and Language

- Neutral, direct, operational Spanish.
- Use correct electoral terminology rather than friendlier but inaccurate substitutes.
- Prefer concrete verbs: “Comparar”, “Revisar”, “Cambiar workspace”.
- Explain irreversible actions, degraded evidence, and source meaning at the point of use.
- No promotional slogans, celebratory copy, or essential information hidden in tooltips.
- Errors state what happened and the next runnable action.

## Accessibility Contract

WCAG 2.2 AA is a blocking merge gate.

- Zero axe critical/serious findings on primary routes.
- Complete keyboard operation and visible focus.
- Selective AAA contrast when it does not undermine semantics.
- Automated reduced-motion, responsive overflow, and `200%` zoom coverage.
- Semantic tables with captions, scopes, and labelled scroll regions.
- Accessible chart alternatives.
- No color-only meaning.
- Denied/error updates are announced correctly.

## External Tool Policy

### Adopt

- **shadcn/ui:** Pinned CLI, local MCP, only `@shadcn` initially.
- **Impeccable:** Pinned project-local skill for design critique and consistency detection.

### Reference only

- **Vercel design.md:** Use neutral principles for hierarchy, evidence, restraint, responsive design, and reduced motion. Do not ship Vercel logos, Geist, `vbg-*` APIs, hosted brand CSS, or claims of Vercel authorship.

### Selective and deferred

- **beUI:** No persistent hosted MCP initially. Inspect a named registry payload only for a specific complex component.
- **Transitions.dev:** Prefer copied, free, reduced-motion-safe snippets. Do not install Refine/Pro initially.

Every external addition records owner, exact version/commit or registry payload, files written, dependencies, license, reviewed diff, bundle impact, and accessibility evidence.

## Migration and Delivery Strategy

Use one isolated feature-branch chain with one sequential writer:

1. Pinned tooling, Tailwind 4, tokens, and primitives.
2. Application shell, sidebar, and workspace context.
3. Operational briefing and `/dashboard → /` redirect.
4. Official routes: explore, municipal, compare.
5. Fiscalización, review, and shared evidence states.
6. Simulation and data visualizations.
7. Selective motion, accessibility gate, and legacy CSS removal.
8. Accumulated tracker to `main`.

Legacy global CSS remains only while it has real production callers. The final tracker rejects any legacy visual caller. Production retains the current coherent UI until the accumulated tracker lands.

## Functional Non-goals

The redesign does not change:

- Authentication, workspace authorization, or permission semantics
- Electoral algorithms or statutory allocation rules
- Official/fiscalización separation
- Denial and truncation disclosure contracts
- Provenance, coverage, exclusion, and granularity semantics
- Simulation's hypothetical status
- Sensitive review-data hiding
- Existing route/query/deep-link contracts, except `/dashboard → /`

New product features discovered during design become separate future work units.

## Completion Gates

- Active workspace, current section, and evidence state are identifiable within three seconds.
- Every primary route is at most two actions from the briefing.
- Zero axe critical/serious findings.
- Complete keyboard operation.
- No page-level overflow at `320px`.
- Existing deep links and query parameters remain valid.
- Denied/unavailable/truncated states remain fail-closed.
- Desktop/mobile visual regression covers every primary route.
- Existing suite and redesign tests are green.
- Initial JavaScript grows by no more than `10%` without explicit approval.
- No production caller uses the legacy visual system.
- This document matches the delivered implementation bytes.

## Decisions Log

| Date | Decision | Rationale |
| --- | --- | --- |
| 2026-09-01 | Situation-room product posture | Make trust, speed, and analytical hierarchy memorable |
| 2026-09-01 | Analyst/operator primary persona | Preserve operator-grade precision over generic executive simplification |
| 2026-09-01 | Command Ledger approved | Best balance of briefing, density, actions, and evidence adjacency |
| 2026-09-01 | Light-first graphite/ivory system | Better long-form reading, screenshots, print, and semantic contrast |
| 2026-09-01 | IBM Plex typography | Technical/institutional identity without Vercel brand convergence |
| 2026-09-01 | Progressive shadcn/Tailwind migration | Route-complete slices with final legacy removal |
| 2026-09-01 | WCAG 2.2 AA blocking gate | Accessibility is production evidence, not later cleanup |
