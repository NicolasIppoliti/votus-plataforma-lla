begin;
-- Restore only the authoritative 0020 facets definition.

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

commit;
