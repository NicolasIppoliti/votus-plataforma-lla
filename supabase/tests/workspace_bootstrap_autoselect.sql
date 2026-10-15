begin;
grant workspace_admin_owner to current_user;
set local role workspace_admin_owner;
insert into workspace_private.organization(id,slug,display_name) values
 ('42500000-0000-0000-0000-000000000001','bootstrap-one','Bootstrap One'),
 ('42500000-0000-0000-0000-000000000002','bootstrap-two','Bootstrap Two');
insert into workspace_private.organization_membership(organization_id,user_id,membership_revision) values
 ('42500000-0000-0000-0000-000000000001','42510000-0000-0000-0000-000000000001',3),
 ('42500000-0000-0000-0000-000000000001','42510000-0000-0000-0000-000000000002',1),
 ('42500000-0000-0000-0000-000000000002','42510000-0000-0000-0000-000000000002',1);
reset role;
select plan(8);
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub','42510000-0000-0000-0000-000000000001','session_id','42520000-0000-0000-0000-000000000001','exp',floor(extract(epoch from statement_timestamp()+interval '10 minutes')))::text,true);
select is(workspace_api.bootstrap_workspace_context()->>'status','active','sole membership bootstraps active');
select is(workspace_api.bootstrap_workspace_context()->>'context_revision','2','repeat bootstrap preserves selected revision');
select set_config('request.jwt.claims',jsonb_build_object('sub','42510000-0000-0000-0000-000000000002','session_id','42520000-0000-0000-0000-000000000002','exp',floor(extract(epoch from statement_timestamp()+interval '10 minutes')))::text,true);
select is(workspace_api.bootstrap_workspace_context()->>'status','selection_required','multiple memberships require selection');
select set_config('request.jwt.claims',jsonb_build_object('sub','42510000-0000-0000-0000-000000000003','session_id','42520000-0000-0000-0000-000000000003','exp',floor(extract(epoch from statement_timestamp()+interval '10 minutes')))::text,true);
select is(workspace_api.bootstrap_workspace_context()->>'status','selection_required','zero memberships require selection');
reset role;
select is((select count(*) from workspace_private.workspace_audit_event where session_id='42520000-0000-0000-0000-000000000001' and action='context_switched' and outcome='succeeded' and reason_code='organization_switched'),1::bigint,'automatic selection is audited once');
set local role workspace_admin_owner;
-- An existing unselected context must stay unselected even after gaining a membership.
insert into workspace_private.organization_membership(organization_id,user_id,membership_revision) values
 ('42500000-0000-0000-0000-000000000001','42510000-0000-0000-0000-000000000003',1);
reset role;
set local role authenticated;
select is(workspace_api.bootstrap_workspace_context()->>'context_revision','1','existing unselected context is not rewritten');
reset role;
set local role workspace_admin_owner;
update workspace_private.organization_membership set revoked_at=statement_timestamp() where user_id='42510000-0000-0000-0000-000000000003';
reset role;
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub','42510000-0000-0000-0000-000000000003','session_id','42520000-0000-0000-0000-000000000004','exp',floor(extract(epoch from statement_timestamp()+interval '10 minutes')))::text,true);
select is(workspace_api.bootstrap_workspace_context()->>'status','selection_required','revoked membership is not counted');
reset role;
set local role workspace_admin_owner;
update workspace_private.organization set disabled_at=statement_timestamp() where id='42500000-0000-0000-0000-000000000001';
reset role;
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub','42510000-0000-0000-0000-000000000001','session_id','42520000-0000-0000-0000-000000000005','exp',floor(extract(epoch from statement_timestamp()+interval '10 minutes')))::text,true);
select is(workspace_api.bootstrap_workspace_context()->>'status','selection_required','disabled organization is not counted');
reset role;
select * from finish();
rollback;
