-- Keep the 0022 official wrapper's exclusion audit selective when official rows
-- dominate an election/category. The predicate deliberately uses IS DISTINCT
-- FROM rather than <> so legacy rows with a null source_kind remain auditable.
create index if not exists result_row_non_official_scope_idx
  on result_row (election_id, category_id, jurisdiction_id)
  where source_kind is distinct from 'official';
