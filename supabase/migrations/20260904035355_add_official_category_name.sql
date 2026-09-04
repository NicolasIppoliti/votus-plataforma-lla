begin;

alter function public.results_exploration_official(uuid,uuid,text,text,text,text,integer,text)
  rename to results_exploration_official_wrapper_20260904035355;

grant create on schema public to results_exploration_executor;
set role results_exploration_executor;
create function public.results_exploration_official(
  p_election_id uuid,
  p_category_id uuid,
  p_distrito_code text,
  p_seccion_code text default null,
  p_circuito_code text default null,
  p_establecimiento_code text default null,
  p_mesa_code integer default null,
  p_requested_level text default 'seccion'
) returns jsonb
language plpgsql stable security definer
set search_path=public,pg_temp
as $$
declare
  payload jsonb;
  category_name text;
  category_count bigint;
begin
  payload:=results_exploration_official_wrapper_20260904035355(
    p_election_id,p_category_id,p_distrito_code,p_seccion_code,p_circuito_code,
    p_establecimiento_code,p_mesa_code,p_requested_level
  );
  if payload->>'status'<>'ok' then
    return payload;
  end if;

  select count(*)::bigint,min(c.name)
    into category_count,category_name
  from category c
  where c.id=p_category_id
    and length(btrim(c.name))>0;
  if category_count<>1 then
    return jsonb_build_object(
      'status','selection_invalid',
      'reason','selected category has no nonblank authoritative name',
      'counts',jsonb_build_object('invalid_category_name',1),
      'source_exclusions',coalesce(payload->'source_exclusions','[]'::jsonb)
    );
  end if;

  return payload||jsonb_build_object('category_name',category_name);
end
$$;
reset role;
revoke create on schema public from results_exploration_executor;

alter function public.results_exploration_official(uuid,uuid,text,text,text,text,integer,text)
  owner to results_exploration_executor;
revoke all on function public.results_exploration_official(uuid,uuid,text,text,text,text,integer,text)
  from public,anon,authenticated;
do $$
begin
  if to_regrole('service_role') is not null then
    revoke all on function public.results_exploration_official(uuid,uuid,text,text,text,text,integer,text)
      from service_role;
  end if;
end
$$;
grant execute on function public.results_exploration_official(uuid,uuid,text,text,text,text,integer,text)
  to workspace_query_owner;

commit;
