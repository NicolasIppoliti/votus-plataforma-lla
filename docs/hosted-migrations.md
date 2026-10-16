# Hosted migrations

Nothing applies `supabase/migrations` to the hosted database automatically. CI
proves every migration on a disposable stack (apply, roll back, reapply), but the
hosted database only changes when an operator runs the procedure below. Web code
merged to `develop` or `main` can therefore get ahead of the hosted schema: in
October 2026 four migrations stayed unapplied for a day and every analysis page
failed (#593).

A hosted push changes production data and schema. It needs explicit approval for
the exact migration list, and a check that a recent backup exists, before step 3.

## Connection

Use the **direct** Postgres connection string of the hosted project (user
`postgres`, port 5432, not the pooler). Keep it only in your shell or local
untracked env file, never in the repository, an issue, a log or a chat:

```sh
export VOTUS_HOSTED_DB_URL='<direct postgres URL>'
```

## Procedure

1. **Check drift** from the release revision:

   ```sh
   pnpm --dir apps/web db:drift
   ```

   It lists aligned migrations, pending ones (only in the repository) and unknown
   ones (only in the hosted database). Exit codes: 0 aligned, 1 drift, 2 could not
   check. Unknown migrations stop the release: find out where they came from
   before pushing anything.

2. **Dry-run** and compare the list with the pending versions from step 1:

   ```sh
   supabase db push --db-url "$VOTUS_HOSTED_DB_URL" --dry-run
   ```

3. **Push** the same list:

   ```sh
   supabase db push --db-url "$VOTUS_HOSTED_DB_URL"
   ```

   Use `--db-url`, **not** `--linked`. `--linked` connects as the CLI's temporary
   `cli_login_postgres` role, which does not hold ADMIN OPTION on the custom owner
   roles (`workspace_query_owner`, `workspace_context_owner`). Migrations that
   rewrite functions owned by those roles then fail with `no possible grantors`.
   As `postgres` they apply. Each migration runs in its own transaction, so a
   failed one leaves the database unchanged.

4. **Verify**:
   - `pnpm --dir apps/web db:drift` exits 0.
   - Rewritten functions keep their owner, `SECURITY DEFINER`, `search_path`
     and ACL (`pg_proc.proowner`, `prosecdef`, `proconfig`, `proacl`).
   - No temporary bridge role from the migration remains (`pg_roles`), and no
     temporary `CREATE` grant is left on `workspace_api` or `workspace_private`.
   - The deployed pages that depend on the change load for a real user session.

## Rollback

Down coverage is partial: see [`supabase/migrations/down/README.md`](../supabase/migrations/down/README.md)
for which migrations have a reverse file proven by CI's rollback and reapply
step. Where one exists, apply it as `postgres` in reverse order, then mark the
version reverted (`supabase migration repair --db-url "$VOTUS_HOSTED_DB_URL"
--status reverted <version>`). A rollback needs the same explicit approval as a
push. Restoring a backup is the last resort.
