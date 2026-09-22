import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import OperationalBriefingPage from "./(authenticated)/page";

it("renders the root operational briefing with evidence and review routes", () => {
  const markup = renderToStaticMarkup(
    <OperationalBriefingPage /> as ReactElement,
  );

  expect(markup).toContain("<h1>Panel operativo</h1>");
  expect(markup).toContain("Consulte resultados, contraste elecciones y explore escenarios.");
  expect(markup).toContain("Resultados oficiales");
  expect(markup).toContain("Flujos separados");
  expect(markup).toContain("La disponibilidad depende del territorio y del acceso autorizado.");
  const hrefs = [...markup.matchAll(/href="([^"]+)"/g)].map((match) => match[1]);
  expect([...new Set(hrefs)].sort()).toEqual(["/compare", "/drilldown", "/fiscalizacion", "/municipal", "/review", "/simulate"]);
  expect(markup.indexOf("Explorar resultados")).toBeLessThan(markup.indexOf("Atención operativa"));
  expect(markup.indexOf("Comparar elecciones")).toBeLessThan(markup.indexOf("Atención operativa"));
  expect(markup).toContain('href="/review"');
  expect(markup).toContain('href="/drilldown"');
});

it("does not retain a competing dashboard entry route beside the root briefing", () => {
  const markup = renderToStaticMarkup(
    <OperationalBriefingPage /> as ReactElement,
  );

  expect(markup).not.toContain('href="/dashboard"');
});
