-- rls_write_role.sql
-- access-control / D8, task 12.13: the role the ETL actually uses
-- (`etl_writer`) can INSERT/UPDATE/DELETE on every electoral table, and
-- `anon` still cannot read -- 0006_rls.sql's authenticated-read-only
-- policy and anon revoke MUST NOT be weakened by adding this write role.
--
-- Exercises real INSERT/UPDATE/DELETE (not just `has_table_privilege`)
-- against `category`, `jurisdiction`, `election` and `result_row` so a
-- passing run proves the grant AND row-level security actually let the
-- writes through (RLS is enabled with no INSERT/UPDATE/DELETE policy on
-- any of these tables -- a grant alone would still be blocked without
-- `etl_writer` also carrying `bypassrls`).
begin;

select plan(10);

-- 1-4: etl_writer can write end to end on the tables ingestion actually
-- writes through (category -> jurisdiction -> election -> result_row).
select lives_ok(
  $$
    set local role etl_writer;
    insert into category (name) values ('rls_write_role_test_category');
    reset role;
  $$,
  'etl_writer can INSERT into category'
);

select lives_ok(
  $$
    set local role etl_writer;
    insert into jurisdiction (distrito_code) values ('rls_write_role_test_distrito');
    reset role;
  $$,
  'etl_writer can INSERT into jurisdiction'
);

select lives_ok(
  $$
    set local role etl_writer;
    insert into election (year, round) values (2099, 'rls_write_role_test');
    reset role;
  $$,
  'etl_writer can INSERT into election'
);

select lives_ok(
  $$
    set local role etl_writer;
    insert into result_row (
      election_id, jurisdiction_id, category_id, granularity, list_id,
      votes, source_kind, archive_entry_id, source_row_index
    )
    select
      (select id from election where round = 'rls_write_role_test'),
      (select id from jurisdiction where distrito_code = 'rls_write_role_test_distrito'),
      (select id from category where name = 'rls_write_role_test_category'),
      'distrito', '1', 10, 'fiscalizacion', 'rls_write_role_test', 0;
    reset role;
  $$,
  'etl_writer can INSERT into result_row'
);

-- 5-6: etl_writer can UPDATE and DELETE, not just INSERT.
select lives_ok(
  $$
    set local role etl_writer;
    update result_row set votes = 20 where archive_entry_id = 'rls_write_role_test';
    reset role;
  $$,
  'etl_writer can UPDATE result_row'
);

select lives_ok(
  $$
    set local role etl_writer;
    delete from result_row where archive_entry_id = 'rls_write_role_test';
    reset role;
  $$,
  'etl_writer can DELETE from result_row'
);

-- 7: etl_writer can also read what it just wrote (SELECT is part of D8's
-- upsert-lookup pattern, e.g. `db.py::upsert_jurisdiction`'s `IS NOT
-- DISTINCT FROM` lookup).
select lives_ok(
  $$
    set local role etl_writer;
    select count(*) from jurisdiction where distrito_code = 'rls_write_role_test_distrito';
    reset role;
  $$,
  'etl_writer can SELECT from jurisdiction'
);

-- 8-9: this migration NEVER weakens 0006 -- anon stays denied, on both an
-- old table and the one this migration itself touches last.
select throws_ok(
  $$ set local role anon; select count(*) from jurisdiction $$,
  '42501',
  'permission denied for table jurisdiction',
  'anon is still denied on jurisdiction after granting etl_writer'
);

select throws_ok(
  $$ set local role anon; select count(*) from result_row $$,
  '42501',
  'permission denied for table result_row',
  'anon is still denied on result_row after granting etl_writer'
);

-- 10: task 14.1 -- a FRESH deploy must not ship a login-capable role with
-- the literal password `0009_etl_write_grants.sql` hardcoded. Exercised
-- over REAL password authentication rather than the `127.0.0.1 trust` rule
-- this project's local Docker `pg_hba.conf` uses for loopback convenience
-- (which would accept ANY password, defeating the point of this test) --
-- the docker-internal network hostname `db` is on this project's
-- `scram-sha-256` path instead, the same authentication method a real
-- deployment's network traffic would go through.
create extension if not exists dblink;

select throws_ok(
  $$
    select dblink_connect(
      'etl_writer_password_probe',
      'host=db port=5432 dbname=postgres user=etl_writer '
      'password=etl_writer_local_dev_only sslmode=disable'
    )
  $$,
  NULL,
  NULL,
  'etl_writer rejects the known literal password -- a fresh deploy ships no usable secret'
);

select * from finish();
rollback;
