begin;
-- Historical projections contain positive evidence only; a default labels that
-- evidence without inventing non-positive zeroes. Reparse archives to backfill.
alter table public.result_row add column vote_kind text not null default 'POSITIVO'
 check (vote_kind in ('POSITIVO','EN BLANCO','NULO','IMPUGNADO','RECURRIDO','COMANDO'));
alter table public.result_row add constraint result_row_non_positive_identity
 check (vote_kind = 'POSITIVO' or (list_id is null and source_kind = 'official'));
alter table public.result_row drop constraint result_row_natural_key;
alter table public.result_row add constraint result_row_natural_key
 unique nulls not distinct (archive_entry_id,election_id,jurisdiction_id,category_id,list_id,source_kind,vote_kind);

-- The positive-only readers must evaluate vote_kind without fetching each fact
-- from the heap. Keep the scope-first key and source predicate (also used by
-- source-audit replicas), adding the discriminator to the covering payload.
-- A positive-only partial predicate would make unfiltered scope reads lose this
-- access path, so do not replace the existing source-kind predicate.
drop index public.result_row_official_district_scope_idx;
create index result_row_official_district_scope_idx
 on public.result_row (election_id, category_id, jurisdiction_id)
 include (archive_entry_id, granularity, list_id, votes, vote_kind)
 where source_kind = 'official';

-- Amend the deployed read functions, including the historical implementations
-- reached by the exploration wrappers. Inline subqueries preserve each caller's
-- existing RLS/security-definer boundary and all existing source-kind predicates.
-- No view owner, alternate policy, or public access path is introduced.
-- CREATE OR REPLACE preserves function OIDs, owners and ACLs. The exact inserted
-- expression is reversed by down; no old migration file is edited.
do $migration$
declare f record; definition text; owner_name text; had_create boolean; had_set boolean;
begin
 for f in
  select p.oid, p.proowner, n.nspname
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where ((n.nspname='public' and p.proname like 'results_exploration_%')
      or n.nspname='workspace_api')
    and p.prokind='f' and p.prosrc ~* '(from|join)\s+(public\.)?result_row\M'
 loop
  definition:=regexp_replace(pg_get_functiondef(f.oid),
   '(from|join)\s+(public\.)?result_row\M',
   '\1 (select * from public.result_row where vote_kind = ''POSITIVO'')','gi');
  owner_name:=pg_get_userbyid(f.proowner);
  had_create:=has_schema_privilege(owner_name,f.nspname,'CREATE');
  had_set:=pg_has_role(current_user,owner_name,'SET');
  if not had_set then execute format('grant %I to %I',owner_name,current_user); end if;
  if not had_create then execute format('grant create on schema %I to %I',f.nspname,owner_name); end if;
  execute format('set local role %I',owner_name);
  execute definition;
  reset role;
  if not had_create then execute format('revoke create on schema %I from %I',f.nspname,owner_name); end if;
  if not had_set then execute format('revoke %I from %I',owner_name,current_user); end if;
 end loop;
end $migration$;

-- Reuse the existing authorized Internas envelope. Only its non-positive field
-- changes; parent/list totals still read the explicitly positive-filtered rows.
-- Missing kinds are unavailable, not zero: historical data needs a reload.
do $migration$
declare definition text; had_set boolean; had_create boolean;
begin
 definition:=pg_get_functiondef('workspace_api.official_internal_lists(uuid,uuid,text,text)'::regprocedure);
 definition:=replace(definition,
  'jsonb_build_object(''status'',''unavailable'',''reason'',''not_persisted_by_national_ingestion'')',
  $expression$(select case
   when bool_or(rows<>mesas) then jsonb_build_object('status','unavailable','reason','conflicting_non_positive_identity')
   when count(*)<>5 or min(mesas)<>(
    select count(distinct r.jurisdiction_id) from public.result_row r
    join public.jurisdiction j on j.id=r.jurisdiction_id
    where r.election_id=p_election_id and r.category_id=p_category_id
     and r.source_kind='official' and j.distrito_code=p_distrito_code and j.seccion_code=p_seccion_code
   ) then jsonb_build_object('status','unavailable','reason','not_reloaded')
   else jsonb_build_object('status','available','totals',jsonb_object_agg(vote_kind,votes)) end
   from (select rr.vote_kind,sum(rr.votes)::bigint votes,count(*) rows,
     count(distinct rr.jurisdiction_id) mesas
    from public.result_row rr join public.jurisdiction j on j.id=rr.jurisdiction_id
    where rr.election_id=p_election_id and rr.category_id=p_category_id
     and rr.source_kind='official' and rr.vote_kind<>'POSITIVO'
     and j.distrito_code=p_distrito_code and j.seccion_code=p_seccion_code
    group by rr.vote_kind) kinds)$expression$);
 if position('not_persisted_by_national_ingestion' in definition)>0 then
  raise exception 'could not replace Internas non-positive marker';
 end if;
 had_set:=pg_has_role(current_user,'workspace_query_owner','SET');
 had_create:=has_schema_privilege('workspace_query_owner','workspace_api','CREATE');
 if not had_set then grant workspace_query_owner to current_user; end if;
 if not had_create then grant create on schema workspace_api to workspace_query_owner; end if;
 set local role workspace_query_owner;
 execute definition;
 reset role;
 if not had_create then revoke create on schema workspace_api from workspace_query_owner; end if;
 if not had_set then revoke workspace_query_owner from current_user; end if;
end $migration$;
commit;
