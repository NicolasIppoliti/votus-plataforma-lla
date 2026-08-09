-- 0016_add_circuito_to_mesa_crosswalk.down.sql
-- The projection remains rebuildable in either schema. Circuito-bearing rows
-- cannot be collapsed honestly to the old three-part identity, so report and
-- clear them before restoring the prior key.

begin;

do $$
declare
  discarded_rows bigint;
begin
  select count(*) into discarded_rows from mesa_crosswalk;
  raise notice
    'down migration 0016: deleting % rebuildable mesa_crosswalk row(s) before removing circuito identity',
    discarded_rows;
  delete from mesa_crosswalk;
end $$;

alter table mesa_crosswalk
  drop constraint mesa_crosswalk_identity_key;

alter table mesa_crosswalk
  drop column circuito_code;

alter table mesa_crosswalk
  add constraint mesa_crosswalk_distrito_code_seccion_code_mesa_code_key
  unique (distrito_code, seccion_code, mesa_code);

commit;
