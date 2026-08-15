import { expect, test } from "@playwright/test";

import { assertE2eEnvironment } from "./gate-contract";
import {
  FISCALIZACION_VOTES,
  OFFICIAL_VOTES,
  sourceIsolationFixture,
  withResultFixture,
} from "./result-fixture";
import { scenarioBaseUrl } from "./scenario-ownership";

const environment = assertE2eEnvironment(process.env);
const SPEC = "e2e/municipal.spec.ts";
const { scope: MUNICIPAL_SCOPE, seed: MUNICIPAL_SOURCE_ISOLATION_FIXTURE } =
  sourceIsolationFixture(SPEC);
const baseURL = scenarioBaseUrl(SPEC, environment);

test.describe("the municipal route defaults to official results", () => {
  test("test_route_renders_official_figure_without_fiscalizacion_leakage", async ({ page }) => {
    await withResultFixture(SPEC, MUNICIPAL_SOURCE_ISOLATION_FIXTURE, async () => {
      await page.goto(new URL("/dashboard", baseURL).toString());
      await expect(page).toHaveURL(/\/dashboard/);

      await page.getByRole("link", { name: "Municipal (Concejales)" }).click();
      await expect(page).toHaveURL(/\/municipal/);
      await page.goto(new URL(
        `/municipal?electionId=${MUNICIPAL_SCOPE.electionId}` +
          `&jurisdictionId=${MUNICIPAL_SCOPE.jurisdictionId}&categoryId=${MUNICIPAL_SCOPE.categoryId}`,
        baseURL,
      ).toString());

      const main = page.getByRole("main");
      await expect(main.getByRole("heading", { name: "Resultados municipales (Concejales)" })).toBeVisible();
      await expect(main).toContainText(
        `Por tipo de fuente: 1 fila oficial / ${OFFICIAL_VOTES} votos.`,
      );
      await expect(main.getByRole("status", { name: "granularidad: seccion" })).toBeVisible();
      await expect(main).toContainText(
        `1 fila fiscalización / ${FISCALIZACION_VOTES} votos se excluyeron por el filtro de fuente oficial`,
      );
      await expect(main).not.toContainText(String(OFFICIAL_VOTES + FISCALIZACION_VOTES));
      await expect(main).not.toContainText("party-internal, unofficial");
    });
  });
});
