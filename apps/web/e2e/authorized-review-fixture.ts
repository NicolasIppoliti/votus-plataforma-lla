import { createClient } from "@supabase/supabase-js";
import { expect, type Page } from "@playwright/test";
import { assertE2eEnvironment } from "./gate-contract";

export const REVIEW_ITEM = {
  id: "00000000-0000-4000-8000-000000000024",
  kind: "pba_conflicting_duplicate_semantic_result",
  severity: "warning",
  subject_ref: `official-import/2025/general/mesa/${"subject-segment-".repeat(8)}`,
  detected_at: "2026-08-13T12:34:56.789Z",
  note: `The official mesa identity needs manual review because ${"the source lineage remains ambiguous; ".repeat(6)}`,
} as const;

export async function withReviewItem<T>(page: Page, run: () => Promise<T>): Promise<T> {
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
    await page.goto("/");
    const trigger = page.getByRole("button", { name: "Abrir navegación" });
    const mobile = await trigger.isVisible();
    if (mobile) await trigger.click();
    const organizationSelector = page.getByRole("combobox", { name: "Organización", exact: true });
    await expect(organizationSelector).toBeVisible();
    await organizationSelector.selectOption(fixture.organization_id);
    const switchResponse = page.waitForResponse((response) => response.url().endsWith("/api/workspace") && response.request().method() === "POST");
    await page.getByRole("button", { name: "Cambiar organización" }).click();
    const response = await switchResponse;
    expect({ ok: response.ok(), body: await response.json() }).toMatchObject({ ok: true, body: { status: "active" } });
    if (mobile) await page.getByRole("button", { name: "Cerrar navegación" }).click();
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
