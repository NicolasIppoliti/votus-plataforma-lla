begin;
do $$
declare facts regclass[] := array['workspace_private.organization'::regclass,'workspace_private.organization_membership'::regclass,'workspace_private.section_scope'::regclass,'workspace_private.organization_section_entitlement'::regclass,'workspace_private.workspace_audit_event'::regclass];
begin
  if (select count(*) from pg_attribute where attrelid=any(facts) and attnum>0 and not attisdropped) <> 32 then
    raise exception 'authority-facts rollback refused unexpected columns';
  end if;
  if (select count(*) from pg_constraint where conrelid=any(facts)) <> 25 then
    raise exception 'authority-facts rollback refused unexpected constraints';
  end if;
  if (select count(*) from pg_index where indrelid=any(facts)) <> 12 then
    raise exception 'authority-facts rollback refused unexpected indexes';
  end if;
  if exists (select 1 from pg_trigger where tgrelid=any(facts) and not tgisinternal)
     or (select count(*) from pg_policy where polrelid=any(facts)) <> 4
     or exists (select 1 from pg_policy where polrelid=any(facts) and polname not in ('workspace_admin_owner_organization_select','workspace_admin_owner_membership_select','workspace_admin_owner_scope_select','workspace_admin_owner_entitlement_select'))
     or exists (select 1 from pg_class s join pg_depend d on d.objid=s.oid where s.relkind='S' and d.refobjid=any(facts)) then
    raise exception 'authority-facts rollback refused unexpected triggers, policies, or sequences';
  end if;
  if exists (select 1 from pg_class c cross join lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) acl where c.oid=any(facts) and acl.grantee<>c.relowner) then
    raise exception 'authority-facts rollback refused unexpected table grants';
  end if;
end $$;
do $$
declare
admin_could_set boolean;
  audit_could_set boolean;
begin
  select pg_has_role(current_user,'workspace_admin_owner','SET'),
    pg_has_role(current_user,'workspace_audit_owner','SET')
  into admin_could_set, audit_could_set;
  perform set_config('votus_pr3a.workspace_admin_owner_could_set', admin_could_set::text, true);
  perform set_config('votus_pr3a.workspace_audit_owner_could_set', audit_could_set::text, true);
  if current_setting('votus_pr3a.workspace_admin_owner_could_set', true) = 'false' then
    grant workspace_admin_owner to current_user;
  end if;
  if current_setting('votus_pr3a.workspace_audit_owner_could_set', true) = 'false' then
    grant workspace_audit_owner to current_user;
  end if;
end $$;
drop function workspace_private.authorization_facts_status();
    drop table workspace_private.workspace_audit_event;
drop table workspace_private.organization_section_entitlement;
drop table workspace_private.organization_membership;
drop table workspace_private.section_scope;
drop table workspace_private.organization;
do $$
begin
if current_setting('votus_pr3a.workspace_audit_owner_could_set', true) = 'false' then
    revoke workspace_audit_owner from current_user;
  end if;
  if current_setting('votus_pr3a.workspace_admin_owner_could_set', true) = 'false' then
    revoke workspace_admin_owner from current_user;
  end if;
end $$;
commit;
