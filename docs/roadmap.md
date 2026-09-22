# Roadmap: Evidence before broader coverage

Cross-workstream planning index grounded in the [11 September audit](audits/2026-09-11-project-status.md).
The [active proposal/PRD](../openspec/changes/operational-verification/proposal.md) owns the first slice;
the [specification](../openspec/changes/operational-verification/specs/operational-verification/spec.md) owns acceptance scenarios. This is not a release certification.

## Status and sequencing

NOW has a constructed documentation procedure; no hosted state has been verified.
Maintainer guidance is delivered and the first bounded cleanup is implemented and locally verified.
The other NEXT workstreams remain independent future changes.
LATER items require their own scope decisions. Horizons are priorities, not dates or estimates.

## NOW — Operational verification

**Status:** documentation constructed; independent lifecycle evaluation pending, no hosted RUN.
**Start here:** [Private operational verification procedure](operational-verification.md), then its evidence template; BUILD/REVIEW stays offline.
**Value:** give responsible internal operators reproducible private diagnosis instead of inferred readiness.
**RUN dependencies:** separately approved future target,
revision, existing identities and selected official 2023/2025 Coronel Rosales `02/027` observations.
**Done when:** the clear operator entrypoint supports bounded alignment/access/aggregate evidence,
explicit unknowns, privacy/30-day retention and stop rules; execution remains separately authorized.
Neither planning completion nor a later report automatically approves or blocks a release.

## NEXT — Maintainer clarity and bounded cleanup

**Status:** guidance and migration inventory/down-path documentation delivered; test-only boundary
scaffolding removed and locally verified. Additional cleanup requires its own scope; no dependency
on hosted verification.
**Value:** one reliable root-level setup/release/rollback navigation path, distinct from the
specific operational-verification procedure; no duplicate operator or runtime framework.
**Dependencies:** inventory current documentation and production callers before editing/removing paths.
**Done when:** root maintainer guidance is usable, migration inventory/down-path documentation
matches current entrypoints, and only proven obsolete paths are removed without contract changes.
Preserve production-used helpers/types in `apps/web/src/lib/results/exploration.ts`;
the obsolete adapter does not justify deleting the whole module.

## NEXT — Actual PASO-scale evidence

**Status:** independent future change, not yet opened; streaming ingestion/validation already exists.
**Dependencies:** separate offline authorization for actual PASO sources, bounded resources and evidence handling.
**Done when:** the real ingestion entrypoint demonstrates actual source-shape/scale behavior,
transactional/idempotent outcomes and memory observations, with per-category/per-reason exclusions.
Synthetic streaming tests or local CI alone do not supply actual-scale evidence.

## LATER — Product breadth and deferred reliability

| Workstream / status | Dependencies | Done condition for a future bounded slice |
| --- | --- | --- |
| PBA municipal expansion — not yet opened | Product-selected territory, official sources, crosswalks, mappings and authorization | A second municipal territory works end to end through ingest, authorized projection and reachable UI, with provenance and granularity visible. |
| Review resolution — not yet opened | Explicit lifecycle, permissions, audit and conflict decisions | An approved resolution workflow is reachable and preserves scoped review evidence; today's intentionally read-only UI is not a defect. |
| Local keyboard flakiness — user-deferred | User resumes the item; bounded reproduction | The reproduced keyboard workflow is reliable without weakening browser checks; not bundled into operational verification. |

Current PBA ETL scope is `027` Coronel Rosales and `113` Tigre;
municipal UI remains `02/027`. Registry/ETL support does not prove hosted/UI availability.
An all-135-partido program is unapproved; establish the second complete municipal path first.

## FUTURE — Territorial intelligence program

**Direction approved; implementation not authorized.** Current routes remain
selector/chart/table-first, without complete source-backed geometry or child-unit
scene contracts. The map becomes the main workspace, not a decorative hero.

Follow the [sequential slice plan](plans/territorial-intelligence-slices.md):

1. Documentation alignment (Slice 0), then source/geometry/terrain feasibility.
2. Immutable geographic archive and reachable validation CLI.
3. Smallest complete Coronel Rosales map, then provincial and national expansion.
4. Territorial election comparison alongside dominance as the core product.
5. Separate Fiscalización heat layer and statutory seat simulation.
6. Future Análisis/Prospectiva foundations, then conditional recommendations.

Each slice must be committed, pushed, reviewed in its own PR and merged before the
next starts. Exact coverage is a feasibility finding, not a roadmap promise.
Provincial/national expansion is not authorization for all-135-partido ingestion;
the existing municipal-expansion workstream must be reconciled with these slices
before overlapping work starts. Specialized modules share foundations, never mix
source kinds, and do not delay the first useful official municipal workspace.

## Boundaries

Preserve source isolation, privacy, statutory algorithms and persisted archive/database contracts.
This roadmap creates no issues, delivery commitments or permission to query, ingest, deploy or repair.