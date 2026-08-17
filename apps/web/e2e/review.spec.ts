import { expect, test } from "@playwright/test";

test.describe("the review route reflects the disposable database", () => {
  test("test_authenticated_route_renders_truthful_empty_queue", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/dashboard/);

    await page.getByRole("navigation", { name: "principal" }).getByRole("link", { name: "Revisión", exact: true }).click();
    await expect(page).toHaveURL(/\/review/);
    const main = page.getByRole("main");
    await expect(main.getByRole("heading", { name: "Cola de revisión" })).toBeVisible();
    await expect(main).toContainText("No hay elementos de revisión pendientes.");
    await expect(main.getByRole("table")).toHaveCount(0);
  });
});
