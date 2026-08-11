drop function if exists results_exploration_official(uuid, uuid, text, text, text, text, integer, text);
drop function if exists results_exploration_facets(uuid, uuid, text, text, text);
drop function if exists results_exploration_party_jurisdiction(text, integer, text, text, text, text);
drop function if exists results_exploration_reporting_level(text, text, text, text);
drop index if exists result_row_exploration_scope_idx;
