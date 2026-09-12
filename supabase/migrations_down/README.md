# Historical down migrations

This sibling directory is retained for historical migration and OpenSpec
references. Current release proofs use [migrations/down](../migrations/down/README.md).
Neither directory provides complete rollback coverage or a one-command hosted
rollback. Keep existing SQL paths intact; do not move them into the forward inventory.

The Supabase CLI applies every `.sql` file directly under `supabase/migrations/`
as a forward migration, in filename order, during `supabase db start` /
`supabase db reset` / `supabase db push`. It has no concept of a paired "down"
file — a `NNNN_..._down.sql` file living next to its forward migration is
scanned too, and its leading numeric prefix collides with the forward
migration's version, which the CLI rejects as a duplicate `schema_migrations`
primary key (discovered running migrations 0001-0005 for the first time in
Phase 8, `SQLSTATE 23505`).

The historical down scripts were placed in this sibling directory to keep them
out of automatic forward application. This does not imply one down script exists
for every forward migration. For any proposed manual rollback, first read the
[current guidance](../migrations/down/README.md) and the exact migration contract;
verify supported tooling and obtain separate target-specific execution approval.
The old command example is not a supported hosted rollback procedure.
