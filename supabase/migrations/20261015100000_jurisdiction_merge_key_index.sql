-- Match etl.db.MERGE_KEY_SQL exactly, including NULL tags and escaping.
-- Keep duplicate persisted lineages visible to the resolver's ambiguity check.
-- Rollout: apply production manually during a maintenance window. Plain CREATE
-- INDEX takes a SHARE lock on jurisdiction: writes block during the build;
-- ordinary reads remain unaffected. The transactional runner retains the lock
-- until commit (including ANALYZE). Duration depends on table size and load;
-- no production build-duration measurement or fixed upper bound is available.
create index jurisdiction_merge_key_idx on public.jurisdiction
((case when distrito_code is null then 'N' else replace(replace('P' || distrito_code::text, '\', '\\'), '|', '\|') end || '|' || case when seccion_code is null then 'N' else replace(replace('P' || seccion_code::text, '\', '\\'), '|', '\|') end || '|' || case when circuito_code is null then 'N' else replace(replace('P' || circuito_code::text, '\', '\\'), '|', '\|') end || '|' || case when establecimiento_code is null then 'N' else replace(replace('P' || establecimiento_code::text, '\', '\\'), '|', '\|') end || '|' || case when mesa_code is null then 'N' else replace(replace('P' || mesa_code::text, '\', '\\'), '|', '\|') end));

-- Collect expression statistics as well as table statistics on existing installs.
analyze public.jurisdiction;
