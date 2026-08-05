# SPIKE 003 — first end-to-end pipeline run (task 12.16)

> Runs the real pipeline once against the already-archived 2025 national ZIP
> (`archive/national_2025/legislativas2025.zip`, 13 554 180 bytes, sha256
> `5fb19bb280af8895dc0bc2ac19d79e836fb4053b713a135357743bf35371ee4b`) through
> the actual runtime harnesses built in this phase (`etl/etl/__main__.py`,
> the `etl_writer` write role from `0009_etl_write_grants.sql`) — not a
> bespoke script. This is the first evidence the system RUNS, not just that
> its functions pass unit tests.

## Why the archived file needed a small setup step first

`sources.yaml` registers `national/2025-legislativas` with
`filename: 2025-legislativas.zip` under the `national` capability, which
`LocalArchiveStore` expects at `archive/national/2025-legislativas.zip`. The
actual pre-archived copy from the SPIKE lives at
`archive/national_2025/legislativas2025.zip` — a different directory and
filename, outside that convention, with no `archive-manifest.json` entry
at all (the file predates this project ever writing one).

`archive/` is entirely gitignored (D2 — provenance lives in the committed
manifest, not git-tracked bytes), so this is a local, reversible setup step,
not a modification to any tracked or archived evidence:

```
mkdir -p archive/national
cp archive/national_2025/legislativas2025.zip archive/national/2025-legislativas.zip
shasum -a 256 archive/national/2025-legislativas.zip
# 5fb19bb280af8895dc0bc2ac19d79e836fb4053b713a135357743bf35371ee4b  (matches, byte count matches: 13554180)
```

`archive-manifest.json` (committed alongside this file) was then written
with one `status: "ok"` record for `national/2025-legislativas` pointing at
the copied path, so `ingest` finds it through the same `latest_ok_record`
lookup `fetch` would have produced from a real network fetch. The original
file at `archive/national_2025/legislativas2025.zip` was left untouched.

## A genuine bug found and fixed during this run

`ingest_source` (task 12a) originally passed the archived bytes straight to
`ingest_national`, which expects a bare CSV — but every registered national
source is a ZIP. The first real run failed immediately with
`UnicodeDecodeError` trying to `.decode("utf-8")` raw ZIP bytes. Fixed by
adding `resolve_national_results_bytes` (`etl/etl/__main__.py`), which
extracts the archive (`storage.extract_zip_safely`, the same safe-extraction
path `tests/test_ingest_national.py` already exercises) and picks the one
CSV member whose header matches `ingest.national.REQUIRED_COLUMNS` — never
a hardcoded filename, since the results file is named `resultados2025.csv`
in 2025 and `ResultadosElectorales.csv` in 2023. Covered by a new RED/GREEN
test, `test_cli.py::test_ingest_extracts_the_results_csv_from_a_zip_archived_national_source`.

## The run

```
export ETL_DATABASE_URL="postgresql://etl_writer:etl_writer_local_dev_only@127.0.0.1:54322/postgres"
cd etl && uv run python -m etl ingest --source national/2025-legislativas --year 2025 --round legislativas
```

```
ingested 1621111 rows from national/2025-legislativas
( cd etl && uv run python -m etl ingest --source national/2025-legislativas  )  35.32s user 12.95s system 13% cpu 5:53.33 total
```

Ran through `etl_writer` — the real, dedicated, non-superuser write role
from `0009_etl_write_grants.sql` (task 12c), not the `postgres` superuser
DSN — proving that role's grants work against real production-shaped data,
not just the pgTAP fixture in `rls_write_role.sql`.

## Result

Queried directly against the local Postgres instance after the run:

| Metric | Value |
|---|---|
| `result_row` count for this archive entry | **1,621,111** |
| Distinct elections | **1** (2025, legislativas) |
| Distinct jurisdictions (mesas) | **108,992** |
| Distinct categories | **2** (`DIPUTADO NACIONAL`, `SENADOR NACIONAL`) |
| Distinct distrito codes | 26 (24 provinces + CABA + one additional code observed in the source) |
| `source_kind` breakdown | 1,621,111 `official`, 0 `fiscalizacion` (expected — this run only ingested the national ZIP) |
| Total votes summed | 28,196,825 (plausible order of magnitude for a national legislative election) |
| Wall-clock | **5 min 53 s** total (35.3 s user + 13.0 s system CPU — 13% average CPU, i.e. dominated by wait time, not computation) |

`result_row` held **0** rows before this phase (the finding that opened
Phase 12). It now holds real, queryable data from the actual archived
source, loaded through the actual CLI, through the actual write role.

## A genuine, un-papered-over performance finding

13% average CPU utilization over a ~6-minute run for ~109k distinct
jurisdictions means the run is latency-bound, not compute-bound.
`pg_stat_activity` sampled mid-run consistently showed the connection
`active` inside `db.py::upsert_jurisdiction`'s `select id from jurisdiction
where distrito_code = $1 and seccion_code is not distinct from $2 ...`
lookup — `load_national_rows`'s per-row jurisdiction cache only avoids a
repeat round trip for an ALREADY-SEEN mesa within the same run; the first
occurrence of each of the ~109k distinct mesas still costs one synchronous
`SELECT` (cache miss) immediately followed by one `INSERT` on a genuine
miss. At real national scale this is roughly 100k+ synchronous round trips
in sequence, which is exactly the ~6-minute wall-clock measured here.

This is a real N+1-shaped bottleneck, not fixed as part of this task —
task 12.16 asks this phase to run the pipeline and record the outcome, not
to redesign `load_national_rows`'s upsert strategy (e.g. a single
bulk-upsert statement or a pre-loaded jurisdiction cache keyed from the
manifest would remove most of these round trips). Flagged here as a
concrete, measured forward gap for whichever change next touches
`etl/etl/db.py::upsert_jurisdiction`/`load_national_rows` at real scale —
5-6 minutes is tolerable for a one-off manual run but would not be for a
tight ingestion-then-serve loop.

## UPDATE (Phase 14b): batched jurisdiction resolution re-run

Task 14.4-14.6 fixed the N+1 flagged above. `etl/etl/db.py::batch_upsert_jurisdictions`
replaced `load_national_rows`'s per-mesa `upsert_jurisdiction` calls with
exactly two round trips for the whole batch: one `unnest(...) with ordinality`
`SELECT` (NULL-safe `IS NOT DISTINCT FROM` join, preserving the same
semantics `upsert_jurisdiction` already required — migration 0002's unique
key spans four nullable columns, so a plain `ON CONFLICT` would silently
duplicate every row with a `NULL` in that key) to resolve every already-
known jurisdiction in one shot, then one bulk `INSERT ... SELECT * FROM
unnest(...) RETURNING ...` for whatever is missing. Proven with a new
integration test, `test_jurisdiction_resolution_is_batched_not_per_row`
(50 distinct mesas, asserts round trips stay under 10 — a per-row pattern
would issue at least 100).

Re-ran the SAME command against the SAME archived source
(`archive/national/2025-legislativas.zip`, sha256
`5fb19bb280af8895dc0bc2ac19d79e836fb4053b713a135357743bf35371ee4b`),
through the same `etl_writer` role, on the same machine:

```
export ETL_DATABASE_URL="postgresql://etl_writer:etl_writer_local_dev_only@127.0.0.1:54322/postgres"
cd etl && time uv run python -m etl ingest --source national/2025-legislativas --year 2025 --round legislativas
```

```
ingested 1621111 rows from national/2025-legislativas
uv run python -m etl ingest --source national/2025-legislativas --year 2025    20.07s user 5.19s system 44% cpu 57.156 total
```

| Metric | Before (task 12.16) | After (task 14.6) |
|---|---|---|
| Wall-clock | **5 min 53 s** (353 s) | **57 s** |
| Speedup | — | **~6.2x** |
| `result_row` count | 1,621,111 | 1,621,111 (identical) |
| Distinct jurisdictions | 108,992 | 108,992 (identical) |
| Distinct categories | 2 | 2 (identical) |
| Total votes | 28,196,825 | 28,196,825 (identical) |
| Average CPU | 13% (latency-bound) | 44% (still not compute-bound, but far less wait) |

The composition is byte-for-byte identical to the original run — this was
purely a round-trip-count fix, not a behavior change. The remaining ~57 s
is dominated by CSV parsing and the ~1.6M-row bulk `result_row` insert, not
jurisdiction resolution; no further N+1 was observed for this source.

## What this run does NOT cover

- PBA and fiscalización ingestion were not re-run here (already covered by
  `etl/tests/test_integration_idempotent.py` and
  `etl/tests/test_ingest_fiscalizacion.py`'s real-Postgres tests against
  synthetic/small fixtures — task 12.16 asks specifically for the national
  ZIP, the largest and previously entirely unexercised source).
- `validate-crosswalk`/`validate-curated` were not run against this data
  set in this session (a further, cheap follow-up once the ingest
  performance finding above is addressed, since a second full extract-and-
  parse pass over the same 457 MB CSV would cost roughly the same
  wall-clock again without needing the slow per-mesa upsert loop).
