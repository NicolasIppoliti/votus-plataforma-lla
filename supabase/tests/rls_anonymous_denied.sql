-- rls_anonymous_denied.sql
-- access-control spec: "No anonymous read path exists" — one assertion per
-- electoral table, run under the `anon` Postgres role. Every in-scope table
-- MUST reject an anonymous SELECT outright (insufficient_privilege, SQLSTATE
-- 42501), not merely return zero rows — a table that granted `anon` a bare
-- SELECT and relied on RLS alone to filter to nothing would still be one
-- accidental permissive policy away from a leak. This suite asserts the
-- stronger, defense-in-depth property design D7/access-control actually
-- requires: no anonymous GRANT exists at all, on any of the 11 electoral
-- tables created by migrations 0001-0006.
--
-- Depends on the `pgtap` extension, enabled by migration 0006 (task 8.4) —
-- this file's own RED evidence (task 8.1) is that `pgtap` does not exist
-- before that migration runs, so this whole suite errors rather than plans
-- and finishes cleanly.
begin;

select plan(11);

-- One row per electoral table created by migrations 0001-0006 (D7 core
-- tables list in design.md's Interfaces/Contracts section), asserted in
-- migration order.
select throws_ok(
  $$ set local role anon; select count(*) from jurisdiction $$,
  '42501',
  'permission denied for table jurisdiction',
  'anon is denied on jurisdiction'
);

select throws_ok(
  $$ set local role anon; select count(*) from election $$,
  '42501',
  'permission denied for table election',
  'anon is denied on election'
);

select throws_ok(
  $$ set local role anon; select count(*) from category $$,
  '42501',
  'permission denied for table category',
  'anon is denied on category'
);

select throws_ok(
  $$ set local role anon; select count(*) from result_row $$,
  '42501',
  'permission denied for table result_row',
  'anon is denied on result_row'
);

select throws_ok(
  $$ set local role anon; select count(*) from jurisdiction_crosswalk $$,
  '42501',
  'permission denied for table jurisdiction_crosswalk',
  'anon is denied on jurisdiction_crosswalk'
);

select throws_ok(
  $$ set local role anon; select count(*) from mesa_crosswalk $$,
  '42501',
  'permission denied for table mesa_crosswalk',
  'anon is denied on mesa_crosswalk'
);

select throws_ok(
  $$ set local role anon; select count(*) from fiscalizacion_mesa_identity $$,
  '42501',
  'permission denied for table fiscalizacion_mesa_identity',
  'anon is denied on fiscalizacion_mesa_identity'
);

select throws_ok(
  $$ set local role anon; select count(*) from archive_entry $$,
  '42501',
  'permission denied for table archive_entry',
  'anon is denied on archive_entry'
);

select throws_ok(
  $$ set local role anon; select count(*) from party_canonical $$,
  '42501',
  'permission denied for table party_canonical',
  'anon is denied on party_canonical'
);

select throws_ok(
  $$ set local role anon; select count(*) from list_identity $$,
  '42501',
  'permission denied for table list_identity',
  'anon is denied on list_identity'
);

select throws_ok(
  $$ set local role anon; select count(*) from party_mapping $$,
  '42501',
  'permission denied for table party_mapping',
  'anon is denied on party_mapping'
);

select * from finish();
rollback;
