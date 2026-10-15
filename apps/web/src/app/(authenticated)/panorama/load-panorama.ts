import { profileServerSpan } from "@/lib/workspace/profile-server";
import { loadWorkspaceSelection } from "@/lib/workspace/selection";
import { createAuthorizedOfficialFacetRepository } from "@/lib/workspace/official-facets";
import { resolveDefaultElectoralContext } from "@/lib/context/default";
import { serializeElectoralContext } from "@/lib/context/url";
import { loadAuthorizedOfficialDrilldownEvidence, type OfficialDrilldownEvidence } from "@/lib/workspace/official-drilldown-evidence";
import type { ExplorationFacetExclusion, FacetOption } from "@/lib/results/exploration";

import { loadCircuitGeometry } from "../drilldown/circuit-geometry";
import type { CircuitMapProps } from "@/components/maps/CircuitReferenceSvg";

export interface PanoramaData {
  circuitGeometry?: CircuitMapProps["geometry"] | null;
  href: string;
  evidence?: OfficialDrilldownEvidence;
  circuitOptions?: readonly FacetOption[];
  exclusions: readonly ExplorationFacetExclusion[];
}

/** Resolve the workspace default from authorized official facets. */
export function loadPanorama(): Promise<PanoramaData> {
  return profileServerSpan("panorama.load", resolvePanorama);
}

async function resolvePanorama(): Promise<PanoramaData> {
  const unavailable: PanoramaData = { href: "/drilldown", exclusions: [] };
  try {
    // Next renders pages and layouts concurrently. The layout's workspace
    // bootstrap is not a barrier for this fresh session's authorized reads.
    await loadWorkspaceSelection();
    const repository = createAuthorizedOfficialFacetRepository();
    const context = await resolveDefaultElectoralContext(repository);
    const { electionId, categoryId, distritoCode, seccionCode } = context;
    if (!electionId || !categoryId || !distritoCode || !seccionCode) return unavailable;
    const selection = { electionId, categoryId, distritoCode, seccionCode };
    const territory = await repository.facets(selection);
    const evidence = await loadAuthorizedOfficialDrilldownEvidence({ ...selection, requestedLevel: "seccion", circuitoCode: null, establecimientoCode: null, mesaCode: null });
    const query = serializeElectoralContext(context);
    query.set("level", "seccion");
    // Each facet response carries a scoped exclusion report; do not sum overlapping reads.
    // Geometry failure must not suppress authorized electoral evidence.
    const circuitGeometry = distritoCode === "02" && seccionCode === "027"
      ? await loadCircuitGeometry().catch(() => null) : null;
    return { href: `/drilldown?${query}`, evidence, circuitGeometry, circuitOptions: territory.circuitos, exclusions: territory.exclusions ?? [] };
  } catch {
    return unavailable;
  }
}
