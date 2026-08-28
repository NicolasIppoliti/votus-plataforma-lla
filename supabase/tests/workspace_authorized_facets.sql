begin;
grant workspace_admin_owner,workspace_context_owner to current_user;
insert into public.election(id,year,round) values('50000000-0000-0000-0000-000000000001',2099,'generales');
insert into public.category(id,name) values('51000000-0000-0000-0000-000000000001','AUTHORIZED FACET TEST'),('51000000-0000-0000-0000-000000000002','PBA DISTRITO AS SECTION');
insert into public.jurisdiction(id,distrito_code,seccion_code,seccion_name,distrito_name) values
 ('52000000-0000-0000-0000-000000000001','02','027','Exact','Buenos Aires'),('52000000-0000-0000-0000-000000000002','02',null,null,null);
insert into public.result_row(election_id,jurisdiction_id,category_id,granularity,list_id,votes,source_kind,archive_entry_id,source_row_index) values
 ('50000000-0000-0000-0000-000000000001','52000000-0000-0000-0000-000000000001','51000000-0000-0000-0000-000000000001','seccion','A',1,'official','authorized-official',1),
 ('50000000-0000-0000-0000-000000000001','52000000-0000-0000-0000-000000000001','51000000-0000-0000-0000-000000000001','seccion','B',1,'fiscalizacion','unauthorized-fiscal',2),
 ('50000000-0000-0000-0000-000000000001','52000000-0000-0000-0000-000000000002','51000000-0000-0000-0000-000000000001','distrito','C',1,'official','unauthorized-coarse',3),
 ('50000000-0000-0000-0000-000000000001','52000000-0000-0000-0000-000000000001','51000000-0000-0000-0000-000000000002','distrito','D',1,'official','authorized-pba-distrito',4),
 ('50000000-0000-0000-0000-000000000001','52000000-0000-0000-0000-000000000001','51000000-0000-0000-0000-000000000002','distrito','E',2,'official','authorized-pba-dedup',5);
set local role workspace_admin_owner;
insert into workspace_private.organization(id,slug,display_name,entitlement_revision) values
 ('40000000-0000-0000-0000-000000000001','facets-one','Facets One',1),('40000000-0000-0000-0000-000000000002','facets-two','Facets Two',1);
insert into workspace_private.organization_membership(organization_id,user_id,membership_revision,revoked_at) values
 ('40000000-0000-0000-0000-000000000001','41000000-0000-0000-0000-000000000001',1,null),
 ('40000000-0000-0000-0000-000000000002','41000000-0000-0000-0000-000000000001',1,null),
 ('40000000-0000-0000-0000-000000000001','41000000-0000-0000-0000-000000000002',2,statement_timestamp());
insert into workspace_private.section_scope values('02','027'),('02','028');
insert into workspace_private.organization_section_entitlement(organization_id,distrito_code,seccion_code) values
 ('40000000-0000-0000-0000-000000000001','02','027'),('40000000-0000-0000-0000-000000000002','02','028');
reset role; set local role workspace_context_owner;
insert into workspace_private.workspace_context(session_id,user_id,organization_id,membership_revision,entitlement_revision,context_revision,fixed_expires_at,revoked_at) values
 ('42000000-0000-0000-0000-000000000001','41000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001',1,1,1,statement_timestamp()+interval '1 hour',null),
 ('42000000-0000-0000-0000-000000000002','41000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000002',1,1,1,statement_timestamp()+interval '1 hour',null),
 ('42000000-0000-0000-0000-000000000003','41000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001',1,0,1,statement_timestamp()+interval '1 hour',null),
 ('42000000-0000-0000-0000-000000000004','41000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001',1,1,1,statement_timestamp()+interval '1 hour',statement_timestamp()),
 ('42000000-0000-0000-0000-000000000005','41000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001',1,1,1,statement_timestamp()-interval '1 second',null),
 ('42000000-0000-0000-0000-000000000006','41000000-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000001',2,1,1,statement_timestamp()+interval '1 hour',null),
 ('42000000-0000-0000-0000-000000000007','41000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001',1,1,1,statement_timestamp()+interval '1 hour',null);
reset role;
select plan(17);
select ok((select strpos(pg_get_functiondef('workspace_private.authorized_section_scopes()'::regprocedure),'trusted_workspace_claims')<strpos(pg_get_functiondef('workspace_private.authorized_section_scopes()'::regprocedure),'from workspace_private.workspace_context')),'trusted claims are captured before relation access');
select ok((select pg_get_functiondef('workspace_api.official_facets()'::regprocedure) like '%source_kind=''official''%' and pg_get_functiondef('workspace_api.official_facets()'::regprocedure) like '%j.seccion_code is not null%' and pg_get_functiondef('workspace_api.official_facets()'::regprocedure) not like '%fiscalizacion%'),'facets use only exact official source rows without a raw fallback');
select ok(not has_function_privilege('anon','workspace_api.official_facets()','EXECUTE') and not has_function_privilege('service_role','workspace_api.official_facets()','EXECUTE') and has_function_privilege('authenticated','workspace_api.official_facets()','EXECUTE'),'only authenticated reaches the official facets interface');
select ok(to_regclass('public.result_row_authorized_official_facets_idx') is not null and to_regclass('workspace_private.organization_section_entitlement_active_scope_idx') is not null,'official and entitlement indexes cover bounded discovery');
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub','41000000-0000-0000-0000-000000000001','session_id','42000000-0000-0000-0000-000000000001','exp',floor(extract(epoch from statement_timestamp()+interval '10 minutes')))::text,true);
select is(workspace_api.official_facets()->>'status','ok','active context is authorized');
select is((workspace_api.official_facets()->>'total')::bigint,2::bigint,'official exact rows include normalized PBA distrito sections but exclude fiscalizacion and coarse province rows');
select ok(not (workspace_api.official_facets()->'truncated')::boolean and jsonb_array_length(workspace_api.official_facets()->'facets')=2,'authorized payload is bounded and complete');
select is(workspace_api.official_facets()->'facets'->0->>'distrito_name','Buenos Aires','district name stays on an authorized exact tuple');
select is(workspace_api.official_facets()->'facets'->0->>'seccion_name','Exact','section name stays on an authorized exact tuple');
select ok(not exists(select 1 from jsonb_array_elements(workspace_api.official_facets()->'facets') f where f->>'distrito_code'<>'02' or f->>'seccion_code'<>'027'),'name metadata does not widen exact-section membership');
reset role; insert into public.category select gen_random_uuid(),'AUTHORIZED FACET OVERFLOW '||g from generate_series(1,199) g;
insert into public.result_row(election_id,jurisdiction_id,category_id,granularity,list_id,votes,source_kind,archive_entry_id,source_row_index) select '50000000-0000-0000-0000-000000000001','52000000-0000-0000-0000-000000000001',id,'seccion','Z',1,'official','authorized-overflow',row_number() over() from public.category where name like 'AUTHORIZED FACET OVERFLOW %';
set local role authenticated; select set_config('request.jwt.claims',jsonb_build_object('sub','41000000-0000-0000-0000-000000000001','session_id','42000000-0000-0000-0000-000000000001','exp',floor(extract(epoch from statement_timestamp()+interval '10 minutes')))::text,true);
select is(workspace_api.official_facets(),jsonb_build_object('status','payload_too_large','facets','[]'::jsonb,'total',201,'truncated',true),'overflow fails closed without returning a partial facet page');
select set_config('request.jwt.claims',jsonb_build_object('sub','41000000-0000-0000-0000-000000000001','session_id','42000000-0000-0000-0000-000000000002','exp',floor(extract(epoch from statement_timestamp()+interval '10 minutes')))::text,true);
select is(workspace_api.official_facets(),jsonb_build_object('status','ok','facets','[]'::jsonb,'total',0,'truncated',false),'a second organization can be authorized with an empty result');
select set_config('request.jwt.claims',jsonb_build_object('sub','41000000-0000-0000-0000-000000000001','session_id','42000000-0000-0000-0000-000000000003','exp',floor(extract(epoch from statement_timestamp()+interval '10 minutes')))::text,true);
select is(workspace_api.official_facets()->>'status','context_stale','stale entitlement revision is denied distinctly');
select set_config('request.jwt.claims',jsonb_build_object('sub','41000000-0000-0000-0000-000000000001','session_id','42000000-0000-0000-0000-000000000004','exp',floor(extract(epoch from statement_timestamp()+interval '10 minutes')))::text,true);
select is(workspace_api.official_facets()->>'status','context_revoked','revoked session context is denied distinctly');
select set_config('request.jwt.claims',jsonb_build_object('sub','41000000-0000-0000-0000-000000000001','session_id','42000000-0000-0000-0000-000000000005','exp',floor(extract(epoch from statement_timestamp()+interval '10 minutes')))::text,true);
select is(workspace_api.official_facets()->>'status','context_expired','expired fixed context is denied distinctly');
select set_config('request.jwt.claims',jsonb_build_object('sub','41000000-0000-0000-0000-000000000002','session_id','42000000-0000-0000-0000-000000000006','exp',floor(extract(epoch from statement_timestamp()+interval '10 minutes')))::text,true);
select is(workspace_api.official_facets()->>'status','membership_revoked','revoked membership is denied distinctly');
select set_config('request.jwt.claims',jsonb_build_object('sub','41000000-0000-0000-0000-000000000002','session_id','42000000-0000-0000-0000-000000000007','exp',floor(extract(epoch from statement_timestamp()+interval '10 minutes')))::text,true);
select is(workspace_api.official_facets()->>'status','claims_mismatch','session user mismatch is denied distinctly');
select * from finish();
rollback;
