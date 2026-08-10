import { expect, test } from "@playwright/test";

import { assertE2eEnvironment } from "./gate-contract";
import {
  FISCALIZACION_VOTES,
  OFFICIAL_VOTES,
  sourceIsolationFixture,
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
const { scope: SOURCE_SCOPE, seed: SOURCE_ISOLATION_FIXTURE } =
  sourceIsolationFixture(SPEC);
const baseURL = scenarioBaseUrl(SPEC, environment);

test.describe("the fiscalizacion route renders labelled unofficial figures", () => {
  test("test_route_renders_labelled_unofficial_figures", async ({ page }) => {
    await withResultFixture(SPEC, SOURCE_ISOLATION_FIXTURE, async () => {
      await page.goto(new URL("/dashboard", baseURL).toString());
      await expect(page).toHaveURL(/\/dashboard/);

      // Reachable from the authenticated layout (task 13.10), not merely
      // addressable by URL.
      await page.getByRole("link", { name: /Fiscalización/ }).click();
      await expect(page).toHaveURL(/\/fiscalizacion/);
      await page.goto(new URL(
        `/fiscalizacion?electionId=${SOURCE_SCOPE.electionId}` +
          `&jurisdictionId=${SOURCE_SCOPE.jurisdictionId}&categoryId=${SOURCE_SCOPE.categoryId}`,
        baseURL,
      ).toString());

      const main = page.getByRole("main");
      await expect(main.getByText(
        "Unofficial source — party-internal fiscalización, not an official Junta Electoral result.",
        { exact: true },
      )).toBeVisible();
      await expect(main).toContainText("Coverage: 93 of 153 mesas");
      await expect(main).toContainText("not a random sample");
      await expect(main).toContainText(
        `1 official row(s) / ${OFFICIAL_VOTES} vote(s) were excluded by the fiscalización-source filter`,
      );
      await expect(main).toContainText(
        `By source kind: 1 fiscalizacion row(s) / ${FISCALIZACION_VOTES} vote(s).`,
      );
      await expect(main).not.toContainText(String(OFFICIAL_VOTES + FISCALIZACION_VOTES));
    });
  });
});
