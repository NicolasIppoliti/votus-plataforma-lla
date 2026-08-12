# Design: Results Exploration UI
## Technical Approach
Extend `/drilldown` and `/fiscalizacion` as authenticated, server-rendered explorers. Read-only Postgres RPCs provide facets, official aggregation, and coverage without transferring mesa rows or hitting PostgREST's row cap. Existing Auth/RLS, canonical parties, source isolation, and provenance remain authoritative.
## Architecture Decisions
| Option | Tradeoff | Decision and rationale |
|---|---|---|
| Aggregate in React vs Postgres | React would transfer and paginate millions of rows. | Use read-only `security invoker` RPCs, executable only by `authenticated`; Postgres remains the query boundary. |
| New route vs extend `/drilldown` | A new route duplicates an entry point. | Extend `/drilldown`, relabel navigation “Explore results,” and preserve deep links, proving layout reachability. |
| Selector hierarchy vs source-backed facets | Orphan lower selectors can cross administrative parents. | The RPC requires every supplied lower selector's complete parent chain; source-backed facets remain optional until selected. |
| Raw PBA granularity vs normalized lineage | Raw `distrito` collides with national province `02`; migration 0017 normalizes partido 027 to `02/027`. | Derive effective `sección` reporting from exact PBA provenance plus normalized lineage; never expose that partido total as province/distrito. |
| New provenance behavior vs reuse | No provenance delta exists. | Reuse `ProvenanceLink`, `SourceDisclaimer`, refusals, and archive references unchanged. |
## Data Flow
`authenticated layout → /drilldown → repository → authenticated RPC → RLS-visible official rows → party totals/facets`. Coverage independently follows `/fiscalizacion → coverage RPC → official mesa denominator → fiscalización presence`, and links uncovered identities back to official `/drilldown` results.
RPCs compare codes exactly against normalized `jurisdiction`; web code never rewrites them. Official aggregation filters `source_kind = 'official'` and returns an ordered per-kind row/vote audit derived from the included rows; the parser and page independently refuse any non-official included kind. Coverage derives official mesas, then left-matches fiscalización presence. It returns covered/uncovered mesas and, only when official rows carry establecimiento identity, escuelas derived from them. A school is covered with at least one covered mesa and uncovered with none; covered/total counts expose partial presence. Missing official rows refuse the denominator; missing establecimiento identity returns `source_unavailable`, never zero schools.
## Interfaces / Contracts
`ExplorationSelection` carries election/category IDs, distrito/sección codes, optional circuito/establecimiento codes, and optional mesa ID. `ExplorationResult` is `ok`, `no_rows`, `source_unavailable`, or `denominator_unavailable`. Party rows carry canonical identity, votes, share, mesa count, source level, and archive IDs; unresolved lists remain separately tallied.
`CoverageResult.ok` carries labelled scope; `mesas: { covered, uncovered }`; and `escuelas`, either `{ status: "available", covered, uncovered }` or `{ status: "source_unavailable", reason }`. Identities carry official-result links; schools include covered/total mesa counts. Coverage carries presence, never votes. The route MUST state: uncovered means no fiscalización presence, not missing or zero official votes; official results remain separately available.
## Testing Strategy
| Layer | What to Test | Approach |
|---|---|---|
| Unit | Contracts, hierarchy, refusals | RED-first Vitest route tests render both sets, the distinction, and unavailable schools. |
| Integration | RLS, lineage, mappings, filters, denominator | Disposable Supabase fixtures prove both coverage levels; an uncovered mesa with positive official votes remains available only through the official RPC. |
| E2E | Reachability, separation, deep links | Playwright asserts notice/school lists, then follows an uncovered identity to official `/drilldown`. |
## Migration / Rollout
Apply the additive RPC/index migration before the web change. No data rewrite, flag, or fabricated jurisdiction is required; rollback drops new functions/indexes and restores prior pages.
