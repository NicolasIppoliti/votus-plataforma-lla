begin; do $$ begin if to_regrole('workspace_review_context_migrator') is not null then raise exception 'workspace_review_context_migrator already exists'; end if; end $$; create role workspace_review_context_migrator nologin noinherit; grant workspace_review_ingest_owner to workspace_review_context_migrator with inherit false, set true; grant workspace_review_context_migrator to current_user with inherit false, set true;
do $$ begin perform set_config('votus_review_context_classification_down.schema_create',has_schema_privilege('workspace_review_ingest_owner','workspace_private','CREATE')::text,true); if current_setting('votus_review_context_classification_down.schema_create')='false' then grant create on schema workspace_private to workspace_review_ingest_owner; end if; end $$;
lock table public.review_item in share row exclusive mode; set role workspace_review_ingest_owner; lock table workspace_private.review_item_context in share row exclusive mode;
create temporary table review_context_down_snapshot on commit drop as select coalesce(sum(n),0) review_count,
  coalesce(jsonb_agg(jsonb_build_array(kind,severity,n) order by kind,severity),'[]'::jsonb) kind_severity from (select kind,severity,count(*) n from public.review_item group by kind,severity) grouped;
do $$ declare summary jsonb; begin
  select jsonb_build_object('structured_contexts',coalesce(sum(rows),0),
    'review_items',(select count(*) from public.review_item),'groups',coalesce(jsonb_agg(
      jsonb_build_object('kind',kind,'context_role',context_role,'source_kind',source_kind,
        'archive_availability',archive_availability,'unknown_reason',unknown_reason,'rows',rows)
      order by kind,context_role,source_kind,archive_availability,unknown_reason),'[]'::jsonb))
    into summary from (select r.kind,c.context_role,c.source_kind,c.archive_availability,
      c.unknown_reason,count(*) rows from public.review_item r
      join workspace_private.review_item_context c on c.review_item_id=r.id
      group by r.kind,c.context_role,c.source_kind,c.archive_availability,c.unknown_reason) grouped;
  raise notice 'review context degradation summary: %',summary;
end $$;
delete from workspace_private.review_item_context;
insert into workspace_private.review_item_context
  (review_item_id,context_role,source_kind,archive_availability,unknown_reason)
select id,'unknown','unknown','unknown','historical_unclassified' from public.review_item;
alter table workspace_private.review_item_context alter column unknown_reason set not null;
alter table workspace_private.review_item_context
  drop constraint review_item_context_role_check,
  drop constraint review_item_context_source_kind_check,
  drop constraint review_item_context_archive_availability_check,
  drop constraint review_item_context_unknown_reason_check,
  drop constraint review_item_context_archive_link_check,
  drop constraint review_item_context_election_fkey,
  drop constraint review_item_context_category_fkey,
  drop constraint review_item_context_archive_entry_fkey,
  drop constraint review_item_context_exact_key,
  drop column source_kind,
  drop column archive_availability,
  drop column election_year,
  drop column election_id,
  drop column category_id,
  drop column archive_entry_id;
alter table workspace_private.review_item_context rename column context_role to context_state;
alter table workspace_private.review_item_context
  add constraint review_item_context_review_item_key unique (review_item_id),
  add constraint review_item_context_state_check check (context_state='unknown'),
  add constraint review_item_context_unknown_reason_check check (
    unknown_reason in ('historical_unclassified','writer_context_not_provided'));
create or replace function workspace_private.create_unknown_review_item_context()
returns trigger language plpgsql security definer set search_path=pg_catalog,workspace_private,pg_temp as $$ begin
  insert into workspace_private.review_item_context(review_item_id,context_state,unknown_reason)
  values(new.id,'unknown','writer_context_not_provided'); return new;
end $$;
do $$ declare current_count bigint; current_shape jsonb;
begin
  select coalesce(sum(n),0),coalesce(jsonb_agg(jsonb_build_array(kind,severity,n) order by kind,severity),'[]'::jsonb)
    into current_count,current_shape from (select kind,severity,count(*) n from public.review_item group by kind,severity) grouped;
  if (select (review_count,kind_severity)<>(current_count,current_shape)
      from review_context_down_snapshot)
    or (select count(*) from workspace_private.review_item_context)<>current_count
    or exists(select 1 from public.review_item r left join workspace_private.review_item_context c
      on c.review_item_id=r.id where c.context_id is null)
    or exists(select 1 from workspace_private.review_item_context
      where context_state<>'unknown' or unknown_reason<>'historical_unclassified')
  then raise exception 'review context degradation did not preserve reviews or foundation coverage'
    using errcode='23514';
  end if;
end $$;
reset role;
do $$ begin if current_setting('votus_review_context_classification_down.schema_create',true)='false' then revoke create on schema workspace_private from workspace_review_ingest_owner; end if; end $$;
revoke workspace_review_context_migrator from current_user; revoke workspace_review_ingest_owner from workspace_review_context_migrator; drop role workspace_review_context_migrator; do $$ begin if to_regrole('workspace_review_context_migrator') is not null then raise exception 'workspace_review_context_migrator cleanup failed'; end if; end $$; commit;
