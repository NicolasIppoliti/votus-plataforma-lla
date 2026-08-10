-- 0017_repair_jurisdiction_reconciliation.down.sql
-- This migration is intentionally not reversible. It performs a data merge:
-- result rows are repointed and duplicate jurisdiction identities are removed.
-- The prior identities cannot be reconstructed without inventing provenance.

do $$
begin
  raise exception
    'migration 0017 is not reversible: its data merge removed duplicate jurisdiction '
    'identities, and reconstructing them would require guessing historical provenance';
end $$;
