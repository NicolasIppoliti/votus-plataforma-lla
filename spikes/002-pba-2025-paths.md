# SPIKE 002 — PBA 2025 result paths for distrito 027 (Coronel Rosales)

> Task 5.0 prerequisite. Performed under D10 etiquette: serial requests only,
> ≥4 s apart, identifying User-Agent (`VotusElectoralAnalysis/1.0`), TLS
> verification on (default `curl`/`requests` behaviour, no `-k`). Navigation
> followed linked pages and the site's own client-side URL-construction
> pattern (revealed in an inline `<script>`, not guessed) — no brute-forcing,
> no general crawl.

## Why task 5.0 exists

The 2023 URL pattern does not extrapolate: `/resultados-generales/2025027.pdf`
returns 404 (both letter cases tried, per the prompt). D10's registered-path
allowlist cannot be seeded from a guessed pattern, so this session discovers
the real 2025 paths by navigating from `/`.

## Navigation trail (each row = one request, in order, ≥4 s apart)

| # | URL | Method | Status | Content-Type | Size | Notes |
|---|---|---|---|---|---|---|
| 1 | `https://www.juntaelectoral.gba.gov.ar/` | GET | 200 | text/html | 13 028 b | Already a known-good reference point. Root page links `href="/escrutinio-definitivo-2025"`. |
| 2 | `https://www.juntaelectoral.gba.gov.ar/escrutinio-definitivo-2025` | GET | 301 | text/html | 369 b | `Location: https://www.juntaelectoral.gba.gov.ar/escrutinio-definitivo-2025/` — trailing-slash redirect, same page, not a new discovery. |
| 3 | `https://www.juntaelectoral.gba.gov.ar/escrutinio-definitivo-2025/` | GET | 200 | text/html | 1 044 110 b | "ELECCIONES PROVINCIALES 2025 - ESCRUTINIO DEFINITIVO" landing page (Junta Electoral de la Provincia de Buenos Aires). Contains a `<select id="select-distrito">` whose `<option value="027">027 - CORONEL ROSALES</option>` confirms the distrito code, and an inline `<script>` that constructs the next URL as `"distrito_" + distrito.value + ".html"` on button click — the site's own documented navigation mechanism, not a guessed pattern. |
| 4 | `https://www.juntaelectoral.gba.gov.ar/escrutinio-definitivo-2025/distrito_027.html` | GET | 200 | text/html | 471 727 b | Distrito 027 results page. See "Data found" below. |
| 5 | `https://www.juntaelectoral.gba.gov.ar/escrutinio-definitivo-2025/concejales/2025027.pdf` | HEAD | 200 | application/pdf | 606 289 b | Linked from page #4 (`Bancas Concejales`). |
| 6 | `https://www.juntaelectoral.gba.gov.ar/escrutinio-definitivo-2025/consejeros/2025027.pdf` | HEAD | 200 | application/pdf | 303 704 b | Linked from page #4 (`Bancas Consejeros Esc.`). |
| 7 | `https://www.juntaelectoral.gba.gov.ar/escrutinio-definitivo-2025/concejales_distri/2025027.pdf` | HEAD | 200 | application/pdf | 303 057 b | Linked from page #4 (`Distribucion de Bancas Concejales`). |
| 8 | `https://www.juntaelectoral.gba.gov.ar/escrutinio-definitivo-2025/consejeros_distri/2025027.pdf` | HEAD | 200 | application/pdf | 302 921 b | Linked from page #4 (`Distribucion de Bancas Consejeros Esc.`). |

Reference points already measured in a prior session (not re-fetched, cited
per the prompt): `/` → 200; `/resultados-generales/2023027.pdf` → 200, real
`%PDF`; `/docs/LEY5109.pdf` → 200; `/robots.txt` → 404; `/resultados-generales/`
→ 403.

## Data found

`distrito_027.html` (row #4) embeds a real, machine-parseable HTML `<table>`
with distrito-level 2025 totals for **two** categories, side by side:

- `Diputados Prov. Tit.` — PBA provincial legislature (maps to
  `ALLOCATION_LEVEL.PBA_PROVINCIAL_LEGISLADORES`)
- `Concejales Titulares` — municipal council (maps to
  `ALLOCATION_LEVEL.PBA_MUNICIPAL_CONCEJALES`)

Header block: `Distrito: 027 - CORONEL ROSALES`, `Electores habilitados:
52.755`, `Total de mesas: 156`, `Mesas escrutadas: 156`, `Porcentaje: 100 %`.
This is a **distrito-level total** — the page reports the fully-scrutinized
aggregate for the whole distrito, with no mesa-by-mesa breakdown in this
view. No mesa/circuito-level HTML source was found; the 156-mesa figure
appears only as an aggregate count, never disaggregated.

Table rows (list id, party, Diputados Prov. votes, %, Concejales votes, %),
transcribed directly from the HTML (real 2025 figures, not estimated):

| Lista | Partido | Dip. Prov. | % | Concejales | % |
|---|---|---|---|---|---|
| 2206 | ALIANZA LA LIBERTAD AVANZA | 15.254 | 48.44 % | 14.550 | 45.06 % |
| 2200 | ALIANZA FUERZA PATRIA | 7.443 | 23.64 % | 7.300 | 22.61 % |
| 2201 | ALIANZA POTENCIA | 3.821 | 12.13 % | 4.540 | 14.06 % |
| 2207 | ALIANZA UNION Y LIBERTAD | 1.686 | 5.35 % | 1.788 | 5.54 % |
| 2204 | ALIANZA SOMOS BUENOS AIRES | 1.492 | 4.74 % | 1.512 | 4.68 % |
| 962 | AGRUPACION MUNICIPAL PRIMERO ROSALES | — | — | 1.384 | 4.29 % |
| 2203 | FTE. DE IZQUIERDA Y DE TRABAJADORES - UNIDAD | 957 | 3.04 % | 1.027 | 3.18 % |
| 2202 | ALIANZA ES CON VOS ES CON NOSOTROS | 189 | 0.6 % | 190 | 0.59 % |
| 1006 | PARTIDO LIBERTARIO | 3 | 0.01 % | — | — |
| 1003 | CONSTRUYENDO PORVENIR | 91 | 0.29 % | — | — |
| 1008 | VALORES REPUBLICANOS | 120 | 0.38 % | — | — |
| 2208 | ALIANZA UNION LIBERAL | 1 | 0 % | — | — |
| 959 | MOVIMIENTO AVANZADA SOCIALISTA | 155 | 0.49 % | — | — |
| 963 | PARTIDO FRENTE PATRIOTA FEDERAL | 74 | 0.23 % | — | — |
| 974 | PARTIDO POLITICA OBRERA | 89 | 0.28 % | — | — |
| 980 | PARTIDO TIEMPO DE TODOS | 115 | 0.37 % | — | — |
| — | VOTOS POSITIVOS | 31.490 | 91.43 % | 32.291 | 93.76 % |
| — | VOTO EN BLANCO | 2.951 | 8.57 % | 2.150 | 6.24 % |
| — | Total de votos | 34.441 | 65.28 % | 34.441 | 65.28 % |

Note: the four linked PDFs (`concejales`, `consejeros`, `concejales_distri`,
`consejeros_distri`) are seat-allocation/bancas documents. **They are PDFs**,
and per `electoral-ingestion` spec, "PDF/telegrama OCR extraction is
explicitly OUT OF SCOPE; the system MUST NOT attempt it." They are recorded
here for completeness (and to justify registering their paths so an operator
can open them manually / archive them as reference documents), but **task
5.4's parser MUST NOT attempt to parse PDF bytes** — only the `distrito_027.html`
table is an in-scope ingestion source. Consejeros escolares vote figures
exist ONLY inside PDFs in this discovery (no HTML table column for that
category), so consejeros escolares stays unavailable for ingestion under this
scope, exactly as the "No PBA source available for a given category" scenario
anticipates.

## Verdict

**A 2025 provincial result document IS reachable** for distrito 027, at
distrito-level granularity, via HTML (not PDF), covering two of the three
categories the proposal names (`Concejales`, `Diputados Prov.`; `Consejeros
Escolares` remains PDF-only and therefore out of scope for parsing). Task
5.0 is NOT a stop condition — the search is not widened into a general
crawl; navigation stayed confined to the `/escrutinio-definitivo-2025/`
subtree reached from the linked landing page.

## Registered paths for `sources.yaml` / `HostPolicy.allowed_path_prefixes` (D10 constraint 7)

Only these confirmed prefixes are registered — bounded surface, no crawling:

- `/escrutinio-definitivo-2025/distrito_027.html` — the ingestion source (HTML table)
- `/escrutinio-definitivo-2025/concejales/2025027.pdf` — reference document only, never parsed
- `/escrutinio-definitivo-2025/consejeros/2025027.pdf` — reference document only, never parsed
- `/escrutinio-definitivo-2025/concejales_distri/2025027.pdf` — reference document only, never parsed
- `/escrutinio-definitivo-2025/consejeros_distri/2025027.pdf` — reference document only, never parsed
