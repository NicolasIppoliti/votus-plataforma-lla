begin;
do $$ begin perform set_config('votus_projections.workspace_query_owner',pg_has_role(current_user,'workspace_query_owner','SET')::text,true); if not pg_has_role(current_user,'workspace_query_owner','SET') then execute format('grant workspace_query_owner to %I',current_user); end if; end $$;
grant execute on function public.results_exploration_schools(uuid,uuid,text,text) to workspace_query_owner;
grant select on public.archive_entry to workspace_query_owner;
create policy workspace_query_owner_archive_entry_select on public.archive_entry for select to workspace_query_owner using(source_kind='official');
grant create on schema workspace_api to workspace_query_owner;
set role workspace_query_owner;
create function workspace_api.official_schools(p_election_id uuid,p_category_id uuid,p_distrito_code text,p_seccion_code text) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,workspace_private,public,pg_temp as $$
declare auth_status text; scope_allowed boolean; payload jsonb;
begin
 select min(a.authorization_status),coalesce(bool_or(a.distrito_code=p_distrito_code and a.seccion_code=p_seccion_code),false) into auth_status,scope_allowed from workspace_private.authorized_section_scopes() a;
 if auth_status not in ('authorized','authorized_empty') then return jsonb_build_object('status','authorization_denied','authorization_status',auth_status,'truncated',false); end if;
 if p_seccion_code is null then return jsonb_build_object('status','authorization_denied','authorization_status','scope_required','reason','an exact section is required for authorized schools','truncated',false); end if;
 if not scope_allowed then return jsonb_build_object('status','authorization_denied','authorization_status','scope_denied','truncated',false); end if;
 payload:=public.results_exploration_schools(p_election_id,p_category_id,p_distrito_code,p_seccion_code);
 if octet_length(payload::text)>120000 then return jsonb_build_object('status','payload_too_large','total_bytes',octet_length(payload::text),'authorization_status','authorized','truncated',true); end if;
 return payload||jsonb_build_object('authorization_status','authorized','truncated',false);
end $$;
create function workspace_api.official_reference(p_election_id uuid,p_category_id uuid,p_distrito_code text,p_seccion_code text) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,workspace_private,public,pg_temp as $$
declare auth_status text; scope_allowed boolean; reference_total bigint; excluded_rows bigint; items jsonb; payload jsonb; source_exclusions jsonb;
begin
 select min(a.authorization_status),coalesce(bool_or(a.distrito_code=p_distrito_code and a.seccion_code=p_seccion_code),false) into auth_status,scope_allowed from workspace_private.authorized_section_scopes() a;
 if auth_status not in ('authorized','authorized_empty') then return jsonb_build_object('status','authorization_denied','authorization_status',auth_status,'total',0,'truncated',false); end if;
 if p_seccion_code is null or not scope_allowed then return jsonb_build_object('status','authorization_denied','authorization_status',case when p_seccion_code is null then 'scope_required' else 'scope_denied' end,'total',0,'truncated',false); end if;
 select coalesce(jsonb_agg(jsonb_build_object('kind',kind,'reason','non_official_source','rows',rows) order by kind),'[]'::jsonb) into source_exclusions from (select coalesce(rr.source_kind,'unknown') kind,count(*) rows from public.result_row rr join public.jurisdiction j on j.id=rr.jurisdiction_id where rr.election_id=p_election_id and rr.category_id=p_category_id and rr.source_kind is distinct from 'official' and j.distrito_code=p_distrito_code and j.seccion_code=p_seccion_code group by coalesce(rr.source_kind,'unknown')) excluded;
 select count(*) into excluded_rows from public.result_row rr join public.jurisdiction j on j.id=rr.jurisdiction_id where rr.election_id=p_election_id and rr.category_id=p_category_id and rr.source_kind='official' and j.distrito_code=p_distrito_code and j.seccion_code is null; if excluded_rows>0 then return jsonb_build_object('status','source_unavailable','reason','official rows without exact section identity were excluded','exclusions',jsonb_build_array(jsonb_build_object('reason','official_rows_without_section_identity','rows',excluded_rows)),'source_exclusions',source_exclusions,'total',0,'truncated',false,'authorization_status','authorized'); end if;
 with refs as materialized (select distinct j.id jurisdiction_id,e.id election_id,e.year,e.round,c.id category_id,c.name category_name,j.distrito_code,j.distrito_name,j.seccion_code,j.seccion_name,j.circuito_code,j.circuito_name,j.establecimiento_code,j.establecimiento_name,j.mesa_code from public.result_row rr join public.jurisdiction j on j.id=rr.jurisdiction_id join public.election e on e.id=rr.election_id join public.category c on c.id=rr.category_id where rr.election_id=p_election_id and rr.category_id=p_category_id and rr.source_kind='official' and j.distrito_code=p_distrito_code and j.seccion_code=p_seccion_code), counted as (select count(*) total from refs), page as (select * from refs order by jurisdiction_id limit 100) select counted.total,coalesce(jsonb_agg(to_jsonb(page) order by page.jurisdiction_id) filter(where page.jurisdiction_id is not null),'[]'::jsonb) into reference_total,items from counted left join page on true group by counted.total;
 payload:=jsonb_build_object('status',case when reference_total=0 then 'no_rows' else 'ok' end,'source_kind','official','items',items,'source_exclusions',source_exclusions,'total',reference_total,'truncated',reference_total>100,'authorization_status','authorized');
 if octet_length(payload::text)>120000 then return jsonb_build_object('status','payload_too_large','source_exclusions',source_exclusions,'total',reference_total,'authorization_status','authorized','truncated',true); end if;
 return payload;
end $$;
create function workspace_api.official_provenance(p_election_id uuid,p_category_id uuid,p_distrito_code text,p_seccion_code text) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,workspace_api,public,pg_temp as $$
declare base jsonb; payload jsonb; source_total bigint;
begin
 base:=workspace_api.official_result(p_election_id,p_category_id,p_distrito_code,p_seccion_code,null,null,null,'seccion');
 if base->>'authorization_status'<>'authorized' or base->>'status'<>'ok' then return jsonb_build_object('status',base->'status','reason',base->'reason','exclusions',coalesce(base->'exclusions','[]'::jsonb),'source_exclusions',coalesce(base->'source_exclusions','[]'::jsonb),'authorization_status',base->'authorization_status','truncated',false); end if;
 with ids as materialized (select value id from jsonb_array_elements_text(coalesce(base->'archive_entry_ids','[]'::jsonb))), counted as (select count(*) total from ids), page as (select id from ids order by id limit 100), sources as (select p.id,ae.capability,ae.mime,ae.bytes,ae.fetched_at,ae.status,ae.sha256,ae.id is not null metadata_available from page p left join public.archive_entry ae on ae.id=p.id and ae.source_kind='official')
 select counted.total,jsonb_build_object('status','ok','source_kind','official','source_audit',base->'source_audit','source_exclusions',coalesce(base->'source_exclusions','[]'::jsonb),'archive_entry_ids',coalesce(jsonb_agg(sources.id order by sources.id) filter(where sources.id is not null),'[]'::jsonb),'sources',coalesce(jsonb_agg(jsonb_build_object('id',sources.id,'metadata_status',case when sources.metadata_available then 'available' else 'source_unavailable' end,'capability',sources.capability,'mime',sources.mime,'bytes',sources.bytes,'fetched_at',sources.fetched_at,'status',sources.status,'sha256',sources.sha256) order by sources.id) filter(where sources.id is not null),'[]'::jsonb),'total',counted.total,'truncated',counted.total>100,'authorization_status','authorized') into source_total,payload from counted left join sources on true group by counted.total;
 if octet_length(payload::text)>120000 then return jsonb_build_object('status','payload_too_large','total',source_total,'authorization_status','authorized','truncated',true); end if;
 return payload;
end $$;
revoke all on function workspace_api.official_schools(uuid,uuid,text,text),workspace_api.official_reference(uuid,uuid,text,text),workspace_api.official_provenance(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function workspace_api.official_schools(uuid,uuid,text,text),workspace_api.official_reference(uuid,uuid,text,text),workspace_api.official_provenance(uuid,uuid,text,text) to authenticated;
reset role; revoke create on schema workspace_api from workspace_query_owner;
do $$ begin if to_regrole('service_role') is not null then revoke all on function workspace_api.official_schools(uuid,uuid,text,text),workspace_api.official_reference(uuid,uuid,text,text),workspace_api.official_provenance(uuid,uuid,text,text) from service_role; end if; end $$;
do $$ begin if current_setting('votus_projections.workspace_query_owner',true)='false' then execute format('revoke workspace_query_owner from %I',current_user); end if; end $$;
commit;
