-- Preserve the requested level beside the actual normalized row level.
-- Existing rows stay NULL because their original request intent is unknown.
alter table result_row
  add column requested_granularity text,
  add constraint result_row_requested_granularity_check
    check (requested_granularity in (
      'distrito', 'seccion', 'circuito', 'establecimiento', 'mesa'
    ));

comment on column result_row.requested_granularity is
  'Normalized level requested for this row; NULL when historical request intent is unknown.';
