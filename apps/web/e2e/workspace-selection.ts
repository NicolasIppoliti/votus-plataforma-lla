import { expect, type Page, type TestInfo } from "@playwright/test";
import { writeWorkspaceStateFacts } from "./workspace-state-facts";
import { withReviewItem } from "./authorized-review-fixture";

export async function selectOrganizationOnboardingOnReview({ page }: { page: Page }, testInfo: TestInfo) {
  // Bootstrap this authenticated session before adding its sole organization.
  // New sessions with one organization auto-select it; an existing unselected
  // context must stay unselected when a membership subsequently becomes available.
  await page.goto("/review");
  const inline = page.getByRole("region", { name: "Elegí tu organización", exact: true });
  await expect(page).toHaveURL(url => url.pathname === "/onboarding" && url.searchParams.get("returnTo") === "/review");
  await expect(inline).toBeVisible();
  await expect(inline.getByRole("status").filter({ hasText: /^No hay organizaciones disponibles\. Pedile acceso a quien administra tu organización\.$/ })).toBeVisible();
  try {
    await withReviewItem(page, async () => {
      await page.reload();
      await writeWorkspaceStateFacts(page, testInfo, "review-inline-before-selection");
      await expect(inline).toBeVisible();
      await expect(page.getByRole("table", { name: "Elementos de revisión pendientes" })).toHaveCount(0);
      await inline.getByRole("combobox", { name: "Organización", exact: true }).selectOption({ label: "E2E Authorized Review Browser" });
      await inline.getByRole("button", { name: "Continuar con esta organización", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Tu alcance de trabajo", exact: true })).toBeVisible();
      const state = await page.request.get("/api/workspace");
      expect(state.ok()).toBe(true);
      expect(await state.json()).toMatchObject({ status: "active", onboardingCompleted: false });
      await expect(page.getByRole("table", { name: "Elementos de revisión pendientes" })).toHaveCount(0);
      await page.getByRole("link", { name: "Continuar a la guía", exact: true }).click();
      await page.getByRole("link", { name: "Continuar", exact: true }).click();
      await page.getByRole("button", { name: "Ingresar a Votus", exact: true }).click();
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
