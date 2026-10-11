begin;
drop function workspace_api.official_internal_lists(uuid,uuid,text,text);
drop policy workspace_query_owner_list_identity_select on public.list_identity;
revoke select on public.list_identity from workspace_query_owner;
commit;
