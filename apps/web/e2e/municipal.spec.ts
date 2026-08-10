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
      await expect(main.getByRole("heading", { name: "Municipal (Concejales)" })).toBeVisible();
      await expect(main).toContainText(
        `By source kind: 1 official row(s) / ${OFFICIAL_VOTES} vote(s).`,
      );
      await expect(main.getByRole("status", { name: "granularity: seccion" })).toBeVisible();
      await expect(main).toContainText(
        `1 fiscalizacion row(s) / ${FISCALIZACION_VOTES} vote(s) were excluded by the official-source filter`,
      );
      await expect(main).not.toContainText(String(OFFICIAL_VOTES + FISCALIZACION_VOTES));
      await expect(main).not.toContainText("party-internal, unofficial");
    });
  });
});
