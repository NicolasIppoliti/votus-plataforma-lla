import { createClient } from "@supabase/supabase-js";

import { findUserByEmail } from "../src/lib/e2e-fixture-user";

/**
 * access-control / 14c, task 14.8: delete the e2e fixture user
 * `e2e/global-setup.ts` seeded, so the local Supabase Auth instance does
 * not accumulate a fixture user per run. A no-op when the required
 * environment variables are absent (mirrors `global-setup.ts`) or when no
 * matching user is found (setup itself was skipped, or already ran).
 */
export default async function globalTeardown(): Promise<void> {
  const url = process.env["NEXT_PUBLIC_SUPABASE_URL"];
  const serviceRoleKey = process.env["SUPABASE_SERVICE_ROLE_KEY"];
  const email = process.env["VOTUS_E2E_TEST_USER_EMAIL"];

  if (!url || !serviceRoleKey || !email) {
    return;
  }

  const admin = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data, error: listError } = await admin.auth.admin.listUsers();
  if (listError) {
    throw new Error(`e2e global teardown: failed to list users: ${listError.message}`);
  }

  const fixtureUser = findUserByEmail(data.users, email);
  if (!fixtureUser) {
    return;
  }

  const { error: deleteError } = await admin.auth.admin.deleteUser(fixtureUser.id);
  if (deleteError) {
    throw new Error(
      `e2e global teardown: failed to delete fixture user ${email}: ${deleteError.message}`,
    );
  }
}
