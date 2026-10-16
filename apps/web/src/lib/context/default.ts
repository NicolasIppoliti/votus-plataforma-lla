import type { ExplorationFacetSelection, ExplorationFacets } from "@/lib/results/exploration";
import type { ElectoralContext } from "./url";

/** Workspace territory uses national lineage, not the provincial partido scheme. */
const WORKSPACE_TERRITORY = { distritoCode: "02", seccionCode: "027" } as const;
const MUNICIPAL_CATEGORY = "CONCEJALES";
type FacetRepository = { facets(selection: ExplorationFacetSelection): Promise<ExplorationFacets> };

/** Why a default is empty matters to the reader: a required choice is not an outage. */
export type DefaultElectoralSelection = {
  context: ElectoralContext;
  status: "resolved" | "selection_required" | "unavailable";
};

/** Only authorized official facets may supply IDs. The default is the latest
 * non-PASO election that carries CONCEJALES: the provincial election when it is
 * split from the national one, the joint election otherwise (#605). A year whose
 * provincial election is not loaded yet falls back to the previous one. Two such
 * elections in one year, or an unavailable territory, stay empty; never pick or
 * substitute a different territory or category. */
export async function resolveDefaultElectoralSelection(repository: FacetRepository): Promise<DefaultElectoralSelection> {
  const empty: ElectoralContext = { sourceKind: "official" };
  const unavailable = { context: empty, status: "unavailable" } as const;
  const selectionRequired = { context: empty, status: "selection_required" } as const;
  try {
    const initial = await repository.facets({});
    const candidates = initial.elections.filter(item => item.round !== "paso");
    if (candidates.length === 0) return unavailable;
    const years = [...new Set(candidates.map(item => item.year))].sort((a, b) => b - a);
    for (const year of years) {
      const municipal = (await Promise.all(candidates.filter(item => item.year === year).map(async election => {
        const categories = (await repository.facets({ electionId: election.id })).categories.filter(item => item.name === MUNICIPAL_CATEGORY);
        if (categories.length > 1) throw new Error("ambiguous municipal category");
        return categories.length === 1 ? { electionId: election.id, categoryId: categories[0]!.id } : null;
      }))).filter(item => item !== null);
      if (municipal.length === 0) continue;
      if (municipal.length !== 1) return selectionRequired;
      const selection = { ...municipal[0]!, ...WORKSPACE_TERRITORY };
      const territory = await repository.facets(selection);
      if (territory.distritos.filter(item => item.code === selection.distritoCode).length !== 1 || territory.secciones.filter(item => item.code === selection.seccionCode).length !== 1 || !territory.availableLevels.includes("seccion")) return unavailable;
      return { context: { ...selection, sourceKind: "official" }, status: "resolved" };
    }
    return selectionRequired;
  } catch {
    return unavailable;
  }
}

export async function resolveDefaultElectoralContext(repository: FacetRepository): Promise<ElectoralContext> {
  return (await resolveDefaultElectoralSelection(repository)).context;
}
