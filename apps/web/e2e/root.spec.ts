import { expect, request, test } from "@playwright/test";

import { assertE2eEnvironment, emptyStorageState } from "./gate-contract";

const environment = assertE2eEnvironment(process.env);
const ROOT_CONTENT = "Un espacio de evidencia cívica para examinar resultados electorales";

test.describe("the production root preserves its authentication boundary", () => {
  test("test_root_redirects_anonymous_and_renders_landing_when_authenticated", async ({ page }) => {
    const anonymousContext = await request.newContext({ baseURL: environment.VOTUS_E2E_BASE_URL,
      storageState: emptyStorageState() });
    try {
      const anonymous = await anonymousContext.get("/", { maxRedirects: 0 });
      expect([301, 302, 307, 308]).toContain(anonymous.status());
      expect(anonymous.headers()["location"]).toMatch(/\/login$/);
      expect(await anonymous.text()).not.toContain(ROOT_CONTENT);
    } finally {
      await anonymousContext.dispose();
    }

        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto("/");
        await expect(page).toHaveURL(/\/$/);
        await expect(page.getByRole("main")).toContainText(ROOT_CONTENT);
        await page.getByRole("link", { name: "Ir al contenido principal" }).press("Enter");
        await expect(page.locator("#main-content")).toBeFocused();
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
          ),
        ).toBe(true);

        await page.goto("/dashboard");
        await expect(page.getByRole("heading", { level: 1, name: "Panel de Votus" })).toBeVisible();
        await expect(page.getByRole("navigation", { name: "principal" })).toBeVisible();
        await page.getByRole("link", { name: "Ir al contenido principal" }).press("Enter");
        await expect(page.locator("#main-content")).toBeFocused();
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
          ),
        ).toBe(true);
      });
});
