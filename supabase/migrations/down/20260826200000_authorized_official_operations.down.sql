begin;
do $$ begin perform set_config('votus_operations_down.workspace_query_owner',pg_has_role(current_user,'workspace_query_owner','SET')::text,true); if not pg_has_role(current_user,'workspace_query_owner','SET') then execute format('grant workspace_query_owner to %I',current_user); end if; end $$;
set role workspace_query_owner;
drop function workspace_api.official_comparison(uuid,uuid,text,text,text,text,integer,text,uuid,uuid,text,text,text,text,integer,text);
drop function workspace_api.official_result(uuid,uuid,text,text,text,text,integer,text);
reset role;
revoke execute on function public.results_exploration_official(uuid,uuid,text,text,text,text,integer,text) from workspace_query_owner;
do $$ begin if current_setting('votus_operations_down.workspace_query_owner',true)='false' then execute format('revoke workspace_query_owner from %I',current_user); end if; end $$;
commit;
