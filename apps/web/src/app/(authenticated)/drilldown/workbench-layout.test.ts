import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const css = readFileSync(new URL("./drilldown.module.css", import.meta.url), "utf8");

// Structural guards for #449: reference-only locators support a wider inspector.
// Actual geometry at each viewport is covered by the existing provenance E2E.
it("keeps locator workbenches compact beside a flexible inspector", () => {
  expect(css).toContain('.workbench:has(> [data-map-kind="locator"]) { grid-template-columns: minmax(0, 20rem) minmax(0, 1fr); align-items: start; }');
  expect(css).toContain('.mapPanel[data-map-kind="locator"] { width: 100%; max-width: 20rem; }');
  expect(css).toContain('@media (max-width: 760px) { .workbench:has(> [data-map-kind="locator"]) { grid-template-columns: minmax(0, 1fr); } }');
});

it("bounds locator canvases while leaving the broad data-map grid unchanged", () => {
  expect(css).toContain('.mapPanel[data-map-kind="locator"] .mapStage { height: 15rem; min-height: 0; }');
  expect(css).toContain('.mapPanel[data-map-kind="locator"] .mapCamera { padding: 1rem; }');
  expect(css).toContain('.mapPanel[data-map-kind="locator"] .mapCamera:has(.nationalMap) { height: auto; min-height: 0; }');
  expect(css).toContain('.mapPanel[data-map-kind="locator"] .nationalViews { grid-template-columns: minmax(0, 1fr); }');
  expect(css).toContain('.mapPanel[data-map-kind="locator"] .nationalCanvas { height: 12rem; }');
  expect(css).toContain('.mapPanel[data-map-kind="locator"] .polarMap { max-height: 12rem; }');
  expect(css).toContain('.workbench { display: grid; grid-template-columns: minmax(0, 1fr) 322px;');
});
