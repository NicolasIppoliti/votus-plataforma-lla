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

test.describe("the fiscalizacion route explores coverage", () => {
  test("test_route_reaches_only_authorized_fiscalizacion_evidence", async ({ page }) => {
    await withResultFixture(SPEC, COVERAGE_FIXTURE, async () => {
      await page.goto(new URL("/dashboard", baseURL).toString());
      await expect(page).toHaveURL(/\/dashboard/);
      await page.getByRole("navigation", { name: "principal" }).getByRole("link", { name: "Fiscalización (no oficial)", exact: true }).click();
      await expect(page).toHaveURL(/\/fiscalizacion/);
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

      const form = page.locator('form[action="/fiscalizacion"]');
      await page.locator("html").evaluate((element) => { element.dataset.scopeSentinel = "alive"; });
      const draft = async (label: string, value: string, dependent: string): Promise<void> => {
        const control = page.getByLabel(label), child = page.getByLabel(dependent);
        const responsePromise = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/fiscalizacion/scope-options");
        await control.focus(); await control.selectOption(value);
        expect(page.url()).toBe(coldUrl);
        await expect(child).toHaveValue(""); await expect(child).toBeDisabled();
        const response = await responsePromise;
        expect(await response.json()).toMatchObject({ capability: "coverage-scope-options", meaning: "scope-options-only" });
        await expect(child).toBeEnabled();
        await expect(form).not.toHaveAttribute("aria-busy", "true");
        await expect(page.locator("html")).toHaveAttribute("data-scope-sentinel", "alive");
      };
      await draft("Elección", COVERAGE_SCOPE.electionId, "Categoría");
      await draft("Categoría", COVERAGE_SCOPE.categoryId, "Distrito");
      await draft("Distrito", COVERAGE_SCOPE.distritoCode, "Sección");
      const sectionResponse = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/fiscalizacion/scope-options");
      await page.getByLabel("Sección").selectOption(COVERAGE_SCOPE.seccionCode);
      await sectionResponse;
      const expectedUrl = new URL(`/fiscalizacion?electionId=${COVERAGE_SCOPE.electionId}&categoryId=${COVERAGE_SCOPE.categoryId}&distritoCode=${COVERAGE_SCOPE.distritoCode}&seccionCode=${COVERAGE_SCOPE.seccionCode}`, baseURL).toString();
      const navigations: string[] = [];
      page.on("framenavigated", (frame) => { if (frame === page.mainFrame()) navigations.push(frame.url()); });
      await page.getByRole("button", { name: "Mostrar cobertura" }).click();
      await expect(page).toHaveURL(expectedUrl); await expectNoBlankSearchParams(page);
      expect([...new Set(navigations)]).toEqual([expectedUrl]);

      const primaryNavigation = page.getByRole("navigation", { name: "principal" });
      await expect(primaryNavigation.locator('a[aria-current="page"]')).toHaveCount(1);
      await expect(
        primaryNavigation.getByRole("link", {
          name: "Fiscalización (no oficial)",
          exact: true,
        }),
      ).toHaveAttribute("aria-current", "page");

      for (const [label, value, optionText] of [
        ["Distrito", COVERAGE_SCOPE.distritoCode,
          `${COVERAGE_SCOPE.distritoCode} — Buenos Aires`],
        ["Sección", COVERAGE_SCOPE.seccionCode,
          `${COVERAGE_SCOPE.seccionCode} — Coronel de Marina L. Rosales`],
      ] as const) {
        const selector = page.getByLabel(label);
        await expect(selector).toHaveValue(value);
        await expect(selector.getByRole("option", { name: optionText, exact: true }))
          .toHaveAttribute("value", value);
      }
      const main = page.getByRole("main");
      await expect(main).toContainText("Estado de cobertura: authorization_denied");
      await expect(main).toContainText("Estado del resultado: authorization_denied");
      await expect(main).not.toContainText("mesas cubiertas de 2 mesas oficiales");
      await expect(main.getByRole("link", { name: /Consultar evidencia|Consultar resultado|Ver votos oficiales/ })).toHaveCount(0);
      const reusableUrl = page.url();
      await page.goto(new URL("/dashboard", baseURL).toString()); await page.goBack();
      await expect(page).toHaveURL(reusableUrl);
      await expect(page.getByLabel("Sección")).toHaveValue(COVERAGE_SCOPE.seccionCode);
      await page.reload(); await expect(page).toHaveURL(reusableUrl);
      await expect(page.getByRole("main")).toContainText("Estado de cobertura: authorization_denied");

      await page.goto(new URL(`/fiscalizacion?electionId=${COVERAGE_SCOPE.electionId}&categoryId=${COVERAGE_SCOPE.categoryId}&jurisdictionId=legacy-public`, baseURL).toString());
      await expect(page.getByRole("main").getByRole("alert")).toContainText("parámetros de consulta no admitidos");
      await expect(page.getByRole("main")).not.toContainText("Cobertura: 93 de 153 mesas");
    });
  });
});
