begin;
do $$ declare r text; begin foreach r in array array['workspace_admin_owner','workspace_review_ingest_owner'] loop perform set_config('votus_review_scope.'||r,pg_has_role(current_user,r,'SET')::text,true); if not pg_has_role(current_user,r,'SET') then execute format('grant %I to %I',r,current_user); end if; end loop; end $$;
alter table public.review_item add column tenant_scope_state text not null default 'platform_only';
alter table public.review_item add constraint review_item_tenant_scope_state_check check (tenant_scope_state in ('platform_only','section_scoped'));
grant select,insert,references,trigger on public.review_item to workspace_review_ingest_owner;
revoke insert,update,delete on public.review_item from etl_writer;
create policy workspace_review_ingest_owner_review_select on public.review_item for select to workspace_review_ingest_owner using (true);
create policy workspace_review_ingest_owner_review_insert on public.review_item for insert to workspace_review_ingest_owner with check (true);
set role workspace_admin_owner;
grant select,references on workspace_private.section_scope to workspace_review_ingest_owner;
create policy workspace_review_ingest_owner_section_select on workspace_private.section_scope for select to workspace_review_ingest_owner using (true);
reset role;
grant usage on schema workspace_private to etl_writer;
grant create on schema workspace_private to workspace_review_ingest_owner;
set role workspace_review_ingest_owner;
create table workspace_private.review_item_section_scope(
 review_item_id uuid not null,
 distrito_code text not null,
 seccion_code text not null,
 primary key(review_item_id,distrito_code,seccion_code),
 foreign key (review_item_id) references public.review_item(id) on delete cascade,
 foreign key (distrito_code, seccion_code) references workspace_private.section_scope(distrito_code,seccion_code) on delete restrict
);
create index review_item_section_scope_section_idx on workspace_private.review_item_section_scope(distrito_code,seccion_code,review_item_id);
alter table workspace_private.review_item_section_scope enable row level security;
alter table workspace_private.review_item_section_scope force row level security;
create policy workspace_review_ingest_owner_scope_all on workspace_private.review_item_section_scope for all to workspace_review_ingest_owner using(true) with check(true);
revoke all on workspace_private.review_item_section_scope from public,anon,authenticated,etl_writer;
create function workspace_private.enforce_review_item_scope_state() returns trigger language plpgsql security definer set search_path=pg_catalog,workspace_private,pg_temp as $$
declare item_id uuid; state text; has_scope boolean;
begin
 if tg_table_name='review_item' then item_id:=case when tg_op='DELETE' then old.id else new.id end; else item_id:=case when tg_op='DELETE' then old.review_item_id else new.review_item_id end; end if;
 select tenant_scope_state into state from public.review_item where id=item_id;
 if not found then if tg_op='DELETE' then return old; else return new; end if; end if;
 select exists(select 1 from workspace_private.review_item_section_scope where review_item_id=item_id) into has_scope;
 if (state='section_scoped') is distinct from has_scope then raise exception 'review item scope state does not match its exact structured scope' using errcode='23514'; end if;
 if tg_op='DELETE' then return old; else return new; end if;
end $$;
create function workspace_private.record_review_item(p_kind text,p_severity text,p_subject_ref text,p_note text,p_distrito_codes text[],p_seccion_codes text[]) returns boolean language plpgsql security definer set search_path=pg_catalog,workspace_private,pg_temp as $$
declare scope_count integer; distinct_count integer; state text; item_id uuid;
begin
 if p_distrito_codes is null or p_seccion_codes is null or coalesce(array_ndims(p_distrito_codes),1)<>1 or coalesce(array_ndims(p_seccion_codes),1)<>1 or cardinality(p_distrito_codes)<>cardinality(p_seccion_codes) then raise exception 'review scope arrays must be aligned one-dimensional arrays' using errcode='23514'; end if;
 select count(*),count(distinct (distrito,seccion)) into scope_count,distinct_count from unnest(p_distrito_codes,p_seccion_codes) as requested(distrito,seccion);
 if scope_count<>distinct_count or exists(select 1 from unnest(p_distrito_codes,p_seccion_codes) requested(distrito,seccion) where distrito!~'^[0-9]{2}$' or seccion!~'^[0-9]{3}$') then raise exception 'review scope must contain unique exact canonical sections' using errcode='23514'; end if;
 if exists(select 1 from unnest(p_distrito_codes,p_seccion_codes) requested(distrito,seccion) where not exists(select 1 from workspace_private.section_scope registered where registered.distrito_code=requested.distrito and registered.seccion_code=requested.seccion)) then raise exception 'review scope is not registered' using errcode='23503'; end if;
 state:=case when scope_count=0 then 'platform_only' else 'section_scoped' end;
 perform pg_catalog.pg_advisory_xact_lock(2963544934623095067);
 select candidate.id into item_id from public.review_item candidate where candidate.resolved_at is null and candidate.kind=p_kind and candidate.severity=p_severity and candidate.subject_ref=p_subject_ref and candidate.note is not distinct from p_note and candidate.tenant_scope_state=state and (select count(*) from workspace_private.review_item_section_scope existing where existing.review_item_id=candidate.id)=scope_count and not exists(select 1 from workspace_private.review_item_section_scope existing where existing.review_item_id=candidate.id and not exists(select 1 from unnest(p_distrito_codes,p_seccion_codes) requested(distrito,seccion) where requested.distrito=existing.distrito_code and requested.seccion=existing.seccion_code)) limit 1;
 if found then return false; end if;
 insert into public.review_item(kind,severity,subject_ref,note,tenant_scope_state) values(p_kind,p_severity,p_subject_ref,p_note,state) returning id into item_id;
 insert into workspace_private.review_item_section_scope(review_item_id,distrito_code,seccion_code) select item_id,distrito,seccion from unnest(p_distrito_codes,p_seccion_codes) requested(distrito,seccion);
 return true;
end $$;
alter table workspace_private.review_item_section_scope owner to workspace_review_ingest_owner;
create constraint trigger review_item_scope_state_on_item after insert or update of tenant_scope_state on public.review_item deferrable initially deferred for each row execute function workspace_private.enforce_review_item_scope_state();
create constraint trigger review_item_scope_state_on_scope after insert or update or delete on workspace_private.review_item_section_scope deferrable initially deferred for each row execute function workspace_private.enforce_review_item_scope_state();
revoke all on function workspace_private.enforce_review_item_scope_state(),workspace_private.record_review_item(text,text,text,text,text[],text[]) from public,anon,authenticated;
do $$ begin if to_regrole('service_role') is not null then revoke all on workspace_private.review_item_section_scope from service_role; revoke all on function workspace_private.enforce_review_item_scope_state(),workspace_private.record_review_item(text,text,text,text,text[],text[]) from service_role; end if; end $$;
grant execute on function workspace_private.record_review_item(text,text,text,text,text[],text[]) to etl_writer;
reset role;
revoke create on schema workspace_private from workspace_review_ingest_owner;
do $$ declare r text; begin foreach r in array array['workspace_review_ingest_owner','workspace_admin_owner'] loop if current_setting('votus_review_scope.'||r,true)='false' then execute format('revoke %I from %I',r,current_user); end if; end loop; end $$;
commit;
