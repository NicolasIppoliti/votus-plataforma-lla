\set ON_ERROR_STOP on
create temp table workspace_predecessor as
select n.nspacl::text as public_acl,
  (select jsonb_agg(jsonb_build_array(r.rolname,r.rolcanlogin,r.rolinherit,r.rolsuper,
      r.rolcreatedb,r.rolcreaterole,r.rolreplication,r.rolbypassrls,r.rolpassword)
      order by r.rolname)
   from pg_roles r where r.rolname = any(array['anon','authenticated','service_role','etl_writer',current_user])) as roles,
  (select md5(coalesce(string_agg(concat_ws(':',p.oid,n2.nspname,p.proname,
      pg_get_function_identity_arguments(p.oid),pg_get_functiondef(p.oid),p.proowner,p.prosecdef,p.proacl::text), E'\n'
      order by p.oid),''))
   from pg_proc p join pg_namespace n2 on n2.oid = p.pronamespace
   where n2.nspname !~ '^pg_' and n2.nspname <> 'information_schema') as functions,
  exists (select 1 from pg_database d
    cross join lateral aclexplode(coalesce(d.datacl,acldefault('d',d.datdba))) acl
    where d.datname=current_database() and acl.grantee=0 and acl.privilege_type='TEMPORARY') as public_temp
from pg_namespace n where n.nspname = 'public';
create temp table workspace_refusals (scenario text primary key, sqlstate text not null);
create table workspace_private.rollback_sentinel (id integer);
\set LAST_ERROR_SQLSTATE 00000
\set ON_ERROR_STOP off
\ir ../migrations/down/20260825144358_organization_workspace_expand.down.sql
\set ON_ERROR_STOP on
insert into workspace_refusals values ('state-bearing-sentinel', :'LAST_ERROR_SQLSTATE');
do $$ begin
  if (select sqlstate = '00000' from workspace_refusals where scenario = 'state-bearing-sentinel')
     or to_regclass('workspace_private.rollback_sentinel') is null
     or to_regnamespace('workspace_api') is null
     or (select count(*) from pg_roles where rolname like 'workspace\_%' escape '\') <> 8
     or (select count(*) from pg_default_acl d join pg_roles r on r.oid=d.defaclrole
         where r.rolname like 'workspace\_%' escape '\') <> 8 then
    raise exception 'sentinel rollback refusal was not atomic';
  end if;
end $$;
drop table workspace_private.rollback_sentinel;
alter default privileges for role workspace_query_owner grant execute on functions to public;
do $$ begin
  if exists (select 1 from pg_default_acl d join pg_roles r on r.oid=d.defaclrole
    where r.rolname='workspace_query_owner' and d.defaclnamespace=0 and d.defaclobjtype='f') then
    raise exception 'default ACL adversary did not mutate the selected owner row';
  end if;
end $$;
\set LAST_ERROR_SQLSTATE 00000
\set ON_ERROR_STOP off
\ir ../migrations/down/20260825144358_organization_workspace_expand.down.sql
\set ON_ERROR_STOP on
insert into workspace_refusals values ('mutated-default-acl', :'LAST_ERROR_SQLSTATE');
do $$ begin
  if (select sqlstate = '00000' from workspace_refusals where scenario = 'mutated-default-acl')
     or to_regnamespace('workspace_private') is null or to_regnamespace('workspace_api') is null
     or (select count(*) from pg_roles where rolname like 'workspace\_%' escape '\') <> 8
     or exists (select 1 from pg_default_acl d join pg_roles r on r.oid=d.defaclrole
       where r.rolname='workspace_query_owner' and d.defaclnamespace=0 and d.defaclobjtype='f')
     or (select count(*) from pg_default_acl d join pg_roles r on r.oid=d.defaclrole
       where r.rolname like 'workspace\_%' escape '\') <> 7 then
    raise exception 'default ACL rollback refusal was not atomic';
  end if;
end $$;
alter default privileges for role workspace_query_owner revoke execute on functions from public;
\ir ../migrations/down/20260825144358_organization_workspace_expand.down.sql
do $$ declare before workspace_predecessor%rowtype; begin
  select * into before from workspace_predecessor;
  if to_regnamespace('workspace_private') is not null or to_regnamespace('workspace_api') is not null
     or exists (select 1 from pg_roles where rolname like 'workspace\_%' escape '\')
     or exists (select 1 from pg_default_acl d join pg_roles r on r.oid=d.defaclrole
       where r.rolname like 'workspace\_%' escape '\')
     or (select nspacl::text from pg_namespace where nspname='public') is distinct from before.public_acl
     or (select jsonb_agg(jsonb_build_array(r.rolname,r.rolcanlogin,r.rolinherit,r.rolsuper,
          r.rolcreatedb,r.rolcreaterole,r.rolreplication,r.rolbypassrls,r.rolpassword) order by r.rolname)
         from pg_roles r where r.rolname=any(array['anon','authenticated','service_role','etl_writer',current_user]))
        is distinct from before.roles
     or (select md5(coalesce(string_agg(concat_ws(':',p.oid,n.nspname,p.proname,
          pg_get_function_identity_arguments(p.oid),pg_get_functiondef(p.oid),p.proowner,p.prosecdef,p.proacl::text),E'\n' order by p.oid),''))
         from pg_proc p join pg_namespace n on n.oid=p.pronamespace
         where n.nspname !~ '^pg_' and n.nspname <> 'information_schema') is distinct from before.functions
     or (select exists (select 1 from pg_database d
       cross join lateral aclexplode(coalesce(d.datacl,acldefault('d',d.datdba))) acl
       where d.datname=current_database() and acl.grantee=0 and acl.privilege_type='TEMPORARY'))
        is distinct from before.public_temp then
    raise exception 'exact down changed predecessor state';
  end if;
end $$;
\ir ../migrations/20260825144358_organization_workspace_expand.sql
do $$ begin
  if (select count(*) from pg_namespace n where n.nspname=any(array['workspace_private','workspace_api'])
       and pg_get_userbyid(n.nspowner)=current_user) <> 2
     or (select count(*) from pg_authid r where r.rolname like 'workspace\_%' escape '\'
       and not r.rolcanlogin and not r.rolinherit and not r.rolsuper and not r.rolcreatedb
       and not r.rolcreaterole and not r.rolreplication and not r.rolbypassrls and r.rolpassword is null) <> 8
     or exists (select 1 from pg_auth_members m join pg_roles r on r.oid in (m.roleid,m.member)
       where r.rolname like 'workspace\_%' escape '\')
         or (select count(*) from pg_default_acl d join pg_roles r on r.oid=d.defaclrole
           where r.rolname like 'workspace\_%' escape '\' and d.defaclnamespace=0 and d.defaclobjtype='f'
           and (select count(*) from aclexplode(d.defaclacl))=1 and exists
             (select 1 from aclexplode(d.defaclacl) acl where acl.grantor=d.defaclrole
              and acl.grantee=d.defaclrole and acl.privilege_type='EXECUTE' and not acl.is_grantable)) <> 8
     or (select count(*) from pg_namespace n cross join lateral aclexplode(n.nspacl) acl
       where n.nspname='workspace_private' and acl.grantee<>n.nspowner) <> 8
     or (select count(*) from pg_namespace n cross join lateral aclexplode(n.nspacl) acl
       where n.nspname='workspace_api' and acl.grantee<>n.nspowner) <> 2
     or exists (select 1 from unnest(array['workspace_private','workspace_api']) s,
       unnest(array['anon','authenticated','service_role']) r
       where has_schema_privilege(r,s,'USAGE') or has_schema_privilege(r,s,'CREATE'))
     or exists (select 1 from pg_namespace n cross join lateral aclexplode(n.nspacl) acl
       where n.nspname=any(array['workspace_private','workspace_api']) and acl.grantee=0) then
    raise exception 'exact reapply did not restore the closed workspace foundation';
  end if;
end $$;
select 'workspace-foundation-release-proof' as evidence, count(*) as refusal_count,
  array_agg(scenario order by scenario) as adversaries, 8 as restored_role_count,
  '20260825144358-down,20260825144358-up' as migration_sequence
from workspace_refusals;
