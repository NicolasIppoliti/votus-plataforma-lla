import { expect, test } from "@playwright/test";

/**
 * Threat matrix, "Unofficial-source leakage into official figures", path 3
 * of 3: the RENDERED page, independent of `repository.test.ts`'s coverage
 * of the default query (path 1) and the aggregate (path 2). Blocking one
 * path does not block the others (design.md threat matrix row), so this
 * test exercises the actual HTML the operator sees, not the API surface.
 *
 * Requires a running Supabase stack and a seeded fixture user (same
 * contract as `e2e/auth.spec.ts`). Skips explicitly, never silently, when
 * unavailable — see apps/web/environment-variables.example.txt.
 */

const SUPABASE_URL = process.env["NEXT_PUBLIC_SUPABASE_URL"];
const SUPABASE_ANON_KEY = process.env["NEXT_PUBLIC_SUPABASE_ANON_KEY"];
const TEST_USER_EMAIL = process.env["VOTUS_E2E_TEST_USER_EMAIL"];
const TEST_USER_PASSWORD = process.env["VOTUS_E2E_TEST_USER_PASSWORD"];

const hasE2eCredentials = Boolean(
  SUPABASE_URL && SUPABASE_ANON_KEY && TEST_USER_EMAIL && TEST_USER_PASSWORD,
);

// The badge marker rendered only when a figure's `sourceKind` is
// `fiscalizacion` (see `src/components/GranularityBadge.tsx` /
// `SourceDisclaimer.tsx`, task 11.17). No page rendered without an
// explicit unofficial opt-in may ever contain it.
const FISCALIZACION_MARKER = "party-internal, unofficial";

test.describe("no fiscalización leakage into the rendered page", () => {
  test.skip(
    !hasE2eCredentials,
    "Requires NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, " +
      "VOTUS_E2E_TEST_USER_EMAIL and VOTUS_E2E_TEST_USER_PASSWORD in the " +
      "environment (a running local Supabase stack plus a seeded fixture " +
      "user). None are committed to the repo — see " +
      "apps/web/environment-variables.example.txt. Skipping explicitly " +
      "rather than failing or silently passing.",
  );

  test("test_rendered_page_excludes_fiscalizacion_without_opt_in", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(TEST_USER_EMAIL as string);
    await page.getByLabel("Password").fill(TEST_USER_PASSWORD as string);
    await page.getByRole("button", { name: "Sign in" }).click();

    // The default comparison view — no fiscalización opt-in requested —
    // must not surface the unofficial-source marker anywhere in the
    // rendered HTML, even though the underlying data may include
    // fiscalización rows in Postgres.
    await page.goto("/compare");
    expect(await page.content()).not.toContain(FISCALIZACION_MARKER);

    // The disclaimer required by provenance-display MUST still be present
    // — this test is about the fiscalización badge specifically, not a
    // claim that the page shows no provenance affordances at all.
    await expect(page.getByText("not an official electoral source")).toBeVisible();
  });
});
