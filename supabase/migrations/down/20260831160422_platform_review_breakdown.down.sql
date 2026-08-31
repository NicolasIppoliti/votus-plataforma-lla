begin;
do $$ declare protected_count bigint; categories jsonb;
begin
 select coalesce(sum(rows),0),coalesce(jsonb_agg(jsonb_build_object('context_role',context_role,'source_kind',source_kind,'archive_availability',archive_availability,'rows',rows) order by context_role,source_kind,archive_availability),'[]'::jsonb)
 into protected_count,categories from (select context_role,source_kind,archive_availability,count(*) rows from workspace_private.review_item_context where unknown_reason is null group by context_role,source_kind,archive_availability) categorized;
 if protected_count>0 then raise exception 'platform review breakdown rollback refused: count=%, categories=%',protected_count,categories using errcode='23514'; end if;
end $$;
do $$ begin if to_regrole('workspace_review_breakdown_migrator') is not null then raise exception 'workspace_review_breakdown_migrator already exists'; end if; end $$;
create role workspace_review_breakdown_migrator nologin noinherit;
grant workspace_review_ingest_owner to workspace_review_breakdown_migrator with inherit false, set true;
grant workspace_review_breakdown_migrator to current_user with inherit false, set true;
create temporary table platform_review_breakdown_down_privileges(schema_create boolean not null) on commit drop;
insert into platform_review_breakdown_down_privileges values(has_schema_privilege('workspace_review_ingest_owner','workspace_private','CREATE'));
do $$ begin if not (select schema_create from platform_review_breakdown_down_privileges) then grant create on schema workspace_private to workspace_review_ingest_owner; end if; end $$;
set role workspace_review_ingest_owner;
alter table workspace_private.review_item_context alter column unknown_reason set not null;
drop function workspace_private.platform_review_breakdown(integer,integer);
reset role;
drop policy workspace_review_ingest_owner_breakdown_election_select on public.election;
drop policy workspace_review_ingest_owner_breakdown_category_select on public.category;
do $$ begin if not (select schema_create from platform_review_breakdown_down_privileges) then revoke create on schema workspace_private from workspace_review_ingest_owner; end if; end $$;
revoke workspace_review_breakdown_migrator from current_user;
revoke workspace_review_ingest_owner from workspace_review_breakdown_migrator;
drop role workspace_review_breakdown_migrator;
do $$ begin if to_regrole('workspace_review_breakdown_migrator') is not null then raise exception 'workspace_review_breakdown_migrator cleanup failed'; end if; end $$;
commit;
