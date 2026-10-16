# Program closure audit: 2026-10-14 findings, rechecked on 2026-10-16 (#468)

The 2026-10-14 production audit (desktop and 390 px crawl of 9 routes) opened
Epics A–H (#469–#476) with 43 findings (#425–#467). All 43 were closed when this
audit started. This document is the "after" half: every finding is marked
**fixed** or **deliberately deferred** to a named follow-up issue.

## Evidence

- **Before:** each finding's issue body (its 2026-10-14 reproduction and acceptance
  criteria). The original screenshots were not committed.
- **After:** 26 full-page captures of the develop preview
  (`votus-plataforma-lla-git-develop-…vercel.app`, develop `1e169a2d`, CI run
  38951739425 green 9/9), signed in with the single-organization test account,
  against the hosted database with real data. Captured at 1440 and 390 px:
  - the 9 routes in their default context;
  - four data-bearing states: Panorama, Exploración and Evidencia on
    2025 legislativas · DIPUTADO NACIONAL · 02/027 (mesa level, 10 circuits), and
    Comparación 2023 generales vs 2025 legislativas.

  Captures are local (`/tmp/votus-audit/468`) and contain no personal data.
- **Interactions** (click, hover, keyboard) are judged from each closing PR's
  end-to-end tests, not from static captures.

The default context is 2025 provinciales · CONCEJALES (#605). That election is
stored at section level only, so circuit results there are correctly reported as
unavailable rather than invented.

## Context: why the hosted UI looked far from the design

Before this audit, three hosted problems hid most of the UI behind empty or error
states. They were not design gaps:

| Cause | Effect | Resolution |
| --- | --- | --- |
| Four 2026-10-15 migrations never applied to the hosted database | Context and options failed | Applied 2026-10-16; `db:drift` and the procedure added (#593) |
| `official_facets` exceeded the 8 s statement timeout | "No se pudieron cargar las opciones autorizadas" on most pages | #592: 5–8 s → 0.13–0.22 s |
| Default context required one election per year; 2025 has two | Every page started empty | #605: the election that carries CONCEJALES |

## Verdict per finding

Legend: **Fixed**; **Fixed (e2e)**: interaction proven by the closing PR's
end-to-end test; **Deferred → #n**: the remaining gap is tracked by an open issue.

### Epic A: Workspace access and error states

| # | Finding | After | Verdict |
| --- | --- | --- | --- |
| 425 | Auto-select the only organization | A fresh sign-in on the develop alias lands on Panorama with the organization active (migration 20261015000000, applied 2026-10-16) | Fixed |
| 426 | `selection_required` is its own facets error | No organization shows the selection state, not "denied" | Fixed |
| 427 | Actionable "Seleccioná una organización" on every data page | Shared state present; the selector also appears in the top bar at the same time | Deferred → #599 |
| 428 | Organization identity and selector in the top bar | Top bar shows "Organización activa" with a switch | Fixed |
| 429 | Top-bar review status tells "no organization" from failure | "Seleccioná una organización para ver el estado de revisión" / "Sin elementos pendientes" | Fixed |
| 430 | Intermittent "No se pudieron cargar las opciones autorizadas" | Root cause: facets statement timeout; fixed and applied | Fixed (#592) |
| 431 | Route loading states | `loading.tsx` present for the listed routes | Fixed |
| 432 | One Alert component | All observed refusals and empty states share it | Fixed |

### Epic B: Shared electoral context bar

| # | Finding | After | Verdict |
| --- | --- | --- | --- |
| 433 | One URL contract | All captured routes share the bar's parameters | Fixed |
| 434 | Useful default context | 2025 provinciales · CONCEJALES · 02/027 | Fixed (#605) |
| 435 | Context bar in the shell | On every data route; shown on `/simulate` without effect | Deferred → #613 |
| 436 | Panorama reads and writes the context | Category change updates figures | Fixed (e2e) |
| 437 | Exploración opens on the context territory | Opens on Coronel Rosales results | Fixed |
| 438 | Comparación shared context, A/B naming | "Lado A / Lado B", headings from the elections | Fixed |
| 439 | Municipal year switch kept in refusal states | Switch visible | Fixed |
| 440 | Fiscalización starts from shared territory | Prefilled; explicit opt-in kept | Fixed |
| 441 | One vocabulary for level and body | "Nivel", "Cuerpo a elegir" | Fixed |
| 442 | Workflow links carry the context | "Los enlaces conservan el contexto electoral" | Fixed (e2e) |

### Epic C: Maps that carry data and drive selection

| # | Finding | After | Verdict |
| --- | --- | --- | --- |
| 443 | Shared legend and colour scale | Encodings explained, but no party key, and the Exploración legend overlaps the map | Deferred → #614, #610 |
| 444 | Panorama map by winner and margin | Circuits filled by winner and margin band | Fixed |
| 445 | Clicking a circuit selects it | URL and table selection | Fixed (e2e) |
| 446 | Row hover highlights the circuit | Two-way highlight, keyboard | Fixed (e2e) |
| 447 | Municipal 2025 legend | Legend present (R5 inventory) | Fixed |
| 448 | Clicking a polling place filters establishments | Real-page e2e | Fixed (e2e) |
| 449 | Reference-only maps as locator | Default (section-level) Exploración shows a locator | Fixed |
| 450 | No hashes in the Exploración map card | None in Exploración; Comparación's map card still shows a SHA-256 | Deferred → #615 |

### Epic D: Formatting and labels behind one boundary

| # | Finding | After | Verdict |
| --- | --- | --- | --- |
| 451 | One es-AR number formatter | "33.146", "61,63 %", "40,96 pp" everywhere observed | Fixed |
| 452 | Circuit labels without duplicated code | Code shown once (no circuit names in the source) | Fixed |
| 453 | Human labels from one dictionary | Raw `complete` in Exploración's circuit status; "fiscalizacion" in Evidencia | Deferred → #612 |
| 454 | Granularity warning only on a real difference | No spurious warning in the data states | Fixed |
| 455 | Names first, codes in detail | Upper-case source names and "nombres contradictorios" in headings; provincial names missing | Deferred → #611, #609 |
| 456 | Glossary tooltips | "?" glossary next to the level labels | Fixed |

### Epic E: Panorama and shell simplification

| # | Finding | After | Verdict |
| --- | --- | --- | --- |
| 457 | One "Fuente y límites" disclosure | Single disclosure on Panorama | Fixed |
| 458 | Panorama above the fold: winner, share, margin, map | All four visible above 900 px at 1440 | Fixed |
| 459 | Legal disclaimer out of the rail | Page footer on every route | Fixed |
| 460 | Rail background spans long pages; sub-item icons | Full-height rail, icons present | Fixed |
| 461 | Consistent gutter and title scale | Same container and h1 scale on all routes | Fixed |

### Epics F–H: Mobile, Simulation, First-run verification

| # | Finding | After | Verdict |
| --- | --- | --- | --- |
| 462 | Stack Comparación selectors at narrow widths | One field per row at 390 | Fixed |
| 463 | Every form at 320 and 390 | #463 evidence; `root.spec.ts` geometry at 320/390 | Fixed |
| 464 | Simulación from the official 2025 base | Load option exists; the page opens empty and ignores the context | Deferred → #613 |
| 465 | Escenarios seat chart and difference | Present | Fixed |
| 466 | Link Escenarios and Simulación | "Editar este escenario" | Fixed (e2e) |
| 467 | First-run e2e in the release gate | In the browser lane (8/8, 0 skipped) | Fixed |

**Totals:** 36 fixed, 7 deferred to open issues (#599, #609, #610, #611, #612,
#613, #614, #615).

## Against the approved prototypes

With real data, page structure matches the prototypes. Panorama shows the
headline reading, the circuit map and the circuit table. Exploración shows the
workbench and inspector. Comparación shows A/B with a shared territory.
Evidencia shows the availability reading. The remaining distance is polish and
data-labelling, not layout, and is tracked by:

- the hosted-only gaps above (#610–#615, #609);
- the frontend checklist audit (#594–#603);
- the deviations already accepted in [`r5/current-2196d8f2.md`](r5/current-2196d8f2.md).
