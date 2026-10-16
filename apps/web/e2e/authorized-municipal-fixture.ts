import { expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { assertE2eEnvironment } from "./gate-contract";
import { scenarioBaseUrl } from "./scenario-ownership";

const environment = assertE2eEnvironment(process.env);
const baseURL = scenarioBaseUrl("e2e/municipal.spec.ts", environment);
interface WorkspaceFixture { organization_id: string; user_id: string; distrito_code: string; seccion_code: string; }

export async function withAuthorizedMunicipalWorkspace<T>(page: Page, run: () => Promise<T>, seccionCode = "027"): Promise<T> {
  const admin = createClient(environment.NEXT_PUBLIC_SUPABASE_URL, environment.SUPABASE_SERVICE_ROLE_KEY);
  const { data: users, error: userError } = await admin.auth.admin.listUsers();
  const user = users?.users.find((candidate) => candidate.email?.toLowerCase() === environment.VOTUS_E2E_TEST_USER_EMAIL.toLowerCase());
  if (userError || !user) throw new Error("failed to resolve municipal fixture user");
  const { data, error } = await admin.rpc("e2e_setup_authorized_fiscal_fixture", { p_user_id: user.id, p_distrito_code: "02", p_seccion_code: seccionCode });
  if (error || typeof data?.organization_id !== "string") throw new Error("failed to set up authorized municipal fixture");
  const fixture = data as WorkspaceFixture;
  try {
    await page.goto(new URL("/dashboard", baseURL).toString());
    await page.getByRole("banner").getByRole("combobox", { name: "Organización", exact: true }).selectOption(fixture.organization_id);
    const switched = page.waitForResponse((response) => response.url().endsWith("/api/workspace") && response.request().method() === "POST");
    await page.getByRole("banner").getByRole("button", { name: "Cambiar organización" }).click();
    expect({ ok: (await switched).ok() }).toEqual({ ok: true });
    return await run();
  } finally {
    const cleanup = await admin.rpc("e2e_cleanup_authorized_fiscal_fixture", { p_fixture: fixture });
    if (cleanup.error || cleanup.data?.cleaned !== true) throw new Error(cleanup.error?.message ?? "municipal fixture cleanup failed");
  }
}
