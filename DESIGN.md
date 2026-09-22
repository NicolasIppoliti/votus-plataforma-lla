# Design System — Votus

## Product Context

- **What this is:** An authenticated electoral-analysis platform that combines immutable public official results, explicitly opt-in internal fiscalización evidence, review workflows, cross-election comparison, and hypothetical 2027 scenarios.
- **Primary user:** Electoral analyst/operator. Leadership consumes an executive briefing as a secondary progressive-disclosure layer.
- **Space:** Internal political and electoral analysis.
- **Project type:** Data-dense internal web application and decision-support dashboard.
- **Memorable posture:** A serious electoral situation room: information-rich, clearly hierarchical, fast to operate, and trustworthy.

## Approved Direction

- **Name:** Votus analytical workspace (2026-09-21 redesign)
- **Aesthetic:** Palantir-inspired information organization with Vercel-inspired visual precision: neutral work surfaces, compact typography, explicit context, exact tables, and progressive supporting detail. No vendor branding or assets.
- **Decoration:** Intentional and minimal. Typography, hairline borders, tonal surfaces, and evidence structure do the visual work.
- **Theme:** Support light and dark analytical surfaces. Initialize from the OS preference and provide an in-app selector with a persistent per-user override.
- **Layout:** Grid-disciplined analytical routes with controlled asymmetry on the operational briefing.
- **Brand posture:** Analytically neutral. LLA identity may appear in institutional context but must not become data semantics.
- **Current delivery scope:** Login, shared shell, operational briefing, reactive official comparison and hypothetical simulation. The user accepted the reactive visual direction and requested a quieter header, sidebar-footer controls and automatic return to login when the session ends. Explore, municipal, fiscalización and review remain later route-specific slices.

## Design Principles

1. **Evidence stays beside the figure it qualifies.** Essential source, granularity, refusal/degraded-state, and interpretation-changing qualifiers remain inline. Supporting contextual evidence opens on demand, never as the sole location of essential qualifiers. Comparison uses native provenance disclosures; existing evidence Sheets elsewhere remain unchanged.
2. **Denied is not empty.** Empty, denied, unavailable, truncated, technical error, and loading states share structure but never meaning or disclosure behavior.
3. **Tables are canonical.** Visualizations accelerate interpretation but do not replace exact values or accessible alternatives.
4. **Density follows the task.** Briefing and shell are calm; exploration and comparison are compact; simulation balances controls and technical evidence.
5. **Navigation is visible wayfinding.** Search and command palettes may accelerate navigation but never replace the persistent sidebar.
6. **Official and fiscalización remain unmistakably separate.** They can be juxtaposed but never visually or numerically collapsed into one source.
7. **No decorative dashboard language.** Avoid generic KPI grids, pie charts, gauges, gradients, blobs, oversized radii, and motion without explanatory value.

## Information Architecture

### Global shell

- **Desktop:** Persistent `15rem` sidebar with a bottom workspace/account cluster and a lightweight topbar. Chrome follows the selected light/dark theme.
- **Mobile:** Sidebar becomes a scrollable drawer with the same workspace/account controls. Do not duplicate those controls in the header.
- **Topbar responsibility:** Mobile navigation trigger and authorized review status only.
- **Sidebar responsibility:** Product identity, domain navigation, current-route indication, source-separation reminder, active organization, workspace switch, theme and account actions.
- **Footer behavior:** One bottom-aligned cluster in normal scroll flow, not a fixed overlay. All controls remain reachable on short screens and at 200% zoom. Desktop and mobile share the theme preference; crossing the breakpoint restores focus to a visible control.

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
| Briefing title | `2rem / 1.2` | Operational home; `1.75rem` on mobile |
| Redesigned route title | `2rem / 1.2` | Comparison; login uses `1.5rem` |
| Redesigned section | `1.25rem / 1.3` | Exact comparison results; applied-context headings use `1rem` |
| `h3` | `1rem / 1.3` | Panel and table section |
| `body` | `0.875rem / 1.55` | Primary explanatory copy |
| `small` | `0.75rem / 1.45` | Secondary copy |
| `label` | `0.6875rem / 1.2` | Controls and metadata |
| `micro` | `0.625rem / 1.2` | Compact machine evidence only |

Existing non-redesigned routes retain their route-specific heading scales until their own delivery slice. Body copy never drops below `0.8125rem` for dense analytical surfaces; comparison controls remain at least `0.875rem`.

## Color

### Core palette

The values below describe the light-theme reference. Both themes retain Votus-owned semantic/source/status meanings and must meet the accessibility contract; the preset's neutral palette does not replace them.

| Token | Value | Meaning |
| --- | --- | --- |
| `--shell` | `#FFFFFF` | Theme-consistent sidebar and application chrome |
| `--canvas` | `#FAFAFA` | Neutral analytical background |
| `--surface` | `#FFFFFF` | Primary work surface |
| `--surface-muted` | `#F2F2F2` | Filter bars and secondary groupings |
| `--ink` | `#171717` | Primary text |
| `--muted-ink` | `#646464` | Secondary text; AA on canvas |
| `--border` | `#E2E2E2` | Hairline structure |
| `--accent` | `#333333` | Product action and active navigation |
| `--accent-strong` | `#171717` | Hover/pressed action |

Dark neutrals: canvas `#0A0A0A`, shell/surface `#141414`, secondary surface `#222222`, ink `#EDEDED`, muted ink `#A8A8A8`, border `#383838`, action `#D4D4D4`. Semantic source/status tokens keep their separate accessible dark variants.

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
- **Comparison:** Desktop aligns Side A, Side B, and shared territory in three columns. Applied context precedes a full-width exact table; two evidence sections follow beneath. On mobile, editors, territory, context, chart, exact table, and evidence stack in reading order. Selector changes automatically update the authorized comparison; there is no Apply step. Only supporting archive provenance starts collapsed; source and interpretation-changing notes remain visible.
- **Forms:** Progressive selectors stack into obvious groups while preserving field names, query parameters, focus behavior, and deep links.
- **Simulation:** Fully functional on mobile, while desktop remains the preferred deep-analysis environment. The editor updates its server-calculated result automatically after a short typing pause; charts and exact evidence always refer to the same accepted scenario.
- **Touch targets:** At least `44×44px`.

## Component Architecture

### shadcn/ui foundation

Use a pinned shadcn CLI version and allow only the canonical `@shadcn` registry initially. Source is copied into the repository and becomes project-owned.

**Reviewed baseline (2026-09-18):** Exact preset [`b5aq`](https://ui.shadcn.com/create?preset=b5aq): Nova, Radix, neutral base/theme/chart, Lucide, and IBM Plex Sans. Do not apply it globally. Votus-owned tokens remain authoritative for the semantic/source/status palette, IBM Plex Mono, visible focus, compact density, and low-radius geometry (`3/6/10px`).

Expected primitives:

- Button, Input, Label, Select, Checkbox
- Sheet for mobile navigation and on-demand right-side contextual evidence
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
- Comparison pairs Side A/Side B on one 0–100% scale, retaining each side's party name. Its denominator is the supplied party-vote total, not turnout or all ballots. Include every compared party.
- Simulation seat bars use the requested seats-to-fill denominator, show zero-seat lists and unallocated seats, and distinguish renewed seats from the whole council. Keep hypothetical status and incomplete/tie qualifications visible.
- Horizontal bars support distribution and seat allocation.
- Delta bars/markers support cross-election comparison.
- Time series require a genuine temporal dimension.
- No pie charts, gauges, decorative KPI visualizations, or animated numbers.
- Every chart includes an accessible table or textual equivalent.
- Official and fiscalización can be juxtaposed but cannot share an aggregated series.
- Essential source and interpretation-changing provenance, coverage, exclusion, and granularity qualifiers remain adjacent to the visualization; supporting detail may open in native disclosures or the existing contextual Sheet, depending on the route.

## Motion

- **Approach:** Reactive and functional: control edits cause the meaningful visual change; the interface does not simulate incoming activity.
- **Focal interaction:** Chart marks explain changes in comparison share or scenario allocation. Exact numbers change without counting animations.
- **Continuity:** Soft navigation preserves control focus and scroll. Pending or invalid edits suppress stale figures, evidence and trace until the served selection matches the current request.
- **Budget:** No polling/subscriptions, decorative loops or new motion libraries; short bounded geometry transitions only.
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
- **Impeccable (optional):** Existing Pi-only local skill, v4.3.1, used in Operate mode for this redesign. No new hooks or runtime dependencies. It is not required in a clean checkout and must not install hooks.

### Reference only

- **Vercel design.md:** Use neutral principles for hierarchy, evidence, restraint, responsive design, and reduced motion. Do not ship Vercel logos, Geist, `vbg-*` APIs, hosted brand CSS, or claims of Vercel authorship.

### Selective and deferred

- **beUI:** No persistent hosted MCP initially. Inspect a named registry payload only for a specific complex component.
- **Transitions.dev:** Prefer copied, free, reduced-motion-safe snippets. Do not install Refine/Pro initially.

Every external addition records owner, exact version/commit or registry payload, files written, dependencies, license, reviewed diff, bundle impact, and accessibility evidence.

## Migration and Delivery Strategy

The shadcn migration is complete at base commit `146bacf1dad38b76c54a27ccc38bff5c1fad48c9`. This redesign changes presentation rather than repeating component replacement.

1. Deliver branded login, neutral shared shell, task-first home, and exact-results-first comparison.
2. Incorporate the requested automatic comparison/simulation interactions and truthful charts, then validate the actual revised screens with the user.
3. Redesign the remaining routes in coherent, tested slices, preserving their distinct domain states.
4. Complete whole-product responsive, accessibility, and regression validation.

Track implementation in `odd/tasks/product-ui-redesign.md` and its project-scoped Engram mirror. Use strict TDD against production entry points. Visual previews use actual production components with explicitly fictional adapters and no real session; they do not replace functional browser tests. The authenticated E2E screenshot/trace policy remains off.

Taste's project-local `redesign-existing-projects` skill is pinned to `Leonxlnx/taste-skill@5217fb45be2c0b302f29c9cd31cbd3237501c684`. Its general guidance is subordinate to product truth, accessibility, the operational brief, and the prohibition on invented metrics or decorative effects.

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
- Desktop/mobile visual inspection and functional geometry coverage cover every delivered route; synthetic previews never claim authenticated-data proof.
- Existing suite and redesign tests are green.
- Initial JavaScript grows by no more than `10%` without explicit approval.
- No obsolete presentation path remains in a redesigned route; still-used styles for pending routes are retained.
- This document matches the delivered implementation bytes.

## Decisions Log

| Date | Decision | Rationale |
| --- | --- | --- |
| 2026-09-01 | Situation-room product posture | Make trust, speed, and analytical hierarchy memorable |
| 2026-09-01 | Analyst/operator primary persona | Preserve operator-grade precision over generic executive simplification |
| 2026-09-01 | Command Ledger approved | Best balance of briefing, density, actions, and evidence adjacency |
| 2026-09-01 | Light-first graphite/ivory system (superseded by 2026-09-18 theme decision) | Better long-form reading, screenshots, print, and semantic contrast |
| 2026-09-01 | IBM Plex typography | Technical/institutional identity without Vercel brand convergence |
| 2026-09-01 | Progressive shadcn/Tailwind migration | Route-complete slices with final legacy removal |
| 2026-09-01 | WCAG 2.2 AA blocking gate | Accessibility is production evidence, not later cleanup |
| 2026-09-18 | Keep exact `b5aq` baseline (Nova, Radix, neutral base/theme/chart, Lucide, IBM Plex Sans); no global apply | Preserve Command Ledger's Votus-owned semantic/source/status palette, Mono, focus, compact density, and 3/6/10px geometry |
| 2026-09-18 | Support light and dark themes, initialized from OS preference with an in-app selector and persistent per-user override | Replace the earlier light-first/no-selector restriction with explicit user control |
| 2026-09-18 | On-demand right-side contextual evidence Sheet; essential qualifiers remain inline; migration stays parity-first | Reduce primary-view load without hiding source, granularity, refusal/degraded states, or interpretation-changing evidence; separate behavior changes from component parity |

| 2026-09-21 | Palantir information structure + Vercel neutral precision, retaining Plex and shadcn | User-approved redesign beyond the completed parity migration; validate login/home/comparison before other routes |
| 2026-09-21 | Full-width exact comparison with native supporting-provenance disclosures | Give real tabular evidence space while keeping interpretation-changing context visible; preserve native controls and GET contracts |

## Automatic Interaction Contract

- All source data is queried through the existing authorized server pipeline; automatic UI reactions do not imply incoming realtime data or newly ingested results.
- Comparison preserves six native controls and canonical query keys; changing an ancestor clears its descendants. Soft replace navigation avoids history entries for every control adjustment, with no scroll reset.
- Simulation debounces typing for 350ms, validates the form shape, then reuses the authoritative server allocation, council checks and input trace. There is no duplicate browser allocation pipeline.
- The current draft, pending request and served result must agree before figures appear. Pending/invalid state is explicit, not a faded stale result. Inputs remain usable and focused.
- Reload restores exactly representable editor scenarios. Rich supplied links that cannot round-trip through the editor remain intact in a clearly labelled provided-scenario mode; starting another scenario is explicit and does not silently coerce missing totals or discard held-over/unmodeled data.
- Charts use existing React/CSS/SVG and data contracts; no new runtime chart library. Reduced motion preserves feedback without spatial interpolation.
- Native review approval for the earlier static slice does not approve new interaction bytes. A fresh candidate assessment applies at the revised deliverable boundary.

## Session Continuity Contract

- An already-open protected page verifies session validity on mount, when it becomes visible/focused, and at a bounded 60-second interval while visible. This is an access check, not a realtime electoral-data feed.
- Verified ended authentication or fixed workspace expiration/revocation replaces the page with login, discarding the protected client-router cache. Healthy token renewal remains transparent.
- Temporary connection/service failures and workspace membership/selection states are not evidence of a logged-out session. They must not cause automatic logout.
- The read-only, private/no-store session probe returns status only, using the existing verified workspace boundary without bootstrapping a context or listing organizations. Tokens remain in HttpOnly cookies; database lifetime rules and the explicit signout action remain unchanged.
