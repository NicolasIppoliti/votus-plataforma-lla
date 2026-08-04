-- Down migration for 0005_party_mapping.sql
drop index if exists party_mapping_canonical_party_id_idx;
drop table if exists party_mapping;
drop table if exists list_identity;
drop table if exists party_canonical;
