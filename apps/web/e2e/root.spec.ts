import { expect, request, test } from "@playwright/test";

import { assertE2eEnvironment, emptyStorageState } from "./gate-contract";

const environment = assertE2eEnvironment(process.env);
const ROOT_CONTENT = "Panel de Votus";

test.describe("the production root preserves its authentication boundary", () => {
  test("test_root_redirects_anonymous_and_renders_briefing_when_authenticated", async ({
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
    await expect(page).toHaveURL(/\/$/);
    await expect(
      page.getByRole("heading", { level: 1, name: "Panel de Votus" }),
    ).toBeVisible();
    const topbar = page.locator("header.workspace-topbar");
    const desktopSidebar = page.locator(".app-shell > aside.situation-sidebar");
    const desktopNavigation = desktopSidebar.locator(
      'nav[aria-label="principal"]',
    );
    const drawerTrigger = topbar.getByRole("button", {
      name: "Abrir navegación",
    });

    await expect(desktopSidebar).toBeHidden();
    await expect(desktopNavigation).toBeHidden();
    await expect(drawerTrigger).toBeVisible();
    await expect(drawerTrigger).toHaveAttribute(
      "aria-controls",
      "mobile-navigation-drawer",
    );
    await expect(drawerTrigger).toHaveAttribute("aria-expanded", "false");
    const overflowBeforeOpen = await page.evaluate(() => document.body.style.overflow);
    await drawerTrigger.click();

    const drawer = page.getByRole("dialog", {
      name: "Navegación principal",
    });
    const closeDrawer = drawer.getByRole("button", {
      name: "Cerrar navegación",
    });
    const drawerNavigation = drawer.getByRole("navigation", {
      name: "principal",
    });
    await expect(drawer).toBeVisible();
    await expect(drawer).toHaveAttribute("id", "mobile-navigation-drawer");
    await expect(drawerTrigger).toHaveAttribute("aria-expanded", "true");
    expect(await page.evaluate(() => document.body.style.overflow)).toBe("hidden");
    await expect(closeDrawer).toBeFocused();
    await expect(drawer).toContainText(
      "Esta herramienta no es una fuente electoral oficial.",
    );
    for (const groupLabel of [
      "Situación",
      "Resultados oficiales",
      "Fiscalización",
      "Escenarios",
      "Operaciones",
    ]) {
      await expect(
        drawerNavigation.getByRole("heading", { name: groupLabel, exact: true }),
      ).toBeVisible();
    }
    for (const [label, href] of [
      ["Resumen operativo", "/"],
      ["Explorar", "/drilldown"],
      ["Comparar", "/compare"],
      ["Municipal", "/municipal"],
      ["Fiscalización (no oficial)", "/fiscalizacion"],
      ["Simulación 2027", "/simulate"],
      ["Revisión de datos", "/review"],
    ] as const) {
      await expect(
        drawerNavigation.getByRole("link", { name: label, exact: true }),
      ).toHaveAttribute("href", href);
    }
    await expect(
      drawerNavigation.locator('a[aria-current="page"]'),
    ).toHaveCount(1);
    await expect(
      drawerNavigation.getByRole("link", {
        name: "Resumen operativo",
        exact: true,
      }),
    ).toHaveAttribute("aria-current", "page");

    await page.keyboard.press("Shift+Tab");
    await expect(
      drawerNavigation.getByRole("link", {
        name: "Revisión de datos",
        exact: true,
      }),
    ).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(closeDrawer).toBeFocused();

    const comparisonDrawerLink = drawerNavigation.getByRole("link", {
      name: "Comparar",
      exact: true,
    });
    const municipalDrawerLink = drawerNavigation.getByRole("link", {
      name: "Municipal",
      exact: true,
    });
    await comparisonDrawerLink.focus();
    await page.keyboard.press("Tab");
    await expect(municipalDrawerLink).toBeFocused();
    await page.evaluate(() => {
      const main = document.querySelector<HTMLElement>("#main-content");
      if (!main) throw new Error("main content is missing");
      main.focus();
    });
    await expect(municipalDrawerLink).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
    await expect(drawerTrigger).toHaveAttribute("aria-expanded", "false");
    expect(await page.evaluate(() => document.body.style.overflow)).toBe(
      overflowBeforeOpen,
    );
    await expect(drawerTrigger).toBeFocused();

    await drawerTrigger.click();
    await closeDrawer.click();
    await expect(drawer).toBeHidden();
    await expect(drawerTrigger).toHaveAttribute("aria-expanded", "false");
    await expect(drawerTrigger).toBeFocused();

    await drawerTrigger.click();
    await drawerNavigation.getByRole("link", { name: "Comparar", exact: true }).click();
    await expect(page).toHaveURL(/\/compare$/);
    await expect(drawer).toBeHidden();

    await page.setViewportSize({ width: 320, height: 844 });
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
      topbar.getByRole("status").filter({
        hasText: /^No hay organizaciones disponibles\.$/,
      }),
    ).toBeVisible();
    await expect(
      topbar.getByRole("combobox", { name: "Organización" }),
    ).toHaveCount(0);
    await expect(topbar.getByRole("button", { name: "Cerrar sesión" })).toBeVisible();
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      ),
    ).toBe(true);

    await page.goto("/dashboard");
    await page.setViewportSize({ width: 1440, height: 1000 });
    await expect(drawerTrigger).toBeHidden();
    await expect(desktopNavigation).toBeVisible();
    const sidebar = page.locator(".app-shell > aside.situation-sidebar");
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
      desktopNavigation.locator('a[aria-current="page"]'),
    ).toHaveCount(1);
    await expect(
      desktopNavigation.getByRole("link", {
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
        desktopNavigation.getByRole("link", {
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
