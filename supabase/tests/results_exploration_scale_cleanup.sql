\set ON_ERROR_STOP on
SET statement_timeout='300s';
begin;
do $$ begin
  if exists (select 1 from result_row where election_id::text not like '30000000-%')
     or exists (select 1 from jurisdiction where id::text not like '30000000-%')
     or exists (select 1 from category where id::text not like '30000000-%')
     or exists (select 1 from election where id::text not like '30000000-%')
     or exists (select 1 from party_mapping where canonical_party_id<>'scale-canonical')
     or exists (select 1 from party_canonical where id<>'scale-canonical') then
    raise exception 'scale cleanup refused non-fixture rows';
  end if;
end $$;
truncate table result_row, jurisdiction, category, election, party_mapping, party_canonical;
-- The legacy/null fixture rows are gone, so restore the exact 0002 source-kind contract this
-- proof relaxed. Leaving it dropped would hand every later proof in the same stack a schema
-- whose DB-level source leakage guard is disarmed.
alter table result_row alter column source_kind set not null;
alter table result_row add constraint result_row_source_kind_check
  check (source_kind in ('official', 'fiscalizacion')); commit;
select 'scale fixture cleanup complete' as cleanup_status;
