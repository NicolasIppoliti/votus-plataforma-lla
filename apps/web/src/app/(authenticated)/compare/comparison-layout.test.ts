import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const css = readFileSync(new URL("./comparison.module.css", import.meta.url), "utf8");

it("gives every narrow selector a full row, including shared territory fields", () => {
  const mobile = css.slice(css.indexOf("/* Compact mobile comparison"));
  expect(mobile).toContain("@media (max-width: 760px)");
  expect(mobile).toMatch(/\.root :global\(\.official-compare__selector-grid\) fieldset\s*\{[^}]*grid-template-columns: minmax\(0,1fr\)/);
  expect(mobile).toMatch(/\.root :global\(\.official-compare__selector-grid\) :global\(\.official-compare__shared\)\s*\{[^}]*grid-template-columns: minmax\(0,1fr\)/);
  expect(mobile).toMatch(/\.metricSwitch\s*\{[^}]*flex-wrap: nowrap/);
  expect(mobile).toMatch(/\.metricSwitch button\s*\{[^}]*white-space: nowrap/);
  expect(mobile).toMatch(/\.spatial\s*\{[^}]*padding: 12px/);
});
