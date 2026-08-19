begin;
drop function results_exploration_official(uuid,uuid,text,text,text,text,integer,text);
alter function results_exploration_official_wrapper_0029(uuid,uuid,text,text,text,text,integer,text) rename to results_exploration_official;
revoke all on function results_exploration_official(uuid,uuid,text,text,text,text,integer,text) from public,anon; grant execute on function results_exploration_official(uuid,uuid,text,text,text,text,integer,text) to authenticated;
drop function results_exploration_official_0030(uuid,uuid,text,text,text,text,integer,text);
drop index if exists result_row_official_district_geography_idx;
commit;
