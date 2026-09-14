import { expect, test, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { assertE2eEnvironment } from "./gate-contract";
import { comparisonFixture, withResultFixture } from "./result-fixture";
import { scenarioBaseUrl } from "./scenario-ownership";
const environment = assertE2eEnvironment(process.env), SPEC = "e2e/comparison.spec.ts";
const { identity, seed } = comparisonFixture(SPEC), baseURL = scenarioBaseUrl(SPEC, environment);
interface WorkspaceFixture { organization_id: string; user_id: string; distrito_code: string; seccion_code: string; extra_seccion_code?: string; }
async function withAuthorizedComparisonWorkspace<T>(page: Page, run: (revokeAuthorization: () => Promise<void>) => Promise<T>): Promise<T> {
  const admin = createClient(environment.NEXT_PUBLIC_SUPABASE_URL, environment.SUPABASE_SERVICE_ROLE_KEY);
  const { data: users, error: userError } = await admin.auth.admin.listUsers();
  const user = users?.users.find((candidate) => candidate.email?.toLowerCase() === environment.VOTUS_E2E_TEST_USER_EMAIL.toLowerCase());
  if (userError || !user) throw new Error("failed to resolve comparison fixture user");
  const { data, error } = await admin.rpc("e2e_setup_authorized_fiscal_fixture", { p_user_id: user.id, p_distrito_code: identity.distritoCode, p_seccion_code: identity.seccionCode });
  if (error || typeof data?.organization_id !== "string") throw new Error("failed to set up authorized comparison fixture");
  let fixture = data as WorkspaceFixture;
  const leftOnlySection = identity.comparisonLeftOnlySection;
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
    await page.goto(new URL("/dashboard", baseURL).toString()); const selector = page.getByRole("combobox", { name: "Organización", exact: true }); await expect(selector).toBeVisible(); await selector.selectOption(fixture.organization_id);
    const switched = page.waitForResponse((response) => response.url().endsWith("/api/workspace") && response.request().method() === "POST"); await page.getByRole("button", { name: "Cambiar organización" }).click(); const response = await switched;
    expect({ ok: response.ok(), body: await response.json() }).toMatchObject({ ok: true, body: { status: "active" } });
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
async function submitOptions(page: Page): Promise<void> {
  const navigation = page.waitForResponse((response) => response.request().isNavigationRequest() && new URL(response.url()).pathname === "/compare");
  await page.getByRole("button", { name: "Actualizar opciones" }).click();
  expect((await navigation).ok()).toBe(true);
  await expect(page.getByRole("main")).toBeVisible();
}
test.describe("authorized official comparison", () => {
  test("serves complete evidence, then removes every figure after authorization loss and reload", async ({ page }) => {
    await withResultFixture(SPEC, seed, async () => withAuthorizedComparisonWorkspace(page, async (revokeAuthorization) => {
      const leftOnlySection = identity.comparisonLeftOnlySection;
        if (!leftOnlySection) throw new Error("comparison fixture left-only section is missing");
        const comparisonNavigationLink = page.getByRole("navigation", { name: "principal" }).getByRole("link", { name: "Comparar", exact: true });
      await comparisonNavigationLink.click(); await expect(page).toHaveURL(/\/compare$/); await expect(comparisonNavigationLink).toHaveAttribute("aria-current", "page");
      const compare = page.getByRole("button", { name: "Comparar resultados", exact: true });
      const unavailableCompare = () => expect(compare.filter({ visible: true }).and(page.locator(":enabled"))).toHaveCount(0);
      const leftCategory = page.getByLabel("Categoría izquierda", { exact: true });
      const rightCategory = page.getByLabel("Categoría derecha", { exact: true });
      await unavailableCompare();
      await page.getByLabel("Elección izquierda (2023)").selectOption(identity.electionIds[0]!);
      await page.getByLabel("Elección derecha (2025)").selectOption(identity.electionIds[1]!);
      await unavailableCompare();
      await submitOptions(page);
      await expect(page).toHaveURL(new RegExp(`leftElectionId=${identity.electionIds[0]}`));
      for (const category of [leftCategory, rightCategory]) {
        await expect(category).toBeEnabled();
        await expect(category).toHaveAttribute("required", "");
        await expect(category).toHaveValue("");
      }
      // Required, empty descendants must not block an options-only GET.
      await submitOptions(page);
      await unavailableCompare();
      await leftCategory.selectOption(identity.categoryId);
      await expect(rightCategory).toHaveValue("");
      await unavailableCompare();
      await rightCategory.selectOption(identity.categoryId);
      await expect(leftCategory).toHaveValue(identity.categoryId);
      await unavailableCompare();
      await submitOptions(page);
      await page.getByLabel("Distrito compartido").selectOption(identity.distritoCode);
      await unavailableCompare();
      await submitOptions(page);
        const sharedSection = page.getByRole("combobox", { name: "Sección compartida", exact: true });
        await expect(sharedSection.getByRole("option", { name: leftOnlySection.seccionCode, exact: false })).toHaveCount(0);
        await expect(page.getByRole("main")).toContainText("Opciones no compartidas — Sección: 1 Lado A / 0 Lado B (disponibles solo en ese lado).");
        await unavailableCompare();
        await sharedSection.selectOption(identity.seccionCode);
        await expect(compare).toBeEnabled();
        await compare.click();
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
      await expect(main.getByText("Comparación aplicada", { exact: true })).toBeVisible();
      await expect(main.getByRole("combobox")).toHaveCount(6);
      for (const side of ["A", "B"]) await expect(main.getByRole("group", { name: new RegExp(`^Lado ${side}\\b`) })).toHaveCount(1);
      const appliedHeading = main.getByRole("heading", { name: "Resultados exactos", exact: true });
      const table = tableRegion.getByRole("table");
      const rails = main.getByRole("complementary", { name: "Evidencia oficial por lado" }).getByRole("article");
      await expect(rails).toHaveCount(2);
      const applied = { heading: await appliedHeading.innerText(), table: await table.innerText(), rails: await rails.allInnerTexts() };
      const expectAppliedUnchanged = async (): Promise<void> => {
        await expect.poll(async () => ({
          heading: await appliedHeading.innerText(),
          table: await table.innerText(),
          rails: await rails.allInnerTexts(),
        })).toEqual(applied);
      };
      const hashes = applied.rails.flatMap((rail) => [...rail.matchAll(/SHA-256 ([a-f0-9]{64})/g)].map((match) => match[1]));
      expect(hashes).toHaveLength(2);
      for (const category of [leftCategory, rightCategory]) {
        await category.selectOption("");
        await expect(main.getByText("Cambios sin aplicar", { exact: true })).toBeVisible();
        await unavailableCompare();
        await expect(page).toHaveURL(servedUrl.toString());
        await expectAppliedUnchanged();
        await category.selectOption(identity.categoryId);
        await expect(main.getByText("Cambios sin aplicar", { exact: true })).toHaveCount(0);
        await expect(compare).toBeEnabled();
        await expect(page).toHaveURL(servedUrl.toString());
        await expectAppliedUnchanged();
      }
      await tableRegion.focus();
      await expect(tableRegion).toBeFocused();
      await page.setViewportSize({ width: 1440, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1440);
      await page.setViewportSize({ width: 320, height: 720 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
      await revokeAuthorization(); await page.reload(); await expect(page).toHaveURL(servedUrl.toString()); await expect(main.getByRole("alert")).toContainText("No tiene autorización");
      await expect(main).not.toContainText("100,00 %"); await expect(main).not.toContainText("puntos porcentuales"); await expect(main).not.toContainText(identity.archiveEntryIds[0]!); await expect(main).not.toContainText(identity.archiveEntryIds[1]!);
        await expect(main).not.toContainText("Opciones no compartidas"); await expect(main).not.toContainText("disponibles solo en ese lado");
    }));
  });
});
