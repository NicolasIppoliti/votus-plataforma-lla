-- Runtime proof for the PR1 official explorer. Synthetic rows contain no
-- personal data and the pgTAP transaction rolls every fixture back.
begin;
select plan(30);
insert into election (id, year, round) values
  ('20000000-0000-0000-0000-000000000001', 2025, 'legislativas'),
  ('20000000-0000-0000-0000-000000000002', 2023, 'generales'),
  ('20000000-0000-0000-0000-000000000004', 2023, 'paso'),
  ('20000000-0000-0000-0000-000000000005', 2025, 'provinciales');
insert into category (id, name)
values ('20000000-0000-0000-0000-000000000003', 'DIPUTADO NACIONAL'),
  ('20000000-0000-0000-0000-000000000006', 'CONCEJALES');
insert into jurisdiction (
  id, distrito_code, seccion_code, circuito_code,
  establecimiento_code, establecimiento_name, mesa_code
) values
  ('20000000-0000-0000-0000-000000000010', '02', '027', '00001', 'E1', 'Fixture school', 1),
  ('20000000-0000-0000-0000-000000000011', '02', '027', '00001', 'E1', 'Fixture school', 2),
  ('20000000-0000-0000-0000-000000000012', '02', '027', '00002', null, null, 3),
  ('20000000-0000-0000-0000-000000000013', '03', null, null, null, null, null),
  ('20000000-0000-0000-0000-000000000014', '02', '027', null, null, null, null),
  ('20000000-0000-0000-0000-000000000015', '02', '028', '00003', 'E2', 'Other fixture school', 3);
insert into party_canonical (id, display_name)
values ('wu1-canonical', 'WU1 CANONICAL'), ('wu1-municipal', 'WU1 MUNICIPAL');
insert into party_mapping (
  year, jurisdiction, category, list_id, canonical_party_id, verified
) values
  (2025, 'national', 'DIPUTADO NACIONAL', '110', 'wu1-canonical', true),
  (2023, 'national', 'DIPUTADO NACIONAL', '135', 'wu1-canonical', true),
  (2023, 'national', 'DIPUTADO NACIONAL', '20135', 'wu1-canonical', true),
  (2023, 'coronel_rosales_municipal', 'CONCEJALES', '135', 'wu1-municipal', true);
insert into result_row (
  election_id, jurisdiction_id, category_id, granularity, list_id, votes,
  source_kind, archive_entry_id, source_row_index
) values
  ('20000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000010', '20000000-0000-0000-0000-000000000003', 'mesa', '110', 120, 'official', 'national/2025-legislativas', 1),
  ('20000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000010', '20000000-0000-0000-0000-000000000003', 'mesa', '999', 40, 'official', 'national/2025-legislativas', 2),
  ('20000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', '20000000-0000-0000-0000-000000000003', 'mesa', '110', 80, 'official', 'national/2025-legislativas', 3),
  ('20000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', '20000000-0000-0000-0000-000000000003', 'mesa', '999', 60, 'official', 'national/2025-legislativas', 4),
  ('20000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000010', '20000000-0000-0000-0000-000000000003', 'mesa', '110', 999, 'fiscalizacion', 'fiscalizacion/wu1-runtime', 5),
  ('20000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000012', '20000000-0000-0000-0000-000000000003', 'mesa', '20135', 50, 'official', 'national/2023-generales', 6),
  ('20000000-0000-0000-0000-000000000004', '20000000-0000-0000-0000-000000000012', '20000000-0000-0000-0000-000000000003', 'mesa', '135', 70, 'official', 'national/2023-paso', 7),
  ('20000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-000000000013', '20000000-0000-0000-0000-000000000003', 'distrito', '77', 23, 'official', 'pba/2025-distrito-003', 8),
  ('20000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000012', '20000000-0000-0000-0000-000000000006', 'mesa', '135', 31, 'official', 'national/2023-generales', 9),
  ('20000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-000000000014', '20000000-0000-0000-0000-000000000003', 'distrito', '78', 29, 'official', 'pba/2025-distrito-027', 10),
  ('20000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000015', '20000000-0000-0000-0000-000000000003', 'mesa', '20135', 30, 'official', 'national/2023-generales', 11);

select is(jsonb_array_length(results_exploration_facets()->'elections'), 4,
  'cold-start facets expose every official election shape');
select is(jsonb_array_length(results_exploration_facets(
  '20000000-0000-0000-0000-000000000001')->'categories'), 1,
  'election selection exposes its source-backed category');
select is((results_exploration_official(
  '20000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000003', '02', '027'
)->>'total_votes')::bigint, 300::bigint,
  'official total excludes the internal source row');
select is((select (party->>'votes')::bigint from jsonb_array_elements(
  results_exploration_official(
    '20000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000003', '02', '027'
  )->'parties') party where party->>'identity_status' = 'canonical'), 200::bigint,
  'verified canonical identity carries exact votes');
select is((select party->>'list_id' from jsonb_array_elements(
  results_exploration_official(
    '20000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000003', '02', '027'
  )->'parties') party where party->>'identity_status' = 'unmapped'), '999',
  'unmapped identity keeps its list id');
select is(results_exploration_official(
  '20000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000003', '02', '027'
)->>'source_granularity', 'mesa', 'payload names actual source granularity');
select is((results_exploration_official(
  '20000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000003', '02', '027'
)->>'mesa_count')::integer, 2, 'mesa-backed total reports its mesa count');
select is(results_exploration_official(
  '20000000-0000-0000-0000-000000000005',
  '20000000-0000-0000-0000-000000000003', '03', p_requested_level => 'distrito'
)->'mesa_count', 'null'::jsonb, 'district-only source does not fabricate a mesa count');
select is(results_exploration_official('20000000-0000-0000-0000-000000000005',
  '20000000-0000-0000-0000-000000000003', '02', '027')->>'status', 'ok',
  'normalized 02/027 PBA total is reachable as a section result');
select is((results_exploration_official('20000000-0000-0000-0000-000000000005',
  '20000000-0000-0000-0000-000000000003', '02', '027')->>'total_votes')::bigint,
  29::bigint, 'section result carries the exact PBA partido total');
select is(results_exploration_official('20000000-0000-0000-0000-000000000005',
  '20000000-0000-0000-0000-000000000003', '02', '027')->>'source_granularity',
  'seccion', 'PBA provenance and normalized lineage report section level');
select is(results_exploration_official('20000000-0000-0000-0000-000000000005',
  '20000000-0000-0000-0000-000000000003', '02', p_requested_level => 'distrito')->>'status',
  'no_rows', 'province query excludes a single partido total');
select is(results_exploration_official('20000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000003', '02', '027')->'source_audit',
  '[{"kind":"official","rows":4,"votes":300}]'::jsonb,
  'aggregate source audit is derived from every included row');
set local role authenticated;
select is(results_exploration_official('20000000-0000-0000-0000-000000000002',
  '20000000-0000-0000-0000-000000000003', '02', p_mesa_code => 3,
  p_requested_level => 'mesa')->>'status', 'selection_invalid',
  'orphan mesa cannot combine a non-global 2023 mesa id across sections');
select is(results_exploration_official('20000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000003', '02', p_circuito_code => '00001',
  p_requested_level => 'circuito')->>'status', 'selection_invalid', 'circuito requires seccion');
select is(results_exploration_official('20000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000003', '02', '027', p_establecimiento_code => 'E1',
  p_requested_level => 'establecimiento')->>'status', 'selection_invalid', 'establecimiento requires circuito');
select is(results_exploration_official('20000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000003', '02', '027', '00001', p_mesa_code => 1,
  p_requested_level => 'mesa')->>'status', 'selection_invalid', 'mesa requires establecimiento');
reset role;
select is(results_exploration_official(
  '20000000-0000-0000-0000-000000000005',
  '20000000-0000-0000-0000-000000000003', '03', '001',
  p_circuito_code => '00001', p_establecimiento_code => 'E1', p_mesa_code => 1, p_requested_level => 'mesa'
)->>'status', 'source_unavailable', 'district-only source refuses a mesa projection');
select is((results_exploration_official(
  '20000000-0000-0000-0000-000000000005',
  '20000000-0000-0000-0000-000000000003', '03', '001',
  p_circuito_code => '00001', p_establecimiento_code => 'E1', p_mesa_code => 1, p_requested_level => 'mesa'
)->'counts'->>'included_distrito_rows')::integer, 1,
  'finer-level refusal counts only the included district row');
select is(results_exploration_official(
  '20000000-0000-0000-0000-000000000002',
  '20000000-0000-0000-0000-000000000003', '02', '027',
  p_circuito_code => '00002', p_establecimiento_code => 'E1', p_requested_level => 'establecimiento'
)->>'status', 'source_unavailable', '2023 source without school identity refuses school results');
select is(results_exploration_official(
  '20000000-0000-0000-0000-000000000002',
  '20000000-0000-0000-0000-000000000003', '02', '027'
)->>'election_round', 'generales', '2023 generales keeps its exact election round');
select is(results_exploration_official(
  '20000000-0000-0000-0000-000000000004',
  '20000000-0000-0000-0000-000000000003', '02', '027'
)->>'election_round', 'paso', '2023 PASO keeps its exact election round');
select is((select party->>'canonical_party_id' from jsonb_array_elements(
  results_exploration_official('20000000-0000-0000-0000-000000000002',
    '20000000-0000-0000-0000-000000000006', '02', '027')->'parties') party),
  'wu1-municipal', 'bundled 2023 municipal category uses verified Coronel Rosales context');
select is((select party->>'canonical_party_id' from jsonb_array_elements(
  results_exploration_official('20000000-0000-0000-0000-000000000002',
    '20000000-0000-0000-0000-000000000003', '02', '027')->'parties') party),
  'wu1-canonical', 'bundled 2023 national category remains in the national context');
select is(results_exploration_official(
  '20000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000003', '02', '027')->>'source_kind',
  'official', 'success payload carries explicit official-source evidence');
select is(results_exploration_party_jurisdiction(
  'pba/2025-distrito-003', 2025, 'provinciales', 'DIPUTADO NACIONAL', '03', null), null,
  'PBA archive shape never invents municipal party identity');
select is((results_exploration_official(
  '20000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000003', '02', '999'
)->'counts'->>'selected_rows')::integer, 0, 'no-row refusal reports selected rows');
select lives_ok($$
  set local role authenticated;
  select results_exploration_facets();
  select results_exploration_official(
    '20000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000003', '02', '027');
  reset role;
$$, 'authenticated executes both official explorer RPCs');
select throws_ok($$
  set local role anon;
  select results_exploration_facets()
$$, '42501', 'permission denied for function results_exploration_facets',
  'anon cannot execute the facets RPC');
select throws_ok($$
  set local role anon;
  select results_exploration_official(
    '20000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000003', '02', '027')
$$, '42501', 'permission denied for function results_exploration_official',
  'anon cannot execute the official aggregation RPC');

select * from finish();
rollback;
