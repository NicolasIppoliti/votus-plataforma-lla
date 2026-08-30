begin;
do $$ begin perform set_config('votus_platform_review_down.admin',pg_has_role(current_user,'workspace_admin_owner','SET')::text,true); if not pg_has_role(current_user,'workspace_admin_owner','SET') then grant workspace_admin_owner to current_user; end if; end $$;
drop policy workspace_admin_owner_platform_review_select on public.review_item; drop index public.review_item_platform_unresolved_idx;
grant create on schema workspace_private to workspace_admin_owner; set role workspace_admin_owner; drop function workspace_private.platform_review_items(integer,integer); reset role; revoke create on schema workspace_private from workspace_admin_owner;
revoke select on public.review_item from workspace_admin_owner;
grant select on public.review_item,public.review_item_unresolved_count to authenticated;
create policy review_item_authenticated_read on public.review_item for select to authenticated using(workspace_private.review_item_is_authorized(id));
do $$ begin if current_setting('votus_platform_review_down.admin',true)='false' then revoke workspace_admin_owner from current_user; end if; end $$;
commit;
