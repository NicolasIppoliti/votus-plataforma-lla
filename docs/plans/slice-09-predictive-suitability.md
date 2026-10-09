# Slice 9 — Is a 2027 Rosales council vote estimate defensible?

> **Outcome (2026-10-09, #391).** The question was answered with a preregistered
> backtest of a mesa-level ecological-inference model: **not validated** against
> persistence. This definition is kept as history; see the
> [closure](../research/slice-09-closure.md) and
> [backtest results](../research/slice-09-backtest-results.md).

**Question:** Is estimating the 2027 Coronel Rosales **CONCEJALES list-vote
distribution** defensible on accepted comparable official evidence?

**Current answer: feasibility is not established.** The human product decision is
predictive suitability first, for this target only. No forecast is promised; no-go
is a valid result. No model, route, output or numerical accuracy target is selected.
[Delivery plan](territorial-intelligence-slices.md) · [Product](../../PRODUCT.md) ·
[Roadmap](../roadmap.md)

## What is already delivered, and what it cannot establish

| Evidence | Accepted boundary | Not established |
| --- | --- | --- |
| Slice 8 W1 #388 / W2 #389 | Merged direct transfers and bounded deterministic samples | Probabilities, predictive confidence or forecast backtests |
| Slice 6 comparison | National DIPUTADO NACIONAL, 2023 generales / 2025 legislativas at `02/027` | Municipal council training series |
| Municipal 2023 INTENDENTE / 2025 CONCEJALES | Distinct election categories | A matched council series |
| Existing official datasets | May contain additional categories | Accepted comparable series or sufficient independent periods |

Slice 8 completion is bounded: its 60-seat / 600-slot illustration limits differ
from W2's 21-sample / 600-aggregate-work guards. Neither is an inference budget or
universal certification. Broader council exploration and official-golden
certification are not implied by delivery.

## Target contract to accept before inference

| Dimension | Selected direction / remaining acceptance |
| --- | --- |
| Unit | Whole Coronel Rosales municipality; national distrito `02`, seccion `027`. PBA distrito `027` denotes the partido, not the national province. |
| Election | 2027 municipal CONCEJALES council renewal. Future category, round and election identity must be explicitly accepted, not inferred from the year. |
| Outcome | Joint vector of list vote counts and associated shares for an accepted roster; shares are compositional, not independent party outcomes. |
| Denominator | Explicitly accept the share basis and its reconciliation to listed votes, unmodeled votes, blank/annulled categories and missing coverage. Included-party shares are not automatically statutory valid-vote shares. |
| Roster | Accept election-specific list identities, alliances, splits/mergers and unmapped states; the future roster is not currently treated as known. |
| Geography | No all-135-partido, circuit, establishment or mesa inference; finer evidence does not automatically justify finer predictions. |

The [curated crosswalk](../../curated/crosswalk.yaml) verifies PBA `027` to national
`02/027`. Preserve the existing single normalization boundary and municipal meaning;
never attribute the section's votes to all Buenos Aires by dropping `027`.

A new or unseen party cannot be handled by picking the first historical identity,
relabeling a proxy or silently treating absence as zero. Unresolved identity stays
visible. Any proxy target, roster scenario or new-party uncertainty treatment needs
independent acceptance; unsupported treatment is grounds for refusal.

Predict **votes first**, only if suitability is established. Any subsequent seat
conversion is separate, deterministic statutory Hare under Ley 5109 Arts. 109–110:
**9 renewed seats, 18 total**, not an 18-seat renewal or national D'Hondt exercise.
Preserve the existing [allocator](../../apps/web/src/domain/seat-allocation/allocate.ts)
and [council configuration](../../apps/web/src/app/(authenticated)/simulate/simulation-configuration.ts),
including denominator/coverage refusals and exact traces. Seat calculations do not
validate a vote forecast, and share estimates alone do not supply complete inputs.

## Evidence inventory gate — metadata recorded; acceptance pending

The [official-evidence inventory](../research/slice-09-official-evidence-inventory.md)
records authorized metadata research, fresh PDF response hashes and candidate
periods, not an accepted council series. The two 2023 paths were byte-identical at
the recorded observation time only; no canonical/archive acceptance follows.
The prior GENERALES label was not reproduced, so rounds remain unresolved.
2025 was outside the fresh PDF checks; its prior provenance limits are unchanged.
Before inference, complete a reviewable acceptance inventory. Availability in an
archive or parser is not acceptance for this target.

- [ ] Official source/election/category/round inventory with archive entry, checksum,
  acquisition provenance, revision and usable period availability.
- [ ] Territory crosswalk and historical boundary applicability for every period;
  no invented fine geography or automatic correspondence from current references.
- [ ] Election-specific list/party roster and identity mapping with unresolved,
  excluded and quarantined cases reported by category/reason, never silently picked.
- [ ] Comparable outcome and denominator definitions, coverage and missingness,
  including how blank/annulled and unmodeled votes reconcile to the target.
- [ ] Explicit acceptance/rejection of each candidate period or proxy; assess whether
  independent temporal evidence can support evaluation, not merely row volume.

**Named availability gaps:** comparable historical municipal CONCEJALES periods,
their official source/archive coverage, historical roster continuity and denominator
compatibility have not been established here. The future 2027 round, roster and
complete target inputs also remain unaccepted. The two delivered comparison periods
do not establish adequacy; no universal minimum period count is invented.

Fiscalización is never pooled into official training or evaluation metrics. Its
coverage is non-random, retains its denominator and literal `isRandomSample: false`,
and belongs to a separate opt-in operational module. No fiscal names, private
production records or personal data are needed for this suitability definition.

## Evaluation gate — design pending, no evaluations performed

After evidence acceptance, approve and preregister the comparison protocol **before
reading the holdout outcomes**. Do not retrospectively tune acceptance criteria to
results already inspected. Document any prior exposure and its effect on credibility.

1. Define temporal origins, training windows and genuinely held-out later elections.
   Use only information available at each origin: later results, revised identities,
   future rosters and future covariates cannot leak into historical predictions.
2. Specify reproducible simple benchmarks (for example, an accepted comparable
   prior-election share baseline) and candidate comparisons only where inputs and
   roster mappings make them valid. No benchmark or model is approved by this example.
3. Define the probabilistic outcome, if used: a joint count/share distribution on the
   accepted roster and denominator, or explicitly defined election events. Then
   choose appropriate proper scoring and calibration checks for that outcome.
   An arbitrary error on observed shares is not automatically a proper score.
4. Assess compositional/multiclass uncertainty, dependence between lists, zeros,
   new-party behavior and interval/event calibration with honest finite-period limits.
   More mesas from one election are not more independent future elections.
5. Freeze benchmark comparisons, success criteria, refusal conditions and the
   decision procedure before holdout reading. Numeric thresholds and metrics are
   **not decided yet**; obtain explicit acceptance rather than inventing fixed N,
   accuracy guarantees or universal pass thresholds.
6. Record replayable source versions, accepted mappings, origin-specific inputs,
   exclusions, configurations and evaluation artifacts; explain unsupported claims
   and how sensitivity to defensible assumptions affects the decision.

A method-neutral assessment may conclude that the available evidence cannot support
probabilistic evaluation at all. A fitted model or attractive uncertainty graphic
would not remedy an insufficient temporal evaluation design.

## Decision and authorization gates

| Gate | Required decision | Current state |
| --- | --- | --- |
| Product question | Suitability first; 2027 Rosales CONCEJALES | Selected by the human |
| Evidence | Accept target, roster, denominators and comparable official periods | Metadata inventory recorded; acceptance and review pending |
| Evaluation | Preregister adequate origins, benchmarks, scoring/calibration and criteria | Pending design and acceptance |
| Go/no-go | Review observed evidence against frozen criteria and limits | Not performed; no feasibility pass |
| Implementation | Approved issue, exact scope and separate authorization | Not authorized; no route/model/output chosen |

Refuse or return no-go if comparability or coverage is inadequate, the target or
roster is unknown, independent evaluation is insufficient, or new-party uncertainty
cannot be supported. Report the specific failed gate and evidence gaps, not a
numeric forecast disguised as a scenario. A go decision, if later justified, would
apply only to its accepted target and limits, not all territories or elections.

**Next separately authorized phase:** acquire/verify public official evidence and,
where needed, conduct primary-source research to resolve the named gaps; then seek
acceptance of the evaluation design. The original definition performed neither
acquisition nor research; the linked inventory now records authorized metadata
research and bounded in-memory public-report verification only. Fresh response
hashes are not archived provenance. Canonical/source-version decisions, round and
comparability acceptance, archival acquisition and evaluation remain pending.
Obtain a future approved issue before implementation, consistent with the
user's issue-first preference. Slice 10 recommendations and tactical targeting remain
outside this work and require their own conditional decision and authorization.

## Verification and rollback boundary

This passive definition has no meaningful behavioral RED/GREEN. Verify local links,
existing territory/statutory contracts and truthful delivery/unknown wording instead.
Future behavioral implementation still requires real-entry strict TDD and refusal
coverage; documentation is not a substitute for runtime reachability or evaluation.
Rollback is limited to the four planning/product documentation surfaces changed in
this reconciliation. It does not alter runtime, archives, database contracts or the
merged W1/W2 behavior, and does not authorize a Git rollback operation.
