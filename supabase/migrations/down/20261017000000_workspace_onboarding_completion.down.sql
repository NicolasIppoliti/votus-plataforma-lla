begin;
-- Change the audit vocabulary as its owner, preserving the runner's role edges.
do $audit$
declare had_set boolean:=pg_has_role(current_user,'workspace_audit_owner','SET');
 runner text:=current_user; definition text;
begin
 if not had_set then
  create role onboarding_599_audit_migrator nologin;
  grant workspace_audit_owner to onboarding_599_audit_migrator with inherit false, set true;
  execute format('grant onboarding_599_audit_migrator to %I with inherit false, set true',runner);
 end if;
 set local role workspace_audit_owner;
 if exists(select 1 from workspace_private.workspace_audit_event where action='onboarding_completed') then
  raise exception 'onboarding rollback refused: completion audit events must be retained';
 end if;
 select pg_get_constraintdef(oid) into strict definition from pg_constraint
 where conrelid='workspace_private.workspace_audit_event'::regclass
 and conname='workspace_audit_event_action_check';
 alter table workspace_private.workspace_audit_event drop constraint workspace_audit_event_action_check;
 execute 'alter table workspace_private.workspace_audit_event add constraint workspace_audit_event_action_check '||replace(definition, ', ''onboarding_completed''::text', '');
 reset role;
 if not had_set then
  execute format('revoke onboarding_599_audit_migrator from %I',runner);
  revoke workspace_audit_owner from onboarding_599_audit_migrator;
  drop role onboarding_599_audit_migrator;
 end if;
end $audit$;
-- Reverse #599 onboarding: restore current_workspace without the onboarding fact,
-- then drop complete_onboarding() and the completion table.
do $migration$
declare had_create boolean; had_set boolean; bridge constant text := 'onboarding_599_migrator'; runner text := current_user;
begin
 had_create:=has_schema_privilege('workspace_context_owner','workspace_api','CREATE');
 had_set:=pg_has_role(runner,'workspace_context_owner','SET');
 if not had_set then
  execute format('create role %I nologin',bridge);
  execute format('grant workspace_context_owner to %I with inherit false, set true',bridge);
  execute format('grant %I to %I with inherit false, set true',bridge,runner);
 end if;
 if not had_create then grant create on schema workspace_api to workspace_context_owner; end if;
 set local role workspace_context_owner;
 drop function workspace_api.complete_onboarding();
 execute $fn$
create or replace function workspace_api.current_workspace() returns jsonb language plpgsql stable security definer set search_path=pg_catalog,workspace_private,pg_temp as $$
declare c record; ctx workspace_private.workspace_context%rowtype; org record;
begin
  select * into c from workspace_private.trusted_workspace_claims(); select * into ctx from workspace_private.workspace_context where session_id=c.claim_session_id;
  if not found then return jsonb_build_object('status','selection_required','context_revision',0); end if; if ctx.user_id<>c.claim_user_id then raise exception using errcode='VOT03'; end if;
  if ctx.revoked_at is not null then return jsonb_build_object('status','revoked','context_revision',ctx.context_revision); end if; if ctx.fixed_expires_at<=statement_timestamp() then return jsonb_build_object('status','expired','context_revision',ctx.context_revision); end if;
  if ctx.organization_id is null then return jsonb_build_object('status','selection_required','context_revision',ctx.context_revision); end if;
  select o.id,o.display_name into org from workspace_private.organization o join workspace_private.organization_membership m on m.organization_id=o.id where o.id=ctx.organization_id and o.disabled_at is null and m.user_id=c.claim_user_id and m.revoked_at is null and m.membership_revision=ctx.membership_revision and o.entitlement_revision=ctx.entitlement_revision;
  if not found then return jsonb_build_object('status','stale','context_revision',ctx.context_revision); end if;
  return jsonb_build_object('status','active','context_revision',ctx.context_revision,'organization',jsonb_build_object('id',org.id,'display_name',org.display_name));
end $$
 $fn$;
 reset role;
 if not had_create then revoke create on schema workspace_api from workspace_context_owner; end if;
 if not had_set then
  execute format('revoke %I from %I',bridge,runner);
  execute format('revoke workspace_context_owner from %I',bridge);
  execute format('drop role %I',bridge);
 end if;
end $migration$;
drop table workspace_private.onboarding_completion;
commit;
