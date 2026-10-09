# Slice 9 — Backtest results (`slice09-ei-relation-backtest-v1`)

**Verdict: not validated.** The relation-type EI model fails the development
gates against the persistence reference (B1). The single 2025 test passes its
confirmation, but validation requires both. Per the
[preregistration](slice-09-backtest-preregistration.md), the 2027 simulator must
present transfers as **supuestos sin validar**. Nothing was retuned.

## Provenance

| Step | Artifact | SHA-256 |
| --- | --- | --- |
| Freeze | `curated/slice-09-backtest-freeze.json` (commit `71d5b96`) | `96537965…c158` |
| Runner | `etl/etl/backtest.py` (commit `e96c430`) | — |
| Panel rebuilt from DINE archives | temporary | `059cb471…0127` |
| Development stage | [`slice-09-backtest-development.json`](slice-09-backtest-development.json) (commit `2057278`) | `cfa37305…515a` |
| Final stage, run once | [`slice-09-backtest-final.json`](slice-09-backtest-final.json) | `e864f49e…922e` |

An independent verifier rebuilt the panel, re-ran both stages byte-identically,
recomputed every gate with its own exact-fraction script, and recomputed the
2019 and 2025 model TV from raw `forecast` shares against JEBA totals.

## Development cuts (TV in pp / seat error, 9 seats)

| Cut | Model | B1 persistence | B2 proportional |
| --- | --- | --- | --- |
| 2019 | 29.627 / 3 | 8.239 / 1 | 8.894 / 1 |
| 2021 | 7.209 / 0 | 13.642 / 1 | 18.394 / 1 |
| 2023 | 26.385 / 3 | 29.856 / 3 | 43.392 / 4 |
| Mean | **21.074** / 2.000 | **17.245** / 1.667 | 23.560 / 2.000 |

Best reference: B1. Gates against B1:

| Gate | Result |
| --- | --- |
| Mean TV ≤ 85 % of reference | FAIL (21.074 vs 14.659 limit) |
| Mean TV at least 1 pp lower | FAIL (3.828 pp higher) |
| Strict majority of cut wins | PASS (2 of 3) |
| No cut lost by more than 2 pp | FAIL (2019 lost by 21.388 pp) |
| Mean seat error not worse | FAIL (2.000 vs 1.667) |

## 2025 final test (once)

| Model | B1 | B2 |
| --- | --- | --- |
| 22.557 / 3 | 24.079 / 3 | 24.079 / 3 |

Confirmation against B1: PASS (1.522 pp better, equal seats). Validated: **no**,
because development failed.

## Reading

- The model beats both references in 2021 and 2023 but loses 2019 badly. The
  2019 cut learned from a single transition (2015 Intendente proxy → 2017
  Concejales). Whether the proxy, the one-pair training or the
  correspondence drives that loss is **untested**; testing it now would be
  post-measurement exploration and could not validate the model.
- Absolute errors are large for every method (7–43 pp). Even the best
  reference misses by over 17 pp on average.
- Exposure caveat from the preregistration stands: outcomes were known while
  curating, so these numbers are not a blind forecast.
