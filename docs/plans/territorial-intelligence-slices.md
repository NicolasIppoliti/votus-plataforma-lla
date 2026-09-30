# Territorial Intelligence — Merge-Gated Delivery

**Reconciled through W1 #388 (`14741ab`) and W2 #389 (`1b37b37`) merged deliveries.**
Slices 0–6 and accepted bounded Slice 8 work are complete, not every original
expansion goal. Spatial Slice 7 is deferred. Slice 9 is defined as a suitability
question, not an authorized model or forecast. This does not authorize spatial
implementation or any Git operation.
Existing selector/chart/table workflows remain usable.
[Product](../../PRODUCT.md) · [Design](../../DESIGN.md) ·
[Proposal](../proposals/2026-09-22-3d-electoral-heroes-and-navigation.md) · [Roadmap](../roadmap.md)

## Current status

| Slice | Status and accepted boundary | Merged evidence |
| --- | --- | --- |
| 0 | Completed: product direction | [#360](https://github.com/NicolasIppoliti/votus-plataforma-lla/pull/360) |
| 1 | Completed: research/lab feasibility and ARBA partido archive/CLI; no production map | [#362](https://github.com/NicolasIppoliti/votus-plataforma-lla/pull/362) |
| 2 | Partial/conditional: bounded CNE reference archive/CLI delivered; additional usable child/terrain sources remain conditional | [#371](https://github.com/NicolasIppoliti/votus-plataforma-lla/pull/371) |
| 3 | Completed: optional Coronel Rosales CNE section reference on `/municipal` | [#372](https://github.com/NicolasIppoliti/votus-plataforma-lla/pull/372) |
| 4 | Completed: Buenos Aires anchor and verified municipal transition | [#374](https://github.com/NicolasIppoliti/votus-plataforma-lla/pull/374) |
| 5 | Completed: bounded Argentina reference views, not full electoral coverage | [Source #378](https://github.com/NicolasIppoliti/votus-plataforma-lla/pull/378), [generator #380](https://github.com/NicolasIppoliti/votus-plataforma-lla/pull/380), [UI #382](https://github.com/NicolasIppoliti/votus-plataforma-lla/pull/382) |
| 6 | Completed: one accepted national election pair at Coronel Rosales section depth | [#383](https://github.com/NicolasIppoliti/votus-plataforma-lla/pull/383) |
| 7 | Deferred: spatial operational heat awaits accepted evidence; existing Fiscalización remains usable | — |
| 8 | Completed: accepted bounded seat relief, W1 transfers and W2 deterministic samples; broader exploration remains future | [Relief #387](https://github.com/NicolasIppoliti/votus-plataforma-lla/pull/387), [transfers #388](https://github.com/NicolasIppoliti/votus-plataforma-lla/pull/388), [samples #389](https://github.com/NicolasIppoliti/votus-plataforma-lla/pull/389) |
| 9 | Defined: [2027 Rosales CONCEJALES suitability](slice-09-predictive-suitability.md); evidence/evaluation pending, feasibility not established | — |
| 10 | Conditional on 9 and separate authorization: supported-granularity recommendations | — |

Source availability does not block already delivered bounded scopes or Slice 7 planning.
New usable child geography and terrain require independent source acceptance and validation.
Original intent documents and historical task paragraphs may retain pre-merge wording;
this status table and each delivered boundary below distinguish current delivery from intent.

## Rules for every slice

- Commit, push, review in its **own PR**, and merge before starting the next dependent slice.
  The user explicitly separated the bounded Slice 8 seat-presentation increment from
  deferred spatial Slice 7; this exception does not waive either slice's delivery gates.
  These are future delivery gates, not permission to publish this documentation now.
- Dependencies below mean **merged**, not merely implemented. Obtain separate scope
  authorization and write implementation specifications at each slice, not through this documentation correction.
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

### 0 — Align product direction

- **Delivered:** Direction merged in PR #360; no runtime delivery or geographic coverage implied.
- **Goal/scope:** Agree map-first purpose, glossary, visual/evidence contracts and this sequence.
- **Entry point:** README links to Product, Design, glossary, proposal, roadmap and plan.
- **Verification:** Documentation-only TDD exception; inspect links, current/target wording,
  source/statutory consistency and full authored diff, including new files.
- **Non-goals:** Implementation, dependencies, schemas, OpenSpec changes or claimed coverage.
- **Rollback:** These seven documentation surfaces only; no runtime effects.
- **Dependencies/gate:** None; review the direction and review-load forecast, then merge.

### 1 — Establish source, geometry and terrain feasibility

- **Delivered:** PR #362 merged on 2026-09-23. Research/lab only, including immutable
  ARBA partido geometry and real fetch/validation CLI absorbed from Slice 2. Production
  rendering, terrain and child-source acceptance remain separate expansion work.
- **Goal/scope:** Source/geometry/terrain matrix, bounded partido join, standalone deck.gl +
  MapLibre evaluator and lab budgets. By explicit user decision, the partido-only immutable
  ARBA WFS snapshot, registry and reachable archive/validation CLI planned for Slice 2 were
  absorbed into Slice 1. This does not complete terrain or child-source archival work.
- **Entry point:** Linked evidence report; real `fetch` and `validate-partido-geometry` CLI;
  standalone evaluator outside Next routes. No delivered production map.
- **Verification:** Source/document verification for research; CLI behavior-level TDD and
  evaluator command-level TDD, focused/full/type/lint and candidate/base canonical gates
  8/8. For the Slice 1 candidate, all nine production routes were within its accepted
  ≤10% initial-JS budget: eight retained-build inventories were identical; `/login` raw
  bytes were equal and gzip was 2 bytes smaller because one server-action/minifier chunk
  differed by build. This historical measurement is not a current universal budget. Native
  assessment was unassessable historically; that is not approval. The merged research/lab
  delivery is verified, not a pending merge or a production-map certification.
- **Non-goals:** Production renderer, electoral ingestion, terrain, child geography,
  arbitrary nationwide coverage or invented APIs.
- **Rollback:** Revert evaluator/package/report and new geography consumer/registry/CLI;
  retain immutable snapshot and manifest history and existing exact workflows.
- **Dependencies/gate:** 0; minimal partido workspace is feasible within accepted lab
  budgets, not a production guarantee. Future expansion retains independent merge gates.

### 2 — Archive and validate geographic reference evidence

- **Delivered:** PR #371 merged on 2026-09-25: original CNE circuits and sections,
  checksum provenance and a real archive-reading CLI. Original circuits `0248B`/`0248C`
  overlap: strict partition validation rejects them by default; they were not repaired.
  Explicit checksum-pinned reference-only acceptance reports warnings and unsupported
  spatial assignment. Historical applicability and geographic coverage remain unverified.
  Later provincial/national scopes delivered their own reference pipelines; none establishes
  blanket completion of all geography.
- **Remaining conditional scope:** Remaining separately accepted terrain or child-reference source/archive/CLI
  validation, only if such sources become available. Partido-only ARBA snapshot/archive/CLI
  was explicitly absorbed into Slice 1; the bounded CNE delivery above does not complete
  remaining usable child-source or terrain goals.
- **Entry point:** Documented maintainer CLI invoking archive read/validation, not only helpers.
- **RED/verification:** Drive the CLI against missing/corrupt checksums, incompatible versions,
  code collisions and incomplete coverage; GREEN must report per-reason exclusions and replay.
- **Non-goals:** Web scenes, new electoral algorithms or changes to existing archive contracts.
- **Rollback:** New CLI/projection consumers; retain immutable entries and prior contracts.
- **Dependencies/gate:** 1 merged, then separately accept each new source; its archive and
  validation gate must pass before that source is used. Unavailable sources do not block
  delivered municipal references or planning the next slice.

### 3 — Deliver the smallest complete municipal workspace

- **Delivered:** PR #372: `/municipal` uses an optional checksum-verified CNE **section**
  reference for Coronel Rosales and authorized exact official results, with no-JS and WebGL
  fallback. This intentionally evolved from the ARBA partido feasibility in Slice 1; it is
  not an ARBA production renderer, circuit/mesa allocation or historical certification.
  Later municipal/comparison gates strengthen browser evidence, not hosted authenticated
  deployment or full physical-device certification.
- **Original intent / future expansion:** Smallest reachable Coronel Rosales municipal workspace
  using existing authorized exact municipal results, with synchronized exact table/text
  fallback and explicit unsupported child-depth/terrain states. No electoral extrusion
  without a separately validated metric and production decision.
- **Entry point:** Existing `/municipal` saved scope; no generic municipality promise.
- **RED/verification:** Render the real route before implementation; cover denied/stale data,
  ties, unmapped/missing/incomplete evidence, unsupported geometry and WebGL failure; browser
  proof of selection, exact-results access, keyboard/mobile/reduced-motion and agreed budgets.
- **Non-goals:** Generic municipalities, circuits, establishments, mesas, terrain, comparison,
  provincial/national expansion or fabricated geometry.
- **Rollback:** Municipal scene integration only; retain authorized exact-table workflow.
- **Dependencies/gate:** Delivered scope follows 1 and bounded CNE reference work in 2; newly accepted terrain or child
  geometry must first clear remaining Slice 2 archive/validation work before use. A working
  end-to-end scope, not an isolated renderer. High review-load risk: keep depth narrow.

### 4 — Expand to the provincial anchor

- **Delivered:** PR #374: `/drilldown` Buenos Aires anchor and verified Coronel Rosales
  transition. It does not deliver votes for all 135 partidos.
- **Future expansion / original goal:** Buenos Aires Province workspace with only verified child territories and
  visible coverage limits; reuse municipal navigation/evidence without assuming all partidos.
- **Entry point:** `/drilldown` provincial scope with a reachable Coronel Rosales transition.
- **RED/verification:** Real-route unsupported/missing units, national/PBA scheme collisions,
  authorized drilldown/back, exact totals and geometry/result correspondence.
- **Non-goals:** All-135 ingestion commitment or national expansion.
- **Rollback:** Provincial scene/scope integration; keep municipal and exact exploration.
- **Dependencies/gate:** 3; source-backed child coverage and performance verified. High breadth
  risk: split by truthful, useful territorial coverage before exceeding the review budget.

### 5 — Expand to the national anchor

- **Delivered:** PRs #378/#380/#382: optional continental MapLibre/deck view and separately
  labelled complete-territory D3 polar SVG on `/drilldown`. Geographic coverage is not
  electoral coverage. Source, generator, UI and bounded verification evidence are linked in
  [UI PR #382](https://github.com/NicolasIppoliti/votus-plataforma-lla/pull/382).
- **Future expansion / original goal:** Argentina workspace and supported child jurisdictions, with a verified
  Buenos Aires transition and explicit missing coverage; no false complete-country claim.
- **Entry point:** `/drilldown` national scope and geographic breadcrumbs.
- **RED/verification:** Route-driven jurisdiction identity, unsupported children, camera/scope
  synchronization, authorization and measured large-geometry behavior.
- **Non-goals:** New unsupported election categories or full national source acquisition.
- **Rollback:** National scene integration; retain provincial/municipal scopes and exact results.
- **Dependencies/gate:** 4; review applicable boundaries, coverage and device budgets.

### 6 — Compare territorial elections

- **Delivered:** PR #383 merged on 2026-09-29: national `DIPUTADO NACIONAL`, 2023 generales
  versus 2025 legislativas, Coronel Rosales `02`/`027` only. Both sides use the same current
  CNE section reference, not historical child-territory proof. Per-election highest-vote
  canonical party shares use a common 0–100% scale and exact included-party-vote denominators;
  leaders may differ. Absence is not zero and missing-side deltas remain nonnumeric.
- **Bounded verification:** [PR #383](https://github.com/NicolasIppoliti/votus-plataforma-lla/pull/383)
  records one fresh ordinary focused gate: four cases, 371 SQL assertions, two rollback/reapply
  proofs, build and cleanup passed. Camera retention/synchronization, opt-in, fallback,
  mobile and real Tab/Enter paths are covered. Ten actual initial chunks total 556969 raw
  bytes; direct MapLibre/Overlay/GeoJsonLayer implementations are physically outside initial
  groups behind activation guards. This is not exhaustive transitive attribution, network
  or execution timing, numeric reduced-motion duration or full accessibility certification.
  No numeric Slice 6 budget was accepted; Slice 1 lab and Slice 5 ≤10% budgets do not apply
  universally. The accepted original-camera RED exception is historical and narrowly scoped,
  not a strict-TDD policy change.
- **Future expansion / original goal:** Paired comparable territories, synchronized cameras/scales and exact deltas,
  preserving each election's labels, metric basis, provenance and unmatched units.
- **Entry point:** `/compare`, gated to the accepted section/election pair; other scopes retain
  authorized aggregate comparison. Future child correspondence needs independent verification.
- **RED/verification:** Real route: changed boundaries, incompatible bases, missing/left-only/right-only
  units, zero versus absence, ties and delayed-selection reversal; accessible exact paired values.
- **Non-goals:** Fiscalización blending, finer within-section vote allocation, generic pair
  coverage, historical edition certification or unsupported fine-grained comparison.
- **Rollback:** Spatial comparison only; preserve current authorized aggregate comparison.
- **Dependencies/gate:** 5; review correspondence and common scales. High contract/UI diff risk:
  start with one supported comparison depth and split further capabilities into later merged PRs.

### 7 — Add separate Fiscalización operational heat

- **Status:** Spatial extension deferred awaiting accepted evidence, not a missing
  application. Existing `/fiscalizacion` and coverage guards remain usable; spatial heat
  requires separate evidence acceptance and implementation authorization.
- **Goal/scope:** Coverage/operational heat at supported geography, with official denominator,
  literal `isRandomSample: false` and explicit source opt-in.
- **Entry point:** `/fiscalizacion`; never an official-results series or default query path.
- **RED/verification:** Route/query/aggregate leakage checks, zero/missing denominators,
  bounded uncovered collections, denied evidence and accessible operational coverage.
- **Non-goals:** Statistical representativeness, personal fiscal names or inferred official totals.
- **Rollback:** Heat presentation only; retain existing paired coverage/results guards.
- **Dependencies/gate:** 6 plus separately accepted spatial evidence; source-separation
  and coverage semantics pass independent review. Deferred spatial work does not gate
  the user-authorized bounded Slice 8 seat-presentation increment.

### 8 — Add statutory seat scenarios

- **Status:** Accepted bounded work complete. Seat relief merged in PR #387 independently
  of deferred spatial Slice 7. W1 direct transfers merged in PR #388 (`14741ab`),
  and W2 bounded samples merged in PR #389 (`1b37b37`) after their delivery gates.
  This closes the accepted increment, not speculative broader council exploration,
  probability modeling or universal official-golden certification.
  Reuse the existing statutory calculator unchanged (PBA Hare, national D'Hondt; 18 total / 9 renewed council seats).
- **Merged W1 scope:** An explicit distinct donor/receptor pair transfers a nonnegative
  safe-integer amount (default zero) from the current complete baseline. Only those
  two vote counts change; total, richer vote bases, unmodeled breakdown, padrón,
  projection scope and supplied rosters survive. Zero is an exact no-op; invalid
  requests do not navigate. The existing URL feeds the canonical server allocation,
  table, trace and refusals. Baseline changes reset transfer controls; the custom
  editor remains usable. Independent regressions and served mobile/keyboard/reset
  verification passed for W1 before its separately authorized delivery.
- **Merged W2 scope:** Separate donor/target/maximum/positive-step controls preserve the
  complete baseline and its ordinary exact result. URL keys `sweepDonor`, `sweepTarget`,
  `sweepMax`, `sweepStep` accompany canonical `input`; W1 exact URLs remain unchanged.
  Samples include zero, every step and the maximum once; a shorter final interval is
  disclosed. Preloop, overflow-safe guards reject requests above 21 samples or 600
  aggregate work positions (sample count × seats-to-fill × list count), without
  clamping, thinning or changing the baseline. These are conservative unbenchmarked
  application guards, not universal performance certification or illustration caps.
  The canonical server allocator evaluates every point; refusals are counted by reason.
  Min/max seat counts cover all lists, including zero, over valid samples only; no
  valid samples means no extrema. Each point links its own complete adjusted input and
  preserved roster/evidence to the existing exact route, without sweep parameters.
  There are no probabilities, guarantees between points, general winning thresholds,
  Hare monotonicity assumptions or binary search. W2 independent verification and
  merge are delivered; that bounded evidence does not establish official statutory
  golden certification, probabilistic confidence or forecast backtesting.
  Rollback removes only W2 controls, request validation, evaluation, rendering,
  tests/styles and these docs; retain W1 transfers, baseline/exact contracts and allocator.
- **Delivered presentation scope:** Individually countable, static shallow-depth blocks grouped by list,
  with a shared seats-to-fill capacity, zero-seat lists and unchanged exact evidence.
  Municipal drawings represent renewal only, never unknown holdover identities.
  Drawing is bounded to 60 seats and 600 slots across lists; larger scenarios retain
  exact labelled counts and disclose that individual-seat drawing is unavailable.
  No camera, map, three-axis sensitivity, renderer dependency or algorithm change.
- **Future scope:** Broader hypothetical council exploration and conditional vote ranges
  with assumptions, not fabricated exact winning thresholds.
- **Entry point:** `/simulate`, keeping accepted inputs and exact allocation trace synchronized.
- **Merged relief verification:** Strict real-route RED/GREEN for seat presentation, then
  synthetic national/provincial/municipal cases, zero seats, large-count fallback and
  unchanged trace/roster checks. These protect presentation preservation, not statutory
  certification or passed official goldens. The allocator refuses insufficient partial
  scenarios; retain that refusal rather than fabricating seats. Keep the unassigned-count
  disclosure for any partial result supported by the authoritative interface.
  The actual focused `/simulate` browser gate passed with 371 SQL assertions, both
  rollback/reapply proofs, production build and owned cleanup. Desktop/mobile captures
  were reviewed; real Tab/Shift+Tab, forced-color distinctions and settled reduced-motion
  checks passed. A strict-zero duration assertion failed and was corrected to respect
  the existing 0.01ms global policy without changing product CSS. Motion was inspected
  after settlement, not continuously throughout every update. This is scoped browser
  evidence, not full accessibility, physical-device or official-golden certification.
- **Future verification:** Entry-driven official golden cases for statutory/modeling
  changes, ties, conditional range limits and total-versus-renewed seats (18/9).
- **Non-goals:** Client-side duplicate allocation or probabilistic election prediction.
- **Rollback:** New scenario presentation/range behavior; retain existing statutory calculator.
- **Dependencies/gate:** Existing statutory `/simulate` entry and independent review,
  mobile/accessibility and evidence gates for this presentation increment; no dependency
  on deferred spatial 7 or new source acceptance. W1 and W2 independent verification
  and merge gates are fulfilled for their accepted scopes. Slice 9 may be defined,
  but analytical implementation still requires its own evidence/evaluation gate.
  Keep later capabilities independently reviewable.

### 9 — Assess predictive suitability before choosing an analytical implementation

- **Selected question:** Is estimating the 2027 Coronel Rosales CONCEJALES list-vote
  distribution defensible on accepted comparable official evidence?
- **Status:** [Definition](slice-09-predictive-suitability.md) recorded; feasibility **not
  established**. Product target is selected; methods, routes and outputs are not.
- **Scope:** Accept target/denominator, source and identity inventory, then preregister
  temporal evaluation, benchmarks, uncertainty checks and success/refusal criteria
  before holdout inspection. No-go or separately authorized evidence acquisition is valid.
- **Entry point:** This linked definition only; no analysis module is chosen or promised.
- **Verification:** Passive-doc behavioral-TDD exception now. Future authorized behavior
  requires real-entry refusal tests, reproducible evaluation and supported granularity.
- **Non-goals:** Forecast promises, recommendations, tactical targeting or invented accuracy.
- **Rollback:** Definition/planning text only; no runtime or official-evidence changes.
- **Dependencies/gate:** Bounded 8 merge gate fulfilled. Source acceptance and adequate
  evaluation remain open; an approved issue and separate authorization precede implementation.

### 10 — Deliver conditional municipal/intra-municipal recommendations

- **Status:** Conditional, not authorized; requires Slice 9 evaluation, supported
  geography and a separate product/scope decision.
- **Goal/scope:** Evidence-bound recommendations only at evaluated supported granularity, with
  assumptions, confidence, limitations and traceable alternatives visible to the analyst.
- **Entry point:** The analysis module from 9, linked to supporting territorial evidence.
- **RED/verification:** Real-entry unsupported territory, weak evidence, uncertainty and
  reproducibility cases; evaluate recommendation limits before user-facing claims.
- **Non-goals:** Deterministic predictions, false precision or unsupported mesa geography.
- **Rollback:** Recommendation surface/output only; retain evaluated analytical foundations.
- **Dependencies/gate:** 9; independent evidence review and explicitly accepted limitations.
  High research/product breadth risk: select one useful question before implementation.
