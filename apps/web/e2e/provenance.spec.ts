import { expect, test } from "@playwright/test";

import { assertE2eEnvironment } from "./gate-contract";
import {
  FISCALIZACION_VOTES,
  OFFICIAL_VOTES,
  sourceIsolationFixture,
  withResultFixture,
} from "./result-fixture";
import { resultScenarioIdentity, scenarioBaseUrl } from "./scenario-ownership";

/**
 * Threat matrix, "Unofficial-source leakage into official figures", path 3
 * of 3: the RENDERED page, independent of `repository.test.ts`'s coverage
 * of the default query (path 1) and the aggregate (path 2). Blocking one
 * path does not block the others (design.md threat matrix row), so this
 * test exercises the actual HTML the operator sees, not the API surface.
 */

const environment = assertE2eEnvironment(process.env);
const SPEC = "e2e/provenance.spec.ts";
const identity = resultScenarioIdentity(SPEC);
const { scope: SOURCE_SCOPE, seed: SOURCE_ISOLATION_FIXTURE } =
  sourceIsolationFixture(SPEC);
const baseURL = scenarioBaseUrl(SPEC, environment);
// The badge marker rendered only when a figure's `sourceKind` is
// `fiscalizacion` (see `src/components/GranularityBadge.tsx` /
// `SourceDisclaimer.tsx`, task 11.17). No page rendered without an
// explicit unofficial opt-in may ever contain it.
const FISCALIZACION_MARKER = "party-internal, unofficial";

test.describe("no fiscalización leakage into the rendered page", () => {
  test("test_rendered_page_excludes_fiscalizacion_without_opt_in", async ({ page }) => {
    await withResultFixture(SPEC, SOURCE_ISOLATION_FIXTURE, async () => {
      await page.goto(new URL("/dashboard", baseURL).toString());
      await expect(page).toHaveURL(/\/dashboard/);

      await page.goto(new URL(
        `/drilldown?electionId=${SOURCE_SCOPE.electionId}` +
          `&jurisdictionId=${SOURCE_SCOPE.jurisdictionId}&categoryId=${SOURCE_SCOPE.categoryId}` +
          `&partyCategory=${encodeURIComponent(identity.categoryName)}&partyJurisdiction=national`,
        baseURL,
      ).toString());

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
