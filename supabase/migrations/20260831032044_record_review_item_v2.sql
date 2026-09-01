begin;
do $$ begin if to_regrole('workspace_review_context_migrator') is not null then raise exception 'workspace_review_context_migrator already exists'; end if; end $$;
create role workspace_review_context_migrator nologin noinherit;
grant workspace_review_ingest_owner to workspace_review_context_migrator with inherit false, set true;
grant workspace_review_context_migrator to current_user with inherit false, set true;
create temporary table record_review_item_v2_privileges(schema_create boolean not null) on commit drop;
insert into record_review_item_v2_privileges values(has_schema_privilege('workspace_review_ingest_owner','workspace_private','CREATE'));
do $$ begin if not (select schema_create from record_review_item_v2_privileges) then grant create on schema workspace_private to workspace_review_ingest_owner; end if; end $$;
grant select on public.election,public.category,public.archive_entry to workspace_review_ingest_owner;
create policy workspace_review_ingest_owner_context_election_select on public.election for select to workspace_review_ingest_owner using(true);
create policy workspace_review_ingest_owner_context_category_select on public.category for select to workspace_review_ingest_owner using(true);
create policy workspace_review_ingest_owner_context_archive_select on public.archive_entry for select to workspace_review_ingest_owner using(true);
lock table public.review_item in share row exclusive mode;
set role workspace_review_ingest_owner;
lock table workspace_private.review_item_context in share row exclusive mode;
create function workspace_private.record_review_item_core(p_kind text,p_severity text,p_subject_ref text,p_note text,p_distrito_codes text[],p_seccion_codes text[])
returns table(inserted boolean,review_item_id uuid) language plpgsql security definer set search_path=pg_catalog,workspace_private,public,pg_temp as $$
declare scope_count integer; distinct_count integer; state text; item_id uuid; candidate_count integer; candidate_ids uuid[];
begin
 if p_distrito_codes is null or p_seccion_codes is null or coalesce(array_ndims(p_distrito_codes),1)<>1 or coalesce(array_ndims(p_seccion_codes),1)<>1 or cardinality(p_distrito_codes)<>cardinality(p_seccion_codes) then raise exception 'review scope arrays must be aligned one-dimensional arrays' using errcode='23514'; end if;
 select count(*),count(distinct (distrito,seccion)) into scope_count,distinct_count from unnest(p_distrito_codes,p_seccion_codes) requested(distrito,seccion);
 if scope_count<>distinct_count or exists(select 1 from unnest(p_distrito_codes,p_seccion_codes) requested(distrito,seccion) where distrito!~'^[0-9]{2}$' or seccion!~'^[0-9]{3}$') then raise exception 'review scope must contain unique exact canonical sections' using errcode='23514'; end if;
 if exists(select 1 from unnest(p_distrito_codes,p_seccion_codes) requested(distrito,seccion) where not exists(select 1 from workspace_private.section_scope registered where registered.distrito_code=requested.distrito and registered.seccion_code=requested.seccion)) then raise exception 'review scope is not registered' using errcode='23503'; end if;
 state:=case when scope_count=0 then 'platform_only' else 'section_scoped' end;
 perform pg_catalog.pg_advisory_xact_lock(2963544934623095067);
 select count(*),array_agg(candidate.id) into candidate_count,candidate_ids from public.review_item candidate where candidate.resolved_at is null and candidate.kind=p_kind and candidate.severity=p_severity and candidate.subject_ref=p_subject_ref and candidate.note is not distinct from p_note and candidate.tenant_scope_state=state and (select count(*) from workspace_private.review_item_section_scope existing where existing.review_item_id=candidate.id)=scope_count and not exists(select 1 from workspace_private.review_item_section_scope existing where existing.review_item_id=candidate.id and not exists(select 1 from unnest(p_distrito_codes,p_seccion_codes) requested(distrito,seccion) where requested.distrito=existing.distrito_code and requested.seccion=existing.seccion_code));
 if candidate_count>1 then raise exception 'active review identity is ambiguous' using errcode='23514'; end if;
 if candidate_count=1 then item_id:=candidate_ids[1]; return query select false,item_id; return; end if;
 insert into public.review_item(kind,severity,subject_ref,note,tenant_scope_state) values(p_kind,p_severity,p_subject_ref,p_note,state) returning id into item_id;
 insert into workspace_private.review_item_section_scope(review_item_id,distrito_code,seccion_code) select item_id,distrito,seccion from unnest(p_distrito_codes,p_seccion_codes) requested(distrito,seccion);
 return query select true,item_id;
end $$;
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
create or replace function workspace_private.record_review_item(p_kind text,p_severity text,p_subject_ref text,p_note text,p_distrito_codes text[],p_seccion_codes text[])
returns boolean language plpgsql security definer set search_path=pg_catalog,workspace_private,pg_temp as $$ declare result record; begin select * into strict result from workspace_private.record_review_item_core(p_kind,p_severity,p_subject_ref,p_note,p_distrito_codes,p_seccion_codes); return result.inserted; end $$;
revoke all on function workspace_private.record_review_item_core(text,text,text,text,text[],text[]),workspace_private.record_review_item(text,text,text,text,text[],text[]),workspace_private.record_review_item_v2(text,text,text,text,text[],text[],text,text,text,integer,uuid,uuid,text) from public,anon,authenticated,etl_writer,workspace_query_owner,workspace_admin_owner,workspace_platform_admin;
grant execute on function workspace_private.record_review_item_v2(text,text,text,text,text[],text[],text,text,text,integer,uuid,uuid,text) to etl_writer;
grant execute on function workspace_private.record_review_item(text,text,text,text,text[],text[]) to etl_writer;
do $$ begin if to_regrole('service_role') is not null then revoke all on function workspace_private.record_review_item_core(text,text,text,text,text[],text[]),workspace_private.record_review_item(text,text,text,text,text[],text[]),workspace_private.record_review_item_v2(text,text,text,text,text[],text[],text,text,text,integer,uuid,uuid,text) from service_role; end if; end $$;
reset role;
do $$ begin if not (select schema_create from record_review_item_v2_privileges) then revoke create on schema workspace_private from workspace_review_ingest_owner; end if; end $$;
revoke workspace_review_context_migrator from current_user;
revoke workspace_review_ingest_owner from workspace_review_context_migrator;
drop role workspace_review_context_migrator;
do $$ begin if to_regrole('workspace_review_context_migrator') is not null then raise exception 'workspace_review_context_migrator cleanup failed'; end if; end $$;
commit;
