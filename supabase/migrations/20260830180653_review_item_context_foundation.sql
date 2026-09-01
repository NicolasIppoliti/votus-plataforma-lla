begin;
do $$ begin if to_regrole('workspace_review_context_foundation_migrator') is not null then raise exception 'workspace_review_context_foundation_migrator already exists'; end if; end $$;
create role workspace_review_context_foundation_migrator nologin noinherit;
grant workspace_review_ingest_owner to workspace_review_context_foundation_migrator with inherit false, set true;
grant workspace_review_context_foundation_migrator to current_user with inherit false, set true;
do $$
begin
  perform set_config('votus_review_context.owner_schema_create', has_schema_privilege('workspace_review_ingest_owner', 'workspace_private', 'CREATE')::text, true);
  if not has_schema_privilege('workspace_review_ingest_owner', 'workspace_private', 'CREATE') then
    grant create on schema workspace_private to workspace_review_ingest_owner;
  end if;
end $$;
lock table public.review_item in share row exclusive mode;
set role workspace_review_ingest_owner;
create table workspace_private.review_item_context (
  context_id uuid primary key default gen_random_uuid(),
  review_item_id uuid not null,
  context_state text not null,
  unknown_reason text not null,
  constraint review_item_context_review_item_key unique (review_item_id),
  constraint review_item_context_review_item_fkey foreign key (review_item_id)
    references public.review_item(id) on delete cascade,
  constraint review_item_context_state_check check (context_state = 'unknown'),
  constraint review_item_context_unknown_reason_check check (
    unknown_reason in ('historical_unclassified', 'writer_context_not_provided')
  )
);
alter table workspace_private.review_item_context enable row level security;
alter table workspace_private.review_item_context force row level security;
create policy workspace_review_ingest_owner_context_all
  on workspace_private.review_item_context for all to workspace_review_ingest_owner
  using (current_user = 'workspace_review_ingest_owner') with check (current_user = 'workspace_review_ingest_owner');
revoke all on workspace_private.review_item_context
  from public, anon, authenticated, etl_writer, workspace_query_owner,
    workspace_admin_owner, workspace_platform_admin;
do $$
declare
  review_count_before bigint;
  review_count_after bigint;
  backfill_count bigint;
  context_count bigint;
  kind_severity_before jsonb;
  kind_severity_after jsonb;
begin
  select coalesce(sum(item_count), 0), coalesce(
    jsonb_agg(jsonb_build_array(kind, severity, item_count) order by kind, severity),
    '[]'::jsonb
  ) into review_count_before, kind_severity_before
  from (
    select kind, severity, count(*) as item_count
    from public.review_item group by kind, severity
  ) grouped;
  insert into workspace_private.review_item_context (review_item_id, context_state, unknown_reason)
  select id, 'unknown', 'historical_unclassified' from public.review_item;
  get diagnostics backfill_count = row_count;
  select coalesce(sum(item_count), 0), coalesce(
    jsonb_agg(jsonb_build_array(kind, severity, item_count) order by kind, severity),
    '[]'::jsonb
  ) into review_count_after, kind_severity_after
  from (
    select kind, severity, count(*) as item_count
    from public.review_item group by kind, severity
  ) grouped;
  select count(*) into context_count from workspace_private.review_item_context;
  if review_count_after <> review_count_before
    or kind_severity_after <> kind_severity_before
    or backfill_count <> review_count_before
    or context_count <> review_count_before
  then
    raise exception 'review item context backfill did not preserve review count and kind/severity'
      using errcode = '23514';
  end if;
end $$;
create function workspace_private.create_unknown_review_item_context()
returns trigger language plpgsql security definer
set search_path = pg_catalog, workspace_private, pg_temp
as $$
begin
  insert into workspace_private.review_item_context (review_item_id, context_state, unknown_reason)
  values (new.id, 'unknown', 'writer_context_not_provided');
  return new;
end $$;
revoke all on function workspace_private.create_unknown_review_item_context()
  from public, anon, authenticated, etl_writer, workspace_query_owner,
    workspace_admin_owner, workspace_platform_admin;
create trigger review_item_context_after_insert after insert on public.review_item
for each row execute function workspace_private.create_unknown_review_item_context();
do $$
begin
  if to_regrole('service_role') is not null then
    revoke all on workspace_private.review_item_context from service_role;
    revoke all on function workspace_private.create_unknown_review_item_context() from service_role;
  end if;
end $$;
reset role;
do $$ begin
  if current_setting('votus_review_context.owner_schema_create', true) = 'false' then
    revoke create on schema workspace_private from workspace_review_ingest_owner;
  end if;
end $$;
revoke workspace_review_context_foundation_migrator from current_user;
revoke workspace_review_ingest_owner from workspace_review_context_foundation_migrator;
drop role workspace_review_context_foundation_migrator;
do $$ begin if to_regrole('workspace_review_context_foundation_migrator') is not null then raise exception 'workspace_review_context_foundation_migrator cleanup failed'; end if; end $$;
commit;
