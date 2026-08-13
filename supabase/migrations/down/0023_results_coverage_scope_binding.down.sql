-- Restore the exact 0022 successful payload while preserving function identity and ACL.
do $$
declare
  function_oid constant oid := 'results_exploration_coverage(uuid,uuid,text,text)'::regprocedure;
  definition text; restored text; owner_oid oid; function_acl aclitem[];
  augmentation_pattern constant text :=
    $pattern$return result \|\| jsonb_build_object\([[:space:]]*'election_id',[[:space:]]*p_election_id::text,[[:space:]]*'category_id',[[:space:]]*p_category_id::text\);$pattern$;
begin
  select pg_get_functiondef(function_oid), proowner, proacl
    into definition, owner_oid, function_acl from pg_proc where oid = function_oid;
  if (select count(*) from regexp_matches(definition, augmentation_pattern, 'g')) <> 1 then
    raise exception '0023 down expected one coverage scope augmentation';
  end if;
  restored := regexp_replace(definition, augmentation_pattern, 'return result;');
  execute restored;
  if exists (select 1 from pg_proc where oid = function_oid and
      (prosecdef or provolatile <> 's' or proowner <> owner_oid or proacl is distinct from function_acl
       or proconfig is distinct from array['search_path=public, pg_temp'])) then
    raise exception '0023 down changed coverage security invoker, stability, owner, grants or search path';
  end if;
end $$;
