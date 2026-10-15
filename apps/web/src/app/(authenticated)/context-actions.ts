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
    // A scoped RPC contains only matching rows. Each selector needs its parent's
    // scope, not its own value, or choosing a category removes every sibling.
    const electionScope = context.electionId ? { electionId: context.electionId } : {};
    const categoryScope = { ...electionScope, ...(context.categoryId ? { categoryId: context.categoryId } : {}) };
    const districtScope = { ...categoryScope, ...(context.distritoCode ? { distritoCode: context.distritoCode } : {}) };
    const [facets, elections, categories, districts, sections] = await Promise.all([
      repository.facets(context),
      repository.facets({}),
      repository.facets(electionScope),
      repository.facets(categoryScope),
      repository.facets(districtScope),
    ]);
    return { context, facets: { ...facets, elections: elections.elections, categories: categories.categories,
      distritos: districts.distritos, secciones: sections.secciones } };
  } catch {
    return null;
  }
}
