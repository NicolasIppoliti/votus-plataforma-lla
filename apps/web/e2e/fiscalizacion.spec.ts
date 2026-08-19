import { expect, test, type Page } from "@playwright/test";

import { assertE2eEnvironment } from "./gate-contract";
import {
  FISCALIZACION_VOTES,
  coverageFixture,
  withResultFixture,
} from "./result-fixture";
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
  test("test_route_reaches_uncovered_official_results", async ({ page }) => {
    await withResultFixture(SPEC, COVERAGE_FIXTURE, async () => {
      await page.goto(new URL("/dashboard", baseURL).toString());
      await expect(page).toHaveURL(/\/dashboard/);

      // Reachable from the authenticated layout (task 13.10), not merely
      // addressable by URL.
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
        const responsePromise = page.waitForResponse((response) =>
          new URL(response.url()).pathname === "/api/fiscalizacion/scope-options");
        await control.focus(); await control.selectOption(value);
        expect(page.url()).toBe(coldUrl);
        await expect(control).toBeFocused();
        await expect(child).toHaveValue(""); await expect(child).toBeDisabled();
        const response = await responsePromise;
        expect(await response.json()).toMatchObject({
          capability: "coverage-scope-options", meaning: "scope-options-only",
        });
        await expect(child).toBeEnabled();
        await expect(form).not.toHaveAttribute("aria-busy", "true");
        await expect(form.locator('[aria-live="polite"]')).toHaveText("");
        await expect(page.locator("html")).toHaveAttribute("data-scope-sentinel", "alive");
      };
      await draft("Elección", COVERAGE_SCOPE.electionId, "Categoría");
      await draft("Categoría", COVERAGE_SCOPE.categoryId, "Distrito");
      await draft("Distrito", COVERAGE_SCOPE.distritoCode, "Sección");
      const sectionResponse = page.waitForResponse((response) =>
        new URL(response.url()).pathname === "/api/fiscalizacion/scope-options");
      await page.getByLabel("Sección").selectOption(COVERAGE_SCOPE.seccionCode);
      expect(page.url()).toBe(coldUrl); await sectionResponse;
      const expectedUrl = new URL(
        `/fiscalizacion?electionId=${COVERAGE_SCOPE.electionId}` +
          `&categoryId=${COVERAGE_SCOPE.categoryId}&distritoCode=${COVERAGE_SCOPE.distritoCode}` +
          `&seccionCode=${COVERAGE_SCOPE.seccionCode}`, baseURL,
      ).toString();
      const navigations: string[] = [];
      page.on("framenavigated", (frame) => { if (frame === page.mainFrame()) navigations.push(frame.url()); });
      await page.getByRole("button", { name: "Mostrar cobertura" }).click();
      await expect(page).toHaveURL(expectedUrl); await expectNoBlankSearchParams(page);
      expect(navigations).toEqual([expectedUrl]);

      const primaryNavigation = page.getByRole("navigation", { name: "principal" });
      await expect(primaryNavigation.locator('a[aria-current="page"]')).toHaveCount(1);
      await expect(
        primaryNavigation.getByRole("link", {
          name: "Fiscalización (no oficial)",
          exact: true,
        }),
      ).toHaveAttribute("aria-current", "page");

      const main = page.getByRole("main");
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
      await expect(main).toContainText("1 mesas cubiertas de 2 mesas oficiales");
      await expect(main).toContainText("1 sin cobertura");
      await expect(main).toContainText("No es una muestra aleatoria");
      await expect(main).toContainText(
        "Sin cobertura significa que no hay presencia de fiscalización, no que los votos oficiales sean cero o falten",
      );
      await expect(main).toContainText(`fiscalización: 1 filas / ${FISCALIZACION_VOTES} votos / 1 mesas`);
      await expect(main.getByRole("list", { name: "procedencia" }).getByRole("listitem")).toHaveCount(3);
      const reusableUrl = page.url();
      await page.goto(new URL("/dashboard", baseURL).toString()); await page.goBack();
      await expect(page).toHaveURL(reusableUrl);
      await expect(page.getByLabel("Sección")).toHaveValue(COVERAGE_SCOPE.seccionCode);
      await page.reload(); await expect(page).toHaveURL(reusableUrl);
      await expect(page.getByRole("main")).toContainText("1 mesas cubiertas de 2 mesas oficiales");
      const schools = main.getByRole("list", { name: "Cobertura por establecimiento" });
      await expect(schools.getByRole("listitem")).toHaveCount(2);
      await expect(schools).toContainText("Circuito 00001 — Synthetic school: 1 de 1 mesas cubiertas");
      await expect(schools).toContainText("Circuito 00002 — Synthetic school: 0 de 1 mesas cubiertas");
      await expect(schools.getByRole("link", { name: "Ver votos oficiales del establecimiento" }).nth(0))
        .toHaveAttribute("href", /circuitoCode=00001.*establecimientoCode=E1.*level=establecimiento/);
      await expect(schools.getByRole("link", { name: "Ver votos oficiales del establecimiento" }).nth(1))
        .toHaveAttribute("href", /circuitoCode=00002.*establecimientoCode=E1.*level=establecimiento/);
      await page.goto(new URL(
        `/drilldown?electionId=${COVERAGE_SCOPE.electionId}` +
          `&categoryId=${COVERAGE_SCOPE.categoryId}&distritoCode=${COVERAGE_SCOPE.distritoCode}` +
          `&seccionCode=${COVERAGE_SCOPE.seccionCode}&level=seccion`, baseURL,
      ).toString());
      const schoolBreakdown = page.getByRole("table", { name: "Votos oficiales por circuito y establecimiento" });
      await expect(schoolBreakdown).toContainText("Circuito 00001 — E1 — Synthetic school");
      await expect(schoolBreakdown).toContainText("Circuito 00002 — E1 — Synthetic school");
      await expect(schoolBreakdown.getByRole("row")).toHaveCount(3);
      await expect(schoolBreakdown).toContainText(`${33_333} votos`);

      await page.goto(new URL(
        `/fiscalizacion?electionId=${COVERAGE_SCOPE.electionId}` +
          `&categoryId=${COVERAGE_SCOPE.categoryId}&distritoCode=${COVERAGE_SCOPE.distritoCode}` +
          `&seccionCode=${COVERAGE_SCOPE.seccionCode}`, baseURL,
      ).toString());
      const coverageMain = page.getByRole("main");
      await coverageMain.getByRole("link", { name: "Ver votos oficiales" }).last().click();
      await expect(page).toHaveURL(/\/drilldown\?/);
      await expect(page.getByRole("main")).toContainText("33333 votos a nivel establecimiento");
      await expect(page.getByRole("main")).not.toContainText(String(FISCALIZACION_VOTES));

      await page.goto(new URL(
        `/fiscalizacion?electionId=${COVERAGE_SCOPE.electionId}` +
          `&categoryId=${COVERAGE_SCOPE.categoryId}&distritoCode=${COVERAGE_SCOPE.distritoCode}` +
          "&seccionCode=999",
        baseURL,
      ).toString());
      const unavailableCoverage = page
        .getByRole("main")
        .getByRole("status");
      await expect(unavailableCoverage).toContainText(
        "Cobertura no disponible para este alcance",
      );
      await expect(unavailableCoverage).toContainText(
        "No se estimó la cobertura porque no existe un denominador oficial por mesa",
      );
      await expect(unavailableCoverage).not.toContainText(
        "no official mesa rows exist for the selected scope",
      );
    });
  });
});
