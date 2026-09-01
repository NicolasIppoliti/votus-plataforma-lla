begin; do $$ begin if to_regrole('workspace_review_context_migrator') is not null then raise exception 'workspace_review_context_migrator already exists'; end if; end $$; create role workspace_review_context_migrator nologin noinherit; grant workspace_review_ingest_owner to workspace_review_context_migrator with inherit false, set true; grant workspace_review_context_migrator to current_user with inherit false, set true;
do $$ declare relation_name text; begin
  perform set_config('votus_review_context_classification.schema_create',has_schema_privilege('workspace_review_ingest_owner','workspace_private','CREATE')::text,true);
  foreach relation_name in array array['election','category','archive_entry'] loop perform set_config('votus_review_context_classification.references_'||relation_name,has_table_privilege('workspace_review_ingest_owner',format('public.%I',relation_name),'REFERENCES')::text,true); end loop;
  if current_setting('votus_review_context_classification.schema_create')='false' then grant create on schema workspace_private to workspace_review_ingest_owner; end if;
  foreach relation_name in array array['election','category','archive_entry'] loop if current_setting('votus_review_context_classification.references_'||relation_name,true)='false' then execute format('grant references on table public.%I to workspace_review_ingest_owner',relation_name); end if; end loop;
end $$;
lock table public.review_item in share row exclusive mode; set role workspace_review_ingest_owner; lock table workspace_private.review_item_context in share row exclusive mode;
create temporary table review_context_snapshot on commit drop as select coalesce(sum(n),0) review_count,
  coalesce(jsonb_agg(jsonb_build_array(kind,severity,n) order by kind,severity),'[]'::jsonb) kind_severity from (select kind,severity,count(*) n from public.review_item group by kind,severity) grouped;
alter table workspace_private.review_item_context drop constraint review_item_context_review_item_key,
  drop constraint review_item_context_state_check,drop constraint review_item_context_unknown_reason_check,
  alter column unknown_reason drop not null;
alter table workspace_private.review_item_context rename column context_state to context_role;
alter table workspace_private.review_item_context add column source_kind text,add column archive_availability text,
  add column election_year integer,add column election_id uuid,add column category_id uuid,
  add column archive_entry_id text;
update workspace_private.review_item_context c set
  context_role=case when r.kind in ('blank_vote_cell','duplicate_collapsed',
    'mesa_absent_from_official_import','mesa_discontinuity','mesa_tally_divergence')
    then 'observed' else 'unknown' end,
  source_kind=case when r.kind in ('blank_vote_cell','duplicate_collapsed',
    'mesa_absent_from_official_import','mesa_tally_divergence') then 'fiscalizacion'
    when r.kind='mesa_discontinuity' then 'official' else 'unknown' end,
  archive_availability='unknown',
  unknown_reason=case when r.kind in ('blank_vote_cell','duplicate_collapsed',
    'mesa_absent_from_official_import','mesa_discontinuity','mesa_tally_divergence')
    then 'historical_archive_not_linked' else 'historical_unclassified' end
from public.review_item r where r.id=c.review_item_id;
insert into workspace_private.review_item_context(review_item_id,context_role,source_kind,archive_availability,unknown_reason)
select id,'comparison','official','unknown','historical_archive_not_linked' from public.review_item where kind='mesa_tally_divergence';
alter table workspace_private.review_item_context
  alter column source_kind set not null,
  alter column archive_availability set not null,
  add constraint review_item_context_role_check
    check (context_role in ('observed','comparison','unknown')),
  add constraint review_item_context_source_kind_check
    check (source_kind in ('official','fiscalizacion','unknown')),
  add constraint review_item_context_archive_availability_check
    check (archive_availability in ('available','unavailable','unknown')),
  add constraint review_item_context_unknown_reason_check check (
    (unknown_reason is null and context_role<>'unknown' and source_kind<>'unknown'
      and archive_availability<>'unknown') or
    (unknown_reason is not null and unknown_reason in ('historical_archive_not_linked','historical_unclassified',
      'writer_context_not_provided') and (context_role='unknown' or source_kind='unknown'
      or archive_availability='unknown'))
  ),
  add constraint review_item_context_archive_link_check check (
    (archive_availability='available')=(archive_entry_id is not null)
  ),
  add constraint review_item_context_election_fkey foreign key (election_id)
    references public.election(id),
  add constraint review_item_context_category_fkey foreign key (category_id)
    references public.category(id),
  add constraint review_item_context_archive_entry_fkey foreign key (archive_entry_id)
    references public.archive_entry(id),
  add constraint review_item_context_exact_key unique nulls not distinct
    (review_item_id,context_role,source_kind,archive_availability,election_year,
     election_id,category_id,archive_entry_id,unknown_reason);
create or replace function workspace_private.create_unknown_review_item_context()
returns trigger language plpgsql security definer set search_path=pg_catalog,workspace_private,pg_temp as $$ begin
  insert into workspace_private.review_item_context(review_item_id,context_role,source_kind,archive_availability,unknown_reason)
  values(new.id,'unknown','unknown','unknown','writer_context_not_provided'); return new;
end $$;
do $$ declare current_count bigint; current_shape jsonb; expected_count bigint;
begin
  select coalesce(sum(n),0),coalesce(jsonb_agg(jsonb_build_array(kind,severity,n) order by kind,severity),'[]'::jsonb)
    into current_count,current_shape from (select kind,severity,count(*) n from public.review_item group by kind,severity) grouped;
  select count(*)+count(*) filter(where kind='mesa_tally_divergence') into expected_count from public.review_item;
  if (select (review_count,kind_severity)<>(current_count,current_shape)
      from review_context_snapshot)
    or (select count(*) from workspace_private.review_item_context)<>expected_count
    or exists(select 1 from public.review_item r left join workspace_private.review_item_context c
      on c.review_item_id=r.id where c.context_id is null)
    or exists(select 1 from workspace_private.review_item_context where election_year is not null
      or election_id is not null or category_id is not null or archive_entry_id is not null)
    or exists(
      with expected as (
        select id review_item_id,
          case when kind in ('blank_vote_cell','duplicate_collapsed','mesa_absent_from_official_import',
            'mesa_discontinuity','mesa_tally_divergence') then 'observed' else 'unknown' end context_role,
          case when kind in ('blank_vote_cell','duplicate_collapsed','mesa_absent_from_official_import',
            'mesa_tally_divergence') then 'fiscalizacion' when kind='mesa_discontinuity'
            then 'official' else 'unknown' end source_kind,
          case when kind in ('blank_vote_cell','duplicate_collapsed','mesa_absent_from_official_import',
            'mesa_discontinuity','mesa_tally_divergence') then 'historical_archive_not_linked'
            else 'historical_unclassified' end unknown_reason from public.review_item
        union all select id,'comparison','official','historical_archive_not_linked'
          from public.review_item where kind='mesa_tally_divergence'
      ), actual as (select review_item_id,context_role,source_kind,unknown_reason from workspace_private.review_item_context)
      (select * from expected except all select * from actual)
      union all (select * from actual except all select * from expected)
    ) then raise exception 'historical review context classification violated preservation or mapping'
      using errcode='23514';
  end if;
end $$;
reset role;
do $$ declare relation_name text; begin
  foreach relation_name in array array['election','category','archive_entry'] loop if current_setting('votus_review_context_classification.references_'||relation_name,true)='false' then execute format('revoke references on table public.%I from workspace_review_ingest_owner',relation_name); end if; end loop;
  if current_setting('votus_review_context_classification.schema_create',true)='false' then revoke create on schema workspace_private from workspace_review_ingest_owner; end if;
end $$;
revoke workspace_review_context_migrator from current_user; revoke workspace_review_ingest_owner from workspace_review_context_migrator; drop role workspace_review_context_migrator; do $$ begin if to_regrole('workspace_review_context_migrator') is not null then raise exception 'workspace_review_context_migrator cleanup failed'; end if; end $$; commit;
