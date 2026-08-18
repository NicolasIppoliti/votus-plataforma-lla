-- Keep progressive facet discovery proportional to dimension rows instead of
-- deduplicating the complete official fact corpus on every request.
begin;

create or replace function results_exploration_facets(
  p_election_id uuid default null, p_category_id uuid default null,
  p_distrito_code text default null, p_seccion_code text default null,
  p_circuito_code text default null, p_establecimiento_code text default null
) returns jsonb
language sql stable security invoker
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'status', 'ok',
    'elections', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', id, 'year', year, 'round', round,
        'label', year::text || ' ' || round
      ) order by year, round, id)
      from (
        select e.id, e.year, e.round
        from election e
        where exists (
          select 1 from result_row rr
          where rr.source_kind = 'official' and rr.election_id = e.id
        )
      ) options
    ), '[]'::jsonb),
    'categories', case when p_election_id is not null then coalesce((
      select jsonb_agg(jsonb_build_object('id', id, 'name', name) order by name, id)
      from (
        select c.id, c.name
        from category c
        where exists (
          select 1 from result_row rr
          where rr.source_kind = 'official'
            and rr.election_id = p_election_id and rr.category_id = c.id
        )
      ) options
    ), '[]'::jsonb) else '[]'::jsonb end,
    'distritos', case
      when p_election_id is not null and p_category_id is not null then coalesce((
        select jsonb_agg(jsonb_build_object(
          'code', code, 'name', name, 'name_status', name_status,
          'name_variant_count', name_variant_count
        ) order by code)
        from (
          select j.distrito_code as code,
            case when count(distinct j.distrito_name) = 1
              then max(j.distrito_name) else null end as name,
            case count(distinct j.distrito_name)
              when 0 then 'missing' when 1 then 'present' else 'conflict' end as name_status,
            count(distinct j.distrito_name) as name_variant_count
          from result_row rr
          join jurisdiction j on j.id = rr.jurisdiction_id
          where rr.source_kind = 'official'
            and rr.election_id = p_election_id
            and rr.category_id = p_category_id
          group by j.distrito_code
        ) options
      ), '[]'::jsonb) else '[]'::jsonb end,
    'secciones', case
      when p_election_id is not null and p_category_id is not null
        and p_distrito_code is not null then coalesce((
        select jsonb_agg(jsonb_build_object(
          'code', code, 'name', name, 'name_status', name_status,
          'name_variant_count', name_variant_count
        ) order by code)
        from (
          select j.seccion_code as code,
            case when count(distinct j.seccion_name) = 1
              then max(j.seccion_name) else null end as name,
            case count(distinct j.seccion_name)
              when 0 then 'missing' when 1 then 'present' else 'conflict' end as name_status,
            count(distinct j.seccion_name) as name_variant_count
          from result_row rr
          join jurisdiction j on j.id = rr.jurisdiction_id
          where rr.source_kind = 'official'
            and rr.election_id = p_election_id
            and rr.category_id = p_category_id
            and j.distrito_code = p_distrito_code
            and j.seccion_code is not null
          group by j.seccion_code
        ) options
      ), '[]'::jsonb) else '[]'::jsonb end,
    'circuitos', case
      when p_election_id is not null and p_category_id is not null
        and p_distrito_code is not null and p_seccion_code is not null then coalesce((
        select jsonb_agg(jsonb_build_object(
          'code', code, 'name', name, 'name_status', name_status,
          'name_variant_count', name_variant_count
        ) order by code)
        from (
          select j.circuito_code as code,
            case when count(distinct j.circuito_name) = 1
              then max(j.circuito_name) else null end as name,
            case count(distinct j.circuito_name)
              when 0 then 'missing' when 1 then 'present' else 'conflict' end as name_status,
            count(distinct j.circuito_name) as name_variant_count
          from result_row rr
          join jurisdiction j on j.id = rr.jurisdiction_id
          where rr.source_kind = 'official'
            and rr.election_id = p_election_id
            and rr.category_id = p_category_id
            and j.distrito_code = p_distrito_code
            and j.seccion_code = p_seccion_code
            and j.circuito_code is not null
          group by j.circuito_code
        ) options
      ), '[]'::jsonb) else '[]'::jsonb end,
    'establecimientos', case
      when p_election_id is not null and p_category_id is not null
        and p_distrito_code is not null and p_seccion_code is not null
        and p_circuito_code is not null then coalesce((
        select jsonb_agg(jsonb_build_object(
          'code', code, 'name', name, 'name_status', name_status,
          'name_variant_count', name_variant_count
        ) order by code)
        from (
          select j.establecimiento_code as code,
            case when count(distinct j.establecimiento_name) = 1
              then max(j.establecimiento_name) else null end as name,
            case count(distinct j.establecimiento_name)
              when 0 then 'missing' when 1 then 'present' else 'conflict' end as name_status,
            count(distinct j.establecimiento_name) as name_variant_count
          from result_row rr
          join jurisdiction j on j.id = rr.jurisdiction_id
          where rr.source_kind = 'official'
            and rr.election_id = p_election_id
            and rr.category_id = p_category_id
            and j.distrito_code = p_distrito_code
            and j.seccion_code = p_seccion_code
            and j.circuito_code = p_circuito_code
            and j.establecimiento_code is not null
          group by j.establecimiento_code
        ) options
      ), '[]'::jsonb) else '[]'::jsonb end,
    'mesas', case
      when p_election_id is not null and p_category_id is not null
        and p_distrito_code is not null and p_seccion_code is not null
        and p_circuito_code is not null and p_establecimiento_code is not null then coalesce((
        select jsonb_agg(jsonb_build_object('code', code) order by code)
        from (
          select distinct j.mesa_code as code
          from result_row rr
          join jurisdiction j on j.id = rr.jurisdiction_id
          where rr.source_kind = 'official'
            and rr.election_id = p_election_id
            and rr.category_id = p_category_id
            and j.distrito_code = p_distrito_code
            and j.seccion_code = p_seccion_code
            and j.circuito_code = p_circuito_code
            and j.establecimiento_code = p_establecimiento_code
            and j.mesa_code is not null
        ) options
      ), '[]'::jsonb) else '[]'::jsonb end,
    'available_levels', coalesce((
      select jsonb_agg(level order by level_order)
      from (
        select 'distrito' as level, 1 as level_order
        where p_election_id is not null and p_category_id is not null
          and p_distrito_code is not null
          and exists (
            select 1 from result_row rr
            join jurisdiction j on j.id = rr.jurisdiction_id
            where rr.source_kind = 'official'
              and rr.election_id = p_election_id and rr.category_id = p_category_id
              and j.distrito_code = p_distrito_code
          )
        union all
        select 'seccion', 2
        where p_election_id is not null and p_category_id is not null
          and p_distrito_code is not null and p_seccion_code is not null
          and exists (
            select 1 from result_row rr
            join jurisdiction j on j.id = rr.jurisdiction_id
            where rr.source_kind = 'official'
              and rr.election_id = p_election_id and rr.category_id = p_category_id
              and j.distrito_code = p_distrito_code and j.seccion_code = p_seccion_code
          )
        union all
        select 'circuito', 3
        where p_election_id is not null and p_category_id is not null
          and p_distrito_code is not null and p_seccion_code is not null
          and p_circuito_code is not null
          and exists (
            select 1 from result_row rr
            join jurisdiction j on j.id = rr.jurisdiction_id
            where rr.source_kind = 'official'
              and rr.election_id = p_election_id and rr.category_id = p_category_id
              and j.distrito_code = p_distrito_code and j.seccion_code = p_seccion_code
              and j.circuito_code = p_circuito_code
          )
        union all
        select 'establecimiento', 4
        where p_election_id is not null and p_category_id is not null
          and p_distrito_code is not null and p_seccion_code is not null
          and p_circuito_code is not null
          and exists (
            select 1 from result_row rr
            join jurisdiction j on j.id = rr.jurisdiction_id
            where rr.source_kind = 'official'
              and rr.election_id = p_election_id and rr.category_id = p_category_id
              and j.distrito_code = p_distrito_code and j.seccion_code = p_seccion_code
              and j.circuito_code = p_circuito_code and j.establecimiento_code is not null
          )
        union all
        select 'mesa', 5
        where p_election_id is not null and p_category_id is not null
          and p_distrito_code is not null and p_seccion_code is not null
          and p_circuito_code is not null and p_establecimiento_code is not null
          and exists (
            select 1 from result_row rr
            join jurisdiction j on j.id = rr.jurisdiction_id
            where rr.source_kind = 'official'
              and rr.election_id = p_election_id and rr.category_id = p_category_id
              and j.distrito_code = p_distrito_code and j.seccion_code = p_seccion_code
              and j.circuito_code = p_circuito_code
              and j.establecimiento_code = p_establecimiento_code
              and j.mesa_code is not null
          )
      ) levels
    ), '[]'::jsonb)
  )
$$;

commit;
