begin;
do $$ begin if to_regrole('workspace_review_breakdown_migrator') is not null then raise exception 'workspace_review_breakdown_migrator already exists'; end if; end $$;
create role workspace_review_breakdown_migrator nologin noinherit;
grant workspace_review_ingest_owner to workspace_review_breakdown_migrator with inherit false, set true;
grant workspace_review_breakdown_migrator to current_user with inherit false, set true;
create temporary table platform_review_breakdown_privileges(schema_create boolean not null) on commit drop;
insert into platform_review_breakdown_privileges values(has_schema_privilege('workspace_review_ingest_owner','workspace_private','CREATE'));
do $$ begin if not (select schema_create from platform_review_breakdown_privileges) then grant create on schema workspace_private to workspace_review_ingest_owner; end if; end $$;
create policy workspace_review_ingest_owner_breakdown_election_select on public.election for select to workspace_review_ingest_owner using(true);
create policy workspace_review_ingest_owner_breakdown_category_select on public.category for select to workspace_review_ingest_owner using(true);
set role workspace_review_ingest_owner;
alter table workspace_private.review_item_context alter column unknown_reason drop not null;
create function workspace_private.platform_review_breakdown(p_limit integer default 50,p_offset integer default 0) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,workspace_private,public,pg_temp as $$
declare total_items bigint; total_groups bigint; page_groups bigint; resolved_items bigint; resolved_category_groups bigint; groups jsonb; resolved_categories jsonb; bounded_resolved_categories jsonb; resolved_exclusion jsonb; bounded_resolved_exclusion jsonb; exclusions jsonb; payload jsonb;
    begin
     if p_limit is null or p_limit<1 or p_limit>100 or p_offset is null or p_offset<0 or p_offset>2000000000 then raise exception 'invalid platform review breakdown pagination' using errcode='22023'; end if;
     with source as materialized(
      select r.id review_item_id,r.kind category,r.severity reason,r.tenant_scope_state,c.context_role,c.source_kind,c.archive_availability,c.election_year,e.round election_round,cat.name category_name,(c.archive_entry_id is not null) archive_linked
      from public.review_item r join workspace_private.review_item_context c on c.review_item_id=r.id left join public.election e on e.id=c.election_id left join public.category cat on cat.id=c.category_id where r.resolved_at is null
     ),grouped as materialized(
      select category,reason,tenant_scope_state,context_role,source_kind,archive_availability,election_year,election_round,category_name,archive_linked,count(distinct review_item_id) rows
      from source group by category,reason,tenant_scope_state,context_role,source_kind,archive_availability,election_year,election_round,category_name,archive_linked
     ),page as(
      select * from grouped order by category,reason,tenant_scope_state,context_role,source_kind,archive_availability,election_year nulls last,election_round nulls last,category_name nulls last,archive_linked limit p_limit offset p_offset
     ),resolved_grouped as materialized(
      select r.kind category,r.severity reason,count(distinct r.id) rows from public.review_item r where r.resolved_at is not null group by r.kind,r.severity
     )
     select (select count(distinct review_item_id) from source),(select count(*) from grouped),(select count(*) from page),coalesce((select jsonb_agg(jsonb_build_object('category',category,'reason',reason,'tenant_scope_state',tenant_scope_state,'context_role',context_role,'source_kind',source_kind,'archive_availability',archive_availability,'election_year',election_year,'election_round',election_round,'category_name',category_name,'archive_linked',archive_linked,'rows',rows) order by category,reason,tenant_scope_state,context_role,source_kind,archive_availability,election_year nulls last,election_round nulls last,category_name nulls last,archive_linked) from page),'[]'::jsonb),coalesce((select sum(rows) from resolved_grouped),0),(select count(*) from resolved_grouped),coalesce((select jsonb_agg(jsonb_build_object('category',category,'reason',reason,'rows',rows) order by category,reason) from resolved_grouped),'[]'::jsonb)
     into total_items,total_groups,page_groups,groups,resolved_items,resolved_category_groups,resolved_categories;
     resolved_exclusion:=case when resolved_items>0 then jsonb_build_object('reason','resolved_items','rows',resolved_items,'categories',resolved_categories) else null end;
     exclusions:=(case when total_groups>page_groups then jsonb_build_array(jsonb_build_object('reason','pagination_bound','groups',total_groups-page_groups)) else '[]'::jsonb end)||(case when resolved_exclusion is not null then jsonb_build_array(resolved_exclusion) else '[]'::jsonb end);
     payload:=jsonb_build_object('status',case when page_groups=0 then 'no_rows' else 'ok' end,'total_items',total_items,'total_groups',total_groups,'groups',groups,'truncated',total_groups>page_groups or resolved_items>0,'exclusions',exclusions);
     if octet_length(payload::text)>8192 then
      select coalesce(jsonb_agg(entry order by ordinal),'[]'::jsonb) into bounded_resolved_categories from jsonb_array_elements(resolved_categories) with ordinality as bounded(entry,ordinal) where ordinal<=25;
      bounded_resolved_exclusion:=case when resolved_items>0 then jsonb_build_object('reason','resolved_items','rows',resolved_items,'category_groups',resolved_category_groups,'category_offset',0,'category_limit',jsonb_array_length(bounded_resolved_categories),'categories_omitted',resolved_category_groups-jsonb_array_length(bounded_resolved_categories),'categories',bounded_resolved_categories) else null end;
      exclusions:=jsonb_build_array(jsonb_build_object('reason','payload_bound','groups',total_groups))||(case when bounded_resolved_exclusion is not null then jsonb_build_array(bounded_resolved_exclusion) else '[]'::jsonb end);
      payload:=jsonb_build_object('status','payload_too_large','total_items',total_items,'total_groups',total_groups,'groups','[]'::jsonb,'truncated',total_groups>0 or resolved_items>0,'exclusions',exclusions);
      if octet_length(payload::text)>8192 and bounded_resolved_exclusion is not null then
       bounded_resolved_exclusion:=jsonb_build_object('reason','resolved_items','rows',resolved_items,'category_groups',resolved_category_groups,'category_offset',0,'category_limit',0,'categories_omitted',resolved_category_groups,'categories','[]'::jsonb);
       payload:=jsonb_build_object('status','payload_too_large','total_items',total_items,'total_groups',total_groups,'groups','[]'::jsonb,'truncated',true,'exclusions',jsonb_build_array(jsonb_build_object('reason','payload_bound','groups',total_groups),bounded_resolved_exclusion));
      end if;
      return payload;
     end if;
     return payload;
end $$;
revoke all on function workspace_private.platform_review_breakdown(integer,integer) from public,anon,authenticated,etl_writer,workspace_query_owner,workspace_admin_owner,workspace_platform_admin;
grant execute on function workspace_private.platform_review_breakdown(integer,integer) to workspace_platform_admin;
do $$ begin if to_regrole('service_role') is not null then revoke all on function workspace_private.platform_review_breakdown(integer,integer) from service_role; end if; end $$;
reset role;
do $$ begin if not (select schema_create from platform_review_breakdown_privileges) then revoke create on schema workspace_private from workspace_review_ingest_owner; end if; end $$;
revoke workspace_review_breakdown_migrator from current_user;
revoke workspace_review_ingest_owner from workspace_review_breakdown_migrator;
drop role workspace_review_breakdown_migrator;
do $$ begin if to_regrole('workspace_review_breakdown_migrator') is not null then raise exception 'workspace_review_breakdown_migrator cleanup failed'; end if; end $$;
commit;
