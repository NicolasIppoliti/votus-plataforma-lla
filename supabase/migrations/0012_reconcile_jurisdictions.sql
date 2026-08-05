-- 0012_reconcile_jurisdictions.sql
-- Phase 17: single administrative-code normalization boundary, applied
-- retroactively to the jurisdictions already loaded before this migration
-- (`etl.jurisdiction.normalize_distrito_code` / `normalize_seccion_code`,
-- `etl.db.upsert_jurisdiction` / `batch_upsert_jurisdictions` now apply the
-- same transform going forward -- this migration reconciles what was
-- written BEFORE that fix existed).
--
-- Measured live before this migration, Coronel Rosales existed as THREE
-- separate jurisdiction identities:
--
--   distrito_code | seccion_code | jurisdictions | rows   | source
--   --------------|--------------|---------------|--------|---------------
--   02            | 027          | 94            | 1 395  | fiscalización
--   027           | NULL         | 1             | 23     | PBA official
--   2             | 27           | 166           | 38 983 | national official
--
-- Cause 1 (format): national ingestion wrote the raw CSV's UNPADDED
-- distrito/seccion ("2"/"27"); fiscalización wrote the curated PADDED form
-- ("02"/"027"). This migration canonicalizes EVERY jurisdiction row's
-- distrito_code/seccion_code nationwide to the padded form and merges any
-- jurisdiction rows that become identical (same distrito/seccion/circuito/
-- establecimiento/mesa) as a result -- scoped in practice to Coronel
-- Rosales, since national ingestion's raw-CSV padding is uniform across the
-- rest of the corpus (no other jurisdiction in this project has ever been
-- ingested from more than one source).
--
-- Cause 2 (scheme) is NOT fixed by this migration: PBA's stray
-- distrito_code = "027" jurisdiction is a DIFFERENT numbering scheme,
-- resolved going forward by `etl.ingest.pba.resolve_pba_jurisdictions`
-- (task 17.5, code-level fix, no historical PBA jurisdiction to reconcile
-- here since only 1 row exists and it is superseded by re-ingesting PBA
-- under the corrected code path -- see spikes/006 for the live before/after
-- verification and the operational note on that one stray row).
--
-- Safety invariants (task 17.6):
--   1. result_row's total row count MUST NOT change -- asserted before and
--      after, inside the same transaction, raising loudly on any mismatch.
--   2. A repoint that would collide two result_row rows on their natural
--      key (archive_entry_id, jurisdiction_id, category_id, list_id,
--      source_kind) MUST abort the whole migration rather than silently
--      drop one side via ON CONFLICT DO NOTHING -- checked explicitly
--      BEFORE any UPDATE runs.
--   3. jurisdiction's unique key spans four NULLABLE columns, and Postgres
--      never matches NULL = NULL for conflict detection (etl/etl/db.py's
--      upsert_jurisdiction docstring) -- grouping below uses
--      `IS NOT DISTINCT FROM` semantics (via a plain GROUP BY on nullable
--      columns, which already treats NULLs as equal to each other, unlike
--      a unique CONSTRAINT/index would) so two distrito-level rows that are
--      both circuito/establecimiento/mesa = NULL are correctly recognized
--      as duplicates of one another.

begin;

do $$
declare
  before_count bigint;
  after_count bigint;
  duplicate_group_count bigint;
begin
  select count(*) into before_count from result_row;

  -- Step 1: the canonical form of every jurisdiction row's distrito/seccion,
  -- alongside its unchanged circuito/establecimiento/mesa, plus a single
  -- NULL-safe text `merge_key` composing all five. A plain `=` on
  -- `merge_key` is hash-joinable; the equivalent five-column
  -- `IS NOT DISTINCT FROM` join is NOT (measured live: it degrades to a
  -- nested-loop plan over ~163k jurisdiction rows and did not finish in a
  -- reasonable time), so the join/group-by below use `merge_key` instead
  -- of the raw nullable columns directly.
  --
  -- TWO different transforms, by numbering scheme -- NOT one blind zero-pad
  -- (the bug this migration itself must not repeat, `etl.jurisdiction`'s
  -- module docstring explains why in code):
  --   - A PBA-scheme jurisdiction (distrito-only: seccion/circuito/
  --     establecimiento/mesa all NULL, distrito_code found in
  --     `jurisdiction_crosswalk.pba_distrito_code`) is TRANSLATED via the
  --     curated crosswalk to the national distrito code -- zero-padding
  --     PBA's own "027" would silently produce "27", a real but WRONG
  --     national code (national seccion 027's own digits, not distrito 02).
  --   - Every other (national-scheme) jurisdiction is zero-padded to the
  --     curated DINE form, matching `etl.jurisdiction.normalize_distrito_code`
  --     / `normalize_seccion_code` exactly.
  create temporary table jurisdiction_canonical as
  select
    j.id,
    coalesce(xw.national_distrito_code, canon.canonical_distrito) as canonical_distrito,
    canon.canonical_seccion,
    j.circuito_code,
    j.establecimiento_code,
    j.mesa_code,
    concat_ws(
      chr(31),
      coalesce(xw.national_distrito_code, canon.canonical_distrito),
      coalesce(canon.canonical_seccion, chr(1)),
      coalesce(j.circuito_code, chr(1)),
      coalesce(j.establecimiento_code, chr(1)),
      coalesce(j.mesa_code::text, chr(1))
    ) as merge_key
  from jurisdiction j
  cross join lateral (
    select
      case when j.distrito_code ~ '^[0-9]+$'
        then lpad(j.distrito_code::int::text, 2, '0')
        else j.distrito_code
      end as canonical_distrito,
      case
        when j.seccion_code is null then null
        when j.seccion_code ~ '^[0-9]+$' then lpad(j.seccion_code::int::text, 3, '0')
        else j.seccion_code
      end as canonical_seccion
  ) canon
  left join jurisdiction_crosswalk xw
    on j.seccion_code is null
   and j.circuito_code is null
   and j.establecimiento_code is null
   and j.mesa_code is null
   and xw.pba_distrito_code = j.distrito_code;

  create index on jurisdiction_canonical (merge_key);

  -- Step 2: one canonical jurisdiction id per distinct `merge_key`
  -- (equivalent to grouping by the five original columns with NULL-safe
  -- equality) -- deterministic tie-break: the smallest id survives.
  create temporary table jurisdiction_merge_target as
  select
    merge_key,
    min(id::text)::uuid as canonical_id,
    count(*) as member_count
  from jurisdiction_canonical
  group by 1;

  create index on jurisdiction_merge_target (merge_key);

  select count(*) into duplicate_group_count
  from jurisdiction_merge_target where member_count > 1;

  -- Step 3: map every NON-canonical duplicate id to its group's canonical id.
  create temporary table jurisdiction_remap as
  select jc.id as old_id, jmt.canonical_id
  from jurisdiction_canonical jc
  join jurisdiction_merge_target jmt using (merge_key)
  where jc.id <> jmt.canonical_id;

  -- Step 4a: collision check -- two duplicate rows being merged together
  -- both already carrying a result_row on the exact same natural key.
  if exists (
    select 1
    from result_row rr
    join jurisdiction_remap jr on jr.old_id = rr.jurisdiction_id
    group by jr.canonical_id, rr.archive_entry_id, rr.category_id, rr.list_id, rr.source_kind
    having count(*) > 1
  ) then
    raise exception
      'migration 0012: repointing would collide two result_row rows on their '
      'natural key (archive_entry_id, jurisdiction_id, category_id, list_id, '
      'source_kind) -- aborting, no votes may be silently dropped';
  end if;

  -- Step 4b: collision check -- a duplicate row's result_row colliding with
  -- one that already sits at the canonical id.
  if exists (
    select 1
    from result_row rr_dup
    join jurisdiction_remap jr on jr.old_id = rr_dup.jurisdiction_id
    join result_row rr_existing
      on rr_existing.jurisdiction_id = jr.canonical_id
     and rr_existing.archive_entry_id = rr_dup.archive_entry_id
     and rr_existing.category_id = rr_dup.category_id
     and rr_existing.list_id is not distinct from rr_dup.list_id
     and rr_existing.source_kind = rr_dup.source_kind
  ) then
    raise exception
      'migration 0012: repointing would collide with a result_row already at '
      'the canonical jurisdiction -- aborting, no votes may be silently dropped';
  end if;

  -- Step 5: repoint every affected result_row, now proven collision-free.
  update result_row rr
  set jurisdiction_id = jr.canonical_id
  from jurisdiction_remap jr
  where rr.jurisdiction_id = jr.old_id;

  -- Step 6: canonicalize the SURVIVING jurisdiction rows' own codes too
  -- (every jurisdiction nationwide, not just the ones with a duplicate),
  -- so a future ingest run -- which now always writes padded codes via the
  -- Phase 17 write boundary -- resolves to the SAME row rather than
  -- creating a fresh duplicate next time.
  update jurisdiction j
  set distrito_code = jc.canonical_distrito,
      seccion_code = jc.canonical_seccion
  from jurisdiction_canonical jc
  where j.id = jc.id
    and j.id not in (select old_id from jurisdiction_remap)
    and (
      j.distrito_code is distinct from jc.canonical_distrito
      or j.seccion_code is distinct from jc.canonical_seccion
    );

  -- Step 7: delete the emptied duplicate jurisdiction rows.
  delete from jurisdiction where id in (select old_id from jurisdiction_remap);

  select count(*) into after_count from result_row;
  if before_count <> after_count then
    raise exception
      'migration 0012: result_row count changed from % to % -- aborting, must '
      'not lose or duplicate a single row', before_count, after_count;
  end if;

  raise notice
    'migration 0012: merged % duplicate jurisdiction group(s) (% jurisdiction '
    'row(s) removed), result_row count unchanged at %',
    duplicate_group_count, (select count(*) from jurisdiction_remap), after_count;
end $$;

commit;
