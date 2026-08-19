-- Runtime proof for the PR1 official explorer. Synthetic rows contain no
-- personal data and the pgTAP transaction rolls every fixture back.
begin;
select plan(104);
insert into election (id, year, round) values
  ('20000000-0000-0000-0000-000000000001', 2025, 'legislativas'),
  ('20000000-0000-0000-0000-000000000002', 2023, 'generales'),
  ('20000000-0000-0000-0000-000000000004', 2023, 'paso'),
  ('20000000-0000-0000-0000-000000000005', 2025, 'provinciales');
insert into category (id, name)
values ('20000000-0000-0000-0000-000000000003', 'DIPUTADO NACIONAL'),
  ('20000000-0000-0000-0000-000000000006', 'CONCEJALES'),
  ('20000000-0000-0000-0000-000000000007', 'MESA IDENTITY FIXTURE');
insert into jurisdiction (
  id, distrito_code, distrito_name, seccion_code, seccion_name, circuito_code,
  circuito_name, establecimiento_code, establecimiento_name, mesa_code
) values
  ('20000000-0000-0000-0000-000000000010', '02', 'Buenos Aires', '027', 'Coronel de Marina L. Rosales', '00001', '00001', 'E1', 'Fixture school', 1),
  ('20000000-0000-0000-0000-000000000011', '02', 'Buenos Aires', '027', 'Coronel de Marina L. Rosales', '00001', '00001', 'E1', 'Fixture school', 2),
  ('20000000-0000-0000-0000-000000000012', '02', 'Buenos Aires', '027', 'Coronel de Marina L. Rosales', '00002', '00002', null, null, 3),
  ('20000000-0000-0000-0000-000000000013', '03', null, null, null, null, null, null, null, null),
  ('20000000-0000-0000-0000-000000000014', '02', 'Buenos Aires', '027', 'Coronel de Marina L. Rosales', null, null, null, null, null),
  ('20000000-0000-0000-0000-000000000015', '02', 'Buenos Aires', '028', 'Bahía Blanca', '00003', '00003', 'E2', 'Other fixture school', 3),
  ('20000000-0000-0000-0000-000000000016', '02', 'Buenos Aires', '027', 'Coronel de Marina L. Rosales', '00002', '00002', 'E1', 'Other fixture school', 4),
  ('20000000-0000-0000-0000-000000000017', '02', 'Buenos Aires', '027', 'Coronel de Marina L. Rosales', '00003', null, 'E1', 'Fixture school', 5),
  ('20000000-0000-0000-0000-000000000030', '02', 'Buenos Aires', '027', 'Coronel de Marina L. Rosales', '00004', '00004', 'E10', 'Mesa lineage A', 7),
  ('20000000-0000-0000-0000-000000000031', '02', 'Buenos Aires', '027', 'Coronel de Marina L. Rosales', '00004', '00004', 'E10', 'Mesa lineage A', 8),
  ('20000000-0000-0000-0000-000000000032', '02', 'Buenos Aires', '027', 'Coronel de Marina L. Rosales', '00004', '00004', 'E11', 'Mesa lineage B', 7),
  ('20000000-0000-0000-0000-000000000033', '02', 'Buenos Aires', '027', 'Coronel de Marina L. Rosales', '00008', '00008', 'E20', 'Shared-code lineage A', 7),
  ('20000000-0000-0000-0000-000000000034', '02', 'Buenos Aires', '027', 'Coronel de Marina L. Rosales', '00009', '00009', 'E21', 'Shared-code lineage B', 7),
  ('20000000-0000-0000-0000-000000000035', '02', 'Buenos Aires', '027', 'Coronel de Marina L. Rosales', '00010', '00010', 'E22', 'Missing mesa identity', null),
  ('20000000-0000-0000-0000-000000000027', '02', 'Buenos Aires', '999', null, '00001', '00001', 'E9', 'Fiscal-only scope', 9);
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
  ('20000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000015', '20000000-0000-0000-0000-000000000003', 'mesa', '20135', 30, 'official', 'national/2023-generales', 11),
  ('20000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000016', '20000000-0000-0000-0000-000000000003', 'mesa', '110', 30, 'official', 'national/2025-legislativas', 12),
  ('20000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000017', '20000000-0000-0000-0000-000000000003', 'mesa', '110', 20, 'official', 'national/2025-legislativas', 13),
  ('20000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000017', '20000000-0000-0000-0000-000000000003', 'mesa', '110', 777, 'fiscalizacion', 'fiscalizacion/wu1-runtime', 14),
  ('20000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000030', '20000000-0000-0000-0000-000000000006', 'mesa', '135', 10, 'official', 'national/2025-mesa-lineage', 15),
  ('20000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000031', '20000000-0000-0000-0000-000000000006', 'mesa', '135', 20, 'official', 'national/2025-mesa-lineage', 16),
  ('20000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000032', '20000000-0000-0000-0000-000000000006', 'mesa', '135', 30, 'official', 'national/2025-mesa-lineage', 17),
  ('20000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-000000000033', '20000000-0000-0000-0000-000000000007', 'mesa', 'A', 11, 'official', 'national/2025-mesa-identity', 18),
  ('20000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-000000000033', '20000000-0000-0000-0000-000000000007', 'mesa', 'B', 12, 'official', 'national/2025-mesa-identity', 19),
  ('20000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-000000000034', '20000000-0000-0000-0000-000000000007', 'mesa', 'A', 13, 'official', 'national/2025-mesa-identity', 20),
  ('20000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-000000000034', '20000000-0000-0000-0000-000000000007', 'mesa', 'B', 14, 'official', 'national/2025-mesa-identity', 21),
  ('20000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-000000000035', '20000000-0000-0000-0000-000000000007', 'mesa', 'A', 15, 'official', 'national/2025-mesa-identity', 22),
  ('20000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000027', '20000000-0000-0000-0000-000000000003', 'mesa', null, 91, 'fiscalizacion', 'fiscalizacion/only-runtime', 23);
create function pg_temp.schools(p_election uuid default '20000000-0000-0000-0000-000000000001')
returns jsonb language sql stable as $$ select results_exploration_schools(p_election,
  '20000000-0000-0000-0000-000000000003', '02', '027') $$;
create function pg_temp.coverage() returns jsonb language sql stable as $$
  select results_exploration_coverage('20000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000003', '02', '027') $$;

select is(jsonb_array_length(results_exploration_facets()->'elections'), 4,
  'cold-start facets expose every official election shape');
select is(jsonb_array_length(results_exploration_facets(
  '20000000-0000-0000-0000-000000000001')->'categories'), 2,
  'election selection exposes its source-backed categories');
select is(results_exploration_facets(
  '20000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000003'
)->'distritos',
  '[{"code":"02","name":"Buenos Aires","name_status":"present","name_variant_count":1}]'::jsonb,
  'district facets expose the normalized code and exact authoritative name');
select is(results_exploration_facets(
  '20000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000003', '02'
)->'secciones',
  '[{"code":"027","name":"Coronel de Marina L. Rosales","name_status":"present","name_variant_count":1}]'::jsonb,
  'section facets expose the normalized code and exact authoritative name');
select is(results_exploration_facets(
  '20000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000003', '02', '027'
)->'circuitos',
  '[{"code":"00001","name":"00001","name_status":"present","name_variant_count":1},
    {"code":"00002","name":"00002","name_status":"present","name_variant_count":1},
    {"code":"00003","name":null,"name_status":"missing","name_variant_count":0}]'::jsonb,
  'circuit facets preserve code-like authoritative names and isolate a missing name');
select is(results_exploration_facets(
  '20000000-0000-0000-0000-000000000005',
  '20000000-0000-0000-0000-000000000003'
)->'distritos',
  '[{"code":"02","name":"Buenos Aires","name_status":"present","name_variant_count":1},
    {"code":"03","name":null,"name_status":"missing","name_variant_count":0}]'::jsonb,
  'a missing district name does not contaminate the named district option');
select is(results_exploration_facets(
  '20000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000003', '02', '027'
)->'establecimientos', '[]'::jsonb,
  'establishment facets stay empty until a circuit is selected');
select ok(not (results_exploration_facets(
  '20000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000003', '02', '027'
)->'available_levels' ? 'establecimiento'),
  'establishment level stays unavailable until a circuit is selected');
select is(results_exploration_facets(
  '20000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000003', '02', '027', '00001'
)->'establecimientos', '[{"code":"E1","name":"Fixture school","name_status":"present","name_variant_count":1}]'::jsonb,
  'selected circuit exposes only its establishment identity and name');
select is(results_exploration_facets(
  '20000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000003', '02', '027', '00002'
)->'establecimientos', '[{"code":"E1","name":"Other fixture school","name_status":"present","name_variant_count":1}]'::jsonb,
  'same establishment code in another circuit keeps its own name');
select is(results_exploration_facets(
  '20000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000006', '02', '027', '00004'
)->'mesas', '[]'::jsonb,
  'mesa facets stay empty until an establishment is selected');
select ok(not (results_exploration_facets(
  '20000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000006', '02', '027', '00004'
)->'available_levels' ? 'mesa'),
  'mesa level stays unavailable until an establishment is selected');
select is(results_exploration_facets(
  '20000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000006', '02', '027', '00004', 'E10'
)->'mesas', '[{"code":7},{"code":8}]'::jsonb,
  'mesa facets include only the selected establishment lineage');
select is(results_exploration_facets(
  '20000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000006', '02', '027', '00004', 'E11'
)->'mesas', '[{"code":7}]'::jsonb,
  'a shared mesa code in another establishment cannot pull sibling mesas');
savepoint conflicting_facet_name;
update jurisdiction set
  establecimiento_name = case id
    when '20000000-0000-0000-0000-000000000010' then 'Fixture school north'
    when '20000000-0000-0000-0000-000000000011' then 'Fixture school south'
    else establecimiento_name end,
  circuito_name = case id
    when '20000000-0000-0000-0000-000000000011' then '00001 variant'
    else circuito_name end
where id in (
  '20000000-0000-0000-0000-000000000010',
  '20000000-0000-0000-0000-000000000011'
);
select is(results_exploration_facets(
  '20000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000003', '02', '027'
)->'circuitos',
  '[{"code":"00001","name":null,"name_status":"conflict","name_variant_count":2},
    {"code":"00002","name":"00002","name_status":"present","name_variant_count":1},
    {"code":"00003","name":null,"name_status":"missing","name_variant_count":0}]'::jsonb,
  'one conflicting circuit name does not contaminate present or missing sibling options');
select is(results_exploration_facets(
  '20000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000003', '02', '027', '00001'
)->'establecimientos', '[{"code":"E1","name":null,"name_status":"conflict","name_variant_count":2}]'::jsonb,
  'conflicting facet names expose their exact variant count without picking a label');
rollback to savepoint conflicting_facet_name;

select is((results_exploration_official(
  '20000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000003', '02', '027'
)->>'total_votes')::bigint, 350::bigint,
  'official total excludes the internal source row');
select is(results_exploration_official_0030('20000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000003','02','027'),
  results_exploration_official_0029('20000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000003','02','027'),
  '0030 delegates every non-district payload to the unchanged 0029 core');
select is(results_exploration_official('20000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000003','02',p_requested_level=>'distrito')-'source_exclusions',
  results_exploration_official_0029('20000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000003','02',p_requested_level=>'distrito'),
  'district fast path preserves mapped, unmapped, archive, mesa identity, audit, shares, and totals');
select ok(jsonb_build_array(public_payload-'source_exclusions',fast_payload)=jsonb_build_array(preserved_payload,preserved_payload)
  and preserved_payload->>'status'='selection_invalid' and preserved_payload->'counts'->>'missing_selector'='1',
  'missing required selector delegates to 0029 without no_rows: '||label) from (values
  ('election',null::uuid,'20000000-0000-0000-0000-000000000003'::uuid,'02'::text),('category','20000000-0000-0000-0000-000000000001',null,'02'),
  ('distrito','20000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000003',null)) cases(label,election_id,category_id,distrito)
cross join lateral (select results_exploration_official(election_id,category_id,distrito) public_payload,results_exploration_official_0030(election_id,category_id,distrito) fast_payload,
  results_exploration_official_0029(election_id,category_id,distrito) preserved_payload) payloads;
select ok(public_payload-'source_exclusions'=core_payload and core_payload=jsonb_build_object('status',status,
  'reason',reason,'counts',counts) and not (public_payload ?| figures) and not (core_payload ?| figures),
  'dimension validation and core/public parity: '||label) from (values
('unknown election district','20000000-0000-0000-0000-000000000090'::uuid,'20000000-0000-0000-0000-000000000003'::uuid,'distrito','selection_invalid','unknown election_id',jsonb_build_object('unknown_election_id',1)),
('unknown category district','20000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000091','distrito','selection_invalid','unknown category_id',jsonb_build_object('unknown_category_id',1)),
('both unknown district','20000000-0000-0000-0000-000000000090','20000000-0000-0000-0000-000000000091','distrito','selection_invalid','unknown election_id and category_id',jsonb_build_object('unknown_election_id',1,'unknown_category_id',1)),
('unknown election delegated section','20000000-0000-0000-0000-000000000090','20000000-0000-0000-0000-000000000003','seccion','selection_invalid','unknown election_id',jsonb_build_object('unknown_election_id',1)),
('valid empty district','20000000-0000-0000-0000-000000000005','20000000-0000-0000-0000-000000000007','distrito','no_rows','no official rows exist for the selected scope',jsonb_build_object('selected_rows',0,'requested_level_distrito',0)))
cases(label,election_id,category_id,requested_level,status,reason,counts) cross join lateral (select
  results_exploration_official(election_id,category_id,'99',p_requested_level=>requested_level) public_payload,
  results_exploration_official_0030(election_id,category_id,'99',p_requested_level=>requested_level) core_payload) payloads
cross join lateral (select array['total_votes','parties','source_audit','archive_entry_ids','mesa_count'] figures) evidence;
savepoint district_fast_path_edges;
insert into jurisdiction(id,distrito_code) values ('20000000-0000-0000-0000-000000000036','02'),('20000000-0000-0000-0000-000000000037','04');
insert into result_row(election_id,jurisdiction_id,category_id,granularity,list_id,votes,source_kind,archive_entry_id,source_row_index) values
('20000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000036','20000000-0000-0000-0000-000000000003','distrito','mixed',1,'official','national/mixed',26),
('20000000-0000-0000-0000-000000000005','20000000-0000-0000-0000-000000000037','20000000-0000-0000-0000-000000000007','distrito','zero',0,'official','national/zero',27);
select is(results_exploration_official(election_id,category_id,distrito,p_requested_level=>'distrito')-
    'source_exclusions',results_exploration_official_0029(election_id,category_id,distrito,
    p_requested_level=>'distrito'),'district edge payload matches 0029: '||label) from (values
  ('mixed','20000000-0000-0000-0000-000000000001'::uuid,'20000000-0000-0000-0000-000000000003'::uuid,'02'),
  ('district source','20000000-0000-0000-0000-000000000005'::uuid,'20000000-0000-0000-0000-000000000003'::uuid,'03'),
  ('zero votes','20000000-0000-0000-0000-000000000005'::uuid,'20000000-0000-0000-0000-000000000007'::uuid,'04'),
  ('no rows','20000000-0000-0000-0000-000000000005'::uuid,'20000000-0000-0000-0000-000000000007'::uuid,'99')
) cases(label,election_id,category_id,distrito);
rollback to savepoint district_fast_path_edges;
select is((select (party->>'votes')::bigint from jsonb_array_elements(
  results_exploration_official(
    '20000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000003', '02', '027'
  )->'parties') party where party->>'identity_status' = 'canonical'), 250::bigint,
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
select is(results_exploration_official(
  '20000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000003', '02', '027')->'source_exclusions',
  '[{"kind":"fiscalizacion","rows":2,"votes":1776}]'::jsonb,
  'official aggregate audits every scoped row excluded by source kind');
select is(results_exploration_official(
  '20000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000003', '02', '999')->>'status', 'no_rows',
  'a scope without official rows preserves the underlying refusal');
select is(results_exploration_official(
  '20000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000003', '02', '999')->'source_exclusions',
  '[{"kind":"fiscalizacion","rows":1,"votes":91}]'::jsonb,
  'a fiscal-only refused scope carries source exclusion evidence');
select is((results_exploration_official(
  '20000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000003', '02', '027'
)->>'mesa_count')::integer, 4, 'mesa-backed total reports its mesa count');
select is((select jsonb_build_object('status',payload->'status','reason',payload->'reason','exclusions',payload->'exclusions',
  'has_figures',payload ?| array['total_votes','parties','source_audit','archive_entry_ids','mesa_count']) from (select
  results_exploration_official('20000000-0000-0000-0000-000000000005','20000000-0000-0000-0000-000000000007','02',p_requested_level=>'distrito') payload) result),
  '{"status":"source_unavailable","reason":"official rows excluded from distrito aggregation","exclusions":[{"reason":"official_rows_without_mesa_code","rows":1,"votes":15}],"has_figures":false}'::jsonb,
  'district aggregation refuses mesa rows without identity and audits exact rows and votes');
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
select is((select jsonb_build_object('status',payload->'status','reason',payload->'reason','exclusions',payload->'exclusions',
  'has_figures',payload ?| array['total_votes','parties','source_audit','archive_entry_ids','mesa_count']) from (select
  results_exploration_official('20000000-0000-0000-0000-000000000005','20000000-0000-0000-0000-000000000003','02',p_requested_level=>'distrito') payload) result),
  '{"status":"source_unavailable","reason":"official rows excluded from distrito aggregation","exclusions":[{"reason":"pba_partido_rows_not_province_aggregate","rows":1,"votes":29}],"has_figures":false}'::jsonb,
  'province query refuses PBA partido rows with exact excluded rows and votes, without figures');
savepoint combined_district_exclusions; insert into result_row(election_id,jurisdiction_id,category_id,granularity,list_id,votes,source_kind,archive_entry_id,source_row_index) values
('20000000-0000-0000-0000-000000000005','20000000-0000-0000-0000-000000000014','20000000-0000-0000-0000-000000000007','distrito','PBA',17,'official','pba/2025-distrito-027',28);
select is((select jsonb_build_object('status',payload->'status','exclusions',payload->'exclusions','has_figures',payload ?| array['total_votes','parties','source_audit','archive_entry_ids','mesa_count']) from (select
  results_exploration_official('20000000-0000-0000-0000-000000000005','20000000-0000-0000-0000-000000000007','02',p_requested_level=>'distrito') payload) result),
  '{"status":"source_unavailable","exclusions":[{"reason":"official_rows_without_mesa_code","rows":1,"votes":15},{"reason":"pba_partido_rows_not_province_aggregate","rows":1,"votes":17}],"has_figures":false}'::jsonb,
  'district refusal independently audits PBA partido and missing-mesa exclusions'); rollback to savepoint combined_district_exclusions;
select is(results_exploration_official('20000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000003', '02', '027')->'source_audit',
  '[{"kind":"official","rows":6,"votes":350}]'::jsonb,
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
  set local role authenticated; select results_exploration_official_0020('20000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000003', '02', '027')
$$, '42501', 'permission denied for function results_exploration_official_0020',
  'authenticated cannot bypass source exclusions through the internal RPC');
reset role;
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

select is(jsonb_array_length(pg_temp.schools()->'schools'), 3,
  'same establishment code across circuits remains three schools');
select is((select school->>'total_votes' from jsonb_array_elements(pg_temp.schools()->'schools') school
  where school->>'circuito_code' = '00001'), '300', 'school total sums its two mesas only');
select is((select school->>'mesa_count' from jsonb_array_elements(pg_temp.schools()->'schools') school
  where school->>'circuito_code' = '00001'), '2', 'school reports its exact mesa count');
select is((select party->>'votes' from jsonb_array_elements((select school->'parties'
  from jsonb_array_elements(pg_temp.schools()->'schools') school
  where school->>'circuito_code' = '00001')) party
  where party->>'canonical_party_id' = 'wu1-canonical'), '200',
  'school breakdown carries canonical-party votes');
select is(pg_temp.schools()->'source_audit',
  '[{"kind":"official","rows":6,"votes":350}]'::jsonb,
  'school source audit is derived from every included row');
select is(pg_temp.schools()->'source_exclusions',
  '[{"kind":"fiscalizacion","rows":2,"votes":1776}]'::jsonb,
  'school aggregate independently audits every non-official source row');
savepoint school_unknown_source_kind;
alter table result_row drop constraint result_row_source_kind_check; alter table result_row alter column source_kind drop not null;
insert into result_row (election_id, jurisdiction_id, category_id, granularity, list_id,
  votes, source_kind, archive_entry_id, source_row_index) values
  (
  '20000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000010',
  '20000000-0000-0000-0000-000000000003', 'mesa', null, 9, 'unexpected', 'other/runtime', 24),
  ('20000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000010',
  '20000000-0000-0000-0000-000000000003', 'mesa', null, 10, null, 'other/runtime', 25);
select is(results_exploration_official('20000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000003', '02', '027')->'source_exclusions',
  '[{"kind":"fiscalizacion","rows":2,"votes":1776},{"kind":"unknown","rows":2,"votes":19}]'::jsonb,
  'official wrapper classifies null and unsupported source kinds as unknown exclusions');
select is((select jsonb_build_object('source_exclusions', payload->'source_exclusions',
  'source_audit', payload->'source_audit', 'school_votes', (select sum((school->>'total_votes')::bigint)
    from jsonb_array_elements(payload->'schools') school)) from (select pg_temp.schools() payload) result),
    '{"source_exclusions":[{"kind":"fiscalizacion","rows":2,"votes":1776},
    {"kind":"unknown","rows":2,"votes":19}],"source_audit":[{"kind":"official","rows":6,"votes":350}],
    "school_votes":350}'::jsonb, 'null and unsupported school sources map to unknown without changing official totals');
update jurisdiction set establecimiento_name = 'Conflicting school name'
where id = '20000000-0000-0000-0000-000000000011';
select is((select jsonb_build_object('status', payload->'status', 'source_exclusions', payload->'source_exclusions')
  from (select pg_temp.schools() payload) result), '{"status":"selection_invalid","source_exclusions":[
    {"kind":"fiscalizacion","rows":2,"votes":1776},{"kind":"unknown","rows":2,"votes":19}]}'::jsonb,
  'school refusal preserves null and unsupported source exclusion accounting');
rollback to savepoint school_unknown_source_kind;
select is((select school->>'total_votes' from jsonb_array_elements(pg_temp.schools()->'schools') school
  where school->>'circuito_code' = '00003'), '20',
  'school totals independently exclude co-located fiscalizacion rows');
savepoint school_missing_circuit;
insert into jurisdiction (
  id, distrito_code, seccion_code, circuito_code,
  establecimiento_code, establecimiento_name, mesa_code
) values (
  '20000000-0000-0000-0000-000000000018', '02', '027', null,
  'E-MISSING-CIRCUIT', 'Incomplete fixture school', 6
), (
  '20000000-0000-0000-0000-000000000021', '02', '027', '00004',
  null, null, 7
), (
  '20000000-0000-0000-0000-000000000022', '02', '027', null,
  null, null, 8
);
insert into result_row (
  election_id, jurisdiction_id, category_id, granularity, list_id, votes,
  source_kind, archive_entry_id, source_row_index
) values
  ('20000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000018',
    '20000000-0000-0000-0000-000000000003', 'mesa', '110', 25, 'official',
    'national/2025-legislativas', 15),
  ('20000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000018',
    '20000000-0000-0000-0000-000000000003', 'mesa', '999', 75, 'official',
    'national/2025-legislativas', 16),
  ('20000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000021',
    '20000000-0000-0000-0000-000000000003', 'mesa', '110', 40, 'official',
    'national/2025-legislativas', 17),
  ('20000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000022',
    '20000000-0000-0000-0000-000000000003', 'mesa', '110', 60, 'official',
    'national/2025-legislativas', 18);
select is((select jsonb_build_object('schools', jsonb_array_length(payload->'schools'), 'exclusions', payload->'exclusions', 'audit', payload->'source_audit') from (select pg_temp.schools() payload) result),
  '{"schools":3,"exclusions":[{"reason":"official_rows_without_circuito_and_establecimiento_code","rows":1,"votes":60},{"reason":"official_rows_without_circuito_code","rows":2,"votes":100},{"reason":"official_rows_without_establecimiento_code","rows":1,"votes":40}],"audit":[{"kind":"official","rows":6,"votes":350}]}'::jsonb,
  'school items, exclusions and included audit independently account for incomplete identities');
select is((select jsonb_build_object('schools', jsonb_array_length(payload->'escuelas'->'items'), 'exclusions', payload->'escuelas'->'exclusions', 'school_observed', (select sum((school->>'observed_units')::integer) from jsonb_array_elements(payload->'escuelas'->'items') school), 'school_denominator', (select sum((school->>'denominator_units')::integer) from jsonb_array_elements(payload->'escuelas'->'items') school), 'coverage', payload->'mesas_coverage', 'audit', payload->'denominator_audit') from (select pg_temp.coverage() payload) result),
  '{"schools":3,"exclusions":[{"reason":"official_rows_without_circuito_and_establecimiento_code","rows":1,"votes":60},{"reason":"official_rows_without_circuito_code","rows":2,"votes":100},{"reason":"official_rows_without_establecimiento_code","rows":1,"votes":40}],"school_observed":2,"school_denominator":4,"coverage":{"observed_units":2,"denominator_units":7,"is_random_sample":false},"audit":[{"kind":"official","rows":10,"votes":550,"mesas":7}]}'::jsonb,
  'coverage keeps complete schools and all valid mesas while auditing school exclusions');
rollback to savepoint school_missing_circuit;
savepoint broad_scope_exclusions;
insert into jurisdiction (id, distrito_code, seccion_code, circuito_code,
  establecimiento_code, establecimiento_name, mesa_code) values
  ('20000000-0000-0000-0000-000000000028', '02', '027', '00007',
    'E-WITHOUT-MESA', 'Broad scope fixture', null);
insert into result_row (election_id, jurisdiction_id, category_id, granularity, list_id,
  votes, source_kind, archive_entry_id, source_row_index) values
  ('20000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000010',
    '20000000-0000-0000-0000-000000000003', 'seccion', '110', 61, 'official',
    'national/2025-broad-scope', 25),
  ('20000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000028',
    '20000000-0000-0000-0000-000000000003', 'mesa', '110', 62, 'official',
    'national/2025-broad-scope', 26),
  ('20000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000010',
    '20000000-0000-0000-0000-000000000003', 'seccion', null, 63, 'fiscalizacion',
    'fiscalizacion/coarser-runtime', 27);
select is((select jsonb_build_object('exclusions', payload->'exclusions',
  'coverage', payload->'mesas_coverage', 'audit', payload->'denominator_audit')
  from (select pg_temp.coverage() payload) result),
  '{"exclusions":[{"reason":"fiscalizacion_rows_without_mesa_granularity","rows":1,"votes":63},
    {"reason":"official_rows_without_mesa_granularity","rows":1,"votes":61},
    {"reason":"official_rows_without_mesa_identity","rows":1,"votes":62}],
    "coverage":{"observed_units":2,"denominator_units":4,"is_random_sample":false},
    "audit":[{"kind":"official","rows":6,"votes":350,"mesas":4}]}'::jsonb,
  'coverage classifies broad official rows before retaining only valid mesas');
select is((select jsonb_build_object('exclusions', payload->'exclusions',
  'source_exclusions', payload->'source_exclusions', 'source_audit', payload->'source_audit',
  'school_count', jsonb_array_length(payload->'schools'),
  'school_votes', (select sum((school->>'total_votes')::bigint) from jsonb_array_elements(payload->'schools') school),
  'mesa_count', (select sum((school->>'mesa_count')::bigint) from jsonb_array_elements(payload->'schools') school))
  from (select pg_temp.schools() payload) result),
  '{"exclusions":[{"reason":"official_rows_without_mesa_code","rows":1,"votes":62},
    {"reason":"official_rows_without_mesa_granularity","rows":1,"votes":61}],
    "source_exclusions":[{"kind":"fiscalizacion","rows":3,"votes":1839}],
    "source_audit":[{"kind":"official","rows":6,"votes":350}],
    "school_count":3,"school_votes":350,"mesa_count":4}'::jsonb,
  'school audit starts broad while totals retain only complete official mesas');
rollback to savepoint broad_scope_exclusions;
select is(pg_temp.schools('20000000-0000-0000-0000-000000000002')->>'status',
  'source_unavailable', '2023 school breakdown refuses missing source identity');
savepoint school_no_complete_identity;
insert into jurisdiction (
  id, distrito_code, seccion_code, circuito_code,
  establecimiento_code, establecimiento_name, mesa_code
) values
  ('20000000-0000-0000-0000-000000000019', '02', '027', null,
    'E-WITHOUT-CIRCUIT', 'Incomplete circuit fixture', 7),
  ('20000000-0000-0000-0000-000000000020', '02', '027', null, null, null, 8),
  ('20000000-0000-0000-0000-000000000024', '02', '027', '00004',
    'E-WITHOUT-MESA', 'Incomplete mesa fixture', null);
insert into result_row (
  election_id, jurisdiction_id, category_id, granularity, list_id, votes,
  source_kind, archive_entry_id, source_row_index
) values
  ('20000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000019',
    '20000000-0000-0000-0000-000000000003', 'mesa', '20135', 20, 'official',
    'national/2023-generales', 17),
  ('20000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000020',
    '20000000-0000-0000-0000-000000000003', 'mesa', '20135', 30, 'official',
    'national/2023-generales', 18),
  ('20000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000024',
    '20000000-0000-0000-0000-000000000003', 'mesa', '20135', 40, 'official',
    'national/2023-generales', 19);
select is(pg_temp.schools('20000000-0000-0000-0000-000000000002')->'exclusions',
  '[{"reason":"official_rows_without_circuito_and_establecimiento_code","rows":1,"votes":30},
    {"reason":"official_rows_without_circuito_code","rows":1,"votes":20},
    {"reason":"official_rows_without_establecimiento_code","rows":1,"votes":50},
    {"reason":"official_rows_without_mesa_code","rows":1,"votes":40}]'::jsonb,
  'no-complete-school refusal audits excluded rows and votes by reason');
rollback to savepoint school_no_complete_identity;
select throws_ok($$
  set local role anon;
  select results_exploration_schools('20000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000003', '02', '027')
$$, '42501', 'permission denied for function results_exploration_schools',
  'anon cannot execute the school breakdown RPC');

select is(results_exploration_coverage(
  '20000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000003', '02', '027')->>'status',
  'ok', 'coverage derives from the selected official section');
select is((results_exploration_coverage(
  '20000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000003', '02', '027'
)->'mesas_coverage'->>'observed_units')::integer, 2, 'two official mesas have fiscalizacion presence');
select is((results_exploration_coverage(
  '20000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000003', '02', '027'
)->'mesas_coverage'->>'denominator_units')::integer, 4, 'denominator is the four official mesas');
select is(results_exploration_coverage(
  '20000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000003', '02', '027'
)->'mesas_coverage'->'is_random_sample', 'false'::jsonb, 'mesa coverage is literally non-random');
select is((select mesa->>'code' from jsonb_array_elements(results_exploration_coverage(
  '20000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000003', '02', '027')->'mesas') mesa
  where not (mesa->>'covered')::boolean and mesa->>'code' = '2'), '2',
  'uncovered mesa identity is explicit');
select is((select school->>'observed_units' from jsonb_array_elements(
  results_exploration_coverage('20000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000003', '02', '027')->'escuelas'->'items') school
  where school->>'circuito_code' = '00001'), '1', 'first circuit keeps its observed school mesas');
select is((select school->>'denominator_units' from jsonb_array_elements(
  results_exploration_coverage('20000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000003', '02', '027')->'escuelas'->'items') school
  where school->>'circuito_code' = '00001'), '2', 'first circuit keeps its school denominator');
select is((select school->>'observed_units' from jsonb_array_elements(
  results_exploration_coverage('20000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000003', '02', '027')->'escuelas'->'items') school
  where school->>'circuito_code' = '00002'), '0', 'different-name school code in another circuit stays independent');
select is((select school->>'observed_units' from jsonb_array_elements(
  results_exploration_coverage('20000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000003', '02', '027')->'escuelas'->'items') school
  where school->>'circuito_code' = '00003'), '1', 'same-name school code in another circuit does not merge');
select is(jsonb_array_length(results_exploration_coverage(
  '20000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000003', '02', '027')->'escuelas'->'items'), 3,
  'school output preserves circuito plus establecimiento identity');
select is(results_exploration_coverage('20000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000003', '02', '027')->'source_audit',
  '[{"kind":"fiscalizacion","rows":2,"votes":1776,"mesas":2}]'::jsonb,
  'fiscalizacion source audit is row-derived and isolated');
savepoint coarser_fiscalizacion;
alter table result_row drop constraint result_row_source_kind_check; alter table result_row alter column source_kind drop not null;
insert into jurisdiction (id, distrito_code, seccion_code, circuito_code, establecimiento_code,
  establecimiento_name, mesa_code) values
  ('20000000-0000-0000-0000-000000000025', '02', '027', '00005', 'E-INCOMPLETE-FISCAL', 'Incomplete fiscal fixture', null),
  ('20000000-0000-0000-0000-000000000026', '02', '027', '00006', 'E-UNMAPPED-FISCAL', 'Unmapped fiscal fixture', 99),
  ('20000000-0000-0000-0000-000000000028', '02', '027', '00007', 'E-INCOMPLETE-OFFICIAL', 'Incomplete official fixture', null);
insert into result_row (election_id, jurisdiction_id, category_id, granularity, list_id, votes,
  source_kind, archive_entry_id, source_row_index) values (
  '20000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', '20000000-0000-0000-0000-000000000003', 'seccion', null, 888, 'fiscalizacion', 'fiscalizacion/coarser-runtime', 20
), (
  '20000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000025', '20000000-0000-0000-0000-000000000003', 'mesa', null, 444, 'fiscalizacion', 'fiscalizacion/incomplete-runtime', 21
), (
  '20000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000026', '20000000-0000-0000-0000-000000000003', 'mesa', null, 222, 'fiscalizacion', 'fiscalizacion/unmapped-runtime', 22
), (
  '20000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', '20000000-0000-0000-0000-000000000003',
  'seccion', '110', 777, 'official', 'national/coarser-runtime', 23
), (
  '20000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000028', '20000000-0000-0000-0000-000000000003', 'mesa', '110', 333, 'official', 'national/incomplete-runtime', 24
), (
  '20000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', '20000000-0000-0000-0000-000000000003', 'mesa', null, 111, null, 'fiscalizacion/runtime', 25
), (
  '20000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', '20000000-0000-0000-0000-000000000003', 'mesa', null, 112, 'unsupported', 'fiscalizacion/runtime', 26
);
select is(pg_temp.coverage()->>'status', 'ok', 'coarser and identity-incomplete fiscalizacion do not cause false refusal');
select is((pg_temp.coverage()->'mesas_coverage'->>'observed_units')::integer, 2, 'coarser fiscalizacion cannot mark an official mesa covered');
select is(jsonb_build_object('source', pg_temp.coverage()->'source_audit', 'denominator', pg_temp.coverage()->'denominator_audit'),
  '{"source":[{"kind":"fiscalizacion","rows":2,"votes":1776,"mesas":2}],"denominator":[{"kind":"official","rows":6,"votes":350,"mesas":4}]}'::jsonb,
  'excluded rows cannot enter the isolated numerator or official denominator');
select is(pg_temp.coverage()->'exclusions',
  '[{"reason":"fiscalizacion_rows_without_mesa_granularity","rows":1,"votes":888},
    {"reason":"fiscalizacion_rows_without_mesa_identity","rows":1,"votes":444},
    {"reason":"fiscalizacion_rows_without_official_mesa_mapping","rows":1,"votes":222},
    {"reason":"official_rows_without_mesa_granularity","rows":1,"votes":777},
    {"reason":"official_rows_without_mesa_identity","rows":1,"votes":333},
    {"reason":"unsupported_source_kind_rows","rows":2,"votes":223}]'::jsonb,
  'coverage reports mutually exclusive source exclusions');
update jurisdiction set establecimiento_name = 'Conflicting coverage name' where id = '20000000-0000-0000-0000-000000000011';
select is((select jsonb_build_object('count', payload->'counts'->'ambiguous_establecimiento_name', 'exclusions', payload->'exclusions')
  from (select pg_temp.coverage() payload) result), '{"count":1,"exclusions":[
    {"reason":"fiscalizacion_rows_without_mesa_granularity","rows":1,"votes":888},{"reason":"fiscalizacion_rows_without_mesa_identity","rows":1,"votes":444},
    {"reason":"fiscalizacion_rows_without_official_mesa_mapping","rows":1,"votes":222},{"reason":"official_rows_without_mesa_granularity","rows":1,"votes":777},
    {"reason":"official_rows_without_mesa_identity","rows":1,"votes":333},{"reason":"unsupported_source_kind_rows","rows":2,"votes":223}]}'::jsonb, 'coverage ambiguity refusal audits every source exclusion reason');
rollback to savepoint coarser_fiscalizacion;
select is(results_exploration_coverage('20000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000003', '02', '027')->'denominator_audit',
  '[{"kind":"official","rows":6,"votes":350,"mesas":4}]'::jsonb,
  'official denominator audit carries rows votes and mesas');
select is((results_exploration_official('20000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000003', '02', '027', '00001', 'E1', 2, 'mesa'
)->>'total_votes')::bigint, 140::bigint,
  'uncovered coverage does not erase positive official votes behind its link');
select is(results_exploration_coverage('20000000-0000-0000-0000-000000000002',
  '20000000-0000-0000-0000-000000000003', '02', '027')->'escuelas'->>'status',
  'source_unavailable', 'missing school identity is unavailable rather than empty');
savepoint coverage_without_denominator;
insert into jurisdiction (id, distrito_code, seccion_code, circuito_code,
  establecimiento_code, establecimiento_name, mesa_code) values
  ('20000000-0000-0000-0000-000000000029', '02', '999', null, null, null, null);
insert into result_row (election_id, jurisdiction_id, category_id, granularity, list_id,
  votes, source_kind, archive_entry_id, source_row_index) values
  ('20000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000027',
    '20000000-0000-0000-0000-000000000003', 'seccion', null, 92, 'fiscalizacion',
    'fiscalizacion/only-runtime', 29),
  ('20000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000029',
    '20000000-0000-0000-0000-000000000003', 'mesa', null, 93, 'fiscalizacion',
    'fiscalizacion/only-runtime', 30),
  ('20000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000029',
    '20000000-0000-0000-0000-000000000003', 'seccion', '110', 94, 'official', 'national/only-runtime', 31),
  ('20000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000029',
    '20000000-0000-0000-0000-000000000003', 'mesa', '110', 95, 'official', 'national/only-runtime-missing', 32);
select is((select jsonb_build_object('status', payload->'status', 'exclusions', payload->'exclusions')
  from (select results_exploration_coverage('20000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000003', '02', '999') payload) result),
  '{"status":"denominator_unavailable","exclusions":[
    {"reason":"fiscalizacion_rows_without_mesa_granularity","rows":1,"votes":92},
    {"reason":"fiscalizacion_rows_without_mesa_identity","rows":1,"votes":93},
    {"reason":"fiscalizacion_rows_without_official_mesa_mapping","rows":1,"votes":91},
    {"reason":"official_rows_without_mesa_granularity","rows":1,"votes":94},
    {"reason":"official_rows_without_mesa_identity","rows":1,"votes":95}]}'::jsonb,
  'coverage denominator refusal audits mutually exclusive official and fiscalizacion exclusions');
rollback to savepoint coverage_without_denominator;
select is(jsonb_array_length(results_exploration_coverage(
  '20000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000003', '02', '027'
)->'provenance'->'official_archive_entry_ids'), 1, 'coverage carries official denominator provenance');
select lives_ok($$
  set local role authenticated;
  select results_exploration_coverage('20000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000003', '02', '027');
  reset role;
$$, 'authenticated executes the coverage RPC');
select throws_ok($$
  set local role anon;
  select results_exploration_coverage('20000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000003', '02', '027')
$$, '42501', 'permission denied for function results_exploration_coverage',
  'anon cannot execute the coverage RPC');

select * from finish();
rollback;
