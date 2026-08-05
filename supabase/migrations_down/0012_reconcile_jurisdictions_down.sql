-- Reverts 0012 -- NOT SAFELY REVERSIBLE in general.
--
-- 0012 is a DATA reconciliation, not a schema change: it deletes emptied
-- duplicate `jurisdiction` rows after repointing `result_row.jurisdiction_id`
-- to the surviving canonical row, and it re-labels every surviving
-- jurisdiction's `distrito_code`/`seccion_code` to the curated, zero-padded
-- (or, for a PBA-scheme row, crosswalk-translated) canonical form. Neither
-- step preserves a log of "which id was deleted" or "what the code used to
-- be" anywhere queryable after COMMIT, so there is no data-driven way to
-- reconstruct the pre-migration state.
--
-- If a rollback is genuinely required, restore from a database backup taken
-- before 0012 was applied. Re-running the FORWARD migration is always safe
-- (idempotent: a second run finds zero duplicate groups and zero surviving
-- rows still needing re-labeling, per its own NOTICE message), but there is
-- deliberately no "undo" query here that would either do nothing useful or,
-- worse, quietly re-fragment the numbering scheme this migration exists to
-- fix.
do $$
begin
  raise exception
    'migration 0012 is a data reconciliation, not reversible via SQL -- '
    'restore from a pre-migration backup if a rollback is genuinely required';
end $$;
