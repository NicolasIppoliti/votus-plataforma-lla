-- Coverage-only, read-only boundary. The denominator is always the official
-- mesa corpus in the exact selected election/category/section; fiscalizacion
-- is explicit presence and is never summed into an official result.
create or replace function results_exploration_coverage(
  p_election_id uuid, p_category_id uuid,
  p_distrito_code text, p_seccion_code text
) returns jsonb
language plpgsql stable security invoker
set search_path = public, pg_temp
as $$
declare
  official_mesa_count bigint;
  unmatched_fiscalizacion_mesas bigint;
  ambiguous_school_names bigint;
  result jsonb;
begin
  if p_election_id is null or p_category_id is null
     or p_distrito_code is null or p_seccion_code is null then
    return jsonb_build_object('status', 'selection_invalid',
      'reason', 'coverage requires election, category, distrito and seccion selectors',
      'counts', jsonb_build_object('missing_selector', 1));
  end if;

  select count(distinct rr.jurisdiction_id) into official_mesa_count
  from result_row rr join jurisdiction j on j.id = rr.jurisdiction_id
  where rr.election_id = p_election_id and rr.category_id = p_category_id
    and rr.source_kind = 'official' and rr.granularity = 'mesa'
    and j.distrito_code = p_distrito_code and j.seccion_code = p_seccion_code
    and j.mesa_code is not null;
  if official_mesa_count = 0 then
    return jsonb_build_object('status', 'denominator_unavailable',
      'reason', 'no official mesa rows exist for the selected scope',
      'counts', jsonb_build_object(
        'official_mesa_rows', 0,
        'fiscalizacion_rows', (select count(*) from result_row rr
          join jurisdiction j on j.id = rr.jurisdiction_id
          where rr.election_id = p_election_id and rr.category_id = p_category_id
            and rr.source_kind = 'fiscalizacion'
            and j.distrito_code = p_distrito_code and j.seccion_code = p_seccion_code)));
  end if;

  select count(distinct fr.jurisdiction_id) into unmatched_fiscalizacion_mesas
  from result_row fr join jurisdiction j on j.id = fr.jurisdiction_id
  where fr.election_id = p_election_id and fr.category_id = p_category_id
    and fr.source_kind = 'fiscalizacion'
    and j.distrito_code = p_distrito_code and j.seccion_code = p_seccion_code
    and not exists (select 1 from result_row rr
      where rr.election_id = fr.election_id and rr.category_id = fr.category_id
        and rr.jurisdiction_id = fr.jurisdiction_id and rr.source_kind = 'official'
        and rr.granularity = 'mesa');
  if unmatched_fiscalizacion_mesas > 0 then
    return jsonb_build_object('status', 'source_inconsistent',
      'reason', 'fiscalizacion presence includes mesas outside the official denominator',
      'counts', jsonb_build_object('unmatched_fiscalizacion_mesas', unmatched_fiscalizacion_mesas));
  end if;

  select count(*) into ambiguous_school_names from (
    select j.circuito_code, j.establecimiento_code
    from result_row rr join jurisdiction j on j.id = rr.jurisdiction_id
    where rr.election_id = p_election_id and rr.category_id = p_category_id
      and rr.source_kind = 'official' and rr.granularity = 'mesa'
      and j.distrito_code = p_distrito_code and j.seccion_code = p_seccion_code
      and j.establecimiento_code is not null
    group by j.circuito_code, j.establecimiento_code
    having count(distinct j.establecimiento_name) > 1
  ) conflicts;
  if ambiguous_school_names > 0 then
    return jsonb_build_object('status', 'source_inconsistent',
      'reason', 'one establecimiento code carries conflicting names',
      'counts', jsonb_build_object('ambiguous_establecimiento_name', ambiguous_school_names));
  end if;

  with official_rows as (
    select rr.*, j.distrito_code, j.seccion_code, j.circuito_code,
      j.establecimiento_code, j.establecimiento_name, j.mesa_code
    from result_row rr join jurisdiction j on j.id = rr.jurisdiction_id
    where rr.election_id = p_election_id and rr.category_id = p_category_id
      and rr.source_kind = 'official' and rr.granularity = 'mesa'
      and j.distrito_code = p_distrito_code and j.seccion_code = p_seccion_code
      and j.mesa_code is not null
  ), official_mesas as (
    select jurisdiction_id, distrito_code, seccion_code, circuito_code,
      establecimiento_code, establecimiento_name, mesa_code
    from official_rows
    group by jurisdiction_id, distrito_code, seccion_code, circuito_code,
      establecimiento_code, establecimiento_name, mesa_code
  ), fiscalizacion_rows as (
    select rr.* from result_row rr join official_mesas mesa
      on mesa.jurisdiction_id = rr.jurisdiction_id
    where rr.election_id = p_election_id and rr.category_id = p_category_id
      and rr.source_kind = 'fiscalizacion'
  ), covered_mesas as (
    select distinct jurisdiction_id from fiscalizacion_rows
  ), coverage_mesas as (
    select mesa.*, covered.jurisdiction_id is not null as covered
    from official_mesas mesa left join covered_mesas covered using (jurisdiction_id)
  ), school_items as (
    select circuito_code, establecimiento_code as code,
      case when count(distinct establecimiento_name) = 1 then max(establecimiento_name) end as name,
      count(*) filter (where covered)::bigint as observed_units,
      count(*)::bigint as denominator_units,
      (select jsonb_agg(archive_entry_id order by archive_entry_id)
        from (select distinct row_source.archive_entry_id
          from official_rows row_source
          where row_source.circuito_code is not distinct from coverage_mesas.circuito_code
            and row_source.establecimiento_code = coverage_mesas.establecimiento_code) entries
      ) as official_archive_entry_ids
    from coverage_mesas where establecimiento_code is not null
    group by circuito_code, establecimiento_code
  ), missing_school as (
    select count(*)::bigint as rows, coalesce(sum(row_votes), 0)::bigint as votes
    from (select mesa.jurisdiction_id, sum(rr.votes)::bigint as row_votes
      from official_mesas mesa join official_rows rr using (jurisdiction_id)
      where mesa.establecimiento_code is null group by mesa.jurisdiction_id) missing
  ), official_audit as (
    select count(*)::bigint as rows, coalesce(sum(votes), 0)::bigint as votes,
      count(distinct jurisdiction_id)::bigint as mesas from official_rows
  ), fiscalizacion_audit as (
    select count(*)::bigint as rows, coalesce(sum(votes), 0)::bigint as votes,
      count(distinct jurisdiction_id)::bigint as mesas from fiscalizacion_rows
  ), election_shape as (
    select year, round from election where id = p_election_id
  )
  select jsonb_build_object(
    'status', 'ok', 'source_kind', 'fiscalizacion', 'is_random_sample', false,
    'election_year', election_shape.year, 'election_round', election_shape.round,
    'distrito_code', p_distrito_code, 'seccion_code', p_seccion_code,
    'mesas_coverage', jsonb_build_object(
      'observed_units', (select count(*) from coverage_mesas where covered),
      'denominator_units', (select count(*) from coverage_mesas),
      'is_random_sample', false),
    'mesas', (select jsonb_agg(jsonb_build_object(
      'code', mesa_code, 'circuito_code', circuito_code,
      'establecimiento_code', establecimiento_code,
      'establecimiento_name', establecimiento_name, 'covered', covered,
      'official_result_href', null) order by circuito_code, mesa_code, establecimiento_code)
      from coverage_mesas),
    'escuelas', case when not exists (select 1 from school_items) then jsonb_build_object(
      'status', 'source_unavailable',
      'reason', 'the registered source publishes no establecimiento data',
      'exclusions', jsonb_build_array(jsonb_build_object(
        'reason', 'official_mesas_without_establecimiento_identity',
        'rows', missing_school.rows, 'votes', missing_school.votes)), 'items', '[]'::jsonb)
      else jsonb_build_object('status', 'available',
        'exclusions', case when missing_school.rows > 0 then jsonb_build_array(jsonb_build_object(
          'reason', 'official_mesas_without_establecimiento_identity',
          'rows', missing_school.rows, 'votes', missing_school.votes)) else '[]'::jsonb end,
        'items', (select jsonb_agg(jsonb_build_object('circuito_code', circuito_code,
          'code', code, 'name', name,
          'observed_units', observed_units, 'denominator_units', denominator_units,
          'is_random_sample', false, 'official_archive_entry_ids', official_archive_entry_ids)
          order by circuito_code, code) from school_items)) end,
    'source_audit', jsonb_build_array(jsonb_build_object('kind', 'fiscalizacion',
      'rows', fiscalizacion_audit.rows, 'votes', fiscalizacion_audit.votes,
      'mesas', fiscalizacion_audit.mesas)),
    'denominator_audit', jsonb_build_array(jsonb_build_object('kind', 'official',
      'rows', official_audit.rows, 'votes', official_audit.votes, 'mesas', official_audit.mesas)),
    'exclusions', case when missing_school.rows > 0 then jsonb_build_array(jsonb_build_object(
      'reason', 'official_mesas_without_establecimiento_identity',
      'rows', missing_school.rows, 'votes', missing_school.votes)) else '[]'::jsonb end,
    'provenance', jsonb_build_object(
      'official_archive_entry_ids', (select jsonb_agg(archive_entry_id order by archive_entry_id)
        from (select distinct archive_entry_id from official_rows) entries),
      'fiscalizacion_archive_entry_ids', coalesce((select jsonb_agg(archive_entry_id order by archive_entry_id)
        from (select distinct archive_entry_id from fiscalizacion_rows) entries), '[]'::jsonb))
  ) into result
  from official_audit cross join fiscalizacion_audit cross join missing_school cross join election_shape;
  return result;
end $$;

revoke all on function results_exploration_coverage(uuid, uuid, text, text) from public;
revoke all on function results_exploration_coverage(uuid, uuid, text, text) from anon;
grant execute on function results_exploration_coverage(uuid, uuid, text, text) to authenticated;
