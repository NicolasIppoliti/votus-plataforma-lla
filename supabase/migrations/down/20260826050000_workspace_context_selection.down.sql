begin;
do $$ begin
  if exists(select 1 from workspace_private.workspace_context where organization_id is null)
    then raise exception 'workspace-selection rollback refused while selection is required'; end if;
  if (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='workspace_api' and p.proname=any(array['available_organizations',
        'current_workspace','bootstrap_workspace_context','switch_workspace_context']))<>4
    or to_regprocedure('workspace_private.trusted_workspace_claims()') is null
    or (select count(*) from pg_policies where policyname=any(array[
      'workspace_context_owner_organization_select','workspace_context_owner_membership_select']))<>2
  then raise exception 'workspace-selection rollback refused unexpected state'; end if;
end $$;
do $$ declare r text; begin foreach r in array array['workspace_admin_owner','workspace_context_owner'] loop
  perform set_config('votus_selection_down.'||r,pg_has_role(current_user,r,'SET')::text,true);
  if not pg_has_role(current_user,r,'SET') then execute format('grant %I to %I',r,current_user); end if;
end loop; end $$;
set role workspace_context_owner;
drop function workspace_api.switch_workspace_context(uuid,bigint);
drop function workspace_api.bootstrap_workspace_context();
drop function workspace_api.current_workspace();
drop function workspace_api.available_organizations();
drop function workspace_private.trusted_workspace_claims();
alter table workspace_private.workspace_context drop constraint workspace_context_selection_check;
alter table workspace_private.workspace_context alter organization_id set not null,
  alter membership_revision set not null,alter entitlement_revision set not null;
reset role;
set role workspace_admin_owner;
revoke select on workspace_private.organization,workspace_private.organization_membership from workspace_context_owner;
drop policy workspace_context_owner_organization_select on workspace_private.organization;
drop policy workspace_context_owner_membership_select on workspace_private.organization_membership;
reset role;
do $$ declare r text; begin foreach r in array array['workspace_context_owner','workspace_admin_owner'] loop
  if current_setting('votus_selection_down.'||r,true)='false' then execute format('revoke %I from %I',r,current_user); end if;
end loop; end $$;
commit;
