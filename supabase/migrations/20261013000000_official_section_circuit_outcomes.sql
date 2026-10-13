begin;
-- Independent CNE locales membership; the results source is NOT its denominator.
create table public.official_mesa_circuit_membership (
 election_id uuid not null references public.election(id),
 archive_entry_id text not null,
 distrito_code text not null,
 seccion_code text not null,
 circuito_code text not null check (circuito_code ~ '^([0-9]{5}|[0-9]{4}[A-Z])$'),
 circuito_raw text not null,
 mesa_code integer not null check (mesa_code>0),
 source_row_index integer not null,
 primary key(election_id,distrito_code,seccion_code,mesa_code)
);
-- One row per excluded mesa/reason, never pick one of competing ranges.
create table public.official_mesa_circuit_membership_quarantine (
 election_id uuid not null references public.election(id),
 archive_entry_id text not null,
 distrito_code text not null,
 seccion_code text not null,
 mesa_code integer not null,
 reason text not null,
 primary key(election_id,archive_entry_id,distrito_code,seccion_code,mesa_code,reason)
);
alter table public.official_mesa_circuit_membership enable row level security;
alter table public.official_mesa_circuit_membership_quarantine enable row level security;
revoke all on table public.official_mesa_circuit_membership,public.official_mesa_circuit_membership_quarantine from public,anon,authenticated;
do $$ begin
 if to_regrole('service_role') is not null then
  revoke all on table public.official_mesa_circuit_membership,public.official_mesa_circuit_membership_quarantine from service_role;
 end if;
end $$;
grant select,insert,delete on table public.official_mesa_circuit_membership,public.official_mesa_circuit_membership_quarantine to etl_writer;
do $$ begin
 perform set_config('votus_circuit_outcomes.could_set_owner',pg_has_role(current_user,'workspace_query_owner','SET')::text,true);
 if not pg_has_role(current_user,'workspace_query_owner','SET') then grant workspace_query_owner to current_user; end if;
end $$;
grant select on table public.official_mesa_circuit_membership,public.official_mesa_circuit_membership_quarantine to workspace_query_owner;
create policy workspace_query_owner_official_mesa_circuit_membership_select on public.official_mesa_circuit_membership for select to workspace_query_owner using(true);
create policy workspace_query_owner_official_mesa_circuit_membership_quarantine_select on public.official_mesa_circuit_membership_quarantine for select to workspace_query_owner using(true);
grant create on schema workspace_api to workspace_query_owner;
set role workspace_query_owner;
create function workspace_api.official_section_circuit_outcomes(
 p_election_id uuid,p_category_id uuid,p_distrito_code text,p_seccion_code text
) returns jsonb language plpgsql stable security definer
set search_path=pg_catalog,workspace_api,public,pg_temp as $$
declare base jsonb; payload jsonb; circuit_count bigint; unassigned jsonb; unassigned_total bigint;
begin
 -- Exact-section authorization and result-availability envelope precedes ALL reads.
 base:=workspace_api.official_result(p_election_id,p_category_id,p_distrito_code,p_seccion_code);
 if base->>'authorization_status' is distinct from 'authorized' or base->>'status' is distinct from 'ok' then
  return base;
 end if;
 select count(distinct circuito_code) into circuit_count from public.official_mesa_circuit_membership
 where election_id=p_election_id and distrito_code=p_distrito_code and seccion_code=p_seccion_code;
 if circuit_count>200 then
  return jsonb_build_object('status','payload_too_large','authorization_status','authorized','total_circuits',circuit_count,'truncated',true);
 end if;
 with members as (
  select mesa_code,circuito_code from public.official_mesa_circuit_membership
  where election_id=p_election_id and distrito_code=p_distrito_code and seccion_code=p_seccion_code
 ), relevant_quarantines as (
  select q.* from public.official_mesa_completeness_quarantine q
  where q.election_id=p_election_id
  and ((q.distrito_code=p_distrito_code and q.seccion_code=p_seccion_code) or q.seccion_code is null)
  and (q.scope='catalogue' or q.category_id=p_category_id or q.category_id is null)
 ), membership_reasons as (
  select reason,count(distinct mesa_code) n from public.official_mesa_circuit_membership_quarantine
  where election_id=p_election_id and distrito_code=p_distrito_code and seccion_code=p_seccion_code group by reason
 )
 select jsonb_build_object(
  'catalogue_mesas_without_membership',(select count(*) from public.official_expected_mesa e
   where e.election_id=p_election_id and e.distrito_code=p_distrito_code and e.seccion_code=p_seccion_code
   and not exists(select from members m where m.mesa_code=e.mesa_code)),
  'membership_quarantined_mesas',(select count(distinct mesa_code) from public.official_mesa_circuit_membership_quarantine
   where election_id=p_election_id and distrito_code=p_distrito_code and seccion_code=p_seccion_code),
  'membership_quarantine_reasons',coalesce((select jsonb_object_agg(reason,n) from membership_reasons),'{}'::jsonb),
  'completeness_quarantines',(select count(*) from relevant_quarantines q where q.seccion_code is null
   or not exists(select from members m where m.mesa_code=q.mesa_code)),
  'unexpected_status_mesas',(select count(*) from public.official_mesa_count_status s
   where s.election_id=p_election_id and s.category_id=p_category_id and s.distrito_code=p_distrito_code and s.seccion_code=p_seccion_code
   and not exists(select from members m where m.mesa_code=s.mesa_code)
   and not exists(select from members m where m.circuito_code=s.circuito_code))
 ) into unassigned;
 unassigned_total:=(unassigned->>'catalogue_mesas_without_membership')::bigint
  +(unassigned->>'membership_quarantined_mesas')::bigint+(unassigned->>'completeness_quarantines')::bigint
  +(unassigned->>'unexpected_status_mesas')::bigint;
 if circuit_count=0 then
  return jsonb_build_object('status','ok','authorization_status','authorized','source_kind','official','level','seccion',
   'circuit_membership','unknown','circuits','[]'::jsonb,'unassigned',unassigned,'truncated',false);
 end if;
 -- Competing archives or jurisdiction representations of the same mesa/list refuse;
 -- they cannot be made independent by grouping and summing them.
 if exists(select from public.result_row rr join public.jurisdiction j on j.id=rr.jurisdiction_id
  where rr.election_id=p_election_id and rr.category_id=p_category_id and rr.source_kind='official'
  and j.distrito_code=p_distrito_code and j.seccion_code=p_seccion_code
  group by j.mesa_code,rr.list_id having count(*)>1) then
  return jsonb_build_object('status','source_unavailable','authorization_status','authorized',
   'reason','conflicting_result_identity','truncated',false);
 end if;
 if base->>'source_granularity' is distinct from 'mesa' then
  return jsonb_build_object('status','source_unavailable','authorization_status','authorized',
   'reason','mesa_results_required','truncated',false);
 end if;
 with members as (
  select mesa_code,circuito_code from public.official_mesa_circuit_membership
  where election_id=p_election_id and distrito_code=p_distrito_code and seccion_code=p_seccion_code
 ), circuits as (select distinct circuito_code from members), statuses as (
  select mesa_code,circuito_code,count_status from public.official_mesa_count_status
  where election_id=p_election_id and category_id=p_category_id and distrito_code=p_distrito_code and seccion_code=p_seccion_code
 ), counts as (
  select c.circuito_code,
   (select count(*) from members m where m.circuito_code=c.circuito_code) expected,
   (select count(*) from members m join statuses s using(mesa_code) where m.circuito_code=c.circuito_code and s.count_status='counted') counted,
   (select count(*) from members m join statuses s using(mesa_code) where m.circuito_code=c.circuito_code and s.count_status='not_counted') not_counted,
   (select count(*) from members m where m.circuito_code=c.circuito_code and not exists(select from statuses s where s.mesa_code=m.mesa_code)) missing,
   (select count(*) from statuses s left join members m using(mesa_code)
    where (s.circuito_code=c.circuito_code and m.mesa_code is null)
     or (m.circuito_code=c.circuito_code and s.circuito_code<>m.circuito_code)) unexpected,
   (select count(*) from public.official_mesa_completeness_quarantine q join members m on m.mesa_code=q.mesa_code
    where q.election_id=p_election_id and q.distrito_code=p_distrito_code and q.seccion_code=p_seccion_code
    and m.circuito_code=c.circuito_code and (q.scope='catalogue' or q.category_id=p_category_id or q.category_id is null)) quarantined
  from circuits c
 ), raw as (
  select m.circuito_code,rr.list_id,rr.votes,e.year,c.name category_name,
   public.results_exploration_party_jurisdiction(rr.archive_entry_id,e.year,e.round,c.name,j.distrito_code,j.seccion_code) mapping_jurisdiction
  from public.result_row rr join public.jurisdiction j on j.id=rr.jurisdiction_id
  join members m on m.mesa_code=j.mesa_code
  join public.election e on e.id=rr.election_id join public.category c on c.id=rr.category_id
  where rr.election_id=p_election_id and rr.category_id=p_category_id and rr.source_kind='official'
  and j.distrito_code=p_distrito_code and j.seccion_code=p_seccion_code and rr.granularity='mesa'
 ), identified as (
  -- Same verified party mapping and helper boundary as official_result/internal_lists.
  select r.*,pm.canonical_party_id,pc.display_name from raw r
  left join public.party_mapping pm on pm.year=r.year and pm.jurisdiction=r.mapping_jurisdiction
   and pm.category=r.category_name and pm.list_id=r.list_id and pm.verified
  left join public.party_canonical pc on pc.id=pm.canonical_party_id
 ), grouped as (
  select circuito_code,canonical_party_id,display_name,
   case when canonical_party_id is null then list_id else null end unmapped_list_id,sum(votes)::bigint votes
  from identified group by circuito_code,canonical_party_id,display_name,
   case when canonical_party_id is null then list_id else null end
 ), outcomes as (
  select circuito_code,sum(votes)::bigint positive_total,
   jsonb_agg(jsonb_build_object('identity_status',case when canonical_party_id is null then 'unmapped' else 'canonical' end,
    'canonical_party_id',canonical_party_id,'display_name',display_name,'list_id',unmapped_list_id,'votes',votes)
    order by votes desc,canonical_party_id nulls last,unmapped_list_id) parties
  from grouped group by circuito_code
 )
 select jsonb_build_object('status','ok','authorization_status','authorized','source_kind','official','level','seccion',
  'circuit_membership','known','category_applicability','district_reported_categories','unassigned',unassigned,'truncated',false,
  'circuits',jsonb_agg(jsonb_build_object('circuito_code',c.circuito_code,
   'positive_total',coalesce(o.positive_total,0),'parties',coalesce(o.parties,'[]'::jsonb),
   'status',case when c.expected=c.counted and c.not_counted=0 and c.missing=0 and c.unexpected=0 and c.quarantined=0 and unassigned_total=0 then 'complete' else 'partial' end,
   'counts',jsonb_build_object('expected',c.expected,'counted',c.counted,'not_counted',c.not_counted,'missing',c.missing,'unexpected',c.unexpected,'quarantined',c.quarantined))
   order by c.circuito_code)) into payload from counts c left join outcomes o using(circuito_code);
 if octet_length(payload::text)>120000 then
  return jsonb_build_object('status','payload_too_large','authorization_status','authorized','total_bytes',octet_length(payload::text),'truncated',true);
 end if;
 return payload;
end $$;
revoke all on function workspace_api.official_section_circuit_outcomes(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function workspace_api.official_section_circuit_outcomes(uuid,uuid,text,text) to authenticated;
reset role;
revoke create on schema workspace_api from workspace_query_owner;
do $$ begin
 if to_regrole('service_role') is not null then
  revoke all on function workspace_api.official_section_circuit_outcomes(uuid,uuid,text,text) from service_role;
 end if;
 if current_setting('votus_circuit_outcomes.could_set_owner',true)='false' then
  execute format('revoke workspace_query_owner from %I',current_user);
 end if;
end $$;
commit;
