import { expect, it, vi, beforeEach } from "vitest";
import type { ExplorationFacets } from "@/lib/results/exploration";
import { resolveDefaultElectoralContext } from "./default";
import { loadPanorama } from "@/app/(authenticated)/panorama/load-panorama";

const { facets, evidence } = vi.hoisted(() => ({ facets: vi.fn(), evidence: vi.fn() }));
vi.mock("@/lib/workspace/official-facets", () => ({ createAuthorizedOfficialFacetRepository: () => ({ facets }) }));
vi.mock("@/lib/workspace/official-drilldown-evidence", () => ({ loadAuthorizedOfficialDrilldownEvidence: evidence }));
const option = (code: string) => ({ code, name: null, nameStatus: "missing" as const, nameVariantCount: 0 });
function fixture(years: number[]) {
  facets.mockImplementation(async (selection) => ({
    elections: years.map(year => ({ id: `e-${year}`, year, round: year === 2025 ? "provinciales" : "generales", label: String(year) })),
    categories: selection.electionId ? [{ id: `c-${selection.electionId}`, name: "CONCEJALES" }] : [],
    distritos: [option("02")], secciones: [option("027")], circuitos: [], establecimientos: [], mesas: [], availableLevels: ["seccion"], exclusions: [],
  } satisfies ExplorationFacets));
}
beforeEach(() => { vi.resetAllMocks(); evidence.mockResolvedValue({ status: "empty" }); });
it.each([[2023], [2025], [2023, 2025]])("resolves latest authorized municipal context for %j", async (...years) => {
  fixture(years);
  const year = Math.max(...years);
  expect(await resolveDefaultElectoralContext({ facets })).toEqual({ electionId: `e-${year}`, categoryId: `c-e-${year}`, distritoCode: "02", seccionCode: "027", sourceKind: "official" });
});
it("returns empty selection on denied facets", async () => {
  facets.mockRejectedValue(new Error("denied"));
  expect(await resolveDefaultElectoralContext({ facets })).toEqual({ sourceKind: "official" });
});
it("does not pick an ambiguous latest election or missing municipal category", async () => {
  fixture([2025, 2025]);
  expect(await resolveDefaultElectoralContext({ facets })).toEqual({ sourceKind: "official" });
  fixture([2025]);
  facets.mockResolvedValue({ elections: [{ id: "e", year: 2025, round: "provinciales" }], categories: [], distritos: [], secciones: [] });
  expect(await resolveDefaultElectoralContext({ facets })).toEqual({ sourceKind: "official" });
});
it("reaches the municipal default through the real Panorama loader", async () => {
  fixture([2023, 2025]);
  const data = await loadPanorama();
  expect(evidence).toHaveBeenCalledWith(expect.objectContaining({ electionId: "e-2025", categoryId: "c-e-2025", distritoCode: "02", seccionCode: "027", requestedLevel: "seccion" }));
  expect(data.href).toContain("sourceKind=official");
});
it("Panorama does not load evidence for unauthorized territory", async () => {
  fixture([2025]);
  facets.mockRejectedValue(new Error("denied"));
  expect(await loadPanorama()).toEqual({ href: "/drilldown", exclusions: [] });
  expect(evidence).not.toHaveBeenCalled();
});
