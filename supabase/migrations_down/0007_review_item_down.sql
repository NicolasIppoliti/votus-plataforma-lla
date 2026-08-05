-- 0007_review_item_down.sql
-- Rolls back 0007_review_item.sql: drops the table (and, transitively, its
-- index, policy, and grant).

drop view if exists review_item_unresolved_count;
drop table if exists review_item;
