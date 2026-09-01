begin;
do $$ begin if to_regrole('workspace_review_context_migrator') is not null then raise exception 'workspace_review_context_migrator already exists'; end if; end $$;
create role workspace_review_context_migrator nologin noinherit;
grant workspace_review_ingest_owner to workspace_review_context_migrator with inherit false, set true;
grant workspace_review_context_migrator to current_user with inherit false, set true;
create temporary table record_review_item_contexts_down_privileges(schema_create boolean not null) on commit drop;
insert into record_review_item_contexts_down_privileges values(has_schema_privilege('workspace_review_ingest_owner','workspace_private','CREATE'));
do $$ begin if not (select schema_create from record_review_item_contexts_down_privileges) then grant create on schema workspace_private to workspace_review_ingest_owner; end if; end $$;
lock table public.review_item in share row exclusive mode;
set role workspace_review_ingest_owner;
lock table workspace_private.review_item_context in share row exclusive mode;
drop function workspace_private.record_review_item_v2(text,text,text,text,text[],text[],jsonb);
create function workspace_private.record_review_item_v2(p_kind text,p_severity text,p_subject_ref text,p_note text,p_distrito_codes text[],p_seccion_codes text[],p_context_role text,p_source_kind text,p_archive_availability text,p_election_year integer,p_election_id uuid,p_category_id uuid,p_archive_entry_id text)
returns boolean language plpgsql security definer set search_path=pg_catalog,workspace_private,public,pg_temp as $$
declare result record; context_count integer; exact_count integer; fallback_count integer;
begin
 if (p_context_role,p_source_kind,p_archive_availability) is distinct from ('observed','fiscalizacion','available') or p_election_year is null or p_election_id is null or p_category_id is null or p_archive_entry_id is null then raise exception 'record_review_item_v2 requires observed fiscalizacion available context' using errcode='23514'; end if;
 if not exists(select 1 from public.archive_entry where id=p_archive_entry_id and status='ok' and source_kind='fiscalizacion') then raise exception 'record_review_item_v2 archive is missing or is not an available fiscalizacion archive' using errcode='23514'; end if;
 if not exists(select 1 from public.election where id=p_election_id and year=p_election_year) then raise exception 'record_review_item_v2 election is missing or its year conflicts' using errcode='23514'; end if;
 if not exists(select 1 from public.category where id=p_category_id) then raise exception 'record_review_item_v2 category is missing' using errcode='23514'; end if;
 select * into strict result from workspace_private.record_review_item_core(p_kind,p_severity,p_subject_ref,p_note,p_distrito_codes,p_seccion_codes);
 select count(*),count(*) filter(where (context_role,source_kind,archive_availability,election_year,election_id,category_id,archive_entry_id,unknown_reason) is not distinct from (p_context_role,p_source_kind,p_archive_availability,p_election_year,p_election_id,p_category_id,p_archive_entry_id,null)),count(*) filter(where (context_role,source_kind,archive_availability,unknown_reason)=('unknown','unknown','unknown','writer_context_not_provided') and election_year is null and election_id is null and category_id is null and archive_entry_id is null) into context_count,exact_count,fallback_count from workspace_private.review_item_context where review_item_id=result.review_item_id;
 if context_count=1 and exact_count=1 then return result.inserted; end if;
 if context_count=1 and fallback_count=1 then update workspace_private.review_item_context set context_role=p_context_role,source_kind=p_source_kind,archive_availability=p_archive_availability,election_year=p_election_year,election_id=p_election_id,category_id=p_category_id,archive_entry_id=p_archive_entry_id,unknown_reason=null where review_item_id=result.review_item_id; return result.inserted; end if;
 raise exception 'record_review_item_v2 active review context conflicts with explicit context' using errcode='23514';
end $$;
revoke all on function workspace_private.record_review_item_v2(text,text,text,text,text[],text[],text,text,text,integer,uuid,uuid,text) from public,anon,authenticated,etl_writer,workspace_query_owner,workspace_admin_owner,workspace_platform_admin;
grant execute on function workspace_private.record_review_item_v2(text,text,text,text,text[],text[],text,text,text,integer,uuid,uuid,text) to etl_writer;
do $$ begin if to_regrole('service_role') is not null then revoke all on function workspace_private.record_review_item_v2(text,text,text,text,text[],text[],text,text,text,integer,uuid,uuid,text) from service_role; end if; end $$;
reset role;
do $$ begin if not (select schema_create from record_review_item_contexts_down_privileges) then revoke create on schema workspace_private from workspace_review_ingest_owner; end if; end $$;
revoke workspace_review_context_migrator from current_user;
revoke workspace_review_ingest_owner from workspace_review_context_migrator;
drop role workspace_review_context_migrator;
do $$ begin if to_regrole('workspace_review_context_migrator') is not null then raise exception 'workspace_review_context_migrator cleanup failed'; end if; end $$;
commit;
