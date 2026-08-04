-- 0007_review_item.sql
-- D7: "one review queue is the surfacing mechanism". Every ingestion run
-- writes to this table; the authenticated layout renders an
-- unresolved-count banner linking to `/review` (task 11.19/11.18).
--
-- This is the FIRST table that persists the `MesaDivergence` records
-- `etl/etl/crosswalk.py::join_fiscalizacion_identity` has been producing
-- in memory since Phase 4 (design.md D9.5: "Per-mesa tally divergence
-- against the official record is informational, never a join failure").
-- `etl/etl/review_item.py` (this phase) projects those in-memory records
-- into insert-ready rows; `etl/etl/db.py::insert_review_items` is the
-- write path.
--
-- `kind` carries the full extended set from D7 and 0004's forward-gap
-- comment, plus `mesa_tally_divergence` for D9.5 (a new kind — the
-- Impugnado/En blanco category-definition difference specifically MUST
-- NOT be recorded as this kind at all; it is excluded before insertion,
-- never inserted and then hidden by severity).
create table if not exists review_item (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in (
    'content_drift',
    'fetch_failure',
    'unmapped_party',
    'unmapped_jurisdiction',
    'mesa_discontinuity',
    'source_reexported',
    'duplicate_collapsed',
    'duplicate_conflict',
    'unmergeable_row',
    'blank_vote_cell',
    'mesa_tally_divergence'
  )),
  severity text not null check (severity in ('info', 'warning', 'error')),
  subject_ref text not null,
  detected_at timestamptz not null default now(),
  resolved_at timestamptz,
  note text,
  created_at timestamptz not null default now()
);

alter table review_item enable row level security;

create index if not exists review_item_unresolved_idx
  on review_item (detected_at)
  where resolved_at is null;

-- access-control: same single-authenticated-role read grant as every other
-- electoral table (0006_rls.sql). Writes go through the ETL's
-- service_role/postgres connection, which bypasses RLS.
revoke all on table review_item from anon;
grant select on table review_item to authenticated;
create policy review_item_authenticated_read
  on review_item for select to authenticated using (true);

-- Task 11.19's "unresolved-count banner query": the authenticated layout
-- (task 11.18) reads this one row rather than issuing its own
-- `count(*) where resolved_at is null`, so the definition of "unresolved"
-- lives in one place. Inherits the base table's RLS via the invoker's role
-- (no `security definer`), so it is readable by exactly the same
-- authenticated-only audience as `review_item` itself.
create or replace view review_item_unresolved_count as
  select count(*)::integer as unresolved_count
  from review_item
  where resolved_at is null;

revoke all on review_item_unresolved_count from anon;
grant select on review_item_unresolved_count to authenticated;
