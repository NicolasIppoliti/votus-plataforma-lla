import { expect, request, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { createClient } from "@supabase/supabase-js";

import { assertE2eEnvironment, emptyStorageState } from "./gate-contract";
import { withReviewItem } from "./authorized-review-fixture";

const environment = assertE2eEnvironment(process.env);
const ROOT_CONTENT = "Panel operativo";

async function expectNoSevereAccessibilityIssues(page: Page) {
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  expect(result.violations.filter(issue => issue.impact === "critical" || issue.impact === "serious")
    .map(issue => ({ id: issue.id, impact: issue.impact, affectedNodes: issue.nodes.length }))).toEqual([]);
}

test("the authenticated page follows the system theme and persists explicit theme choices", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: ROOT_CONTENT })).toBeVisible();
  const theme = page.getByRole("combobox", { name: "Tema", exact: true });
  const root = page.locator("html");
  await expect(root).toHaveCSS("color-scheme", "dark");
  await expect(theme.locator("option:checked")).toHaveText("Sistema");
  await expect(theme.locator("option")).toHaveText(["Sistema", "Claro", "Oscuro"]);

  await theme.focus();
  await expect(theme).toBeFocused();
  await theme.selectOption({ label: "Claro" });
  await expect(theme.locator("option:checked")).toHaveText("Claro");
  await expect(root).toHaveCSS("color-scheme", "light");
  await page.reload();
  await expect(theme.locator("option:checked")).toHaveText("Claro");
  await expect(root).toHaveCSS("color-scheme", "light");

  await theme.selectOption({ label: "Oscuro" });
  await page.emulateMedia({ colorScheme: "light" });
  await page.reload();
  await expect(theme.locator("option:checked")).toHaveText("Oscuro");
  await expect(root).toHaveCSS("color-scheme", "dark");

  await theme.selectOption({ label: "Sistema" });
  await expect(root).toHaveCSS("color-scheme", "light");
  await page.reload();
  await expect(theme.locator("option:checked")).toHaveText("Sistema");
  await expect(root).toHaveCSS("color-scheme", "light");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(root).toHaveCSS("color-scheme", "dark");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(root).toHaveCSS("color-scheme", "light");
  await expect(page).toHaveURL(/\/$/);
});

test("a real same-workspace POST hides both counts until an equal-valued RSC snapshot arrives", async ({ page }) => {
  await withReviewItem(page, async () => {
    await page.goto("/");
    const topbar = page.locator("header.workspace-topbar");
    const attention = page.getByRole("complementary", { name: "Atención operativa" });
    const count = "1 elemento(s) de revisión pendiente(s)";
    for (const reader of [topbar, attention]) await expect(reader).toContainText(count);
    const organization = page.getByRole("combobox", { name: "Organización", exact: true });
    const activeId = await organization.inputValue();
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    let requestedRevision: number | undefined;
    await page.route("**/api/workspace", async (route) => {
      const body = route.request().postDataJSON();
      expect(body.organizationId).toBe(activeId);
      expect(Number.isSafeInteger(body.expectedRevision)).toBe(true);
      requestedRevision = body.expectedRevision;
      await held;
      await route.continue();
    });
    const responsePromise = page.waitForResponse((response) => response.url().endsWith("/api/workspace") && response.request().method() === "POST");
    try {
      await page.getByRole("button", { name: "Cambiar organización" }).click();
      await expect(organization).toBeDisabled();
      for (const reader of [topbar, attention]) {
        await expect(reader).toContainText("No se pudo verificar el estado de revisión.");
        await expect(reader).not.toContainText(count);
      }
      release();
      const response = await responsePromise;
      expect(response.ok()).toBe(true);
      expect(await response.json()).toMatchObject({ status: "active", revision: requestedRevision });
      for (const reader of [topbar, attention]) await expect(reader).toContainText(count);
      await expect(organization).toHaveValue(activeId);
      await expect(organization).toBeEnabled();
    } finally {
      release();
      await responsePromise;
      await page.unrouteAll({ behavior: "wait" });
    }
  });
});

test("real workspace A to B replaces identity and authorized count, while B to A preserves an unsent form", async ({ page }) => {
  await withReviewItem(page, async () => {
    const admin = createClient(environment.NEXT_PUBLIC_SUPABASE_URL, environment.SUPABASE_SERVICE_ROLE_KEY);
    const { data: auth, error: authError } = await admin.auth.admin.listUsers();
    const user = auth?.users.find(candidate => candidate.email?.toLowerCase() === environment.VOTUS_E2E_TEST_USER_EMAIL.toLowerCase());
    if (authError || !user) throw new Error("failed to resolve owned workspace fixture user");
    // This existing RPC creates only organization/membership/entitlement, not fiscal votes.
    const { data: fixture, error: setupError } = await admin.rpc("e2e_setup_authorized_fiscal_fixture", {
      p_user_id: user.id, p_distrito_code: "02", p_seccion_code: "028",
    });
    if (setupError) throw new Error("failed to set up second authorized workspace");
    const failures: unknown[] = [];
    try {
      expect(typeof fixture?.organization_id).toBe("string");
      await page.goto("/");
      const topbar = page.locator("header.workspace-topbar");
      const attention = page.getByRole("complementary", { name: "Atención operativa" });
      const organization = page.getByRole("combobox", { name: "Organización", exact: true });
      const firstId = await organization.inputValue();
      expect(firstId).not.toBe(fixture.organization_id);
      await expect(topbar).toContainText("Organización activa: E2E Authorized Review Browser");
      for (const reader of [topbar, attention]) await expect(reader).toContainText("1 elemento(s) de revisión pendiente(s)");
      await organization.selectOption(fixture.organization_id);
      const switched = page.waitForResponse(response => response.url().endsWith("/api/workspace") && response.request().method() === "POST");
      await page.getByRole("button", { name: "Cambiar organización" }).click();
      const response = await switched;
      expect(response.request().postDataJSON().organizationId).toBe(fixture.organization_id);
      expect(response.ok()).toBe(true);
      expect(await response.json()).toMatchObject({ status: "active" });
      await expect(organization).toHaveValue(fixture.organization_id);
      await expect(topbar.locator(".workspace-identity")).toHaveText("Organización activa: E2E Authorized Fiscal Browser");
      for (const reader of [topbar, attention]) {
        await expect(reader).toContainText("Sin elementos pendientes");
        await expect(reader).not.toContainText("1 elemento(s) de revisión pendiente(s)");
        await expect(reader).not.toContainText("No se pudo verificar");
      }
      await expect(topbar.locator(".workspace-identity")).not.toContainText("E2E Authorized Review Browser");

      await page.goto("/simulate");
      const draft = page.getByLabel("Total de votos", { exact: true });
      await draft.fill("12345");
      await organization.selectOption(firstId);
      const returned = page.waitForResponse(response => response.url().endsWith("/api/workspace") && response.request().method() === "POST");
      await page.getByRole("button", { name: "Cambiar organización" }).click();
      const returnResponse = await returned;
      expect(returnResponse.request().postDataJSON().organizationId).toBe(firstId);
      expect(returnResponse.ok()).toBe(true);
      await expect(topbar).toContainText("Organización activa: E2E Authorized Review Browser");
      await expect(topbar).toContainText("1 elemento(s) de revisión pendiente(s)");
      await expect(draft).toHaveValue("12345");
      await expect(page).toHaveURL(/\/simulate$/);
    } catch (error) {
      failures.push(error);
    } finally {
      try {
        const { data, error } = await admin.rpc("e2e_cleanup_authorized_fiscal_fixture", { p_fixture: fixture });
        if (error || data?.cleaned !== true) throw new Error("second workspace ownership cleanup failed");
      } catch (error) { failures.push(error); }
    }
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) throw new AggregateError(failures, "workspace assertions and owned cleanup failed");
  });
});

test("the short mobile drawer keeps the real organization and account footer keyboard reachable", async ({ page }) => {
  await withReviewItem(page, async () => {
    await page.setViewportSize({ width: 320, height: 400 });
    await page.goto("/");
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Ir al contenido principal" })).toBeFocused();
    await page.keyboard.press("Tab");
    const trigger = page.getByRole("button", { name: "Abrir navegación" });
    await expect(trigger).toBeFocused();
    await page.keyboard.press("Enter");
    const drawer = page.getByRole("dialog", { name: "Navegación principal" });
    const close = drawer.getByRole("button", { name: "Cerrar navegación" });
    const account = drawer.locator("summary", { hasText: "Cuenta" });
    await expect(close).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(account).toBeFocused();
    await expect(account).toBeInViewport({ ratio: 1 });
    await page.keyboard.press("Shift+Tab");
    await expect(drawer.getByRole("button", { name: "Cambiar organización" })).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    const organization = drawer.getByRole("combobox", { name: "Organización", exact: true });
    await expect(organization).toBeFocused();
    await expect(organization).toBeInViewport({ ratio: 1 });
    await expect(organization.locator("option:checked")).toHaveText("E2E Authorized Review Browser");
    const selectorIds = await page.locator(".workspace-footer select").evaluateAll(elements => elements.map(element => element.id));
    expect(selectorIds).toHaveLength(2);
    expect(new Set(selectorIds).size).toBe(2);
    expect(selectorIds.every(Boolean)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
    await expect(trigger).toBeFocused();
  });
});

test("resizing an open drawer to desktop preserves one visible keyboard footer path", async ({ page }) => {
  await withReviewItem(page, async () => {
    await page.setViewportSize({ width: 320, height: 400 });
    await page.goto("/");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    const trigger = page.getByRole("button", { name: "Abrir navegación", includeHidden: true });
    await expect(trigger).toBeFocused();
    await page.keyboard.press("Enter");
    const drawer = page.getByRole("dialog", { name: "Navegación principal" });
    await expect(drawer.getByRole("button", { name: "Cerrar navegación" })).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(drawer.locator("summary", { hasText: "Cuenta" })).toBeFocused();
    await page.setViewportSize({ width: 1440, height: 1000 });
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    await expect(drawer).toBeHidden();
    const activeIsVisible = () => page.evaluate(() => {
      const active = document.activeElement;
      if (!(active instanceof HTMLElement) || active === document.body || !active.checkVisibility()) return false;
      const box = active.getBoundingClientRect();
      return box.top >= 0 && box.bottom <= innerHeight && box.left >= 0 && box.right <= innerWidth;
    });
    await expect.poll(activeIsVisible).toBe(true);
    await expect(page.getByRole("contentinfo", { name: "Organización y cuenta" })).toHaveCount(1);
    await expect(page.getByRole("combobox", { name: "Organización", exact: true })).toHaveCount(1);
    await page.keyboard.press("Tab");
    await expect.poll(activeIsVisible).toBe(true);
  });
});

test("account controls live in the visible sidebar footer and preserve drawer keyboard operation", async ({ page, context }) => {
  // Sign out only a new login session, never the harness's shared storage session.
  await context.clearCookies();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/login");
  await page.getByLabel("Correo electrónico").fill(environment.VOTUS_E2E_TEST_USER_EMAIL);
  await page.getByLabel("Contraseña").fill(environment.VOTUS_E2E_TEST_USER_PASSWORD);
  await page.getByRole("button", { name: "Iniciar sesión" }).click();
  await expect(page).toHaveURL(/\/$/);
  const sidebar = page.locator(".app-shell > aside.situation-sidebar");
  const footer = sidebar.getByRole("contentinfo", { name: "Organización y cuenta" });
  const account = footer.locator("summary", { hasText: "Cuenta" });
  await expect(account).toBeVisible();
  await expect(page.locator("header.workspace-topbar").getByRole("button", { name: "Cerrar sesión" })).toHaveCount(0);
  await account.focus();
  await account.press("Enter");
  const signOut = footer.getByRole("button", { name: "Cerrar sesión" });
  await expect(signOut).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(signOut).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(signOut).toBeHidden();
  await expect(account).toBeFocused();

  await page.setViewportSize({ width: 320, height: 568 });
  const trigger = page.getByRole("button", { name: "Abrir navegación" });
  await trigger.click();
  const drawer = page.getByRole("dialog", { name: "Navegación principal" });
  const close = drawer.getByRole("button", { name: "Cerrar navegación" });
  const mobileAccount = drawer.locator("summary", { hasText: "Cuenta" });
  await expect(close).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(mobileAccount).toBeFocused();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Tab");
  const mobileSignOut = drawer.getByRole("button", { name: "Cerrar sesión" });
  await expect(mobileSignOut).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(close).toBeFocused();
  await mobileSignOut.focus();
  await page.keyboard.press("Escape");
  await expect(drawer).toBeVisible();
  await expect(mobileSignOut).toBeHidden();
  await expect(mobileAccount).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  await expect(trigger).toBeFocused();

  await trigger.click();
  await mobileAccount.press("Enter");
  await mobileSignOut.click();
  await expect(page).toHaveURL(/\/login$/);
});

for (const [status, httpStatus, message] of [
  ["denied", 403, "Ya no tenés acceso a esa organización."],
  ["conflict", 409, "La organización cambió en otra pestaña."],
  ["unavailable", 503, "No se pudo cambiar la organización."],
] as const) {
  test(`a ${status} workspace response stays unverified until a fresh RSC snapshot`, async ({ page }) => {
    await withReviewItem(page, async () => {
      await page.goto("/");
      const readers = [page.locator("header.workspace-topbar"), page.getByRole("complementary", { name: "Atención operativa" })];
      for (const reader of readers) await expect(reader).toContainText("1 elemento(s) de revisión pendiente(s)");
      await page.route("**/api/workspace", route => route.fulfill({ status: httpStatus, json: { status } }));
      try {
        await page.getByRole("button", { name: "Cambiar organización" }).click();
        await expect(page.getByRole("contentinfo", { name: "Organización y cuenta" })).toContainText(message);
        await expect(page.getByRole("combobox", { name: "Organización", exact: true })).toBeEnabled();
        for (const reader of readers) {
          await expect(reader).toContainText("No se pudo verificar el estado de revisión.");
          await expect(reader).not.toContainText("elemento(s) de revisión pendiente(s)");
          await expect(reader).not.toContainText("Sin elementos pendientes");
        }
      } finally { await page.unrouteAll({ behavior: "wait" }); }
      const response = page.waitForResponse(response => response.url().endsWith("/api/workspace") && response.request().method() === "POST");
      await page.getByRole("button", { name: "Cambiar organización" }).click();
      expect((await response).ok()).toBe(true);
      for (const reader of readers) await expect(reader).toContainText("1 elemento(s) de revisión pendiente(s)");
    });
  });
}

test("workspace refresh preserves an unsent real simulation form", async ({ page }) => {
  await withReviewItem(page, async () => {
    await page.goto("/simulate");
    const draft = page.getByLabel("Total de votos", { exact: true });
    await draft.fill("12345");
    const response = page.waitForResponse(response => response.url().endsWith("/api/workspace") && response.request().method() === "POST");
    await page.getByRole("button", { name: "Cambiar organización" }).click();
    expect((await response).ok()).toBe(true);
    await expect(page.locator("header.workspace-topbar")).toContainText("1 elemento(s) de revisión pendiente(s)");
    await expect(draft).toHaveValue("12345");
    await expect(page).toHaveURL(/\/simulate$/);
  });
});

test("briefing places attention beside desktop actions and after mobile actions", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  const main = page.getByRole("main");
  const explore = main.getByRole("link", { name: "Explorar resultados", exact: true }).first();
  const attention = main.getByRole("complementary", { name: "Atención operativa" });
  const actionBox = await explore.boundingBox();
  const attentionBox = await attention.boundingBox();
  expect(actionBox).not.toBeNull();
  expect(attentionBox).not.toBeNull();
  expect(attentionBox!.x).toBeGreaterThan(actionBox!.x + actionBox!.width);
  await expectNoSevereAccessibilityIssues(page);
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    const action = await explore.boundingBox();
    const rail = await attention.boundingBox();
    expect(action!.y + action!.height).toBeLessThan(rail!.y);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    for (const href of ["/drilldown", "/compare", "/municipal", "/fiscalizacion", "/simulate", "/review"]) {
      await expect(main.locator(`a[href="${href}"]`).first()).toBeVisible();
    }
    await expectNoSevereAccessibilityIssues(page);
    await page.getByRole("button", { name: "Abrir navegación" }).click();
    await expectNoSevereAccessibilityIssues(page);
    await page.keyboard.press("Escape");
  }
});

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
      page.getByRole("heading", { level: 1, name: "Panel operativo" }),
    ).toBeVisible();
    const topbar = page.locator("header.workspace-topbar");
    const desktopSidebar = page.locator(".app-shell > aside.situation-sidebar");
    const desktopNavigation = desktopSidebar.locator(
      'nav[aria-label="principal"]',
    );
    const drawerTrigger = topbar.getByRole("button", {
      name: "Abrir navegación",
      includeHidden: true,
    });

    await expect(desktopSidebar).toBeHidden();
    await expect(desktopNavigation).toBeHidden();
    await expect(drawerTrigger).toBeVisible();
    await expect(drawerTrigger).toHaveAttribute(
      "aria-controls",
      "mobile-navigation-drawer",
    );
    await expect(drawerTrigger).toHaveAttribute("aria-expanded", "false");
    const overflowBeforeOpen = await page.evaluate(() => getComputedStyle(document.body).overflow);
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
    expect(await page.evaluate(() => getComputedStyle(document.body).overflow)).toBe("hidden");
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
    await expect(drawer.locator("summary", { hasText: "Cuenta" })).toBeFocused();
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
    expect(await page.evaluate(() => getComputedStyle(document.body).overflow)).toBe(
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
    await expect(topbar).toContainText("Organización sin verificar");
    await expect(
      topbar.getByRole("status").filter({
        hasText: "No se pudo verificar el estado de revisión.",
      }),
    ).toBeVisible();
    await drawerTrigger.click();
    const footer = drawer.getByRole("contentinfo", { name: "Organización y cuenta" });
    await expect(footer.getByRole("status").filter({ hasText: "Seleccioná una organización para continuar." })).toBeVisible();
    await expect(footer.getByRole("status").filter({ hasText: /^No hay organizaciones disponibles\.$/ })).toBeVisible();
    await expect(
      topbar.getByRole("combobox", { name: "Organización" }),
    ).toHaveCount(0);
    await drawer.locator("summary", { hasText: "Cuenta" }).press("Enter");
    await expect(footer.getByRole("button", { name: "Cerrar sesión" })).toBeVisible();
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
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

    const officialRoutes = page.getByRole("main").getByRole("region", { name: "Resultados oficiales", exact: true });
    await expect(officialRoutes).toContainText("Sección compartida y evidencia independiente.");
    await expect(officialRoutes.getByRole("link", { name: "Comparar elecciones" })).toHaveAttribute("href", "/compare");
    await expect(officialRoutes).toContainText("Coronel Rosales · Concejales 2025. Elección configurada.");
    await expect(officialRoutes.getByRole("link", { name: "Resultados municipales" })).toHaveAttribute("href", "/municipal");
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
