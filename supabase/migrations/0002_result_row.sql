-- 0002_result_row.sql
-- electoral-ingestion spec: the normalized, rebuildable result projection.
-- One row per (mesa-or-coarser jurisdiction, list, category) combination,
-- always traceable back to the archive entry and source row it came from
-- (D8 idempotency key).
--
-- `archive_entry_id` is a free-text reference to the archived source's
-- stable manifest id (e.g. "national/2023-generales" from
-- `archive-manifest.json`, see D2) rather than a foreign key: no
-- `archive_entry` table exists yet in this migration set (out of Phase 3's
-- assigned scope per tasks.md 3.6/3.7), and D2 already treats the manifest
-- as the archive's source of truth. A formal `archive_entry` table/FK can
-- be added by a later phase without breaking this column's meaning.
--
-- `list_id` is likewise free text (the raw source `agrupacion_id`), not a
-- foreign key to a party table — `party_mapping` does not exist until
-- Phase 7; `is_unmapped` marks rows with no curated mapping yet.

create table if not exists result_row (
  id uuid primary key default gen_random_uuid(),
  election_id uuid not null references election (id),
  jurisdiction_id uuid not null references jurisdiction (id),
  category_id uuid not null references category (id),
  -- jurisdiction-model: the level this specific row is attributable to.
  -- MUST match how far `jurisdiction_id`'s lineage actually reaches.
  granularity text not null
    check (granularity in ('distrito', 'seccion', 'circuito', 'establecimiento', 'mesa')),
  list_id text,
  votes integer not null,
  -- D9.1: distinguishes official sources from internal fiscalización data.
  source_kind text not null default 'official'
    check (source_kind in ('official', 'fiscalizacion')),
  -- Unmapped list ids are stored, not dropped or guessed at (spec
  -- "Unmapped party/list identifier handling").
  is_unmapped boolean not null default false,
  archive_entry_id text not null,
  source_row_index integer not null,
  created_at timestamptz not null default now(),
  -- D8 idempotency key: (archive_entry, natural key). The natural key here
  -- is (jurisdiction, category, list, source_kind) within one archive
  -- entry — re-running ingestion for the same entry must not duplicate.
  unique (archive_entry_id, jurisdiction_id, category_id, list_id, source_kind)
);

alter table result_row enable row level security;

create index if not exists result_row_source_kind_election_jurisdiction_idx
  on result_row (source_kind, election_id, jurisdiction_id);
