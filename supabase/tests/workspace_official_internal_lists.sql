begin;
select plan(29);
select ok(to_regprocedure('workspace_api.official_internal_lists(uuid,uuid,text,text)') is not null,'authorized internal-list RPC exists');
grant workspace_admin_owner,workspace_context_owner to current_user;
insert into public.election(id,year,round) values('55000000-0000-0000-0000-000000000001',2098,'paso');
insert into public.category(id,name) values('55000000-0000-0000-0000-000000000002','INTERNAL LIST TEST');
insert into public.jurisdiction(id,distrito_code,seccion_code,circuito_code,mesa_code) values
 ('55000000-0000-0000-0000-000000000003','98','998','00001',1),
 ('55000000-0000-0000-0000-000000000009','98','998','00001',2);
insert into public.party_canonical(id,display_name) values('internal-parent-a','Parent A'),('internal-parent-b','Parent B');
insert into public.party_mapping(year,jurisdiction,category,list_id,canonical_party_id) values
 (2098,'national','INTERNAL LIST TEST','132-3007','internal-parent-a'),
 (2098,'national','INTERNAL LIST TEST','132-3008','internal-parent-a'),
 (2098,'national','INTERNAL LIST TEST','135-3016','internal-parent-b');
insert into public.list_identity(year,jurisdiction,category,list_id,source_name) values
 (2098,'national','INTERNAL LIST TEST','132-3007','Internal A1'),
 (2098,'national','INTERNAL LIST TEST','132-3008','Internal A2'),
 (2098,'national','INTERNAL LIST TEST','135-3016','Internal B');
insert into public.result_row(election_id,jurisdiction_id,category_id,granularity,list_id,votes,source_kind,archive_entry_id,source_row_index)
 select '55000000-0000-0000-0000-000000000001','55000000-0000-0000-0000-000000000003',
 '55000000-0000-0000-0000-000000000002','mesa',list_id,votes,'official','national/2098-paso',n
 from (values ('132-3007',10,1),('132-3008',0,2),('135-3016',20,3),('999-9999',5,4)) v(list_id,votes,n);
-- Same list on another mesa is legitimate aggregation, not an identity conflict.
insert into public.result_row(election_id,jurisdiction_id,category_id,granularity,list_id,votes,source_kind,archive_entry_id,source_row_index) values
 ('55000000-0000-0000-0000-000000000001','55000000-0000-0000-0000-000000000009','55000000-0000-0000-0000-000000000002','mesa','132-3007',2,'official','national/2098-paso',5),
 ('55000000-0000-0000-0000-000000000001','55000000-0000-0000-0000-000000000003','55000000-0000-0000-0000-000000000002','mesa','sentinel',987654,'fiscalizacion','internal/test',1);
set local role workspace_admin_owner;
insert into workspace_private.organization(id,slug,display_name,entitlement_revision) values('55000000-0000-0000-0000-000000000004','internal-lists','Internal Lists',1);
insert into workspace_private.organization_membership(organization_id,user_id,membership_revision) values('55000000-0000-0000-0000-000000000004','55000000-0000-0000-0000-000000000005',1);
insert into workspace_private.section_scope values('98','998');
insert into workspace_private.organization_section_entitlement(organization_id,distrito_code,seccion_code) values('55000000-0000-0000-0000-000000000004','98','998');
reset role; set local role workspace_context_owner;
insert into workspace_private.workspace_context(session_id,user_id,organization_id,membership_revision,entitlement_revision,context_revision,fixed_expires_at) values('55000000-0000-0000-0000-000000000006','55000000-0000-0000-0000-000000000005','55000000-0000-0000-0000-000000000004',1,1,1,statement_timestamp()+interval '1 hour');
reset role;
select ok(has_function_privilege('authenticated','workspace_api.official_internal_lists(uuid,uuid,text,text)','EXECUTE') and not has_function_privilege('anon','workspace_api.official_internal_lists(uuid,uuid,text,text)','EXECUTE') and not has_function_privilege('service_role','workspace_api.official_internal_lists(uuid,uuid,text,text)','EXECUTE'),'only authenticated may execute');
select ok(not exists(select from pg_proc p cross join lateral aclexplode(p.proacl) a where p.oid='workspace_api.official_internal_lists(uuid,uuid,text,text)'::regprocedure and a.grantee=0 and a.privilege_type='EXECUTE'),'PUBLIC cannot execute');
select ok((select r.rolname='workspace_query_owner' and p.prosecdef and regexp_replace(array_to_string(p.proconfig,','),'\s+','','g')='search_path=pg_catalog,workspace_api,public,pg_temp' from pg_proc p join pg_roles r on r.oid=p.proowner where p.oid='workspace_api.official_internal_lists(uuid,uuid,text,text)'::regprocedure),'query-owner security definer pins its search path');
select ok(has_table_privilege('workspace_query_owner','public.list_identity','SELECT') and not has_table_privilege('authenticated','public.list_identity','SELECT') and not has_table_privilege('anon','public.list_identity','SELECT') and not has_table_privilege('service_role','public.list_identity','SELECT'),'list identity lookup is not a direct client read');
select ok(exists(select from pg_policies where schemaname='public' and tablename='list_identity' and policyname='workspace_query_owner_list_identity_select' and roles=array['workspace_query_owner']::name[] and cmd='SELECT' and qual='true'),'list identity has an explicit query-owner SELECT policy');
set local role authenticated;
select throws_ok($query$select workspace_api.official_internal_lists('55000000-0000-0000-0000-000000000001','55000000-0000-0000-0000-000000000002','98','998')$query$,'VOT01','VOT01','missing session is denied by the trusted-claims guard');
select set_config('request.jwt.claims',jsonb_build_object('sub','55000000-0000-0000-0000-000000000005','session_id','55000000-0000-0000-0000-000000000006','exp',floor(extract(epoch from statement_timestamp()+interval '10 minutes')))::text,true);
select is(workspace_api.official_internal_lists('55000000-0000-0000-0000-000000000001','55000000-0000-0000-0000-000000000002','98','997')->>'authorization_status','scope_denied','unauthorized exact section is denied');
select is(workspace_api.official_internal_lists('55000000-0000-0000-0000-000000000001','55000000-0000-0000-0000-000000000002','98',null)->>'authorization_status','scope_required','missing exact section is denied');
create temporary table internal_payload as select workspace_api.official_internal_lists('55000000-0000-0000-0000-000000000001','55000000-0000-0000-0000-000000000002','98','998') p;
select is((select p->>'status' from internal_payload),'ok','authorized list projection succeeds');
select is((select p->>'positive_total' from internal_payload),'37','positive total excludes fiscalizacion');
select is((select p->'lists' from internal_payload),
 '[{"canonical_party_id":"internal-parent-a","display_name":"Parent A","list_id":"132-3007","source_name":"Internal A1","identity_status":"canonical","votes":12},{"canonical_party_id":"internal-parent-a","display_name":"Parent A","list_id":"132-3008","source_name":"Internal A2","identity_status":"canonical","votes":0},{"canonical_party_id":"internal-parent-b","display_name":"Parent B","list_id":"135-3016","source_name":"Internal B","identity_status":"canonical","votes":20},{"canonical_party_id":null,"display_name":null,"list_id":"999-9999","source_name":null,"identity_status":"unmapped","votes":5}]'::jsonb,'exact two-list parent, zero list, single-list parent and explicit unmapped list');
select is((select p->'non_positive' from internal_payload),'{"status":"unavailable","reason":"not_reloaded"}'::jsonb,'non-positive kinds are unavailable until reloaded, never measured empty or zero');
select ok((select p->>'source_kind'='official' and p->>'source_granularity'='mesa' and p->>'level'='seccion' and p->>'truncated'='false' and p::text not like '%sentinel%' and p::text not like '%987654%' from internal_payload),'official source and granularity are visible without sentinel leakage');
select is(workspace_api.official_result('55000000-0000-0000-0000-000000000001','55000000-0000-0000-0000-000000000002','98','998')->'parties',
 '[{"identity_status":"canonical","canonical_party_id":"internal-parent-b","display_name":"Parent B","list_id":null,"votes":20,"vote_share":"0.54054054054054054054"},{"identity_status":"canonical","canonical_party_id":"internal-parent-a","display_name":"Parent A","list_id":null,"votes":12,"vote_share":"0.32432432432432432432"},{"identity_status":"unmapped","canonical_party_id":null,"display_name":null,"list_id":"999-9999","votes":5,"vote_share":"0.13513513513513513514"}]'::jsonb,'existing official_result still aggregates by parent unchanged');
reset role;
savepoint measured_kinds;
insert into public.result_row(election_id,jurisdiction_id,category_id,granularity,list_id,votes,source_kind,archive_entry_id,source_row_index,vote_kind)
 select '55000000-0000-0000-0000-000000000001','55000000-0000-0000-0000-000000000003',
 '55000000-0000-0000-0000-000000000002','mesa',null,votes,'official','national/2098-paso',n,kind
 from (values ('EN BLANCO',2121,20),('NULO',319,21),('IMPUGNADO',12,22),('RECURRIDO',4,23),('COMANDO',12,24)) v(kind,votes,n);
set local role authenticated;
select is(workspace_api.official_internal_lists('55000000-0000-0000-0000-000000000001','55000000-0000-0000-0000-000000000002','98','998')->'non_positive'->>'reason','not_reloaded','incomplete kind coverage across mesas is not presented as a section total');
reset role;
insert into public.result_row(election_id,jurisdiction_id,category_id,granularity,list_id,votes,source_kind,archive_entry_id,source_row_index,vote_kind)
 select '55000000-0000-0000-0000-000000000001','55000000-0000-0000-0000-000000000009',
 '55000000-0000-0000-0000-000000000002','mesa',null,0,'official','national/2098-paso',n,kind
 from (values ('EN BLANCO',25),('NULO',26),('IMPUGNADO',27),('RECURRIDO',28),('COMANDO',29)) v(kind,n);
set local role authenticated;
select is(workspace_api.official_internal_lists('55000000-0000-0000-0000-000000000001','55000000-0000-0000-0000-000000000002','98','998')->'non_positive',
 '{"status":"available","totals":{"EN BLANCO":2121,"NULO":319,"IMPUGNADO":12,"RECURRIDO":4,"COMANDO":12}}'::jsonb,'real totals remain separate per kind');
select is(workspace_api.official_internal_lists('55000000-0000-0000-0000-000000000001','55000000-0000-0000-0000-000000000002','98','998')->>'positive_total','37','non-positive rows never inflate list positives');
reset role;
insert into public.result_row(election_id,jurisdiction_id,category_id,granularity,votes,archive_entry_id,source_row_index,vote_kind)
 values('55000000-0000-0000-0000-000000000001','55000000-0000-0000-0000-000000000003','55000000-0000-0000-0000-000000000002','mesa',1,'national/2098-competing',1,'NULO');
set local role authenticated;
select is(workspace_api.official_internal_lists('55000000-0000-0000-0000-000000000001','55000000-0000-0000-0000-000000000002','98','998')->'non_positive'->>'reason','conflicting_non_positive_identity','competing non-positive archives refuse rather than sum');
rollback to savepoint measured_kinds;
-- The full curated key prevents competing parents for one list identity.
select throws_ok($query$insert into public.party_mapping(year,jurisdiction,category,list_id,canonical_party_id)
 values(2098,'national','INTERNAL LIST TEST','132-3007','internal-parent-b')$query$,
 '23505',null,'duplicate full mapping key is rejected rather than picked or summed');
select ok(not exists(select from unnest(array['anon','authenticated']) r,
 unnest(array['result_row','jurisdiction','election','category']) t
 where has_table_privilege(r,'public.'||t,'SELECT')),'clients cannot SELECT the underlying result tables');
savepoint oversized_names;
update public.list_identity set source_name=repeat('long internal list name ',2000)
 where year=2098 and jurisdiction='national' and category='INTERNAL LIST TEST';
set local role authenticated;
select ok((select p->>'status'='payload_too_large' and p->>'authorization_status'='authorized'
 and p->>'truncated'='true' and (p->>'total_bytes')::integer>120000
 and not (p ? 'lists') and not (p ? 'positive_total') and jsonb_object_length_safe.keys=4
 from (select workspace_api.official_internal_lists('55000000-0000-0000-0000-000000000001','55000000-0000-0000-0000-000000000002','98','998') p) x
 cross join lateral (select count(*) keys from jsonb_object_keys(p)) jsonb_object_length_safe),
 'oversized list names produce a bounded refusal, never truncated success');
rollback to savepoint oversized_names;
savepoint non_paso;
update public.election set round='generales' where id='55000000-0000-0000-0000-000000000001';
set local role authenticated;
select is(workspace_api.official_internal_lists('55000000-0000-0000-0000-000000000001','55000000-0000-0000-0000-000000000002','98','998'),
 '{"status":"source_unavailable","authorization_status":"authorized","truncated":false,"counts":{"unsupported_internal_list_source":5}}'::jsonb,
 'non-PASO official rows are refused with a reason count');
rollback to savepoint non_paso;
savepoint non_national;
update public.result_row set archive_entry_id='pba/2098-distrito-998'
 where election_id='55000000-0000-0000-0000-000000000001' and source_kind='official';
set local role authenticated;
select is(workspace_api.official_internal_lists('55000000-0000-0000-0000-000000000001','55000000-0000-0000-0000-000000000002','98','998'),
 '{"status":"source_unavailable","authorization_status":"authorized","truncated":false,"counts":{"unsupported_internal_list_source":5}}'::jsonb,
 'non-national official rows are refused with a reason count');
rollback to savepoint non_national;
savepoint mixed_levels;
update public.result_row set granularity='seccion'
 where election_id='55000000-0000-0000-0000-000000000001' and list_id='132-3008';
set local role authenticated;
select ok((select p->>'status'='source_unavailable' and p->>'authorization_status'='authorized'
 and p->'counts'->>'included_seccion_rows'='1' and p->'counts'->>'included_mesa_rows'='4'
 and not (p ? 'lists') from (select workspace_api.official_internal_lists('55000000-0000-0000-0000-000000000001','55000000-0000-0000-0000-000000000002','98','998') p) x),
 'mixed source levels are refused through the internal-list entry point');
rollback to savepoint mixed_levels;
-- Conflicting archives for the same NULL-safe natural identity must be refused.
insert into public.result_row(election_id,jurisdiction_id,category_id,granularity,list_id,votes,source_kind,archive_entry_id,source_row_index) values
 ('55000000-0000-0000-0000-000000000001','55000000-0000-0000-0000-000000000003','55000000-0000-0000-0000-000000000002','mesa','132-3007',99,'official','national/2098-paso-conflict',1);
set local role authenticated;
select is(workspace_api.official_internal_lists('55000000-0000-0000-0000-000000000001','55000000-0000-0000-0000-000000000002','98','998')->>'status','source_unavailable','conflicting source identities are refused');
select is(workspace_api.official_internal_lists('55000000-0000-0000-0000-000000000001','55000000-0000-0000-0000-000000000002','98','998')->'counts'->>'conflicting_result_identity','1','conflict breakdown is reported');
reset role;
update public.result_row set list_id=null where archive_entry_id like 'national/2098-paso%' and list_id='132-3007' and jurisdiction_id='55000000-0000-0000-0000-000000000003';
set local role authenticated;
select is(workspace_api.official_internal_lists('55000000-0000-0000-0000-000000000001','55000000-0000-0000-0000-000000000002','98','998')->'counts'->>'conflicting_result_identity','1','NULL list identities are also conflict-safe');
reset role;
select ok((select strpos(d,'workspace_api.official_result(')<strpos(d,'public.result_row') from (select pg_get_functiondef('workspace_api.official_internal_lists(uuid,uuid,text,text)'::regprocedure) d) f),'authorization envelope runs before result reads');
select * from finish();
rollback;
