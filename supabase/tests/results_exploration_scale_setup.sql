\set ON_ERROR_STOP on
SET statement_timeout='300s';
-- Disposable high-cardinality fixture setup; timings are local, not production claims.
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
insert into party_canonical(id,display_name)
values ('scale-canonical','Scale verified party');
insert into party_mapping(year,jurisdiction,category,list_id,canonical_party_id,verified)
values (2025,'national','DIPUTADO NACIONAL','0','scale-canonical',true);
insert into jurisdiction (id, distrito_code, seccion_code, circuito_code,
  establecimiento_code, establecimiento_name, mesa_code)
select ('30000000-0000-0000-0001-' || lpad(unit::text, 12, '0'))::uuid,
  '02', '028', lpad(((unit - 1) % 500 + 1)::text, 5, '0'),
  'E' || lpad(((unit - 1) % 500 + 1)::text, 5, '0'),
  'Synthetic scale school ' || ((unit - 1) % 500 + 1), unit
from generate_series(1, 12000) unit;
insert into jurisdiction (
  id, distrito_code, distrito_name, seccion_code, seccion_name
) values
  ('30000000-0000-0000-0008-000000000001', '02', 'Buenos Aires', '027', 'Coronel de Marina L. Rosales'),
  ('30000000-0000-0000-0008-000000000002', '02', 'BUENOS AIRES', '027', 'CORONEL DE MARINA L. ROSALES');
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
-- This relaxation commits, and the cleanup block at the end of the proof file restores it. An
-- abort in between therefore leaves the DB-level source guard dropped. That is bounded, not
-- guaranteed away: e2e-release-gate.ts runs the setup and pgTAP proof as adjacent phases, so a
-- failed phase stops the gate before any later proof observes the weakened schema, and the
-- disposable stack is destroyed by owned cleanup.
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
-- Production-shaped distrito cardinality: 78,962 jurisdictions, 581,400 official
-- facts, 135 normalized source shapes across two sections, ten lists including a
-- verified party mapping, and an audited nonofficial row. Distrito 05 isolates this
-- proof from the smaller fixtures while exercising the deployed eight-argument RPC.
insert into jurisdiction(id,distrito_code,seccion_code,mesa_code)
select ('30000000-0000-0000-0006-'||lpad(unit::text,12,'0'))::uuid,'05',
  case when unit<=39481 then '001' else '002' end,unit
from generate_series(1,78962) unit;
insert into result_row(election_id,jurisdiction_id,category_id,granularity,list_id,votes,
  source_kind,archive_entry_id,source_row_index)
select '30000000-0000-0000-0000-000000000001',
  ('30000000-0000-0000-0006-'||lpad((((row_number-1)%78962)+1)::text,12,'0'))::uuid,
  '30000000-0000-0000-0000-000000000002','mesa',((row_number-1)%10)::text,
  row_number%17,'official','national/production-district-shape-'||lpad((case
    when ((row_number-1)%78962)+1<=39481 then ((row_number-1)%68)+1
    else 69+((row_number-1)%67)
  end)::text,3,'0'),row_number
from generate_series(1,581400) row_number;
insert into result_row(election_id,jurisdiction_id,category_id,granularity,list_id,votes,
  source_kind,archive_entry_id,source_row_index) values
  ('30000000-0000-0000-0000-000000000001','30000000-0000-0000-0006-000000000001',
   '30000000-0000-0000-0000-000000000002','mesa',null,77,'fiscalizacion',
   'fiscalizacion/production-district-shape',1);
-- NULL and a literal control-character section are distinct source identities. They
-- intentionally share every other shape field so any text sentinel collision doubles facts.
insert into jurisdiction(id,distrito_code,seccion_code,mesa_code) values
  ('30000000-0000-0000-0007-000000000001','06',null,1),
  ('30000000-0000-0000-0007-000000000002','06',chr(1),2);
insert into result_row(election_id,jurisdiction_id,category_id,granularity,list_id,votes,
  source_kind,archive_entry_id,source_row_index) values
  ('30000000-0000-0000-0000-000000000001','30000000-0000-0000-0007-000000000001',
   '30000000-0000-0000-0000-000000000002','mesa','collision',11,'official',
   'national/null-safe-section-identity',1),
  ('30000000-0000-0000-0000-000000000001','30000000-0000-0000-0007-000000000002',
   '30000000-0000-0000-0000-000000000002','mesa','collision',13,'official',
   'national/null-safe-section-identity',2);
commit;
vacuum (analyze) jurisdiction;
vacuum (analyze) result_row;
-- Keep plan-reset behavior explicit in the setup phase; the pgTAP proof opens a fresh connection.
discard plans;
select 'results_exploration_scale_setup_complete' as setup_marker;
