-- 0009_etl_write_grants.sql
-- access-control / D8: grant DML to the role the ETL actually uses.
--
-- 0006_rls.sql's own comment claimed "writing/loading is always done by
-- the ETL through the `service_role` (or `postgres`) connection, which
-- bypasses RLS entirely and needs no grant here at all." Measured against
-- this live database, that was false on two counts:
--
--   1. `service_role` is `NOLOGIN` (`rolcanlogin = false`) in this project,
--      same as every other Supabase-managed role -- it is a PostgREST/JWT
--      claim, not a role a direct `psycopg.connect(dsn)` call can actually
--      authenticate as. No DSN naming `service_role` as its user has ever
--      been able to connect.
--   2. `etl/etl/db.py` has never connected as `service_role` at all. Every
--      write this project has ever made ran through the raw `postgres`
--      connection string (`postgresql://postgres:postgres@127.0.0.1:54322/postgres`,
--      the same DSN `supabase status` prints) -- a superuser, which bypasses
--      every grant and policy check by definition and was never an
--      intentionally chosen "ETL role" so much as a default nobody replaced.
--
-- `etl_writer` is the real fix: a dedicated, non-superuser, LOGIN role the
-- ETL can actually connect as, granted exactly DML (select/insert/update/
-- delete) on every electoral table plus `bypassrls` -- the same "writes
-- bypass RLS" property 0006's comment described, now backed by a role that
-- can really log in and really hold that grant. `authenticated` stays
-- read-only (0006, untouched) and `anon` stays revoked (0006/this
-- migration, untouched) -- this migration only ADDS `etl_writer`'s grants,
-- it narrows nothing.
--
-- The password below is a LOCAL DEVELOPMENT default only, matching this
-- project's existing `postgres`/`postgres` convention (`supabase/config.toml`,
-- never used against a real remote project in this repo). A deployed
-- environment MUST rotate it out-of-band (`alter role etl_writer with
-- password '...'`) rather than trust this migration's literal value.

do $$
begin
  if not exists (select from pg_roles where rolname = 'etl_writer') then
    create role etl_writer login password 'etl_writer_local_dev_only' bypassrls;
  end if;
end $$;

-- `create role` auto-grants the new role to its creator (`postgres`) WITH
-- ADMIN OPTION only, not WITH SET -- so `postgres` cannot `set role
-- etl_writer` (the pattern the pgTAP suite, `supabase/tests/rls_write_role.sql`,
-- needs to exercise etl_writer's grants, and the same pattern 0006 already
-- relies on for `anon`/`authenticated`) without this explicit grant.
grant etl_writer to postgres;

do $$
declare
  electoral_table text;
begin
  foreach electoral_table in array array[
    'jurisdiction', 'election', 'category', 'result_row',
    'jurisdiction_crosswalk', 'mesa_crosswalk', 'fiscalizacion_mesa_identity',
    'archive_entry', 'party_canonical', 'list_identity', 'party_mapping',
    'review_item'
  ]
  loop
    execute format(
      'grant select, insert, update, delete on table %I to etl_writer',
      electoral_table
    );
  end loop;
end $$;
