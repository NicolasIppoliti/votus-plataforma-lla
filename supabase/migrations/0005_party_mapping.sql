-- 0005_party_mapping.sql
-- party-identity-mapping spec; design D7 (unmapped rows surface via the
-- `review_item.kind = 'unmapped_party'` value, table itself deferred to
-- Phase 11, same forward-gap already recorded for 0004); D8's idempotency.
--
-- Mirrors `curated/party_map.yaml` -- the human-reviewed source of truth
-- (PR-reviewed per design.md's File Changes table); a future loader task
-- populates these tables from it, the same relationship 0003 has with
-- `curated/crosswalk.yaml`. The ETL's `etl.party_map` module already
-- operates directly against the YAML file and does not require these
-- tables to run.
--
-- Key is the FULL tuple (year, jurisdiction, category, list_id) -- never
-- list_id alone. The same list_id value under a different year,
-- jurisdiction or category is an UNRELATED row (party-identity-mapping
-- spec: LLA's national agrupacion_id changed 135 (2023) -> 110 (2025); PBA
-- municipal's 22xx family is unrelated to either national scheme).

create table if not exists party_canonical (
  id text primary key,
  display_name text not null,
  created_at timestamptz not null default now()
);

alter table party_canonical enable row level security;

-- One list/alliance identifier as it appears in ONE source scheme, curated
-- independently of any canonical-party decision so a list can be named and
-- documented before (or without) a party being assigned to it (e.g. a
-- purely local list -- "Local-only lists are representable" scenario).
create table if not exists list_identity (
  id uuid primary key default gen_random_uuid(),
  year integer not null,
  jurisdiction text not null,
  category text not null,
  list_id text not null,
  source_name text not null,
  created_at timestamptz not null default now(),
  unique (year, jurisdiction, category, list_id)
);

alter table list_identity enable row level security;

-- The curated (year, jurisdiction, category, list_id) -> canonical_party
-- mapping. `verified` distinguishes a sourced/confirmed entry from one a
-- curator has not yet reviewed -- never defaults an unreviewed row into
-- resolvable state.
create table if not exists party_mapping (
  id uuid primary key default gen_random_uuid(),
  year integer not null,
  jurisdiction text not null,
  category text not null,
  list_id text not null,
  canonical_party_id text not null references party_canonical (id),
  verified boolean not null default true,
  source text,
  created_at timestamptz not null default now(),
  unique (year, jurisdiction, category, list_id)
);

alter table party_mapping enable row level security;

-- FK column index (schema-foreign-key-indexes best practice) -- fast
-- lookups/joins from a canonical party back to all its mapped list ids.
create index if not exists party_mapping_canonical_party_id_idx
  on party_mapping (canonical_party_id);
