begin;
do $$ begin
  if (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='workspace_api' and p.proname='invalidate_workspace_context')<>1
    or to_regclass('workspace_private.workspace_context') is null
    or (select count(*) from pg_policies where policyname in
      ('workspace_context_owner_context_all','workspace_context_owner_audit_insert'))<>2
  then raise exception 'workspace-context rollback refused unexpected state'; end if;
end $$;
do $$ declare r text; begin
  foreach r in array array['workspace_audit_owner','workspace_context_owner'] loop
    perform set_config('votus_context_down.'||r,pg_has_role(current_user,r,'SET')::text,true);
    if not pg_has_role(current_user,r,'SET') then execute format('grant %I to %I',r,current_user); end if;
  end loop;
end $$;
set role workspace_context_owner;
drop function workspace_api.invalidate_workspace_context();
drop table workspace_private.workspace_context;
reset role;
revoke usage on schema workspace_api from authenticated;
set role workspace_audit_owner;
revoke insert on workspace_private.workspace_audit_event from workspace_context_owner;
drop policy workspace_context_owner_audit_insert on workspace_private.workspace_audit_event;
reset role;
do $$ declare r text; begin
  foreach r in array array['workspace_context_owner','workspace_audit_owner'] loop
    if current_setting('votus_context_down.'||r,true)='false' then execute format('revoke %I from %I',r,current_user); end if;
  end loop;
end $$;
commit;
