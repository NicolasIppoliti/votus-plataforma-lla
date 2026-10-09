# Slice 9 — v1 code disposition

Decided by the user on 2026-10-09, after the
[backtest results](slice-09-backtest-results.md): retire the v1 ideology
experiment code and keep its research documents as history.

## Why v1 is obsolete

- v1 needed at least three whole-roster CONCEJALES cuts. Under its own contract,
  Coronel Rosales 2011–2025 yields zero admissible cuts, so v1 could never run
  on real data.
- The goal was redefined via `/goal-tweak` as a mesa-level ecological-inference
  scenario model. Ideology could enter only as an optional declared prior; the
  frozen model (`curated/slice-09-backtest-freeze.json`) uses none.
- No module of the new pipeline imports v1 code (`etl/tests/test_v1_disposition.py`
  checks this).

## Retired

| Path | Lines | Last version |
| --- | --- | --- |
| `etl/etl/pba_ideology_experiment.py` | 650 | `cfbb91c` |
| `etl/tests/test_cli_pba_ideology_experiment.py` | 873 | `cfbb91c` |
| `etl/tests/fixtures/ideology_v1_public_cases.json` | 1659 | `cfbb91c` |

The v1 work was delivered in `26cab34`, `cb2bd4f`, `3350fc3`, `b74dc2b`, `90be58c`,
`904316f` and `cfbb91c` (79 synthetic checks, RDD-reviewed). To recover a file:

```sh
git show cfbb91c:etl/etl/pba_ideology_experiment.py
```

## Kept as history

Each kept document has a "superseded" notice under its title. They still
describe v1, not the delivered model.

- [Method](slice-09-ideology-v1-method.md): the v1 public experiment contract.
- [Source dossier](slice-09-ideology-v1-source-dossier.md): partial source
  authentication; its official sources fed the offer correspondence.
- [Evidence status report](slice-09-ideology-v1-evidence-status-report.md): why
  v1 could not be evaluated.
- [Expediente request draft](slice-09-expediente-request-draft.md): its header still
  reads "no enviado", but the user sent the request to JEBA on 2026-10-08. No
  reply has been incorporated, and the delivered model does not depend on one.

## Reused

No v1 code. The new pipeline (`dine_municipal_panel`, `mesa_transfers`,
`hare_seats`, `forecast_baselines`, `relation_forecast`, `backtest`,
`scenario_2027`) was written for the redefined goal.
