import { createClient } from "@supabase/supabase-js";
import { chromium } from "@playwright/test";

import { findUserByEmail } from "../src/lib/e2e-fixture-user";
import { assertE2eEnvironment, assertLoopbackStorageState } from "./gate-contract";

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
 * The release gate owns all credentials. Missing input is a hard failure,
 * never a reason to turn a required scenario into a skip.
 */
export default async function globalSetup(): Promise<void> {
  const environment = assertE2eEnvironment(process.env);
  const url = environment.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = environment.SUPABASE_SERVICE_ROLE_KEY;
  const email = environment.VOTUS_E2E_TEST_USER_EMAIL;
  const password = environment.VOTUS_E2E_TEST_USER_PASSWORD;

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

  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ baseURL: environment.VOTUS_E2E_BASE_URL });
    const page = await context.newPage();
    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
    try {
      await page.waitForURL(/\/dashboard/, { timeout: 10_000 });
    } catch {
      const alert = await page.getByRole("alert").textContent().catch(() => null);
      throw new Error(`e2e global setup: fixture sign-in failed${alert ? `: ${alert}` : ""}`);
    }
    const state = await context.storageState();
    assertLoopbackStorageState(state);
    await context.storageState({ path: environment.VOTUS_E2E_STORAGE_STATE });
  } finally {
    await browser.close();
  }
}
