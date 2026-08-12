drop index if exists jurisdiction_exploration_lineage_idx; drop function if exists results_exploration_schools(uuid, uuid, text, text);
drop function if exists results_exploration_official(uuid, uuid, text, text, text, text, integer, text);
revoke execute on function results_exploration_official_0020(uuid, uuid, text, text, text, text, integer, text) from results_exploration_executor;
alter function results_exploration_official_0020(uuid, uuid, text, text, text, text, integer, text) rename to results_exploration_official;
grant execute on function results_exploration_official(uuid, uuid, text, text, text, text, integer, text) to authenticated;
revoke authenticated from results_exploration_executor; drop role results_exploration_executor;
\ir ../0021_results_coverage.sql
