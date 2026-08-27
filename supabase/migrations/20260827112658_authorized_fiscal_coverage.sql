begin;
do $$ begin perform set_config('votus_coverage.workspace_query_owner',pg_has_role(current_user,'workspace_query_owner','SET')::text,true); if not pg_has_role(current_user,'workspace_query_owner','SET') then execute format('grant workspace_query_owner to %I',current_user); end if; end $$;
grant execute on function public.results_exploration_coverage(uuid,uuid,text,text) to workspace_query_owner;
grant create on schema workspace_api to workspace_query_owner;
set role workspace_query_owner;
create function workspace_api.fiscalizacion_coverage(p_election_id uuid,p_category_id uuid,p_distrito_code text,p_seccion_code text,p_opt_in boolean default false) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,workspace_private,public,pg_temp as $$
declare auth_status text; scope_allowed boolean; core jsonb; payload jsonb; uncovered_total bigint; exclusion_total bigint; uncovered_items jsonb; exclusion_items jsonb;
begin
 if not coalesce(p_opt_in,false) then return jsonb_build_object('status','opt_in_required'); end if;
 select min(a.authorization_status),coalesce(bool_or(a.distrito_code=p_distrito_code and a.seccion_code=p_seccion_code),false) into auth_status,scope_allowed from workspace_private.authorized_section_scopes() a;
 if auth_status not in ('authorized','authorized_empty') then return jsonb_build_object('status','authorization_denied','authorization_status',auth_status); end if;
 if not scope_allowed then return jsonb_build_object('status','authorization_denied','authorization_status','scope_denied'); end if;
 core:=public.results_exploration_coverage(p_election_id,p_category_id,p_distrito_code,p_seccion_code);
 if core->>'status'='source_inconsistent' then return jsonb_build_object('status','source_inconsistent'); end if;
 select count(*) into uncovered_total from jsonb_array_elements(coalesce(core->'mesas','[]'::jsonb)) m(item) where not coalesce((item->>'covered')::boolean,false);
 select coalesce(jsonb_agg(item order by ordinal),'[]'::jsonb) into uncovered_items from (select jsonb_build_object('code',m.item->'code','circuito_code',m.item->'circuito_code','establecimiento_code',m.item->'establecimiento_code','establecimiento_name',m.item->'establecimiento_name') item,m.ordinality ordinal from jsonb_array_elements(coalesce(core->'mesas','[]'::jsonb)) with ordinality m(item,ordinality) where not coalesce((m.item->>'covered')::boolean,false) order by m.ordinality limit 100) page;
 select jsonb_array_length(coalesce(core->'exclusions','[]'::jsonb)) into exclusion_total;
 select coalesce(jsonb_agg(item order by ordinal),'[]'::jsonb) into exclusion_items from (select jsonb_build_object('reason',e.item->'reason','rows',e.item->'rows') item,e.ordinality ordinal from jsonb_array_elements(coalesce(core->'exclusions','[]'::jsonb)) with ordinality e(item,ordinality) order by e.ordinality limit 20) page;
 payload:=jsonb_build_object('status',coalesce(core->>'status','source_unavailable'),'authorization_status','authorized','source_kind','fiscalizacion','is_random_sample',false,'vote_data','not_included','observed_units',coalesce((core->'mesas_coverage'->>'observed_units')::bigint,0),'denominator_units',coalesce((core->'mesas_coverage'->>'denominator_units')::bigint,0),'uncovered',jsonb_build_object('items',uncovered_items,'total',uncovered_total,'truncated',uncovered_total>100),'exclusions',jsonb_build_object('items',exclusion_items,'total',exclusion_total,'truncated',exclusion_total>20),'truncated',uncovered_total>100 or exclusion_total>20);
 if octet_length(payload::text)>120000 then return jsonb_build_object('status','payload_too_large','authorization_status','authorized','source_kind','fiscalizacion','is_random_sample',false,'vote_data','not_included','truncated',true); end if;
 return payload;
end $$;
revoke all on function workspace_api.fiscalizacion_coverage(uuid,uuid,text,text,boolean) from public,anon,authenticated;
grant execute on function workspace_api.fiscalizacion_coverage(uuid,uuid,text,text,boolean) to authenticated;
reset role;
revoke create on schema workspace_api from workspace_query_owner;
do $$ begin if to_regrole('service_role') is not null then revoke all on function workspace_api.fiscalizacion_coverage(uuid,uuid,text,text,boolean) from service_role; end if; end $$;
do $$ begin if current_setting('votus_coverage.workspace_query_owner',true)='false' then execute format('revoke workspace_query_owner from %I',current_user); end if; end $$;
commit;
