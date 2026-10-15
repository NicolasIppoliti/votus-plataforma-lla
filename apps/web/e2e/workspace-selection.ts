import { expect, type Page, type TestInfo } from "@playwright/test";
import { writeWorkspaceStateFacts } from "./workspace-state-facts";
import { withReviewItem } from "./authorized-review-fixture";

export async function selectOrganizationInlineOnReview({ page }: { page: Page }, testInfo: TestInfo) {
  // Bootstrap this authenticated session before adding its sole organization.
  // New sessions with one organization auto-select it; an existing unselected
  // context must stay unselected when a membership subsequently becomes available.
  await page.goto("/review");
  const inline = page.getByRole("region", { name: "Selección de organización", exact: true });
  await expect(inline).toBeVisible();
  await expect(inline.getByRole("status").filter({ hasText: /^No hay organizaciones disponibles\.$/ })).toBeVisible();
  try {
    await withReviewItem(page, async () => {
      await page.reload();
      await writeWorkspaceStateFacts(page, testInfo, "review-inline-before-selection");
      await expect(inline).toBeVisible();
      await expect(page.getByRole("table", { name: "Elementos de revisión pendientes" })).toHaveCount(0);
      await inline.getByRole("combobox", { name: "Organización", exact: true }).selectOption({ label: "E2E Authorized Review Browser" });
      const switched = page.waitForResponse(response => response.url().endsWith("/api/workspace") && response.request().method() === "POST");
      await inline.getByRole("button", { name: "Cambiar organización" }).click();
      const response = await switched;
      expect(response.ok()).toBe(true);
      expect(await response.json()).toMatchObject({ status: "active" });
      await writeWorkspaceStateFacts(page, testInfo, "review-inline-after-switch");
      await expect(inline).toHaveCount(0);
      await expect(page.getByRole("heading", { name: "Cola de revisión", exact: true })).toBeVisible();
      await expect(page.getByRole("table", { name: "Elementos de revisión pendientes" })).toBeVisible();
      await expect(page.getByRole("main")).toContainText("Mostrando 1 de 1.");
      await expect(page).toHaveURL(/\/review$/);
    }, { selectOrganization: false });
  } catch (error) {
    await writeWorkspaceStateFacts(page, testInfo, "review-inline-failed").catch(() => {});
    throw error;
  }
}
