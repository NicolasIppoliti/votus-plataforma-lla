-- Down migration for 0004_source_kind.sql
drop index if exists archive_entry_source_kind_idx;
drop table if exists archive_entry;
