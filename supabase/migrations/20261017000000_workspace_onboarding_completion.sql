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
 select pg_get_constraintdef(oid) into strict definition from pg_constraint
 where conrelid='workspace_private.workspace_audit_event'::regclass
 and conname='workspace_audit_event_action_check';
 alter table workspace_private.workspace_audit_event drop constraint workspace_audit_event_action_check;
 execute 'alter table workspace_private.workspace_audit_event add constraint workspace_audit_event_action_check '||replace(definition, '''review_visibility_denied''::text', '''review_visibility_denied''::text, ''onboarding_completed''::text');
 reset role;
 if not had_set then
  execute format('revoke onboarding_599_audit_migrator from %I',runner);
  revoke workspace_audit_owner from onboarding_599_audit_migrator;
  drop role onboarding_599_audit_migrator;
 end if;
end $audit$;
-- #599 onboarding: completion is persisted once per user and organization.
-- Rows are written only by workspace_api.complete_onboarding() for the session's
-- active organization; nothing reads the table directly.
create table workspace_private.onboarding_completion (
  user_id uuid not null,
  -- No foreign key: organizations are disabled, never deleted, and the only writer
  -- (complete_onboarding) inserts the session's verified active organization.
  organization_id uuid not null,
  completed_at timestamptz not null default statement_timestamp(),
  constraint onboarding_completion_pkey primary key (user_id, organization_id)
);
alter table workspace_private.onboarding_completion enable row level security;
alter table workspace_private.onboarding_completion force row level security;
revoke all on workspace_private.onboarding_completion from public;
do $$ begin
  if to_regrole('anon') is not null then revoke all on workspace_private.onboarding_completion from anon; end if;
  if to_regrole('authenticated') is not null then revoke all on workspace_private.onboarding_completion from authenticated; end if;
  if to_regrole('service_role') is not null then revoke all on workspace_private.onboarding_completion from service_role; end if;
end $$;
grant select, insert on workspace_private.onboarding_completion to workspace_context_owner;
create policy workspace_context_owner_onboarding_select on workspace_private.onboarding_completion for select to workspace_context_owner using (true);
create policy workspace_context_owner_onboarding_insert on workspace_private.onboarding_completion for insert to workspace_context_owner with check (true);

-- Functions are owned by workspace_context_owner. On hosted Supabase postgres
-- holds ADMIN without SET on that role, so a temporary bridge role lets the
-- migration runner SET it (same pattern as 20261016000000).
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
  return jsonb_build_object('status','active','context_revision',ctx.context_revision,'organization',jsonb_build_object('id',org.id,'display_name',org.display_name),
    'onboarding_completed',exists(select 1 from workspace_private.onboarding_completion oc where oc.user_id=c.claim_user_id and oc.organization_id=org.id));
end $$
 $fn$;
 execute $fn$
create function workspace_api.complete_onboarding() returns jsonb language plpgsql security definer set search_path=pg_catalog,workspace_private,pg_temp as $$
declare c record; current jsonb;
begin
  select * into c from workspace_private.trusted_workspace_claims();
  -- Missing JSON fields can produce NULL rather than true in the shared helper.
  -- The writer must reject incomplete claims before any context access or write.
  if c.claim_user_id is null or c.claim_session_id is null or c.claim_expires_at is null then
    raise exception using errcode='VOT02';
  end if;
  current:=workspace_api.current_workspace();
  if current->>'status'<>'active' then return jsonb_build_object('status',current->>'status'); end if;
  insert into workspace_private.onboarding_completion(user_id,organization_id) values (c.claim_user_id,(current->'organization'->>'id')::uuid) on conflict do nothing;
  if found then
    insert into workspace_private.workspace_audit_event(
      actor_kind,user_id,session_id,context_id,organization_id,action,outcome)
    select 'organization_user',c.claim_user_id,c.claim_session_id,ctx.id,ctx.organization_id,
      'onboarding_completed','succeeded'
    from workspace_private.workspace_context ctx where ctx.session_id=c.claim_session_id;
  end if;
  return jsonb_build_object('status','ok');
end $$
 $fn$;
 -- The owner sets the function ACL: only signed-in users may complete onboarding.
 revoke all on function workspace_api.complete_onboarding() from public;
 if to_regrole('anon') is not null then revoke all on function workspace_api.complete_onboarding() from anon; end if;
 if to_regrole('service_role') is not null then revoke all on function workspace_api.complete_onboarding() from service_role; end if;
 grant execute on function workspace_api.complete_onboarding() to authenticated;
 reset role;
 if not had_create then revoke create on schema workspace_api from workspace_context_owner; end if;
 if not had_set then
  execute format('revoke %I from %I',bridge,runner);
  execute format('revoke workspace_context_owner from %I',bridge);
  execute format('drop role %I',bridge);
 end if;
end $migration$;
commit;
