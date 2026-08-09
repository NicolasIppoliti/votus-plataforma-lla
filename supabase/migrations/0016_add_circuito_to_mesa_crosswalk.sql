-- 0016_add_circuito_to_mesa_crosswalk.sql
-- `mesa_crosswalk` is a rebuildable archive-derived projection. Existing rows
-- cannot be assigned a circuito honestly, so this migration reports and clears
-- them before making circuito part of the exact mesa identity.

begin;

do $$
declare
  discarded_rows bigint;
begin
  select count(*) into discarded_rows from mesa_crosswalk;
  raise notice
    'migration 0016: deleting % rebuildable mesa_crosswalk row(s) because circuito cannot be inferred from the existing three-part identity',
    discarded_rows;
  delete from mesa_crosswalk;
end $$;

alter table mesa_crosswalk
  drop constraint mesa_crosswalk_distrito_code_seccion_code_mesa_code_key;

alter table mesa_crosswalk
  add column circuito_code text not null;

alter table mesa_crosswalk
  add constraint mesa_crosswalk_identity_key
  unique (distrito_code, seccion_code, circuito_code, mesa_code);

commit;
