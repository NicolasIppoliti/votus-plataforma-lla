-- 0004_source_kind.sql
-- D9.1: `source_kind` distinguishes official sources from internal
-- fiscalización data on the archive side. `result_row.source_kind` already
-- exists with the same check constraint (0002) -- nothing to add there.
--
-- No `archive_entry` table existed before this migration (0002's own
-- comment records that gap as out of Phase 3's scope). D9.1 requires
-- `source_kind` on `archive_entry` too, so this migration creates the table
-- now, mirroring `archive-manifest.json`'s row shape (D2) plus the
-- `source_kind` column.
--
-- `review_item.kind` extension (`source_reexported`, `duplicate_collapsed`,
-- `duplicate_conflict`, `unmergeable_row`, `blank_vote_cell`) is NOT part of
-- this migration: the `review_item` table itself does not exist until
-- Phase 11, the same forward-gap already recorded for Phase 5's
-- fetch-failure records. `etl.ingest.fiscalizacion.ReviewItemDraft` is the
-- traceable artifact Phase 11's loader will project into that table.

create table if not exists archive_entry (
  id text primary key,
  capability text not null,
  source text not null,
  source_url text not null,
  archived_path text,
  sha256 text,
  mime text not null,
  bytes integer,
  fetched_at timestamptz not null,
  status text not null check (status in ('ok', 'error')),
  -- D9.1: distinguishes official sources from internal fiscalización data.
  source_kind text not null default 'official'
    check (source_kind in ('official', 'fiscalizacion')),
  notes text,
  created_at timestamptz not null default now()
);

alter table archive_entry enable row level security;

create index if not exists archive_entry_source_kind_idx
  on archive_entry (source_kind);
