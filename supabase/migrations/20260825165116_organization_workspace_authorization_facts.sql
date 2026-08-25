begin;
do $$
declare
  admin_was_member boolean;
  audit_was_member boolean;
begin
  with recursive runner_role_closure(role_oid) as (select current_user::text::regrole::oid
    union
    select edge.roleid
    from pg_auth_members edge
    join runner_role_closure inherited on inherited.role_oid = edge.member)
  select
    bool_or(role_oid = 'workspace_admin_owner'::regrole::oid),
    bool_or(role_oid = 'workspace_audit_owner'::regrole::oid)
  into admin_was_member, audit_was_member
  from runner_role_closure;
  perform set_config('votus_pr3a.workspace_admin_owner_was_member', admin_was_member::text, true);
  perform set_config('votus_pr3a.workspace_audit_owner_was_member', audit_was_member::text, true);
  if current_setting('votus_pr3a.workspace_admin_owner_was_member', true) = 'false' then
    grant workspace_admin_owner to current_user;
  end if;
  if current_setting('votus_pr3a.workspace_audit_owner_was_member', true) = 'false' then
    grant workspace_audit_owner to current_user;
  end if;
end $$;

create table workspace_private.organization (
  id uuid default gen_random_uuid() not null,
  slug text not null,
  display_name text not null,
  disabled_at timestamptz,
  entitlement_revision bigint default 0 not null,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null,
  constraint organization_pkey primary key (id),
  constraint organization_slug_key unique (slug),
  constraint organization_slug_check check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint organization_display_name_check check (display_name = btrim(display_name) and display_name <> ''),
  constraint organization_entitlement_revision_check check (entitlement_revision >= 0),
  constraint organization_timestamps_check check (updated_at >= created_at)
);
create table workspace_private.organization_membership (
  organization_id uuid not null,
  user_id uuid not null,
  granted_at timestamptz default now() not null,
  revoked_at timestamptz,
  membership_revision bigint default 1 not null,
  constraint organization_membership_pkey primary key (organization_id, user_id),
  constraint organization_membership_organization_fkey foreign key (organization_id) references workspace_private.organization(id) on delete restrict,
  constraint organization_membership_revoked_at_check check (revoked_at is null or revoked_at >= granted_at),
  constraint organization_membership_revision_check check (membership_revision > 0)
);
create index organization_membership_active_scope_idx on workspace_private.organization_membership (user_id, organization_id) where revoked_at is null;
create table workspace_private.section_scope (
  distrito_code text not null,
  seccion_code text not null,
  constraint section_scope_pkey primary key (distrito_code, seccion_code),
  constraint section_scope_codes_check check (distrito_code = btrim(distrito_code) and distrito_code <> '' and distrito_code ~ '^[0-9]{2}$' and seccion_code = btrim(seccion_code) and seccion_code <> '' and seccion_code ~ '^[0-9]{3}$')
);
create table workspace_private.organization_section_entitlement (
  organization_id uuid not null,
  distrito_code text not null,
  seccion_code text not null,
  granted_at timestamptz default now() not null,
  revoked_at timestamptz,
  entitlement_revision bigint default 1 not null,
  constraint organization_section_entitlement_pkey primary key (organization_id, distrito_code, seccion_code),
  constraint organization_section_entitlement_organization_fkey foreign key (organization_id) references workspace_private.organization(id) on delete restrict,
  constraint organization_section_entitlement_scope_fkey foreign key (distrito_code, seccion_code) references workspace_private.section_scope(distrito_code, seccion_code) on delete restrict,
  constraint organization_section_entitlement_revoked_at_check check (revoked_at is null or revoked_at >= granted_at),
  constraint organization_section_entitlement_revision_check check (entitlement_revision > 0)
);
create index organization_section_entitlement_scope_idx on workspace_private.organization_section_entitlement (distrito_code, seccion_code);
create index organization_section_entitlement_active_scope_idx on workspace_private.organization_section_entitlement (distrito_code, seccion_code, organization_id) where revoked_at is null;
create table workspace_private.workspace_audit_event (
  id uuid default gen_random_uuid() not null,
  occurred_at timestamptz default now() not null,
  actor_kind text not null,
  actor_ref text,
  user_id uuid,
  session_id uuid,
  context_id uuid,
  organization_id uuid,
  action text not null,
  outcome text not null,
  reason_code text,
  detail jsonb default '{}'::jsonb not null,
  constraint workspace_audit_event_pkey primary key (id),
  constraint workspace_audit_event_organization_fkey foreign key (organization_id) references workspace_private.organization(id) on delete restrict,
  constraint workspace_audit_event_actor_kind_check check (actor_kind in ('platform_operator','organization_user','system','etl')),
  constraint workspace_audit_event_actor_ref_check check (actor_ref is null or (actor_ref = btrim(actor_ref) and actor_ref <> '')),
  constraint workspace_audit_event_action_check check (action in ('organization_created','organization_disabled','membership_granted','membership_revoked','section_scope_registered','section_entitlement_granted','section_entitlement_revoked','context_bootstrapped','context_switched','context_invalidated','context_revoked','authorization_denied','review_scope_recorded','review_visibility_denied')),
  constraint workspace_audit_event_outcome_check check (outcome in ('succeeded','denied','no_op')),
  constraint workspace_audit_event_reason_code_check check (reason_code is null or reason_code in ('operator_request','same_state','organization_disabled','membership_missing','membership_revoked','entitlement_missing','entitlement_revoked','section_not_entitled','scope_invalid','claims_invalid','claims_mismatch','context_missing','context_stale','context_expired','context_revoked','context_conflict','bearer_invalid','source_kind_denied','platform_only_review','logout','session_revoked','organization_switched')),
  constraint workspace_audit_event_detail_check check (jsonb_typeof(detail) = 'object')
);
create index workspace_audit_event_organization_idx on workspace_private.workspace_audit_event (organization_id, occurred_at desc) where organization_id is not null;
create index workspace_audit_event_session_idx on workspace_private.workspace_audit_event (session_id, occurred_at desc) where session_id is not null;
create index workspace_audit_event_user_idx on workspace_private.workspace_audit_event (user_id, occurred_at desc) where user_id is not null;

alter table workspace_private.organization owner to workspace_admin_owner;
alter table workspace_private.organization_membership owner to workspace_admin_owner;
alter table workspace_private.section_scope owner to workspace_admin_owner;
alter table workspace_private.organization_section_entitlement owner to workspace_admin_owner;
alter table workspace_private.workspace_audit_event owner to workspace_audit_owner;
alter table workspace_private.organization enable row level security;
alter table workspace_private.organization force row level security;
alter table workspace_private.organization_membership enable row level security;
alter table workspace_private.organization_membership force row level security;
alter table workspace_private.section_scope enable row level security;
alter table workspace_private.section_scope force row level security;
alter table workspace_private.organization_section_entitlement enable row level security;
alter table workspace_private.organization_section_entitlement force row level security;
alter table workspace_private.workspace_audit_event enable row level security;
alter table workspace_private.workspace_audit_event force row level security;
revoke all on table workspace_private.organization from public;
revoke all on table workspace_private.organization_membership from public;
revoke all on table workspace_private.section_scope from public;
revoke all on table workspace_private.organization_section_entitlement from public;
revoke all on table workspace_private.workspace_audit_event from public;
do $$
declare boundary_role text; sequence_name text;
begin
  foreach boundary_role in array array['anon','authenticated','service_role','etl_writer','workspace_bootstrap_caller','workspace_context_owner','workspace_query_owner','workspace_review_ingest_owner','workspace_platform_admin'] loop
    if to_regrole(boundary_role) is not null then
      execute format('revoke all on table workspace_private.organization, workspace_private.organization_membership, workspace_private.section_scope, workspace_private.organization_section_entitlement, workspace_private.workspace_audit_event from %I', boundary_role);
    end if;
  end loop;
  for sequence_name in select format('%I.%I', n.nspname, s.relname) from pg_class s join pg_namespace n on n.oid=s.relnamespace join pg_depend d on d.objid=s.oid where s.relkind='S' and d.refobjid=any(array['workspace_private.organization'::regclass,'workspace_private.organization_membership'::regclass,'workspace_private.section_scope'::regclass,'workspace_private.organization_section_entitlement'::regclass,'workspace_private.workspace_audit_event'::regclass]) loop
    execute format('revoke all on sequence %s from public', sequence_name);
    foreach boundary_role in array array['anon','authenticated','service_role','etl_writer','workspace_bootstrap_caller','workspace_context_owner','workspace_query_owner','workspace_review_ingest_owner','workspace_platform_admin'] loop
      if to_regrole(boundary_role) is not null then execute format('revoke all on sequence %s from %I', sequence_name, boundary_role); end if;
    end loop;
  end loop;
end $$;
do $$
begin
  if current_setting('votus_pr3a.workspace_audit_owner_was_member', true) = 'false' then
    revoke workspace_audit_owner from current_user;
  end if;
  if current_setting('votus_pr3a.workspace_admin_owner_was_member', true) = 'false' then
    revoke workspace_admin_owner from current_user;
  end if;
end $$;
commit;
