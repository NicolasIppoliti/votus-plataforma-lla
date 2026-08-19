import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server-client";
import {
  EXPLORATION_LEVEL, createResultsExplorationRepository, normalizeExplorationParams,
  type ExplorationFacetSelection, type ExplorationFacets, type ResultsExplorationRepository,
} from "./exploration";
export const SCOPE_CAPABILITY = {
  OFFICIAL: "official-exploration", COVERAGE: "coverage-scope-options",
} as const;
export type ScopeCapability = (typeof SCOPE_CAPABILITY)[keyof typeof SCOPE_CAPABILITY];
export const SCOPE_OPTIONS_MEANING = "scope-options-only" as const;
const codeSchema = z.string().min(1).max(128).refine((value) => value.trim() === value);
const rawCodeSchema = z.string().min(1).max(128);
const levelSchema = z.enum(EXPLORATION_LEVEL);
export const scopeOptionsRequestSchema = z.strictObject({
  electionId: z.uuid().optional(), categoryId: z.uuid().optional(),
  distritoCode: rawCodeSchema.optional(), seccionCode: rawCodeSchema.optional(),
  circuitoCode: rawCodeSchema.optional(), establecimientoCode: rawCodeSchema.optional(),
  mesaCode: z.number().int().nonnegative().safe().optional(), level: levelSchema.optional(),
});
export type ScopeOptionsSelection = z.infer<typeof scopeOptionsRequestSchema>;
const text = z.string().min(1).max(256);
const facetOptionSchema = z.strictObject({
  code: codeSchema, name: z.string().max(256).nullable(), nameStatus: z.enum(["present", "missing", "conflict"]),
  nameVariantCount: z.number().int().nonnegative().safe(),
});
const facetsSchema = z.strictObject({
  elections: z.array(z.strictObject({
    id: z.uuid(), year: z.number().int().nonnegative().safe(), round: text, label: text,
  })),
  categories: z.array(z.strictObject({ id: z.uuid(), name: text })),
  distritos: z.array(facetOptionSchema), secciones: z.array(facetOptionSchema),
  circuitos: z.array(facetOptionSchema), establecimientos: z.array(facetOptionSchema),
  mesas: z.array(z.strictObject({ code: z.number().int().nonnegative().safe() })),
  availableLevels: z.array(levelSchema),
});
export const scopeOptionsResponseSchema = z.strictObject({ capability: z.enum(SCOPE_CAPABILITY),
  meaning: z.literal(SCOPE_OPTIONS_MEANING), selection: scopeOptionsRequestSchema, facets: facetsSchema, });
export type ScopeOptionsResponse = z.infer<typeof scopeOptionsResponseSchema>;
type ScopeOptionsRepository = Pick<ResultsExplorationRepository, "facets">;
export interface ScopeOptionsDependencies { authenticate(): Promise<ScopeOptionsRepository | null>; }
const productionDependencies: ScopeOptionsDependencies = {
  authenticate: async () => {
    const client = await createSupabaseServerClient();
    const { data: { user }, error } = await client.auth.getUser();
    if (error) throw new Error("Authentication provider unavailable");
    return user ? createResultsExplorationRepository(client) : null;
  },
};
function errorResponse(error: "unauthorized" | "malformed_request" | "invalid_selection" | "service_unavailable", status: number): Response {
  return Response.json({ error }, { status });
}
function hasCompleteParents(selection: ScopeOptionsSelection): boolean {
  const chain: (keyof ScopeOptionsSelection)[] = [
    "electionId", "categoryId", "distritoCode", "seccionCode", "circuitoCode", "establecimientoCode", "mesaCode",
  ];
  return chain.every((key, index) => selection[key] === undefined ||
    chain.slice(0, index).every((parent) => selection[parent] !== undefined));
}
function permitsCapability(selection: ScopeOptionsSelection, capability: ScopeCapability): boolean {
  if (capability === SCOPE_CAPABILITY.COVERAGE) return [
    selection.circuitoCode, selection.establecimientoCode, selection.mesaCode, selection.level,
  ].every((value) => value === undefined);
  if (!selection.level) return true;
  const levelScope = {
    distrito: selection.distritoCode, seccion: selection.seccionCode,
    circuito: selection.circuitoCode, establecimiento: selection.establecimientoCode,
    mesa: selection.mesaCode,
  };
  return levelScope[selection.level] !== undefined;
}
function facetSelection(selection: ScopeOptionsSelection): ExplorationFacetSelection {
  return {
    ...(selection.electionId ? { electionId: selection.electionId } : {}),
    ...(selection.categoryId ? { categoryId: selection.categoryId } : {}),
    ...(selection.distritoCode ? { distritoCode: selection.distritoCode } : {}),
    ...(selection.seccionCode ? { seccionCode: selection.seccionCode } : {}),
    ...(selection.circuitoCode ? { circuitoCode: selection.circuitoCode } : {}),
    ...(selection.establecimientoCode ? { establecimientoCode: selection.establecimientoCode } : {}),
  };
}
function isMember(selection: ScopeOptionsSelection, facets: ExplorationFacets): boolean {
  if (selection.electionId && !facets.elections.some(({ id }) => id === selection.electionId)) return false;
  if (selection.categoryId && !facets.categories.some(({ id }) => id === selection.categoryId)) return false;
  const codes: [string | undefined, { code: string }[]][] = [
    [selection.distritoCode, facets.distritos], [selection.seccionCode, facets.secciones],
    [selection.circuitoCode, facets.circuitos], [selection.establecimientoCode, facets.establecimientos],
  ];
  if (codes.some(([selected, options]) => selected !== undefined &&
    !options.some(({ code }) => code === selected))) return false;
  if (selection.mesaCode !== undefined && !facets.mesas.some(({ code }) => code === selection.mesaCode)) return false;
  return selection.level === undefined || facets.availableLevels.includes(selection.level);
}
export function createScopeOptionsHandler(
  capability: ScopeCapability, dependencies: ScopeOptionsDependencies = productionDependencies,
): (request: Request) => Promise<Response> {
  return async (request) => {
    let repository: ScopeOptionsRepository | null;
    try { repository = await dependencies.authenticate(); }
    catch { return errorResponse("service_unavailable", 503); }
    if (!repository) return errorResponse("unauthorized", 401);
    if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json"))
      return errorResponse("malformed_request", 400);
    let raw: unknown;
    try { raw = await request.json(); } catch { return errorResponse("malformed_request", 400); }
    const parsed = scopeOptionsRequestSchema.safeParse(raw);
    if (!parsed.success) return errorResponse("malformed_request", 400);
    const normalized = normalizeExplorationParams({
      ...(parsed.data.distritoCode !== undefined ? { distritoCode: parsed.data.distritoCode } : {}), ...(parsed.data.seccionCode !== undefined ? { seccionCode: parsed.data.seccionCode } : {}),
      ...(parsed.data.circuitoCode !== undefined ? { circuitoCode: parsed.data.circuitoCode } : {}),
      ...(parsed.data.establecimientoCode !== undefined ? { establecimientoCode: parsed.data.establecimientoCode } : {}),
      ...(parsed.data.mesaCode !== undefined ? { mesaCode: String(parsed.data.mesaCode) } : {}),
    });
    if (normalized.status === "invalid") return errorResponse("invalid_selection", 422);
    const selection: ScopeOptionsSelection = {
      ...(parsed.data.electionId ? { electionId: parsed.data.electionId } : {}), ...(parsed.data.categoryId ? { categoryId: parsed.data.categoryId } : {}),
      ...normalized.value, ...(parsed.data.level ? { level: parsed.data.level } : {}),
    };
    if (!hasCompleteParents(selection) || !permitsCapability(selection, capability))
      return errorResponse("invalid_selection", 422);
    try {
      const facets = await repository.facets(facetSelection(selection));
      if (!isMember(selection, facets)) return errorResponse("invalid_selection", 422);
      return Response.json(scopeOptionsResponseSchema.parse({
        capability, meaning: SCOPE_OPTIONS_MEANING, selection, facets,
      }));
    } catch { return errorResponse("service_unavailable", 503); }
  };
}
