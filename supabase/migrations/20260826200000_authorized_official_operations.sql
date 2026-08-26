begin;
do $$ declare r text; begin foreach r in array array['workspace_query_owner'] loop perform set_config('votus_operations.'||r,pg_has_role(current_user,r,'SET')::text,true); if not pg_has_role(current_user,r,'SET') then execute format('grant %I to %I',r,current_user); end if; end loop; end $$;
grant execute on function public.results_exploration_official(uuid,uuid,text,text,text,text,integer,text) to workspace_query_owner;
grant create on schema workspace_api to workspace_query_owner;
set role workspace_query_owner;
create function workspace_api.official_result(p_election_id uuid,p_category_id uuid,p_distrito_code text,p_seccion_code text default null,p_circuito_code text default null,p_establecimiento_code text default null,p_mesa_code integer default null,p_requested_level text default 'seccion') returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,workspace_private,public,pg_temp as $$
declare auth_status text; scope_allowed boolean; payload jsonb;
begin
 select min(a.authorization_status),coalesce(bool_or(a.distrito_code=p_distrito_code and a.seccion_code=p_seccion_code),false) into auth_status,scope_allowed from workspace_private.authorized_section_scopes() a;
 if auth_status not in ('authorized','authorized_empty') then return jsonb_build_object('status','authorization_denied','authorization_status',auth_status,'truncated',false); end if;
 if p_seccion_code is null then return jsonb_build_object('status','authorization_denied','authorization_status','scope_required','reason','an exact section is required for an authorized official operation','truncated',false); end if;
 if not scope_allowed then return jsonb_build_object('status','authorization_denied','authorization_status','scope_denied','truncated',false); end if;
 if exists(select 1 from public.result_row rr join public.jurisdiction j on j.id=rr.jurisdiction_id where rr.election_id=p_election_id and rr.category_id=p_category_id and rr.source_kind='official' and j.distrito_code=p_distrito_code and j.seccion_code is null) then return jsonb_build_object('status','source_unavailable','reason','official rows without exact section identity were excluded','exclusions',jsonb_build_array(jsonb_build_object('reason','official_rows_without_section_identity')),'source_exclusions','[]'::jsonb,'authorization_status','authorized','truncated',false); end if;
 payload:=public.results_exploration_official(p_election_id,p_category_id,p_distrito_code,p_seccion_code,p_circuito_code,p_establecimiento_code,p_mesa_code,p_requested_level);
 if octet_length(payload::text)>120000 then return jsonb_build_object('status','payload_too_large','total_bytes',octet_length(payload::text),'truncated',true,'authorization_status','authorized'); end if;
 return payload||jsonb_build_object('authorization_status','authorized','truncated',false);
end $$;
create function workspace_api.official_comparison(p_left_election_id uuid,p_left_category_id uuid,p_left_distrito_code text,p_left_seccion_code text default null,p_left_circuito_code text default null,p_left_establecimiento_code text default null,p_left_mesa_code integer default null,p_left_requested_level text default 'seccion',p_right_election_id uuid default null,p_right_category_id uuid default null,p_right_distrito_code text default null,p_right_seccion_code text default null,p_right_circuito_code text default null,p_right_establecimiento_code text default null,p_right_mesa_code integer default null,p_right_requested_level text default 'seccion') returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,workspace_api,pg_temp as $$
declare left_payload jsonb; right_payload jsonb; payload jsonb;
begin
 left_payload:=workspace_api.official_result(p_left_election_id,p_left_category_id,p_left_distrito_code,p_left_seccion_code,p_left_circuito_code,p_left_establecimiento_code,p_left_mesa_code,p_left_requested_level);
 right_payload:=workspace_api.official_result(p_right_election_id,p_right_category_id,p_right_distrito_code,p_right_seccion_code,p_right_circuito_code,p_right_establecimiento_code,p_right_mesa_code,p_right_requested_level);
 if left_payload->>'authorization_status'<>'authorized' then return jsonb_build_object('status','authorization_denied','side','left','authorization_status',left_payload->>'authorization_status','truncated',false); end if;
 if right_payload->>'authorization_status'<>'authorized' then return jsonb_build_object('status','authorization_denied','side','right','authorization_status',right_payload->>'authorization_status','truncated',false); end if;
 if left_payload->>'status'<>'ok' then return jsonb_build_object('status','operation_unavailable','side','left','operation_status',left_payload->>'status','truncated',false); end if;
 if right_payload->>'status'<>'ok' then return jsonb_build_object('status','operation_unavailable','side','right','operation_status',right_payload->>'status','truncated',false); end if;
 payload:=jsonb_build_object('status','ok','left',left_payload-'authorization_status','right',right_payload-'authorization_status','truncated',false);
 if octet_length(payload::text)>250000 then return jsonb_build_object('status','payload_too_large','total_bytes',octet_length(payload::text),'truncated',true); end if;
 return payload;
end $$;
revoke all on function workspace_api.official_result(uuid,uuid,text,text,text,text,integer,text),workspace_api.official_comparison(uuid,uuid,text,text,text,text,integer,text,uuid,uuid,text,text,text,text,integer,text) from public,anon,authenticated;
grant execute on function workspace_api.official_result(uuid,uuid,text,text,text,text,integer,text),workspace_api.official_comparison(uuid,uuid,text,text,text,text,integer,text,uuid,uuid,text,text,text,text,integer,text) to authenticated;
reset role; revoke create on schema workspace_api from workspace_query_owner;
do $$ begin if to_regrole('service_role') is not null then revoke all on function workspace_api.official_result(uuid,uuid,text,text,text,text,integer,text),workspace_api.official_comparison(uuid,uuid,text,text,text,text,integer,text,uuid,uuid,text,text,text,text,integer,text) from service_role; end if; end $$;
do $$ begin if current_setting('votus_operations.workspace_query_owner',true)='false' then execute format('revoke workspace_query_owner from %I',current_user); end if; end $$;
commit;
