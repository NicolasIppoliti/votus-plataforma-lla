-- `result_row`'s natural key must include `election_id`.
--
-- Migration 0002 defined the D8 idempotency key as
--   (archive_entry_id, jurisdiction_id, category_id, list_id, source_kind)
-- which omits `election_id`, even though that column is `not null` and every
-- ingestion path already writes it.
--
-- The omission is invisible while one archived file contains exactly one
-- election, which is true of every source ingested so far: each national DINE
-- ZIP is a single electoral event. It stops being true for a multi-year source,
-- and one is already identified for this project -- the PBA open-data catalogue
-- publishes `elecciones-generales-2005-2023.csv`, nineteen years of results in a
-- single file. Under the old key a 2005 row and a 2023 row for the same
-- jurisdiction, category and list collide as duplicates of one natural key.
--
-- Widening the key is only half the fix; see `etl/etl/db.py::load_result_rows`,
-- whose delete step is scoped by `election_id` in the same change. Without that,
-- re-ingesting one election would still delete every other election's rows that
-- share the archive entry.

alter table result_row
  drop constraint if exists result_row_archive_entry_id_jurisdiction_id_category_id_li_key;

do $$
declare
  existing_constraint text;
begin
  -- The generated constraint name is truncated by Postgres' 63-character limit
  -- and differs between environments, so discover it rather than assume it.
  select conname into existing_constraint
  from pg_constraint
  where conrelid = 'result_row'::regclass
    and contype = 'u'
    and array_length(conkey, 1) = 5;

  if existing_constraint is not null then
    execute format('alter table result_row drop constraint %I', existing_constraint);
  end if;
end $$;

alter table result_row
  add constraint result_row_natural_key unique (
    archive_entry_id, election_id, jurisdiction_id, category_id, list_id, source_kind
  );
