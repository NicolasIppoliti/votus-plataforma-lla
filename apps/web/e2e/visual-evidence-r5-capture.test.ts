import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("keeps the focused skip link out of production R5 captures without touching the app", () => {
  const source = readFileSync(new URL("./visual-evidence-r5.spec.ts", import.meta.url), "utf8");
  const normalization = source.slice(source.indexOf('if (file.startsWith("production-"))'), source.indexOf("const size = await page.evaluate"));
  expect(normalization).toMatch(/querySelectorAll<HTMLElement>\("\.skip-link"\)[\s\S]*?setProperty\("visibility", "hidden", "important"\)/);
  const screenshot = source.indexOf("await page.screenshot({ path: test.info().outputPath(file)");
  expect(source.indexOf('querySelectorAll<HTMLElement>(".skip-link")')).toBeLessThan(screenshot);
  const layout = readFileSync(new URL("../src/app/layout.tsx", import.meta.url), "utf8");
  expect(layout).toContain('<a className="skip-link" href="#main-content">');
});

it("checks full selected values on Evidencia and Comparación at phone widths before their production capture", () => {
  const source = readFileSync(new URL("./visual-evidence-r5.spec.ts", import.meta.url), "utf8");
  expect(source).toContain('import { expectFullSelectedValues } from "./visual-evidence-r5-selected-values";');
  expect(source).toMatch(/if \(width <= 390 && \["\/evidencia", "\/compare"\]\.includes\(pair\.route\)\) await expectFullSelectedValues\(page\);\s*measurements\.push\(await capture\(page, `production-/);
  const helper = readFileSync(new URL("./visual-evidence-r5-selected-values.ts", import.meta.url), "utf8");
  for (const fact of ["[data-mobile-select-value]", "selectedOptions", "scrollWidth", "toBeGreaterThan(0)"]) expect(helper).toContain(fact);
});
