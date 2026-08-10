import { expect, test } from "@playwright/test";

import { assertE2eEnvironment } from "./gate-contract";
import {
  FISCALIZACION_VOTES,
  OFFICIAL_VOTES,
  SOURCE_ISOLATION_FIXTURE,
  SOURCE_SCOPE,
  withResultFixture,
} from "./result-fixture";

/**
 * fiscalizacion-analysis spec, "An operator route reaches fiscalización
 * through the opt-in path" (Requirement 8, task 13.11) — `provenance.spec.ts`
 * already proves the DEFAULT page never leaks a fiscalización marker
 * (path 3 of the threat matrix); this spec proves the OPPOSITE direction:
 * the dedicated `/fiscalizacion` route, reached through the opt-in path,
 * renders labelled unofficial figures with their coverage denominator.
 */

const environment = assertE2eEnvironment(process.env);

test.describe("the fiscalizacion route renders labelled unofficial figures", () => {
  test("test_route_renders_labelled_unofficial_figures", async ({ page }) => {
    await withResultFixture(SOURCE_ISOLATION_FIXTURE, async () => {
      await page.goto("/login");
      await page.getByLabel("Email").fill(environment.VOTUS_E2E_TEST_USER_EMAIL);
      await page.getByLabel("Password").fill(environment.VOTUS_E2E_TEST_USER_PASSWORD);
      await page.getByRole("button", { name: "Sign in" }).click();
      await expect(page).toHaveURL(/\/dashboard/);

      // Reachable from the authenticated layout (task 13.10), not merely
      // addressable by URL.
      await page.getByRole("link", { name: /Fiscalización/ }).click();
      await expect(page).toHaveURL(/\/fiscalizacion/);
      await page.goto(
        `/fiscalizacion?electionId=${SOURCE_SCOPE.electionId}` +
          `&jurisdictionId=${SOURCE_SCOPE.jurisdictionId}&categoryId=${SOURCE_SCOPE.categoryId}`,
      );

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
