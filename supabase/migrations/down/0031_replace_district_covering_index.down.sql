begin;
drop index if exists result_row_official_district_scope_idx;
create index if not exists result_row_official_district_geography_idx
  on result_row (jurisdiction_id, election_id, category_id)
  include (archive_entry_id, granularity, list_id, votes)
  where source_kind = 'official';
commit;
