create index if not exists jurisdiction_exploration_lineage_idx on jurisdiction (distrito_code, seccion_code, circuito_code, establecimiento_code, id);
create role results_exploration_executor nologin inherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls; grant authenticated to results_exploration_executor;
alter function results_exploration_official(uuid, uuid, text, text, text, text, integer, text) rename to results_exploration_official_0020;
revoke all on function results_exploration_official_0020(uuid, uuid, text, text, text, text, integer, text) from public, anon, authenticated;
grant execute on function results_exploration_official_0020(uuid, uuid, text, text, text, text, integer, text) to results_exploration_executor;
create function results_exploration_official(p_election_id uuid, p_category_id uuid, p_distrito_code text, p_seccion_code text default null,
  p_circuito_code text default null, p_establecimiento_code text default null, p_mesa_code integer default null, p_requested_level text default 'seccion')
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare payload jsonb; source_exclusions jsonb;
begin
  payload := results_exploration_official_0020(p_election_id, p_category_id, p_distrito_code,
    p_seccion_code, p_circuito_code, p_establecimiento_code, p_mesa_code, p_requested_level);
  with normalized as (
    select rr.source_kind, rr.votes, rr.archive_entry_id, rr.granularity, results_exploration_reporting_level(
      rr.archive_entry_id, rr.granularity, j.distrito_code, j.seccion_code) as effective_level,
      j.seccion_code, j.circuito_code, j.establecimiento_code, j.mesa_code
    from result_row rr join jurisdiction j on j.id = rr.jurisdiction_id
    where rr.election_id = p_election_id and rr.category_id = p_category_id
      and rr.source_kind is distinct from 'official' and j.distrito_code = p_distrito_code
  ), scoped as (
    select source_kind, votes from normalized
    where (payload->>'status' <> 'ok' or effective_level = payload->>'source_granularity')
      and not (p_requested_level = 'distrito' and granularity = 'distrito'
        and effective_level = 'seccion' and archive_entry_id ~ '^pba/[0-9]{4}-distrito-[0-9]+$')
      and (p_seccion_code is null or seccion_code = p_seccion_code or effective_level = 'distrito')
      and (p_circuito_code is null or circuito_code = p_circuito_code or effective_level in ('distrito', 'seccion'))
      and (p_establecimiento_code is null or establecimiento_code = p_establecimiento_code or effective_level in ('distrito', 'seccion', 'circuito'))
      and (p_mesa_code is null or mesa_code = p_mesa_code or effective_level <> 'mesa')
  ), groups as (select case when source_kind = 'fiscalizacion' then source_kind else 'unknown' end as source_kind,
      count(*)::bigint as rows, coalesce(sum(votes), 0)::bigint as votes from scoped group by 1)
  select coalesce(jsonb_agg(jsonb_build_object('kind', source_kind, 'rows', rows, 'votes', votes)
    order by source_kind), '[]'::jsonb) into source_exclusions from groups;
  return payload || jsonb_build_object('source_exclusions', source_exclusions); end $$;
revoke all on function results_exploration_official(uuid, uuid, text, text, text, text, integer, text) from public, anon; grant execute on function results_exploration_official(uuid, uuid, text, text, text, text, integer, text) to authenticated;
grant results_exploration_executor to postgres;
grant create on schema public to results_exploration_executor;
alter function results_exploration_official(uuid, uuid, text, text, text, text, integer, text) owner to results_exploration_executor;
revoke create on schema public from results_exploration_executor;
create or replace function results_exploration_coverage(p_election_id uuid, p_category_id uuid, p_distrito_code text,
  p_seccion_code text) returns jsonb language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare official_mesa_count bigint; ambiguous_school_names bigint; result jsonb; denominator_refusal_exclusions jsonb;
begin
  if p_election_id is null or p_category_id is null or p_distrito_code is null or p_seccion_code is null then
    return jsonb_build_object('status', 'selection_invalid', 'reason',
      'coverage requires election, category, distrito and seccion selectors', 'counts', jsonb_build_object('missing_selector', 1));
  end if;
  with official_classified as materialized (
    select rr.jurisdiction_id, rr.votes, case when rr.granularity <> 'mesa' then 'official_rows_without_mesa_granularity'
      when j.mesa_code is null then 'official_rows_without_mesa_identity' end as reason
    from result_row rr join jurisdiction j on j.id = rr.jurisdiction_id
    where rr.election_id = p_election_id and rr.category_id = p_category_id and rr.source_kind = 'official'
      and j.distrito_code = p_distrito_code and j.seccion_code = p_seccion_code
  ), official_mesas as materialized (select distinct jurisdiction_id from official_classified where reason is null
  ), fiscalizacion_classified as (
    select rr.votes, case when rr.granularity <> 'mesa' then 'fiscalizacion_rows_without_mesa_granularity'
      when j.circuito_code is null or j.establecimiento_code is null or j.mesa_code is null
        then 'fiscalizacion_rows_without_mesa_identity'
      when mesa.jurisdiction_id is null then 'fiscalizacion_rows_without_official_mesa_mapping'
    end as reason
    from result_row rr join jurisdiction j on j.id = rr.jurisdiction_id
    left join official_mesas mesa on mesa.jurisdiction_id = rr.jurisdiction_id
    where rr.election_id = p_election_id and rr.category_id = p_category_id and rr.source_kind = 'fiscalizacion'
      and j.distrito_code = p_distrito_code and j.seccion_code = p_seccion_code
  ), unsupported_source_classified as (
    select rr.votes, 'unsupported_source_kind_rows' as reason from result_row rr
    join jurisdiction j on j.id = rr.jurisdiction_id
    where rr.election_id = p_election_id and rr.category_id = p_category_id
      and rr.source_kind is distinct from 'official' and rr.source_kind is distinct from 'fiscalizacion'
      and j.distrito_code = p_distrito_code and j.seccion_code = p_seccion_code
  ), exclusion_groups as (select reason, count(*)::bigint as rows, coalesce(sum(votes), 0)::bigint as votes
    from (select reason, votes from official_classified where reason is not null union all
      select reason, votes from fiscalizacion_classified where reason is not null union all
      select reason, votes from unsupported_source_classified) excluded group by reason
  )
  select (select count(*) from official_mesas), coalesce(jsonb_agg(jsonb_build_object('reason', reason,
    'rows', rows, 'votes', votes) order by reason), '[]'::jsonb)
  into official_mesa_count, denominator_refusal_exclusions from exclusion_groups;
  if official_mesa_count = 0 then
    return jsonb_build_object('status', 'denominator_unavailable',
      'reason', 'no official mesa rows exist for the selected scope',
      'counts', jsonb_build_object('official_mesa_rows', 0,
        'fiscalizacion_rows', (select count(*) from result_row rr join jurisdiction j on j.id = rr.jurisdiction_id where
          rr.election_id = p_election_id and rr.category_id = p_category_id and rr.source_kind = 'fiscalizacion'
          and j.distrito_code = p_distrito_code and j.seccion_code = p_seccion_code)),
      'exclusions', denominator_refusal_exclusions);
  end if;
  select count(*) into ambiguous_school_names from (select j.circuito_code, j.establecimiento_code from result_row rr
    join jurisdiction j on j.id = rr.jurisdiction_id
    where rr.election_id = p_election_id and rr.category_id = p_category_id
      and rr.source_kind = 'official' and rr.granularity = 'mesa'
      and j.distrito_code = p_distrito_code and j.seccion_code = p_seccion_code
      and j.circuito_code is not null and j.establecimiento_code is not null and j.mesa_code is not null
    group by j.circuito_code, j.establecimiento_code having count(distinct j.establecimiento_name) > 1) conflicts;
  if ambiguous_school_names > 0 then
    return jsonb_build_object('status', 'source_inconsistent', 'reason',
      'one establecimiento code carries conflicting names', 'counts', jsonb_build_object('ambiguous_establecimiento_name', ambiguous_school_names), 'exclusions', denominator_refusal_exclusions);
  end if;
  with official_scoped as materialized (
    select rr.*, j.distrito_code, j.seccion_code, j.circuito_code, j.establecimiento_code, j.establecimiento_name,
      j.mesa_code from result_row rr join jurisdiction j on j.id = rr.jurisdiction_id
    where rr.election_id = p_election_id and rr.category_id = p_category_id and rr.source_kind = 'official'
      and j.distrito_code = p_distrito_code and j.seccion_code = p_seccion_code
  ), official_classified as materialized (
    select *, case when granularity <> 'mesa' then 'official_rows_without_mesa_granularity' when mesa_code is null
      then 'official_rows_without_mesa_identity' end as exclusion_reason from official_scoped
  ), official_rows as materialized (select * from official_classified where exclusion_reason is null
  ), official_mesas as materialized (select jurisdiction_id, distrito_code, seccion_code, circuito_code,
      establecimiento_code, establecimiento_name, mesa_code from official_rows group by jurisdiction_id,
      distrito_code, seccion_code, circuito_code, establecimiento_code, establecimiento_name, mesa_code
  ), fiscalizacion_classified as materialized (
    select rr.*, case when rr.granularity <> 'mesa' then 'fiscalizacion_rows_without_mesa_granularity'
      when j.circuito_code is null or j.establecimiento_code is null or j.mesa_code is null
        then 'fiscalizacion_rows_without_mesa_identity'
      when mesa.jurisdiction_id is null then 'fiscalizacion_rows_without_official_mesa_mapping'
    end as exclusion_reason from result_row rr join jurisdiction j on j.id = rr.jurisdiction_id
    left join official_mesas mesa on mesa.jurisdiction_id = rr.jurisdiction_id
    where rr.election_id = p_election_id and rr.category_id = p_category_id and rr.source_kind = 'fiscalizacion'
      and j.distrito_code = p_distrito_code and j.seccion_code = p_seccion_code
  ), fiscalizacion_rows as materialized (select * from fiscalizacion_classified where exclusion_reason is null
  ), covered_mesas as (select distinct jurisdiction_id from fiscalizacion_rows
  ), coverage_mesas as materialized (select mesa.*, covered.jurisdiction_id is not null as covered from official_mesas
    mesa left join covered_mesas covered using (jurisdiction_id)
  ), complete_school_mesas as materialized (select * from coverage_mesas where circuito_code is not null and establecimiento_code is not null
  ), school_sources as (select circuito_code, establecimiento_code,
      jsonb_agg(archive_entry_id order by archive_entry_id) as official_archive_entry_ids
    from (select distinct circuito_code, establecimiento_code, archive_entry_id from official_rows where circuito_code
      is not null and establecimiento_code is not null) entries group by circuito_code, establecimiento_code
  ), school_items as (select complete_school_mesas.circuito_code, complete_school_mesas.establecimiento_code as code,
      case when count(distinct establecimiento_name) = 1 then max(establecimiento_name) end as name,
      count(*) filter (where covered)::bigint as observed_units, count(*)::bigint as denominator_units,
      max(school_sources.official_archive_entry_ids::text)::jsonb as official_archive_entry_ids
    from complete_school_mesas join school_sources using (circuito_code, establecimiento_code) group by
      complete_school_mesas.circuito_code, complete_school_mesas.establecimiento_code
  ), exclusion_groups as (select case when circuito_code is null and establecimiento_code is null
          then 'official_rows_without_circuito_and_establecimiento_code'
        when circuito_code is null then 'official_rows_without_circuito_code'
        else 'official_rows_without_establecimiento_code'
      end as reason, count(*)::bigint as rows, coalesce(sum(votes), 0)::bigint as votes from official_rows
    where circuito_code is null or establecimiento_code is null group by 1
  ), official_exclusion_groups as (select exclusion_reason as reason, count(*)::bigint as rows,
      coalesce(sum(votes), 0)::bigint as votes from official_classified where exclusion_reason is not null group by exclusion_reason
  ), fiscalizacion_exclusion_groups as (select exclusion_reason as reason, count(*)::bigint as rows,
      coalesce(sum(votes), 0)::bigint as votes from fiscalizacion_classified where exclusion_reason is not null group by exclusion_reason
  ), unsupported_source_exclusion_groups as (select 'unsupported_source_kind_rows' as reason, count(*)::bigint as rows,
      coalesce(sum(rr.votes), 0)::bigint as votes from result_row rr join jurisdiction j on j.id = rr.jurisdiction_id
    where rr.election_id = p_election_id and rr.category_id = p_category_id
      and rr.source_kind is distinct from 'official' and rr.source_kind is distinct from 'fiscalizacion'
      and j.distrito_code = p_distrito_code and j.seccion_code = p_seccion_code having count(*) > 0
  ), exclusion_audit as (select coalesce(jsonb_agg(jsonb_build_object('reason', reason, 'rows', rows, 'votes', votes)
      order by reason), '[]'::jsonb) as groups from exclusion_groups
  ), coverage_exclusion_audit as (select coalesce(jsonb_agg(jsonb_build_object('reason', reason, 'rows', rows,
      'votes', votes) order by reason), '[]'::jsonb) as groups
    from (select * from exclusion_groups union all select * from official_exclusion_groups
      union all select * from fiscalizacion_exclusion_groups union all select * from unsupported_source_exclusion_groups) groups
  ), official_audit as (select count(*)::bigint as rows, coalesce(sum(votes), 0)::bigint as votes, count(distinct jurisdiction_id)::bigint as mesas from official_rows
  ), fiscalizacion_audit as (select count(*)::bigint as rows, coalesce(sum(votes), 0)::bigint as votes, count(distinct jurisdiction_id)::bigint as mesas from fiscalizacion_rows
  ), election_shape as (select year, round from election where id = p_election_id)
  select jsonb_build_object(
    'status', 'ok', 'source_kind', 'fiscalizacion', 'is_random_sample', false,
    'election_year', election_shape.year, 'election_round', election_shape.round,
    'distrito_code', p_distrito_code, 'seccion_code', p_seccion_code,
    'mesas_coverage', jsonb_build_object('observed_units', (select count(*) from coverage_mesas where covered),
      'denominator_units', (select count(*) from coverage_mesas), 'is_random_sample', false),
    'mesas', (select jsonb_agg(jsonb_build_object('code', mesa_code, 'circuito_code', circuito_code,
      'establecimiento_code', establecimiento_code, 'establecimiento_name', establecimiento_name, 'covered', covered,
      'official_result_href', null) order by circuito_code, mesa_code, establecimiento_code)
      from coverage_mesas),
    'escuelas', case when not exists (select 1 from school_items) then jsonb_build_object('status', 'source_unavailable',
      'reason', 'the registered source publishes no complete establecimiento data',
      'exclusions', exclusion_audit.groups, 'items', '[]'::jsonb)
      else jsonb_build_object('status', 'available', 'exclusions', exclusion_audit.groups,
        'items', (select jsonb_agg(jsonb_build_object('circuito_code', circuito_code,
          'code', code, 'name', name, 'observed_units', observed_units, 'denominator_units', denominator_units,
          'is_random_sample', false, 'official_archive_entry_ids', official_archive_entry_ids)
          order by circuito_code, code) from school_items)) end,
    'source_audit', jsonb_build_array(jsonb_build_object('kind', 'fiscalizacion',
      'rows', fiscalizacion_audit.rows, 'votes', fiscalizacion_audit.votes, 'mesas', fiscalizacion_audit.mesas)),
    'denominator_audit', jsonb_build_array(jsonb_build_object('kind', 'official', 'rows', official_audit.rows,
      'votes', official_audit.votes, 'mesas', official_audit.mesas)),
    'exclusions', coverage_exclusion_audit.groups,
    'provenance', jsonb_build_object('official_archive_entry_ids', (select jsonb_agg(archive_entry_id order by archive_entry_id)
        from (select distinct archive_entry_id from official_rows) entries),
      'fiscalizacion_archive_entry_ids', coalesce((select jsonb_agg(archive_entry_id order by archive_entry_id)
        from (select distinct archive_entry_id from fiscalizacion_rows) entries), '[]'::jsonb))
  ) into result
  from official_audit cross join fiscalizacion_audit cross join exclusion_audit
    cross join coverage_exclusion_audit cross join election_shape;
  return result; end $$;
revoke all on function results_exploration_coverage(uuid, uuid, text, text) from public, anon; grant execute on function results_exploration_coverage(uuid, uuid, text, text) to authenticated;
create or replace function results_exploration_schools(p_election_id uuid, p_category_id uuid, p_distrito_code text,
  p_seccion_code text) returns jsonb language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare complete_school_count bigint; conflicting_names bigint; exclusion_audit jsonb; source_exclusion_audit jsonb;
  excluded_rows bigint; excluded_votes bigint; payload_school_limit constant integer := 500; result jsonb;
begin
  if p_election_id is null or p_category_id is null or p_distrito_code is null or p_seccion_code is null then
    return jsonb_build_object('status', 'selection_invalid', 'reason',
      'school breakdown requires election, category, distrito and seccion selectors', 'counts', jsonb_build_object('missing_selector', 1));
  end if;
  with scoped as materialized (
    select rr.source_kind, rr.granularity, rr.votes, j.circuito_code, j.establecimiento_code, j.mesa_code
    from result_row rr join jurisdiction j on j.id = rr.jurisdiction_id where rr.election_id = p_election_id and rr.category_id = p_category_id
      and j.distrito_code = p_distrito_code and j.seccion_code = p_seccion_code
  ), official_scoped as (select * from scoped where source_kind = 'official'
  ), exclusion_groups as (select case when granularity <> 'mesa' then 'official_rows_without_mesa_granularity'
        when circuito_code is null and establecimiento_code is null
          then 'official_rows_without_circuito_and_establecimiento_code'
        when circuito_code is null then 'official_rows_without_circuito_code'
        when establecimiento_code is null then 'official_rows_without_establecimiento_code'
        else 'official_rows_without_mesa_code'
      end as reason, count(*)::bigint as rows, coalesce(sum(votes), 0)::bigint as votes
    from official_scoped where granularity <> 'mesa' or circuito_code is null or establecimiento_code is null
      or mesa_code is null group by 1
  )
  select count(distinct (circuito_code, establecimiento_code)) filter (
      where circuito_code is not null and establecimiento_code is not null
        and mesa_code is not null and granularity = 'mesa'
    ), coalesce((select jsonb_agg(jsonb_build_object('reason', reason, 'rows', rows, 'votes', votes)
      order by reason) from exclusion_groups), '[]'::jsonb),
    coalesce((select sum(rows) from exclusion_groups), 0), coalesce((select sum(votes) from exclusion_groups), 0),
    coalesce((select jsonb_agg(jsonb_build_object('kind', source_kind, 'rows', rows, 'votes', votes)
      order by source_kind) from (select case
        when source_kind = 'fiscalizacion' then source_kind else 'unknown' end as source_kind,
      count(*)::bigint as rows, coalesce(sum(votes), 0)::bigint as votes from scoped
      where source_kind is distinct from 'official' group by 1) groups), '[]'::jsonb)
  into complete_school_count, exclusion_audit, excluded_rows, excluded_votes, source_exclusion_audit
  from official_scoped;
  if complete_school_count = 0 then return jsonb_build_object('status', 'source_unavailable',
      'reason', 'the registered source publishes no complete establecimiento data',
      'counts', jsonb_build_object('complete_establecimientos', 0, 'excluded_rows', excluded_rows,
        'excluded_votes', excluded_votes),
      'exclusions', exclusion_audit, 'source_exclusions', source_exclusion_audit); end if;
  if complete_school_count > payload_school_limit then return jsonb_build_object('status', 'selection_invalid',
      'reason', 'the section school breakdown exceeds the bounded payload limit',
      'counts', jsonb_build_object('schools', complete_school_count, 'payload_school_limit', payload_school_limit),
      'exclusions', exclusion_audit, 'source_exclusions', source_exclusion_audit); end if;
  select count(*) into conflicting_names from (select j.circuito_code, j.establecimiento_code from result_row rr join jurisdiction j on j.id = rr.jurisdiction_id
    where rr.election_id = p_election_id and rr.category_id = p_category_id
      and rr.source_kind = 'official' and rr.granularity = 'mesa'
      and j.distrito_code = p_distrito_code and j.seccion_code = p_seccion_code
      and j.circuito_code is not null and j.establecimiento_code is not null and j.mesa_code is not null
    group by j.circuito_code, j.establecimiento_code having count(distinct j.establecimiento_name) > 1) conflicts;
  if conflicting_names > 0 then return jsonb_build_object('status', 'selection_invalid',
      'reason', 'one complete establecimiento identity carries conflicting names',
      'counts', jsonb_build_object('ambiguous_establecimiento_name', conflicting_names),
      'exclusions', exclusion_audit, 'source_exclusions', source_exclusion_audit); end if;
  with scoped as materialized (
    select rr.jurisdiction_id, rr.list_id, rr.votes, rr.archive_entry_id, rr.source_kind, rr.granularity, j.circuito_code,
      j.establecimiento_code, j.establecimiento_name, j.mesa_code, e.year, e.round, c.name as category_name,
      results_exploration_party_jurisdiction(rr.archive_entry_id, e.year, e.round,
        c.name, j.distrito_code, j.seccion_code) as mapping_jurisdiction
    from result_row rr join jurisdiction j on j.id = rr.jurisdiction_id join election e on e.id = rr.election_id
    join category c on c.id = rr.category_id
    where rr.election_id = p_election_id and rr.category_id = p_category_id
      and j.distrito_code = p_distrito_code and j.seccion_code = p_seccion_code
  ), identified as (
    select scoped.*, pm.canonical_party_id, pc.display_name from scoped left join party_mapping pm on pm.year = scoped.year and pm.jurisdiction = scoped.mapping_jurisdiction
      and pm.category = scoped.category_name and pm.list_id = scoped.list_id and pm.verified
    left join party_canonical pc on pc.id = pm.canonical_party_id
    where source_kind = 'official' and granularity = 'mesa'
      and circuito_code is not null and establecimiento_code is not null and mesa_code is not null
  ), party_groups as (select circuito_code, establecimiento_code, canonical_party_id, display_name,
      case when canonical_party_id is null then list_id end as unmapped_list_id, sum(votes)::bigint as votes
    from identified group by circuito_code, establecimiento_code, canonical_party_id, display_name,
      case when canonical_party_id is null then list_id end
  ), school_totals as (select circuito_code, establecimiento_code, sum(votes)::bigint as total_votes from party_groups
    group by circuito_code, establecimiento_code
  ), school_meta as (select circuito_code, establecimiento_code, max(establecimiento_name) as name,
      count(distinct jurisdiction_id)::bigint as mesa_count, jsonb_agg(distinct archive_entry_id order by archive_entry_id) as archive_entry_ids
    from identified group by circuito_code, establecimiento_code
  ), school_items as (
    select meta.circuito_code, meta.establecimiento_code, meta.name, meta.mesa_count, totals.total_votes,
      meta.archive_entry_ids, jsonb_agg(jsonb_build_object(
        'identity_status', case when parties.canonical_party_id is null then 'unmapped' else 'canonical' end,
        'canonical_party_id', parties.canonical_party_id, 'display_name', parties.display_name,
        'list_id', parties.unmapped_list_id, 'votes', parties.votes, 'vote_share', case when totals.total_votes = 0
          then null else (parties.votes::numeric / totals.total_votes)::text end) order by parties.votes desc,
        parties.canonical_party_id nulls last, parties.unmapped_list_id) as parties
    from school_meta meta join school_totals totals using (circuito_code, establecimiento_code)
    join party_groups parties using (circuito_code, establecimiento_code)
    group by meta.circuito_code, meta.establecimiento_code, meta.name, meta.mesa_count, totals.total_votes, meta.archive_entry_ids
  ), audit as (select count(*)::bigint as rows, coalesce(sum(votes), 0)::bigint as votes from identified)
  select jsonb_build_object('status', 'ok', 'source_kind', 'official', 'level', 'seccion',
    'source_audit', jsonb_build_array(jsonb_build_object('kind', 'official', 'rows', audit.rows, 'votes', audit.votes)),
    'source_exclusions', source_exclusion_audit, 'exclusions', exclusion_audit,
    'schools', (select jsonb_agg(jsonb_build_object(
      'circuito_code', circuito_code, 'code', establecimiento_code, 'name', name, 'mesa_count', mesa_count,
      'total_votes', total_votes, 'parties', parties, 'archive_entry_ids', archive_entry_ids) order by circuito_code, establecimiento_code)
      from school_items)) into result from audit;
  return result; end $$;
revoke all on function results_exploration_schools(uuid, uuid, text, text) from public, anon; grant execute on function results_exploration_schools(uuid, uuid, text, text) to authenticated;
