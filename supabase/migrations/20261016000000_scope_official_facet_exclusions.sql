begin;
-- Unlike the official-only facets index, the audit must also count non-official
-- sources. Index only those sources; an all-source positive index also tempts
-- unrelated election-existence readers into scanning a geography-first index.
-- Official probes reuse result_row_authorized_official_facets_idx.
create index result_row_facet_exclusion_scope_idx
 on public.result_row(jurisdiction_id,election_id,category_id)
 include(source_kind) where vote_kind='POSITIVO' and source_kind is distinct from 'official';

-- CREATE OR REPLACE retains OID, owner, ACL, SECURITY DEFINER and search_path.
-- A temporary membership bridge avoids changing postgres's existing ADMIN-only
-- membership on hosted Supabase (which may have SET FALSE).
do $migration$
declare definition text; first_statement integer; next_statement integer;
 replacement text := $statement$ select count(*) filter(where rr.source_kind is distinct from 'official'),count(*) filter(where rr.source_kind='official' and (j.seccion_code is null or j.circuito_code is null or j.establecimiento_code is null or j.mesa_code is null)) into non_official_total,incomplete_lineage_total
 from (
  -- DISTINCT preserves EXISTS semantics even if a scope pair repeats.
  select j.* from (select distinct distrito_code,seccion_code
   from unnest(scope_districts,scope_sections) s(distrito_code,seccion_code)) scope
  join public.jurisdiction j using(distrito_code,seccion_code)
  where j.seccion_code is not null
  union all
  -- Disjoint from the section branch: coarse rows are visible only when the
  -- already-authorized district selector is present, exactly as before.
  select j.* from public.jurisdiction j
  where j.seccion_code is null and p_distrito_code is not null and j.distrito_code=p_distrito_code
 ) j
 cross join lateral (
  select fact.source_kind from public.result_row fact
  where fact.jurisdiction_id=j.id and fact.vote_kind='POSITIVO' and fact.source_kind='official'
   and (p_election_id is null or fact.election_id=p_election_id)
   and (p_category_id is null or fact.category_id=p_category_id)
  union all
  select fact.source_kind from public.result_row fact
  where fact.jurisdiction_id=j.id and fact.vote_kind='POSITIVO' and fact.source_kind is distinct from 'official'
   and (p_election_id is null or fact.election_id=p_election_id)
   and (p_category_id is null or fact.category_id=p_category_id)
  -- Prevent flattening into a hash join that reads every fact before scoping.
  offset 0
 ) rr
 where (p_distrito_code is null or j.distrito_code=p_distrito_code)
  and (p_seccion_code is null or j.seccion_code=p_seccion_code or j.seccion_code is null)
  and (p_circuito_code is null or j.circuito_code=p_circuito_code)
  and (p_establecimiento_code is null or j.establecimiento_code=p_establecimiento_code);
$statement$;
 had_create boolean; had_set boolean; bridge constant text := 'official_facets_592_migrator';
 runner text := current_user;
begin
 definition:=pg_get_functiondef('workspace_api.official_facets(uuid,uuid,text,text,text,text)'::regprocedure);
 first_statement:=position(' select count(*) filter' in definition);
 next_statement:=position(' exclusions:=' in definition);
 if first_statement=0 or next_statement<=first_statement
  or position('where ((j.seccion_code is not null and exists' in definition)=0 then
  raise exception 'official_facets exclusion statement differs from the expected pre-592 definition';
 end if;
 definition:=substring(definition from 1 for first_statement-1)||replacement||substring(definition from next_statement);
 had_create:=has_schema_privilege('workspace_query_owner','workspace_api','CREATE');
 had_set:=pg_has_role(runner,'workspace_query_owner','SET');
 if not had_set then
  execute format('create role %I nologin',bridge);
  execute format('grant workspace_query_owner to %I with inherit false, set true',bridge);
  execute format('grant %I to %I with inherit false, set true',bridge,runner);
 end if;
 if not had_create then grant create on schema workspace_api to workspace_query_owner; end if;
 set local role workspace_query_owner;
 execute definition;
 reset role;
 if not had_create then revoke create on schema workspace_api from workspace_query_owner; end if;
 if not had_set then
  execute format('revoke %I from %I',bridge,runner);
  execute format('revoke workspace_query_owner from %I',bridge);
  execute format('drop role %I',bridge);
 end if;
end $migration$;
-- The remaining queries already use equality joins from authorized sections or
-- fully selected geography; unlike the audit they have no cross-scope OR/EXISTS.
commit;
