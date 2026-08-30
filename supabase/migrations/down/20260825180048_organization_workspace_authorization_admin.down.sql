begin;
do $$
declare
  functions regprocedure[]:=array[
    'workspace_private.append_audit_event(text,uuid,text,text,jsonb)'::regprocedure,'workspace_private.create_organization(text,text,text,text)'::regprocedure,
    'workspace_private.disable_organization(uuid,text,text)'::regprocedure,'workspace_private.grant_membership(uuid,uuid,text,text)'::regprocedure,
    'workspace_private.revoke_membership(uuid,uuid,text,text)'::regprocedure,'workspace_private.register_section_scope(text,text,text,text)'::regprocedure,
    'workspace_private.grant_section_entitlement(uuid,text,text,text,text)'::regprocedure,'workspace_private.revoke_section_entitlement(uuid,text,text,text,text)'::regprocedure];
  expected_policies text[]:=array['workspace_admin_owner_organization_select','workspace_admin_owner_organization_insert','workspace_admin_owner_organization_update','workspace_admin_owner_membership_select','workspace_admin_owner_membership_insert','workspace_admin_owner_membership_update','workspace_admin_owner_scope_select','workspace_admin_owner_scope_insert','workspace_admin_owner_entitlement_select','workspace_admin_owner_entitlement_insert','workspace_admin_owner_entitlement_update','workspace_audit_owner_event_select','workspace_audit_owner_event_insert','workspace_admin_owner_jurisdiction_select'];
begin
  if (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='workspace_private')<>9
     or exists(select 1 from unnest(functions) f where f is null) or exists(select 1 from pg_proc p where p.oid=any(functions) and ((p.proname='append_audit_event' and p.proowner<>'workspace_audit_owner'::regrole) or (p.proname<>'append_audit_event' and p.proowner<>'workspace_admin_owner'::regrole))) then raise exception 'workspace-admin rollback refused unexpected functions'; end if;
  if (select count(*) from pg_policy p where p.polname=any(expected_policies))<>14
     or exists(select 1 from pg_policy p join pg_class c on c.oid=p.polrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='workspace_private' and p.polname<>all(expected_policies)) then raise exception 'workspace-admin rollback refused unexpected policies'; end if;
  if (select count(*) from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where p.oid=any(functions) and a.privilege_type='EXECUTE')<>16 or exists(select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where p.oid=any(functions) and a.privilege_type='EXECUTE' and ((p.proname='append_audit_event' and a.grantee not in (p.proowner,'workspace_admin_owner'::regrole)) or (p.proname<>'append_audit_event' and a.grantee not in (p.proowner,'workspace_platform_admin'::regrole)))) then raise exception 'workspace-admin rollback refused unexpected function grants'; end if;
  if not has_table_privilege('workspace_admin_owner','public.jurisdiction','SELECT') or has_table_privilege('workspace_admin_owner','public.jurisdiction','INSERT,UPDATE,DELETE') or exists(select 1 from pg_class c cross join lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a where c.oid=any(array['workspace_private.organization'::regclass,'workspace_private.organization_membership'::regclass,'workspace_private.section_scope'::regclass,'workspace_private.organization_section_entitlement'::regclass,'workspace_private.workspace_audit_event'::regclass]) and a.grantee<>c.relowner) then raise exception 'workspace-admin rollback refused unexpected table grants'; end if;
  if exists(select 1 from pg_depend d where d.refobjid=any(functions::oid[]) and d.deptype='n') then raise exception 'workspace-admin rollback refused unexpected dependencies'; end if;
end $$;
do $$
declare admin_could_set boolean; audit_could_set boolean;
begin
  select pg_has_role(current_user,'workspace_admin_owner','SET'),pg_has_role(current_user,'workspace_audit_owner','SET') into admin_could_set,audit_could_set;
  perform set_config('votus_pr3b.workspace_admin_owner_could_set',admin_could_set::text,true),set_config('votus_pr3b.workspace_audit_owner_could_set',audit_could_set::text,true);
  if not admin_could_set then grant workspace_admin_owner to current_user; end if;
  if not audit_could_set then grant workspace_audit_owner to current_user; end if;
end $$;
drop function workspace_private.revoke_section_entitlement(uuid,text,text,text,text); drop function workspace_private.grant_section_entitlement(uuid,text,text,text,text); drop function workspace_private.register_section_scope(text,text,text,text);
drop function workspace_private.revoke_membership(uuid,uuid,text,text); drop function workspace_private.grant_membership(uuid,uuid,text,text);
drop function workspace_private.disable_organization(uuid,text,text);
drop function workspace_private.create_organization(text,text,text,text);
drop function workspace_private.append_audit_event(text,uuid,text,text,jsonb);
drop policy workspace_admin_owner_jurisdiction_select on public.jurisdiction;
revoke select on public.jurisdiction from workspace_admin_owner;
drop policy workspace_audit_owner_event_insert on workspace_private.workspace_audit_event; drop policy workspace_audit_owner_event_select on workspace_private.workspace_audit_event; drop policy workspace_admin_owner_entitlement_update on workspace_private.organization_section_entitlement; drop policy workspace_admin_owner_entitlement_insert on workspace_private.organization_section_entitlement;
drop policy workspace_admin_owner_scope_insert on workspace_private.section_scope;
drop policy workspace_admin_owner_membership_update on workspace_private.organization_membership;
drop policy workspace_admin_owner_membership_insert on workspace_private.organization_membership;
drop policy workspace_admin_owner_organization_update on workspace_private.organization;
drop policy workspace_admin_owner_organization_insert on workspace_private.organization;
do $$ begin
if current_setting('votus_pr3b.workspace_audit_owner_could_set',true)='false' then revoke workspace_audit_owner from current_user; end if;
  if current_setting('votus_pr3b.workspace_admin_owner_could_set',true)='false' then revoke workspace_admin_owner from current_user; end if;
end $$;
commit;
