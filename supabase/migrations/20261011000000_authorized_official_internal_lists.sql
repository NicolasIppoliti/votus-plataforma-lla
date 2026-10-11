begin;
do $$ begin
 perform set_config('votus_internal_lists.could_set_owner',pg_has_role(current_user,'workspace_query_owner','SET')::text,true);
 if not pg_has_role(current_user,'workspace_query_owner','SET') then grant workspace_query_owner to current_user; end if;
end $$;
grant select on public.list_identity to workspace_query_owner;
create policy workspace_query_owner_list_identity_select on public.list_identity for select to workspace_query_owner using(true);
grant create on schema workspace_api to workspace_query_owner;
set role workspace_query_owner;
-- National ingestion persists POSITIVO rows only. Non-positive totals are
-- unavailable, not measured zero. Keep the existing parent aggregate untouched.
create function workspace_api.official_internal_lists(
 p_election_id uuid,p_category_id uuid,p_distrito_code text,p_seccion_code text
) returns jsonb language plpgsql stable security definer
set search_path=pg_catalog,workspace_api,public,pg_temp as $$
declare base jsonb; payload jsonb; conflicts bigint; unsupported bigint;
begin
 -- Reuse exact-section authorization, missing-section and mixed-level guards.
 -- No result or identity lookup occurs before this authorization envelope.
 base:=workspace_api.official_result(p_election_id,p_category_id,p_distrito_code,p_seccion_code);
 if base->>'authorization_status' is distinct from 'authorized' or base->>'status' is distinct from 'ok' then
  return base;
 end if;
 select count(*) into unsupported
 from public.result_row rr join public.jurisdiction j on j.id=rr.jurisdiction_id
 join public.election e on e.id=rr.election_id
 where rr.election_id=p_election_id and rr.category_id=p_category_id
 and rr.source_kind='official' and j.distrito_code=p_distrito_code and j.seccion_code=p_seccion_code
 and (e.round<>'paso' or rr.archive_entry_id !~ '^national/');
 if unsupported>0 then
  return jsonb_build_object('status','source_unavailable','authorization_status','authorized','truncated',false,
   'counts',jsonb_build_object('unsupported_internal_list_source',unsupported));
 end if;
 -- GROUP BY is NULL-safe. Different mesas may sum; competing archives for the
 -- same jurisdiction/list may not. Refuse even identical competing tallies.
 select count(*) into conflicts from (
  select rr.jurisdiction_id,rr.list_id from public.result_row rr
  join public.jurisdiction j on j.id=rr.jurisdiction_id
  where rr.election_id=p_election_id and rr.category_id=p_category_id
  and rr.source_kind='official' and j.distrito_code=p_distrito_code and j.seccion_code=p_seccion_code
  group by rr.jurisdiction_id,rr.list_id having count(*)>1
 ) duplicate_identities;
 if conflicts>0 then
  return jsonb_build_object('status','source_unavailable','authorization_status','authorized','truncated',false,
   'counts',jsonb_build_object('conflicting_result_identity',conflicts));
 end if;
 -- Supported national PASO rows share one mapping scheme. UNIQUE full keys
 -- (year,jurisdiction,category,list_id) prevent competing curated identities.
 with raw as (
  select rr.list_id,rr.votes,e.year,c.name category_name,
   public.results_exploration_party_jurisdiction(rr.archive_entry_id,e.year,e.round,c.name,
    j.distrito_code,j.seccion_code) mapping_jurisdiction
  from public.result_row rr join public.jurisdiction j on j.id=rr.jurisdiction_id
  join public.election e on e.id=rr.election_id join public.category c on c.id=rr.category_id
  where rr.election_id=p_election_id and rr.category_id=p_category_id
  and rr.source_kind='official' and j.distrito_code=p_distrito_code and j.seccion_code=p_seccion_code
 ), identified as (
  select r.list_id,r.votes,pm.canonical_party_id,pc.display_name,li.source_name
  from raw r left join public.party_mapping pm on pm.year=r.year and pm.jurisdiction=r.mapping_jurisdiction
   and pm.category=r.category_name and pm.list_id=r.list_id and pm.verified
  left join public.party_canonical pc on pc.id=pm.canonical_party_id
  left join public.list_identity li on li.year=r.year and li.jurisdiction=r.mapping_jurisdiction
   and li.category=r.category_name and li.list_id=r.list_id
 ), grouped as (
  select list_id,canonical_party_id,display_name,source_name,sum(votes)::bigint votes
  from identified group by list_id,canonical_party_id,display_name,source_name
 )
 select jsonb_build_object('status','ok','authorization_status','authorized','source_kind','official',
  'level','seccion','source_granularity',base->'source_granularity','category_name',base->'category_name',
  'positive_total',coalesce(sum(votes),0),'truncated',false,
  'non_positive',jsonb_build_object('status','unavailable','reason','not_persisted_by_national_ingestion'),
  'lists',coalesce(jsonb_agg(jsonb_build_object('canonical_party_id',canonical_party_id,'display_name',display_name,
   'list_id',list_id,'source_name',source_name,'identity_status',case when canonical_party_id is null or source_name is null
    then 'unmapped' else 'canonical' end,'votes',votes) order by canonical_party_id nulls last,list_id),'[]'::jsonb))
 into payload from grouped;
 if octet_length(payload::text)>120000 then
  return jsonb_build_object('status','payload_too_large','authorization_status','authorized',
   'total_bytes',octet_length(payload::text),'truncated',true);
 end if;
 return payload;
end $$;
revoke all on function workspace_api.official_internal_lists(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function workspace_api.official_internal_lists(uuid,uuid,text,text) to authenticated;
reset role;
revoke create on schema workspace_api from workspace_query_owner;
do $$ begin
 if to_regrole('service_role') is not null then
  revoke all on function workspace_api.official_internal_lists(uuid,uuid,text,text) from service_role;
 end if;
 if current_setting('votus_internal_lists.could_set_owner',true)='false' then
  execute format('revoke workspace_query_owner from %I',current_user);
 end if;
end $$;
commit;
