# Proposal: Electoral Analysis Platform (Votus)

> Phase: `sdd-propose` · Change: `electoral-analysis-platform`
> Input: `openspec/changes/electoral-analysis-platform/exploration.md`

## Intent

Party operators of La Libertad Avanza in Coronel Rosales (PBA, distrito 027) have no
single place to compare official 2023 vs 2025 results. Today the data lives in national
bulk ZIPs, PBA per-distrito PDFs and CKAN aggregates, each with different granularity,
different list numbers and different alliance names. Every question is answered by hand,
inconsistently, and without an audit trail.

Votus is an **internal** tool that ingests PUBLIC official results and answers operator
questions directly:

- In which mesas did we underperform our own 2023 baseline?
- Which establecimientos flipped between 2023 and 2025?
- What is our realistic ceiling in circuito X heading into 2027?
- How much of the 2025 result is LLA proper vs. the PRO fusion?

Success = an operator answers those questions unaided, and can click any number through to
the archived source file it came from.

## Granularity Guarantee (load-bearing)

The contractual requirement is **maximum granularity actually published by the source**,
with mesa level as the target — not a blanket mesa-level promise. Current evidence:

| Level | Year | Category | Finest granularity found | Status |
|---|---|---|---|---|
| National | 2023 | PASO / Generales / Balotaje | mesa (bulk ZIP) | CONFIRMED reachable, schema UNVERIFIED |
| National | 2025 | Legislativas | mesa (bulk ZIP) | CONFIRMED reachable, schema UNVERIFIED |
| PBA provincial | 2023 | Legisladores/Consejeros | distrito totals (PDF) | NOT FOUND at mesa level |
| PBA provincial | 2025 | Legisladores (7 Sep) | distrito pages (`distrito_022.html`) | UNVERIFIED |
| PBA municipal | 2023 | Intendente / Concejales | distrito totals (PDF `2023027.pdf`) | NOT FOUND at mesa level |
| PBA municipal | 2025 | Intendente / Concejales | none identified | NOT FOUND |
| PBA (CKAN) | 2005–2023 | provincial + nacional | municipio aggregate CSV/XLSX | CONFIRMED, no 2025 |

Every figure rendered in the UI MUST carry a visible provenance/granularity indicator, so
an operator always knows whether a number is a mesa-level figure or a distrito aggregate.
Mixing granularities in one comparison MUST be flagged, never silently averaged.

## Scope

### In Scope

1. **SPIKE (first work item, time-boxed, gates everything below).** Download and inspect
   the real national 2023/2025 ZIPs and the PBA endpoints to establish: (a) actual column
   schemas; (b) whether BUP changed the 2025 file format vs 2023; (c) whether national
   distrito codes reconcile with PBA distrito `027`; (d) whether ANY mesa-level PBA or
   municipal source exists (telegramas, per-mesa escrutinio definitivo exports, the
   OpenAPI at `resultados-electorales.argentina.apidocs.ar`). Output: a written granularity
   verdict that converts each UNVERIFIED / NOT FOUND cell above into a commitment.
2. **Immutable raw archive** — provenance-tracked fetch → normalize → sha256 → local mirror
   → manifest, following the sibling repo's `archive.py` / `manifest.py` / `http_client.py`
   patterns (exploration Approach 3). Raw files are never hand-edited.
3. **Normalized relational layer** — a rebuildable projection of the archive, modelling
   distrito / sección / circuito / establecimiento / mesa explicitly, supporting cross-year
   and cross-level queries.
4. **Party/alliance identity mapping** — a first-class, curated, reviewed dataset keyed by
   `(year, jurisdiction, category, list_id)` → canonical party. Covers LLA solo list `135`
   (2023 municipal) vs. "Alianza La Libertad Avanza" with PRO (2025), plus purely local
   lists such as `962 — Agrupación Municipal Primero Rosales`. Never inferred at query time.
5. **Geographic/code crosswalk** — hand-verified mapping between national and PBA
   distrito/circuito/mesa codes and across 2023 → 2025, curated like the mapping layer.
6. **Operator-facing analysis UI** — 2023 vs 2025 comparison at the finest available level,
   per-mesa and per-establecimiento drilldown where confirmed, swing/flip detection,
   and 2027 scenario projection inputs.
7. **Provenance & auditability** — every displayed figure traceable to an archived source
   file, its sha256, its source URL and its fetch timestamp.
8. **Access control** — authenticated, role-gated internal access. No anonymous access.
9. **Disclaimers** — visible "not an official electoral source" notice.

### Out of Scope / Non-Goals

- No padrón, voter roll, or any voter-level personal data.
- No individual-voter targeting, canvassing lists, or contactability features.
- No scraping behind authentication, paywalls, or CAPTCHAs.
- Not an official electoral source; not a public results site; no real-time election-night
  ingestion.
- No years other than 2023 and 2025 in this change (CKAN 2005–2023 history is deferred).
- No jurisdictions outside national / PBA / Coronel Rosales in this change.
- No PDF/OCR extraction pipeline unless the SPIKE proves it is the only path to a
  granularity the user requires — decided after the SPIKE, not now.

## Capabilities

### New Capabilities

- `source-archive`: provenance-tracked immutable fetch/hash/manifest of official sources.
- `electoral-data-model`: normalized jurisdiction/granularity/results schema.
- `party-identity-mapping`: curated list/alliance → canonical party mapping over time.
- `geo-code-crosswalk`: curated national ↔ PBA and 2023 ↔ 2025 code reconciliation.
- `results-analysis`: cross-year comparison, swing/flip detection, 2027 scenarios.
- `provenance-display`: per-figure source + sha256 + granularity indicator in the UI.
- `access-control`: authenticated, role-gated internal access.

### Modified Capabilities

None — greenfield repo, `openspec/specs/` is empty.

## Approach

Exploration **Approach 3 (hybrid)**, already decided: an immutable provenance-tracked raw
archive feeding a normalized relational layer for analysis queries. The relational layer is
a pure rebuildable projection — it can always be dropped and regenerated from the archive,
which is what keeps two layers consistent. Exact technology binding (Next.js/Supabase vs.
Python/uv ETL, or both; Supabase Auth/RLS vs. Clerk) belongs to `sdd-design`.

Strict TDD is mandatory (`strict_tdd: true`); the first implementation task establishes the
test runner. RDD is enabled.

## Affected Areas

| Area | Impact | Description |
|---|---|---|
| `openspec/specs/*` | New | Seven new capability specs |
| repo root | New | Greenfield scaffold + test runner |
| ETL / archive layer | New | Ported from sibling `lla-coronel-rosales` patterns |
| data layer | New | Normalized schema + curated mapping tables |
| web app | New | Operator UI, diverges from sibling's public static site |
| `lla-coronel-rosales` | None | Read-only reference; never modified |

## Delivery Slicing

Sized for `auto-chain` PRs against a 400-line review budget:

1. SPIKE + granularity verdict (findings document, minimal code).
2. Test runner + project scaffold.
3. Source registry + archive/manifest layer (national sources only).
4. National 2023 parser + normalized schema.
5. National 2025 parser + BUP format reconciliation.
6. PBA/municipal ingestion at whatever granularity the SPIKE confirmed.
7. Party identity mapping (curated data + review workflow).
8. Geo-code crosswalk.
9. Access control + auth.
10. Comparison UI with provenance/granularity indicators.
11. 2027 scenario analysis.

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| 1. Distrito/circuito/mesa codes do not reconcile national ↔ PBA or 2023 ↔ 2025 | High | SPIKE item (c); curated crosswalk as a reviewed deliverable, not inferred |
| 2. No mesa-level PBA/municipal source exists | High | SPIKE item (d); granularity table is contractual; UI marks aggregate figures explicitly; PDF/OCR only if SPIKE proves it necessary |
| 3. Party/alliance identity unstable across year/level/category | Confirmed | Curated mapping table with human review; never inferred at query time |
| 4. BUP changed the 2025 file schema | Medium | SPIKE item (b); diff real files before writing a shared parser |
| 5. 2023 PASO ZIP is Wayback-only (~88 MB, slow) | Medium | Archive it early with a generous timeout; sha256 mirror removes future dependency on the source |
| 6. Engram persistence blocked (`ambiguous_project`) | Confirmed | OpenSpec files are the source of truth this session; re-run with cwd inside this repo |
| 7. `juntaelectoral.gba.gov.ar` terms of use never read | Medium | Verify robots.txt / terms before any programmatic fetch of that host |
| 8. Operator misreads an aggregate as a mesa figure | Medium | Mandatory granularity indicator; block silent mixed-granularity comparisons |

## Rollback Plan

- **Pre-merge**: the change is additive to a greenfield repo — `git revert` the slice's PR
  or delete the branch; nothing pre-existing is touched.
- **Data layer**: the relational layer is a projection. Roll back by dropping and rebuilding
  from the raw archive; the archive itself is append-only and never rolled back.
- **Migrations**: every schema migration ships with a down migration.
- **Curated data** (party mapping, crosswalk): version-controlled files — revert the commit
  and rebuild.
- **Per-slice**: each auto-chain PR is independently revertable; reverting a later slice
  never invalidates the archive produced by an earlier one.

## Dependencies

- Network access to argentina.gob.ar, datos.mininterior.gob.ar, catalogo.datos.gba.gob.ar,
  juntaelectoral.gba.gov.ar and web.archive.org.
- Read access to the sibling `lla-coronel-rosales` repo for archive-layer patterns.
- Stack + hosting decision from `sdd-design`.
- Human curator for the party mapping and crosswalk tables.

## Resolved Product Questions

The proposal's open questions have been answered by the product owner and are DECIDED.
They supersede any earlier "TBD" language in this document.

1. **Granularity fallback.** If the SPIKE confirms no mesa-level PBA/municipal source exists,
   distrito-level aggregates ARE ACCEPTED for those categories. OCR of PDFs/telegramas is
   OUT OF SCOPE for this change — it is not a fallback the system will attempt.
2. **2025 PBA provincial election (7 Sep 2025).** IN SCOPE, alongside the 2025 national
   legislative election (26 Oct 2025). Both 2025 electoral events are ingested and analyzed.
3. **Scenario analysis depth.** The tool MUST include real seat-allocation simulation — not a
   trend comparison alone. The simulation MUST model the actual PBA municipal council rule:
   an 18-seat Concejo Deliberante renewing 9 seats per election.

   **Council size, verified against Decreto-Ley 6769/58 (Ley Orgánica de las
   Municipalidades).** Art. 2 sets council size by population bracket: ≤5.000 → 6; 5.000–
   10.000 → 10; 10.000–20.000 → 12; 20.000–30.000 → 14; 30.000–40.000 → 16; **40.000–80.000
   → 18**; 80.000–200.000 → 20; >200.000 → 24. Coronel Rosales had **67.503 inhabitants**
   (INDEC, definitive Censo 2022 results), placing it in the 40.000–80.000 bracket →
   **18 concejales in total**. Art. 3: "durarán cuatro (4) años en sus funciones (…). El
   Concejo se renovará por mitades cada dos (2) años." → **9 seats are allocated per
   election**, which matches the observed 2023 outcome (UxP 3 + JxC 3 + LLA 3 = 9).

   These are TWO DISTINCT numbers and both MUST be stated separately wherever the
   simulation is specified or implemented: council total = 18, seats per election = 9.
   Conflating them is not cosmetic — under the Hare quota the seats-to-fill count is the
   DIVISOR (`valid votes ÷ seats to fill`), so an incorrect seat count silently changes the
   cuociente and therefore which lists clear the bar.

   Art. 4 of the same law confirms the LOM does NOT define its own allocation method:
   "Las elecciones se practicarán en el mismo acto en que se elijan los senadores y
   diputados de conformidad con lo establecido en la **Ley Electoral que rija en la
   Provincia**." A full-text scan of the LOM found no competing allocation rule, so
   Ley 5109 Arts. 109–110 govern.

   **REVISED after the Phase 0 SPIKE (supersedes the earlier "D'Hondt" wording).** The
   allocation method is set by statute and is NOT uniform across levels, so the simulator
   MUST implement two distinct algorithms and select by level:

   - **Coronel Rosales concejales, and PBA provincial legislators — Hare quota with largest
     remainder.** Ley 5109, Capítulo XVI, Arts. 109–110. Art. 109(a): total valid votes
     divided by the number of seats to fill yields the `cuociente electoral`. Art. 109(b):
     each list's votes divided by the cuociente gives its seats; lists below the cuociente
     get no representation. Art. 109(c): remaining seats go to the largest remainders, and
     equal remainders are resolved deterministically in favour of the party with more votes
     — there is no sorteo. Art. 109 final paragraph: blank and annulled votes are EXCLUDED
     from the cuociente denominator. Art. 110: if no party reaches the cuociente, take 50% of
     it, then 50% again, repeatedly, until allocation completes.
   - **National diputados (if ever simulated) — D'Hondt.** Código Electoral Nacional, Ley
     19.945, Art. 161(a). Art. 160 (sustituido por Ley 24.444) sets a 3% threshold measured
     against the **padrón electoral del distrito**, not against valid votes. Art. 161(c)
     resolves a residual tie by **sorteo** of the Junta Electoral, so any deterministic rule
     used there is a declared simulation convention, not the statute.

   **Electoral threshold (piso).** The earlier "UNVERIFIED, default 0%, configurable"
   position is RESOLVED for PBA: Ley 5109 contains no fixed-percentage piso for these
   allocations. The derived `cuociente electoral` is itself the qualifying bar, so a
   percentage parameter does not model the PBA rule and MUST NOT be presented as if it did.
   A percentage threshold parameter remains correct only for the national D'Hondt path,
   where its basis is the padrón.
4. **Geographic breadth.** Ingestion and analysis cover national + PBA-provincial + Coronel
   Rosales (distrito 027) only. Comparative benchmarking against the other 21 partidos of the
   Sexta Sección is explicitly a NON-GOAL of this change and is noted as a likely future
   change.
5. **Access control.** A single authenticated role is sufficient for this change. There is no
   anonymous access. Separate viewer/curator roles are explicitly a NON-GOAL of this change.

## Success Criteria

- [ ] SPIKE completed; every UNVERIFIED / NOT FOUND cell in the granularity table has a
      written verdict, and committed granularity is stated per (level × year × category).
- [ ] National 2023 and 2025 results queryable at the granularity the SPIKE confirmed.
- [ ] PBA provincial and municipal results ingested at their maximum published granularity.
- [ ] Every displayed figure resolves to an archived file + sha256 + source URL.
- [ ] Every displayed figure shows its granularity; mixed-granularity comparisons are flagged.
- [ ] LLA 2023 (list 135) vs 2025 (LLA+PRO alliance) comparable through the curated mapping.
- [ ] Anonymous access is impossible; roles enforced.
- [ ] Zero padrón or voter-level personal data present anywhere in the system.
- [ ] Strict TDD respected: test runner established first, RED-GREEN-REFACTOR throughout.
