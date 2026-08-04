# SPIKE 004 — full corpus load (task 14.10-14.13)

> Before this phase, `result_row` was 100 % `official` and held only the
> national 2025 ZIP (Phase 12's end-to-end proof, `spikes/003`). Five PBA
> entries and one fiscalización entry were registered in `sources.yaml`
> but never fetched or ingested. This spike fetches and ingests both,
> under D10's etiquette constraints for PBA and D9's personal-data
> stripping for fiscalización, and records the resulting `result_row`
> composition.

## 14.10 — fetching the five registered PBA entries under D10

Ran `scripts/fetch_pba_2025.py` (new, one-off script — the real invocation
of already-tested D10 machinery: `etl.http_client.PolicedHostFetcher`,
`etl.ingest.pba.archive_pba_source`, `check_robots_txt_still_absent`; every
constraint it exercises is already covered by `etl/tests/test_ingest_pba.py`
against fakes, this is the actual run):

```
cd etl && uv run python ../scripts/fetch_pba_2025.py
```

```
pba/2025-distrito-027: ok -> archive/pba/distrito_027.html
pba/2025-concejales-bancas-027: ok -> archive/pba/concejales-bancas-027.pdf
pba/2025-consejeros-bancas-027: ok -> archive/pba/consejeros-bancas-027.pdf
pba/2025-concejales-distri-027: ok -> archive/pba/concejales-distribucion-027.pdf
pba/2025-consejeros-distri-027: ok -> archive/pba/consejeros-distribucion-027.pdf
0.15s user 0.04s system 1% cpu 16.566 total
```

All five `ok`. D10's constraints, as exercised by this run:

| Constraint | How it held |
|---|---|
| 1. TLS verification on, never bypassed | `RequestsFetcher` never passes `verify=False` anywhere; no `-k` equivalent exists in this codepath |
| 2. Concurrency 1 | `PolicedHostFetcher`'s per-host semaphore (`max_concurrency=1`); this script itself also fetches strictly sequentially |
| 3. ≥4 s delay | `PBA_HOST_POLICY.min_delay_seconds = POLITENESS_DELAY_SECONDS["pba"] = 4.0`; observed wall-clock (16.6 s for 5 requests) is consistent with 4 inter-request delays of ~4 s |
| 4. Identifying User-Agent | `DEFAULT_USER_AGENT` (project + contact), never a spoofed browser string |
| 5. Archive-first | `archive_pba_source` checks `latest_ok_record` before fetching; a re-run of this script would re-fetch nothing (all five now have `status: "ok"` manifest entries) |
| 6. Bounded retry, then stop | `_PolicedBackoffFetcher`, `DEFAULT_MAX_ATTEMPTS = 3`; not exercised this run since every request succeeded on the first attempt |
| 7. Registered paths only | `PolicedHostFetcher._enforce_registered_path` against `PBA_ALLOWED_PATHS` — the exact five paths this script iterates, no crawling |
| 8. Halt on `robots.txt` returning 200 | `check_robots_txt_still_absent(transport, PBA_HOST)` ran before any of the five fetches; still 404 this session, so the run proceeded |

Byte counts for the four PDF ("bancas"/"distribución") entries matched
`sources.yaml`'s previously-verified sizes exactly (606289, 303704, 303057,
302921 bytes) — confirms the real fetch reproduces what the SPIKE/D10
refutation session (design.md's D10 amendment) had already measured. The
HTML entry (`distrito_027.html`) came back at 471727 bytes; `sources.yaml`
did not record an exact prior byte count for it, only "verified 200,
text/html" — no discrepancy to reconcile.

`archive-manifest.json` now carries five new `"ok"` records under the
`pba` capability.

## 14.11 — ingesting PBA into `result_row`

Only `pba/2025-distrito-027` (the HTML entry) is ever parsed —
`etl.ingest.pba` never parses PDF bytes anywhere; the four "bancas" PDFs
are archived as reference documents only, exactly as documented in both
`sources.yaml` and `etl/etl/ingest/pba.py`'s module docstring. This is not
a gap left by this task: it was an explicit design decision from Phase 5.

```
export ETL_DATABASE_URL="postgresql://etl_writer:etl_writer_local_dev_only@127.0.0.1:54322/postgres"
cd etl && uv run python -m etl ingest --source pba/2025-distrito-027 --year 2025 --round generales
```

```
ingested 23 rows from pba/2025-distrito-027
```

Verified directly against Postgres:

| Category | Granularity | Rows | Total votes |
|---|---|---|---|
| `DIPUTADOS PROVINCIALES` | `distrito` | 15 | 31,490 |
| `CONCEJALES` | `distrito` | 8 | 32,291 |

Granularity is `distrito` throughout — the source publishes no mesa or
circuito breakdown for these two categories, and the system surfaces that
degradation explicitly (no fabricated finer level), per the
`electoral-ingestion` spec's "Distrito-level PBA municipal totals ingested"
scenario and `jurisdiction.make_result_row`'s no-fabrication rule.

## 14.12 — fiscalización CSV, placed and ingested with personal data stripped

The registered file
(`local://fiscalizacion/2025-coronel-rosales-mesas-procesadas.csv`) was
copied from
`/Users/nicolasmateoippoliti/Documents/Carga de Datos de Fiscalización - La Libertad Avanza - Elecciones 2025 - Mesas Procesadas.csv`
to its registered archive path,
`archive/fiscalizacion/fiscalizacion-2025-coronel-rosales.csv`
(sha256 `915613063ea544eb03c8b436307af1dd5e6889b106fdfba0a39039be21d5976e`,
9824 bytes), and registered in `archive-manifest.json` with `status: "ok"`
(a manual manifest entry, not a network fetch — `source: local-file`, the
same precedent `spikes/003` used for the pre-archived national ZIP). The
OTHER file in the same source directory
(`...Respuestas.csv`, 40,555 bytes) was deliberately NOT copied, NOT
registered, and NOT ingested — out of scope per this task's own
instruction.

The raw source file's header row confirms `Nombre,Apellido` columns are
present in the original (`Nombre,Apellido,Escuela,Mesa,<15 party
columns>`) — i.e. this is genuinely unstripped input, not a
pre-sanitized fixture, so the strip step below is exercised for real.

```
cd etl && uv run python -m etl ingest --source fiscalizacion/2025-coronel-rosales --year 2025 --round legislativas
```

```
ingested 1395 rows from fiscalizacion/2025-coronel-rosales
```

1395 = 93 unique mesas × 15 party/list columns (the CSV's `En blanco` and
`Impugnado` columns are not list-identity rows). 93 distinct
`jurisdiction_id`s confirmed via `count(distinct jurisdiction_id) from
result_row where source_kind='fiscalizacion'`.

### Personal-data verification — by querying the database, not trusting the code

Extracted the 36 distinct `Nombre`/`Apellido` tokens from the raw source
CSV (in memory, never written to any file or printed), then queried every
`text`/`character varying` column in every table in the `public` schema
for a case-insensitive substring match against each token:

| Table.column checked | Non-null rows | Rows matching any fiscal name/surname token |
|---|---|---|
| `review_item.note` | 0 | 0 |
| `review_item.subject_ref` | 0 | 0 |
| `jurisdiction.establecimiento_name` | 0 | 0 |
| `jurisdiction.distrito_name` | 0 | 0 |
| `jurisdiction.seccion_name` | 0 | 0 |
| `jurisdiction.circuito_name` | 0 | 0 |
| `archive_entry.notes` | 0 | 0 |
| `fiscalizacion_mesa_identity.evidence_note` | 0 | 0 |
| `fiscalizacion_mesa_identity.decision_ref` | 0 | 0 |
| `party_canonical.display_name` | 0 | 0 |
| `list_identity.source_name` | 0 | 0 |
| `jurisdiction_crosswalk.name` | 0 | 0 |

**Total hits: 0.** No real fiscal's name reached any table — confirmed by
direct query against the live database this session, not by reading
`PERSONAL_DATA_COLUMNS`/`strip_personal_data` and trusting it does what it
says.

## 14.13 — resulting `result_row` composition

```sql
select election.year, election.round, category.name, result_row.granularity,
       result_row.source_kind, count(*), sum(votes)
from result_row
join election on election.id = result_row.election_id
join category on category.id = result_row.category_id
group by 1,2,3,4,5 order by 1,2,3;
```

| Year | Round | Category | Granularity | `source_kind` | Rows | Total votes |
|---|---|---|---|---|---|---|
| 2025 | `generales` | CONCEJALES | distrito | `official` | 8 | 32,291 |
| 2025 | `generales` | DIPUTADOS PROVINCIALES | distrito | `official` | 15 | 31,490 |
| 2025 | `legislativas` | DIPUTADO NACIONAL | mesa | `fiscalizacion` | 1,395 | 20,294 |
| 2025 | `legislativas` | DIPUTADO NACIONAL | mesa | `official` | 1,364,412 | 22,977,871 |
| 2025 | `legislativas` | SENADOR NACIONAL | mesa | `official` | 256,699 | 5,218,954 |

**Totals**: 1,622,529 rows across 2 distinct elections (`2025/legislativas`
national, `2025/generales` PBA provincial+municipal), 28,280,900 votes.
`source_kind` breakdown: 1,621,134 `official`, 1,395 `fiscalizacion` (0
`unofficial` — no such `source_kind` exists in this schema outside
`fiscalizacion`).

This is the first time `result_row` has EVER held anything besides the
single national ZIP — the PBA provincial/municipal source and the internal
fiscalización tally are both real, queryable data now, at the granularity
each source actually publishes (distrito for PBA, mesa for fiscalización),
with zero fabricated finer levels.

### Default query still returns official-only

`ResultsRepository.queryOfficial` (`apps/web/src/lib/fiscalizacion/repository.ts`)
never issues a `source_kind` filter at the SQL/REST layer — `SupabaseRowSource`
fetches every row for `(election_id, jurisdiction_id, category_id)`, and
`queryOfficial` filters client-side to `row.sourceKind === "official"`.
This is exactly the shape D9.1's threat-matrix control worries about: a
default-query path that FORGOT the filter would now leak real
fiscalización rows for the first time, since they only just started
existing.

Verified directly against Postgres, through the `authenticated` role (the
same RLS-gated read path production traffic goes through, per
`0006_rls.sql`'s `select ... to authenticated using (true)` policy), for
the exact `(election_id, jurisdiction_id, category_id)` triple that now
holds ONLY fiscalización rows (a jurisdiction+category the PBA/fiscalización
crosswalk has not joined to any official row yet, D9.2/curated crosswalk's
known-unverified state):

```sql
set role authenticated;
select source_kind, count(*) from result_row
where election_id = '7d143b8e-98b9-4924-a88e-75992e00cc74'
  and jurisdiction_id = 'ff20ca85-2149-40c1-9051-492f94822cf1'
  and category_id = 'd09fe62f-e8cb-4ca2-ac88-a2a5f355f220'
group by source_kind;
```

```
 source_kind   | count
---------------+-------
 fiscalizacion |    15
```

All 15 rows for this key are `fiscalizacion`; zero are `official`. A
client `queryOfficial` call against this exact key would fetch these 15
rows from `SupabaseRowSource` and then filter every single one of them out
— returning `{ status: "ok", rows: [] }`, never leaking a fiscalización
figure into the default/official view. `repository.test.ts`'s existing 4
fake-backed unit tests re-ran unchanged (still green) alongside this real
query, confirming the tested behavior matches the real, now-populated
database's behavior.

## What this run does NOT cover

- The four "bancas" PBA PDFs are archived but never parsed (by design,
  Phase 5) — no seat-allocation figures from them entered `result_row`.
- The PBA/fiscalización join to the national jurisdiction hierarchy is
  still unresolved (`curated/crosswalk.yaml`'s "same-id-only, not
  exact-value-verified" state, D9.5/D4 from the SPIKE) — the zero
  `(jurisdiction_id, category_id)` overlap between `official` and
  `fiscalizacion` observed above reflects that, not a defect introduced
  this session.
- `validate-crosswalk`/`validate-curated` were not re-run against this
  expanded corpus (same deferred follow-up `spikes/003` already flagged).
