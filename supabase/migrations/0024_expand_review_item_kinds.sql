begin;

-- Keep review_item.kind queryable as a closed vocabulary while admitting every
-- kind emitted by the production ETL. This is an allowlist expansion only:
-- existing rows and values are left untouched.
alter table review_item drop constraint review_item_kind_check;
alter table review_item add constraint review_item_kind_check check (
  kind = any (array[
    'content_drift',
    'fetch_failure',
    'unmapped_party',
    'unmapped_jurisdiction',
    'mesa_discontinuity',
    'source_reexported',
    'duplicate_collapsed',
    'duplicate_conflict',
    'unmergeable_row',
    'blank_vote_cell',
    'mesa_tally_divergence',
    'ambiguous_mesa_circuito',
    'mesa_absent_from_official_import',
    'unreadable_vote_cell',
    'ambiguous_official_mesa_identity',
    'pba_conflicting_duplicate_semantic_result',
    'pba_exact_duplicate_semantic_result',
    'pba_unreadable_vote_cell'
  ])
);

commit;
