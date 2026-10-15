import { createAuthorizedOfficialFacetRepository } from "@/lib/workspace/official-facets";
import { resolveDefaultElectoralContext } from "@/lib/context/default";
import { parseElectoralContext, serializeElectoralContext, type ElectoralContext, type ElectoralContextSearchParams } from "@/lib/context/url";
import { loadAuthorizedOfficialDrilldownEvidence, type OfficialDrilldownEvidence } from "@/lib/workspace/official-drilldown-evidence";
import type { ExplorationFacetExclusion, FacetOption } from "@/lib/results/exploration";

import { loadCircuitGeometry } from "../drilldown/circuit-geometry";
import type { CircuitMapProps } from "@/components/maps/CircuitReferenceSvg";

export interface PanoramaData {
  circuitGeometry?: CircuitMapProps["geometry"] | null;
  href: string;
  context?: ElectoralContext;
  notice?: string;
  evidence?: OfficialDrilldownEvidence;
  circuitOptions?: readonly FacetOption[];
  exclusions: readonly ExplorationFacetExclusion[];
}

/** Read the shared URL contract; only an absent selection uses the workspace default. */
export async function loadPanorama(params: ElectoralContextSearchParams = {}): Promise<PanoramaData> {
  const unavailable: PanoramaData = { href: "/drilldown", exclusions: [] };
  const parsed = parseElectoralContext(params);
  if (parsed.status !== "ok") return { ...unavailable, notice: `Contexto inválido: ${parsed.reason}. No se muestran cifras.` };
  try {
    const repository = createAuthorizedOfficialFacetRepository();
    const context = params.electionId !== undefined ? parsed.value : { ...await resolveDefaultElectoralContext(repository), sourceKind: parsed.value.sourceKind };
    if (params.electionId !== undefined || context.electionId) unavailable.context = context;
    if (context.sourceKind !== "official") return { ...unavailable, notice: "Fiscalización: fuente no oficial. Panorama solo muestra resultados oficiales; no se combinan fuentes." };
    if (context.circuitoCode || context.establecimientoCode || context.mesaCode !== undefined) return { ...unavailable, notice: "Panorama termina en el partido. Consulte esta selección detallada en Exploración." };
    const { electionId, categoryId, distritoCode, seccionCode } = context;
    if (!electionId || !categoryId || !distritoCode || !seccionCode) return unavailable;
    const selection = { electionId, categoryId, distritoCode, seccionCode };
    const territory = await repository.facets(selection);
    // The authorized repository rejects selections outside its facet membership.
    const evidence = await loadAuthorizedOfficialDrilldownEvidence({ ...selection, requestedLevel: "seccion", circuitoCode: null, establecimientoCode: null, mesaCode: null });
    const query = serializeElectoralContext(context);
    query.set("level", "seccion");
    // Each facet response carries a scoped exclusion report; do not sum overlapping reads.
    // Geometry failure must not suppress authorized electoral evidence.
    const circuitGeometry = distritoCode === "02" && seccionCode === "027"
      ? await loadCircuitGeometry().catch(() => null) : null;
    return { context, href: `/drilldown?${query}`, evidence, circuitGeometry, circuitOptions: territory.circuitos, exclusions: territory.exclusions ?? [] };
  } catch {
    return unavailable;
  }
}
