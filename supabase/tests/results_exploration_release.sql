\set ON_ERROR_STOP on
do $$ begin
  if results_exploration_party_jurisdiction(
       'pba/2025-distrito-113', 2025, 'provinciales',
       'SENADORES PROVINCIALES', '02', '113') is distinct from 'pba_provincial'
     or results_exploration_party_jurisdiction(
       'pba/2025-distrito-113', 2025, 'provinciales',
       'CONCEJALES', '02', '113') is distinct from 'tigre_municipal'
     or results_exploration_party_jurisdiction(
       'pba/2025-distrito-027', 2025, 'provinciales',
       'DIPUTADOS PROVINCIALES', '02', '027') is distinct from 'pba_provincial' then
    raise exception 'timestamped PBA 113 migration omitted exact mappings or changed 027';
  end if;
end $$;
\ir ../migrations/down/20260825165116_organization_workspace_authorization_facts.down.sql
\ir ../migrations/down/20260825144358_organization_workspace_expand.down.sql
\ir ../migrations/down/20260824193650_map_pba_113_party_jurisdictions.down.sql
do $$ begin
  if results_exploration_party_jurisdiction(
       'pba/2025-distrito-113', 2025, 'provinciales',
       'CONCEJALES', '02', '113') is not null
     or results_exploration_party_jurisdiction(
       'pba/2025-distrito-027', 2025, 'provinciales',
       'DIPUTADOS PROVINCIALES', '02', '027') is distinct from 'pba_provincial' then
    raise exception 'timestamped PBA 113 rollback did not restore exact 0037 boundary';
  end if;
end $$;
do $$ begin
  if to_regprocedure('public.results_exploration_facets_0036(uuid,uuid,text,text,text,text)') is null
     or has_function_privilege('authenticated',
       'public.results_exploration_facets_0036(uuid,uuid,text,text,text,text)', 'EXECUTE')
     or has_function_privilege('anon',
       'public.results_exploration_facets_0036(uuid,uuid,text,text,text,text)', 'EXECUTE')
     or exists (
       select 1 from pg_proc p
       cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
       where p.oid = 'public.results_exploration_facets_0036(uuid,uuid,text,text,text,text)'::regprocedure
         and acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
     ) then
    raise exception '0037 did not preserve a fully private six-argument 0036 facets base';
  end if;
end $$;
\ir ../migrations/down/0037_add_selector_name_canonical_fallback.down.sql
do $$ begin
  if to_regprocedure('public.results_exploration_facets_0036(uuid,uuid,text,text,text,text)') is not null
     or to_regprocedure('public.results_exploration_facets(uuid,uuid,text,text,text,text)') is null
     or not has_function_privilege('authenticated',
       'public.results_exploration_facets(uuid,uuid,text,text,text,text)', 'EXECUTE')
     or has_function_privilege('anon',
       'public.results_exploration_facets(uuid,uuid,text,text,text,text)', 'EXECUTE') then
    raise exception '0037 rollback did not restore the exact public 0036 facets boundary';
  end if;
end $$;
\ir ../migrations/down/0036_map_pba_party_jurisdictions.down.sql
do $$ begin
  if results_exploration_party_jurisdiction(
       'pba/2025-distrito-027', 2025, 'provinciales',
       'DIPUTADOS PROVINCIALES', '02', '027') is not null
     or results_exploration_party_jurisdiction(
       'national/2023-generales', 2023, 'generales', 'PRESIDENTE', '02', '027')
       is distinct from 'national' then
    raise exception '0036 rollback did not restore the exact pre-PBA party boundary';
  end if;
end $$;
\ir ../migrations/down/0035_reject_partial_pba_district_totals.down.sql
do $$ begin
  if to_regprocedure('public.results_exploration_official_0035(uuid,uuid,text,text,text,text,integer,text)') is not null
     or to_regprocedure('public.results_exploration_official_wrapper_0034(uuid,uuid,text,text,text,text,integer,text)') is not null
     or to_regprocedure('public.results_exploration_official_0034(uuid,uuid,text,text,text,text,integer,text)') is null
     or to_regprocedure('public.results_exploration_official_wrapper_0033(uuid,uuid,text,text,text,text,integer,text)') is null then
    raise exception '0035 rollback did not restore the exact 0034 RPC state';
  end if;
end $$;
\ir ../migrations/down/0034_optimize_results_exploration_shape_identity.down.sql
do $$ begin
  if to_regprocedure('public.results_exploration_official_0034(uuid,uuid,text,text,text,text,integer,text)') is not null
     or to_regprocedure('public.results_exploration_official_wrapper_0033(uuid,uuid,text,text,text,text,integer,text)') is not null
     or to_regprocedure('public.results_exploration_official_0033(uuid,uuid,text,text,text,text,integer,text)') is null
     or to_regprocedure('public.results_exploration_official_wrapper_0032(uuid,uuid,text,text,text,text,integer,text)') is null then
    raise exception '0034 rollback did not restore the exact 0033 RPC state';
  end if;
end $$;
\ir ../migrations/down/0033_optimize_results_exploration_district_metadata.down.sql
do $$ begin
  if to_regprocedure('public.results_exploration_official_0033(uuid,uuid,text,text,text,text,integer,text)') is not null
     or to_regprocedure('public.results_exploration_official_wrapper_0032(uuid,uuid,text,text,text,text,integer,text)') is not null
     or to_regprocedure('public.results_exploration_official_0032(uuid,uuid,text,text,text,text,integer,text)') is null
     or to_regprocedure('public.results_exploration_official_wrapper_0031(uuid,uuid,text,text,text,text,integer,text)') is null then
    raise exception '0033 rollback did not restore the exact 0032 RPC state';
  end if;
end $$;
\ir ../migrations/down/0032_preaggregate_results_exploration_district.down.sql
do $$ begin
  if to_regprocedure('public.results_exploration_official_0032(uuid,uuid,text,text,text,text,integer,text)') is not null
     or to_regprocedure('public.results_exploration_official_wrapper_0031(uuid,uuid,text,text,text,text,integer,text)') is not null
     or to_regprocedure('public.results_exploration_official_0030(uuid,uuid,text,text,text,text,integer,text)') is null
     or to_regclass('public.result_row_official_district_scope_idx') is null then
    raise exception '0032 rollback did not restore the exact 0031 RPC and index state';
  end if;
end $$;
\ir ../migrations/down/0031_replace_district_covering_index.down.sql
do $$ begin
  if to_regclass('public.result_row_official_district_scope_idx') is not null
     or to_regclass('public.result_row_official_district_geography_idx') is null
     or to_regprocedure('public.results_exploration_official_0030(uuid,uuid,text,text,text,text,integer,text)') is null then
    raise exception '0031 rollback did not restore only the exact 0030 district index';
  end if;
end $$;
\ir ../migrations/down/0030_optimize_results_exploration_district.down.sql
do $$ begin
  if to_regprocedure('public.results_exploration_official_0030(uuid,uuid,text,text,text,text,integer,text)') is not null or to_regclass('public.result_row_official_district_geography_idx') is not null or to_regprocedure('public.results_exploration_official_0029(uuid,uuid,text,text,text,text,integer,text)') is null then
    raise exception '0030 rollback did not restore the 0029 wrapper and remove district objects'; end if;
end $$;
\ir ../migrations/down/0029_optimize_results_exploration_official.down.sql
do $$ begin
  if to_regprocedure('public.results_exploration_official_0029(uuid,uuid,text,text,text,text,integer,text)') is not null
     or to_regprocedure('public.results_exploration_official_0020(uuid,uuid,text,text,text,text,integer,text)') is null then
    raise exception '0029 rollback did not restore the preserved official wrapper';
  end if;
end $$;
\ir ../migrations/down/0028_bound_results_exploration_cold_start.down.sql
do $$
declare facets_definition text;
begin
  select lower(pg_get_functiondef(
    'public.results_exploration_facets(uuid,uuid,text,text,text,text)'::regprocedure
  )) into facets_definition;
  if position('select distinct rr.election_id' in facets_definition) = 0
     or position('from election e' in facets_definition) > 0 then
    raise exception '0028 rollback did not restore the exact 0026 facet discovery plan';
  end if;
end $$;
\ir ../migrations/down/0027_optimize_non_official_source_audit.down.sql
do $$ begin
  if to_regclass('public.result_row_non_official_scope_idx') is not null then
    raise exception '0027 rollback left result_row_non_official_scope_idx installed';
  end if;
  if to_regprocedure('public.results_exploration_facets(uuid,uuid,text,text,text,text)') is null
     or to_regprocedure('public.results_exploration_official(uuid,uuid,text,text,text,text,integer,text)') is null then
    raise exception '0027 rollback changed explorer functions instead of dropping only its index';
  end if;
end $$;
\ir ../migrations/down/0026_scope_mesa_facets_to_establishment.down.sql
do $$
declare
  facets_definition text;
begin
  if to_regprocedure('public.results_exploration_facets(uuid,uuid,text,text,text,text)') is not null
     or to_regprocedure('public.results_exploration_facets(uuid,uuid,text,text,text)') is null then
    raise exception '0026 rollback did not restore the exact optimized five-argument facets definition';
  end if;
  select lower(pg_get_functiondef(
    'public.results_exploration_facets(uuid,uuid,text,text,text)'::regprocedure
  )) into facets_definition;
  if position('with official as (' in facets_definition) > 0
     or position('case when p_election_id is not null then' in facets_definition) = 0 then
    raise exception '0026 rollback did not restore the exact optimized five-argument facets definition';
  end if;
end $$;
\ir ../migrations/down/0025_optimize_results_exploration_facets.down.sql
do $$
declare
  facets_definition text;
begin
  select lower(pg_get_functiondef(
    'public.results_exploration_facets(uuid,uuid,text,text,text)'::regprocedure
  )) into facets_definition;
  if position('with official as (' in facets_definition) = 0
     or position('case when p_election_id is not null then' in facets_definition) > 0 then
    raise exception '0025 rollback did not restore the broad 0020 facets definition';
  end if;
end $$;
\ir ../migrations/down/0023_results_coverage_scope_binding.down.sql
\ir ../migrations/down/0022_results_exploration_scale.down.sql
do $$ begin
  if to_regprocedure('public.results_exploration_schools(uuid,uuid,text,text)') is not null then raise exception '0022 rollback left the school breakdown RPC installed'; end if;
  if to_regprocedure('public.results_exploration_official_0020(uuid,uuid,text,text,text,text,integer,text)') is not null or to_regprocedure('public.results_exploration_official(uuid,uuid,text,text,text,text,integer,text)') is null then raise exception '0022 rollback did not restore the exact 0020 official RPC identity'; end if;
end $$;
\ir ../migrations/down/0021_results_coverage.down.sql
do $$ begin
  if to_regprocedure('public.results_exploration_coverage(uuid,uuid,text,text)') is not null then raise exception '0021 rollback left the coverage RPC installed'; end if;
  if to_regprocedure('public.results_exploration_official(uuid,uuid,text,text,text,text,integer,text)') is null then raise exception '0021 rollback removed a 0020 RPC'; end if;
end $$;
\ir ../migrations/down/0020_results_exploration.down.sql
do $$ begin
  if to_regprocedure('public.results_exploration_official(uuid,uuid,text,text,text,text,integer,text)') is not null or to_regprocedure('public.results_exploration_facets(uuid,uuid,text,text,text)') is not null or to_regclass('public.result_row_exploration_scope_idx') is not null then raise exception '0020 rollback left official exploration objects installed'; end if;
end $$;
\ir ../migrations/0020_results_exploration.sql
\ir ../migrations/0021_results_coverage.sql
\ir ../migrations/0022_results_exploration_scale.sql
\ir ../migrations/0023_results_coverage_scope_binding.sql
\ir ../migrations/0025_optimize_results_exploration_facets.sql
\ir ../migrations/0026_scope_mesa_facets_to_establishment.sql
\ir ../migrations/0027_optimize_non_official_source_audit.sql
\ir ../migrations/0028_bound_results_exploration_cold_start.sql
\ir ../migrations/0029_optimize_results_exploration_official.sql
\ir ../migrations/0030_optimize_results_exploration_district.sql
\ir ../migrations/0031_replace_district_covering_index.sql
\ir ../migrations/0032_preaggregate_results_exploration_district.sql
\ir ../migrations/0033_optimize_results_exploration_district_metadata.sql
\ir ../migrations/0034_optimize_results_exploration_shape_identity.sql
\ir ../migrations/0035_reject_partial_pba_district_totals.sql
\ir ../migrations/0036_map_pba_party_jurisdictions.sql
\ir ../migrations/0037_add_selector_name_canonical_fallback.sql
\ir ../migrations/20260824193650_map_pba_113_party_jurisdictions.sql
\ir ../migrations/20260825144358_organization_workspace_expand.sql
\ir ../migrations/20260825165116_organization_workspace_authorization_facts.sql
do $$
declare
  facets_definition text;
  index_definition text;
begin
      if to_regprocedure('public.results_exploration_facets(uuid,uuid,text,text,text)') is not null
         or to_regprocedure('public.results_exploration_facets(uuid,uuid,text,text,text,text)') is null
         or to_regprocedure('public.results_exploration_facets_0036(uuid,uuid,text,text,text,text)') is null then
        raise exception '0037 forward apply did not preserve the six-argument public/internal facet boundary';
      end if;
      select lower(pg_get_functiondef(
        'public.results_exploration_facets_0036(uuid,uuid,text,text,text,text)'::regprocedure
      )) into facets_definition;
      if position('with official as (' in facets_definition) > 0
         or position('case when p_election_id is not null then' in facets_definition) = 0
         or position('j.establecimiento_code = p_establecimiento_code' in facets_definition) = 0
         or position('from election e' in facets_definition) = 0
         or position('rr.election_id = e.id' in facets_definition) = 0
         or position('from category c' in facets_definition) = 0
         or position('rr.category_id = c.id' in facets_definition) = 0
         or position('select distinct rr.election_id' in facets_definition) > 0 then
        raise exception '0037 did not preserve bounded 0036 six-argument facet discovery';
      end if;
      if has_function_privilege('authenticated',
           'public.results_exploration_facets_0036(uuid,uuid,text,text,text,text)', 'EXECUTE')
         or has_function_privilege('anon',
           'public.results_exploration_facets_0036(uuid,uuid,text,text,text,text)', 'EXECUTE')
         or exists (
           select 1 from pg_proc p
           cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
           where p.oid = 'public.results_exploration_facets_0036(uuid,uuid,text,text,text,text)'::regprocedure
             and acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
         ) then
        raise exception '0037 internal facets base remained directly executable';
      end if;
  if to_regclass('public.result_row_exploration_scope_idx') is null then raise exception 'forward apply omitted result_row_exploration_scope_idx'; end if;
  if to_regclass('public.result_row_non_official_scope_idx') is null then
    raise exception '0027 forward apply omitted result_row_non_official_scope_idx';
  end if;
  if results_exploration_party_jurisdiction(
       'pba/2025-distrito-027', 2025, 'provinciales', 'CONCEJALES', '02', '027')
       is distinct from 'coronel_rosales_municipal'
     or results_exploration_party_jurisdiction(
       'pba/2025-distrito-027', 2025, 'provinciales',
       'DIPUTADOS PROVINCIALES', '02', '027') is distinct from 'pba_provincial'
     or results_exploration_party_jurisdiction(
       'pba/2025-distrito-113', 2025, 'provinciales',
       'SENADORES PROVINCIALES', '02', '113') is distinct from 'pba_provincial'
     or results_exploration_party_jurisdiction(
       'pba/2025-distrito-113', 2025, 'provinciales',
       'CONCEJALES', '02', '113') is distinct from 'tigre_municipal'
     or results_exploration_party_jurisdiction(
       'national/2023-generales', 2023, 'generales', 'PRESIDENTE', '02', '027')
       is distinct from 'national' then
    raise exception 'forward apply omitted an exact party-jurisdiction mapping';
  end if;
  if to_regprocedure('public.results_exploration_official_0035(uuid,uuid,text,text,text,text,integer,text)') is null
     or to_regprocedure('public.results_exploration_official_wrapper_0034(uuid,uuid,text,text,text,text,integer,text)') is null
     or to_regprocedure('public.results_exploration_official_0034(uuid,uuid,text,text,text,text,integer,text)') is null
     or to_regprocedure('public.results_exploration_official_wrapper_0033(uuid,uuid,text,text,text,text,integer,text)') is null
     or to_regprocedure('public.results_exploration_official_0033(uuid,uuid,text,text,text,text,integer,text)') is null
     or to_regprocedure('public.results_exploration_official_wrapper_0032(uuid,uuid,text,text,text,text,integer,text)') is null
     or to_regprocedure('public.results_exploration_official_0032(uuid,uuid,text,text,text,text,integer,text)') is null
     or to_regprocedure('public.results_exploration_official_wrapper_0031(uuid,uuid,text,text,text,text,integer,text)') is null
     or to_regprocedure('public.results_exploration_official_0030(uuid,uuid,text,text,text,text,integer,text)') is null
     or to_regprocedure('public.results_exploration_official_0029(uuid,uuid,text,text,text,text,integer,text)') is null
     or to_regclass('public.result_row_official_district_scope_idx') is null
     or to_regclass('public.result_row_official_district_geography_idx') is not null then
    raise exception '0035 forward apply omitted the PBA-safe district core or preserved history'; end if;
  select lower(pg_get_indexdef('public.result_row_non_official_scope_idx'::regclass))
    into index_definition;
  if position('(election_id, category_id, jurisdiction_id)' in index_definition) = 0
     or position('source_kind is distinct from ''official''::text' in index_definition) = 0 then
    raise exception '0027 forward apply installed the wrong non-official partial-index contract';
  end if;
  select lower(pg_get_indexdef('public.result_row_official_district_scope_idx'::regclass))
    into index_definition;
  if position('(election_id, category_id, jurisdiction_id)' in index_definition) = 0
     or position('include (archive_entry_id, granularity, list_id, votes)' in index_definition) = 0
     or position('source_kind = ''official''::text' in index_definition) = 0 then
    raise exception '0031 forward apply installed the wrong district partial-index contract';
  end if;
  if to_regprocedure('public.results_exploration_official_0020(uuid,uuid,text,text,text,text,integer,text)') is null then raise exception '0022 forward apply omitted the preserved 0020 official RPC'; end if;
  if has_function_privilege('authenticated', 'public.results_exploration_official_0020(uuid,uuid,text,text,text,text,integer,text)', 'EXECUTE') or exists (select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl where p.oid = 'public.results_exploration_official_0020(uuid,uuid,text,text,text,text,integer,text)'::regprocedure and acl.grantee = 0 and acl.privilege_type = 'EXECUTE') then raise exception 'internal 0020 RPC remained directly executable'; end if;
  if has_function_privilege('authenticated', 'public.results_exploration_official_0035(uuid,uuid,text,text,text,text,integer,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.results_exploration_official_0035(uuid,uuid,text,text,text,text,integer,text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.results_exploration_official_wrapper_0034(uuid,uuid,text,text,text,text,integer,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.results_exploration_official_wrapper_0034(uuid,uuid,text,text,text,text,integer,text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.results_exploration_official_0034(uuid,uuid,text,text,text,text,integer,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.results_exploration_official_0034(uuid,uuid,text,text,text,text,integer,text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.results_exploration_official_wrapper_0033(uuid,uuid,text,text,text,text,integer,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.results_exploration_official_wrapper_0033(uuid,uuid,text,text,text,text,integer,text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.results_exploration_official_0033(uuid,uuid,text,text,text,text,integer,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.results_exploration_official_0033(uuid,uuid,text,text,text,text,integer,text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.results_exploration_official_wrapper_0032(uuid,uuid,text,text,text,text,integer,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.results_exploration_official_wrapper_0032(uuid,uuid,text,text,text,text,integer,text)', 'EXECUTE')
     or exists (select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl where p.oid in (
       'public.results_exploration_official_0035(uuid,uuid,text,text,text,text,integer,text)'::regprocedure,
       'public.results_exploration_official_wrapper_0034(uuid,uuid,text,text,text,text,integer,text)'::regprocedure,
       'public.results_exploration_official_0034(uuid,uuid,text,text,text,text,integer,text)'::regprocedure,
       'public.results_exploration_official_wrapper_0033(uuid,uuid,text,text,text,text,integer,text)'::regprocedure,
       'public.results_exploration_official_0033(uuid,uuid,text,text,text,text,integer,text)'::regprocedure,
       'public.results_exploration_official_wrapper_0032(uuid,uuid,text,text,text,text,integer,text)'::regprocedure
     ) and acl.grantee = 0 and acl.privilege_type = 'EXECUTE')
     or has_function_privilege('authenticated', 'public.results_exploration_official_0032(uuid,uuid,text,text,text,text,integer,text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.results_exploration_official_wrapper_0031(uuid,uuid,text,text,text,text,integer,text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.results_exploration_official_0030(uuid,uuid,text,text,text,text,integer,text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.results_exploration_official_0029(uuid,uuid,text,text,text,text,integer,text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.results_exploration_official_0022(uuid,uuid,text,text,text,text,integer,text)', 'EXECUTE') then
    raise exception '0035 internal RPCs remained directly executable'; end if;
  if (select p.proowner <> 'results_exploration_executor'::regrole from pg_proc p
      where p.oid='public.results_exploration_official_0035(uuid,uuid,text,text,text,text,integer,text)'::regprocedure)
     or (select p.proowner <> 'results_exploration_executor'::regrole from pg_proc p
      where p.oid='public.results_exploration_official(uuid,uuid,text,text,text,text,integer,text)'::regprocedure) then
    raise exception '0035 RPC ownership was not preserved'; end if;
  if not has_function_privilege('authenticated', 'public.results_exploration_party_jurisdiction(text,integer,text,text,text,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.results_exploration_party_jurisdiction(text,integer,text,text,text,text)', 'EXECUTE') then
    raise exception '0036 party-jurisdiction ACL was not preserved';
  end if;
  if not has_function_privilege('authenticated', 'public.results_exploration_facets(uuid,uuid,text,text,text,text)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.results_exploration_official(uuid,uuid,text,text,text,text,integer,text)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.results_exploration_coverage(uuid,uuid,text,text)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.results_exploration_schools(uuid,uuid,text,text)', 'EXECUTE') then
    raise exception 'authenticated execute grants were not restored';
  end if;
  if has_function_privilege('anon', 'public.results_exploration_facets(uuid,uuid,text,text,text,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.results_exploration_official(uuid,uuid,text,text,text,text,integer,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.results_exploration_coverage(uuid,uuid,text,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.results_exploration_schools(uuid,uuid,text,text)', 'EXECUTE') then
    raise exception 'anonymous execute remained after forward apply';
  end if;
end $$;
begin;
set local role authenticated;
select results_exploration_facets();
select results_exploration_party_jurisdiction(
  'pba/2025-distrito-027', 2025, 'provinciales', 'DIPUTADOS PROVINCIALES', '02', '027');
select results_exploration_facets('30000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002', '02', '027', null, null);
select results_exploration_official('30000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002', '02', '027');
select results_exploration_coverage('30000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002', '02', '027');
select results_exploration_schools('30000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002', '02', '027');
rollback;
begin;
set local role authenticated;
\set ON_ERROR_STOP off
select results_exploration_official_0020('30000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002', '02', '027');
\set internal_sqlstate :SQLSTATE
rollback;
\set ON_ERROR_STOP on
select :'internal_sqlstate' = '42501' as expected_internal_denial \gset
\if :expected_internal_denial
\else
  \echo 'expected permission denied for function results_exploration_official_0020'
  \quit 1
\endif
begin;
set local role anon;
\set ON_ERROR_STOP off
select results_exploration_facets('30000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002', '02', '027', null, null);
\set facets_sqlstate :SQLSTATE
rollback;
\set ON_ERROR_STOP on
select :'facets_sqlstate' = '42501' as expected_facets_anon_denial \gset
\if :expected_facets_anon_denial
\else
  \echo 'expected permission denied for function results_exploration_facets'
  \quit 1
\endif
begin;
set local role anon;
\set ON_ERROR_STOP off
select results_exploration_coverage('30000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002', '02', '027');
\set caught_sqlstate :SQLSTATE
rollback;
\set ON_ERROR_STOP on
select :'caught_sqlstate' = '42501' as expected_anon_denial \gset
\if :expected_anon_denial
\else
  \echo 'expected permission denied for function results_exploration_coverage'
  \quit 1
\endif
begin;
set local role anon;
\set ON_ERROR_STOP off
select results_exploration_schools('30000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002', '02', '027');
\set schools_sqlstate :SQLSTATE
rollback;
\set ON_ERROR_STOP on
select :'schools_sqlstate' = '42501' as expected_school_anon_denial \gset
\if :expected_school_anon_denial
\else
  \echo 'expected permission denied for function results_exploration_schools'
  \quit 1
\endif
select 'release-proof' as evidence, 40 as migration_inventory_count, '20260825165116-down,20260825144358-down,20260824193650-down,0037-down,0036-down,0035-down,0034-down,0033-down,0032-down,0031-down,0030-down,0029-down,0028-down,0027-down,0026-down,0025-down,0023-down,0022-down,0021-down,0020-down,0020-up,0021-up,0022-up,0023-up,0025-up,0026-up,0027-up,0028-up,0029-up,0030-up,0031-up,0032-up,0033-up,0034-up,0035-up,0036-up,0037-up,20260824193650-up,20260825144358-up,20260825165116-up' as migration_sequence, 'authenticated-execute/anon-denied/internal-denied' as grant_state;
