-- 0006_rls_down.sql
-- Rolls back 0006_rls.sql: drops the per-table authenticated-read policy
-- and revokes the SELECT grant, returning every electoral table to
-- default-deny (RLS stays enabled -- that part shipped in 0001-0005 and is
-- not this migration's to undo).

do $$
declare
  electoral_table text;
begin
  foreach electoral_table in array array[
    'jurisdiction', 'election', 'category', 'result_row',
    'jurisdiction_crosswalk', 'mesa_crosswalk', 'fiscalizacion_mesa_identity',
    'archive_entry', 'party_canonical', 'list_identity', 'party_mapping'
  ]
  loop
    execute format(
      'drop policy if exists %I on %I',
      electoral_table || '_authenticated_read', electoral_table
    );
    execute format('revoke select on table %I from authenticated', electoral_table);
  end loop;
end $$;
