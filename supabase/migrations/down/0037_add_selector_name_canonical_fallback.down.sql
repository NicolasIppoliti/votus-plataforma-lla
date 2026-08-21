begin;

drop function results_exploration_facets(uuid,uuid,text,text,text,text);

alter function results_exploration_facets_0036(uuid,uuid,text,text,text,text)
  rename to results_exploration_facets;

revoke all on function results_exploration_facets(uuid,uuid,text,text,text,text) from public;
revoke all on function results_exploration_facets(uuid,uuid,text,text,text,text) from anon;
grant execute on function results_exploration_facets(uuid,uuid,text,text,text,text) to authenticated;

commit;
