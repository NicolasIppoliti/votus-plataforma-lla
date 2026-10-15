# R5 round 2 — populated captures expose remaining fidelity gaps

**Do not close #499, #500 or #501.** All 12 supplied same-scale pair PNGs were opened with the image read tool. Comparación remains substantially denser/longer than the approved specimen; Exploración has populated totals but no resolved circuit map; Panorama resolves its map but still starts late on mobile. Simulación's narrow geography-heading column is no longer visible, but its distribution and lower page remain different. Evidencia has no production capture in this artifact.

Round 1 used `/tmp/votus-r5/art/`, with mostly unselected/unavailable states and no generated pairs. Its short pages were not parity evidence. This round supersedes those observations with `/tmp/votus-r5/art3/`; it does not retroactively establish a before/after implementation test.

## Evidence and limitations

Each reviewed pair is located at:
`/tmp/votus-r5/art3/visual-evidence-r5-R5-<page>-approved-pair-at-<width>px/pair-<page>-<width>.png`.

Reviewed pages: `panorama`, `exploracion`, `comparacion`, `simulacion`; widths: **1440, 390, 320**, all twelve combinations. Prototype is left, production right. Labels state equal CSS-pixel scale; desktop sources are both 1440 wide, not the historical R4 1276/1424/1600 specimens. Full captures have explicit end labels and striped padding after the shorter side; padding is not missing production content. The reader downscales long images to fit: fine typography and exact pixel measurements are not certified here. Heights below come from the adjacent measurement JSONs, not estimates from displayed thumbnails.

This is a static visual audit, not interaction verification, native-review approval, gate execution or implementation/TDD evidence. Different selected geography, fictional parties and synthetic totals are not themselves product defects. Open exact-result sections in these captures cannot establish their default state or prove which action opened them.

| Page | Width | Prototype document height | Production document height |
|---|---:|---:|---:|
| Panorama | 1440 | 2750 | 2736 |
| Panorama | 390 | 4248 | 3915 |
| Panorama | 320 | 4469 | 4383 |
| Exploración | 1440 | 2146 | 4502 |
| Exploración | 390 | 3392 | 6824 |
| Exploración | 320 | 3497 | 7771 |
| Comparación | 1440 | 2571 | 3878 |
| Comparación | 390 | 4708 | 7375 |
| Comparación | 320 | 4891 | 8019 |
| Simulación | 1440 | 2586 | 3612 |
| Simulación | 390 | 4889 | 5714 |
| Simulación | 320 | 5736 | 6517 |

Comparación is about **57% taller at 390 and 64% taller at 320** in these captured states. These specimens differ from the historical heights quoted in #499, so this is not a controlled regression measurement against R4.

## Per-element review

**MATCH** means only the named visible aspect matches. **DEVIATION** includes added/missing content or state differences; uncertain root causes are explicit. **DATA-ONLY** is reserved for differences explained by selected/synthetic content, not layout. Shared-shell rows below apply to each of the four pages at each width, and are part of every page's inventory.

### Shared top bars and footer — all four pages

| Element | 1440 | 390 | 320 |
|---|---|---|---|
| Organization top bar | DEVIATION: added organization/account/actions above or across content | DEVIATION: organization and review status precede title | DEVIATION: same, with more wrapping |
| Global filters | DEVIATION: added election/category/district/section/source bar; on Exploración/Comparación it visibly overlays mid-workbench in the capture | DEVIATION: tall global context before title; election/category share row, territory/source below; selected-value text repeated underneath | DEVIATION: election/category stack separately, plus repeated values, delaying title further |
| Navigation | DEVIATION: extra Municipal, Escenarios, review and fiscalización destinations versus simpler specimen rail | DEVIATION: menu above organization, not inline beside page title | DEVIATION: same ordering difference |
| Source framing | DEVIATION: official/authorization or user-supplied context replaces fictional-demo badge/caution | DEVIATION: same; retain source separation when compacting | DEVIATION: same |
| Footer | DEVIATION: longer official-source disclaimer replaces short laboratory footer | DEVIATION: disclaimer wraps into a substantial block | DEVIATION: further wrapping |

The mid-page bar and visible “Ir al contenido principal” focus link on Exploración/Comparación may be capture/focus/scroll state rather than intended layout. Recapture in a controlled state before assigning an implementation cause; do not approve the obstructed pair as parity.

### Panorama

| Element | 1440 | 390 | 320 |
|---|---|---|---|
| Title/subtitle | MATCH: wording and hierarchy recognizable; shifted down by shell | MATCH: same text, below global controls | MATCH: same, still later start |
| Page filters/summary | DEVIATION: compact below-title prototype controls replaced by above-title global controls | DEVIATION: no compact selected-summary + Mapa/Resultados/Detalle navigation | DEVIATION: same missing compact summary/navigation |
| Territory and values | DATA-ONLY: Coronel Rosales circuits vs Argentina; 11.111 vs fictional national total | DATA-ONLY: same selected-context distinction | DATA-ONLY: same |
| Map | DEVIATION: large local outline fills broad panel; no specimen national grid/inset framing; local geography itself DATA-ONLY | DEVIATION: local outline fills almost all frame width; more verbose stacked legend; no obvious cut outline at this reader scale | DEVIATION: similarly edge-tight, legend wraps further; no definitive clipping verdict at reduced display scale |
| Headline inspector | MATCH: map left, inspector right with leader/share/votes/bars; DEVIATION: large amber completeness box and long unmapped leader replace compact warning | MATCH: inspector follows map; DEVIATION: large amber block and one-column distribution vs compact two-column party bars | MATCH: same ordering; long leader and metric text wrap more |
| Interpretation | DEVIATION: specimen “Lo que se puede leer aquí” three-part explanation missing as a distinct group | DEVIATION: same missing group | DEVIATION: same |
| Search/table | MATCH: search and territory rows; DEVIATION: five-column circuit schema replaces specimen four-column province schema | MATCH: search/table present; DEVIATION: only initial columns visible | DEVIATION: only initial columns and partial next column visible; scrolling unverified |
| Rows/pagination | DATA-ONLY: two synthetic circuits rather than twelve displayed provinces; absent pagination is not alone a defect with two rows | DATA-ONLY: same | DATA-ONLY: same |
| Disclosures | DEVIATION: Códigos administrativos and Fuente y límites replace specimen national framing disclosure/provenance arrangement; closed contents unverified | DEVIATION: same | DEVIATION: same |
| Continuation/lower forms | MATCH: four continuation destinations; DEVIATION: 3+1 desktop arrangement plus added operational-review card and separate municipal/fiscalización links | MATCH: two-column continuation cards; DEVIATION: extra operational and separate-scope blocks | MATCH: two-column cards; DEVIATION: same additions and extra wrapping |

**Summary:** populated map and table are now visible. Similar total height is not parity: fewer data rows offset substantial shell and operational additions. Mobile late-content defect remains; map clipping is not proven fixed.

### Exploración

| Element | 1440 | 390 | 320 |
|---|---|---|---|
| Title/subtitle | MATCH: title and introductory hierarchy | MATCH: same, after tall shell | MATCH: same, later still |
| Page filters/forms | DEVIATION: territory disclosure and exclusion notes replace compact selector row | DEVIATION: all page controls stack singly after duplicated global context, vs compact two-column specimen | DEVIATION: same, with taller notes |
| Compact summary/anchors | DEVIATION: no equivalent specimen mobile summary needed on desktop; added exclusion context instead | DEVIATION: populated summary and Mapa/Resultados/Detalle shortcuts absent | DEVIATION: same |
| Map | DEVIATION: tiny narrow reference grid/amber warning, no resolved circuit outline; broad specimen national map absent | DEVIATION: empty grid/warning and legend in place of resolved specimen geography | DEVIATION: same; even longer warning/legend wrapping |
| Desktop panel balance | DEVIATION: narrow map left, much wider inspector right, opposite specimen balance | MATCH: map before inspector stack | MATCH: same stack |
| Inspector/summary | MATCH: territory, leader, total and distribution present; DATA-ONLY: 14.444 and selected section vs fictional Argentina | MATCH: equivalent summary roles; DEVIATION: more caveat text and long names | MATCH: same with heavier wrapping |
| Territory navigator | DEVIATION: back links/no next authorized level replace searchable province list (selected-level/state difference, not proof of missing implementation) | DEVIATION: same missing list in this state | DEVIATION: same |
| Territorial table/search | DEVIATION: search present but circuit table has headers/no populated rows; specimen province rows visible | DEVIATION: same empty result body; initial columns only | DEVIATION: same; horizontal scroll unverified |
| Exact-results disclosure | DEVIATION: open large section instead of closed compact row; default state unknown | DEVIATION: open scope IDs, distribution and table greatly extend page | DEVIATION: same, more wrapping |
| Lower tables and evidence | DEVIATION: added party table, establishment-unavailable block, reference ID table and provenance | DEVIATION: same; long identifiers, initial table columns visible | DEVIATION: same, very tall identifier cells |
| Lower reference cards | DEVIATION: extra Argentina and Buenos Aires cards after exact results | DEVIATION: two long stacked cards absent from specimen | DEVIATION: same |
| Other disclosures/forms | DEVIATION: legend notes and archive/provenance disclosures; contents not fully inspected; no transfer form in either | DEVIATION: same | DEVIATION: same |

**Summary:** selected totals are populated, but circuit map/table are not. Metadata says `circuitRpcControlled: false`; this is evidence of uncontrolled capture state, not proof of root cause. Open exact results, reference cards and repeated filters account for visible density differences that are not merely synthetic totals.

### Comparación

| Element | 1440 | 390 | 320 |
|---|---|---|---|
| Title/subtitle | MATCH: title and shared-reading subtitle | MATCH: same text after shell | MATCH: same |
| Shared selectors | DEVIATION: added shared-section selector and all-party control rather than compact territory/party row | DEVIATION: global context plus single-column territory/section/party controls | DEVIATION: same, longer wraps; selected section clipped in native select |
| A/B form | MATCH: A/B election/category and swap action; DEVIATION: year-specific labels | DEVIATION: each election/category stacks with duplicated selected-value text; much taller than specimen paired rows | DEVIATION: same; category select truncates; explanatory selected-value text remains below |
| Summary/shortcuts | DEVIATION: reference-only description replaces specimen selected-party headline | DEVIATION: no compact comparison summary or Mapa/Resultados/Detalle shortcuts | DEVIATION: same |
| Metric switch | MATCH: three visible modes; DEVIATION: Participación replaces % de votos label | MATCH: three controls fit at reader scale; exact typography uncertain | MATCH: three controls visible; cannot certify fine “Ganadores” wrapping at this scale |
| Paired maps | MATCH: two maps side by side; DEVIATION: plain local cyan outlines vs detailed specimen choropleths | MATCH: A then B; DEVIATION: each repeats contour disclosure, interactive/select actions, amber notice and exact-results link | MATCH: same repeated controls/notice/link, rather than specimen shared compact map controls |
| Geographic/numeric content | DATA-ONLY: local section, synthetic names, 60→75%, +15 pp rather than specimen province/party totals | DATA-ONLY: same | DATA-ONLY: same |
| Inspector | MATCH: shared territory, A/B shares/votes/change and evidence link; DEVIATION: larger completeness/caveat text, long party selector, no populated child list | MATCH: after both maps; DEVIATION: long selector/text and completeness block extend it | MATCH: same order, denser wraps |
| Change table/search | DEVIATION: specimen populated child-change table + search/order controls replaced by comparability-unavailable warning | DEVIATION: warning card, not populated change rows | DEVIATION: same; unavailable data must not be invented to match specimen |
| Disclosures/context | DEVIATION: added Detalles, Notas, Comparación aplicada, Contexto rows below workbench | DEVIATION: same repeated-context area | DEVIATION: same |
| Exact table/chart | DEVIATION: placed after change warning/context, with added bar chart; specimen compact exact table precedes change table | DEVIATION: open long exact-result block/chart after context, only early table columns visible | DEVIATION: same; very tall wrapped party cells, scroll unverified |
| Evidence rail/lower section | MATCH: evidence access retained; DEVIATION: extra full A/B coverage/reference/provenance cards below exact results | DEVIATION: A/B evidence cards stack at bottom | DEVIATION: same |

**Summary:** the requested selectors → paired maps → inspector order exists, but its compact density does not. Repeated per-map controls, duplicated context and large lower result/evidence blocks remain visible. Exact results are open in the screenshot, not proven opened by “Seleccionar sección y consultar resultados”.

### Simulación

| Element | 1440 | 390 | 320 |
|---|---|---|---|
| Title/headline | MATCH: title and hypothetical/not-prediction framing; DEVIATION: persisted-scenario/reconstructed-vote paragraphs added | MATCH: same, plus long paragraphs before workbench | MATCH: title wraps as specimen; extra paragraphs remain |
| Filters/summary | DEVIATION: static territory/base text and official-base link replace compact specimen selects | DEVIATION: no specimen compact summary/Mapa-Escenario-Resultados shortcuts | DEVIATION: same |
| Geography heading/switch | MATCH: heading left, Base/Escenario right, with readable explanation | DEVIATION: switch below full-width heading/explanation rather than beside it; no narrow side-column symptom | DEVIATION: switch below full-width explanation; reported narrow-column symptom not visible |
| Map/legend | DEVIATION: gray internal circuits and verbose multi-status legend replace solid teal outline/party key; selected geography recognizable | DEVIATION: longer legend below map | DEVIATION: legend wraps heavily; not a data-only layout difference |
| Inspector | DEVIATION: evidence link and reference explanation replace two demo circuit buttons/method link | DEVIATION: same | DEVIATION: same |
| Transfer form | MATCH: donor/recipient, integer quantity, cyan action and reset; DEVIATION: empty selects and changed action copy | MATCH: form follows map/inspection; DEVIATION: repeated selected-value helper text and larger reset area | MATCH: same |
| Nine-seat headline | MATCH: nine-seat strip and total; DATA-ONLY: 5/2/2 instead of fictional 4/4/1 | MATCH: same | MATCH: same |
| Distribution | DEVIATION: eight long per-list nine-box rows, vs compact four-list base→scenario summary | DEVIATION: long distribution extends form panel substantially | DEVIATION: long names wrap further, same repeated strips |
| Exact table | MATCH: base/scenario totals and comparison table; DATA-ONLY: eight lists/32.291 vs four/49.300; DEVIATION: rightmost columns outside visible panel | DEVIATION: only list column visible, specimen shows several early columns | DEVIATION: only list column visible; scrolling not verified |
| Disclosures | MATCH: sensitivity/allocation disclosures; DEVIATION: added Sin bancas, calculation, distribution-reading and scenario-editor rows | DEVIATION: same additions | DEVIATION: same |
| Lower scenario/results | DEVIATION: added current-scenario, municipal result, granularity and long hash block | DEVIATION: long stacked block after table | DEVIATION: hash wraps into many lines |
| Availability/footer-adjacent | DEVIATION: two current availability items vs specimen larger inventory; historical demo copy not required to remain literal | DEVIATION: two stacked current items | DEVIATION: same |

**Summary:** geography header is encouraging current-state evidence for #501, not a controlled before/after proof. Distribution presentation and wide table remain material deviations, not explained solely by having more synthetic rows.

## Failed journeys and unavailable evidence

A scoped search for `**/e2e-facts-r5-*.json` under `/tmp/votus-r5` found **none**. No failure assertion, stack trace or journey fact can therefore be quoted. User reports Evidencia and municipal journeys failed again; that report is not an observed test result in this audit.

- **Evidencia 1440/390/320:** artifact contains only prototype PNG and prototype measurements (2588/4527/4926 px), no production PNG and no pair. Every production element—bars, title, selectors, summary, map, inspector, units table, disclosures, lower explanations and footer—is **unverified**, not MATCH. Machine-label translation and long selected values remain gaps.
- **Municipal:** production PNGs exist, with measurement heights 4740 at 390 and 5323 at 320, `sourceKind: official`. Their presence does not establish journey success; they were not included in the twelve approved pair comparisons. No approved prototype is supplied. Table-scroll behavior remains unverified.
- **Fiscalización:** production PNGs exist, heights 3324/3644 at 390/320, `sourceKind: fiscalizacion`; no approved prototype. These metadata do not demonstrate activation, coverage correctness or horizontal interaction. No parity disposition is made.
- All supplied measurement scroll widths equal their viewport widths. This does **not** prove nested tables can be scrolled or their hidden columns reached.

## Prioritized product deviations to reach the prototype

Preserve text through disclosures and preserve official-source/evidence rails; do not silently remove warnings or fabricate unavailable data.

| Priority | Page / width | Element | Expected → actual / action |
|---|---|---|---|
| P1 | Comparación / 390, 320 | Selector hierarchy | Compact paired controls + selected summary → duplicated global/page controls, single-column A/B rows and repeated values. Consolidate while keeping full selected values accessible. |
| P1 | Comparación / 390, 320 | Map actions | Shared compact controls → repeated interactive/select buttons, notices and exact links on both sides. Fold secondary detail, retain reachable actions. |
| P1 | Comparación / all | Result hierarchy | Compact inspector → exact table → change table → footer → change warning/context → large open chart/table → A/B evidence cards. Restore compact reading order without dropping evidence or pretending child comparability exists. |
| P1 | Exploración / 1440 | Workbench proportions | Broad map / narrow inspector → tiny map / broad inspector. Restore balanced map prominence. |
| P1 | Exploración / 390, 320 | Pre-map controls | Compact two-column filters/summary → repeated shell and single-column page controls with exclusion notes. Fold detail and restore quick navigation. |
| P1 | Panorama / 390, 320 | First substantive content | Inline title/menu and compact controls → organization + tall context before title; map starts much later. Compact shell without hiding source context. |
| P2 | Exploración / all | Lower density | Closed exact-results row → open scope/chart/tables/reference IDs and two extra geography cards. Compare controlled closed/open states; retain details in appropriate disclosures. |
| P2 | Simulación / all | Distribution | Compact base→scenario list summary → repeated nine-seat strips for eight lists. Use compact summary, fold zero-seat/detail rows without dropping them. |
| P2 | Simulación / 390, 320 | Exact table | Several useful early columns visible → essentially list names only. Improve narrow-width column density and verify horizontal access. |
| P2 | Panorama / all | Interpretation and lower navigation | Distinct reading explanation + compact continuation → absent interpretation group, added operational/separate-scope blocks. Reconcile intended product content and placement rather than silently delete it. |
| P2 | Simulación / all | Reference map explanation | Short party legend + concise reference rail → verbose status legend and additional provenance text. Compact/fold secondary explanation while preserving limitations. |
| P2 | Comparación / 390, 320 | Selected values | Readable selections → native selects truncate category/section/long party names; helper text compensates at height cost. Design an accessible compact full-value treatment. |

Separate evidence blockers, not proven product defects: resolve/recapture Exploración circuit geography/rows; obtain Evidencia production captures and failed-journey facts; recapture desktop Exploración/Comparación without bar/focus obstruction; inspect loaded Panorama contour at native scale; verify municipal/fiscalización scrolling. None should be mislabeled DATA-ONLY or assumed fixed.

## Acceptance mapping

### #499 — comparison mobile

| AC | Status | Evidence / remaining gap |
|---|---|---|
| 1:1 pairs at 390/320, per-element notes, independent verifier with no blocking finding | PARTIAL / NOT SATISFIED overall | Both supplied pairs opened and inventoried above. Populated comparison is visible, but density/hierarchy blockers remain (7375/8019 vs 4708/4891). No independent no-blocking disposition established. |
| E2E assertion that “Seleccionar sección y consultar resultados” leaves exact disclosure open | NOT VERIFIED | Open exact results are visible; no assertion inspected or action executed. Screenshot state does not establish causal behavior. |
| `test:e2e:gate` 8/8, 0 skipped | NOT VERIFIED | No gate report supplied or command run. |

### #500 — complete desktop comparisons

| AC | Status | Evidence / remaining gap |
|---|---|---|
| No segment shows production absent when content exists | SATISFIED for four supplied R5 pairs only | All four full-page desktop pairs include lower production content and explicit capture ends; stripe padding is clearly marked. Evidencia pair absent. Historical R4 reconstruction remains unverified. |
| Every lower-section element has match/deviation note | PARTIAL | Four-page lower inventory above covers tables, disclosures, reference/evidence cards, scenario/availability, continuation and footer. Evidencia production missing; no note can establish its parity. |
| Independent verifier finds no blocking issue | NOT SATISFIED | This audit finds blocking fidelity/evidence gaps; no no-blocking approval is claimed. |

Scope caveat: R5 pair labels show 1440 CSS px on both sides. Do not attach the R4 native-width caveat as if these were mismatched widths. Rebuilding specifically from `raw/r4-*-1440-full.png`, equal-height historical segments and R4 native-width annotations are not demonstrated by art3.

### #501 — all three ACs apply to every item

AC1 = strict TDD where behavior/labels change; AC2 = 1:1 before/after evidence; AC3 = gate 8/8, zero skipped.

| Item | Current visual result | AC1 | AC2 | AC3 |
|---|---|---|---|---|
| Evidencia Spanish machine label at single boundary | GAP: production capture absent; boundary not inspected | NOT VERIFIED | NOT SATISFIED | NOT VERIFIED |
| Evidencia / Comparación mobile long selects | Comparación truncation remains visible; Evidencia GAP | NOT VERIFIED | PARTIAL: prototype/current pairs for comparison, not production-before/after; none for evidence | NOT VERIFIED |
| Simulación 320 geography heading/explanation | Narrow side-column symptom not visible; switch below full-width text | NOT VERIFIED | PARTIAL: current pair exists, historical controlled before/after absent | NOT VERIFIED |
| Panorama mobile late content / clipped map | Late content remains; map resolved but precise clipping unresolved | NOT VERIFIED | PARTIAL: current pairs, not controlled before/after | NOT VERIFIED |
| Exploración mobile delayed map | Tall duplicated controls and delayed reference panel remain; unresolved map | NOT VERIFIED | PARTIAL: current pairs, not controlled before/after | NOT VERIFIED |
| Municipal / Fiscalización length and horizontal scrolling | Metadata only assessed here; no approved pairs or scrolling interaction | NOT VERIFIED | NOT SATISFIED | NOT VERIFIED |

No behavior/label code changed in this documentation task, so no meaningful RED/GREEN applies to the report itself. That exception does not waive implementation TDD ACs. Next evidence should include actual gate/test records, populated Evidencia, journey failure facts, controlled focus/disclosure state, long selected values, and horizontal-scroll interactions. Keep all three issues open.
