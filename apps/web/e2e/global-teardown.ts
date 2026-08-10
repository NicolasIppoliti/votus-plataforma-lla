import { createClient } from "@supabase/supabase-js";

import { findUserByEmail } from "../src/lib/e2e-fixture-user";
import { assertE2eEnvironment } from "./gate-contract";

/**
 * access-control / 14c, task 14.8: delete the e2e fixture user
 * `e2e/global-setup.ts` seeded, so the local Supabase Auth instance does
 * not accumulate a fixture user per run. Missing environment, lookup errors,
 * an absent fixture, and deletion errors all fail the release gate.
 */
export default async function globalTeardown(): Promise<void> {
  const environment = assertE2eEnvironment(process.env);
  const url = environment.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = environment.SUPABASE_SERVICE_ROLE_KEY;
  const email = environment.VOTUS_E2E_TEST_USER_EMAIL;

  const admin = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data, error: listError } = await admin.auth.admin.listUsers();
  if (listError) {
    throw new Error(`e2e global teardown: failed to list users: ${listError.message}`);
  }

  const fixtureUser = findUserByEmail(data.users, email);
  if (!fixtureUser) {
    throw new Error("e2e global teardown: fixture user is missing; cleanup cannot be proven");
  }

  const { error: deleteError } = await admin.auth.admin.deleteUser(fixtureUser.id);
  if (deleteError) {
    throw new Error(
      `e2e global teardown: failed to delete fixture user ${email}: ${deleteError.message}`,
    );
  }
}
