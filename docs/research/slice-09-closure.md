# Slice 9 — Closure: 2027 scenario model for Coronel Rosales concejales

Closed 2026-10-09 on branch `feat/slice-09-ideology-v1-completion` (local only;
no push, PR or publication).

**Outcome.** The mesa-level ecological-inference (EI) transfer model was
preregistered, frozen and backtested. It is **not validated**: it loses to the
persistence reference on the development cuts. The 2027 simulator ships with
persistence as its default and labels every transfer **supuestos sin validar**.
Slice 10 is unblocked only for a scenario UI that keeps that label (user
decision; see the last section).

## Requirements reconciliation

| Requirement | Status | Evidence |
| --- | --- | --- |
| DINE 2015–2023 mesa panel, hash/size/encoding verified | Met, size by hash | `c47b15d`; `panel` rejects any archive whose SHA-256 differs from `expected_sha256` (which fixes its exact bytes, hence its size), records `archive_bytes`/`member_bytes` without a separate expected-size check, and decodes strict UTF-8 (`etl/etl/dine_municipal_panel.py:48–76`); rebuild sha `059cb471…0127`, reproduced by independent verifiers |
| Concejales 2017/2021, Intendente proxy 2015/2019/2023 flagged per row with bias note | Met | `curated/slice-09-mesa-panel-inputs.json` (`proxy`, `proxy_note`); `is_proxy` on panel rows and on reconcile/align outputs |
| 2027 base = JEBA definitive concejales 2025, 154 Argentine + 2 foreign mesas | Met, with an open discrepancy | `69a15c8`; positivos 32,291 (argentinos 32,184 + extranjeros). JEBA PDF says 154 mesas, HTML components 154 + 2 = 156; recorded `status: unresolved` |
| DINE vs JEBA reconciliation per election with per-reason breakdown; no missing mesa as zero | Met | `fb6504e`; `reconcile` reports per-field and per-offer deltas; missing mesas are counted, never zero-filled, and labelled "unidentified: district totals cannot identify which mesas" |
| Explicit, audited mesa alignment, per-reason non-aligned counts | Met | `34d72f3`; aligned 112/131/122/133 mesas; per-reason counts (`only_in_origin`, `only_in_destination`, `electores_change_exceeds_threshold`, …) and per `mesa_tipo` |
| Sourced offer correspondence; entries/exits explicit; no residual bucket | Met | `7230b95`; every offer covered, merges/splits declared, exits/entries explicit; `core_mapping` rejects incomplete coverage |
| EI transfers with reported uncertainty; ideology only as optional dated prior | Met | `85cf291`, `1a6878b`; constrained FISTA + 200-replicate bootstrap (type-7 percentiles), e.g. 2019→2021 Juntos retention 0.618 [0.546, 0.672]; no ideology prior used |
| Preregistered rolling-origin backtest 2019/2021/2023; 2025 single final test | Met | freeze `71d5b96` before any measurement; runner `e96c430`; development `2057278`; final once `b01fb5f` |
| References: persistence and proportional; compare to the best | Met | `a071f60`; best reference B1 chosen globally by mean development TV |
| District TV primary; Hare seat error secondary (Ley 5109, 9 seats); mesa error diagnostic only | Met | `3ace933` (6 official golden cases); the model is district-level, so no per-mesa forecast error exists (declared in the preregistration) |
| Gates frozen before measuring | Met | `curated/slice-09-backtest-freeze.json`, `etl/tests/test_backtest_freeze.py` |
| 2027 simulator, explicit adjustable assumptions, validated vs unvalidated label | Met | `13e635b`; label derived from the committed backtest verdict |
| Recipe, inputs, hyperparameters and correspondence hashed before measuring; prior-exposure declaration | Met | `71d5b96`; [preregistration](slice-09-backtest-preregistration.md) |
| v1 code reused or retired with documented disposition | Met | `9c9efdd`; [disposition](slice-09-v1-disposition.md) |

## Results

From [backtest results](slice-09-backtest-results.md). TV in pp / seat error.

| Cut | Model | B1 persistence | B2 proportional |
| --- | --- | --- | --- |
| 2019 | 29.627 / 3 | 8.239 / 1 | 8.894 / 1 |
| 2021 | 7.209 / 0 | 13.642 / 1 | 18.394 / 1 |
| 2023 | 26.385 / 3 | 29.856 / 3 | 43.392 / 4 |
| Development mean | 21.074 / 2.000 | 17.245 / 1.667 | 23.560 / 2.000 |
| 2025 final (once) | 22.557 / 3 | 24.079 / 3 | 24.079 / 3 |

Gates against B1: relative FAIL, absolute FAIL, majority PASS (2/3), maximum
loss FAIL (2019, 21.388 pp), seats FAIL. 2025 confirmation PASS. Validated: no.
Nothing was retuned after measurement; `git diff 71d5b96 HEAD` touches no frozen
file.

Default simulator output (2025 offers continuing unchanged into 2027):
persistence seats 2206:5, 2200:2, 2201:2; EI alternative 2206:4, 2200:3,
2201:2. Both are labelled as unvalidated assumptions.

## Limitations

- **Proxy.** Three of five elections use INTENDENTE for CONCEJALES. DINE-vs-JEBA
  positivos gaps are large only in proxy years (−823, −978, −792 votes versus
  −8 and −27 in concejales years), consistent with split-ticket effects. Proxy
  error is not separable at mesa level.
- **Small training base.** The 2019 cut learns from one transition; whether
  that, the proxy or the correspondence drives the 2019 loss is untested.
- **Not blind.** Outcomes 2015–2025 were known while curating (declared).
- **Weak identification.** EI estimates for small offers have wide intervals.
- **Absolute error is large** for every method (7–43 pp); even persistence
  misses by 17 pp on average.
- **JEBA category header unauthenticated** (`jeba_category_unauthenticated`).
- **2025 mesa count** 154 vs 156 unresolved; totals use both components.
- **2025 is spent.** A future validated model needs a new preregistration and
  a new holdout (for example 2027 itself).

## Verification and review

Every unit had an independent `gentle-ai-verify` pass and a native RDD review
acknowledged before its commit; lineages are logged in
`odd/tasks/slice-09-completion-and-slice-10-unblock.md` (original root). Corrections required by RDD were made within
budget and validated: R3-negative-residual (m6, `review-e8a3c1671f0a8600`) and
R3-ignored-development-option (m8, `review-9f8a599acf9bdcc6`).

| Unit | Commit(s) | RDD lineage(s) |
| --- | --- | --- |
| m1 panel | `7b6afc5` `3171aed` `e427590` `be5c9c4` `c47b15d` | `review-ad7df6681d155d9c` `review-86383f2147f51663` `review-cd8127262ddd8a4c` `review-d9f69c71ee15418d` `review-9803bc62e1f744ba` |
| m2 reconciliation | `469157c` `69a15c8` `fb6504e` | `review-477e6d306cbb6328` `review-e3abbd4afd99c9a1` `review-9964ea723e29a85d` |
| m3 alignment | `34d72f3` | `review-beed68d755fdb028` |
| m4 correspondence | `7230b95` | `review-820a754e1cac186f` |
| m5 EI | `85cf291` `1a6878b` | `review-68a25fc024637b35` `review-355bdd29ce790e49` |
| m6 metrics/forecast | `3ace933` `a071f60` `3f5b438` `1a65a4f` | `review-8a7018c876376105` `review-59908140a7e4fe05` `review-efb91a55d1e25370` `review-e8a3c1671f0a8600` |
| m7 freeze | `71d5b96` | `review-527302ddffffa40a` |
| m8 backtest | `e96c430` `2057278` `b01fb5f` | `review-9f8a599acf9bdcc6` `review-ad442c1a0a904f51` `review-0df08af5276c087c` |
| m9 simulator | `13e635b` | `review-6246c92a711916d9` |
| m10 v1 disposition | `9c9efdd` | `review-ca929ad3018578e6` |

Independent reproductions: development and final outputs byte-identical
(`cfa37305…`, `e864f49e…`); gates recomputed with a separate exact-fraction
script; 2019 and 2025 model TV recomputed from raw `forecast` shares.

### Failed, skipped or pending checks

- Full ETL suite: 1807 passed, 87 skipped, **13 errors**. The same 13 errors
  occur at the pre-retirement HEAD ("owned database fixtures require the
  privileged test phase"); the privileged database phase was not run.
- Delegated subagent transcripts were not audited for raw-output exposure
  before the freeze (declared).
- The Engram mirror of the ODD task file was not refreshed after the m7–m11
  appends.
- No JEBA reply to the 2026-10-08 expediente request has been incorporated;
  the model does not depend on it.

### Preservation of other work

Each commit asserted that the original root HEAD (`023b4ab`) and its staged
index (`git ls-files --stage -z` sha `1e868896…`) were unchanged, and staged only
named paths. The unrelated deleted `.agents/skills/…` files in the original root
were left untouched. Commit `67447e4` ("archive verified CNE Rosales sources",
14:50) was not made by any work unit of this goal; it appeared on this branch
between m10 and m11. It was preserved as is;
it adds archive-only records and does not affect the frozen backtest.

## Slice 10 disposition

User decision 2026-10-09, from the evidence above: **scoped unblock**. Slice 10
may build a scenario UI over `etl/etl/scenario_2027.py` only if it always shows
"supuestos sin validar", uses persistence as the default and shows the backtest
errors. It must never present a forecast as validated. A validated forecast
needs a new preregistered backtest.
