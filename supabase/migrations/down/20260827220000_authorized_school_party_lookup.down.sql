begin;

drop policy workspace_query_owner_party_mapping_select on public.party_mapping;
drop policy workspace_query_owner_party_canonical_select on public.party_canonical;

revoke select on public.party_mapping, public.party_canonical from workspace_query_owner;

commit;
