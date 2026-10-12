begin;
select plan(29);
-- Tables: the expected mesa catalogue and per-category count status are ETL-written,
-- never directly readable by clients.
select ok(to_regclass('public.official_expected_mesa') is not null,'expected mesa catalogue table exists');
select ok(to_regclass('public.official_mesa_count_status') is not null,'mesa count status table exists');
select ok((select bool_and(c.relrowsecurity) from pg_class c where c.oid in ('public.official_expected_mesa'::regclass,'public.official_mesa_count_status'::regclass)),'both tables enforce RLS');
select ok(not exists(select from unnest(array['anon','authenticated','service_role']) r,
 unnest(array['public.official_expected_mesa','public.official_mesa_count_status']) t,
 unnest(array['SELECT','INSERT','UPDATE','DELETE']) p where has_table_privilege(r,t,p)),'clients and service_role have no direct table privileges');
select ok((select bool_and(has_table_privilege('etl_writer',t,'SELECT') and has_table_privilege('etl_writer',t,'INSERT') and has_table_privilege('etl_writer',t,'DELETE'))
 from unnest(array['public.official_expected_mesa','public.official_mesa_count_status']) t),'etl_writer can replace both tables');
select ok((select bool_and(has_table_privilege('workspace_query_owner',t,'SELECT') and not has_table_privilege('workspace_query_owner',t,'INSERT'))
 from unnest(array['public.official_expected_mesa','public.official_mesa_count_status']) t),'query owner reads but never writes');
select is((select count(*) from pg_policies where schemaname='public' and tablename in ('official_expected_mesa','official_mesa_count_status')
 and roles=array['workspace_query_owner']::name[] and cmd='SELECT' and qual='true'),2::bigint,'each table has one explicit query-owner SELECT policy');
-- Fixture: one authorized section 97/997 with three catalogue mesas.
grant workspace_admin_owner,workspace_context_owner to current_user;
insert into public.election(id,year,round) values
 ('57000000-0000-0000-0000-000000000001',2097,'legislativas'),
 ('57000000-0000-0000-0000-000000000011',2096,'generales');
insert into public.category(id,name) values
 ('57000000-0000-0000-0000-000000000002','COMPLETENESS PARTIAL'),
 ('57000000-0000-0000-0000-000000000012','COMPLETENESS COMPLETE'),
 ('57000000-0000-0000-0000-000000000022','COMPLETENESS UNEXPECTED');
insert into public.jurisdiction(id,distrito_code,seccion_code,circuito_code,mesa_code) values
 ('57000000-0000-0000-0000-000000000003','97','997','00001',1),
 ('57000000-0000-0000-0000-000000000013','97','997','00001',2),
 ('57000000-0000-0000-0000-000000000023','97','997','00002',3);
insert into public.result_row(election_id,jurisdiction_id,category_id,granularity,list_id,votes,source_kind,archive_entry_id,source_row_index)
 select e,j,c,'mesa','1',10,'official','national/2097-test',n from (values
  ('57000000-0000-0000-0000-000000000001'::uuid,'57000000-0000-0000-0000-000000000003'::uuid,'57000000-0000-0000-0000-000000000002'::uuid,1),
  ('57000000-0000-0000-0000-000000000001','57000000-0000-0000-0000-000000000003','57000000-0000-0000-0000-000000000012',2),
  ('57000000-0000-0000-0000-000000000001','57000000-0000-0000-0000-000000000003','57000000-0000-0000-0000-000000000022',3),
  ('57000000-0000-0000-0000-000000000011','57000000-0000-0000-0000-000000000003','57000000-0000-0000-0000-000000000002',4)) v(e,j,c,n);
insert into public.official_expected_mesa(election_id,archive_entry_id,distrito_code,seccion_code,mesa_code,mesa_tipo,electores,source_row_index) values
 ('57000000-0000-0000-0000-000000000001','national/2097-test','97','997',1,'NATIVOS',300,1),
 ('57000000-0000-0000-0000-000000000001','national/2097-test','97','997',2,'NATIVOS',310,2),
 ('57000000-0000-0000-0000-000000000001','national/2097-test','97','997',3,'NATIVOS',320,3);
insert into public.official_mesa_count_status(election_id,archive_entry_id,category_id,distrito_code,seccion_code,circuito_code,mesa_code,count_status) values
 -- Partial: mesa 1 counted, mesa 2 not counted, mesa 3 absent from the results source.
 ('57000000-0000-0000-0000-000000000001','national/2097-test','57000000-0000-0000-0000-000000000002','97','997','00001',1,'counted'),
 ('57000000-0000-0000-0000-000000000001','national/2097-test','57000000-0000-0000-0000-000000000002','97','997','00001',2,'not_counted'),
 -- Complete: every catalogue mesa counted.
 ('57000000-0000-0000-0000-000000000001','national/2097-test','57000000-0000-0000-0000-000000000012','97','997','00001',1,'counted'),
 ('57000000-0000-0000-0000-000000000001','national/2097-test','57000000-0000-0000-0000-000000000012','97','997','00001',2,'counted'),
 ('57000000-0000-0000-0000-000000000001','national/2097-test','57000000-0000-0000-0000-000000000012','97','997','00002',3,'counted'),
 -- Unexpected: a counted mesa 4 the catalogue does not list.
 ('57000000-0000-0000-0000-000000000001','national/2097-test','57000000-0000-0000-0000-000000000022','97','997','00001',1,'counted'),
 ('57000000-0000-0000-0000-000000000001','national/2097-test','57000000-0000-0000-0000-000000000022','97','997','00001',2,'counted'),
 ('57000000-0000-0000-0000-000000000001','national/2097-test','57000000-0000-0000-0000-000000000022','97','997','00002',3,'counted'),
 ('57000000-0000-0000-0000-000000000001','national/2097-test','57000000-0000-0000-0000-000000000022','97','997','00002',4,'counted');
select throws_ok($q$insert into public.official_expected_mesa(election_id,archive_entry_id,distrito_code,seccion_code,mesa_code,mesa_tipo,electores,source_row_index)
 values('57000000-0000-0000-0000-000000000001','national/2097-other','97','997',1,'NATIVOS',1,9)$q$,'23505',null,
 'a second catalogue row for the same election mesa is rejected, never picked');
select throws_ok($q$insert into public.official_mesa_count_status(election_id,archive_entry_id,category_id,distrito_code,seccion_code,circuito_code,mesa_code,count_status)
 values('57000000-0000-0000-0000-000000000001','national/2097-test','57000000-0000-0000-0000-000000000002','97','997','00001',3,'escrutado')$q$,'23514',null,
 'count status accepts only counted or not_counted');
set local role workspace_admin_owner;
insert into workspace_private.organization(id,slug,display_name,entitlement_revision) values('57000000-0000-0000-0000-000000000004','completeness','Completeness',1);
insert into workspace_private.organization_membership(organization_id,user_id,membership_revision) values('57000000-0000-0000-0000-000000000004','57000000-0000-0000-0000-000000000005',1);
insert into workspace_private.section_scope values('97','997');
insert into workspace_private.organization_section_entitlement(organization_id,distrito_code,seccion_code) values('57000000-0000-0000-0000-000000000004','97','997');
reset role; set local role workspace_context_owner;
insert into workspace_private.workspace_context(session_id,user_id,organization_id,membership_revision,entitlement_revision,context_revision,fixed_expires_at) values('57000000-0000-0000-0000-000000000006','57000000-0000-0000-0000-000000000005','57000000-0000-0000-0000-000000000004',1,1,1,statement_timestamp()+interval '1 hour');
reset role;
-- RPC privilege boundary.
select ok(to_regprocedure('workspace_api.official_section_completeness(uuid,uuid,text,text)') is not null,'authorized completeness RPC exists');
select ok(has_function_privilege('authenticated','workspace_api.official_section_completeness(uuid,uuid,text,text)','EXECUTE')
 and not has_function_privilege('anon','workspace_api.official_section_completeness(uuid,uuid,text,text)','EXECUTE')
 and not has_function_privilege('service_role','workspace_api.official_section_completeness(uuid,uuid,text,text)','EXECUTE'),'only authenticated may execute');
select ok(not exists(select from pg_proc p cross join lateral aclexplode(p.proacl) a where p.oid='workspace_api.official_section_completeness(uuid,uuid,text,text)'::regprocedure and a.grantee=0 and a.privilege_type='EXECUTE'),'PUBLIC cannot execute');
select ok((select r.rolname='workspace_query_owner' and p.prosecdef and regexp_replace(array_to_string(p.proconfig,','),'\s+','','g')='search_path=pg_catalog,workspace_api,public,pg_temp'
 from pg_proc p join pg_roles r on r.oid=p.proowner where p.oid='workspace_api.official_section_completeness(uuid,uuid,text,text)'::regprocedure),'query-owner security definer pins its search path');
select ok((select strpos(d,'workspace_api.official_result(')<strpos(d,'public.official_expected_mesa') from (select pg_get_functiondef('workspace_api.official_section_completeness(uuid,uuid,text,text)'::regprocedure) d) f),
 'authorization envelope runs before completeness reads');
set local role authenticated;
select throws_ok($q$select workspace_api.official_section_completeness('57000000-0000-0000-0000-000000000001','57000000-0000-0000-0000-000000000002','97','997')$q$,'VOT01','VOT01','missing session is denied');
select set_config('request.jwt.claims',jsonb_build_object('sub','57000000-0000-0000-0000-000000000005','session_id','57000000-0000-0000-0000-000000000006','exp',floor(extract(epoch from statement_timestamp()+interval '10 minutes')))::text,true);
select is(workspace_api.official_section_completeness('57000000-0000-0000-0000-000000000001','57000000-0000-0000-0000-000000000002','97','996')->>'authorization_status','scope_denied','unauthorized exact section is denied');
select is(workspace_api.official_section_completeness('57000000-0000-0000-0000-000000000001','57000000-0000-0000-0000-000000000002','97',null)->>'authorization_status','scope_required','missing exact section is denied');
-- Partial.
create temporary table partial_payload as select workspace_api.official_section_completeness('57000000-0000-0000-0000-000000000001','57000000-0000-0000-0000-000000000002','97','997') p;
select is((select p->>'status' from partial_payload),'ok','authorized completeness succeeds');
select is((select p->'completeness'->>'status' from partial_payload),'partial','a not-counted or missing mesa makes the section partial');
select is((select p->'completeness'->'counts' from partial_payload),
 '{"expected":3,"counted":1,"not_counted":1,"missing":1,"unexpected":0}'::jsonb,'every reason is reported separately');
select is((select p->'completeness'->>'category_applicability' from partial_payload),'district_reported_categories','the category assumption is stated, not implied');
select is((select p->'completeness'->'sources' from partial_payload),
 '{"catalogue_archive_entry_ids":["national/2097-test"],"status_archive_entry_ids":["national/2097-test"]}'::jsonb,'catalogue and status provenance are returned');
-- Complete.
select is(workspace_api.official_section_completeness('57000000-0000-0000-0000-000000000001','57000000-0000-0000-0000-000000000012','97','997')->'completeness'->>'status','complete','every expected mesa counted is complete');
select is(workspace_api.official_section_completeness('57000000-0000-0000-0000-000000000001','57000000-0000-0000-0000-000000000012','97','997')->'completeness'->'counts',
 '{"expected":3,"counted":3,"not_counted":0,"missing":0,"unexpected":0}'::jsonb,'complete counts reconcile');
-- Unexpected.
select is(workspace_api.official_section_completeness('57000000-0000-0000-0000-000000000001','57000000-0000-0000-0000-000000000022','97','997')->'completeness'->>'status','partial','a mesa outside the catalogue is never complete');
select is(workspace_api.official_section_completeness('57000000-0000-0000-0000-000000000001','57000000-0000-0000-0000-000000000022','97','997')->'completeness'->'counts'->>'unexpected','1','unexpected mesas are counted');
-- Unknown: no catalogue for the election.
create temporary table unknown_payload as select workspace_api.official_section_completeness('57000000-0000-0000-0000-000000000011','57000000-0000-0000-0000-000000000002','97','997') p;
select is((select p->'completeness'->>'status' from unknown_payload),'unknown','an election without a catalogue is unknown, never complete');
select is((select p->'completeness'->>'reason' from unknown_payload),'no_expected_catalogue','unknown states its reason');
select ok((select p->'completeness'->'counts' = 'null'::jsonb from unknown_payload),'unknown carries no counts, never 0 or 100 percent');
reset role;
select * from finish();
rollback;
