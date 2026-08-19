-- Restore the preserved 0022 wrapper and remove only 0029 functions.
begin; drop function results_exploration_official(uuid,uuid,text,text,text,text,integer,text);
alter function results_exploration_official_0022(uuid,uuid,text,text,text,text,integer,text) rename to results_exploration_official;
revoke all on function results_exploration_official(uuid,uuid,text,text,text,text,integer,text) from public, anon;
grant execute on function results_exploration_official(uuid,uuid,text,text,text,text,integer,text) to authenticated;
drop function results_exploration_official_0029(uuid,uuid,text,text,text,text,integer,text); commit;
