# Slice 9 — Backtest preregistration (relation-type EI model)

Experiment ID: **`slice09-ei-relation-backtest-v1`**. Declared 2026-10-09,
before any model-versus-outcome value was read. Machine-readable freeze:
[`curated/slice-09-backtest-freeze.json`](../../curated/slice-09-backtest-freeze.json);
`etl/tests/test_backtest_freeze.py` recomputes every declared SHA-256.
Nothing here is a result.

## What is frozen

- **Code**: commit `1a65a4f` (tree `6302f71`) and the SHA-256 of every module the
  `forecast` and `baselines` CLIs execute.
- **Inputs**: the seven curated files (panel inputs, alignment rules, transfer
  recipe, forecast recipe, offer correspondence, DINE→JEBA offer map, JEBA
  definitive totals). EI hyperparameters live in the transfer recipe (FISTA,
  `tol` 1e-10, `max_iter` 20000, origin-electores weighting); the pooling and
  fallback rules live in the forecast recipe. Both are covered by their hashes.
- **Derived panel**: `panel --inputs curated/slice-09-mesa-panel-inputs.json`
  rebuilt from the verified DINE archives yields SHA-256 `059cb471…0127`.
- **Interpreter**: pinned CPython 3.13.12 run with `-I -S -B` (stdlib only).

## Cuts

Rolling origin; each cut trains only on transitions whose destination year is
at most the forecast origin year (enforced by the CLI).

| Cut | Pair | Training pairs |
| --- | --- | --- |
| 2019 | 2017→2019 | 2015→2017 |
| 2021 | 2019→2021 | 2015→2017, 2017→2019 |
| 2023 | 2021→2023 | 2015→2017, 2017→2019, 2019→2021 |
| **2025 final** | 2023→2025 | all four pairs above |

The 2025 final test is run **once**, only after the development results are
committed. Its output SHA-256 is recorded with the result.

## Metrics and references

- Primary: district total variation (TV) of positive-vote shares against JEBA
  definitive totals, exact fractions; 1 pp = 0.01 TV.
- Secondary: seat error, half-L1 between Hare allocations of 9 seats (Ley 5109,
  arts. 109–110) on forecast and observed votes.
- The model applies at district level, so no per-mesa forecast error exists;
  none is computed or used.
- References: B1 persistence and B2 proportional redistribution (frozen in
  `etl/etl/forecast_baselines.py`). The **best reference** is chosen once,
  globally, as the lower mean TV over the three development cuts. If B1 and B2
  tie exactly, every gate must pass against both.

## Gates (decided by user, option A)

Development gates, over cuts 2019/2021/2023 against the best reference:

1. Mean model TV ≤ 0.85 × reference mean TV **and** at least 1 pp lower.
2. Model TV strictly lower in a majority of cuts (≥ 2 of 3) **and** no cut
   where it is more than 2 pp higher.
3. Mean model seat error ≤ reference mean seat error.
4. Absolute TV is always reported but is not a gate.

2025 confirmation, same best reference: model TV no more than 2 pp above the
reference's 2025 TV **and** model seat error not greater.

**Validated** = all development gates pass **and** the 2025 confirmation
passes. Any undefined metric (zero positive forecast, ambiguous Hare tie) fails
the gate it feeds. Otherwise transfers are presented as unvalidated assumptions;
no threshold, recipe, input or code changes after measurement, and the user is
consulted.

## Prior exposure declaration

- **v0** (earlier failed research) reported mean TV 25.373733 pp, maximum
  36.085299 pp and gain 0.633089 pp; the recency protocol on `main` cites a
  frozen-mean benchmark of 26.4677 pp. Both used other methods and supports.
- **v1** (ideology calibration, `cfbb91c` and predecessors) was validated only
  on synthetic cases; no real v1 measurement exists.
- **Data**: all JEBA definitive district totals 2015–2025, including 2025
  offers, votes and official seats (Hare golden cases), were read while
  curating. DINE 2015–2023 mesa data were inventoried, reconciled and aligned.
  The offer correspondence and the relation-type model (user decision,
  2026-10-09) were chosen with that knowledge. Outcomes are therefore not
  blind; the freeze protects the recipe, not ignorance of results.
- **Pre-freeze executions**: the main-session transcript records real-data runs
  only as SHA-256 smokes, never displaying values: `baselines` for the five
  pairs (`9ef8fecf…`, `d0ae2c37…`, `96015301…`, `2635aad0…`, `cc4b8f8a…`) and
  `forecast` for 2017→2019 (`7f31913b…`) and 2023→2025 (`6efbcb6c…`). The
  2023→2025 smoke computed the 2025 metrics internally without reading them.
  Delegated subagent transcripts were not audited, so their exposure to raw
  output cannot be excluded. The m8 run is the first read and only counted
  2025 measurement.
