-- Reverts 0008: narrows the natural key back to the migration-0002 shape.
-- Only safe while no archive entry holds more than one election; otherwise the
-- narrower key will reject existing rows as duplicates.
alter table result_row drop constraint if exists result_row_natural_key;

alter table result_row
  add constraint result_row_archive_entry_id_jurisdiction_id_category_id_li_key unique (
    archive_entry_id, jurisdiction_id, category_id, list_id, source_kind
  );
