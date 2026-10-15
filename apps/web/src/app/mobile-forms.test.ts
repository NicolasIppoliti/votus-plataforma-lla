import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("mobile form CSS contracts (#463)", () => {
  it("stacks exploration selectors at 320px and 390px instead of halving their text space", () => {
    expect(css("./(authenticated)/drilldown/drilldown.module.css")).toMatch(/@media\s*\(max-width: 30rem\)\s*\{\s*\.filterRow\s*\{\s*grid-template-columns: minmax\(0, 1fr\);/);
  });
  it("stacks every evidence context field, not just its first field, on narrow phones", () => {
    expect(css("./(authenticated)/evidencia/evidence.module.css")).toMatch(/@media\s*\(max-width: 30rem\)\s*\{\s*\.context\s*\{\s*grid-template-columns: minmax\(0, 1fr\);/);
  });
  it("shows full wrapping selected text instead of hiding overflow on phones", () => {
    const global = css("./globals.css");
    expect(global).toMatch(/\.responsive-select > \.responsive-select__value\s*\{\s*display: none;/);
    expect(global).toMatch(/@media\s*\(max-width: 30rem\)[\s\S]*\.responsive-select > \.responsive-select__value\s*\{[^}]*display: block;[^}]*white-space: normal;[^}]*overflow-wrap: anywhere;/);
  });
  it("bounds native fields and gives mobile form actions 44px targets without clipping labels", () => {
    const global = css("./globals.css");
    expect(global).toMatch(/:where\(input, select, textarea\)\s*\{[^}]*min-width: 0;[^}]*max-width: 100%;[^}]*min-height: 2\.75rem;/);
    expect(global).toMatch(/@media\s*\(max-width: 30rem\)\s*\{\s*:is\(form, \.electoral-context\) :is\(button, input, select, textarea\)\s*\{[^}]*min-width: 2\.75rem;[^}]*min-height: 2\.75rem;/);
    expect(global).toMatch(/:is\(form, \.electoral-context\) :is\(label, legend, button\)\s*\{[^}]*white-space: normal;[^}]*overflow-wrap: anywhere;/);
  });
});
