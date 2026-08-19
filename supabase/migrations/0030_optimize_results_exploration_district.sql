begin; create index if not exists result_row_official_district_geography_idx on result_row (jurisdiction_id, election_id, category_id) include (archive_entry_id, granularity, list_id, votes) where source_kind = 'official';
alter function results_exploration_official(uuid,uuid,text,text,text,text,integer,text) rename to results_exploration_official_wrapper_0029;
revoke all on function results_exploration_official_wrapper_0029(uuid,uuid,text,text,text,text,integer,text) from public,anon,authenticated; grant execute on function results_exploration_official_wrapper_0029(uuid,uuid,text,text,text,text,integer,text) to results_exploration_executor;
create function results_exploration_official_0030(p_election_id uuid,p_category_id uuid,p_distrito_code text,p_seccion_code text default null,p_circuito_code text default null,p_establecimiento_code text default null,p_mesa_code integer default null,p_requested_level text default 'seccion') returns jsonb
language plpgsql stable security invoker set search_path=public,pg_temp as $$ declare election_exists boolean; category_exists boolean; begin
  if p_election_id is null or p_category_id is null or p_distrito_code is null then return results_exploration_official_0029(p_election_id,p_category_id,p_distrito_code,p_seccion_code,p_circuito_code,p_establecimiento_code,p_mesa_code,p_requested_level); end if;
  select exists(select 1 from election where id=p_election_id),exists(select 1 from category where id=p_category_id) into election_exists,category_exists;
  if not election_exists or not category_exists then return jsonb_build_object('status','selection_invalid','reason',case when not election_exists and not category_exists then 'unknown election_id and category_id' when not election_exists then 'unknown election_id' else 'unknown category_id' end,
    'counts',jsonb_strip_nulls(jsonb_build_object('unknown_election_id',case when not election_exists then 1 end,'unknown_category_id',case when not category_exists then 1 end))); end if;
  if p_requested_level is distinct from 'distrito' or p_seccion_code is not null or p_circuito_code is not null or p_establecimiento_code is not null or p_mesa_code is not null then return results_exploration_official_0029(p_election_id,p_category_id,p_distrito_code,p_seccion_code,p_circuito_code,p_establecimiento_code,p_mesa_code,p_requested_level); end if;
  return (with target_jurisdictions as materialized (select id,seccion_code,mesa_code from jurisdiction where distrito_code=p_distrito_code), raw_rows as materialized (
    select rr.archive_entry_id,rr.granularity,rr.list_id,rr.votes,j.id jurisdiction_id,p_distrito_code distrito_code,j.seccion_code,j.mesa_code,e.year,e.round,c.name category_name
    from target_jurisdictions j cross join lateral (select fact.archive_entry_id,fact.granularity,fact.list_id,fact.votes from result_row fact where fact.jurisdiction_id=j.id and fact.election_id=p_election_id and fact.category_id=p_category_id and fact.source_kind='official' offset 0) rr
    join election e on e.id=p_election_id join category c on c.id=p_category_id), source_shapes as materialized (
    select distinct archive_entry_id,granularity,distrito_code,seccion_code,year,round,category_name from raw_rows), normalized_shapes as materialized (
    select s.*,results_exploration_reporting_level(archive_entry_id,granularity,distrito_code,seccion_code) effective_level,
      results_exploration_party_jurisdiction(archive_entry_id,year,round,category_name,distrito_code,seccion_code) mapping_jurisdiction from source_shapes s), classified_rows as materialized (
    select r.*,s.effective_level,s.mapping_jurisdiction,case when r.granularity='distrito' and s.effective_level='seccion' then 'pba_partido_rows_not_province_aggregate'
      when r.granularity='mesa' and s.effective_level='mesa' and r.mesa_code is null then 'official_rows_without_mesa_code' end exclusion_reason
    from raw_rows r join normalized_shapes s on s.archive_entry_id=r.archive_entry_id and s.granularity=r.granularity and s.distrito_code=r.distrito_code
      and s.seccion_code is not distinct from r.seccion_code and s.year=r.year and s.round=r.round and s.category_name=r.category_name
  ), exclusion_groups as (select exclusion_reason reason,count(*)::bigint rows,coalesce(sum(votes),0)::bigint votes from classified_rows where exclusion_reason is not null group by exclusion_reason),
  levels as (select effective_level,count(*)::bigint rows from classified_rows where exclusion_reason is null group by 1), state as (
    select coalesce(sum(rows),0)::bigint row_count,count(*)::bigint level_count,min(effective_level) source_granularity,
      coalesce(jsonb_object_agg('included_'||effective_level||'_rows',rows),'{}'::jsonb) counts,(select count(*) from exclusion_groups)::bigint exclusion_count from levels
  ), selected as materialized (select r.* from classified_rows r cross join state s where r.exclusion_reason is null and r.effective_level=s.source_granularity),
  preaggregated as (select year,round,category_name,mapping_jurisdiction,list_id,sum(votes)::bigint votes from selected group by year,round,category_name,mapping_jurisdiction,list_id), identified as (
    select a.*,pm.canonical_party_id,pc.display_name from preaggregated a left join party_mapping pm on pm.year=a.year
      and pm.jurisdiction=a.mapping_jurisdiction and pm.category=a.category_name and pm.list_id=a.list_id and pm.verified
    left join party_canonical pc on pc.id=pm.canonical_party_id), grouped as (
    select canonical_party_id,display_name,case when canonical_party_id is null then list_id end list_id,sum(votes)::bigint votes
    from identified group by canonical_party_id,display_name,case when canonical_party_id is null then list_id end),
  totals as (select coalesce(sum(votes),0)::bigint total_votes from grouped),
  source_audit as (select jsonb_agg(jsonb_build_object('kind','official','rows',rows,'votes',votes)) value
    from (select count(*)::bigint rows,sum(votes)::bigint votes from selected) audit),
  parties as (select jsonb_agg(jsonb_build_object('identity_status',case when canonical_party_id is null then 'unmapped' else 'canonical' end,
    'canonical_party_id',canonical_party_id,'display_name',display_name,'list_id',list_id,'votes',votes,'vote_share',case when (select total_votes from totals)=0 then null else (votes::numeric/(select total_votes from totals))::text end)
    order by votes desc,canonical_party_id nulls last,list_id) value from grouped)
  select case when exclusion_count>0 then jsonb_build_object('status','source_unavailable','reason','official rows excluded from distrito aggregation',
    'exclusions',(select jsonb_agg(jsonb_build_object('reason',reason,'rows',rows,'votes',votes) order by reason) from exclusion_groups))
  when row_count=0 then jsonb_build_object('status','no_rows','reason','no official rows exist for the selected scope','counts',jsonb_build_object('selected_rows',0,'requested_level_distrito',0))
  when level_count>1 then jsonb_build_object('status','source_unavailable','reason','the selected scope mixes source granularities and cannot be summed safely','counts',counts)
  else jsonb_build_object('status','ok','source_kind','official','source_audit',(select value from source_audit),'level','distrito',
    'source_granularity',source_granularity,'election_year',(select min(year) from selected),'election_round',(select min(round) from selected),
    'total_votes',(select total_votes from totals),'mesa_count',case when source_granularity='mesa' then (select count(distinct jurisdiction_id)
      from selected) else null end,'parties',coalesce((select value from parties),'[]'::jsonb),'archive_entry_ids',
    (select jsonb_agg(archive_entry_id order by archive_entry_id) from (select distinct archive_entry_id from selected) entries)) end from state);
end $$; revoke all on function results_exploration_official_0030(uuid,uuid,text,text,text,text,integer,text) from public,anon,authenticated; grant execute on function results_exploration_official_0030(uuid,uuid,text,text,text,text,integer,text) to results_exploration_executor;
create or replace function results_exploration_official(p_election_id uuid,p_category_id uuid,p_distrito_code text,
  p_seccion_code text default null,p_circuito_code text default null,p_establecimiento_code text default null,p_mesa_code integer default null,p_requested_level text default 'seccion') returns jsonb language plpgsql stable security definer
set search_path=public,pg_temp as $$ declare payload jsonb; source_exclusions jsonb; begin
  payload:=results_exploration_official_0030(p_election_id,p_category_id,p_distrito_code,
    p_seccion_code,p_circuito_code,p_establecimiento_code,p_mesa_code,p_requested_level);
  with scoped_geography as materialized (select id,seccion_code,circuito_code,establecimiento_code,mesa_code from jurisdiction where distrito_code=p_distrito_code
    and (p_seccion_code is null or seccion_code=p_seccion_code or seccion_code is null)), scoped_rows as materialized (select rr.source_kind,rr.votes,rr.archive_entry_id,rr.granularity,j.*
    from scoped_geography j join result_row rr on rr.jurisdiction_id=j.id where rr.election_id=p_election_id and rr.category_id=p_category_id and rr.source_kind is distinct from 'official'),
  source_shapes as materialized (select distinct archive_entry_id,granularity,p_distrito_code distrito_code,seccion_code from scoped_rows), normalized_shapes as materialized (
    select s.*,results_exploration_reporting_level(archive_entry_id,granularity,distrito_code,seccion_code) effective_level from source_shapes s),
  normalized as (select r.*,s.effective_level from scoped_rows r join normalized_shapes s on s.archive_entry_id=r.archive_entry_id and s.granularity=r.granularity
    and s.seccion_code is not distinct from r.seccion_code), scoped as (select source_kind,votes from normalized where (payload->>'status'<>'ok' or effective_level=payload->>'source_granularity')
      and not (p_requested_level='distrito' and granularity='distrito' and effective_level='seccion')
      and (p_seccion_code is null or seccion_code=p_seccion_code or effective_level='distrito')
      and (p_circuito_code is null or circuito_code=p_circuito_code or effective_level in ('distrito','seccion'))
      and (p_establecimiento_code is null or establecimiento_code=p_establecimiento_code or effective_level in ('distrito','seccion','circuito'))
      and (p_mesa_code is null or mesa_code=p_mesa_code or effective_level<>'mesa')),
  groups as (select case when source_kind='fiscalizacion' then source_kind else 'unknown' end source_kind,count(*)::bigint rows,coalesce(sum(votes),0)::bigint votes from scoped group by 1)
  select coalesce(jsonb_agg(jsonb_build_object('kind',source_kind,'rows',rows,'votes',votes) order by source_kind),'[]'::jsonb) into source_exclusions from groups;
  return payload||jsonb_build_object('source_exclusions',source_exclusions);
end $$;
revoke all on function results_exploration_official(uuid,uuid,text,text,text,text,integer,text) from public,anon; grant execute on function results_exploration_official(uuid,uuid,text,text,text,text,integer,text) to authenticated;
grant create on schema public to results_exploration_executor; alter function results_exploration_official_0030(uuid,uuid,text,text,text,text,integer,text) owner to results_exploration_executor;
alter function results_exploration_official(uuid,uuid,text,text,text,text,integer,text) owner to results_exploration_executor; revoke create on schema public from results_exploration_executor; commit;
