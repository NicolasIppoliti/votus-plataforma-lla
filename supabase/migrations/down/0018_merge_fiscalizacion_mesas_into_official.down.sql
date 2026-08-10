-- Reverts 0018 -- NOT REVERSIBLE via SQL.
--
-- 0018 repoints election-scoped fiscalización `result_row` rows onto official
-- jurisdiction ids and deletes source jurisdictions once they are empty. It
-- deliberately keeps no post-commit map of the removed ids, so recreating the
-- prior split would require inventing identifiers and lineage. The review-item
-- constraint change is inseparable from data written under the new kinds.
--
-- Restore from a database backup taken before 0018 if rollback is required.
do $$
begin
  raise exception
    'migration 0018 is a data reconciliation and is not reversible via SQL -- '
    'restore from a pre-migration backup if rollback is required';
end $$;
