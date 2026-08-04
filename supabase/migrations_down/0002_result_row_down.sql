-- Down migration for 0002_result_row.sql
drop index if exists result_row_source_kind_election_jurisdiction_idx;
drop table if exists result_row;
