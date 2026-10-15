import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const css = readFileSync(new URL("./comparison.module.css", import.meta.url), "utf8");

it("keeps full selected labels readable through the shared responsive helper without a duplicate disclosure", () => {
  const form = readFileSync(new URL("./ComparisonSelectionForm.tsx", import.meta.url), "utf8");
  expect(form).toContain("<ResponsiveSelect");
  expect(form).not.toContain("Valores completos de la selección");
});

it("stacks comparison selectors at full width on narrow phones", () => {
  const phone = css.slice(css.indexOf("@media (max-width: 480px)"));
  expect(phone).toContain("@media (max-width: 480px)");
  for (const selector of [".root :global(.official-compare__selector-grid)", ".root :global(.official-compare__selector-grid) fieldset", ".root :global(.official-compare__selector-grid) :global(.official-compare__shared)", ".sharedRow"]) {
    expect(phone).toContain(`${selector} { grid-template-columns: minmax(0,1fr); }`);
  }
  expect(phone).toContain(".root :global(.official-compare__selection) :global(.responsive-select) { width: 100%; min-width: 0; }");
  expect(phone).toContain(".root :global(.official-compare__selection) select { width: 100%; min-width: 0; }");
});

it("pairs narrow selectors while preserving readable metric controls", () => {
  const mobile = css.slice(css.indexOf("/* Compact comparison controls"));
  expect(mobile).toContain("@media (max-width: 760px)");
  expect(mobile).toMatch(/\.root :global\(\.official-compare__selector-grid\) fieldset\s*\{[^}]*grid-template-columns: repeat\(2,minmax\(0,1fr\)\)/);
  expect(mobile).toMatch(/\.root :global\(\.official-compare__selector-grid\) :global\(\.official-compare__shared\)\s*\{[^}]*grid-template-columns: repeat\(2,minmax\(0,1fr\)\)/);
  expect(mobile).toMatch(/\.metricSwitch\s*\{[^}]*flex-wrap: nowrap/);
  expect(mobile).toMatch(/\.metricSwitch button\s*\{[^}]*white-space: nowrap/);
  expect(mobile).toMatch(/\.spatial\s*\{[^}]*padding: 12px/);
});
