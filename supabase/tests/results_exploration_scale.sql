\set ON_ERROR_STOP on
-- Disposable high-cardinality proof; timings are local, not production claims.
begin;
-- Issue #54 production-shaped coverage proof.
insert into election (id, year, round) values
  ('30000000-0000-0000-0000-000000000001', 2025, 'legislativas'),
  ('30000000-0000-0000-0000-000000000003', 2023, 'generales'),
  ('30000000-0000-0000-0000-000000000004', 2023, 'paso'),
  ('30000000-0000-0000-0000-000000000005', 2021, 'generales'),
  -- A dimension row without official facts must not become a selectable scope.
  ('30000000-0000-0000-0000-000000000006', 2019, 'unbacked');
insert into category (id, name)
select case when category_number = 1
    then '30000000-0000-0000-0000-000000000002'::uuid
    else ('30000000-0000-0000-0002-' || lpad(category_number::text, 12, '0'))::uuid end,
  case when category_number = 1 then 'DIPUTADO NACIONAL'
    else 'SCALE CATEGORY ' || lpad(category_number::text, 2, '0') end
from generate_series(1, 15) category_number;
insert into jurisdiction (id, distrito_code, seccion_code, circuito_code,
  establecimiento_code, establecimiento_name, mesa_code)
select ('30000000-0000-0000-0001-' || lpad(unit::text, 12, '0'))::uuid,
  '02', '028', lpad(((unit - 1) % 500 + 1)::text, 5, '0'),
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
-- The exact 2025 legislativas / DIPUTADO NACIONAL / 02/027 scope stays small
-- beside the 02/028 corpus above,
-- so the public RPC and its unsupported-source audit must use bounded access paths.
insert into jurisdiction (id, distrito_code, seccion_code, circuito_code,
  establecimiento_code, establecimiento_name, mesa_code)
select ('30000000-0000-0000-0004-' || lpad(official_mesa::text, 12, '0'))::uuid,
  '02', '027',
  lpad((((official_mesa - 1) / 51) + 1)::text, 5, '0'),
  'COVERAGE-E' || lpad((((official_mesa - 1) / 17) + 1)::text, 3, '0'),
  'Coverage proof school ' || (((official_mesa - 1) / 17) + 1),
  20000 + official_mesa
from generate_series(1, 153) official_mesa;
insert into result_row (election_id, jurisdiction_id, category_id, granularity, list_id, votes,
  source_kind, archive_entry_id, source_row_index)
select '30000000-0000-0000-0000-000000000001'::uuid,
  ('30000000-0000-0000-0004-' || lpad(official_mesa::text, 12, '0'))::uuid,
  '30000000-0000-0000-0000-000000000002'::uuid, 'mesa', result_position::text,
  ((official_mesa + result_position) % 500)::integer, 'official',
  'national/2025-legislativas-coverage-proof',
  ((official_mesa - 1) * 15 + result_position)::bigint
from generate_series(1, 153) official_mesa
cross join generate_series(1, 15) result_position;
insert into result_row (election_id, jurisdiction_id, category_id, granularity, list_id, votes,
  source_kind, archive_entry_id, source_row_index)
select '30000000-0000-0000-0000-000000000001'::uuid,
  ('30000000-0000-0000-0004-' || lpad(covered_mesa::text, 12, '0'))::uuid,
  '30000000-0000-0000-0000-000000000002'::uuid, 'mesa', result_position::text,
  ((covered_mesa + result_position) % 500)::integer, 'fiscalizacion',
  'fiscalizacion/2025-legislativas-coverage-proof',
  ((covered_mesa - 1) * 15 + result_position)::bigint
from generate_series(1, 93) covered_mesa
cross join generate_series(1, 15) result_position;
-- The reported timeout occurs when the official wrapper audits a tiny geography
-- surrounded by a much larger election/category corpus. The 120k official rows
-- and 6k fiscalizacion rows above are outside 02/001; only the three rows below
-- are in scope. Temporarily admit legacy/null source kinds so the scale contract
-- also proves the IS DISTINCT FROM predicate keeps unknown-source auditing.
insert into jurisdiction (id, distrito_code, seccion_code, circuito_code,
  establecimiento_code, establecimiento_name, mesa_code) values
  ('30000000-0000-0000-0003-000000000001', '02', '001', '00001',
    'SCOPE-001', 'Selected audit scope', 1);
alter table result_row drop constraint result_row_source_kind_check;
alter table result_row alter column source_kind drop not null;
insert into result_row (election_id, jurisdiction_id, category_id, granularity, list_id, votes,
  source_kind, archive_entry_id, source_row_index) values
  ('30000000-0000-0000-0000-000000000001', '30000000-0000-0000-0003-000000000001',
    '30000000-0000-0000-0000-000000000002', 'mesa', 'selected-official', 41,
    'official', 'national/scale-selected-scope', 1),
  ('30000000-0000-0000-0000-000000000001', '30000000-0000-0000-0003-000000000001',
    '30000000-0000-0000-0000-000000000002', 'mesa', 'selected-legacy', 9,
    'legacy', 'legacy/scale-selected-scope', 1),
  ('30000000-0000-0000-0000-000000000001', '30000000-0000-0000-0003-000000000001',
    '30000000-0000-0000-0000-000000000002', 'mesa', 'selected-null', 10,
    null, 'unknown/scale-selected-scope', 1);
-- Keep the selected-scope 120k-row proof intact while making cold start discover
-- four elections and making every selected election expose fifteen categories.
-- One row per supplemental scope prevents a single-scope toy without materially
-- increasing the bounded fixture runtime.
insert into result_row (election_id, jurisdiction_id, category_id, granularity, list_id, votes,
  source_kind, archive_entry_id, source_row_index)
select election_id, '30000000-0000-0000-0001-000000000001'::uuid, category_id,
  'distrito', 'supplemental', 1, 'official', 'national/scale-facet-distribution',
  row_number() over (order by election_id, category_id)::bigint
from (values
  ('30000000-0000-0000-0000-000000000001'::uuid),
  ('30000000-0000-0000-0000-000000000003'::uuid),
  ('30000000-0000-0000-0000-000000000004'::uuid),
  ('30000000-0000-0000-0000-000000000005'::uuid)
) elections(election_id)
cross join lateral (
  select id as category_id from category where name like 'SCALE %'
) categories
where (election_id, category_id) <> (
  '30000000-0000-0000-0000-000000000001'::uuid,
  '30000000-0000-0000-0000-000000000002'::uuid
);
insert into jurisdiction(id,distrito_code,seccion_code,mesa_code) select
  ('30000000-0000-0000-0005-'||lpad(unit::text,12,'0'))::uuid,'04','001',unit from generate_series(1,2000) unit;
insert into result_row(election_id,jurisdiction_id,category_id,granularity,list_id,votes,source_kind,archive_entry_id,source_row_index)
select '30000000-0000-0000-0000-000000000001',('30000000-0000-0000-0005-'||lpad(unit::text,12,'0'))::uuid,
  '30000000-0000-0000-0000-000000000002','mesa',party::text,unit%17,'official','national/district-fast-path',unit*10+party
from generate_series(1,2000) unit cross join generate_series(1,10) party;
insert into result_row(election_id,jurisdiction_id,category_id,granularity,list_id,votes,source_kind,archive_entry_id,source_row_index)
select '30000000-0000-0000-0000-000000000003',('30000000-0000-0000-0005-'||lpad(unit::text,12,'0'))::uuid,
  '30000000-0000-0000-0000-000000000002','mesa','other-election',99,'official','national/district-wrong-election',unit
from generate_series(1,2000) unit;
commit; vacuum (analyze) jurisdiction; vacuum (analyze) result_row;
begin;
select plan(19);
create temporary table scale_plan_evidence (label text primary key,representative_result_rows bigint not null,plan jsonb not null) on commit drop;
select is((results_exploration_official('30000000-0000-0000-0000-000000000001'::uuid,
    '30000000-0000-0000-0000-000000000002'::uuid,'02','001')->>'total_votes')::bigint,
  41::bigint, 'tiny selected scope keeps official totals unchanged');
select is(results_exploration_official(
    '30000000-0000-0000-0000-000000000001'::uuid,
    '30000000-0000-0000-0000-000000000002'::uuid, '02', '001')->'source_exclusions',
  '[{"kind":"unknown","rows":2,"votes":19}]'::jsonb,
  'tiny selected scope audits legacy and null sources as unknown exclusions');
do $$ declare fast_payload jsonb; preserved_payload jsonb; selected_rows bigint; selected_shapes bigint; begin
  select results_exploration_official(election_id,category_id,'04',p_requested_level=>'distrito'),
    results_exploration_official_0029(election_id,category_id,'04',p_requested_level=>'distrito')
    into fast_payload,preserved_payload from (values ('30000000-0000-0000-0000-000000000001'::uuid,
      '30000000-0000-0000-0000-000000000002'::uuid)) ids(election_id,category_id);
  if fast_payload-'source_exclusions' is distinct from preserved_payload then
    raise exception 'large district payload differs from preserved 0029 semantics';
  end if;
      select count(*),count(distinct (rr.archive_entry_id,rr.granularity,j.distrito_code,
        j.seccion_code,e.year,e.round,c.name)) into selected_rows,selected_shapes from jurisdiction j
      cross join lateral (select rr.archive_entry_id,rr.granularity from result_row rr
        where rr.jurisdiction_id=j.id and rr.election_id='30000000-0000-0000-0000-000000000001'
          and rr.category_id='30000000-0000-0000-0000-000000000002' and rr.source_kind='official' offset 0) rr
      join election e on e.id='30000000-0000-0000-0000-000000000001'
      join category c on c.id='30000000-0000-0000-0000-000000000002' where j.distrito_code='04';
      if selected_rows<>20000 or selected_shapes<>1 then raise exception 'district facts/shapes %/% instead of 20000/1',selected_rows,selected_shapes; end if;
    end $$;
select is((select jsonb_build_object(
    'status', payload->'status',
    'source_kind', payload->'source_kind',
    'is_random_sample', payload->'is_random_sample',
    'observed_units', payload->'mesas_coverage'->'observed_units',
    'denominator_units', payload->'mesas_coverage'->'denominator_units',
    'source_kind_audit', payload->'source_audit'->0->'kind',
    'source_rows', payload->'source_audit'->0->'rows',
    'source_mesas', payload->'source_audit'->0->'mesas',
    'denominator_kind_audit', payload->'denominator_audit'->0->'kind',
    'denominator_rows', payload->'denominator_audit'->0->'rows',
    'denominator_mesas', payload->'denominator_audit'->0->'mesas',
    'school_status', payload->'escuelas'->'status',
    'school_observed_units', (select sum((school->>'observed_units')::bigint)::bigint
      from jsonb_array_elements(payload->'escuelas'->'items') school),
    'school_denominator_units', (select sum((school->>'denominator_units')::bigint)::bigint
      from jsonb_array_elements(payload->'escuelas'->'items') school),
    'exclusions', payload->'exclusions',
    'provenance', payload->'provenance')
  from (select public.results_exploration_coverage(
    '30000000-0000-0000-0000-000000000001'::uuid,
    '30000000-0000-0000-0000-000000000002'::uuid, '02', '027') payload) coverage),
  jsonb_build_object(
    'status', 'ok', 'source_kind', 'fiscalizacion', 'is_random_sample', false,
    'observed_units', 93::bigint, 'denominator_units', 153::bigint,
    'source_kind_audit', 'fiscalizacion', 'source_rows', 1395::bigint, 'source_mesas', 93::bigint,
    'denominator_kind_audit', 'official', 'denominator_rows', 2295::bigint,
    'denominator_mesas', 153::bigint, 'school_status', 'available',
    'school_observed_units', 93::bigint, 'school_denominator_units', 153::bigint,
    'exclusions', '[]'::jsonb,
    'provenance', jsonb_build_object(
      'official_archive_entry_ids', jsonb_build_array('national/2025-legislativas-coverage-proof'),
      'fiscalizacion_archive_entry_ids', jsonb_build_array('fiscalizacion/2025-legislativas-coverage-proof'))),
  'production-shaped coverage preserves counts, grouping, isolation, and provenance');
select ok((select payload->>'status' = 'ok'
    and payload ?& array['elections', 'categories', 'distritos', 'secciones', 'circuitos',
      'establecimientos', 'mesas', 'available_levels']
    and jsonb_typeof(payload->'elections') = 'array'
    and jsonb_array_length(payload->'elections') = 4
    and jsonb_array_length(payload->'categories') = 0
  from (select results_exploration_facets(null, null, null, null, null, null) payload) cold_start),
  'cold-start facets preserve the payload contract across four election scopes');
select is(results_exploration_schools('30000000-0000-0000-0000-000000000001'::uuid,
  '30000000-0000-0000-0000-000000000002'::uuid, '02', '028')->>'status',
  'ok', 'supported high-cardinality school payload reaches real aggregation');
select is(jsonb_array_length(results_exploration_schools('30000000-0000-0000-0000-000000000001'::uuid,
  '30000000-0000-0000-0000-000000000002'::uuid, '02', '028')->'schools'),
  500, 'scale payload retains exactly 500 complete schools');
select is((select sum((school->>'mesa_count')::bigint)::bigint
  from jsonb_array_elements(results_exploration_schools('30000000-0000-0000-0000-000000000001'::uuid,
    '30000000-0000-0000-0000-000000000002'::uuid, '02', '028')->'schools') school),
  12000::bigint, 'scale payload aggregates all 12000 mesas across its schools');
insert into jurisdiction (id, distrito_code, seccion_code, circuito_code, establecimiento_code, establecimiento_name, mesa_code) values
  ('30000000-0000-0000-0002-000000000001', '02', '028', '00501', 'E00501', 'Overflow school', 12001);
insert into result_row (election_id, jurisdiction_id, category_id, granularity, list_id, votes, source_kind,
  archive_entry_id, source_row_index) values
  ('30000000-0000-0000-0000-000000000001', '30000000-0000-0000-0002-000000000001', '30000000-0000-0000-0000-000000000002', 'mesa', '1', 7, 'official', 'national/scale-fixture', 120001),
  ('30000000-0000-0000-0000-000000000001', '30000000-0000-0000-0001-000000000001', '30000000-0000-0000-0000-000000000002', 'seccion', '1', 8, 'official', 'national/scale-exclusion', 120002);
select is((select jsonb_build_object('status', payload->'status', 'exclusions', payload->'exclusions',
  'source_exclusions', payload->'source_exclusions') from (select results_exploration_schools(
    '30000000-0000-0000-0000-000000000001'::uuid,
    '30000000-0000-0000-0000-000000000002'::uuid, '02', '028') payload) result),
  '{"status":"selection_invalid","exclusions":[{"reason":"official_rows_without_mesa_granularity","rows":1,"votes":8}],"source_exclusions":[{"kind":"fiscalizacion","rows":6000,"votes":6000}]}'::jsonb,
  'bounded school refusal keeps official and non-official exclusion evidence');
do $$ declare evidence jsonb; representative_result_rows constant bigint := 122295; begin
  execute $plan$explain (analyze, buffers, format json)
    select results_exploration_facets(
      '30000000-0000-0000-0000-000000000001'::uuid,
      '30000000-0000-0000-0000-000000000002'::uuid, '02', '027', null)$plan$
    into evidence;
  insert into scale_plan_evidence values ('facets_selected', representative_result_rows, evidence);
  execute $plan$explain (analyze, buffers, format json)
    select results_exploration_facets(null, null, null, null, null, null)$plan$
    into evidence;
  insert into scale_plan_evidence values ('facets_cold_start', 122357, evidence);
  execute $plan$explain (analyze, buffers, format json)
    select results_exploration_official(
      '30000000-0000-0000-0000-000000000001'::uuid,
      '30000000-0000-0000-0000-000000000002'::uuid, '02', '028')$plan$
    into evidence;
    insert into scale_plan_evidence values ('official', representative_result_rows, evidence);
        execute $plan$explain (analyze, buffers, format json) with scoped_geography as materialized
          (select id,seccion_code from jurisdiction where distrito_code='02' and seccion_code='001'),raw_rows as materialized
          (select rr.*,j.seccion_code from scoped_geography j cross join lateral (select fact.archive_entry_id,fact.granularity
            from result_row fact where fact.jurisdiction_id=j.id and fact.election_id='30000000-0000-0000-0000-000000000001'
              and fact.category_id='30000000-0000-0000-0000-000000000002' and fact.source_kind='official' offset 0) rr),
          source_shapes as materialized (select distinct archive_entry_id,granularity,seccion_code from raw_rows),normalized_shapes as materialized
          (select s.*,results_exploration_reporting_level(archive_entry_id,granularity,'02',seccion_code) effective_level from source_shapes s)
          select count(*) from raw_rows r join normalized_shapes s on (s.archive_entry_id,s.granularity,s.seccion_code)
            is not distinct from (r.archive_entry_id,r.granularity,r.seccion_code) where s.effective_level='mesa'$plan$ into evidence;
      insert into scale_plan_evidence values ('official_core_scope', 129754, evidence);
      execute $plan$explain (analyze, buffers, format json)
        select count(*)::bigint, coalesce(sum(rr.votes), 0)::bigint

    from result_row rr
    join jurisdiction j on j.id = rr.jurisdiction_id
    where rr.election_id = '30000000-0000-0000-0000-000000000001'::uuid
      and rr.category_id = '30000000-0000-0000-0000-000000000002'::uuid
      and rr.source_kind is distinct from 'official'
      and j.distrito_code = '02' and j.seccion_code = '001'$plan$
    into evidence;
      insert into scale_plan_evidence values ('official_source_exclusions', 129754, evidence);
      execute $plan$explain (analyze,buffers,format json) with target_jurisdictions as materialized
        (select id from jurisdiction where distrito_code='04') select count(*),sum(rr.votes) from target_jurisdictions j
        cross join lateral (select fact.votes from result_row fact where fact.jurisdiction_id=j.id
          and fact.election_id='30000000-0000-0000-0000-000000000001' and fact.category_id='30000000-0000-0000-0000-000000000002'
          and fact.source_kind='official' offset 0) rr$plan$ into evidence;
      insert into scale_plan_evidence values ('district_scope_access',151754,evidence);
      execute $plan$explain (analyze,buffers,format json) select results_exploration_official(
        '30000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000002','04',
        p_requested_level=>'distrito')$plan$ into evidence;
      insert into scale_plan_evidence values ('district_rpc',151754,evidence);
      execute $plan$explain (analyze, buffers, format json)
        select public.results_exploration_coverage(
      '30000000-0000-0000-0000-000000000001'::uuid,
      '30000000-0000-0000-0000-000000000002'::uuid, '02', '027')$plan$
    into evidence;
  insert into scale_plan_evidence values ('coverage_production_rpc', 129754, evidence);
  execute $plan$explain (analyze, buffers, format json)
    select count(*)::bigint, coalesce(sum(rr.votes), 0)::bigint
    from result_row rr
    join jurisdiction j on j.id = rr.jurisdiction_id
    where rr.election_id = '30000000-0000-0000-0000-000000000001'::uuid
      and rr.category_id = '30000000-0000-0000-0000-000000000002'::uuid
      and rr.source_kind is distinct from 'official'
      and rr.source_kind is distinct from 'fiscalizacion'
      and j.distrito_code = '02' and j.seccion_code = '027'$plan$
    into evidence;
  insert into scale_plan_evidence values ('coverage_unsupported_source_audit', 129754, evidence);
  execute $plan$explain (analyze, buffers, format json)
    select results_exploration_schools(
      '30000000-0000-0000-0000-000000000001'::uuid,
      '30000000-0000-0000-0000-000000000002'::uuid, '02', '028')$plan$
    into evidence;
  insert into scale_plan_evidence values ('schools', representative_result_rows, evidence);
end $$;
-- Disposable timings are not production latency claims. Keep the existing 15s
-- coverage budget and 7s cold-start budget, while bounding shared block churn.
select ok((select plan::text like '%result_row_non_official_scope_idx%'
    from scale_plan_evidence where label = 'official_source_exclusions'),
  'source exclusion audit uses the geography-selective non-official partial index');
    select ok((select label = 'official_core_scope'
        and plan::text like '%result_row_official_district_scope_idx%'
        and plan::text not like '%result_row_official_district_geography_idx%'
        and (coalesce((plan->0->'Plan'->>'Shared Hit Blocks')::bigint, 0)
          + coalesce((plan->0->'Plan'->>'Shared Read Blocks')::bigint, 0)) <= 20
        and (select district.plan::text like '%result_row_official_district_scope_idx%'
          and district.plan::text not like '%result_row_official_district_geography_idx%'
          and not jsonb_path_exists(district.plan,
            '$.** ? (@."Node Type" == "Seq Scan" && @."Relation Name" == "result_row")')
          and (district.plan->0->>'Execution Time')::numeric<=2000
          and coalesce((district.plan->0->'Plan'->>'Shared Hit Blocks')::bigint,0)
            +coalesce((district.plan->0->'Plan'->>'Shared Read Blocks')::bigint,0)<=7500
          from scale_plan_evidence district where district.label='district_scope_access')
      from scale_plan_evidence where label = 'official_core_scope'),
      'official core and district path automatically use bounded scope-first index access without a fact seq scan');

select ok((select label = 'coverage_production_rpc'
    and (plan->0->>'Execution Time')::numeric <= 15000
    and (coalesce((plan->0->'Plan'->>'Shared Hit Blocks')::bigint, 0)
      + coalesce((plan->0->'Plan'->>'Shared Read Blocks')::bigint, 0)) <= 30000
    and (plan->0->'Plan'->>'Actual Rows')::bigint = 1
    and (select (district.plan->0->>'Execution Time')::numeric<=5000
      and coalesce((district.plan->0->'Plan'->>'Shared Hit Blocks')::bigint,0)
        +coalesce((district.plan->0->'Plan'->>'Shared Read Blocks')::bigint,0)<=10000
      and (district.plan->0->'Plan'->>'Actual Rows')::bigint=1
      from scale_plan_evidence district where district.label='district_rpc')
  from scale_plan_evidence where label = 'coverage_production_rpc'),
  'production-shaped coverage and district RPCs stay within strict time and shared-block budgets');
select ok((select label = 'coverage_unsupported_source_audit'
    and plan::text like '%result_row_non_official_scope_idx%'
    and (coalesce((plan->0->'Plan'->>'Shared Hit Blocks')::bigint, 0)
      + coalesce((plan->0->'Plan'->>'Shared Read Blocks')::bigint, 0)) <= 2500
    and (plan->0->'Plan'->>'Actual Rows')::bigint = 1
  from scale_plan_evidence where label = 'coverage_unsupported_source_audit'),
  'coverage unsupported-source audit uses 0027 with a tighter shared-block budget');
select ok((select label = 'facets_cold_start'
    and (coalesce((plan->0->'Plan'->>'Shared Hit Blocks')::bigint, 0)
      + coalesce((plan->0->'Plan'->>'Shared Read Blocks')::bigint, 0)) <= 500
    and (plan->0->'Plan'->>'Actual Rows')::bigint = 1
  from scale_plan_evidence where label = 'facets_cold_start'),
  'cold-start facets bound fact-table reads while preserving source-backed elections');
select ok((plan->0->>'Execution Time')::numeric <= case
      when label = 'facets_cold_start' then 7000
      else 10000 end
    and (plan->0->'Plan'->>'Actual Rows')::bigint = 1,
  label || ' stays within its disposable plan budget and returns one payload row'
) from scale_plan_evidence
where label not in ('coverage_production_rpc', 'coverage_unsupported_source_audit',
  'district_scope_access','district_rpc')
order by label;
select diag(format(
  '%s: representative_result_rows=%s planning_ms=%s execution_ms=%s top_node=%s shared_hit_blocks=%s shared_read_blocks=%s indexes=%s',
  label, representative_result_rows, round((plan->0->>'Planning Time')::numeric, 3),
  round((plan->0->>'Execution Time')::numeric, 3), plan->0->'Plan'->>'Node Type',
  coalesce((plan->0->'Plan'->>'Shared Hit Blocks')::bigint, 0),
  coalesce((plan->0->'Plan'->>'Shared Read Blocks')::bigint, 0),
  jsonb_path_query_array(plan, '$.**."Index Name"')
)) from scale_plan_evidence order by label;
select * from finish();
rollback;
begin; delete from result_row where election_id::text like '30000000-%'; delete from jurisdiction where id::text like '30000000-%';
delete from category where id::text like '30000000-%'; delete from election where id::text like '30000000-%';
-- The legacy/null fixture rows are gone, so restore the exact 0002 source-kind contract this
-- proof relaxed. Leaving it dropped would hand every later proof in the same stack a schema
-- whose DB-level source leakage guard is disarmed.
alter table result_row alter column source_kind set not null;
alter table result_row add constraint result_row_source_kind_check
  check (source_kind in ('official', 'fiscalizacion')); commit;
