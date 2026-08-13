begin;
select plan(6);
insert into election values ('20000000-0000-0000-0000-000000000001', 2025, 'scope-contract');
insert into category values ('20000000-0000-0000-0000-000000000003', 'SCOPE CONTRACT');
insert into jurisdiction (id, distrito_code, seccion_code, circuito_code,
  establecimiento_code, mesa_code) values
  ('20000000-0000-0000-0000-000000000010', '02', '027', '00001', 'E1', 1);
insert into result_row (election_id, jurisdiction_id, category_id, granularity, list_id,
  votes, source_kind, archive_entry_id, source_row_index) values
  ('20000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000010',
   '20000000-0000-0000-0000-000000000003', 'mesa', '1', 1, 'official', 'test/scope', 1);

select is(results_exploration_coverage(
  '20000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000003',
  '02', '027')->>'election_id', '20000000-0000-0000-0000-000000000001',
  'successful coverage echoes the exact requested election id');
select is(results_exploration_coverage(
  '20000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000003',
  '02', '027')->>'category_id', '20000000-0000-0000-0000-000000000003',
  'successful coverage echoes the exact requested category id');
select isnt(results_exploration_coverage(
  '20000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000003',
  '02', '999')->>'status', 'ok', 'refusal behavior remains intact');
select ok(has_function_privilege('authenticated',
  'results_exploration_coverage(uuid,uuid,text,text)', 'execute'),
  'authenticated retains coverage execution');
select ok(not has_function_privilege('anon',
  'results_exploration_coverage(uuid,uuid,text,text)', 'execute'),
  'anonymous coverage execution remains denied');
select ok(not (select prosecdef from pg_proc where oid =
  'results_exploration_coverage(uuid,uuid,text,text)'::regprocedure),
  'coverage remains security invoker');

select * from finish();
rollback;
