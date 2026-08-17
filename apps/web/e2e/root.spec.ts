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
        await expect(
          page.getByRole("navigation", { name: "principal" }),
        ).toHaveCount(0);
        await page.getByRole("link", { name: "Ir al contenido principal" }).press("Enter");
        await expect(page.locator("#main-content")).toBeFocused();
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
          ),
        ).toBe(true);

        await page.goto("/dashboard");
        await expect(page.getByRole("heading", { level: 1, name: "Panel de Votus" })).toBeVisible();
        const primaryNavigation = page.getByRole("navigation", { name: "principal" });
        await expect(primaryNavigation).toBeVisible();

        await page.setViewportSize({ width: 1440, height: 1000 });
        const [headerContainer, navigationContainer, contentContainer] = await Promise.all([
          page.getByRole("banner").locator(".shell-container").first().boundingBox(),
          primaryNavigation.getByRole("list").boundingBox(),
          page.locator("#main-content").boundingBox(),
        ]);
        expect(headerContainer).not.toBeNull();
        expect(navigationContainer).not.toBeNull();
        expect(contentContainer).not.toBeNull();
        expect(Math.abs(navigationContainer!.x - headerContainer!.x)).toBeLessThanOrEqual(1);
        expect(Math.abs(navigationContainer!.x - contentContainer!.x)).toBeLessThanOrEqual(1);
        expect(Math.abs(navigationContainer!.width - headerContainer!.width)).toBeLessThanOrEqual(1);
        expect(Math.abs(navigationContainer!.width - contentContainer!.width)).toBeLessThanOrEqual(1);
        await expect(primaryNavigation.locator('a[aria-current="page"]')).toHaveCount(1);
        await expect(
          primaryNavigation.getByRole("link", { name: "Panel", exact: true }),
        ).toHaveAttribute("aria-current", "page");
        await expect(
          primaryNavigation.getByRole("link", { name: "Comparar", exact: true }),
        ).toHaveCount(0);
        await expect(
          primaryNavigation.getByRole("link", {
            name: "Municipal (Concejales)",
            exact: true,
          }),
        ).toHaveCount(0);

        const preparedRoutes = page.getByRole("region", {
          name: "Rutas de análisis preparadas",
        });
        await expect(preparedRoutes).toContainText(
          "se requiere un contexto preparado o un enlace directo",
        );
        await expect(
          preparedRoutes.getByRole("link", { name: "Comparar resultados electorales" }),
        ).toHaveAttribute("href", "/compare");
        await expect(
          preparedRoutes.getByRole("link", { name: "Análisis de concejos municipales" }),
        ).toHaveAttribute("href", "/municipal");
        await page.getByRole("link", { name: "Ir al contenido principal" }).press("Enter");
        await expect(page.locator("#main-content")).toBeFocused();
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
          ),
        ).toBe(true);
      });
});
