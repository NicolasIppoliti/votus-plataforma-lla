begin;

grant select on public.party_mapping, public.party_canonical to workspace_query_owner;

create policy workspace_query_owner_party_mapping_select
  on public.party_mapping
  for select
  to workspace_query_owner
  using (true);

create policy workspace_query_owner_party_canonical_select
  on public.party_canonical
  for select
  to workspace_query_owner
  using (true);

commit;
