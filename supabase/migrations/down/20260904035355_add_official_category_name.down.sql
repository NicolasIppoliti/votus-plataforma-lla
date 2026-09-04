begin;

drop function public.results_exploration_official(uuid,uuid,text,text,text,text,integer,text);
alter function public.results_exploration_official_wrapper_20260904035355(uuid,uuid,text,text,text,text,integer,text)
  rename to results_exploration_official;

commit;
