import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import HomePage from "./page";

it("renders a clear Votus identity and evidence-led purpose", () => {
  const markup = renderToStaticMarkup(<HomePage /> as ReactElement);

  expect(markup).toContain(
    '<main id="main-content" class="public-shell" tabindex="-1">',
  );
  expect(markup.match(/id="main-content"/g) ?? []).toHaveLength(1);
  expect(markup).toContain("<h1>Votus</h1>");
  expect(markup).toContain("Internal electoral analysis");
  expect(markup).toContain("official and public evidence");
  expect(markup).toContain("explicit source status");
});
