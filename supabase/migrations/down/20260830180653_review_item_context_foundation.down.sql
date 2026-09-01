begin;
do $$ begin if to_regrole('workspace_review_context_foundation_migrator') is not null then raise exception 'workspace_review_context_foundation_migrator already exists'; end if; end $$;
create role workspace_review_context_foundation_migrator nologin noinherit;
grant workspace_review_ingest_owner to workspace_review_context_foundation_migrator with inherit false, set true;
grant workspace_review_context_foundation_migrator to current_user with inherit false, set true;
set role workspace_review_ingest_owner;
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
reset role;
drop trigger review_item_context_after_insert on public.review_item;
set role workspace_review_ingest_owner;
drop function workspace_private.create_unknown_review_item_context();
drop table workspace_private.review_item_context;
reset role;
revoke workspace_review_context_foundation_migrator from current_user;
revoke workspace_review_ingest_owner from workspace_review_context_foundation_migrator;
drop role workspace_review_context_foundation_migrator;
do $$ begin if to_regrole('workspace_review_context_foundation_migrator') is not null then raise exception 'workspace_review_context_foundation_migrator cleanup failed'; end if; end $$;
commit;
