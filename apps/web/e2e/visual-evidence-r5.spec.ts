import { expect, test, type Page } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import type { Server } from "node:http";
import { withReviewItem } from "./authorized-review-fixture";

const pairs = [
  { name: "panorama", prototype: "panorama", route: "/" },
  { name: "exploracion", prototype: "territorial-exploration", route: "/drilldown" },
  { name: "comparacion", prototype: "temporal-comparison", route: "/compare" },
  { name: "evidencia", prototype: "evidence-quality", route: "/evidencia" },
  { name: "simulacion", prototype: "seat-simulation", route: "/simulate" },
] as const;

type Measurement = { file: string; width: number; viewportHeight: number; documentHeight: number; scrollWidth: number };
async function capture(page: Page, file: string): Promise<Measurement> {
  await page.evaluate(() => document.fonts.ready);
  const size = await page.evaluate(() => ({
    width: innerWidth, viewportHeight: innerHeight,
    documentHeight: document.documentElement.scrollHeight,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(size.scrollWidth, `${file}: horizontal overflow`).toBeLessThanOrEqual(size.width);
  await page.screenshot({ path: test.info().outputPath(file), fullPage: true, animations: "disabled" });
  return { file, ...size };
}

async function production(page: Page, route: string) {
  if (route === "/simulate") {
    await page.goto("/scenarios");
    await page.getByTestId("scenario-persistencia").getByRole("link", { name: "Editar este escenario" }).click();
    await expect(page.getByTestId("allocation-result")).toBeVisible();
  } else {
    await page.goto(route);
  }
  await expect(page).not.toHaveURL(/\/login/);
  await expect(page.locator("#main-content h1").first()).toBeVisible();
}

for (const pair of pairs) {
  for (const width of [1440, 390, 320]) {
    test(`R5 ${pair.name} approved pair at ${width}px`, async ({ page, browser }) => {
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
        await withReviewItem(page, async () => {
          await production(page, pair.route);
          measurements.push(await capture(page, `production-${pair.name}-${width}.png`));
        });
      } finally {
        await writeFile(test.info().outputPath("visual-evidence-r5-heights.json"), JSON.stringify({ pair: pair.name, route: pair.route, measurements }, null, 2));
        await reference.close();
        await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      }
    });
  }
}

// These operator surfaces have no approved prototype. Keep official mode:
// never opt into fiscalización implicitly or combine it with official figures.
for (const route of ["/municipal", "/fiscalizacion"]) {
  for (const width of [390, 320]) {
    test(`R5 production-only ${route} at ${width}px (no approved prototype)`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await withReviewItem(page, async () => {
        await production(page, route);
        const measurement = await capture(page, `production-${route.slice(1)}-${width}.png`);
        await writeFile(test.info().outputPath("visual-evidence-r5-heights.json"), JSON.stringify({ route, approvedPrototype: null, sourceKind: "official", measurements: [measurement] }, null, 2));
      });
    });
  }
}
