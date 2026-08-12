\set ON_ERROR_STOP on
-- Disposable high-cardinality proof; timings are local, not production claims.
begin;
select plan(8);
create temporary table scale_plan_evidence (label text primary key,
  representative_result_rows bigint not null, plan jsonb not null) on commit drop;
insert into election (id, year, round) values ('30000000-0000-0000-0000-000000000001', 2025, 'scale-fixture');
insert into category (id, name) values ('30000000-0000-0000-0000-000000000002', 'SCALE FIXTURE');
insert into jurisdiction (id, distrito_code, seccion_code, circuito_code,
  establecimiento_code, establecimiento_name, mesa_code)
select ('30000000-0000-0000-0001-' || lpad(unit::text, 12, '0'))::uuid,
  '02', '027', lpad(((unit - 1) % 500 + 1)::text, 5, '0'),
  'E' || lpad(((unit - 1) % 500 + 1)::text, 5, '0'),
  'Synthetic scale school ' || ((unit - 1) % 500 + 1), unit
from generate_series(1, 12000) unit;
insert into result_row (election_id, jurisdiction_id, category_id, granularity, list_id, votes,
  source_kind, archive_entry_id, source_row_index)
select '30000000-0000-0000-0000-000000000001'::uuid,
  ('30000000-0000-0000-0001-' || lpad(unit::text, 12, '0'))::uuid,
  '30000000-0000-0000-0000-000000000002'::uuid, 'mesa', party::text,
  ((unit + party) % 500)::integer, 'official', 'national/scale-fixture',
  ((unit - 1) * 10 + party)::bigint
from generate_series(1, 12000) unit cross join generate_series(1, 10) party;
insert into result_row (election_id, jurisdiction_id, category_id, granularity, list_id, votes,
  source_kind, archive_entry_id, source_row_index)
select '30000000-0000-0000-0000-000000000001'::uuid,
  ('30000000-0000-0000-0001-' || lpad(unit::text, 12, '0'))::uuid,
  '30000000-0000-0000-0000-000000000002'::uuid, 'mesa', null,
  1, 'fiscalizacion', 'fiscalizacion/scale-fixture', unit::bigint
from generate_series(2, 12000, 2) unit;
analyze jurisdiction;
analyze result_row;
select is(results_exploration_schools('30000000-0000-0000-0000-000000000001'::uuid,
  '30000000-0000-0000-0000-000000000002'::uuid, '02', '027')->>'status',
  'ok', 'supported high-cardinality school payload reaches real aggregation');
select is(jsonb_array_length(results_exploration_schools('30000000-0000-0000-0000-000000000001'::uuid,
  '30000000-0000-0000-0000-000000000002'::uuid, '02', '027')->'schools'),
  500, 'scale payload retains exactly 500 complete schools');
select is((select sum((school->>'mesa_count')::bigint)::bigint
  from jsonb_array_elements(results_exploration_schools('30000000-0000-0000-0000-000000000001'::uuid,
    '30000000-0000-0000-0000-000000000002'::uuid, '02', '027')->'schools') school),
  12000::bigint, 'scale payload aggregates all 12000 mesas across its schools');
insert into jurisdiction (id, distrito_code, seccion_code, circuito_code, establecimiento_code, establecimiento_name, mesa_code) values
  ('30000000-0000-0000-0002-000000000001', '02', '027', '00501', 'E00501', 'Overflow school', 12001);
insert into result_row (election_id, jurisdiction_id, category_id, granularity, list_id, votes, source_kind,
  archive_entry_id, source_row_index) values
  ('30000000-0000-0000-0000-000000000001', '30000000-0000-0000-0002-000000000001', '30000000-0000-0000-0000-000000000002', 'mesa', '1', 7, 'official', 'national/scale-fixture', 120001),
  ('30000000-0000-0000-0000-000000000001', '30000000-0000-0000-0001-000000000001', '30000000-0000-0000-0000-000000000002', 'seccion', '1', 8, 'official', 'national/scale-exclusion', 120002);
select is((select jsonb_build_object('status', payload->'status', 'exclusions', payload->'exclusions',
  'source_exclusions', payload->'source_exclusions') from (select results_exploration_schools(
    '30000000-0000-0000-0000-000000000001'::uuid,
    '30000000-0000-0000-0000-000000000002'::uuid, '02', '027') payload) result),
  '{"status":"selection_invalid","exclusions":[{"reason":"official_rows_without_mesa_granularity","rows":1,"votes":8}],"source_exclusions":[{"kind":"fiscalizacion","rows":6000,"votes":6000}]}'::jsonb,
  'bounded school refusal keeps official and non-official exclusion evidence');
do $$ declare evidence jsonb; representative_result_rows constant bigint := 120000; begin
  execute $plan$explain (analyze, buffers, format json)
    select results_exploration_facets(
      '30000000-0000-0000-0000-000000000001'::uuid,
      '30000000-0000-0000-0000-000000000002'::uuid, '02', '027', null)$plan$
    into evidence;
  insert into scale_plan_evidence values ('facets', representative_result_rows, evidence);
  execute $plan$explain (analyze, buffers, format json)
    select results_exploration_official(
      '30000000-0000-0000-0000-000000000001'::uuid,
      '30000000-0000-0000-0000-000000000002'::uuid, '02', '027')$plan$
    into evidence;
  insert into scale_plan_evidence values ('official', representative_result_rows, evidence);
  execute $plan$explain (analyze, buffers, format json)
    select results_exploration_coverage(
      '30000000-0000-0000-0000-000000000001'::uuid,
      '30000000-0000-0000-0000-000000000002'::uuid, '02', '027')$plan$
    into evidence;
  insert into scale_plan_evidence values ('coverage', representative_result_rows, evidence);
  execute $plan$explain (analyze, buffers, format json)
    select results_exploration_schools(
      '30000000-0000-0000-0000-000000000001'::uuid,
      '30000000-0000-0000-0000-000000000002'::uuid, '02', '027')$plan$
    into evidence;
  insert into scale_plan_evidence values ('schools', representative_result_rows, evidence);
end $$;
select ok((plan->0->>'Execution Time')::numeric <= case when label = 'coverage' then 15000 else 10000 end
    and (plan->0->'Plan'->>'Actual Rows')::bigint = 1,
  label || ' stays within its disposable plan budget and returns one payload row'
) from scale_plan_evidence order by label;
select diag(format(
  '%s: representative_result_rows=%s planning_ms=%s execution_ms=%s top_node=%s shared_hit_blocks=%s shared_read_blocks=%s',
  label, representative_result_rows, round((plan->0->>'Planning Time')::numeric, 3),
  round((plan->0->>'Execution Time')::numeric, 3), plan->0->'Plan'->>'Node Type',
  coalesce((plan->0->'Plan'->>'Shared Hit Blocks')::bigint, 0),
  coalesce((plan->0->'Plan'->>'Shared Read Blocks')::bigint, 0)
)) from scale_plan_evidence order by label;
select * from finish();
rollback;
