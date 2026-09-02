import { expect, request, test } from "@playwright/test";

import { assertE2eEnvironment, emptyStorageState } from "./gate-contract";

const environment = assertE2eEnvironment(process.env);
const ROOT_CONTENT =
  "Un espacio de evidencia cívica para examinar resultados electorales";

test.describe("the production root preserves its authentication boundary", () => {
  test("test_root_redirects_anonymous_and_renders_landing_when_authenticated", async ({
    page,
  }) => {
    const anonymousContext = await request.newContext({
      baseURL: environment.VOTUS_E2E_BASE_URL,
      storageState: emptyStorageState(),
    });
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
    await page
      .getByRole("link", { name: "Ir al contenido principal" })
      .press("Enter");
    await expect(page.locator("#main-content")).toBeFocused();
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      ),
    ).toBe(true);

    await page.goto("/dashboard");
    await expect(
      page.getByRole("heading", { level: 1, name: "Panel de Votus" }),
    ).toBeVisible();
    const primaryNavigation = page.getByRole("navigation", {
      name: "principal",
    });
    await expect(primaryNavigation).toBeVisible();
    const topbar = page.locator("header.workspace-topbar");

    await page.setViewportSize({ width: 320, height: 844 });
    await expect(primaryNavigation).toBeVisible();
    await expect(topbar).toBeVisible();
    await expect(
      topbar.getByRole("status").filter({
        hasText: "Seleccioná una organización para continuar.",
      }),
    ).toBeVisible();
    await expect(
      topbar.getByRole("status").filter({
        hasText: "No se pudo verificar el estado de revisión.",
      }),
    ).toBeVisible();
    await expect(
      topbar.getByRole("combobox", { name: "Organización" }),
    ).toBeVisible();
    await expect(topbar.getByRole("button", { name: "Cerrar sesión" })).toBeVisible();
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      ),
    ).toBe(true);

    await page.setViewportSize({ width: 1440, height: 1000 });
    const sidebar = page.locator("aside.situation-sidebar");
    const [sidebarBox, topbarBox, topbarContainer, contentContainer] =
      await Promise.all([
        sidebar.boundingBox(),
        topbar.boundingBox(),
        topbar.locator(".workspace-topbar__inner").boundingBox(),
        page.locator("#main-content").boundingBox(),
      ]);
    expect(sidebarBox).not.toBeNull();
    expect(topbarBox).not.toBeNull();
    expect(topbarContainer).not.toBeNull();
    expect(contentContainer).not.toBeNull();
    expect(sidebarBox!.x).toBe(0);
    expect(sidebarBox!.width).toBe(240);
    expect(topbarBox!.height).toBe(64);
    expect(contentContainer!.x).toBeGreaterThanOrEqual(
      sidebarBox!.x + sidebarBox!.width,
    );
    expect(
      Math.abs(topbarContainer!.x - contentContainer!.x),
    ).toBeLessThanOrEqual(1);
    await expect(sidebar).toContainText(
      "Esta herramienta no es una fuente electoral oficial.",
    );
    await expect(
      primaryNavigation.locator('a[aria-current="page"]'),
    ).toHaveCount(1);
    await expect(
      primaryNavigation.getByRole("link", {
        name: "Resumen operativo",
        exact: true,
      }),
    ).toHaveAttribute("aria-current", "page");
    for (const navigationLabel of [
      "Explorar",
      "Comparar",
      "Municipal",
      "Fiscalización (no oficial)",
      "Simulación 2027",
      "Revisión de datos",
    ]) {
      await expect(
        primaryNavigation.getByRole("link", {
          name: navigationLabel,
          exact: true,
        }),
      ).toBeVisible();
    }

    const preparedRoutes = page.getByRole("region", {
      name: "Rutas de análisis especializadas",
    });
    await expect(preparedRoutes).toContainText(
      "Inicie una comparación nacional o el análisis municipal",
    );
    await expect(
      preparedRoutes.getByRole("link", {
        name: "Comparar resultados electorales",
      }),
    ).toHaveAttribute("href", "/compare");
    await expect(preparedRoutes).toContainText("Selección municipal disponible");
    await expect(
      preparedRoutes.getByRole("link", {
        name: "Análisis de concejos municipales",
      }),
    ).toHaveAttribute("href", "/municipal");
    await page
      .getByRole("link", { name: "Ir al contenido principal" })
      .press("Enter");
    await expect(page.locator("#main-content")).toBeFocused();
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      ),
    ).toBe(true);
  });
});
