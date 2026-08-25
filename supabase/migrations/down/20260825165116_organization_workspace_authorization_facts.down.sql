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
     or exists (select 1 from pg_policy where polrelid=any(facts))
     or exists (select 1 from pg_class s join pg_depend d on d.objid=s.oid where s.relkind='S' and d.refobjid=any(facts)) then
    raise exception 'authority-facts rollback refused unexpected triggers, policies, or sequences';
  end if;
  if exists (select 1 from pg_class c cross join lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) acl where c.oid=any(facts) and acl.grantee<>c.relowner) then
    raise exception 'authority-facts rollback refused unexpected table grants';
  end if;
end $$;
do $$
declare
  admin_was_member boolean;
  audit_was_member boolean;
begin
  with recursive runner_role_closure(role_oid) as (select current_user::text::regrole::oid
    union
    select edge.roleid
    from pg_auth_members edge
    join runner_role_closure inherited on inherited.role_oid = edge.member)
  select
    bool_or(role_oid = 'workspace_admin_owner'::regrole::oid),
    bool_or(role_oid = 'workspace_audit_owner'::regrole::oid)
  into admin_was_member, audit_was_member
  from runner_role_closure;
  perform set_config('votus_pr3a.workspace_admin_owner_was_member', admin_was_member::text, true);
  perform set_config('votus_pr3a.workspace_audit_owner_was_member', audit_was_member::text, true);
  if current_setting('votus_pr3a.workspace_admin_owner_was_member', true) = 'false' then
    grant workspace_admin_owner to current_user;
  end if;
  if current_setting('votus_pr3a.workspace_audit_owner_was_member', true) = 'false' then
    grant workspace_audit_owner to current_user;
  end if;
end $$;
drop table workspace_private.workspace_audit_event;
drop table workspace_private.organization_section_entitlement;
drop table workspace_private.organization_membership;
drop table workspace_private.section_scope;
drop table workspace_private.organization;
do $$
begin
  if current_setting('votus_pr3a.workspace_audit_owner_was_member', true) = 'false' then
    revoke workspace_audit_owner from current_user;
  end if;
  if current_setting('votus_pr3a.workspace_admin_owner_was_member', true) = 'false' then
    revoke workspace_admin_owner from current_user;
  end if;
end $$;
commit;
