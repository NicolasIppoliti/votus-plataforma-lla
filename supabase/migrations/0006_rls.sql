-- 0006_rls.sql
-- access-control spec: authenticated-role read access, single role, no
-- anonymous tier (D7's "no privilege flags" access model, task 8.4).
--
-- RLS was already ENABLED on every electoral table when each was created
-- (0001-0005), with no policy -- default-deny, so nothing has ever been
-- readable via the Data API. This migration is what makes `authenticated`
-- able to read, and makes the invariant that `anon` cannot self-documenting
-- and regression-proof rather than an implicit absence:
--
--   1. GRANT SELECT to `authenticated` (the only role this project ever
--      creates policies for -- viewer/curator roles are an explicit
--      non-goal per specs/access-control/spec.md) plus one permissive
--      `USING (true)` policy per table: any authenticated user has
--      identical access to every in-scope table, matching the "Single
--      authenticated role" requirement's own scenario.
--   2. Explicit `REVOKE ALL ... FROM anon` on every table. Locally this is
--      currently a no-op (the CLI's `auto_expose_new_tables` default never
--      granted `anon` anything -- see `supabase/tests/rls_anonymous_denied.sql`,
--      which already passes against migrations 0001-0005 alone), but a
--      cloud project or a future CLI default change could differ, and
--      writing/loading is always done by the ETL through the `service_role`
--      (or `postgres`) connection, which bypasses RLS entirely and needs no
--      grant here at all. Making the revoke explicit means this migration's
--      own diff is the security control, not an implicit platform default.
--
-- Only SELECT is granted -- this change's UI is read-only (Next.js RSC,
-- "server-only reads" per design.md's Data Flow); all writes go through the
-- ETL's `service_role`/`postgres` connection (`etl/etl/db.py`, D8), which
-- bypasses RLS and needs no policy or grant here.

do $$
declare
  electoral_table text;
begin
  foreach electoral_table in array array[
    'jurisdiction', 'election', 'category', 'result_row',
    'jurisdiction_crosswalk', 'mesa_crosswalk', 'fiscalizacion_mesa_identity',
    'archive_entry', 'party_canonical', 'list_identity', 'party_mapping'
  ]
  loop
    execute format('revoke all on table %I from anon', electoral_table);
    execute format('grant select on table %I to authenticated', electoral_table);
    execute format(
      'create policy %I on %I for select to authenticated using (true)',
      electoral_table || '_authenticated_read', electoral_table
    );
  end loop;
end $$;
