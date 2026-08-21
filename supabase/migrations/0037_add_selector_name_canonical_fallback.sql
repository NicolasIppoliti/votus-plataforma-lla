-- Recover district and section labels from canonical same-code jurisdiction rows
-- only when the selected official source scope carries no label of its own.
begin;

alter function results_exploration_facets(uuid,uuid,text,text,text,text)
  rename to results_exploration_facets_0036;

revoke all on function results_exploration_facets_0036(uuid,uuid,text,text,text,text) from public;
revoke all on function results_exploration_facets_0036(uuid,uuid,text,text,text,text) from anon;
revoke all on function results_exploration_facets_0036(uuid,uuid,text,text,text,text) from authenticated;

create function results_exploration_facets(
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
          'code', code,
          'name', case when variant_count = 1 then preferred_name else null end,
          'name_status', case variant_count
            when 0 then 'missing' when 1 then 'present' else 'conflict' end,
          'name_variant_count', variant_count
        ) order by code)
        from (
          with selected_names as materialized (
            select distinct j.distrito_code as code, btrim(j.distrito_name) as name
            from result_row rr
            join jurisdiction j on j.id = rr.jurisdiction_id
            where rr.source_kind = 'official'
              and rr.election_id = p_election_id
              and rr.category_id = p_category_id
          ), selected_options as (
            select code,
              count(distinct lower(btrim(name)))
                filter (where name is not null and btrim(name) <> '')
                as selected_variant_count,
              (array_agg(btrim(name) order by
                (btrim(name) = upper(btrim(name))), btrim(name) collate "C")
                filter (where name is not null and btrim(name) <> ''))[1]
                as selected_name
            from selected_names
            group by code
          ), global_names as materialized (
            select distinct o.code, btrim(j.distrito_name) as name
            from selected_options o
            join jurisdiction j on j.distrito_code = o.code
            where o.selected_variant_count = 0
              and j.distrito_name is not null
              and btrim(j.distrito_name) <> ''
          ), global_options as (
            select code,
              count(distinct lower(btrim(name)))
                filter (where name is not null and btrim(name) <> '')
                as global_variant_count,
              (array_agg(btrim(name) order by
                (btrim(name) = upper(btrim(name))), btrim(name) collate "C")
                filter (where name is not null and btrim(name) <> ''))[1]
                as global_name
            from global_names
            group by code
          )
          select o.code,
            case when o.selected_variant_count > 0
              then o.selected_variant_count
              else coalesce(g.global_variant_count, 0) end as variant_count,
            case when o.selected_variant_count > 0
              then o.selected_name else g.global_name end as preferred_name
          from selected_options o
          left join global_options g on g.code = o.code
        ) options
      ), '[]'::jsonb) else '[]'::jsonb end,
    'secciones', case
      when p_election_id is not null and p_category_id is not null
        and p_distrito_code is not null then coalesce((
        select jsonb_agg(jsonb_build_object(
          'code', code,
          'name', case when variant_count = 1 then preferred_name else null end,
          'name_status', case variant_count
            when 0 then 'missing' when 1 then 'present' else 'conflict' end,
          'name_variant_count', variant_count
        ) order by code)
        from (
          with selected_names as materialized (
            select distinct j.seccion_code as code, btrim(j.seccion_name) as name
            from result_row rr
            join jurisdiction j on j.id = rr.jurisdiction_id
            where rr.source_kind = 'official'
              and rr.election_id = p_election_id
              and rr.category_id = p_category_id
              and j.distrito_code = p_distrito_code
              and j.seccion_code is not null
          ), selected_options as (
            select code,
              count(distinct lower(btrim(name)))
                filter (where name is not null and btrim(name) <> '')
                as selected_variant_count,
              (array_agg(btrim(name) order by
                (btrim(name) = upper(btrim(name))), btrim(name) collate "C")
                filter (where name is not null and btrim(name) <> ''))[1]
                as selected_name
            from selected_names
            group by code
          ), global_names as materialized (
            select distinct o.code, btrim(j.seccion_name) as name
            from selected_options o
            join jurisdiction j on j.distrito_code = p_distrito_code
              and j.seccion_code = o.code
            where o.selected_variant_count = 0
              and j.seccion_name is not null
              and btrim(j.seccion_name) <> ''
          ), global_options as (
            select code,
              count(distinct lower(btrim(name)))
                filter (where name is not null and btrim(name) <> '')
                as global_variant_count,
              (array_agg(btrim(name) order by
                (btrim(name) = upper(btrim(name))), btrim(name) collate "C")
                filter (where name is not null and btrim(name) <> ''))[1]
                as global_name
            from global_names
            group by code
          )
          select o.code,
            case when o.selected_variant_count > 0
              then o.selected_variant_count
              else coalesce(g.global_variant_count, 0) end as variant_count,
            case when o.selected_variant_count > 0
              then o.selected_name else g.global_name end as preferred_name
          from selected_options o
          left join global_options g on g.code = o.code
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

revoke all on function results_exploration_facets(uuid,uuid,text,text,text,text) from public;
revoke all on function results_exploration_facets(uuid,uuid,text,text,text,text) from anon;
grant execute on function results_exploration_facets(uuid,uuid,text,text,text,text) to authenticated;

commit;
