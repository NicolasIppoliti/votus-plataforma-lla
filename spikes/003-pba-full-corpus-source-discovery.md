# SPIKE 003 — PBA 2025 full-corpus source discovery

**Research date:** 2026-08-22  
**Scope:** official 2025 Buenos Aires provincial and municipal definitive-election sources beyond the currently supported partido `027`.  
**Artifact policy:** primary official sources only. No candidate names, personal data, credentials, or source artifacts were persisted. Network responses were inspected as streams; no temporary downloads were created.

## Executive summary

The Junta Electoral de la Provincia de Buenos Aires publishes a static definitive-results landscape with two navigable aggregate levels:

- a landing page that enumerates **135 source-native `distrito` codes** (partidos/municipalities) and all **8 electoral sections**;
- one HTML results page per selected distrito and one HTML results page per selected electoral section, reached by the landing page's own `distrito_<value>.html` and `seccion_<value>.html` navigation logic.[S1]

All eight section pages were reachable and machine-readable on the research date. Capital, Second, Third, and Sixth report provincial-deputy totals; First, Fourth, Fifth, and Seventh report provincial-senator totals.[S6][S7][S8][S9][S10][S11][S12][S13] This agrees with the official election call for the 7 September 2025 general election.[S2]

Three district pages were inspected without recording candidate names:

- `027` has provincial-deputy and municipal-council columns.[S3]
- `063` has the same category pair but a materially larger jurisdiction and nearly no category-absence cells.[S5]
- `113` replaces the provincial-deputy column with a provincial-senator column while retaining municipal council, so it is a bounded next **one-district** ingestion slice that exercises a genuinely unsupported source shape.[S4]

The official election call includes provincial legislators, municipal councillors, and school councillors.[S2] The sampled distrito HTML pages expose provincial legislator and municipal council vote columns, but not school-councillor vote columns.[S3][S4][S5] They link school-councillor PDFs; those PDF contents were not extracted because this repository excludes PDF/OCR ingestion and this research must not capture candidate names. Therefore machine-readable school-councillor vote coverage remains **unknown**, not zero and not unavailable by inference.

There is no verified bulk ZIP/CSV or first-party data API in the inspected definitive-results pages. The observed delivery is static HTML plus linked PDFs, with no pagination controls and no client-side API request in the landing page.[S1][S3][S4][S5] A separate official election portal links a results hostname, but that hostname did not resolve during this research, so its formats and coverage are inaccessible and cannot substantiate ingestion decisions.[S14][S15]

## 1. Exact implemented and production-reachable boundary

This section records repository evidence, not a proposal.

### 1.1 Registered and archived sources

`etl/sources.yaml` registers exactly five PBA 2025 entries:

1. `pba/2025-distrito-027` — the only ingestible HTML source;
2. four distrito-027 council/school-council seat or distribution PDFs — archive-only references.

`archive-manifest.json` has successful immutable archive records for those same five entries. The HTML archive is `archive/pba/distrito_027.html`, 471,727 bytes, SHA-256 `b46c1fbe90bd6e623b1c2dcac88790243e7d585890a46afd4290f1ded7a9f852`. A live streamed GET on 2026-08-22 produced the same byte count and hash.[S3]

The test fixture is only a 6,641-byte slice of the archived page, SHA-256 `cef1642726d87f98267289cc68b1dac17e57561fda1ab200acddb6978c020440`; it is not a second corpus source.

### 1.2 Reachability, not helper existence

The production CLI path is reachable for the registered HTML entry:

`ingest_source` resolves the exact registered source, requires a successful manifest record, verifies the archive hash, enforces `text/html`, calls `ingest_pba`, loads the caller-selected curated crosswalk, and then calls `load_pba_rows`. The four PDFs fail the ingest MIME boundary and remain archival references.

The current host policy allows only the five exact distrito-027 paths. It intentionally does **not** allow the landing page, other district pages, section pages, or a directory prefix. Tested helper behavior therefore does not make any additional source production-reachable.

### 1.3 Parser and normalization boundary

The parser requires both recognized headers:

- `Diputados...` → `DIPUTADOS PROVINCIALES`;
- `Concejales...` → `CONCEJALES`.

A Senate-bearing page such as distrito `113` lacks the required Deputy header and would currently be refused as incomplete schema, even though its HTML table is structurally similar.[S4] The parser emits source-native partido totals at `distrito` granularity; the reviewed crosswalk then translates only PBA `027` to normalized `02/027` and stores the partido total at normalized `seccion` granularity. No other PBA distrito code has a curated jurisdiction crosswalk entry.

### 1.4 Curated party boundary

The current party evidence is deliberately narrow:

- 2025 municipal mappings are scoped to the `coronel_rosales_municipal` jurisdiction and `CONCEJALES` list IDs observed on distrito `027`;
- 2025 PBA provincial mappings are scoped to `pba_provincial`, `DIPUTADOS PROVINCIALES`, and list IDs observed on distrito `027`;
- the results-exploration jurisdiction selector recognizes only archive entry `pba/2025-distrito-027`, normalized `02/027`, and those two categories before returning either curated party jurisdiction.

There is no reviewed Senate mapping and no reviewed municipal mapping for another partido. Repeated numeric list IDs across distrito, section, or category pages are **not** evidence of identity. Expansion must retain unresolved IDs as unmapped until reviewed primary evidence exists; it must never reuse the `027` mapping by numeric coincidence.

## 2. Verified official source landscape

### 2.1 Election and legal category scope

Decree 639/2025 called the Buenos Aires electorate to a general election on **7 September 2025** for:

- provincial senators and deputies;
- municipal councillors;
- school councillors.

It assigns the provincial chambers by electoral section: Capital/Second/Third/Sixth elect deputies, while First/Fourth/Fifth/Seventh elect senators.[S2]

### 2.2 Landing-page coverage and navigation

The definitive-results landing page contains:

- `select-distrito`: 135 unique three-digit values;
- `select-seccion`: 8 values (`8` Capital and `1` through `7` for First through Seventh);
- client-side navigation that constructs `distrito_<selected value>.html` and `seccion_<selected value>.html`;
- direct map links to district and section pages.[S1]

This verifies the **published selectable corpus**, not universal reachability of every generated district URL. Only the three district pages below and all eight section pages were fetched in this bounded research.

### 2.3 All selectable partidos/municipalities

The following are the exact Junta labels and codes from `select-distrito`; they are preserved as source evidence and are not canonical-name normalization decisions.[S1]

| Code and official label | Code and official label | Code and official label |
| --- | --- | --- |
| `001` ADOLFO ALSINA | `002` ALBERTI | `003` ALMIRANTE BROWN |
| `004` AVELLANEDA | `005` AYACUCHO | `006` AZUL |
| `007` BAHIA BLANCA | `008` BALCARCE | `009` BARADERO |
| `010` ARRECIFES | `011` BERAZATEGUI | `012` BERISSO |
| `013` BOLIVAR | `014` BRAGADO | `015` BRANDSEN |
| `016` CAMPANA | `017` CAÑUELAS | `018` CAPITAN SARMIENTO |
| `019` CARLOS CASARES | `020` CARLOS TEJEDOR | `021` CARMEN DE ARECO |
| `022` PATAGONES | `023` CASTELLI | `024` COLON |
| `025` CORONEL DORREGO | `026` CORONEL PRINGLES | `027` CORONEL ROSALES |
| `028` CORONEL SUAREZ | `029` CHACABUCO | `030` CHASCOMUS |
| `031` CHIVILCOY | `032` DAIREAUX | `033` DOLORES |
| `034` ENSENADA | `035` ESCOBAR | `036` ESTEBAN ECHEVERRIA |
| `037` EXALTACION DE LA CRUZ | `038` FLORENCIO VARELA | `039` GENERAL ALVARADO |
| `040` GENERAL ALVEAR | `041` GENERAL ARENALES | `042` GENERAL BELGRANO |
| `043` GENERAL GUIDO | `044` GENERAL LA MADRID | `045` GENERAL LAS HERAS |
| `046` GENERAL LAVALLE | `047` GENERAL MADARIAGA | `048` GENERAL PAZ |
| `049` GENERAL PINTO | `050` GENERAL PUEYRREDON | `051` GENERAL RODRIGUEZ |
| `052` GENERAL SAN MARTIN | `053` SAN MIGUEL | `054` GENERAL VIAMONTE |
| `055` GENERAL VILLEGAS | `056` ADOLFO GONZALES CHAVES | `057` GUAMINI |
| `058` HIPOLITO YRIGOYEN | `059` BENITO JUAREZ | `060` JUNIN |
| `061` LA MATANZA | `062` LANUS | `063` LA PLATA |
| `064` LAPRIDA | `065` LAS FLORES | `066` LEANDRO N. ALEM |
| `067` LINCOLN | `068` LOBERIA | `069` LOBOS |
| `070` LOMAS DE ZAMORA | `071` LUJAN | `072` MAGDALENA |
| `073` MAIPU | `074` MAR CHIQUITA | `075` MARCOS PAZ |
| `076` MERCEDES | `077` MERLO | `078` MONTE |
| `079` MORENO | `080` MORON | `081` NAVARRO |
| `082` NECOCHEA | `083` NUEVE DE JULIO | `084` OLAVARRIA |
| `085` PEHUAJO | `086` PELLEGRINI | `087` PERGAMINO |
| `088` PILA | `089` DEL PILAR | `090` PARTIDO DE PINAMAR |
| `091` PUAN | `092` QUILMES | `093` RAMALLO |
| `094` RAUCH | `095` RIVADAVIA | `096` ROJAS |
| `097` ROQUE PEREZ | `098` SAAVEDRA | `099` SALADILLO |
| `100` SALLIQUELO | `101` SALTO | `102` SAN ANDRES DE GILES |
| `103` SAN ANTONIO DE ARECO | `104` SAN CAYETANO | `105` SAN FERNANDO |
| `106` SAN ISIDRO | `107` SAN NICOLAS | `108` SAN PEDRO |
| `109` SAN VICENTE | `110` SUIPACHA | `111` TANDIL |
| `112` TAPALQUE | `113` TIGRE | `114` TORNQUIST |
| `115` TRENQUE LAUQUEN | `116` TORDILLO | `117` TRES ARROYOS |
| `118` TRES DE FEBRERO | `119` PARTIDO DE LA COSTA | `120` PARTIDO DE MONTE HERMOSO |
| `121` VEINTICINCO DE MAYO | `122` VICENTE LOPEZ | `123` PARTIDO DE VILLA GESELL |
| `124` VILLARINO | `125` ZARATE | `126` TRES LOMAS |
| `127` FLORENTINO AMEGHINO | `128` PRESIDENTE PERON | `129` JOSE C. PAZ |
| `130` MALVINAS ARGENTINAS | `131` PUNTA INDIO | `132` EZEIZA |
| `133` ITUZAINGO | `134` HURLINGHAM | `135` LEZAMA |

### 2.4 Electoral-section pages

All eight official section HTML pages returned machine-readable tables on 2026-08-22. Each page is a single section aggregate, reports electors/mesa totals and scrutiny percentage, and has one provincial category plus percentage columns; there is no pagination.[S6][S7][S8][S9][S10][S11][S12][S13]

| Source value | Official section | Provincial category in HTML | Body rows | Streamed SHA-256 |
| --- | --- | --- | ---: | --- |
| `8` | Capital | Diputados Prov. Tit. | 18 | `0344441ade66693c3fe8bdc5ba5f755ca79584a702a54d76676baabf434ecdbb` [S6] |
| `1` | First | Senadores Prov. Tit. | 17 | `2feca511c23309ae65e6c2cc74f1498f07cfd8f17043d8830f01e15974bbfe75` [S7] |
| `2` | Second | Diputados Prov. Tit. | 17 | `c739779605a203e858129d0ee256a2a9dcfc1a434a4bc1be8c586ff1db6edddc` [S8] |
| `3` | Third | Diputados Prov. Tit. | 18 | `9defaa4c3714bca36e8891a171a4ca80a7c0b100d9a27193df9f8851d65536d9` [S9] |
| `4` | Fourth | Senadores Prov. Tit. | 18 | `317ec1f3bddd33a5c25afba72c068c4c2da6bb4e7c5bca318d28be1137690ca5` [S10] |
| `5` | Fifth | Senadores Prov. Tit. | 17 | `ec19144d692d7166ea13eaea8620d453cd181416d09cb3c51cb3d086a8b0f50d` [S11] |
| `6` | Sixth | Diputados Prov. Tit. | 17 | `fa00564cba6b82ff183716a4a6ca96b6e0f5a54cbb2d9509338741ccaf87463b` [S12] |
| `7` | Seventh | Senadores Prov. Tit. | 16 | `915acab69e82963d66f5becdf97e15181fa46e06d7751bd0418e777861319ec7` [S13] |

Section `1`, for example, reports `5,131,861` electors, `14,533` total mesas, `14,533` scrutinized mesas, and `100%`; the table remains a section total and does not expose mesa rows.[S7]

Each section page also links two section-level PDFs (`seccion/...pdf` and `seccion_distri/...pdf`). Their content was not extracted, so their exact internal schema and candidate-level content remain unknown.

## 3. Shape verification from three district samples

All measurements below came from streamed official HTML responses on 2026-08-22. Party labels were not copied into this artifact.

| Distrito | Reported aggregate | HTML category columns | Table shape | Category-absence behavior | Linked PDF mechanics |
| --- | --- | --- | --- | --- | --- |
| `027` | 52,755 electors; 156/156 mesas; 100% | Provincial deputies; municipal council | 18 body rows, each 6 cells; 3- and 4-digit list IDs | 1 deputy cell and 8 council cells are `-`/empty; 2 summary rows have no list ID | Four relative PDFs using `2025` + zero-padded distrito code [S3] |
| `063` | 639,839 electors; 1,840/1,840 mesas; 100% | Provincial deputies; municipal council | 19 body rows; 3- and 4-digit list IDs | 1 `-`/empty cell in each vote category; 2 summary rows have no list ID | Same four-path family with code `063` [S5] |
| `113` | 363,425 electors; 1,027/1,027 mesas; 100% | **Provincial senators**; municipal council | 20 body rows, each 6 cells; 3- and 4-digit list IDs | 3 `-`/empty cells in each vote category; 2 summary rows have no list ID | Same four-path family with code `113` [S4] |

Streamed file evidence:

- distrito `027`: 471,727 bytes; SHA-256 `b46c1fbe90bd6e623b1c2dcac88790243e7d585890a46afd4290f1ded7a9f852`.[S3]
- distrito `063`: 472,071 bytes; SHA-256 `2c9dd56362a8f04478b5cea7f48ecf8f9e1078951b9646e0f4d2f3819d263ad3`.[S5]
- distrito `113`: 472,248 bytes; SHA-256 `65a3e524b8a1b136960c22deb237b65ad7e6dc48bc5f3ca746770d315bb46b9b`.[S4]

### 3.1 Granularity

The sampled district pages contain one already-aggregated result per list/category. The mesa counts are metadata only; there are no mesa, circuit, establishment, or polling-place identifiers in the result table.[S3][S4][S5] Section pages similarly publish section aggregates.[S6][S7][S8][S9][S10][S11][S12][S13]

District totals and section totals are different source grains. Ingesting both must never sum or deduplicate them as if they were peer rows.

### 3.2 Identifiers and code schemes

Verified source-native identifiers are:

- distrito selector/page code: zero-padded three digits (`001`–`135`, not presented in numeric order in the selector);[S1]
- section selector/page code: `1`–`8`, with `8` labeled Capital;[S1]
- list identifier: the first table column, observed as two to four decimal digits across section pages and three to four digits in the three district samples;[S3][S4][S5][S6][S7][S8][S9][S10][S11][S12][S13]
- category identifier: human-readable header text, not a published stable machine code;[S3][S4][S5]
- PDF filenames: sampled district PDFs use `2025` plus the three-digit distrito code, while section PDFs use textual section tokens.[S3][S4][S5][S6][S7][S8][S9][S10][S11][S12][S13]

None of these proves equivalence to the repository's national jurisdiction codes or party identities. Crosswalk and party normalization remain independently reviewed curation decisions.

### 3.3 Internal-list behavior

The definitive HTML presents one row keyed by `Lista` plus party label and one vote cell per displayed category. No separate internal-list identifier, sublist field, pagination token, or candidate identifier was observed in the landing page, the three district samples, or the eight section pages.[S1][S3][S4][S5][S6][S7][S8][S9][S10][S11][S12][S13]

That observation does **not** prove that internal lists never existed elsewhere in the election process. It proves only that this definitive-results HTML shape does not expose an internal-list dimension. A repeated list number must not be merged across categories or jurisdictions without primary evidence.

### 3.4 Download and archival properties

The HTML and PDF links are direct static paths, not paginated API responses. The landing page performs browser navigation; it does not expose a bulk-download action or make an observed `fetch`/AJAX data request.[S1] The pages can be archived as immutable repository copies by recording exact bytes, retrieval time, source URL, MIME, size, and SHA-256. The upstream URL itself is not versioned and supplied no useful `ETag`/`Last-Modified` evidence in the sampled HEAD responses, so upstream immutability must not be assumed.

## 4. Verified facts, hypotheses, unknowns, and inaccessible sources

### Verified facts

- The election date and legal category set are defined by official Decree 639/2025.[S2]
- The Junta landing page enumerates 135 district choices and 8 section choices and owns the page-construction mechanism.[S1]
- All eight section pages were reachable and exposed the chamber/category split recorded above.[S6][S7][S8][S9][S10][S11][S12][S13]
- The three sampled distrito pages are static, single-table aggregates with different category-absence patterns; distrito `113` has a Senate header that the current parser does not support.[S3][S4][S5]
- Distrito `027` live bytes still matched the repository archive hash on 2026-08-22.[S3]

### Bounded hypotheses — not ingestion authority

- Because the landing page enumerates 135 values and constructs a district page path from each value, the remaining 132 district pages are likely intended to exist. They were not fetched, so this is not a reachability claim.[S1]
- The repeated four-PDF relative-path family in all three district samples suggests a corpus-wide naming convention. It must be verified per district before registration; paths must not be guessed.[S3][S4][S5]

### Unknowns

- Reachability, hash, exact headers, and row accounting for the other 132 district pages.
- A primary official district-to-electoral-section crosswalk suitable for normalization. Chamber headers show the elected chamber but do not establish the repository's canonical national `02/<seccion>` pair.
- Whether every district HTML omits school-councillor votes; omission was verified only in the three samples.
- Whether linked school-councillor PDFs contain vote totals, seat calculations, candidate details, or some combination. Their contents were deliberately not extracted.
- Whether a maintained official bulk download or API exists outside the inspected pages.
- Whether any list ID has the same party identity across districts/categories. No such mapping may be inferred.

### Inaccessible official source

The official Buenos Aires election portal links `http://resultados.eleccionesbonaerenses.gba.gob.ar/` as its results destination.[S14] DNS resolution failed on 2026-08-22, so no claim is made about that host's election phase, granularity, API, downloads, identifiers, or archival suitability.[S15] It remains locator evidence only until the primary host is accessible and directly inspected.

## 5. Mandatory observability for every exclusion or quarantine

Any future discovery or ingestion slice must reconcile accepted data with a **per-category, per-reason** breakdown. A total-only warning is insufficient.

| Risk | Required observable breakdown |
| --- | --- |
| Landing-listed district URL is missing, redirects unexpectedly, times out, or changes MIME | Per distrito code and reason/status; aggregate counts by reason. Never omit the district from the run summary. |
| Expected chamber or council header is absent/duplicated/renamed | Per distrito, source header, normalized category (if unambiguous), and schema reason. Ambiguous headers remain unnormalized. |
| Summary row is excluded | Per distrito and category, reason `summary_row_without_list_id`, source row count, and excluded vote-cell count. |
| `-`/empty category cell means a list did not compete in that category | Per distrito/category/list ID and reason `list_absent_from_category`; never convert to zero. |
| Vote cell is unreadable | Per distrito/category/reason with safe source row index and character-shape evidence; do not log raw text if it could contain personal data. |
| Row is short or has extra cells | Per distrito/category/reason and observed cell count versus declared header count. |
| Duplicate semantic result | Per distrito/category/list ID/reason, all source row indices, and whether vote values agree; accept none until reviewed. |
| Jurisdiction code lacks reviewed crosswalk evidence | Per source distrito/reason and affected row count by category; write no guessed canonical jurisdiction. |
| Party/list lacks reviewed mapping evidence | Per source distrito/category/list ID/reason; retain as visibly unmapped and never reuse another district's mapping by numeric coincidence. |
| School-councillor category is absent from HTML or only a PDF link is known | Availability matrix per distrito/category/reason (`html_absent`, `pdf_link_only_uninspected`, `source_inaccessible`); never emit zeros. |
| Both district and section aggregates are archived | Per source/granularity/category accounting; never sum section totals with constituent district totals. |
| Archived bytes drift at the same URL | Per archive entry/URL/reason with expected and observed hash/size; stop rather than silently replacing authority. |
| Personal/candidate content appears during source inspection | Per artifact/type/reason count only; redact values and prevent fixture/log/doc persistence. |

Every run should report, for each distrito and category:

`source rows/cells = accepted + expected exclusions + quarantined + unavailable`

The equation must be backed by reason-level counts and must fail closed when it does not reconcile.

## 6. Bounded next ingestion slice

### Recommendation: one district, `113`, HTML only

Use distrito `113` as the next bounded slice, **not** a full-corpus batch. It is one official district page with the same broad six-column district-table layout as `027`, but its provincial category is `Senadores Prov. Tit.` rather than `Diputados Prov. Tit.`. It therefore tests a genuinely different source shape while keeping source count, archival footprint, and jurisdiction-correlation work bounded.[S4]

This recommendation does not authorize the URL in production, add a crosswalk, or map any party. Those remain reviewed changes.

### Acceptance evidence for that future slice

1. **Source authority:** direct navigation evidence from the official landing selector to distrito `113`, plus archived URL, retrieval time, MIME, byte count, and SHA-256.[S1][S4]
2. **Immutable archive:** read-back hash matches the manifest before parsing; source drift is a stop condition.
3. **Schema evidence:** exact source headers and a category-aware accounting of all body rows/cells, including the observed Senate/council `-` cells and summary rows.[S4]
4. **Production reachability:** an end-to-end CLI test drives registered archive lookup, verified read, parser, crosswalk load, and write boundary. A helper-only parser test is insufficient.
5. **Jurisdiction authority:** a separately reviewed primary-source crosswalk proves the source distrito's normalized jurisdiction. Numeric-code identity is not assumed.
6. **Party authority:** each mapped `(year, jurisdiction, category, list_id)` has reviewed primary evidence. Every remaining list ID is visibly unmapped with a per-category breakdown; no mapping is copied from distrito `027`.
7. **No silent loss:** accepted, excluded, quarantined, and unavailable counts reconcile per category and reason.
8. **Granularity:** stored rows remain partido totals; no mesa/circuit/establishment values are fabricated from aggregate mesa metadata.
9. **Category availability:** school-councillor HTML absence is reported as unavailable/unknown for this slice, not zero; linked PDFs remain archive-only unless a separately approved non-OCR extraction scope is established.

### Non-goals

- Loading all 135 districts or any section aggregate.
- Designing migrations, parser architecture, or production code.
- Inferring party identity, district crosswalks, or section membership from codes/names.
- Parsing or OCR-ing PDFs.
- Fabricating mesa/circuit/establishment detail.
- Recovering or reverse-engineering the inaccessible results hostname.
- Treating the three sampled district shapes as proof of all 135 pages.

## 7. Source-confidence limits

Confidence is **high** for the election call, landing-page selectable coverage, all eight section-page category headers, and the three streamed district shapes because each was read directly from an official primary source on 2026-08-22.[S1][S2][S3][S4][S5][S6][S7][S8][S9][S10][S11][S12][S13]

Confidence is **bounded** for corpus-wide district reachability and shape because only three of 135 district pages were fetched. Confidence is **none** for party equivalence beyond existing reviewed mappings, a full PBA-to-national jurisdiction crosswalk, machine-readable school-councillor votes, and the inaccessible results host. Those are explicitly unknown and must not be normalized or silently skipped.

## Primary sources

All sources below are official first-party government/election sources. Access date for every entry: **2026-08-22**.

- **[S1]** Junta Electoral de la Provincia de Buenos Aires, definitive-results landing page: <https://www.juntaelectoral.gba.gov.ar/escrutinio-definitivo-2025/>
- **[S2]** Provincia de Buenos Aires, official normative system, Decree 639/2025: <https://normas.gba.gob.ar/documentos/0ZYM5GiE.html>
- **[S3]** Junta Electoral, distrito `027` definitive results: <https://www.juntaelectoral.gba.gov.ar/escrutinio-definitivo-2025/distrito_027.html>
- **[S4]** Junta Electoral, distrito `113` definitive results: <https://www.juntaelectoral.gba.gov.ar/escrutinio-definitivo-2025/distrito_113.html>
- **[S5]** Junta Electoral, distrito `063` definitive results: <https://www.juntaelectoral.gba.gov.ar/escrutinio-definitivo-2025/distrito_063.html>
- **[S6]** Junta Electoral, Capital section definitive results: <https://www.juntaelectoral.gba.gov.ar/escrutinio-definitivo-2025/seccion_8.html>
- **[S7]** Junta Electoral, First section definitive results: <https://www.juntaelectoral.gba.gov.ar/escrutinio-definitivo-2025/seccion_1.html>
- **[S8]** Junta Electoral, Second section definitive results: <https://www.juntaelectoral.gba.gov.ar/escrutinio-definitivo-2025/seccion_2.html>
- **[S9]** Junta Electoral, Third section definitive results: <https://www.juntaelectoral.gba.gov.ar/escrutinio-definitivo-2025/seccion_3.html>
- **[S10]** Junta Electoral, Fourth section definitive results: <https://www.juntaelectoral.gba.gov.ar/escrutinio-definitivo-2025/seccion_4.html>
- **[S11]** Junta Electoral, Fifth section definitive results: <https://www.juntaelectoral.gba.gov.ar/escrutinio-definitivo-2025/seccion_5.html>
- **[S12]** Junta Electoral, Sixth section definitive results: <https://www.juntaelectoral.gba.gov.ar/escrutinio-definitivo-2025/seccion_6.html>
- **[S13]** Junta Electoral, Seventh section definitive results: <https://www.juntaelectoral.gba.gov.ar/escrutinio-definitivo-2025/seccion_7.html>
- **[S14]** Official Buenos Aires election portal (owner of the results-host link): <https://eleccionesbonaerenses.gba.gob.ar/>
- **[S15]** Official results hostname linked by [S14], **inaccessible during research**: <http://resultados.eleccionesbonaerenses.gba.gob.ar/>

No secondary source is cited. A search engine was used only to locate the official decree and does not substantiate any claim.
