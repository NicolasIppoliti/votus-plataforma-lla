-- Split official school rows from non-official audit rows so PostgreSQL can use the
-- existing partial indexes instead of scanning mixed source kinds.
begin;
create or replace function results_exploration_schools(p_election_id uuid, p_category_id uuid, p_distrito_code text,
  p_seccion_code text) returns jsonb language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare complete_school_count bigint; conflicting_names bigint; exclusion_audit jsonb; source_exclusion_audit jsonb;
  excluded_rows bigint; excluded_votes bigint; payload_school_limit constant integer := 500; result jsonb;
begin
  if p_election_id is null or p_category_id is null or p_distrito_code is null or p_seccion_code is null then
    return jsonb_build_object('status', 'selection_invalid', 'reason',
      'school breakdown requires election, category, distrito and seccion selectors', 'counts', jsonb_build_object('missing_selector', 1));
  end if;
  with official_scoped as materialized (
    select rr.granularity, rr.votes, j.circuito_code, j.establecimiento_code, j.mesa_code
    from result_row rr join jurisdiction j on j.id = rr.jurisdiction_id where rr.election_id = p_election_id and rr.category_id = p_category_id
      and rr.source_kind = 'official' and j.distrito_code = p_distrito_code and j.seccion_code = p_seccion_code
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
    coalesce((select sum(rows) from exclusion_groups), 0), coalesce((select sum(votes) from exclusion_groups), 0)
  into complete_school_count, exclusion_audit, excluded_rows, excluded_votes
  from official_scoped;
  with non_official_scoped as materialized (
    select rr.source_kind, rr.votes from result_row rr join jurisdiction j on j.id = rr.jurisdiction_id
    where rr.election_id = p_election_id and rr.category_id = p_category_id
      and rr.source_kind is distinct from 'official'
      and j.distrito_code = p_distrito_code and j.seccion_code = p_seccion_code
  )
  select coalesce(jsonb_agg(jsonb_build_object('kind', source_kind, 'rows', rows, 'votes', votes)
      order by source_kind), '[]'::jsonb) into source_exclusion_audit
  from (select case when source_kind = 'fiscalizacion' then source_kind else 'unknown' end as source_kind,
    count(*)::bigint as rows, coalesce(sum(votes), 0)::bigint as votes
    from non_official_scoped group by 1) groups;
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
    select rr.jurisdiction_id, rr.list_id, rr.votes, rr.archive_entry_id, j.circuito_code,
      j.establecimiento_code, j.establecimiento_name, j.mesa_code, e.year, e.round, c.name as category_name,
      results_exploration_party_jurisdiction(rr.archive_entry_id, e.year, e.round,
        c.name, j.distrito_code, j.seccion_code) as mapping_jurisdiction
    from result_row rr join jurisdiction j on j.id = rr.jurisdiction_id join election e on e.id = rr.election_id
    join category c on c.id = rr.category_id
    where rr.election_id = p_election_id and rr.category_id = p_category_id
      and rr.source_kind = 'official' and rr.granularity = 'mesa'
      and j.distrito_code = p_distrito_code and j.seccion_code = p_seccion_code
      and j.circuito_code is not null and j.establecimiento_code is not null and j.mesa_code is not null
  ), identified as (
    select scoped.*, pm.canonical_party_id, pc.display_name from scoped left join party_mapping pm on pm.year = scoped.year and pm.jurisdiction = scoped.mapping_jurisdiction
      and pm.category = scoped.category_name and pm.list_id = scoped.list_id and pm.verified
    left join party_canonical pc on pc.id = pm.canonical_party_id
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
commit;
