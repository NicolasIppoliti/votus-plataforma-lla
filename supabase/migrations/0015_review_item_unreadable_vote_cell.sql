-- 0015_review_item_unreadable_vote_cell.sql
-- One new review-queue kind: a vote cell in the fiscalización sheet that
-- carries no readable number.
--
-- `blank_vote_cell` already records an EMPTY cell — missing, explicitly not
-- zero. A cell holding `"1O"` or `"n/d"` is a different fact: someone wrote
-- something and it cannot be read. Both end as `None` in the loaded row, so
-- without two kinds an operator cannot tell "the fiscal left it blank" from
-- "the fiscal wrote something we could not parse" — and only the second is a
-- transcription error a human can go back and fix against the source.
--
-- It is a review item and NOT a quarantine, deliberately. The row is loaded:
-- every readable column of it. Counting it as quarantined made `ingest_source`
-- print it under "not written to result_row", which is false — a plausible
-- withheld-row total whose distribution is wrong.
--
-- The kind list is a check constraint rather than free text for the reason it
-- always has been here: it is what stops a typo becoming an unqueryable
-- bucket that nobody ever reads because nobody knows it exists.

begin;

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
