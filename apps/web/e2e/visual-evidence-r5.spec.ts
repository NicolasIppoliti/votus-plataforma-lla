import { type Page, type Browser, type Locator } from "@playwright/test";
import { expect, test } from "./review-test-fixture";
import { readFile, writeFile } from "node:fs/promises";
import type { Server } from "node:http";
import { withReviewItem } from "./authorized-review-fixture";
import { withAuthorizedResultWorkspace } from "./authorized-result-workspace";
import { withAuthorizedComparisonWorkspace } from "./authorized-comparison-fixture";
import { withAuthorizedMunicipalWorkspace } from "./authorized-municipal-fixture";
import { comparisonFixture, coverageFixture, sourceIsolationFixture, withResultFixture } from "./result-fixture";
import { withPanoramaResults } from "./panorama-result-fixture";
import { scenarioBaseUrl } from "./scenario-ownership";
import { assertE2eEnvironment } from "./gate-contract";

const environment = assertE2eEnvironment(process.env);
// Each test includes fixture ownership, two full-page captures and pair rendering.
// Keep a bounded budget for the two cold interactive comparison maps as well.
test.setTimeout(120_000);

const pairs = [
  { name: "panorama", prototype: "panorama", route: "/" },
  { name: "exploracion", prototype: "territorial-exploration", route: "/drilldown" },
  { name: "comparacion", prototype: "temporal-comparison", route: "/compare" },
  { name: "evidencia", prototype: "evidence-quality", route: "/evidencia" },
  { name: "simulacion", prototype: "seat-simulation", route: "/simulate" },
] as const;

const readiness = new WeakMap<Page, { phase: string; locators: Record<string, Locator> }>();
function signal(page: Page, name: string, locator: Locator) {
  const state = readiness.get(page) ?? { phase: "setup", locators: {} as Record<string, Locator> };
  readiness.set(page, state);
  state.phase = name;
  state.locators[name] = locator;
  return locator;
}

test.beforeEach(async ({ page }) => {
  readiness.set(page, { phase: "setup", locators: {
    organization: page.getByRole("combobox", { name: "Organización", exact: true }),
    main: page.getByRole("main"),
    exactDisclosure: page.getByText("Mostrar resultados exactos", { exact: true }),
    comparison: page.getByRole("region", { name: "Comparación territorial de referencia" }),
    comparisonOpenResults: page.locator('[data-results-for="compare-results-heading"][open]'),
    evidenceContext: page.getByRole("form", { name: "Contexto de la evidencia" }),
    evidenceReading: page.getByRole("heading", { name: "Qué respalda este dato", exact: true }),
    allocation: page.getByTestId("allocation-result"),
    municipalTable: page.getByRole("region", { name: "Tabla de resultados oficiales exactos por partido" }),
    mapCanvases: page.locator("canvas.maplibregl-canvas"),
    loading: page.getByText(/Cargando contexto autorizado|Preparando contorno de referencia/),
  } });
});

test.afterEach(async ({ page }, info) => {
  if (info.status === info.expectedStatus) return;
  const match = info.title.match(/^R5 (?:production-only \/)?(\w+).*?at (\d+)px/);
  if (!match) return;
  const state = readiness.get(page)!;
  const path = info.outputPath(`e2e-facts-r5-${match[1]}-${match[2]}.json`);
  // Write a baseline first, even if the browser was lost during the timeout.
  const baseline = { phase: state.phase, status: info.status, pathname: new URL(page.url()).pathname };
  await writeFile(path, JSON.stringify(baseline, null, 2));
  try {
    const content = await page.evaluate(() => {
      const visible = (node: Element) => node.getClientRects().length > 0 && getComputedStyle(node).visibility !== "hidden";
      const texts = (selector: string) => Array.from(document.querySelectorAll(selector)).filter(visible)
        .slice(0, 40).map(node => (node.textContent ?? "").trim().slice(0, 1000));
      return { pathname: location.pathname, headings: texts("h1,h2,h3,h4,h5,h6"), alerts: texts('[role="alert"]'), statuses: texts('[role="status"]') };
    });
    const matched = Object.fromEntries(await Promise.all(Object.entries(state.locators).map(async ([name, locator]) => [name,
      await locator.evaluateAll(nodes => ({ count: nodes.length, visible: nodes.filter(node => node.getClientRects().length > 0 && getComputedStyle(node).visibility !== "hidden").length }))])));
    await writeFile(path, JSON.stringify({ ...baseline, ...content, readiness: matched }, null, 2));
  } catch { await writeFile(path, JSON.stringify({ ...baseline, collectionFailed: true }, null, 2)); }
});

type Measurement = { file: string; width: number; viewportHeight: number; documentHeight: number; scrollWidth: number };
async function capture(page: Page, file: string): Promise<Measurement> {
  await page.evaluate(() => document.fonts.ready);
  // MapLibre can have a visible canvas before its final electoral fill paints.
  // Require three matching rendered frames, not an arbitrary sleep.
  for (const canvas of await page.locator("canvas.maplibregl-canvas").all()) {
    let previous: Buffer | undefined;
    let consecutive = 0;
    await expect.poll(async () => {
      const frame = await canvas.screenshot({ animations: "disabled", scale: "css" });
      consecutive = previous?.equals(frame) ? consecutive + 1 : 0;
      previous = frame;
      return consecutive;
    }, { timeout: 15000, message: `${file}: map must settle` }).toBeGreaterThanOrEqual(2);
  }
  await expect(signal(page, "capture-loading-cleared", page.getByText(/Cargando contexto autorizado|Preparando contorno de referencia/))).toHaveCount(0);
  if (file.startsWith("production-")) {
    // Capture-only normalization: full-page stitching must not paint sticky
    // context bars over content. Preserve fixed positioning: skip links rely
    // on it to stay outside the viewport until focused.
    await page.evaluate(() => {
      for (const element of document.querySelectorAll<HTMLElement>("*")) {
        const position = getComputedStyle(element).position;
        if (position === "sticky") {
          element.style.setProperty("position", "static", "important");
        }
      }
    });
  }
  const size = await page.evaluate(() => ({
    width: innerWidth, viewportHeight: innerHeight,
    documentHeight: document.documentElement.scrollHeight,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(size.scrollWidth, `${file}: horizontal overflow`).toBeLessThanOrEqual(size.width);
  // Last action before capture, after all setup interactions and measurements.
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement || document.activeElement instanceof SVGElement) {
      document.activeElement.blur();
    }
  });
  await page.screenshot({ path: test.info().outputPath(file), fullPage: true, animations: "disabled", scale: "css" });
  return { file, ...size };
}

async function selectedOfficial(page: Page, route: string, captureSelected: () => Promise<void>) {
  // The municipal scenario owns real Rosales data (02/027). Follow the
  // provenance exact-selection URL/disclosure journey against that owned seed,
  // rather than borrowing a comparison-only category and its facet exclusions.
  if (route !== "/compare") {
    const spec = "e2e/municipal.spec.ts";
    const { scope, seed } = sourceIsolationFixture(spec);
    const baseURL = scenarioBaseUrl(spec, environment);
    const viewport = page.viewportSize()!;
    await page.setViewportSize({ width: 1440, height: 900 });
    await withResultFixture(spec, seed, () => withAuthorizedMunicipalWorkspace(page, async () => {
      await page.setViewportSize(viewport);
      // Evidencia accepts only these four context keys and fixes official /
      // section scope internally; drilldown also accepts explicit scope keys.
      const params = new URLSearchParams({ electionId: scope.electionId, categoryId: scope.categoryId,
        distritoCode: "02", seccionCode: "027" });
      if (route === "/drilldown") {
        params.set("level", "seccion");
        params.set("sourceKind", "official");
      }
      await page.goto(new URL(`${route}?${params}`, baseURL).toString());
      if (route === "/drilldown") {
        await signal(page, "open-exact-results", page.getByText("Mostrar resultados exactos", { exact: true })).click();
        await expect(signal(page, "exact-votes", page.getByRole("main"))).toContainText("14.444 votos a nivel seccion");
        await expect(page.locator("details[open]").filter({ has: page.getByText("Mostrar resultados exactos", { exact: true }) })).toBeVisible();
      } else {
        // root.spec.ts asserts this form; the selected result adds the inspector
        // and traceability. Do not depend on a geographic title's exact spelling.
        await expect(signal(page, "evidence-context", page.getByRole("form", { name: "Contexto de la evidencia" }))).toBeVisible();
        await expect(signal(page, "evidence-reading", page.getByRole("heading", { name: "Qué respalda este dato", exact: true }))).toBeVisible();
        await expect(signal(page, "evidence-traceability", page.getByRole("heading", { name: "Trazabilidad autorizada", exact: true }))).toBeVisible();
        await expect(signal(page, "evidence-outline", page.locator('svg[aria-label^="Referencia CNE de"]'))).toBeVisible();
      }
      await captureSelected();
    }));
    return;
  }
  const spec = "e2e/comparison.spec.ts";
  const { identity, seed } = comparisonFixture(spec, "spatial");
  const baseURL = scenarioBaseUrl(spec, environment);
  const viewport = page.viewportSize()!;
  await page.setViewportSize({ width: 1440, height: 900 });
  await withResultFixture(spec, seed, () => withAuthorizedComparisonWorkspace(page, async () => {
    await page.setViewportSize(viewport);
    const params = new URLSearchParams({
      leftElectionId: identity.electionIds[0]!, leftCategoryId: identity.categoryId,
      rightElectionId: identity.electionIds[1]!, rightCategoryId: identity.categoryId,
      distritoCode: "02", seccionCode: "027",
    });
    await page.goto(new URL(`${route}?${params}`, baseURL).toString());
    if (route === "/compare") {
      const panel = signal(page, "comparison-panel", page.getByRole("region", { name: "Comparación territorial de referencia" }));
      await expect(panel).toBeVisible();
      // Both sides share one control group; activating it loads both maps.
      await panel.locator("[data-map-controls] > summary").click();
      await panel.getByText("Estado de los mapas", { exact: true }).click();
      await panel.getByRole("button", { name: "Mostrar mapa interactivo" }).click();
      for (const name of ["Lado A — 2023 generales", "Lado B — 2025 legislativas"]) {
        const side = name.split(" — ")[0];
        await expect(signal(page, `${name}-ready`, panel.getByRole("status").filter({ hasText: `${side}:` }))).toContainText("Mapa de", { timeout: 15000 });
        await expect(signal(page, `${name}-canvas`, panel.getByRole("article", { name }).locator("canvas.maplibregl-canvas"))).toBeVisible();
      }
      await panel.getByRole("button", { name: "Seleccionar sección y consultar resultados" }).first().click();
      await expect(page.locator('[data-results-for="compare-results-heading"]')).toHaveAttribute("open", "");
      await expect(page.getByRole("table").first()).toContainText(identity.comparisonParty!.displayName);
    }
    await captureSelected();
  }, identity), "spatial");
}

async function production(page: Page, route: string, captureSelected: () => Promise<void>) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  if (route === "/simulate") {
    await withReviewItem(page, async () => {
      await page.goto("/scenarios");
      await page.getByTestId("scenario-persistencia").getByRole("link", { name: "Editar este escenario" }).click();
      await expect(page).toHaveURL(/\/simulate\?scenario=/);
      await expect(signal(page, "scenario-provenance", page.getByRole("region", { name: "Procedencia del escenario" }))).toContainText("Persistencia");
      await expect(signal(page, "scenario-allocation", page.getByTestId("allocation-result"))).toBeVisible();
      await captureSelected();
    });
  } else if (route === "/") {
    await withPanoramaResults(fixture => withAuthorizedResultWorkspace(page, test.info().project.use.baseURL!,
      { distritoCode: "02", seccionCode: "027" }, async () => {
        await page.goto("/");
        for (const [label, value] of [["Elección", fixture.election.id], ["Categoría", fixture.categories[0]!.id], ["Distrito", "02"], ["Sección", "027"]]) {
          const control = page.getByRole("combobox", { name: `Contexto electoral: ${label}`, exact: true });
          await expect(control).toBeEnabled();
          await control.selectOption(value!);
        }
        await expect(page.getByRole("complementary", { name: "Lectura de la selección" })).toContainText("11.111");
        await expect(page.getByRole("group", { name: "Circuitos de Coronel Rosales: geometría de referencia CNE", exact: true })).toBeVisible();
        await expect(page.getByRole("group", { name: "Codificación de circuitos", exact: true })).toBeVisible();
        await expect(page.getByRole("region", { name: "Circuitos disponibles para profundizar", exact: true })).toContainText("00248");
        await captureSelected();
      }), test.info());
  } else {
    await selectedOfficial(page, route, captureSelected);
  }
}

async function renderPair(browser: Browser, name: string, width: number) {
  const context = await browser.newContext({ viewport: { width: width * 2, height: 900 }, deviceScaleFactor: 1, storageState: { cookies: [], origins: [] } });
  try {
    const page = await context.newPage();
    const images = await Promise.all(["prototype", "production"].map(async side => ({ side,
      data: (await readFile(test.info().outputPath(`${side}-${name}-${width}.png`))).toString("base64") })));
    await page.setContent(`<!doctype html><html><head><style>
      *{box-sizing:border-box}body{margin:0;display:flex;background:#ddd;font:16px sans-serif}
      figure{margin:0;width:${width}px;flex:none;background:repeating-linear-gradient(45deg,#ddd,#ddd 10px,#eee 10px,#eee 20px)}
      figcaption,footer{height:40px;padding:8px;background:#fff;color:#111}img{display:block;width:${width}px;height:auto}
      </style></head><body>${images.map(({ side, data }) => `<figure><figcaption>${side} · ${name} · ${width} CSS px · 1:1</figcaption><img src="data:image/png;base64,${data}" alt="${side}"><footer>Fin de captura ${side}</footer></figure>`).join("")}</body></html>`);
    await page.locator("img").evaluateAll(images => Promise.all(images.map(image => (image as HTMLImageElement).decode())));
    for (const image of await page.locator("img").all()) {
      expect(await image.evaluate(image => (image as HTMLImageElement).naturalWidth)).toBe(width);
    }
    await page.screenshot({ path: test.info().outputPath(`pair-${name}-${width}.png`), fullPage: true, scale: "css" });
  } finally { await context.close(); }
}

for (const pair of pairs) {
  for (const width of [1440, 390, 320]) {
    test(`R5 ${pair.name} approved pair at ${width}px`, async ({ page, browser, next }) => {
      // Controlled circuit RPC follows municipal.spec.ts: real authorized loader,
      // real checksum-pinned geometry, explicitly synthetic outcomes.
      if (pair.name === "panorama") next.onFetch(request => {
        const url = new URL(request.url);
        if (url.origin !== new URL(environment.NEXT_PUBLIC_SUPABASE_URL).origin) return "abort";
        if (url.pathname !== "/rest/v1/rpc/official_section_circuit_outcomes") return fetch(request, { redirect: "error" });
        return Response.json({
          status: "ok", authorization_status: "authorized", source_kind: "official", level: "seccion", truncated: false,
          circuit_membership: "known", category_applicability: "district_reported_categories",
          unassigned: { catalogue_mesas_without_membership: 0, membership_quarantined_mesas: 0, membership_quarantine_reasons: {}, completeness_quarantines: 0, completeness_quarantine_reasons: {}, unexpected_status_mesas: 0 },
          circuits: [6000, 5111].map((votes, index) => ({ circuito_code: index === 0 ? "00248" : "00249", positive_total: votes,
            parties: [{ identity_status: "canonical", canonical_party_id: "r5-synthetic-party", display_name: "Agrupación sintética R5", list_id: null, votes }],
            status: "complete", counts: { expected: 1, counted: 1, not_counted: 0, missing: 0, unexpected: 0, quarantined: 0 } })),
        });
      });
      else next.onFetch(request => {
        // Unlike Panorama these are ordinary DB-backed journeys. The Next
        // fixture aborts unhandled fetches; explicitly pass through Supabase.
        if (new URL(request.url).origin !== new URL(environment.NEXT_PUBLIC_SUPABASE_URL).origin) return "abort";
        return fetch(request, { redirect: "error" });
      });
      await page.setViewportSize({ width, height: 900 });
      const moduleUrl = new URL(`../../../docs/prototypes/${pair.prototype}/serve.mjs`, import.meta.url);
      const { createPreviewServer } = await import(moduleUrl.href);
      const server: Server = createPreviewServer();
      const reference = await browser.newContext({ viewport: { width, height: 900 }, storageState: { cookies: [], origins: [] } });
      const measurements: Measurement[] = [];
      try {
        await new Promise<void>((resolve, reject) => {
          server.once("error", reject);
          server.listen(0, "127.0.0.1", resolve);
        });
        const address = server.address();
        if (!address || typeof address === "string") throw new Error("prototype server has no TCP address");
        const prototype = await reference.newPage();
        const failures: string[] = [];
        prototype.on("pageerror", error => failures.push(error.message));
        prototype.on("response", response => { if (!response.ok()) failures.push(`${response.status()} ${response.url()}`); });
        await prototype.goto(`http://127.0.0.1:${address.port}/`, { waitUntil: "networkidle" });
        await expect(prototype.locator("h1").first()).toBeVisible();
        expect(failures).toEqual([]);
        measurements.push(await capture(prototype, `prototype-${pair.name}-${width}.png`));
        await production(page, pair.route, async () => {
          measurements.push(await capture(page, `production-${pair.name}-${width}.png`));
        });
        await renderPair(browser, pair.name, width);
      } finally {
        await writeFile(test.info().outputPath("visual-evidence-r5-heights.json"), JSON.stringify({ pair: pair.name, route: pair.route, synthetic: true, circuitRpcControlled: pair.name === "panorama", measurements }, null, 2));
        await reference.close();
        await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      }
    });
  }
}

// No approved prototypes for these operator surfaces. Fiscalización is a
// separate, explicitly activated synthetic journey; never mix its figures.
for (const route of ["/municipal", "/fiscalizacion"]) {
  for (const width of [390, 320]) {
    test(`R5 production-only ${route} at ${width}px (no approved prototype)`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      const spec = route === "/municipal" ? "e2e/municipal.spec.ts" : "e2e/fiscalizacion.spec.ts";
      const fixture = route === "/municipal" ? sourceIsolationFixture("e2e/municipal.spec.ts") : coverageFixture("e2e/fiscalizacion.spec.ts");
      const baseURL = scenarioBaseUrl(spec, environment);
      const scope = { ...fixture.scope, distritoCode: route === "/municipal" ? "02" : "82", seccionCode: route === "/municipal" ? "027" : "827" };
      // The shared municipal helper switches the workspace on desktop, just as
      // municipal.spec.ts does; only the final production page uses mobile size.
      if (route === "/municipal") await page.setViewportSize({ width: 1440, height: 900 });
      const authorize = (run: () => Promise<void>) => route === "/municipal"
        ? withAuthorizedMunicipalWorkspace(page, run)
        : withAuthorizedResultWorkspace(page, baseURL, scope, run);
      await withResultFixture(spec, fixture.seed, () => authorize(async () => {
        if (route !== "/municipal") await page.setViewportSize({ width, height: 900 });
        const params = new URLSearchParams({ electionId: scope.electionId, categoryId: scope.categoryId,
          distritoCode: scope.distritoCode, seccionCode: scope.seccionCode, sourceKind: "official" });
        if (route === "/municipal") {
          await page.goto(new URL("/", baseURL).toString());
          // Same cold, configured-election navigation as municipal.spec.ts;
          // resize only after loading the exact official result.
          await page.getByRole("navigation", { name: "principal" }).getByRole("link", { name: "Municipal", exact: true }).click();
        } else await page.goto(new URL(`${route}?${params}`, baseURL).toString());
        const main = page.getByRole("main");
        if (route === "/fiscalizacion") {
          await page.getByRole("link", { name: "Activar fiscalización (no oficial)", exact: true }).click();
          await expect(main).toContainText("Estado de cobertura: ok");
          await expect(main).toContainText("1 unidades observadas de 2 del denominador oficial");
          await expect(main).toContainText("22.222 votos");
          await expect(main).not.toContainText(/11\.?111|33\.?333/);
        } else {
          await expect(signal(page, "municipal-heading", main.getByRole("heading", { name: "Coronel Rosales", level: 1 }))).toBeVisible();
          const table = signal(page, "municipal-exact-table", main.getByRole("region", { name: "Tabla de resultados oficiales exactos por partido" }));
          await expect(table.getByRole("rowheader", { name: "ALIANZA LA LIBERTAD AVANZA" })).toBeVisible();
          await expect(table.getByRole("cell", { name: "11.111", exact: true })).toBeVisible();
          // This excluded-source count is required adjacent evidence, not leakage.
          await expect(main).toContainText("1 fila fiscalización / 22.222 votos");
        }
        await page.setViewportSize({ width, height: 900 });
        const measurement = await capture(page, `production-${route.slice(1)}-${width}.png`);
        await writeFile(test.info().outputPath("visual-evidence-r5-heights.json"), JSON.stringify({ route, approvedPrototype: null,
          synthetic: true, sourceKind: route === "/fiscalizacion" ? "fiscalizacion" : "official", measurements: [measurement] }, null, 2));
      }));
    });
  }
}
