import { expect, test, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { assertE2eEnvironment } from "./gate-contract";
import { comparisonFixture, withResultFixture } from "./result-fixture";
import { scenarioBaseUrl } from "./scenario-ownership";
const environment = assertE2eEnvironment(process.env), SPEC = "e2e/comparison.spec.ts";
const { identity, seed } = comparisonFixture(SPEC), baseURL = scenarioBaseUrl(SPEC, environment);
interface WorkspaceFixture { organization_id: string; user_id: string; distrito_code: string; seccion_code: string; }
async function withAuthorizedComparisonWorkspace<T>(page: Page, run: (revokeAuthorization: () => Promise<void>) => Promise<T>): Promise<T> {
  const admin = createClient(environment.NEXT_PUBLIC_SUPABASE_URL, environment.SUPABASE_SERVICE_ROLE_KEY);
  const { data: users, error: userError } = await admin.auth.admin.listUsers();
  const user = users?.users.find((candidate) => candidate.email?.toLowerCase() === environment.VOTUS_E2E_TEST_USER_EMAIL.toLowerCase());
  if (userError || !user) throw new Error("failed to resolve comparison fixture user");
  const { data, error } = await admin.rpc("e2e_setup_authorized_fiscal_fixture", { p_user_id: user.id, p_distrito_code: identity.distritoCode, p_seccion_code: identity.seccionCode });
  if (error || typeof data?.organization_id !== "string") throw new Error("failed to set up authorized comparison fixture");
  const fixture = data as WorkspaceFixture; let outcome: { value: T } | { error: unknown }; let cleanupError: { message: string } | null = null;
  try {
    await page.goto(new URL("/dashboard", baseURL).toString()); const selector = page.getByLabel("Organización"); await expect(selector).toBeVisible(); await selector.selectOption(fixture.organization_id);
    const switched = page.waitForResponse((response) => response.url().endsWith("/api/workspace") && response.request().method() === "POST"); await page.getByRole("button", { name: "Cambiar organización" }).click(); const response = await switched;
    expect({ ok: response.ok(), body: await response.json() }).toMatchObject({ ok: true, body: { status: "active" } });
    const revokeAuthorization = async (): Promise<void> => { const revoked = await admin.rpc("e2e_revoke_authorized_fiscal_fixture", { p_fixture: fixture }); if (revoked.error || revoked.data?.revoked !== true) throw new Error("failed to revoke authorized comparison fixture"); };
    outcome = { value: await run(revokeAuthorization) };
  } catch (caught) { outcome = { error: caught }; }
  finally { ({ error: cleanupError } = await admin.rpc("e2e_cleanup_authorized_fiscal_fixture", { p_fixture: fixture })); }
  if ("error" in outcome) { if (cleanupError) throw new AggregateError([outcome.error, new Error(cleanupError.message)], "comparison assertions and cleanup failed"); throw outcome.error; }
  if (cleanupError) throw new Error("failed to clean authorized comparison fixture"); return outcome.value;
}
async function submitOptions(page: Page): Promise<void> { await page.getByRole("button", { name: "Actualizar opciones" }).click(); await expect(page.getByRole("main")).toBeVisible(); }
test.describe("authorized official comparison", () => {
  test("serves complete evidence, then removes every figure after authorization loss and reload", async ({ page }) => {
    await withResultFixture(SPEC, seed, async () => withAuthorizedComparisonWorkspace(page, async (revokeAuthorization) => {
      const comparisonNavigationLink = page.getByRole("navigation", { name: "principal" }).getByRole("link", { name: "Comparar", exact: true });
      await comparisonNavigationLink.click(); await expect(page).toHaveURL(/\/compare$/); await expect(comparisonNavigationLink).toHaveAttribute("aria-current", "page");
      await page.getByLabel("Elección izquierda (2023)").selectOption(identity.electionIds[0]!); await page.getByLabel("Elección derecha (2025)").selectOption(identity.electionIds[1]!); await submitOptions(page);
      await page.getByLabel("Categoría izquierda").selectOption(identity.categoryId); await page.getByLabel("Categoría derecha").selectOption(identity.categoryId); await submitOptions(page);
      await page.getByLabel("Distrito compartido").selectOption(identity.distritoCode); await submitOptions(page); await page.getByRole("combobox", { name: "Sección compartida", exact: true }).selectOption(identity.seccionCode); await submitOptions(page);
      const servedUrl = new URL(page.url()); expect(Object.fromEntries(servedUrl.searchParams)).toEqual({ leftElectionId: identity.electionIds[0], leftCategoryId: identity.categoryId, rightElectionId: identity.electionIds[1], rightCategoryId: identity.categoryId, distritoCode: identity.distritoCode, seccionCode: identity.seccionCode });
      const main = page.getByRole("main"); await expect(main).toContainText("sin cambio"); await expect(main).toContainText("100,00 %"); await expect(main).toContainText("0,00 puntos porcentuales");
      await expect(main).toContainText(identity.archiveEntryIds[0]!); await expect(main).toContainText(identity.archiveEntryIds[1]!); await expect(main).toContainText("SHA-256"); await expect(main).not.toContainText("https://"); await expect(main).not.toContainText("example.test");
      const leftSide = main.getByRole("article", { name: "Lado A", exact: true });
      const rightSide = main.getByRole("article", { name: "Lado B", exact: true });
      await expect(leftSide).toContainText("Elección: 2023");
      await expect(leftSide).toContainText(`Categoría: ${identity.categoryName}`);
      await expect(rightSide).toContainText("Elección: 2025");
      await expect(rightSide).toContainText(`Categoría: ${identity.categoryName}`);
      const tableRegion = main.getByRole("region", { name: /Tabla exacta/ });
      await tableRegion.focus();
      await expect(tableRegion).toBeFocused();
      await page.setViewportSize({ width: 1440, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1440);
      await page.setViewportSize({ width: 320, height: 720 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
      await revokeAuthorization(); await page.reload(); await expect(page).toHaveURL(servedUrl.toString()); await expect(main.getByRole("alert")).toContainText("No tiene autorización");
      await expect(main).not.toContainText("100,00 %"); await expect(main).not.toContainText("puntos porcentuales"); await expect(main).not.toContainText(identity.archiveEntryIds[0]!); await expect(main).not.toContainText(identity.archiveEntryIds[1]!);
    }));
  });
});
