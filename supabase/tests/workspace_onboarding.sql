begin;
-- #599: onboarding completion is persisted once per user and organization and
-- exposed through current_workspace; only the session's active organization
-- can be marked complete, and the completion table is never directly readable.
grant workspace_admin_owner to current_user;
-- Forced RLS: completion rows are read through the owning role's policy.
grant workspace_context_owner to current_user;
set local role workspace_admin_owner;
insert into workspace_private.organization(id,slug,display_name) values
 ('59900000-0000-0000-0000-000000000001','onboarding-one','Onboarding One'),
 ('59900000-0000-0000-0000-000000000002','onboarding-two','Onboarding Two');
insert into workspace_private.organization_membership(organization_id,user_id,membership_revision) values
 ('59900000-0000-0000-0000-000000000001','59910000-0000-0000-0000-000000000001',1),
 ('59900000-0000-0000-0000-000000000001','59910000-0000-0000-0000-000000000002',1),
 ('59900000-0000-0000-0000-000000000002','59910000-0000-0000-0000-000000000002',1);
reset role;
select plan(35);

-- User 1 belongs to one organization: bootstrap selects it, onboarding pending.
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub','59910000-0000-0000-0000-000000000001','session_id','59920000-0000-0000-0000-000000000001','exp',floor(extract(epoch from statement_timestamp()+interval '10 minutes')))::text,true);
select is(workspace_api.bootstrap_workspace_context()->>'status','active','sole membership bootstraps active');
select is(workspace_api.current_workspace()->>'onboarding_completed','false','a new user has not completed onboarding');
select is(workspace_api.complete_onboarding()->>'status','ok','completing onboarding for the active organization succeeds');
select is(workspace_api.current_workspace()->>'onboarding_completed','true','completion is visible through current_workspace');
select is(workspace_api.complete_onboarding()->>'status','ok','completing again is idempotent');
reset role;
set local role workspace_context_owner;
-- Keep the protected read under its policy role, but run pgTAP as the test runner.
select count(*) as completed_rows from workspace_private.onboarding_completion
where user_id='59910000-0000-0000-0000-000000000001' \gset
reset role;
select is(:completed_rows::bigint,1::bigint,'one completion row per user and organization');

-- User 2 shares organization one but has not completed it; two organizations require selection.
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub','59910000-0000-0000-0000-000000000002','session_id','59920000-0000-0000-0000-000000000002','exp',floor(extract(epoch from statement_timestamp()+interval '10 minutes')))::text,true);
select is(workspace_api.bootstrap_workspace_context()->>'status','selection_required','two memberships require selection');
select is(workspace_api.current_workspace() ? 'onboarding_completed',false,'no onboarding fact without an active organization');
select is(workspace_api.complete_onboarding()->>'status','selection_required','completion needs an active organization');
reset role;
set local role workspace_context_owner;
select count(*) as unselected_rows from workspace_private.onboarding_completion
where user_id='59910000-0000-0000-0000-000000000002' \gset
reset role;
select is(:unselected_rows::bigint,0::bigint,'nothing is recorded without an active organization');

set local role authenticated;
select throws_ok($$select count(*) from workspace_private.onboarding_completion$$,'42501',null,'the completion table is not directly readable');
reset role;

-- Completion must be contextual and audited once, even after the repeated RPC.
select is((select count(*) from workspace_private.workspace_audit_event
  where user_id='59910000-0000-0000-0000-000000000001'
    and organization_id='59900000-0000-0000-0000-000000000001'
    and session_id='59920000-0000-0000-0000-000000000001'
    and context_id is not null and actor_kind='organization_user'
    and action='onboarding_completed' and outcome='succeeded'),1::bigint,
  'first completion is audited once with user, organization, session and context');
select ok((select proowner='workspace_context_owner'::regrole and prosecdef
  and proconfig=array['search_path=pg_catalog, workspace_private, pg_temp']::text[]
  from pg_proc where oid='workspace_api.complete_onboarding()'::regprocedure),
  'completion RPC has the isolated definer owner and fixed search path');
select ok((select relrowsecurity and relforcerowsecurity from pg_class
  where oid='workspace_private.onboarding_completion'::regclass),'completion forces RLS');
select ok(not has_function_privilege('anon','workspace_api.complete_onboarding()','EXECUTE')
  and not has_function_privilege('service_role','workspace_api.complete_onboarding()','EXECUTE'),
  'anon and service role cannot execute completion');
select ok(not has_table_privilege('authenticated','workspace_private.onboarding_completion',
  'SELECT,INSERT,UPDATE,DELETE'),'authenticated has no direct completion table privileges');

set local role authenticated;
-- User 2 still has their unselected context from above.
select is(workspace_api.switch_workspace_context('59900000-0000-0000-0000-000000000001',1)->>'status',
  'active','second user selects the same organization');
select is(workspace_api.current_workspace()->>'onboarding_completed','false',
  'first user completion does not complete onboarding for the second user');
select is(workspace_api.complete_onboarding()->>'status','ok','second user completes their own organization');
select is(workspace_api.switch_workspace_context('59900000-0000-0000-0000-000000000002',2)->>'status',
  'active','second user switches organization');
select is(workspace_api.current_workspace()->>'onboarding_completed','false',
  'completion in organization one leaves organization two pending');
select is(workspace_api.switch_workspace_context('59900000-0000-0000-0000-000000000001',3)->>'status',
  'active','second user switches back');
select is(workspace_api.current_workspace()->>'onboarding_completed','true',
  'switching back restores completion');
select set_config('request.jwt.claims',jsonb_build_object(
  'sub','59910000-0000-0000-0000-000000000001',
  'session_id','59920000-0000-0000-0000-000000000003',
  'exp',floor(extract(epoch from statement_timestamp()+interval '10 minutes')))::text,true);
select is(workspace_api.bootstrap_workspace_context()->>'onboarding_completed','true',
  'completion survives a new session for the same user and organization');
reset role;

-- The writer must fail closed, not merely rely on context readers being tested.
set local role authenticated;
select current_setting('request.jwt.claims') as valid_claims \gset
select set_config('request.jwt.claims','',true);
select throws_ok($$select workspace_api.complete_onboarding()$$,'VOT01',null,'missing claims cannot complete');
select set_config('request.jwt.claims','{}',true);
select throws_ok($$select workspace_api.complete_onboarding()$$,'VOT02',null,'malformed claims cannot complete');
select set_config('request.jwt.claims',jsonb_set(:'valid_claims'::jsonb,'{exp}','1')::text,true);
select throws_ok($$select workspace_api.complete_onboarding()$$,'VOT02',null,'expired claims cannot complete');
select set_config('request.jwt.claims',jsonb_set(:'valid_claims'::jsonb,'{sub}','"59910000-0000-0000-0000-000000000002"')::text,true);
select throws_ok($$select workspace_api.complete_onboarding()$$,'VOT03',null,'session user mismatch cannot complete');
select set_config('request.jwt.claims',:'valid_claims',true);
reset role;
set local role workspace_context_owner;
update workspace_private.workspace_context set revoked_at=statement_timestamp() where session_id='59920000-0000-0000-0000-000000000003';
set local role authenticated;
select is(workspace_api.complete_onboarding()->>'status','revoked','revoked context cannot complete');
set local role workspace_context_owner;
update workspace_private.workspace_context set revoked_at=null where session_id='59920000-0000-0000-0000-000000000003';
reset role;
set local role workspace_context_owner;
update workspace_private.workspace_context set fixed_expires_at=statement_timestamp()-interval '1 minute' where session_id='59920000-0000-0000-0000-000000000003';
set local role authenticated;
select is(workspace_api.complete_onboarding()->>'status','expired','expired context cannot complete');
set local role workspace_context_owner;
update workspace_private.workspace_context set fixed_expires_at=statement_timestamp()+interval '10 minutes' where session_id='59920000-0000-0000-0000-000000000003';
reset role;
set local role workspace_context_owner;
update workspace_private.workspace_context set membership_revision=99 where session_id='59920000-0000-0000-0000-000000000003';
set local role authenticated;
select is(workspace_api.complete_onboarding()->>'status','stale','stale context cannot complete');
set local role workspace_context_owner;
update workspace_private.workspace_context set membership_revision=1 where session_id='59920000-0000-0000-0000-000000000003';
reset role;
set local role workspace_admin_owner;
update workspace_private.organization set disabled_at=statement_timestamp() where id='59900000-0000-0000-0000-000000000001';
set local role authenticated;
select is(workspace_api.complete_onboarding()->>'status','stale','disabled organization cannot complete');
set local role workspace_admin_owner;
update workspace_private.organization set disabled_at=null where id='59900000-0000-0000-0000-000000000001';
reset role;
set local role workspace_admin_owner;
update workspace_private.organization_membership set revoked_at=statement_timestamp() where user_id='59910000-0000-0000-0000-000000000001';
set local role authenticated;
select is(workspace_api.complete_onboarding()->>'status','stale','revoked membership cannot complete');
set local role workspace_admin_owner;
update workspace_private.organization_membership set revoked_at=null where user_id='59910000-0000-0000-0000-000000000001';
reset role;
select is((select count(*) from workspace_private.workspace_audit_event
 where action='onboarding_completed' and user_id in
 ('59910000-0000-0000-0000-000000000001','59910000-0000-0000-0000-000000000002')),
 2::bigint,'denied writes produce no success audit events');
set local role workspace_context_owner;
select count(*) as final_rows from workspace_private.onboarding_completion
 where user_id in ('59910000-0000-0000-0000-000000000001','59910000-0000-0000-0000-000000000002') \gset
reset role;
select is(:final_rows::bigint,2::bigint,'rejected calls leave completion rows unchanged');
select * from finish();
rollback;
