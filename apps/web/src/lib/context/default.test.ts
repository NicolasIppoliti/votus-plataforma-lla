import { expect, it, vi, beforeEach } from "vitest";
import type { ExplorationFacets } from "@/lib/results/exploration";
import { resolveDefaultElectoralContext, resolveDefaultElectoralSelection } from "./default";
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

// #605: concejales live in the provincial election when it is split from the
// national one, and in the joint election otherwise. Identify the default by
// the election that carries CONCEJALES, never by guessing between elections.
function catalog(elections: { id: string; year: number; round: string; categories: string[] }[]) {
  facets.mockImplementation(async (selection) => ({
    elections: elections.map(({ id, year, round }) => ({ id, year, round, label: `${year} ${round}` })),
    categories: elections.find(item => item.id === selection.electionId)?.categories.map(name => ({ id: `${selection.electionId}-${name}`, name })) ?? [],
    distritos: [option("02")], secciones: [option("027")], circuitos: [], establecimientos: [], mesas: [], availableLevels: ["seccion"], exclusions: [],
  } satisfies ExplorationFacets));
}
const rosales = (electionId: string) => ({ electionId, categoryId: `${electionId}-CONCEJALES`, distritoCode: "02", seccionCode: "027", sourceKind: "official" });

it("picks the split provincial election that carries CONCEJALES over the national one of the same year", async () => {
  catalog([
    { id: "leg-2025", year: 2025, round: "legislativas", categories: ["DIPUTADO NACIONAL"] },
    { id: "prov-2025", year: 2025, round: "provinciales", categories: ["CONCEJALES", "DIPUTADOS PROVINCIALES"] },
    { id: "gen-2023", year: 2023, round: "generales", categories: ["PRESIDENTE Y VICE", "CONCEJALES"] },
  ]);
  expect(await resolveDefaultElectoralContext({ facets })).toEqual(rosales("prov-2025"));
});

it("picks the joint election when the provincial one is not split", async () => {
  catalog([
    { id: "gen-2027", year: 2027, round: "generales", categories: ["PRESIDENTE Y VICE", "GOBERNADOR Y VICE", "CONCEJALES"] },
    { id: "bal-2027", year: 2027, round: "balotaje", categories: ["PRESIDENTE Y VICE"] },
    { id: "prov-2025", year: 2025, round: "provinciales", categories: ["CONCEJALES"] },
  ]);
  expect(await resolveDefaultElectoralContext({ facets })).toEqual(rosales("gen-2027"));
});

it("falls back to the latest year with CONCEJALES while a split provincial election is not loaded yet", async () => {
  catalog([
    { id: "gen-2027", year: 2027, round: "generales", categories: ["PRESIDENTE Y VICE"] },
    { id: "prov-2025", year: 2025, round: "provinciales", categories: ["CONCEJALES"] },
  ]);
  expect(await resolveDefaultElectoralContext({ facets })).toEqual(rosales("prov-2025"));
});

it("never takes CONCEJALES from a PASO", async () => {
  catalog([
    { id: "paso-2025", year: 2025, round: "paso", categories: ["CONCEJALES"] },
    { id: "prov-2025", year: 2025, round: "provinciales", categories: ["CONCEJALES"] },
  ]);
  expect(await resolveDefaultElectoralContext({ facets })).toEqual(rosales("prov-2025"));
});

it("stays empty when two elections of the latest CONCEJALES year both carry CONCEJALES", async () => {
  catalog([
    { id: "a-2025", year: 2025, round: "provinciales", categories: ["CONCEJALES"] },
    { id: "b-2025", year: 2025, round: "generales", categories: ["CONCEJALES"] },
    { id: "gen-2023", year: 2023, round: "generales", categories: ["CONCEJALES"] },
  ]);
  expect(await resolveDefaultElectoralContext({ facets })).toEqual({ sourceKind: "official" });
});

it("reports why the default is empty: a choice is required only when authorized elections exist (#605)", async () => {
  catalog([
    { id: "a-2025", year: 2025, round: "provinciales", categories: ["CONCEJALES"] },
    { id: "b-2025", year: 2025, round: "generales", categories: ["CONCEJALES"] },
  ]);
  expect(await resolveDefaultElectoralSelection({ facets })).toEqual({ context: { sourceKind: "official" }, status: "selection_required" });
  catalog([{ id: "leg-2025", year: 2025, round: "legislativas", categories: ["DIPUTADO NACIONAL"] }]);
  expect(await resolveDefaultElectoralSelection({ facets })).toEqual({ context: { sourceKind: "official" }, status: "selection_required" });
  catalog([{ id: "prov-2025", year: 2025, round: "provinciales", categories: ["CONCEJALES"] }]);
  expect(await resolveDefaultElectoralSelection({ facets })).toEqual({ context: rosales("prov-2025"), status: "resolved" });
  catalog([]);
  expect(await resolveDefaultElectoralSelection({ facets })).toEqual({ context: { sourceKind: "official" }, status: "unavailable" });
  facets.mockRejectedValue(new Error("denied"));
  expect(await resolveDefaultElectoralSelection({ facets })).toEqual({ context: { sourceKind: "official" }, status: "unavailable" });
});
