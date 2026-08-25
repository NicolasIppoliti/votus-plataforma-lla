begin;
select plan(20);
select is(
  (select count(*) from pg_namespace n
   where n.nspname = any(array['workspace_private', 'workspace_api'])
     and pg_get_userbyid(n.nspowner) = current_user),
  2::bigint,
  'workspace schemas exist and are owned by the migration owner');
select is(
  (select count(*) from (
     select c.oid from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = any(array['workspace_private', 'workspace_api'])
     union all select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = any(array['workspace_private', 'workspace_api'])
     union all select t.oid from pg_type t join pg_namespace n on n.oid = t.typnamespace
       where n.nspname = any(array['workspace_private', 'workspace_api'])
     union all select pol.oid from pg_policy pol join pg_class c on c.oid = pol.polrelid
       join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = any(array['workspace_private', 'workspace_api'])
   ) state_objects),
  0::bigint,
  'workspace schemas contain no tables, sequences, functions, types, policies, or state');
select is(
  (select array_agg(r.rolname order by r.rolname) from pg_roles r
   where r.rolname like 'workspace\_%' escape '\'),
  array['workspace_admin_owner','workspace_audit_owner','workspace_bootstrap_caller',
    'workspace_bootstrap_owner','workspace_context_owner','workspace_platform_admin',
    'workspace_query_owner','workspace_review_ingest_owner']::name[],
  'the exact eight workspace roles exist');
select is(
  (select count(*) from pg_authid r
   where r.rolname like 'workspace\_%' escape '\'
     and not r.rolcanlogin and not r.rolinherit and not r.rolsuper
     and not r.rolcreatedb and not r.rolcreaterole and not r.rolreplication
     and not r.rolbypassrls and r.rolpassword is null),
  8::bigint,
  'all workspace roles are locked and passwordless');
select is(
  (select count(*) from pg_auth_members m join pg_roles granted on granted.oid = m.roleid
   join pg_roles member on member.oid = m.member
   where granted.rolname like 'workspace\_%' escape '\'
      or member.rolname like 'workspace\_%' escape '\'),
  0::bigint,
  'workspace and boundary roles have zero memberships');
select is(
  (select array_agg(r.rolname::text || ':' || acl.privilege_type order by r.rolname, acl.privilege_type)
   from pg_namespace n cross join lateral aclexplode(n.nspacl) acl
   join pg_roles r on r.oid = acl.grantee
   where n.nspname = 'workspace_private' and acl.grantee <> n.nspowner),
  array['workspace_admin_owner:USAGE','workspace_audit_owner:USAGE',
    'workspace_bootstrap_caller:USAGE','workspace_bootstrap_owner:USAGE',
    'workspace_context_owner:USAGE','workspace_platform_admin:USAGE',
    'workspace_query_owner:USAGE','workspace_review_ingest_owner:USAGE'],
  'workspace_private has the exact intended direct USAGE ACL');
select is(
  (select array_agg(r.rolname::text || ':' || acl.privilege_type order by r.rolname, acl.privilege_type)
   from pg_namespace n cross join lateral aclexplode(n.nspacl) acl
   join pg_roles r on r.oid = acl.grantee
   where n.nspname = 'workspace_api' and acl.grantee <> n.nspowner),
  array['workspace_context_owner:USAGE','workspace_query_owner:USAGE'],
  'workspace_api has only context/query USAGE');
select ok(
  not exists (select 1 from unnest(array['workspace_private','workspace_api']) schema_name,
    unnest(array['anon','authenticated','service_role']) role_name
    where has_schema_privilege(role_name, schema_name, 'USAGE'))
  and not exists (select 1 from pg_namespace n cross join lateral aclexplode(n.nspacl) acl
    where n.nspname=any(array['workspace_private','workspace_api']) and acl.grantee=0
      and acl.privilege_type='USAGE'),
  'PUBLIC and client roles are denied workspace schema usage');
select ok(
  not exists (select 1 from unnest(array['workspace_private','workspace_api']) schema_name,
    unnest(array['anon','authenticated','service_role','workspace_bootstrap_owner',
      'workspace_bootstrap_caller','workspace_context_owner','workspace_query_owner',
      'workspace_admin_owner','workspace_review_ingest_owner','workspace_audit_owner',
      'workspace_platform_admin']) role_name
    where has_schema_privilege(role_name, schema_name, 'CREATE'))
  and not exists (select 1 from pg_namespace n cross join lateral aclexplode(n.nspacl) acl
    where n.nspname=any(array['workspace_private','workspace_api']) and acl.grantee=0
      and acl.privilege_type='CREATE'),
  'workspace, client, and PUBLIC roles cannot CREATE in workspace schemas');
select ok(
  not exists (select 1 from pg_namespace n cross join lateral aclexplode(n.nspacl) acl
    where n.nspname='public' and acl.grantee=0 and acl.privilege_type='CREATE')
  and not exists (select 1 from pg_roles r where r.rolname like 'workspace\_%' escape '\'
    and has_schema_privilege(r.rolname, 'public', 'CREATE')),
  'foundation preserves denied PUBLIC CREATE and grants no workspace CREATE on public');
select is(
  (select count(*) from pg_default_acl d join pg_roles r on r.oid = d.defaclrole
   where r.rolname like 'workspace\_%' escape '\' and d.defaclnamespace = 0
     and d.defaclobjtype = 'f'),
  8::bigint,
  'there is one global function default ACL row per workspace owner');
select is(
  (select count(*) from pg_default_acl d join pg_roles r on r.oid = d.defaclrole
   where r.rolname like 'workspace\_%' escape '\' and d.defaclnamespace = 0
     and d.defaclobjtype = 'f' and (select count(*) from aclexplode(d.defaclacl)) = 1
     and exists (select 1 from aclexplode(d.defaclacl) acl
       where acl.grantor = d.defaclrole and acl.grantee = d.defaclrole
         and acl.privilege_type = 'EXECUTE' and not acl.is_grantable)),
  8::bigint,
  'workspace function defaults are owner-only EXECUTE without grant option');
select is(
  (select count(*) from pg_default_acl d join pg_roles r on r.oid = d.defaclrole
   where r.rolname like 'workspace\_%' escape '\' and d.defaclnamespace <> 0),
  0::bigint,
  'workspace owners have no schema-scoped defaults');
select is(
  (select count(*) from pg_default_acl d join pg_roles r on r.oid = d.defaclrole
   where r.rolname like 'workspace\_%' escape '\' and d.defaclobjtype in ('r','S')),
  0::bigint,
  'workspace owners have no table or sequence defaults');
select ok(
  exists (select 1 from pg_roles creator
    left join pg_default_acl d on d.defaclrole = creator.oid and d.defaclnamespace = 0
      and d.defaclobjtype = 'f'
    cross join lateral aclexplode(coalesce(d.defaclacl, acldefault('f', creator.oid))) acl
    where creator.rolname = current_user and acl.grantee = 0
      and acl.privilege_type = 'EXECUTE'),
  'migration creator retains the observable PUBLIC function baseline');
select is(
  (select count(*) from pg_namespace auth cross join lateral aclexplode(auth.nspacl) acl
   join pg_roles r on r.oid = acl.grantee
   where auth.nspname = 'auth' and r.rolname like 'workspace\_%' escape '\'),
  0::bigint,
  'workspace roles receive no Auth schema privileges');
select is(
  (select count(*) from pg_depend dep join pg_namespace workspace on workspace.oid = dep.objid
   join pg_namespace referenced on referenced.oid = dep.refobjid
   where dep.classid = 'pg_namespace'::regclass and dep.refclassid = 'pg_namespace'::regclass
     and workspace.nspname = any(array['workspace_private','workspace_api'])
     and referenced.nspname = 'auth'),
  0::bigint,
  'workspace foundation has no Auth dependencies');
select ok(
  not has_schema_privilege('service_role', 'workspace_private', 'USAGE')
  and not has_schema_privilege('service_role', 'workspace_api', 'USAGE')
  and not pg_has_role('service_role', 'workspace_bootstrap_owner', 'MEMBER')
  and not pg_has_role('service_role', 'workspace_bootstrap_caller', 'MEMBER'),
  'service_role has no bootstrap authority');
select is(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = any(array['workspace_private','workspace_api']) or
     (n.nspname = 'public' and (p.proname like 'workspace\_%' escape '\'
       or p.proname like '%bootstrap%'))),
  0::bigint,
  'foundation adds no SECURITY DEFINER, bootstrap, API, or workspace functions'
);
select ok(exists (select 1 from pg_database d
  cross join lateral aclexplode(coalesce(d.datacl,acldefault('d',d.datdba))) acl
  where d.datname=current_database() and acl.grantee=0 and acl.privilege_type='TEMPORARY'),
  'PUBLIC TEMP remains observed and was not revoked');
select * from finish();
rollback;
