import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("lets compact or short viewports scroll both shell rows away instead of covering the page", () => {
  const css = readFileSync(new URL("./globals.css", import.meta.url), "utf8");
  const compact = css.match(/@media \(max-width: 980px\), \(max-height: 600px\)\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";
  expect(compact).toMatch(/\.electoral-context\s*\{[^}]*position:\s*static/);
  expect(compact).toMatch(/\.workspace-topbar\s*\{[^}]*position:\s*static/);
  expect(compact).toContain("scroll-padding-block-start: 1rem");
});

it("retains sticky electoral context below the topbar and compensates scroll targets for both measured heights", () => {
  const css = readFileSync(new URL("./globals.css", import.meta.url), "utf8");
  const rules = [...css.matchAll(/\.electoral-context\s*\{([^}]+)\}/g)].map(match => match[1]).join("\n");
  expect(rules).toMatch(/position:\s*sticky\s*;/);
  expect(rules).toContain("top: var(--electoral-topbar-height, 4rem)");
  expect(rules).toContain("background: var(--color-surface)");
  expect(css).toContain("scroll-padding-block-start: calc(var(--electoral-topbar-height, 4rem) + var(--electoral-context-height, 0px) + 1rem)");
  const component = readFileSync(new URL("./(authenticated)/ElectoralContextBar.tsx", import.meta.url), "utf8");
  expect(component).toContain("new ResizeObserver");
  expect(component).toContain('"--electoral-context-height"');
  expect(component).toContain('"--electoral-topbar-height"');
  expect(component).toContain("observer.disconnect()");
});
