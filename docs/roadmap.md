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

**Direction approved; Slice 1 feasibility is an unmerged implementation candidate.**
Current routes remain selector/chart/table-first. One ARBA partido reference has a
checksum-backed archive/CLI and a standalone non-production renderer evaluator;
child geometry, terrain and production map scenes are not delivered. The map becomes the main workspace, not a decorative hero.

Follow the [sequential slice plan](plans/territorial-intelligence-slices.md):

1. Documentation alignment (Slice 0), then Slice 1 source/geometry/terrain feasibility;
   final whole-candidate verification, review and merge remain pending.
2. The user pulled partido-only archive/CLI into Slice 1. Remaining Slice 2 work
   validates any newly accepted child/terrain source before that source is used.
3. After Slice 1 merges, the smallest production scope may start without unavailable
   sources: Coronel Rosales partido boundary with existing authorized exact municipal
   results, table/text fallback and explicit unsupported child/terrain states. No
   generic municipality, extrusion or comparison is included.
4. Territorial election comparison alongside dominance as the core product.
5. Separate Fiscalización heat layer and statutory seat simulation.
6. Future Análisis/Prospectiva foundations, then conditional recommendations.

Each slice requires its own reviewed PR and merge before the next starts; none of
those delivery actions has occurred for Slice 1. Exact coverage is a feasibility finding, not a roadmap promise.
Provincial/national expansion is not authorization for all-135-partido ingestion;
the existing municipal-expansion workstream must be reconciled with these slices
before overlapping work starts. Specialized modules share foundations, never mix
source kinds, and do not delay the first useful official municipal workspace.

## Boundaries

Preserve source isolation, privacy, statutory algorithms and persisted archive/database contracts.
This roadmap creates no issues, delivery commitments or permission to query, ingest, deploy or repair.