#!/usr/bin/env sh
# set-local-etl-writer-password.sh
# access-control / 14a, task 14.3: the explicit, NON-migration path for
# setting `etl_writer`'s local development password.
#
# `supabase/migrations/0010_etl_writer_no_default_password.sql` clears
# whatever password `0009_etl_write_grants.sql` set, so applying every
# migration end to end (`supabase db reset`) never leaves a usable secret
# behind by itself -- `etl_writer` exists, is LOGIN-capable, but has NO
# password until one is set explicitly. This script is that explicit step
# for local development ONLY: it is never invoked automatically by
# `supabase db reset` / `supabase start` (unlike `supabase/seed.sql`, which
# the Supabase CLI DOES run automatically on every reset -- deliberately
# NOT used for this, so the pgTAP assertion in
# `supabase/tests/rls_write_role.sql` that the literal password is
# rejected stays true immediately after a plain `supabase db reset`).
#
# Run this once after `supabase db reset` / `supabase start` to restore
# the local end-to-end flow (`etl/etl/__main__.py ingest`,
# `spikes/003-first-end-to-end-run.md`):
#
#   ./scripts/set-local-etl-writer-password.sh
#
# The literal value below is the SAME local-development-only convention
# `0009_etl_write_grants.sql` used to hardcode into the migration itself --
# moving it here does not change its sensitivity (it was never usable
# against anything but a developer's own throwaway Docker Postgres, the
# same convention as this project's `postgres`/`postgres` superuser DSN),
# it only stops it from being the DEFAULT every fresh deploy inherits.

set -eu

CONTAINER="${SUPABASE_DB_CONTAINER:-supabase_db_votus-plataforma-lla}"
LOCAL_DEV_PASSWORD="etl_writer_local_dev_only"

docker exec -i "$CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 <<SQL
alter role etl_writer password '${LOCAL_DEV_PASSWORD}';
SQL

echo "etl_writer's local development password is set. Export:"
echo '  export ETL_DATABASE_URL="postgresql://etl_writer:etl_writer_local_dev_only@127.0.0.1:54322/postgres"'
