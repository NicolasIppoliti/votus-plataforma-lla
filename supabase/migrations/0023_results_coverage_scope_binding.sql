-- Bind every successful coverage payload to the requested election/category without
-- duplicating the immutable 0022 aggregation. CREATE OR REPLACE preserves owner and ACL.
do $$
declare
  function_oid constant oid := 'results_exploration_coverage(uuid,uuid,text,text)'::regprocedure;
  definition text; patched text; owner_oid oid; function_acl aclitem[];
begin
  select pg_get_functiondef(function_oid), proowner, proacl
    into definition, owner_oid, function_acl from pg_proc where oid = function_oid;
  if (length(definition) - length(replace(definition, 'return result;', '')))
       / length('return result;') <> 1 then
    raise exception '0023 expected one successful coverage return boundary';
  end if;
  patched := replace(definition, 'return result;',
    $patch$return result || jsonb_build_object(
      'election_id', p_election_id::text, 'category_id', p_category_id::text);$patch$);
  execute patched;
  if exists (select 1 from pg_proc where oid = function_oid and
      (prosecdef or provolatile <> 's' or proowner <> owner_oid or proacl is distinct from function_acl
       or proconfig is distinct from array['search_path=public, pg_temp'])) then
    raise exception '0023 changed coverage security invoker, stability, owner, grants or search path';
  end if;
end $$;
