begin;
do $$ declare r text; begin
  foreach r in array array['workspace_admin_owner','workspace_audit_owner','workspace_context_owner'] loop
    perform set_config('votus_context.'||r,pg_has_role(current_user,r,'SET')::text,true);
    if not pg_has_role(current_user,r,'SET') then execute format('grant %I to %I',r,current_user); end if;
  end loop;
end $$;
grant create on schema workspace_private to workspace_context_owner;
set role workspace_admin_owner;
grant references on workspace_private.organization,workspace_private.organization_membership to workspace_context_owner;
reset role;
set role workspace_context_owner;
create table workspace_private.workspace_context (
  id uuid default gen_random_uuid() primary key,
  session_id uuid not null unique,
  user_id uuid not null,
  organization_id uuid not null,
  membership_revision bigint not null check (membership_revision > 0),
  entitlement_revision bigint not null check (entitlement_revision >= 0),
  context_revision bigint not null check (context_revision > 0),
  fixed_expires_at timestamptz not null,
  revoked_at timestamptz,
  constraint workspace_context_organization_fkey foreign key (organization_id)
    references workspace_private.organization(id) on delete restrict,
  constraint workspace_context_membership_fkey foreign key (organization_id,user_id)
    references workspace_private.organization_membership(organization_id,user_id) on delete restrict
);
alter table workspace_private.workspace_context enable row level security;
alter table workspace_private.workspace_context force row level security;
create policy workspace_context_owner_context_all on workspace_private.workspace_context
  for all to workspace_context_owner using (true) with check (true);
revoke all on table workspace_private.workspace_context from public,anon,authenticated,service_role;
reset role;
set role workspace_admin_owner;
revoke references on workspace_private.organization,workspace_private.organization_membership from workspace_context_owner;
reset role;
revoke create on schema workspace_private from workspace_context_owner;
set role workspace_audit_owner;
create policy workspace_context_owner_audit_insert on workspace_private.workspace_audit_event
  for insert to workspace_context_owner with check (actor_kind='organization_user');
grant insert on workspace_private.workspace_audit_event to workspace_context_owner;
reset role;

grant usage on schema workspace_api to authenticated;
grant create on schema workspace_api to workspace_context_owner;
create function workspace_api.invalidate_workspace_context() returns jsonb
language plpgsql security definer set search_path=pg_catalog,workspace_private,pg_temp as $$
declare
  claims_text text; claims jsonb; subject_text text; session_text text;
  expires numeric; subject_id uuid; current_session_id uuid;
  context_row workspace_private.workspace_context%rowtype;
begin
  claims_text:=pg_catalog.current_setting('request.jwt.claims',true);
  if claims_text is null or btrim(claims_text)='' then raise exception using errcode='VOT01'; end if;
  begin claims:=claims_text::jsonb; exception when others then raise exception using errcode='VOT02'; end;
  if jsonb_typeof(claims)<>'object' or jsonb_typeof(claims->'sub')<>'string'
    or jsonb_typeof(claims->'session_id')<>'string' or jsonb_typeof(claims->'exp')<>'number'
  then raise exception using errcode='VOT02'; end if;
  subject_text:=claims->>'sub'; session_text:=claims->>'session_id';
  if subject_text!~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or session_text!~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  then raise exception using errcode='VOT02'; end if;
  begin subject_id:=subject_text::uuid; current_session_id:=session_text::uuid;
    expires:=(claims->>'exp')::numeric;
  exception when others then raise exception using errcode='VOT02'; end;
  if subject_id::text<>subject_text or current_session_id::text<>session_text
    or expires<>trunc(expires) or expires<1 or expires>253402300799
    or to_timestamp(expires::bigint)<=statement_timestamp()
  then raise exception using errcode='VOT02'; end if;

  select * into context_row from workspace_private.workspace_context
    where session_id=current_session_id for update;
  if not found then return jsonb_build_object('invalidated',false); end if;
  if context_row.user_id<>subject_id then raise exception using errcode='VOT03'; end if;
  if context_row.revoked_at is not null then return jsonb_build_object('invalidated',false); end if;
  update workspace_private.workspace_context set revoked_at=statement_timestamp()
    where id=context_row.id returning * into context_row;
  insert into workspace_private.workspace_audit_event(
    actor_kind,user_id,session_id,context_id,organization_id,action,outcome,reason_code)
  values('organization_user',subject_id,current_session_id,context_row.id,
    context_row.organization_id,'context_invalidated','succeeded','logout');
  return jsonb_build_object('invalidated',true);
end $$;
alter function workspace_api.invalidate_workspace_context() owner to workspace_context_owner;
revoke create on schema workspace_api from workspace_context_owner;
revoke all on function workspace_api.invalidate_workspace_context() from public,anon,service_role;
grant execute on function workspace_api.invalidate_workspace_context() to authenticated;
do $$ declare r text; begin
  foreach r in array array['workspace_context_owner','workspace_audit_owner','workspace_admin_owner'] loop
    if current_setting('votus_context.'||r,true)='false' then execute format('revoke %I from %I',r,current_user); end if;
  end loop;
end $$;
commit;
