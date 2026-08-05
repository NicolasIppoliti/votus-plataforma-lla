import { createClient } from "@supabase/supabase-js";

import { findUserByEmail } from "../src/lib/e2e-fixture-user";

/**
 * access-control / 14c, task 14.8: seed the e2e fixture user reproducibly
 * before the suite runs. `e2e/global-teardown.ts` deletes it afterwards --
 * this pair is the ONLY place any of the four e2e spec files' shared
 * `VOTUS_E2E_TEST_USER_EMAIL`/`VOTUS_E2E_TEST_USER_PASSWORD` credential is
 * created, so no spec file needs its own ad hoc seeding step.
 *
 * "Reproducibly" means: re-running the suite after an interrupted previous
 * run (which may have left the fixture user behind if teardown never ran)
 * must not error on a duplicate email -- `findUserByEmail` finds and
 * removes any stale user with the same email before creating a fresh one.
 *
 * A no-op, not an error, when the required environment variables are
 * absent -- every spec file already skips explicitly in that case (see
 * `apps/web/environment-variables.example.txt`); global setup must not
 * turn "credentials absent" into a hard failure for the WHOLE suite.
 */
export default async function globalSetup(): Promise<void> {
  const url = process.env["NEXT_PUBLIC_SUPABASE_URL"];
  const serviceRoleKey = process.env["SUPABASE_SERVICE_ROLE_KEY"];
  const email = process.env["VOTUS_E2E_TEST_USER_EMAIL"];
  const password = process.env["VOTUS_E2E_TEST_USER_PASSWORD"];

  if (!url || !serviceRoleKey || !email || !password) {
    return;
  }

  const admin = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: existing, error: listError } = await admin.auth.admin.listUsers();
  if (listError) {
    throw new Error(`e2e global setup: failed to list existing users: ${listError.message}`);
  }

  const stale = findUserByEmail(existing.users, email);
  if (stale) {
    const { error: deleteError } = await admin.auth.admin.deleteUser(stale.id);
    if (deleteError) {
      throw new Error(
        `e2e global setup: failed to remove stale fixture user ${email}: ${deleteError.message}`,
      );
    }
  }

  const { error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (createError) {
    throw new Error(`e2e global setup: failed to seed fixture user ${email}: ${createError.message}`);
  }
}
