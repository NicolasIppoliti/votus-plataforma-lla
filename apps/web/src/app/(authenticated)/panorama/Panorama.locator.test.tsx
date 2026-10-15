import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { Panorama } from "./Panorama";

it("lets the reference locator use its shared compact dimensions without inline stage overrides", () => {
  const html = renderToStaticMarkup(<Panorama data={{ href: "/drilldown", exclusions: [] }} />);
  expect(html).toContain('data-map-kind="locator"');
  // Locator CSS already sets a 15rem stage. Inline compact dimensions would
  // enlarge it and defeat the above-the-fold layout at 1440×900.
  expect(html).not.toMatch(/style="[^"]*(?:height|min-height):280px/);
});
