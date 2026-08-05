-- Reverts 0011: drops the `mesa_tipo` column added to `result_row`.
alter table result_row drop column if exists mesa_tipo;
