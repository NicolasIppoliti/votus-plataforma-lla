begin;
create role votus_workspace_admin_test login inherit;
grant workspace_platform_admin to votus_workspace_admin_test
  with admin false, inherit true, set false;

select plan(14);
select ok(exists(
  select 1 from pg_auth_members m join pg_roles granted on granted.oid=m.roleid
  join pg_roles member on member.oid=m.member
  where granted.rolname='workspace_platform_admin'
    and member.rolname='votus_workspace_admin_test'
    and not m.admin_option and m.inherit_option and not m.set_option)
  and (select rolcanlogin and rolinherit from pg_roles
       where rolname='votus_workspace_admin_test'),
  'temporary LOGIN caller inherits administration without SET or ADMIN');
select is((select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='workspace_private' and p.proname=any(array[
    'create_organization','disable_organization','grant_membership','revoke_membership',
    'register_section_scope','grant_section_entitlement','revoke_section_entitlement'])
  and has_function_privilege('votus_workspace_admin_test',p.oid,'EXECUTE')),7::bigint,
  'the caller reaches all seven fixed administration functions');
select is((select count(*) from unnest(array['anon','authenticated','service_role']) role_name,
  pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='workspace_private' and p.proname=any(array[
    'create_organization','disable_organization','grant_membership','revoke_membership',
    'register_section_scope','grant_section_entitlement','revoke_section_entitlement'])
  and has_function_privilege(role_name,p.oid,'EXECUTE')),0::bigint,
  'client roles cannot reach any administration function');
select ok(not has_function_privilege('votus_workspace_admin_test',
  'workspace_private.append_audit_event(text,uuid,text,text,jsonb)','EXECUTE'),
  'the caller cannot execute the audit helper');
select ok(has_function_privilege('votus_workspace_admin_test',
  'workspace_private.authorization_facts_status()','EXECUTE'),
  'the caller can reach the bounded authority status readback');
select ok(not has_table_privilege('votus_workspace_admin_test',
  'workspace_private.organization','INSERT,UPDATE,DELETE'),
  'the caller cannot perform direct organization DML');
select is((select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='workspace_private' and p.prosecdef),12::bigint,
  'all twelve private workspace functions are security definer');
select is((select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='workspace_private' and p.proconfig @>
    array['search_path=pg_catalog, workspace_private, pg_temp']),12::bigint,
  'all private functions have the fixed search path');
select is((select array_agg(r.rolname order by r.rolname) from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace join pg_roles r on r.oid=p.proowner
  where n.nspname='workspace_private'),
  array['workspace_admin_owner','workspace_admin_owner','workspace_admin_owner',
    'workspace_admin_owner','workspace_admin_owner','workspace_admin_owner',
    'workspace_admin_owner','workspace_admin_owner','workspace_audit_owner','workspace_context_owner',
    'workspace_review_ingest_owner','workspace_review_ingest_owner']::name[],
  'private function ownership is exact');
select is((select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
  where n.nspname='workspace_private' and p.proname<>'authorization_facts_status'
    and acl.privilege_type='EXECUTE'),20::bigint,
  'private functions expose only owner and intended caller execution');
select is((select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='workspace_private' and c.relkind='r' and c.relforcerowsecurity),7::bigint,
  'all seven private authority and review-scope tables force RLS');
select is((select count(*) from pg_policies where schemaname='workspace_private'
  and policyname=any(array['workspace_admin_owner_organization_select',
    'workspace_admin_owner_membership_select','workspace_admin_owner_scope_select',
    'workspace_admin_owner_entitlement_select'])),4::bigint,
  'the four parent owner SELECT policies remain present');
select is((select count(*) from pg_policies where policyname like 'workspace\_%' escape '\'),22::bigint,
  'the complete administration and context policy set is present');
select ok(not has_table_privilege('votus_workspace_admin_test','public.jurisdiction','SELECT'),
  'the caller receives no direct jurisdiction access');
select * from finish();
rollback;
