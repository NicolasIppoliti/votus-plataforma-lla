begin;

do $$
declare
  incompatible_rows bigint;
begin
  select count(*)
    into incompatible_rows
    from review_item
   where kind = any (array[
     'ambiguous_official_mesa_identity',
     'pba_conflicting_duplicate_semantic_result',
     'pba_exact_duplicate_semantic_result',
     'pba_unreadable_vote_cell'
   ]);

  if incompatible_rows > 0 then
    raise exception
      '0024 down refused: % 0024-only review_item row(s) exist; resolve or delete those rows before rollback',
      incompatible_rows;
  end if;
end $$;

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
    'unreadable_vote_cell'
  ])
);

commit;
