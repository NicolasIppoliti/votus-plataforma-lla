import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import Page from "./page";

const mocks = vi.hoisted(() => ({ facets: vi.fn(), evidence: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/workspace/profile-server", () => ({ profileServerSpan: (_name: string, operation: () => unknown) => operation() }));
vi.mock("@/lib/workspace/official-facets", () => ({ createAuthorizedOfficialFacetRepository: () => ({ facets: mocks.facets }) }));
vi.mock("@/lib/workspace/official-drilldown-evidence", () => ({ loadAuthorizedOfficialDrilldownEvidence: mocks.evidence }));
vi.mock("../drilldown/circuit-geometry", () => ({ loadCircuitGeometry: async () => null }));
vi.mock("../WorkspacePresentation", () => ({ ReviewAttention: () => null }));
vi.mock("../drilldown/TerritorialMapStage", () => ({ TerritorialMapStage: () => <div>Mapa de referencia</div> }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.facets.mockResolvedValue({ circuitos: [], exclusions: [] });
  mocks.evidence.mockImplementation(async ({ categoryId }: { categoryId: string }) => ({
    status: "ok",
    result: {
      status: "ok", sourceKind: "official", level: "seccion", sourceGranularity: "mesa",
      electionYear: 2023, electionRound: "general", categoryName: categoryId,
      totalVotes: categoryId === "president" ? 11111 : 7777,
      mesaCount: 1, archiveEntryIds: [], sourceAudit: [], sourceExclusions: [], parties: [],
    },
    provenance: { items: [], sourceExclusions: [] }, reference: { items: [], sourceExclusions: [] },
    schools: { status: "unavailable", exclusions: [], sourceExclusions: [] },
    completeness: { status: "unavailable" },
  }));
});

it("reads fresh category-specific figures through the real page and loader while retaining Rosales", async () => {
  const params = { electionId: "e2023", categoryId: "president", distritoCode: "02", seccionCode: "027", sourceKind: "official" };
  const before = renderToStaticMarkup(await Page({ searchParams: Promise.resolve(params) }));
  const after = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ ...params, categoryId: "deputy" }) }));
  expect(before).toContain("<dd>11.111</dd>");
  expect(after).toContain("<dd>7.777</dd>");
  expect(after).not.toContain("<dd>11.111</dd>");
  expect(after).toContain("categoryId=deputy");
  expect(after).toContain("Coronel Rosales");
  for (const categoryId of ["president", "deputy"]) {
    expect(mocks.facets).toHaveBeenCalledWith({ electionId: "e2023", categoryId, distritoCode: "02", seccionCode: "027" });
    expect(mocks.evidence).toHaveBeenCalledWith({ electionId: "e2023", categoryId, distritoCode: "02", seccionCode: "027", requestedLevel: "seccion", circuitoCode: null, establecimientoCode: null, mesaCode: null });
  }
});
