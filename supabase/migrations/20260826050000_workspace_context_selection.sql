begin;
do $$ declare r text; begin foreach r in array array['workspace_admin_owner','workspace_context_owner'] loop
  perform set_config('votus_selection.'||r,pg_has_role(current_user,r,'SET')::text,true); if not pg_has_role(current_user,r,'SET') then execute format('grant %I to %I',r,current_user); end if;
end loop; end $$;
set role workspace_context_owner;
alter table workspace_private.workspace_context alter organization_id drop not null,alter membership_revision drop not null,alter entitlement_revision drop not null;
alter table workspace_private.workspace_context add constraint workspace_context_selection_check check ((organization_id is null and membership_revision is null and entitlement_revision is null) or (organization_id is not null and membership_revision is not null and entitlement_revision is not null));
reset role; set role workspace_admin_owner;
create policy workspace_context_owner_organization_select on workspace_private.organization for select to workspace_context_owner using(true);
create policy workspace_context_owner_membership_select on workspace_private.organization_membership for select to workspace_context_owner using(true);
grant select on workspace_private.organization,workspace_private.organization_membership to workspace_context_owner;
reset role; grant create on schema workspace_private,workspace_api to workspace_context_owner; set role workspace_context_owner;
create function workspace_private.trusted_workspace_claims() returns table(claim_user_id uuid,claim_session_id uuid,claim_expires_at timestamptz)
language plpgsql stable security definer set search_path=pg_catalog,workspace_private,pg_temp as $$
declare raw text; claims jsonb; s text; sid text; expiration numeric;
begin
  raw:=current_setting('request.jwt.claims',true); if raw is null or btrim(raw)='' then raise exception using errcode='VOT01'; end if;
  begin claims:=raw::jsonb; exception when others then raise exception using errcode='VOT02'; end;
  if jsonb_typeof(claims)<>'object' or jsonb_typeof(claims->'sub')<>'string' or jsonb_typeof(claims->'session_id')<>'string' or jsonb_typeof(claims->'exp')<>'number' then raise exception using errcode='VOT02'; end if;
  s:=claims->>'sub'; sid:=claims->>'session_id'; if s!~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' or sid!~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception using errcode='VOT02'; end if;
  begin claim_user_id:=s::uuid; claim_session_id:=sid::uuid; expiration:=(claims->>'exp')::numeric; exception when others then raise exception using errcode='VOT02'; end;
  if claim_user_id::text<>s or claim_session_id::text<>sid or expiration<>trunc(expiration) or expiration<1 or expiration>253402300799 or to_timestamp(expiration::bigint)<=statement_timestamp() then raise exception using errcode='VOT02'; end if;
  claim_expires_at:=to_timestamp(expiration::bigint); return next;
end $$;
create function workspace_api.available_organizations() returns jsonb language plpgsql stable security definer set search_path=pg_catalog,workspace_private,pg_temp as $$
declare c record; result jsonb; total bigint;
begin
  select * into c from workspace_private.trusted_workspace_claims();
  select count(*) into total from workspace_private.organization_membership m join workspace_private.organization o on o.id=m.organization_id where m.user_id=c.claim_user_id and m.revoked_at is null and o.disabled_at is null;
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'display_name',display_name) order by display_name,id),'[]'::jsonb) into result from (select o.id,o.display_name from workspace_private.organization_membership m join workspace_private.organization o on o.id=m.organization_id where m.user_id=c.claim_user_id and m.revoked_at is null and o.disabled_at is null order by o.display_name,o.id limit 100) available;
  return jsonb_build_object('status','ok','organizations',result,'total',total,'truncated',total>100);
end $$;
create function workspace_api.current_workspace() returns jsonb language plpgsql stable security definer set search_path=pg_catalog,workspace_private,pg_temp as $$
declare c record; ctx workspace_private.workspace_context%rowtype; org record;
begin
  select * into c from workspace_private.trusted_workspace_claims(); select * into ctx from workspace_private.workspace_context where session_id=c.claim_session_id;
  if not found then return jsonb_build_object('status','selection_required','context_revision',0); end if; if ctx.user_id<>c.claim_user_id then raise exception using errcode='VOT03'; end if;
  if ctx.revoked_at is not null then return jsonb_build_object('status','revoked','context_revision',ctx.context_revision); end if; if ctx.fixed_expires_at<=statement_timestamp() then return jsonb_build_object('status','expired','context_revision',ctx.context_revision); end if;
  if ctx.organization_id is null then return jsonb_build_object('status','selection_required','context_revision',ctx.context_revision); end if;
  select o.id,o.display_name into org from workspace_private.organization o join workspace_private.organization_membership m on m.organization_id=o.id where o.id=ctx.organization_id and o.disabled_at is null and m.user_id=c.claim_user_id and m.revoked_at is null and m.membership_revision=ctx.membership_revision and o.entitlement_revision=ctx.entitlement_revision;
  if not found then return jsonb_build_object('status','stale','context_revision',ctx.context_revision); end if;
  return jsonb_build_object('status','active','context_revision',ctx.context_revision,'organization',jsonb_build_object('id',org.id,'display_name',org.display_name));
end $$;
create function workspace_api.bootstrap_workspace_context() returns jsonb language plpgsql security definer set search_path=pg_catalog,workspace_private,pg_temp as $$
declare c record; ctx workspace_private.workspace_context%rowtype;
begin
  select * into c from workspace_private.trusted_workspace_claims(); insert into workspace_private.workspace_context(session_id,user_id,organization_id,membership_revision,entitlement_revision,context_revision,fixed_expires_at) values(c.claim_session_id,c.claim_user_id,null,null,null,1,c.claim_expires_at) on conflict(session_id) do nothing;
  select * into ctx from workspace_private.workspace_context where session_id=c.claim_session_id; if ctx.user_id<>c.claim_user_id then raise exception using errcode='VOT03'; end if; return workspace_api.current_workspace();
end $$;
create function workspace_api.switch_workspace_context(p_organization_id uuid,p_expected_revision bigint) returns jsonb language plpgsql security definer set search_path=pg_catalog,workspace_private,pg_temp as $$
declare c record; ctx workspace_private.workspace_context%rowtype; target record;
begin
  select * into c from workspace_private.trusted_workspace_claims(); select * into ctx from workspace_private.workspace_context where session_id=c.claim_session_id for update;
  if not found then return jsonb_build_object('status','selection_required','context_revision',0); end if; if ctx.user_id<>c.claim_user_id then raise exception using errcode='VOT03'; end if;
  if ctx.revoked_at is not null then return jsonb_build_object('status','revoked','context_revision',ctx.context_revision); end if; if ctx.fixed_expires_at<=statement_timestamp() then return jsonb_build_object('status','expired','context_revision',ctx.context_revision); end if;
  if p_expected_revision is null or p_expected_revision<>ctx.context_revision then return jsonb_build_object('status','conflict','context_revision',ctx.context_revision); end if;
  select o.entitlement_revision,m.membership_revision into target from workspace_private.organization o join workspace_private.organization_membership m on m.organization_id=o.id where o.id=p_organization_id and o.disabled_at is null and m.user_id=c.claim_user_id and m.revoked_at is null;
  if not found then return jsonb_build_object('status','denied','context_revision',ctx.context_revision); end if;
  if ctx.organization_id=p_organization_id and ctx.membership_revision=target.membership_revision and ctx.entitlement_revision=target.entitlement_revision then return jsonb_build_object('status','same_state','context_revision',ctx.context_revision); end if;
  update workspace_private.workspace_context set organization_id=p_organization_id,membership_revision=target.membership_revision,entitlement_revision=target.entitlement_revision,context_revision=context_revision+1 where id=ctx.id and context_revision=p_expected_revision returning * into ctx;
  if not found then return jsonb_build_object('status','conflict','context_revision',p_expected_revision); end if;
  insert into workspace_private.workspace_audit_event(actor_kind,user_id,session_id,context_id,organization_id,action,outcome,reason_code) values('organization_user',c.claim_user_id,c.claim_session_id,ctx.id,p_organization_id,'context_switched','succeeded','organization_switched');
  return jsonb_build_object('status','active','context_revision',ctx.context_revision);
end $$;
alter function workspace_private.trusted_workspace_claims() owner to workspace_context_owner; alter function workspace_api.available_organizations() owner to workspace_context_owner; alter function workspace_api.current_workspace() owner to workspace_context_owner; alter function workspace_api.bootstrap_workspace_context() owner to workspace_context_owner; alter function workspace_api.switch_workspace_context(uuid,bigint) owner to workspace_context_owner;
revoke all on function workspace_private.trusted_workspace_claims() from public,anon,authenticated;
revoke all on function workspace_api.available_organizations(),workspace_api.current_workspace(),workspace_api.bootstrap_workspace_context(),workspace_api.switch_workspace_context(uuid,bigint) from public,anon;
do $$ begin if to_regrole('service_role') is not null then revoke all on function workspace_api.available_organizations(),workspace_api.current_workspace(),workspace_api.bootstrap_workspace_context(),workspace_api.switch_workspace_context(uuid,bigint) from service_role; end if; end $$;
grant execute on function workspace_api.available_organizations(),workspace_api.current_workspace(),workspace_api.bootstrap_workspace_context(),workspace_api.switch_workspace_context(uuid,bigint) to authenticated;
reset role; revoke create on schema workspace_private,workspace_api from workspace_context_owner;
do $$ declare r text; begin foreach r in array array['workspace_context_owner','workspace_admin_owner'] loop if current_setting('votus_selection.'||r,true)='false' then execute format('revoke %I from %I',r,current_user); end if; end loop; end $$;
commit;
