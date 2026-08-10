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
 * Threat matrix, "Unofficial-source leakage into official figures", path 3
 * of 3: the RENDERED page, independent of `repository.test.ts`'s coverage
 * of the default query (path 1) and the aggregate (path 2). Blocking one
 * path does not block the others (design.md threat matrix row), so this
 * test exercises the actual HTML the operator sees, not the API surface.
 */

const environment = assertE2eEnvironment(process.env);
// The badge marker rendered only when a figure's `sourceKind` is
// `fiscalizacion` (see `src/components/GranularityBadge.tsx` /
// `SourceDisclaimer.tsx`, task 11.17). No page rendered without an
// explicit unofficial opt-in may ever contain it.
const FISCALIZACION_MARKER = "party-internal, unofficial";

test.describe("no fiscalización leakage into the rendered page", () => {
  test("test_rendered_page_excludes_fiscalizacion_without_opt_in", async ({ page }) => {
    await withResultFixture(SOURCE_ISOLATION_FIXTURE, async () => {
      await page.goto("/login");
      await page.getByLabel("Email").fill(environment.VOTUS_E2E_TEST_USER_EMAIL);
      await page.getByLabel("Password").fill(environment.VOTUS_E2E_TEST_USER_PASSWORD);
      await page.getByRole("button", { name: "Sign in" }).click();
      // Wait for the client-side sign-in to actually set the session cookie
      // (visible as the redirect to /dashboard) before navigating away —
      // otherwise the next `goto` can race ahead of authentication and land
      // back on /login, which would make this test pass for the wrong
      // reason (no page reached at all, not a genuine leakage check).
      await expect(page).toHaveURL(/\/dashboard/);

      await page.goto(
        `/drilldown?electionId=${SOURCE_SCOPE.electionId}` +
          `&jurisdictionId=${SOURCE_SCOPE.jurisdictionId}&categoryId=${SOURCE_SCOPE.categoryId}` +
          `&partyCategory=${encodeURIComponent("DIPUTADO NACIONAL")}&partyJurisdiction=national`,
      );

      const main = page.getByRole("main");
      const officialTotal = main.getByRole("note").filter({ hasText: "Official total:" });
      await expect(officialTotal).toContainText(`Official total: ${OFFICIAL_VOTES} votes`);
      await expect(officialTotal).not.toContainText(String(FISCALIZACION_VOTES));
      await expect(main).toContainText(
        `1 fiscalizacion row(s) / ${FISCALIZACION_VOTES} vote(s) were excluded by the official-source filter`,
      );
      await expect(main).not.toContainText(FISCALIZACION_MARKER);
      await expect(main).not.toContainText(`Official total: ${OFFICIAL_VOTES + FISCALIZACION_VOTES}`);
    });
  });
});
