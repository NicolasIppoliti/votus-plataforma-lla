-- 0031
-- 0030 led its district covering index with jurisdiction_id, which only pays off once a
-- geography scan has already produced the jurisdictions. Every official read reaches
-- result_row with election_id and category_id fixed and the jurisdiction set open, so that
-- order forced a wide scan before the selective columns applied. Leading with the fixed
-- columns lets the same partial covering index answer the scope directly.
--
-- Measured on the scale proof (results_exploration_scale.sql, ~150k official rows): the
-- official_core_scope plan drops to 7 shared blocks against a bound of 20, and both it and
-- district_scope_access choose this index with no planner hints and no result_row seq scan.
begin;
drop index if exists result_row_official_district_geography_idx;
create index if not exists result_row_official_district_scope_idx
  on result_row (election_id, category_id, jurisdiction_id)
  include (archive_entry_id, granularity, list_id, votes)
  where source_kind = 'official';
commit;
