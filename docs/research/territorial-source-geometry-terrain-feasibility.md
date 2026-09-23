# Territorial source, geometry and terrain feasibility

## Status, scope and method

Slice 1 feasibility synthesis (TF-01–TF-04); source access date: **2026-09-22**. TF-02 adds one checksum-backed ARBA WFS archive and a production CLI structural validator. TF-03 adds a standalone, non-production renderer evaluator and exact dependency pins, outside Next routes. Together they prove bounded partido correspondence and lab feasibility, not election-date applicability, complete coverage, topology, terrain, child geography or a delivered map. No database ingestion or production renderer was added.

The parent researcher fetched and inspected the primary sources registered below using approved web tools and supplied bounded observations to this writer. The TF-01 writer did **not** independently fetch those URLs; the TF-02 implementation writer subsequently ran the real WFS archival command documented below. Claims below are limited to those observations; live metadata is not an immutable dataset snapshot. Resource listings do not prove the contents, validity, or historical applicability of geometry archives. Election-result inventory match counts remain unmeasured; the bounded WFS-to-canonical-jurisdiction count is measured below.

Repository requirements were read in `CONTEXT.md`, `docs/plans/territorial-intelligence-slices.md`, `docs/proposals/2026-09-22-3d-electoral-heroes-and-navigation.md`, and `odd/tasks/territorial-feasibility-01.md`. Canonical-code observations below also use the parent-supplied repository inspection, not a new independent code audit.

Evidence states:

- **Verified:** supported by a fetched primary document, inspected catalog metadata, or the explicitly attributed repository observation. Its scope is stated; catalog verification is not geometry verification.
- **Candidate:** a supported investigation target, not an accepted correspondence or product scope.
- **Unknown:** evidence or measurement has not been obtained; never means zero or absent.
- **Contradiction/risk:** versions, meanings, or identifiers differ and cannot be silently reconciled.

Only public official reference/election evidence is considered. DINE's provisional-count publication is not definitive election certification. Fiscalización is outside this audit and must never enter an official result aggregate.

## Anchor/depth compatibility and coverage matrix

License and freshness codes refer to the source register and the following table. “Unknown” applies separately to missing geometry, conflicting identity, and unmatched result counts in every row; no full-coverage inference is permitted.

| Anchor/depth | Authority and candidate dataset | Geometry/coordinates and resolution | Geographic versus electoral depth; join candidate | Verified coverage and election applicability | Unknowns and blockers |
| --- | --- | --- | --- | --- | --- |
| Argentina boundary | IGN GIS layers [S4] | Province polygons are listed; a country outline resource, CRS, scale and precision were not verified | Country anchor versus national electoral districts; province identities require inspection | Layer availability only; neither complete national geometry nor 2023/2025 applicability established | National extent, islands/territorial treatment, geometry inventory and district correspondence unknown; do not infer a national outline from a province listing |
| Buenos Aires Province boundary | IGN province layer [S4] | Polygon layer listed; archive, CRS and resolution uninspected | Geographic province versus national electoral district `02` | No inspected PBA feature or verified election-version correspondence | Feature identifier, topology, boundary date, missing/conflicting/unmatched counts unknown |
| Coronel Rosales partido | ARBA WFS `idera:Departamento` (TF-02 below); catalog [S8] | Archived EPSG:4326 MultiPolygon; structural checks passed; positional resolution/topology unknown | Exact WFS identity `cca=113`, `cde=06182`, `nam=Coronel Rosales`; explicit registry association to PBA `027`, then existing crosswalk to national `(02,027)` | One accepted feature, zero invalid/conflicting features in the bounded snapshot; no 2023/2025/2027 applicability established | Legal extent, historical applicability, topology and precision remain unknown; broken ZIP is not used |
| Coronel Rosales circuits | CNE-authored PBA Circuits [S9–S10] | Catalog lists SHP/GeoJSON/KML, EPSG:4326; scale/positional accuracy unknown | Circuit polygons could support intra-partido geography; election circuit identifiers remain election-scoped | Attribute CSV enumerates 10 local circuit strings, not 10 validated polygons or 10 matched election units | Inspect actual geometries, uniqueness, municipal containment, suffix/padding rules and both election sides; all match/conflict counts unknown |
| Establishments | DINE hierarchy [S2]; no coordinate source verified | No authoritative coordinates or positional precision verified | Voting place contains mesas; an electoral identity is not a geocoded location | No establishment spatial coverage verified at Argentina, PBA or Coronel Rosales depth | Coordinate source, reuse terms, precision, identifiers, election applicability and counts all unknown; no geographic point placement |
| Mesas | DINE hierarchy/results fields [S2] | No mesa geometry or coordinates verified | Minimum electoral aggregation, not a presumed polygon; future sublayout may be explicitly non-geographic | No mesa spatial coverage verified at any anchor | No invented polygons, distances or locations; establishment anchoring itself requires future verified coordinates |
| Physical terrain: Argentina → PBA → Coronel Rosales | IGN MDE-Ar v2.1 [S6–S7] | Published 30 m resolution, approximately 2 m vertical precision, SRVN16; derived from SRTM/ALOS | Physical elevation, independent of jurisdiction boundaries and electoral extrusion | IGN describes continental national coverage; PBA/local tile coverage and quality were not inspected; this is not all-national-territory coverage proof | Local voids, acquisition dates, exact files, checksum, resampling and renderer encoding unknown; no accepted tile service or production terrain path |

The ten **catalog attribute identities** inspected for Coronel de Marina Leonardo Rosales are: `248`, `0248A`, `0248B`, `0248C`, `0248D`, `0248E`, `0248F`, `249`, `0249A`, `0249B` [S10]. They occur with municipality `06182` and INDEC municipality/department `182`. Ten is not an election denominator, archive geometry count, or complete circuit-coverage claim.

PBA legislative-section geometry is a separate candidate reference: the catalog describes 2022 SHP/GeoJSON/KML in EPSG:4326, authored by IDEBA/IGN [S11]. It must not substitute for the partido represented by national `seccion_id=027`.

## License, version and freshness

| Evidence | Version/freshness actually established | License/terms actually established | Acceptance limitation |
| --- | --- | --- | --- |
| DINE standard [S1–S3] | Developer page points to v1.0.8; PDF change-log entry 2025-09-25, 13 pages; legal adoption in 2024 | Legal adoption concerns final delivery of provisional national-count data; no general reuse license verified here | Proposal's starting-point link was updated from v1.0.6 to v1.0.8; do not infer which standard each historical file implements or that 2024 adoption specifically names v1.0.8 |
| IGN boundaries [S4–S5] | Live layer listing; individual layer version/date unavailable in supplied evidence | Attribute Instituto Geográfico Nacional de la República Argentina; retain metadata date/reuse conditions; derived products name original date; downloaded data shared freely; commercial use only for derived works using data as input; no endorsement | Do not relabel as CC BY or treat free download as unrestricted redistribution; inspect selected layer metadata |
| MDE-Ar [S5–S7] | Version 2.1 established; release/acquisition dates not verified | Introduction says freely distributed; IGN reuse conditions are recorded, but selected elevation download terms still need checking | Technical PDF title inspected; detailed unquoted report fields remain pending, including any dataset-specific qualifications |
| ARBA Partidos [S8] | Live metadata modified 2026-06-17; resource says updated June 2026; ZIP listed as 7,796,169 bytes; no dataset version/checksum published | Catalog declares CC BY 4.0 | Modification date is not historical boundary validity; archive contents and exact attribution metadata not inspected |
| CNE/PBA Circuits [S9–S10] | Live metadata modified 2026-03-12; ZIP listed as 7,382,682 bytes; no version/checksum published | Catalog declares CC BY 4.0 | 2026 metadata does not prove 2023 or 2025 election applicability; attribute CSV is not polygon verification |
| PBA legislative sections [S11] | Data described as 2022; exact release/version/checksum unavailable | Catalog declares CC BY 4.0 | Source field points to IDEBA WFS; service and underlying archive not independently validated here |
| deck.gl [S12–S14, S18] | Live docs; bundle reference specifically v9.4.0-alpha.2 | First-party repository LICENSE: MIT | Upstream reference differs from the installed exact 9.4.0 evaluator pins below; not a production dependency |
| MapLibre GL JS [S15–S17, S19] | Live docs/examples and branch license; exact documentation revision unavailable | First-party repository LICENSE.txt: BSD-3-Clause terms | Exact 6.10.0 evaluator package metadata below; renderer license does not license basemap tiles, terrain data, fonts or other services |

## Canonical identity and join risks

DINE v1.0.8 defines district as province/CABA, section usually as department/partido/comuna, provincial section as a grouping of sections, circuit as a section subdivision, voting place as containing mesas, and mesa as the minimum electoral aggregation [S2]. Its electoral-scope CSV supplies district/section identities corresponding to results, not polygon geometry. Result fields include `distrito_id`, `seccionprovincial_id`, `seccion_id`, numeric/alphanumeric `circuito_id`, `mesa_id`, and `mesa_tipo`. IDs are scoped per election and are explicitly not guaranteed stable between election processes.

| Identity family | Observed value/meaning | Risk and TF-02 requirement |
| --- | --- | --- |
| PBA election scheme | `distrito 027` = Coronel Rosales partido (parent repository evidence) | Not national district `027`; resolve through the existing normalization/crosswalk boundary |
| National election scheme | District `02` + section `027` = current Votus municipal jurisdiction (parent repository evidence) | Preserve the pair, election and scheme; never attribute a partido total to the province by dropping section |
| ARBA/PBA Partidos | CSV `municipio_id=6182` [S20]; WFS `cca=113`, `cde=06182` verified in TF-02 | Explicit source registry associates the exact WFS identity with PBA `027`; crosswalk supplies `(02,027)`. Never infer equivalence from `6182`, `06182`, `182`, `113`, or names |
| CNE/PBA Circuits and INDEC | `municipio_id=06182`; INDEC municipality/department `182` [S9–S10] | `6182`, `06182`, and `182` belong to declared field contexts, not automatically interchangeable namespaces |
| Circuit IDs | Repository examples such as `00248`; catalog `248` and `0248A`-style strings | Candidate padding correspondence only; preserve suffixes and raw values; test collisions rather than numeric-casting or stripping zeros globally |
| PBA legislative sections | Provincial section grouping, catalog data described as 2022 [S2, S11] | Not national `seccion_id=027`; joining on the word “section” would confuse levels |
| Establishment/mesa | Election hierarchy and election-scoped IDs [S2] | Retain full applicable parent identity and election; no global mesa-identity assumption or inferred coordinates |

The current municipal target is Coronel Rosales 2025 provincial Concejales at national `(02,027)`, according to repository requirements and the parent inspection. That existing scope does not validate 2026 boundary resources against 2025 results. For 2023 and 2025 separately, a later production integration must inspect actual result identities and establish dated correspondence; a cross-election match cannot be assumed from equal strings. No geometry or election applicability has been established for 2027.

DINE's developer page covers provisional national results and provincial/local results held under simultaneous-election law [S1]. Disposición 1/2024 describes historical provisional data complete in DINE custody from 2011–2023 [S3]; this custodial statement is not proof of complete Votus ingestion, municipal category coverage, definitive results, or geometry coverage.

## Renderer feasibility: source context and measured lab acceptance

| Question | Fetched first-party evidence | Remaining gate |
| --- | --- | --- |
| Map integration | deck.gl documents MapLibre compatibility for GL JS 4.5.1, 5 and 6 and synchronized camera operation [S12] | Standalone pinned-version runtime proof is recorded in TF-03 below; production integration remains untested |
| Composition mode | Interleaved requires WebGL2; overlaid uses a separate canvas; reverse-controlled blocks base-map interaction and loses MapLibre controls/plugins [S12] | TF-03 uses MapLibreOverlay/GeoJsonLayer on a blank style; no production composition choice is delivered |
| Terrain | MapLibre example consumes `raster-dem` with independently controlled exaggeration [S15] | IGN source elevation is not an accepted raster-dem service; conversion, tiling, archival provenance and licensing remain open decisions |
| Bundle reference | deck.gl v9.4.0-alpha.2, esbuild evergreen, gzip-9: minimal Deck+Layer 146.8 kB compressed (144.5 kB WebGL-only); GeoJsonLayer adds 46.9 kB (39.5 kB WebGL-only) [S13] | These are upstream reference measurements, not Votus bundle growth, selected versions, or accepted budgets |
| Performance | Hardware-dependent; mobile is more memory-sensitive/slower; updates may block interaction; binary data/workers can reduce processing/serialization [S14] | TF-03 records single desktop and constrained mobile-emulation lab observations below; no physical-device proof or production SLO |
| Input and failure | MapLibre documents keyboard shortcuts enabled by default, cooperative gestures and WebGL2 options; official example handles map creation/error for WebGL support [S16–S17] | Standalone forced-failure/table behavior is browser-tested below; production fallback is not established |

The fetched renderer documents do not establish Votus's accessibility contract. TF-03 browser evidence below covers the standalone fallback, keyboard, focus, reduced motion, 320px, CDP page-scale 2 and 44px controls; native browser zoom and complete production accessibility remain unverified.

Physical terrain must remain separately explained and switchable from electoral metric height. No terrain exaggeration, resolution, or vertical precision establishes electoral meaning. Missing terrain must not remove valid exact evidence. No production renderer or terrain path is approved by this report.

## TF-02 audit output contract: no silent exclusions

This is a required reporting shape, not a new database schema or script specification. For each source snapshot, election, anchor and depth, report the following independently. Election-side inventory counts remain **unknown / not measured**. The bounded ten CSV circuit strings above and the one accepted WFS feature below are separate measurements, not election coverage denominators.

| Category | Explicit reason fields | Required outcome |
| --- | --- | --- |
| Missing | Missing geometry; missing coordinates; missing source identifier; missing result observation; missing parent identity; missing provenance/license/version | Separate counts and bounded non-personal identity examples per reason; absence is never zero votes |
| Conflict | Duplicate source key; normalization collision; ambiguous crosswalk; incompatible parent; multiple geometries; incompatible boundary version | Report candidates without picking first or summing; state whether documented multipart geometry is legitimate before classifying it as conflict |
| Unmatched | Geometry-only; election-only; left-election-only; right-election-only; unresolved identifier scheme | Count both input sides, explain denominator/source inventories, and preserve unresolved units |
| Invalid | Unreadable/empty geometry; invalid topology; unsupported CRS; invalid coordinate; unsupported code shape | Explain validation rule and affected granularity; no silent repair or deletion |
| Excluded | Outside declared anchor; outside election/category; non-official source; incompatible date; unavailable reuse permission | Count each deliberate exclusion by reason, including source_kind; exclusion is not missing coverage |
| Unknown applicability | No dated correspondence; metadata-only resource; no inspected archive; no established coordinate precision | Report unassessed units separately from proven mismatches |
| Accepted | Unambiguous in-scope identity and supported geometry at declared precision | Count only after source/version/election checks; acceptance at partido level says nothing about circuit or mesa coverage |

Record raw and canonical keys, source authority/resource, retrieval date, snapshot checksum when later archived, election/category/source_kind, geometry/coordinate precision, denominator definition, and reason. Avoid personal names or establishment contact details. Reason counts may overlap; disclose that and provide a separate unique-unit reconciliation so totals cannot conceal duplicate counting. Do not manufacture complete expected inventories when the denominator itself is unknown.

## Bounded conclusion and next gate

**Verified bounded correspondence:** TF-02 archived one Coronel Rosales ARBA WFS MultiPolygon, passed structural checks, and resolved the explicit PBA `027` association through the existing crosswalk to `(02,027)`. This is not a dated polygon/result join or acceptance of complete product coverage.

**Conditional extension:** circuit polygons are plausible; ten catalog attribute identities are enumerated. Actual archive geometry, identifier uniqueness, election-side matches and dated applicability require their own accepted source/archive/CLI validation before any circuit scope is used. Establishments and mesas remain non-geographic until separately evidenced; even a non-geographic mesa layout cannot be geographically anchored without a verified establishment location.

**Go:** the separately authorized partido-only archive/CLI path is reproducible below. Preserve the exact snapshot rather than treating the live URL as immutable. Circuit, establishment and mesa geometry remain explicitly unsupported.

**Go:** a minimal Coronel Rosales partido-boundary workspace using existing authorized exact municipal results is feasible within accepted lab budgets, as an implementation candidate pending final whole-candidate verification and Slice 1 merge. **No-go:** terrain, child geography, national/provincial expansion and production integration claims. Historical applicability and election-side join counts remain unverified; show unsupported depths and exact table/text fallback rather than infer missing geography. The partido-only archive/CLI portion planned for Slice 2 was pulled into Slice 1 by explicit user decision; other terrain/child references still need separately accepted source/archive/CLI work before use. A partido-only Slice 3 may start after Slice 1 merges without waiting for those unavailable sources.

## TF-02 — Reproducible partido snapshot and structural validation

The parent inspected official ARBA WFS `DescribeFeatureType` for `idera:Departamento`: fields `cca`, `cde`, `fna`, `gna`, `nam`, `sag`, `ara3`, `arl`, `geom`. Its bounded response identified `Departamento.482`, `cca=113`, `cde=06182`, `nam=Coronel Rosales`, `fna=Partido de Coronel Rosales`, `gna=Partido`, `sag=ARBA`, MultiPolygon, and `urn:ogc:def:crs:EPSG::4326`.

Exact registered and independently archived GetFeature URL (WFS 2.0.0, count 2 so duplicate candidates are not silently hidden by a count-1 query):

```text
https://geo.arba.gov.ar/geoserver/idera/wfs?service=WFS&version=2.0.0&request=GetFeature&typeNames=idera%3ADepartamento&outputFormat=application%2Fjson&srsName=EPSG%3A4326&count=2&CQL_FILTER=cde%3D%2706182%27%20AND%20cca%3D%27113%27&sortBy=cde%20A
```

Executed successfully from the repository root:

```sh
uv run --project etl python -m etl fetch --source geography/arba-coronel-rosales-partido
uv run --project etl python -m etl validate-partido-geometry --source geography/arba-coronel-rosales-partido
```

The existing immutable archive/manifest contract produced:

- Path: `archive/geography/arba-coronel-rosales-partido.b502009185a5d6b1666312d2d91aa9b79053b2ee8a06f0aa683029b925c3ed13.geojson`.
- SHA-256: `b502009185a5d6b1666312d2d91aa9b79053b2ee8a06f0aa683029b925c3ed13`.
- Size: **69,544 bytes**; retrieval timestamp: **2026-09-22T18:36:01Z** (not a boundary validity date).
- This exact small, checksum-addressed snapshot is the sole Git-versioned archive exception required for reproducible clean checkouts; the broader raw archive remains manifest-hashed and ignored.
- Canonical record plus initial fetch event retained in `archive-manifest.json`; no invented election year/round. The existing writer serialized the legacy top-level record list into its already-supported schema-v2 `records`/`fetch_events` envelope; persistence code was not changed.

Actual validator output (both commands exited 0):

```json
{"counts":{"accepted":1,"conflict":0,"invalid":0},"crs":"EPSG:4326","feature":"Departamento.482","feature_type":"idera:Departamento","geometry":"MultiPolygon","jurisdiction":{"national_distrito":"02","national_seccion":"027","pba_distrito":"027"},"reasons":{},"snapshot":{"sha256":"b502009185a5d6b1666312d2d91aa9b79053b2ee8a06f0aa683029b925c3ed13","source":"geography/arba-coronel-rosales-partido","timestamp":"2026-09-22T18:36:01Z"},"unsupported_depths":["circuit","establishment","mesa"]}
```

The validator reads only checksum-verified archived bytes before JSON parsing. It requires one FeatureCollection/Feature, exact registered identity, the registered `idera:Departamento` QName bound to the payload's `Departamento.` feature-ID prefix, the observed EPSG:4326 declaration, Polygon/MultiPolygon, finite numeric coordinate pairs, and non-empty closed rings of at least four positions. GeoJSON does not independently declare the namespace; that part of the evidence is the registered WFS source contract. The PBA `027` association is explicit metadata, resolved through the existing curated crosswalk, never derived from administrative digits or name similarity.

**Structural, not topological:** no self-intersection, hole containment, winding, overlap, precision, legal-boundary or election-date validity checks are claimed. The accepted count means structural reference evidence with a canonical jurisdiction correspondence; it does not count accepted 2023/2025/2027 election joins. Circuit, establishment and mesa depths remain unsupported, not zero-coverage claims.

Counts are mutually exclusive at the first failed validation gate: zero features gives one invalid snapshot with `missing_feature`; multiple returned features give a conflict count equal to the returned candidates with `multiple_features` (a bounded response, not a province-wide inventory). Other invalid snapshots receive one exact reason such as `archive_integrity`, `wrong_identity`, `wrong_crs`, `wrong_feature_type`, `wrong_geometry_type`, `invalid_coordinates`, or `unsupported_reference_kind`. The accepted snapshot has no rejection reasons.

Strict-TDD evidence began with the exact CLI-entry command `uv run --project etl pytest etl/tests/test_cli.py -k test_validate_coronel_rosales_partido_geometry_is_reachable_through_main`: **1 failed, 197 deselected**, argparse `invalid choice: 'validate-partido-geometry'`, before implementation. The earlier fixture-setup failure was corrected and is not counted as RED. First GREEN was **1 passed, 197 deselected**. Subsequent negative CLI-entry cycles observed failures before adding each validation gate; the focused suite now passes **33 cases**. No topology library, dependency, database projection or circuit source was introduced.

Final corrected-candidate verification: the manifest consumer regression test passed **1/1**; focused geography/source checks passed **71/71**; the complete ETL suite passed **1,135 tests with 99 skipped and one intentional duplicate-ZIP-member warning**. The skipped tests do not establish their covered behavior. Ruff over the four changed Python/test files and `git diff --check` passed. The real validator was rerun twice after the final source correction and returned identical accepted output for the same archived snapshot. Historical RED/GREEN ordering is writer-recorded evidence; independent verification confirms the resulting behavior, not the chronology.

## TF-03 — standalone renderer feasibility (non-production)

Executed on macOS arm64, Node v24.20.0, cached pnpm 12.3.4, Playwright Chromium 1.62.1, 2026-09-22. Exact installed package metadata: `maplibre-gl@6.10.0` BSD-3-Clause; `@deck.gl/layers@9.4.0` MIT; `@deck.gl/maplibre@9.4.0` MIT; `esbuild@0.28.2` MIT. The evaluator is outside Next routes and serves only a checksum-verified archive snapshot on process-lifetime 127.0.0.1; the archive bytes are not copied into the bundle or public directory. It renders one ARBA partido MultiPolygon on a blank MapLibre style with a deck `MapLibreOverlay`/`GeoJsonLayer`, and a static semantic table exists before script initialization. Selection emphasizes the actual boundary outline and textual state. No electoral metric, winner, extrusion, child geometry, basemap, terrain or elevation claim is present. Terrain is expressly disabled: no validated raster-dem archive exists. Circuit, establishment and mesa geometry are unsupported; the lab thresholds below were accepted by the user.

Strict TDD: `pnpm --dir apps/web exec vitest run e2e/territorial-renderer-evaluation.test.ts` first failed 1/1 with `Command "evaluate:territorial-renderer" not found` before dependencies/implementation. The missing Vitest and pnpm-10 lockfile parsing attempts were setup failures, **not** RED. The first browser RED reached the pre-rendered table and then timed out waiting for the named `WebGL unavailable` state after forcing canvas contexts to fail. The subsequent focused GREEN passed 1/1; final focused rerun also passed 1/1. `pnpm --dir apps/web test` passed **1,285/1,285 across 71 files** after raising the new command-level test's five-second default timeout; `pnpm --dir apps/web typecheck` and `pnpm --dir apps/web lint` passed. `pnpm --dir apps/web evaluate:territorial-renderer -- --verify` output was deterministic across two command invocations in the focused test:

```json
{"archive":{"source":"geography/arba-coronel-rosales-partido","bytes":69544,"sha256":"b502009185a5d6b1666312d2d91aa9b79053b2ee8a06f0aa683029b925c3ed13","geometry":"MultiPolygon","featureCount":1},"renderer":{"stack":"MapLibreOverlay/GeoJsonLayer","canvas":true,"blankStyle":true},"fallback":{"webglFailure":"map unavailable","exactTableRetained":true},"browser":{"keyboard":true,"mobile320NoOverflow":true,"zoom200Method":"cdp-page-scale","zoom200EmulatedUsable":true,"reducedMotionCameraChanged":true,"reducedMotionDurationMs":0,"reducedMotionSettled":true,"visibleKeyboardFocus":true},"accessibility":{"axeSeriousOrCritical":0,"touchTarget44":true}}
```

The fallback test compares the semantic table's text before and after forced WebGL failure, verifies source/checksum/CRS/shape/codes/unsupported depths and tests Enter/Space selection. The 320×720 viewport has no document overflow; Chromium CDP emulates 2x **page scale**, not native browser zoom. At that scale the evaluator checks no document overflow, operates Enter/Space on the focus/reset control, scrolls to and programmatically focuses the exact table caption, and checks table/control visibility. Computed `:focus-visible` styling has a nonzero visible outline or equivalent. `@axe-core/playwright` WCAG 2 A/AA found zero serious/critical violations in forced fallback. Reduced-motion emulation confirms the media query is active and the evaluator's explicit camera observation seam starts settled at a distinct geometry-visible camera (64px initial padding), then focus moves zoom to the 24px target with duration exactly zero. Camera is not moving immediately or 300 ms afterward; Enter selects, Space resets and renderer status remains available. No drag, hover or tilt affordance is promised. The initial table remains available when scripts are disabled.

Final corrected-candidate single-run observations (`pnpm --dir apps/web evaluate:territorial-renderer -- --measure --profile desktop` and `--measure --profile mobile`):

```json
{"profile":"desktop","device":"Chromium desktop, unthrottled","throttling":"unthrottled","bundle":{"rawBytes":3425827,"gzipBytes":739083},"rendererReadyMs":1179,"keyboardInteractionMs":9,"canvas":{"width":1120,"height":280},"featureCount":1,"heapBytes":11200000}
{"profile":"mobile","device":"Chromium mobile emulation, not a physical device","throttling":"CDP 150ms latency, 1.6Mbps down, 0.75Mbps up, 4x CPU","bundle":{"rawBytes":3425827,"gzipBytes":739083},"rendererReadyMs":19786,"keyboardInteractionMs":18,"canvas":{"width":592,"height":440},"featureCount":1,"heapBytes":10600000}
```

Accepted lab budgets: standalone gzip ≤800 KiB; desktop renderer-ready ≤2 s and interaction ≤150 ms; constrained mobile Chromium emulation ready ≤25 s and interaction ≤150 ms; heap ≤16 MiB; production initial-JS growth ≤10%. All final single-run observations pass. Mobile touch/DPR2 and CDP network/CPU throttling are emulation, not physical-device evidence; Chromium's `performance.memory` is approximate. These are not production renderer SLOs. The standalone bundle is **not** production initial JS. Focused/full web tests, typecheck and lint passed. The corrected-candidate canonical gate passed 8/8, including production build; detached clean base passed the same 8/8. The final retained-build comparison keeps every user-facing route within the ≤10% budget: eight manifest-based raw/gzip/chunk inventories are identical; `/login` has four chunks and 93,452 raw bytes in both builds, while deterministic gzip-9 is 26,165 bytes for the candidate versus 26,167 for base (−2 bytes). The sole differing chunk contains a build-specific server-action ID/minified variable, so exact gzip identity is not claimed. Production route and generated-output scans found zero evaluator routes/identifiers. The earlier direct build without local Supabase credentials failed `/compare` prerender, but the canonical local gate supplies its disposable stack. Impeccable detector returned `[]` only once before the final behavior-only `main.ts` correction; it was not rerun. Native assessment remained unassessable because intended untracked files were undeclared: there is no native approval/receipt, commit, push, PR, merge or production map delivery. Rollback can revert evaluator/package/report and new geography consumer/registry/CLI while retaining immutable snapshot and manifest history; existing exact workflows remain.

## Primary-source register

All S-numbered URLs below were fetched by the **parent**, with access date **2026-09-22**. Dates/versions not stated are unavailable in the supplied inspection. A successful fetch proves neither dataset completeness nor archive validity. No secondary source or search snippet is cited.

| ID | URL | Publisher; artifact/version/date | Inspection caveat |
| --- | --- | --- | --- |
| S1 | https://www.argentina.gob.ar/dine/resultados-electorales | Argentina/DINE; live developer page; revision date unavailable | Current link is v1.0.8; publication scope is provisional results |
| S2 | https://www.argentina.gob.ar/sites/default/files/preservacionresultadoselectorales_1.0.8.pdf | DINE; versioned standard v1.0.8; 2025-09-25 change-log entry; 13 pages | Version-labelled document, not an independently checksummed immutable snapshot; no polygon specification |
| S3 | https://www.argentina.gob.ar/normativa/nacional/disposici%C3%B3n-1-2024-397238/texto | Argentina national normative portal; Disposición 1/2024; publication line `e. 11/03/2024` (2024-03-11) | Legal adoption/custody statement, not geometry or definitive-results guarantee |
| S4 | https://www.ign.gob.ar/NuestrasActividades/InformacionGeoespacial/CapasSIG | IGN; live GIS layer listing; revision unavailable | Province, department and local-government polygon listings; archive coverage uninspected |
| S5 | https://www.ign.gob.ar/descargas/tyc1.html | IGN; reuse terms; version/date unavailable | Retain conditions and selected resource metadata; not a blanket third-party license |
| S6 | https://www.ign.gob.ar/NuestrasActividades/Geodesia/ModeloDigitalElevaciones/Introduccion | IGN; live MDE introduction describing v2.1; release date unavailable | Published resolution/precision/continental coverage, not local tile audit |
| S7 | https://www.ign.gob.ar/archivos/Informe_MDE-Ar_v2.1_30m.pdf | IGN; technical report MDE-Ar v2.1 30 m; date unavailable | PDF fetched; extraction exposed title; detailed report fields pending inspection |
| S8 | https://catalogo.datos.gba.gob.ar/api/3/action/package_show?id=partidos | PBA catalog; author ARBA; live metadata modified 2026-06-17 | Catalog metadata; the separately fetched attribute CSV is registered as S20; ZIP remains unfetched |
| S9 | https://catalogo.datos.gba.gob.ar/api/3/action/package_show?id=circuitos-electorales | PBA catalog; author Poder Judicial de la Nación / Justicia Nacional Electoral / Cámara Nacional Electoral; modified 2026-03-12 | Lists source download site and archive metadata; no archive inspection implied |
| S10 | https://catalogo.datos.gba.gob.ar/dataset/4fe68b69-c788-4c06-ac67-26e4ebc7416b/resource/43d4314f-c540-4b00-8c41-1104141bda19/download/circuitos-electorales-pba.csv | PBA catalog/CNE-authored resource; live CSV; immutable version unavailable | Ten local strings inspected; not proof of geometry/result matching |
| S11 | https://catalogo.datos.gba.gob.ar/api/3/action/package_show?id=secciones-electorales | PBA catalog; IDEBA/IGN; data described as 2022 | Legislative sections, not national partido identity; service not separately fetched |
| S12 | https://deck.gl/docs/developer-guide/base-maps/using-with-maplibre | vis.gl/deck.gl; live integration docs; revision unavailable | Documents compatibility/mode constraints, not Votus runtime validation |
| S13 | https://deck.gl/docs/developer-guide/building-apps | vis.gl/deck.gl; live guide; reference benchmark v9.4.0-alpha.2 | Upstream compressed-size references only |
| S14 | https://deck.gl/docs/developer-guide/performance | vis.gl/deck.gl; live performance guide; revision unavailable | General guidance; no local measurements |
| S15 | https://maplibre.org/maplibre-gl-js/docs/examples/3d-terrain/ | MapLibre; live terrain example; version/date unavailable | raster-dem example does not supply an IGN service |
| S16 | https://www.maplibre.org/maplibre-gl-js/docs/examples/check-if-webgl-is-supported/ | MapLibre; live WebGL support example; version/date unavailable | Failure handling example, not Votus fallback proof |
| S17 | https://www.maplibre.org/maplibre-gl-js/docs/API/type-aliases/MapOptions/ | MapLibre; live API documentation; version/date unavailable | Keyboard/gesture options do not establish accessible exact evidence |
| S18 | https://github.com/visgl/deck.gl/blob/master/LICENSE | vis.gl/deck.gl first-party repository; MIT; live master branch | Exact commit/date not supplied |
| S19 | https://github.com/maplibre/maplibre-gl-js/blob/main/LICENSE.txt | MapLibre first-party repository; BSD-3-Clause terms; live main branch | Exact commit/date not supplied |
| S20 | https://catalogo.datos.gba.gob.ar/dataset/627f65de-2510-4bf4-976b-16035828b5ae/resource/6cd47ea4-37af-4fdb-9d38-678c1067b7e9/download/limite-partidos-pba.csv | PBA catalog/ARBA; live Partidos attribute CSV; immutable version unavailable | Parent fetched and inspected Coronel Rosales `municipio_id=6182`; attribute evidence, not geometry proof |

**Broken ZIP distribution target (not evidence of archive contents):**
https://catalogo.datos.gba.gob.ar/dataset/627f65de-2510-4bf4-976b-16035828b5ae/resource/2cc73f96-98f7-42fa-a180-e56c755cf59a/download/limite-partidos-pba.zip

Parent diagnosis reproduced incomplete transfers for the Partidos and circuit ZIP distributions, despite active catalog/API records. HTTP/2, HTTP/1.1 and bounded byte-range attempts failed to yield complete bytes; the CNE origin separately returned `Request Rejected`. The user also reported broken links in a browser. No ZIP contents were accepted or archived. This is a broken/stale distribution path, not proof that geometry does not exist. The separately fetched CSV [S20] remains attribute evidence only; the official WFS below is the bounded replacement for partido geometry, not for circuits.
