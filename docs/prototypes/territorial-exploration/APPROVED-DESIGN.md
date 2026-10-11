# Exploration — approved design reference

**Visual approval:** 2026-09-30. **Status:** frozen, isolated prototype; not production acceptance.
This handoff records the current specimen, not a production implementation plan.
Root: `/Users/nicolasmateoippoliti/.codex/visualizations/2026/09/30/01a0f056-ac70-73c1-9d2e-048373a60494/territorial-exploration-prototype/`.
Paths below are relative to this root. UI copy is neutral Spanish; this handoff is English.
Approved capture: [Rosales / 2025 / Concejales / all groups](./checks/navigator-delivery.png).

## Visual intent and composition

Midnight-navy analytical workspace; geography carries the restrained cyan glow/depth.
Opaque readable inspection panels, not a KPI-card wall. No particles or animated figures.
Reading order: fixed sidebar → header/territorial trail → context filters → map with
right inspector → territorial outcomes table → collapsible exact results → disclaimer.
The inspector orders territory/category → **Navegador territorial** → outcome → votes.
Navigation remains visible when the selected electoral context has no sample.
Other module buttons are disabled in this Exploration specimen.

## Current tokens and type

These are actual CSS variables/selectors, not a newly mandated production token API.

| CSS reference | Exact value | Role |
| --- | --- | --- |
| `--canvas` | `#07111b` | Page canvas |
| `--surface`, `--surface-raised` | `#0d1d2b`, `#122635` | Work surfaces |
| `--rule` | `#284255` | Structural separators |
| `--cyan` / `--a` | `#65e5f2` | Selection, focus / fictional Alianza A |
| `--text`, `--secondary`, `--muted` | `#edf5f7`, `#b9c8d2`, `#91a9b9` | Text hierarchy |
| `--b`, `--c`, `--d` | `#aac0f1`, `#efc58c`, `#769598` | Fictional group colors |
| `.sidebar`, `.map-panel` backgrounds | `#081522`, `#091724` | Quiet rail / map stage |
| `.navigator-child` background / border | `#153242` / `#3a6378` | Discoverable next-level actions |
| Navigator child/parent hover | `#1c4051`, cyan border | Pointer affordance |

Local IBM Plex Sans: weights 400–700, body `14px / 1.5`; headings use weight 500.
Local IBM Plex Mono: 400 and 600; exact numerical emphasis, not all prose.
Base page title: `32px / 1.16`; territory title: `25px / 1.2`.
Base total: Plex Mono `38px / 1.3`, letter-spacing `-2px`; large-screen total 44px.
Navigator title: `15px / 1.4`; child text: `12px / 1.5`; names wrap, never ellipsize.
Font files: `assets/plex-sans.woff2`, `assets/plex-mono.woff2`, `assets/plex-mono-semibold.woff2`.

## Layout and responsive reference

Base main inset: 218px rail plus `32px 34px 0` padding; max-width 2040px.
Workbench: `minmax(0,1fr) 322px`, 1px `#2b4658` border, 9px radius.
Base inspector padding: `22px 23px`; map heading: `20px 23px 0`.
SVG reference frame: `860 × 600`; base displayed map height 500px, stage minimum 490px.

| Width condition | Rail / inspector | Main padding | Displayed map height |
| --- | --- | --- | --- |
| `min-width:1800px` | 218px / 360px | `40px 46px 0` | 600px |
| Base, above 1250px and below 1800px | 218px / 322px | `32px 34px 0` | 500px |
| `max-width:1250px`, above 980px | 190px / 295px | `28px 23px 0` | 500px |
| `max-width:980px`, above 760px | 78px icon rail / 275px | `27px 22px 0` | 480px |
| `max-width:760px`, above 500px | Drawer / stacked inspector | `23px 18px 0` | 430px |
| `max-width:500px`, above 360px | Drawer / stacked inspector | `23px 18px 0` | 370px |
| `max-width:360px` | Drawer / stacked inspector | `18px 12px 0` | 335px |

Mobile keeps map before inspector; the navigator precedes results inside the inspector.
Filters become two columns; the prototype badge moves to its own row at ≤500px.
Navigator child list: max-height 210px, 8px gaps, vertical scroll.
Territorial table viewport: max-height 310px, 280px at ≤760px; table min-width 890px.
Exact table min-width: 590px. Both table viewports are keyboard-focusable and scroll
internally; horizontal table scrolling is intentional, document overflow is not.

## Navigation, focus and motion

- `Abrir <child>` is a native button: minimum height 48px, padding `10px 11px`.
- Direct-parent `Volver` and next-level search: minimum height 44px; wrapped names.
- `Ruta de exploración` exposes ancestors; current item uses `aria-current=location`.
- Child/ancestor/parent navigator actions focus the new `#navigator-title` and use
  instant nearest-block scrolling; heading scroll-margin-top is 24px.
- Search appears for lists of at least ten children (currently 24/135), not two-item
  demo lists. It is independent of the lower table filter and all statistical values.
- Territory transitions reset both searches, next-level list scroll and camera;
  election, category, group selection and exact-results expansion are retained.
- Map child paths use one roving tab stop; arrows wrap, Enter/Space explore.
- Native evidence/drawer dialogs support Escape; selection status is a live status.
- Standard focus: 2px cyan outline, 4px offset; search/table viewport offsets differ.
- Camera controls clamp scale to 80–180% in 20-point steps; reset is 100%.
  User-triggered transform transition: 250ms ease. No pan/pinch gesture is implemented.
- Reduced-motion disables transitions/animations and smooth document scrolling.
  No perpetual or unattended camera motion is part of the approved design.

## Data states and reference boundaries

Winner/share/margin always use all four groups, not the highlighted group or camera.
Positive unique maximum + complete sample + valid reference permits a winner fill.
Tie, partial, missing and zero cases are neutral; partial leadership is provisional.
Missing votes are null: clear figures/bars/exact rows and disable the exact toggle.
Zero votes remain exact zeros; undefined shares/margins display “—”, never division by zero.
Invalid source geometry says **Cartografía observada** and stays neutral independently
of electoral coverage; its fictional exact row remains available.
Loading commits a matching map only after all local assets arrive; latest context is
preserved. Asset failure is explicitly unavailable, with no substitute map/results.
Empty navigator search says **No hay coincidencias**; a mesa says **Fin del recorrido**.

All votes, groups, coverage and deep units are authored fiction: 174 nodes, two years,
24 province/CABA references, 135 PBA references, two circuits/four establishments/eight mesas.
The Rosales Concejales partition totals 49,300 / 48,800; other Council territories lack
samples. Only complete same-context child partitions sum; independent aggregates do
not imply complete coverage. Shares use current totals; 2025 deltas use same-node,
same-category 2023 shares only when both totals are positive and a base exists.
Geography is a separate reference: all 538 CNE features/22 invalid cases retained;
the IGN national polar inset preserves all 1,980 components independently of camera.
No official electoral crosswalk, election-effective boundaries, deep polygons,
school coordinates or mesa areas are established. Deep maps show the labelled ancestor.
See `README.md` for source provenance, fixture vectors and reuse limitations.

## Reuse candidates and remaining limits

Rail/drawer, header/trail, filter row, map-centered frame, readable inspector,
navigator, evidence dialog and exact-table treatment are candidates for visual reuse.
This is not a mandate to extract abstractions or directly promote prototype code.
No application integration, production routing or data/backend plan is approved here.
Unverified: other browsers, physical devices, actual assistive technology, production
performance/security, real-data comparability, official joins, historic boundaries
and publication/reuse permissions. Not every control has a 44px target: mobile map
controls reach 30px and the smallest menu button 34px; approval is not an accessibility
certification. The interpretation guide is non-evaluated design copy, not a model.

## Frozen evidence and fingerprints

Historical actual-entry checks: `node verify-navigator.mjs` 8/8 PASS;
`node verify.mjs` 13/13 PASS; independent P15 adds ten checks and frozen asset verification.
Reports: `checks/navigator-report.json`, `checks/report.json`,
`checks/navigator-independent-report.json`. Local Chromium/mobile emulation only.
Strict TDD remains on; this documentation-only closure uses source/hash/readback checks,
not a manufactured RED. No runtime rerun required; RDD remains disabled/unmanaged.
SHA-256 values below identify the approved bytes, not production/reuse readiness.

| Frozen artifact | SHA-256 |
| --- | --- |
| `index.html` | `177548401cfcfdf62d930f679bef05953f55ea7f7ad2774fd8d88fa266690d23` |
| `prototype.css` | `2291aabb08366c80e18bddbc9f32978c91a16cc909be83951e4cd040610108f3` |
| `prototype.js` | `50a9d2b0d37b8d6c8cf334e0dbbde0a9d3c3e0b53edb6e1b66214a8abc7923d3` |
| `generate-demo-results.mjs` | `e276781dc591a8ba2e44b28c0cb41bd3cfb9aa707437a5260f550e60ba0a45bb` |
| `assets/demo-results.json` | `cf2c1db19469ddf04a12e3ab7cd2eaec954c0290421ada254b8f81eace84040f` |
| `README.md` | `0962c639f7f8dfe919c67e009c3eb3ffbbb01b1f3fb3b01e52c7d8939ab2debc` |
| `assets/reference-paths.json` | `25defac7857e0fcdf0b54a5f22c64cc76e91d949c0615756f49e778ff6844b91` |
| `assets/winner-reference-paths.json` | `a78aaf525c7da8417f652695092b2cf9f631a97fd9d983fbcc044b078b779723` |
| `checks/navigator-delivery.png` | `905e9ac61277524b73b9987c14e4790df413136987dddf6dadc05b3ec84b5098` |
