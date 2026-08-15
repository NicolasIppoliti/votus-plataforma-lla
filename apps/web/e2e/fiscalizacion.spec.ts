import { expect, test } from "@playwright/test";

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

test.describe("the fiscalizacion route explores coverage", () => {
  test("test_route_reaches_uncovered_official_results", async ({ page }) => {
    await withResultFixture(SPEC, COVERAGE_FIXTURE, async () => {
      await page.goto(new URL("/dashboard", baseURL).toString());
      await expect(page).toHaveURL(/\/dashboard/);

      // Reachable from the authenticated layout (task 13.10), not merely
      // addressable by URL.
      await page.getByRole("navigation", { name: "principal" }).getByRole("link", { name: "Fiscalización (no oficial)", exact: true }).click();
      await expect(page).toHaveURL(/\/fiscalizacion/);
      await page.goto(new URL(
        `/fiscalizacion?electionId=${COVERAGE_SCOPE.electionId}` +
          `&categoryId=${COVERAGE_SCOPE.categoryId}&distritoCode=${COVERAGE_SCOPE.distritoCode}` +
          `&seccionCode=${COVERAGE_SCOPE.seccionCode}`,
        baseURL,
      ).toString());

      const main = page.getByRole("main");
      await expect(main).toContainText("1 mesas cubiertas de 2 mesas oficiales");
      await expect(main).toContainText("1 sin cobertura");
      await expect(main).toContainText("No es una muestra aleatoria");
      await expect(main).toContainText(
        "Sin cobertura significa que no hay presencia de fiscalización, no que los votos oficiales sean cero o falten",
      );
      await expect(main).toContainText(`fiscalización: 1 filas / ${FISCALIZACION_VOTES} votos / 1 mesas`);
      await expect(main.getByRole("list", { name: "procedencia" }).getByRole("listitem")).toHaveCount(3);
      const reusableUrl = page.url();
      await page.reload();
      await expect(page).toHaveURL(reusableUrl);
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
      await expect(page.getByRole("main").getByRole("alert")).toContainText(
        "Se rechazó la solicitud: no official mesa rows exist for the selected scope",
      );
    });
  });
});
