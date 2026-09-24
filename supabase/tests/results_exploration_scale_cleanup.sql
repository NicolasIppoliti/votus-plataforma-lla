\set ON_ERROR_STOP on
SET statement_timeout='300s';
begin;
do $$ begin
  if exists (select 1 from result_row where election_id::text not like '30000000-%')
     or exists (select 1 from jurisdiction where id::text not like '30000000-%')
     or exists (select 1 from category where id::text not like '30000000-%')
     or exists (select 1 from election where id::text not like '30000000-%')
     or exists (
       select 1 from party_mapping m
       where ((m.year=2025 and m.jurisdiction='national'
           and m.category='DIPUTADO NACIONAL' and m.list_id='0'
           and m.canonical_party_id='scale-canonical' and m.verified is true
           and m.source is null)
         or (m.year=2023 and m.jurisdiction='coronel_rosales_municipal'
           and m.category='INTENDENTE' and m.verified is true
           and m.source='archive/national/2023-generales.zip -> 2023_Generales/ResultadoElectorales_2023_Generales.csv (02/027)'
           and (m.list_id,m.canonical_party_id) in (
             ('20132','JXC'),('20134','UP'),('20135','LLA'),('20962','PRIMERO_ROSALES')
           ))) is not true
     )
     or exists (
       select 1 from party_canonical c
       where ((c.id='scale-canonical' and c.display_name='Scale verified party')
          or (c.id,c.display_name) in (
            ('JXC','JUNTOS POR EL CAMBIO'),('UP','UNION POR LA PATRIA'),
            ('LLA','LA LIBERTAD AVANZA'),('PRIMERO_ROSALES','AGRUPACION MUNICIPAL PRIMERO ROSALES')
          )) is not true
     ) then
    raise exception 'scale cleanup refused non-fixture rows';
  end if;
end $$;
do $$ begin if to_regrole('workspace_review_context_migrator') is not null then raise exception 'workspace_review_context_migrator already exists'; end if; end $$;
create role workspace_review_context_migrator nologin noinherit;
grant workspace_review_ingest_owner to workspace_review_context_migrator with inherit false, set true;
grant workspace_review_context_migrator to current_user with inherit false, set true;
lock table public.review_item in share row exclusive mode; set role workspace_review_ingest_owner; lock table workspace_private.review_item_context in share row exclusive mode; do $$ begin if exists(select 1 from workspace_private.review_item_context) then raise exception 'scale cleanup refused review contexts'; end if; end $$;
truncate table workspace_private.review_item_context; reset role;
truncate table result_row, jurisdiction;
delete from party_mapping where canonical_party_id='scale-canonical';
delete from party_canonical where id='scale-canonical';
delete from category; delete from election;
revoke workspace_review_context_migrator from current_user;
revoke workspace_review_ingest_owner from workspace_review_context_migrator;
drop role workspace_review_context_migrator;
do $$ begin if to_regrole('workspace_review_context_migrator') is not null then raise exception 'workspace_review_context_migrator cleanup failed'; end if; end $$;
-- The legacy/null fixture rows are gone, so restore the exact 0002 source-kind contract this
-- proof relaxed. Leaving it dropped would hand every later proof in the same stack a schema
-- whose DB-level source leakage guard is disarmed.
alter table result_row alter column source_kind set not null;
alter table result_row add constraint result_row_source_kind_check
  check (source_kind in ('official', 'fiscalizacion')); commit;
select 'scale fixture cleanup complete' as cleanup_status;
