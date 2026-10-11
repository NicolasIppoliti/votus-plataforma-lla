# Votus Comparison — isolated temporal design study

One local Comparison screen, consistent with the approved Exploration specimen.
Initial context: Buenos Aires, national deputies, A=2023, B=2025, fictional Alianza A.
**Every electoral value, pairing and deep unit is fictional.** Geographic references
are independent source material, not official electoral or historical joins.

## Run and verification

`node serve.mjs` starts the orchestrator-owned loopback preview on an available port.
`node verify.mjs --policy-only` checks the served policy and frozen fixture contract.
`node verify.mjs` drives the actual rendered entry using the project's existing
Chromium/Playwright/axe packages; no install or production build is required. It
writes `checks/report.json`, `desktop.png`, `change.png`, `mesa.png` and mobile
390/320 captures. Server and tests are owned by the orchestrator, not this UI.

Strict TDD was resolved from repository AGENTS.md rule 11. The orchestrator observed
entry HTTP404 and policy HTTP404 RED before these files existed, without deleting
finished code. Policy-only and the nine real-entry checks subsequently passed.
Checks cover exact side arithmetic, all groups, swap, camera synchronization, fixed
scales, blocked states, Council deep traversal, native keyboard/focus, mobile
390/320, axe serious/critical findings, reduced motion and no external requests or
runtime errors. The ninth regression distinguishes truthful valid-reference notices
from genuinely observed source geometry, preserving quantitative valid fills and
neutral observed fills. Its actual-entry RED preceded the scope-aware notice fix.
This is emulated Chromium evidence, not universal accessibility,
physical-device, other-browser or production verification. RDD is disabled/unmanaged.

## Context and calculation

Territory and selected group are shared. Each side retains its independent year and
category through navigation. Swap exchanges both contexts, reversing B−A. Groups
are always the same four fictional IDs `a/b/c/d`, labelled Alianza A/B and Lista C/D.

For each eligible side: `total = a + b + c + d`; selected share is
`selectedVotes / ownSideTotal × 100`. Change is `(ratioB − ratioA) × 100` percentage
points, calculated before display rounding. It is **not** percent growth, turnout,
padrón share or a denominator including blank/invalid/other electoral votes.
Counts use Spanish-Argentina grouping; shares and signed changes use two decimals.
Rounded shares need not total exactly 100.00%.

Only same-category, distinct-year, complete positive pairs with full synthetic
correspondence expose comparison figures and the four-row exact table. The policy
is authored in `assets/comparison-policy.json`, with `kind=synthetic-only` and
`historicalBoundaryStatus=unverified`; an internal ID is not an official crosswalk.

| Pair state | Behavior |
| --- | --- |
| Matched | Both side totals/votes/shares and B−A are visible. |
| Category mismatch or same year | Explain the incompatible context; clear comparison values. |
| Missing or partial | Explain absence/coverage; no zero substitution or prior figures. |
| Zero denominator | Shares/difference undefined; no comparison values. |
| Unmapped | Mendoza illustrates missing fictional D correspondence; the whole pair is blocked. |
| Discontinuous | Jujuy illustrates a discontinuous fictional unit; the pair is blocked. |
| Local input failure | Empty maps/figures and an explicit unavailable state, without substitute data. |

Mendoza/Jujuy are **design scenarios, not findings about real provinces**. Tied full
samples can compare selected-group shares; no unique winner is claimed. Child rows
are evaluated independently and may be eligible while an incomplete parent is not.

## Visual and navigation behavior

The midnight navy/cyan workbench uses local IBM Plex Sans/Mono, an opaque inspector
and restrained reference glow. Desktop retains a quiet sidebar, compact shared/A/B
controls, paired maps and one right detail panel. Mobile stacks A then B and detail,
with a native navigation drawer. Other modules are visibly disabled; Exploration
links to the separately running approved local specimen, without altering it.

**Participación** uses equal SVG frames (`860×600`), synchronized center/zoom and the
same fixed 0–100% selected-group scale. **Cambio** uses one fixed symmetric
−100..100pp map, B−A, with explicit zero. There is no adaptive range; these
relative views are separate from the optional categorical **Ganadores** view. Camera actions never change statistics; geographic navigation resets camera.
Source-observed geometry is neutral even if its independent fictional numbers are
eligible. Textual rows expose both pair state and source quality without color alone.

The right-panel next-level navigator comes before figures, even when data are
missing. Native **Abrir**, ancestor **Ir a** and parent **Volver** actions preserve
both contexts and group, focus the new heading and bring it into view. Wrapped child
buttons are at least 44px high. The 24/135-child lists have bounded scrolling and a
separate name search; two-child deep lists need no search. Lower-table filtering is
independent. Neither search changes denominators, scales, map fills or eligibility.
Both searches reset on territory changes. Map references additionally support
Enter/Space and arrow-key navigation. Dialogs use native focus/Escape behavior.

The 174-node demonstration tree includes country, 24 province references, 135 PBA
references and 14 fictional circuits/establishments/mesas. Only the Rosales family
has the authored Council partition; other Council nodes remain missing. Deep nodes
have **no own location**: both maps retain a labelled Rosales ancestor outline, no
invented circuit polygons, school markers, mesa areas or child geography.

## Comparable-child coverage

A compact summary above the child table counts **all immediate child pairs**, not
only visible search matches. Comparable plus the exclusive exclusion reasons always
reconcile to the total number of children. It reuses the same pair eligibility as
figures and rows: full tied samples remain comparable; invalid reference geometry
is counted numerically and warned separately, never treated as missing votes.
Selected grouping, either search, view and camera do not change these counts.
A terminal node explicitly states **Sin siguiente nivel**, not zero-percent coverage;
loading and input failure expose unavailable text without prior counts or reasons.

`node verify-enhancements.mjs coverage` checks the actual served summary, exclusive
reasons, search/group independence, national blocked states, incompatible contexts
and deep terminal navigation. The orchestrator observed the missing-summary RED
before the C5 source existed; baseline nine checks remain separate regression proof.

## Exact selected-group ranking

The native **Ordenar territorios** selector defaults to largest B−A percentage-point
change first and can reverse the order. It sorts exact unrounded selected-group
changes, not the formatted text or absolute vote counts. Comparable rows precede
excluded rows; exclusions retain their reasons and blank metrics. Equal changes
use Spanish label order, then internal ID, for deterministic ties.

Changing group, either context or swapping A/B recomputes the ranking. Sorting and
name filtering affect only the lower table's presentation, never maps, totals or
whole-child coverage. The chosen order persists through navigation; terminal and
failed-input states disable sorting instead of inventing rows.
`node verify-enhancements.mjs ranking` exercises both orders, groups, swap, retained
excluded rows and search independence after the orchestrator's genuine missing-control RED.

## Secondary absolute vote change

For eligible pairs, a secondary integer difference is `votesB − votesA` for the
selected group. The detail and party/child tables show signed counts such as
`+7.346 votos`, `-2 votos` or `0 votos`, separately labelled from percentage points.
Swap reverses the sign. Blocked or unavailable comparisons clear this value; missing
counts are never replaced by zero. It does not change either side's denominator,
the pp ranking or the relative map scale.

Absolute counts and shares can move in different directions; neither establishes
causal vote transfer, turnout change or a forecast. Exact tables remain within
keyboard-focusable horizontal scroll containers on mobile.
`node verify-enhancements.mjs votes` checks all four groups, party/child cells, swap,
Council/deep navigation and clearing after incompatible contexts, following the
orchestrator's pre-source missing-vote-delta RED.

## Optional categorical winners

**Ganadores** is a third paired view; **Participación** remains the default. Each
eligible side identifies a unique maximum across all four fictional groups,
independent of the highlighted group. Colors reuse Exploration's fixed specimen
palette: A `#65e5f2`, B `#aac0f1`, C `#efc58c`, D `#769598`. The separate legend is
categorical, not a magnitude scale. Map paths carry no quantitative share value in
this view, and accessible labels name the winner or neutral reason.

Ties show **Empate** and neutral contours. Excluded pairs and observed source
geometry receive no winner color; their reasons remain available. The selected
territory's side summaries can show exact fictional winner names even with neutral
reference geometry. Deep units show their own winner text but never paint their
Rosales ancestor as their own electoral area. No fake circuit/school/mesa geography
is introduced. Group highlighting does not filter overall winners.

Both contexts, camera, navigation and selection remain linked. Swap exchanges side
winner labels. Returning to share/change restores quantitative fills and the fixed
scales; all numerical figures continue to describe the highlighted group. A view
click before loading or after input failure does not calculate absent data or
retain old winner claims. This demonstrates synthetic leaders, **not real-party
branding, official party correspondence or historical winner changes**.

`node verify-enhancements.mjs winners` checks 159 reference units, colors/labels,
ties, invalid and blocked neutrality, deep ancestor boundaries, group independence,
swap/camera, return to numeric views, mobile 390/320 and axe. `all` runs all four
accepted enhancements; baseline and policy-only runners remain separate. The root
observed a genuine missing-native-button RED before winner implementation.

## Preserved inputs and provenance

The server allowlists the original Exploration assets read-only at the same origin;
this artifact does not copy, modify or regenerate them. SHA-256 fingerprints:

| Frozen input | SHA-256 |
| --- | --- |
| `demo-results.json` | `cf2c1db19469ddf04a12e3ab7cd2eaec954c0290421ada254b8f81eace84040f` |
| `reference-paths.json` | `25defac7857e0fcdf0b54a5f22c64cc76e91d949c0615756f49e778ff6844b91` |
| `winner-reference-paths.json` | `a78aaf525c7da8417f652695092b2cf9f631a97fd9d983fbcc044b078b779723` |

CNE reference catalog: https://mapa2.electoral.gov.ar/. Source archive SHA-256:
`964af68999504c107c71eaccd8470055f990071eccba09f227e81b6dc31df673`.
All 538 source entities are retained; 22 invalid geometries remain observed, not
repaired or discarded (two PBA references: Adolfo Alsina and Arrecifes). Name-grouped
province references and source GIDs do not establish canonical electoral codes.
Coronel Rosales uses `gid=30556`, Buenos Aires, `Cnel. de Marina L.Rosales`, Punta Alta.

Preserved IGN national source SHA-256:
`ae076881944abd36b79b0a68d14912ca475af95a2c2a9211910ffab81f6ca1e6`;
Buenos Aires source SHA-256:
`314600f9b681841b9f35c27fac030c835de6a95cbf4a0c4256a39df6c069f723`.
The national continental frame does not imply full geographic coverage. Its visible
independent polar reference preserves all 1,980 source components, including islands
and Antarctic extent; it is not electoral coverage and does not zoom with the maps.
Source metadata dates to 2019; election-effective boundaries and reuse/publication
permissions remain unverified. Display precision is not geographic accuracy.
Full extraction/winding/simplification provenance remains in Exploration's frozen README.

## Non-production boundary

The actual application compares official temporal selections on a shared
`distrito/seccion`; its existing map contract is narrower: national deputies in
02/027, 2023 general versus 2025 legislative. This specimen's aggregate and deep
navigation is fictional and does not extend real application coverage.

No application routes, ETL/archive, auth/RLS, database, infrastructure, dependencies,
credentials, external APIs, remote fonts/tiles, personal data or persistence are
changed or consulted. State resets on reload. Historical party/boundary joins,
real data, security, performance, actual assistive technology, production integration
and publishing remain unverified. Comparison visual approval is still pending;
visual approval would not certify any of those production properties.
