import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import HomePage from "./page";

it("renders exactly one keyboard-accessible sign-out submit control", () => {
  const markup = renderToStaticMarkup(<HomePage /> as ReactElement);

  expect(
    markup.match(
      /<button class="button button--secondary" type="submit">Cerrar sesión<\/button>/g,
    ) ?? [],
  ).toHaveLength(1);
  expect(markup).toMatch(
    /<form[^>]*>.*<button class="button button--secondary" type="submit">Cerrar sesión<\/button>.*<\/form>/s,
  );
});

it("renders a clear Votus identity and evidence-led purpose", () => {
  const markup = renderToStaticMarkup(<HomePage /> as ReactElement);

  expect(markup).toContain(
    '<main id="main-content" class="public-shell" tabindex="-1">',
  );
  expect(markup.match(/id="main-content"/g) ?? []).toHaveLength(1);
  expect(markup).toContain("<h1>Votus</h1>");
  expect(markup).toContain("Análisis electoral interno");
  expect(markup).toContain("evidencia oficial y pública");
  expect(markup).toContain("estado explícito de la fuente");
});
