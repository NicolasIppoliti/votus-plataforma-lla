import { expect, test } from "@playwright/test";

import { assertE2eEnvironment } from "./gate-contract";
import { withResultFixture } from "./result-fixture";
import { resultScenarioIdentity, scenarioBaseUrl } from "./scenario-ownership";

/**
 * provenance-display spec: "Mixed-granularity comparison is flagged in the
 * display, not just the API" — the `/compare` page must visibly show the
 * D6 refusal, not merely encode it in a `status` field the UI ignores
 * (task 11.14).
 *
 * Simplification, disclosed: real ingestion never produces two elections'
 * rows sharing one `jurisdiction_id` at different `granularity` values —
 * a genuine mismatch comes from jurisdiction LINEAGE differing between
 * years (jurisdiction-model territory, not this phase's scope). This test
 * seeds that shape directly at the table level specifically to exercise
 * `compare.ts`'s refusal path end-to-end through the real page, which is
 * exactly what this task needs: proof the DISPLAY flags it, not a claim
 * about how ingestion produces the mismatch.
 */

const environment = assertE2eEnvironment(process.env);
const SPEC = "e2e/comparison.spec.ts";
const identity = resultScenarioIdentity(SPEC);
const baseURL = scenarioBaseUrl(SPEC, environment);

test.describe("mixed-granularity comparison is flagged in the display", () => {
  test("test_mixed_granularity_flagged_in_display_not_only_api", async ({ page }) => {
    const marker = identity.categoryName;
    const categoryId = identity.categoryId;
    const [election2023Id, election2025Id] = identity.electionIds;
    if (!election2023Id || !election2025Id) throw new Error("comparison identity is incomplete");
    await withResultFixture(
      SPEC,
      {
        category: { id: categoryId, name: marker },
        jurisdictions: [{
          id: identity.jurisdictionId,
          distrito_code: identity.distritoCode,
          seccion_code: identity.seccionCode,
        }],
        elections: [
          { id: election2023Id, year: identity.electionYears[0]!, round: identity.electionRounds[0]! },
          { id: election2025Id, year: identity.electionYears[1]!, round: identity.electionRounds[1]! },
        ],
        rows: [
          {
            election_id: election2023Id,
            jurisdiction_id: identity.jurisdictionId,
            category_id: categoryId,
            granularity: "mesa",
            list_id: null,
            votes: 10,
            archive_entry_id: identity.archiveEntryIds[0]!,
            source_row_index: 0,
            source_kind: "official",
          },
          {
            election_id: election2025Id,
            jurisdiction_id: identity.jurisdictionId,
            category_id: categoryId,
            granularity: "distrito",
            list_id: null,
            votes: 20,
            archive_entry_id: identity.archiveEntryIds[1]!,
            source_row_index: 0,
            source_kind: "official",
          },
        ],
      },
      async () => {
        await page.goto(new URL("/dashboard", baseURL).toString());
        await expect(page).toHaveURL(/\/dashboard/);

        const url =
          `/compare?election2023=${election2023Id}&election2025=${election2025Id}` +
          `&jurisdictionId=${identity.jurisdictionId}&categoryId=${categoryId}` +
          `&partyCategory=${encodeURIComponent(marker)}&partyJurisdiction=national`;
        await page.goto(new URL(url, baseURL).toString());
        // Next.js also renders its own `role="alert"` route-announcer div, so
        // `getByRole("alert")` alone is ambiguous — scope to the page's own
        // mismatch message by its text content instead.
        const mismatchAlert = page.getByText("Granularidad mixta", { exact: false });
        await expect(mismatchAlert).toBeVisible();
        await expect(mismatchAlert).toContainText("mesa");
        await expect(mismatchAlert).toContainText("distrito");
      },
    );
  });
});
