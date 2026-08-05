-- 0009_etl_write_grants_down.sql
-- Rolls back 0009_etl_write_grants.sql: revokes etl_writer's DML grants and
-- drops the role. Leaves 0006's authenticated-read policy and anon revoke
-- untouched (not this migration's to undo).

do $$
declare
  electoral_table text;
begin
  foreach electoral_table in array array[
    'jurisdiction', 'election', 'category', 'result_row',
    'jurisdiction_crosswalk', 'mesa_crosswalk', 'fiscalizacion_mesa_identity',
    'archive_entry', 'party_canonical', 'list_identity', 'party_mapping',
    'review_item'
  ]
  loop
    execute format(
      'revoke select, insert, update, delete on table %I from etl_writer',
      electoral_table
    );
  end loop;
end $$;

drop role if exists etl_writer;
