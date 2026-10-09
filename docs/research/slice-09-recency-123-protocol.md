# Slice 9 — Fixed recency experiment protocol

## Freeze and scope

Experiment ID: **`slice09-recency-123-v1`**. This protocol is frozen before
experiment implementation or scoring, following approval of fixed chronological
weights **1/6, 2/6, 3/6**. R1 creates this passive document only; implementation
and execution remain later work. No experiment result is claimed here.

The target is the whole Coronel Rosales municipality, national **02/027**
(PBA partido 027), municipal general **CONCEJALES positive-share distribution**.
This is a compositional point vector, not independent party probabilities.
The governing [plan](../plans/slice-09-predictive-suitability.md) and
[latest alignment-v2 closure](slice-09-inactivity-v2-closure.md) remain unchanged.

## Fixed candidate and chronological proof

At each valid origin, retain exactly the frozen pilot's three immediately prior
chronological election vectors, already aligned to the target roster plus residual.
Let `A`, `B`, `C` denote oldest, middle, newest respectively:

`recency = A/6 + 2B/6 + 3C/6`.

The weights sum to **1**; apply them coordinatewise, including the residual.
Normalize each historical vector by its own complete positive-vote denominator
before alignment; never pool raw votes or silently renormalize participating lists.

| Target | Oldest A | Middle B | Newest C |
| --- | --- | --- | --- |
| 2021 | 2015 | 2017 | 2019 |
| 2023 | 2017 | 2019 | 2021 |
| 2025 | 2019 | 2021 | 2023 |

Reuse the frozen pilot's public outputs without changing its implementation only
if their semantics are proved: `mean = (A+B+C)/3`, `middle = B`, `latest = C`.
Verify actual election dates/rounds and public vector provenance for each origin;
a field name or same-type benchmark label alone is not chronological proof.
Only then use the exact identity **`recency = mean/2 + middle/6 + latest/3`**,
including residual. The identity gives weights 1/6, 2/6, 3/6, not a new estimator.
If those semantics cannot be established, stop and report the unmet technical
precondition; do not substitute another vector or alter the frozen pilot.

## Common evidence and comparisons

Keep alignment policy `municipal-electoral-inactivity-v2`, accepted mappings,
rosters, availability assumptions, full positive denominators and exclusions
unchanged. Preserve blank/null and coverage limits separately; use official data
only. Do not invent historical availability from present acquisition or later
roster evidence. Unknown identities remain unresolved, not zero-imputed.

The baseline has **3 valid origins (2021/2023/2025)** and **2 excluded origins
(2017/2019)**. Preserve exclusions with per-origin/per-reason breakdowns; do not
replace missing origins or omit inconvenient errors. The frozen mean's measured
mean TV is **26.4677 pp**. Compare recency with that unchanged mean and both frozen
persistences: last election and last election of the same municipal election type.
All four methods must use identical support, observed outcomes and coordinates.

Select the better persistence by its **GLOBAL mean TV over the common valid
origins**, never the best benchmark separately at each origin. Report both global
benchmark means and which supplies the gain denominator.

## Accounting and scientific gates

For each target and method, show each coordinate's predicted and observed shares
in pp and contribution `abs(predicted_pp - observed_pp)/2`. The observed residual
is zero, so its contribution is **`predicted_residual_pp/2`**. Contributions must
sum to `TVpp = 0.5 × (sum_list_abs_errors + predicted_residual_pp)`; prediction
mass including residual and observed list mass must each reconcile to 100 pp.
Report zero-history coordinates and their error contributions explicitly,
distinguishing reviewed project zeros, sourced zeros, branches and unresolved
identities. Do not falsely label reviewed branches as new parties or introduce
new priors, entrant classifications, transfer assumptions or alignment policy.

Report per-origin TV, unweighted mean, maximum, absolute gain and relative gain.
With recency mean `R` and better global persistence mean `P`, every gate is required:

- **At least 3 valid origins**.
- **Mean TV ≤ 5 pp** and **maximum TV ≤ 10 pp**.
- **At least 10% AND at least 0.5 pp improvement**: `R ≤ 0.9P` and `P-R ≥ 0.5`.

If `P = 0`, relative gain is undefined (report null), and the absolute gain cannot
pass. Result and gains must be measured; no scientific improvement is expected
or promised merely because recency weighting changes the candidate.

## Later technical execution and delivery boundary

Proposed reachable real-main seam: **`evaluate-pba-recency-experiment --evidence-path`**
with a required evidence path value. No tuning, weight/window selection or
output-writing options. Its later implementation requires real-entry verification;
this protocol does not implement or invoke it.

Later execution must be guarded, offline and read-only, preserving the original
frozen evidence, ledger, reports, archive/manifest and source bytes. No database,
network, ingestion or dependency installation is authorized. Historical **I1
remains open**; guards do not resolve that incident. Technical checks cover
chronology, input validity, common support, mass/TV reconciliation, reachable CLI
and preservation. Passing those checks is distinct from meeting scientific gates.

Historical outcomes and prior scores were exposed before this experiment was
specified: this is **retrospective exploratory assessment**, not unseen validation.
Even a diagnostic pass supplies **no calibrated uncertainty, no 2027 forecast and
no Slice 10 activation**. Existing scenario availability is not forecasting.

Local delivery/code commits for later implementation and execution remain blocked
on previous unstaged dependencies until they can be separated explicitly; no
implicit staging of old work or false standalone code-commit claim is permitted.
The parent owns task tracking and any commits. R1 verification is structural
readback and relative-link existence only: no meaningful behavioral RED applies
to this passive protocol, and no test runner or experiment is run for R1.
