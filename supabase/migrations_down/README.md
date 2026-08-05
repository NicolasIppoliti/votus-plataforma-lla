# Down migrations

The Supabase CLI applies every `.sql` file directly under `supabase/migrations/`
as a forward migration, in filename order, during `supabase db start` /
`supabase db reset` / `supabase db push`. It has no concept of a paired "down"
file — a `NNNN_..._down.sql` file living next to its forward migration is
scanned too, and its leading numeric prefix collides with the forward
migration's version, which the CLI rejects as a duplicate `schema_migrations`
primary key (discovered running migrations 0001-0005 for the first time in
Phase 8, `SQLSTATE 23505`).

Down migrations therefore live in this sibling directory instead, one file
per forward migration, so the CLI never auto-applies them. Apply one
manually and deliberately when rolling back a specific migration, e.g.:

```sh
supabase db execute --file supabase/migrations_down/0006_rls_down.sql
```

or via `docker exec`/`psql` directly against the target Postgres instance.
