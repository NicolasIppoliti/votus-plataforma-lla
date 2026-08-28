grant select, insert, update, delete
on table public.category,
public.jurisdiction,
public.election,
public.archive_entry,
public.result_row
to service_role;

grant select, insert, delete
on table public.party_canonical,
public.party_mapping
to service_role;

grant insert (id, kind, severity, subject_ref, detected_at, note)
on table public.review_item
to service_role;

grant delete
on table public.review_item
to service_role;

grant select (id)
on table public.review_item
to service_role;

grant workspace_admin_owner to current_user;
grant workspace_context_owner,workspace_review_ingest_owner to workspace_admin_owner with inherit true,set false;
grant workspace_admin_owner to workspace_audit_owner with inherit true,set false;
grant workspace_audit_owner to current_user;
set role workspace_audit_owner; create policy e2e_workspace_audit_owner_delete on workspace_private.workspace_audit_event for delete to workspace_audit_owner using(true); reset role;
grant update,delete on public.review_item to workspace_audit_owner;
create policy e2e_workspace_audit_review_all on public.review_item for all to workspace_audit_owner using(true) with check(true);
grant create on schema public to workspace_audit_owner;
set role workspace_audit_owner;
create function public.e2e_setup_authorized_review_fixture(p_user_id uuid, p_review_item_id uuid) returns jsonb
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare
  organization_id uuid := gen_random_uuid();
  distrito_code text := '02';
  seccion_code text := '027';
  owns_section_scope boolean := false;
begin
  if p_user_id is null or p_review_item_id is null then raise exception 'e2e authorized review fixture identifiers are required'; end if;
  if p_review_item_id <> '00000000-0000-4000-8000-000000000024'::uuid then raise exception 'e2e authorized review fixture review item is not owned'; end if;
    perform 1 from public.review_item item
  where item.id = p_review_item_id and item.resolved_at is null and item.tenant_scope_state = 'platform_only'
    and not exists (select 1 from workspace_private.review_item_section_scope scope where scope.review_item_id = item.id)
  for update;
  if not found then raise exception 'e2e authorized review fixture review item is missing or collides'; end if;
  if exists (select 1 from workspace_private.organization where slug = 'e2e-authorized-review-browser') then raise exception 'e2e authorized review fixture organization collides'; end if;
    insert into workspace_private.organization(id, slug, display_name, entitlement_revision)
  values (organization_id, 'e2e-authorized-review-browser', 'E2E Authorized Review Browser', 1);
  insert into workspace_private.organization_membership(organization_id, user_id) values (organization_id, p_user_id);
  insert into workspace_private.section_scope values (distrito_code, seccion_code)
  on conflict do nothing returning true into owns_section_scope;
  insert into workspace_private.organization_section_entitlement(organization_id, distrito_code, seccion_code)
  values (organization_id, distrito_code, seccion_code);
  update public.review_item set tenant_scope_state = 'section_scoped'
  where id = p_review_item_id and tenant_scope_state = 'platform_only';
  if not found then raise exception 'e2e authorized review fixture review item changed concurrently'; end if;
  insert into workspace_private.review_item_section_scope(review_item_id, distrito_code, seccion_code)
  values (p_review_item_id, distrito_code, seccion_code);
  return jsonb_build_object(
    'fixture_version', 1, 'organization_id', organization_id, 'user_id', p_user_id,
    'review_item_id', p_review_item_id, 'distrito_code', distrito_code,
    'seccion_code', seccion_code, 'owns_section_scope', coalesce(owns_section_scope, false)
  );
end $$;

create function public.e2e_cleanup_authorized_review_fixture(p_fixture jsonb) returns jsonb
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare
  fixture_organization_id uuid;
  fixture_user_id uuid;
  fixture_review_item_id uuid;
  fixture_distrito_code text;
  fixture_seccion_code text;
  fixture_owns_section_scope boolean;
  removed_section_scope boolean := false;
begin
  if jsonb_typeof(p_fixture) <> 'object' then raise exception 'e2e authorized review fixture cleanup token is invalid'; end if;
  begin
    fixture_organization_id := (p_fixture->>'organization_id')::uuid;
    fixture_user_id := (p_fixture->>'user_id')::uuid;
    fixture_review_item_id := (p_fixture->>'review_item_id')::uuid;
    fixture_distrito_code := p_fixture->>'distrito_code';
    fixture_seccion_code := p_fixture->>'seccion_code';
    fixture_owns_section_scope := (p_fixture->>'owns_section_scope')::boolean;
  exception when others then raise exception 'e2e authorized review fixture cleanup token is invalid';
  end;
  if (p_fixture->>'fixture_version') <> '1'
    or fixture_review_item_id <> '00000000-0000-4000-8000-000000000024'::uuid
    or fixture_distrito_code !~ '^[0-9]{2}$' or fixture_seccion_code !~ '^[0-9]{3}$'
  then raise exception 'e2e authorized review fixture cleanup token is invalid'; end if;
  perform 1 from workspace_private.organization organization
  join workspace_private.organization_membership membership on membership.organization_id = organization.id
  join workspace_private.organization_section_entitlement entitlement on entitlement.organization_id = organization.id
  join workspace_private.review_item_section_scope review_scope
    on (review_scope.distrito_code, review_scope.seccion_code) = (entitlement.distrito_code, entitlement.seccion_code)
  join public.review_item review_item on review_item.id = review_scope.review_item_id
  where organization.id = fixture_organization_id and organization.slug = 'e2e-authorized-review-browser'
    and membership.user_id = fixture_user_id and membership.revoked_at is null
    and (entitlement.distrito_code, entitlement.seccion_code) = (fixture_distrito_code, fixture_seccion_code)
    and entitlement.revoked_at is null and review_item.id = fixture_review_item_id
    and review_item.tenant_scope_state = 'section_scoped'
  for update of organization, membership, entitlement, review_scope, review_item;
  if not found then raise exception 'e2e authorized review fixture cleanup facts are missing or collide'; end if;

  delete from workspace_private.workspace_context where organization_id = fixture_organization_id;
  delete from workspace_private.workspace_audit_event where organization_id = fixture_organization_id;
  delete from workspace_private.review_item_section_scope where review_item_id = fixture_review_item_id;
  delete from public.review_item where id = fixture_review_item_id;
  delete from workspace_private.organization_section_entitlement where organization_id = fixture_organization_id;
  delete from workspace_private.organization_membership where organization_id = fixture_organization_id;
  delete from workspace_private.organization where id = fixture_organization_id and slug = 'e2e-authorized-review-browser';
  if fixture_owns_section_scope then
    delete from workspace_private.section_scope scope
    where (scope.distrito_code, scope.seccion_code) = (fixture_distrito_code, fixture_seccion_code)
      and not exists (select 1 from workspace_private.organization_section_entitlement entitlement where (entitlement.distrito_code, entitlement.seccion_code) = (scope.distrito_code, scope.seccion_code))
      and not exists (select 1 from workspace_private.review_item_section_scope review_scope where (review_scope.distrito_code, review_scope.seccion_code) = (scope.distrito_code, scope.seccion_code));
    removed_section_scope := found;
  end if;
  return jsonb_build_object('cleaned', true, 'removed_section_scope', removed_section_scope);
end $$;

create function public.e2e_setup_authorized_fiscal_fixture(p_user_id uuid, p_distrito_code text, p_seccion_code text) returns jsonb language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare organization_id uuid := gen_random_uuid(); distrito_code text := p_distrito_code; seccion_code text := p_seccion_code; owns_section_scope boolean := false; begin
  if p_user_id is null or p_distrito_code !~ '^[0-9]{2}$' or p_seccion_code !~ '^[0-9]{3}$' then raise exception 'e2e authorized fiscal fixture inputs are invalid'; end if; if exists (select 1 from workspace_private.organization where slug = 'e2e-authorized-fiscal-browser') then raise exception 'e2e authorized fiscal fixture organization collides'; end if; insert into workspace_private.organization(id, slug, display_name, entitlement_revision) values (organization_id, 'e2e-authorized-fiscal-browser', 'E2E Authorized Fiscal Browser', 1); insert into workspace_private.organization_membership(organization_id, user_id) values (organization_id, p_user_id); insert into workspace_private.section_scope values (distrito_code, seccion_code) on conflict do nothing returning true into owns_section_scope; insert into workspace_private.organization_section_entitlement(organization_id, distrito_code, seccion_code) values (organization_id, distrito_code, seccion_code); return jsonb_build_object('fixture_version', 1, 'organization_id', organization_id, 'user_id', p_user_id, 'distrito_code', distrito_code, 'seccion_code', seccion_code, 'owns_section_scope', coalesce(owns_section_scope, false));
end $$;
create function public.e2e_cleanup_authorized_fiscal_fixture(p_fixture jsonb) returns jsonb language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare fixture_organization_id uuid; fixture_user_id uuid; fixture_distrito_code text; fixture_seccion_code text; fixture_owns_section_scope boolean; begin
  if jsonb_typeof(p_fixture) <> 'object' then raise exception 'e2e authorized fiscal fixture cleanup token is invalid'; end if; begin fixture_organization_id := (p_fixture->>'organization_id')::uuid; fixture_user_id := (p_fixture->>'user_id')::uuid; fixture_distrito_code := p_fixture->>'distrito_code'; fixture_seccion_code := p_fixture->>'seccion_code'; fixture_owns_section_scope := (p_fixture->>'owns_section_scope')::boolean; exception when others then raise exception 'e2e authorized fiscal fixture cleanup token is invalid'; end; if (p_fixture->>'fixture_version') <> '1' or fixture_distrito_code !~ '^[0-9]{2}$' or fixture_seccion_code !~ '^[0-9]{3}$' then raise exception 'e2e authorized fiscal fixture cleanup token is invalid'; end if; perform 1 from workspace_private.organization organization join workspace_private.organization_membership membership on membership.organization_id = organization.id join workspace_private.organization_section_entitlement entitlement on entitlement.organization_id = organization.id where organization.id = fixture_organization_id and organization.slug = 'e2e-authorized-fiscal-browser' and membership.user_id = fixture_user_id and membership.revoked_at is null and (entitlement.distrito_code, entitlement.seccion_code) = (fixture_distrito_code, fixture_seccion_code) and entitlement.revoked_at is null for update of organization, membership, entitlement; if not found then raise exception 'e2e authorized fiscal fixture cleanup facts are missing or collide'; end if; delete from workspace_private.workspace_context where organization_id = fixture_organization_id; delete from workspace_private.workspace_audit_event where organization_id = fixture_organization_id; delete from workspace_private.organization_section_entitlement where organization_id = fixture_organization_id; delete from workspace_private.organization_membership where organization_id = fixture_organization_id; delete from workspace_private.organization where id = fixture_organization_id and slug = 'e2e-authorized-fiscal-browser'; if fixture_owns_section_scope then delete from workspace_private.section_scope scope where (scope.distrito_code, scope.seccion_code) = (fixture_distrito_code, fixture_seccion_code) and not exists (select 1 from workspace_private.organization_section_entitlement entitlement where (entitlement.distrito_code, entitlement.seccion_code) = (scope.distrito_code, scope.seccion_code)) and not exists (select 1 from workspace_private.review_item_section_scope review_scope where (review_scope.distrito_code, review_scope.seccion_code) = (scope.distrito_code, scope.seccion_code)); end if; return jsonb_build_object('cleaned', true);
end $$;
revoke all on function public.e2e_setup_authorized_review_fixture(uuid, uuid) from public, anon, authenticated;
revoke all on function public.e2e_cleanup_authorized_review_fixture(jsonb) from public, anon, authenticated;
revoke all on function public.e2e_setup_authorized_fiscal_fixture(uuid,text,text) from public, anon, authenticated;
revoke all on function public.e2e_cleanup_authorized_fiscal_fixture(jsonb) from public, anon, authenticated;
grant execute on function public.e2e_setup_authorized_review_fixture(uuid, uuid) to service_role;
grant execute on function public.e2e_cleanup_authorized_review_fixture(jsonb) to service_role;
grant execute on function public.e2e_setup_authorized_fiscal_fixture(uuid,text,text) to service_role;
grant execute on function public.e2e_cleanup_authorized_fiscal_fixture(jsonb) to service_role;
reset role;
revoke create on schema public from workspace_audit_owner;
revoke workspace_admin_owner,workspace_audit_owner from current_user;
select pg_notify('pgrst','reload schema');
