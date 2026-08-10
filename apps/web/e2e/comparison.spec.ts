import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

import { assertE2eEnvironment } from "./gate-contract";
import { withResultFixture } from "./result-fixture";

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

test.describe("mixed-granularity comparison is flagged in the display", () => {
  test("test_mixed_granularity_flagged_in_display_not_only_api", async ({ page }) => {
    const marker = `e2e-mixed-granularity-${randomUUID()}`;
    const categoryId = randomUUID();
    const election2023Id = randomUUID();
    const election2025Id = randomUUID();
    await withResultFixture(
      {
        category: { id: categoryId, name: marker },
        jurisdiction: {
          id: environment.NATIONAL_JURISDICTION_ID,
          distrito_code: "99",
          seccion_code: "999",
        },
        elections: [
          { id: election2023Id, year: 2023, round: `${marker}-2023` },
          { id: election2025Id, year: 2025, round: `${marker}-2025` },
        ],
        rows: [
          {
            election_id: election2023Id,
            jurisdiction_id: environment.NATIONAL_JURISDICTION_ID,
            category_id: categoryId,
            granularity: "mesa",
            list_id: null,
            votes: 10,
            archive_entry_id: `${marker}-2023`,
            source_row_index: 0,
            source_kind: "official",
          },
          {
            election_id: election2025Id,
            jurisdiction_id: environment.NATIONAL_JURISDICTION_ID,
            category_id: categoryId,
            granularity: "distrito",
            list_id: null,
            votes: 20,
            archive_entry_id: `${marker}-2025`,
            source_row_index: 0,
            source_kind: "official",
          },
        ],
        archivePrefix: marker,
      },
      async () => {
        await page.goto("/login");
        await page.getByLabel("Email").fill(environment.VOTUS_E2E_TEST_USER_EMAIL);
        await page.getByLabel("Password").fill(environment.VOTUS_E2E_TEST_USER_PASSWORD);
        await page.getByRole("button", { name: "Sign in" }).click();
        await expect(page).toHaveURL(/\/dashboard/);

        const url =
          `/compare?election2023=${election2023Id}&election2025=${election2025Id}` +
          `&jurisdictionId=${environment.NATIONAL_JURISDICTION_ID}&categoryId=${categoryId}` +
          `&partyCategory=${encodeURIComponent(marker)}&partyJurisdiction=national`;
        await page.goto(url);
        // Next.js also renders its own `role="alert"` route-announcer div, so
        // `getByRole("alert")` alone is ambiguous — scope to the page's own
        // mismatch message by its text content instead.
        const mismatchAlert = page.getByText("Mixed granularity", { exact: false });
        await expect(mismatchAlert).toBeVisible();
        await expect(mismatchAlert).toContainText("mesa");
        await expect(mismatchAlert).toContainText("distrito");
      },
    );
  });
});
