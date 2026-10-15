import { profileServerSpan } from "@/lib/workspace/profile-server";
import { createAuthorizedOfficialFacetRepository } from "@/lib/workspace/official-facets";
import { loadAuthorizedOfficialDrilldownEvidence, type OfficialDrilldownEvidence } from "@/lib/workspace/official-drilldown-evidence";
import type { ExplorationFacetExclusion, FacetOption } from "@/lib/results/exploration";

export interface PanoramaData {
  href: string;
  evidence?: OfficialDrilldownEvidence;
  circuitOptions?: readonly FacetOption[];
  exclusions: readonly ExplorationFacetExclusion[];
}

/** Resolve the approved scope, never the first available election or category. */
export function loadPanorama(): Promise<PanoramaData> {
  return profileServerSpan("panorama.load", resolvePanorama);
}

async function resolvePanorama(): Promise<PanoramaData> {
  const unavailable: PanoramaData = { href: "/drilldown", exclusions: [] };
  try {
    const repository = createAuthorizedOfficialFacetRepository();
    const initial = await repository.facets({});
    const elections = initial.elections.filter(item => item.year === 2025 && item.round === "legislativas");
    if (elections.length !== 1) return unavailable;
    const electionId = elections[0]!.id;
    const election = await repository.facets({ electionId });
    const categories = election.categories.filter(item => item.name === "DIPUTADO NACIONAL");
    if (categories.length !== 1) return unavailable;
    const categoryId = categories[0]!.id;
    const selection = { electionId, categoryId, distritoCode: "02", seccionCode: "027" };
    const territory = await repository.facets(selection);
    if (territory.distritos.filter(item => item.code === "02").length !== 1 || territory.secciones.filter(item => item.code === "027").length !== 1 || !territory.availableLevels.includes("seccion")) return unavailable;
    const evidence = await loadAuthorizedOfficialDrilldownEvidence({ ...selection, requestedLevel: "seccion", circuitoCode: null, establecimientoCode: null, mesaCode: null });
    const query = new URLSearchParams({ ...selection, level: "seccion" });
    // Each facet response carries a scoped exclusion report; do not sum overlapping reads.
    return { href: `/drilldown?${query}`, evidence, circuitOptions: territory.circuitos, exclusions: territory.exclusions ?? [] };
  } catch {
    return unavailable;
  }
}
