# Territorial Intelligence — Merge-Gated Delivery

**Planning only; no implementation authorization.** Deliver territorial dominance and
comparison first, then separate specialized modules. Current selector/chart/table
workflows remain usable until replaced by verified vertical slices.
[Product](../../PRODUCT.md) · [Design](../../DESIGN.md) ·
[Proposal](../proposals/2026-09-22-3d-electoral-heroes-and-navigation.md) · [Roadmap](../roadmap.md)

## Rules for every slice

- Commit, push, review in its **own PR**, and merge before starting the next slice.
  These are future delivery gates, not permission to publish this documentation now.
- Dependencies below mean **merged**, not merely implemented. Obtain separate scope
  authorization and write implementation specifications at each slice, not in this PR.
- Strict TDD: real-entry-point RED before behavior exists, then GREEN and relevant
  negative cases. Record exact commands/results, affected regression checks and runtime
  reachability; helper-only tests do not qualify. Docs/research-only work records a
  justified behavioral-TDD exception and source/document verification instead.
- Every merge gate includes review, source/privacy/access invariants, applicable
  accessibility/performance checks and honest reporting of skipped/failed checks.
- Forecast authored additions + deletions before writing. Above approximately **400
  lines**, re-slice by independently useful behavior before proceeding; do not compress
  prose/tests or exclude the proposal because it started untracked. A cohesive unit
  still above budget requires an explicit review-load decision, not silent continuation.
- Rollback means a reviewed removal/reversion boundary, never permission to delete
  immutable archives or roll back persisted contracts without a verified recovery plan.

## Sequential slices

### 0 — Align product direction (this documentation PR)

- **Goal/scope:** Agree map-first purpose, glossary, visual/evidence contracts and this sequence.
- **Entry point:** README links to Product, Design, glossary, proposal, roadmap and plan.
- **Verification:** Documentation-only TDD exception; inspect links, current/target wording,
  source/statutory consistency and full authored diff, including new files.
- **Non-goals:** Implementation, dependencies, schemas, OpenSpec changes or claimed coverage.
- **Rollback:** These seven documentation surfaces only; no runtime effects.
- **Dependencies/gate:** None; review the direction and review-load forecast, then merge.

### 1 — Establish source, geometry and terrain feasibility

- **Goal/scope:** An auditable coverage/compatibility matrix for the anchor chain, including
  geographic versus electoral depth, licensing, versions, joins, terrain and unknowns.
  Evaluate deck.gl + MapLibre legibility and measured device/bundle budgets.
- **Entry point:** Maintainer-facing evidence report linked from the proposal; any prototype
  is explicitly non-production and cannot establish delivered map availability.
- **Verification:** Reproducible source inspection, provenance and unmatched-unit breakdowns;
  research-only TDD exception. No exact source coverage is presumed before this spike.
- **Non-goals:** Production renderer, ingestion, arbitrary nationwide coverage or invented APIs.
- **Rollback:** Research/prototype artifacts only, preserving existing evidence.
- **Dependencies/gate:** 0; review actual coverage, licenses, budgets and the smallest feasible
  municipal scope. If no truthful scope exists, stop rather than start Slice 2 on assumptions.

### 2 — Archive and validate geographic reference evidence

- **Goal/scope:** Immutable checksum-backed geography/terrain reference archive and validation
  through a real CLI, limited to Slice 1's accepted sources and correspondence rules.
- **Entry point:** Documented maintainer CLI invoking archive read/validation, not only helpers.
- **RED/verification:** Drive the CLI against missing/corrupt checksums, incompatible versions,
  code collisions and incomplete coverage; GREEN must report per-reason exclusions and replay.
- **Non-goals:** Web scenes, new electoral algorithms or changes to existing archive contracts.
- **Rollback:** New CLI/projection consumers; retain immutable entries and prior contracts.
- **Dependencies/gate:** 1; review reproducibility, reachability, provenance and privacy.

### 3 — Deliver the smallest complete municipal workspace

- **Goal/scope:** Reachable Coronel Rosales map with validated official results, supported
  geography, factual party colors/states, declared extrusion, independently explained terrain
  where available, synchronized exact evidence and an accessible fallback.
- **Entry point:** Existing `/municipal` saved scope; no generic municipality promise.
- **RED/verification:** Render the real route before implementation; cover denied/stale data,
  ties, unmapped/missing/incomplete evidence, unsupported geometry and WebGL failure; browser
  proof of selection, exact-results access, keyboard/mobile/reduced-motion and agreed budgets.
- **Non-goals:** Provincial/national expansion, comparison or fabricated circuit/mesa geometry.
- **Rollback:** Municipal scene integration only; retain authorized exact-table workflow.
- **Dependencies/gate:** 2; a working end-to-end scope, not an isolated renderer. High review-load
  risk: narrow supported depth or split independently reachable sub-slices before writing.

### 4 — Expand to the provincial anchor

- **Goal/scope:** Buenos Aires Province workspace with only verified child territories and
  visible coverage limits; reuse municipal navigation/evidence without assuming all partidos.
- **Entry point:** `/drilldown` provincial scope with a reachable Coronel Rosales transition.
- **RED/verification:** Real-route unsupported/missing units, national/PBA scheme collisions,
  authorized drilldown/back, exact totals and geometry/result correspondence.
- **Non-goals:** All-135 ingestion commitment or national expansion.
- **Rollback:** Provincial scene/scope integration; keep municipal and exact exploration.
- **Dependencies/gate:** 3; source-backed child coverage and performance verified. High breadth
  risk: split by truthful, useful territorial coverage before exceeding the review budget.

### 5 — Expand to the national anchor

- **Goal/scope:** Argentina workspace and supported child jurisdictions, with a verified
  Buenos Aires transition and explicit missing coverage; no false complete-country claim.
- **Entry point:** `/drilldown` national scope and geographic breadcrumbs.
- **RED/verification:** Route-driven jurisdiction identity, unsupported children, camera/scope
  synchronization, authorization and measured large-geometry behavior.
- **Non-goals:** New unsupported election categories or full national source acquisition.
- **Rollback:** National scene integration; retain provincial/municipal scopes and exact results.
- **Dependencies/gate:** 4; review applicable boundaries, coverage and device budgets.

### 6 — Compare territorial elections

- **Goal/scope:** Paired comparable territories, synchronized cameras/scales and exact deltas,
  preserving each election's labels, metric basis, provenance and unmatched units.
- **Entry point:** `/compare`, using verified child-unit correspondence rather than aggregate inference.
- **RED/verification:** Real route: changed boundaries, incompatible bases, missing/left-only/right-only
  units, zero versus absence, ties and delayed-selection reversal; accessible exact paired values.
- **Non-goals:** Fiscalización blending or unsupported fine-grained comparison.
- **Rollback:** Spatial comparison only; preserve current authorized aggregate comparison.
- **Dependencies/gate:** 5; review correspondence and common scales. High contract/UI diff risk:
  start with one supported comparison depth and split further capabilities into later merged PRs.

### 7 — Add separate Fiscalización operational heat

- **Goal/scope:** Coverage/operational heat at supported geography, with official denominator,
  literal `isRandomSample: false` and explicit source opt-in.
- **Entry point:** `/fiscalizacion`; never an official-results series or default query path.
- **RED/verification:** Route/query/aggregate leakage checks, zero/missing denominators,
  bounded uncovered collections, denied evidence and accessible operational coverage.
- **Non-goals:** Statistical representativeness, personal fiscal names or inferred official totals.
- **Rollback:** Heat presentation only; retain existing paired coverage/results guards.
- **Dependencies/gate:** 6; source-separation and coverage semantics pass independent review.

### 8 — Add statutory seat scenarios

- **Goal/scope:** Hypothetical 3D council/seat exploration using authoritative allocation;
  conditional vote ranges with assumptions, not fabricated exact winning thresholds.
- **Entry point:** `/simulate`, keeping accepted inputs and exact allocation trace synchronized.
- **RED/verification:** Entry-driven official golden cases for PBA Hare/national D'Hondt,
  ties, conditional range limits and total-versus-renewed seats (Coronel Rosales: 18/9).
- **Non-goals:** Client-side duplicate allocation or probabilistic election prediction.
- **Rollback:** New scenario presentation/range behavior; retain existing statutory calculator.
- **Dependencies/gate:** 7; statutory, mobile and evidence review. High combined modeling/rendering
  risk: re-slice into independently useful scenario capabilities if the budget is exceeded.

### 9 — Establish future Análisis/Prospectiva evidence foundations

- **Goal/scope:** A bounded probabilistic analytical question with explicit assumptions,
  confidence, limitations, evidence lineage and an evaluation protocol; no accuracy promises.
- **Entry point:** Separately approved reachable analysis module exposing evidence/uncertainty;
  route and model contract are decisions for this slice, not invented here.
- **RED/verification:** Real-entry refusal under insufficient/incompatible evidence, reproducible
  evaluation and honest uncertainty; record limitations and supported geographic granularity.
- **Non-goals:** Recommendations, deterministic forecasts or fabricated model accuracy.
- **Rollback:** New analytical output/module; preserve underlying official evidence.
- **Dependencies/gate:** 8; reviewed question, evaluation adequacy and explicit go/no-go for use.

### 10 — Deliver conditional municipal/intra-municipal recommendations

- **Goal/scope:** Evidence-bound recommendations only at evaluated supported granularity, with
  assumptions, confidence, limitations and traceable alternatives visible to the analyst.
- **Entry point:** The analysis module from 9, linked to supporting territorial evidence.
- **RED/verification:** Real-entry unsupported territory, weak evidence, uncertainty and
  reproducibility cases; evaluate recommendation limits before user-facing claims.
- **Non-goals:** Deterministic predictions, false precision or unsupported mesa geography.
- **Rollback:** Recommendation surface/output only; retain evaluated analytical foundations.
- **Dependencies/gate:** 9; independent evidence review and explicitly accepted limitations.
  High research/product breadth risk: select one useful question before implementation.
