"use server";

import { createAuthorizedOfficialFacetRepository } from "@/lib/workspace/official-facets";
import { resolveDefaultElectoralContext } from "@/lib/context/default";
import { parseElectoralContext } from "@/lib/context/url";

/** Every call reauthorizes against the current workspace; never cache across sessions. */
export async function loadContextOptions(query: string) {
  const parsed = parseElectoralContext(new URLSearchParams(query));
  if (parsed.status !== "ok") return null;
  try {
    const repository = createAuthorizedOfficialFacetRepository();
    const hasSelection = new URLSearchParams(query).has("electionId");
    const context = hasSelection ? parsed.value : { ...await resolveDefaultElectoralContext(repository), sourceKind: parsed.value.sourceKind };
    const facets = await repository.facets(context);
    return { context, facets };
  } catch {
    return null;
  }
}
