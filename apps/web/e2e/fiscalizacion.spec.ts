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
      await page.getByRole("navigation", { name: "main" }).getByRole("link", { name: "Fiscalización (unofficial)", exact: true }).click();
      await expect(page).toHaveURL(/\/fiscalizacion/);
      await page.goto(new URL(
        `/fiscalizacion?electionId=${COVERAGE_SCOPE.electionId}` +
          `&categoryId=${COVERAGE_SCOPE.categoryId}&distritoCode=${COVERAGE_SCOPE.distritoCode}` +
          `&seccionCode=${COVERAGE_SCOPE.seccionCode}`,
        baseURL,
      ).toString());

      const main = page.getByRole("main");
      await expect(main).toContainText("1 covered of 2 official mesas");
      await expect(main).toContainText("1 uncovered");
      await expect(main).toContainText("not a random sample");
      await expect(main).toContainText(
        "Uncovered means no fiscalización presence, not zero or missing official votes",
      );
      await expect(main).toContainText(`fiscalizacion: 1 rows / ${FISCALIZACION_VOTES} votes / 1 mesas`);
      await expect(main.getByRole("list", { name: "provenance" }).getByRole("listitem")).toHaveCount(3);
      const reusableUrl = page.url();
      await page.reload();
      await expect(page).toHaveURL(reusableUrl);
      await expect(page.getByRole("main")).toContainText("1 covered of 2 official mesas");
      const schools = main.getByRole("list", { name: "School coverage" });
      await expect(schools.getByRole("listitem")).toHaveCount(2);
      await expect(schools).toContainText("Circuito 00001 — Synthetic school: 1 of 1 mesas covered");
      await expect(schools).toContainText("Circuito 00002 — Synthetic school: 0 of 1 mesas covered");
      await expect(schools.getByRole("link", { name: "View school official votes" }).nth(0))
        .toHaveAttribute("href", /circuitoCode=00001.*establecimientoCode=E1.*level=establecimiento/);
      await expect(schools.getByRole("link", { name: "View school official votes" }).nth(1))
        .toHaveAttribute("href", /circuitoCode=00002.*establecimientoCode=E1.*level=establecimiento/);
      await page.goto(new URL(
        `/drilldown?electionId=${COVERAGE_SCOPE.electionId}` +
          `&categoryId=${COVERAGE_SCOPE.categoryId}&distritoCode=${COVERAGE_SCOPE.distritoCode}` +
          `&seccionCode=${COVERAGE_SCOPE.seccionCode}&level=seccion`, baseURL,
      ).toString());
      const schoolBreakdown = page.getByRole("table", { name: "Official votes by circuit and establishment" });
      await expect(schoolBreakdown).toContainText("Circuito 00001 — E1 — Synthetic school");
      await expect(schoolBreakdown).toContainText("Circuito 00002 — E1 — Synthetic school");
      await expect(schoolBreakdown.getByRole("row")).toHaveCount(3);
      await expect(schoolBreakdown).toContainText(`${33_333} votes`);

      await page.goto(new URL(
        `/fiscalizacion?electionId=${COVERAGE_SCOPE.electionId}` +
          `&categoryId=${COVERAGE_SCOPE.categoryId}&distritoCode=${COVERAGE_SCOPE.distritoCode}` +
          `&seccionCode=${COVERAGE_SCOPE.seccionCode}`, baseURL,
      ).toString());
      const coverageMain = page.getByRole("main");
      await coverageMain.getByRole("link", { name: "View official votes" }).last().click();
      await expect(page).toHaveURL(/\/drilldown\?/);
      await expect(page.getByRole("main")).toContainText("33333 votes at mesa level");
      await expect(page.getByRole("main")).not.toContainText(String(FISCALIZACION_VOTES));

      await page.goto(new URL(
        `/fiscalizacion?electionId=${COVERAGE_SCOPE.electionId}` +
          `&categoryId=${COVERAGE_SCOPE.categoryId}&distritoCode=${COVERAGE_SCOPE.distritoCode}` +
          "&seccionCode=999",
        baseURL,
      ).toString());
      await expect(page.getByRole("main").getByRole("alert")).toContainText(
        "no official mesa rows exist for the selected scope",
      );
    });
  });
});
