import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";

import { assertE2eEnvironment } from "./gate-contract";
import { coverageFixture, withResultFixture } from "./result-fixture";
import { scenarioBaseUrl } from "./scenario-ownership";

/**
 * fiscalizacion-analysis spec, "An operator route reaches fiscalización
 * through the opt-in path" (Requirement 8, task 13.11) — `provenance.spec.ts`
 * already proves the DEFAULT page never leaks a fiscalización marker
 * (path 3 of the threat matrix); this spec proves the OPPOSITE direction:
 * the dedicated `/fiscalizacion` route, reached through the opt-in path,
 * renders labelled unofficial figures with their coverage denominator.
 */

const environment = assertE2eEnvironment(process.env);
const SPEC = "e2e/fiscalizacion.spec.ts";
const { scope: COVERAGE_SCOPE, seed: COVERAGE_FIXTURE } = coverageFixture(SPEC);
const baseURL = scenarioBaseUrl(SPEC, environment);

async function expectNoBlankSearchParams(page: Page): Promise<void> {
  const url = new URL(page.url());
  for (const [name, value] of url.searchParams) {
    expect(value, `${name} must be omitted instead of serialized blank`).not.toBe("");
  }
}

async function withAuthorizedFiscalWorkspace<T>(page: Page, run: () => Promise<T>): Promise<T> {
  const admin = createClient(environment.NEXT_PUBLIC_SUPABASE_URL, environment.SUPABASE_SERVICE_ROLE_KEY);
  const { data: auth, error: authError } = await admin.auth.admin.listUsers(); const user = auth?.users.find((candidate) => candidate.email?.toLowerCase() === environment.VOTUS_E2E_TEST_USER_EMAIL.toLowerCase());
  if (authError || !user) throw new Error(`failed to resolve fiscal fixture user: ${authError?.message ?? "user missing"}`);
  const { data: fixture, error: fixtureError } = await admin.rpc("e2e_setup_authorized_fiscal_fixture", { p_user_id: user.id, p_distrito_code: COVERAGE_SCOPE.distritoCode, p_seccion_code: COVERAGE_SCOPE.seccionCode });
  if (fixtureError || typeof fixture?.organization_id !== "string") { const cause = new Error(`failed to set up authorized fiscal fixture: ${fixtureError?.message ?? "invalid response"}`); if (fixture) { const cleanup = await admin.rpc("e2e_cleanup_authorized_fiscal_fixture", { p_fixture: fixture }); if (cleanup.error) throw new AggregateError([cause, new Error(cleanup.error.message)], "fiscal fixture setup and cleanup failed"); } throw cause; }
  let outcome: { value: T } | { error: unknown }; let cleanupError: { message: string } | null;
  try { await page.goto(new URL("/dashboard", baseURL).toString()); const selector = page.getByLabel("Organización"); await expect(selector).toBeVisible(); await selector.selectOption(fixture.organization_id); const switched = page.waitForResponse((response) => response.url().endsWith("/api/workspace") && response.request().method() === "POST"); await page.getByRole("button", { name: "Cambiar organización" }).click(); const response = await switched; expect({ ok: response.ok(), body: await response.json() }).toMatchObject({ ok: true, body: { status: "active" } }); outcome = { value: await run() }; }
  catch (error) { outcome = { error }; } finally { ({ error: cleanupError } = await admin.rpc("e2e_cleanup_authorized_fiscal_fixture", { p_fixture: fixture })); }
  if ("error" in outcome) { if (cleanupError) throw new AggregateError([outcome.error, new Error(cleanupError.message)], "fiscal assertion and fixture cleanup failed"); throw outcome.error; } if (cleanupError) throw new Error(`failed to clean fiscal fixture: ${cleanupError.message}`); return outcome.value;
}

test.describe("the fiscalizacion route explores coverage", () => {
  test("test_route_reaches_only_authorized_fiscalizacion_evidence", async ({ page }) => {
    await withResultFixture(SPEC, COVERAGE_FIXTURE, async () => withAuthorizedFiscalWorkspace(page, async () => {
      await expect(page).toHaveURL(new URL("/", baseURL).toString());
      await page.getByRole("navigation", { name: "principal" }).getByRole("link", { name: "Fiscalización (no oficial)", exact: true }).click();
      await expect(page).toHaveURL(/\/fiscalizacion/);
      await expect(page.getByRole("main")).not.toContainText("No tiene autorización");
      const coldUrl = page.url();
      await page.getByRole("button", { name: "Mostrar cobertura" }).click();
      await expect(page).toHaveURL(coldUrl);
      await expect(page.getByLabel("Elección")).toBeFocused();
      for (const label of ["Categoría", "Distrito", "Sección"]) {
        const descendant = page.getByLabel(label);
        await expect(descendant).toBeDisabled();
        expect(await descendant.evaluate((element) => {
          (element as HTMLSelectElement).focus();
          return document.activeElement === element;
        })).toBe(false);
      }

      const form = page.locator('form[action="/fiscalizacion"]'); await page.locator("html").evaluate((element) => { element.dataset.scopeSentinel = "alive"; });
      const draft = async (label: string, value: string, dependent: string): Promise<void> => {
        const control = page.getByLabel(label), child = page.getByLabel(dependent);
        const scopeResponse = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/fiscalizacion/scope-options", { timeout: 2_000 }).catch(() => null);
        await control.focus(); await control.selectOption(value);
        expect(page.url()).toBe(coldUrl); await expect(child).toHaveValue("");
        const response = await scopeResponse; if (response && !response.ok()) throw new Error(`scope options failed: ${response.status()} ${await response.text()}`);
        await expect(child).toBeEnabled(); await expect(form).not.toHaveAttribute("aria-busy", "true"); await expect(page.locator("html")).toHaveAttribute("data-scope-sentinel", "alive");
      };
      await draft("Elección", COVERAGE_SCOPE.electionId, "Categoría");
      await draft("Categoría", COVERAGE_SCOPE.categoryId, "Distrito");
      await draft("Distrito", COVERAGE_SCOPE.distritoCode, "Sección");
      await page.getByLabel("Sección").selectOption(COVERAGE_SCOPE.seccionCode); await expect(form).not.toHaveAttribute("aria-busy", "true");
      const expectedUrl = new URL(`/fiscalizacion?electionId=${COVERAGE_SCOPE.electionId}&categoryId=${COVERAGE_SCOPE.categoryId}&distritoCode=${COVERAGE_SCOPE.distritoCode}&seccionCode=${COVERAGE_SCOPE.seccionCode}`, baseURL).toString();
      await page.getByRole("button", { name: "Mostrar cobertura" }).click();
      await expect(page).toHaveURL(expectedUrl); await expectNoBlankSearchParams(page);

      const primaryNavigation = page.getByRole("navigation", { name: "principal" });
      await expect(primaryNavigation.locator('a[aria-current="page"]')).toHaveCount(1);
      await expect(
        primaryNavigation.getByRole("link", {
          name: "Fiscalización (no oficial)",
          exact: true,
        }),
      ).toHaveAttribute("aria-current", "page");

      const main = page.getByRole("main");
      await expect(main).toContainText("Estado de cobertura: ok"); await expect(main).toContainText("1 unidades observadas de 2 del denominador oficial");
      await expect(main).toContainText("Mesa 2");
      await expect(main).toContainText("Estado del resultado: ok"); await expect(main).toContainText("Fuente: fiscalización; no es una muestra aleatoria"); await expect(main).toContainText("denominador 2");
      await expect(main).toContainText("22222 votos"); await expect(main).not.toContainText(/11111|33333/); await expect(main).toContainText(String(COVERAGE_FIXTURE.archiveEntries?.[1]?.["id"])); await expect(main).not.toContainText(String(COVERAGE_FIXTURE.archiveEntries?.[0]?.["id"])); await expect(main).not.toContainText(String(COVERAGE_FIXTURE.archiveEntries?.[2]?.["id"]));
      const reusableUrl = page.url();
      await page.goto(new URL("/dashboard", baseURL).toString()); await page.goBack();
      await expect(page).toHaveURL(reusableUrl);
      await page.reload(); await expect(page).toHaveURL(reusableUrl);
      await expect(page.getByRole("main")).toContainText("Estado de cobertura: ok");

      await page.goto(new URL(`/fiscalizacion?electionId=${COVERAGE_SCOPE.electionId}&categoryId=${COVERAGE_SCOPE.categoryId}&jurisdictionId=legacy-public`, baseURL).toString());
      await expect(page.getByRole("main").getByRole("alert")).toContainText("parámetros de consulta no admitidos");
      await expect(page.getByRole("main")).not.toContainText("Cobertura: 93 de 153 mesas");
    }));
  });
});
