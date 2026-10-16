# R5 final visual review — main `7ceb0b0`

**Do not close #499, #500 or #501 on this evidence alone.** The full-page evidence is now available for all five pages, including Evidencia. Comparación's repeated per-map actions have been consolidated and Simulación's compact distribution is visibly improved. Nevertheless, mobile density, obstructed desktop captures, and a raw Evidencia exclusion code remain. Static images do not establish interaction assertions, strict TDD, or the required gate result.

## Human sign-off (2026-10-16)

Owner decisions (verbatim):

1. #499 Comparación mobile height difference (6388 vs 4708 px at 390; 6905 vs 4891 at 320) accepted as intentional deviation — all text stays in the DOM;
2. #500 R5 equal-width 1440 pairs accepted as replacement for the historical R4 reconstruction.

These decisions supersede the historical requests for human sign-off on those two points below; they do not establish the remaining interaction, gate, or independent-verification criteria.

The verifier reported these production document heights for main `1d1e8c6` (CSS px). This is a later baseline than the historical `7ceb0b0` inventory below, not a measurement from the capture fix.

| Page | 1440 | 390 | 320 |
|---|---:|---:|---:|
| Panorama | 2736 | 3915 | 4383 |
| Exploración | 3891 | 5776 | 6460 |
| Comparación | 3371 | 6388 | 6905 |
| Evidencia | 3253 | 5590 | 6014 |
| Simulación | 3320 | 5681 | 6447 |

The independent verifier found the desktop `pair-exploracion-1440.png` and `pair-comparacion-1440.png` obstructed by the sticky global context bar, with focus-ring/skip-link artifacts remaining. The R5 spec now normalizes sticky/fixed positioning and blurs the active element before each full-page production capture, without changing production components or other specs. Clean replacement images still require the CI-only e2e lane; that lane was not run locally.

## Evidence, method and history

Reviewed the issue bodies using `gh issue view 499`, `gh issue view 500`, and `gh issue view 501`. Read the previous findings from the parent-prepared clean origin/main checkout. Parent reports fixes merged through PRs 571–573; merge status is context, not proof of visual acceptance.

Opened **all 15 pair PNGs and all four production-only municipal/fiscalización PNGs with the read tool**, and read all 19 adjacent height JSONs under `/tmp/votus-ci/r5main`.

- Pair locator: `visual-evidence-r5-R5-<page>-approved-pair-at-<width>px/pair-<page>-<width>.png`, for panorama/exploracion/comparacion/evidencia/simulacion × 1440/390/320.
- Production-only directories: `visual-evidence-r5-R5-prod-06c3a-90px-no-approved-prototype-` (municipal 390), `prod-51b24-20px-no-approved-prototype-` (municipal 320), `prod-6c573-90px-no-approved-prototype-` (fiscalización 390), `prod-e65d9-20px-no-approved-prototype-` (fiscalización 320); each name has the same `visual-evidence-r5-R5-` prefix.
- Prototype is left, production right, labelled 1:1 CSS-pixel scale. Both sides' measured widths are 1440, 390 or 320 respectively. These are **not** R4's historical 1276/1424/1600-native-width desktop specimens. The R4 width caveat applies to those historical pairs, not these equal-width R5 pairs.
- Full-page end labels and striped padding identify the shorter side. Padding is not absent application content. The reader downscales tall images; exact typography, pixel spacing and ambiguous contour edges need native-scale inspection, not invented precision.
- Every JSON says synthetic. Only Panorama reports `circuitRpcControlled: true`; the other paired pages report false. Unresolved circuit state is a capture limitation, not a demonstrated implementation root cause.
- No implementation code, e2e assertion, CI test report, or horizontal-scroll interaction was inspected/executed. An open disclosure in a screenshot proves state only, not which action opened it or its default state.

**History:** Round 1 (`/tmp/votus-r5/art/`) largely captured unselected/unavailable states and had no generated pairs; short heights were not parity. Round 2 (`/tmp/votus-r5/art3/`) inspected twelve populated pairs, but lacked Evidencia production; found repeated comparison actions, long exploration controls, delayed Panorama, and verbose simulation distribution. This final round supersedes current-state observations, not the historical absence of controlled production-before/after or TDD records.

## Heights — document CSS px, from JSON

Heights exclude pair headers/end labels/padding. Different data, disclosure state and scope prevent treating total height alone as fidelity or a controlled regression test.

| Page | Width | Prototype | Production | Production − prototype |
|---|---:|---:|---:|---:|
| Panorama | 1440 | 2750 | 2736 | −14 |
| Panorama | 390 | 4248 | 3915 | −333 |
| Panorama | 320 | 4469 | 4383 | −86 |
| Exploración | 1440 | 2146 | 4440 | +2294 |
| Exploración | 390 | 3392 | 6711 | +3319 |
| Exploración | 320 | 3497 | 7641 | +4144 |
| Comparación | 1440 | 2571 | 3709 | +1138 |
| Comparación | 390 | 4708 | 6923 | +2215 |
| Comparación | 320 | 4891 | 7553 | +2662 |
| Evidencia | 1440 | 2588 | 3253 | +665 |
| Evidencia | 390 | 4527 | 5615 | +1088 |
| Evidencia | 320 | 4926 | 6014 | +1088 |
| Simulación | 1440 | 2586 | 3320 | +734 |
| Simulación | 390 | 4889 | 5681 | +792 |
| Simulación | 320 | 5736 | 6447 | +711 |
| Municipal | 390 | Not supplied | 4740 | Not comparable |
| Municipal | 320 | Not supplied | 5323 | Not comparable |
| Fiscalización | 390 | Not supplied | 3324 | Not comparable |
| Fiscalización | 320 | Not supplied | 3644 | Not comparable |

Comparison remains about **47% taller at 390 and 54% taller at 320**. Versus round 2's recorded production heights, it is 452/466 px shorter, exploration 113/130 px shorter, and simulation 33/70 px shorter at 390/320. These are descriptive cross-round differences, not controlled causal before/after tests.

## Element inventory

**MATCH** certifies only the named visible aspect, not complete parity. **DEVIATION** includes added content and capture/state differences, not automatically a product bug. **DATA-ONLY** is reserved for synthetic content differences, not a blanket excuse for geometry/layout. Shared rows apply to every paired page/width below.

### Shared shell — all five pages

| Element | 1440 | 390 | 320 |
|---|---|---|---|
| Top bars/navigation | DEVIATION: organization/account/review bar and expanded destination rail versus minimal specimen shell | DEVIATION: menu, organization and review status precede page title | DEVIATION: same, with more wrapping |
| Global selectors | DEVIATION: extra global election/category/territory/source controls on Panorama, Exploración, Comparación and Simulación; Evidencia uses page controls | DEVIATION: tall global context and repeated selected-value helpers on those four pages | DEVIATION: election/category stack and increase delay further |
| Capture obstruction | DEVIATION: Exploración global bar overlays workbench/table transition; Comparación bar obscures upper workbench; focus link also visible | DEVIATION: focus link appears inside Exploración/Comparación reading flow | DEVIATION: same focus artifact; cause not established |
| Source label | DEVIATION: official/authorized or user-supplied warning replaces prototype demo badge; distinction must remain | DEVIATION: same semantic distinction, larger framing | DEVIATION: same with more wraps |
| Footer | DEVIATION: long source-verification disclaimer instead of compact laboratory footer | DEVIATION: substantial wrapped disclaimer | DEVIATION: further wrapping |

### Panorama

| Element | 1440 | 390 | 320 |
|---|---|---|---|
| Headline | MATCH: title/subtitle hierarchy; DEVIATION: below extra shell | MATCH: wording; DEVIATION: late start | MATCH: wording; DEVIATION: later start |
| Selectors/summary | DEVIATION: above-title global controls replace compact below-title row | DEVIATION: compact selected summary and Mapa/Resultados/Detalle anchors absent | DEVIATION: same |
| Map | DEVIATION: broad local circuit outline and verbose status legend versus national grid/inset | DEVIATION: edge-tight local map, long stacked legend; no definitive cut edge at reader scale | DEVIATION: same, more legend wraps; clipping fix cannot be certified |
| Geographic/numeric content | DATA-ONLY: local circuits and 11.111 versus fictional national totals | DATA-ONLY: same | DATA-ONLY: same |
| Inspector | MATCH: leader/share/votes/distribution on right; DEVIATION: large amber completeness box, long unmapped leader | MATCH: follows map; DEVIATION: large warning and single-column distribution | MATCH: same; long leader wraps further |
| Interpretation | DEVIATION: distinct three-part “Lo que se puede leer aquí” group absent | DEVIATION: same | DEVIATION: same |
| Search/table | MATCH: territory search and populated rows; DEVIATION: five-column circuit schema versus province schema | MATCH: search/rows; DEVIATION: only early columns visible | DEVIATION: early columns/partial next column; scroll unverified |
| Rows/pagination | DATA-ONLY: two circuits rather than twelve displayed provinces; pagination unnecessary for two rows | DATA-ONLY: same | DATA-ONLY: same |
| Disclosures | DEVIATION: Códigos administrativos and Fuente y límites replace specimen framing arrangement; closed contents unverified | DEVIATION: same | DEVIATION: same |
| Lower navigation/cards | MATCH: four continuation roles; DEVIATION: 3+1 arrangement plus operational review and separate municipal/fiscalización links | MATCH: two-column continuation; DEVIATION: added operational/separate-scope sections | MATCH: same roles; DEVIATION: extra sections and wraps |

Similar total height does not resolve late first content: fewer table rows offset added shell/lower content.

### Exploración

| Element | 1440 | 390 | 320 |
|---|---|---|---|
| Headline | MATCH: title/subtitle; DEVIATION: shifted below extra shell | MATCH: title/subtitle; DEVIATION: delayed | MATCH: same, longer delay |
| Selectors | DEVIATION: territory disclosure and selection/exclusion notes versus compact specimen row | DEVIATION: stacked page controls repeat global scope; compact summary/anchors absent | DEVIATION: same with taller wraps |
| Map/panel proportions | DEVIATION: narrow grid/warning, broad inspector; no resolved circuit outline, unlike broad specimen map | DEVIATION: warning/grid before inspector, not resolved specimen geography | DEVIATION: same |
| Inspector | MATCH: selected territory, leader, total, distribution; DEVIATION: larger caveats | MATCH: same roles after map; DEVIATION: longer caveats/names | MATCH: roles; DEVIATION: additional wrapping |
| Values | DATA-ONLY: 14.444/local section/real party label versus fictional national sample | DATA-ONLY: same | DATA-ONLY: same |
| Navigator | DEVIATION: back links/no next authorized level versus searchable child list; scope/state differs | DEVIATION: same | DEVIATION: same |
| Territorial table/search | MATCH: search and table framing; DEVIATION: circuit headers, no populated circuit rows | DEVIATION: empty table, early columns only | DEVIATION: same, scroll unverified |
| Exact disclosure | DEVIATION: open scope IDs, chart and table versus closed specimen row; default unknown | DEVIATION: large open block extends page | DEVIATION: same with more ID wrapping |
| Lower results/reference | DEVIATION: added distribution table, unavailable-establishment block, reference ID table and provenance disclosure | DEVIATION: same, narrow tables and wrapped identifiers | DEVIATION: same, still taller identifier cells |
| Geographic reference cards | DEVIATION: extra Argentina/Buenos Aires explanation cards | DEVIATION: stacked long cards | DEVIATION: same |
| Other disclosures | DEVIATION: selection/exclusion, legend and archive notes added; closed contents unverified | DEVIATION: same | DEVIATION: same |

The small height improvement does not establish compact approved density. Uncontrolled circuit data and focus/overlay state need clean recapture before causal diagnosis.

### Comparación

| Element | 1440 | 390 | 320 |
|---|---|---|---|
| Headline | MATCH: comparison title/subtitle | MATCH: same; DEVIATION: below tall shell | MATCH: same; DEVIATION: delayed |
| Shared selectors | DEVIATION: added shared section and all-party field | DEVIATION: repeated global/page territory and section; no compact summary/anchors | DEVIATION: same; long native values clipped |
| A/B selectors | MATCH: election/category/swap roles; DEVIATION: year-specific labels | DEVIATION: single-column A/B fields with repeated helpers versus paired compact rows | DEVIATION: same; category values truncated in native controls |
| Metric/actions | MATCH: three modes; DEVIATION: Participación copy; upper area partially obstructed | MATCH: three mode controls; improved single shared interactive/select actions; DEVIATION: white-bordered controls and extra explanation remain | MATCH: shared actions visible; DEVIATION: action text wraps; fine Ganadores typography not certified |
| Maps | MATCH: A/B side by side; DEVIATION: plain local cyan contours, no detailed choropleth | MATCH: A then B; per-map action repetition removed; DEVIATION: shared amber A/B notices and long reference hash/context | MATCH: same; notices and hash wrap more |
| Data | DATA-ONLY: local section, synthetic party IDs, 60→75%, +15 pp versus specimen province/party totals | DATA-ONLY: same | DATA-ONLY: same |
| Inspector | MATCH: territory/A/B shares/votes/change/evidence; DEVIATION: no populated child navigator, long selector/completeness rail | MATCH: after maps; DEVIATION: long caveats/selector | MATCH: same; long names wrap |
| Change table | DEVIATION: unavailable-comparability warning replaces populated searchable change rows; must not invent data | DEVIATION: same | DEVIATION: same |
| Context/disclosures | DEVIATION: consolidated Comparación aplicada/Contexto y límites row remains below change block | DEVIATION: same; less duplicated than round 2 | DEVIATION: same |
| Exact results/chart | DEVIATION: open chart/table after change block rather than compact table before change table | DEVIATION: large open chart/table; early columns only | DEVIATION: wrapped synthetic IDs and early columns only; scrolling unverified |
| Lower evidence | MATCH: evidence access retained; DEVIATION: extra full A/B coverage/reference/provenance cards | DEVIATION: A/B cards stack below exact results | DEVIATION: same |

The selectors → paired maps → inspector ordering exists, but the requested compact density remains visibly unmet. Open exact results do not prove the select-results action opens the disclosure.

### Evidencia

| Element | 1440 | 390 | 320 |
|---|---|---|---|
| Headline | MATCH: title/subtitle hierarchy | MATCH: title/subtitle | MATCH: title wraps across lines, readable |
| Selectors | MATCH: selection controls above workbench; DEVIATION: separate district/section and full-selection disclosures | DEVIATION: full-width single-column controls versus compact paired specimen controls; full-selection disclosures added | DEVIATION: same; native section value clips, full value available only if helper/disclosure treatment works |
| Notices/summary | DEVIATION: three added exclusion/official-query notes replace demo warning | DEVIATION: notes before map, compact summary/anchors absent | DEVIATION: same |
| Map/legend | MATCH: geographic silhouette and map-before-inspector roles; DEVIATION: neutral unknown-completeness map, three stacked keys | MATCH: silhouette; DEVIATION: taller explanatory legend/unknown state | MATCH: same |
| Availability/data | DATA-ONLY: unknown official completeness versus complete synthetic sample; do not manufacture denominators | DATA-ONLY: same | DATA-ONLY: same |
| Inspector | MATCH: evidence/limitations/traceability roles; DEVIATION: much longer caveats, no available denominator, no specimen cases disclosure visible | MATCH: follows map; DEVIATION: long limitation rail | MATCH: same, further wraps |
| Units/table | DEVIATION: “Sin circuito asignado” and unknown-membership warning replace searchable two-row units table | DEVIATION: no comparable search/table in this state | DEVIATION: same; not proof of missing implementation in other states |
| Sources/exclusions | DEVIATION: added detailed exclusion rail; raw `non_official_source` and `official_rows_without_mesa_granularity` visible | DEVIATION: same machine codes wrap in prose | DEVIATION: same |
| Disclosures | MATCH: traceability access; DEVIATION: archive/provenance and authorized electoral reference disclosures; contents unverified | DEVIATION: same arrangement | DEVIATION: same |
| Lower explanations | MATCH: six “Lo que Votus permite hoy” topics/two-column desktop grouping; DEVIATION: revised official-completeness copy | MATCH: six topics stacked; DEVIATION: revised copy | MATCH: same; DEVIATION: longer wraps |

The exact old string `non_official_source_rows` is not visibly established here; the current raw `non_official_source` still violates the intended Spanish display-label outcome. Screenshots cannot establish a single normalization boundary.

### Simulación

| Element | 1440 | 390 | 320 |
|---|---|---|---|
| Headline/context | MATCH: hypothetical/not-prediction role; DEVIATION: added persisted-scenario/reconstructed-vote paragraphs | MATCH: title role; DEVIATION: long pre-workbench context | MATCH: title wraps; DEVIATION: same extra context |
| Selectors/summary | DEVIATION: static base/territory and official-load link replace compact selects; extra empty global fields | DEVIATION: no compact summary/anchors, added global controls | DEVIATION: same |
| Geography heading/switch | MATCH: readable heading and Base/Escenario roles | MATCH: full-width heading/explanation; DEVIATION: switch underneath, not specimen beside heading | MATCH: full-width explanation above switch; narrow side-column defect not visible |
| Map/legend | DEVIATION: gray circuit map and multi-status explanation versus solid teal/party key | DEVIATION: long legend/provenance below map | DEVIATION: same with heavier wraps |
| Inspector | MATCH: inspection role; DEVIATION: evidence link/caveat replace demo circuit buttons/method rail | DEVIATION: same | DEVIATION: same |
| Transfer form | MATCH: donor/recipient/integer transfer/cyan action/reset; DEVIATION: empty selection state and copy | MATCH: follows map; DEVIATION: larger explanation/reset area | MATCH: same |
| Seats/distribution | MATCH: nine-seat strip, compact base→scenario rows; improved from repeated per-list strips | MATCH: compact three winning rows; zero-seat lists folded | MATCH: same |
| Data | DATA-ONLY: 5/2/2, eight lists, 32.291 versus fictional 4/4/1, four lists, 49.300 | DATA-ONLY: same | DATA-ONLY: same |
| Exact table | MATCH: base/scenario votes/percent/seats; DEVIATION: dense boxed table versus specimen sparse rows | DEVIATION: names and early vote columns visible, later fields offscreen | DEVIATION: extremely wrapped list names and early columns only; scrolling unverified |
| Disclosures | MATCH: sensitivity/allocation; DEVIATION: additional zero-seat, calculation, distribution and scenario-editor rows | DEVIATION: same additions | DEVIATION: same |
| Lower result | DEVIATION: added current-scenario/holdover/municipal result/granularity/hash block | DEVIATION: long stacked block | DEVIATION: hash/paragraph wraps extend it |
| Availability | DEVIATION: two current availability items versus longer prototype inventory; literal obsolete demo copy need not be preserved | DEVIATION: two stacked items | DEVIATION: same |

### Municipal and Fiscalización — production-only inspection

No approved prototype exists in this artifact. Consequently **no MATCH or DATA-ONLY comparison can be asserted** for either page; DEVIATION below means the observed limitation, not a measured prototype mismatch.

| Page / element | 390 | 320 |
|---|---|---|
| Municipal top bars/selectors/headline | DEVIATION: tall shared shell before Coronel Rosales title; official label visible | DEVIATION: more stacking; section native value truncates |
| Municipal map/inspector/context | DEVIATION: context card, contour, repeated interactive/select controls, notice and exact link form a long reference block; no comparative inspector specimen | DEVIATION: same, more wrapping |
| Municipal exact table/chart | DEVIATION: only party column visible initially; horizontal-scroll instruction present, interaction unverified | DEVIATION: same |
| Municipal circuit/local map/table | DEVIATION: map/legend and long location text, initial table columns and partial address visible | DEVIATION: circuit/local columns visible; addresses beyond viewport, scrolling unverified |
| Municipal disclosures/footer | DEVIATION: codes, geographic archive and provenance disclosures; closed contents unknown; long footer | DEVIATION: same plus long wrapped archive hashes |
| Fiscalización bars/selectors/headline | DEVIATION: global scope repeated in page form; non-official/opt-in framing clearly visible | DEVIATION: long native labels truncate, helpers wrap |
| Fiscalización map/inspector | DEVIATION: no geographic map; evidence coverage card/bar is the substantive inspector, explicitly 1 observed of 2 and not random | DEVIATION: same; no prototype for comparison |
| Fiscalización result table | DEVIATION: initial party/list/partial next field visible, horizontal instruction present; raw exclusion code below | DEVIATION: essentially first two columns visible; scrolling unverified |
| Fiscalización lower disclosures/footer | DEVIATION: archive disclosure then separate authorized coverage card and long footer | DEVIATION: same, longer wraps |

Page-level scroll widths equal viewport widths in all JSONs. That does **not** demonstrate that nested tables can scroll or that hidden columns are reachable.

## Remaining deviations, ranked

| Priority | Finding | Evidence / next step |
|---|---|---|
| P1 | Comparación mobile still not compact approved hierarchy/density | 6923/7553 versus 4708/4891; repeated scope controls, long inspector and open lower chart/table/evidence. Keep official labels/text, fold secondary detail; obtain controlled closed/open captures. |
| P1 | Exploración mobile delayed map and unresolved geography | Stacked duplicate controls; 6711/7641 versus 3392/3497; grid warning/empty circuit table. Resolve capture state and recapture before assigning data root cause. |
| P1 evidence | Desktop Exploración/Comparación obscured by global bar/focus state | Full pages exist, but part of workbench is covered. Clean recapture needed for unqualified lower-element verification. |
| P2 | Evidencia still exposes raw machine reason codes | Current sources/exclusions rail shows `non_official_source`; establish Spanish display boundary, preserving exclusion counts/reasons. |
| P2 | Panorama mobile substantive content still late; contour clipping not conclusively cleared | Extra global controls before title; map edge-tight. Native-scale contour verification required, not a parity claim from total height. |
| P2 | Long mobile selections and wide tables | Comparison native values truncate; evidence native selection has separate full-value disclosure. Verify access and horizontal scroll, especially municipal/fiscalización at 320. |
| P2 | Simulación remains longer despite improved heading/distribution | Extra shell/context/legend/current-result blocks; long names dominate narrow table. Preserve limitations through appropriate disclosures. |
| P3 / product sign-off | Added operational, provenance, reference and separate-scope sections differ from prototype | Not all differences should be removed: official-source/evidence requirements supersede fictional demo copy. Human approval needed for intended departures. |

## Acceptance mapping — exact issue wording

SATISFIED is limited to observed evidence. NOT SATISFIED means a visible gap or required evidence not demonstrated; it does not assert an unrun test failed. NEEDS HUMAN SIGN-OFF identifies independent approval or interpretation that this static audit cannot supply.

### #499

| Quoted acceptance criterion | Verdict | Evidence / gap |
|---|---|---|
| “1:1 same-scale pairs at 390 and 320 against the approved captures, with per-element notes and an independent verifier with no blocking finding.” | NOT SATISFIED | Pairs and inventories exist; compact mobile density remains a blocking fidelity finding. This independent static audit cannot issue a no-blocking disposition. |
| “An e2e assertion that \"Seleccionar sección y consultar resultados\" leaves the exact-table disclosure **open**. The verifier suggested this; today only focus is asserted.” | NOT SATISFIED | Exact results visibly open, but no assertion/action evidence reviewed; screenshots cannot prove causality. |
| “`test:e2e:gate` 8/8, 0 skipped.” | NOT SATISFIED | No gate report inspected or gate executed. Merge/artifact availability alone does not prove 8/8 and zero skipped. |

### #500

| Quoted acceptance criterion | Verdict | Evidence / gap |
|---|---|---|
| “No segment shows production as absent when the content exists.” | SATISFIED | All five current full-page desktop pairs include production through end labels; shorter-side stripes explicitly distinguish padding. No viewport-only blank-production artifact observed. This does not prove historical R4 reconstruction. |
| “Every lower-section element has a match or deviation note.” | SATISFIED | Five inventories above include lower tables, disclosures, evidence/reference cards, interpretation, continuation/availability and shared footer; obstruction and unknown closed contents are explicit deviations/limitations. |
| “An independent verifier finds no blocking issue.” | NOT SATISFIED | This audit identifies mobile fidelity and desktop obstruction blockers; no no-blocking approval claimed. |

Scope qualifications: request to rebuild specifically from `raw/r4-*-1440-full.png` and equal-height historical segments is not demonstrated by these R5 full-page files. Historical native widths 1276/1424/1600 must be annotated on actual R4 pairs, not falsely attributed to equal-width R5 captures. Acceptance of replacement R5 evidence for that historical scope **NEEDS HUMAN SIGN-OFF**.

### #501 — each acceptance criterion applied to every item

The issue says “For each item:” followed by these exact criteria:

1. “strict TDD where behaviour or labels change;”
2. “1:1 before/after evidence;”
3. “`test:e2e:gate` 8/8, 0 skipped.”

| Item (issue wording) | Current visual outcome | AC1: strict TDD | AC2: before/after | AC3: gate |
|---|---|---|---|---|
| “**Evidencia:** the raw machine label `non_official_source_rows` is visible. It needs a Spanish display label at a single boundary, like #498 did for review kinds.” | NOT SATISFIED: a raw `non_official_source` remains; exact old spelling not established; boundary not inspected | NOT SATISFIED: no RED-before-implementation evidence inspected | NOT SATISFIED: current pair is prototype/current, not controlled production before/after; round 2 lacked production | NOT SATISFIED: no 8/8 report |
| “**Evidencia / Comparación (mobile):** selects truncate long values at 390 and 320 px.” | NEEDS HUMAN SIGN-OFF: Evidencia offers full-selection disclosures; native truncation remains visible, comparison uses helper text. Interaction/accessibility not verified | NOT SATISFIED: no TDD evidence inspected | NOT SATISFIED: current same-scale pairs exist; controlled production before/after absent | NOT SATISFIED: no 8/8 report |
| “**Simulación (320 px):** the geography heading and its explanation wrap into a narrow column beside the Base/Escenario switch.” | SATISFIED for current visible symptom: heading/explanation span width above switch, no narrow side column | NOT SATISFIED: implementation evidence absent; whether CSS-only exception applies not established | NOT SATISFIED: current pair and historical notes are not controlled before/after evidence | NOT SATISFIED: no 8/8 report |
| “**Panorama (mobile):** substantive content starts late, and the map is partially clipped inside its frame.” | NOT SATISFIED: content still late; clipping not conclusively determined at downscaled reader resolution | NOT SATISFIED: implementation evidence/exception absent | NOT SATISFIED: no controlled production before/after | NOT SATISFIED: no 8/8 report |
| “**Exploración (mobile):** extra context and the taller territory controls push the map noticeably down at 390 and 320 px.” | NOT SATISFIED: duplicate context and stacked controls still delay map | NOT SATISFIED: implementation evidence/exception absent | NOT SATISFIED: no controlled production before/after | NOT SATISFIED: no 8/8 report |
| “**Municipal / Fiscalización (mobile):** pages are long. At 320 px the tables show only their first columns; horizontal-scroll interaction has not been verified.” | NOT SATISFIED: first-column limitation remains visible, scrolling unverified | NOT SATISFIED: interaction-test evidence absent | NOT SATISFIED: production-only captures, no comparative before/after | NOT SATISFIED: no 8/8 report |

This documentation-only task has no meaningful behavior-level RED/GREEN. That exception does not waive the implementation acceptance criteria. Required report check: `git diff --check`. No commit or push performed. Next closure evidence: actual test/TDD records, clean controlled disclosure/focus captures, native-scale map inspection, horizontal-scroll journeys, and independent/human disposition of intentional product departures.
