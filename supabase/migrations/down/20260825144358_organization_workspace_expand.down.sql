begin;
do $$
declare
  workspace_roles text[] := array[
    'workspace_bootstrap_owner', 'workspace_bootstrap_caller',
    'workspace_context_owner', 'workspace_query_owner', 'workspace_admin_owner',
    'workspace_review_ingest_owner', 'workspace_audit_owner', 'workspace_platform_admin'
  ];
  schema_name text;
  default_acl_count integer;
  default_acl_owner_count integer;
  invalid_default_acls text;
  unexpected_objects text;
begin
  select
    count(*),
    count(distinct defaults.defaclrole),
    string_agg(
      owner.rolname || ':' || defaults.defaclobjtype::text,
      ', ' order by owner.rolname, defaults.defaclobjtype
    ) filter (
      where defaults.defaclobjtype <> 'f'
        or (select count(*) from aclexplode(defaults.defaclacl)) <> 1
        or not exists (
          select 1
          from aclexplode(defaults.defaclacl) acl
          where acl.grantor = defaults.defaclrole
            and acl.grantee = defaults.defaclrole
            and acl.privilege_type = 'EXECUTE'
            and not acl.is_grantable
        )
    )
  into default_acl_count, default_acl_owner_count, invalid_default_acls
  from pg_default_acl defaults
  join pg_roles owner on owner.oid = defaults.defaclrole
  where defaults.defaclnamespace = 0
    and owner.rolname = any(workspace_roles);

  if default_acl_count <> cardinality(workspace_roles)
     or default_acl_owner_count <> cardinality(workspace_roles)
     or invalid_default_acls is not null then
    raise exception
      'workspace rollback refused default ACLs: expected one owner-only global function default per workspace role (% roles), found % rows for % roles; invalid: %',
      cardinality(workspace_roles),
      default_acl_count,
      default_acl_owner_count,
      coalesce(invalid_default_acls, 'none');
  end if;

  select string_agg(
    owner.rolname || ':' || defaults.defaclobjtype::text,
    ', ' order by owner.rolname, defaults.defaclobjtype
  )
  into invalid_default_acls
  from pg_default_acl defaults
  join pg_roles owner on owner.oid = defaults.defaclrole
  join pg_namespace namespace on namespace.oid = defaults.defaclnamespace
  where namespace.nspname = any(array['workspace_private', 'workspace_api']);

  if invalid_default_acls is not null then
    raise exception
      'workspace rollback refused default ACLs: unexpected schema-scoped entries: %',
      invalid_default_acls;
  end if;

  foreach schema_name in array array['workspace_private', 'workspace_api']
  loop
    select string_agg(
      pg_describe_object(dependency.classid, dependency.objid, dependency.objsubid),
      ', '
      order by pg_describe_object(dependency.classid, dependency.objid, dependency.objsubid)
    )
    into unexpected_objects
    from pg_depend dependency
    join pg_namespace namespace on namespace.oid = dependency.refobjid
    where dependency.refclassid = 'pg_namespace'::regclass
      and dependency.deptype = 'n'
      and dependency.classid <> 'pg_default_acl'::regclass
      and namespace.nspname = schema_name;

    if unexpected_objects is not null then
      raise exception 'workspace rollback refused objects in schema %: %',
        schema_name,
        unexpected_objects;
    end if;
  end loop;
end $$;
do $$
declare
  workspace_roles text[] := array[
    'workspace_bootstrap_owner', 'workspace_bootstrap_caller',
    'workspace_context_owner', 'workspace_query_owner', 'workspace_admin_owner',
    'workspace_review_ingest_owner', 'workspace_audit_owner', 'workspace_platform_admin'
  ];
  boundary_roles text[] := workspace_roles || array[
    'anon', 'authenticated', 'service_role', 'etl_writer', current_user::text
  ];
  owner_role text;
  membership record;
begin
  foreach owner_role in array workspace_roles
  loop
    execute format('grant %I to %I', owner_role, current_user);
    execute format(
      'alter default privileges for role %I grant execute on functions to public',
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
end $$;
revoke all on schema workspace_api from workspace_context_owner, workspace_query_owner;
revoke all on schema workspace_private from
  workspace_bootstrap_owner, workspace_bootstrap_caller,
  workspace_context_owner, workspace_query_owner, workspace_admin_owner,
  workspace_review_ingest_owner, workspace_audit_owner, workspace_platform_admin;
drop schema workspace_api;
drop schema workspace_private;
drop role workspace_bootstrap_owner;
drop role workspace_bootstrap_caller;
drop role workspace_context_owner;
drop role workspace_query_owner;
drop role workspace_admin_owner;
drop role workspace_review_ingest_owner;
drop role workspace_audit_owner;
drop role workspace_platform_admin;
commit;
