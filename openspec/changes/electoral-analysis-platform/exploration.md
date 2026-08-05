# Exploration — electoral-analysis-platform

> Phase: `sdd-explore` · Change: `electoral-analysis-platform`
> Persisted by the orchestrator (the explore agent had no write tool; Engram save
> blocked by `ambiguous_project`).

## Current State

Greenfield repo — only `openspec/config.yaml`, `.atl/`, `.engram/config.json` exist,
no source code. `openspec/config.yaml` frames the scope: internal LLA Coronel Rosales
analysis tool, national/PBA/municipal levels, mesa granularity, 2023 + 2025, stack
decision deferred to `sdd-design`.

## Data Sources (verified where stated)

### National — DINE / Ministerio del Interior

- Portals: <https://www.argentina.gob.ar/dine/resultados-electorales>,
  <https://resultados.gob.ar>, <https://resultados.mininterior.gob.ar> — HTML query UI
  plus a documented OpenAPI v3 API (<https://resultados-electorales.argentina.apidocs.ar/>),
  filterable by distrito / sección provincial / sección / circuito / mesa.
- Bulk mesa-level ZIPs, already verified reachable by the sibling `lla-coronel-rosales`
  ETL (`etl/sources.yaml`):
  - 2023 Generales — `https://www.argentina.gob.ar/sites/default/files/2023_generales_1.zip` (~28 MB)
  - 2023 Balotaje — `https://www.argentina.gob.ar/sites/default/files/2023_segundavuelta.zip` (~3 MB)
  - 2023 PASO — official URL now 404s; only surviving copy is Wayback:
    `https://web.archive.org/web/20240106010034if_/https://www.argentina.gob.ar/sites/default/files/dine-resultados/2023-PROVISORIOS_PASO.zip`
    (~88 MB, needs a generous timeout)
  - 2025 Legislativas — `https://datos.mininterior.gob.ar/dataset/947e871a-650e-4b63-8939-ecb29acb717c/resource/a24110fb-bfcf-47a6-8aa7-2e53dab9caf5/download/elecciones_legislativas_2025.zip` (~13.5 MB)
- Schema reference: <https://www.argentina.gob.ar/sites/default/files/preservacionresultadoselectorales_1.0.6.pdf>
  documents a distrito > sección provincial > sección > circuito > mesa hierarchy, CSV/RFC4180.
  **UNVERIFIED**: the exact column names inside the ZIPs — requires direct unzip and inspection.
- Boleta Única de Papel (BUP) debuted nationally in October 2025. The *ballot* change is
  confirmed; whether the published *data file schema* changed vs. 2023 is **UNVERIFIED** —
  diff the actual files before writing a shared parser.

### Province of Buenos Aires — Junta Electoral

- Confirmed: the 7 September 2025 PBA provincial legislative election was held separately
  from the 26 October 2025 national election; `juntaelectoral.gba.gov.ar` ran its own
  "ELECCIONES PROVINCIALES 2025" process
  (e.g. `.../escrutinio-definitivo-2025/distrito_022.html`).
- Directly fetched and read
  <https://www.juntaelectoral.gba.gov.ar/resultados-generales/2023027.pdf>:
  2023 Escrutinio Definitivo, DISTRITO 027 — CORONEL ROSALES, SECCIÓN SEXTA, category
  "Intendente, 9 Concejales y 3 Consejeros Escolares". It contains **only distrito-level
  totals — no mesa or circuito breakdown**:

  | List | Alliance | Votes | Share | Seats |
  |---|---|---:|---:|---|
  | 134 | Unión por la Patria | 12.507 | 35,37 % | Intendencia + 3 concejales + 3 consejeros escolares |
  | 132 | Juntos por el Cambio | 10.630 | 30,06 % | 3 concejales |
  | 135 | La Libertad Avanza | 10.365 | 29,31 % | 3 concejales |
  | 962 | Agrupación Municipal Primero Rosales | 1.857 | 5,25 % | 0 |

  Totals: 153 mesas, 52.194 electores, 39.273 votos.

  **Load-bearing finding**: PBA municipal-category results (intendente / concejales) are
  published as per-distrito PDF totals only at this endpoint.

- `catalogo.datos.gba.gob.ar` (CKAN) exposes two structured bulk datasets, both
  **municipio-level aggregates**, neither covering 2025:
  - `resultados-electorales-provinciales` — "Resultados Generales nivel provincial 2005-2023",
    CSV `.../download/elecciones-generales-2005-2023.csv` plus an XLSX sibling
  - `resultados-electorales-nacionales` — national results by municipio
  - `secciones-electorales` — shapefile / GeoJSON / KML plus CSV/XLSX of section boundaries
    and municipio lists; the page does not document circuito/mesa code mappings.

- **Risk**: no PBA source with confirmed public mesa-level bulk data for provincial or
  municipal categories was found. This directly threatens the "votes per mesa" requirement
  at those levels unless an unsurfaced source exists or the requirement is scoped down.

### Coronel Rosales / Sexta Sección

- Distrito code **027** in PBA numbering (confirmed from the PDF itself).
- Sexta Sección comprises 22 partidos: Adolfo Alsina, Adolfo Gonzales Chaves, Bahía Blanca,
  Benito Juárez, Coronel Dorrego, Coronel Pringles, Coronel Rosales, Coronel Suárez,
  Daireaux, Guaminí, General Lamadrid, Laprida, Monte Hermoso, Patagones, Pellegrini, Puan,
  Saavedra, Salliqueló, Tres Arroyos, Tres Lomas, Tornquist, Villarino.
- Scale (confirmed, Coronel Rosales 2023): 153 mesas, 52.194 electores, 39.273 votos.
  Sexta Sección / PBA-wide / national mesa counts are **UNVERIFIED** — pull real row counts
  from a downloaded ZIP during design rather than estimating.

## Join Keys — the central technical risk

The national preservation standard defines stable-by-design distrito / sección / circuito /
mesa numeric codes, but no evidence was gathered that PBA's own distrito numbering (027 for
Coronel Rosales) matches the national DINE distrito code scheme, nor that circuito/mesa
numbers are stable 2023 → 2025.

**UNVERIFIED and highest-risk.** `sdd-design` MUST cross-reference a real national ZIP's
Coronel Rosales code against `027` and diff both years' files before assuming a shared join
key. A hand-verified crosswalk table is likely required, in the spirit of the sibling repo's
curated `titularidad.yaml` / `vendor_aliases.yaml`.

## Party / Alliance Identity Over Time

- 2023 municipal (Coronel Rosales): LLA ran solo as list `135 — LA LIBERTAD AVANZA`;
  UxP as `134`; JxC as `132`; plus the purely local `962 — AGRUPACIÓN MUNICIPAL PRIMERO
  ROSALES`, absent from any national or provincial dataset.
- 2025 PBA provincial: LLA fused with PRO as "Alianza La Libertad Avanza" (single ballot line).
- 2025 national legislative: LLA reportedly fronted with PRO nationally as well, against
  Peronism's "Fuerza Patria" (successor branding to 2023's "Unión por la Patria").
  Exact per-district list numbers for 2025 are **UNVERIFIED** — check against the downloaded
  2025 ZIP's `Agrupaciones` / `Listas` tables.

Net: list numbers and alliance names are unstable across year, jurisdiction level, and even
across categories within the same year. A party-identity mapping table
(list/alliance id → canonical party, keyed by year + jurisdiction + category) is mandatory.

## Prior Art — `lla-coronel-rosales` (read-only, not modified)

- `etl/sources.yaml` — already has an `electoral` capability with the four national entries
  above, pre-verified with content-length checks. Directly reusable as the seed registry
  (no PBA or municipal entries exist there yet).
- `etl/etl/config.py` — trivial YAML loader; `"electoral"` is already in `KNOWN_CAPABILITIES`
  but never built out (no `electoral.py` build script exists). This project builds the
  transform layer for the first time; it is not a straight port.
- `etl/etl/archive.py` + `etl/etl/manifest.py` — the reusable core: fetch → per-capability
  normalization (strip volatile tokens before hashing) → sha256 → local mirror → optional R2
  upload → manifest upsert with explicit content-drift and failed-refetch handling.
- `etl/etl/http_client.py` — thin `requests` wrapper with retry/backoff and a descriptive
  User-Agent; useful for the slow Wayback-hosted 2023 PASO ZIP (`timeout: 180`).
- **Not reusable**: `apps/web` there is a public, unauthenticated static-data Next.js site.
  This project needs real access control, so the web app must diverge.

## Approach Comparison — ingestion layer

| Approach | Pros | Cons | Effort |
|---|---|---|---|
| 1. Python ETL → versioned static JSON in repo (dondevalaplata pattern) | ~80 % reuse of `archive.py` / `manifest.py` / `sources.yaml`; zero infra; fully auditable via git | Mesa-level data across 2 years × 3 levels is hundreds of thousands of rows — bloats git history and diffs; poor fit for ad-hoc scenario queries; no native access control | Medium |
| 2. Python/TS ETL → Supabase Postgres, queried at runtime | Relational DB fits mesa-level joins, aggregation and scenario queries; Supabase Auth/RLS provides access control; owner has direct experience with this stack | New infra vs. the sibling's zero-infra approach; needs upfront schema and party-mapping design; raw files still need a provenance story | Medium–High |
| 3. Hybrid — immutable provenance-tracked raw archive + Postgres normalized layer | Keeps the audit-trail strength (matters for credibility) while enabling real analysis queries; raw archive is reprocessable without re-fetching fragile sources (e.g. the Wayback-only PASO ZIP) | Two layers to keep consistent — mitigated because Postgres is a pure rebuildable projection, never hand-edited | Medium–High, but ~80 % of the archive layer is reusable |

### Recommendation

**Approach 3.** Reuse `lla-coronel-rosales/etl/etl/{archive,manifest,http_client,storage}.py`
almost as-is for an immutable, sha256'd, provenance-tracked raw archive, feeding a Supabase
Postgres normalized layer gated by Supabase Auth/RLS. It is the only option satisfying both
the multi-year / multi-jurisdiction mesa-level query flexibility requirement and the
internal-tool access-control requirement, while preserving existing provenance discipline.

### Access control

Supabase Auth + RLS is the lower-friction choice given the recommended data layer, and it
matches the owner's documented convention (`SECURITY DEFINER is_admin()`, never inline
subqueries on the same table). Clerk remains a documented alternative. Final decision belongs
to `sdd-design`.

## Legal / Ethical Framing

All identified sources (argentina.gob.ar / DINE, datos.mininterior.gob.ar,
catalogo.datos.gba.gob.ar CKAN, juntaelectoral.gba.gov.ar) publish official, already-public
results — this is aggregation of public data, not personal data. No robots.txt or
terms-of-use text was directly read for these hosts — **UNVERIFIED**; check once a fetching
strategy is chosen, particularly for `juntaelectoral.gba.gov.ar`, whose per-distrito pages
are HTML/PDF-only with no declared bulk-download terms, making programmatic fetching closer
to scraping than to downloading an open dataset.

Nothing identified involves padrón or voter-level personal data, consistent with the stated
non-goals. The tool MUST carry a visible "not an official electoral source" disclaimer —
recommended as an explicit `sdd-spec` requirement.

## Non-Goals (recorded)

- No voter-level or padrón personal data.
- No individual-voter targeting.
- No scraping of anything behind authentication.

## Risks

1. Distrito / sección / circuito / mesa code stability across national-vs-PBA numbering and
   across 2023 → 2025 is UNVERIFIED — resolve by direct file inspection before design locks
   a join strategy.
2. No confirmed public mesa-level source for PBA provincial or municipal categories — either
   an unidentified source exists, PDF/telegram scraping is required, or granularity must be
   scoped down explicitly.
3. Party/alliance identity is confirmed unstable — the mapping layer requires ongoing manual
   curation.
4. BUP's effect on the 2025 file format is unverified — diff real files before building a
   shared parser.
5. The 2023 PASO ZIP is Wayback-only (~88 MB, slow) — a soft long-term availability risk.
6. Persistence gap: Engram save blocked by `ambiguous_project` (session cwd contains multiple
   git repos). Fix: run the session with cwd inside this repo.

## Ready for Proposal

Yes, with two caveats:

1. Mesa-level granularity is confirmed only for NATIONAL categories. PBA provincial and
   municipal mesa-level availability is unresolved and may need scope negotiation.
2. The distrito / circuito / mesa crosswalk across national and PBA, and across years, must
   be verified by direct file inspection rather than assumed from documentation.
