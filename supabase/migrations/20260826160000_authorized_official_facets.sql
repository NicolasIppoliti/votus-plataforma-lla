begin;
do $$ declare r text; begin foreach r in array array['workspace_admin_owner','workspace_context_owner','workspace_query_owner'] loop perform set_config('votus_facets.'||r,pg_has_role(current_user,r,'SET')::text,true); if not pg_has_role(current_user,r,'SET') then execute format('grant %I to %I',r,current_user); end if; end loop; end $$;
set role workspace_admin_owner;
grant select on workspace_private.organization,workspace_private.organization_membership,workspace_private.organization_section_entitlement,workspace_private.section_scope to workspace_query_owner;
create policy workspace_query_owner_organization_select on workspace_private.organization for select to workspace_query_owner using(true);
create policy workspace_query_owner_membership_select on workspace_private.organization_membership for select to workspace_query_owner using(true);
create policy workspace_query_owner_entitlement_select on workspace_private.organization_section_entitlement for select to workspace_query_owner using(true);
create policy workspace_query_owner_section_select on workspace_private.section_scope for select to workspace_query_owner using(true);
reset role; set role workspace_context_owner;
grant select on workspace_private.workspace_context to workspace_query_owner;
grant execute on function workspace_private.trusted_workspace_claims() to workspace_query_owner;
create policy workspace_query_owner_context_select on workspace_private.workspace_context for select to workspace_query_owner using(true);
reset role;
create index result_row_authorized_official_facets_idx on public.result_row(jurisdiction_id,election_id,category_id) where source_kind='official';
grant select on public.result_row,public.jurisdiction,public.election,public.category to workspace_query_owner;
create policy workspace_query_owner_result_row_select on public.result_row for select to workspace_query_owner using(true);
create policy workspace_query_owner_jurisdiction_select on public.jurisdiction for select to workspace_query_owner using(true);
create policy workspace_query_owner_election_select on public.election for select to workspace_query_owner using(true);
create policy workspace_query_owner_category_select on public.category for select to workspace_query_owner using(true);
grant create on schema workspace_private,workspace_api to workspace_query_owner;
set role workspace_query_owner;
create function workspace_private.authorized_section_scopes() returns table(authorization_status text,organization_id uuid,distrito_code text,seccion_code text)
language plpgsql stable security definer set search_path=pg_catalog,workspace_private,pg_temp as $$
declare c record; ctx workspace_private.workspace_context%rowtype; org workspace_private.organization%rowtype; member workspace_private.organization_membership%rowtype;
begin
 select * into c from workspace_private.trusted_workspace_claims();
 select * into ctx from workspace_private.workspace_context x where x.session_id=c.claim_session_id;
 if not found then return query select 'context_missing',null::uuid,null::text,null::text; return; end if;
 if ctx.user_id<>c.claim_user_id then return query select 'claims_mismatch',null::uuid,null::text,null::text; return; end if;
 if ctx.revoked_at is not null then return query select 'context_revoked',ctx.organization_id,null::text,null::text; return; end if;
 if ctx.fixed_expires_at<=statement_timestamp() then return query select 'context_expired',ctx.organization_id,null::text,null::text; return; end if;
 if ctx.organization_id is null then return query select 'selection_required',null::uuid,null::text,null::text; return; end if;
 select * into org from workspace_private.organization o where o.id=ctx.organization_id;
 if not found or org.disabled_at is not null then return query select 'organization_disabled',ctx.organization_id,null::text,null::text; return; end if;
 if org.entitlement_revision<>ctx.entitlement_revision then return query select 'context_stale',ctx.organization_id,null::text,null::text; return; end if;
 select * into member from workspace_private.organization_membership m where m.organization_id=ctx.organization_id and m.user_id=c.claim_user_id;
 if not found or member.revoked_at is not null then return query select 'membership_revoked',ctx.organization_id,null::text,null::text; return; end if;
 if member.membership_revision<>ctx.membership_revision then return query select 'context_stale',ctx.organization_id,null::text,null::text; return; end if;
 return query select 'authorized',org.id,e.distrito_code,e.seccion_code from workspace_private.organization_section_entitlement e join workspace_private.section_scope s using(distrito_code,seccion_code) where e.organization_id=org.id and e.revoked_at is null order by e.distrito_code,e.seccion_code;
 if not found then return query select 'authorized_empty',org.id,null::text,null::text; end if;
end $$;
create function workspace_api.official_facets() returns jsonb language plpgsql stable security definer set search_path=pg_catalog,workspace_private,pg_temp as $$
declare auth_status text; scope_districts text[]; scope_sections text[]; facet_total bigint; facet_page jsonb;
begin
 select min(a.authorization_status),array_agg(a.distrito_code order by a.distrito_code,a.seccion_code) filter(where a.distrito_code is not null),array_agg(a.seccion_code order by a.distrito_code,a.seccion_code) filter(where a.seccion_code is not null) into auth_status,scope_districts,scope_sections from workspace_private.authorized_section_scopes() a;
 if auth_status not in ('authorized','authorized_empty') then return jsonb_build_object('status',auth_status,'facets','[]'::jsonb,'total',0,'truncated',false); end if;
 if auth_status='authorized_empty' then return jsonb_build_object('status','ok','facets','[]'::jsonb,'total',0,'truncated',false); end if;
 with options as materialized (select distinct e.id election_id,e.year,e.round,c.id category_id,c.name category_name,j.distrito_code,j.seccion_code from unnest(scope_districts,scope_sections) scope(distrito_code,seccion_code) join public.jurisdiction j using(distrito_code,seccion_code) join public.result_row rr on rr.jurisdiction_id=j.id and rr.source_kind='official' join public.election e on e.id=rr.election_id join public.category c on c.id=rr.category_id where j.seccion_code is not null), counted as (select count(*) total from options), page as (select * from options order by year,round,election_id,category_name,category_id,distrito_code,seccion_code limit 200)
 select counted.total,coalesce(jsonb_agg(jsonb_build_object('election_id',page.election_id,'year',page.year,'round',page.round,'category_id',page.category_id,'category_name',page.category_name,'distrito_code',page.distrito_code,'seccion_code',page.seccion_code) order by page.year,page.round,page.election_id,page.category_name,page.category_id,page.distrito_code,page.seccion_code) filter(where page.election_id is not null),'[]'::jsonb) into facet_total,facet_page from counted left join page on true group by counted.total;
 return jsonb_build_object('status','ok','facets',facet_page,'total',facet_total,'truncated',facet_total>200);
end $$;
revoke all on function workspace_private.authorized_section_scopes(),workspace_api.official_facets() from public,anon,authenticated;
grant execute on function workspace_api.official_facets() to authenticated;
reset role; revoke create on schema workspace_private,workspace_api from workspace_query_owner;
do $$ begin if to_regrole('service_role') is not null then revoke all on function workspace_private.authorized_section_scopes(),workspace_api.official_facets() from service_role; end if; end $$;
do $$ declare r text; begin foreach r in array array['workspace_query_owner','workspace_context_owner','workspace_admin_owner'] loop if current_setting('votus_facets.'||r,true)='false' then execute format('revoke %I from %I',r,current_user); end if; end loop; end $$;
commit;
