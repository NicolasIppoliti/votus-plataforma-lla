import { expect, test } from "@playwright/test";

const READ_ONLY_NOTICE =
  "Esta pantalla es solo de consulta. Puede inspeccionar los elementos pendientes, pero no modificarlos ni resolverlos aquí.";

test.describe("the review route reflects the disposable database", () => {
  test("test_authenticated_route_renders_truthful_empty_queue", async ({ page }) => {
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
    await expect(main).toContainText("No hay elementos de revisión pendientes.");
    await expect(main.getByRole("table")).toHaveCount(0);
  });
});
