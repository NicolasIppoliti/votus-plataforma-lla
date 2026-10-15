import type { ExplorationFacetSelection, ExplorationFacets } from "@/lib/results/exploration";
import type { ElectoralContext } from "./url";

/** Workspace territory uses national lineage, not the provincial partido scheme. */
const WORKSPACE_TERRITORY = { distritoCode: "02", seccionCode: "027" } as const;
type FacetRepository = { facets(selection: ExplorationFacetSelection): Promise<ExplorationFacets> };

/** Only authorized official facets may supply IDs. Ambiguous or unavailable
 * defaults stay empty; never substitute a different territory or category. */
export async function resolveDefaultElectoralContext(repository: FacetRepository): Promise<ElectoralContext> {
  const empty: ElectoralContext = { sourceKind: "official" };
  try {
    const initial = await repository.facets({});
    const latestYear = Math.max(...initial.elections.map(item => item.year));
    const elections = initial.elections.filter(item => item.year === latestYear && item.round !== "paso");
    if (elections.length !== 1) return empty;
    const electionId = elections[0]!.id;
    const election = await repository.facets({ electionId });
    const categories = election.categories.filter(item => item.name === "CONCEJALES");
    if (categories.length !== 1) return empty;
    const categoryId = categories[0]!.id;
    const selection = { electionId, categoryId, ...WORKSPACE_TERRITORY };
    const territory = await repository.facets(selection);
    if (territory.distritos.filter(item => item.code === selection.distritoCode).length !== 1 || territory.secciones.filter(item => item.code === selection.seccionCode).length !== 1 || !territory.availableLevels.includes("seccion")) return empty;
    return { ...selection, sourceKind: "official" };
  } catch {
    return empty;
  }
}
