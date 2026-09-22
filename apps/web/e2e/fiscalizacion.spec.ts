import { createClient } from "@supabase/supabase-js";
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./review-test-fixture";
import { zoomTest } from "./review-zoom-test-fixture";
import { createFiscalStateHandler, fiscalWirePair, fiscalWireStates } from "./fiscalizacion-state-control";

import { assertE2eEnvironment } from "./gate-contract";
import { coverageFixture, withResultFixture } from "./result-fixture";
import { scenarioBaseUrl } from "./scenario-ownership";

/**
 * fiscalizacion-analysis spec, "An operator route reaches fiscalización
 * through the opt-in path" (Requirement 8, task 13.11) — `provenance.spec.ts`
 * already proves the DEFAULT page never leaks a fiscalización marker
 * (path 3 of the threat matrix); this spec proves the OPPOSITE direction:
 * the dedicated `/fiscalizacion` route, reached through the opt-in path,
 * renders labelled unofficial figures with their coverage denominator.
 */

const environment = assertE2eEnvironment(process.env);
const SPEC = "e2e/fiscalizacion.spec.ts";
const { scope: COVERAGE_SCOPE, seed: COVERAGE_FIXTURE } = coverageFixture(SPEC);
const baseURL = scenarioBaseUrl(SPEC, environment);

async function expectNoBlankSearchParams(page: Page): Promise<void> {
  const url = new URL(page.url());
  for (const [name, value] of url.searchParams) {
    expect(value, `${name} must be omitted instead of serialized blank`).not.toBe("");
  }
}

async function withAuthorizedFiscalWorkspace<T>(page: Page, run: () => Promise<T>): Promise<T> {
  const admin = createClient(environment.NEXT_PUBLIC_SUPABASE_URL, environment.SUPABASE_SERVICE_ROLE_KEY);
  const { data: auth, error: authError } = await admin.auth.admin.listUsers(); const user = auth?.users.find((candidate) => candidate.email?.toLowerCase() === environment.VOTUS_E2E_TEST_USER_EMAIL.toLowerCase());
  if (authError || !user) throw new Error(`failed to resolve fiscal fixture user: ${authError?.message ?? "user missing"}`);
  const { data: fixture, error: fixtureError } = await admin.rpc("e2e_setup_authorized_fiscal_fixture", { p_user_id: user.id, p_distrito_code: COVERAGE_SCOPE.distritoCode, p_seccion_code: COVERAGE_SCOPE.seccionCode });
  if (fixtureError || typeof fixture?.organization_id !== "string") { const cause = new Error(`failed to set up authorized fiscal fixture: ${fixtureError?.message ?? "invalid response"}`); if (fixture) { const cleanup = await admin.rpc("e2e_cleanup_authorized_fiscal_fixture", { p_fixture: fixture }); if (cleanup.error) throw new AggregateError([cause, new Error(cleanup.error.message)], "fiscal fixture setup and cleanup failed"); } throw cause; }
  let outcome: { value: T } | { error: unknown }; let cleanupError: { message: string } | null;
  try {
    await page.goto(new URL("/dashboard", baseURL).toString());
    const trigger = page.getByRole("button", { name: "Abrir navegación" });
    const mobile = await trigger.isVisible();
    if (mobile) await trigger.click();
    const selector = page.getByRole("combobox", { name: "Organización", exact: true });
    await expect(selector).toBeVisible();
    await selector.selectOption(fixture.organization_id);
    const switched = page.waitForResponse((response) => response.url().endsWith("/api/workspace") && response.request().method() === "POST");
    await page.getByRole("button", { name: "Cambiar organización" }).click();
    const response = await switched;
    expect({ ok: response.ok(), body: await response.json() }).toMatchObject({ ok: true, body: { status: "active" } });
    if (mobile) await page.getByRole("button", { name: "Cerrar navegación" }).click();
    outcome = { value: await run() };
  }
  catch (error) { outcome = { error }; } finally { ({ error: cleanupError } = await admin.rpc("e2e_cleanup_authorized_fiscal_fixture", { p_fixture: fixture })); }
  if ("error" in outcome) { if (cleanupError) throw new AggregateError([outcome.error, new Error(cleanupError.message)], "fiscal assertion and fixture cleanup failed"); throw outcome.error; } if (cleanupError) throw new Error(`failed to clean fiscal fixture: ${cleanupError.message}`); return outcome.value;
}

test.describe("the fiscalizacion route explores coverage", () => {
  test("test_route_reaches_only_authorized_fiscalizacion_evidence", async ({ page, next }) => {
    const matched: string[] = [];
    next.onFetch(createFiscalStateHandler(environment.NEXT_PUBLIC_SUPABASE_URL, COVERAGE_SCOPE, (side, request) => {
      matched.push(side);
      return fetch(request, { redirect: "error" });
    }));
    await withResultFixture(SPEC, COVERAGE_FIXTURE, async () => withAuthorizedFiscalWorkspace(page, async () => {
      await expect(page).toHaveURL(new URL("/", baseURL).toString());
      await page.getByRole("navigation", { name: "principal" }).getByRole("link", { name: "Fiscalización (no oficial)", exact: true }).click();
      await expect(page).toHaveURL(/\/fiscalizacion/);
      await page.setViewportSize({ width: 1440, height: 900 });
      await expect(page.getByRole("heading", { level: 1, name: "Fiscalización (no oficial)", exact: true })).toHaveCSS("font-size", "32px");
      await expect(page.getByRole("main")).not.toContainText("No tiene autorización");
      await expect(page.getByRole("button", { name: "Mostrar cobertura" })).toHaveCount(0);
      await expect(page.getByText("La cobertura y los resultados se actualizan al cambiar la selección.")).toBeVisible();
      for (const label of ["Categoría", "Distrito", "Sección"]) {
        const descendant = page.getByLabel(label);
        await expect(descendant).toBeDisabled();
        expect(await descendant.evaluate((element) => {
          (element as HTMLSelectElement).focus();
          return document.activeElement === element;
        })).toBe(false);
      }

      const form = page.locator('form[action="/fiscalizacion"]'); await page.locator("html").evaluate((element) => { element.dataset.scopeSentinel = "alive"; });
      const selection = new URLSearchParams();
      const draft = async (label: string, name: string, value: string, dependent: string): Promise<void> => {
        const control = page.getByLabel(label), child = page.getByLabel(dependent);
        await control.focus(); await control.selectOption(value);
        selection.set(name, value);
        await expect(child).toHaveValue("");
        await expect(page).toHaveURL(new URL(`/fiscalizacion?${selection}`, baseURL).toString());
        await expect(child).toBeEnabled(); await expect(form).not.toHaveAttribute("aria-busy", "true");
        await expect(control).toBeFocused();
        await expect(page.locator("html")).toHaveAttribute("data-scope-sentinel", "alive");
        expect(matched).toEqual([]);
      };
      await draft("Elección", "electionId", COVERAGE_SCOPE.electionId, "Categoría");
      await draft("Categoría", "categoryId", COVERAGE_SCOPE.categoryId, "Distrito");
      await draft("Distrito", "distritoCode", COVERAGE_SCOPE.distritoCode, "Sección");
      await page.getByLabel("Sección").focus();
      await page.getByLabel("Sección").selectOption(COVERAGE_SCOPE.seccionCode);
      const expectedUrl = new URL(`/fiscalizacion?electionId=${COVERAGE_SCOPE.electionId}&categoryId=${COVERAGE_SCOPE.categoryId}&distritoCode=${COVERAGE_SCOPE.distritoCode}&seccionCode=${COVERAGE_SCOPE.seccionCode}`, baseURL).toString();
      await expect(page).toHaveURL(expectedUrl); await expectNoBlankSearchParams(page);
      await expect(form).not.toHaveAttribute("aria-busy", "true");
      await expect(page.getByLabel("Sección")).toBeFocused();

      const primaryNavigation = page.getByRole("navigation", { name: "principal" });
      await expect(primaryNavigation.locator('a[aria-current="page"]')).toHaveCount(1);
      await expect(
        primaryNavigation.getByRole("link", {
          name: "Fiscalización (no oficial)",
          exact: true,
        }),
      ).toHaveAttribute("aria-current", "page");

      const main = page.getByRole("main");
      await expect(main).toContainText("Estado de cobertura: ok"); await expect(main).toContainText("1 unidades observadas de 2 del denominador oficial");
      expect(matched).toEqual(expect.arrayContaining(["coverage", "result"]));
      await expect(main).toContainText("Mesa 2");
      await expect(main).toContainText("Estado del resultado: ok"); await expect(main).toContainText("Fuente: fiscalización; no es una muestra aleatoria"); await expect(main).toContainText("denominador 2");
      await expect(main).toContainText("22222 votos"); await expect(main).not.toContainText(/11111|33333/); await expect(main).toContainText(String(COVERAGE_FIXTURE.archiveEntries?.[1]?.["id"])); await expect(main).not.toContainText(String(COVERAGE_FIXTURE.archiveEntries?.[0]?.["id"])); await expect(main).not.toContainText(String(COVERAGE_FIXTURE.archiveEntries?.[2]?.["id"]));
      const tableRegion = page.getByRole("region", { name: "Resultados de fiscalización" });
      const qualification = main.getByRole("region", { name: "Calificación de la evidencia", exact: true });
      const resultRegion = main.getByRole("region", { name: "Resultado autorizado", exact: true });
      const coverageDetail = main.getByRole("region", { name: "Cobertura autorizada", exact: true });
      const unitChart = main.getByRole("region", { name: "Cobertura de unidades", exact: true });
      const archiveSummary = main.locator("summary").filter({ hasText: "Archivo de respaldo" });
      await expect(qualification).toContainText("1 unidades observadas de 2 del denominador oficial");
      await expect(qualification).toContainText("No es una muestra aleatoria");
      await expect(unitChart.getByRole("img")).toHaveAttribute("aria-label", "1 de 2 unidades observadas");
      await expect(main.getByRole("list", { name: "Procedencia del resultado" })).not.toBeVisible();
      await archiveSummary.focus(); await expect(archiveSummary).toBeFocused();
      await archiveSummary.press("Enter");
      await expect(main.getByRole("list", { name: "Procedencia del resultado" })).toBeVisible();
      await archiveSummary.press("Enter");
      for (const width of [1710, 1440, 390, 320]) {
        await page.setViewportSize({ width, height: 900 });
        await expect(main.getByRole("heading", { level: 1 })).toHaveCSS("font-size", "32px");
        await expect(main.getByRole("heading", { name: "Resultado autorizado", exact: true })).toHaveCSS("font-size", "20px");
        await expect(main.getByRole("heading", { name: "Elegir el alcance de la cobertura", exact: true })).toHaveCSS("font-size", "16px");
        await expect.poll(() => main.locator(":scope > .shell-container").evaluate((element) => {
          const workspace = element.closest(".app-shell__workspace");
          if (!(workspace instanceof HTMLElement)) throw new Error("Fiscalización requires an application workspace");
          const style = getComputedStyle(workspace);
          const available = workspace.clientWidth - Number.parseFloat(style.paddingLeft) - Number.parseFloat(style.paddingRight);
          return Math.abs(element.getBoundingClientRect().width - Math.min(1540, available));
        })).toBeLessThanOrEqual(1);
        const boxes = await Promise.all([qualification, resultRegion, coverageDetail].map((region) => region.evaluate((element) => {
          const { x, y, width, bottom } = element.getBoundingClientRect(); return { x, y, width, bottom };
        })));
        expect(boxes[0]!.bottom).toBeLessThanOrEqual(boxes[1]!.y);
        expect(boxes[1]!.bottom).toBeLessThanOrEqual(boxes[2]!.y);
        expect(Math.abs(boxes[1]!.x - boxes[2]!.x)).toBeLessThanOrEqual(1);
        expect(Math.abs(boxes[1]!.width - boxes[2]!.width)).toBeLessThanOrEqual(1);
        await expect.poll(() => unitChart.evaluate((element) => {
          const axis = element.querySelector('[aria-hidden="true"]');
          const svg = element.querySelector("svg");
          if (!axis || !svg) return false;
          const plot = svg.getBoundingClientRect();
          const ticks = [...axis.children].map((tick) => { const box = tick.getBoundingClientRect(); return box.x + box.width / 2; });
          const mark = svg.querySelector("rect")?.getBoundingClientRect();
          return ticks.length === 2 && Math.abs(ticks[0]! - plot.x) <= 1 && Math.abs(ticks[1]! - plot.right) <= 1
            && !!mark && Math.abs(mark.width - plot.width / 2) <= 1;
        })).toBe(true);
        await tableRegion.focus(); await expect(tableRegion).toBeFocused();
        expect(await page.locator("html").evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
      }
      expect(await tableRegion.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.getByRole("combobox", { name: "Tema", exact: true }).selectOption("dark");
      await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
      await expect(unitChart).toBeVisible();
      await page.emulateMedia({ reducedMotion: "reduce" });
      const duration = await unitChart.locator("rect").evaluate((element) => getComputedStyle(element).transitionDuration);
      expect(duration.endsWith("ms") ? Number.parseFloat(duration) : Number.parseFloat(duration) * 1000).toBeLessThanOrEqual(0.01);
      await page.getByRole("combobox", { name: "Tema", exact: true }).selectOption("light");
      await page.emulateMedia({ reducedMotion: "no-preference" });
      const reusableUrl = page.url();
      await page.goto(new URL("/dashboard", baseURL).toString()); await page.goBack();
      await expect(page).toHaveURL(reusableUrl);
      await page.reload(); await expect(page).toHaveURL(reusableUrl);
      await expect(page.getByRole("main")).toContainText("Estado de cobertura: ok");

      await page.goto(new URL(`/fiscalizacion?electionId=${COVERAGE_SCOPE.electionId}&categoryId=${COVERAGE_SCOPE.categoryId}&jurisdictionId=legacy-public`, baseURL).toString());
      await expect(page.getByRole("main").getByRole("alert")).toContainText("parámetros de consulta no admitidos");
      await expect(page.getByRole("main")).not.toContainText("Cobertura: 93 de 153 mesas");
    }));
  });
});

const fiscalUrl = new URL(`/fiscalizacion?${new URLSearchParams({
  electionId: COVERAGE_SCOPE.electionId, categoryId: COVERAGE_SCOPE.categoryId,
  distritoCode: COVERAGE_SCOPE.distritoCode, seccionCode: COVERAGE_SCOPE.seccionCode,
})}`, baseURL).toString();
const pair = fiscalWirePair(COVERAGE_SCOPE);
const figureSentinels = /7 unidades observadas|denominador 108|Sentinel school|Sentinel Party|876543|456789|sentinel-unmapped|missing_identity|fiscal\/sentinel|SHA-256/;

async function expectSuppressed(page: Page): Promise<void> {
  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { name: "Cobertura autorizada", exact: true })).toHaveCount(0);
  await expect(main.getByRole("heading", { name: "Resultado autorizado", exact: true })).toHaveCount(0);
  await expect(main.getByRole("table")).toHaveCount(0);
  await expect(main.getByRole("list")).toHaveCount(0);
  await expect(main).not.toContainText(figureSentinels);
}

async function expectReady(page: Page): Promise<void> {
  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { name: "Cobertura autorizada", exact: true })).toBeVisible();
  await expect(main.getByRole("heading", { name: "Resultado autorizado", exact: true })).toBeVisible();
  for (const text of ["7 unidades observadas de 108", "Sentinel school", "Sentinel Party", "876543", "456789", "missing_identity", "fiscal/sentinel"])
    await expect(main).toContainText(text);
  for (const label of ["Unidades sin cobertura", "Resultados"])
    await expect(main.getByRole("alert").filter({ hasText: `${label}: se muestran 100 de 101; respuesta truncada` })).toBeVisible();
}

async function tabTo(page: Page, control: Locator): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt++) {
    await page.keyboard.press("Tab");
    if (await control.evaluate((element) => element === document.activeElement)) break;
  }
  await expect(control).toBeFocused();
  const box = await control.boundingBox();
  if (!box) throw new Error("fiscal control has no layout box");
  expect(box.width).toBeGreaterThanOrEqual(44);
  expect(box.height).toBeGreaterThanOrEqual(44);
  expect(await control.evaluate((element) => getComputedStyle(element).outlineStyle)).not.toBe("none");
}

for (const state of fiscalWireStates(COVERAGE_SCOPE)) {
  test(`paired evidence suppresses ${state.side} ${state.payload.status}`, async ({ page, next }) => {
    const matched: string[] = [];
    next.onFetch(createFiscalStateHandler(environment.NEXT_PUBLIC_SUPABASE_URL, COVERAGE_SCOPE, (side) => {
      matched.push(side);
      return Response.json(side === state.side ? state.payload : pair[side]);
    }));
    await withResultFixture(SPEC, COVERAGE_FIXTURE, () => withAuthorizedFiscalWorkspace(page, async () => {
      await page.goto(fiscalUrl);
      const role = state.payload.status === "no_rows" ? "status" : "alert";
      await expect(page.getByRole("main").getByRole(role).filter({ hasText: state.text })).toBeVisible();
      await expectSuppressed(page);
      expect(matched).toEqual(expect.arrayContaining(["coverage", "result"]));
      await expect(page.getByLabel("Sección")).toHaveValue(COVERAGE_SCOPE.seccionCode);
    }));
  });
}

for (const side of ["coverage", "result"] as const) {
  for (const failure of ["malformed", "thrown"] as const) {
    test(`${side} ${failure} recovers with a keyboard document retry`, async ({ page, next }) => {
      let failing = true;
      const matched: string[] = [];
      next.onFetch(createFiscalStateHandler(environment.NEXT_PUBLIC_SUPABASE_URL, COVERAGE_SCOPE, (requested) => {
        matched.push(requested);
        if (failing && requested === side) {
          if (failure === "thrown") throw new Error("controlled transport failure");
          return Response.json({ status: "ok", unsafe: "remote-detail-sentinel" });
        }
        return Response.json(pair[requested]);
      }));
      await withResultFixture(SPEC, COVERAGE_FIXTURE, () => withAuthorizedFiscalWorkspace(page, async () => {
        await page.goto(fiscalUrl);
        await expect(page.getByRole("alert").filter({ hasText: "Error técnico de evidencia" })).toBeVisible();
        await expectSuppressed(page);
        await expect(page.getByRole("main")).not.toContainText(/remote-detail-sentinel|controlled transport failure/);
        expect(matched).toEqual(expect.arrayContaining(["coverage", "result"]));
        await page.locator("html").evaluate((element) => { element.dataset.documentSentinel = "old"; });
        const retry = page.getByRole("link", { name: "Reintentar carga" });
        await tabTo(page, retry);
        const prior = matched.length;
        failing = false;
        await page.keyboard.press("Enter");
        await expectReady(page);
        await expect(page).toHaveURL(fiscalUrl);
        await expect(page.locator("html")).not.toHaveAttribute("data-document-sentinel", "old");
        expect(matched.slice(prior)).toEqual(expect.arrayContaining(["coverage", "result"]));
      }));
    });
  }
}

test("deferred production evidence stays figure-free while loading", async ({ page, next }) => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const matched: string[] = [];
  next.onFetch(createFiscalStateHandler(environment.NEXT_PUBLIC_SUPABASE_URL, COVERAGE_SCOPE, async (side) => {
    matched.push(side);
    await pending;
    return Response.json(pair[side]);
  }));
  await withResultFixture(SPEC, COVERAGE_FIXTURE, () => withAuthorizedFiscalWorkspace(page, async () => {
    try {
      await page.goto(fiscalUrl, { waitUntil: "commit" });
      await expect.poll(() => matched.length).toBe(2);
      await expect(page.getByLabel("Cargando fiscalización")).toBeVisible();
      await expectSuppressed(page);
    } finally { release(); }
    await expectReady(page);
  }));
});

for (const width of [640, 1280]) {
  zoomTest.describe(`fiscal evidence at native 200% in ${width}px window`, () => {
    zoomTest.use({ zoomWindowWidth: width });
    zoomTest("retains paired evidence and keyboard controls without document overflow", async ({ page, next, zoom }) => {
      const matched: string[] = [];
      next.onFetch(createFiscalStateHandler(environment.NEXT_PUBLIC_SUPABASE_URL, COVERAGE_SCOPE, (side) => {
        matched.push(side);
        return Response.json(pair[side]);
      }));
      await withResultFixture(SPEC, COVERAGE_FIXTURE, () => withAuthorizedFiscalWorkspace(page, async () => {
        await page.goto(fiscalUrl);
        await expectReady(page);
        expect(matched).toEqual(expect.arrayContaining(["coverage", "result"]));
        expect(await zoom.set(1)).toBe(1);
        const baseline = await page.evaluate(() => ({ inner: innerWidth, outer: outerWidth }));
        expect(baseline.outer).toBe(width);
        expect(await zoom.set(2)).toBe(2);
        await expect.poll(() => page.evaluate(() => innerWidth)).toBeCloseTo(baseline.inner / 2, 0);
        expect(await page.evaluate(() => outerWidth)).toBe(baseline.outer);
        expect(await page.locator("html").evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
        await tabTo(page, page.getByLabel("Elección"));
        await tabTo(page, page.getByLabel("Sección"));
        await tabTo(page, page.getByRole("region", { name: "Resultados de fiscalización" }));
        await tabTo(page, page.locator("summary").filter({ hasText: "Archivo de respaldo" }));
        await page.keyboard.press("Enter");
        await expect(page.getByRole("list", { name: "Procedencia del resultado" })).toBeVisible();
        await expectReady(page);
      }));
    });
  });
}

for (const action of ["revert", "independent edit"] as const) {
  test(`suppresses stale paired evidence during a delayed scope response and ${action}`, async ({ page, next }) => {
    let responseReady = false;
    let responseDelivered = false;
    let delayEnabled = false;
    let release: () => void = () => {};
    const deferred = new Promise<void>((resolve) => { release = resolve; });
    const handler = createFiscalStateHandler(environment.NEXT_PUBLIC_SUPABASE_URL, COVERAGE_SCOPE,
      (side) => Response.json(pair[side]));
    next.onFetch(async (request) => {
      const delay = delayEnabled && new URL(request.url).pathname === "/rest/v1/rpc/official_facets"
        && await request.clone().json().then((body) => body.p_distrito_code === COVERAGE_SCOPE.distritoCode && body.p_seccion_code === null);
      const response = await handler(request);
      // Delay the actual authorized facet response without bypassing the test-mode transport.
      if (delay) {
        responseReady = true;
        await deferred;
        responseDelivered = true;
      }
      return response;
    });
    await withResultFixture(SPEC, COVERAGE_FIXTURE, () => withAuthorizedFiscalWorkspace(page, async () => {
      await page.goto(fiscalUrl);
      await expectReady(page);
      const section = page.getByLabel("Sección");
      await section.focus();
      delayEnabled = true;
      try {
        await section.selectOption("");
        await expectSuppressed(page);
        await expect.poll(() => responseReady).toBe(true);
        await expect(section).toBeFocused();
        const control = action === "revert" ? section : page.getByLabel("Categoría");
        await control.focus();
        await control.selectOption(action === "revert" ? COVERAGE_SCOPE.seccionCode : "");
        // Restoring the exact served scope may show its already verified cached pair immediately.
        if (action === "independent edit") await expectSuppressed(page);
        release();
        await expect.poll(() => responseDelivered).toBe(true);
        await expect(control).toBeFocused();
        if (action === "revert") await expect(page).toHaveURL(fiscalUrl);
        await expect(page.locator('form[action="/fiscalizacion"]')).not.toHaveAttribute("aria-busy", "true");
        if (action === "revert") {
          await expect(page).toHaveURL(fiscalUrl);
          await expect(section).toHaveValue(COVERAGE_SCOPE.seccionCode);
          await expectReady(page);
        } else {
          await expect(page).toHaveURL(new URL(`/fiscalizacion?electionId=${COVERAGE_SCOPE.electionId}`, baseURL).toString());
          await expect(control).toHaveValue("");
          await expect(page.getByLabel("Distrito")).toHaveValue("");
          await expect(section).toHaveValue("");
          await expect(page.getByLabel("Distrito")).toBeDisabled();
          await expect(section).toBeDisabled();
          await expectSuppressed(page);
        }
      } finally {
        release();
      }
    }));
  });
}
