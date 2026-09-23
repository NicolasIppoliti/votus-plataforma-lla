import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { build } from "esbuild";
import { chromium } from "@playwright/test";

const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const root = path.resolve(web, "../..");
const source = path.join(web, "renderer-evaluation");
const id = "geography/arba-coronel-rosales-partido";
const sha256 = "b502009185a5d6b1666312d2d91aa9b79053b2ee8a06f0aa683029b925c3ed13";
const bytes = 69544;

async function geometry() {
  const manifest = JSON.parse(await readFile(path.join(root, "archive-manifest.json"), "utf8")) as { records: Array<{ id: string; archived_path: string; sha256: string; bytes: number }> };
  const matches = manifest.records.filter((record) => record.id === id);
  if (matches.length !== 1) throw new Error("Archive manifest must contain exactly one partido entry");
  const record = matches[0]!;
  if (record.sha256 !== sha256 || record.bytes !== bytes || !/^archive\/geography\/[a-z0-9.-]+\.geojson$/.test(record.archived_path)) throw new Error("Archive declaration mismatch");
  const archive = path.resolve(root, record.archived_path);
  const realRoot = await realpath(root);
  const realArchive = await realpath(archive);
  if (!realArchive.startsWith(realRoot + path.sep) || !archive.startsWith(path.join(root, "archive", "geography") + path.sep)) throw new Error("Archive path escapes repository");
  const content = await readFile(realArchive);
  if (content.length !== bytes || createHash("sha256").update(content).digest("hex") !== sha256) throw new Error("Archived geometry checksum mismatch");
  const parsed = JSON.parse(content.toString("utf8")) as { type: string; features: Array<{ geometry: { type: string } }> };
  if (parsed.type !== "FeatureCollection" || parsed.features.length !== 1 || parsed.features[0]?.geometry.type !== "MultiPolygon") throw new Error("Archived geometry shape mismatch");
  return content;
}

async function main() {
  const mode = process.argv.includes("--verify") ? "verify" : process.argv.includes("--measure") ? "measure" : null;
  const profile = process.argv[process.argv.indexOf("--profile") + 1] ?? "";
  if (!mode || (mode === "measure" && !["desktop", "mobile"].includes(profile))) throw new Error("Usage: --verify | --measure --profile desktop|mobile");
  const content = await geometry();
  const temp = await mkdtemp(path.join(tmpdir(), "territorial-renderer-"));
  let server: ReturnType<typeof createServer> | undefined;
  try {
    const output = await build({ entryPoints: [path.join(source, "main.ts")], bundle: true, format: "esm", platform: "browser", write: false, outfile: path.join(temp, "main.js"), logLevel: "silent" });
    const bundle = output.outputFiles[0]!.contents;
    const html = await readFile(path.join(source, "index.html"));
    const css = await readFile(path.join(source, "evaluation.css"));
    server = createServer((request, response) => {
      const files: Record<string, [Buffer | Uint8Array, string]> = { "/": [html, "text/html; charset=utf-8"], "/main.js": [bundle, "text/javascript; charset=utf-8"], "/evaluation.css": [css, "text/css; charset=utf-8"], "/_evaluation/geometry": [content, "application/geo+json"] };
      const hit = files[request.url ?? ""];
      response.writeHead(hit ? 200 : 404, { "content-type": hit?.[1] ?? "text/plain", "cache-control": "no-store" });
      response.end(hit?.[0] ?? "Not found");
    });
    await new Promise<void>((resolve, reject) => { server!.once("error", reject); server!.listen(0, "127.0.0.1", resolve); });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Loopback address unavailable");
    const url = `http://127.0.0.1:${address.port}/`;
    const browser = await chromium.launch({ headless: true });
    try {
      if (mode === "verify") {
        const verifyContext = await browser.newContext({ viewport: { width: 320, height: 720 } });
        const page = await verifyContext.newPage();
        await page.addInitScript(() => { HTMLCanvasElement.prototype.getContext = function () { return null; }; });
        await page.goto(url);
        const initialTable = await page.locator("table").innerText();
        for (const evidence of [id, sha256, "EPSG:4326", "MultiPolygon", "027", "02/027", "Unsupported at all three depths"]) if (!initialTable.includes(evidence)) throw new Error(`Initial evidence missing: ${evidence}`);
        await page.locator("#renderer-status").getByText("WebGL unavailable").waitFor({ timeout: 10000 });
        const exactTableRetained = await page.locator("table").innerText() === initialTable;
        if (!exactTableRetained) throw new Error("Fallback table changed");
        const focusControl = page.getByRole("button", { name: "Focus or reset Coronel Rosales boundary" });
        await focusControl.focus();
        const visibleKeyboardFocus = await focusControl.evaluate((button) => {
          const style = getComputedStyle(button);
          const outline = parseFloat(style.outlineWidth) > 0 && style.outlineStyle !== "none" && style.outlineColor !== "transparent" && style.outlineColor !== "rgba(0, 0, 0, 0)";
          return button.matches(":focus-visible") && (outline || (style.boxShadow !== "none" && style.boxShadow !== ""));
        });
        if (!visibleKeyboardFocus) throw new Error("Keyboard focus indicator missing");
        await page.keyboard.press("Enter");
        if (!(await page.locator("#selection").innerText()).includes("boundary selected")) throw new Error("Keyboard selection failed");
        await page.keyboard.press("Space");
        if (!(await page.locator("#selection").innerText()).includes("not selected")) throw new Error("Keyboard reset failed");
        const noOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
        if (!noOverflow) throw new Error("320px document overflow");
        const buttonSize = await page.locator("button").boundingBox();
        if (!buttonSize || buttonSize.width < 44 || buttonSize.height < 44) throw new Error("Touch target under 44px");
        const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
        const severe = axe.violations.filter((v) => v.impact === "critical" || v.impact === "serious");
        if (severe.length) throw new Error(`Axe severe findings: ${JSON.stringify(severe.map((v) => v.id))}`);
        const cdp = await page.context().newCDPSession(page);
        let zoom200 = "unsupported";
        try {
          await cdp.send("Emulation.setPageScaleFactor", { pageScaleFactor: 2 });
          zoom200 = await page.evaluate(() => visualViewport?.scale === 2 ? "verified" : "unsupported");
        } catch { zoom200 = "unsupported"; }
        if (zoom200 === "verified") {
          const evidence = page.getByRole("table", { name: "Exact source and coverage evidence (available without WebGL)" });
          const noZoomOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
          if (!noZoomOverflow || !(await evidence.isVisible()) || !(await focusControl.isVisible())) throw new Error("200% page scale hides evidence, control or overflows document");
          await focusControl.scrollIntoViewIfNeeded();
          await focusControl.focus();
          if (!(await focusControl.evaluate((control) => control === document.activeElement))) throw new Error("200% focus control unreachable");
          await page.keyboard.press("Enter");
          if (!(await page.locator("#selection").innerText()).includes("boundary selected")) throw new Error("200% focus operation failed");
          await page.keyboard.press("Space");
          if (!(await page.locator("#selection").innerText()).includes("not selected")) throw new Error("200% reset operation failed");
          const caption = evidence.locator("caption");
          await caption.scrollIntoViewIfNeeded();
          await caption.evaluate((element) => { element.tabIndex = -1; element.focus(); });
          if (!(await caption.evaluate((element) => element === document.activeElement && element.getBoundingClientRect().width > 0))) throw new Error("200% exact evidence caption not reachable");
          if (!(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth))) throw new Error("200% document overflow after navigation");
        }
        await cdp.detach();
        await verifyContext.close();
        const rendered = await browser.newPage();
        await rendered.goto(url);
        await rendered.locator("#renderer-status").getByText("Renderer ready").waitFor({ timeout: 20000 });
        const canvasCount = await rendered.locator("#map canvas").count();
        if (canvasCount === 0) throw new Error("Renderer ready without canvas");
        await rendered.emulateMedia({ reducedMotion: "reduce" });
        const renderedControl = rendered.getByRole("button", { name: "Focus or reset Coronel Rosales boundary" });
        if (!(await rendered.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches))) throw new Error("Reduced-motion emulation unavailable");
        const camera = () => rendered.evaluate(() => (window as Window & { __territorialRendererEvaluation?: { camera: () => { longitude: number; latitude: number; zoom: number; moving: boolean } | null } }).__territorialRendererEvaluation?.camera());
        const before = await camera();
        if (!before || before.moving) throw new Error("Initial camera not settled");
        await renderedControl.focus();
        await rendered.keyboard.press("Enter");
        await rendered.locator("#selection").getByText("boundary selected").waitFor();
        const after = await camera();
        const reducedMotionDurationMs = await rendered.evaluate(() => (window as Window & { __territorialRendererEvaluation?: { lastFocusDurationMs: () => number | undefined } }).__territorialRendererEvaluation?.lastFocusDurationMs());
        const reducedMotionCameraChanged = !!after && Math.abs(after.zoom - before.zoom) > 0.01;
        if (!reducedMotionCameraChanged || reducedMotionDurationMs !== 0 || after?.moving) throw new Error("Reduced-motion focus did not immediately move a distinct camera with zero duration");
        await rendered.waitForTimeout(300);
        const settled = await camera();
        const reducedMotionSettled = !!settled && !settled.moving && Math.abs(settled.zoom - after.zoom) < 0.000001;
        if (!reducedMotionSettled) throw new Error("Camera continued moving after reduced-motion focus");
        if (!(await rendered.locator("#renderer-status").innerText()).includes("Renderer ready")) throw new Error("Renderer status lost after reduced-motion focus");
        await rendered.keyboard.press("Space");
        if (!(await rendered.locator("#selection").innerText()).includes("not selected")) throw new Error("Reduced-motion reset unavailable");
        await rendered.close();
        console.log(JSON.stringify({ archive: { source: id, bytes, sha256, geometry: "MultiPolygon", featureCount: 1 }, renderer: { stack: "MapLibreOverlay/GeoJsonLayer", canvas: true, blankStyle: true }, fallback: { webglFailure: "map unavailable", exactTableRetained }, browser: { keyboard: true, mobile320NoOverflow: true, zoom200Method: "cdp-page-scale", zoom200EmulatedUsable: zoom200 === "verified" ? true : "unsupported", reducedMotionCameraChanged, reducedMotionDurationMs, reducedMotionSettled, visibleKeyboardFocus }, accessibility: { axeSeriousOrCritical: 0, touchTarget44: true } }));
      } else {
        const mobile = profile === "mobile";
        const context = await browser.newContext({ viewport: mobile ? { width: 320, height: 720 } : { width: 1440, height: 900 }, deviceScaleFactor: mobile ? 2 : 1, hasTouch: mobile });
        const page = await context.newPage();
        let throttling = "unthrottled";
        if (mobile) {
          const cdp = await context.newCDPSession(page);
          try {
            await cdp.send("Network.enable");
            await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 150, downloadThroughput: 1_600_000 / 8, uploadThroughput: 750_000 / 8 });
            await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
            throttling = "CDP 150ms latency, 1.6Mbps down, 0.75Mbps up, 4x CPU";
          } catch { throttling = "unsupported"; }
        }
        const started = performance.now();
        await page.goto(url);
        await page.locator("#renderer-status").getByText("Renderer ready").waitFor({ timeout: 30000 });
        const rendererReadyMs = Math.round(performance.now() - started);
        const action = performance.now();
        await page.getByRole("button", { name: "Focus or reset Coronel Rosales boundary" }).focus();
        await page.keyboard.press("Enter");
        await page.locator("#selection").getByText("boundary selected").waitFor();
        const keyboardInteractionMs = Math.round(performance.now() - action);
        const canvas = await page.locator("#map canvas").first().evaluate((node) => ({ width: (node as HTMLCanvasElement).width, height: (node as HTMLCanvasElement).height }));
        const heap = await page.evaluate(() => (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? "unsupported");
        console.log(JSON.stringify({ profile, device: mobile ? "Chromium mobile emulation, not a physical device" : "Chromium desktop, unthrottled", throttling, bundle: { rawBytes: bundle.length, gzipBytes: gzipSync(bundle).length }, rendererReadyMs, keyboardInteractionMs, canvas, featureCount: 1, heapBytes: heap }));
        await context.close();
      }
    } finally { await browser.close(); }
  } finally {
    if (server) await new Promise<void>((resolve, reject) => server!.close((error) => error ? reject(error) : resolve()));
    await rm(temp, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
