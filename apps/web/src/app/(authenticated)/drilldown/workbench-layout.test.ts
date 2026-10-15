import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const css = readFileSync(new URL("./drilldown.module.css", import.meta.url), "utf8");

// Structural guard for the override that reversed the intended desktop layout.
// Pixel geometry is verified separately by the parent's browser recapture.
it("does not replace the broad-map workbench with a locator-first narrow column", () => {
  expect(css).not.toMatch(/\.workbench:has\(> \[data-map-kind="locator"\]\)\s*\{/);
  expect(css).toContain("grid-template-columns: minmax(0, 1fr) 322px");
});

it("caps the locator reference column at 320px including borders without narrowing data maps", () => {
  expect(css).toMatch(/\.mapPanel\[data-map-kind="locator"\]\s*\{[^}]*box-sizing: border-box;[^}]*width: 100%;[^}]*max-width: 320px;/);
});
