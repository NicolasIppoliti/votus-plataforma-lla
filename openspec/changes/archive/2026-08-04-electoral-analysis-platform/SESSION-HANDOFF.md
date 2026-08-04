# Session Handoff — electoral-analysis-platform

> Written because Engram was unavailable for the whole session
> (`ambiguous_project`: the session cwd was `~/dev`, which contains ~25 git repos).
> Nothing was lost — every artifact is on disk. Read this file first in the next session,
> then persist its contents to Engram under `sdd-init/votus-plataforma-lla` and
> `sdd/electoral-analysis-platform/*`.

## Project

**Votus** — internal electoral analysis tool for the La Libertad Avanza structure in
Coronel Rosales (Partido de Coronel de Marina Leonardo Rosales, Buenos Aires Province).
Ingests PUBLIC official election results for 2023 and 2025 at national, PBA-provincial and
municipal levels, at the finest granularity each source actually publishes, to support
scenario comparison heading into 2027.

Repo: `/Users/nicolasmateoippoliti/dev/votus-plataforma-lla` (greenfield, no source code yet).

## SDD Session Preflight (re-use these; do not re-ask)

| Setting | Value |
|---|---|
| `execution_mode` | `auto` |
| `artifact_store` | `hybrid` (OpenSpec files + Engram — Engram half still pending) |
| `delivery_strategy` | `auto-chain` |
| `chain_strategy` | not yet collected (ask only when chaining actually triggers) |
| `review_budget_lines` | `400` |
| `strict_tdd` | `true` |
| RDD (receipt-driven development) | `on`, decided by global scope |

## Completed phases

1. **Repo init** — `git init` + one empty commit; `gentle-ai skill-registry refresh` (82 skills
   at `.atl/skill-registry.md`); `gentle-ai review mode enable` → RDD on.
2. **`sdd-init`** — `partial`. OpenSpec bootstrapped (`openspec/config.yaml` with `strict_tdd`,
   delivery block, per-phase rules). Engram half NOT written.
3. **`sdd-explore`** — `openspec/changes/electoral-analysis-platform/exploration.md` (193 lines).
4. **`sdd-propose`** — `.../proposal.md` (210 lines), including a `## Resolved Product Questions`
   section appended after the user answered.
5. **`sdd-spec`** — 8 delta capability specs under `.../specs/` (548 lines total), verified on disk.

## Next phase

**`sdd-design`** (model: `opus`). Not started. It must:

- Decide the stack. Candidate from exploration: Python/uv ETL producing an immutable
  sha256-tracked raw archive (reusing the `lla-coronel-rosales` sibling patterns) feeding a
  Supabase Postgres normalized layer, with a Next.js App Router front end on Vercel.
  **Not locked** — `openspec/config.yaml` explicitly defers this to design.
- Bind the SPIKE (see Risk 1) as the first work item, before any join strategy is locked.
- Resolve the four spec-level open items listed under "Open items" below.

## Resolved product decisions (binding)

1. **Granularity fallback** — if the SPIKE confirms no mesa-level PBA/municipal source exists,
   ACCEPT distrito-level aggregates for those categories. OCR of PDFs/telegramas is OUT OF SCOPE.
2. **2025 PBA provincial election (7 Sep 2025)** — IN SCOPE, alongside the national legislative
   election (26 Oct 2025). They were separate processes.
3. **Scenario analysis depth** — real seat-allocation simulation required: D'Hondt for Coronel
   Rosales concejales, with a configurable threshold parameter. Not just trend comparison.
4. **Geographic breadth** — national + PBA-provincial + Coronel Rosales only. Benchmarking
   against the other 21 partidos of the Sexta Sección is a NON-GOAL of this change.
5. **Access control** — a single authenticated role suffices. No anonymous access. Separate
   viewer/curator roles are a NON-GOAL of this change.

## Capabilities specified

`source-archive` · `jurisdiction-model` · `electoral-ingestion` · `party-identity-mapping` ·
`results-analysis` · `seat-simulation` · `access-control` · `provenance-display`

All requirements use RFC 2119 keywords and carry Given/When/Then scenarios written to be
directly translatable into failing tests first (strict TDD — the scenarios ARE the test contract).

## Load-bearing findings

### Granularity is NOT uniform

Verified by directly reading
<https://www.juntaelectoral.gba.gov.ar/resultados-generales/2023027.pdf>:

| Level | Mesa-level? | Source |
|---|---|---|
| National 2023 / 2025 | CONFIRMED | DINE bulk ZIPs |
| PBA provincial 2025 | NOT FOUND | Junta Electoral, HTML/PDF only |
| Municipal (intendente / concejales) | NO — distrito totals only | `2023027.pdf` |

Coronel Rosales 2023 baseline (distrito 027, Sección Sexta): 153 mesas, 52.194 electores,
39.273 votos. UxP 12.507 (35,37 %) won the intendencia + 3 concejales; JxC 10.630 (30,06 %)
3 concejales; **LLA 10.365 (29,31 %) 3 concejales**; Agrupación Municipal Primero Rosales
1.857 (5,25 %) 0 seats.

The spec therefore contractualizes "maximum granularity the source actually publishes", with
degradation that MUST be surfaced, never silent, plus a visible granularity indicator in the UI.

### Confirmed national bulk sources

- 2023 Generales — `https://www.argentina.gob.ar/sites/default/files/2023_generales_1.zip` (~28 MB)
- 2023 Balotaje — `https://www.argentina.gob.ar/sites/default/files/2023_segundavuelta.zip` (~3 MB)
- 2023 PASO — official URL 404s; Wayback only:
  `https://web.archive.org/web/20240106010034if_/https://www.argentina.gob.ar/sites/default/files/dine-resultados/2023-PROVISORIOS_PASO.zip`
  (~88 MB, needs a 180 s timeout)
- 2025 Legislativas — `https://datos.mininterior.gob.ar/dataset/947e871a-650e-4b63-8939-ecb29acb717c/resource/a24110fb-bfcf-47a6-8aa7-2e53dab9caf5/download/elecciones_legislativas_2025.zip` (~13.5 MB)

All four already exist, pre-verified, in the sibling repo's `etl/sources.yaml` under the
`electoral` capability — but that repo never built the transform layer, so this is not a port.

### Reusable prior art — `lla-coronel-rosales` (read-only, DO NOT modify)

`etl/etl/archive.py`, `manifest.py`, `http_client.py`, `storage.py` — fetch → normalize →
sha256 → local mirror → R2 upload → manifest upsert with content-drift and failed-refetch
handling. Its `apps/web` is NOT reusable: it is a public unauthenticated static site, whereas
Votus needs real access control.

Note: `lla-coronel-rosales` is the "dondevalaplata" project — an explicitly neutral,
non-partisan citizen transparency portal. Votus is a separate partisan internal tool and must
stay in its own repo.

## Open risks

1. **Join keys — highest risk, UNVERIFIED.** No evidence that PBA distrito numbering (`027`)
   matches the national DINE distrito code scheme, nor that circuito/mesa codes are stable
   2023 → 2025. The SPIKE must cross-reference a real national ZIP against `027` and diff both
   years before design locks a join strategy. A hand-curated crosswalk table is likely required.
2. **No confirmed mesa-level PBA/municipal source.** Resolution policy already decided (accept
   distrito aggregates), but the SPIKE should still check the OpenAPI at
   <https://resultados-electorales.argentina.apidocs.ar/> and any per-mesa escrutinio-definitivo
   export before conceding.
3. **Party/alliance identity is unstable.** LLA ran solo as list `135` in the 2023 municipal
   race, then fused with PRO as "Alianza La Libertad Avanza" for the 2025 PBA provincial race.
   Exact 2025 list numbers are UNVERIFIED — read them from the downloaded ZIP's
   `Agrupaciones`/`Listas` tables. The mapping table needs ongoing human curation.
4. **BUP format drift.** Boleta Única de Papel debuted nationally in Oct 2025. The ballot change
   is confirmed; whether the published file schema changed vs. 2023 is UNVERIFIED. Diff real
   files before writing a shared parser.
5. **`juntaelectoral.gba.gov.ar` robots.txt / terms of use never read** — UNVERIFIED. Its pages
   are HTML/PDF-only with no declared bulk-download terms, making programmatic fetching closer
   to scraping than to open-data download. Check before building a fetcher for that host.
6. **2023 PASO ZIP is Wayback-only** — soft long-term availability risk; archive it locally early.

## Open items for `sdd-design`

1. PBA concejal electoral threshold (piso) is UNVERIFIED — the spec mandates a configurable
   parameter defaulting to 0 %. Confirm the real value from a legal source if possible.
2. D'Hondt quotient tie-breaking rule is unspecified upstream — design must pick one and cite it.
3. Mixed-granularity comparison resolution (auto-aggregate-and-label vs. require explicit
   operator choice) was left as an inclusive OR in `results-analysis` — design must pick one
   deterministically.
4. The mechanism for "surfacing" degradation / unmapped-party / content-drift conditions
   (log vs. UI banner vs. review queue) is behavior-only in the spec — design must bind it.

## Non-goals (recorded)

No padrón or voter-level personal data. No individual-voter targeting. No scraping behind
authentication. Not presented as an official electoral source — a visible disclaimer is a spec
requirement. No OCR of result PDFs in this change. No Sexta Sección benchmarking in this change.
No viewer/curator role split in this change.

## Engram gap — how to fix

The Engram MCP server resolves the project from the **process cwd**, not from the `project`
parameter. This session started in `~/dev`, which contains ~25 git repos, so every `mem_save`
returned `ambiguous_project` with `available_projects: ["argentina-mcp", "auto-etl"]` — the
recovery token was useless because this repo was not in that list.

Fix — start the next session from inside the repo:

```bash
cd ~/dev/votus-plataforma-lla && claude
```

`.engram/config.json` already pins `{"project": "votus-plataforma-lla"}`; it takes effect on a
fresh MCP session. General rule: one repo, one session — never launch from `~/dev`.

Once Engram resolves, persist: `sdd-init/votus-plataforma-lla`,
`sdd/electoral-analysis-platform/explore`, `.../proposal`, `.../spec`.

## Uncommitted state

All files above are on disk and **uncommitted** (the repo has a single empty initial commit).
Nothing was committed because RDD is on and no review receipt exists yet.
