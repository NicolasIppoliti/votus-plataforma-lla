\set ON_ERROR_STOP on
begin;
\ir ../migrations/down/0023_results_coverage_scope_binding.down.sql
insert into election (id, year, round) values
  ('30000000-0000-0000-0000-000000000001', 2025, 'scope-release');
insert into category (id, name) values
  ('30000000-0000-0000-0000-000000000002', 'SCOPE RELEASE');
insert into jurisdiction (id, distrito_code, seccion_code, circuito_code,
  establecimiento_code, mesa_code) values
  ('30000000-0000-0000-0000-000000000003', '02', '027', '00001', 'E1', 1);
insert into result_row (election_id, jurisdiction_id, category_id, granularity, list_id,
  votes, source_kind, archive_entry_id, source_row_index) values
  ('30000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000003',
   '30000000-0000-0000-0000-000000000002', 'mesa', '1', 1, 'official', 'release/scope', 1);
do $$ declare payload jsonb; begin
  payload := results_exploration_coverage(
    '30000000-0000-0000-0000-000000000001',
    '30000000-0000-0000-0000-000000000002', '02', '027');
  if payload->>'status' <> 'ok' or payload ? 'election_id' or payload ? 'category_id' then
    raise exception '0023 rollback did not restore the successful 0022 payload';
  end if;
end $$;
\ir ../migrations/0023_results_coverage_scope_binding.sql
do $$ declare payload jsonb; begin
  payload := results_exploration_coverage(
    '30000000-0000-0000-0000-000000000001',
    '30000000-0000-0000-0000-000000000002', '02', '027');
  if payload->>'election_id' <> '30000000-0000-0000-0000-000000000001'
     or payload->>'category_id' <> '30000000-0000-0000-0000-000000000002' then
    raise exception '0023 reapply did not restore exact coverage scope binding';
  end if;
  if exists (select 1 from pg_proc where oid =
      'results_exploration_coverage(uuid,uuid,text,text)'::regprocedure and prosecdef) then
    raise exception 'coverage changed from security invoker';
  end if;
  if has_function_privilege('authenticated',
      'results_exploration_coverage(uuid,uuid,text,text)', 'execute') then
    raise exception 'authenticated legacy coverage execution was restored';
  end if;
  if has_function_privilege('anon',
      'results_exploration_coverage(uuid,uuid,text,text)', 'execute') then
    raise exception 'anonymous coverage execution was restored';
  end if;
end $$;
rollback;
select '0023-down,0023-up' as migration_sequence,
  'scope-bound/client-denied/security-invoker' as contract;
