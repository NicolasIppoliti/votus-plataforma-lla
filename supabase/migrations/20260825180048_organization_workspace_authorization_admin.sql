begin;
do $$
declare admin_could_set boolean; audit_could_set boolean;
begin
  select pg_has_role(current_user,'workspace_admin_owner','SET'),pg_has_role(current_user,'workspace_audit_owner','SET') into admin_could_set,audit_could_set;
  perform set_config('votus_pr3b.workspace_admin_owner_could_set',admin_could_set::text,true),set_config('votus_pr3b.workspace_audit_owner_could_set',audit_could_set::text,true);
  if not admin_could_set then grant workspace_admin_owner to current_user; end if;
  if not audit_could_set then grant workspace_audit_owner to current_user; end if;
end $$;
grant create on schema workspace_private to workspace_admin_owner,workspace_audit_owner;

create policy workspace_admin_owner_organization_insert on workspace_private.organization for insert to workspace_admin_owner with check (true); create policy workspace_admin_owner_organization_update on workspace_private.organization for update to workspace_admin_owner using (true) with check (true);
create policy workspace_admin_owner_membership_insert on workspace_private.organization_membership for insert to workspace_admin_owner with check (true); create policy workspace_admin_owner_membership_update on workspace_private.organization_membership for update to workspace_admin_owner using (true) with check (true);
create policy workspace_admin_owner_scope_insert on workspace_private.section_scope for insert to workspace_admin_owner with check (true); create policy workspace_admin_owner_entitlement_insert on workspace_private.organization_section_entitlement for insert to workspace_admin_owner with check (true);
create policy workspace_admin_owner_entitlement_update on workspace_private.organization_section_entitlement for update to workspace_admin_owner using (true) with check (true); create policy workspace_audit_owner_event_select on workspace_private.workspace_audit_event for select to workspace_audit_owner using (true);
create policy workspace_audit_owner_event_insert on workspace_private.workspace_audit_event for insert to workspace_audit_owner with check (true); grant select on public.jurisdiction to workspace_admin_owner; create policy workspace_admin_owner_jurisdiction_select on public.jurisdiction for select to workspace_admin_owner using (true);

create function workspace_private.append_audit_event(p_action text,p_organization_id uuid,p_actor_ref text,p_reason_code text,p_detail jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,workspace_private,pg_temp as $$
declare event_id uuid;
begin
  if p_actor_ref is null or p_actor_ref<>btrim(p_actor_ref) or p_actor_ref='' then raise exception 'actor_ref must be opaque and nonblank'; end if;
  if p_detail is null or jsonb_typeof(p_detail)<>'object' then raise exception 'audit detail must be an object'; end if;
  insert into workspace_private.workspace_audit_event(actor_kind,actor_ref,organization_id,action,outcome,reason_code,detail)
  values('platform_operator',p_actor_ref,p_organization_id,p_action,'succeeded',p_reason_code,p_detail) returning id into event_id;
  return jsonb_build_object('id',event_id,'status','recorded');
end $$;
alter function workspace_private.append_audit_event(text,uuid,text,text,jsonb) owner to workspace_audit_owner;
revoke all on function workspace_private.append_audit_event(text,uuid,text,text,jsonb) from public;
grant execute on function workspace_private.append_audit_event(text,uuid,text,text,jsonb) to workspace_admin_owner;

create function workspace_private.create_organization(p_slug text,p_display_name text,p_actor_ref text,p_reason_code text default 'operator_request') returns jsonb
language plpgsql security definer set search_path=pg_catalog,workspace_private,pg_temp as $$
declare row workspace_private.organization%rowtype;
begin
  if p_slug is null or p_slug!~'^[a-z0-9]+(-[a-z0-9]+)*$' then raise exception 'organization slug is invalid'; end if;
  if p_display_name is null or p_display_name<>btrim(p_display_name) or p_display_name='' then raise exception 'organization name is invalid'; end if;
  lock table workspace_private.organization in share row exclusive mode;
  if exists(select 1 from workspace_private.organization o where o.slug=p_slug or o.display_name=p_display_name) then raise exception 'organization slug or name already exists'; end if;
  insert into workspace_private.organization(slug,display_name) values(p_slug,p_display_name) returning * into row;
  perform workspace_private.append_audit_event('organization_created',row.id,p_actor_ref,p_reason_code,jsonb_build_object('slug',row.slug));
  return jsonb_build_object('changed',true,'status','created','organization_id',row.id,'entitlement_revision',row.entitlement_revision);
end $$;

create function workspace_private.disable_organization(p_organization_id uuid,p_actor_ref text,p_reason_code text default 'operator_request') returns jsonb
language plpgsql security definer set search_path=pg_catalog,workspace_private,pg_temp as $$
declare row workspace_private.organization%rowtype;
begin
  select * into row from workspace_private.organization o where o.id=p_organization_id for update;
  if not found then raise exception 'organization missing'; end if;
  if row.disabled_at is not null then return jsonb_build_object('changed',false,'status','already_disabled','organization_id',row.id,'entitlement_revision',row.entitlement_revision); end if;
  update workspace_private.organization set disabled_at=now(),updated_at=now() where id=row.id returning * into row;
  perform workspace_private.append_audit_event('organization_disabled',row.id,p_actor_ref,p_reason_code,'{}'::jsonb);
  return jsonb_build_object('changed',true,'status','disabled','organization_id',row.id,'entitlement_revision',row.entitlement_revision);
end $$;

create function workspace_private.grant_membership(p_organization_id uuid,p_user_id uuid,p_actor_ref text,p_reason_code text default 'operator_request') returns jsonb
language plpgsql security definer set search_path=pg_catalog,workspace_private,pg_temp as $$
declare org workspace_private.organization%rowtype; rev bigint; revoked timestamptz;
begin
  select * into org from workspace_private.organization o where o.id=p_organization_id for update;
  if not found then raise exception 'organization missing'; end if;
  if org.disabled_at is not null then raise exception 'organization disabled'; end if;
  select membership_revision,revoked_at into rev,revoked from workspace_private.organization_membership m where m.organization_id=p_organization_id and m.user_id=p_user_id for update;
  if not found then insert into workspace_private.organization_membership(organization_id,user_id) values(p_organization_id,p_user_id) returning membership_revision into rev;
  elsif revoked is null then return jsonb_build_object('changed',false,'status','active','organization_id',p_organization_id,'user_id',p_user_id,'membership_revision',rev);
  else update workspace_private.organization_membership set granted_at=now(),revoked_at=null,membership_revision=membership_revision+1 where organization_id=p_organization_id and user_id=p_user_id returning membership_revision into rev; end if;
  perform workspace_private.append_audit_event('membership_granted',p_organization_id,p_actor_ref,p_reason_code,jsonb_build_object('user_id',p_user_id));
  return jsonb_build_object('changed',true,'status','active','organization_id',p_organization_id,'user_id',p_user_id,'membership_revision',rev);
end $$;

create function workspace_private.revoke_membership(p_organization_id uuid,p_user_id uuid,p_actor_ref text,p_reason_code text default 'operator_request') returns jsonb
language plpgsql security definer set search_path=pg_catalog,workspace_private,pg_temp as $$
declare rev bigint; revoked timestamptz;
begin
  perform 1 from workspace_private.organization o where o.id=p_organization_id for update;
  if not found then raise exception 'organization missing'; end if;
  select membership_revision,revoked_at into rev,revoked from workspace_private.organization_membership m where m.organization_id=p_organization_id and m.user_id=p_user_id for update;
  if not found then raise exception 'membership missing'; end if;
  if revoked is not null then return jsonb_build_object('changed',false,'status','revoked','organization_id',p_organization_id,'user_id',p_user_id,'membership_revision',rev); end if;
  update workspace_private.organization_membership set revoked_at=now(),membership_revision=membership_revision+1 where organization_id=p_organization_id and user_id=p_user_id returning membership_revision into rev;
  perform workspace_private.append_audit_event('membership_revoked',p_organization_id,p_actor_ref,p_reason_code,jsonb_build_object('user_id',p_user_id));
  return jsonb_build_object('changed',true,'status','revoked','organization_id',p_organization_id,'user_id',p_user_id,'membership_revision',rev);
end $$;

create function workspace_private.register_section_scope(p_distrito_code text,p_seccion_code text,p_actor_ref text,p_reason_code text default 'operator_request') returns jsonb
language plpgsql security definer set search_path=pg_catalog,workspace_private,pg_temp as $$
declare inserted boolean; begin
  if p_distrito_code!~'^[0-9]{2}$' or p_seccion_code!~'^[0-9]{3}$' then raise exception 'scope must already be canonical'; end if;
  if not exists(select 1 from public.jurisdiction j where j.distrito_code=p_distrito_code and j.seccion_code=p_seccion_code and j.seccion_code is not null) then raise exception 'exact jurisdiction scope missing'; end if;
  insert into workspace_private.section_scope values(p_distrito_code,p_seccion_code) on conflict do nothing returning true into inserted;
  if not coalesce(inserted,false) then return jsonb_build_object('changed',false,'status','registered','distrito_code',p_distrito_code,'seccion_code',p_seccion_code); end if;
  perform workspace_private.append_audit_event('section_scope_registered',null,p_actor_ref,p_reason_code,jsonb_build_object('distrito_code',p_distrito_code,'seccion_code',p_seccion_code));
  return jsonb_build_object('changed',true,'status','registered','distrito_code',p_distrito_code,'seccion_code',p_seccion_code);
end $$;

create function workspace_private.grant_section_entitlement(p_organization_id uuid,p_distrito_code text,p_seccion_code text,p_actor_ref text,p_reason_code text default 'operator_request') returns jsonb
language plpgsql security definer set search_path=pg_catalog,workspace_private,pg_temp as $$
declare org workspace_private.organization%rowtype; rev bigint; revoked timestamptz;
begin
  select * into org from workspace_private.organization o where o.id=p_organization_id for update;
  if not found then raise exception 'organization missing'; end if;
  if org.disabled_at is not null then raise exception 'organization disabled'; end if;
  if not exists(select 1 from workspace_private.section_scope s where s.distrito_code=p_distrito_code and s.seccion_code=p_seccion_code) then raise exception 'scope missing'; end if;
  select entitlement_revision,revoked_at into rev,revoked from workspace_private.organization_section_entitlement e where e.organization_id=p_organization_id and e.distrito_code=p_distrito_code and e.seccion_code=p_seccion_code for update;
  if not found then insert into workspace_private.organization_section_entitlement(organization_id,distrito_code,seccion_code) values(p_organization_id,p_distrito_code,p_seccion_code) returning entitlement_revision into rev;
  elsif revoked is null then return jsonb_build_object('changed',false,'status','active','organization_id',p_organization_id,'distrito_code',p_distrito_code,'seccion_code',p_seccion_code,'entitlement_revision',rev,'organization_revision',org.entitlement_revision);
  else update workspace_private.organization_section_entitlement set granted_at=now(),revoked_at=null,entitlement_revision=entitlement_revision+1 where organization_id=p_organization_id and distrito_code=p_distrito_code and seccion_code=p_seccion_code returning entitlement_revision into rev; end if;
  update workspace_private.organization set entitlement_revision=entitlement_revision+1,updated_at=now() where id=p_organization_id returning entitlement_revision into org.entitlement_revision;
  perform workspace_private.append_audit_event('section_entitlement_granted',p_organization_id,p_actor_ref,p_reason_code,jsonb_build_object('distrito_code',p_distrito_code,'seccion_code',p_seccion_code));
  return jsonb_build_object('changed',true,'status','active','organization_id',p_organization_id,'distrito_code',p_distrito_code,'seccion_code',p_seccion_code,'entitlement_revision',rev,'organization_revision',org.entitlement_revision);
end $$;

create function workspace_private.revoke_section_entitlement(p_organization_id uuid,p_distrito_code text,p_seccion_code text,p_actor_ref text,p_reason_code text default 'operator_request') returns jsonb
language plpgsql security definer set search_path=pg_catalog,workspace_private,pg_temp as $$
declare org_rev bigint; rev bigint; revoked timestamptz;
begin
  select entitlement_revision into org_rev from workspace_private.organization o where o.id=p_organization_id for update;
  if not found then raise exception 'organization missing'; end if;
  if not exists(select 1 from workspace_private.section_scope s where s.distrito_code=p_distrito_code and s.seccion_code=p_seccion_code) then raise exception 'scope missing'; end if;
  select entitlement_revision,revoked_at into rev,revoked from workspace_private.organization_section_entitlement e where e.organization_id=p_organization_id and e.distrito_code=p_distrito_code and e.seccion_code=p_seccion_code for update;
  if not found then raise exception 'entitlement missing'; end if;
  if revoked is not null then return jsonb_build_object('changed',false,'status','revoked','organization_id',p_organization_id,'distrito_code',p_distrito_code,'seccion_code',p_seccion_code,'entitlement_revision',rev,'organization_revision',org_rev); end if;
  update workspace_private.organization_section_entitlement set revoked_at=now(),entitlement_revision=entitlement_revision+1 where organization_id=p_organization_id and distrito_code=p_distrito_code and seccion_code=p_seccion_code returning entitlement_revision into rev;
  update workspace_private.organization set entitlement_revision=entitlement_revision+1,updated_at=now() where id=p_organization_id returning entitlement_revision into org_rev;
  perform workspace_private.append_audit_event('section_entitlement_revoked',p_organization_id,p_actor_ref,p_reason_code,jsonb_build_object('distrito_code',p_distrito_code,'seccion_code',p_seccion_code));
  return jsonb_build_object('changed',true,'status','revoked','organization_id',p_organization_id,'distrito_code',p_distrito_code,'seccion_code',p_seccion_code,'entitlement_revision',rev,'organization_revision',org_rev);
end $$;

alter function workspace_private.create_organization(text,text,text,text) owner to workspace_admin_owner; alter function workspace_private.disable_organization(uuid,text,text) owner to workspace_admin_owner; alter function workspace_private.grant_membership(uuid,uuid,text,text) owner to workspace_admin_owner; alter function workspace_private.revoke_membership(uuid,uuid,text,text) owner to workspace_admin_owner; alter function workspace_private.register_section_scope(text,text,text,text) owner to workspace_admin_owner; alter function workspace_private.grant_section_entitlement(uuid,text,text,text,text) owner to workspace_admin_owner; alter function workspace_private.revoke_section_entitlement(uuid,text,text,text,text) owner to workspace_admin_owner;
revoke all on function workspace_private.create_organization(text,text,text,text) from public; revoke all on function workspace_private.disable_organization(uuid,text,text) from public; revoke all on function workspace_private.grant_membership(uuid,uuid,text,text) from public; revoke all on function workspace_private.revoke_membership(uuid,uuid,text,text) from public; revoke all on function workspace_private.register_section_scope(text,text,text,text) from public; revoke all on function workspace_private.grant_section_entitlement(uuid,text,text,text,text) from public; revoke all on function workspace_private.revoke_section_entitlement(uuid,text,text,text,text) from public;
grant execute on function workspace_private.create_organization(text,text,text,text) to workspace_platform_admin; grant execute on function workspace_private.disable_organization(uuid,text,text) to workspace_platform_admin; grant execute on function workspace_private.grant_membership(uuid,uuid,text,text) to workspace_platform_admin; grant execute on function workspace_private.revoke_membership(uuid,uuid,text,text) to workspace_platform_admin; grant execute on function workspace_private.register_section_scope(text,text,text,text) to workspace_platform_admin; grant execute on function workspace_private.grant_section_entitlement(uuid,text,text,text,text) to workspace_platform_admin; grant execute on function workspace_private.revoke_section_entitlement(uuid,text,text,text,text) to workspace_platform_admin;
revoke create on schema workspace_private from workspace_admin_owner,workspace_audit_owner;
do $$ begin
if current_setting('votus_pr3b.workspace_audit_owner_could_set',true)='false' then revoke workspace_audit_owner from current_user; end if;
  if current_setting('votus_pr3b.workspace_admin_owner_could_set',true)='false' then revoke workspace_admin_owner from current_user; end if;
end $$;
commit;
