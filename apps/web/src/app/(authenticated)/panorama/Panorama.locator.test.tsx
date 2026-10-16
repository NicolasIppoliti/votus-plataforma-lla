import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { Panorama } from "./Panorama";

it("bounds the circuit overview drawing independently of its full evidence legend", () => {
  const css = readFileSync(new URL("./panorama.module.css", import.meta.url), "utf8");
  const drawing = css.match(/\.circuitMap > svg\s*\{([^}]+)\}/)?.[1];
  expect(drawing).toMatch(/height:\s*180px/);
  expect(drawing).toMatch(/display:\s*block/);
});

it("bounds the reference stage within Panorama without resizing Exploration", () => {
  const css = readFileSync(new URL("./panorama.module.css", import.meta.url), "utf8");
  const stage = css.match(/\.map > section\[data-map-kind="locator"\] > div\s*\{([^}]+)\}/)?.[1];
  // Leave room for the authorized organization header and review notice too.
  expect(stage).toMatch(/height:\s*120px/);
  expect(stage).toMatch(/min-height:\s*0/);
});

it("lets the reference locator use its shared compact dimensions without inline stage overrides", () => {
  const html = renderToStaticMarkup(<Panorama data={{ href: "/drilldown", exclusions: [] }} />);
  expect(html).toContain('data-map-kind="locator"');
  // Locator CSS already sets a 15rem stage. Inline compact dimensions would
  // enlarge it and defeat the above-the-fold layout at 1440×900.
  expect(html).not.toMatch(/style="[^"]*(?:height|min-height):280px/);
});
