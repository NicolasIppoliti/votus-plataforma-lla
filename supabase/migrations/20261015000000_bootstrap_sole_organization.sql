begin;
do $$ begin
  perform set_config('votus_bootstrap.had_role',pg_has_role(current_user,'workspace_context_owner','SET')::text,true);
  if not pg_has_role(current_user,'workspace_context_owner','SET') then grant workspace_context_owner to current_user; end if;
end $$;
grant create on schema workspace_private,workspace_api to workspace_context_owner;
set role workspace_context_owner;
create or replace function workspace_api.bootstrap_workspace_context() returns jsonb language plpgsql security definer set search_path=pg_catalog,workspace_private,pg_temp as $$
declare c record; ctx workspace_private.workspace_context%rowtype; inserted boolean; target record;
begin
  select * into c from workspace_private.trusted_workspace_claims(); insert into workspace_private.workspace_context(session_id,user_id,organization_id,membership_revision,entitlement_revision,context_revision,fixed_expires_at) values(c.claim_session_id,c.claim_user_id,null,null,null,1,c.claim_expires_at) on conflict(session_id) do nothing;
  inserted:=found;
  if inserted then
    select o.id,o.entitlement_revision,m.membership_revision into target
    from workspace_private.organization o join workspace_private.organization_membership m on m.organization_id=o.id
    where m.user_id=c.claim_user_id and m.revoked_at is null and o.disabled_at is null
      and (select count(*) from workspace_private.organization_membership active_m join workspace_private.organization active_o on active_o.id=active_m.organization_id where active_m.user_id=c.claim_user_id and active_m.revoked_at is null and active_o.disabled_at is null)=1;
    if found then
      update workspace_private.workspace_context set organization_id=target.id,membership_revision=target.membership_revision,entitlement_revision=target.entitlement_revision,context_revision=2 where session_id=c.claim_session_id returning * into ctx;
      insert into workspace_private.workspace_audit_event(actor_kind,user_id,session_id,context_id,organization_id,action,outcome,reason_code) values('organization_user',c.claim_user_id,c.claim_session_id,ctx.id,target.id,'context_switched','succeeded','organization_switched');
    end if;
  end if;
  select * into ctx from workspace_private.workspace_context where session_id=c.claim_session_id; if ctx.user_id<>c.claim_user_id then raise exception using errcode='VOT03'; end if; return workspace_api.current_workspace();
end $$;
alter function workspace_api.bootstrap_workspace_context() owner to workspace_context_owner;
revoke all on function workspace_api.bootstrap_workspace_context() from public,anon,service_role;
grant execute on function workspace_api.bootstrap_workspace_context() to authenticated;
reset role;
revoke create on schema workspace_private,workspace_api from workspace_context_owner;
do $$ begin
  if current_setting('votus_bootstrap.had_role',true)='false' then revoke workspace_context_owner from current_user; end if;
end $$;
commit;
