# PASO-scale ingestion evidence (2023 PASO, national file)

First real, full-source run of the existing ingestion entrypoint on the archived 2023 PASO
national results, against a local Supabase Postgres. It records memory, time, row
accounting, exclusions, idempotency and transactional outcomes.

**Result:** the full source ingests with zero unexplained loss, zero ambiguity quarantine and
internal lists preserved. Peak RSS stays under 2.8 GB. A rerun is idempotent, and an interrupted
run leaves no partial data. The cost is wall time and disk: about 66 minutes for a first load,
about 110 minutes for a reload, and a reload temporarily doubles the database footprint.

Code baseline: `main` at `e4a6c67`. Run date: 2026-10-10. Host: Apple Silicon arm64, 16 GiB RAM.
This supersedes the unexecuted proposal on the unmerged branch `chore/paso-source-scale-evidence`.

## Input

| Fact | Value |
| --- | --- |
| Source id | `national/2023-paso-wayback` (registry `etl/sources.yaml`, manifest `archive-manifest.json`) |
| Archive | `archive/national/2023-paso-wayback.zip`, 88,157,604 bytes |
| SHA-256 (computed) | `25558e7b73e8c273726ea12f04040e2fac8e693ad0eb866386502eb112bd2c0c`, equal to the manifest |
| Result member | `2023_PASO/ResultadosElectorales.csv`, 3,756,022,182 bytes uncompressed |
| CSV records | 16,600,877 data rows (16,600,878 lines including the header) |

## Target and method

- **Database.** A dedicated database, `votus_paso_scale`, inside the user's running local
  Supabase Postgres (`127.0.0.1:54322`). No new container, no hosted database.
- **Schema.** `etl.verify.apply_migrations` cannot target a sibling database in the
  Supabase cluster: roles are cluster-wide, and the first role-creating migration fails with
  `role "results_exploration_executor" already exists`. The schema was cloned instead with
  `pg_dump -s -n public -n workspace_api -n workspace_private` from the migrated local
  database. The clone matched it: 20 tables, 54 policies, 7 `result_row` indexes.
- **Watchdog**, agreed before the run: abort when host free disk drops below 5 GiB, when RSS
  exceeds 10 GiB, or after 120 minutes. A sample every 5 s recorded free disk, process RSS,
  `pg_database_size` and temp usage. On abort it sends SIGINT, then SIGKILL.
- **Measurement.** Time and memory come from `/usr/bin/time -l` (macOS), which is authoritative.
  Sampled RSS is unreliable on macOS, because memory compression shrinks it to about 18 MB
  while the process waits on Postgres.
- `TMPDIR` pointed at an owned directory. The CSV extracts there (3.67 GB) and is removed
  afterwards. The database was dropped at the end.

Command, run from the repository root:

```sh
TMPDIR=<owned-temp> /usr/bin/time -l etl/.venv/bin/python -m etl \
  --sources-path etl/sources.yaml --local-root archive --manifest-path archive-manifest.json \
  ingest --source national/2023-paso-wayback --year 2023 --round paso \
  --database-url postgresql://postgres:<local>@127.0.0.1:54322/votus_paso_scale \
  --metrics-output <new-file>.json
```

## Runs

| Run | Purpose | Outcome | Wall (s) | User / sys CPU (s) | Max RSS (bytes) | Peak footprint (bytes) | DB size after |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |
| 1 | First load | Watchdog abort: free disk < 5 GiB at 3644 s | 3654.61 | 573.22 / 128.99 | 2,685,222,912 | 6,116,381,400 | 0 rows committed |
| 2 | First load, after freeing disk | Succeeded | 3994.76 | 557.85 / 130.95 | 2,789,703,680 | 6,117,692,120 | 8,338,803,859 B |
| 3 | Identical rerun | Succeeded | 6597.38 | 679.90 / 158.11 | 2,406,858,752 | 6,117,561,048 | 14,115,171,475 B |
| 4 | Planned SIGINT at 1200 s, over run 3's data | Interrupted | 1211.43 | 336.14 / 62.73 | 1,890,009,088 | 6,116,020,952 | unchanged |

Freeing disk between runs 1 and 2 meant pruning unused Docker images (8.6 GB, user-authorized).
Host free disk fell by up to 11 GiB during the first load and by up to 9.6 GiB during the rerun.

## Row accounting

Run 2's stdout: `ingested 13627397 rows from national/2023-paso-wayback`.

`records_seen` 16,600,877 = `rows_emitted` 13,627,397 + excluded 2,973,480. Unexplained loss: **0**.

- `ambiguous_categories`: `{}`. **No ambiguity quarantine**: not one PASO row was quarantined.
- `unreadable_vote_rows`: 0 for every reason.
- Every stored row has `granularity = mesa` and `source_kind = official`.
- Stored data: 1 election (`2023/paso`), 10 categories, 106,662 mesa jurisdictions,
  372 distinct `list_id` values and 119,885,162 list votes.

### Exclusions per reason

Excluded rows are out of scope for normalized list votes. The ingest reports them on stderr
and in `--metrics-output`:

| `votos_tipo` | Rows | Votes |
| --- | ---: | ---: |
| EN BLANCO | 594,696 | 12,727,253 |
| NULO | 594,696 | 1,459,610 |
| IMPUGNADO | 594,696 | 37,586 |
| RECURRIDO | 594,696 | 48,202 |
| COMANDO | 594,696 | 163,776 |

### Per category

Each excluded reason accounts for the same row count within a category, exactly one row per
mesa and category. That matches the source shape.

| Category | Records seen | Rows stored | Excluded rows (per reason) | Votes stored | Distinct lists |
| --- | ---: | ---: | ---: | ---: | ---: |
| CONCEJAL | 16,105 | 11,165 | 988 | 172,832 | 53 |
| DIPUTADOS/AS NACIONALES | 2,728,753 | 2,206,093 | 104,532 | 20,704,629 | 216 |
| DIPUTADOS/AS PROVINCIALES | 626,402 | 514,312 | 22,418 | 4,274,129 | 46 |
| GOBERNADOR/A | 1,233,990 | 1,023,140 | 42,170 | 8,272,836 | 44 |
| INTENDENTE/A | 984,431 | 778,246 | 41,237 | 8,287,337 | 102 |
| PARLAMENTO MERCOSUR NACIONAL | 2,659,326 | 2,136,666 | 104,532 | 21,461,156 | 21 |
| PARLAMENTO MERCOSUR REGIONAL | 2,895,519 | 2,372,859 | 104,532 | 20,463,470 | 213 |
| PRESIDENTE/A | 3,114,677 | 2,592,017 | 104,532 | 22,539,543 | 27 |
| SENADORES/AS NACIONALES | 1,751,578 | 1,505,333 | 49,249 | 9,722,749 | 84 |
| SENADORES/AS PROVINCIALES | 590,096 | 487,566 | 20,506 | 3,986,481 | 41 |

Internal PASO lists survive. For example, PRESIDENTE/A keeps 27 lists and DIPUTADOS/AS
NACIONALES keeps 216. The 6.46M-row quarantine regression does not recur.

## Idempotency (run 3)

The rerun replaces its scope: it deletes by archive entry and election, then inserts, inside one
transaction. Its results compared with run 2:

- stdout is identical, and the `--metrics-output` JSON is byte-for-byte equal.
- Fingerprint identical: 13,627,397 rows; 119,885,162 votes; 372 lists; 106,662 mesas;
  1/10/106,662/1 election/category/jurisdiction/archive-entry rows; md5 of the sorted logical
  identity (`distrito:seccion:circuito:mesa | category | list_id | votes | mesa_tipo`)
  `3c1f44ae501fe8c22b4aea215e49072e` before and after.
- Only the database size changed, from 8.34 GB to 14.12 GB. The in-transaction delete leaves
  13.6M dead tuples until vacuum.

## Transactional outcome (runs 1 and 4)

- **Run 1**, aborted on a fresh database by the watchdog: afterwards `result_row`, `election`,
  `category`, `jurisdiction` and `archive_entry` each held **0** rows. The archive projection
  and reference writes rolled back along with the vote rows.
- **Run 4**, SIGINT at 1200 s over run 3's data. Postgres statistics show the run had deleted
  all 13,627,397 existing rows and inserted 1,183,000 new ones: `n_tup_ins` 28,437,794 =
  2 × 13,627,397 + 1,183,000, and `n_dead_tup` 1,183,000 afterwards. After rollback the
  fingerprint was identical to run 3's, including the md5. **No partial data.**

## Findings

No defect of the kinds this experiment targets: silent loss, misleading exclusion or memory
blowup. Operational findings:

1. **Wall time.** A first load takes 66 minutes, at about 3,400 rows/s through 1,000-row
   `executemany` batches into a table with 7 indexes. A reload takes 110 minutes, because it
   inserts into indexes already holding the rows it deletes.
2. **Reload disk.** A reload needs roughly twice the loaded size at once: about 8.3 GB of data
   plus 3.7 GB of temp extraction. On this host that left 7.8 GiB free at the lowest point.
3. **Memory is bounded but not small.** Max RSS is 2.4–2.8 GB, and macOS reports a peak
   footprint of 6.1 GB. The first pass retains every candidate natural key: 13.6M keys.
4. **Blank and null votes are not stored.** About 14.4M non-list votes are reported per reason
   but never projected. Turnout and blank share cannot be derived from `result_row`. This is
   the current normalized-list-vote scope, not loss.
5. **Schema tooling.** `apply_migrations` cannot prepare an isolated database inside a cluster
   whose roles already exist, such as local Supabase. Isolated runs need a schema clone or a
   separate Postgres.

Faster bulk loading (for example `COPY`) and reload strategies are possible follow-ups.
This experiment does not decide them.
