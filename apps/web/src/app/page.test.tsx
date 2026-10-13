import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import OperationalBriefingPage from "./(authenticated)/page";

vi.mock("@/lib/workspace/official-facets", () => ({
  createAuthorizedOfficialFacetRepository: () => ({
    facets: vi.fn().mockResolvedValue({ elections: [] }),
  }),
}));

vi.mock("@/lib/workspace/official-drilldown-evidence", () => ({
  loadAuthorizedOfficialDrilldownEvidence: vi.fn().mockResolvedValue({ status: "authorization_denied" }),
}));

it("renders the root operational briefing with evidence and review routes", async () => {
  const markup = renderToStaticMarkup(
    await OperationalBriefingPage() as ReactElement,
  );

  expect(markup).toContain("<h1>Panorama</h1>");
  expect(markup).toContain("Una lectura del territorio. Un punto de partida para el análisis.");
  expect(markup).toContain("Resultados oficiales");
  expect(markup).toContain("Otros alcances · flujos separados");
  expect(markup).toContain("La disponibilidad depende del territorio y del acceso autorizado.");
  const hrefs = [...markup.matchAll(/href="([^"]+)"/g)].map((match) => match[1]).filter((href) => href?.startsWith("/"));
  expect([...new Set(hrefs)].sort()).toEqual(["/compare", "/drilldown", "/fiscalizacion", "/municipal", "/review", "/simulate"]);
  expect(markup.indexOf("Explorar resultados")).toBeLessThan(markup.indexOf("Atención operativa"));
  expect(markup.indexOf("Comparar elecciones")).toBeLessThan(markup.indexOf("Atención operativa"));
  expect(markup).toContain('href="/review"');
  expect(markup).toContain('href="/drilldown"');
});

it("does not retain a competing dashboard entry route beside the root briefing", async () => {
  const markup = renderToStaticMarkup(
    await OperationalBriefingPage() as ReactElement,
  );

  expect(markup).not.toContain('href="/dashboard"');
});
