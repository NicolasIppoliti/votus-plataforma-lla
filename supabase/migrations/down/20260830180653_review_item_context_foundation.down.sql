begin;
do $$
begin
  perform set_config('votus_review_context_down.owner_membership', pg_has_role(current_user, 'workspace_review_ingest_owner', 'SET')::text, true);
  if not pg_has_role(current_user, 'workspace_review_ingest_owner', 'SET') then
    grant workspace_review_ingest_owner to current_user;
  end if;
end $$;
do $$
begin
  if exists (
    select 1 from workspace_private.review_item_context
    where context_state is distinct from 'unknown'
      or unknown_reason is null
      or unknown_reason not in ('historical_unclassified', 'writer_context_not_provided')
  ) then
    raise exception 'review item context rollback refused: unexpected state or reason'
      using errcode = '23514';
  end if;
end $$;
drop trigger review_item_context_after_insert on public.review_item;
set role workspace_review_ingest_owner;
drop function workspace_private.create_unknown_review_item_context();
drop table workspace_private.review_item_context;
reset role;
do $$
begin
  if current_setting('votus_review_context_down.owner_membership', true) = 'false' then
    revoke workspace_review_ingest_owner from current_user;
  end if;
end $$;
commit;
