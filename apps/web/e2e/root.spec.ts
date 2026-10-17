import { writeFile } from "node:fs/promises";
import { expect, request, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { createClient } from "@supabase/supabase-js";

import { assertE2eEnvironment, emptyStorageState } from "./gate-contract";
import { withReviewItem } from "./authorized-review-fixture";
import { writeWorkspaceStateFacts } from "./workspace-state-facts";
import { withPanoramaResults } from "./panorama-result-fixture";
import { expectMobileFormGeometry } from "./mobile-form-geometry";
import { prepareOrganization } from "./onboarding";

const environment = assertE2eEnvironment(process.env);
const ROOT_CONTENT = "Panorama";

async function expectAccountPointerAccess(page: Page, width: number) {
  const mobile = width <= 980;
  if (mobile) await page.getByRole("button", { name: "Abrir navegación" }).click();
  const container = mobile
    ? page.getByRole("dialog", { name: "Navegación principal" })
    : page.locator(".workspace-topbar__controls");
  await container.locator("summary", { hasText: /^Cuenta$/ }).click();
  // The drawer is deliberately scrollable; reveal the expanded account before
  // checking all items together, without scrolling individual items into place.
  if (mobile) await container.locator(".workspace-account").scrollIntoViewIfNeeded();
  const items = [
    container.getByRole("link", { name: "Guía de Votus", exact: true }),
    container.getByRole("link", { name: "Privacidad", exact: true }),
    container.getByRole("button", { name: "Cerrar sesión", exact: true }),
  ];
  const boxes = [];
  for (const item of items) {
    await expect(item).toBeVisible();
    await expect(item).toBeInViewport({ ratio: 1 });
    const box = await item.boundingBox();
    expect(box).not.toBeNull();
    boxes.push(box!);
    expect(await item.evaluate(element => {
      const rect = element.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
      return hit !== null && element.contains(hit);
    })).toBe(true);
  }
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i]!;
      const b = boxes[j]!;
      expect(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y).toBe(true);
    }
  }
  if (!mobile) expect((await page.locator(".workspace-topbar").boundingBox())!.height).toBe(64);
  await items[1]!.click();
  await expect(page).toHaveURL(url => url.pathname === "/privacidad");
}

for (const width of [1440, 981, 390]) {
  test(`Cuenta items are inside the viewport, nonoverlapping and pointer reachable at ${width}px`, async ({ page }) => {
    await withReviewItem(page, async () => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/");
      await expectAccountPointerAccess(page, width);
    });
  });
}

test("document titles distinguish direct entries, redirects and client navigation (#595)", async ({ page }) => {
  await withReviewItem(page, async () => {
    for (const [route, title] of [["/", "Panorama"], ["/drilldown", "Exploración"], ["/compare", "Comparación"], ["/dashboard", "Panorama"]] as const) {
      await page.goto(route);
      await expect(page).toHaveTitle(`${title} · Votus`);
    }
    // A document-scoped marker survives App Router navigation, not a full reload.
    await page.evaluate(() => { document.documentElement.dataset.titleNavigation = "client"; });
    await page.getByRole("navigation", { name: "principal", exact: true }).getByRole("link", { name: "Comparación", exact: true }).click();
    await expect(page).toHaveTitle("Comparación · Votus");
    await expect(page.locator("html")).toHaveAttribute("data-title-navigation", "client");
    await page.goto("/ruta-inexistente-595");
    await expect(page).toHaveTitle("Página no encontrada · Votus");
  });
});

for (const width of [1440, 981]) {
  test(`desktop topbar stays one bounded 64px row with a long organization at ${width}px`, async ({ page }) => {
    const organizationName = "Coordinación Electoral de la Sexta Sección — Coronel Rosales y distritos de la región";
    await withReviewItem(page, async () => {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto("/dashboard");
      const topbar = page.locator(".workspace-topbar");
      await expect(topbar.getByRole("link", { name: "1 elemento(s) de revisión pendiente(s)" })).toBeVisible();
      const selector = topbar.getByRole("combobox", { name: "Organización", exact: true });
      await expect(selector.locator("option:checked")).toHaveText(organizationName);
      const box = await topbar.boundingBox();
      expect(box!.height).toBe(64);
      const geometry = await topbar.evaluate(element => {
        const bounds = element.getBoundingClientRect();
        return [...element.querySelectorAll("select, button, summary, .review-alert a")]
          .filter(control => control.getBoundingClientRect().width > 0)
          .map(control => {
            const rect = control.getBoundingClientRect();
            return rect.left >= bounds.left && rect.right <= bounds.right && rect.top >= bounds.top && rect.bottom <= bounds.bottom;
          });
      });
      expect(geometry.length).toBeGreaterThan(0);
      expect(geometry.every(Boolean)).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }, { organizationName });
  });
}

for (const width of [320, 390]) {
  test(`every route and workspace form stays readable at ${width}px (#463)`, async ({ page }) => {
    // Existing authorized fixture; no screenshots or data dumps are retained.
    await withReviewItem(page, async () => {
      await page.setViewportSize({ width, height: 844 });
      for (const route of ["/", "/drilldown", "/compare", "/municipal", "/fiscalizacion", "/evidencia", "/review", "/scenarios", "/simulate"]) {
        await test.step(route, async () => {
          await page.goto(route);
          await expect(page.locator("#main-content h1").first()).toBeVisible();
          await expect(page).not.toHaveURL(/\/login/);
          const root = page.locator("#main-content");
          // Open form-owned pickers, including disabled alternate-scope controls.
          const pickers = root.locator("details").filter({ has: page.locator("select, input") });
          for (let index = 0; index < await pickers.count(); index++) {
            const picker = pickers.nth(index);
            if (!await picker.evaluate(element => (element as HTMLDetailsElement).open)) await picker.locator(":scope > summary").click();
          }
          if (route === "/drilldown") {
            // #501: Exploración folds the shared bar (its page form repeats it) so the
            // map follows the compact page controls; the summary keeps the values and source.
            const bar = page.getByRole("region", { name: "Contexto electoral", exact: true });
            const fold = bar.locator("details.electoral-context__fold");
            await expect(fold).not.toHaveAttribute("open", "");
            await expect(fold.locator(":scope > summary")).toContainText("Fuente: Oficial");
            const map = page.getByRole("region", { name: "Mapa territorial de referencia", exact: true });
            const controls = page.getByRole("region", { name: "Filtros de exploración", exact: true });
            await expect(bar.getByText("Cargando contexto autorizado…")).toHaveCount(0);
            const [barBox, controlsBox, mapBox] = await Promise.all([bar.boundingBox(), controls.boundingBox(), map.boundingBox()]);
            expect(barBox!.height).toBeLessThanOrEqual(120);
            expect(controlsBox!.y).toBeGreaterThanOrEqual(barBox!.y + barBox!.height);
            expect(mapBox!.y).toBeGreaterThanOrEqual(controlsBox!.y + controlsBox!.height);
            await fold.locator(":scope > summary").click();
          }
          if (["/", "/drilldown", "/compare", "/municipal", "/fiscalizacion", "/simulate"].includes(route)) {
            await expect(page.getByRole("combobox", { name: "Contexto electoral: Fuente", exact: true })).toBeVisible();
          }
          if (route === "/evidencia") await expect(page.getByRole("form", { name: "Contexto de la evidencia" })).toBeVisible();
          await expectMobileFormGeometry(page, page.locator(".app-shell__workspace"));
          await page.getByRole("button", { name: "Abrir navegación" }).click();
          const drawer = page.getByRole("dialog", { name: "Navegación principal" });
          await expect(drawer.getByRole("combobox", { name: "Organización", exact: true })).toBeVisible();
          await drawer.locator("summary").filter({ hasText: "Cuenta" }).click();
          await expectMobileFormGeometry(page, drawer);
          await drawer.getByRole("button", { name: "Cerrar navegación" }).click();
        });
      }
    });
  });

  test(`login form stays labelled and bounded at ${width}px (#463)`, async ({ browser, baseURL }) => {
    if (!baseURL) throw new Error("mobile form audit requires the configured E2E base URL");
    const context = await browser.newContext({ baseURL, storageState: emptyStorageState(), viewport: { width, height: 844 } });
    try {
      const page = await context.newPage();
      await page.goto("/login");
      await expect(page.getByLabel("Correo electrónico")).toBeVisible();
      await expect(page.getByLabel("Contraseña", { exact: true })).toBeVisible();
      await expectMobileFormGeometry(page, page.locator("body"));
    } finally { await context.close(); }
  });
}

test("authenticated routes share page gutter and title scale", async ({ page }) => {
  await withReviewItem(page, async () => {
  const routes = ["/", "/drilldown", "/municipal", "/compare", "/simulate", "/scenarios", "/evidencia", "/review", "/fiscalizacion"];
  for (const width of [320, 390, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    let sharedLeft: number | undefined;
    let sharedRight: number | undefined;
    for (const route of routes) {
      await page.goto(route);
      const title = page.locator("#main-content h1");
      await expect(title).toBeVisible();
      await expect(title).toHaveCSS("font-size", width < 768 ? "28px" : "32px");
      await expect(title).toHaveCSS("line-height", width < 768 ? "33.6px" : "38.4px");
      const geometry = await title.evaluate(node => {
        const box = node.getBoundingClientRect();
        // Simulation reserves desktop header space for its scenario summary.
        // The title must start at the page gutter, not fill that reserved space.
        const pageBox = node.closest("main")!.getBoundingClientRect();
        const container = document.getElementById("main-content")!;
        const shell = container.getBoundingClientRect();
        const style = getComputedStyle(container);
        return { left: box.left, right: pageBox.right, expectedLeft: shell.left + parseFloat(style.paddingLeft), expectedRight: shell.right - parseFloat(style.paddingRight) };
      });
      expect(Math.abs(geometry.left - geometry.expectedLeft), route).toBeLessThan(1);
      expect(Math.abs(geometry.right - geometry.expectedRight), route).toBeLessThan(1);
      sharedLeft ??= geometry.left;
      sharedRight ??= geometry.right;
      expect(Math.abs(geometry.left - sharedLeft), route).toBeLessThan(1);
      expect(Math.abs(geometry.right - sharedRight), route).toBeLessThan(1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), route).toBe(true);
    }
  }
  });
});

async function expectNoSevereAccessibilityIssues(page: Page) {
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  expect(result.violations.filter(issue => issue.impact === "critical" || issue.impact === "serious")
    .map(issue => ({ id: issue.id, impact: issue.impact, affectedNodes: issue.nodes.length }))).toEqual([]);
}

test("without an organization onboarding is a prerequisite, not a context failure (#598)", async ({ page }) => {
  await page.goto("/municipal");
  await expect(page).toHaveURL(url => url.pathname === "/onboarding" && url.searchParams.get("returnTo") === "/municipal");
  await expect(page.getByRole("heading", { name: "Elegí tu organización", exact: true })).toBeVisible();
  await expect(page.getByRole("status")).toContainText("No hay organizaciones disponibles.");
  await expect(page.getByRole("region", { name: "Contexto electoral", exact: true })).toHaveCount(0);
  await expect(page.getByRole("main")).not.toContainText("No se pudo verificar el contexto autorizado.");
});

test("electoral context stays labelled and readable at 320px with explicit source opt-in", async ({ page }) => {
  // With an active organization (#598: without one the bar is a prerequisite note).
  await withReviewItem(page, async () => {
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto("/municipal");
    const bar = page.getByRole("region", { name: "Contexto electoral", exact: true });
    await expect(bar).toBeVisible();
    await expect(bar).toHaveCSS("position", "static");
    await expect(page.locator(".workspace-topbar")).toHaveCSS("position", "static");
    for (const label of ["Elección", "Categoría", "Distrito", "Sección", "Fuente"]) {
      await expect(bar.getByRole("combobox", { name: `Contexto electoral: ${label}`, exact: true })).toHaveCount(1);
    }
    await expect(page).toHaveURL(/\/municipal$/);
    const source = bar.getByRole("combobox", { name: "Contexto electoral: Fuente", exact: true });
    await expect(source).toHaveValue("official");
    await source.selectOption("fiscalizacion");
    await expect(page).toHaveURL(/sourceKind=fiscalizacion/);
    await expect(bar).toHaveAttribute("data-source", "fiscalizacion");
    await expect(bar.getByText("Fiscalización: fuente no oficial.", { exact: false })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(bar).toHaveCSS("position", "sticky");
    await expect(page.locator(".workspace-topbar")).toHaveCSS("position", "sticky");
    await page.setViewportSize({ width: 1440, height: 500 });
    await expect(bar).toHaveCSS("position", "static");
    await expect(page.locator(".workspace-topbar")).toHaveCSS("position", "static");
  });
});

test("Panorama updates its figures when the shared category changes, keeping Rosales", async ({ page }) => {
  await withPanoramaResults(async (fixture) => withReviewItem(page, async () => {
    await page.goto("/");
    const election = page.getByRole("combobox", { name: "Contexto electoral: Elección", exact: true });
    await expect(election).toBeEnabled();
    const seededElection = election.locator("option").filter({ hasText: fixture.election.label });
    if (await seededElection.count() === 0) {
      const bar = page.getByRole("region", { name: "Contexto electoral", exact: true });
      await writeFile(test.info().outputPath("e2e-facts-panorama-election-options.json"), JSON.stringify({
        electionControlCount: await election.count(),
        electionEnabled: await election.isEnabled(),
        electionOptions: await election.locator("option").allTextContents(),
        categoryOptions: await bar.getByRole("combobox", { name: "Contexto electoral: Categoría", exact: true }).locator("option").allTextContents(),
        source: await bar.getAttribute("data-source"),
        loadingStatusCount: await bar.getByRole("status").count(),
        unavailableContextCount: await bar.getByText("No se pudo verificar el contexto autorizado.", { exact: true }).count(),
      }));
    }
    await expect(seededElection).toHaveAttribute("value", fixture.election.id);
    await election.selectOption(fixture.election.id);
    const category = page.getByRole("combobox", { name: "Contexto electoral: Categoría", exact: true });
    await expect(category).toBeEnabled();
    await expect.poll(async () => category.locator("option[value]:not([value=''])").count()).toBeGreaterThan(1);
    const categories = fixture.categories.map(category => category.id);
    await category.selectOption(categories[0]!);
    await page.getByRole("combobox", { name: "Contexto electoral: Distrito", exact: true }).selectOption("02");
    await page.getByRole("combobox", { name: "Contexto electoral: Sección", exact: true }).selectOption("027");
    const summary = page.getByRole("complementary", { name: "Lectura de la selección" });
    // #458 states the official denominator in the headline metric label.
    const total = summary.getByText(/^Sobre [\d.]+ votos positivos oficiales$/);
    try {
      await expect(total).toBeVisible();
    } catch (error) {
      // Capture only electoral context and public render state, never storage,
      // credentials or the full page. Keep the original assertion as the failure.
      try {
        const facts = await page.evaluate(() => {
          const keys = ["electionId", "categoryId", "distritoCode", "seccionCode", "circuitoCode", "establecimientoCode", "mesaCode", "sourceKind"];
          const params = new URL(window.location.href).searchParams;
          const bar = document.querySelector('[aria-label="Contexto electoral"]');
          const summary = document.querySelector('aside[aria-labelledby="panorama-result-heading"]');
          const alerts = Array.from(document.querySelectorAll('[role="alert"], [role="status"]'));
          return {
            pathname: window.location.pathname,
            searchParams: Object.fromEntries(keys.map(key => [key, params.getAll(key)])),
            selectedOptions: Array.from(bar?.querySelectorAll("select") ?? []).map(select => ({
              label: select.getAttribute("aria-label"), value: select.value, disabled: select.disabled,
            })),
            regions: {
              context: !!bar,
              summary: !!summary,
              officialTotal: !!summary && Array.from(summary.querySelectorAll("span")).some(node => /^Sobre [\d.]+ votos positivos oficiales$/.test(node.textContent ?? "")),
              alertCount: alerts.filter(node => node.getAttribute("role") === "alert").length,
              statusCount: alerts.filter(node => node.getAttribute("role") === "status").length,
            },
            // Summary alerts describe the evidence status (including malformed /
            // unavailable); they contain no result rows or provenance payloads.
            summaryAlerts: Array.from(summary?.querySelectorAll('[role="alert"], [role="status"]') ?? []).map(node => node.textContent),
          };
        });
        await writeFile(test.info().outputPath("e2e-facts-panorama-summary.json"), JSON.stringify(facts));
      } catch { /* Diagnostics must not replace the original failure. */ }
      throw error;
    }
    await expect(total).toHaveText("Sobre 11.111 votos positivos oficiales");
    await category.selectOption(categories[1]!);
    await expect(category).toHaveValue(categories[1]!);
    await expect(page.getByRole("combobox", { name: "Contexto electoral: Distrito", exact: true })).toHaveValue("02");
    await expect(page.getByRole("combobox", { name: "Contexto electoral: Sección", exact: true })).toHaveValue("027");
    await expect(total).toBeVisible();
    await expect(total).toHaveText("Sobre 7.777 votos positivos oficiales");
    const exact = page.getByRole("link", { name: "Ver resultados exactos en Exploración" });
    await expect(exact).toHaveAttribute("href", new RegExp(`categoryId=${categories[1]}`));
    await expect(page.locator("#panorama-territory")).toHaveCount(0);
    await page.reload();
    await expect(total).toBeVisible();
    await expect(total).toHaveText("Sobre 7.777 votos positivos oficiales");
  }), test.info());
});

test("the authenticated page renders one navy theme regardless of the system preference", async ({ page }) => {
  await withReviewItem(page, async () => {
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: ROOT_CONTENT })).toBeVisible();
    const root = page.locator("html");
    await expect(root).toHaveCSS("color-scheme", "dark");
    await expect(root).not.toHaveAttribute("data-theme");
    await expect(page.locator("body")).toHaveCSS("background-color", "rgb(7, 17, 27)");
    await expect(page.locator(".app-shell > aside.situation-sidebar")).toHaveCSS("background-color", "rgb(8, 21, 34)");
    await expect(page.getByRole("combobox", { name: "Tema", exact: true, includeHidden: true })).toHaveCount(0);
  }
  await expect(page).toHaveURL(/\/$/);
  });
});

test("topbar anchors workspace controls while the 218px rail becomes a drawer", async ({ page }) => {
  await withReviewItem(page, async () => {
    await page.setViewportSize({ width: 1440, height: 1400 });
    await page.goto("/");
    const sidebar = page.locator(".app-shell > aside.situation-sidebar");
    const controls = page.getByRole("banner").getByRole("group", { name: "Organización y cuenta", exact: true });
    const topbar = page.getByRole("banner");
    const trigger = page.getByRole("button", { name: "Abrir navegación" });
    await expect(controls).toBeVisible();
    await expect(controls).toContainText("Organización activa: E2E Authorized Review Browser");
    await expect(topbar.getByRole("combobox", { name: "Organización", exact: true })).toHaveCount(1);
    await expect(topbar.locator("summary")).toHaveCount(1);
    await expect(trigger).toBeHidden();
    expect((await sidebar.boundingBox())!.width).toBe(218);
    const navigationBox = await sidebar.getByRole("navigation", { name: "principal" }).boundingBox();
    const controlsBox = await controls.boundingBox();
    const sidebarBox = await sidebar.boundingBox();
    expect(navigationBox).not.toBeNull();
    expect(controlsBox).not.toBeNull();
    expect(sidebarBox).not.toBeNull();
    const topbarBox = await topbar.boundingBox();
    expect(topbarBox).not.toBeNull();
    expect(controlsBox!.y).toBeGreaterThanOrEqual(topbarBox!.y);
    expect(controlsBox!.y + controlsBox!.height).toBeLessThanOrEqual(topbarBox!.y + topbarBox!.height);
    expect((await page.locator(".app-shell__workspace").boundingBox())!.x).toBe(218);

    await page.setViewportSize({ width: 1100, height: 1400 });
    expect((await sidebar.boundingBox())!.width).toBe(190);
    expect((await page.locator(".app-shell__workspace").boundingBox())!.x).toBe(190);
    await expect(controls).toBeVisible();
    await expect(trigger).toBeHidden();

    await page.setViewportSize({ width: 981, height: 900 });
    await expect(sidebar).toBeVisible();
    await expect(trigger).toBeHidden();

    await page.setViewportSize({ width: 980, height: 900 });
    await expect(sidebar).toBeHidden();
    await expect(trigger).toBeVisible();
    await trigger.click();
    const drawer = page.getByRole("dialog", { name: "Navegación principal" });
    await expect(drawer.getByRole("group", { name: "Organización y cuenta", exact: true })).toBeVisible();
    await page.setViewportSize({ width: 320, height: 400 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await page.setViewportSize({ width: 1440, height: 400 });
    await expect(drawer).toBeHidden();
    const account = controls.locator("summary", { hasText: "Cuenta" });
    await expect(account).toBeFocused();
    await expect(account).toBeInViewport({ ratio: 1 });
  });
});

test("a real same-workspace POST hides both counts until an equal-valued RSC snapshot arrives", async ({ page }) => {
  await withReviewItem(page, async () => {
    await page.goto("/");
    const topbar = page.locator("header.workspace-topbar");
    const attention = page.getByRole("complementary", { name: "Atención operativa" });
    const count = "1 elemento(s) de revisión pendiente(s)";
    for (const reader of [topbar, attention]) await expect(reader).toContainText(count);
    const organization = topbar.getByRole("combobox", { name: "Organización", exact: true });
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
      await topbar.getByRole("button", { name: "Cambiar organización" }).click();
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
      const sidebar = topbar.locator(".workspace-topbar__controls");
      const attention = page.getByRole("complementary", { name: "Atención operativa" });
      const organization = topbar.getByRole("combobox", { name: "Organización", exact: true });
      const firstId = await organization.inputValue();
      expect(firstId).not.toBe(fixture.organization_id);
      // Prepare B through onboarding, then restore A before exercising the real
      // header switch. Neither organization should interrupt the unsent-form proof.
      await prepareOrganization(page, fixture.organization_id, new URL("/", page.url()).toString());
      await prepareOrganization(page, firstId, new URL("/", page.url()).toString());
      await expect(sidebar).toContainText("Organización activa: E2E Authorized Review Browser");
      for (const reader of [topbar, attention]) await expect(reader).toContainText("1 elemento(s) de revisión pendiente(s)");
      await organization.selectOption(fixture.organization_id);
      const switched = page.waitForResponse(response => response.url().endsWith("/api/workspace") && response.request().method() === "POST");
      await topbar.getByRole("button", { name: "Cambiar organización" }).click();
      const response = await switched;
      expect(response.request().postDataJSON().organizationId).toBe(fixture.organization_id);
      expect(response.ok()).toBe(true);
      expect(await response.json()).toMatchObject({ status: "active" });
      await expect(organization).toHaveValue(fixture.organization_id);
      await expect(sidebar.locator(".workspace-identity")).toHaveText("Organización activa: E2E Authorized Fiscal Browser");
      for (const reader of [topbar, attention]) {
        await expect(reader).toContainText("Sin elementos pendientes");
        await expect(reader).not.toContainText("1 elemento(s) de revisión pendiente(s)");
        await expect(reader).not.toContainText("No se pudo verificar");
      }
      await expect(sidebar.locator(".workspace-identity")).not.toContainText("E2E Authorized Review Browser");
      for (const width of [1440, 981, 390]) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto("/");
        await expect(page.getByRole("banner")).toContainText("Sin elementos pendientes");
        await expectAccountPointerAccess(page, width);
      }
      await page.setViewportSize({ width: 1440, height: 900 });

      await page.goto("/simulate");
      const draft = page.getByLabel("Total de votos", { exact: true });
      await draft.fill("12345");
      await organization.selectOption(firstId);
      const returned = page.waitForResponse(response => response.url().endsWith("/api/workspace") && response.request().method() === "POST");
      await topbar.getByRole("button", { name: "Cambiar organización" }).click();
      const returnResponse = await returned;
      expect(returnResponse.request().postDataJSON().organizationId).toBe(firstId);
      expect(returnResponse.ok()).toBe(true);
      await expect(sidebar).toContainText("Organización activa: E2E Authorized Review Browser");
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

test("the 390px drawer submits the real workspace switch and refreshes topbar identity", async ({ page }) => {
  await withReviewItem(page, async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    const topbar = page.getByRole("banner");
    await expect(topbar.locator(".workspace-topbar__mobile-identity")).toHaveText("Organización activa: E2E Authorized Review Browser");
    await page.getByRole("button", { name: "Abrir navegación" }).click();
    const drawer = page.getByRole("dialog", { name: "Navegación principal" });
    const organization = drawer.getByRole("combobox", { name: "Organización", exact: true });
    const organizationId = await organization.inputValue();
    const switched = page.waitForResponse(response => response.url().endsWith("/api/workspace") && response.request().method() === "POST");
    await drawer.getByRole("button", { name: "Cambiar organización" }).click();
    const response = await switched;
    expect(response.request().postDataJSON()).toMatchObject({ organizationId, expectedRevision: expect.any(Number) });
    expect(response.ok()).toBe(true);
    await expect(drawer.getByRole("status").filter({ hasText: /^Organización activa\.$/ })).toBeVisible();
    await drawer.getByRole("button", { name: "Cerrar navegación" }).click();
    await expect(topbar.locator(".workspace-topbar__mobile-identity")).toHaveText("Organización activa: E2E Authorized Review Browser");
    await expect(topbar).toContainText("1 elemento(s) de revisión pendiente(s)");
  });
});

test("the short mobile drawer keeps the real organization and account group keyboard reachable", async ({ page }) => {
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
    const selectorIds = await page.locator(".workspace-footer form select").evaluateAll(elements => elements.map(element => element.id));
    expect(selectorIds).toHaveLength(2);
    expect(new Set(selectorIds).size).toBe(2);
    expect(selectorIds.every(Boolean)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
    await expect(trigger).toBeFocused();
  });
});

test("resizing an open drawer to desktop focuses the visible topbar account", async ({ page }) => {
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
    await expect(page.getByRole("group", { name: "Organización y cuenta" })).toHaveCount(1);
    await expect(page.locator(".workspace-topbar__controls").locator("summary", { hasText: "Cuenta" })).toBeFocused();
    await expect(page.getByRole("banner").getByRole("combobox", { name: "Organización", exact: true })).toHaveCount(1);
    await page.keyboard.press("Tab");
    await expect.poll(activeIsVisible).toBe(true);
  });
});

test("account controls live in the topbar and mobile drawer and preserve keyboard operation", async ({ page, context }) => {
  // Sign out only a new login session, never the harness's shared storage session.
  await context.clearCookies();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/login");
  await page.getByLabel("Correo electrónico").fill(environment.VOTUS_E2E_TEST_USER_EMAIL);
  await page.getByLabel("Contraseña").fill(environment.VOTUS_E2E_TEST_USER_PASSWORD);
  await page.getByRole("button", { name: "Iniciar sesión" }).click();
  await expect(page).toHaveURL(url => url.pathname === "/onboarding");
  await withReviewItem(page, async () => {
  const sidebar = page.locator(".app-shell > aside.situation-sidebar");
  const topbar = page.getByRole("banner");
  const controls = topbar.getByRole("group", { name: "Organización y cuenta", exact: true });
  await expect(controls).toHaveCount(1);
  await expect(controls).toContainText("Organización activa: E2E Authorized Review Browser");
  await expect(topbar.getByRole("combobox", { name: "Organización", exact: true })).toHaveCount(1);
  await expect(sidebar.getByRole("group", { name: "Organización y cuenta", exact: true, includeHidden: true })).toHaveCount(0);
  const account = controls.locator("summary").filter({ hasText: /^Cuenta$/ });
  await expect(account).toBeVisible();
  await account.focus();
  await account.press("Enter");
  const signOut = controls.getByRole("button", { name: "Cerrar sesión", exact: true });
  await expect(signOut).toBeVisible();
  await page.keyboard.press("Tab");
  const guide = controls.getByRole("link", { name: "Guía de Votus", exact: true });
  await expect(guide).toBeFocused();
  await expect(guide).toHaveAttribute("href", "/onboarding?paso=alcance");
  await page.keyboard.press("Tab");
  const privacy = controls.getByRole("link", { name: "Privacidad", exact: true });
  await expect(privacy).toBeFocused();
  await expect(privacy).toHaveAttribute("href", "/privacidad");
  await page.keyboard.press("Tab");
  await expect(signOut).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(signOut).toBeHidden();
  await expect(account).toBeFocused();
  const activeOrganizationId = await topbar.getByRole("combobox", { name: "Organización", exact: true }).inputValue();
  await account.press("Enter");
  await guide.click();
  await expect(page).toHaveURL(url => url.pathname === "/onboarding" && url.searchParams.get("paso") === "alcance");
  await expect(page.getByRole("heading", { name: "Tu alcance de trabajo", exact: true })).toBeVisible();
  const revisited = await page.request.get("/api/workspace");
  expect(revisited.ok()).toBe(true);
  expect(await revisited.json()).toMatchObject({ status: "active", activeOrganizationId, onboardingCompleted: true });
  await page.goto("/");
  await expect(page).toHaveURL(url => url.pathname === "/");

  await page.setViewportSize({ width: 320, height: 568 });
  const trigger = page.getByRole("button", { name: "Abrir navegación" });
  await trigger.click();
  const drawer = page.getByRole("dialog", { name: "Navegación principal" });
  const close = drawer.getByRole("button", { name: "Cerrar navegación" });
  const mobileControls = drawer.getByRole("group", { name: "Organización y cuenta", exact: true });
  await expect(mobileControls).toHaveCount(1);
  await expect(mobileControls).toContainText("Organización activa: E2E Authorized Review Browser");
  await expect(drawer.getByRole("combobox", { name: "Organización", exact: true })).toHaveCount(1);
  const mobileAccount = mobileControls.locator("summary").filter({ hasText: /^Cuenta$/ });
  await expect(close).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(mobileAccount).toBeFocused();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Tab");
  await expect(mobileControls.getByRole("link", { name: "Guía de Votus", exact: true })).toBeFocused();
  await page.keyboard.press("Tab");
  const mobilePrivacy = mobileControls.getByRole("link", { name: "Privacidad", exact: true });
  await expect(mobilePrivacy).toBeFocused();
  await expect(mobilePrivacy).toHaveAttribute("href", "/privacidad");
  await page.keyboard.press("Tab");
  const mobileSignOut = mobileControls.getByRole("button", { name: "Cerrar sesión", exact: true });
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
        await page.getByRole("banner").getByRole("button", { name: "Cambiar organización" }).click();
        await expect(page.getByRole("group", { name: "Organización y cuenta" })).toContainText(message);
        await expect(page.getByRole("banner").getByRole("combobox", { name: "Organización", exact: true })).toBeEnabled();
        for (const reader of readers) {
          await expect(reader).toContainText("No se pudo verificar el estado de revisión.");
          await expect(reader).not.toContainText("elemento(s) de revisión pendiente(s)");
          await expect(reader).not.toContainText("Sin elementos pendientes");
        }
      } finally { await page.unrouteAll({ behavior: "wait" }); }
      const response = page.waitForResponse(response => response.url().endsWith("/api/workspace") && response.request().method() === "POST");
      await page.getByRole("banner").getByRole("button", { name: "Cambiar organización" }).click();
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
    await page.getByRole("banner").getByRole("button", { name: "Cambiar organización" }).click();
    expect((await response).ok()).toBe(true);
    await expect(page.locator("header.workspace-topbar")).toContainText("1 elemento(s) de revisión pendiente(s)");
    await expect(draft).toHaveValue("12345");
    await expect(page).toHaveURL(/\/simulate$/);
  });
});

test("Panorama exposes supporting limits once through a keyboard-operated disclosure", async ({ page }) => {
  await withReviewItem(page, async () => {
  await page.goto("/");
  const main = page.getByRole("main");
  const disclosure = main.locator("details").filter({ has: page.locator("summary", { hasText: "Fuente y límites" }) });
  const toggle = disclosure.locator("summary");
  await expect(toggle).toHaveCount(1);
  await expect(disclosure).not.toHaveAttribute("open", "");
  const source = page.getByRole("combobox", { name: "Contexto electoral: Fuente", exact: true });
  await expect(source).toBeVisible();
  await expect(source).toHaveValue("official");
  await expect(source.locator("option:checked")).toHaveText("Oficial");
  await toggle.focus();
  await page.keyboard.press("Enter");
  await expect(disclosure).toHaveAttribute("open", "");
  for (const text of ["Fiscalización es una fuente no oficial", "Aplicabilidad electoral desconocida", "No hay participación, comparación histórica ni pronóstico"]) {
    await expect(main.getByText(text, { exact: false })).toHaveCount(1);
    await expect(disclosure.getByText(text, { exact: false })).toBeVisible();
  }
  await page.keyboard.press("Enter");
  await expect(disclosure).not.toHaveAttribute("open", "");
  });
});

test("Panorama places the map beside its summary and stacks them on mobile",  async ({ page }, testInfo) => {
  await withReviewItem(page, async () => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  const heading = page.getByRole("heading", { level: 1, name: ROOT_CONTENT, exact: true });
  try {
    await expect(heading).toBeVisible();
  } catch (error) {
    await writeWorkspaceStateFacts(page, testInfo, "panorama-heading-failure");
    throw error;
  }
  await expect(heading).toHaveCSS("font-size", "32px");
  const main = page.getByRole("main");
  const explore = main.getByRole("link", { name: "Explorar resultados", exact: true }).first();
  const attention = main.getByRole("complementary", { name: "Atención operativa" });
  const actionBox = await explore.boundingBox();
  const attentionBox = await attention.boundingBox();
  expect(actionBox).not.toBeNull();
  expect(attentionBox).not.toBeNull();
  expect(attentionBox!.y).toBeGreaterThan(actionBox!.y + actionBox!.height);
  const map = main.getByRole("region", { name: "Mapa territorial de referencia", exact: true }).or(main.getByRole("region", { name: "Ganadores por circuito", exact: true }));
  const summary = main.getByRole("complementary", { name: "Lectura de la selección" });
  const mapBox = await map.boundingBox();
  const summaryBox = await summary.boundingBox();
  try {
    expect(summaryBox!.x).toBeGreaterThanOrEqual(mapBox!.x + mapBox!.width);
    expect(mapBox!.y).toBeGreaterThanOrEqual(0);
    expect(mapBox!.y + mapBox!.height).toBeLessThanOrEqual(900);
    expect(summaryBox!.y + summaryBox!.height).toBeLessThanOrEqual(900);
    // Every supplied headline figure must fit without scrolling, not merely its container.
    for (const metric of await summary.locator("strong, b").all()) {
      const box = await metric.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.y + box!.height).toBeLessThanOrEqual(900);
    }
  } catch (error) {
    const facts = await page.evaluate(() => {
      const geometry = (element: Element | null) => {
        if (!element) return null;
        const { y, height } = element.getBoundingClientRect();
        return { y, height };
      };
      const main = document.querySelector("main");
      const heading = main?.querySelector("h1");
      const summary = main?.querySelector('[aria-labelledby="panorama-result-heading"]');
      const map = main?.querySelector('[aria-label="Mapa territorial de referencia"], [aria-label="Ganadores por circuito"]');
      return {
        viewport: { width: window.innerWidth, height: window.innerHeight },
        banner: geometry(Array.from(document.querySelectorAll("header")).find(element => !element.closest("main")) ?? null),
        context: geometry(document.querySelector('[aria-label="Contexto electoral"]')),
        pageHeader: geometry(heading?.closest("header") ?? heading?.parentElement ?? null),
        map: geometry(map ?? null),
        mapRegion: map?.getAttribute("aria-label") ?? null,
        summary: geometry(summary ?? null),
        summaryMessages: Array.from(summary?.querySelectorAll('[role="status"], [role="alert"]') ?? [])
          .filter(element => element.getClientRects().length > 0 && getComputedStyle(element).visibility === "visible")
          .map(element => ({ role: element.getAttribute("role"), text: (element as HTMLElement).innerText })),
      };
    });
    await writeFile(testInfo.outputPath("e2e-facts-panorama-fold.json"), JSON.stringify(facts, null, 2));
    throw error;
  }
  const limits = main.locator("details").filter({ has: page.locator("summary", { hasText: /^Fuente y límites$/ }) });
  await expect(limits).not.toHaveAttribute("open", "");
  await limits.locator("summary").click();
  await expect(main.getByRole("heading", { name: "Límites y evidencia", exact: true })).toBeVisible();
  await limits.locator("summary").click();
  await expectNoSevereAccessibilityIssues(page);
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    const action = await explore.boundingBox();
    const rail = await attention.boundingBox();
    const mobileMap = await map.boundingBox();
    const mobileSummary = await summary.boundingBox();
    expect(mobileSummary!.y).toBeGreaterThanOrEqual(mobileMap!.y + mobileMap!.height);
    expect(action!.y + action!.height).toBeLessThan(rail!.y);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    for (const href of ["/drilldown", "/compare", "/municipal", "/fiscalizacion", "/simulate", "/review"]) {
      await expect(main.locator(`a[href^="${href}"]`).first()).toBeVisible();
    }
    await expectNoSevereAccessibilityIssues(page);
    await page.getByRole("button", { name: "Abrir navegación" }).click();
    await expectNoSevereAccessibilityIssues(page);
    await page.keyboard.press("Escape");
  }
  });
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

    await withReviewItem(page, async () => {
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
      page.getByRole("heading", { level: 1, name: ROOT_CONTENT }),
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
    await expect(drawer).not.toContainText(
      "Esta herramienta no es una fuente electoral oficial.",
    );
    await expect(page.locator("footer.app-footer")).toContainText(
      "Esta herramienta no es una fuente electoral oficial.",
    );
    for (const groupLabel of [
      "Panorama", "Exploración", "Comparación", "Simulación", "Evidencia",
    ]) {
      await expect(
        drawerNavigation.getByRole("link", { name: groupLabel, exact: true }),
      ).toBeVisible();
    }
    for (const [label, href] of [
      ["Panorama", "/"],
      ["Exploración", "/drilldown"],
      ["Municipal", "/municipal"],
      ["Comparación", "/compare"],
      ["Simulación", "/simulate"],
      ["Escenarios Rosales 2027", "/scenarios"],
      ["Evidencia", "/evidencia"],
      ["Revisión de datos", "/review"],
      ["Fiscalización (no oficial)", "/fiscalizacion"],
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
        name: "Panorama",
        exact: true,
      }),
    ).toHaveAttribute("aria-current", "page");

    await page.keyboard.press("Shift+Tab");
    await expect(drawer.locator("summary", { hasText: "Cuenta" })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(closeDrawer).toBeFocused();

    const comparisonDrawerLink = drawerNavigation.getByRole("link", {
      name: "Exploración",
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
    await drawerNavigation.getByRole("link", { name: "Comparación", exact: true }).click();
    await expect(page).toHaveURL(/\/compare$/);
    await expect(drawer).toBeHidden();

    await page.setViewportSize({ width: 320, height: 844 });
    await expect(topbar).toBeVisible();
    await expect(topbar).not.toContainText("Organización sin verificar");
    await expect(topbar.getByRole("link", { name: "1 elemento(s) de revisión pendiente(s)", exact: true })).toBeVisible();
    await expect(topbar).not.toContainText("No se pudo verificar el estado de revisión.");
    await expect(topbar).not.toContainText("Sin elementos pendientes");
    await drawerTrigger.click();
    const footer = drawer.getByRole("group", { name: "Organización y cuenta" });
    await expect(footer).toContainText("Organización activa: E2E Authorized Review Browser");
    await expect(drawer.getByRole("combobox", { name: "Organización", exact: true })).toHaveCount(1);
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
    expect(sidebarBox!.width).toBe(218);
    expect(topbarBox!.height).toBe(64);
    expect(contentContainer!.x).toBeGreaterThanOrEqual(
      sidebarBox!.x + sidebarBox!.width,
    );
    expect(
      Math.abs(topbarContainer!.x - contentContainer!.x),
    ).toBeLessThanOrEqual(1);
    await expect(sidebar).not.toContainText(
      "Esta herramienta no es una fuente electoral oficial.",
    );
    await expect(page.locator("footer.app-footer")).toContainText(
      "Esta herramienta no es una fuente electoral oficial.",
    );
    await expect(
      desktopNavigation.locator('a[aria-current="page"]'),
    ).toHaveCount(1);
    await expect(
      desktopNavigation.getByRole("link", {
        name: "Panorama",
        exact: true,
      }),
    ).toHaveAttribute("aria-current", "page");
    for (const navigationLabel of [
      "Exploración",
      "Municipal",
      "Comparación",
      "Simulación",
      "Escenarios Rosales 2027",
      "Evidencia",
      "Revisión de datos",
      "Fiscalización (no oficial)",
    ]) {
      await expect(
        desktopNavigation.getByRole("link", {
          name: navigationLabel,
          exact: true,
        }),
      ).toBeVisible();
    }

    await expect(desktopNavigation.getByRole("link")).toHaveText([
      "Panorama", "Exploración", "Municipal", "Comparación", "Simulación",
      "Escenarios Rosales 2027", "Evidencia", "Revisión de datos", "Fiscalización (no oficial)",
    ]);
    await expect(desktopNavigation.getByRole("link", { name: "Evidencia", exact: true })).toHaveAttribute("href", "/evidencia");
    await expect(desktopNavigation.getByRole("link", { name: "Revisión de datos", exact: true })).toHaveAttribute("href", "/review");

    await expect(page.getByRole("main").getByRole("heading", { name: ROOT_CONTENT, exact: true })).toBeVisible();
    const officialRoutes = page.getByRole("main").getByRole("region", { name: "Continuar el análisis", exact: true });
    await expect(officialRoutes).toContainText("Contrastar bases y reconocer sus condiciones de comparabilidad.");
    const explorationHref = await officialRoutes.getByRole("link", { name: "Explorar resultados", exact: true }).getAttribute("href");
    expect(explorationHref).not.toBeNull();
    const carried = new URL(explorationHref!, page.url()).searchParams;
    carried.delete("level");
    await expect(officialRoutes.getByRole("link", { name: "Comparar elecciones" })).toHaveAttribute("href", `/compare${carried.size ? `?${carried}` : ""}`);
    // Municipal is a separated flow in the approved Panorama, outside the official routes.
    const separatedRoutes = page.getByRole("main").getByRole("region", { name: "Otros alcances · flujos separados", exact: true });
    await expect(separatedRoutes).toContainText("Coronel Rosales · Concejales 2025. Elección configurada.");
    await expect(separatedRoutes.getByRole("link", { name: "Resultados municipales" })).toHaveAttribute("href", "/municipal");
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
});

test("an unknown route answers with the Spanish not-found page (#600)", async ({ page }) => {
  await withReviewItem(page, async () => {
    const response = await page.goto("/ruta-que-no-existe");
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { level: 1, name: "Página no encontrada", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Volver al inicio", exact: true })).toHaveAttribute("href", "/");
  });
});
