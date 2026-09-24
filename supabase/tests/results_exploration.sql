-- Runtime proof for the PR1 official explorer. Synthetic rows contain no
-- personal data and the pgTAP transaction rolls every fixture back.
begin;
select plan(155);
insert into election (id, year, round) values
  ('20000000-0000-0000-0000-000000000001', 2025, 'legislativas'),
  ('20000000-0000-0000-0000-000000000002', 2023, 'generales'),
  ('20000000-0000-0000-0000-000000000004', 2023, 'paso'),
  ('20000000-0000-0000-0000-000000000005', 2025, 'provinciales');
insert into category (id, name)
values ('20000000-0000-0000-0000-000000000003', 'DIPUTADO NACIONAL'),
  ('20000000-0000-0000-0000-000000000006', 'CONCEJALES'),
  ('20000000-0000-0000-0000-000000000007', 'MESA IDENTITY FIXTURE'),
  ('20000000-0000-0000-0000-000000000008', 'DIPUTADOS PROVINCIALES'),
  ('20000000-0000-0000-0000-000000000009', 'SENADORES PROVINCIALES'),
  ('20000000-0000-0000-0000-000000000018', 'INTENDENTE');
insert into jurisdiction (
  id, distrito_code, distrito_name, seccion_code, seccion_name, circuito_code,
  circuito_name, establecimiento_code, establecimiento_name, mesa_code
) values
  ('20000000-0000-0000-0000-000000000010', '02', 'Buenos Aires', '027', 'Coronel de Marina L. Rosales', '00001', '00001', 'E1', 'Fixture school', 1),
  ('20000000-0000-0000-0000-000000000011', '02', 'Buenos Aires', '027', 'Coronel de Marina L. Rosales', '00001', '00001', 'E1', 'Fixture school', 2),
  ('20000000-0000-0000-0000-000000000012', '02', 'Buenos Aires', '027', 'Coronel de Marina L. Rosales', '00002', '00002', null, null, 3),
  ('20000000-0000-0000-0000-000000000013', '03', null, null, null, null, null, null, null, null),
  ('20000000-0000-0000-0000-000000000014', '02', null, '027', null, null, null, null, null, null),
  ('20000000-0000-0000-0000-000000000015', '02', 'Buenos Aires', '028', 'Bahía Blanca', '00003', '00003', 'E2', 'Other fixture school', 3),
  ('20000000-0000-0000-0000-000000000016', '02', 'Buenos Aires', '027', 'Coronel de Marina L. Rosales', '00002', '00002', 'E1', 'Other fixture school', 4),
  ('20000000-0000-0000-0000-000000000017', '02', 'Buenos Aires', '027', 'Coronel de Marina L. Rosales', '00003', null, 'E1', 'Fixture school', 5),
  ('20000000-0000-0000-0000-000000000030', '02', 'Buenos Aires', '027', 'Coronel de Marina L. Rosales', '00004', '00004', 'E10', 'Mesa lineage A', 7),
  ('20000000-0000-0000-0000-000000000031', '02', 'Buenos Aires', '027', 'Coronel de Marina L. Rosales', '00004', '00004', 'E10', 'Mesa lineage A', 8),
  ('20000000-0000-0000-0000-000000000032', '02', 'Buenos Aires', '027', 'Coronel de Marina L. Rosales', '00004', '00004', 'E11', 'Mesa lineage B', 7),
  ('20000000-0000-0000-0000-000000000033', '02', 'Buenos Aires', '027', 'Coronel de Marina L. Rosales', '00008', '00008', 'E20', 'Shared-code lineage A', 7),
  ('20000000-0000-0000-0000-000000000034', '02', 'Buenos Aires', '027', 'Coronel de Marina L. Rosales', '00009', '00009', 'E21', 'Shared-code lineage B', 7),
  ('20000000-0000-0000-0000-000000000035', '02', 'Buenos Aires', '027', 'Coronel de Marina L. Rosales', '00010', '00010', 'E22', 'Missing mesa identity', null),
  ('20000000-0000-0000-0000-000000000080', '02', 'BUENOS AIRES', '027', 'CORONEL DE MARINA L. ROSALES', null, null, null, null, null),
  ('20000000-0000-0000-0000-000000000081', '03', 'Third District North', null, null, null, null, null, null, null),
  ('20000000-0000-0000-0000-000000000082', '03', 'Third District South', null, null, null, null, null, null, null),
  ('20000000-0000-0000-0000-000000000083', '02', 'Buenos Aires', '113', 'TIGRE', null, null, null, null, null),
  ('20000000-0000-0000-0000-000000000027', '02', 'Buenos Aires', '999', null, '00001', '00001', 'E9', 'Fiscal-only scope', 9);
insert into party_canonical (id, display_name)
values ('wu1-canonical', 'WU1 CANONICAL'), ('wu1-municipal', 'WU1 MUNICIPAL'),
('wu2-pba-municipal', 'WU2 PBA MUNICIPAL'), ('wu2-pba-provincial', 'WU2 PBA PROVINCIAL'),
('FUERZA_PATRIA', 'ALIANZA FUERZA PATRIA'),
('LLA_PRO_ALLIANCE', 'ALIANZA LA LIBERTAD AVANZA'),
('SOMOS_BUENOS_AIRES', 'ALIANZA SOMOS BUENOS AIRES'),
('PARTIDO_LIBERTARIO', 'PARTIDO LIBERTARIO'), ('POTENCIA', 'ALIANZA POTENCIA'),
('UNION_Y_LIBERTAD', 'ALIANZA UNION Y LIBERTAD'), ('NUEVOS_AIRES', 'ALIANZA NUEVOS AIRES'),
('POLITICA_OBRERA', 'PARTIDO POLITICA OBRERA'), ('TIEMPO_DE_TODOS', 'PARTIDO TIEMPO DE TODOS'),
('CONSTRUYENDO_PORVENIR', 'CONSTRUYENDO PORVENIR'),
('MOVIMIENTO_SOCIALISTA', 'MOVIMIENTO AVANZADA SOCIALISTA'),
('ES_CON_VOS', 'ALIANZA ES CON VOS ES CON NOSOTROS'), ('VALORES_REPUBLICANOS', 'VALORES REPUBLICANOS'),
('FIT', 'FRENTE DE IZQUIERDA'), ('UNION_LIBERAL', 'UNION LIBERAL'),
('FRENTE_PATRIOTA_FEDERAL', 'FRENTE PATRIOTA FEDERAL'),
('ACCION_COMUNAL_TIGRE', 'ACCION COMUNAL DEL PARTIDO DE TIGRE'),
('OPCION_VECINAL_TIGRE', 'OPCION VECINAL PARA EL PROGRESO DE TIGRE');
insert into party_mapping (
  year, jurisdiction, category, list_id, canonical_party_id, verified
) values
  (2025, 'national', 'DIPUTADO NACIONAL', '110', 'wu1-canonical', true),
  (2023, 'national', 'DIPUTADO NACIONAL', '135', 'wu1-canonical', true),
  (2023, 'national', 'DIPUTADO NACIONAL', '20135', 'wu1-canonical', true),
  (2023, 'coronel_rosales_municipal', 'CONCEJALES', '135', 'wu1-municipal', true),
  (2025, 'coronel_rosales_municipal', 'CONCEJALES', '2206', 'wu2-pba-municipal', true),
  (2025, 'pba_provincial', 'DIPUTADOS PROVINCIALES', '2206', 'wu2-pba-provincial', true),
  (2025, 'pba_provincial', 'SENADORES PROVINCIALES', '2200', 'FUERZA_PATRIA', true),
  (2025, 'pba_provincial', 'SENADORES PROVINCIALES', '2206', 'LLA_PRO_ALLIANCE', true),
  (2025, 'pba_provincial', 'SENADORES PROVINCIALES', '2204', 'SOMOS_BUENOS_AIRES', true),
  (2025, 'pba_provincial', 'SENADORES PROVINCIALES', '1006', 'PARTIDO_LIBERTARIO', true),
  (2025, 'pba_provincial', 'SENADORES PROVINCIALES', '2201', 'POTENCIA', true),
  (2025, 'pba_provincial', 'SENADORES PROVINCIALES', '2207', 'UNION_Y_LIBERTAD', true),
  (2025, 'pba_provincial', 'SENADORES PROVINCIALES', '974', 'POLITICA_OBRERA', true),
  (2025, 'pba_provincial', 'SENADORES PROVINCIALES', '980', 'TIEMPO_DE_TODOS', true),
  (2025, 'pba_provincial', 'SENADORES PROVINCIALES', '1003', 'CONSTRUYENDO_PORVENIR', true),
  (2025, 'pba_provincial', 'SENADORES PROVINCIALES', '959', 'MOVIMIENTO_SOCIALISTA', true),
  (2025, 'pba_provincial', 'SENADORES PROVINCIALES', '2202', 'ES_CON_VOS', true),
  (2025, 'pba_provincial', 'SENADORES PROVINCIALES', '1008', 'VALORES_REPUBLICANOS', true),
  (2025, 'pba_provincial', 'SENADORES PROVINCIALES', '2203', 'FIT', true),
  (2025, 'pba_provincial', 'SENADORES PROVINCIALES', '2208', 'UNION_LIBERAL', true),
  (2025, 'pba_provincial', 'SENADORES PROVINCIALES', '963', 'FRENTE_PATRIOTA_FEDERAL', true),
  (2025, 'tigre_municipal', 'CONCEJALES', '2200', 'FUERZA_PATRIA', true),
  (2025, 'tigre_municipal', 'CONCEJALES', '2206', 'LLA_PRO_ALLIANCE', true),
  (2025, 'tigre_municipal', 'CONCEJALES', '2204', 'SOMOS_BUENOS_AIRES', true),
  (2025, 'tigre_municipal', 'CONCEJALES', '1006', 'PARTIDO_LIBERTARIO', true),
  (2025, 'tigre_municipal', 'CONCEJALES', '2201', 'POTENCIA', true),
  (2025, 'tigre_municipal', 'CONCEJALES', '2207', 'UNION_Y_LIBERTAD', true),
  (2025, 'tigre_municipal', 'CONCEJALES', '2205', 'NUEVOS_AIRES', true),
  (2025, 'tigre_municipal', 'CONCEJALES', '974', 'POLITICA_OBRERA', true),
  (2025, 'tigre_municipal', 'CONCEJALES', '980', 'TIEMPO_DE_TODOS', true),
  (2025, 'tigre_municipal', 'CONCEJALES', '1003', 'CONSTRUYENDO_PORVENIR', true),
  (2025, 'tigre_municipal', 'CONCEJALES', '959', 'MOVIMIENTO_SOCIALISTA', true),
  (2025, 'tigre_municipal', 'CONCEJALES', '193', 'ACCION_COMUNAL_TIGRE', true),
  (2025, 'tigre_municipal', 'CONCEJALES', '2203', 'FIT', true),
  (2025, 'tigre_municipal', 'CONCEJALES', '981', 'OPCION_VECINAL_TIGRE', true),
  (2025, 'tigre_municipal', 'CONCEJALES', '2208', 'UNION_LIBERAL', true);
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
  ('20000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-000000000014', '20000000-0000-0000-0000-000000000003', 'seccion', '78', 29, 'official', 'pba/2025-distrito-027', 10),
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
  ('20000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000027', '20000000-0000-0000-0000-000000000003', 'mesa', null, 91, 'fiscalizacion', 'fiscalizacion/only-runtime', 23),
  ('20000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-000000000014', '20000000-0000-0000-0000-000000000003', 'seccion', null, 43, 'fiscalizacion', 'pba/2025-distrito-027', 24),
  ('20000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-000000000014', '20000000-0000-0000-0000-000000000006', 'seccion', '2206', 101, 'official', 'pba/2025-distrito-027', 25),
  ('20000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-000000000014', '20000000-0000-0000-0000-000000000008', 'seccion', '2206', 202, 'official', 'pba/2025-distrito-027', 26),
  ('20000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000012', '20000000-0000-0000-0000-000000000018', 'mesa', '20135', 37, 'official', 'national/2023-generales', 27);
insert into result_row (
  election_id, jurisdiction_id, category_id, granularity, list_id, votes,
  source_kind, archive_entry_id, source_row_index
)
  select '20000000-0000-0000-0000-000000000005'::uuid, '20000000-0000-0000-0000-000000000083'::uuid, '20000000-0000-0000-0000-000000000009'::uuid, 'distrito', list_id, 1, 'official', 'pba/2025-distrito-113', 100 + ordinality
    from unnest(array['2200','2206','2204','1006','2201','2207','974','980','1003','959','2202','1008','2203','2208','963']) with ordinality as senate(list_id, ordinality)
  union all
  select '20000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-000000000083', '20000000-0000-0000-0000-000000000006', 'distrito', list_id, 1, 'official', 'pba/2025-distrito-113', 115 + ordinality
    from unnest(array['2200','2206','2204','1006','2201','2207','2205','974','980','1003','959','193','2203','981','2208']) with ordinality as council(list_id, ordinality)
  union all
  select '20000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-000000000083', '20000000-0000-0000-0000-000000000009', 'distrito', null, 99, 'fiscalizacion', 'pba/2025-distrito-113', 131;
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
    {"code":"03","name":null,"name_status":"conflict","name_variant_count":2}]'::jsonb,
  'same-code fallback prefers title case, rejects conflicts, and never crosses district codes');
select is(results_exploration_facets(
  '20000000-0000-0000-0000-000000000005',
  '20000000-0000-0000-0000-000000000006', '02'
)->'secciones',
  '[{"code":"027","name":"Coronel de Marina L. Rosales","name_status":"present","name_variant_count":1},
{"code":"113","name":"TIGRE","name_status":"present","name_variant_count":1}]'::jsonb,
  'production-shaped PBA section rows recover conflict-checked canonical same-code names');
savepoint selected_facet_name_precedence;
update jurisdiction set distrito_name = 'Selected Third District'
where id = '20000000-0000-0000-0000-000000000013';
select is(results_exploration_facets(
  '20000000-0000-0000-0000-000000000005',
  '20000000-0000-0000-0000-000000000003'
)->'distritos'->1,
  '{"code":"03","name":"Selected Third District","name_status":"present","name_variant_count":1}'::jsonb,
  'a selected source-backed name wins without mixing conflicting global fallback names');
rollback to savepoint selected_facet_name_precedence;
savepoint blank_district_facet_names;
update jurisdiction set distrito_name = case id
  when '20000000-0000-0000-0000-000000000081' then '  Third District North  '
  else '   ' end
where id in (
  '20000000-0000-0000-0000-000000000013',
  '20000000-0000-0000-0000-000000000081',
  '20000000-0000-0000-0000-000000000082'
);
select is(results_exploration_facets(
  '20000000-0000-0000-0000-000000000005',
  '20000000-0000-0000-0000-000000000003'
)->'distritos'->1,
  '{"code":"03","name":"Third District North","name_status":"present","name_variant_count":1}'::jsonb,
  'blank selected and global district names are ignored while one trimmed real name remains present');
update jurisdiction set distrito_name = '   '
where id = '20000000-0000-0000-0000-000000000081';
select is(results_exploration_facets(
  '20000000-0000-0000-0000-000000000005',
  '20000000-0000-0000-0000-000000000003'
)->'distritos'->1,
  '{"code":"03","name":null,"name_status":"missing","name_variant_count":0}'::jsonb,
  'a district with only blank selected and global names remains missing');
rollback to savepoint blank_district_facet_names;
savepoint blank_section_facet_names;
update jurisdiction set seccion_name = '   '
where distrito_code = '02' and seccion_code = '027';
update jurisdiction set seccion_name = '  Coronel de Marina L. Rosales  '
where id = '20000000-0000-0000-0000-000000000010';
select is(results_exploration_facets(
  '20000000-0000-0000-0000-000000000005',
  '20000000-0000-0000-0000-000000000006', '02'
)->'secciones',
  '[{"code":"027","name":"Coronel de Marina L. Rosales","name_status":"present","name_variant_count":1},
{"code":"113","name":"TIGRE","name_status":"present","name_variant_count":1}]'::jsonb,
  'blank selected and global section names are ignored while real sibling names remain present');
update jurisdiction set seccion_name = '   '
where id = '20000000-0000-0000-0000-000000000010';
select is(results_exploration_facets(
  '20000000-0000-0000-0000-000000000005',
  '20000000-0000-0000-0000-000000000006', '02'
)->'secciones',
  '[{"code":"027","name":null,"name_status":"missing","name_variant_count":0},
{"code":"113","name":"TIGRE","name_status":"present","name_variant_count":1}]'::jsonb,
  'a section with only blank selected and global names remains missing without affecting siblings');
rollback to savepoint blank_section_facet_names;
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
select is(results_exploration_official_0034('20000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000003','02','027'),
  results_exploration_official_0033('20000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000003','02','027'),
  '0034 delegates every non-district payload with exact 0033 parity');
select is(results_exploration_official_0035('20000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000003','02',p_requested_level=>'distrito'),
  results_exploration_official_0034('20000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000003','02',p_requested_level=>'distrito'),
  '0035 district core preserves exact realistic 0034 JSONB payload outside PBA');
select is(results_exploration_official('20000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000003','02',p_requested_level=>'distrito')->>'status','ok',
  'national mesa-backed source remains eligible for district aggregation');
select is(results_exploration_official('20000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000003','02',p_requested_level=>'distrito'),
  results_exploration_official_wrapper_0034('20000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000003','02',p_requested_level=>'distrito') || jsonb_build_object('category_name','DIPUTADO NACIONAL'),
  'public district wrapper preserves category extension and exact prior 0034 public fields outside PBA');
select is(results_exploration_official('20000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000003','02',p_requested_level=>'distrito')-'source_exclusions',
  results_exploration_official_0029('20000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000003','02',p_requested_level=>'distrito') || jsonb_build_object('category_name','DIPUTADO NACIONAL'),
  'district fast path preserves exact prior fields with category extension for mapped, unmapped, archive, mesa identity, audit, shares, and totals');
select ok(jsonb_build_array(public_payload-'source_exclusions',fast_payload)=jsonb_build_array(preserved_payload,preserved_payload)
  and preserved_payload->>'status'='selection_invalid' and preserved_payload->'counts'->>'missing_selector'='1',
  'missing required selector delegates to 0029 without no_rows: '||label) from (values
  ('election',null::uuid,'20000000-0000-0000-0000-000000000003'::uuid,'02'::text),('category','20000000-0000-0000-0000-000000000001',null,'02'),
  ('distrito','20000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000003',null)) cases(label,election_id,category_id,distrito)
cross join lateral (select results_exploration_official(election_id,category_id,distrito) public_payload,results_exploration_official_0034(election_id,category_id,distrito) fast_payload,
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
  results_exploration_official_0034(election_id,category_id,'99',p_requested_level=>requested_level) core_payload) payloads
cross join lateral (select array['total_votes','parties','source_audit','archive_entry_ids','mesa_count'] figures) evidence;
savepoint district_fast_path_edges;
insert into jurisdiction(id,distrito_code) values ('20000000-0000-0000-0000-000000000036','02'),('20000000-0000-0000-0000-000000000037','04');
insert into result_row(election_id,jurisdiction_id,category_id,granularity,list_id,votes,source_kind,archive_entry_id,source_row_index) values
('20000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000036','20000000-0000-0000-0000-000000000003','distrito','mixed',1,'official','national/mixed',26),
('20000000-0000-0000-0000-000000000005','20000000-0000-0000-0000-000000000037','20000000-0000-0000-0000-000000000007','distrito','zero',0,'official','national/zero',27);
select is(public_payload-'source_exclusions',core_payload || case when core_payload->>'status'='ok'
    then jsonb_build_object('category_name',expected_category) else '{}'::jsonb end,
    'district edge preserves exact prior fields with conditional category extension: '||label) from (values
  ('mixed','20000000-0000-0000-0000-000000000001'::uuid,'20000000-0000-0000-0000-000000000003'::uuid,'02',null::text),
  ('district source','20000000-0000-0000-0000-000000000005'::uuid,'20000000-0000-0000-0000-000000000003'::uuid,'03','DIPUTADO NACIONAL'),
  ('zero votes','20000000-0000-0000-0000-000000000005'::uuid,'20000000-0000-0000-0000-000000000007'::uuid,'04','MESA IDENTITY FIXTURE'),
  ('no rows','20000000-0000-0000-0000-000000000005'::uuid,'20000000-0000-0000-0000-000000000007'::uuid,'99',null)
) cases(label,election_id,category_id,distrito,expected_category)
cross join lateral (select results_exploration_official(election_id,category_id,distrito,p_requested_level=>'distrito') public_payload,
  results_exploration_official_0029(election_id,category_id,distrito,p_requested_level=>'distrito') core_payload) payloads;
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
  'source_exclusions',payload->'source_exclusions',
  'has_figures',payload ?| array['total_votes','parties','source_audit','archive_entry_ids','mesa_count']) from (select
  results_exploration_official('20000000-0000-0000-0000-000000000005','20000000-0000-0000-0000-000000000003','02',p_requested_level=>'distrito') payload) result),
  '{"status":"source_unavailable","reason":"official rows excluded from distrito aggregation","exclusions":[{"reason":"pba_partido_rows_not_province_aggregate","rows":1,"votes":29}],"source_exclusions":[{"kind":"fiscalizacion","rows":1,"votes":43}],"has_figures":false}'::jsonb,
  'province refusal audits nonofficial PBA section rows without admitting them to official figures');
savepoint legacy_pba_distrito;
update result_row set granularity='distrito'
where archive_entry_id='pba/2025-distrito-027' and source_row_index=10;
select is(results_exploration_official('20000000-0000-0000-0000-000000000005',
  '20000000-0000-0000-0000-000000000003','02',p_requested_level=>'distrito')->>'status',
  'source_unavailable','legacy stored-distrito PBA partido rows remain excluded');
rollback to savepoint legacy_pba_distrito;
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
set local role results_exploration_executor;
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
    '20000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000003', '02', '027'
  )->>'category_name', 'DIPUTADO NACIONAL',
    'success payload carries the exact authoritative category name');
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
  archive_entry_id, year, round, category, distrito_code, seccion_code), expected,
  'party jurisdiction maps only the exact curated source shape: ' || label)
from (values
  ('national President', 'national/2023-generales', 2023, 'generales', 'PRESIDENTE', '02', '027', 'national'),
  ('bundled national municipal', 'national/2023-generales', 2023, 'generales', 'CONCEJALES', '02', '027', 'coronel_rosales_municipal'),
  ('PBA municipal', 'pba/2025-distrito-027', 2025, 'provinciales', 'CONCEJALES', '02', '027', 'coronel_rosales_municipal'),
  ('PBA provincial', 'pba/2025-distrito-027', 2025, 'provinciales', 'DIPUTADOS PROVINCIALES', '02', '027', 'pba_provincial'),
  ('unregistered PBA archive with curated codes', 'pba/2025-distrito-999', 2025, 'provinciales', 'DIPUTADOS PROVINCIALES', '02', '027', null),
  ('PBA provincial outside curated section', 'pba/2025-distrito-028', 2025, 'provinciales', 'DIPUTADOS PROVINCIALES', '02', '028', null),
  ('unmapped PBA category', 'pba/2025-distrito-027', 2025, 'provinciales', 'DIPUTADO NACIONAL', '02', '027', null)
) cases(label,archive_entry_id,year,round,category,distrito_code,seccion_code,expected);
select is(results_exploration_party_jurisdiction(
  archive_entry_id, year, round, category, distrito_code, seccion_code), expected,
  '2023 INTENDENTE mapping is source and section scoped: ' || label)
from (values
  ('DINE 2023 general', 'national/2023-generales', 2023, 'generales', 'INTENDENTE', '02', '027', 'coronel_rosales_municipal'),
  ('wrong source', 'national/2023-paso', 2023, 'generales', 'INTENDENTE', '02', '027', 'national'),
  ('wrong section', 'national/2023-generales', 2023, 'generales', 'INTENDENTE', '02', '028', 'national'),
  ('wrong category', 'national/2023-generales', 2023, 'generales', 'DIPUTADO NACIONAL', '02', '027', 'national'),
  ('wrong year', 'national/2023-generales', 2024, 'generales', 'INTENDENTE', '02', '027', 'national'),
  ('wrong round', 'national/2023-generales', 2023, 'paso', 'INTENDENTE', '02', '027', 'national')
) cases(label,archive_entry_id,year,round,category,distrito_code,seccion_code,expected);
select is((select party->>'canonical_party_id' from jsonb_array_elements(
  results_exploration_official('20000000-0000-0000-0000-000000000002',
    '20000000-0000-0000-0000-000000000018', '02', '027')->'parties') party),
  'LLA',
  'authorized official RPC resolves DINE municipal INTENDENTE list through versioned curated identity');
select is(results_exploration_party_jurisdiction(
  archive_entry_id, year, round, category, distrito_code, seccion_code), expected,
  'distrito 113 mapping is exact and closed: ' || label)
from (values
  ('Senate', 'pba/2025-distrito-113', 2025, 'provinciales', 'SENADORES PROVINCIALES', '02', '113', 'pba_provincial'),
  ('Council', 'pba/2025-distrito-113', 2025, 'provinciales', 'CONCEJALES', '02', '113', 'tigre_municipal'),
  ('wrong source', 'pba/2025-distrito-114', 2025, 'provinciales', 'CONCEJALES', '02', '113', null),
  ('wrong category', 'pba/2025-distrito-113', 2025, 'provinciales', 'DIPUTADOS PROVINCIALES', '02', '113', null),
  ('wrong section', 'pba/2025-distrito-113', 2025, 'provinciales', 'CONCEJALES', '02', '027', null),
  ('wrong district', 'pba/2025-distrito-113', 2025, 'provinciales', 'CONCEJALES', '03', '113', null),
  ('wrong year', 'pba/2025-distrito-113', 2024, 'provinciales', 'CONCEJALES', '02', '113', null),
  ('wrong round', 'pba/2025-distrito-113', 2025, 'generales', 'CONCEJALES', '02', '113', null)
) cases(label,archive_entry_id,year,round,category,distrito_code,seccion_code,expected);
select is((select jsonb_build_object(
    'status', payload->'status', 'level', payload->'level',
    'source_granularity', payload->'source_granularity', 'source_kind', payload->'source_kind',
    'total_votes', payload->'total_votes', 'archive_entry_ids', payload->'archive_entry_ids')
  from (select results_exploration_official(
    '20000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-000000000009',
    '02', '113') payload) response),
  '{"status":"ok","level":"seccion","source_granularity":"seccion","source_kind":"official","total_votes":15,"archive_entry_ids":["pba/2025-distrito-113"]}'::jsonb,
  'public RPC reaches official distrito 113 Senate rows only as normalized section results');
select is(results_exploration_official(
  '20000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-000000000009',
  '02', '113')->'source_audit', '[{"kind":"official","rows":15,"votes":15}]'::jsonb,
  'distrito 113 Senate source audit contains official rows only');
select is(results_exploration_official(
  '20000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-000000000009',
  '02', '113')->'source_exclusions', '[{"kind":"fiscalizacion","rows":1,"votes":99}]'::jsonb,
  'distrito 113 Senate excludes non-official rows without mixing figures');
select is((select jsonb_build_object(
    'canonical', count(*) filter (where party->>'identity_status'='canonical'),
    'unmapped', count(*) filter (where party->>'identity_status'='unmapped'))
  from jsonb_array_elements(results_exploration_official(
    '20000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-000000000009',
    '02', '113')->'parties') party), '{"canonical":15,"unmapped":0}'::jsonb,
  'distrito 113 Senate resolves all 15 exact approved party mappings');
select is((select jsonb_agg(party->>'display_name' order by party->>'display_name')
  from jsonb_array_elements(results_exploration_official(
    '20000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-000000000009',
    '02', '113')->'parties') party),
  '["ALIANZA ES CON VOS ES CON NOSOTROS","ALIANZA FUERZA PATRIA","ALIANZA LA LIBERTAD AVANZA","ALIANZA POTENCIA","ALIANZA SOMOS BUENOS AIRES","ALIANZA UNION Y LIBERTAD","CONSTRUYENDO PORVENIR","FRENTE DE IZQUIERDA","FRENTE PATRIOTA FEDERAL","MOVIMIENTO AVANZADA SOCIALISTA","PARTIDO LIBERTARIO","PARTIDO POLITICA OBRERA","PARTIDO TIEMPO DE TODOS","UNION LIBERAL","VALORES REPUBLICANOS"]'::jsonb,
  'distrito 113 Senate exposes exact approved canonical display names');
select is((select jsonb_build_object(
    'status', payload->'status', 'level', payload->'level',
    'source_granularity', payload->'source_granularity', 'source_kind', payload->'source_kind',
    'total_votes', payload->'total_votes', 'archive_entry_ids', payload->'archive_entry_ids')
  from (select results_exploration_official(
    '20000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-000000000006',
    '02', '113') payload) response),
  '{"status":"ok","level":"seccion","source_granularity":"seccion","source_kind":"official","total_votes":15,"archive_entry_ids":["pba/2025-distrito-113"]}'::jsonb,
  'public RPC reaches official distrito 113 Council rows only as normalized section results');
select is(results_exploration_official(
  '20000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-000000000006',
  '02', '113')->'source_audit', '[{"kind":"official","rows":15,"votes":15}]'::jsonb,
  'distrito 113 Council source audit contains official rows only');
select is(results_exploration_official(
  '20000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-000000000006',
  '02', '113')->'source_exclusions', '[]'::jsonb,
  'distrito 113 Council has no mixed source rows');
select is((select jsonb_build_object(
    'canonical', count(*) filter (where party->>'identity_status'='canonical'),
    'unmapped', count(*) filter (where party->>'identity_status'='unmapped'))
  from jsonb_array_elements(results_exploration_official(
    '20000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-000000000006',
    '02', '113')->'parties') party), '{"canonical":15,"unmapped":0}'::jsonb,
  'distrito 113 Council resolves all 15 exact approved party mappings');
select is((select jsonb_agg(party->>'display_name' order by party->>'display_name')
  from jsonb_array_elements(results_exploration_official(
    '20000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-000000000006',
    '02', '113')->'parties') party),
  '["ACCION COMUNAL DEL PARTIDO DE TIGRE","ALIANZA FUERZA PATRIA","ALIANZA LA LIBERTAD AVANZA","ALIANZA NUEVOS AIRES","ALIANZA POTENCIA","ALIANZA SOMOS BUENOS AIRES","ALIANZA UNION Y LIBERTAD","CONSTRUYENDO PORVENIR","FRENTE DE IZQUIERDA","MOVIMIENTO AVANZADA SOCIALISTA","OPCION VECINAL PARA EL PROGRESO DE TIGRE","PARTIDO LIBERTARIO","PARTIDO POLITICA OBRERA","PARTIDO TIEMPO DE TODOS","UNION LIBERAL"]'::jsonb,
  'distrito 113 Council exposes exact approved canonical display names');
select is((select jsonb_build_object(
    'status', payload->'status', 'reason', payload->'reason',
    'exclusions', payload->'exclusions', 'source_exclusions', payload->'source_exclusions',
    'has_figures', payload ?| array['total_votes','parties','source_audit','archive_entry_ids','mesa_count'])
  from (select results_exploration_official(
    '20000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-000000000006',
    '02', p_requested_level=>'distrito') payload) response),
  '{"status":"source_unavailable","reason":"official rows excluded from distrito aggregation","exclusions":[{"reason":"pba_partido_rows_not_province_aggregate","rows":16,"votes":116}],"source_exclusions":[],"has_figures":false}'::jsonb,
  'distrito request refuses Tigre partido rows instead of rendering them as Buenos Aires totals');
savepoint pba113_incorrect_mapping;
update party_mapping set verified=false
where year=2025 and jurisdiction='tigre_municipal' and category='CONCEJALES' and list_id='2200';
select is((select jsonb_build_object(
    'canonical', count(*) filter (where party->>'identity_status'='canonical'),
    'unmapped', jsonb_agg(jsonb_build_object(
      'identity_status',party->'identity_status','list_id',party->'list_id',
      'canonical_party_id',party->'canonical_party_id','display_name',party->'display_name'))
      filter (where party->>'identity_status'='unmapped'))
  from jsonb_array_elements(results_exploration_official(
    '20000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-000000000006',
    '02', '113')->'parties') party),
  '{"canonical":14,"unmapped":[{"identity_status":"unmapped","list_id":"2200","canonical_party_id":null,"display_name":null}]}'::jsonb,
  'missing or unverified distrito 113 mapping stays visibly unmapped and keeps its list id');
rollback to savepoint pba113_incorrect_mapping;
select is(results_exploration_official(
    '20000000-0000-0000-0000-000000000005',
    '20000000-0000-0000-0000-000000000006', '02', '027') - 'source_exclusions',
  results_exploration_official_0035(
    '20000000-0000-0000-0000-000000000005',
    '20000000-0000-0000-0000-000000000006', '02', '027') || jsonb_build_object('category_name','CONCEJALES'),
  'generic public RPC preserves exact 0035 core fields with CONCEJALES category extension for PBA municipal results');
select is((select party->>'canonical_party_id' from jsonb_array_elements(
    results_exploration_official('20000000-0000-0000-0000-000000000005',
      '20000000-0000-0000-0000-000000000006', '02', '027')->'parties') party),
  'wu2-pba-municipal', 'generic RPC resolves PBA Concejales with municipal party jurisdiction');
select is(results_exploration_official(
    '20000000-0000-0000-0000-000000000005',
    '20000000-0000-0000-0000-000000000008', '02', '027') - 'source_exclusions',
  results_exploration_official_0035(
    '20000000-0000-0000-0000-000000000005',
    '20000000-0000-0000-0000-000000000008', '02', '027') || jsonb_build_object('category_name','DIPUTADOS PROVINCIALES'),
  'generic public RPC preserves exact 0035 core fields with DIPUTADOS PROVINCIALES category extension for PBA provincial results');
select is((select party->>'canonical_party_id' from jsonb_array_elements(
    results_exploration_official('20000000-0000-0000-0000-000000000005',
      '20000000-0000-0000-0000-000000000008', '02', '027')->'parties') party),
  'wu2-pba-provincial', 'generic RPC resolves Diputados with provincial party jurisdiction');
select is((results_exploration_official(
  '20000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000003', '02', '999'
)->'counts'->>'selected_rows')::integer, 0, 'no-row refusal reports selected rows');
select throws_ok($$
  set local role authenticated;
  select results_exploration_facets();
$$, '42501', 'permission denied for function results_exploration_facets',
  'authenticated cannot execute the legacy public facets RPC');
select ok(not exists(
  select from unnest(array['jurisdiction','election','category','result_row',
    'jurisdiction_crosswalk','mesa_crosswalk','fiscalizacion_mesa_identity','archive_entry',
    'party_canonical','list_identity','party_mapping','review_item',
    'review_item_unresolved_count']) table_name,
    unnest(array['anon','authenticated','service_role']) role_name
  where to_regrole(role_name) is not null
    and has_table_privilege(role_name,'public.'||table_name,'SELECT')),
  'client roles cannot select legacy public result tables or views');
select ok(not exists(
  select from pg_policies where schemaname='public'
    and tablename=any(array['jurisdiction','election','category','result_row',
      'jurisdiction_crosswalk','mesa_crosswalk','fiscalizacion_mesa_identity','archive_entry',
      'party_canonical','list_identity','party_mapping','review_item'])
    and 'authenticated'=any(roles)),
  'authenticated has no surviving legacy public read policy');
select ok(not exists(
  select from unnest(array[
    'results_exploration_party_jurisdiction(text,integer,text,text,text,text)',
    'results_exploration_reporting_level(text,text,text,text)',
    'results_exploration_facets(uuid,uuid,text,text,text,text)',
    'results_exploration_official(uuid,uuid,text,text,text,text,integer,text)',
    'results_exploration_coverage(uuid,uuid,text,text)',
    'results_exploration_schools(uuid,uuid,text,text)']) function_name,
    unnest(array['anon','authenticated','service_role']) role_name
  where to_regrole(role_name) is not null
    and has_function_privilege(role_name,'public.'||function_name,'EXECUTE')),
  'client roles cannot execute legacy public result functions');
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
select throws_ok($$
  set local role authenticated;
  select results_exploration_coverage('20000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000003', '02', '027');
$$, '42501', 'permission denied for function results_exploration_coverage',
  'authenticated cannot execute the legacy public coverage RPC');
select throws_ok($$
  set local role anon;
  select results_exploration_coverage('20000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000003', '02', '027')
$$, '42501', 'permission denied for function results_exploration_coverage',
  'anon cannot execute the coverage RPC');

select * from finish();
rollback;
