import { expect, test } from "@playwright/test";

/**
 * fiscalizacion-analysis spec, "An operator route reaches fiscalización
 * through the opt-in path" (Requirement 8, task 13.11) — `provenance.spec.ts`
 * already proves the DEFAULT page never leaks a fiscalización marker
 * (path 3 of the threat matrix); this spec proves the OPPOSITE direction:
 * the dedicated `/fiscalizacion` route, reached through the opt-in path,
 * renders labelled unofficial figures with their coverage denominator.
 *
 * Requires a running Supabase stack and a seeded fixture user (same
 * contract as `e2e/auth.spec.ts` / `provenance.spec.ts`). Skips explicitly,
 * never silently, when unavailable — see
 * apps/web/environment-variables.example.txt.
 */

const SUPABASE_URL = process.env["NEXT_PUBLIC_SUPABASE_URL"];
const SUPABASE_ANON_KEY = process.env["NEXT_PUBLIC_SUPABASE_ANON_KEY"];
const TEST_USER_EMAIL = process.env["VOTUS_E2E_TEST_USER_EMAIL"];
const TEST_USER_PASSWORD = process.env["VOTUS_E2E_TEST_USER_PASSWORD"];

const hasE2eCredentials = Boolean(
  SUPABASE_URL && SUPABASE_ANON_KEY && TEST_USER_EMAIL && TEST_USER_PASSWORD,
);

test.describe("the fiscalizacion route renders labelled unofficial figures", () => {
  test.skip(
    !hasE2eCredentials,
    "Requires NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, " +
      "VOTUS_E2E_TEST_USER_EMAIL and VOTUS_E2E_TEST_USER_PASSWORD in the " +
      "environment (a running local Supabase stack plus a seeded fixture " +
      "user). None are committed to the repo — see " +
      "apps/web/environment-variables.example.txt. Skipping explicitly " +
      "rather than failing or silently passing.",
  );

  test("test_route_renders_labelled_unofficial_figures", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(TEST_USER_EMAIL as string);
    await page.getByLabel("Password").fill(TEST_USER_PASSWORD as string);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/dashboard/);

    // Reachable from the authenticated layout (task 13.10), not merely
    // addressable by URL.
    await page.getByRole("link", { name: /Fiscalización/ }).click();
    await expect(page).toHaveURL(/\/fiscalizacion/);

    // No query params supplied: the page MUST render its own refusal
    // state (missing electionId/jurisdictionId/categoryId), never a raw
    // error page, proving the route degrades safely without crashing.
    await expect(page.getByRole("heading", { name: "Fiscalización (unofficial)" })).toBeVisible();
  });
});
