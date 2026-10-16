import { resolveDefaultElectoralContext } from "@/lib/context/default";
import { parseElectoralContext, type ElectoralContextSearchParams } from "@/lib/context/url";
import { createAuthorizedOfficialFacetRepository } from "@/lib/workspace/official-facets";

/** What the shared electoral context means for the official 2025 base (#613):
 * the base represents 2025 provinciales · CONCEJALES · 02/027 (JEBA definitivo).
 * "matches" loads it on its own; "other" says which base exists; "unavailable"
 * (the context cannot be verified) keeps the editor as it was. */
export type OfficialBaseContext = "matches" | "other" | "unavailable";

export async function officialBaseContext(params: ElectoralContextSearchParams): Promise<OfficialBaseContext> {
  try {
    const parsed = parseElectoralContext(params);
    if (parsed.status !== "ok") return "unavailable";
    const repository = createAuthorizedOfficialFacetRepository();
    const context = parsed.value.electionId ? parsed.value : await resolveDefaultElectoralContext(repository);
    if (!context.electionId || !context.categoryId) return "unavailable";
    if (context.sourceKind !== "official" || context.distritoCode !== "02" || context.seccionCode !== "027") return "other";
    const election = (await repository.facets({})).elections.find(item => item.id === context.electionId);
    const category = (await repository.facets({ electionId: context.electionId })).categories.find(item => item.id === context.categoryId);
    if (!election || !category) return "unavailable";
    return election.year === 2025 && election.round !== "paso" && category.name === "CONCEJALES" ? "matches" : "other";
  } catch {
    return "unavailable";
  }
}
