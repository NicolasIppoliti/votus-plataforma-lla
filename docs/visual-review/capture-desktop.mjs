#!/usr/bin/env node
// Manual, opt-in capture against a local authenticated browser. Never run in CI.
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const { chromium, expect } = require("@playwright/test");
const pages = [
  ["panorama", "/", "Panorama"],
  ["exploracion", "/drilldown", "Exploración territorial"],
  ["comparacion", "/compare", "Comparación electoral"],
  ["evidencia", "/evidencia", "Evidencia y calidad de datos"],
  ["simulacion", "/simulate", /Simulación de (bancas|escenarios)/],
];
const [base, endpoint, output] = process.argv.slice(2);
const local = (value) => {
  const url = new URL(value);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.username || url.password || url.protocol !== "http:") throw new Error("Usar solamente HTTP local, sin credenciales en URL");
  return url;
};
let browser;
try {
  if (!base || !endpoint || !output) throw new Error("Uso: node docs/visual-review/capture-desktop.mjs http://localhost:3000 http://localhost:9222 docs/visual-review/artifacts/raw-nuevo");
  local(base); local(endpoint);
  await mkdir(output); // No overwrite of previous evidence.
  browser = await chromium.connectOverCDP(endpoint);
  const context = browser.contexts()[0];
  if (!context) throw new Error("Abrir una sesión local autenticada antes de capturar");
  const captures = [];
  for (const [name, route, heading] of pages) {
    const page = await context.newPage();
    try {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "dark" });
      await page.goto(new URL(route, base).href);
      await expect(page.getByRole("heading", { name: heading, exact: true, level: 1 })).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      // A human confirms loaded data/maps; a heading alone is not evidence of readiness.
      console.log(`${name}: verificar datos oficiales, mapas y secciones; reanudar en el inspector.`);
      await page.pause();
      if (new URL(page.url()).pathname !== route) throw new Error(`Ruta inesperada: ${name}`);
      const dimensions = await page.evaluate(() => ({ width: window.innerWidth, height: Math.max(document.documentElement.scrollHeight, document.body.scrollHeight) }));
      const filename = `r4-${name}-1440-full.png`;
      await page.screenshot({ path: resolve(output, filename), fullPage: true, animations: "disabled", scale: "css" });
      captures.push({ name, production: { path: filename, fullPage: true }, dimensions, prototype: { path: "PENDIENTE.png", fullPage: true } });
    } finally { await page.close(); }
  }
  await writeFile(resolve(output, "capture-manifest.json"), JSON.stringify(captures, null, 2), { flag: "wx" });
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  // Disconnect CDP; the operator owns the original browser and login session.
  if (browser) await browser.close();
}
