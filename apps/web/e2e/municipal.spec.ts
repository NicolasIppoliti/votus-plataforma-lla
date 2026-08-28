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

test.describe("the municipal route requires workspace-authorized official results", () => {
  test("test_route_is_reachable_and_fails_closed_without_workspace_entitlement", async ({ page }) => {
    await withResultFixture(SPEC, MUNICIPAL_SOURCE_ISOLATION_FIXTURE, async () => {
      await page.goto(new URL("/dashboard", baseURL).toString());
      await page.getByRole("link", { name: "Análisis de concejos municipales" }).click();
      await expect(page).toHaveURL(/\/municipal$/);
      await page.getByLabel("Elección municipal").selectOption(MUNICIPAL_SCOPE.electionId);
      await page.getByRole("button", { name: "Ver resultados oficiales" }).click();
      const url = new URL(page.url());
      expect([[...url.searchParams.keys()], url.searchParams.get("electionId")]).toEqual([["electionId"], MUNICIPAL_SCOPE.electionId]);

      const main = page.getByRole("main");
      await expect(main.getByRole("heading", { name: "Municipal (Concejales)" })).toBeVisible();
      await expect(main.getByRole("alert")).toContainText("El espacio de trabajo no autoriza esta sección municipal");
      await expect(main).not.toContainText(`ALIANZA LA LIBERTAD AVANZA: ${OFFICIAL_VOTES} voto(s)`);
      await expect(main).not.toContainText("110: 1 filas");
      await expect(main.getByRole("status", { name: "granularidad: seccion" })).toHaveCount(0);
      await expect(main).not.toContainText(`1 fila fiscalización / ${FISCALIZACION_VOTES} votos`);
      await expect(main.getByRole("list", { name: "procedencia" })).toHaveCount(0);
      await expect(main).not.toContainText(String(OFFICIAL_VOTES + FISCALIZACION_VOTES));
      await expect(main).not.toContainText("party-internal, unofficial");
    });
  });
});
