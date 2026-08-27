import { createClient } from "@supabase/supabase-js";
import { expect, test, type Locator, type Page } from "@playwright/test";

import { assertE2eEnvironment } from "./gate-contract";

const READ_ONLY_NOTICE =
  "Esta pantalla es solo de consulta. Puede inspeccionar los elementos pendientes, pero no modificarlos ni resolverlos aquí.";
const REVIEW_REGION_LABEL = "Elementos de revisión pendientes";
const REVIEW_ITEM = {
  id: "00000000-0000-4000-8000-000000000024",
  kind: "pba_conflicting_duplicate_semantic_result",
  severity: "warning",
  subject_ref: `official-import/2025/general/mesa/${"subject-segment-".repeat(8)}`,
  detected_at: "2026-08-13T12:34:56.789Z",
  note: `The official mesa identity needs manual review because ${"the source lineage remains ambiguous; ".repeat(6)}`,
} as const;

async function withReviewItem<T>(page: Page, run: () => Promise<T>): Promise<T> {
  const environment = assertE2eEnvironment(process.env);
  const admin = createClient(
    environment.NEXT_PUBLIC_SUPABASE_URL,
    environment.SUPABASE_SERVICE_ROLE_KEY,
  );
  const { error: insertError } = await admin
    .from("review_item")
    .insert(REVIEW_ITEM);
  if (insertError) {
    throw new Error(`failed to seed review item: ${insertError.message}`);
  }
  const { data: auth, error: authError } = await admin.auth.admin.listUsers();
  const user = auth?.users.find((candidate) => candidate.email?.toLowerCase() === environment.VOTUS_E2E_TEST_USER_EMAIL.toLowerCase()); if (authError || !user) { const cause = new Error(`failed to resolve fixture user: ${authError?.message ?? "user missing"}`); const { error } = await admin.from("review_item").delete().eq("id", REVIEW_ITEM.id); if (error) throw new AggregateError([cause, new Error(error.message)], "review fixture setup and cleanup failed"); throw cause; }
  const { data: fixture, error: fixtureError } = await admin.rpc("e2e_setup_authorized_review_fixture", { p_user_id: user.id, p_review_item_id: REVIEW_ITEM.id }); if (fixtureError || typeof fixture?.organization_id !== "string") { const cause = new Error(`failed to set up authorized review fixture: ${fixtureError?.message ?? "invalid response"}`); const cleanup = fixtureError ? await admin.from("review_item").delete().eq("id", REVIEW_ITEM.id) : await admin.rpc("e2e_cleanup_authorized_review_fixture", { p_fixture: fixture }); if (cleanup.error) throw new AggregateError([cause, new Error(cleanup.error.message)], "review fixture setup and cleanup failed"); throw cause; }

  let outcome: { value: T } | { error: unknown }; let cleanupError: { message: string } | null;
  try {
    const bootstrap = await page.request.get("/api/workspace"); expect(bootstrap.ok()).toBe(true); const workspace = await bootstrap.json() as { current?: { context_revision?: unknown } };
    const expectedRevision = workspace.current?.context_revision; if (typeof expectedRevision !== "number" || !Number.isSafeInteger(expectedRevision) || expectedRevision < 1) throw new Error("workspace bootstrap returned an invalid revision");
    const switched = await page.request.post("/api/workspace", { data: { organizationId: fixture.organization_id, expectedRevision } }); expect(switched.ok()).toBe(true); await expect(switched.json()).resolves.toMatchObject({ status: "active" });
    outcome = { value: await run() };
  } catch (error) {
    outcome = { error };
  } finally {
    ({ error: cleanupError } = await admin.rpc("e2e_cleanup_authorized_review_fixture", { p_fixture: fixture }));
  }

  if ("error" in outcome) {
    if (cleanupError) {
      throw new AggregateError(
        [outcome.error, new Error(cleanupError.message)],
        "review assertion and fixture cleanup failed",
      );
    }
    throw outcome.error;
  }
  if (cleanupError) {
    throw new Error(`failed to clean review item: ${cleanupError.message}`);
  }
  return outcome.value;
}

async function expectDocumentNotToOverflow(page: Page): Promise<void> {
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
}

async function expectCellTextContained(row: Locator): Promise<void> {
  const violations = await row.getByRole("cell").evaluateAll((cells) =>
    cells.flatMap((cell, cellIndex) => {
      const cellRect = cell.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(cell);
      return Array.from(range.getClientRects()).flatMap(
        (textRect, lineIndex) => {
          const tolerance = 1;
          const contained =
            textRect.left >= cellRect.left - tolerance &&
            textRect.right <= cellRect.right + tolerance &&
            textRect.top >= cellRect.top - tolerance &&
            textRect.bottom <= cellRect.bottom + tolerance;
          return contained
            ? []
            : [
                {
                  cellIndex,
                  lineIndex,
                  cellLeft: cellRect.left,
                  cellRight: cellRect.right,
                  textLeft: textRect.left,
                  textRight: textRect.right,
                },
              ];
        },
      );
    }),
  );
  expect(
    violations,
    "every text range must remain inside its own cell",
  ).toEqual([]);
}

async function expectPopulatedReviewLayout(
  page: Page,
  viewport: { width: number; height: number },
  expectTableOverflow: boolean,
): Promise<void> {
  await page.setViewportSize(viewport);
  await page.evaluate(async () => {
    await document.fonts.ready;
  });

  const region = page.getByRole("region", { name: REVIEW_REGION_LABEL });
  await expect(region).toBeVisible();
  await expect(region).toHaveAttribute("tabindex", "0");
  await region.focus();
  await expect(region).toBeFocused();
  await expectDocumentNotToOverflow(page);

  const scrollDimensions = await region.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  if (expectTableOverflow) {
    expect(scrollDimensions.scrollWidth).toBeGreaterThan(
      scrollDimensions.clientWidth,
    );
  } else {
    expect(scrollDimensions.scrollWidth).toBeLessThanOrEqual(
      scrollDimensions.clientWidth,
    );
  }

  const table = page.getByRole("table", { name: REVIEW_REGION_LABEL });
  const row = table.locator("tbody").getByRole("row");
  await expect(row).toHaveCount(1);
  const cells = row.getByRole("cell");
  await expect(cells).toHaveCount(5);
  await expect(cells.nth(0)).toHaveText(REVIEW_ITEM.kind);
  await expect(cells.nth(1)).toHaveText(REVIEW_ITEM.severity);
  await expect(cells.nth(2)).toHaveText(REVIEW_ITEM.subject_ref);
  await expect(cells.nth(3)).toContainText("2026-08-13T12:34:56.789");
  await expect(cells.nth(4)).toHaveText(REVIEW_ITEM.note);
  await expectCellTextContained(row);
}

test.describe("the review route reflects the disposable database", () => {
  test("test_authenticated_route_contains_long_review_evidence_without_page_overflow", async ({
    page,
  }) => {
    await withReviewItem(page, async () => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto("/dashboard");
      await expect(page).toHaveURL(/\/dashboard/);

      const dashboardMain = page.getByRole("main");
      await dashboardMain
        .getByRole("link", { name: "Revisión", exact: true })
        .click();

      await expect(page).toHaveURL(/\/review/);
      const main = page.getByRole("main");
      await expect(
        main.getByRole("heading", { name: "Cola de revisión" }),
      ).toBeVisible();
      await expect(main).toContainText(READ_ONLY_NOTICE);
      await expect(
        main.getByText("Resolver elementos de revisión", { exact: true }),
      ).toHaveCount(0);
      await expectPopulatedReviewLayout(
        page,
        { width: 390, height: 844 },
        true,
      );
      await expectPopulatedReviewLayout(
        page,
        { width: 1280, height: 900 },
        false,
      );
    });

    await page.reload();
    const main = page.getByRole("main");
    await expect(main).toContainText(READ_ONLY_NOTICE);
    await expect(main).toContainText(
      "No hay elementos de revisión pendientes.",
    );
    await expect(main.getByRole("table")).toHaveCount(0);
    await expectDocumentNotToOverflow(page);
  });
});
