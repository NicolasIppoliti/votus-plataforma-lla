\set ON_ERROR_STOP on
SET statement_timeout='120s';
-- Disposable high-cardinality EXPLAIN/plan proof; fixture state is committed by setup.
begin;
select plan(17);
create temporary table scale_plan_evidence (label text primary key,representative_result_rows bigint not null,plan jsonb not null) on commit drop;
do $$ declare evidence jsonb; representative_result_rows constant bigint := 122295; begin
  execute $plan$explain (analyze, buffers, format json)
    select results_exploration_facets(
      '30000000-0000-0000-0000-000000000001'::uuid,
      '30000000-0000-0000-0000-000000000002'::uuid, '02', '027', null)$plan$
    into evidence;
  insert into scale_plan_evidence values ('facets_selected', representative_result_rows, evidence);
  execute $plan$explain (analyze, buffers, format json)
    select results_exploration_facets(null, null, null, null, null, null)$plan$
    into evidence;
  insert into scale_plan_evidence values ('facets_cold_start', 122360, evidence);
  execute $plan$explain (analyze, buffers, format json)
    select results_exploration_official(
      '30000000-0000-0000-0000-000000000001'::uuid,
      '30000000-0000-0000-0000-000000000002'::uuid, '02', '028')$plan$
    into evidence;
    insert into scale_plan_evidence values ('official', representative_result_rows, evidence);
        execute $plan$explain (analyze, buffers, format json) with scoped_geography as materialized
          (select id,seccion_code from jurisdiction where distrito_code='02' and seccion_code='001'),raw_rows as materialized
          (select array[rr.archive_entry_id,rr.granularity,j.seccion_code]::text[] shape_key,
            rr.*,j.seccion_code from scoped_geography j cross join lateral (select fact.archive_entry_id,fact.granularity
            from result_row fact where fact.jurisdiction_id=j.id and fact.election_id='30000000-0000-0000-0000-000000000001'
              and fact.category_id='30000000-0000-0000-0000-000000000002' and fact.source_kind='official' offset 0) rr),
          source_shapes as materialized (select distinct shape_key,archive_entry_id,granularity,seccion_code from raw_rows),
          normalized_shapes as materialized
          (select s.*,results_exploration_reporting_level(archive_entry_id,granularity,'02',seccion_code) effective_level from source_shapes s)
          select count(*) from raw_rows r join normalized_shapes s on s.shape_key=r.shape_key
          where s.effective_level='mesa'$plan$ into evidence;
      insert into scale_plan_evidence values ('official_core_scope', 129754, evidence);
      execute $plan$explain (analyze, buffers, format json)
        select count(*)::bigint, coalesce(sum(rr.votes), 0)::bigint

    from result_row rr
    join jurisdiction j on j.id = rr.jurisdiction_id
    where rr.election_id = '30000000-0000-0000-0000-000000000001'::uuid
      and rr.category_id = '30000000-0000-0000-0000-000000000002'::uuid
      and rr.source_kind is distinct from 'official'
      and j.distrito_code = '02' and j.seccion_code = '001'$plan$
    into evidence;
      insert into scale_plan_evidence values ('official_source_exclusions', 129754, evidence);
      execute $plan$explain (analyze,buffers,format json) with target_jurisdictions as materialized
        (select id from jurisdiction where distrito_code='04') select count(*),sum(rr.votes) from target_jurisdictions j
        cross join lateral (select fact.votes from result_row fact where fact.jurisdiction_id=j.id
          and fact.election_id='30000000-0000-0000-0000-000000000001' and fact.category_id='30000000-0000-0000-0000-000000000002'
          and fact.source_kind='official' offset 0) rr$plan$ into evidence;
      insert into scale_plan_evidence values ('district_scope_access',151754,evidence);
      execute $plan$explain (analyze,buffers,format json) select results_exploration_official_0035(
        '30000000-0000-0000-0000-000000000001'::uuid,
        '30000000-0000-0000-0000-000000000002'::uuid,'04'::text,null::text,null::text,
        null::text,null::integer,'distrito'::text)$plan$ into evidence;
      insert into scale_plan_evidence values ('district_core_rpc',151754,evidence);
      execute $plan$explain (analyze,buffers,format json) select results_exploration_official(
        '30000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000002','04',
        p_requested_level=>'distrito')$plan$ into evidence;
      insert into scale_plan_evidence values ('district_rpc',151754,evidence);
      execute $plan$explain (analyze, buffers, format json)
        select public.results_exploration_coverage(
      '30000000-0000-0000-0000-000000000001'::uuid,
      '30000000-0000-0000-0000-000000000002'::uuid, '02', '027')$plan$
    into evidence;
  insert into scale_plan_evidence values ('coverage_production_rpc', 129754, evidence);
  execute $plan$explain (analyze, buffers, format json)
    select count(*)::bigint, coalesce(sum(rr.votes), 0)::bigint
    from result_row rr
    join jurisdiction j on j.id = rr.jurisdiction_id
    where rr.election_id = '30000000-0000-0000-0000-000000000001'::uuid
      and rr.category_id = '30000000-0000-0000-0000-000000000002'::uuid
      and rr.source_kind is distinct from 'official'
      and rr.source_kind is distinct from 'fiscalizacion'
      and j.distrito_code = '02' and j.seccion_code = '027'$plan$
    into evidence;
  insert into scale_plan_evidence values ('coverage_unsupported_source_audit', 129754, evidence);
  execute $plan$explain (analyze, buffers, format json)
    select results_exploration_schools(
      '30000000-0000-0000-0000-000000000001'::uuid,
      '30000000-0000-0000-0000-000000000002'::uuid, '02', '028')$plan$
    into evidence;
  insert into scale_plan_evidence values ('schools', representative_result_rows, evidence);
end $$;
-- Disposable timings are not production latency claims. Keep the existing 15s
-- coverage budget and 7s cold-start budget, while bounding stable replica block churn.
select ok((select plan::text like '%result_row_non_official_scope_idx%'
    from scale_plan_evidence where label = 'official_source_exclusions'),
  'source exclusion audit uses the geography-selective non-official partial index');
    select ok((select label = 'official_core_scope'
        and plan::text like '%result_row_official_district_scope_idx%'
        and plan::text not like '%result_row_official_district_geography_idx%'
        and (coalesce((plan->0->'Plan'->>'Shared Hit Blocks')::bigint, 0)
          + coalesce((plan->0->'Plan'->>'Shared Read Blocks')::bigint, 0)) <= 20
        and (select district.plan::text like '%result_row_official_district_scope_idx%'
          and district.plan::text not like '%result_row_official_district_geography_idx%'
          and not jsonb_path_exists(district.plan,
            '$.** ? (@."Node Type" == "Seq Scan" && @."Relation Name" == "result_row")')
          and (district.plan->0->>'Execution Time')::numeric<=2000
          -- Distrito 05 adds 581,400 entries to this same election/category partial index.
          -- The larger B-tree increases its page depth and page access even for distrito 04;
          -- 8,500 preserves a tight bound on that stable access shape.
          and coalesce((district.plan->0->'Plan'->>'Shared Hit Blocks')::bigint,0)
            +coalesce((district.plan->0->'Plan'->>'Shared Read Blocks')::bigint,0)<=8500
          from scale_plan_evidence district where district.label='district_scope_access')
      from scale_plan_evidence where label = 'official_core_scope'),
      'official core and district path automatically use bounded scope-first index access without a fact seq scan');

-- Everything above reads hand-written replicas of the function body. A later migration could
-- redefine results_exploration_official and leave both the shipped migration file and those
-- replicas untouched, so the suite would stay green while production stopped using the index.
-- EXPLAIN cannot close that gap: for a SQL function call it reports a bare Result node and
-- hides every nested plan. Its nested-function shared-block total is unstable, so district_rpc
-- bounds only execution time and one-row shape and cannot name an index. pg_stat_get_xact_numscans
-- can name the real access path. It counts scans for the current transaction
-- only, so no flush is needed and no concurrent backend can inflate the readings.
create temporary table district_scan_evidence (label text primary key,
  table_scans bigint not null, index_scans bigint not null) on commit drop;
do $$ declare district_seq_before bigint; district_idx_before bigint;
  district_seq_after bigint; district_idx_after bigint; district_index oid; district_payload jsonb; begin
  district_index := to_regclass('public.result_row_official_district_scope_idx');
  if district_index is null then raise exception '0031 scope-first district index is absent, so its access cannot be measured'; end if;
  district_seq_before := pg_stat_get_xact_numscans('public.result_row'::regclass);
  district_idx_before := pg_stat_get_xact_numscans(district_index);
  district_payload := results_exploration_official('30000000-0000-0000-0000-000000000001'::uuid,
    '30000000-0000-0000-0000-000000000002'::uuid,'04',p_requested_level=>'distrito');
  district_seq_after := pg_stat_get_xact_numscans('public.result_row'::regclass);
  district_idx_after := pg_stat_get_xact_numscans(district_index);
  if jsonb_typeof(district_payload) is distinct from 'object' then
    raise exception 'district RPC returned % instead of a payload object',coalesce(jsonb_typeof(district_payload),'null'); end if;
  insert into district_scan_evidence values ('district_rpc_access',
    district_seq_after-district_seq_before, district_idx_after-district_idx_before);
end $$;
-- One public call dispatches once to the 0034 core, whose batched raw_rows stage has one logical
-- scope-first fact access. Permit up to four physical scans for the planner/parallel shape, but
-- reject both a missing access and the old per-jurisdiction scan algorithm.
select ok((select index_scans between 1 and 4
    from district_scan_evidence where label = 'district_rpc_access'),
  'production district RPC uses a small bounded number of batched scope-first index scans');
select diag(format('district_rpc_access table_scans=%s index_scans=%s',table_scans,index_scans))
from district_scan_evidence where label='district_rpc_access';
select ok((select table_scans = 0 from district_scan_evidence where label = 'district_rpc_access'),
  'production district RPC reaches result_row without a sequential scan');

create temporary table school_scan_evidence (target_jurisdictions bigint not null,table_scans bigint not null,
  official_index_scans bigint not null,non_official_index_scans bigint not null) on commit drop;
do $$ declare target_jurisdictions bigint; school_seq_before bigint; school_official_before bigint; school_non_official_before bigint;
  school_seq_after bigint; school_official_after bigint; school_non_official_after bigint;
  official_index oid; non_official_index oid; school_payload jsonb; begin
  official_index:=to_regclass('public.result_row_official_district_scope_idx');
  non_official_index:=to_regclass('public.result_row_non_official_scope_idx');
  if official_index is null or non_official_index is null then
    raise exception 'school source-split indexes are absent, so access cannot be measured'; end if;
  select count(*) into target_jurisdictions from jurisdiction where distrito_code='02' and seccion_code='028';
  school_seq_before := pg_stat_get_xact_numscans('public.result_row'::regclass);
  school_official_before := pg_stat_get_xact_numscans(official_index);
  school_non_official_before := pg_stat_get_xact_numscans(non_official_index);
  school_payload:=results_exploration_schools('30000000-0000-0000-0000-000000000001'::uuid,
    '30000000-0000-0000-0000-000000000002'::uuid,'02','028');
  school_seq_after := pg_stat_get_xact_numscans('public.result_row'::regclass);
  school_official_after := pg_stat_get_xact_numscans(official_index);
  school_non_official_after := pg_stat_get_xact_numscans(non_official_index);
  if school_payload->>'status' is distinct from 'ok' then raise exception 'school RPC returned %',school_payload->>'status'; end if;
  insert into school_scan_evidence values (target_jurisdictions,school_seq_after-school_seq_before,
    school_official_after-school_official_before,school_non_official_after-school_non_official_before);
end $$;
select ok((select target_jurisdictions>0 and official_index_scans between 1 and target_jurisdictions*3
    and non_official_index_scans between 1 and target_jurisdictions from school_scan_evidence),
  'production school RPC bounds partial-index scans by the selected jurisdiction scope');
select ok((select table_scans=0 from school_scan_evidence),
  'production school RPC reaches result_row without a sequential scan');
select diag(format('school_rpc_access target_jurisdictions=%s table_scans=%s official_index_scans=%s non_official_index_scans=%s',
  target_jurisdictions,table_scans,official_index_scans,non_official_index_scans)) from school_scan_evidence;

select ok((select label = 'coverage_production_rpc'
    and (plan->0->>'Execution Time')::numeric <= 15000
    and (coalesce((plan->0->'Plan'->>'Shared Hit Blocks')::bigint, 0)
      + coalesce((plan->0->'Plan'->>'Shared Read Blocks')::bigint, 0)) <= 30000
    and (plan->0->'Plan'->>'Actual Rows')::bigint = 1
  from scale_plan_evidence where label = 'coverage_production_rpc'),
  'production-shaped coverage RPC stays within its time and shared-block budgets');
-- A bare Result node includes unstable nested-function block totals, so the encapsulated core
-- and wrapper contracts intentionally use only strict latency and one-row shape. Stable block
-- budgets remain on the hand-written fact-access and nonofficial-audit replicas above and below.
select ok((select (plan->0->>'Execution Time')::numeric<=3000
    and (plan->0->'Plan'->>'Actual Rows')::bigint=1
  from scale_plan_evidence where label='district_core_rpc'),
  'production district core stays within 3000ms and returns one row');
select ok((select (plan->0->>'Execution Time')::numeric<=3000
    and (plan->0->'Plan'->>'Actual Rows')::bigint=1
  from scale_plan_evidence where label='district_rpc'),
  'public district wrapper stays within 3000ms and returns one row');
select ok((select label = 'coverage_unsupported_source_audit'
    and plan::text like '%result_row_non_official_scope_idx%'
    and (coalesce((plan->0->'Plan'->>'Shared Hit Blocks')::bigint, 0)
      + coalesce((plan->0->'Plan'->>'Shared Read Blocks')::bigint, 0)) <= 2500
    and (plan->0->'Plan'->>'Actual Rows')::bigint = 1
  from scale_plan_evidence where label = 'coverage_unsupported_source_audit'),
  'coverage unsupported-source audit uses 0027 with a tighter shared-block budget');
select ok((select label = 'facets_cold_start'
    and (coalesce((plan->0->'Plan'->>'Shared Hit Blocks')::bigint, 0)
      + coalesce((plan->0->'Plan'->>'Shared Read Blocks')::bigint, 0)) <= 500
    and (plan->0->'Plan'->>'Actual Rows')::bigint = 1
  from scale_plan_evidence where label = 'facets_cold_start'),
  'cold-start facets bound fact-table reads while preserving source-backed elections');
select ok((plan->0->>'Execution Time')::numeric <= case
      when label = 'facets_cold_start' then 7000
      else 10000 end
    and (plan->0->'Plan'->>'Actual Rows')::bigint = 1,
  label || ' stays within its disposable plan budget and returns one payload row'
) from scale_plan_evidence
where label not in ('coverage_production_rpc', 'coverage_unsupported_source_audit',
  'district_scope_access','district_core_rpc','district_rpc')
order by label;
select diag(format(
  '%s: representative_result_rows=%s planning_ms=%s execution_ms=%s top_node=%s shared_hit_blocks=%s shared_read_blocks=%s indexes=%s',
  label, representative_result_rows, round((plan->0->>'Planning Time')::numeric, 3),
  round((plan->0->>'Execution Time')::numeric, 3), plan->0->'Plan'->>'Node Type',
  coalesce((plan->0->'Plan'->>'Shared Hit Blocks')::bigint, 0),
  coalesce((plan->0->'Plan'->>'Shared Read Blocks')::bigint, 0),
  jsonb_path_query_array(plan, '$.**."Index Name"')
)) from scale_plan_evidence order by label;
select * from finish();
rollback;
