-- Bound official exploration to the selected geography before normalizing rows.
begin;
alter function results_exploration_official(uuid,uuid,text,text,text,text,integer,text) rename to results_exploration_official_0022;
revoke all on function results_exploration_official_0022(uuid,uuid,text,text,text,text,integer,text) from public, anon, authenticated; grant execute on function results_exploration_official_0022(uuid,uuid,text,text,text,text,integer,text) to results_exploration_executor;
create function results_exploration_official_0029(
  p_election_id uuid, p_category_id uuid, p_distrito_code text, p_seccion_code text default null, p_circuito_code text default null, p_establecimiento_code text default null, p_mesa_code integer default null, p_requested_level text default 'seccion') returns jsonb language plpgsql stable security invoker
set search_path = public, pg_temp as $$
declare result jsonb; row_count bigint; level_count bigint; actual_level text; source_granularity text; granularity_counts jsonb;
begin
  if p_requested_level not in ('distrito','seccion','circuito','establecimiento','mesa') then
    raise exception 'unsupported exploration level: %', p_requested_level;
  end if;
  if (p_circuito_code is not null and p_seccion_code is null) or
    (p_establecimiento_code is not null and p_circuito_code is null) or
    (p_mesa_code is not null and p_establecimiento_code is null) then return jsonb_build_object(
      'status','selection_invalid','reason','lower-level selectors require their complete parent chain',
      'counts',jsonb_build_object('missing_parent_selector',1)); end if;
  actual_level := case when p_mesa_code is not null then 'mesa' when p_establecimiento_code is not null
    then 'establecimiento' when p_circuito_code is not null then 'circuito'
    when p_seccion_code is not null then 'seccion' else 'distrito' end;
  if p_requested_level <> actual_level then return jsonb_build_object('status','selection_invalid',
    'reason',format('the supplied selectors describe %s results, not %s results',actual_level,p_requested_level),
    'counts',jsonb_build_object('missing_selector',1,'selector_level_'||actual_level,1,
    'requested_level_'||p_requested_level,1)); end if;
  if p_requested_level = 'establecimiento' and not exists (select 1 from jurisdiction j
    join result_row rr on rr.jurisdiction_id = j.id where j.distrito_code = p_distrito_code
    and j.seccion_code = p_seccion_code and j.establecimiento_code is not null
    and rr.election_id = p_election_id and rr.category_id = p_category_id and rr.source_kind = 'official')
  then return jsonb_build_object('status','source_unavailable','reason',
    'the registered source publishes no establecimiento data','counts',jsonb_build_object(
    'establecimiento_identity_available_rows',0,'establecimiento_identity_missing_rows',(
    select count(*) from jurisdiction j join result_row rr on rr.jurisdiction_id = j.id
    where j.distrito_code = p_distrito_code and j.seccion_code = p_seccion_code
    and j.establecimiento_code is null and rr.election_id = p_election_id
    and rr.category_id = p_category_id and rr.source_kind = 'official'))); end if;
  with scoped_geography as materialized (
    select j.id,j.seccion_code,j.circuito_code,j.establecimiento_code,j.mesa_code
    from jurisdiction j where j.distrito_code = p_distrito_code
      and (p_seccion_code is null or j.seccion_code = p_seccion_code or j.seccion_code is null)
  ), normalized as materialized (
    select rr.archive_entry_id,rr.granularity,j.seccion_code,j.circuito_code,
      j.establecimiento_code,j.mesa_code,results_exploration_reporting_level(
        rr.archive_entry_id,rr.granularity,p_distrito_code,j.seccion_code) effective_level
    from scoped_geography j join result_row rr on rr.jurisdiction_id = j.id
    where rr.election_id = p_election_id and rr.category_id = p_category_id
      and rr.source_kind = 'official'
  ), scoped as (
    select effective_level from normalized where
      not (p_requested_level = 'distrito' and granularity = 'distrito'
        and effective_level = 'seccion' and archive_entry_id ~ '^pba/[0-9]{4}-distrito-[0-9]+$')
      and (p_seccion_code is null or seccion_code = p_seccion_code or effective_level = 'distrito')
      and (p_circuito_code is null or circuito_code = p_circuito_code or effective_level in ('distrito','seccion'))
      and (p_establecimiento_code is null or establecimiento_code = p_establecimiento_code or effective_level in ('distrito','seccion','circuito'))
      and (p_mesa_code is null or mesa_code = p_mesa_code or effective_level <> 'mesa')
  ), levels as (select effective_level granularity,count(*)::bigint rows from scoped group by 1)
  select coalesce(sum(rows),0),count(*),min(granularity),
    coalesce(jsonb_object_agg('included_'||granularity||'_rows',rows),'{}'::jsonb)
  into row_count,level_count,source_granularity,granularity_counts from levels;
  if row_count = 0 then return jsonb_build_object('status','no_rows','reason',
    'no official rows exist for the selected scope','counts',
    jsonb_build_object('selected_rows',0,'requested_level_'||p_requested_level,0)); end if;
  if level_count > 1 then return jsonb_build_object('status','source_unavailable','reason',
    'the selected scope mixes source granularities and cannot be summed safely','counts',granularity_counts); end if;
  if (case source_granularity when 'distrito' then 1 when 'seccion' then 2 when 'circuito' then 3 when 'establecimiento' then 4 when 'mesa' then 5 else 0 end)
    < (case p_requested_level when 'distrito' then 1 when 'seccion' then 2 when 'circuito' then 3 when 'establecimiento' then 4 when 'mesa' then 5 end) then
    return jsonb_build_object('status','source_unavailable','reason',
      'the published source granularity cannot support the requested finer scope','counts',
      granularity_counts||jsonb_build_object('requested_'||p_requested_level||'_rows',0));
  end if;
  with scoped_geography as materialized (
    select j.id,j.seccion_code,j.circuito_code,j.establecimiento_code,j.mesa_code
    from jurisdiction j where j.distrito_code = p_distrito_code
      and (p_seccion_code is null or j.seccion_code = p_seccion_code or j.seccion_code is null)
  ), normalized as materialized (
    -- jurisdiction.id is the canonical normalized full-lineage mesa identity: the
    -- jurisdiction tuple has one row, and every party row for that mesa shares its id.
    select rr.archive_entry_id,rr.granularity,rr.list_id,rr.votes,'official'::text source_kind,
      j.id jurisdiction_id,j.seccion_code,j.circuito_code,j.establecimiento_code,j.mesa_code,e.year,e.round,
      c.name category_name,results_exploration_reporting_level(rr.archive_entry_id,
        rr.granularity,p_distrito_code,j.seccion_code) effective_level,
      results_exploration_party_jurisdiction(rr.archive_entry_id,e.year,e.round,c.name,
        p_distrito_code,j.seccion_code) mapping_jurisdiction
    from scoped_geography j join result_row rr on rr.jurisdiction_id = j.id
    join election e on e.id = rr.election_id join category c on c.id = rr.category_id
    where rr.election_id = p_election_id and rr.category_id = p_category_id
      and rr.source_kind = 'official'
  ), scoped as (
    select * from normalized where effective_level = source_granularity
      and not (p_requested_level = 'distrito' and granularity = 'distrito'
        and effective_level = 'seccion' and archive_entry_id ~ '^pba/[0-9]{4}-distrito-[0-9]+$')
      and (p_seccion_code is null or seccion_code = p_seccion_code or effective_level = 'distrito')
      and (p_circuito_code is null or circuito_code = p_circuito_code or effective_level in ('distrito','seccion'))
      and (p_establecimiento_code is null or establecimiento_code = p_establecimiento_code or effective_level in ('distrito','seccion','circuito'))
      and (p_mesa_code is null or mesa_code = p_mesa_code or effective_level <> 'mesa')
  ), identified as (
    select s.*,pm.canonical_party_id,pc.display_name from scoped s
    left join party_mapping pm on pm.year=s.year and pm.jurisdiction=s.mapping_jurisdiction
      and pm.category=s.category_name and pm.list_id=s.list_id and pm.verified
    left join party_canonical pc on pc.id=pm.canonical_party_id
  ), grouped as (select canonical_party_id,display_name,
    case when canonical_party_id is null then list_id end unmapped_list_id,sum(votes)::bigint votes
    from identified group by canonical_party_id,display_name,case when canonical_party_id is null then list_id end),
  totals as (select coalesce(sum(votes),0)::bigint total_votes from grouped), source_audit as
    (select jsonb_agg(jsonb_build_object('kind',source_kind,'rows',rows,'votes',votes) order by source_kind) value
    from (select source_kind,count(*)::bigint rows,sum(votes)::bigint votes from scoped group by source_kind) kinds)
  select jsonb_build_object('status','ok','source_kind','official','source_audit',source_audit.value,
    'level',p_requested_level,'source_granularity',source_granularity,
    'election_year',(select min(year) from scoped),'election_round',(select min(round) from scoped),
    'total_votes',totals.total_votes,'mesa_count',case when source_granularity='mesa'
      then (select count(distinct jurisdiction_id) from scoped where mesa_code is not null) else null end,
    'parties',coalesce((select jsonb_agg(jsonb_build_object('identity_status',case when canonical_party_id is null
      then 'unmapped' else 'canonical' end,'canonical_party_id',canonical_party_id,'display_name',display_name,
      'list_id',unmapped_list_id,'votes',votes,'vote_share',case when totals.total_votes=0 then null
      else (votes::numeric/totals.total_votes)::text end) order by votes desc,canonical_party_id nulls last,
      unmapped_list_id) from grouped),'[]'::jsonb),'archive_entry_ids',(select jsonb_agg(archive_entry_id
      order by archive_entry_id) from (select distinct archive_entry_id from scoped) entries))
  into result from totals cross join source_audit;
  return result;
end $$;
revoke all on function results_exploration_official_0029(uuid,uuid,text,text,text,text,integer,text) from public, anon, authenticated; grant execute on function results_exploration_official_0029(uuid,uuid,text,text,text,text,integer,text) to results_exploration_executor;
grant create on schema public to results_exploration_executor; alter function results_exploration_official_0029(uuid,uuid,text,text,text,text,integer,text) owner to results_exploration_executor;
create or replace function results_exploration_official(p_election_id uuid,p_category_id uuid,p_distrito_code text,
  p_seccion_code text default null,p_circuito_code text default null,p_establecimiento_code text default null,
  p_mesa_code integer default null,p_requested_level text default 'seccion') returns jsonb language plpgsql stable
security definer set search_path = public, pg_temp as $$
declare payload jsonb; source_exclusions jsonb;
begin
  payload := results_exploration_official_0029(p_election_id,p_category_id,p_distrito_code,p_seccion_code,
    p_circuito_code,p_establecimiento_code,p_mesa_code,p_requested_level);
  with scoped_geography as materialized (
    select j.id,j.seccion_code,j.circuito_code,j.establecimiento_code,j.mesa_code
    from jurisdiction j where j.distrito_code=p_distrito_code
      and (p_seccion_code is null or j.seccion_code=p_seccion_code or j.seccion_code is null)
  ), normalized as (
    select rr.source_kind,rr.votes,rr.archive_entry_id,rr.granularity,j.seccion_code,j.circuito_code,
      j.establecimiento_code,j.mesa_code,results_exploration_reporting_level(rr.archive_entry_id,
        rr.granularity,p_distrito_code,j.seccion_code) effective_level
    from scoped_geography j join result_row rr on rr.jurisdiction_id=j.id
    where rr.election_id=p_election_id and rr.category_id=p_category_id
      and rr.source_kind is distinct from 'official'
  ), scoped as (select source_kind,votes from normalized where
    (payload->>'status'<>'ok' or effective_level=payload->>'source_granularity')
    and not (p_requested_level='distrito' and granularity='distrito' and effective_level='seccion'
      and archive_entry_id~'^pba/[0-9]{4}-distrito-[0-9]+$')
    and (p_seccion_code is null or seccion_code=p_seccion_code or effective_level='distrito')
    and (p_circuito_code is null or circuito_code=p_circuito_code or effective_level in ('distrito','seccion'))
    and (p_establecimiento_code is null or establecimiento_code=p_establecimiento_code or effective_level in ('distrito','seccion','circuito'))
    and (p_mesa_code is null or mesa_code=p_mesa_code or effective_level<>'mesa')),
  groups as (select case when source_kind='fiscalizacion' then source_kind else 'unknown' end source_kind,
    count(*)::bigint rows,coalesce(sum(votes),0)::bigint votes from scoped group by 1)
  select coalesce(jsonb_agg(jsonb_build_object('kind',source_kind,'rows',rows,'votes',votes)
    order by source_kind),'[]'::jsonb) into source_exclusions from groups;
  return payload||jsonb_build_object('source_exclusions',source_exclusions);
end $$;
revoke all on function results_exploration_official(uuid,uuid,text,text,text,text,integer,text) from public, anon; grant execute on function results_exploration_official(uuid,uuid,text,text,text,text,integer,text) to authenticated;
alter function results_exploration_official(uuid,uuid,text,text,text,text,integer,text) owner to results_exploration_executor; revoke create on schema public from results_exploration_executor;
commit;
