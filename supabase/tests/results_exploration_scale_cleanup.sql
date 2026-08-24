\set ON_ERROR_STOP on
SET statement_timeout='300s';
begin; delete from result_row where election_id::text like '30000000-%'; delete from jurisdiction where id::text like '30000000-%';
delete from party_mapping where canonical_party_id='scale-canonical';
delete from party_canonical where id='scale-canonical';
delete from category where id::text like '30000000-%'; delete from election where id::text like '30000000-%';
-- The legacy/null fixture rows are gone, so restore the exact 0002 source-kind contract this
-- proof relaxed. Leaving it dropped would hand every later proof in the same stack a schema
-- whose DB-level source leakage guard is disarmed.
alter table result_row alter column source_kind set not null;
alter table result_row add constraint result_row_source_kind_check
  check (source_kind in ('official', 'fiscalizacion')); commit;
select 'scale fixture cleanup complete' as cleanup_status;
