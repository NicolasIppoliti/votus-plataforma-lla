import { prepareOrganization } from "./onboarding";
import { type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { assertE2eEnvironment } from "./gate-contract";
import { resultScenarioIdentity, scenarioBaseUrl, type ResultScenarioIdentity } from "./scenario-ownership";

const environment = assertE2eEnvironment(process.env);
const identity = resultScenarioIdentity("e2e/comparison.spec.ts");
const baseURL = scenarioBaseUrl("e2e/comparison.spec.ts", environment);
interface WorkspaceFixture { organization_id: string; user_id: string; distrito_code: string; seccion_code: string; extra_seccion_code?: string; }

// Shared with comparison.spec.ts: both elections' sections must be authorized,
// including the left-only section used to determine the common selection.
export async function withAuthorizedComparisonWorkspace<T>(page: Page, run: (revokeAuthorization: () => Promise<void>) => Promise<T>, fixtureIdentity: ResultScenarioIdentity = identity): Promise<T> {
  const admin = createClient(environment.NEXT_PUBLIC_SUPABASE_URL, environment.SUPABASE_SERVICE_ROLE_KEY);
  const { data: users, error: userError } = await admin.auth.admin.listUsers();
  const user = users?.users.find((candidate) => candidate.email?.toLowerCase() === environment.VOTUS_E2E_TEST_USER_EMAIL.toLowerCase());
  if (userError || !user) throw new Error("failed to resolve comparison fixture user");
  const { data, error } = await admin.rpc("e2e_setup_authorized_fiscal_fixture", { p_user_id: user.id, p_distrito_code: fixtureIdentity.distritoCode, p_seccion_code: fixtureIdentity.seccionCode });
  if (error || typeof data?.organization_id !== "string") throw new Error("failed to set up authorized comparison fixture");
  let fixture = data as WorkspaceFixture;
  const leftOnlySection = fixtureIdentity.comparisonLeftOnlySection;
  if (!leftOnlySection) throw new Error("comparison fixture left-only section is missing");
  const extension = await admin.rpc("e2e_extend_authorized_fiscal_fixture", { p_fixture: fixture, p_distrito_code: leftOnlySection.distritoCode, p_seccion_code: leftOnlySection.seccionCode });
  if (extension.error || extension.data?.organization_id !== fixture.organization_id || extension.data?.extra_seccion_code !== leftOnlySection.seccionCode) {
    const cause = new Error("failed to extend authorized comparison fixture");
    const cleanup = await admin.rpc("e2e_cleanup_authorized_fiscal_fixture", { p_fixture: fixture });
    if (cleanup.error || cleanup.data?.cleaned !== true) throw new AggregateError([cause, new Error(cleanup.error?.message ?? "comparison fixture setup cleanup failed")], "comparison fixture setup and cleanup failed");
    throw cause;
  }
  fixture = extension.data as WorkspaceFixture;
  let outcome: { value: T } | { error: unknown }; let cleanupError: Error | null = null;
  try {
    await prepareOrganization(page, fixture.organization_id, new URL("/", baseURL).toString());
    const revokeAuthorization = async (): Promise<void> => { const revoked = await admin.rpc("e2e_revoke_authorized_fiscal_fixture", { p_fixture: fixture }); if (revoked.error || revoked.data?.revoked !== true || revoked.data?.revoked_scope_count !== 2) throw new Error("failed to revoke authorized comparison fixture"); };
    outcome = { value: await run(revokeAuthorization) };
  } catch (caught) { outcome = { error: caught }; }
  finally {
    try {
      const cleanup = await admin.rpc("e2e_cleanup_authorized_fiscal_fixture", { p_fixture: fixture });
      if (cleanup.error || cleanup.data?.cleaned !== true) cleanupError = new Error(cleanup.error?.message ?? "comparison fixture cleanup failed");
    } catch (caught) { cleanupError = caught instanceof Error ? caught : new Error("comparison fixture cleanup failed"); }
  }
  if ("error" in outcome) { if (cleanupError) throw new AggregateError([outcome.error, cleanupError], "comparison assertions and cleanup failed"); throw outcome.error; }
  if (cleanupError) throw cleanupError; return outcome.value;
}
