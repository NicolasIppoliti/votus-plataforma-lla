# R5 current inventory — develop `2196d8f2`

## Evidence and limits

Reviewed all 15 equal-width pair PNGs and all four production-only PNGs from
**release-gates run 38928330948**, head **2196d8f2**. This replaces the current-state
conclusions of `findings.md` (main `7ceb0b0`), not its historical record.

Artifact: `visual-evidence-r5`; local extraction: `/tmp/r5-2196/visual-evidence-r5`.
For each page slug `panorama`, `exploracion`, `comparacion`, `evidencia`, `simulacion`
and width **1440, 390, 320**, the exact relative image locator is:

`visual-evidence-r5-R5-<slug>-approved-pair-at-<width>px/pair-<slug>-<width>.png`.

Adjacent `prototype-<slug>-<width>.png` and `production-<slug>-<width>.png` are the
individual originals. Each pair labels prototype left, production right, 1:1 CSS
scale. End labels/striped padding mark a shorter document, **not missing content**.
Images are external CI artifacts, not committed assets. Retention is 14 days;
retain/download the run before expiry. The additional `mobile-evidence-463` artifact
is available at `/tmp/r5-2196/mobile-evidence-463`; it was not needed for this inventory.

All visual observations below apply to the three widths unless explicitly qualified.
MATCH means the named visible role/aspect matches, not pixel identity. DEVIATION
includes additional official evidence, data/state differences and folded content;
it is not automatically a defect. Closed disclosure contents and interactions cannot
be certified from a PNG. The image reader scales tall captures down: fine typography
and exact pixel-clearance are not asserted.

The parent supplies the green run result and exact log line:
`Browser lane passed: 8 passed, 0 skipped, disposable stack cleaned`.
This documentation task did not independently execute the browser gate or retrieve
its log. PR merge/test history below is supplied task context, not newly reproduced TDD.

## Owner decisions carried forward

- Prior sign-off: Comparación's extra mobile height is intentional while all text
  remains in the DOM; equal-width R5 desktop pairs replace historical R4 reconstruction.
- ODD L4: S6b full-value alternatives accepted (Evidencia disclosure; Comparación
  helper text). Native select ellipsis alone is therefore not a reopened blocker.
- ODD L4: merged PRs plus their tests and green 8/8 CI accepted for historical S4/S7
  evidence. This is not a fabricated RED transcript. Strict TDD still applies to new fixes.
- ODD L4/L5: fix S6e by folding **only the shared global Contexto electoral bar on
  phones on `/drilldown`**. Keep page-local controls as in the prototype; do not
  silently remove text or collapse official/evidence distinctions.

## Shared shell and capture checks

| Element | Current assessment |
|---|---|
| Navigation/account | DEVIATION: authorized organization/review shell and expanded destinations replace minimal specimen shell; mobile menu precedes title. |
| Global context | DEVIATION: additional controls on Panorama, Comparación and Simulación remain tall on phones. Exploración 390/320 instead has a closed **Contexto electoral** summary with selected scope, followed by breadcrumb/title and local controls. Evidencia uses page-level controls. |
| Skip-link/overlay | MATCH: no visible **Ir al contenido principal** artifact in any of the 19 production captures inspected. Desktop Exploración/Comparación no longer have the global bar covering the workbench/lower transition. This is a capture-state conclusion, not removal of the accessible skip link. |
| Source/evidence | MATCH: official labels, unknown-completeness caveats and evidence access remain visible; Simulación explicitly says user-supplied/non-official and not a prediction. |
| Footer | DEVIATION: every production page ends with the longer source-verification disclaimer instead of the compact prototype laboratory footer. |

## Panorama inventory

Evidence: `pair-panorama-{1440,390,320}.png` using the locator above.

| Element | MATCH / DEVIATION against fresh captures |
|---|---|
| Title and summary controls | MATCH: title/subtitle hierarchy. DEVIATION: extra global controls precede title; prototype compact summary/Mapa–Resultados–Detalle anchors not reproduced. |
| Map and legend | DEVIATION: local circuit contour instead of national reference geography; stacked multi-status legend. At 390/320 the complete outer silhouette is inside its frame, with visible surrounding space; no cut edge observed. |
| Inspector | MATCH: leader, share, votes and exact-results link roles. DEVIATION: amber provisional/unknown-completeness warning, unmapped-party explanation instead of fictional distribution. |
| Interpretation group | DEVIATION: no separate three-column “Lo que se puede leer aquí” group; limitations instead occur in inspector and Fuente y límites. Not reported as blank production. |
| Search and results table | MATCH: search, linked territory rows and results table. DEVIATION: two synthetic circuit rows/five-column schema rather than province list; mobile shows initial columns, not all columns simultaneously. |
| Pagination | DEVIATION: specimen pagination not reproduced for two available rows. |
| Administrative codes | DEVIATION: added closed Códigos administrativos disclosure beneath map. Contents not inspected in closed-state image. |
| Source/limits | DEVIATION: closed Fuente y límites row before continuation rather than specimen framing. |
| Continue analysis | MATCH: exploration/comparison/simulation/evidence continuation roles. DEVIATION: desktop 3+1 arrangement; mobile two-column cards; context-preservation notice added. |
| Operational review | DEVIATION: added Atención operativa card, review action and workspace qualification. |
| Separate-scope links | DEVIATION: added municipal and fiscalización links, explicitly separate flows. |

These fresh mobile images are from `2196d8f2`, **after merged #566**; unlike the
old audit, they are not pre-fix screenshots. Extra shell height remains a disclosed
deviation, not proof that the clipping symptom persists.

## Exploración inventory

Evidence: `pair-exploracion-{1440,390,320}.png`.

| Element | MATCH / DEVIATION against fresh captures |
|---|---|
| Heading/local controls | MATCH: title, territory/election/category/grouping roles. DEVIATION: authorized local section and selection/exclusion disclosure. At 390/320 global context is summarized, not a second expanded selector stack; map follows local controls and their closed notes. Local controls still stack more than the specimen's compact paired fields. |
| Map/legend | DEVIATION: unresolved circuit-membership warning/grid, no resolved national specimen map. Warning is explicit; do not invent circuit membership or diagnose a root cause from pixels. Legend and its notes remain present. |
| Inspector/navigation | MATCH: selected territory, leader, total, distribution, before-interpreting access. DEVIATION: long official completeness caveats, back navigation/no next authorized level instead of populated child list. |
| Territorial breakdown/search | MATCH: filter and table framing. DEVIATION: circuit columns with empty result state instead of populated province rows; early columns only on mobile. |
| Exact-results disclosure | MATCH: exact-results access. DEVIATION: open production block versus closed prototype row; scope IDs and authorized section breakdown extend below prototype end. |
| Scope | DEVIATION: added election/category/district/section/circuit/establishment/mesa/level metadata; mobile wraps IDs. |
| Distribution chart/table | DEVIATION: added official authorized vote chart and party/votes/percentage table, visible below scope; not absent production. |
| Establishment breakdown | DEVIATION: explicit unavailable-granularity block with exclusion counts/reasons, not an omitted populated table. |
| Query references | DEVIATION: added authorized electoral reference table, jurisdiction/election/category/scope. Narrow mobile cells wrap; full desktop row visible. |
| Provenance | DEVIATION: added safe-provenance exclusion note and closed Archivo y procedencia. |
| Geographic reference | DEVIATION: closed Referencias geográficas y fuentes row; old audit's visible Argentina/Buenos Aires cards are not independently expanded here. |
| Closing limitations | DEVIATION: official/fiscalización separation and reference-not-certification note before footer. |

S6e's requested fold is visible at **both 390 and 320**. The map's unknown
membership state is unchanged evidence/data limitation, not a new missing-content bug.

## Comparación inventory

Evidence: `pair-comparacion-{1440,390,320}.png`.

| Element | MATCH / DEVIATION against fresh captures |
|---|---|
| Heading/shared selectors | MATCH: title and shared territory/grouping roles. DEVIATION: extra shared section and repeated global scope. |
| A/B selectors | MATCH: election/category/swap roles. DEVIATION: stacked A/B fields on mobile and long native selected labels. Full selected-value helper lines remain visible; accepted alternative under L4/#589. |
| Modes/actions | MATCH: three modes and one shared interactive/select-results action group. DEVIATION: Participación terminology, white-bordered actions, explanatory text. No repeated per-map action groups. |
| Maps/status/reference | MATCH: paired A/B desktop, sequential A/B mobile. DEVIATION: plain synthetic local contour, amber status notices and long geographic reference/hash versus detailed specimen choropleth. |
| Inspector | MATCH: A/B shares/votes/change/evidence. DEVIATION: long synthetic IDs, grouping selector, no populated child navigator and larger completeness rail. |
| Change by territory | DEVIATION: explicit unavailable-comparability warning instead of populated searchable change rows; no fabricated zero/child comparison. |
| Applied context | DEVIATION: consolidated Comparación aplicada / Contexto y límites row below change block. |
| Exact results | MATCH: exact A/B numerical table role. DEVIATION: open Resultados exactos after change block rather than compact table above it; "Gráfico de participación oficial por partido" is the summary of a closed chart disclosure (folded by design in #576; `page.test.tsx` pins default closure), so no bars show in this capture; the bars render once opened (`comparison.spec.ts` opens it before asserting the chart). Mobile table exposes initial columns, wraps synthetic identifiers. |
| Evidence by side | MATCH: evidence access. DEVIATION: added full A/B coverage/exclusions/reference/provenance cards; side by side desktop, stacked mobile; closed provenance contents unverified. |

Extra mobile height remains the explicitly accepted deviation; screenshots alone
do not prove which action opened exact results.

## Evidencia inventory

Evidence: `pair-evidencia-{1440,390,320}.png`.

| Element | MATCH / DEVIATION against fresh captures |
|---|---|
| Heading/selectors | MATCH: heading and selection-before-workbench order. DEVIATION: separate district/section controls and full-selection disclosures; single-column mobile fields versus paired specimen fields. L4 accepts disclosure access despite native truncation. |
| Notices | DEVIATION: official-query and per-reason exclusion notices replace fictional demo warning; Spanish labels, not raw reason keys. |
| Map/legend | MATCH: silhouette, legend and map-before-inspector roles. DEVIATION: neutral unknown completeness with reference qualification, not fabricated full coverage. |
| Inspector | MATCH: evidence/limitation/traceability roles. DEVIATION: longer caveats, unavailable denominator and unknown scrutiny; prototype cases disclosure not visible. |
| Units | DEVIATION: Sin circuito asignado with explicit membership warning and counts instead of searchable fictional two-unit table. No claim of absent production beneath the warning. |
| Sources/exclusions | DEVIATION: added detailed official-source exclusion rail, per reason/count. **Spanish display wording** now visible: fuente no oficial / fuente excluida fiscalización / filas oficiales sin granularidad de mesa. Historical raw machine-code defect not visible. |
| Authorized traceability | MATCH: traceability access. DEVIATION: added archive/provenance and authorized electoral reference disclosures; closed contents unverified. |
| Current-capability explanations | MATCH: all six topics present: completeness, separate opt-in fiscalización, authorized traceability, read-only review, unknown-not-empty, sources-not-certification. DEVIATION: revised official-completeness copy; two-column desktop, stacked mobile. |

## Simulación inventory

Evidence: `pair-simulacion-{1440,390,320}.png`.

| Element | MATCH / DEVIATION against fresh captures |
|---|---|
| Heading/base scope | MATCH: hypothetical/not-prediction role. DEVIATION: persisted scenario and reconstructed votes explanation, static base/territory and official-load link, additional empty global selectors. |
| Geography heading/switch | MATCH: heading/explanation readable above Base/Escenario at 320; no narrow column beside switch. DEVIATION: switch below heading on mobile instead of prototype beside it. |
| Map/inspection | MATCH: reference geography and inspection roles. DEVIATION: gray circuit reference, multi-status legend/provenance and official evidence link instead of demo circuit buttons. |
| Transfer form | MATCH: donor/recipient/integer amount/action/reset roles. DEVIATION: unselected state, larger explanation area and different action wording. |
| Seat impact | MATCH: nine-seat strip and base→scenario rows. DEVIATION: three winning lists/5–2–2 rather than fictional 4–4–1, zero-seat lists folded; calculation and distribution disclosures added. |
| Exact base/scenario table | MATCH: votes/shares/seats comparison and totals. DEVIATION: eight lists, dense boxed cells; mobile long names and early columns visible, later columns offscreen. No inference of lost data from initial table viewport. |
| Scenario editor/sensitivity | MATCH: sensitivity disclosure. DEVIATION: added Editar los datos del escenario row, closed contents unverified. |
| Current scenario | DEVIATION: added holdover warning, municipal PBA result, input granularity and supplied-data hash. These are user-supplied scenario qualifications, not official historical results. |
| Allocation explanation | MATCH: Cómo se asignaron las bancas disclosure role; production below current-scenario block. |
| Availability | MATCH: current capability/limitations role. DEVIATION: two current items (optional historical load/statutory calculation) instead of obsolete longer prototype inventory; not blank production. |
| Review date | DEVIATION: prototype Fecha y alcance de esta revisión disclosure not reproduced as a separate production row. |

## Municipal / Fiscalización — no approved prototype

Production-only locators under the same artifact root:

| Page/width | Directory and image |
|---|---|
| Municipal 390 | `visual-evidence-r5-R5-prod-06c3a-90px-no-approved-prototype-/production-municipal-390.png` |
| Municipal 320 | `visual-evidence-r5-R5-prod-51b24-20px-no-approved-prototype-/production-municipal-320.png` |
| Fiscalización 390 | `visual-evidence-r5-R5-prod-6c573-90px-no-approved-prototype-/production-fiscalizacion-390.png` |
| Fiscalización 320 | `visual-evidence-r5-R5-prod-e65d9-20px-no-approved-prototype-/production-fiscalizacion-320.png` |

Municipal retains official-source heading/context, reference map/actions, exact
results with per-reason exclusions, chart/table, circuit/local map and table,
reference/provenance disclosure and footer. Fiscalización captures explicitly
activate **non-official opt-in**, show 1 observed of 2 denominator units and
not-random warnings, result table, unmapped/exclusion breakdown, archive disclosure
and separate authorized coverage card. They must not be described as official/default
captures or combined with official figures. Both remain long; first table columns
are visible initially at 320 and scroll instructions are present. Static images do
not prove scroll interaction; #578's ArrowRight/last-column assertion is the supplied
interaction evidence.

## Per-spec disposition

| Spec | Documentation verdict | Evidence / remaining boundary |
|---|---|---|
| S1 | Pairs/inventory ready; independent no-blocking disposition pending | All five 390/320 pair locators above; no visible skip-link artifact. This writer does not grant independent acceptance. |
| S4 | Consistent visually; historical evidence accepted by owner | Official labels/evidence rails remain visible; folded Contexto electoral is visible on Exploración. DOM text retention cannot be proven from PNGs. L4 accepts merged tests + green CI for past changes. No app/test code changed here. |
| S5 | Inventory satisfied; independent no-blocking disposition pending | All 15 full-page pairs reviewed through production end; every lower role inventoried above, including added/closed/state-dependent content. Striped padding is not absent production. |
| S6a | Visible symptom resolved | Evidencia all widths: Spanish exclusion wording; #575/#582 supplied implementation/test evidence. Single-boundary implementation not re-audited in this documentation task. |
| S6b | Accepted alternative | Evidencia/Comparación 390/320; full-selection disclosures/helper text, #589 focused reachability checks supplied; L4 accepts native truncation with these alternatives. |
| S6c | Visible symptom resolved | Simulación 320 heading spans width above switch; #571. |
| S6d | Post-fix recapture confirms contour; shell deviation retained | Panorama 390/320 at 2196d8f2 postdate #566; silhouette inside frame. Global controls still delay title relative to prototype; do not assert pixel parity. |
| S6e | Requested fold visible | Exploración 390/320: Contexto electoral summary, page controls then map; #590 and L5. Local form remains visible. |
| S6f | Interaction evidence supplied; length remains explicit | Municipal/Fiscalización 390/320 locators above; #578 ArrowRight and last-column assertions, not a screenshot-only interaction claim. |
| S7 | Historical evidence accepted under L4; no new behavior | Supplied merged PRs/tests, L6 RED→GREEN for #589/#590, run 38928330948 8 passed/0 skipped. Fresh same-scale prototype/current evidence exists; controlled historical production before/after for every past item is **not** newly established. |

## Findings and handoff

No new product defect conclusively identified in this static pass. Existing
non-blocking/documented differences include long global controls outside Exploración,
unknown circuit membership, wrapped synthetic IDs and initially offscreen table
columns. Comparación's chart shows only its summary because the chart disclosure is
closed by default (#576); this is the designed state, not a missing chart. Do not silently convert these capture
limitations into proof of full parity.

New documentation correction: README's earlier blanket “official/default” statement
for Fiscalización did not match these opt-in images; corrected in the current docs.

Independent verification and issue closure remain parent-owned. No new app fix, new
TDD claim, issue closure, push or PR is part of this documentation update.
