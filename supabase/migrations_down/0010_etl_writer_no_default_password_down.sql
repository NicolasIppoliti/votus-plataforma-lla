-- 0010_etl_writer_no_default_password_down.sql
-- Rolls back 0010_etl_writer_no_default_password.sql: restores the old
-- (insecure, local-dev-convention) literal password so 0009's original
-- behavior is reproducible if this migration needs to be reverted.
do $$
begin
  if exists (select from pg_roles where rolname = 'etl_writer') then
    alter role etl_writer password 'etl_writer_local_dev_only';
  end if;
end $$;
