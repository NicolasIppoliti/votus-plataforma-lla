import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const css = readFileSync(new URL("./drilldown.module.css", import.meta.url), "utf8");

// Structural guard for the override that reversed the intended desktop layout.
// Pixel geometry is verified separately by the parent's browser recapture.
it("does not replace the broad-map workbench with a locator-first narrow column", () => {
  expect(css).not.toMatch(/\.workbench:has\(> \[data-map-kind="locator"\]\)\s*\{/);
  expect(css).toContain("grid-template-columns: minmax(0, 1fr) 322px");
  expect(css).not.toMatch(/\.mapPanel\[data-map-kind="locator"\]\s*\{[^}]*max-width/);
});
