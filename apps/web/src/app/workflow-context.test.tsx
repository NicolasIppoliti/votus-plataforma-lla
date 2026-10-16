import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import OperationalBriefingPage from "./(authenticated)/(home)/page";

vi.mock("@/lib/workspace/selection", () => ({ loadWorkspaceSelection: async () => ({ status: "active" }) }));

vi.mock("@/lib/workspace/official-facets", () => ({
  createAuthorizedOfficialFacetRepository: () => ({ facets: vi.fn().mockResolvedValue({ elections: [] }) }),
}));

it("renders the current URL context on Panorama workflow links even when default evidence is unavailable", async () => {
  const page = await OperationalBriefingPage({ searchParams: Promise.resolve({
    electionId: "selected", categoryId: "chosen", distritoCode: "2", seccionCode: "27", sourceKind: "official", unrelated: "ignored",
  }) });
  const markup = renderToStaticMarkup(page);
  for (const path of ["/compare", "/simulate", "/evidencia"]) {
    expect(markup).toContain(`href="${path}?electionId=selected&amp;categoryId=chosen&amp;sourceKind=official&amp;distritoCode=02&amp;seccionCode=027"`);
  }
  expect(markup).toContain('href="/drilldown?electionId=selected&amp;categoryId=chosen&amp;sourceKind=official&amp;distritoCode=02&amp;seccionCode=027&amp;level=seccion"');
  expect(markup).not.toContain("unrelated=");
});

it("retains repeated invalid context for destination refusal instead of selecting a default", async () => {
  const page = await OperationalBriefingPage({ searchParams: Promise.resolve({ electionId: ["first", "second"], sourceKind: "official" }) });
  const markup = renderToStaticMarkup(page);
  expect(markup).toContain('href="/compare?electionId=first&amp;electionId=second&amp;sourceKind=official"');
});

it("does not turn an explicit non-official context into an official selection", async () => {
  const page = await OperationalBriefingPage({ searchParams: Promise.resolve({ electionId: "selected", sourceKind: "fiscalizacion" }) });
  const markup = renderToStaticMarkup(page);
  expect(markup).toContain('href="/compare?electionId=selected&amp;sourceKind=fiscalizacion"');
  expect(markup).not.toContain('href="/compare?electionId=selected&amp;sourceKind=official');
});
