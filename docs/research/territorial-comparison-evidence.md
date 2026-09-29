# Territorial comparison: evidence gate

**Current decision: use the updated official ARBA/CNE cartography as the reference for Slice 6, with its date and provenance visible.** The user explicitly superseded the evidence-first implementation hold. Historical boundary equivalence remains unverified, but obtaining issuer confirmation is no longer a prerequisite for this accepted current-reference scope. Do not label current geometry as a certified 2023/2025 edition. No election data, geometry, archive manifest or runtime behavior was changed by this research note.

## Question and accepted contract

Can national `DIPUTADO NACIONAL` results for 2023 generales and 2025 legislativas be compared spatially at Buenos Aires district `02`, Coronel Rosales section `027`?

Two independent obligations remain: comparable territorial boundaries across elections, and applicability of the selected reference geometry to those elections. Equal administrative codes alone do not prove either.

The [accepted proposal](../proposals/2026-09-22-3d-electoral-heroes-and-navigation.md#core-comparison) requires verified comparable territories and metric bases, correspondence evidence or refusal for changed boundaries, and visible missing/left-only/right-only units. Its data boundary permits geometry published at a different date only when election applicability is proven. It does not authorize silent reassignment onto a common reference geography.

## Local evidence located

| Property | Evidence | Limit |
| --- | --- | --- |
| Same national office | `etl/sources.yaml`, `archive-manifest.json`, `curated/party_map.yaml` and `spikes/001-granularity-and-join-keys.md` document the 2023/2025 sources and `DIPUTADO NACIONAL` | A bounded reconciliation of the actual paired result rows has not been run in this investigation |
| Party identity | `curated/party_map.yaml` maps 2023 list `20135` and 2025 list `110` to LLA for the documented scope | Does not prove complete party-union coverage or territorial correspondence |
| Administrative identity | The granularity spike records `02/027` in both years; `curated/crosswalk.yaml` normalizes PBA partido `027` to national `(02, 027)` | Jurisdiction normalization is not a historical boundary crosswalk |
| Reference geometry | `etl/sources.yaml` registers CNE sections and ARBA partido snapshots | Both explicitly lack established election-year applicability; no dated pair or stability proof was located in the bounded local mapping |

Raw votes are a candidate metric, not an assertion that all comparison prerequisites have passed. Category, political identity, boundary correspondence and reference-geometry applicability are separate properties.

## Official-source investigation

The delegated researcher had no web tools and inspected no external sources. The parent then ran two search batches and attempted six official URLs. Search-provider summaries were treated as discovery leads, not verified quotations. No raw geometry or electoral corpus was acquired.

### Inspected primary passage

[Coronel Rosales Municipal Official Bulletin, Ordinance 4352, 26 September 2024, page 14](https://sibom.slyt.gba.gob.ar/bulletins/11354.pdf) states in its historical considerations:

> “N° 7361 fijando el 12 de mayo como fecha de asunción a las nuevas autoridades comunales y estableciendo definitivamente los límites del municipio”

The ordinance concerns the 2025 eightieth-anniversary legend on official municipal documents. It supports a historical account of municipal boundary establishment. It does **not** certify unchanged 2023–2025 electoral boundaries, reproduce a dated electoral boundary pair, or validate the current CNE/ARBA geometry. It is therefore insufficient to pass either spatial obligation.

### Discovery leads and retrieval limits

| Official URL | Observed result | Evidentiary use |
| --- | --- | --- |
| [CNE Acordada 49/2020, judicial collection](https://www.electoral.gob.ar/nuevo/paginas/pdf/judicial_jurisprudencia/AE%20049-20.pdf) | Fetch failed | Unverified lead concerning the national electoral-divisions register; no passage admitted |
| [CNE Acordada 49/2020, alternate collection](https://www.electoral.gob.ar/nuevo_legislacion/pdf/AE%20049-20.pdf) | Fetch failed | Same document, not independent corroboration |
| [CNE map portal](https://mapa2.electoral.gov.ar/) | Extraction reported incomplete content | No dated edition or applicability metadata established |
| [PBA electoral-sections catalog](https://catalogo.datos.gba.gov.ar/dataset/secciones-electorales) | Fetch failed | Unverified lead; do not conflate provincial electoral sections with national section/partido identities |
| [Argentina government result](https://www.argentina.gob.ar/node/170571) | Retrieved a historical biography, not territorial evidence | Rejected as irrelevant |

Failure to retrieve a source and failure to find a change are not evidence that boundaries were unchanged. The initial pass stopped here without new infrastructure, credentials or archive acquisition. The user subsequently chose evidence-first continuation rather than an aggregate-first implementation.

## Evidence-first follow-up

Two further search batches and targeted metadata retrievals were performed after that decision. A raw request to the CNE map portal returned `Request Rejected`; its download page remained unreadable. Acordada 18/2011 was located as a search lead but could not be fetched. No access-control workaround, credential use or source-geometry acquisition was attempted.

The official PBA catalog API was accessible on `catalogo.datos.gba.gob.ar`. The following fields were inspected directly, not inferred from search summaries:

| Primary metadata | Observed fields | Consequence |
| --- | --- | --- |
| [ARBA partidos](https://catalogo.datos.gba.gob.ar/api/3/action/package_show?id=partidos) | `author: ARBA`; `metadata_modified: 2026-06-17T13:29:57.799588`; `version: null`; temporal extra empty; ZIP description ends `Actualización: junio 2026.` | Confirms the current catalog describes a 2026 update, not its applicability to 2023/2025. The original resource creation date in 2019 is not the version date of the current contents |
| [CNE circuits](https://catalogo.datos.gba.gob.ar/api/3/action/package_show?id=circuitos-electorales) | Author identifies the national electoral judiciary/CNE; `metadata_modified: 2026-03-12T17:23:27.942119`; `version: null`; temporal extra empty; source is the CNE download portal; ZIP `last_modified: 2026-03-12T17:23:27.910249` | Confirms issuer attribution and current metadata, not historical applicability. Circuit metadata also does not establish section boundary correspondence |

Both catalogs declare CC BY 4.0. Reuse permission does not prove election applicability. Neither inspected response supplies a versioned 2023/2025 boundary pair, a change crosswalk, or an explicit statement tying its geometry to both elections. Catalog activity records show resource updates, not a legal boundary-change history. Current files must not be silently treated as their original 2018/2019 editions.

### Evidence needed from the issuer

Request the following from the electoral cartography maintainer identified by the CNE catalog, with the ARBA geometry issuer involved if that is the selected source:

1. A dated boundary edition or explicit applicability statement for national district `02`, section `027`, at the 2023 general and 2025 legislative elections.
2. If boundaries changed, the effective dates, authoritative acts and correspondence between the two extents; otherwise an explicit confirmation covering that interval.
3. Identification of the geometry to which the statement applies: layer, edition/date, resource or feature identifier, and a reproducible artifact locator. Once acquired through the existing archive contract, retain its checksum.
4. Clarification that the evidence concerns the national section/Coronel Rosales partido, not Buenos Aires's provincial Sixth Electoral Section or only its child circuits.

Draft institutional request (not sent):

> Solicitamos documentación cartográfica o constancia de aplicabilidad para la sección electoral nacional 027 (Coronel de Marina Leonardo Rosales), distrito 02 (Buenos Aires), correspondiente a las elecciones nacionales generales de 2023 y legislativas de 2025. Necesitamos determinar si sus límites fueron iguales en ambas elecciones y qué edición de la geometría oficial representa dichos límites. Si hubo modificaciones, agradeceremos las fechas de vigencia, los actos que las establecieron y la correspondencia entre las delimitaciones. Rogamos identificar la capa y edición concretas; no se solicita información personal de electores.

No institutional contact was made, and no private project identity was disclosed in the searches.

## Outcome and current decision

- **Historical boundary correspondence:** inconclusive; insufficient evidence gathered.
- **Historical geometry applicability:** inconclusive; insufficient evidence gathered.
- **Accepted next scope:** use updated official ARBA/CNE reference cartography rather than wait for historical editions or issuer confirmation. Preserve source dates, provenance and the distinction between current geographic reference and historical certification. This does not authorize reassignment of historical votes to invented child units.
- **Current aggregate comparison:** remains available; its existing data and access contracts remain intact.

The earlier evidence-first hold and aggregate-first alternative were superseded by the user's explicit instruction to use updated official evidence. The institutional request above is an unsent optional follow-up, not a blocker. Any implementation must carry this scope clarification into the relevant specification rather than silently claim that historical applicability was established.

At the user's request, the parent retried both `https://mapa2.electoral.gov.ar/` and `https://mapa2.electoral.gov.ar/descargas/` with raw fetching. Both returned HTML headed `Request Rejected`; no geometry was retrieved by this retry. The current official catalog metadata and existing archived sources remain distinct from a new successful portal download.

The comparison chart's former `?? 0` fallback for an absent party share has been removed. Route-level tests distinguish a missing party observation from an explicit zero; absence is not displayed as a numeric zero or delta. For the supported spatial pair, the chosen color metric is each election's highest-vote canonical party share of that election's included party votes. Both views use one fixed 0–100% sequential domain; parties may differ, and color does not encode party identity. This documents the implementation choice, not a new browser acceptance result.

## Verification and non-goals

This is a research-only document: no meaningful behavioral RED/GREEN applies. The parent inspected the quoted bulletin passage, source-registry annotations, comparison chart and accepted proposal. No result reconciliation, test suite, build, database query or browser acceptance check was run. No geographical equivalence, full party mapping, production readiness or historical accuracy is claimed. No Slice 1 delivery conclusion is inferred from Slice 5 PR #382.
