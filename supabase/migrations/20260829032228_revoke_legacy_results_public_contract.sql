begin;

revoke select on table
  public.jurisdiction,
  public.election,
  public.category,
  public.result_row,
  public.jurisdiction_crosswalk,
  public.mesa_crosswalk,
  public.fiscalizacion_mesa_identity,
  public.archive_entry,
  public.party_canonical,
  public.list_identity,
  public.party_mapping,
  public.review_item,
  public.review_item_unresolved_count
from public, anon, authenticated;

do $$
begin
  if to_regrole('service_role') is not null then
    execute 'revoke select on table public.jurisdiction,public.election,public.category,public.result_row,public.jurisdiction_crosswalk,public.mesa_crosswalk,public.fiscalizacion_mesa_identity,public.archive_entry,public.party_canonical,public.list_identity,public.party_mapping,public.review_item,public.review_item_unresolved_count from service_role';
  end if;
end
$$;

drop policy jurisdiction_authenticated_read on public.jurisdiction;
drop policy election_authenticated_read on public.election;
drop policy category_authenticated_read on public.category;
drop policy result_row_authenticated_read on public.result_row;
drop policy jurisdiction_crosswalk_authenticated_read on public.jurisdiction_crosswalk;
drop policy mesa_crosswalk_authenticated_read on public.mesa_crosswalk;
drop policy fiscalizacion_mesa_identity_authenticated_read on public.fiscalizacion_mesa_identity;
drop policy archive_entry_authenticated_read on public.archive_entry;
drop policy party_canonical_authenticated_read on public.party_canonical;
drop policy list_identity_authenticated_read on public.list_identity;
drop policy party_mapping_authenticated_read on public.party_mapping;

grant select on table
  public.jurisdiction,
  public.election,
  public.category,
  public.result_row,
  public.jurisdiction_crosswalk,
  public.mesa_crosswalk,
  public.fiscalizacion_mesa_identity,
  public.archive_entry,
  public.party_canonical,
  public.list_identity,
  public.party_mapping
  to results_exploration_executor;

create policy results_exploration_executor_jurisdiction_select on public.jurisdiction for select to results_exploration_executor using (true);
create policy results_exploration_executor_election_select on public.election for select to results_exploration_executor using (true);
create policy results_exploration_executor_category_select on public.category for select to results_exploration_executor using (true);
create policy results_exploration_executor_result_row_select on public.result_row for select to results_exploration_executor using (true);
create policy results_exploration_executor_jurisdiction_crosswalk_select on public.jurisdiction_crosswalk for select to results_exploration_executor using (true);
create policy results_exploration_executor_mesa_crosswalk_select on public.mesa_crosswalk for select to results_exploration_executor using (true);
create policy results_exploration_executor_fiscalizacion_mesa_identity_select on public.fiscalizacion_mesa_identity for select to results_exploration_executor using (true);
create policy results_exploration_executor_archive_entry_select on public.archive_entry for select to results_exploration_executor using (true);
create policy results_exploration_executor_party_canonical_select on public.party_canonical for select to results_exploration_executor using (true);
create policy results_exploration_executor_list_identity_select on public.list_identity for select to results_exploration_executor using (true);
create policy results_exploration_executor_party_mapping_select on public.party_mapping for select to results_exploration_executor using (true);

revoke execute on function
  public.results_exploration_party_jurisdiction(text,integer,text,text,text,text),
  public.results_exploration_reporting_level(text,text,text,text),
  public.results_exploration_facets(uuid,uuid,text,text,text,text),
  public.results_exploration_official(uuid,uuid,text,text,text,text,integer,text),
  public.results_exploration_coverage(uuid,uuid,text,text),
  public.results_exploration_schools(uuid,uuid,text,text)
from public, anon, authenticated;

grant execute on function
  public.results_exploration_party_jurisdiction(text,integer,text,text,text,text),
  public.results_exploration_reporting_level(text,text,text,text)
  to results_exploration_executor;

do $$
begin
  if to_regrole('service_role') is not null then
    execute 'revoke execute on function public.results_exploration_party_jurisdiction(text,integer,text,text,text,text),public.results_exploration_reporting_level(text,text,text,text),public.results_exploration_facets(uuid,uuid,text,text,text,text),public.results_exploration_official(uuid,uuid,text,text,text,text,integer,text),public.results_exploration_coverage(uuid,uuid,text,text),public.results_exploration_schools(uuid,uuid,text,text) from service_role';
  end if;
end
$$;

commit;
