import { readFile, writeFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { test as nextTest } from "./review-test-fixture";
import { zoomTest } from "./review-zoom-test-fixture";

import { formatCount } from "../src/lib/format/number";
import { assertE2eEnvironment } from "./gate-contract";
import {
  FISCALIZACION_VOTES,
  OFFICIAL_VOTES,
  sourceIsolationFixture,
  pasoFixture,
  completenessFixture,
  withResultFixture,
} from "./result-fixture";
import { resultScenarioIdentity, scenarioBaseUrl } from "./scenario-ownership";

/**
 * Threat matrix, "Unofficial-source leakage into official figures", path 3
 * of 3: the RENDERED page, independent of `repository.test.ts`'s coverage
 * of the default query (path 1) and the aggregate (path 2). Blocking one
 * path does not block the others (design.md threat matrix row), so this
 * test exercises the actual HTML the operator sees, not the API surface.
 */

const environment = assertE2eEnvironment(process.env);
const SPEC = "e2e/provenance.spec.ts";
const identity = resultScenarioIdentity(SPEC);
const { scope: SOURCE_SCOPE, seed: SOURCE_ISOLATION_FIXTURE } =
  sourceIsolationFixture(SPEC);
const baseURL = scenarioBaseUrl(SPEC, environment);
// The renderer moved into the workbench; the Argentina heading now labels supporting evidence.
function nationalReferenceStage(page: Page) {
  return page.getByRole("region", { name: "Mapa territorial de referencia", exact: true });
}
// The badge marker rendered only when a figure's `sourceKind` is
// `fiscalizacion` (see `src/components/GranularityBadge.tsx` /
// `SourceDisclaimer.tsx`, task 11.17). No page rendered without an
// explicit unofficial opt-in may ever contain it.
const FISCALIZACION_MARKER = "party-internal, unofficial";

test("PASO internas preserve exact lists on mobile and keyboard", async ({ page }) => {
  const { identity: paso, seed } = pasoFixture(SPEC);
  await withResultFixture(SPEC, seed, async () => withAuthorizedOfficialWorkspace(page, async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    const query = new URLSearchParams({ electionId: paso.electionIds[0]!, categoryId: paso.categoryId,
      distritoCode: paso.distritoCode, seccionCode: paso.seccionCode, level: "seccion" });
    await page.goto(`${baseURL}/drilldown?${query}`);
    await page.getByText("Mostrar resultados exactos", { exact: true }).click();
    const region = page.getByRole("region", { name: "Internas: votos y porcentajes por agrupación" });
    await expect(region).toBeVisible();
    await expect(page.getByText("Completitud desconocida: la fuente oficial de esta elección no publica un catálogo de mesas esperadas.", { exact: true })).toBeVisible();
    for (const [name, votes, within, positive] of [
      ["LA FUERZA DEL CAMBIO", "8.698 votos", "68,52%", "26,16%"],
      ["EL CAMBIO DE NUESTRAS VIDAS", "3.997 votos", "31,48%", "12,02%"],
      ["LIBERTAD POR SIEMPRE", "13.206 votos", "100,00%", "39,72%"],
    ]) {
      const row = region.getByRole("row").filter({ hasText: name! });
      for (const value of [votes!, within!, positive!]) await expect(row).toContainText(value);
    }
    await expect(region).toContainText("Lista única");
    await expect(region).toContainText("Lista sin mapear");
    await expect(region.getByRole("row").filter({ hasText: "Lista sin mapear" }).filter({ hasText: "0 votos" }).first()).toBeVisible();
    await expect(page.getByText(/Votos no positivos/)).toContainText("No disponible");
    await page.getByRole("button", { name: "Restablecer vista", exact: true }).focus();
    // The map/table controls now precede PASO evidence; preserve keyboard reachability, not the old Tab distance.
    for (let i = 0; i < 40 && !await region.evaluate((element) => element === document.activeElement); i++) await page.keyboard.press("Tab");
    await expect(region).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const audit = await new AxeBuilder({ page }).analyze();
    expect(audit.violations.filter((violation) => violation.impact === "critical" || violation.impact === "serious")).toEqual([]);
  }), "paso");
});

test("official section completeness is disclosed through the real RPC", async ({ page }) => {
  const { seed } = completenessFixture(SPEC);
  await withResultFixture(SPEC, seed, async () => withAuthorizedOfficialWorkspace(page, async () => {
    const query = new URLSearchParams({ electionId: identity.electionIds[0]!, categoryId: identity.categoryId,
      distritoCode: identity.distritoCode, seccionCode: identity.seccionCode, level: "seccion" });
    await page.goto(`${baseURL}/drilldown?${query}`);
    // The paragraph also states the category assumption; anchor the exact count sentence at its start.
    const completeness = page.getByText(/^Escrutinio parcial: 1 de 3 mesas esperadas escrutadas; 1 no escrutadas; 1 sin estado en la fuente; 0 fuera del catálogo\. Supone que todas las mesas esperadas de la sección votan esta categoría\.$/);
    await expect(completeness).toBeVisible();
    const circuits = page.getByRole("region", { name: "Resultados exactos por circuito", exact: true });
    await expect(circuits.getByRole("row").filter({ has: page.getByRole("button", { name: "00001", exact: true }) })).toContainText("provisorio · 50 % de mesas");
    await expect(circuits.getByRole("row").filter({ has: page.getByRole("button", { name: "00002", exact: true }) })).toContainText("Sin votos positivos");
    await expect(circuits.getByRole("row")).toHaveCount(3);
  }));
});

test("national reference links and no-WebGL polar view preserve exact selection", async ({ page }) => {
  await withResultFixture(SPEC, SOURCE_ISOLATION_FIXTURE, async () => withAuthorizedOfficialWorkspace(page, async () => {
    await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, kind, ...args) {
        if (kind === "webgl2") return null;
        return original.call(this, kind, ...args);
      } as typeof original;
    });
    await page.goto(new URL("/drilldown", baseURL).toString());
    const national = nationalReferenceStage(page);
    await national.getByRole("button", { name: "Mostrar referencia nacional" }).click();
    await expect(national.getByRole("img", { name: /Extensión completa de la referencia IGN/ })).toBeVisible();
    await expect(national).toContainText("WebGL no disponible");
    await expect(national.getByRole("link", { name: "Ir a Buenos Aires" })).toHaveCount(1);
    await national.getByRole("link", { name: "Ir a Buenos Aires" }).click();
    await expect(page).toHaveURL(/#province-reference-heading$/);
    await expect(page.getByRole("combobox", { name: "Elección", exact: true })).toHaveValue("");
    await national.getByRole("link", { name: "Ir a la selección electoral exacta" }).click();
    await expect(page.getByRole("combobox", { name: "Elección", exact: true })).toBeFocused();
  }));
});

test("national reference renders both views on desktop and mobile without changing electoral scope", async ({ page }, testInfo) => {
  await withResultFixture(SPEC, SOURCE_ISOLATION_FIXTURE, async () => withAuthorizedOfficialWorkspace(page, async () => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const rendererErrors: string[] = [];
    page.on("pageerror", (error) => rendererErrors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") rendererErrors.push(message.text());
    });
    await page.goto(new URL("/drilldown", baseURL).toString());
    const cdp = await page.context().newCDPSession(page);
    const beforeHeap = await cdp.send("Runtime.getHeapUsage");
    const started = Date.now();
    const national = nationalReferenceStage(page);
    const continental = national.getByRole("region", { name: "Vista continental americana" });
    const polar = national.getByRole("region", { name: "Vista completa desde el polo sur" });
    try {
      await national.getByRole("button", { name: "Mostrar referencia nacional" }).click();
      await expect(continental.getByRole("status")).toContainText("Vista continental disponible");
      await expect(national.getByText("Referencia IGN verificada. Ambas vistas son geográficas; ninguna muestra votos.")).toBeVisible();
      const activationToReadyMs = Date.now() - started;
      const afterHeap = await cdp.send("Runtime.getHeapUsage");
      await writeFile(testInfo.outputPath("national-activation-observation.json"), JSON.stringify({
        activationToReadyMs, before: { usedSize: beforeHeap.usedSize, totalSize: beforeHeap.totalSize },
        after: { usedSize: afterHeap.usedSize, totalSize: afterHeap.totalSize },
      }));
    } finally { await cdp.detach(); }
    const polarImage = polar.getByRole("img", { name: /Extensión completa de la referencia IGN/ });
    await expect(polarImage.locator("path")).toHaveAttribute("d", /^M.{100,}/);
    const mapCanvas = continental.locator("canvas.maplibregl-canvas");
    await expect(mapCanvas).toBeVisible();
    await expect.poll(() => mapCanvas.evaluate((canvas) => {
      const element = canvas as HTMLCanvasElement;
      return element.width > 0 && element.height > 0 && Boolean(element.getContext("webgl2"));
    })).toBe(true);

    const screenshotPaths: string[] = [];
    const canvasCaptures: { name: string; png: Buffer; captureMs: [number, number]; regionMs: [number, number]; postRegionCanvas: unknown }[] = [];
    for (const [name, width, height] of [["desktop", 1440, 900], ["mobile", 390, 844]] as const) {
      const continentalPath = testInfo.outputPath(`${name}-continental.png`);
      const polarPath = testInfo.outputPath(`${name}-polar.png`);
      screenshotPaths.push(continentalPath, polarPath);
      await page.setViewportSize({ width, height });
      await expect(continental).toBeVisible();
      await expect(polarImage).toBeVisible();
      await expect(mapCanvas).toBeVisible();
      const canvasStart = performance.now();
      const png = await mapCanvas.screenshot();
      const canvasEnd = performance.now();
      const regionStart = performance.now();
      await testInfo.attach(`${name}-continental`, { body: await continental.screenshot({ path: continentalPath }), contentType: "image/png" });
      await testInfo.attach(`${name}-polar`, { body: await polar.screenshot({ path: polarPath }), contentType: "image/png" });
      const regionEnd = performance.now();
      await writeFile(testInfo.outputPath(`${name}-canvas.png`), png);
      const postRegionCanvas = await mapCanvas.evaluate((element) => {
        const canvas = element as HTMLCanvasElement;
        const rect = canvas.getBoundingClientRect();
        const style = getComputedStyle(canvas);
        const root = getComputedStyle(document.documentElement);
        return {
          rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          intrinsic: { width: canvas.width, height: canvas.height },
          client: { width: canvas.clientWidth, height: canvas.clientHeight },
          dpr: devicePixelRatio, scroll: { x: scrollX, y: scrollY },
          canvasBackground: style.backgroundColor, rootBackground: root.backgroundColor,
          stageBackground: getComputedStyle(canvas.closest("[aria-label^='Mapa continental']")!).backgroundColor,
          borders: { top: parseFloat(style.borderTopWidth), right: parseFloat(style.borderRightWidth),
            bottom: parseFloat(style.borderBottomWidth), left: parseFloat(style.borderLeftWidth) },
        };
      });
      canvasCaptures.push({ name, png, captureMs: [canvasStart, canvasEnd],
        regionMs: [regionStart, regionEnd], postRegionCanvas });
    }
    for (const screenshotPath of screenshotPaths) {
      const png = await readFile(screenshotPath);
      expect(png.subarray(0, 8).toString("hex"), `${screenshotPath} PNG signature`).toBe("89504e470d0a1a0a");
    }
    const diagnostics = [];
    for (const { name, png, captureMs, regionMs, postRegionCanvas } of canvasCaptures) {
      const stageBackground = (postRegionCanvas as { stageBackground: string }).stageBackground;
      const pixels = await page.evaluate(async ([encoded, background]) => {
        const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
        const image = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
        const canvas = document.createElement("canvas");
        canvas.width = image.width;
        canvas.height = image.height;
        const context = canvas.getContext("2d")!;
        context.drawImage(image, 0, 0);
        image.close();
        const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
        const firstRows = Array.from({ length: Math.min(4, canvas.height) }, (_, y) => {
          const colors = new Map<string, number>();
          for (let x = 4; x < canvas.width - 4; x++) {
            const index = (y * canvas.width + x) * 4;
            const rgba = [...data.slice(index, index + 4)].join(",");
            colors.set(rgba, (colors.get(rgba) ?? 0) + 1);
          }
          return { y, uniqueColors: colors.size, dominant: [...colors.entries()]
            .sort((a, b) => b[1] - a[1]).slice(0, 4).map(([rgba, count]) => ({ rgba, count })) };
        });
        const interiorIndex = (Math.floor(canvas.height / 2) * canvas.width + 4) * 4;
        // Land is whatever the layer paints over the map stage's computed background,
        // so the check does not depend on the theme's hue.
        const [backgroundR, backgroundG, backgroundB] = background.match(/\d+/g)!.map(Number);
        const differs = (x: number, y: number) => {
          const index = (y * canvas.width + x) * 4;
          return Math.max(Math.abs(data[index]! - backgroundR!), Math.abs(data[index + 1]! - backgroundG!),
            Math.abs(data[index + 2]! - backgroundB!)) > 12;
        };
        let foreground = 0;
        let northEdge = 0;
        for (let y = 0; y < canvas.height; y++) {
          for (let x = 4; x < canvas.width - 4; x++) {
            if (!differs(x, y)) continue;
            foreground++;
            if (y < 3) northEdge++;
          }
        }
        return { foreground, northEdge, width: canvas.width, height: canvas.height,
          topLeft: [...data.slice(0, 4)], interiorSample: [...data.slice(interiorIndex, interiorIndex + 4)], firstRows };
      }, [png.toString("base64"), stageBackground] as const);
      diagnostics.push({ name, captureMs, regionMs, postRegionCanvas, pixels });
      expect.soft(pixels.foreground, `${name}: continental canvas has visible foreground`).toBeGreaterThan(0);
      expect.soft(pixels.northEdge, `${name}: mainland must not touch the north canvas edge after resize`).toBe(0);
    }
    await writeFile(testInfo.outputPath("national-canvas-diagnostics.json"), JSON.stringify(diagnostics));
    expect(rendererErrors, "browser renderer errors").toEqual([]);
    const election = page.getByRole("combobox", { name: "Elección", exact: true });
    await expect(election).toHaveValue("");
    const provinceLink = national.getByRole("link", { name: "Ir a Buenos Aires" });
    await provinceLink.focus();
    await provinceLink.press("Enter");
    await expect(page).toHaveURL(/#province-reference-heading$/);
    await expect(election).toHaveValue("");
    await national.getByRole("link", { name: "Ir a la selección electoral exacta" }).click();
    await expect(election).toBeFocused();
  }));
});

test("national reference integrity failure leaves exact selectors available for retry", async ({ page }) => {
  await withResultFixture(SPEC, SOURCE_ISOLATION_FIXTURE, async () => withAuthorizedOfficialWorkspace(page, async () => {
    let corrupt = true;
    await page.route("**/geography/argentina-reference.*.geojson", (route) => corrupt
      ? route.fulfill({ status: 200, body: "{}" }) : route.continue());
    await page.goto(new URL("/drilldown", baseURL).toString());
    const national = nationalReferenceStage(page);
    await national.getByRole("button", { name: "Mostrar referencia nacional" }).click();
    await expect(national).toContainText("No se pudo verificar la referencia IGN");
    await expect(national.getByRole("img", { name: /Extensión completa/ })).toHaveCount(0);
    await expect(national.getByRole("button", { name: "Reintentar mapa nacional" })).toBeEnabled();
    const election = page.getByRole("combobox", { name: "Elección", exact: true });
    await expect(election).toBeEnabled();
    await expect(election).toHaveValue("");
    corrupt = false;
    await national.getByRole("button", { name: "Reintentar mapa nacional" }).click();
    await expect(national).toContainText("Referencia IGN verificada");
    await expect(national.getByRole("img", { name: /Extensión completa/ })).toBeVisible();
    await expect(election).toHaveValue("");
  }));
});

test("activated national reference remains accessible and navigable at 320 CSS pixels", async ({ page }, testInfo) => {
  await withResultFixture(SPEC, SOURCE_ISOLATION_FIXTURE, async () => withAuthorizedOfficialWorkspace(page, async () => {
    await page.setViewportSize({ width: 320, height: 720 });
    await page.goto(new URL("/drilldown", baseURL).toString());
    const national = nationalReferenceStage(page);
    const activation = national.getByRole("button", { name: "Mostrar referencia nacional" });
    await activation.focus();
    await expect(activation).toBeFocused();
    await activation.press("Enter");
    await expect(national).toContainText("Referencia IGN verificada");
    await expect(national.getByRole("region", { name: "Vista continental americana" }).getByRole("status"))
      .toContainText("Vista continental disponible");
    const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
    const violations = axe.violations.map(({ id, impact, nodes }) => ({
      id, impact, targets: nodes.flatMap(({ target }) => target),
    }));
    await writeFile(testInfo.outputPath("national-axe-findings.json"), JSON.stringify(violations));
    expect.soft(violations, "automated WCAG-tagged violations after activation (not a conformance claim)").toEqual([]);
    expect.soft(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
      "320px document must not overflow horizontally").toBe(true);
    const targetBoxes = [];
    for (const label of ["Ir a Buenos Aires", "Volver a Argentina", "Ir a la selección electoral exacta"]) {
      const link = national.getByRole("link", { name: label });
      const box = await link.boundingBox();
      targetBoxes.push({ label, width: box?.width ?? 0, height: box?.height ?? 0 });
      expect.soft(box?.width, `${label} touch width`).toBeGreaterThanOrEqual(44);
      expect.soft(box?.height, `${label} touch height`).toBeGreaterThanOrEqual(44);
    }
    await writeFile(testInfo.outputPath("national-320-layout.json"), JSON.stringify({
      viewport: await page.evaluate(() => ({ inner: innerWidth, client: document.documentElement.clientWidth,
        scroll: document.documentElement.scrollWidth })), targets: targetBoxes,
    }));
    const province = national.getByRole("link", { name: "Ir a Buenos Aires" });
    await province.focus();
    await expect(province).toBeFocused();
    const focus = await province.evaluate((element) => {
      const style = getComputedStyle(element);
      return { outline: style.outlineStyle !== "none" && parseFloat(style.outlineWidth) > 0,
        shadow: style.boxShadow !== "none" };
    });
    expect(focus.outline || focus.shadow, "focused navigation has visible outline or ring").toBe(true);
    await province.press("Enter");
    await expect(page).toHaveURL(/#province-reference-heading$/);
  }));
});

test.describe("national reference touch", () => {
  test.use({ hasTouch: true });
  test("touch activation loads both geographic views", async ({ page }) => {
    await withResultFixture(SPEC, SOURCE_ISOLATION_FIXTURE, async () => withAuthorizedOfficialWorkspace(page, async () => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(new URL("/drilldown", baseURL).toString());
      const national = nationalReferenceStage(page);
      await national.getByRole("button", { name: "Mostrar referencia nacional" }).tap();
      await expect(national).toContainText("Referencia IGN verificada");
      await expect(national.getByRole("region", { name: "Vista continental americana" }).getByRole("status"))
        .toContainText("Vista continental disponible");
      await national.getByRole("link", { name: "Ir a Buenos Aires" }).tap();
      await expect(page).toHaveURL(/#province-reference-heading$/);
    }));
  });
});

zoomTest.describe("national reference at native 200% zoom", () => {
  zoomTest.use({ zoomWindowWidth: 640 });
  zoomTest("keeps the verified views and exact navigation usable", async ({ page, next, zoom }, testInfo) => {
    const origin = new URL(environment.NEXT_PUBLIC_SUPABASE_URL).origin;
    next.onFetch((request) => new URL(request.url).origin === origin
      ? fetch(request, { redirect: "error" }) : "abort");
    try {
      await withResultFixture(SPEC, SOURCE_ISOLATION_FIXTURE, async () => withAuthorizedOfficialWorkspace(page, async () => {
      await page.goto(new URL("/drilldown", baseURL).toString());
      const dimensions = () => page.evaluate(() => ({ inner: innerWidth,
        client: document.documentElement.clientWidth, outer: outerWidth }));
      const factorBefore = await zoom.set(1);
      expect(factorBefore).toBe(1);
      const before = await dimensions();
      expect(before.outer).toBe(640);
      expect(Math.abs(before.inner - 640)).toBeLessThanOrEqual(2);
      const factorAfter = await zoom.set(2);
      expect(factorAfter).toBe(2);
      await expect.poll(async () => Math.abs((await dimensions()).inner - before.inner / 2)).toBeLessThanOrEqual(2);
      const after = await dimensions();
      await writeFile(testInfo.outputPath("national-native-zoom.json"), JSON.stringify({
        factorBefore, factorAfter, before, after,
      }));
      expect(Math.abs(after.client - before.client / 2)).toBeLessThanOrEqual(20);
      expect(after.outer).toBe(before.outer);
      expect(Math.abs(after.inner - 320)).toBeLessThanOrEqual(2);
      const national = nationalReferenceStage(page);
      await national.getByRole("button", { name: "Mostrar referencia nacional" }).click();
      await expect(national).toContainText("Referencia IGN verificada");
      await expect(national.getByRole("region", { name: "Vista continental americana" }).getByRole("status"))
        .toContainText("Vista continental disponible");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
      await national.getByRole("link", { name: "Ir a Buenos Aires" }).click();
      await expect(page).toHaveURL(/#province-reference-heading$/);
      }));
    } catch (error) {
      try {
        const trigger = page.getByRole("button", { name: "Abrir navegación" });
        const organization = page.getByRole("combobox", { name: "Organización", exact: true });
        await writeFile(testInfo.outputPath("national-native-failure.json"), JSON.stringify({
          pathname: new URL(page.url()).pathname, errorName: error instanceof Error ? error.name : "unknown",
          mobileTriggerVisible: await trigger.isVisible(),
          drawerVisible: await page.getByRole("dialog", { name: "Navegación principal" }).isVisible(),
          organizationCount: await organization.count(), organizationVisible: await organization.isVisible(),
        }));
      } catch { /* Diagnostic collection must never replace the original failure. */ }
      throw error;
    }
  });
});

nextTest("retries unavailable official evidence with the served canonical selection", async ({ page, next }) => {
    const bodies: unknown[] = [];
    const origin = new URL(environment.NEXT_PUBLIC_SUPABASE_URL).origin;
    next.onFetch(async (request) => {
      const url = new URL(request.url);
      if (url.origin !== origin) return "abort";
      if (url.pathname !== "/rest/v1/rpc/official_result") return fetch(request, { redirect: "error" });
      if (request.method !== "POST" || url.search || url.hash) return "abort";
      bodies.push(await request.clone().json());
      if (bodies.length === 1) return Response.json({ message: "controlled unavailable" }, { status: 503 });
      return fetch(request, { redirect: "error" });
    });
  await withResultFixture(SPEC, SOURCE_ISOLATION_FIXTURE, async () => withAuthorizedOfficialWorkspace(page, async () => {
    const path = `/drilldown?electionId=${SOURCE_SCOPE.electionId}&categoryId=${SOURCE_SCOPE.categoryId}` +
      `&distritoCode=${identity.distritoCode}&seccionCode=${identity.seccionCode}` +
      "&circuitoCode=00001&establecimientoCode=E1&mesaCode=1&level=mesa";
    const submittedUrl = new URL(path, baseURL).toString();
    const expectedBody = {
      p_election_id: SOURCE_SCOPE.electionId, p_category_id: SOURCE_SCOPE.categoryId,
      p_distrito_code: identity.distritoCode, p_seccion_code: identity.seccionCode,
      p_circuito_code: "00001", p_establecimiento_code: "E1", p_mesa_code: 1, p_requested_level: "mesa",
    };
    await page.goto(submittedUrl);
    await expect(page.getByRole("main").getByRole("alert")).toContainText("no está disponible");
    expect(bodies).toEqual([expectedBody]);
    await page.locator("html").evaluate((element) => { element.dataset.retrySentinel = "original-document"; });
    const retry = page.getByRole("link", { name: "Reintentar carga", exact: true });
    await expect(retry).toHaveCount(1);
    await expect(retry).toHaveAttribute("href", path);
    await retry.focus();
    await expect(retry).toBeFocused();
    await retry.press("Enter");
    await expect.poll(() => bodies.length).toBe(2);
    expect(bodies).toEqual([expectedBody, expectedBody]);
    await expect(page).toHaveURL(submittedUrl);
    await expect(page.locator("html")).not.toHaveAttribute("data-retry-sentinel", "original-document");
    await expect(page.getByText("Fin del recorrido", { exact: true })).toBeVisible();
    await page.getByText("Mostrar resultados exactos", { exact: true }).click();
    await expect(page.getByRole("main")).toContainText(`${formatCount(OFFICIAL_VOTES)} votos a nivel mesa`);
    await expect(page.getByText("Archivo y procedencia", { exact: true })).toBeVisible();
    await page.getByText("Archivo y procedencia", { exact: true }).click();
    await expect(page.getByRole("list", { name: "procedencia" })).toContainText("SHA-256");
    await expect(retry).toHaveCount(0);
  }));
});

async function expectDistributionScaleAligned(page: Page): Promise<void> {
  const chart = page.getByRole("region", { name: "Distribución del voto oficial", exact: true });
  await expect(chart).toBeVisible();
  // Compare rendered text centers with actual SVG grid lines, not only shared CSS names.
  await expect.poll(() => chart.evaluate((element) => {
    const ticks = [...element.querySelectorAll('[aria-hidden="true"] > div > span')];
    const axis = element.querySelector('[aria-hidden="true"]');
    const series = element.querySelector("ul");
    const bars = [...element.querySelectorAll('svg[role="img"]')];
    const offsets = bars.flatMap((bar) => ticks.map((tick, index) => {
      const line = bar.querySelectorAll("line")[index];
      if (!line) return Infinity;
      const label = tick.getBoundingClientRect();
      return Math.abs(label.left + label.width / 2 - line.getBoundingClientRect().left);
    }));
    return {
      fiveTicks: ticks.length === 5,
      hasBars: bars.length > 0,
      fullWidth: Boolean(axis && series && Math.abs(axis.getBoundingClientRect().width - series.getBoundingClientRect().width) <= 1),
      aligned: offsets.length > 0 && offsets.every((offset) => offset <= 1),
    };
  })).toEqual({ fiveTicks: true, hasBars: true, fullWidth: true, aligned: true });
}

async function expectNoBlankSearchParams(page: Page): Promise<void> {
  const url = new URL(page.url());
  for (const [name, value] of url.searchParams) {
    expect(value, `${name} must be omitted instead of serialized blank`).not.toBe("");
  }
}

    async function withAuthorizedOfficialWorkspace<T>(page: Page, run: () => Promise<T>): Promise<T> {
      const admin = createClient(environment.NEXT_PUBLIC_SUPABASE_URL, environment.SUPABASE_SERVICE_ROLE_KEY);
      const { data: auth, error: authError } = await admin.auth.admin.listUsers();
      const user = auth?.users.find((candidate) => candidate.email?.toLowerCase() === environment.VOTUS_E2E_TEST_USER_EMAIL.toLowerCase());
      if (authError || !user) throw new Error(`failed to resolve official fixture user: ${authError?.message ?? "user missing"}`);
      const { data: fixture, error: fixtureError } = await admin.rpc("e2e_setup_authorized_fiscal_fixture", { p_user_id: user.id, p_distrito_code: identity.distritoCode, p_seccion_code: identity.seccionCode });
      if (fixtureError || typeof fixture?.organization_id !== "string") throw new Error(`failed to set up authorized official fixture: ${fixtureError?.message ?? "invalid response"}`);
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
      } catch (error) { outcome = { error }; } finally { ({ error: cleanupError } = await admin.rpc("e2e_cleanup_authorized_fiscal_fixture", { p_fixture: fixture })); }
      if ("error" in outcome) { if (cleanupError) throw new AggregateError([outcome.error, new Error(cleanupError.message)], "official assertion and fixture cleanup failed"); throw outcome.error; }
      if (cleanupError) throw new Error(`failed to clean official fixture: ${cleanupError.message}`); return outcome.value;
    }

    test.describe("no fiscalización leakage into the rendered page", () => {
  test("Panorama opens Rosales results without another selection", async ({ page }) => {
    await withResultFixture(SPEC, SOURCE_ISOLATION_FIXTURE, async () => withAuthorizedOfficialWorkspace(page, async () => {
      const query = new URLSearchParams({
        electionId: SOURCE_SCOPE.electionId, categoryId: SOURCE_SCOPE.categoryId,
        distritoCode: identity.distritoCode, seccionCode: identity.seccionCode,
        sourceKind: "official",
      });
      await page.goto(new URL(`/?${query}`, baseURL).toString());
      const explore = page.getByRole("link", { name: /Explorar resultados/ });
      const explorationHref = await explore.getAttribute("href");
      await explore.click();
      const hasRosalesScope = (url: URL) => url.pathname === "/drilldown" &&
        url.searchParams.get("distritoCode") === "02" && url.searchParams.get("seccionCode") === "027";
      // Always leave an artifact before any assertions or DOM collection. CI only
      // uploads facts on failure; a collection error must not erase the baseline.
      const factsPath = test.info().outputPath("e2e-facts-panorama-exact-results.json");
      await writeFile(factsPath, JSON.stringify({
        phase: "after-exploration-click",
        fixtureMatchesPanoramaTerritory: identity.distritoCode === "02" && identity.seccionCode === "027",
        fixtureMatchesPanoramaCategory: identity.categoryName === "CONCEJALES",
      }));
      const pageFacts = await page.evaluate(() => {
        const main = document.querySelector("main");
        const text = main?.textContent ?? "";
        return {
          mainCount: document.querySelectorAll("main").length,
          containsRosales: text.includes("Rosales"),
          needsSelection: text.includes("Elija una sección exacta"),
          empty: text.includes("No se encontraron resultados oficiales"),
          denied: text.includes("no pertenece al alcance autorizado") || text.includes("No tiene autorización"),
          malformed: text.includes("validación de integridad"),
          exactResultsCount: [...(main?.querySelectorAll("summary") ?? [])].filter(element => element.textContent === "Mostrar resultados exactos").length,
          controls: [...(main?.querySelectorAll("select") ?? [])].map(select => ({
            id: select.id, disabled: select.disabled, optionCount: select.options.length,
            hasSelection: Boolean(select.value),
          })),
        };
      }).catch(() => ({ collectionFailed: true }));
      await writeFile(factsPath, JSON.stringify({
        phase: "before-destination-and-evidence-assertions",
        fixtureMatchesPanoramaTerritory: identity.distritoCode === "02" && identity.seccionCode === "027",
        fixtureMatchesPanoramaCategory: identity.categoryName === "CONCEJALES",
        ...pageFacts,
      }));
      {
        const destination = new URL(page.url());
        await writeFile(test.info().outputPath("e2e-facts-panorama-exploration.json"), JSON.stringify({
          destinationPath: destination.pathname,
          destinationScope: {
            distritoCode: destination.searchParams.get("distritoCode"),
            seccionCode: destination.searchParams.get("seccionCode"),
            level: destination.searchParams.get("level"),
          },
          linkHasDistrict: explorationHref !== null && new URL(explorationHref, baseURL).searchParams.has("distritoCode"),
          linkHasSection: explorationHref !== null && new URL(explorationHref, baseURL).searchParams.has("seccionCode"),
          ...pageFacts,
        }));
      }
      await expect(page).toHaveURL(hasRosalesScope);
      await expect(page.getByRole("main")).toContainText("Rosales");
      const exactResults = page.getByText("Mostrar resultados exactos", { exact: true });
      await expect(exactResults).toBeVisible();
      await expect(page.getByRole("main")).not.toContainText("Elija una sección exacta");
    }));
  });
  test("test_rendered_page_excludes_fiscalizacion_without_opt_in", async ({ page }) => {
    await withResultFixture(SPEC, SOURCE_ISOLATION_FIXTURE, async () => withAuthorizedOfficialWorkspace(page, async () => {
      await page.goto(new URL("/dashboard", baseURL).toString());
      await expect(page).toHaveURL(new URL("/", baseURL).toString());

      await page.goto(new URL(
        `/drilldown?electionId=${SOURCE_SCOPE.electionId}` +
          `&jurisdictionId=${SOURCE_SCOPE.jurisdictionId}&categoryId=${SOURCE_SCOPE.categoryId}` +
          `&partyCategory=${encodeURIComponent(identity.categoryName)}&partyJurisdiction=national`,
        baseURL,
      ).toString());

      const legacy = page.getByRole("main");
      await expect(legacy.getByRole("alert")).toContainText("parámetros heredados");
      await expect(legacy.getByRole("alert")).toContainText("jurisdictionId");
      await expect(legacy).not.toContainText(`${formatCount(OFFICIAL_VOTES)} votos`);

      await page
        .getByRole("navigation", { name: "principal" })
        .getByRole("link", { name: "Exploración", exact: true })
        .click();
      await expect(page).toHaveURL(new URL("/drilldown", baseURL).toString());
      await expect(page.getByRole("button", { name: "Aplicar selección" })).toHaveCount(0);
      await page.locator("details").filter({ has: page.locator("#explorer-distrito") }).locator("summary").click();
      for (const label of ["Categoría", "Distrito", "Sección"]) {
        const descendant = page.getByRole("combobox", { name: label, exact: true });
        await expect(descendant).toBeDisabled();
        expect(await descendant.evaluate((element) => {
          (element as HTMLSelectElement).focus();
          return document.activeElement === element;
        })).toBe(false);
      }

      const form = page.locator('form[action="/drilldown"]'); await page.locator("html").evaluate((element) => { element.dataset.scopeSentinel = "alive"; });
      const draft = async (label: string, value: string, dependent?: string, optionText?: string): Promise<void> => {
        const control = page.getByRole("combobox", { name: label, exact: true });
        if (optionText) await expect(control.getByRole("option", { name: optionText, exact: true })).toHaveAttribute("value", value);
        const name = await control.getAttribute("name");
        await control.focus();
        await control.selectOption(value);
        await expect(page).toHaveURL((url) => (url.searchParams.get(name!) ?? "") === value);
        await expect(form).not.toHaveAttribute("aria-busy", "true");
        await expect(control).toBeFocused();
        await expect(control).toHaveValue(value);
        if (dependent && value) await expect(page.getByRole("combobox", { name: dependent, exact: true })).toBeEnabled();
        await expect(page.locator("html")).toHaveAttribute("data-scope-sentinel", "alive");
      };
      await draft("Elección", SOURCE_SCOPE.electionId, "Categoría"); await draft("Categoría", SOURCE_SCOPE.categoryId, "Distrito");
      await draft("Distrito", identity.distritoCode, "Sección", `${identity.distritoCode} — Buenos Aires`);
      await draft("Sección", identity.seccionCode, undefined, `${identity.seccionCode} — Coronel de Marina L. Rosales`);
      const openChild = async (name: string, level: string): Promise<void> => {
        await page.getByRole("button", { name: `Abrir ${name}`, exact: true }).click();
        await expect(page).toHaveURL(url => url.searchParams.get("level") === level);
        await expect(form).not.toHaveAttribute("aria-busy", "true");
        await expect(page.locator("#navigator-title")).toBeFocused();
        await expect(page.locator("html")).toHaveAttribute("data-scope-sentinel", "alive");
      };
      const checkGlossary = async (term: string) => {
        const help = page.getByRole("button", { name: `Qué significa ${term}`, exact: true });
        await help.focus();
        const tooltip = page.locator(`[id="${await help.getAttribute("aria-describedby")}"]`);
        await expect(tooltip).toBeVisible();
        await expect(help).toHaveAccessibleDescription(/.+/);
        await page.keyboard.press("Escape");
        await expect(tooltip).toBeHidden();
        await expect(help).toBeFocused();
      };
      await checkGlossary("sección");
      await checkGlossary("circuito");
      const traversalUrls = [page.url()];
      await openChild("00001", "circuito"); traversalUrls.push(page.url());
      await checkGlossary("establecimiento");
      await openChild("E1 — Synthetic school", "establecimiento"); traversalUrls.push(page.url());
      await checkGlossary("mesa");
      await openChild("Mesa 1", "mesa"); traversalUrls.push(page.url());
      await expect(page.getByText("Fin del recorrido", { exact: true })).toBeVisible();
      // Real browser history must restore both exact lineage and served evidence.
      const traversalLevels = ["seccion", "circuito", "establecimiento", "mesa"];
      const assertRestored = async (index: number) => {
        await expect(page).toHaveURL(traversalUrls[index]!);
        await expect(form).not.toHaveAttribute("aria-busy", "true");
        await expect(page.getByRole("main")).toContainText(`votos a nivel ${traversalLevels[index]}`);
        await expect(page.getByRole("combobox", { name: "Sección", exact: true })).toHaveValue(identity.seccionCode);
        await expect(page.getByText("Actualizando resultados… La evidencia se mostrará cuando la selección esté verificada.", { exact: true })).toHaveCount(0);
      };
      for (const index of [2, 1, 0]) { await page.goBack(); await assertRestored(index); }
      for (const index of [1, 2, 3]) { await page.goForward(); await assertRestored(index); }
      const section = page.getByRole("combobox", { name: "Sección", exact: true });
      await section.focus(); await section.selectOption("");
      await expect(section).toBeFocused();
      for (const key of ["circuitoCode", "establecimientoCode", "mesaCode", "level"]) {
        await expect(page).toHaveURL(url => !url.searchParams.has(key));
      }
      for (const label of ["Circuito", "Establecimiento", "Mesa", "Nivel"]) await expect(page.getByRole("combobox", { name: label, exact: true })).toHaveCount(0);
      await expect(page).toHaveURL((url) => !url.searchParams.has("seccionCode"));
      await expect(form).not.toHaveAttribute("aria-busy", "true");
      await draft("Sección", identity.seccionCode);
      await openChild("00001", "circuito");
      await openChild("E1 — Synthetic school", "establecimiento");
      await openChild("Mesa 1", "mesa");
      await expectNoBlankSearchParams(page);
      const explorerUrl = new URL(
        `/drilldown?electionId=${SOURCE_SCOPE.electionId}&categoryId=${SOURCE_SCOPE.categoryId}` +
          `&distritoCode=${encodeURIComponent(identity.distritoCode)}` +
          `&seccionCode=${encodeURIComponent(identity.seccionCode)}` +
          `&circuitoCode=00001&establecimientoCode=E1&mesaCode=1&level=mesa`,
        baseURL,
      ).toString();
      await expect(page).toHaveURL(explorerUrl);
      await expect(page.locator("html")).toHaveAttribute("data-scope-sentinel", "alive");
      const explorer = page.getByRole("main");
      await page.getByText("Mostrar resultados exactos", { exact: true }).click();
      await expect(explorer).toContainText(`${formatCount(OFFICIAL_VOTES)} votos a nivel mesa, obtenidos de filas de fuente mesa`);
      await expect(explorer).toContainText(
        `Se excluyeron 1 fila de fuente fiscalización / ${formatCount(FISCALIZACION_VOTES)} votos del agregado oficial`);
      await expect(explorer).not.toContainText(`${formatCount(OFFICIAL_VOTES + FISCALIZACION_VOTES)} votos a nivel mesa`);
      await expect(explorer).not.toContainText(FISCALIZACION_MARKER);
      await page.setViewportSize({ width: 1440, height: 900 });
      await expect(explorer.getByRole("heading", { name: "Exploración territorial" })).toBeVisible();
      await expect(explorer.getByRole("heading", { name: "Referencia electoral autorizada" })).toBeVisible();
      const voteTable = explorer.getByRole("region", { name: "Votos oficiales y porcentaje por partido" });
      await voteTable.focus();
      await expect(voteTable).toBeFocused();
      expect(await page.locator("html").evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);

      for (const width of [1440, 390, 320]) {
        await page.setViewportSize({ width, height: 900 });
        await expectDistributionScaleAligned(page);
      }

      await page.setViewportSize({ width: 320, height: 720 });
      await expect(explorer.getByRole("heading", { name: "Exploración territorial" })).toBeVisible();
      await expect(explorer.getByRole("region", { name: "Distribución del voto oficial", exact: true })).toBeVisible();
      await expect(voteTable).toBeVisible();
      await voteTable.focus();
      await expect(voteTable).toBeFocused();
      expect(await page.locator("html").evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
      await page.setViewportSize({ width: 1440, height: 900 });

      await expect(page.getByText("Archivo y procedencia", { exact: true })).toBeVisible();
    await page.getByText("Archivo y procedencia", { exact: true }).click();
      const provenance = page.getByRole("list", { name: "procedencia" });
      await expect(provenance.getByRole("listitem")).toHaveCount(1);
      await expect(provenance).toContainText(identity.archiveEntryIds[0]!);
      await expect(provenance).toContainText("SHA-256");
      await expect(provenance.getByRole("link")).toHaveCount(0);
      await expect(provenance).not.toContainText("http://");
      await expect(provenance).not.toContainText("https://");

      const submittedScope = explorer.getByRole("region", { name: "Alcance aplicado", exact: true });
      const results = explorer.getByRole("region", { name: "Desglose oficial autorizado", exact: true });
      const evidence = explorer.getByRole("region", { name: "Referencias de la consulta", exact: true });
      const submittedHeading = results.getByRole("heading", { name: "Desglose oficial autorizado", exact: true });
      await expect(submittedHeading).toBeVisible();
      await expect(submittedHeading).toHaveCSS("font-size", "20px");
      await expect(explorer.getByRole("heading", { name: "Exploración territorial" })).toHaveCSS("font-size", "32px");
      await expect(submittedScope).toBeVisible();
      const parent = page.getByRole("button", { name: "Volver a Synthetic school", exact: true });
      // Keep a real server response outstanding during an independent edit.
      let ready = false;
      let delivered = false;
      let release: () => void = () => {};
      const held = new Promise<void>((resolve) => { release = resolve; });
      await page.route("**/drilldown?**", async (route) => {
        const params = new URL(route.request().url()).searchParams;
        if (params.get("level") !== "establecimiento" || params.has("mesaCode")) {
          await route.continue(); return;
        }
        const response = await route.fetch();
        ready = true;
        await held;
        await route.fulfill({ response });
        delivered = true;
      });
      try {
        await parent.click();
        await expect.poll(() => ready).toBe(true);
        await expect(results).toHaveCount(0);
        await expect(evidence).toHaveCount(0);
        await expect(provenance).toHaveCount(0);
        // A newer independent context edit must survive the held territorial response.
        await form.getByRole("combobox", { name: "Categoría", exact: true }).selectOption("");
        release();
        await expect.poll(() => delivered).toBe(true);
        await expect(page).toHaveURL(url => !url.searchParams.has("categoryId") && !url.searchParams.has("mesaCode") && !url.searchParams.has("level"));
        await expect(form.getByRole("combobox", { name: "Categoría", exact: true })).toHaveValue("");
        await expect(results).toHaveCount(0);
        await expect(evidence).toHaveCount(0);
      } finally { release(); await page.unrouteAll({ behavior: "wait" }); }

      await draft("Categoría", SOURCE_SCOPE.categoryId, "Distrito");
      await draft("Distrito", identity.distritoCode, "Sección");
      await draft("Sección", identity.seccionCode);
      await openChild("00001", "circuito");
      await openChild("E1 — Synthetic school", "establecimiento");
      await openChild("Mesa 1", "mesa");
      // Returning A → pending B → A must supersede B, not merely clear a dirty flag.
      ready = false; delivered = false;
      let releaseReversal: () => void = () => {};
      const reversal = new Promise<void>((resolve) => { releaseReversal = resolve; });
      await page.route("**/drilldown?**", async (route) => {
        if (new URL(route.request().url()).searchParams.get("level") !== "establecimiento") {
          await route.continue(); return;
        }
        const response = await route.fetch(); ready = true;
        await reversal; await route.fulfill({ response }); delivered = true;
      });
      try {
        await parent.click();
        await expect.poll(() => ready).toBe(true);
        await expect(results).toHaveCount(0);
        await page.getByRole("button", { name: "Volver a la selección verificada", exact: true }).click();
        releaseReversal();
        await expect.poll(() => delivered).toBe(true);
        await expect(page).toHaveURL(explorerUrl);
        await expect(explorer).toContainText("votos a nivel mesa");
        await expect(page.getByText("Fin del recorrido", { exact: true })).toBeVisible();
        await expect(page).toHaveURL(url => url.searchParams.get("mesaCode") === "1" && url.searchParams.get("level") === "mesa");
      } finally { releaseReversal(); await page.unrouteAll({ behavior: "wait" }); }
      const filters = explorer.getByRole("region", { name: "Filtros de exploración", exact: true });
      const workbench = explorer.getByRole("region", { name: "Mesa de trabajo territorial", exact: true });
      const map = workbench.getByRole("region", { name: "Mapa territorial de referencia", exact: true });
      const inspector = workbench.getByRole("region", { name: "Detalle territorial", exact: true });
      // Returning to the served selection re-renders the page with the exact disclosure collapsed.
      const exactToggle = page.getByText("Mostrar resultados exactos", { exact: true });
      if (!(await page.locator("details").filter({ has: exactToggle }).evaluate((element) => (element as HTMLDetailsElement).open))) await exactToggle.click();
      const exactBeforeCamera = await voteTable.textContent();
      const closer = map.getByRole("button", { name: "Acercar mapa", exact: true });
      const farther = map.getByRole("button", { name: "Alejar mapa", exact: true });
      for (let i = 0; i < 4; i++) await closer.click();
      await expect(closer).toBeDisabled();
      await expect(map).toContainText("Vista de referencia · 180 %");
      for (let i = 0; i < 5; i++) await farther.click();
      await expect(farther).toBeDisabled();
      await expect(map).toContainText("Vista de referencia · 80 %");
      await map.getByRole("button", { name: "Restablecer vista", exact: true }).click();
      await expect(map).toContainText("Vista de referencia · 100 %");
      await expect(page).toHaveURL(explorerUrl);
      expect(await voteTable.textContent()).toBe(exactBeforeCamera);
      for (const [width, inspectorWidth] of [[1440, 322], [1250, 295], [980, 275], [760, null], [320, null]] as const) {
        await page.setViewportSize({ width, height: 900 });
        await expect.poll(async () => {
          const [filterBox, workBox, mapBox, detailBox, resultBox, evidenceBox] = await Promise.all(
            [filters, workbench, map, inspector, results, evidence].map(region => region.evaluate(element => {
              const { top, bottom, left, right, width } = element.getBoundingClientRect();
              return { top, bottom, left, right, width };
            })),
          );
          return {
            filtersAbove: filterBox!.bottom <= workBox!.top,
            workbenchAboveResults: workBox!.bottom <= resultBox!.top,
            evidenceBelow: resultBox!.bottom <= evidenceBox!.top,
            inspectorGeometry: inspectorWidth === null
              ? mapBox!.bottom <= detailBox!.top && Math.abs(mapBox!.width - detailBox!.width) <= 2
              : Math.abs(detailBox!.width - inspectorWidth) <= 2 && mapBox!.right <= detailBox!.left,
          };
        }).toEqual({ filtersAbove: true, workbenchAboveResults: true, evidenceBelow: true, inspectorGeometry: true });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        for (const control of await map.getByRole("group", { name: "Controles de vista", exact: true }).getByRole("button").all()) {
          const box = await control.boundingBox();
          expect(box!.height).toBeGreaterThanOrEqual(44);
          expect(box!.width).toBeGreaterThanOrEqual(44);
        }
        for (const link of await explorer.getByRole("navigation", { name: "Ruta de exploración" }).getByRole("link").all()) {
          const box = await link.boundingBox();
          expect(box!.height).toBeGreaterThanOrEqual(44);
          expect(box!.width).toBeGreaterThanOrEqual(44);
        }
      }
      await page.setViewportSize({ width: 1440, height: 900 });

      await parent.click();
      await expect(form).not.toHaveAttribute("aria-busy", "true");
      await expect(page.locator("#navigator-title")).toBeFocused();
      const secondUrl = explorerUrl.replace("&mesaCode=1&level=mesa", "&level=establecimiento");
      await expect(page).toHaveURL(secondUrl); await expectNoBlankSearchParams(page);
      await expect(page.locator("html")).toHaveAttribute("data-scope-sentinel", "alive");
      await expect(explorer).toContainText("votos a nivel establecimiento");
      await page.goto(new URL("/dashboard", baseURL).toString()); await page.goBack();
      await expect(page).toHaveURL(secondUrl);
      await expect(page.getByRole("button", { name: "Abrir Mesa 1", exact: true })).toBeVisible();
      await page.reload(); await expect(page).toHaveURL(secondUrl);

      await page.goto(new URL(
        `/drilldown?electionId=${SOURCE_SCOPE.electionId}&categoryId=${SOURCE_SCOPE.categoryId}` +
          `&distritoCode=${identity.distritoCode}&seccionCode=${identity.seccionCode}` +
          "&circuitoCode=00001&establecimientoCode=E1&mesaCode=invalid&level=mesa",
        baseURL,
      ).toString());
      await expect(page.getByRole("main").getByRole("alert")).toContainText("Se rechazó");

      await page.goto(new URL(
        `/drilldown?electionId=${SOURCE_SCOPE.electionId}&categoryId=${SOURCE_SCOPE.categoryId}` +
          `&distritoCode=${identity.distritoCode}&distritoCode=84&level=distrito`,
        baseURL,
      ).toString());
      await expect(page.getByRole("main").getByRole("alert")).toContainText("Se rechazó");
    }));
  });
});
