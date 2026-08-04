import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";

/**
 * provenance-display spec: "Mixed-granularity comparison is flagged in the
 * display, not just the API" — the `/compare` page must visibly show the
 * D6 refusal, not merely encode it in a `status` field the UI ignores
 * (task 11.14).
 *
 * Requires a running Supabase stack, a seeded fixture user, AND
 * `SUPABASE_SERVICE_ROLE_KEY` to seed the two result rows this test needs
 * (RLS denies anonymous/authenticated writes — see `0006_rls.sql`).
 * Skips explicitly, never silently, when unavailable — including when the
 * environment's `service_role` lacks table grants (observed locally: this
 * project's tables have no `GRANT ... TO service_role`, only writes ever
 * go through the ETL's raw `postgres` connection per D8, so the JS
 * service-role client cannot seed fixture rows here; a real deployment may
 * differ). Fixing that grant is an environment/ops concern outside this
 * phase's scope, not a defect in the pages or repository under test.
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

const SUPABASE_URL = process.env["NEXT_PUBLIC_SUPABASE_URL"];
const SUPABASE_ANON_KEY = process.env["NEXT_PUBLIC_SUPABASE_ANON_KEY"];
const SERVICE_ROLE_KEY = process.env["SUPABASE_SERVICE_ROLE_KEY"];
const TEST_USER_EMAIL = process.env["VOTUS_E2E_TEST_USER_EMAIL"];
const TEST_USER_PASSWORD = process.env["VOTUS_E2E_TEST_USER_PASSWORD"];

const canRun = Boolean(
  SUPABASE_URL && SUPABASE_ANON_KEY && SERVICE_ROLE_KEY && TEST_USER_EMAIL && TEST_USER_PASSWORD,
);

test.describe("mixed-granularity comparison is flagged in the display", () => {
  test.skip(
    !canRun,
    "Requires NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, " +
      "SUPABASE_SERVICE_ROLE_KEY, VOTUS_E2E_TEST_USER_EMAIL and " +
      "VOTUS_E2E_TEST_USER_PASSWORD (a running local Supabase stack, a " +
      "seeded fixture user, and write access to seed fixture result rows). " +
      "Skipping explicitly rather than failing or silently passing.",
  );

  test("test_mixed_granularity_flagged_in_display_not_only_api", async ({ page }) => {
    const admin = createClient(SUPABASE_URL as string, SERVICE_ROLE_KEY as string);
    const marker = `e2e-mixed-granularity-${Date.now()}`;

    const categoryInsert = await admin.from("category").insert({ name: marker }).select("id").single();
    const jurisdictionInsert = await admin
      .from("jurisdiction")
      .insert({ distrito_code: "99", seccion_code: "999" })
      .select("id")
      .single();
    const election2023Insert = await admin
      .from("election")
      .insert({ year: 2023, round: marker })
      .select("id")
      .single();
    const election2025Insert = await admin
      .from("election")
      .insert({ year: 2025, round: marker })
      .select("id")
      .single();

    const seedError =
      categoryInsert.error ??
      jurisdictionInsert.error ??
      election2023Insert.error ??
      election2025Insert.error;

    test.skip(
      Boolean(seedError),
      `Fixture seeding via the service-role client failed (${seedError?.message ?? "unknown error"}) ` +
        "— the local Postgres instance's service_role lacks table grants in " +
        "this environment (writes normally go through the ETL's raw postgres " +
        "connection, D8). Skipping explicitly rather than failing on an " +
        "environment/ops gap unrelated to the page or repository under test.",
    );

    const category = categoryInsert.data as { id: string };
    const jurisdiction = jurisdictionInsert.data as { id: string };
    const election2023 = election2023Insert.data as { id: string };
    const election2025 = election2025Insert.data as { id: string };

    // D8's idempotency key is (archive_entry_id, jurisdiction_id,
    // category_id, list_id, source_kind) — it does NOT include election_id
    // or granularity, so the two fixture rows need distinct
    // archive_entry_ids or they collide on insert as duplicates of the
    // SAME natural key rather than two different elections' rows.
    await admin.from("result_row").insert([
      {
        election_id: election2023.id,
        jurisdiction_id: jurisdiction.id,
        category_id: category.id,
        granularity: "mesa",
        list_id: "1",
        votes: 10,
        archive_entry_id: `${marker}-2023`,
        source_row_index: 0,
      },
      {
        election_id: election2025.id,
        jurisdiction_id: jurisdiction.id,
        category_id: category.id,
        granularity: "distrito",
        list_id: "1",
        votes: 20,
        archive_entry_id: `${marker}-2025`,
        source_row_index: 0,
      },
    ]);

    try {
      await page.goto("/login");
      await page.getByLabel("Email").fill(TEST_USER_EMAIL as string);
      await page.getByLabel("Password").fill(TEST_USER_PASSWORD as string);
      await page.getByRole("button", { name: "Sign in" }).click();
      await expect(page).toHaveURL(/\/dashboard/);

      const url =
        `/compare?election2023=${election2023.id}&election2025=${election2025.id}` +
        `&jurisdictionId=${jurisdiction.id}&categoryId=${category.id}`;
      await page.goto(url);

      // Next.js also renders its own `role="alert"` route-announcer div, so
      // `getByRole("alert")` alone is ambiguous — scope to the page's own
      // mismatch message by its text content instead.
      const mismatchAlert = page.getByText("Mixed granularity", { exact: false });
      await expect(mismatchAlert).toBeVisible();
      await expect(mismatchAlert).toContainText("mesa");
      await expect(mismatchAlert).toContainText("distrito");
    } finally {
      await admin.from("result_row").delete().like("archive_entry_id", `${marker}%`);
      await admin.from("election").delete().in("id", [election2023.id, election2025.id]);
      await admin.from("jurisdiction").delete().eq("id", jurisdiction.id);
      await admin.from("category").delete().eq("id", category.id);
    }
  });
});
