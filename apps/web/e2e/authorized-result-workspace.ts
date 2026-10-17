import { prepareOrganization } from "./onboarding";
import { createClient } from "@supabase/supabase-js";
import { type Page } from "@playwright/test";
import { assertE2eEnvironment } from "./gate-contract";

/** Same scoped authorization RPC and real workspace switch as the official,
 * comparison, municipal and fiscal journeys. Result seeding is separate. */
export async function withAuthorizedResultWorkspace<T>(page: Page, baseURL: string,
  scope: { distritoCode: string; seccionCode: string }, run: () => Promise<T>): Promise<T> {
  const environment = assertE2eEnvironment(process.env);
  const admin = createClient(environment.NEXT_PUBLIC_SUPABASE_URL, environment.SUPABASE_SERVICE_ROLE_KEY);
  const { data: auth, error: authError } = await admin.auth.admin.listUsers();
  const user = auth?.users.find(candidate => candidate.email?.toLowerCase() === environment.VOTUS_E2E_TEST_USER_EMAIL.toLowerCase());
  if (authError || !user) throw new Error("failed to resolve visual fixture user");
  const { data: fixture, error } = await admin.rpc("e2e_setup_authorized_fiscal_fixture", {
    p_user_id: user.id, p_distrito_code: scope.distritoCode, p_seccion_code: scope.seccionCode,
  });
  if (error || typeof fixture?.organization_id !== "string") throw new Error("failed to authorize visual result fixture");
  let outcome: { value: T } | { error: unknown };
  try {
    await prepareOrganization(page, fixture.organization_id, new URL("/", baseURL).toString());
    outcome = { value: await run() };
  } catch (error) { outcome = { error }; }
  let cleanupError: Error | null = null;
  try {
    const cleanup = await admin.rpc("e2e_cleanup_authorized_fiscal_fixture", { p_fixture: fixture });
    if (cleanup.error || cleanup.data?.cleaned !== true) cleanupError = new Error("visual authorization cleanup failed");
  } catch (error) { cleanupError = error instanceof Error ? error : new Error("visual authorization cleanup failed"); }
  if ("error" in outcome) {
    if (cleanupError) throw new AggregateError([outcome.error, cleanupError], "visual capture and cleanup failed");
    throw outcome.error;
  }
  if (cleanupError) throw cleanupError;
  return outcome.value;
}
