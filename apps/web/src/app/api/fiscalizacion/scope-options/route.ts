import { normalizeExplorationParams, type ExplorationFacetSelection } from "@/lib/results/exploration";
import { SCOPE_CAPABILITY, SCOPE_OPTIONS_MEANING, scopeOptionsRequestSchema, scopeOptionsResponseSchema, type ScopeOptionsSelection } from "@/lib/results/scope-selector";
import { AuthorizedOfficialFacetsError, OFFICIAL_FACETS_ERROR, createAuthorizedOfficialFacetRepository } from "@/lib/workspace/official-facets";

const PRIVATE_HEADERS = { "cache-control": "private, no-store, max-age=0" };
function errorResponse(error: string, status: number): Response { return Response.json({ error }, { status, headers: PRIVATE_HEADERS }); }
function complete(selection: ScopeOptionsSelection): boolean {
  if ([selection.circuitoCode, selection.establecimientoCode, selection.mesaCode, selection.level].some((value) => value !== undefined)) return false;
  return (!selection.categoryId || Boolean(selection.electionId)) && (!selection.distritoCode || Boolean(selection.categoryId)) && (!selection.seccionCode || Boolean(selection.distritoCode));
}
export async function POST(request: Request): Promise<Response> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return errorResponse("malformed_request", 400);
  let raw: unknown; try { raw = await request.json(); } catch { return errorResponse("malformed_request", 400); }
  const parsed = scopeOptionsRequestSchema.safeParse(raw); if (!parsed.success) return errorResponse("malformed_request", 400);
  const normalized = normalizeExplorationParams({ ...(parsed.data.distritoCode !== undefined ? { distritoCode: parsed.data.distritoCode } : {}), ...(parsed.data.seccionCode !== undefined ? { seccionCode: parsed.data.seccionCode } : {}) });
  if (normalized.status === "invalid") return errorResponse("invalid_selection", 422);
  const selection: ScopeOptionsSelection = { ...(parsed.data.electionId ? { electionId: parsed.data.electionId } : {}), ...(parsed.data.categoryId ? { categoryId: parsed.data.categoryId } : {}), ...normalized.value };
  if (!complete({ ...parsed.data, ...selection })) return errorResponse("invalid_selection", 422);
  const facetSelection: ExplorationFacetSelection = { ...(selection.electionId ? { electionId: selection.electionId } : {}), ...(selection.categoryId ? { categoryId: selection.categoryId } : {}), ...(selection.distritoCode ? { distritoCode: selection.distritoCode } : {}), ...(selection.seccionCode ? { seccionCode: selection.seccionCode } : {}) };
  try {
    const facets = await createAuthorizedOfficialFacetRepository().facets(facetSelection);
    return Response.json(scopeOptionsResponseSchema.parse({ capability: SCOPE_CAPABILITY.COVERAGE, meaning: SCOPE_OPTIONS_MEANING, selection, facets }), { headers: PRIVATE_HEADERS });
  } catch (error) {
    if (error instanceof AuthorizedOfficialFacetsError && error.code === OFFICIAL_FACETS_ERROR.NONMEMBER) return errorResponse("invalid_selection", 422);
    if (error instanceof AuthorizedOfficialFacetsError && error.code === OFFICIAL_FACETS_ERROR.AUTHORIZATION_DENIED) return errorResponse("authorization_denied", 403);
    return errorResponse("unavailable", 503);
  }
}
