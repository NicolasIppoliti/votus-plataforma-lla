\set ON_ERROR_STOP on
\ir ../migrations/down/20260829032228_revoke_legacy_results_public_contract.down.sql
do $$ begin
  if not has_table_privilege('authenticated','public.jurisdiction','SELECT')
     or not has_table_privilege('authenticated','public.party_mapping','SELECT')
     or has_table_privilege('authenticated','public.review_item','SELECT')
     or not has_function_privilege('authenticated','public.results_exploration_reporting_level(text,text,text,text)','EXECUTE')
     or not has_function_privilege('authenticated','public.results_exploration_official(uuid,uuid,text,text,text,text,integer,text)','EXECUTE')
     or exists(select from pg_policies where schemaname='public' and policyname like 'results_exploration_executor_%')
     or exists(select from unnest(array['anon','service_role']) r where to_regrole(r) is not null and (has_table_privilege(r,'public.jurisdiction','SELECT') or has_function_privilege(r,'public.results_exploration_official(uuid,uuid,text,text,text,text,integer,text)','EXECUTE'))) then
    raise exception 'legacy results cutover rollback did not restore only the authenticated predecessor';
  end if;
end $$;
\ir ../migrations/down/20260827220000_authorized_school_party_lookup.down.sql
do $$ begin if has_table_privilege('workspace_query_owner','public.party_mapping','SELECT') or has_table_privilege('workspace_query_owner','public.party_canonical','SELECT') or exists(select from pg_policies where schemaname='public' and tablename=any(array['party_mapping','party_canonical']) and policyname like 'workspace_query_owner_party_%') then raise exception 'authorized school party lookup rollback did not restore the prior ACL baseline'; end if; end $$;
\ir ../migrations/down/20260827200000_authorized_official_drilldown_facets.down.sql
do $$ begin if to_regprocedure('workspace_api.official_facets(uuid,uuid,text,text,text,text)') is not null or to_regprocedure('workspace_api.official_facets()') is null then raise exception 'authorized drilldown facets rollback did not restore the exact no-argument interface'; end if; end $$;
\ir ../migrations/down/20260827170000_authorized_fiscalizacion_facets.down.sql
\ir ../migrations/down/20260827160000_platform_review_operator_access.down.sql
do $$ begin if to_regprocedure('workspace_private.platform_review_items(integer,integer)') is not null or not has_table_privilege('authenticated','public.review_item','SELECT') or (to_regrole('service_role') is not null and (has_table_privilege('service_role','public.review_item','SELECT') or has_table_privilege('service_role','public.review_item_unresolved_count','SELECT'))) then raise exception 'platform review rollback did not restore the tenant review ACL'; end if; end $$;
\ir ../migrations/down/20260827130000_authorized_fiscal_result.down.sql
do $$ begin if to_regprocedure('workspace_api.fiscalizacion_result(uuid,uuid,text,text,boolean)') is not null then raise exception 'authorized fiscal result rollback left an interface installed'; end if; end $$;
\ir ../migrations/down/20260827112658_authorized_fiscal_coverage.down.sql
do $$ begin if to_regprocedure('workspace_api.fiscalizacion_coverage(uuid,uuid,text,text,boolean)') is not null then raise exception 'authorized coverage rollback left an interface installed'; end if; end $$;
\ir ../migrations/down/20260827040000_authorized_fiscal_review.down.sql
do $$ begin if to_regprocedure('workspace_api.review_items(integer,integer)') is not null or to_regprocedure('workspace_private.review_item_is_authorized(uuid)') is not null then raise exception 'authorized review rollback left an interface installed'; end if; end $$;
\ir ../migrations/down/20260827000000_authorized_official_projections.down.sql
do $$ begin if to_regprocedure('workspace_api.official_schools(uuid,uuid,text,text)') is not null or to_regprocedure('workspace_api.official_reference(uuid,uuid,text,text)') is not null or to_regprocedure('workspace_api.official_provenance(uuid,uuid,text,text)') is not null then raise exception 'authorized projections rollback left an interface installed'; end if; end $$;
\ir ../migrations/down/20260826200000_authorized_official_operations.down.sql
do $$ begin if to_regprocedure('workspace_api.official_result(uuid,uuid,text,text,text,text,integer,text)') is not null or to_regprocedure('workspace_api.official_comparison(uuid,uuid,text,text,text,text,integer,text,uuid,uuid,text,text,text,text,integer,text)') is not null then raise exception 'authorized operations rollback left an interface installed'; end if; end $$;
\ir ../migrations/down/20260826160000_authorized_official_facets.down.sql
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
\ir ../migrations/down/20260826120000_structured_review_scope.down.sql
\ir ../migrations/down/20260826050000_workspace_context_selection.down.sql
\ir ../migrations/down/20260826033130_session_bound_context_invalidation.down.sql
\ir ../migrations/down/20260825180048_organization_workspace_authorization_admin.down.sql
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
\ir ../migrations/20260825180048_organization_workspace_authorization_admin.sql
\ir ../migrations/20260826033130_session_bound_context_invalidation.sql
\ir ../migrations/20260826050000_workspace_context_selection.sql
\ir ../migrations/20260826120000_structured_review_scope.sql
\ir ../migrations/20260826160000_authorized_official_facets.sql
\ir ../migrations/20260826200000_authorized_official_operations.sql
\ir ../migrations/20260827000000_authorized_official_projections.sql
\ir ../migrations/20260827040000_authorized_fiscal_review.sql
\ir ../migrations/20260827112658_authorized_fiscal_coverage.sql
\ir ../migrations/20260827130000_authorized_fiscal_result.sql
\ir ../migrations/20260827160000_platform_review_operator_access.sql
\ir ../migrations/20260827170000_authorized_fiscalizacion_facets.sql
\ir ../migrations/20260827200000_authorized_official_drilldown_facets.sql
\ir ../migrations/20260827220000_authorized_school_party_lookup.sql
do $$
declare
      facets_definition text;
      index_definition text;
    begin
          if not has_table_privilege('workspace_query_owner','public.party_mapping','SELECT') or not has_table_privilege('workspace_query_owner','public.party_canonical','SELECT') or not has_table_privilege('authenticated','public.party_mapping','SELECT') or not has_table_privilege('authenticated','public.party_canonical','SELECT') or exists(select from unnest(array['anon','service_role']) r,unnest(array['party_mapping','party_canonical']) t where to_regrole(r) is not null and has_table_privilege(r,'public.'||t,'SELECT')) or (select count(*)<>2 from pg_policies where schemaname='public' and tablename=any(array['party_mapping','party_canonical']) and cmd='SELECT' and roles=array['workspace_query_owner']::name[] and qual='true' and with_check is null) then raise exception 'authorized school party lookup reapply did not restore the exact closed lookup path'; end if;
          if to_regprocedure('workspace_api.official_facets()') is not null or to_regprocedure('workspace_api.official_facets(uuid,uuid,text,text,text,text)') is null or not has_function_privilege('authenticated','workspace_api.official_facets(uuid,uuid,text,text,text,text)','EXECUTE') or has_function_privilege('anon','workspace_api.official_facets(uuid,uuid,text,text,text,text)','EXECUTE') or (to_regrole('service_role') is not null and has_function_privilege('service_role','workspace_api.official_facets(uuid,uuid,text,text,text,text)','EXECUTE')) then raise exception 'authorized drilldown facets reapply did not restore exact closed interface'; end if;
      if to_regprocedure('workspace_private.platform_review_items(integer,integer)') is null or not has_function_privilege('workspace_platform_admin','workspace_private.platform_review_items(integer,integer)','EXECUTE') or has_table_privilege('authenticated','public.review_item','SELECT') or (to_regrole('service_role') is not null and (has_table_privilege('service_role','public.review_item','SELECT') or has_column_privilege('service_role','public.review_item','id','SELECT'))) then raise exception 'platform review reapply did not restore exact operator-only interface'; end if;
      if to_regprocedure('workspace_api.fiscalizacion_coverage(uuid,uuid,text,text,boolean)') is null or not has_function_privilege('authenticated','workspace_api.fiscalizacion_coverage(uuid,uuid,text,text,boolean)','EXECUTE') or has_function_privilege('anon','workspace_api.fiscalizacion_coverage(uuid,uuid,text,text,boolean)','EXECUTE') or (to_regrole('service_role') is not null and has_function_privilege('service_role','workspace_api.fiscalizacion_coverage(uuid,uuid,text,text,boolean)','EXECUTE')) then raise exception 'authorized coverage reapply did not restore exact closed interface'; end if;
      if to_regprocedure('workspace_api.fiscalizacion_result(uuid,uuid,text,text,boolean)') is null or not has_function_privilege('authenticated','workspace_api.fiscalizacion_result(uuid,uuid,text,text,boolean)','EXECUTE') or has_function_privilege('anon','workspace_api.fiscalizacion_result(uuid,uuid,text,text,boolean)','EXECUTE') or (to_regrole('service_role') is not null and has_function_privilege('service_role','workspace_api.fiscalizacion_result(uuid,uuid,text,text,boolean)','EXECUTE')) then raise exception 'authorized fiscal result reapply did not restore exact closed interface'; end if;
      if to_regprocedure('workspace_api.review_items(integer,integer)') is null or not has_function_privilege('authenticated','workspace_api.review_items(integer,integer)','EXECUTE') or has_function_privilege('anon','workspace_api.review_items(integer,integer)','EXECUTE') or (to_regrole('service_role') is not null and has_function_privilege('service_role','workspace_api.review_items(integer,integer)','EXECUTE')) then raise exception 'authorized review reapply did not restore exact closed interface'; end if;
      if to_regprocedure('workspace_api.official_result(uuid,uuid,text,text,text,text,integer,text)') is null or to_regprocedure('workspace_api.official_comparison(uuid,uuid,text,text,text,text,integer,text,uuid,uuid,text,text,text,text,integer,text)') is null or not has_function_privilege('authenticated','workspace_api.official_result(uuid,uuid,text,text,text,text,integer,text)','EXECUTE') or has_function_privilege('anon','workspace_api.official_result(uuid,uuid,text,text,text,text,integer,text)','EXECUTE') or (to_regrole('service_role') is not null and has_function_privilege('service_role','workspace_api.official_result(uuid,uuid,text,text,text,text,integer,text)','EXECUTE')) then raise exception 'authorized operations reapply did not restore exact closed interfaces'; end if;
      if to_regprocedure('workspace_api.official_schools(uuid,uuid,text,text)') is null or to_regprocedure('workspace_api.official_reference(uuid,uuid,text,text)') is null or to_regprocedure('workspace_api.official_provenance(uuid,uuid,text,text)') is null or not has_function_privilege('authenticated','workspace_api.official_reference(uuid,uuid,text,text)','EXECUTE') or has_function_privilege('anon','workspace_api.official_reference(uuid,uuid,text,text)','EXECUTE') or (to_regrole('service_role') is not null and has_function_privilege('service_role','workspace_api.official_reference(uuid,uuid,text,text)','EXECUTE')) then raise exception 'authorized projections reapply did not restore exact closed interfaces'; end if;
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
\ir ../migrations/20260829032228_revoke_legacy_results_public_contract.sql
do $$ begin
  if exists(select from unnest(array['jurisdiction','election','category','result_row','jurisdiction_crosswalk','mesa_crosswalk','fiscalizacion_mesa_identity','archive_entry','party_canonical','list_identity','party_mapping','review_item','review_item_unresolved_count']) t, unnest(array['anon','authenticated','service_role']) r where to_regrole(r) is not null and has_table_privilege(r,'public.'||t,'SELECT'))
     or exists(select from pg_policies where schemaname='public' and policyname like '%_authenticated_read')
     or exists(select from unnest(array['results_exploration_party_jurisdiction(text,integer,text,text,text,text)','results_exploration_reporting_level(text,text,text,text)','results_exploration_facets(uuid,uuid,text,text,text,text)','results_exploration_official(uuid,uuid,text,text,text,text,integer,text)','results_exploration_coverage(uuid,uuid,text,text)','results_exploration_schools(uuid,uuid,text,text)']) f, unnest(array['anon','authenticated','service_role']) r where to_regrole(r) is not null and has_function_privilege(r,'public.'||f,'EXECUTE')) then
    raise exception 'authenticated legacy public result access survived cutover';
  end if;
  if not has_table_privilege('workspace_query_owner','public.result_row','SELECT')
     or not has_table_privilege('workspace_query_owner','public.party_mapping','SELECT')
     or not has_function_privilege('workspace_query_owner','public.results_exploration_official(uuid,uuid,text,text,text,text,integer,text)','EXECUTE')
     or not has_function_privilege('authenticated','workspace_api.official_result(uuid,uuid,text,text,text,text,integer,text)','EXECUTE')
     or not has_function_privilege('authenticated','workspace_api.official_schools(uuid,uuid,text,text)','EXECUTE') then
    raise exception 'workspace-authorized result access changed during legacy cutover';
  end if;
end $$;
begin;
grant workspace_platform_admin to current_user;
set local role workspace_platform_admin;
\ir ../scripts/workspace_authority_status.sql
rollback;
select 'release-proof' as evidence, 56 as migration_inventory_count, '20260829032228-down,20260827220000-down,20260827200000-down,20260827170000-down,20260827160000-down,20260827130000-down,20260827112658-down,20260827040000-down,20260827000000-down,20260826200000-down,20260826160000-down,20260826120000-down,20260826050000-down,20260826033130-down,20260825180048-down,20260825165116-down,20260825144358-down,20260824193650-down,0037-down,0036-down,0035-down,0034-down,0033-down,0032-down,0031-down,0030-down,0029-down,0028-down,0027-down,0026-down,0025-down,0023-down,0022-down,0021-down,0020-down,0020-up,0021-up,0022-up,0023-up,0025-up,0026-up,0027-up,0028-up,0029-up,0030-up,0031-up,0032-up,0033-up,0034-up,0035-up,0036-up,0037-up,20260824193650-up,20260825144358-up,20260825165116-up,20260825180048-up,20260826033130-up,20260826050000-up,20260826120000-up,20260826160000-up,20260826200000-up,20260827000000-up,20260827040000-up,20260827112658-up,20260827130000-up,20260827160000-up,20260827170000-up,20260827200000-up,20260827220000-up,20260829032228-up' as migration_sequence, 'tenant-rpc/platform-operator-only/direct-review-denied' as grant_state;
