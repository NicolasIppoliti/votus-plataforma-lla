begin;

create or replace function results_exploration_party_jurisdiction(
  p_archive_entry_id text,
  p_year integer,
  p_round text,
  p_category text,
  p_distrito_code text,
  p_seccion_code text
) returns text
language sql immutable strict security invoker
set search_path = public, pg_temp
as $$
  select case
    when p_archive_entry_id ~ '^national/2023-'
      and p_year = 2023
      and p_round = 'generales'
      and p_category = 'CONCEJALES'
      and p_distrito_code = '02'
      and p_seccion_code = '027'
      then 'coronel_rosales_municipal'
    when p_archive_entry_id = 'pba/2025-distrito-027'
      and p_year = 2025
      and p_round = 'provinciales'
      and p_category = 'CONCEJALES'
      and p_distrito_code = '02'
      and p_seccion_code = '027'
      then 'coronel_rosales_municipal'
    when p_archive_entry_id = 'pba/2025-distrito-027'
      and p_year = 2025
      and p_round = 'provinciales'
      and p_category = 'DIPUTADOS PROVINCIALES'
      and p_distrito_code = '02'
      and p_seccion_code = '027'
      then 'pba_provincial'
    when p_archive_entry_id = 'pba/2025-distrito-113'
      and p_year = 2025
      and p_round = 'provinciales'
      and p_category = 'SENADORES PROVINCIALES'
      and p_distrito_code = '02'
      and p_seccion_code = '113'
      then 'pba_provincial'
    when p_archive_entry_id = 'pba/2025-distrito-113'
      and p_year = 2025
      and p_round = 'provinciales'
      and p_category = 'CONCEJALES'
      and p_distrito_code = '02'
      and p_seccion_code = '113'
      then 'tigre_municipal'
    when p_archive_entry_id ~ '^national/' then 'national'
    when p_archive_entry_id ~ '^pba/[0-9]{4}-distrito-[0-9]+$' then null
    else null
  end
$$;

revoke execute on function results_exploration_party_jurisdiction(text,integer,text,text,text,text)
  from public, anon, authenticated;
do $$
begin
  if to_regrole('service_role') is not null then
    execute 'revoke execute on function public.results_exploration_party_jurisdiction(text,integer,text,text,text,text) from service_role';
  end if;
end
$$;
grant execute on function results_exploration_party_jurisdiction(text,integer,text,text,text,text)
  to results_exploration_executor;

commit;
