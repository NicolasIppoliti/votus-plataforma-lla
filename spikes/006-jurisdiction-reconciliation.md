# SPIKE 006 — one real jurisdiction, one row (Phase 17, tasks 17.1-17.7)

## Before — three jurisdiction identities for Coronel Rosales

Measured live, at the start of this phase, against the real loaded corpus
(`result_row` total 18 170 989 rows):

| distrito_code | seccion_code | jurisdictions | rows   | source        |
|---|---|---|---|---|
| `02`  | `027` | 94  | 1 395  | fiscalización |
| `027` | NULL  | 1   | 23     | PBA official  |
| `2`   | `27`  | 166 | 38 983 | national official |

Two distinct causes, both traced to administrative codes being normalized
per call site instead of behind one boundary (already flagged in Phase 16,
not chased down for the write path that actually CREATES jurisdictions):

1. **Format.** `ingest_national` wrote the raw CSV's UNPADDED `2`/`27`;
   `ingest_fiscalizacion` wrote the curated PADDED `02`/`027` directly. Same
   real mesa, two distinct jurisdiction rows.
2. **Scheme.** `ingest_pba` wrote its own `distrito_code = "027"` straight
   into `db.upsert_jurisdiction`. The single `jurisdiction_crosswalk` row
   says PBA `027` maps to national `02`/`027`, but the crosswalk was never
   consulted at ingestion — `etl.crosswalk.resolve_jurisdiction` existed and
   was tested (`test_crosswalk.py`) but had no production call site, the
   same tested-but-unreachable pattern this project has hit repeatedly.

Consequence: the accepted mesa-identity join (93/93 injective, SPIKE 0.9 /
Engram #1410) did not actually execute against real data — a query filtered
by `distrito_code = '02'` (the curated, canonical form) found fiscalización
and PBA but missed all 166 national jurisdictions, silently. The
orchestrator's earlier cross-year comparison only worked because a human
hand-wrote `distrito_code in ('02', '2')`.

## The fix

- **`etl/etl/jurisdiction.py`** — `normalize_distrito_code` /
  `normalize_seccion_code`: the single canonical (curated PADDED) transform,
  since `curated/*.yaml` and `jurisdiction_crosswalk` already use it and
  changing THOSE would be the larger blast radius. Deliberately **not**
  applied inside `make_result_row` itself — `ingest.pba`'s pre-crosswalk-
  resolution value is not yet a national code, and blindly zero-padding
  PBA's own `"027"` to a 2-digit width silently produces `"27"`, a real but
  WRONG national code (this was caught live: an early version of this fix
  applied normalization inside `make_result_row` and broke
  `test_distrito_level_totals_ingested_without_fabricating_lower_levels`,
  which is what surfaced the scheme-vs-format distinction concretely).
  `resolve_pba_distrito_code(code, crosswalk)` resolves (or quarantines,
  task 17.3) a PBA-native code through the crosswalk instead.
- **`etl/etl/db.py`** — `upsert_jurisdiction` / `batch_upsert_jurisdictions`
  now apply `normalize_distrito_code`/`normalize_seccion_code` at the actual
  write boundary (the one place every ingestion path funnels through
  regardless of which parser built the row), proven live against real
  Postgres in `test_integration_idempotent.py::
  test_padded_and_unpadded_national_codes_share_one_jurisdiction_row`.
- **`etl/etl/ingest/pba.py`** — new `resolve_pba_jurisdictions(rows,
  crosswalk)`, mirroring `ingest.national.resolve_jurisdictions`'s
  mapped/quarantined split. `load_pba_rows` now requires a `crosswalk`
  argument and calls this BEFORE any `db.upsert_jurisdiction` call — an
  uncurated PBA distrito code is reported to stderr and never written
  (task 17.3), never silently creating a new PBA-scheme island.
- **`etl/etl/__main__.py`** — `ingest_source`'s PBA branch loads
  `curated/crosswalk.yaml` and passes it through; the pre-existing
  `_normalize_administrative_code` (unpadded-comparison direction, a THIRD
  copy of the same idea) was deleted and every call site now uses the
  field-aware `normalize_distrito_code`/`normalize_seccion_code` from
  `etl.jurisdiction` — one definition, not three.
- **`supabase/migrations/0012_reconcile_jurisdictions.sql`** — reconciles
  what was already written before this fix existed (see below).

## Migration 0012 — what it actually did

Two independent transforms, computed per jurisdiction row and stored in a
`merge_key` used for a fast, hash-joinable equality (the naive five-column
`IS NOT DISTINCT FROM` join was tried first and measured live to degrade to
a nested-loop plan that did not finish in a reasonable time over ~163k
jurisdiction rows — cancelled and replaced with the `merge_key` approach,
which completed the whole migration in **7.7 seconds**):

1. Every NATIONAL-scheme jurisdiction (has a seccion/circuito/establecimiento
   /mesa, or a distrito code not found in `jurisdiction_crosswalk`) is
   zero-padded to the curated DINE form.
2. Every PBA-scheme jurisdiction (distrito-only: seccion/circuito/
   establecimiento/mesa all NULL, distrito code found in
   `jurisdiction_crosswalk.pba_distrito_code`) is TRANSLATED via the
   crosswalk to the national distrito code — never blindly padded.

Safety invariants, enforced inside the migration's own transaction:

- `result_row` count asserted equal before and after — **18 170 989 both
  times**, verified live.
- Two explicit collision checks (duplicate rows merging into the same
  `result_row` natural key, and a merging row colliding with one already at
  the canonical id) run BEFORE any repoint, raising loudly rather than
  risking a silent `ON CONFLICT DO NOTHING` vote loss. Neither fired for
  this real corpus: the merge produced **0 duplicate jurisdiction groups**
  for the current data, because fiscalización's jurisdiction rows carry
  `circuito_code = NULL` (that source has no circuito) while national's
  mesa rows always carry a real circuito code — they were never literally
  the same 5-tuple even after padding, which is the correct, non-fabricated
  outcome per the jurisdiction-model's "no inventing lineage a source
  doesn't have" rule, not a bug. What the migration DID do for every
  surviving row is the code RELABELING (national's 166 rows: `2`/`27` →
  `02`/`027`; PBA's 1 row: `027` → `02`), which is what actually reconciles
  the query surface.

## After — live verification

```sql
select distrito_code, seccion_code, count(distinct j.id) as jurisdictions, ...
from jurisdiction j left join result_row rr on rr.jurisdiction_id = j.id
where j.distrito_code = '02'
```

For `distrito_code = '02'`, `seccion_code = '027'`:

| jurisdictions | rows   | source_kind    |
|---|---|---|
| 93  | 1 395  | fiscalización (the 1 extra pre-migration was a same-session orphan test artifact, 0 rows, unrelated to the real corpus) |
| 166 | 38 983 | official (national — now correctly under `02`/`027`, was `2`/`27`) |

For `distrito_code = '02'`, `seccion_code IS NULL`:

| jurisdictions | rows | source_kind |
|---|---|---|
| 1 | 23 | official (PBA — now correctly under `02`, was `027`) |

**Every distinct `distrito_code` in the whole corpus is now a canonical
2-digit DINE code (`01`-`24`)** — confirmed with `select distinct
distrito_code from jurisdiction order by 1;`, 24 rows, all 2 digits.

**Coronel Rosales now resolves to ONE canonical code family**: a query
filtered by `distrito_code = '02' and seccion_code = '027'` (no hand-written
`OR`/`IN` needed) now finds ALL of national's mesa-level results AND
fiscalización's mesa-level results; `distrito_code = '02' and seccion_code
IS NULL` finds PBA's distrito-level result. This is what "one jurisdiction
set" means structurally: the numbering SCHEME is unified, while the
jurisdiction ROWS legitimately stay distinct per granularity (fiscalización
has no circuito to report; PBA has no seccion/circuito/mesa to report) —
exactly the jurisdiction-model's no-fabrication rule, not a residual bug.

**Fiscalización mesas join to national mesas by identity**, verified with the
already-accepted mesa-number join (`etl.crosswalk.join_fiscalizacion_identity`,
Engram #1410 — never jurisdiction-row equality), now reachable with plain
canonical filtering instead of a hand-written padding workaround:

```sql
with fisc_mesas as (
  select mesa_code from jurisdiction
  where distrito_code='02' and seccion_code='027'
    and circuito_code is null and mesa_code is not null
),
official_mesas as (
  select mesa_code from jurisdiction
  where distrito_code='02' and seccion_code='027'
    and circuito_code is not null and mesa_code is not null
)
select (select count(*) from fisc_mesas) as fiscalizacion_mesas,
       (select count(*) from official_mesas) as official_mesas,
       (select count(*) from fisc_mesas fm
          where fm.mesa_code in (select mesa_code from official_mesas)
       ) as matched_by_identity;
```

Result:

| fiscalizacion_mesas | official_mesas | matched_by_identity |
|---|---|---|
| 93 | 167 | **93** |

All 93 fiscalización mesas match a same-numbered official mesa — 100%,
consistent with the SPIKE 0.9 / Engram #1410 verdict, now provable with a
plain canonical-code filter instead of a hand-authored workaround.

## Result_row integrity

`select count(*) from result_row` before the migration: **18 170 989**.
After: **18 170 989**. Unchanged, asserted inside the migration's own
transaction (would have raised and rolled back on any mismatch).

## Environment note

Applied directly with `psql` against the running local Supabase instance
(`docker exec supabase_db_votus-plataforma-lla psql -U postgres -f
0012_reconcile_jurisdictions.sql`) — **not** `supabase db reset`, per the
explicit instruction to preserve the hours-long real corpus load. The
migration file is idempotent (re-running it finds 0 duplicate groups and 0
surviving rows still needing relabeling) but was applied exactly once this
session.
