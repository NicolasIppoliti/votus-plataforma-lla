-- Official-only, read-only boundaries for the authenticated results explorer.
-- Query-string codes are normalized once in the web boundary and compared
-- exactly here. No source row is relabelled as a finer administrative level.
create or replace function results_exploration_party_jurisdiction(p_archive_entry_id text,
  p_year integer, p_round text, p_category text, p_distrito_code text, p_seccion_code text)
returns text language sql immutable strict security invoker
set search_path = public, pg_temp as $$
  select case
    when p_archive_entry_id ~ '^national/2023-' and p_year = 2023
      and p_round = 'generales' and p_category = 'CONCEJALES'
      and p_distrito_code = '02' and p_seccion_code = '027'
      then 'coronel_rosales_municipal'
    when p_archive_entry_id ~ '^national/' then 'national'
    when p_archive_entry_id ~ '^pba/[0-9]{4}-distrito-[0-9]+$' then null
    else null
  end
$$;
create or replace function results_exploration_reporting_level(p_archive_entry_id text,
  p_granularity text, p_distrito_code text, p_seccion_code text)
returns text language sql immutable security invoker
set search_path = public, pg_temp as $$
  select case when p_archive_entry_id ~ '^pba/[0-9]{4}-distrito-[0-9]+$'
      and p_granularity = 'distrito'
      and p_distrito_code is not null and p_seccion_code is not null
      then 'seccion'
    else p_granularity end
$$;
create index if not exists result_row_exploration_scope_idx
  on result_row (election_id, category_id, source_kind, jurisdiction_id);
create or replace function results_exploration_facets(
  p_election_id uuid default null, p_category_id uuid default null,
  p_distrito_code text default null, p_seccion_code text default null,
  p_circuito_code text default null
) returns jsonb
language sql stable security invoker
set search_path = public, pg_temp
as $$
  with official as (
    select rr.election_id, rr.category_id, rr.granularity,
      e.year, e.round, c.name as category_name,
      j.distrito_code, j.distrito_name, j.seccion_code, j.seccion_name,
      j.circuito_code, j.circuito_name,
      j.establecimiento_code, j.establecimiento_name, j.mesa_code
    from result_row rr
    join election e on e.id = rr.election_id
    join category c on c.id = rr.category_id
    join jurisdiction j on j.id = rr.jurisdiction_id
    where rr.source_kind = 'official'
  ) select jsonb_build_object(
    'status', 'ok',
    'elections', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', id, 'year', year, 'round', round,
        'label', year::text || ' ' || round
      ) order by year, round, id)
      from (select distinct election_id as id, year, round from official) options
    ), '[]'::jsonb),
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object('id', id, 'name', name) order by name, id)
      from (
        select distinct category_id as id, category_name as name from official
        where p_election_id is not null and election_id = p_election_id
      ) options
    ), '[]'::jsonb),
    'distritos', coalesce((
      select jsonb_agg(jsonb_build_object('code', code, 'name', name) order by code)
      from (
        select distrito_code as code,
          case when count(distinct distrito_name) = 1 then max(distrito_name) else null end as name
        from official
        where p_election_id is not null and election_id = p_election_id
          and p_category_id is not null and category_id = p_category_id
        group by distrito_code
      ) options
    ), '[]'::jsonb),
    'secciones', coalesce((
      select jsonb_agg(jsonb_build_object('code', code, 'name', name) order by code)
      from (
        select seccion_code as code,
          case when count(distinct seccion_name) = 1 then max(seccion_name) else null end as name
        from official
        where election_id = p_election_id and category_id = p_category_id
          and distrito_code = p_distrito_code and seccion_code is not null
        group by seccion_code
      ) options
    ), '[]'::jsonb),
    'circuitos', coalesce((
      select jsonb_agg(jsonb_build_object('code', code, 'name', name) order by code)
      from (
        select circuito_code as code,
          case when count(distinct circuito_name) = 1 then max(circuito_name) else null end as name
        from official
        where election_id = p_election_id and category_id = p_category_id
          and distrito_code = p_distrito_code and seccion_code = p_seccion_code
          and circuito_code is not null
        group by circuito_code
      ) options
    ), '[]'::jsonb),
    'establecimientos', coalesce((
      select jsonb_agg(jsonb_build_object('code', code, 'name', name) order by code)
      from (
        select establecimiento_code as code,
          case when count(distinct establecimiento_name) = 1 then max(establecimiento_name) else null end as name
        from official
        where election_id = p_election_id and category_id = p_category_id
          and distrito_code = p_distrito_code and seccion_code = p_seccion_code
          and (p_circuito_code is null or circuito_code = p_circuito_code)
          and establecimiento_code is not null
        group by establecimiento_code
      ) options
    ), '[]'::jsonb),
    'mesas', coalesce((
      select jsonb_agg(jsonb_build_object('code', code) order by code)
      from (
        select distinct mesa_code as code from official
        where election_id = p_election_id and category_id = p_category_id
          and distrito_code = p_distrito_code and seccion_code = p_seccion_code
          and (p_circuito_code is null or circuito_code = p_circuito_code)
          and mesa_code is not null
      ) options
    ), '[]'::jsonb),
    'available_levels', coalesce((
      select jsonb_agg(level order by level_order) from (
        select 'distrito' as level, 1 as level_order
        where p_election_id is not null and p_category_id is not null and p_distrito_code is not null
          and exists (select 1 from official where election_id = p_election_id and category_id = p_category_id and distrito_code = p_distrito_code)
        union all select 'seccion', 2 where p_seccion_code is not null
          and exists (select 1 from official where election_id = p_election_id and category_id = p_category_id and distrito_code = p_distrito_code and seccion_code = p_seccion_code)
        union all select 'circuito', 3 where p_circuito_code is not null
          and exists (select 1 from official where election_id = p_election_id and category_id = p_category_id and distrito_code = p_distrito_code and seccion_code = p_seccion_code and circuito_code = p_circuito_code)
        union all select 'establecimiento', 4 where exists (
          select 1 from official where election_id = p_election_id and category_id = p_category_id
            and distrito_code = p_distrito_code and seccion_code = p_seccion_code
            and (p_circuito_code is null or circuito_code = p_circuito_code)
            and establecimiento_code is not null
        )
        union all select 'mesa', 5 where exists (
          select 1 from official where election_id = p_election_id and category_id = p_category_id
            and distrito_code = p_distrito_code and seccion_code = p_seccion_code
            and (p_circuito_code is null or circuito_code = p_circuito_code)
            and mesa_code is not null
        )
      ) levels
    ), '[]'::jsonb)
  ) $$;
create or replace function results_exploration_official(
  p_election_id uuid, p_category_id uuid, p_distrito_code text,
  p_seccion_code text default null, p_circuito_code text default null,
  p_establecimiento_code text default null, p_mesa_code integer default null,
  p_requested_level text default 'seccion'
) returns jsonb
language plpgsql stable security invoker
set search_path = public, pg_temp
as $$
declare
  result jsonb;
  row_count bigint;
  level_count bigint;
  actual_level text;
  source_granularity text;
  granularity_counts jsonb;
begin
  if p_requested_level not in ('distrito', 'seccion', 'circuito', 'establecimiento', 'mesa') then
    raise exception 'unsupported exploration level: %', p_requested_level;
  end if;
  if (p_circuito_code is not null and p_seccion_code is null)
    or (p_establecimiento_code is not null and p_circuito_code is null)
    or (p_mesa_code is not null and p_establecimiento_code is null) then
    return jsonb_build_object('status', 'selection_invalid',
      'reason', 'lower-level selectors require their complete parent chain',
      'counts', jsonb_build_object('missing_parent_selector', 1));
  end if;
  actual_level := case when p_mesa_code is not null then 'mesa'
    when p_establecimiento_code is not null then 'establecimiento'
    when p_circuito_code is not null then 'circuito'
    when p_seccion_code is not null then 'seccion' else 'distrito' end;
  if p_requested_level <> actual_level then
    return jsonb_build_object(
      'status', 'selection_invalid',
      'reason', format('the supplied selectors describe %s results, not %s results', actual_level, p_requested_level),
      'counts', jsonb_build_object(
        'missing_selector', 1,
        'selector_level_' || actual_level, 1,
        'requested_level_' || p_requested_level, 1
      )
    );
  end if;
  if p_requested_level = 'establecimiento' and not exists (
    select 1 from result_row rr join jurisdiction j on j.id = rr.jurisdiction_id
    where rr.election_id = p_election_id and rr.category_id = p_category_id
      and rr.source_kind = 'official' and j.distrito_code = p_distrito_code
      and j.seccion_code = p_seccion_code and j.establecimiento_code is not null
  ) then
    return jsonb_build_object(
      'status', 'source_unavailable',
      'reason', 'the registered source publishes no establecimiento data',
      'counts', jsonb_build_object(
        'establecimiento_identity_available_rows', 0,
        'establecimiento_identity_missing_rows', (
          select count(*) from result_row rr join jurisdiction j on j.id = rr.jurisdiction_id
          where rr.election_id = p_election_id and rr.category_id = p_category_id
            and rr.source_kind = 'official' and j.distrito_code = p_distrito_code
            and j.seccion_code = p_seccion_code and j.establecimiento_code is null
        )
      )
    );
  end if;
  with normalized as (
    select rr.archive_entry_id, rr.granularity,
      results_exploration_reporting_level(
        rr.archive_entry_id, rr.granularity, j.distrito_code, j.seccion_code
      ) as effective_level,
      j.seccion_code, j.circuito_code, j.establecimiento_code, j.mesa_code
    from result_row rr join jurisdiction j on j.id = rr.jurisdiction_id
    where rr.election_id = p_election_id and rr.category_id = p_category_id
      and rr.source_kind = 'official' and j.distrito_code = p_distrito_code
  ), scoped as (
    select effective_level
    from normalized
    where not (p_requested_level = 'distrito' and granularity = 'distrito'
      and effective_level = 'seccion' and archive_entry_id ~ '^pba/[0-9]{4}-distrito-[0-9]+$')
      and (p_seccion_code is null or seccion_code = p_seccion_code or effective_level = 'distrito')
      and (p_circuito_code is null or circuito_code = p_circuito_code or effective_level in ('distrito', 'seccion'))
      and (p_establecimiento_code is null or establecimiento_code = p_establecimiento_code or effective_level in ('distrito', 'seccion', 'circuito'))
      and (p_mesa_code is null or mesa_code = p_mesa_code or effective_level <> 'mesa')
  ), levels as (
    select effective_level as granularity, count(*)::bigint as rows
    from scoped group by effective_level
  )
  select coalesce(sum(rows), 0), count(*), min(granularity),
    coalesce(jsonb_object_agg('included_' || granularity || '_rows', rows), '{}'::jsonb)
  into row_count, level_count, source_granularity, granularity_counts from levels;

  if row_count = 0 then
    return jsonb_build_object(
      'status', 'no_rows', 'reason', 'no official rows exist for the selected scope',
      'counts', jsonb_build_object('selected_rows', 0, 'requested_level_' || p_requested_level, 0)
    );
  end if;
  if level_count > 1 then
    return jsonb_build_object(
      'status', 'source_unavailable',
      'reason', 'the selected scope mixes source granularities and cannot be summed safely',
      'counts', granularity_counts
    );
  end if;
  if (case source_granularity when 'distrito' then 1 when 'seccion' then 2 when 'circuito' then 3 when 'establecimiento' then 4 when 'mesa' then 5 else 0 end)
     < (case p_requested_level when 'distrito' then 1 when 'seccion' then 2 when 'circuito' then 3 when 'establecimiento' then 4 when 'mesa' then 5 end) then
    return jsonb_build_object(
      'status', 'source_unavailable',
      'reason', 'the published source granularity cannot support the requested finer scope',
      'counts', granularity_counts || jsonb_build_object('requested_' || p_requested_level || '_rows', 0)
    );
  end if;
  with normalized as (
    select rr.*, j.mesa_code, e.year, e.round, c.name as category_name,
      results_exploration_reporting_level(
        rr.archive_entry_id, rr.granularity, j.distrito_code, j.seccion_code
      ) as effective_level,
      j.seccion_code, j.circuito_code, j.establecimiento_code,
      results_exploration_party_jurisdiction(
        rr.archive_entry_id, e.year, e.round, c.name, j.distrito_code, j.seccion_code
      ) as mapping_jurisdiction
    from result_row rr
    join jurisdiction j on j.id = rr.jurisdiction_id
    join election e on e.id = rr.election_id
    join category c on c.id = rr.category_id
    where rr.election_id = p_election_id and rr.category_id = p_category_id
      and rr.source_kind = 'official'
      and j.distrito_code = p_distrito_code
  ), scoped as (
    select * from normalized
    where effective_level = source_granularity
      and not (p_requested_level = 'distrito' and granularity = 'distrito'
        and effective_level = 'seccion' and archive_entry_id ~ '^pba/[0-9]{4}-distrito-[0-9]+$')
      and (p_seccion_code is null or seccion_code = p_seccion_code or effective_level = 'distrito')
      and (p_circuito_code is null or circuito_code = p_circuito_code or effective_level in ('distrito', 'seccion'))
      and (p_establecimiento_code is null or establecimiento_code = p_establecimiento_code or effective_level in ('distrito', 'seccion', 'circuito'))
      and (p_mesa_code is null or mesa_code = p_mesa_code or effective_level <> 'mesa')
  ), identified as (
    select s.*, pm.canonical_party_id, pc.display_name
    from scoped s
    left join party_mapping pm on pm.year = s.year
      and pm.jurisdiction = s.mapping_jurisdiction
      and pm.category = s.category_name and pm.list_id = s.list_id and pm.verified
    left join party_canonical pc on pc.id = pm.canonical_party_id
  ), grouped as (
    select rr.canonical_party_id, rr.display_name,
      case when rr.canonical_party_id is null then rr.list_id else null end as unmapped_list_id,
      sum(rr.votes)::bigint as votes
    from identified rr
    group by rr.canonical_party_id, rr.display_name,
      case when rr.canonical_party_id is null then rr.list_id else null end
  ), totals as (
    select coalesce(sum(votes), 0)::bigint as total_votes from grouped
  ), source_audit as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'kind', source_kind, 'rows', rows, 'votes', votes
    ) order by source_kind), '[]'::jsonb) as value
    from (
      select source_kind, count(*)::bigint as rows, sum(votes)::bigint as votes
      from scoped group by source_kind
    ) included_kinds
  )
  select jsonb_build_object(
    'status', 'ok', 'source_kind', 'official', 'source_audit', source_audit.value,
    'level', p_requested_level,
    'source_granularity', source_granularity,
    'election_year', (select min(year) from scoped),
    'election_round', (select min(round) from scoped),
    'total_votes', totals.total_votes,
    'mesa_count', case when source_granularity = 'mesa'
      then (select count(distinct mesa_code) from scoped where mesa_code is not null)
      else null end,
    'parties', coalesce((
      select jsonb_agg(jsonb_build_object(
        'identity_status', case when canonical_party_id is null then 'unmapped' else 'canonical' end,
        'canonical_party_id', canonical_party_id, 'display_name', display_name,
        'list_id', unmapped_list_id, 'votes', votes,
        'vote_share', case when totals.total_votes = 0 then null else (votes::numeric / totals.total_votes)::text end
      ) order by votes desc, canonical_party_id nulls last, unmapped_list_id)
      from grouped
    ), '[]'::jsonb),
    'archive_entry_ids', (
      select jsonb_agg(archive_entry_id order by archive_entry_id)
      from (select distinct archive_entry_id from scoped) entries
    )
  ) into result from totals cross join source_audit;

  return result;
end $$;
revoke all on function results_exploration_party_jurisdiction(text, integer, text, text, text, text) from public;
revoke all on function results_exploration_party_jurisdiction(text, integer, text, text, text, text) from anon; grant execute on function results_exploration_party_jurisdiction(text, integer, text, text, text, text) to authenticated;

revoke all on function results_exploration_reporting_level(text, text, text, text) from public;
revoke all on function results_exploration_reporting_level(text, text, text, text) from anon; grant execute on function results_exploration_reporting_level(text, text, text, text) to authenticated;
revoke all on function results_exploration_facets(uuid, uuid, text, text, text) from public;
revoke all on function results_exploration_facets(uuid, uuid, text, text, text) from anon; grant execute on function results_exploration_facets(uuid, uuid, text, text, text) to authenticated;
revoke all on function results_exploration_official(uuid, uuid, text, text, text, text, integer, text) from public;
revoke all on function results_exploration_official(uuid, uuid, text, text, text, text, integer, text) from anon; grant execute on function results_exploration_official(uuid, uuid, text, text, text, text, integer, text) to authenticated;
