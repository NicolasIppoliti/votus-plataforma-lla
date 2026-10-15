# R5 — evidence is insufficient to close #499, #500 or #501

All 34 supplied PNGs were opened with the image read tool, and all 19 height JSONs were read. **The decisive limitation is capture state:** Comparación and Evidencia have no selected electoral context; Panorama reports its default selection unavailable; Exploración shows reference-only content. Shorter pages are not evidence of improved density when the results are absent. Simulación has a populated, user-supplied scenario. Municipal is rejected/unavailable; Fiscalización remains opt-in and inactive.

This is a **partial visual review**, not an independent-verifier approval. No application changes, test runs, interaction checks, or historical before/after comparisons were performed.

## Pair-generation limitation

Existing tool: `docs/visual-review/pair-desktop.mjs`. It emits SVG, production left, requires R4 input filenames through its manifest CLI and restricts prototype widths to 1276/1424/1600. R5 desktop PNGs are actually 1440 wide on both sides. It is therefore not directly applicable to the requested R5 PNG pairs (including mobile).

The explicitly requested fallback was attempted:

```text
/Users/nicolasmateoippoliti/dev/votus-plataforma-lla/etl/.venv/bin/python -c 'from PIL import Image; print(Image.__version__)'
ModuleNotFoundError: No module named 'PIL'
```

Following “else document”, no dependency was installed and no substitute renderer was introduced. **No pair PNGs were generated, no ≤1.5 MB output-size claim is made, and no same-scale pair was inspected.** The observations below compare the original PNGs opened individually. The image tool scales long screenshots to fit its display; these observations must not be represented as a native-pixel 1:1 audit. Fine typography, subtle clipping and small text remain uncertain.

## Evidence locator and dimensions

Artifact root: `/tmp/votus-r5/art/`. For the five prototype pages, each row below identifies both files under `visual-evidence-r5-R5-<page>-approved-pair-at-<width>px/`: `prototype-<page>-<width>.png` and `production-<page>-<width>.png`. Its adjacent `visual-evidence-r5-heights.json` records the measurements. These temporary source artifacts are not committed by this review.

All viewport heights are 900. Every recorded scroll width equals the requested viewport width. This establishes no document-level horizontal overflow in these states, **not** scrollability of nested tables. All image heights match the recorded full-document heights as reported by the image reader; these are not 900-pixel viewport-only captures.

| Page | Width | Prototype height | Production height | Capture-state verdict |
|---|---:|---:|---:|---|
| panorama | 1440 | 2750 | 2265 | DEVIATION: unavailable selection and preparing map |
| panorama | 390 | 4248 | 2991 | DEVIATION: same; large global controls before content |
| panorama | 320 | 4469 | 3376 | DEVIATION: same; controls stack further |
| exploracion | 1440 | 2146 | 2063 | DEVIATION: reference-only, not populated results |
| exploracion | 390 | 3392 | 3171 | DEVIATION: reference-only, tall control stack |
| exploracion | 320 | 3497 | 3490 | DEVIATION: almost equal height despite missing results |
| comparacion | 1440 | 2571 | 1052 | DEVIATION: no selected pair, maps/inspector/tables absent |
| comparacion | 390 | 4708 | 2126 | DEVIATION: no selected pair, not density evidence |
| comparacion | 320 | 4891 | 2297 | DEVIATION: no selected pair, not density evidence |
| evidencia | 1440 | 2588 | 1037 | DEVIATION: no exact selection, map/units absent |
| evidencia | 390 | 4527 | 2076 | DEVIATION: same; selectors in one column |
| evidencia | 320 | 4926 | 2331 | DEVIATION: same; headline wraps to two lines |
| simulacion | 1440 | 2586 | 3649 | DEVIATION: expanded distribution and extra scenario content |
| simulacion | 390 | 4889 | 5751 | DEVIATION: longer populated scenario |
| simulacion | 320 | 5736 | 6553 | DEVIATION: longer; geography switch below heading |

R5 desktop comparisons have identical 1440-pixel capture widths. The historical R4 native-width warning in #500 must not be falsely attached to these new inputs. R5 is not a reconstruction from the specified `raw/r4-*-1440-full.png` sources.

## Per-element observations

Each subsection explicitly applies to **1440, 390 and 320**, except where a width is singled out. MATCH means a visible shared element, not whole-page parity. PROD-ONLY identifies additions without judging whether they are required product features. DEVIATION can be an evidence-state mismatch rather than a proven implementation defect. Closed disclosure contents and unavailable result states were not inspected.

### Shared shell — all five pages, each width

| Element | Status | Visible evidence |
|---|---|---|
| Header | PROD-ONLY | Organization identity and pending-review link above page content; desktop also organization selector, change action and Cuenta disclosure. Prototype starts directly with the page heading. |
| Navigation | DEVIATION | Desktop production adds Municipal, Escenarios, Revisión de datos and Fiscalización entries, unlike the simpler specimen rail. Mobile menu sits above organization information rather than beside the title. |
| Context bar | PROD-ONLY | Panorama, Exploración, Comparación and Simulación show global election/category/territory/source controls and “Cargando contexto autorizado…”. Evidencia instead has its own page selectors without this global bar. |
| Mobile controls | DEVIATION | At 390 election/category share a row in the global bar; at 320 they stack. Both repeat selected/placeholder text below controls, substantially increasing height. |
| Footer | DEVIATION | Production adds the electoral-source disclaimer; specimens have laboratory/demo footers. Source separation is visibly stated, not verified functionally. |

### Panorama — 1440 / 390 / 320

| Element | Status | Concrete observation |
|---|---|---|
| Headline | MATCH | “Panorama” and its introductory sentence remain recognizable at all three widths. |
| Context/forms | DEVIATION | Specimen has compact design/territory/base/category controls below title. Production global controls precede it, and territory is Coronel Rosales rather than Argentina. |
| Map | DEVIATION | Specimen renders colored national geography. Production shows a small grid with amber “Preparando contorno de referencia…” instead of a resolved outline. Mobile map frame/control area is narrow, but resolved-map clipping cannot be assessed. |
| Main panel layout | DEVIATION | Desktop specimen gives the map most of the width and puts the inspector right; production has narrow territory/map left and broad empty reading panel right. Both stack map then reading on mobile. |
| Inspector | DEVIATION | Specimen shows leader, vote share, margin, totals, coverage and bars. Production shows “La selección oficial predeterminada no está disponible.” None of those metrics can be compared. |
| Interpretation | DEVIATION | Specimen “Lo que se puede leer aquí” explanatory group has no equivalent populated interpretation in this production state. |
| Lower table/forms | DEVIATION | “Elegir dónde profundizar” heading exists, but production has no rows and an unavailability notice instead of search, territory rows and pagination. |
| Disclosures | DEVIATION | Production has closed “Códigos administrativos” and “Fuente y límites”; specimen has its national-framing disclosure and visible legend/provenance. Closed contents unverified. |
| Continuation links | MATCH | Exploration/comparison/simulation/evidence destinations are visible, although production changes wording and wraps links into multiple rows. |
| Lower operational/other scopes | PROD-ONLY | Atención operativa card, review button and separate municipal/fiscalización destinations add substantial lower-page content. |

**Mobile density remains unapproved at both widths:** title/content follows the tall authorization bar. No assertion that the clipped-map item was fixed is possible while the map is preparing.

### Exploración — 1440 / 390 / 320

| Element | Status | Concrete observation |
|---|---|---|
| Headline | MATCH | “Exploración territorial” and “El territorio como punto de partida.” |
| Context/forms | DEVIATION | Production “Elegir territorio” disclosure replaces territory select; election/category are unset. Mobile four controls stack singly, rather than the specimen's compact two-column grid. |
| Mobile summary/navigation | DEVIATION | Specimen has populated compact summary and Mapa/Resultados/Detalle links. Production has selection guidance, no equivalent populated summary. |
| Map | DEVIATION | Specimen renders Argentina with inset and controls. Production shows “Mostrar referencia nacional”, amber optional-map notice, reference/provenance text and exact-selection link; no rendered geography. White-bordered trigger differs from specimen map controls. |
| Desktop panel proportions | DEVIATION | Production map/reference is narrow left with broad empty detail right; specimen has broad map and narrow detail. |
| Inspector/navigator | DEVIATION | Argentina heading persists, but specimen province search/list and totals/distribution are replaced by “No hay un siguiente nivel autorizado disponible” and no figures pending exact selection. |
| Legends/evidence rail | DEVIATION | Production reference-only legend lacks specimen party colors/distribution and visible map evidence link. Geographic-not-electoral warning remains visible. |
| Lower table/form | DEVIATION | Specimen “Ganadores por provincia” search and results table are not present in production's captured state. |
| Lower exact-results disclosure | DEVIATION | Specimen “Los números, sin aproximaciones” disclosure is not shown in production's captured state. |
| Reference cards | PROD-ONLY | Large Argentina and Buenos Aires reference-geography cards plus selection links occupy lower production page. |
| Disclosures | DEVIATION | Production reference provenance disclosure is closed; contents not reviewed. |

At 390 and 320, extra shell/context and single-column controls visibly delay the reference panel. Similar document height at 320 is misleading because production lacks the specimen's populated inspector and tables.

### Comparación — 1440 / 390 / 320

| Element | Status | Concrete observation |
|---|---|---|
| Headline | MATCH | Title and “Dos muestras. El mismo territorio. Una lectura compartida.” |
| Territory/context | DEVIATION | Production adds shared-section selector; territory and elections are unset, unlike populated Buenos Aires / Alianza A specimen. |
| A/B forms | DEVIATION | Production uses year-specific empty prompts, duplicate visible value text and more vertical spacing on mobile. Intercambiar remains between A and B on mobile and centered on desktop. Long selected names are not exercised. |
| Mobile summary/navigation | DEVIATION | Populated compact summary and Mapa/Resultados/Detalle links in specimen are not shown in production. |
| Maps/metric switch | DEVIATION | Both maps and percentage/change/winner controls are absent in captured production state. Cannot check repeated map actions, “Ganadores” wrapping, or shared-control fidelity. |
| Inspector | DEVIATION | Territory navigator, search, comparison percentages and changes shown in specimen are absent in captured production. |
| Exact/change tables | DEVIATION | Neither specimen result table is shown in production. This is a state mismatch, not proof that implementation lacks tables. |
| Disclosures/guidance | PROD-ONLY | “Detalles de la selección”, “Notas de la selección” and “Contexto de comparación aplicada” rows plus “Complete ambas selecciones…” guidance appear instead of the populated workbench. Contents/interactions unverified. |
| Evidence rail | DEVIATION | Specimen map evidence link and comparability explanations cannot be compared in this unselected production state. Global official-source label and disclaimer remain visible. |

**Blocking evidence gap for #499:** mobile production is 2126/2297 px precisely while maps, inspector and tables are not rendered. Do not compare these heights to populated R4 or approved specimens as a successful compactness fix.

### Evidencia — 1440 / 390 / 320

| Element | Status | Concrete observation |
|---|---|---|
| Headline | MATCH | Title and explanatory sentence retained. Production title is one line at 390, two at 320; specimen mobile title wraps at both widths. |
| Context/forms | DEVIATION | Production election/category/district/section empty selectors and static “Oficial · autorizado” replace populated design/territory/base/category/origin controls. Mobile single-column layout is taller than specimen's largely two-column controls; duplicate value text adds height. |
| Selection summary/navigation | DEVIATION | Specimen has selected-territory summary and map/evidence/unit/traceability links; production has selection-required notice instead. |
| Map/legend | DEVIATION | Specimen Coronel Rosales shape and completeness legend absent in captured production state. |
| Inspector | DEVIATION | “Qué respalda este dato”, coverage, votes, traceability action and cases disclosure absent in captured production. |
| Units table/forms | DEVIATION | Specimen “Inspeccionar las unidades”, search/status controls, two rows and per-row limits disclosures absent in production state. |
| Lower explanations | MATCH | Six visible thematic explanations remain: completeness, separated opt-in fiscalización, safe traceability, read-only review, unknown-vs-empty, and sources not certifying coverage. |
| Lower explanation copy/layout | DEVIATION | Completeness copy now describes expected/scrutinized/missing mesas rather than missing denominator; other copy is updated. Desktop is two columns, mobile one, as in specimen; prototype-specific historical caveats are replaced by current product text. |
| Machine label | DEVIATION (evidence gap) | `non_official_source_rows` is not visible, but no selected evidence rows are displayed. Absence here does not prove Spanish translation at a single boundary. |
| Long selected values | DEVIATION (evidence gap) | Only short “Seleccionar” values appear. Neither 390 nor 320 tests truncation of populated long labels. |

### Simulación — 1440 / 390 / 320

| Element | Status | Concrete observation |
|---|---|---|
| Headline | MATCH | “Simulación de escenarios” and explicit hypothetical/not-prediction framing retained. |
| Context/forms | DEVIATION | Production adds persisted-scenario explanation, integer-vote reconstruction over 32.291 votes and official-base load link; specimen has fictional 49.300 base. Production context is text blocks rather than territory/base selectors. |
| Mobile summary/navigation | DEVIATION | Specimen compact scenario summary and Mapa/Escenario/Resultados shortcuts not shown in production. |
| Geography header/switch | DEVIATION | Production uses “Referencia territorial” rather than Coronel Rosales. At 320 **and 390** Base/Escenario are below the explanatory text rather than beside a narrow text column: the reported narrow-column symptom is not visible. Historical before/after evidence is absent. |
| Map | DEVIATION | Production neutral pale gray shape with internal circuit lines, not specimen solid teal territory; its legend describes winners, margin and provisional status rather than specimen four-party color key. It is explicitly reference-only, so electoral equivalence is not asserted. |
| Inspector | DEVIATION | Production one reference explanation and evidence link replace two demo circuit-inspection buttons and specimen method link. |
| Transfer form | MATCH | Donor/recipient selects, quantity, prominent cyan transfer action and reset are present. |
| Transfer form copy/state | DEVIATION | Empty “Seleccione una lista” values, Lista donante/receptora and “Transferir votos” replace populated party values and “Aplicar transferencia”. Functional transfer not exercised. |
| Seat summary | MATCH | Nine seats and a visible colored seat strip. |
| Seat distribution | DEVIATION | Production long eight-list distribution with repeated 9-box strips replaces compact four-list base→scenario rows. This increases mobile length markedly; production 5/2/2 split differs from fictional 4/4/1, not a correctness finding. |
| Disclosures | PROD-ONLY | Sin bancas, Cómo se calcula, Cómo leer la distribución and Editar los datos del escenario appear; contents are closed/unverified. Shared sensitivity/allocation disclosures remain but arrangement differs. |
| Lower exact table | DEVIATION | Eight real-named lists vs four demo rows; desktop table is visibly cut at the right edge of its panel, mobile shows only initial column. Nested horizontal scrolling not verified. |
| Lower scenario/result | PROD-ONLY | Scenario explanation, municipal result, granularity, long hash and allocation section increase page height. At 320 the long hash is hard to assess at reader scale; no exact overflow conclusion. |
| Availability section | DEVIATION | Two current availability items replace the much larger specimen limitation inventory. Lower text differs substantively; no parity claimed. |

### Production-only mobile pages

No approved prototype exists: every element below is **PROD-ONLY**, not MATCH.

| Page/width | Artifact directory | Header/context/headline/forms | Map/table/disclosures and lower content |
|---|---|---|---|
| municipal / 390 | `visual-evidence-r5-R5-prod-06c3a-90px-no-approved-prototype-` | Shared organization header and tall loading context; Municipal (Concejales), official label, two election links. | Rejected-request/unavailable evidence card with retry and configured-election links. No results table/map visible; footer. Height 1205. |
| municipal / 320 | `visual-evidence-r5-R5-prod-51b24-20px-no-approved-prototype-` | Global controls stack; election links break into separate lines. | Same unavailable card, more wrapping; no table/map to test. Height 1423. |
| fiscalizacion / 390 | `visual-evidence-r5-R5-prod-6c573-90px-no-approved-prototype-` | Shared header/loading context; non-official heading; second election/category/district/section form repeats context; section help control. | Opt-in warning and activation button; no activated coverage/results/table/map. Footer. Height 1825. |
| fiscalizacion / 320 | `visual-evidence-r5-R5-prod-e65d9-20px-no-approved-prototype-` | Same repeated form with stacked global controls. | Activation button wraps onto two lines; no activated results or table. Height 1997. |

The official/default global source and explicit fiscalización opt-in are visible. These static inactive/error screenshots cannot establish table-scroll interaction or populated-page density.

## Acceptance criteria — quoted and mapped

Verdicts: **NOT SATISFIED** means the requested deliverable/approval is absent or a visible blocker remains. **NOT VERIFIED** means this artifact cannot decide the criterion. No issue is recommended for closure.

### #499

| Exact AC | Verdict | Evidence |
|---|---|---|
| “1:1 same-scale pairs at 390 and 320 against the approved captures, with per-element notes and an independent verifier with no blocking finding.” | NOT SATISFIED | Per-element raw-image notes above exist; pairs unavailable (Pillow missing); mobile production has no populated comparison. This review finds a blocking evidence-state mismatch, and is not an independent approval. |
| “An e2e assertion that "Seleccionar sección y consultar resultados" leaves the exact-table disclosure **open**. The verifier suggested this; today only focus is asserted.” | NOT VERIFIED | No interaction/test execution or assertion inspection in this documentation-only review; exact-table state cannot be inferred from screenshots lacking the workbench. |
| “`test:e2e:gate` 8/8, 0 skipped.” | NOT VERIFIED | No gate report supplied or executed. Nineteen measurement files do not establish the eight-test gate result. |

### #500

| Exact AC | Verdict | Evidence |
|---|---|---|
| “No segment shows production as absent when the content exists.” | NOT SATISFIED (pairs missing) | Inputs are full-page, not 900px viewport crops; heights above verify that useful prerequisite. No generated pair segments exist to approve. Blank comparison/evidence result states are in the source captures themselves, not introduced by segmentation. |
| “Every lower-section element has a match or deviation note.” | PARTIAL | Visible lower sections of all five full-page images are inventoried above (including production-only additions). Populated comparison/evidence tables and other unavailable states cannot be compared. Native-pixel pair review remains outstanding. |
| “An independent verifier finds no blocking issue.” | NOT SATISFIED | Blocking capture-state mismatch remains; no independent-verifier approval was obtained. |

Additional scoped requirements: R5 full-page source availability is confirmed; R4-specific source reconstruction is not performed; R4 native-width mismatch is not present in these R5 1440-wide inputs. No claim that this R5 report satisfies the exact historical R4 reconstruction request.

### #501 — ACs apply to each of the six items

Exact criteria:

1. “strict TDD where behaviour or labels change;”
2. “1:1 before/after evidence;”
3. “`test:e2e:gate` 8/8, 0 skipped.”

| Item | AC 1 | AC 2 | AC 3 | Visible result / remaining gap |
|---|---|---|---|---|
| Evidencia machine label | NOT VERIFIED | NOT SATISFIED | NOT VERIFIED | Raw key not visible in unselected screen; Spanish boundary not exercised. |
| Evidencia / Comparación mobile select truncation | NOT VERIFIED | NOT SATISFIED | NOT VERIFIED | Long populated values not captured at either width. |
| Simulación 320 geography header | NOT VERIFIED | NOT SATISFIED | NOT VERIFIED | Narrow side-column symptom not visible: switch is below text. This is encouraging current-state evidence, not historical before/after or TDD. |
| Panorama mobile late content / clipped map | NOT VERIFIED | NOT SATISFIED | NOT VERIFIED | Tall pre-content context remains visible at both widths; unresolved map prevents clipping verdict. |
| Exploración mobile delayed map | NOT VERIFIED | NOT SATISFIED | NOT VERIFIED | Tall global and page controls visibly delay reference panel; resolved map/results not captured. |
| Municipal / Fiscalización length and horizontal scrolling | NOT VERIFIED | NOT SATISFIED | NOT VERIFIED | Error/inactive screens do not contain target result tables. No scroll interaction performed. |

Prototype versus production is **not** production-before versus production-after. This artifact has no historical before captures and no recorded RED/GREEN history; it cannot satisfy those ACs for any item.

## Remaining work, in priority order

1. Repair/recapture the authorized selected contexts so Panorama resolves its outline/results, Exploración has populated results, Comparación has the actual paired maps/inspector/tables, and Evidencia has selected rows. Determine capture-state cause separately; screenshots alone do not establish a backend or frontend root cause.
2. Provide a working image renderer (Pillow was unavailable) and generate native-scale equal-height PNG segments, prototype left / production right, clearly labeling actual capture ends. Preserve complete lower content and enforce ≤1.5 MB per output. Inspect every generated segment at native scale.
3. Review mobile shared-shell height, repeated value text, one-column control stacks and extra context against compact specimens. Review Simulación's long per-list distribution and wide table. Required source/authorization messages must not be silently removed.
4. Exercise long selected values, map clipping after load, exact-table-open interaction and nested table horizontal scrolling. For municipal/fiscalización use appropriate authorized populated evidence; default fiscalización captures intentionally do not activate internal data.
5. Attach actual strict-TDD records where applicable, historical before/after captures, the eight-test gate report (8/8, no skipped), and an independent verifier's disposition. Keep all three issues open until their remaining ACs are met.
