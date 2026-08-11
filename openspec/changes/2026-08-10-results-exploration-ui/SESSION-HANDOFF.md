# Session handoff — 2026-08-10

Production went from "no deployment target" to a live platform with a verified
corpus. This records what is true now, what is deliberately not done, and the
two things that need a human decision.

## Production, verified

- **App**: https://votus-plataforma-lla.vercel.app — Vercel project
  `votus-plataforma-lla`, root `apps/web`, auto-deploy on `main` (proven: the
  merge of #42 produced a `target: production` deployment from `main`).
- **Database**: Supabase `votus-prod`, region `gru1`, **Pro plan** (8 GB),
  provisioned through the Vercel Marketplace. Migrations 0001–0019 applied;
  `supabase db push --dry-run` reports `upToDate: true`.
- **Corpus**: 3.675.711 `result_row`, 157.347 `jurisdiction`, 1598 MB.

| Source | Rows |
| --- | --- |
| `national/2023-generales` | 2.712.023 |
| `national/2025-legislativas` | 753.230 |
| `national/2023-balotaje` | 209.040 |
| `fiscalizacion/2025-coronel-rosales` | 1.395 |
| `pba/2025-distrito-027` | 23 |

- **Auth**: one account, `contacto.nicolasippoliti@gmail.com`. Verified in a real
  browser through the login form: sign-in works, an authenticated read reports
  `Content-Range: 0-0/3675711`, the same read with only the anon key returns
  **401**. RLS holds in both directions.
- **Supabase Site URL**: fixed to the production origin. A magic link now 303s to
  `https://votus-plataforma-lla.vercel.app/dashboard` carrying a session; it
  previously landed on `http://localhost:3000`.

## Browser audit of every authenticated route

`/review` is the only route that renders data — a `mesa_tally_divergence` table
comparing fiscalización against `national/2025-legislativas` per party.

`/fiscalizacion`, `/compare`, `/drilldown`, `/municipal` and `/simulate` return
200 but ask for hand-typed UUIDs. `/dashboard` is the Phase 11 placeholder and
took 32,7 s cold. The app ships **no CSS**.

Four of the five race-pinning environment variables existed only in the local
template and were never set in Vercel; they are now set in production, preview
and development:

| Variable | Value |
| --- | --- |
| `FISCALIZACION_ELECTION_ID` | `9dd2c13b-e026-47b5-9db5-191cfd368164` (2025 legislativas) |
| `FISCALIZACION_CATEGORY_ID` | `16d238ae-794f-4a8b-a062-6816d427a8bf` (DIPUTADO NACIONAL) |
| `MUNICIPAL_CATEGORY_ID` | `e0a790b5-7faf-4ce3-9afe-bd15bf559332` (CONCEJALES) |
| `NATIONAL_JURISDICTION_ID` | `de3bf2bc-3a80-433e-a77c-274b1effea3a` (02/027, sección level) |

## Open decisions

1. **Fiscalización denominator.** `/fiscalizacion` pins its 93-of-153 coverage to
   the sección-level jurisdiction, but all 1.395 fiscalización rows live at 93
   **mesa**-level jurisdictions; the sección itself has zero. The page refuses
   any other jurisdiction by design. No choice of identifier resolves it — the
   page must either aggregate the mesas under the configured sección, or move
   the denominator to mesa level. This change proposes the former.
2. **Municipal jurisdiction.** `MUNICIPAL_JURISDICTION_ID` is deliberately unset.
   `party-family.ts` refuses a national/municipal collision, and the loaded
   corpus has no municipal jurisdiction distinct from 02/027.

## Defects fixed this session

- `0017` collided on 0012's session-scoped temp tables during any cold
  single-session apply (`42P07`), and canonicalized merge survivors before
  deleting their duplicates, which aborts with `23505` on any mesa-level merge
  group. Both fixed with tests; commit on `main`.
- `load-curated` peaked at 6,59 GB and was OOM-killed. The national results
  member is now streamed rather than materialized twice; peak is **217 MB**.
  `cmd_backfill_mesa_tipo` converted too.
- The root `.gitignore` did not match `.env.production-credentials`; env files
  are now ignored by prefix.

## Known blocked work

- **`national/2023-paso-wayback` is not ingested.** Its member is 3,76 GB
  decompressed and the ingest path materializes `list[NationalRow]` for the whole
  corpus, so it is OOM-killed at ~3,4 GB regardless of available disk. Unblocking
  it needs a two-pass streaming design: one pass to collect the duplicate natural
  keys `_quarantine_ambiguous_rows` needs, a second to emit rows in chunks into
  the same transaction that opens with the scoped DELETE. `load_result_rows`
  currently validates every record before the DELETE; streaming moves that
  validation after it, which is unobservable outside the transaction but should
  be covered by an explicit test.
- **`validate-crosswalk` and `validate-curated`** still materialize, because they
  hand bytes to `ingest_national`.

## Gotchas worth keeping

- A Supabase plan upgrade is **not instant**: the first generales ingest died
  with `DiskFull` minutes after the Pro switch. Probe that the volume actually
  extended before assuming a plan change took effect.
- Fiscalización ingest is **order-dependent**: run before its official baseline it
  loads 0 rows and files 93 `mesa_absent_from_official_import` warnings.
- The `POSTGRES_URL_NON_POOLING` Supabase provides still points at the pooler, so
  a custom role needs the tenant suffix (`etl_writer.<ref>`) or the connection
  fails with `ENOIDENTIFIER`.
- The pre-commit review reads whole files, not diffs, so any commit touching
  `etl/etl/__main__.py` surfaces its accumulated backlog and will not converge.
