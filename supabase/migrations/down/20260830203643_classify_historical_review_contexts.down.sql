begin; do $$ begin if to_regrole('workspace_review_context_migrator') is not null then raise exception 'workspace_review_context_migrator already exists'; end if; end $$; create role workspace_review_context_migrator nologin noinherit; grant workspace_review_ingest_owner to workspace_review_context_migrator with inherit false, set true; grant workspace_review_context_migrator to current_user with inherit false, set true;
do $$ begin perform set_config('votus_review_context_classification_down.schema_create',has_schema_privilege('workspace_review_ingest_owner','workspace_private','CREATE')::text,true); if current_setting('votus_review_context_classification_down.schema_create')='false' then grant create on schema workspace_private to workspace_review_ingest_owner; end if; end $$;
lock table public.review_item in share row exclusive mode; set role workspace_review_ingest_owner; lock table workspace_private.review_item_context in share row exclusive mode;
create temporary table review_context_down_snapshot on commit drop as select coalesce(sum(n),0) review_count,
  coalesce(jsonb_agg(jsonb_build_array(kind,severity,n) order by kind,severity),'[]'::jsonb) kind_severity from (select kind,severity,count(*) n from public.review_item group by kind,severity) grouped;
do $$ declare non_reconstructible_items bigint; authoritative_identity_items bigint; year_level_items bigint; multi_context_items bigint; begin
  with categorized as (
    select r.id,count(*) actual_count,
      count(*) filter(where (c.context_role,c.source_kind,c.archive_availability,c.unknown_reason)=('unknown','unknown','unknown','writer_context_not_provided') and c.election_year is null and c.election_id is null and c.category_id is null and c.archive_entry_id is null) fallback_count,
      count(*) filter(where c.archive_availability='unknown' and c.election_year is null and c.election_id is null and c.category_id is null and c.archive_entry_id is null and c.unknown_reason=case when r.kind in ('blank_vote_cell','duplicate_collapsed','mesa_absent_from_official_import','mesa_discontinuity','mesa_tally_divergence') then 'historical_archive_not_linked' else 'historical_unclassified' end and ((r.kind in ('blank_vote_cell','duplicate_collapsed','mesa_absent_from_official_import','mesa_tally_divergence') and (c.context_role,c.source_kind)=('observed','fiscalizacion')) or (r.kind='mesa_discontinuity' and (c.context_role,c.source_kind)=('observed','official')) or (r.kind='mesa_tally_divergence' and (c.context_role,c.source_kind)=('comparison','official')) or (r.kind not in ('blank_vote_cell','duplicate_collapsed','mesa_absent_from_official_import','mesa_discontinuity','mesa_tally_divergence') and (c.context_role,c.source_kind)=('unknown','unknown')))) deterministic_count,
      bool_or(c.election_id is not null or c.category_id is not null or c.archive_entry_id is not null) authoritative,
      bool_or(c.election_year is not null) year_level,
      case when r.kind='mesa_tally_divergence' then 2 else 1 end expected_count
    from public.review_item r join workspace_private.review_item_context c on c.review_item_id=r.id group by r.id,r.kind
  ), unsafe as (select *,not ((actual_count=1 and fallback_count=1) or (actual_count=expected_count and deterministic_count=expected_count)) non_reconstructible from categorized)
  select count(*) filter(where non_reconstructible),count(*) filter(where authoritative),count(*) filter(where year_level),count(*) filter(where non_reconstructible and actual_count>1)
    into non_reconstructible_items,authoritative_identity_items,year_level_items,multi_context_items from unsafe;
  if non_reconstructible_items>0 then raise exception 'review context rollback refused: non_reconstructible_items=%, authoritative_identity_items=%, year_level_items=%, multi_context_items=%',non_reconstructible_items,authoritative_identity_items,year_level_items,multi_context_items using errcode='23514'; end if;
end $$;
create temporary table review_context_down_fallback on commit drop as select review_item_id from workspace_private.review_item_context where (context_role,source_kind,archive_availability,unknown_reason)=('unknown','unknown','unknown','writer_context_not_provided') and election_year is null and election_id is null and category_id is null and archive_entry_id is null;
delete from workspace_private.review_item_context;
insert into workspace_private.review_item_context
  (review_item_id,context_role,source_kind,archive_availability,unknown_reason)
select r.id,'unknown','unknown','unknown',case when f.review_item_id is null then 'historical_unclassified' else 'writer_context_not_provided' end from public.review_item r left join review_context_down_fallback f on f.review_item_id=r.id;
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
      where context_state<>'unknown' or unknown_reason not in ('historical_unclassified','writer_context_not_provided'))
  then raise exception 'review context degradation did not preserve reviews or foundation coverage'
    using errcode='23514';
  end if;
end $$;
set role postgres;
do $$ begin if current_setting('votus_review_context_classification_down.schema_create',true)='false' then revoke create on schema workspace_private from workspace_review_ingest_owner; end if; end $$;
revoke workspace_review_context_migrator from current_user; revoke workspace_review_ingest_owner from workspace_review_context_migrator; drop role workspace_review_context_migrator; do $$ begin if to_regrole('workspace_review_context_migrator') is not null then raise exception 'workspace_review_context_migrator cleanup failed'; end if; end $$; commit;
