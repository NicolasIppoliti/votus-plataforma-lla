begin;
-- Expected official mesa universe and per-category count status (S6, T3-0a).
-- Both are extracted by national ingestion BEFORE vote filtering, so a mesa
-- with no accepted vote row is still expected and still has a count status.
-- The catalogue carries no circuito or category: it is the section-level
-- denominator, and category applicability is a stated assumption.
create table public.official_expected_mesa (
  election_id uuid not null references public.election(id),
  archive_entry_id text not null,
  distrito_code text not null,
  seccion_code text not null,
  mesa_code integer not null,
  mesa_tipo text not null check (mesa_tipo in ('NATIVOS','EXTRANJEROS')),
  electores integer not null check (electores >= 0),
  source_row_index integer not null,
  -- election_id is part of the natural key (AGENTS rule 10); no nullable key columns.
  primary key (election_id, distrito_code, seccion_code, mesa_code)
);
create table public.official_mesa_count_status (
  election_id uuid not null references public.election(id),
  archive_entry_id text not null,
  category_id uuid not null references public.category(id),
  distrito_code text not null,
  seccion_code text not null,
  circuito_code text not null,
  mesa_code integer not null,
  count_status text not null check (count_status in ('counted','not_counted')),
  primary key (election_id, category_id, distrito_code, seccion_code, mesa_code)
);
-- Quarantine survives exclusion from the accepted universe; nullable identities are
-- replaced per archive + election, never resolved through ON CONFLICT.
create table public.official_mesa_completeness_quarantine (
  id bigint generated always as identity primary key,
  election_id uuid not null references public.election(id),
  archive_entry_id text not null,
  scope text not null check (scope in ('catalogue','status')),
  category_id uuid references public.category(id),
  distrito_code text,
  seccion_code text,
  mesa_code integer,
  reason text not null,
  check ((distrito_code is null) = (seccion_code is null))
);
create index official_mesa_completeness_quarantine_election_idx
 on public.official_mesa_completeness_quarantine(election_id, archive_entry_id);
alter table public.official_mesa_completeness_quarantine enable row level security;
revoke all on table public.official_mesa_completeness_quarantine from public, anon, authenticated;
do $$ begin
 if to_regrole('service_role') is not null then
  revoke all on table public.official_mesa_completeness_quarantine from service_role;
 end if;
end $$;
grant select, insert, delete on table public.official_mesa_completeness_quarantine to etl_writer;
grant usage on sequence public.official_mesa_completeness_quarantine_id_seq to etl_writer;
grant select on table public.official_mesa_completeness_quarantine to workspace_query_owner;
create policy workspace_query_owner_official_mesa_completeness_quarantine_select
 on public.official_mesa_completeness_quarantine for select to workspace_query_owner using(true);
create index official_mesa_count_status_archive_idx on public.official_mesa_count_status(archive_entry_id);
create index official_expected_mesa_archive_idx on public.official_expected_mesa(archive_entry_id);
alter table public.official_expected_mesa enable row level security;
alter table public.official_mesa_count_status enable row level security;
revoke all on table public.official_expected_mesa, public.official_mesa_count_status from public, anon, authenticated;
do $$ begin
 if to_regrole('service_role') is not null then
  execute 'revoke all on table public.official_expected_mesa, public.official_mesa_count_status from service_role';
 end if;
end $$;
grant select, insert, delete on table public.official_expected_mesa, public.official_mesa_count_status to etl_writer;

do $$ begin
 perform set_config('votus_completeness.could_set_owner',pg_has_role(current_user,'workspace_query_owner','SET')::text,true);
 if not pg_has_role(current_user,'workspace_query_owner','SET') then grant workspace_query_owner to current_user; end if;
end $$;
grant select on table public.official_expected_mesa, public.official_mesa_count_status to workspace_query_owner;
create policy workspace_query_owner_official_expected_mesa_select on public.official_expected_mesa for select to workspace_query_owner using(true);
create policy workspace_query_owner_official_mesa_count_status_select on public.official_mesa_count_status for select to workspace_query_owner using(true);
grant create on schema workspace_api to workspace_query_owner;
set role workspace_query_owner;
create function workspace_api.official_section_completeness(
 p_election_id uuid,p_category_id uuid,p_distrito_code text,p_seccion_code text
) returns jsonb language plpgsql stable security definer
set search_path=pg_catalog,workspace_api,public,pg_temp as $$
declare base jsonb; has_catalogue boolean; expected bigint; counted bigint; not_counted bigint;
 missing bigint; unexpected bigint; quarantined bigint; unattributed_quarantined bigint;
 catalogue_sources jsonb; status_sources jsonb;
begin
 -- Reuse exact-section authorization, missing-section and mixed-level guards.
 -- No completeness lookup occurs before this authorization envelope.
 base:=workspace_api.official_result(p_election_id,p_category_id,p_distrito_code,p_seccion_code);
 if base->>'authorization_status' is distinct from 'authorized' or base->>'status' is distinct from 'ok' then
  return base;
 end if;
 select exists(select from public.official_expected_mesa where election_id=p_election_id)
  or exists(select from public.official_mesa_completeness_quarantine where election_id=p_election_id and scope='catalogue')
 into has_catalogue;
 if not has_catalogue then
  return jsonb_build_object('status','ok','authorization_status','authorized','source_kind','official','level','seccion',
   'completeness',jsonb_build_object('status','unknown','reason','no_expected_catalogue','counts',null,
    'category_applicability','district_reported_categories','sources',null));
 end if;
 with expected_rows as (
  select mesa_code from public.official_expected_mesa
  where election_id=p_election_id and distrito_code=p_distrito_code and seccion_code=p_seccion_code
 ), status_rows as (
  select mesa_code,count_status from public.official_mesa_count_status
  where election_id=p_election_id and category_id=p_category_id
  and distrito_code=p_distrito_code and seccion_code=p_seccion_code
 )
 select (select count(*) from expected_rows),
  (select count(*) from status_rows s join expected_rows e using(mesa_code) where s.count_status='counted'),
  (select count(*) from status_rows s join expected_rows e using(mesa_code) where s.count_status='not_counted'),
  (select count(*) from expected_rows e where not exists(select from status_rows s where s.mesa_code=e.mesa_code)),
  (select count(*) from status_rows s where not exists(select from expected_rows e where e.mesa_code=s.mesa_code))
 into expected,counted,not_counted,missing,unexpected;
 select count(*) into quarantined from public.official_mesa_completeness_quarantine
 where election_id=p_election_id and distrito_code=p_distrito_code and seccion_code=p_seccion_code
 and (scope='catalogue' or category_id=p_category_id);
 select count(*) into unattributed_quarantined from public.official_mesa_completeness_quarantine
 where election_id=p_election_id and seccion_code is null
 and (scope='catalogue' or category_id=p_category_id or category_id is null);
 select coalesce(jsonb_agg(distinct archive_entry_id order by archive_entry_id),'[]'::jsonb) into catalogue_sources
 from public.official_expected_mesa where election_id=p_election_id and distrito_code=p_distrito_code and seccion_code=p_seccion_code;
 select coalesce(jsonb_agg(distinct archive_entry_id order by archive_entry_id),'[]'::jsonb) into status_sources
 from public.official_mesa_count_status where election_id=p_election_id and category_id=p_category_id
 and distrito_code=p_distrito_code and seccion_code=p_seccion_code;
 return jsonb_build_object('status','ok','authorization_status','authorized','source_kind','official','level','seccion',
  'completeness',jsonb_build_object(
   -- Complete only when every expected mesa is counted and nothing is missing or unexpected.
   -- A section the catalogue does not list is unknown and carries no counts.
   'status',case when expected>0 and counted=expected and not_counted=0 and missing=0 and unexpected=0 and quarantined=0 and unattributed_quarantined=0
    then 'complete' when expected=0 then 'unknown' else 'partial' end,
   'reason',case when expected=0 then 'section_absent_from_catalogue' else null end,
   -- Never drop status rows silently: an absent section still reports what the source listed.
   'unlisted_status_mesas',case when expected=0 then unexpected else null end,
   'quarantined_mesas',case when expected=0 then quarantined else null end,
   'unattributed_quarantined',case when expected=0 then unattributed_quarantined else null end,
   'counts',case when expected=0 then null else jsonb_build_object('expected',expected,'counted',counted,
    'not_counted',not_counted,'missing',missing,'unexpected',unexpected,
    'quarantined',quarantined,'unattributed_quarantined',unattributed_quarantined) end,
   'category_applicability','district_reported_categories',
   'sources',jsonb_build_object('catalogue_archive_entry_ids',catalogue_sources,'status_archive_entry_ids',status_sources)));
end $$;
revoke all on function workspace_api.official_section_completeness(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function workspace_api.official_section_completeness(uuid,uuid,text,text) to authenticated;
reset role;
revoke create on schema workspace_api from workspace_query_owner;
do $$ begin
 if to_regrole('service_role') is not null then
  revoke all on function workspace_api.official_section_completeness(uuid,uuid,text,text) from service_role;
 end if;
 if current_setting('votus_completeness.could_set_owner',true)='false' then
  execute format('revoke workspace_query_owner from %I',current_user);
 end if;
end $$;
commit;
