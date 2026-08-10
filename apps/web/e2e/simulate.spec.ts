import { expect, test } from "@playwright/test";

const PROJECTION = {
  level: "pba_municipal",
  totalVotes: 10_000,
  blankVotes: 0,
  annulledVotes: 0,
  unmodeledVotes: 0,
  unmodeledVoteBreakdown: [],
  seatsToFill: 9,
  isProjection: true,
  granularity: "seccion",
  lists: [
    { listId: "A", listName: "Projection list A", votes: 6_000 },
    { listId: "B", listName: "Projection list B", votes: 4_000 },
  ],
};

test.describe("the simulation route labels caller-supplied projections", () => {
  test("test_projection_discloses_input_method_and_non_provenance", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/dashboard/);

    await page.getByRole("link", { name: "Seat simulation" }).click();
    await expect(page).toHaveURL(/\/simulate/);
    await page.goto(`/simulate?input=${encodeURIComponent(JSON.stringify(PROJECTION))}`);

    const result = page.getByRole("region", { name: "allocation-result" });
    await expect(result.getByRole("heading", { name: "Result (pba_municipal)" })).toBeVisible();
    await expect(result).toContainText("Projection (hypothetical, caller supplied)");
    await expect(result.getByRole("status", { name: "granularity: seccion" })).toBeVisible();
    await expect(result).toContainText(/Supplied-input trace \(not archive provenance\): sha256 [a-f0-9]{64}/);
    await expect(result.getByRole("heading", { name: "Hare quota with largest remainder" })).toBeVisible();
    await expect(result).toContainText("Statutory method: Ley 5109 Arts. 109–110");
    await expect(result.getByRole("link", { name: /archive|source/i })).toHaveCount(0);
    await expect(result).not.toContainText("Official historical result");
  });
});
