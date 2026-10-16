\set ON_ERROR_STOP on
-- The owned Supabase postgres role, like hosted postgres, has ADMIN OPTION
-- without SET on workspace_query_owner. Exercise both directions as that role.
-- This is an owned SQL proof: the gate expands includes before Docker execution.
create temporary table facet_592_metadata as
 select oid,proowner,proacl,proconfig,prosecdef,pg_get_functiondef(oid) definition
 from pg_proc where oid='workspace_api.official_facets(uuid,uuid,text,text,text,text)'::regprocedure;
do $$ begin
 if current_user<>'postgres' or pg_has_role(current_user,'workspace_query_owner','SET')
  or not exists(select 1 from pg_auth_members
   where roleid='workspace_query_owner'::regrole and member=current_user::regrole and admin_option) then
  raise exception 'migration proof requires the hosted-like postgres ADMIN-without-SET role';
 end if;
end $$;
\ir ../migrations/down/20261016000000_scope_official_facet_exclusions.down.sql
\ir ../migrations/20261016000000_scope_official_facet_exclusions.sql
do $$ begin
 if pg_has_role(current_user,'workspace_query_owner','SET')
  or to_regrole('official_facets_592_migrator') is not null then
  raise exception 'migration leaked its temporary role or SET privileges';
 end if;
 if not exists(select 1 from facet_592_metadata old join pg_proc p on p.oid=old.oid
  where (p.proowner,p.proacl,p.proconfig,p.prosecdef,pg_get_functiondef(p.oid))
   is not distinct from (old.proowner,old.proacl,old.proconfig,old.prosecdef,old.definition)) then
  raise exception 'down/reapply changed function identity, security metadata or definition';
 end if;
end $$;
drop table facet_592_metadata;
select 'official_facets ADMIN-without-SET down/reapply preserved definition, OID, owner, ACL and search_path' as evidence;
