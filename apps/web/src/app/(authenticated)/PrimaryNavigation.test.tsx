import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { PrimaryNavigation } from "./PrimaryNavigation";

const navigation = vi.hoisted(() => ({ query: "" }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/drilldown",
  useSearchParams: () => new URLSearchParams(navigation.query),
}));

it("carries the exact exploration context into Comparison without route-local filters", () => {
  navigation.query = "electionId=e25&categoryId=c25&sourceKind=official&distritoCode=2&seccionCode=27&circuitoCode=248&establecimientoCode=school&mesaCode=7&level=mesa&search=local&bElectionId=e23&bCategoryId=c23";
  const markup = renderToStaticMarkup(<PrimaryNavigation />);
  const href = [...markup.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/g)].find(match => match[2]?.includes("<span>Comparación</span>"))?.[1];
  expect(href).toBe("/compare?electionId=e25&amp;categoryId=c25&amp;sourceKind=official&amp;distritoCode=02&amp;seccionCode=027&amp;circuitoCode=00248&amp;establecimientoCode=school&amp;mesaCode=7&amp;bElectionId=e23&amp;bCategoryId=c23");
});

it.each([
  ["", "/drilldown"],
  ["electionId=e25&seccionCode=027&distritoCode=02&level=mesa", "/drilldown?electionId=e25&amp;sourceKind=official&amp;distritoCode=02&amp;seccionCode=027&amp;level=seccion"],
  ["distritoCode=02&seccionCode=027&circuitoCode=00248", "/drilldown?sourceKind=official&amp;distritoCode=02&amp;seccionCode=027&amp;circuitoCode=00248&amp;level=circuito"],
  ["distritoCode=02&seccionCode=027&circuitoCode=00248&establecimientoCode=school", "/drilldown?sourceKind=official&amp;distritoCode=02&amp;seccionCode=027&amp;circuitoCode=00248&amp;establecimientoCode=school&amp;level=establecimiento"],
  ["sourceKind=unknown&electionId=a&electionId=b&local=ignored", "/drilldown?electionId=a&amp;electionId=b&amp;sourceKind=unknown"],
])("renders a reachable exploration link without inventing selection (%s)", (query, href) => {
  navigation.query = query;
  expect(renderToStaticMarkup(<PrimaryNavigation />)).toContain(`href="${href}"`);
});

it("keeps fiscalización explicit and leaves unrelated workflows alone", () => {
  navigation.query = "electionId=e25&sourceKind=fiscalizacion&distritoCode=02&seccionCode=027";
  const markup = renderToStaticMarkup(<PrimaryNavigation />);
  expect(markup).toContain('href="/compare?electionId=e25&amp;sourceKind=fiscalizacion&amp;distritoCode=02&amp;seccionCode=027"');
  for (const path of ["/review", "/scenarios", "/municipal", "/fiscalizacion", "/evidencia"]) expect(markup).toContain(`href="${path}"`);
});
