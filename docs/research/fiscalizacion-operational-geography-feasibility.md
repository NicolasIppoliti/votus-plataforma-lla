# Fiscalización internal geography: no-go now, targeted evidence next

## Decision and boundary

**NO-GO for production internal-area operational heat under the current evidence.**
This is not proof that no usable circuit or polling-place source exists.
National 2025 published mesa→place membership has now been inspected, but no usable
target coordinate pairs were found. Election-applicable spatial correspondence and
complete authorized child-level coverage remain missing [S12; S1–S9; R2–R6].

The user chose to **wait for supported internal geography**, not to accept a
whole-section aggregate fill as its substitute. A section total cannot answer
where within Coronel Rosales operational coverage is missing [R4; R6].

This report documents findings only. It authorizes no implementation, ingestion,
source registration, specification/task change, Git delivery or live deployment.
It does not change the delivered boundaries or status of Slices 0–6 [R6].
New source acceptance belongs to the remaining **Slice 2 source/archive gate**
before consumption by Slice 7; source discovery is not source acceptance [R6].

## Evidence provenance and reading guide

Research access date: **2026-09-29**. The parent fetched the primary records below
and supplied bounded observations. This writer did **not** fetch or independently
verify those endpoints, download archives, query private data or run validators.
Repository observations are separately attributed in the locator register.

| Label | What it establishes | What it does not establish |
| --- | --- | --- |
| Fresh primary evidence | Parent-read metadata, legal passages and actual national 2025 CSV inspection [S12] | Geometry topology, accepted sources or certified full mesa universe |
| Repository-contract evidence | Existing identity, privacy, selection and payload contracts | Current loaded inventory or an authorized live response |
| Archive evidence | Previously recorded CNE validation outcome | Outcome for the current downloadable ZIP |
| Search/access lead | A potential authority-owned resource to investigate | Verified contents, absence or acceptance |
| Pending empirical check | A measurement still required | A completed check or a zero count |

Metadata modification dates are not geometry-validity dates. A catalog license
and CRS description do not certify a particular archive's actual contents [S1; S7].
The incumbent territorial report remains historical context, not a fresh replay [R5].

## Three different products, not interchangeable encodings

| Product | Evidence needed | Meaning and limitation |
| --- | --- | --- |
| Circuit area coverage heat | Applicable circuit polygons, unique election membership, observed and expected mesas per circuit | Operational coverage of assigned mesas; not resident-level vote distribution |
| Institution point coverage | Election-local polling-place identity, authoritative location crosswalk, per-place coverage | Coverage at the voting institution; no implied surrounding catchment |
| Whole-section aggregate | Authorized section numerator and official section denominator | Section-wide summary, not internal geography; rejected as the replacement here |

A mesa is located at a voting establishment in the DINE hierarchy [S4, p. 4].
An establishment coordinate locates a voting operation, not a voter's residence.
A school point therefore does not define a circuit polygon, electoral territory,
neighborhood catchment or residential concentration of votes [S4; S8].
No interpolation, extrapolation, spatial smoothing or point-to-area allocation
is supported by the inspected evidence; no statistical representativeness is claimed [R1].

## Fresh primary evidence: circuits

The PBA catalog's circuit package returned successful CKAN JSON [S1].
Its author is Poder Judicial / Justicia Nacional Electoral / Cámara Nacional Electoral.
It declares CC BY 4.0, `isopen: true`, and modification on **2026-03-12**.
Resources include CSV, XLS and a **7,382,682-byte ZIP** described as
SHP/GeoJSON/KML in **EPSG:4326, WGS84**. Version is null and temporal metadata empty.
These are resource descriptions, not freshly inspected geometry or edition proof.
The full geometry ZIP GET (`munabskv-b-1c53`) failed with `IncompleteRead` after
126,660 bytes; no entries, shapes or topology were inspected. A separate transport
diagnostic (`munahtyk-d-t030`, exit 0) saw HEAD 200/application ZIP,
`Accept-Ranges: bytes`, ETag `1773336208.38-7382682`, and Last-Modified 12 March 2026.
Its suffix request for 65,557 bytes returned HTTP **200, not 206**, with
`Content-Range: bytes 0-7382681/7382682`; only 65,558 bytes were read. Range was not honored and
no ZIP directory was inspected. Diagnostic success is not archive/topology PASS;
no slice checksum is represented as a full archive checksum. No retry or bypass followed.

The Coronel Rosales datastore query returned **10 attribute records** [S2].
Published fields are `municipio_id=6182`, `indec_departamento=182` and
`indec_provincia=2`; this report preserves their published scheme contexts.
The target strings are:

- `248`, `249`;
- `0248A`, `0248B`, `0248C`, `0248D`, `0248E`, `0248F`;
- `0249A`, `0249B`.

Ten records do not establish ten accepted polygons, ten current election units,
complete circuit membership or a coverage denominator [S1–S2].
An initial filter using `indec_departamento=06182` returned zero because it used
the wrong field representation. That zero is not evidence of source absence [S2].

The official text of **Resolución 385/1999** describes restructuring circuits
248/249 and creating 248b/249a using prose boundaries [S10].
It is historical legal evidence, not a certificate of the complete ten-unit list
or its validity for elections in 2023 or 2025. No automatic digitization or
boundary repair from that prose is justified.

### Existing archived topology is a separate evidence stream

The previously accepted archive/CLI work reports overlapping `0248B`/`0248C` [R5–R6].
Strict partition validation accepted **zero**; explicit reference-only treatment
retains warnings, `spatial_assignment` unsupported and election applicability unknown.
Reference-only acceptance is not permission to assign fiscal coverage to areas.
This is existing archive evidence, not geometry freshly retrieved from [S1].
No validator was rerun for this report; no automatic overlap repair is proposed.

## Fresh primary evidence: election results and place identity

DINE's results portal describes provisional national results, including local
or provincial simultaneity, CSV downloads and developer API/documentation links [S3].
That publication scope is not proof that a particular downloaded input contains
the fields or companion files needed by this project.

The parent fully read the 13-page extraction of standard **v1.0.8** [S4]:

- Page 4 scopes identifiers per election; cross-process stability is not guaranteed.
- Page 4 places each mesa at a voting establishment.
- Page 5 defines `circuito_id` as a numeric/alphanumeric string and `mesa_id` as integer.
- Page 12 records v1.0.5, dated **13 September 2023**, removing the
  `Locales de Votacion` CSV from the standard's scope.
- The v1.0.8 entry dated **25 September 2025** is a branding revision.

Removal from the standard does **not** mean the actual 2025 polling-place companion
is absent: it was inspected in the official ZIP [S12]. Parser capability [R3] is
separate from actual-file evidence and from source acceptance. Equal identifiers
across elections or registries still do not establish a location crosswalk [S4; S8].

The official DINE national 2025 ZIP returned HTTP 200, application ZIP,
**13,554,180 bytes**, matching its CKAN metadata [S5; S12]. Its pinned SHA256 is
`5fb19bb280af8895dc0bc2ac19d79e836fb4053b713a135357743bf35371ee4b`.
Parent inspections `munagoan-c-ym4a` (2026-09-29T23:10:19.949569Z) and
`munamuzw-e-vxb4` (23:15:22.714894Z) exited 0 with the same checksum; parsing was
in memory, without persisted archive, registration or acceptance. The earlier
`munabskv-a-gojy` failed on AppleDouble decoding after successful ZIP access.
The corrected inspector explicitly excluded **three** `__MACOSX/._*.csv` sidecars
(magic `00051607`) as packaging metadata, not quarantined electoral rows.

Actual entries and uncompressed sizes [S12]:

| Entry | Bytes | Inspection |
| --- | ---: | --- |
| `ambitosElectorales.csv` | 4,609,488 | Header inspected |
| `localesDeVotacionyMesas.csv` | 16,498,900 | Header and all 108,992 records inspected |
| `resultados2025.csv` | 457,673,045 | Header and all 2,295,376 rows scanned |

The actual companion header is:

```text
año,eleccion_tipo,recuento_tipo,distrito_id,distrito_nombre,seccion_id,seccion_nombre,localvotacion_codigo,localvotacion_nombre,localvotacion_direccion,localvotacion_localidad,localvotacion_cp,localvotacion_geolat,localvotacion_geolng,mesa_id,mesa_electores,mesa_tipo
```

For integer district 2 / section 27, the companion contains **153 records**, 153
unique district-section-mesa keys and **31 place codes**, all five characters.
Missing place codes, invalid keys, mesa→multiple-place-code mappings and raw mesa
spelling collisions were each zero. These are 31 **codes**, not measured distinct
physical sites. All target records have year `2025`, election type `LEGISLATIVAS`,
count type `PROVISORIOS`, mesa type `NATIVOS`. There is **no `circuito_id` column**;
a reported zero for multiple circuits in the first inspector was vacuous.

Every target record lacks at least one latitude/longitude component: **zero complete
pairs and zero place codes with usable basic coordinates**. This does not mean both
columns are blank on every record. Finite/range/zero, consistency, co-location and
coarse PBA-envelope checks had no valid pairs to evaluate; their zero counts do not
validate spatial accuracy, position or CRS. Official address/coordinate **columns
exist**, but target coordinates are not usable [S12].

The full results scan found no controlled row-width, district/section or target
mesa-key errors. Its target cohort is year `2025`, election type `GENERALES`, count
type `PROVISORIO`, `cargo_id=3`, `cargo_nombre=DIPUTADO NACIONAL`: **3,060 rows**,
153 district-section-mesa keys and 153 typed keys. Exactly the same 153 composite
keys occur in the companion: results missing companion = 0; companion missing
this category = 0. This proves correspondence **within the published provisional
CSV cohort**, not the complete registered/planned mesa universe or an authorized
live denominator. Mesa-type value equality across files was not compared; equal
typed-key counts do not prove it. No target mesa mapped to multiple circuit IDs.

Raw result circuit IDs are `00248`, `00249`, `0248A`–`0248F`, `0249A`–`0249B`.
Catalog `248`↔results `00248` is a normalization candidate, not geometry-edition
proof or permission to strip suffixes. Companion `LEGISLATIVAS`/`PROVISORIOS` and
results `GENERALES`/`PROVISORIO` differ: acceptance needs an explicit enum mapping,
not silent equivalence or quarantine of these 153 records [S12; R3].

The **26 October 2025** election date is configured in the registry [R2]. The 2023
CKAN search yielded three results entries and a generales ZIP link [S6]; that ZIP
remains uninspected, including its companion inventory.

## Fresh primary evidence: education locations

The education package is authored by DGCyE, declares CC BY 4.0 and was modified
on **2026-09-17**. Its source is the [official school map](https://mapaescolar.abc.gob.ar/mapaescolar/);
resources include CSV, ZIP, XLS and PDF, with the ZIP described as EPSG:4326 [S7].
A current education registry snapshot is not an election polling-place list.

The inspected datastore field list includes `establecimiento_id`, `cue`,
`cueanexo`, `latitud`, `longitud`, `direccion`, modality and level [S8].
It has **no `localvotacion_codigo` field**. No shared-identity crosswalk was established.
Numeric similarity between school and polling-place IDs is not identity proof.
The municipal filter returned **101 education rows**, using `limit=0` [S9].
These are not 101 physical schools, 101 polling places or an election denominator.
Coordinate completeness, precision, accuracy and duplicate-site handling remain unmeasured.
No person/contact values or raw school rows were retrieved for this observation.

An education CUE crosswalk is a possible **independently verified alternative**, not
a necessity inferred from missing companion columns and not accepted through fuzzy
school-name/address geocoding. A **point-based 2025 national pilot remains only a
candidate** after authoritative usable locations and authorized per-establishment
numerators / full official denominators exist. The inspected ZIP supplies no usable
target points; no pilot is accepted or implemented [S12].
Even then it would describe institution-point coverage, not internal area heat [S4; R4].

## Repository contracts: scope, normalization and joins

The configured fiscal source is `fiscalizacion/2025-coronel-rosales`, year 2025,
round `legislativas`, national legislative election on 26 October [R2].
It is local/non-fetchable, `source_kind: fiscalizacion`, and `upload: never`.
The parser defaults to `DIPUTADO NACIONAL`, national district/section `02`/`027`,
with year and round supplied as inputs [R3]. PBA registry `distrito 027` is a
partido code, not national province district `02` [R1–R2].

No 2023 municipal or 2025 PBA fiscal source is registered in the supplied inventory.
That does not prove nothing else is currently loaded; no live inventory was queried.
The separate official 2025 provincial source is district-aggregate only [R2].
The optional provincial HTML lists 52,104 electors and 154 total/scrutinized mesas [S11].
It is not the national/fiscal denominator and must not be compared with historical
93/153 coverage as if they described the same election population [R1; R2].

National ingestion requires district, section, circuit and mesa; it validates circuit-code
format and retains normalized jurisdiction and natural-key lineage [R3].
Numeric circuit strings pad to five digits; suffix codes pad the numeric part to
four and uppercase the letter [R3]. Thus `248` and `0248A` are different identities.
Keep raw keys alongside canonical keys; measure duplicate keys and normalization
collisions on each actual source before joining. Integer casting is not a crosswalk.

Fiscal rows retain mesa, establishment label, votes and source-row indices, but
not circuit or `mesa_tipo` [R3]. Membership is nevertheless **not wholly missing**:
the loader resolves official jurisdiction by election + district + section + mesa,
and accepts only exactly one match; missing or ambiguous matches enter review [R3].
That protects the unique mesa join rather than selecting the first circuit.
Official circuit lineage can exist without proving correspondence to a geometry edition.
A school label does not independently prove official establishment identity.

## Authorized evidence gap and invariants

The current selection is election/category/district/section, with explicit opt-in [R4].
Coverage exposes section `observed_units`/`denominator_units` plus bounded uncovered
items carrying circuit and establishment metadata; it exposes no child-group totals.
The uncovered collection is limited to the first **100**, with total/truncated flags;
the supplied scout reports no pagination. Do not derive child denominators or complete
uncovered distributions from that bounded list, even when metadata names children.
Official facets list children, not fiscal coverage denominators, and official
`mesaCount`/`totalVotes`/party aggregates are not fiscal coverage counts [R4].

Any later child-level evidence must pair observed distinct mesas and the full
expected official mesa universe for the same election/category/jurisdiction/group.
Missing denominator is unknown, not zero. Historical 93/153 is not live proof [R1–R4].
The existing route already guards source opt-in and paired coverage/result consistency
according to the supplied scout; this report does not claim an authorized RPC replay.

Preserve these repository invariants [R1; R2; R4; R6]:

- Never blend official and internal vote figures; official is the default source kind.
- Keep internal coverage opt-in and `is_random_sample` literally false.
- Never infer representativeness or extrapolate missing internal observations.
- Strip fiscal names at ingestion; expose no names, contact details or private archives.
- Surface conflicts, unmapped identities and exclusions by reason, without silent picks.
- Keep exact authorized evidence available when spatial depth is unsupported.

## Unavailable sources and pending checks

CNE/mapa2 downloads returned `Request Rejected`; `mapa.electoral.gov.ar` had DNS failure.
Fetches for CNE 49/2020 and 144/2022 PDFs failed, school-PDF extraction failed,
and several searches timed out. These are access/search leads, not verified passages
or evidence that the resources do not exist. No access controls were bypassed;
repeated failed fetches yielded no verified document passages.

An earlier bounded verifier timeout established neither ZIP success nor failure.
Successful national 2025 inspections [S12] supersede that pending status **only for
those CSV observations**. Geometry contents/topology/edition, 2023 contents and
live authorized RPC remain unverified. No private fiscal archive or personal data
was inspected. The CNE secretariat directory fetch also failed; a search-only mail
lead is not a verified judicial request channel.

## Custody, verified channel and next gate

The Código Electoral Nacional identifies candidate custodians and existing records
[S13]: art. 39 assigns the central division registry to CNE; art. 40 routes the
federal judge's proposed changes through CNE→DINE→Interior approval and preserves
current divisions until changes are approved. Arts. 77–79 govern judicial polling-
place designation, notification to the Junta/Interior and changes; art. 80 requires
Interior to retain designation communications for five years. These mandates are
**not proof** that particular 2025 files or coordinates exist, are disclosable or
are acceptable for this application.

Interior's public information page, updated June 2026, explicitly lists
**infopublica@mininterior.gob.ar**, TAD and in-person RAIP channels [S14]. It states
15 business days, with a reasoned 15-day extension. TAD requires human authentication
and agency selection/submission [S15]. The user reports formal presentation in TAD
with a receipt or case identifier; see the status below. The agent did not log in or submit.
This Executive channel does not automatically cover a judicial CNE request. No personal
contact, procurement address or party-affiliation channel is proposed.

National published membership evidence is now obtained, not accepted. Remaining
location/edition evidence requires an official request or independently accepted
location crosswalk, plus full denominators and authorized internal child numerators.
Future checks must reconcile enum/raw/canonical identities, edition, topology and
coordinate quality; report exclusions/conflicts by reason and group; then apply
Slice 2 acceptance before Slice 7 consumption [R6]. No live date or Slice 7 delivery
is promised; the user's refusal of whole-section substitution remains unchanged.

## Spanish request template — presented in TAD (user-reported)

**Status: awaiting the official response.** The user confirmed formal TAD submission
with a receipt or case identifier. This is user-reported, not independently verified.
The receipt, submission date, recipient and exact submitted text were not inspected;
no identifiers or applicant details are stored here. The wording below is the prepared
template, not a verified copy of the submission. The agent did not log in, submit or
send a duplicate request. No response or accepted geographic evidence is recorded.

> **Asunto: Solicitud de información pública — geografía electoral nacional 2025, Coronel Rosales**
>
> A la RAIP del Ministerio del Interior:
>
> Solicito copia de los registros existentes correspondientes a la elección nacional
> del 26 de octubre de 2025, categoría Diputado Nacional, distrito nacional 02,
> sección 027 (Coronel Rosales). En los CSV provisionales publicados se observaron
> 153 mesas y 31 códigos de local de votación; se trata de una cohorte publicada,
> no de una certificación del universo total de mesas ni de 31 sitios físicos distintos.
>
> Solicito: (1) límites de circuitos y su edición, vigencia y resoluciones aplicables;
> (2) pertenencia oficial circuito–local–mesa y universo oficial de mesas para ese
> ámbito; (3) correspondencia de códigos de locales con instituciones, direcciones
> institucionales y coordenadas existentes, con CRS, procedencia y calidad registrada;
> y (4) equivalencias documentadas de códigos y enumeraciones, si existen, incluidas
> LEGISLATIVAS/GENERALES y PROVISORIOS/PROVISORIO en los archivos publicados.
>
> Agradeceré los formatos tal como se conservan, con versión, licencia y metadatos
> disponibles, sin producir geocodificación ni cálculos nuevos. Si no obran en ese
> organismo, solicito identificar al custodio competente y derivar la solicitud si
> corresponde. Si deben reservarse ubicaciones por privacidad, solicito cantidades
> por motivo e identificadores disociados, sin campos personales.
>
> No solicito registros de votos, nombres, DNI, domicilios particulares de electores,
> fiscales o autoridades de mesa, archivos privados ni estadísticas internas de
> cobertura de fiscalización; únicamente registros de geografía y locales institucionales.
>
> Muchas gracias.

## Source and repository locator register

All S references are parent-supplied primary observations dated 2026-09-29, not writer fetches.

| ID | Primary URL | Inspection boundary |
| --- | --- | --- |
| S1 | https://catalogo.datos.gba.gob.ar/api/3/action/package_show?id=circuitos-electorales | Successful CKAN metadata, not ZIP contents |
| S2 | https://catalogo.datos.gba.gob.ar/api/3/action/datastore_search?resource_id=43d4314f-c540-4b00-8c41-1104141bda19&q=Coronel%20Rosales&limit=20 | Ten attribute records, no shapes/edition certificate |
| S3 | https://www.argentina.gob.ar/dine/resultados-electorales | Original portal read; publication scope only |
| S4 | https://www.argentina.gob.ar/sites/default/files/preservacionresultadoselectorales_1.0.8.pdf | Full 13-page extraction; cited pp. 4, 5, 12 |
| S5 | https://datos.mininterior.gob.ar/api/3/action/package_show?id=947e871a-650e-4b63-8939-ecb29acb717c | Actual 2025 national CKAN metadata; actual-file evidence separately in S12 |
| S6 | https://datos.mininterior.gob.ar/api/3/action/package_search?q=2023&rows=10 | Three relevant entries; linked https://www.argentina.gob.ar/sites/default/files/2023_generales_1.zip not inspected |
| S7 | https://catalogo.datos.gba.gob.ar/api/3/action/package_show?id=4becb4b7-0a21-4fef-8f2c-30df7f345a01 | Education metadata, not election list |
| S8 | https://catalogo.datos.gba.gob.ar/api/3/action/datastore_search?resource_id=3951210e-7e0e-4fed-bbf1-0183e704c9ae&limit=0 | Field schema, no raw rows |
| S9 | https://catalogo.datos.gba.gob.ar/api/3/action/datastore_search?resource_id=3951210e-7e0e-4fed-bbf1-0183e704c9ae&filters=%7B%22municipio_id%22%3A6182%7D&limit=0 | 101 education rows, no coordinate-quality measurement |
| S10 | https://www.argentina.gob.ar/normativa/nacional/norma-56539/texto | Full official Resolución 385/1999, historical boundaries |
| S11 | https://www.juntaelectoral.gba.gov.ar/escrutinio-definitivo-2025/escrutinio-argentinos/distrito_027.html | Provincial HTML only; separate population |
| S12 | https://datos.mininterior.gob.ar/dataset/947e871a-650e-4b63-8939-ecb29acb717c/resource/a24110fb-bfcf-47a6-8aa7-2e53dab9caf5/download/elecciones_legislativas_2025.zip | Actual in-memory ZIP/CSV inspections, pinned checksum and cohort limits above; not accepted |
| S13 | https://www.argentina.gob.ar/normativa/nacional/ley-19945-19442/actualizacion | Official Code arts. 39–40, 77–80; custody mandates, not specific-file availability |
| S14 | https://www.argentina.gob.ar/interior/transparencia/pedirinformacion | Official RAIP institutional email, channels and deadlines; user-reported presentation is recorded separately above |
| S15 | https://www.argentina.gob.ar/solicitar-informacion-publica | Official TAD authentication and submission instructions; the agent did not log in or submit |

Repository locators below retain the prior report's writer-read/scout provenance;
this update did not reread those repository sources:

- **R1:** [AGENTS.md](../../AGENTS.md), rules 2–6, 8, 10–11; writer read completely.
- **R2:** `etl/sources.yaml:217–236` (writer read); `134–145` provincial source
  and remaining registry inventory (supplied scout inspection, no live inventory).
- **R3:** `etl/etl/ingest/fiscalizacion.py:268–297,673–676,891–895,996–1009`
  and `etl/etl/ingest/national.py:46,445–459,497–506,523–531` (supplied scout);
  fiscal resolver `800–867` and `etl/etl/jurisdiction.py:162–175,208–231` (writer read).
- **R4:** `apps/web/src/lib/workspace/fiscalizacion-evidence.ts:8–11,20–42,67–73`
  (writer read); `apps/web/src/lib/workspace/official-facets.ts` and
  `apps/web/src/lib/results/exploration-contract.ts:12–19` (supplied scout);
  paired route guards and no-pagination observation are supplied scout evidence.
- **R5:** [Territorial feasibility report](territorial-source-geometry-terrain-feasibility.md)
  (writer read); `etl/etl/circuit_geometry.py` and `etl/tests/test_cli.py`
  (supplied archive/validator inspection, no fresh test execution).
- **R6:** [Territorial slices plan](../plans/territorial-intelligence-slices.md),
  current status and Slices 2/7 (writer read); source acceptance precedes consumption.
