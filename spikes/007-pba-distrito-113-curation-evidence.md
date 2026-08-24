# SPIKE 007 — PBA distrito 113 primary-evidence curation package

**Research and access date:** 2026-08-23

**Scope:** proposed PBA 2025 `distrito_113.html` slice only

**Artifact policy:** primary official evidence only; no candidate or other personal names; no PDF content; no source artifact persisted.

## Executive summary

The jurisdiction crosswalk is **proven** for this one source-native jurisdiction. The official Junta selector and distrito page both identify PBA distrito `113` as `TIGRE`; the official national 2025 archive independently carries the complete tuple `distrito_id=02`, `distrito_nombre=BUENOS AIRES`, `seccion_id=113`, `seccion_nombre=TIGRE`.[S1][S2][S4] This is code-and-name evidence from both numbering schemes, not numeric coincidence or a name-only match. A proposed `113 -> 02/113` row is therefore included below, but still requires human review before `curated/crosswalk.yaml` is changed.

The same national primary source carries `seccionprovincial_id=1` and `seccionprovincial_nombre=Sección Primera` for `02/113`.[S4] That directly proves electoral-section membership, so the official First Section page is admissible as a Senate cross-check. Its 15 list-ID/label pairs exactly equal the 15 Senate-present pairs on distrito 113; no list-ID, label, or category disagreement was found.[S2][S3]

The distrito table has 20 body rows and two vote categories. Each category reconciles exactly as `20 cells = 15 accepted list identities + 2 summary cells + 3 category-absence cells + 0 quarantined/unreadable cells`.[S2] A dash is category absence, never zero votes. Initial classification found 23 exact-label mappings, five identities backed by exact official labels that match existing reviewed `party_name` aliases, and two clear local identities requiring new canonical declarations. Human curation on 2026-08-23 approved the `tigre_municipal` scope, both new local canonical IDs, all five alias-backed mappings, and the exact `113 -> 02/113` crosswalk. All 30 category-present identities are therefore mapping-ready evidence; six category-absence cells produce no mapping key. No implementation change is authorized by this artifact alone.

This package does **not** authorize any YAML, parser, test, manifest, migration, archive, or production change. The current production boundary remains exactly `pba/2025-distrito-027`, normalized to `02/027`; nothing here broadens it by analogy.

## 1. Current repository contracts

Repository evidence establishes these constraints:

- `curated/crosswalk.yaml` contains one reviewed PBA jurisdiction row only: PBA `027` to national `02/027`. The mapping is scheme translation, not padding.
- `curated/party_map.yaml` keys mappings by the full tuple `(year, jurisdiction, category, list_id)`. Numeric recurrence is not identity evidence.
- Existing 2025 PBA mappings cover `coronel_rosales_municipal / CONCEJALES` and `pba_provincial / DIPUTADOS PROVINCIALES`; no `SENADORES PROVINCIALES` or Tigre municipal natural key exists.
- `etl/etl/ingest/pba.py`, `etl/tests/test_ingest_pba.py`, and `etl/sources.yaml` are bound to distrito `027`. The parser requires Deputy and Council headers; `distrito_113.html` instead carries Senate and Council headers.[S2]
- Source kinds must remain separate. This package uses official sources only and makes no claim about fiscalización data.

The conventions above are repository contracts, not substitutes for the primary evidence below.

## 2. Primary source identities

No temporary downloads were created. Junta responses were inspected in memory. The national ZIP was read from its immutable registered archive entry without extracting its members to disk.

| Ref | Official source and exact identity | Retrieval/access evidence | Material fields used |
| --- | --- | --- | --- |
| [S1] | Junta Electoral definitive-results landing page, <https://www.juntaelectoral.gba.gov.ar/escrutinio-definitivo-2025/> | Live 200 on 2026-08-23; MIME `text/html`; 1,044,110 bytes; SHA-256 `d883277ef40423cc5196349e0b2528c56c4f4935744bed4466633f17d7d53032` | Selector option `value="113"` with text `113 - TIGRE`; direct `distrito_113.html` link |
| [S2] | Junta Electoral distrito 113 definitive results, <https://www.juntaelectoral.gba.gov.ar/escrutinio-definitivo-2025/distrito_113.html> | Live 200 on 2026-08-23; MIME `text/html`; 472,248 bytes; SHA-256 `65a3e524b8a1b136960c22deb237b65ad7e6dc48bc5f3ca746770d315bb46b9b`; ETag `"734b8-63fb5caeb2b00"`; Last-Modified `Fri, 26 Sep 2025 15:18:06 GMT` | Page identity `113 - TIGRE`; headers `Lista`, `Partidos políticos`, `Senadores Prov. Tit.`, `Concejales Titulares`; list IDs, party/alliance labels, and category cell presence only |
| [S3] | Junta Electoral First Section definitive results, <https://www.juntaelectoral.gba.gov.ar/escrutinio-definitivo-2025/seccion_1.html> | Live 200 on 2026-08-23; MIME `text/html`; 469,560 bytes; SHA-256 `2feca511c23309ae65e6c2cc74f1498f07cfd8f17043d8830f01e15974bbfe75`; ETag `"72a38-63fb5cb00f520"`; Last-Modified `Fri, 26 Sep 2025 15:18:07 GMT` | Headers `Lista`, `Partidos políticos`, `Senadores Prov. Tit.`; 15 list-ID/label rows plus two summary rows |
| [S4] | Official national 2025 legislative dataset ZIP, <https://datos.mininterior.gob.ar/dataset/947e871a-650e-4b63-8939-ecb29acb717c/resource/a24110fb-bfcf-47a6-8aa7-2e53dab9caf5/download/elecciones_legislativas_2025.zip>; registered archive ref `national/2025-legislativas` / `archive/national/2025-legislativas.zip` | Manifest retrieval `2026-08-04T12:29:56Z`; inspected 2026-08-23; MIME `application/zip`; 13,554,180 bytes; SHA-256 `5fb19bb280af8895dc0bc2ac19d79e836fb4053b713a135357743bf35371ee4b`. Member `ambitosElectorales.csv`: 4,609,488 bytes; SHA-256 `59c0c982380d15e85c94e011e8afdff0aec7110099599fe35df8581d7925c5d0` | One unique tuple across 970 matching records: `año=2025`, `distrito_id=02`, `distrito_nombre=BUENOS AIRES`, `seccionprovincial_id=1`, `seccionprovincial_nombre=Sección Primera`, `seccion_id=113`, `seccion_nombre=TIGRE` |

The official Junta `robots.txt` returned 404 during the same access session. No secondary source substantiates any claim.

## 3. Jurisdiction crosswalk verdict

### Evidence chain

1. The official PBA selector publishes code/name pair `113 - TIGRE` and links the corresponding distrito page.[S1]
2. The linked official distrito page repeats source identity `113 - TIGRE`.[S2]
3. The independent official national archive carries province code/name `02 / BUENOS AIRES` together with section/partido code/name `113 / TIGRE` in the same records.[S4]
4. The national archive also carries provincial electoral section code/name `1 / Sección Primera` for that same `02/113` identity.[S4]

The two schemes therefore agree on both the code and authoritative non-personal place label while the national source supplies the province half. **Verdict: proven for exactly PBA `113` -> national `02/113`.** This verdict says nothing about any other PBA distrito.

### Human-approved proposed row — implementation not yet authorized

```yaml
- pba_distrito: "113"
  national_distrito: "02"
  national_seccion: "113"
  name: "TIGRE"
  verified: true
  source: "spikes/007-pba-distrito-113-curation-evidence.md ([S1], [S2], [S4])"
```

Human review approved this exact row on 2026-08-23. Apply it only inside the separately authorized bounded distrito-113 implementation. `TIGRE` preserves the exact official source label; title-casing it would be an additional normalization decision.

## 4. Category shape and complete accounting

The distrito page declares exactly six columns and 20 body rows. There are 18 list-bearing rows and two summary rows (`VOTOS POSITIVOS`, `VOTO EN BLANCO`).[S2] Only list-bearing, readable vote cells are category identities.

| Distrito | Category | Source category cells | Accepted list identities | Summary cells (`summary_row_without_list_id`) | Absence cells (`list_absent_from_category`) | Unreadable | Quarantined/duplicate | Equation |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| `113` | `SENADORES PROVINCIALES` | 20 | 15 | 2 | 3 | 0 | 0 | `20 = 15 + 2 + 3 + 0 + 0` |
| `113` | `CONCEJALES` | 20 | 15 | 2 | 3 | 0 | 0 | `20 = 15 + 2 + 3 + 0 + 0` |
| **Total** | both categories | **40** | **30** | **4** | **6** | **0** | **0** | `40 = 30 + 4 + 6 + 0 + 0` |

Per-reason accounting is therefore explicit: four summary cells, six category-absence cells, and no unreadable, malformed, conflicting-duplicate, exact-duplicate, or other quarantined cells.[S2] The absence cells are:

| Category | List IDs whose cell is `-` | Required interpretation |
| --- | --- | --- |
| `SENADORES PROVINCIALES` | `193`, `981`, `2205` | Did not participate in this category; emit no Senate result and no Senate party-mapping key |
| `CONCEJALES` | `2202`, `1008`, `963` | Did not participate in this category; emit no Council result and no Council party-mapping key |

A dash or empty category cell is never a zero-vote result. Summary cells are not list identities. Any future parser result that does not reproduce the equations above against the archived bytes must fail closed and report the per-category/per-reason discrepancy.

## 5. Senate section cross-check

Section membership is not inferred from chamber type. The official national member `ambitosElectorales.csv` directly associates `02/113 / TIGRE` with `seccionprovincial_id=1 / Sección Primera`.[S4] Only because that evidence exists was the official First Section page used.[S3]

The distrito has 15 Senate-present list-ID/label pairs. The First Section page has 15 party rows, and the pair sets are exactly equal.[S2][S3] The three distrito-local rows absent from Senate (`193`, `981`, `2205`) do not appear as Senate identities on the section page. No disagreement in list ID, official label, or Senate category was observed. Any future disagreement must block the affected mapping rather than choose one source.

## 6. Mapping-ready party evidence

### Classification rule

- **`verified-existing-canonical`** below means the category-specific official source carries a list ID whose official label is byte-for-text equal to an existing `canonical_parties[].display_name`. The proposal relies on that direct category evidence, not on repeated numeric IDs or a mapping from distrito `027`.
- **`requires-new-canonical`** means the official category identity is clear but no canonical declaration exists for its exact label.
- **`unresolved`** means a likely existing canonical has different spelling, abbreviation, or organizational wording. No normalization is proposed.

Exact-label equality is evidence, not a claim that similarly named legal organizations are universally interchangeable. Every row remains subject to human curation review before YAML application.

### Human-approved exact-label natural keys — implementation not yet authorized

`pba_provincial` follows the existing provincial scope convention. Human review approved `tigre_municipal` as the new internal jurisdiction label on 2026-08-23. None of these exact natural keys currently exists.

| Classification | Year | Jurisdiction | Category | List ID | Exact official label | Proposed canonical | Primary evidence |
| --- | ---: | --- | --- | --- | --- | --- | --- |
| verified-existing-canonical | 2025 | `pba_provincial` | `SENADORES PROVINCIALES` | `2200` | `ALIANZA FUERZA PATRIA` | `FUERZA_PATRIA` | Distrito and First Section agree exactly.[S2][S3] |
| verified-existing-canonical | 2025 | `pba_provincial` | `SENADORES PROVINCIALES` | `2206` | `ALIANZA LA LIBERTAD AVANZA` | `LLA_PRO_ALLIANCE` | Distrito and First Section agree exactly.[S2][S3] |
| verified-existing-canonical | 2025 | `pba_provincial` | `SENADORES PROVINCIALES` | `2204` | `ALIANZA SOMOS BUENOS AIRES` | `SOMOS_BUENOS_AIRES` | Distrito and First Section agree exactly.[S2][S3] |
| verified-existing-canonical | 2025 | `pba_provincial` | `SENADORES PROVINCIALES` | `1006` | `PARTIDO LIBERTARIO` | `PARTIDO_LIBERTARIO` | Distrito and First Section agree exactly.[S2][S3] |
| verified-existing-canonical | 2025 | `pba_provincial` | `SENADORES PROVINCIALES` | `2201` | `ALIANZA POTENCIA` | `POTENCIA` | Distrito and First Section agree exactly.[S2][S3] |
| verified-existing-canonical | 2025 | `pba_provincial` | `SENADORES PROVINCIALES` | `2207` | `ALIANZA UNION Y LIBERTAD` | `UNION_Y_LIBERTAD` | Distrito and First Section agree exactly.[S2][S3] |
| verified-existing-canonical | 2025 | `pba_provincial` | `SENADORES PROVINCIALES` | `974` | `PARTIDO POLITICA OBRERA` | `POLITICA_OBRERA` | Distrito and First Section agree exactly.[S2][S3] |
| verified-existing-canonical | 2025 | `pba_provincial` | `SENADORES PROVINCIALES` | `980` | `PARTIDO TIEMPO DE TODOS` | `TIEMPO_DE_TODOS` | Distrito and First Section agree exactly.[S2][S3] |
| verified-existing-canonical | 2025 | `pba_provincial` | `SENADORES PROVINCIALES` | `1003` | `CONSTRUYENDO PORVENIR` | `CONSTRUYENDO_PORVENIR` | Distrito and First Section agree exactly.[S2][S3] |
| verified-existing-canonical | 2025 | `pba_provincial` | `SENADORES PROVINCIALES` | `959` | `MOVIMIENTO AVANZADA SOCIALISTA` | `MOVIMIENTO_SOCIALISTA` | Distrito and First Section agree exactly.[S2][S3] |
| verified-existing-canonical | 2025 | `pba_provincial` | `SENADORES PROVINCIALES` | `2202` | `ALIANZA ES CON VOS ES CON NOSOTROS` | `ES_CON_VOS` | Distrito and First Section agree exactly.[S2][S3] |
| verified-existing-canonical | 2025 | `pba_provincial` | `SENADORES PROVINCIALES` | `1008` | `VALORES REPUBLICANOS` | `VALORES_REPUBLICANOS` | Distrito and First Section agree exactly.[S2][S3] |
| verified-existing-canonical | 2025 | `tigre_municipal` | `CONCEJALES` | `2200` | `ALIANZA FUERZA PATRIA` | `FUERZA_PATRIA` | Council cell present; exact canonical-label equality.[S2] |
| verified-existing-canonical | 2025 | `tigre_municipal` | `CONCEJALES` | `2206` | `ALIANZA LA LIBERTAD AVANZA` | `LLA_PRO_ALLIANCE` | Council cell present; exact canonical-label equality.[S2] |
| verified-existing-canonical | 2025 | `tigre_municipal` | `CONCEJALES` | `2204` | `ALIANZA SOMOS BUENOS AIRES` | `SOMOS_BUENOS_AIRES` | Council cell present; exact canonical-label equality.[S2] |
| verified-existing-canonical | 2025 | `tigre_municipal` | `CONCEJALES` | `1006` | `PARTIDO LIBERTARIO` | `PARTIDO_LIBERTARIO` | Council cell present; exact canonical-label equality.[S2] |
| verified-existing-canonical | 2025 | `tigre_municipal` | `CONCEJALES` | `2201` | `ALIANZA POTENCIA` | `POTENCIA` | Council cell present; exact canonical-label equality.[S2] |
| verified-existing-canonical | 2025 | `tigre_municipal` | `CONCEJALES` | `2207` | `ALIANZA UNION Y LIBERTAD` | `UNION_Y_LIBERTAD` | Council cell present; exact canonical-label equality.[S2] |
| verified-existing-canonical | 2025 | `tigre_municipal` | `CONCEJALES` | `2205` | `ALIANZA NUEVOS AIRES` | `NUEVOS_AIRES` | Council cell present; exact canonical-label equality.[S2] |
| verified-existing-canonical | 2025 | `tigre_municipal` | `CONCEJALES` | `974` | `PARTIDO POLITICA OBRERA` | `POLITICA_OBRERA` | Council cell present; exact canonical-label equality.[S2] |
| verified-existing-canonical | 2025 | `tigre_municipal` | `CONCEJALES` | `980` | `PARTIDO TIEMPO DE TODOS` | `TIEMPO_DE_TODOS` | Council cell present; exact canonical-label equality.[S2] |
| verified-existing-canonical | 2025 | `tigre_municipal` | `CONCEJALES` | `1003` | `CONSTRUYENDO PORVENIR` | `CONSTRUYENDO_PORVENIR` | Council cell present; exact canonical-label equality.[S2] |
| verified-existing-canonical | 2025 | `tigre_municipal` | `CONCEJALES` | `959` | `MOVIMIENTO AVANZADA SOCIALISTA` | `MOVIMIENTO_SOCIALISTA` | Council cell present; exact canonical-label equality.[S2] |

### Unresolved and new-canonical table

| Classification | Year | Jurisdiction | Category | List ID | Exact official label | Candidate existing canonical | Why no mapping row is proposed |
| --- | ---: | --- | --- | --- | --- | --- | --- |
| unresolved | 2025 | `pba_provincial` | `SENADORES PROVINCIALES` | `2203` | `FTE. DE IZQUIERDA Y DE TRABAJADORES - UNIDAD` | `FIT` | `FTE.` versus canonical `FRENTE`; exact distrito/section agreement proves the source identity but not the spelling normalization.[S2][S3] |
| unresolved | 2025 | `pba_provincial` | `SENADORES PROVINCIALES` | `2208` | `ALIANZA UNION LIBERAL` | `UNION_LIBERAL` | Canonical display omits organizational word `ALIANZA`.[S2][S3] |
| unresolved | 2025 | `pba_provincial` | `SENADORES PROVINCIALES` | `963` | `PARTIDO FRENTE PATRIOTA FEDERAL` | `FRENTE_PATRIOTA_FEDERAL` | Canonical display omits organizational word `PARTIDO`.[S2][S3] |
| requires-new-canonical | 2025 | `tigre_municipal` | `CONCEJALES` | `193` | `ACCION COMUNAL DEL PARTIDO DE TIGRE` | none | Clear Council identity, but no exact canonical declaration exists; a human must choose the internal canonical ID.[S2] |
| unresolved | 2025 | `tigre_municipal` | `CONCEJALES` | `2203` | `FTE. DE IZQUIERDA Y DE TRABAJADORES - UNIDAD` | `FIT` | Abbreviated official wording differs from canonical display; do not inherit another jurisdiction/category mapping.[S2] |
| requires-new-canonical | 2025 | `tigre_municipal` | `CONCEJALES` | `981` | `OPCION VECINAL PARA EL PROGRESO DE TIGRE` | none | Clear Council identity, but no exact canonical declaration exists; a human must choose the internal canonical ID.[S2] |
| unresolved | 2025 | `tigre_municipal` | `CONCEJALES` | `2208` | `ALIANZA UNION LIBERAL` | `UNION_LIBERAL` | Organizational wording differs; do not inherit another jurisdiction/category mapping.[S2] |

Initial classification totals across the 30 category-present identities were **23 `verified-existing-canonical`, 2 `requires-new-canonical`, and 5 `unresolved`**. The six category-absence cells are accounted separately and are not identities to map.

### Human curation decisions — 2026-08-23

- Approved municipal scope: `tigre_municipal`.
- Approved new canonical IDs: `ACCION_COMUNAL_TIGRE` for council list `193` and `OPCION_VECINAL_TIGRE` for council list `981`.
- Approved the five previously unresolved mappings because each exact official label byte-matches a previously reviewed `party_name` alias: Senate `2203 -> FIT`, `2208 -> UNION_LIBERAL`, `963 -> FRENTE_PATRIOTA_FEDERAL`; council `2203 -> FIT`, `2208 -> UNION_LIBERAL`.
- Approved exact jurisdiction crosswalk: PBA `113 -> 02/113`, source-preserved name `TIGRE`.

Post-review outcome: all 30 category-present identities are mapping-ready; none remains unresolved for this bounded slice. These decisions authorize evidence curation only. They do not mutate or authorize changes to YAML, parser, source registration, archive, tests, database, or production.

## 7. Proposed implementation gate — not implemented

The curation gate is complete. A separately authorized implementation must use strict TDD with behavior-level RED evidence produced before implementation:

1. **RED — production entry point:** drive the real CLI `ingest_source` with exact source ID `pba/2025-distrito-113`; prove it is currently unreachable, then require archive lookup, hash verification, parser invocation, curated crosswalk loading, and write-boundary reachability. A direct parser test is insufficient.
2. **RED — exact archive registration and allowlist:** require one HTML registration and exact path `/escrutinio-definitivo-2025/distrito_113.html`; do not permit a directory prefix and do not register or parse the linked PDFs in this slice.
3. **RED — category handling:** require `Senadores Prov. Tit.` -> `SENADORES PROVINCIALES` and `Concejales Titulares` -> `CONCEJALES`; refuse missing or duplicate recognized headers before returning partial rows.
4. **RED — no silent loss:** assert the immutable source accounting in Section 4 per category and reason. A dash must emit absence, not zero; summary rows must remain excluded by named reason; unreadable/short/duplicate cells must quarantine with category-specific counts.
5. **RED — jurisdiction write boundary:** require source-native `113` to resolve to both national components `02/113`, store the partido aggregate at normalized `seccion` granularity, preserve `TIGRE` as the section name, and quarantine every row with per-category counts if the reviewed crosswalk row is absent.
6. **RED — party natural keys:** resolve only reviewed `(2025, jurisdiction, category, list_id)` rows. Assert that absent and unresolved identities remain visibly unmapped and that no numeric ID imports a mapping from distrito `027`, a national source, or another category.
7. **GREEN and reachability:** implement the minimum parser/source/curation changes needed for those RED tests, archive the exact bytes through the existing archive-first path, and prove the production CLI reaches the new source. Keep source kind hardcoded `official` on this path.
8. **TRIANGULATE:** exercise one Senate absence, one Council absence, one unresolved label, one missing-crosswalk full quarantine, one unreadable vote cell, and one source-hash drift refusal. Reconcile accepted + summary + absence + quarantine/unreadable to source totals in every case.

The implementation gate remains bounded to one HTML source. It does not authorize full-corpus ingestion, section-total ingestion, PDF parsing, or any change to the existing `pba/2025-distrito-027 -> 02/027` production behavior.

## 8. Decision summary

| Decision class | Count | Outcome |
| --- | ---: | --- |
| Jurisdiction crosswalk claims proven and approved | 1 | Exact `113 -> 02/113`, name `TIGRE` |
| Jurisdiction crosswalk claims blocked | 0 | None for this exact target |
| Category-present party identities | 30 | Fully accounted and mapping-ready after human review |
| Exact-label mappings approved | 23 | Existing canonicals, category-specific natural keys |
| Existing-alias mappings approved | 5 | Exact official labels match reviewed `party_name` aliases |
| New canonical declarations approved | 2 | `ACCION_COMUNAL_TIGRE`, `OPCION_VECINAL_TIGRE` |
| Party mappings unresolved after review | 0 | None for this bounded slice |
| Category-absence cells | 6 | No result row and no mapping key |
| Unreadable/quarantined source cells | 0 | None observed in the inspected immutable identity |

## Primary official references

- **[S1]** Junta Electoral de la Provincia de Buenos Aires, definitive-results landing page: <https://www.juntaelectoral.gba.gov.ar/escrutinio-definitivo-2025/> (accessed 2026-08-23).
- **[S2]** Junta Electoral de la Provincia de Buenos Aires, distrito `113` definitive results: <https://www.juntaelectoral.gba.gov.ar/escrutinio-definitivo-2025/distrito_113.html> (accessed 2026-08-23).
- **[S3]** Junta Electoral de la Provincia de Buenos Aires, First Section definitive results: <https://www.juntaelectoral.gba.gov.ar/escrutinio-definitivo-2025/seccion_1.html> (accessed 2026-08-23).
- **[S4]** Dirección Nacional Electoral / official national data portal, 2025 legislative dataset: <https://datos.mininterior.gob.ar/dataset/947e871a-650e-4b63-8939-ecb29acb717c/resource/a24110fb-bfcf-47a6-8aa7-2e53dab9caf5/download/elecciones_legislativas_2025.zip>; immutable repository archive identity `national/2025-legislativas`, member `ambitosElectorales.csv` (archive retrieved 2026-08-04; inspected 2026-08-23).

[S1]: https://www.juntaelectoral.gba.gov.ar/escrutinio-definitivo-2025/
[S2]: https://www.juntaelectoral.gba.gov.ar/escrutinio-definitivo-2025/distrito_113.html
[S3]: https://www.juntaelectoral.gba.gov.ar/escrutinio-definitivo-2025/seccion_1.html
[S4]: https://datos.mininterior.gob.ar/dataset/947e871a-650e-4b63-8939-ecb29acb717c/resource/a24110fb-bfcf-47a6-8aa7-2e53dab9caf5/download/elecciones_legislativas_2025.zip
