begin;
do $$ begin perform set_config('votus_fiscal_facets.workspace_query_owner',pg_has_role(current_user,'workspace_query_owner','SET')::text,true); if not pg_has_role(current_user,'workspace_query_owner','SET') then execute format('grant workspace_query_owner to %I',current_user); end if; end $$;
grant create on schema workspace_api to workspace_query_owner;
set role workspace_query_owner;
create or replace function workspace_api.official_facets() returns jsonb language plpgsql stable security definer set search_path=pg_catalog,workspace_private,pg_temp as $$
declare auth_status text; scope_districts text[]; scope_sections text[]; facet_total bigint; facet_page jsonb;
begin
 select min(a.authorization_status),array_agg(a.distrito_code order by a.distrito_code,a.seccion_code) filter(where a.distrito_code is not null),array_agg(a.seccion_code order by a.distrito_code,a.seccion_code) filter(where a.seccion_code is not null) into auth_status,scope_districts,scope_sections from workspace_private.authorized_section_scopes() a;
 if auth_status not in ('authorized','authorized_empty') then return jsonb_build_object('status',auth_status,'facets','[]'::jsonb,'total',0,'truncated',false); end if;
 if auth_status='authorized_empty' then return jsonb_build_object('status','ok','facets','[]'::jsonb,'total',0,'truncated',false); end if;
 with options as materialized (select e.id election_id,e.year,e.round,c.id category_id,c.name category_name,j.distrito_code,case when count(distinct nullif(btrim(j.distrito_name),''))=1 then max(nullif(btrim(j.distrito_name),'')) end distrito_name,case count(distinct nullif(btrim(j.distrito_name),'')) when 0 then 'missing' when 1 then 'present' else 'conflict' end distrito_name_status,count(distinct nullif(btrim(j.distrito_name),'')) distrito_name_variant_count,j.seccion_code,case when count(distinct nullif(btrim(j.seccion_name),''))=1 then max(nullif(btrim(j.seccion_name),'')) end seccion_name,case count(distinct nullif(btrim(j.seccion_name),'')) when 0 then 'missing' when 1 then 'present' else 'conflict' end seccion_name_status,count(distinct nullif(btrim(j.seccion_name),'')) seccion_name_variant_count from unnest(scope_districts,scope_sections) scope(distrito_code,seccion_code) join public.jurisdiction j using(distrito_code,seccion_code) join public.result_row rr on rr.jurisdiction_id=j.id and rr.source_kind='official' join public.election e on e.id=rr.election_id join public.category c on c.id=rr.category_id where j.seccion_code is not null group by e.id,e.year,e.round,c.id,c.name,j.distrito_code,j.seccion_code), counted as (select count(*) total from options), page as (select * from options order by year,round,election_id,category_name,category_id,distrito_code,seccion_code limit 200)
 select counted.total,coalesce(jsonb_agg(to_jsonb(page) order by page.year,page.round,page.election_id,page.category_name,page.category_id,page.distrito_code,page.seccion_code) filter(where page.election_id is not null),'[]'::jsonb) into facet_total,facet_page from counted left join page on true group by counted.total;
 if facet_total>200 then return jsonb_build_object('status','payload_too_large','facets','[]'::jsonb,'total',facet_total,'truncated',true); end if;
 return jsonb_build_object('status','ok','facets',facet_page,'total',facet_total,'truncated',false);
end $$;
reset role;
revoke create on schema workspace_api from workspace_query_owner;
do $$ begin if current_setting('votus_fiscal_facets.workspace_query_owner',true)='false' then execute format('revoke workspace_query_owner from %I',current_user); end if; end $$;
commit;
