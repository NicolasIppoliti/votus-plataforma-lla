import { expect, type Browser, type Page, type TestInfo } from "@playwright/test";
import { writeWorkspaceStateFacts } from "./workspace-state-facts";
import { assertE2eEnvironment, emptyStorageState } from "./gate-contract";
import { withReviewItem } from "./authorized-review-fixture";

const environment = assertE2eEnvironment(process.env);

export async function selectOrganizationInlineOnReview({ page, browser }: { page: Page; browser: Browser }, testInfo: TestInfo) {
  try {
    await withReviewItem(page, async () => {
      // A fresh sign-in has its own server-side workspace context, with no selection.
      // The fixture's original context remains untouched for cleanup.
      const context = await browser.newContext({ storageState: emptyStorageState(), baseURL: new URL(page.url()).origin });
      try {
        const freshPage = await context.newPage();
        try {
          await freshPage.goto("/login");
          await freshPage.getByLabel("Correo electrónico").fill(environment.VOTUS_E2E_TEST_USER_EMAIL);
          await freshPage.getByLabel("Contraseña").fill(environment.VOTUS_E2E_TEST_USER_PASSWORD);
          await freshPage.getByRole("button", { name: "Iniciar sesión" }).click();
          await writeWorkspaceStateFacts(freshPage, testInfo, "review-inline-after-sign-in");
          await expect(freshPage).toHaveURL(/\/$/);
          await freshPage.goto("/review");
          const inline = freshPage.getByRole("region", { name: "Selección de organización", exact: true });
          await writeWorkspaceStateFacts(freshPage, testInfo, "review-inline-before-selection");
          await expect(inline).toBeVisible();
          await expect(freshPage.getByRole("table", { name: "Elementos de revisión pendientes" })).toHaveCount(0);
          await inline.getByRole("combobox", { name: "Organización", exact: true }).selectOption({ label: "E2E Authorized Review Browser" });
          const switched = freshPage.waitForResponse(response => response.url().endsWith("/api/workspace") && response.request().method() === "POST");
          await inline.getByRole("button", { name: "Cambiar organización" }).click();
          const response = await switched;
          expect(response.ok()).toBe(true);
          expect(await response.json()).toMatchObject({ status: "active" });
          await writeWorkspaceStateFacts(freshPage, testInfo, "review-inline-after-switch");
          await expect(inline).toHaveCount(0);
          await expect(freshPage.getByRole("heading", { name: "Cola de revisión", exact: true })).toBeVisible();
          await expect(freshPage.getByRole("table", { name: "Elementos de revisión pendientes" })).toBeVisible();
          await expect(freshPage.getByRole("main")).toContainText("Mostrando 1 de 1.");
          await expect(freshPage).toHaveURL(/\/review$/);
        } catch (error) {
          await writeWorkspaceStateFacts(freshPage, testInfo, "review-inline-failed").catch(() => {});
          throw error;
        }
      } finally {
        await context.close();
      }
    });
  } catch (error) {
    // Also cover fixture setup failures, before a fresh page exists. Never log
    // the raw error: it may contain fixture identities or request details.
    await writeWorkspaceStateFacts(page, testInfo, "review-fixture-failed").catch(() => {});
    throw error;
  }
}
