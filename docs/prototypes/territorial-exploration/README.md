# Votus Exploration — isolated analytical prototype

One offline map-centered workbench. Progressive geographic navigation preserves the
selected year, category and group. It does not modify or call the application.
Everything electoral is **fictional**: votes, coverage, deep units and outcomes.
The geographic assets are independent public references, not an official join.

## Run and verify

`node serve.mjs` starts the root-owned loopback preview on an available port.
`node verify.mjs` runs the root-owned Chromium checks using existing project
packages and produces `checks/report.json` and desktop/mobile captures. No install
or production build is needed. Browser mobile emulation is not physical-device
verification. State is in memory and resets on reload.

`node verify-navigator.mjs --fixture-only` checks the served Council partition and
unchanged national fixtures. `node verify-navigator.mjs` checks the visible navigator,
keyboard/focus, independent search, missing-data navigation and desktop/mobile
accessibility, producing `checks/navigator-report.json` and navigator captures.
Both verification scripts belong to the orchestrator, not the UI implementation.

## One stable analytical context

The default category is **Diputados nacionales · demostración**. Navigation never
substitutes a provincial/council category, year or grouping. Province-name reference
groups (24) and PBA section-name references (135) provide child navigation. Other
provinces and partidos have an aggregate fixture without invented child detail.
The three anchor options remain Argentina, Buenos Aires and Coronel Rosales;
additional selected nodes appear temporarily in the same selector.

Coronel Rosales illustrates a fictional two-circuit → four-establishment →
eight-mesa partition, using names such as “Circuito de demostración A” and IDs
prefixed `demo-`. These are not official school, circuit, mesa or electoral codes.
Deep nodes have **no geographic location**: their map keeps a clearly labelled
Coronel Rosales ancestor outline and draws no fake child polygons, points or
catchments. A mesa explicitly says it has no own territorial location.

**Concejales · demostración** is a separate category. Only the Coronel Rosales
family has council values: eight explicitly authored fictional mesa vectors sum
exactly through its establishments and circuits to Rosales. This is a design sample,
**not an allocation derived from official results** or evidence that municipal child
data are available. Argentina, Buenos Aires and all other reference territories
remain unavailable in that category, never zero-filled or substituted.

## Visible next-level navigation

The existing right detail panel contains the **Navegador territorial** immediately
after the selected category and before results, even when the sample is unavailable.
Its headings expose circuits, establishments, mesas and the terminal state. Native
**Abrir** buttons have wrapped names and targets at least 44px high; the ancestor
route and direct-parent **Volver** button keep context visible. After navigation the
new heading receives focus and is brought into view, including the stacked mobile
layout. A mesa states **Fin del recorrido**, without invented geography.

The 24/135-reference lists have bounded scrolling and an independent next-level
name search; two-child illustrative lists need no filter. Search never changes
sample totals, category, map winners or the lower analytical table's own filter.
Territory changes reset both searches. An empty search says **No hay coincidencias**;
an unavailable result does not hide or disable geographical navigation. No third
column, new route, scenario selector or persistence is added.

## Winner, coverage and source quality

The map's child colors encode only a valid-reference, complete, positive sample
with a unique maximum across all four groups. Group highlighting and camera zoom
never recompute the winner, denominator, share or margin. A searchable, bounded
child table exposes the exact territorial outcome, winning share, margin and
coverage without relying on color. Map nodes support Enter/Space exploration and
arrow-key navigation; the same paths have accessible table buttons.

- **Complete:** unique maximum, winning share and first-to-second margin.
- **Tie:** no definitive winner fill.
- **Partial:** reported data may show a provisional leader, never definitive fill.
- **Missing:** null votes, no total/bar/table values and exact-table toggle disabled.
- **Zero:** exact zeros remain visible, but shares and margins are undefined (“—”).
- **Cartografía observada:** invalid source geometry remains in neutral warning
  presentation even when its fictional vote sample is complete.

Electoral coverage is always a **fictional fixture denominator**. It does not
validate source geometry, official completeness, representativeness or turnout.
The national example contains complete, tie, missing, partial and zero child cases.
Its independent aggregate remains partial with incomplete child detail (23/24 with
some data, 22/24 complete), explicitly not a complete partition sum.

## Deterministic fixture construction

`generate-demo-results.mjs` reads only the frozen reference bundle's IDs/names and
writes `assets/demo-results.json`. The JSON has a 174-node tree: country, 24 province
references, 135 PBA references and 14 explicitly fictional deep units. Results are
stored per year and category, with `status`, nullable four-party `votes`, integer
`coverage`, and `aggregation: children|aggregate`.

For national-deputy mesa index `i=0..7`, base votes are `[90+2i, 70+i, 25+i, 8+2i]`. Group assignment
rotates by `(i + yearOffset) mod 4`, with offset 0 for 2025 and 1 for 2023. Complete
school/circuit/Rosales partitions sum those exact child counts within the same year
and category. Other PBA references use the same rotating pattern with shifted index
and factor 70; province aggregate examples use factor 1,200.

Known tie/partial/missing/zero examples replace Catamarca/Chubut/Chaco/CABA samples,
respectively. National aggregates are independent illustrative fixtures:

| Sample | Alianza A | Alianza B | Lista C | Lista D | Total |
| --- | ---: | ---: | ---: | ---: | ---: |
| National 2025 | 9,000,000 | 7,600,000 | 5,800,000 | 5,000,000 | 27,400,000 |
| National 2023 | 8,700,000 | 8,100,000 | 6,100,000 | 5,100,000 | 28,000,000 |
| Council Rosales 2025 | 21,482 | 18,736 | 6,924 | 2,158 | 49,300 |
| Council Rosales 2023 | 19,540 | 20,930 | 5,690 | 2,640 | 48,800 |

No known child-party subtotal may exceed its independent parent aggregate. The
fixture generator enforces this containment invariant as well as requiring complete
children before `aggregation=children`. It does not turn reported incomplete child
counts into an authoritative complete total.

Council vectors are authored explicitly in generator `tableIds` order, with groups
`[a, b, c, d]`. No weights, territorial population or official allocation are inferred:

| Fictional mesa | 2025 vector | 2023 vector |
| --- | --- | --- |
| A1-1 | 3,100 / 2,100 / 700 / 200 | 2,400 / 2,700 / 600 / 300 |
| A1-2 | 2,600 / 2,450 / 900 / 260 | 2,600 / 2,500 / 750 / 330 |
| A2-1 | 2,800 / 2,300 / 850 / 230 | 2,300 / 2,800 / 650 / 290 |
| A2-2 | 2,350 / 2,600 / 1,000 / 300 | 2,500 / 2,600 / 800 / 350 |
| B1-1 | 3,000 / 2,000 / 800 / 240 | 2,200 / 2,900 / 700 / 310 |
| B1-2 | 2,200 / 2,700 / 1,000 / 300 | 2,700 / 2,300 / 800 / 380 |
| B2-1 | 2,600 / 2,300 / 900 / 280 | 2,400 / 2,700 / 650 / 330 |
| B2-2 | 2,832 / 2,286 / 774 / 348 | 2,440 / 2,430 / 740 / 350 |

Complete school/circuit/Rosales Council counts are the exact sums of these vectors,
retaining the table above's 49,300/48,800 totals. Other Council entries remain
`status=missing, votes=null`. The national result structures are unchanged, with
sorted structural SHA-256
`080c0bd14d33c48b863de2f3e04105ff8a6db27afd21a1a3f9addd5849a71ad2`.

All values are nonnegative safe integers; every available entry has exactly four
groups. Shares divide by each current sample total; winning margin is `(largest -
secondLargest)/total × 100` percentage points. 2025 deltas use the same node/category
2023 share only when both totals are positive and the base exists; otherwise “—”.
2023 displays as the comparison base. Rounding need not sum to exactly 100.00%.

## Source-backed geographic assets

Original archives remain unchanged. No credentials/acquisition query keys, map
tiles, CDNs, remote fonts or APIs are consulted at runtime. The project already had
local IBM Plex Sans/Mono fonts, D3 and Shapely; no dependency was added.

### CNE child-reference layer

- Catalog: [CNE electoral map](https://mapa2.electoral.gov.ar/).
- Archive record: `geography/cne-pba-sections`, acquired 2026-09-24.
- SHA-256: `964af68999504c107c71eaccd8470055f990071eccba09f227e81b6dc31df673`.
- Original bytes: 30,269,143. All **538 features**, **1,976 polygons**, **2,213 rings**
  are retained. The derivative contains 140,773 vertices.
- 516 valid features are simplified at 0.002° with topology preservation; all 22
  invalid source features remain unchanged. PBA has two invalid references:
  Adolfo Alsina and Arrecifes. They retain exact fictional rows but no winner fill.
- Province groups preserve all source names/GIDs and raw duplicates: no dissolve,
  repair, selection of a first duplicate, hidden deletion or inferred canonical
  electoral code. Presentation names/IDs are explicit prototype labels only.
- Robust GEOS ring-sign diagnostics drive display winding, not naive unshifted
  shoelace zeros. Final source observations: zero degenerate exteriors, 28 degenerate
  holes, one direction-reversed exterior and one direction-reversed hole. Twelve
  cancellation/residual diagnostic records explain why earlier naive counts were
  not reliable. Source coordinates/components are not repaired or dropped.
- `generate-winner-reference-assets.mjs` and `assets/winner-reference-paths.json`
  belong to the independent asset worker. Final bundle: 6,267,496 bytes;
  SHA-256 `a78aaf525c7da8417f652695092b2cf9f631a97fd9d983fbcc044b078b779723`.
- Child `.path` uses the parent projection; `.scopePath` fits that reference's own
  contour. Grouping CNE names is not an official geography/election crosswalk.
  Year applicability and publication/reuse terms remain unverified.

### Preserved IGN national and Buenos Aires base references

- National IGN source SHA-256:
  `ae076881944abd36b79b0a68d14912ca475af95a2c2a9211910ffab81f6ca1e6`.
- Existing national derivative SHA-256:
  `70b0b5bba80ce1e924159fcceb72560a0b67435fff3d8d11e5b6e70590999af5`, 736,599 bytes.
- Both existing national projections receive all **1,980 polygons, 1,991 rings and
  27,460 vertices**, correcting one exceptional exterior winding for D3. No island
  or Antarctic component is filtered out. The main Mercator frame is continental;
  the independently scaled equal-area polar inset preserves complete source extent,
  not electoral coverage. It does not zoom with the main camera.
- Buenos Aires IGN source SHA-256:
  `314600f9b681841b9f35c27fac030c835de6a95cbf4a0c4256a39df6c069f723`.
  Source `provincia.68`, `in1=06`, 10,282,974 bytes; local 0.002° topological
  derivative retains all 95 components and 2,038 vertices.
- [IGN country layer](https://wms.ign.gob.ar/geoserver/ign/ows?service=WFS&version=1.0.0&request=GetFeature&typeName=ign%3Apais&outputFormat=application%2Fjson&srsName=EPSG%3A4326&maxFeatures=2),
  [IGN province layer](https://wms.ign.gob.ar/geoserver/ign/ows?service=WFS&version=1.0.0&request=GetFeature&typeName=ign%3Aprovincia&outputFormat=application%2Fjson&srsName=EPSG%3A4326&maxFeatures=2&CQL_FILTER=in1%3D%2706%27).
  The archived metadata dates to 2019 and does not establish election-effective
  boundaries. [IGN reuse terms](https://www.ign.gob.ar/descargas/tyc1.html) are recorded
  in the archive, but publication has not been authorized or independently cleared.
  Attribution does not imply IGN endorsement.
- Existing Coronel Rosales reference selects CNE `gid=30556`, province Buenos Aires,
  `departamen=Cnel. de Marina L.Rosales`, cabecera Punta Alta: one ring, 307 vertices.
  No city coordinate or deep electoral polygons are invented.

## Limits and non-production boundary

These reference names and fake samples cannot support real political, electoral or
operational decisions. The interpretive guide is non-evaluated design copy, not a
recommendation model. There are no personal records. The grid is schematic, and
camera percentage is not a measured distance scale. SVG decimal precision is display
precision, not geographic accuracy.

Physical devices, actual assistive technology, production performance, security,
real electoral coverage, historic boundaries, reuse permissions and official joins
remain outside this prototype's verified scope. No application/source archive,
authentication, schema, infrastructure, lockfile, dependency, publication or commit
is changed. User visual approval and production implementation are separate steps.
