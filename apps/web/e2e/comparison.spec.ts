import { expect, test, type Locator, type Page } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import { assertE2eEnvironment } from "./gate-contract";
import { alignedOccupiedGeometry, type Raster } from "./map-raster";
import { comparisonFixture, withResultFixture } from "./result-fixture";
import type { ResultScenarioIdentity } from "./scenario-ownership";
import { scenarioBaseUrl } from "./scenario-ownership";
const environment = assertE2eEnvironment(process.env), SPEC = "e2e/comparison.spec.ts";
const { identity, seed } = comparisonFixture(SPEC), baseURL = scenarioBaseUrl(SPEC, environment);
interface WorkspaceFixture { organization_id: string; user_id: string; distrito_code: string; seccion_code: string; extra_seccion_code?: string; }
function workspaceControls(page: Page): Locator {
  return page.getByRole("banner");
}
async function withAuthorizedComparisonWorkspace<T>(page: Page, run: (revokeAuthorization: () => Promise<void>) => Promise<T>, fixtureIdentity: ResultScenarioIdentity = identity): Promise<T> {
  const admin = createClient(environment.NEXT_PUBLIC_SUPABASE_URL, environment.SUPABASE_SERVICE_ROLE_KEY);
  const { data: users, error: userError } = await admin.auth.admin.listUsers();
  const user = users?.users.find((candidate) => candidate.email?.toLowerCase() === environment.VOTUS_E2E_TEST_USER_EMAIL.toLowerCase());
  if (userError || !user) throw new Error("failed to resolve comparison fixture user");
  const { data, error } = await admin.rpc("e2e_setup_authorized_fiscal_fixture", { p_user_id: user.id, p_distrito_code: fixtureIdentity.distritoCode, p_seccion_code: fixtureIdentity.seccionCode });
  if (error || typeof data?.organization_id !== "string") throw new Error("failed to set up authorized comparison fixture");
  let fixture = data as WorkspaceFixture;
  const leftOnlySection = fixtureIdentity.comparisonLeftOnlySection;
  if (!leftOnlySection) throw new Error("comparison fixture left-only section is missing");
  const extension = await admin.rpc("e2e_extend_authorized_fiscal_fixture", { p_fixture: fixture, p_distrito_code: leftOnlySection.distritoCode, p_seccion_code: leftOnlySection.seccionCode });
  if (extension.error || extension.data?.organization_id !== fixture.organization_id || extension.data?.extra_seccion_code !== leftOnlySection.seccionCode) {
    const cause = new Error("failed to extend authorized comparison fixture");
    const cleanup = await admin.rpc("e2e_cleanup_authorized_fiscal_fixture", { p_fixture: fixture });
    if (cleanup.error || cleanup.data?.cleaned !== true) throw new AggregateError([cause, new Error(cleanup.error?.message ?? "comparison fixture setup cleanup failed")], "comparison fixture setup and cleanup failed");
    throw cause;
  }
  fixture = extension.data as WorkspaceFixture;
  let outcome: { value: T } | { error: unknown }; let cleanupError: Error | null = null;
  try {
    await page.goto(new URL("/dashboard", baseURL).toString());
    const controls = workspaceControls(page);
    const selector = controls.getByRole("combobox", { name: "Organización", exact: true }); await expect(selector).toBeVisible(); await selector.selectOption(fixture.organization_id);
    const switched = page.waitForResponse((response) => response.url().endsWith("/api/workspace") && response.request().method() === "POST"); await controls.getByRole("button", { name: "Cambiar organización" }).click(); const response = await switched;
    expect({ ok: response.ok(), body: await response.json() }).toMatchObject({ ok: true, body: { status: "active" } });
    const revokeAuthorization = async (): Promise<void> => { const revoked = await admin.rpc("e2e_revoke_authorized_fiscal_fixture", { p_fixture: fixture }); if (revoked.error || revoked.data?.revoked !== true || revoked.data?.revoked_scope_count !== 2) throw new Error("failed to revoke authorized comparison fixture"); };
    outcome = { value: await run(revokeAuthorization) };
  } catch (caught) { outcome = { error: caught }; }
  finally {
    try {
      const cleanup = await admin.rpc("e2e_cleanup_authorized_fiscal_fixture", { p_fixture: fixture });
      if (cleanup.error || cleanup.data?.cleaned !== true) cleanupError = new Error(cleanup.error?.message ?? "comparison fixture cleanup failed");
    } catch (caught) { cleanupError = caught instanceof Error ? caught : new Error("comparison fixture cleanup failed"); }
  }
  if ("error" in outcome) { if (cleanupError) throw new AggregateError([outcome.error, cleanupError], "comparison assertions and cleanup failed"); throw outcome.error; }
  if (cleanupError) throw cleanupError; return outcome.value;
}
async function writeSignInFailureFacts(page: Page): Promise<string> {
  const path = test.info().outputPath("e2e-facts-sign-in.json");
  const facts = await page.evaluate(() => ({
    pathname: location.pathname,
    hasReturnTo: new URLSearchParams(location.search).has("returnTo"),
    fields: Array.from(document.querySelectorAll<HTMLInputElement>("input:not([type=hidden])"), input => ({
      type: input.type, empty: input.value.length === 0, valid: input.validity.valid,
    })),
    alertCount: document.querySelectorAll('[role="alert"]').length,
    hasGenericError: document.getElementById("login-error")?.textContent === "Las credenciales no son válidas.",
    pending: document.querySelector("form")?.getAttribute("aria-busy") === "true",
  }));
  await writeFile(path, JSON.stringify(facts));
  return path;
}
test.describe("authorized official comparison", () => {
  test("real sign-in resumes exact exploration/comparison and rechecks revoked access", async ({ page, context }) => {
    await withResultFixture(SPEC, seed, async () => withAuthorizedComparisonWorkspace(page, async (revokeAuthorization) => {
      await page.setViewportSize({ width: 1440, height: 1000 });
      const organization = await workspaceControls(page).getByRole("combobox", { name: "Organización", exact: true }).inputValue();
      const common = { electionId: identity.electionIds[0]!, categoryId: identity.categoryId,
        distritoCode: identity.distritoCode, seccionCode: identity.seccionCode, sourceKind: "official" };
      const exploration = `/drilldown?${new URLSearchParams({ ...common, level: "seccion" })}`;
      const comparison = `/compare?${new URLSearchParams({ ...common, bElectionId: identity.electionIds[1]!, bCategoryId: identity.categoryId })}`;
      const resume = async (destination: string): Promise<void> => {
        await context.clearCookies();
        await page.goto(new URL(destination, baseURL).toString());
        await expect.poll(() => new URL(page.url()).searchParams.get("returnTo")).toBe(destination);
        await expect(page.getByRole("main")).not.toContainText(identity.archiveEntryIds[0]!);
        // A failed attempt must not discard the hidden destination.
        await page.getByLabel("Correo electrónico").fill(environment.VOTUS_E2E_TEST_USER_EMAIL);
        await page.getByLabel("Contraseña").fill("synthetic-invalid-password");
        await page.getByRole("button", { name: "Iniciar sesión" }).click();
        try {
          await expect(page.locator("#login-error")).toHaveText("Las credenciales no son válidas.");
        } catch (error) {
          await test.info().attach("sign-in-failure", {
            path: await writeSignInFailureFacts(page), contentType: "application/json",
          });
          throw error;
        }
        // React actions reset uncontrolled fields after submission, including failed sign-in.
        await page.getByLabel("Correo electrónico").fill(environment.VOTUS_E2E_TEST_USER_EMAIL);
        await page.getByLabel("Contraseña").fill(environment.VOTUS_E2E_TEST_USER_PASSWORD);
        await page.getByRole("button", { name: "Iniciar sesión" }).click();
        await expect(page).toHaveURL(new URL(destination, baseURL).toString());
        // Fresh sessions may require the existing authorized workspace prerequisite.
        const selector = workspaceControls(page).getByRole("combobox", { name: "Organización", exact: true });
        await selector.selectOption(organization);
        const switched = page.waitForResponse(response => new URL(response.url()).pathname === "/api/workspace" && response.request().method() === "POST");
        await workspaceControls(page).getByRole("button", { name: "Cambiar organización" }).click();
        expect((await switched).ok()).toBe(true);
        await expect(page).toHaveURL(new URL(destination, baseURL).toString());
      };
      for (const destination of [exploration, comparison]) {
        await resume(destination);
        await expect(page.getByRole("main").locator("table").filter({ hasText: identity.comparisonParty!.displayName }).first()).toContainText(identity.comparisonParty!.displayName);
      }
      await revokeAuthorization();
      await resume(comparison);
      const main = page.getByRole("main");
      await expect(main.getByRole("alert")).toContainText("No tiene autorización");
      await expect(main.getByRole("table")).toHaveCount(0);
      for (const archive of identity.archiveEntryIds) await expect(main).not.toContainText(archive);
      await expect(workspaceControls(page).getByRole("combobox", { name: "Organización", exact: true })).toBeVisible();
    }));
  });
  for (const width of [1440, 390]) {
    test(`selection survives Panorama → Exploración → Comparación at ${width}px (#442)`, async ({ page }) => {
      await withResultFixture(SPEC, seed, async () => withAuthorizedComparisonWorkspace(page, async () => {
        await page.setViewportSize({ width, height: 1000 });
        const context = new URLSearchParams({
          electionId: identity.electionIds[0]!, categoryId: identity.categoryId, sourceKind: "official",
          distritoCode: identity.distritoCode, seccionCode: identity.seccionCode,
          bElectionId: identity.electionIds[1]!, bCategoryId: identity.categoryId,
        });
        await page.goto(new URL(`/?${context}`, baseURL).toString());
        await page.getByRole("main").getByRole("link", { name: "Explorar resultados", exact: true }).click();
        await expect(page).toHaveURL(url => url.pathname === "/drilldown" && [...context].every(([key, value]) => url.searchParams.get(key) === value) && url.searchParams.get("level") === "seccion");
        await expect(page.getByRole("main").getByRole("table").first()).toBeVisible();
        const navigation = width === 390
          ? page.getByRole("dialog", { name: "Navegación principal" }).getByRole("navigation", { name: "principal", exact: true })
          : page.locator(".app-shell > aside.situation-sidebar").getByRole("navigation", { name: "principal", exact: true });
        if (width === 390) await page.getByRole("button", { name: "Abrir navegación" }).click();
        await navigation.getByRole("link", { name: "Comparación", exact: true }).click();
        await expect(page).toHaveURL(url => url.pathname === "/compare" && [...context].every(([key, value]) => url.searchParams.get(key) === value) && !url.searchParams.has("level"));
        await expect(page.getByRole("main").getByRole("heading", { name: "Resultados exactos", exact: true })).toBeVisible();
        const bar = page.getByRole("region", { name: "Contexto electoral", exact: true });
        await expect(bar.getByRole("combobox", { name: "Contexto electoral: Elección", exact: true })).toHaveValue(identity.electionIds[0]!);
        await expect(bar.getByRole("combobox", { name: "Contexto electoral: Sección", exact: true })).toHaveValue(identity.seccionCode);
      }));
    });
  }

  // A changed frame alone can be inertia or a WebGL repaint, not a settled camera.
  async function settledMap(map: Locator, phase: string): Promise<{ image: Buffer; width: number; height: number }> {
    let previous: Buffer | undefined;
    let width = 0, height = 0, consecutive = 0;
    await expect.poll(async () => {
      const box = await map.boundingBox();
      if (!box) return false;
      const image = await map.screenshot();
      if (box.width === width && box.height === height && previous?.equals(image)) consecutive += 1;
      else consecutive = 1;
      width = box.width; height = box.height; previous = image;
      return consecutive >= 3;
    }, { message: `${phase}: map viewport never stabilized`, timeout: 10000, intervals: [150] }).toBe(true);
    return { image: previous!, width, height };
  }
  async function expectElectoralFill(page: Page, map: Locator, image: Buffer, fill: readonly number[], phase: string): Promise<{ raster: Raster; composited: number[] }> {
    // The screenshot composites deck.gl over the actual page; WebGL readback need not survive a frame.
    const pixels = await page.evaluate(async (bytes) => {
      if (typeof createImageBitmap !== "function" || typeof OffscreenCanvas === "undefined") throw new Error("PNG raster readback is unsupported in this browser");
      const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: "image/png" }));
      try {
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) throw new Error("PNG raster 2D readback is unsupported in this browser");
        context.drawImage(bitmap, 0, 0);
        const data = context.getImageData(0, 0, bitmap.width, bitmap.height);
        return { width: data.width, height: data.height, rgba: Array.from(data.data) };
      } finally { bitmap.close(); }
    }, [...image]);
    const box = await map.boundingBox();
    if (!box || pixels.width < 100 || pixels.height < 100 || Math.abs(pixels.width / box.width - pixels.height / box.height) > 0.02) {
      throw new Error(`${phase}: map screenshot dimensions are invalid`);
    }
    const sample = (x: number, y: number) => pixels.rgba.slice((y * pixels.width + x) * 4, (y * pixels.width + x) * 4 + 4);
    // fitBounds leaves 24 CSS pixels clear. Confirm all corners are the same opaque backdrop.
    const corners = [[3, 3], [pixels.width - 4, 3], [3, pixels.height - 4], [pixels.width - 4, pixels.height - 4]];
    const background = sample(3, 3);
    if (background[3] !== 255 || corners.some(([x, y]) => sample(x!, y!).some((channel, index) => Math.abs(channel - background[index]!) > 2))) {
      throw new Error(`${phase}: cannot establish a uniform opaque map screenshot background`);
    }
    const expected = [...fill]; // Shared electoral fills are opaque to preserve contrast against navy.
    let interior = 0;
    // Skip edges, labels and controls; the polygon must cover a substantial interior area.
    for (let y = 16; y < pixels.height - 16; y += 2) {
      for (let x = 16; x < pixels.width - 16; x += 2) {
        const pixel = sample(x, y);
        if (pixel[3] === 255 && expected.every((channel, index) => Math.abs(pixel[index]! - channel) <= 3)) interior++;
      }
    }
    expect(interior, `${phase}: expected substantial electoral polygon fill ${expected.join(",")} over background ${background.slice(0, 3).join(",")}; neutral municipal fill and outline do not qualify`).toBeGreaterThan(100);
    return { raster: pixels, composited: expected };
  }
  function expectSameViewport(left: { width: number; height: number }, right: { width: number; height: number }, phase: string) {
    expect([right.width, right.height], `${phase}: map viewport resized`).toEqual([left.width, left.height]);
  }
  test("retains the first map camera on late activation, synchronizes both directions and focuses exact results", async ({ page }) => {
    const spatial = comparisonFixture(SPEC, "spatial");
    await withResultFixture(SPEC, spatial.seed, async () => withAuthorizedComparisonWorkspace(page, async () => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      const params = new URLSearchParams({
        leftElectionId: spatial.identity.electionIds[0]!, leftCategoryId: spatial.identity.categoryId,
        rightElectionId: spatial.identity.electionIds[1]!, rightCategoryId: spatial.identity.categoryId,
        distritoCode: "02", seccionCode: "027",
      });
      await page.goto(new URL(`/compare?${params}`, baseURL).toString());
      const main = page.getByRole("main");
      const panel = main.getByRole("region", { name: "Comparación territorial de referencia" });
      await expect(panel).toBeVisible();
      const first = panel.getByRole("article", { name: "Lado A — 2023 generales" });
      const second = panel.getByRole("article", { name: "Lado B — 2025 legislativas" });
      await first.locator('[data-map-controls] > summary').click();
      await first.getByRole("button", { name: "Activar mapa interactivo de Lado A — 2023 generales" }).click();
      await expect(first.getByRole("status")).toContainText("Mapa de", { timeout: 15000 });
      const firstMap = first.locator(".maplibregl-map");
      const secondMap = second.locator(".maplibregl-map");
      await expect(firstMap.locator("canvas.maplibregl-canvas")).toBeVisible();
      const original = await settledMap(firstMap, "initial first map");
      const leftFill = [102, 195, 210]; // 60% of fixed [103,143,162] → [101,229,242], rounded per channel.
      const rightFill = [102, 208, 222]; // Same selected party as A: 9,000 / (9,000 + 3,000) = 75%, using the fixed endpoints.
      await expectElectoralFill(page, firstMap, original.image, leftFill, "initial first map");
      const bounds = await firstMap.boundingBox();
      if (!bounds) throw new Error("first map has no bounds");
      await page.mouse.move(bounds.x + bounds.width * 0.5, bounds.y + bounds.height * 0.5);
      await page.mouse.down();
      await page.mouse.move(bounds.x + bounds.width * 0.72, bounds.y + bounds.height * 0.38, { steps: 8 });
      await page.mouse.up();
      const panned = await settledMap(firstMap, "first map after user pan");
      expectSameViewport(original, panned, "first pan");
      expect(panned.image.equals(original.image), "user pan did not change the settled map view").toBe(false);
      await second.locator('[data-map-controls] > summary').click();
      await second.getByRole("button", { name: "Activar mapa interactivo de Lado B — 2025 legislativas" }).click();
      await expect(second.getByRole("status")).toContainText("Mapa de", { timeout: 15000 });
      await expect(secondMap.locator("canvas.maplibregl-canvas")).toBeVisible();
      const synchronized = await settledMap(secondMap, "second map after activation");
      const inheritedFill = await expectElectoralFill(page, secondMap, synchronized.image, rightFill, "second map after activation");
      const pannedFill = await expectElectoralFill(page, firstMap, panned.image, leftFill, "first map after pan");
      const retained = await settledMap(firstMap, "first map after both views settled");
      expectSameViewport(panned, synchronized, "paired views");
      expectSameViewport(panned, retained, "late activation");
      expect(retained.image.equals(panned.image), "settled first map view reset after second activation").toBe(true);
      expect(alignedOccupiedGeometry(pannedFill.raster, pannedFill.composited, inheritedFill.raster, inheritedFill.composited), "second map did not inherit the settled first polygon geometry within one pixel").toBe(true);
      const secondBounds = await secondMap.boundingBox();
      if (!secondBounds) throw new Error("second map has no bounds");
      await page.mouse.move(secondBounds.x + secondBounds.width * 0.5, secondBounds.y + secondBounds.height * 0.5);
      await page.mouse.down();
      await page.mouse.move(secondBounds.x + secondBounds.width * 0.35, secondBounds.y + secondBounds.height * 0.65, { steps: 8 });
      await page.mouse.up();
      const secondPanned = await settledMap(secondMap, "second map after user pan");
      expectSameViewport(synchronized, secondPanned, "second pan");
      expect(secondPanned.image.equals(synchronized.image), "second user pan did not change the settled map view").toBe(false);
      const firstSynchronized = await settledMap(firstMap, "first map after second pan");
      expectSameViewport(secondPanned, firstSynchronized, "reverse synchronization");
      const reverseLeft = await expectElectoralFill(page, firstMap, firstSynchronized.image, leftFill, "first map after second pan");
      const reverseRight = await expectElectoralFill(page, secondMap, secondPanned.image, rightFill, "second map after user pan");
      expect(alignedOccupiedGeometry(reverseLeft.raster, reverseLeft.composited, reverseRight.raster, reverseRight.composited), "first map did not inherit the second polygon geometry within one pixel").toBe(true);
      await second.getByRole("button", { name: "Seleccionar sección y consultar resultados" }).click();
      await expect(main.getByRole("heading", { name: "Resultados exactos" })).toBeFocused();
      await expect(main.locator('[data-results-for="compare-results-heading"]')).toHaveAttribute("open", "");
      await expect(main.getByRole("table")).toContainText(spatial.identity.comparisonParty!.displayName);
    }, spatial.identity), "spatial");
  });
  test("keeps paired spatial articles and interactive canvases within narrow mobile viewports", async ({ page }) => {
    async function tabTo(target: Locator, label: string): Promise<void> {
      for (let step = 1; step <= 40; step++) {
        await page.keyboard.press("Tab");
        if (await target.evaluate((element) => element === document.activeElement)) return;
      }
      const focused = await page.evaluate(() => {
        const element = document.activeElement;
        return element ? `${element.tagName.toLowerCase()} ${element.getAttribute("aria-label") ?? element.textContent?.trim().slice(0, 80) ?? ""}` : "none";
      });
      throw new Error(`${label} was not reachable within 40 Tabs; focused: ${focused}`);
    }
    const spatial = comparisonFixture(SPEC, "spatial");
    await withResultFixture(SPEC, spatial.seed, async () => withAuthorizedComparisonWorkspace(page, async () => {
      const params = new URLSearchParams({ leftElectionId: spatial.identity.electionIds[0]!, leftCategoryId: spatial.identity.categoryId, rightElectionId: spatial.identity.electionIds[1]!, rightCategoryId: spatial.identity.categoryId, distritoCode: "02", seccionCode: "027" });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(new URL(`/compare?${params}`, baseURL).toString());
      const panel = page.getByRole("region", { name: "Comparación territorial de referencia" });
      const articles = [panel.getByRole("article", { name: "Lado A — 2023 generales" }), panel.getByRole("article", { name: "Lado B — 2025 legislativas" })];
      for (const width of [390, 320]) {
        await page.setViewportSize({ width, height: 844 });
        const selectors = page.locator('form[action="/compare"] select');
        let previousBottom = 0;
        for (const selector of await selectors.all()) {
          const box = await selector.boundingBox();
          if (!box) throw new Error("comparison selector has no bounds");
          expect(box.y).toBeGreaterThanOrEqual(previousBottom);
          previousBottom = box.y + box.height;
          const textFits = await selector.evaluate((element) => {
            const select = element as HTMLSelectElement;
            const style = getComputedStyle(select);
            const context = document.createElement("canvas").getContext("2d")!;
            context.font = style.font;
            const textWidth = context.measureText(select.selectedOptions[0]!.text).width;
            // Reserve native-arrow space as well as both CSS paddings.
            return textWidth <= select.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) - 24;
          });
          expect(textFits, `selected text must fit at ${width}px`).toBe(true);
        }
        for (const article of articles) {
          await expect(article).toBeVisible();
          const box = await article.boundingBox();
          if (!box) throw new Error("spatial article has no bounds");
          expect(box.x).toBeGreaterThanOrEqual(0);
          expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
        }
        const first = await articles[0]!.boundingBox(), second = await articles[1]!.boundingBox();
        expect(second!.y).toBeGreaterThanOrEqual(first!.y + first!.height - 2);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      }
      for (const article of articles) {
        await article.locator('[data-map-controls] > summary').click();
        const activate = article.getByRole("button", { name: /Activar mapa interactivo de Lado/ });
        await tabTo(activate, `map activation in ${await article.getAttribute("aria-label")}`);
        await expect(activate).toBeFocused();
        await page.keyboard.press("Enter");
        await expect(article.getByRole("status")).toContainText("Mapa de", { timeout: 15000 });
        const canvas = article.locator("canvas.maplibregl-canvas");
        await expect(canvas).toBeVisible();
        const box = await canvas.boundingBox();
        if (!box) throw new Error("visible spatial canvas has no bounds");
        expect(box.width).toBeGreaterThan(100);
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(321);
      }
      const select = articles[1]!.getByRole("button", { name: "Seleccionar sección y consultar resultados" });
      await tabTo(select, "second map section selection");
      await expect(select).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(page.getByRole("heading", { name: "Resultados exactos" })).toBeFocused();
      await expect(page.locator('[data-results-for="compare-results-heading"]')).toHaveAttribute("open", "");
    }, spatial.identity), "spatial");
  });

  test("preserves exact official comparison when WebGL is unavailable", async ({ page }) => {
    await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, ...args) {
        if (args[0] === "webgl2") return null;
        return original.apply(this, args);
      } as typeof HTMLCanvasElement.prototype.getContext;
    });
    const spatial = comparisonFixture(SPEC, "spatial");
    await withResultFixture(SPEC, spatial.seed, async () => withAuthorizedComparisonWorkspace(page, async () => {
      const params = new URLSearchParams({ leftElectionId: spatial.identity.electionIds[0]!, leftCategoryId: spatial.identity.categoryId, rightElectionId: spatial.identity.electionIds[1]!, rightCategoryId: spatial.identity.categoryId, distritoCode: "02", seccionCode: "027" });
      await page.goto(new URL(`/compare?${params}`, baseURL).toString());
      const main = page.getByRole("main"), panel = main.getByRole("region", { name: "Comparación territorial de referencia" });
      const table = main.getByRole("table");
      // The exact table is folded behind its own disclosure; open it before reading (assertion unchanged).
      await main.locator("details", { hasText: "Tabla exacta —" }).locator("summary").click();
      await expect(table).toContainText(spatial.identity.comparisonParty!.displayName);
      await expect(main).toContainText(spatial.identity.archiveEntryIds[0]!);
      await expect(main).toContainText(spatial.identity.archiveEntryIds[1]!);
      await expect(main).toContainText("SHA-256");
      await panel.getByRole("article", { name: "Lado A — 2023 generales" }).locator('[data-map-controls] > summary').click();
      const activate = panel.getByRole("article", { name: "Lado A — 2023 generales" }).getByRole("button", { name: "Activar mapa interactivo de Lado A — 2023 generales" });
      await activate.focus();
      await page.keyboard.press("Enter");
      await expect(panel.getByRole("status").first()).toContainText("Mapa no disponible; los resultados exactos siguen disponibles.");
      await expect(panel.locator("canvas.maplibregl-canvas")).toHaveCount(0);
      await expect(table).toBeVisible();
      await expect(page.getByRole("navigation", { name: "principal" }).getByRole("link", { name: "Comparación", exact: true })).toBeVisible();
      await expect(main).not.toContainText("999 votos");
    }, spatial.identity), "spatial");
  });

  test("corrects a figure-free mixed-granularity refusal through the retained scope selector", async ({ page }) => {
    await withResultFixture(SPEC, seed, async () => {
      const extra = identity.comparisonLeftOnlySection!;
      // Extend only this scenario's owned rows, jurisdiction and archive. The
      // existing archive-scoped fixture cleanup also owns the added row.
      const admin = createClient(environment.NEXT_PUBLIC_SUPABASE_URL, environment.SUPABASE_SERVICE_ROLE_KEY);
      const changed = await admin.from("result_row").update({ granularity: "mesa" })
        .eq("archive_entry_id", extra.archiveEntryId);
      if (changed.error) throw new Error("failed to prepare refused comparison scope");
      const added = await admin.from("result_row").insert({
        ...seed.rows.find(row => row.election_id === identity.electionIds[1])!,
        jurisdiction_id: extra.jurisdictionId, source_row_index: 2,
      });
      if (added.error) throw new Error("failed to prepare paired comparison scope");
      await withAuthorizedComparisonWorkspace(page, async () => {
        const params = new URLSearchParams({ electionId: identity.electionIds[0]!, bElectionId: identity.electionIds[1]!, categoryId: identity.categoryId, bCategoryId: identity.categoryId, distritoCode: identity.distritoCode, seccionCode: extra.seccionCode, sourceKind: "official" });
        await page.goto(new URL(`/compare?${params}`, baseURL).toString());
        const main = page.getByRole("main");
        await expect(main).toContainText("Granularidad mixta");
        await expect(main.locator('form[action="/compare"] select')).toHaveCount(6);
        await expect(main.getByRole("table")).toHaveCount(0);
        await expect(main).not.toContainText(/\d+,\d+ %|SHA-256|Procedencia oficial|Referencia oficial/);
        const section = main.getByRole("combobox", { name: "Sección compartida", exact: true });
        await expect(section).toHaveValue(extra.seccionCode);
        await section.selectOption(identity.seccionCode);
        await expect(main.getByRole("heading", { name: "Resultados exactos", exact: true })).toBeVisible();
        await expect(main).not.toContainText("Granularidad mixta");
        await expect(section).toHaveValue(identity.seccionCode);
        await expect(main).not.toContainText("999 votos");
      });
    });
  });

  test("serves complete evidence, then removes every figure after authorization loss and reload", async ({ page }) => {
    await withResultFixture(SPEC, seed, async () => withAuthorizedComparisonWorkspace(page, async (revokeAuthorization) => {
      const leftOnlySection = identity.comparisonLeftOnlySection;
        if (!leftOnlySection) throw new Error("comparison fixture left-only section is missing");
        const comparisonNavigationLink = page.getByRole("navigation", { name: "principal" }).getByRole("link", { name: "Comparación", exact: true });
      await comparisonNavigationLink.click(); await expect(page).toHaveURL(/\/compare$/); await expect(comparisonNavigationLink).toHaveAttribute("aria-current", "page");
      const leftCategory = page.getByLabel("Categoría A", { exact: true });
      const rightCategory = page.getByLabel("Categoría B", { exact: true });
      const leftElection = page.getByLabel("Elección A (2023)");
      const rightElection = page.getByLabel("Elección B (2025)");
      // Independent rapid edits must survive overlapping automatic navigations.
      await leftElection.selectOption(identity.electionIds[0]!);
      await rightElection.focus();
      await rightElection.selectOption(identity.electionIds[1]!);
      for (const category of [leftCategory, rightCategory]) {
        await expect(category).toBeEnabled();
        await expect(category).toHaveAttribute("required", "");
        await expect(category).toHaveValue("");
      }
      await expect(rightElection).toBeFocused();
      await expect(page.getByRole("button", { name: /Actualizar opciones|Comparar resultados/ })).toHaveCount(0);
      await leftCategory.selectOption(identity.categoryId);
      await rightCategory.selectOption(identity.categoryId);
      const sharedDistrict = page.getByLabel("Territorio", { exact: true });
      await expect(sharedDistrict).toBeEnabled();
      await sharedDistrict.selectOption(identity.distritoCode);
      const sharedSection = page.getByRole("combobox", { name: "Sección compartida", exact: true });
      await expect(sharedSection).toBeEnabled();
      await expect(sharedSection.getByRole("option", { name: leftOnlySection.seccionCode, exact: false })).toHaveCount(0);
      await expect(page.getByRole("main")).toContainText("Opciones no compartidas — Sección: 1 Lado A / 0 Lado B (disponibles solo en ese lado).");
      await sharedSection.focus();
      await sharedSection.selectOption(identity.seccionCode);
      await expect(page).toHaveURL(new RegExp(`seccionCode=${identity.seccionCode}`));
      await expect(page.getByRole("heading", { name: "Resultados exactos", exact: true })).toBeVisible();
      await expect(sharedSection).toBeFocused();
      const servedUrl = new URL(page.url()); expect(Object.fromEntries(servedUrl.searchParams)).toEqual({ electionId: identity.electionIds[0], categoryId: identity.categoryId, bElectionId: identity.electionIds[1], bCategoryId: identity.categoryId, sourceKind: "official", distritoCode: identity.distritoCode, seccionCode: identity.seccionCode });
      const main = page.getByRole("main"); await expect(main).toContainText("sin cambio"); await expect(main).toContainText("100,00 %"); await expect(main).toContainText("0,00 puntos porcentuales");
      await expect(main).toContainText(identity.archiveEntryIds[0]!); await expect(main).toContainText(identity.archiveEntryIds[1]!); await expect(main).toContainText("SHA-256"); await expect(main).not.toContainText("https://"); await expect(main).not.toContainText("example.test");
      await main.locator('[data-applied-context] > summary').click();
      const leftSide = main.getByRole("article", { name: "Lado A", exact: true });
      const rightSide = main.getByRole("article", { name: "Lado B", exact: true });
      await expect(leftSide).toContainText("Elección: 2023");
      await expect(leftSide).toContainText(`Categoría: ${identity.categoryName}`);
      await expect(rightSide).toContainText("Elección: 2025");
      await expect(rightSide).toContainText(`Categoría: ${identity.categoryName}`);
      const tableRegion = main.getByRole("region", { name: /Tabla exacta/ });
      // The exact table is folded behind its own disclosure (compact approved hierarchy); open it before reading.
      const exactTable = main.locator("details", { hasText: "Tabla exacta —" });
      const openExactTable = async (): Promise<void> => { if (await exactTable.getAttribute("open") === null) await exactTable.locator("summary").click(); };
      await openExactTable();
      await expect(main.getByText("Comparación aplicada", { exact: true })).toBeVisible();
      await expect(main.locator('form[action="/compare"]').getByRole("combobox")).toHaveCount(6);
      await expect(main.getByRole("combobox", { name: "Agrupación", exact: true })).toBeVisible();
      const workbench = main.getByRole("region", { name: "Mesa de comparación territorial", exact: true });
      const inspector = workbench.getByRole("complementary", { name: "Detalle de comparación", exact: true });
      await expect(inspector.getByRole("region", { name: "Navegador territorial", exact: true })).toBeVisible();
      await expect(main.getByRole("heading", { name: "Cambio por territorio", exact: true })).toBeVisible();
      for (const side of ["A", "B"]) await expect(main.getByRole("group", { name: new RegExp(`^Lado ${side}\\b`) })).toHaveCount(1);
      const appliedHeading = main.getByRole("heading", { name: "Resultados exactos", exact: true });
      await expect(appliedHeading).toHaveCSS("font-size", "20px");
      await expect(leftSide.getByRole("heading", { name: "Lado A", exact: true })).toHaveCSS("font-size", "16px");
      const table = tableRegion.getByRole("table");
      const rails = main.getByRole("complementary", { name: "Evidencia oficial por lado" }).getByRole("article");
      await expect(rails).toHaveCount(2);
      for (const side of ["A", "B"]) {
        const evidence = main.getByRole("article", { name: `Evidencia oficial — Lado ${side}`, exact: true });
        const provenance = evidence.locator("details");
        await expect(provenance).not.toHaveAttribute("open", "");
        await expect(provenance.getByText(/SHA-256/)).toBeHidden();
        await evidence.getByText(`Procedencia oficial — Lado ${side}`, { exact: true }).press("Enter");
        await expect(provenance).toHaveAttribute("open", "");
        await expect(provenance.getByText(/SHA-256/)).toBeVisible();
      }
      const appliedContexts = main.getByRole("region", { name: "Contexto de comparación autorizada" });
      const applied = { contexts: await appliedContexts.innerText(), heading: await appliedHeading.innerText(), table: await table.innerText(), rails: await rails.allInnerTexts() };
      const expectAppliedUnchanged = async (): Promise<void> => {
        const contextDisclosure = main.locator('[data-applied-context]');
        if (await contextDisclosure.getAttribute("open") === null) await contextDisclosure.locator("summary").click();
        await expect.poll(async () => ({
          contexts: await appliedContexts.innerText(),
          heading: await appliedHeading.innerText(),
          table: await table.innerText(),
          rails: await rails.allInnerTexts(),
        })).toEqual(applied);
      };
      const hashes = applied.rails.flatMap((rail) => [...rail.matchAll(/SHA-256 ([a-f0-9]{64})/g)].map((match) => match[1]));
      expect(hashes).toHaveLength(2);
      const chart = main.getByRole("region", { name: "Participación por partido", exact: true });
      await expect(chart).toBeVisible();
      await expect(chart).toContainText("100,00 %");
      await expect(chart).toContainText(/votos.*partidos/i);
      // While a new selection is being served, no old figures or evidence remain current.
      let releaseSelection: () => void = () => {};
      const selectionDelay = new Promise<void>((resolve) => { releaseSelection = resolve; });
      await page.route("**/compare?**", async (route) => {
        await selectionDelay;
        await route.continue();
      });
      try {
        await leftCategory.focus();
        await leftCategory.selectOption("");
        await expect(chart).toHaveCount(0);
        await expect(tableRegion).toHaveCount(0);
        await expect(rails).toHaveCount(0);
        await expect(leftCategory).toBeFocused();
        await expect(sharedDistrict).toHaveValue("");
        await expect(sharedSection).toHaveValue("");
      } finally {
        releaseSelection();
      }
      await expect(page).not.toHaveURL(/categoryId=/);
      await page.unroute("**/compare?**");
      await leftCategory.selectOption(identity.categoryId);
      await expect(sharedDistrict).toBeEnabled();
      await sharedDistrict.selectOption(identity.distritoCode);
      await expect(sharedSection).toBeEnabled();
      await sharedSection.focus();
      await sharedSection.selectOption(identity.seccionCode);
      await expect(page).toHaveURL(servedUrl.toString());
      await expect(chart).toBeVisible();
      for (const side of ["A", "B"]) {
        const details = main.getByRole("article", { name: `Evidencia oficial — Lado ${side}`, exact: true }).locator("details");
        if (!await details.getAttribute("open").then((value) => value !== null)) await details.locator("summary").click();
      }
      await openExactTable();
      await expectAppliedUnchanged();
      await tableRegion.focus();
      await expect(tableRegion).toBeFocused();
      const editA = main.getByRole("group", { name: /^Lado A\b/ });
      const editB = main.getByRole("group", { name: /^Lado B\b/ });
      const shared = main.getByRole("group", { name: /^Territorio\b/ });
      const contexts = main.getByRole("region", { name: "Contexto de comparación autorizada" });
      const evidenceA = main.getByRole("article", { name: "Evidencia oficial — Lado A", exact: true });
      const evidenceB = main.getByRole("article", { name: "Evidencia oficial — Lado B", exact: true });
      const bounds = async (locator: Locator) => {
        await expect(locator).toBeVisible();
        const box = await locator.boundingBox();
        if (!box) throw new Error("Visible comparison region has no bounds");
        return box;
      };
      const precedes = async (before: Locator, after: Locator) => {
        const afterElement = await after.elementHandle();
        if (!afterElement) throw new Error("Missing ordered comparison region");
        expect(await before.evaluate((element, next) => Boolean(element.compareDocumentPosition(next) & Node.DOCUMENT_POSITION_FOLLOWING), afterElement)).toBe(true);
      };
      await test.step("1440px shared territory precedes paired editors and the map/inspector workbench", async () => {
        await page.setViewportSize({ width: 1440, height: 900 });
        const a = await bounds(editA), b = await bounds(editB), territory = await bounds(shared);
        expect(Math.abs(a.width - b.width)).toBeLessThanOrEqual(2);
        expect(Math.abs(a.y - b.y)).toBeLessThanOrEqual(2);
        expect(Math.abs(a.height - b.height)).toBeLessThanOrEqual(2);
        expect(a.x + a.width).toBeLessThanOrEqual(b.x + 2);
        expect(territory.y + territory.height).toBeLessThanOrEqual(a.y + 2);
        expect(territory.width).toBeGreaterThan(a.width);
        const bench = await bounds(workbench), detail = await bounds(inspector);
        expect(bench.y).toBeGreaterThanOrEqual(a.y + a.height - 2);
        expect(detail.x + detail.width).toBeLessThanOrEqual(bench.x + bench.width + 2);
        expect(detail.width).toBeGreaterThanOrEqual(275);
        expect(detail.width).toBeLessThanOrEqual(324);
        await expect(shared).toHaveCount(1);
        const exact = await bounds(tableRegion);
        for (const evidence of [evidenceA, evidenceB]) {
          await expect(evidence).toHaveCount(1);
          const rail = await bounds(evidence);
          expect(exact.width).toBeGreaterThan(rail.width);
          expect(rail.y).toBeGreaterThanOrEqual(exact.y + exact.height - 2);
          await expect(evidence).toContainText("SHA-256");
        }
        const evidence = await bounds(main.getByRole("complementary", { name: "Evidencia oficial por lado" }));
        const results = await bounds(main.getByRole("region", { name: "Resultados exactos", exact: true }));
        expect(evidence.y).toBeGreaterThanOrEqual(results.y + results.height - 2);
        expect(Math.abs(evidence.width - results.width)).toBeLessThanOrEqual(2);
        const railA = await bounds(evidenceA), railB = await bounds(evidenceB);
        expect(Math.abs(railA.y - railB.y)).toBeLessThanOrEqual(2);
        expect(Math.abs(railA.width - railB.width)).toBeLessThanOrEqual(2);
        expect(railA.x + railA.width).toBeLessThanOrEqual(railB.x + 2);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1440);
      });
      await test.step("390px preserves reading order from editors through both evidence rails", async () => {
        await page.setViewportSize({ width: 390, height: 844 });
        // Selection details now follow the workbench and its child comparison, rather than preceding maps.
        const ordered = [shared, editA, editB, workbench, main.getByRole("region", { name: "Cambio por territorio", exact: true }), contexts, chart, tableRegion, evidenceA, evidenceB];
        for (let index = 1; index < ordered.length; index++) {
          const before = ordered[index - 1]!, after = ordered[index]!;
          await precedes(before, after);
          const previous = await bounds(before), next = await bounds(after);
          expect(next.y).toBeGreaterThanOrEqual(previous.y + previous.height - 2);
        }
        await precedes(leftSide, rightSide);
        await expect(contexts.getByRole("article", { name: "Lado A", exact: true })).toContainText("2023");
        await expect(contexts.getByRole("article", { name: "Lado B", exact: true })).toContainText("2025");
        await expectAppliedUnchanged();
      });
      await test.step("320px keeps controls readable and delegates horizontal overflow only to TableScroll", async () => {
        await page.setViewportSize({ width: 320, height: 720 });
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
        for (const control of await main.locator("select, button").all()) {
          if (!await control.isVisible()) continue;
          const box = await bounds(control);
          expect(box.x).toBeGreaterThanOrEqual(0);
          expect(box.x + box.width).toBeLessThanOrEqual(320);
          expect(box.width).toBeGreaterThanOrEqual(44);
          expect(box.height).toBeGreaterThanOrEqual(24);
          expect(await control.evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(14);
        }
        await expect(tableRegion).toHaveCount(1);
        await expect(tableRegion).toHaveAttribute("tabindex", "0");
        await expect(tableRegion).toHaveClass(/\btable-scroll\b/);
        await expect(tableRegion.getByRole("table")).toHaveCount(1);
        expect(await tableRegion.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
        const overflowOwners = await main.locator("*").evaluateAll((elements) => elements.filter((element) => {
          const overflow = getComputedStyle(element).overflowX;
          return ["auto", "scroll"].includes(overflow) && element.scrollWidth > element.clientWidth;
        }).map((element) => element.getAttribute("aria-label")));
        expect(overflowOwners).toEqual([await tableRegion.getAttribute("aria-label")]);
        await tableRegion.focus();
        await expect(tableRegion).toBeFocused();
        await tableRegion.evaluate((element) => { element.scrollLeft = 0; });
        await page.keyboard.press("ArrowRight");
        await expect.poll(() => tableRegion.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
        await expectAppliedUnchanged();
      });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await expect(chart).toBeVisible();
      await page.goto(new URL("/", baseURL).toString());
      await page.goto(servedUrl.toString());
      await page.goBack();
      await expect(page).toHaveURL(new URL("/", baseURL).toString());
      await page.goForward();
      await expect(page).toHaveURL(servedUrl.toString());
      await expect(sharedSection).toHaveValue(identity.seccionCode);
      await expect(chart).toBeVisible();
      await revokeAuthorization();
      await page.reload();
      await expect(page).toHaveURL(servedUrl.toString());
      // Revoking entitlements increments the organization revision: the workspace
      // becomes stale, so #427's preflight replaces data with inline reselection.
      const recovery = main.getByRole("region", { name: "Selección de organización", exact: true });
      await expect(recovery).toBeVisible();
      await expect(main.getByRole("heading", { name: "Seleccioná una organización", exact: true })).toBeVisible();
      await expect(recovery.getByRole("status").filter({ hasText: /^Tu acceso a la organización activa cambió\./ })).toBeVisible();
      await expect(recovery.getByRole("combobox", { name: "Organización", exact: true })).toBeVisible();
      await expect(recovery.getByRole("button", { name: "Cambiar organización", exact: true })).toBeVisible();
      await expect(chart).toHaveCount(0); await expect(main).not.toContainText("100,00 %"); await expect(main).not.toContainText("puntos porcentuales"); await expect(main).not.toContainText(identity.archiveEntryIds[0]!); await expect(main).not.toContainText(identity.archiveEntryIds[1]!);
        await expect(main).not.toContainText("Opciones no compartidas"); await expect(main).not.toContainText("disponibles solo en ese lado");
    }));
  });
});
