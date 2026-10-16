import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import Page from "../(home)/page";
vi.mock("@/lib/workspace/selection", () => ({ loadWorkspaceSelection: async () => ({ status: "active" }) }));

const { facets, evidence } = vi.hoisted(() => ({ facets: vi.fn(), evidence: vi.fn() }));
vi.mock("@/lib/workspace/official-facets", () => ({ createAuthorizedOfficialFacetRepository: () => ({ facets }) }));
vi.mock("@/lib/workspace/official-drilldown-evidence", () => ({ loadAuthorizedOfficialDrilldownEvidence: evidence }));
vi.mock("../drilldown/TerritorialMapStage", () => ({ MAP_HEADING: { REFERENCE: "Referencia territorial" }, TerritorialMapStage: () => <div>Mapa neutral</div> }));
beforeEach(() => {
  facets.mockReset().mockResolvedValue({ elections: [{ id: "e2025" }], categories: [{ id: "concejales" }, { id: "diputados" }], distritos: [{ code: "02" }], secciones: [{ code: "027" }], circuitos: [], availableLevels: ["seccion"], exclusions: [] });
  evidence.mockReset().mockResolvedValue({ status: "empty" });
});
const params = { electionId: "e2025", categoryId: "concejales", distritoCode: "02", seccionCode: "027", sourceKind: "official" };
it("loads the real root page from the shared category URL, not the default", async () => {
  await Page({ searchParams: Promise.resolve(params) });
  expect(evidence).toHaveBeenCalledWith(expect.objectContaining({ electionId: params.electionId, categoryId: params.categoryId, distritoCode: "02", seccionCode: "027", requestedLevel: "seccion" }));
});
it("passes a changed category to the reachable result loader", async () => {
  evidence.mockImplementation(async ({ categoryId }: { categoryId: string }) => ({ status: "ok", result: { status: "ok", sourceKind: "official", level: "seccion", sourceGranularity: "mesa", electionYear: 2025, electionRound: "general", categoryName: categoryId, totalVotes: categoryId === "diputados" ? 321 : 123, parties: [], sourceExclusions: [] }, completeness: { status: "unavailable" }, provenance: { items: [] } }));
  const initial = renderToStaticMarkup(await Page({ searchParams: Promise.resolve(params) }));
  const changed = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ ...params, categoryId: "diputados" }) }));
  expect(evidence).toHaveBeenCalledWith(expect.objectContaining({ categoryId: "diputados" }));
  expect(initial).toContain("123");
  expect(changed).toContain("321");
  expect(changed).not.toContain("123");
  expect(changed).toContain("categoryId=diputados");
});
it("does not query evidence when the authorized facet repository refuses the selection", async () => {
  facets.mockRejectedValue(new Error("selection outside authorized facets"));
  const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve(params) }));
  expect(evidence).not.toHaveBeenCalled();
  expect(html).not.toContain("Votos positivos oficiales</dt>");
});
it.each([{ ...params, sourceKind: "fiscalizacion" }, { ...params, categoryId: ["a", "b"] }, { ...params, seccionCode: undefined }])("refuses unsupported or invalid contexts without querying official figures", async searchParams => {
  const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve(searchParams) }));
  expect(evidence).not.toHaveBeenCalled();
  expect(html).not.toContain("Votos positivos oficiales</dt>");
  expect(html).not.toContain('id="panorama-territory"');
});
