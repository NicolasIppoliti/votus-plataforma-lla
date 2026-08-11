# Results exploration UI

## Why

The platform holds 3.675.711 verified `result_row` records in production and no
way to navigate them. Every analysis route except `/review` refuses with
"Provide `electionId`, `jurisdictionId` and `categoryId` query parameters":
an operator has to paste UUIDs into the address bar to see a single result.

The client stated the requirement on 2026-08-10: exact votes per party broken
down by **sección, mesa and escuela**, to analyse and simulate the 2027
election, and to find where to improve fiscalización coverage or the party's
image. They did not ask for the fiscalización-versus-official tally
comparison, which is the one analysis surface that currently renders.

The data already answers the question. This is a measured query against
production for Coronel Rosales 2025:

| Escuela | Mesas | Votos |
| --- | --- | --- |
| ESCUELA EP N°14/ES N°11 | 10 | 2.115 |
| ESCUELA ES N°2 | 8 | 1.820 |
| ESCUELA EP N°2 | 8 | 1.799 |

The gap is the interface, not the corpus.

## What changes

- A navigable exploration surface: choose an election, then descend
  distrito → sección → circuito → escuela → mesa, and read votes and shares per
  canonical party at whatever level is selected.
- Selection replaces hand-typed UUIDs. Routes keep accepting ids as query
  parameters so a view stays linkable, but no view requires the operator to
  know one.
- Fiscalización is reframed from tally comparison to **coverage**: which mesas
  and escuelas had no fiscal present. The existing rows serve the client's
  "where to improve fiscalización" ask without being compared vote by vote.

## Data constraint this change must state, not hide

`establecimiento_code` is present on **100%** of `national/2025-legislativas`
(753.230 rows, 8.258 establecimientos, 5.268 named) and on **0%** of
`national/2023-generales` and `national/2023-balotaje`.

This is a source limitation, not missing ingestion: the 2023 official ZIPs ship
no establecimiento companion; only the 2025 one does
(`localesDeVotacionyMesas.csv`). `sources.yaml` already records that
"registered 2023 sources have no companion and remain unknown".

Escuela-level analysis therefore exists for 2025 and cannot exist for 2023 from
the registered corpus. Sección and mesa are available for every ingested
election. Any escuela view MUST say which years it can answer for rather than
render an empty breakdown that reads as "no votes".

## Impact

- Affected specs: `results-analysis`, `fiscalizacion-analysis`,
  `provenance-display`
- Affected code: `apps/web/src/app/(authenticated)/**`,
  `apps/web/src/lib/results/**`
- Out of scope: the `national/2023-paso-wayback` ingest, which is blocked on a
  separate two-pass streaming refactor of `ingest_national`; the unstyled UI
  is addressed only insofar as the new views need layout to be usable.
