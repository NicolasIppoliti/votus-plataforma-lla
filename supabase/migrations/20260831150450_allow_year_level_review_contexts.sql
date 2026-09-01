begin;
do $$ begin if to_regrole('workspace_review_context_migrator') is not null then raise exception 'workspace_review_context_migrator already exists'; end if; end $$;
create role workspace_review_context_migrator nologin noinherit;
grant workspace_review_ingest_owner to workspace_review_context_migrator with inherit false, set true;
grant workspace_review_context_migrator to current_user with inherit false, set true;
create temporary table year_level_review_context_privileges(schema_create boolean not null) on commit drop;
insert into year_level_review_context_privileges values(has_schema_privilege('workspace_review_ingest_owner','workspace_private','CREATE'));
do $$ begin if not (select schema_create from year_level_review_context_privileges) then grant create on schema workspace_private to workspace_review_ingest_owner; end if; end $$;
lock table public.review_item in share row exclusive mode;
set role workspace_review_ingest_owner;
lock table workspace_private.review_item_context in share row exclusive mode;
alter table workspace_private.review_item_context drop constraint review_item_context_unknown_reason_check;
alter table workspace_private.review_item_context add constraint review_item_context_unknown_reason_check check (
 (unknown_reason is null and context_role<>'unknown' and source_kind<>'unknown' and archive_availability<>'unknown') or
 (unknown_reason is not null and unknown_reason in ('historical_archive_not_linked','historical_unclassified','writer_context_not_provided') and (context_role='unknown' or source_kind='unknown' or archive_availability='unknown')) or
 (unknown_reason='source_archive_not_attributable' and (context_role,source_kind,archive_availability)=('observed','official','unknown') and election_year is not null and election_id is null and category_id is null and archive_entry_id is null)
);
create or replace function workspace_private.record_review_item_v2(p_kind text,p_severity text,p_subject_ref text,p_note text,p_distrito_codes text[],p_seccion_codes text[],p_contexts jsonb)
returns boolean language plpgsql security definer set search_path=pg_catalog,workspace_private,public,pg_temp as $$
declare result record; requested_count integer; context_count integer; fallback_count integer;
begin
 if jsonb_typeof(p_contexts) is distinct from 'array' or not (jsonb_array_length(p_contexts) between 1 and 4) then raise exception 'record_review_item_v2 contexts must be an array of one through four elements' using errcode='23514'; end if;
 if exists(select 1 from jsonb_array_elements(p_contexts) ctx where jsonb_typeof(ctx)<>'object' or not (
  ((select array_agg(key order by key) from jsonb_object_keys(ctx) key)=array['archive_availability','archive_entry_id','category_id','context_role','election_id','election_year','source_kind'] and jsonb_typeof(ctx->'context_role')='string' and jsonb_typeof(ctx->'source_kind')='string' and jsonb_typeof(ctx->'archive_availability')='string' and jsonb_typeof(ctx->'election_id')='string' and jsonb_typeof(ctx->'category_id')='string' and jsonb_typeof(ctx->'archive_entry_id')='string' and jsonb_typeof(ctx->'election_year')='number') or
  ((select array_agg(key order by key) from jsonb_object_keys(ctx) key)=array['archive_availability','archive_entry_id','category_id','context_role','election_id','election_year','source_kind','unknown_reason'] and jsonb_typeof(ctx->'context_role')='string' and jsonb_typeof(ctx->'source_kind')='string' and jsonb_typeof(ctx->'archive_availability')='string' and jsonb_typeof(ctx->'election_year') is not distinct from 'number' and jsonb_typeof(ctx->'election_id') is not distinct from 'null' and jsonb_typeof(ctx->'category_id') is not distinct from 'null' and jsonb_typeof(ctx->'archive_entry_id') is not distinct from 'null' and jsonb_typeof(ctx->'unknown_reason')='string')
 )) then raise exception 'record_review_item_v2 context objects require exact keys and JSON value types' using errcode='23514'; end if;
 select count(*) into requested_count from jsonb_to_recordset(p_contexts) x(context_role text,source_kind text,archive_availability text,election_year integer,election_id uuid,category_id uuid,archive_entry_id text,unknown_reason text) where
  ((context_role,source_kind) in (('observed','fiscalizacion'),('comparison','official')) and archive_availability='available' and election_year is not null and election_id is not null and category_id is not null and archive_entry_id is not null and unknown_reason is null) or
  ((context_role,source_kind,archive_availability)=('observed','official','unknown') and election_year is not null and election_id is null and category_id is null and archive_entry_id is null and unknown_reason='source_archive_not_attributable');
 if requested_count<>jsonb_array_length(p_contexts) then raise exception 'record_review_item_v2 contexts require explicit available identities or exact year-level official observations' using errcode='23514'; end if;
 if exists(select 1 from jsonb_array_elements(p_contexts) with ordinality a(value,n),jsonb_array_elements(p_contexts) with ordinality b(value,n) where a.n<b.n and row(a.value->>'context_role',a.value->>'source_kind',a.value->>'archive_availability',(a.value->>'election_year')::integer,(a.value->>'election_id')::uuid,(a.value->>'category_id')::uuid,a.value->>'archive_entry_id',a.value->>'unknown_reason') is not distinct from row(b.value->>'context_role',b.value->>'source_kind',b.value->>'archive_availability',(b.value->>'election_year')::integer,(b.value->>'election_id')::uuid,(b.value->>'category_id')::uuid,b.value->>'archive_entry_id',b.value->>'unknown_reason')) then raise exception 'record_review_item_v2 contexts must be unique' using errcode='23514'; end if;
 if exists(select 1 from jsonb_to_recordset(p_contexts) x(context_role text,source_kind text,archive_availability text,election_year integer,election_id uuid,category_id uuid,archive_entry_id text,unknown_reason text) where x.archive_availability='available' and (not exists(select 1 from public.archive_entry a where a.id=x.archive_entry_id and a.status='ok' and a.source_kind=x.source_kind) or not exists(select 1 from public.election e where e.id=x.election_id and e.year=x.election_year) or not exists(select 1 from public.category c where c.id=x.category_id))) then raise exception 'record_review_item_v2 context authority is missing or conflicting' using errcode='23514'; end if;
 select * into strict result from workspace_private.record_review_item_core(p_kind,p_severity,p_subject_ref,p_note,p_distrito_codes,p_seccion_codes);
 select count(*),count(*) filter(where (context_role,source_kind,archive_availability,unknown_reason)=('unknown','unknown','unknown','writer_context_not_provided') and election_year is null and election_id is null and category_id is null and archive_entry_id is null) into context_count,fallback_count from workspace_private.review_item_context where review_item_id=result.review_item_id;
 if context_count=requested_count and not exists(select 1 from workspace_private.review_item_context e where e.review_item_id=result.review_item_id and not exists(select 1 from jsonb_to_recordset(p_contexts) x(context_role text,source_kind text,archive_availability text,election_year integer,election_id uuid,category_id uuid,archive_entry_id text,unknown_reason text) where row(e.context_role,e.source_kind,e.archive_availability,e.election_year,e.election_id,e.category_id,e.archive_entry_id,e.unknown_reason) is not distinct from row(x.context_role,x.source_kind,x.archive_availability,x.election_year,x.election_id,x.category_id,x.archive_entry_id,x.unknown_reason))) then return result.inserted; end if;
 if context_count=1 and fallback_count=1 then
  delete from workspace_private.review_item_context where review_item_id=result.review_item_id;
  insert into workspace_private.review_item_context(review_item_id,context_role,source_kind,archive_availability,election_year,election_id,category_id,archive_entry_id,unknown_reason) select result.review_item_id,x.context_role,x.source_kind,x.archive_availability,x.election_year,x.election_id,x.category_id,x.archive_entry_id,x.unknown_reason from jsonb_to_recordset(p_contexts) x(context_role text,source_kind text,archive_availability text,election_year integer,election_id uuid,category_id uuid,archive_entry_id text,unknown_reason text);
  return result.inserted;
 end if;
 raise exception 'record_review_item_v2 active review context set conflicts with explicit contexts' using errcode='23514';
end $$;
revoke all on function workspace_private.record_review_item_v2(text,text,text,text,text[],text[],jsonb) from public,anon,authenticated,etl_writer,workspace_query_owner,workspace_admin_owner,workspace_platform_admin;
grant execute on function workspace_private.record_review_item_v2(text,text,text,text,text[],text[],jsonb) to etl_writer;
do $$ begin if to_regrole('service_role') is not null then revoke all on function workspace_private.record_review_item_v2(text,text,text,text,text[],text[],jsonb) from service_role; end if; end $$;
set role postgres;
do $$ begin if not (select schema_create from year_level_review_context_privileges) then revoke create on schema workspace_private from workspace_review_ingest_owner; end if; end $$;
revoke workspace_review_context_migrator from current_user;
revoke workspace_review_ingest_owner from workspace_review_context_migrator;
drop role workspace_review_context_migrator;
do $$ begin if to_regrole('workspace_review_context_migrator') is not null then raise exception 'workspace_review_context_migrator cleanup failed'; end if; end $$;
commit;
