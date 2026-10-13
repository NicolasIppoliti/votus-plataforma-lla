begin;
select plan(42);
select ok(to_regclass('public.official_mesa_circuit_membership') is not null,'independent circuit membership exists');
select ok(to_regclass('public.official_mesa_circuit_membership_quarantine') is not null,'excluded membership survives as lineage');
select ok(to_regprocedure('workspace_api.official_section_circuit_outcomes(uuid,uuid,text,text)') is not null,'authorized circuit outcomes RPC exists');
select ok(not exists(select from unnest(array['anon','authenticated','service_role']) r,
 unnest(array['public.official_mesa_circuit_membership','public.official_mesa_circuit_membership_quarantine']) t,
 unnest(array['SELECT','INSERT','UPDATE','DELETE']) p where has_table_privilege(r,t,p)),'no client or service_role table privileges');
select ok((select bool_and(c.relrowsecurity) from pg_class c where c.oid in ('public.official_mesa_circuit_membership'::regclass,'public.official_mesa_circuit_membership_quarantine'::regclass)),'membership and exclusions have RLS');
select is((select count(*) from pg_policies where tablename in ('official_mesa_circuit_membership','official_mesa_circuit_membership_quarantine') and roles=array['workspace_query_owner']::name[] and cmd='SELECT' and qual='true'),2::bigint,'explicit query-owner policies');
select ok(has_function_privilege('authenticated','workspace_api.official_section_circuit_outcomes(uuid,uuid,text,text)','EXECUTE')
 and not has_function_privilege('anon','workspace_api.official_section_circuit_outcomes(uuid,uuid,text,text)','EXECUTE')
 and not has_function_privilege('service_role','workspace_api.official_section_circuit_outcomes(uuid,uuid,text,text)','EXECUTE'),'only authenticated executes');
select ok(not exists(select from pg_proc p cross join lateral aclexplode(p.proacl) a where p.oid='workspace_api.official_section_circuit_outcomes(uuid,uuid,text,text)'::regprocedure and a.grantee=0),'PUBLIC cannot execute');
select ok((select r.rolname='workspace_query_owner' and p.prosecdef and regexp_replace(array_to_string(p.proconfig,','),'\s+','','g')='search_path=pg_catalog,workspace_api,public,pg_temp' from pg_proc p join pg_roles r on r.oid=p.proowner where p.oid='workspace_api.official_section_circuit_outcomes(uuid,uuid,text,text)'::regprocedure),'security definer owner and pinned path');
select ok((select strpos(d,'workspace_api.official_result(')<strpos(d,'public.official_mesa_circuit_membership') from (select pg_get_functiondef('workspace_api.official_section_circuit_outcomes(uuid,uuid,text,text)'::regprocedure) d) f),'authorization precedes membership reads');
select ok((select bool_and(has_table_privilege('etl_writer',t,'SELECT') and has_table_privilege('etl_writer',t,'INSERT') and has_table_privilege('etl_writer',t,'DELETE') and not has_table_privilege('etl_writer',t,'UPDATE')) from unnest(array['public.official_mesa_circuit_membership','public.official_mesa_circuit_membership_quarantine']) t),'ETL can replace but not update membership');
select ok((select bool_and(has_table_privilege('workspace_query_owner',t,'SELECT') and not has_table_privilege('workspace_query_owner',t,'INSERT')) from unnest(array['public.official_mesa_circuit_membership','public.official_mesa_circuit_membership_quarantine']) t),'query owner reads without writing');
grant workspace_admin_owner,workspace_context_owner to current_user;
insert into public.election(id,year,round) values('58000000-0000-0000-0000-000000000001',2098,'legislativas');
insert into public.category(id,name) values('58000000-0000-0000-0000-000000000002','CIRCUIT OUTCOMES');
insert into public.jurisdiction(id,distrito_code,seccion_code,circuito_code,mesa_code) values
 ('58000000-0000-0000-0000-000000000003','98','998','00248',1),
 ('58000000-0000-0000-0000-000000000013','98','998','0248B',2),
 ('58000000-0000-0000-0000-000000000023','98','998','0248B',3);
insert into public.result_row(election_id,jurisdiction_id,category_id,granularity,list_id,votes,source_kind,archive_entry_id,source_row_index) values
 ('58000000-0000-0000-0000-000000000001','58000000-0000-0000-0000-000000000003','58000000-0000-0000-0000-000000000002','mesa','unmapped-fixture',10,'official','national/2098-test',1),
 ('58000000-0000-0000-0000-000000000001','58000000-0000-0000-0000-000000000013','58000000-0000-0000-0000-000000000002','mesa','unmapped-fixture',20,'official','national/2098-test',2),
 ('58000000-0000-0000-0000-000000000001','58000000-0000-0000-0000-000000000003','58000000-0000-0000-0000-000000000002','mesa','fiscal-only',999,'fiscalizacion','fiscalizacion/2098-test',3);
insert into public.official_expected_mesa select '58000000-0000-0000-0000-000000000001','national/2098-test','98','998',n,'NATIVOS',300,n from generate_series(1,3) n;
insert into public.official_mesa_circuit_membership select '58000000-0000-0000-0000-000000000001','geography/test','98','998',case when n=1 then '00248' else '0248B' end,case when n=1 then '0248' else '248B' end,n,n from generate_series(1,3) n;
insert into public.official_mesa_count_status values
 ('58000000-0000-0000-0000-000000000001','national/2098-test','58000000-0000-0000-0000-000000000002','98','998','00248',1,'counted'),
 ('58000000-0000-0000-0000-000000000001','national/2098-test','58000000-0000-0000-0000-000000000002','98','998','0248B',2,'not_counted');
set local role workspace_admin_owner;
insert into workspace_private.organization(id,slug,display_name,entitlement_revision) values('58000000-0000-0000-0000-000000000004','circuit-outcomes','Circuit outcomes',1);
insert into workspace_private.organization_membership(organization_id,user_id,membership_revision) values('58000000-0000-0000-0000-000000000004','58000000-0000-0000-0000-000000000005',1);
insert into workspace_private.section_scope values('98','998');
insert into workspace_private.organization_section_entitlement(organization_id,distrito_code,seccion_code) values('58000000-0000-0000-0000-000000000004','98','998');
reset role; set local role workspace_context_owner;
insert into workspace_private.workspace_context(session_id,user_id,organization_id,membership_revision,entitlement_revision,context_revision,fixed_expires_at) values('58000000-0000-0000-0000-000000000006','58000000-0000-0000-0000-000000000005','58000000-0000-0000-0000-000000000004',1,1,1,statement_timestamp()+interval '1 hour');
reset role; set local role authenticated;
select throws_ok($q$select workspace_api.official_section_circuit_outcomes('58000000-0000-0000-0000-000000000001','58000000-0000-0000-0000-000000000002','98','998')$q$,'VOT01','VOT01','missing session denied');
select set_config('request.jwt.claims',jsonb_build_object('sub','58000000-0000-0000-0000-000000000005','session_id','58000000-0000-0000-0000-000000000006','exp',floor(extract(epoch from statement_timestamp()+interval '10 minutes')))::text,true);
select is(workspace_api.official_section_circuit_outcomes('58000000-0000-0000-0000-000000000001','58000000-0000-0000-0000-000000000002','98','997'),workspace_api.official_result('58000000-0000-0000-0000-000000000001','58000000-0000-0000-0000-000000000002','98','997'),'scope denial is returned unchanged');
select is(workspace_api.official_section_circuit_outcomes('58000000-0000-0000-0000-000000000001','58000000-0000-0000-0000-000000000002','98',null)->>'authorization_status','scope_required','exact section required');
create temporary table circuit_payload as select workspace_api.official_section_circuit_outcomes('58000000-0000-0000-0000-000000000001','58000000-0000-0000-0000-000000000002','98','998') p;
select is((select p->>'circuit_membership' from circuit_payload),'known','independent membership known');
select is((select jsonb_array_length(p->'circuits') from circuit_payload),2,'one entry per independent circuit');
select is((select p->'circuits'->0->>'status' from circuit_payload),'complete','fully counted circuit complete');
select is((select p->'circuits'->1->>'status' from circuit_payload),'partial','not counted and missing circuit partial');
select is((select p->'circuits'->1->'counts' from circuit_payload),'{"expected":2,"counted":0,"not_counted":1,"missing":1,"unexpected":0,"quarantined":0}'::jsonb,'all completeness reasons separate');
select is((select p->'circuits'->0->>'positive_total' from circuit_payload),'10','fiscalizacion votes never mixed');
select is((select p->'circuits'->0->'parties'->0->>'identity_status' from circuit_payload),'unmapped','unmapped identity explicit');
select is((select p->'circuits'->0->'parties'->0->>'list_id' from circuit_payload),'unmapped-fixture','unmapped list identity preserved');
reset role;
-- Canonical groups merge internal/source list ids exactly as official_result does.
savepoint canonical_groups;
insert into public.party_canonical(id,display_name) values('circuit-parent','Circuit parent');
insert into public.party_mapping(year,jurisdiction,category,list_id,canonical_party_id) values
 (2098,'national','CIRCUIT OUTCOMES','mapped-a','circuit-parent'),
 (2098,'national','CIRCUIT OUTCOMES','mapped-b','circuit-parent');
insert into public.result_row(election_id,jurisdiction_id,category_id,granularity,list_id,votes,source_kind,archive_entry_id,source_row_index)
 select '58000000-0000-0000-0000-000000000001','58000000-0000-0000-0000-000000000003','58000000-0000-0000-0000-000000000002','mesa',list_id,votes,'official','national/2098-test',n
 from (values('mapped-a',12,4),('mapped-b',13,5)) v(list_id,votes,n);
set local role authenticated;
select is(workspace_api.official_section_circuit_outcomes('58000000-0000-0000-0000-000000000001','58000000-0000-0000-0000-000000000002','98','998')->'circuits'->0->'parties'->0,
 '{"canonical_party_id":"circuit-parent","display_name":"Circuit parent","identity_status":"canonical","list_id":null,"votes":25}'::jsonb,'all lists mapped to one canonical parent merge');
select is(workspace_api.official_section_circuit_outcomes('58000000-0000-0000-0000-000000000001','58000000-0000-0000-0000-000000000002','98','998')->'circuits'->0->>'positive_total','35','positive total includes every canonical and unmapped group');
rollback to savepoint canonical_groups;
-- Unexpected statuses use their source circuito only for anomaly attribution.
savepoint unexpected_status;
insert into public.official_mesa_count_status values('58000000-0000-0000-0000-000000000001','national/2098-test','58000000-0000-0000-0000-000000000002','98','998','00248',4,'counted');
set local role authenticated;
select is(workspace_api.official_section_circuit_outcomes('58000000-0000-0000-0000-000000000001','58000000-0000-0000-0000-000000000002','98','998')->'circuits'->0->'counts'->>'unexpected','1','unexpected status is not added to expected');
select is(workspace_api.official_section_circuit_outcomes('58000000-0000-0000-0000-000000000001','58000000-0000-0000-0000-000000000002','98','998')->'circuits'->0->>'status','partial','unexpected status blocks complete');
rollback to savepoint unexpected_status;
savepoint category_quarantine;
insert into public.category(id,name) values('58000000-0000-0000-0000-000000000012','OTHER CIRCUIT CATEGORY');
insert into public.official_mesa_completeness_quarantine(election_id,archive_entry_id,scope,category_id,distrito_code,seccion_code,mesa_code,reason) values('58000000-0000-0000-0000-000000000001','national/2098-test','status','58000000-0000-0000-0000-000000000012','98','998',1,'other category');
set local role authenticated;
select is(workspace_api.official_section_circuit_outcomes('58000000-0000-0000-0000-000000000001','58000000-0000-0000-0000-000000000002','98','998')->'circuits'->0->>'status','complete','unrelated status category does not block');
reset role;
update public.official_mesa_completeness_quarantine set scope='catalogue';
set local role authenticated;
select is(workspace_api.official_section_circuit_outcomes('58000000-0000-0000-0000-000000000001','58000000-0000-0000-0000-000000000002','98','998')->'circuits'->0->>'status','partial','catalogue quarantine applies to every category');
rollback to savepoint category_quarantine;
savepoint unattributed_quarantine;
insert into public.official_mesa_completeness_quarantine(election_id,archive_entry_id,scope,reason) values('58000000-0000-0000-0000-000000000001','national/2098-test','status','unreadable identity');
set local role authenticated;
select is(workspace_api.official_section_circuit_outcomes('58000000-0000-0000-0000-000000000001','58000000-0000-0000-0000-000000000002','98','998')->'unassigned'->>'completeness_quarantines','1','election-unattributed null-category quarantine blocks');
select is(workspace_api.official_section_circuit_outcomes('58000000-0000-0000-0000-000000000001','58000000-0000-0000-0000-000000000002','98','998')->'circuits'->0->>'status','partial','unattributed quarantine forces complete circuit partial');
reset role;
insert into public.official_mesa_completeness_quarantine(election_id,archive_entry_id,scope,reason) values('58000000-0000-0000-0000-000000000001','national/2098-test','status','absent results cargo_nombre');
set local role authenticated;
select is(workspace_api.official_section_circuit_outcomes('58000000-0000-0000-0000-000000000001','58000000-0000-0000-0000-000000000002','98','998')->'unassigned'->>'completeness_quarantines','2','every unassigned completeness quarantine is counted');
select is(workspace_api.official_section_circuit_outcomes('58000000-0000-0000-0000-000000000001','58000000-0000-0000-0000-000000000002','98','998')->'unassigned'->'completeness_quarantine_reasons',
 '{"absent results cargo_nombre":1,"unreadable identity":1}'::jsonb,'unassigned completeness quarantines are reported per reason');
reset role;
rollback to savepoint unattributed_quarantine;
insert into public.official_mesa_completeness_quarantine(election_id,archive_entry_id,scope,category_id,distrito_code,seccion_code,mesa_code,reason) values
 ('58000000-0000-0000-0000-000000000001','national/2098-test','status','58000000-0000-0000-0000-000000000002','98','998',1,'conflict');
set local role authenticated;
select is(workspace_api.official_section_circuit_outcomes('58000000-0000-0000-0000-000000000001','58000000-0000-0000-0000-000000000002','98','998')->'circuits'->0->'counts'->>'quarantined','1','readable membership mesa quarantine attributed');
reset role;
update public.official_mesa_completeness_quarantine set mesa_code=null;
set local role authenticated;
select is(workspace_api.official_section_circuit_outcomes('58000000-0000-0000-0000-000000000001','58000000-0000-0000-0000-000000000002','98','998')->'unassigned'->>'completeness_quarantines','1','unreadable quarantine reported unassigned');
select is(workspace_api.official_section_circuit_outcomes('58000000-0000-0000-0000-000000000001','58000000-0000-0000-0000-000000000002','98','998')->'circuits'->0->>'status','partial','unassigned quarantine blocks every circuit');
reset role;
delete from public.official_mesa_completeness_quarantine where election_id='58000000-0000-0000-0000-000000000001';
delete from public.official_mesa_circuit_membership where mesa_code=3;
insert into public.official_mesa_circuit_membership_quarantine(election_id,archive_entry_id,distrito_code,seccion_code,mesa_code,reason) values('58000000-0000-0000-0000-000000000001','geography/test','98','998',3,'overlapping_or_duplicate_ranges');
set local role authenticated;
select is(workspace_api.official_section_circuit_outcomes('58000000-0000-0000-0000-000000000001','58000000-0000-0000-0000-000000000002','98','998')->'unassigned'->>'catalogue_mesas_without_membership','1','excluded catalogue mesa visible');
select is(workspace_api.official_section_circuit_outcomes('58000000-0000-0000-0000-000000000001','58000000-0000-0000-0000-000000000002','98','998')->'unassigned'->>'membership_quarantined_mesas','1','membership conflict survives exclusion');
select is(workspace_api.official_section_circuit_outcomes('58000000-0000-0000-0000-000000000001','58000000-0000-0000-0000-000000000002','98','998')->'circuits'->0->>'status','partial','shrinking expected membership never produces complete');
reset role;
delete from public.official_mesa_circuit_membership where election_id='58000000-0000-0000-0000-000000000001';
set local role authenticated;
select is(workspace_api.official_section_circuit_outcomes('58000000-0000-0000-0000-000000000001','58000000-0000-0000-0000-000000000002','98','998')->>'circuit_membership','unknown','absent membership unknown');
select is(workspace_api.official_section_circuit_outcomes('58000000-0000-0000-0000-000000000001','58000000-0000-0000-0000-000000000002','98','998')->'circuits','[]'::jsonb,'unknown never fabricates circuits');
reset role;
-- >200 independent circuits refuses, rather than silently truncating.
insert into public.official_mesa_circuit_membership select '58000000-0000-0000-0000-000000000001','geography/test','98','998',lpad(n::text,5,'0'),n::text,n,n from generate_series(1,201) n;
set local role authenticated;
select is(workspace_api.official_section_circuit_outcomes('58000000-0000-0000-0000-000000000001','58000000-0000-0000-0000-000000000002','98','998')->>'status','payload_too_large','more than 200 circuits refused');
reset role;
select * from finish();
rollback;
