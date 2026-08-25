begin;
do $$
declare
  workspace_role text;
begin
  if exists (select 1 from pg_namespace n cross join lateral aclexplode(n.nspacl) acl
    where n.nspname = 'public' and acl.grantee = 0 and acl.privilege_type = 'CREATE') then
    raise exception 'workspace roles cannot deny CREATE inherited from PUBLIC on schema public';
  end if;
  if not exists (select 1 from pg_roles creator
    left join pg_default_acl defaults on defaults.defaclrole = creator.oid
      and defaults.defaclnamespace = 0 and defaults.defaclobjtype = 'f'
    cross join lateral aclexplode(coalesce(defaults.defaclacl, acldefault('f', creator.oid))) acl
    where creator.rolname = current_user and acl.grantee = 0 and acl.privilege_type = 'EXECUTE') then
    raise exception 'migration creator must retain the baseline PUBLIC function default';
  end if;
  foreach workspace_role in array array[
    'workspace_bootstrap_owner', 'workspace_bootstrap_caller',
    'workspace_context_owner', 'workspace_query_owner', 'workspace_admin_owner',
    'workspace_review_ingest_owner', 'workspace_audit_owner', 'workspace_platform_admin'
  ]
  loop
    if to_regrole(workspace_role) is not null then
      raise exception 'workspace foundation role already exists: %', workspace_role;
    end if;

    execute format('create role %I nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls', workspace_role);
  end loop;
end $$;
create schema workspace_private;
create schema workspace_api;
revoke all on schema workspace_private from public;
revoke all on schema workspace_api from public;
do $$
declare
  client_role text;
begin
  foreach client_role in array array['anon', 'authenticated', 'service_role']
  loop
    if to_regrole(client_role) is not null then
      execute format('revoke all on schema workspace_private from %I', client_role);
      execute format('revoke all on schema workspace_api from %I', client_role);
    end if;
  end loop;
end $$;
grant usage on schema workspace_private to
  workspace_bootstrap_owner, workspace_bootstrap_caller,
  workspace_context_owner, workspace_query_owner, workspace_admin_owner,
  workspace_review_ingest_owner, workspace_audit_owner, workspace_platform_admin;
grant usage on schema workspace_api to workspace_context_owner, workspace_query_owner;
do $$
declare
  workspace_roles text[] := array[
    'workspace_bootstrap_owner', 'workspace_bootstrap_caller',
    'workspace_context_owner', 'workspace_query_owner', 'workspace_admin_owner',
    'workspace_review_ingest_owner', 'workspace_audit_owner', 'workspace_platform_admin'
  ];
  boundary_roles text[] := workspace_roles || array[
    'anon', 'authenticated', 'service_role', current_user::text, 'etl_writer'
  ];
  owner_role text;
  membership record;
begin
  foreach owner_role in array workspace_roles
  loop
    execute format('grant %I to %I', owner_role, current_user);
    execute format('revoke create on schema public from %I', owner_role);
    execute format(
      'alter default privileges for role %I revoke execute on functions from public',
      owner_role
    );
  end loop;

  for membership in
    select granted.rolname as granted_role, member.rolname as member_role
    from pg_auth_members edge
    join pg_roles granted on granted.oid = edge.roleid
    join pg_roles member on member.oid = edge.member
    where (granted.rolname = any(workspace_roles) and member.rolname = any(boundary_roles))
       or (member.rolname = any(workspace_roles) and granted.rolname = any(boundary_roles))
  loop
    execute format('revoke %I from %I', membership.granted_role, membership.member_role);
  end loop;

  if exists (
    select 1
    from pg_auth_members edge
    join pg_roles granted on granted.oid = edge.roleid
    join pg_roles member on member.oid = edge.member
    where (granted.rolname = any(workspace_roles) and member.rolname = any(boundary_roles))
       or (member.rolname = any(workspace_roles) and granted.rolname = any(boundary_roles))
  ) then
    raise exception 'workspace role membership closure failed';
  end if;
end $$;
commit;
