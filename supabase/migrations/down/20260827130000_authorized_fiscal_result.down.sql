begin;
do $$ begin perform set_config('votus_fiscal_result_down.workspace_query_owner',pg_has_role(current_user,'workspace_query_owner','SET')::text,true); if not pg_has_role(current_user,'workspace_query_owner','SET') then execute format('grant workspace_query_owner to %I',current_user); end if; end $$;
set role workspace_query_owner; drop function workspace_api.fiscalizacion_result(uuid,uuid,text,text,boolean); reset role;
drop view workspace_private.fiscal_archive_metadata,workspace_private.fiscal_party_lookup;
revoke execute on function public.results_exploration_party_jurisdiction(text,integer,text,text,text,text) from workspace_query_owner;
do $$ begin if current_setting('votus_fiscal_result_down.workspace_query_owner',true)='false' then execute format('revoke workspace_query_owner from %I',current_user); end if; end $$;
commit;
