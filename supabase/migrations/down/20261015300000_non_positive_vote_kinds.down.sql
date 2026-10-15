begin;
-- Never erase evidence as an incidental downgrade. Export/recovery of loaded
-- non-positive evidence requires a separately authorized plan.
do $$ begin
 if exists(select 1 from public.result_row where vote_kind<>'POSITIVO') then
  raise exception 'cannot downgrade while non-positive vote evidence is persisted';
 end if;
end $$;
do $migration$
declare f record; definition text; owner_name text; had_set boolean; had_create boolean;
begin
 for f in
  select p.oid,p.proowner,n.nspname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where ((n.nspname='public' and p.proname like 'results_exploration_%') or n.nspname='workspace_api')
   and p.prokind='f' and p.prosrc like '%vote_kind%'
 loop
  definition:=pg_get_functiondef(f.oid);
  if f.oid='workspace_api.official_internal_lists(uuid,uuid,text,text)'::regprocedure then
   definition:=replace(definition,
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
    group by rr.vote_kind) kinds)$expression$,
    'jsonb_build_object(''status'',''unavailable'',''reason'',''not_persisted_by_national_ingestion'')');
  end if;
  definition:=replace(definition,
   '(select * from public.result_row where vote_kind = ''POSITIVO'')','public.result_row');
  if position('vote_kind' in definition)>0 then raise exception 'cannot reverse vote-kind function %',f.oid::regprocedure; end if;
  owner_name:=pg_get_userbyid(f.proowner);
  had_set:=pg_has_role(current_user,owner_name,'SET');
  had_create:=has_schema_privilege(owner_name,f.nspname,'CREATE');
  if not had_set then execute format('grant %I to %I',owner_name,current_user); end if;
  if not had_create then execute format('grant create on schema %I to %I',f.nspname,owner_name); end if;
  execute format('set local role %I',owner_name);
  execute definition;
  reset role;
  if not had_create then execute format('revoke create on schema %I from %I',f.nspname,owner_name); end if;
  if not had_set then execute format('revoke %I from %I',owner_name,current_user); end if;
 end loop;
end $migration$;
alter table public.result_row drop constraint result_row_natural_key;
alter table public.result_row drop constraint result_row_non_positive_identity;
alter table public.result_row drop column vote_kind;
alter table public.result_row add constraint result_row_natural_key
 unique (archive_entry_id,election_id,jurisdiction_id,category_id,list_id,source_kind);
commit;
