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
  public.party_mapping
  from results_exploration_executor;

drop policy results_exploration_executor_jurisdiction_select on public.jurisdiction;
drop policy results_exploration_executor_election_select on public.election;
drop policy results_exploration_executor_category_select on public.category;
drop policy results_exploration_executor_result_row_select on public.result_row;
drop policy results_exploration_executor_jurisdiction_crosswalk_select on public.jurisdiction_crosswalk;
drop policy results_exploration_executor_mesa_crosswalk_select on public.mesa_crosswalk;
drop policy results_exploration_executor_fiscalizacion_mesa_identity_select on public.fiscalizacion_mesa_identity;
drop policy results_exploration_executor_archive_entry_select on public.archive_entry;
drop policy results_exploration_executor_party_canonical_select on public.party_canonical;
drop policy results_exploration_executor_list_identity_select on public.list_identity;
drop policy results_exploration_executor_party_mapping_select on public.party_mapping;

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
  to authenticated;

create policy jurisdiction_authenticated_read on public.jurisdiction for select to authenticated using (true);
create policy election_authenticated_read on public.election for select to authenticated using (true);
create policy category_authenticated_read on public.category for select to authenticated using (true);
create policy result_row_authenticated_read on public.result_row for select to authenticated using (true);
create policy jurisdiction_crosswalk_authenticated_read on public.jurisdiction_crosswalk for select to authenticated using (true);
create policy mesa_crosswalk_authenticated_read on public.mesa_crosswalk for select to authenticated using (true);
create policy fiscalizacion_mesa_identity_authenticated_read on public.fiscalizacion_mesa_identity for select to authenticated using (true);
create policy archive_entry_authenticated_read on public.archive_entry for select to authenticated using (true);
create policy party_canonical_authenticated_read on public.party_canonical for select to authenticated using (true);
create policy list_identity_authenticated_read on public.list_identity for select to authenticated using (true);
create policy party_mapping_authenticated_read on public.party_mapping for select to authenticated using (true);

revoke execute on function
  public.results_exploration_party_jurisdiction(text,integer,text,text,text,text),
  public.results_exploration_reporting_level(text,text,text,text)
  from results_exploration_executor;

grant execute on function
  public.results_exploration_party_jurisdiction(text,integer,text,text,text,text),
  public.results_exploration_reporting_level(text,text,text,text),
  public.results_exploration_facets(uuid,uuid,text,text,text,text),
  public.results_exploration_official(uuid,uuid,text,text,text,text,integer,text),
  public.results_exploration_coverage(uuid,uuid,text,text),
  public.results_exploration_schools(uuid,uuid,text,text)
  to authenticated;

commit;
