\set ON_ERROR_STOP on
SET statement_timeout='120s';
-- Disposable high-cardinality payload/parity proof; fixture state is committed by setup.
begin;
select plan(16);
select is((select jsonb_build_array(
    jsonb_path_query_first(districts, '$[*] ? (@.code == "02")'),
    jsonb_path_query_first(sections, '$[*] ? (@.code == "027")')
  ) from (select
    results_exploration_facets(
      '30000000-0000-0000-0000-000000000001',
      '30000000-0000-0000-0000-000000000002')->'distritos' as districts,
    results_exploration_facets(
      '30000000-0000-0000-0000-000000000001',
      '30000000-0000-0000-0000-000000000002', '02')->'secciones' as sections
  ) facets),
  '[{"code":"02","name":"Buenos Aires","name_status":"present","name_variant_count":1},
    {"code":"027","name":"Coronel de Marina L. Rosales","name_status":"present","name_variant_count":1}]'::jsonb,
  'production-scale fallback resolves case-only global names without changing wire fields');
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
select is((select jsonb_build_object('jurisdictions',count(distinct rr.jurisdiction_id),
    'official_rows',count(*),'sections',count(distinct j.seccion_code),
    'source_shapes',count(distinct (rr.archive_entry_id,rr.granularity,j.seccion_code)),
    'verified_mappings',(select count(*) from party_mapping where canonical_party_id='scale-canonical' and verified),
    'nonofficial_rows',(select count(*) from result_row excluded join jurisdiction excluded_j
      on excluded_j.id=excluded.jurisdiction_id where excluded.election_id=rr.election_id
      and excluded.category_id=rr.category_id and excluded.source_kind<>'official'
      and excluded_j.distrito_code='05'),'votes',sum(rr.votes)::bigint)
    from result_row rr join jurisdiction j on j.id=rr.jurisdiction_id
    where rr.election_id='30000000-0000-0000-0000-000000000001'
      and rr.category_id='30000000-0000-0000-0000-000000000002' and rr.source_kind='official'
      and j.distrito_code='05' group by rr.election_id,rr.category_id),
  '{"jurisdictions":78962,"official_rows":581400,"sections":2,"source_shapes":135,"verified_mappings":1,"nonofficial_rows":1,"votes":4651200}'::jsonb,
  'district latency fixture matches production cardinality and representative identity/audit shapes');
create temporary table production_district_evidence(
  public_payload jsonb not null,core_payload jsonb not null,
  reference_public_payload jsonb not null,reference_core_payload jsonb not null,
  public_elapsed_ms numeric not null,core_elapsed_ms numeric not null,
  reference_public_elapsed_ms numeric not null,reference_core_elapsed_ms numeric not null
) on commit drop;
do $$ declare started_at timestamptz; public_payload jsonb; core_payload jsonb;
  reference_public_payload jsonb; reference_core_payload jsonb;
  public_elapsed_ms numeric; core_elapsed_ms numeric;
  reference_public_elapsed_ms numeric; reference_core_elapsed_ms numeric; begin
  started_at:=clock_timestamp();
  reference_core_payload:=results_exploration_official_0034(
    '30000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000002','05',
    p_requested_level=>'distrito');
  reference_core_elapsed_ms:=extract(epoch from clock_timestamp()-started_at)*1000;
  started_at:=clock_timestamp();
  reference_public_payload:=results_exploration_official_wrapper_0034(
    '30000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000002','05',
    p_requested_level=>'distrito');
  reference_public_elapsed_ms:=extract(epoch from clock_timestamp()-started_at)*1000;
  started_at:=clock_timestamp();
  public_payload:=results_exploration_official('30000000-0000-0000-0000-000000000001',
    '30000000-0000-0000-0000-000000000002','05',p_requested_level=>'distrito');
  public_elapsed_ms:=extract(epoch from clock_timestamp()-started_at)*1000;
  started_at:=clock_timestamp();
  core_payload:=results_exploration_official_0035('30000000-0000-0000-0000-000000000001',
    '30000000-0000-0000-0000-000000000002','05',p_requested_level=>'distrito');
  core_elapsed_ms:=extract(epoch from clock_timestamp()-started_at)*1000;
  insert into production_district_evidence values
    (public_payload,core_payload,reference_public_payload,reference_core_payload,
      public_elapsed_ms,core_elapsed_ms,reference_public_elapsed_ms,reference_core_elapsed_ms);
end $$;
select is((select core_payload from production_district_evidence),
  (select reference_core_payload from production_district_evidence),
  '0035 district core exactly preserves the full realistic 0034 JSONB payload');
select is((select public_payload from production_district_evidence),
  (select reference_public_payload from production_district_evidence),
  'new public district wrapper exactly preserves the real 0034 public wrapper JSONB payload');
-- Only the optimized public call is latency-bounded. Neither preserved reference call is bounded:
-- they remain in the disposable fixture solely so performance cannot trade away exact parity.
select ok((select public_elapsed_ms<=3000 from production_district_evidence),
  (select format('production-shaped district RPC stays under 3000ms (public_elapsed_ms=%s)',
    round(public_elapsed_ms,1)) from production_district_evidence));
select diag(format(
  'production_district_rpc public_elapsed_ms=%s core_elapsed_ms=%s reference_public_elapsed_ms=%s reference_core_elapsed_ms=%s',
  round(public_elapsed_ms,1),round(core_elapsed_ms,1),round(reference_public_elapsed_ms,1),
  round(reference_core_elapsed_ms,1)))
from production_district_evidence;
select is(results_exploration_official_0035(
    '30000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000002','06',
    p_requested_level=>'distrito'),
  results_exploration_official_0034(
    '30000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000002','06',
    p_requested_level=>'distrito'),
  'NULL and literal chr(1) sections preserve the full reference core JSONB payload');
select is(results_exploration_official(
    '30000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000002','06',
    p_requested_level=>'distrito'),
  results_exploration_official_wrapper_0034(
    '30000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000002','06',
    p_requested_level=>'distrito'),
  'NULL and literal chr(1) sections preserve the full reference public JSONB payload');
select is((select jsonb_build_object(
    'optimized_total',(optimized->>'total_votes')::bigint,
    'optimized_rows',(optimized->'source_audit'->0->>'rows')::bigint,
    'optimized_votes',(optimized->'source_audit'->0->>'votes')::bigint,
    'reference_total',(reference->>'total_votes')::bigint)
  from (select results_exploration_official_0035(
      '30000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000002','06',
      p_requested_level=>'distrito') optimized,
    results_exploration_official_0034(
      '30000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000002','06',
      p_requested_level=>'distrito') reference) payloads),
  '{"optimized_total":24,"optimized_rows":2,"optimized_votes":24,"reference_total":24}'::jsonb,
  'NULL and literal chr(1) sections retain explicit two-row and 24-vote diagnostics');
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
    and (select array_agg(jsonb_array_length(
        results_exploration_facets(election_id,null,null,null,null,null)->'categories')
        order by election_id)
      from (values
        ('30000000-0000-0000-0000-000000000001'::uuid),
        ('30000000-0000-0000-0000-000000000003'::uuid),
        ('30000000-0000-0000-0000-000000000004'::uuid),
        ('30000000-0000-0000-0000-000000000005'::uuid)
      ) elections(election_id)) = array[15,15,15,15]
  from (select results_exploration_facets(null, null, null, null, null, null) payload) cold_start),
  'cold-start facets preserve four election scopes with fifteen categories each');
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
select * from finish();
rollback;
