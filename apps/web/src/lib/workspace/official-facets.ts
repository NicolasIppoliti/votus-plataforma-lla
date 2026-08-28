import "server-only";
import type { ExplorationFacetSelection, ExplorationFacets, FacetOption } from "@/lib/results/exploration";
import { createSupabaseServerClient } from "@/lib/supabase/server-client";
import { authorizedOfficialFacets } from "@/lib/workspace/context";

export const OFFICIAL_FACETS_ERROR = { AUTHORIZATION_DENIED: "authorization_denied", UNAVAILABLE: "unavailable", MALFORMED: "malformed", NONMEMBER: "nonmember" } as const;
type OfficialFacetsErrorCode = (typeof OFFICIAL_FACETS_ERROR)[keyof typeof OFFICIAL_FACETS_ERROR];
export class AuthorizedOfficialFacetsError extends Error {
  constructor(readonly code: OfficialFacetsErrorCode) { super(`authorized official facets: ${code}`); this.name = "AuthorizedOfficialFacetsError"; }
}
interface FlatFacet { electionId: string; year: number; round: string; categoryId: string; categoryName: string;
  distritoCode: string; distrito: FacetOption; seccionCode: string; seccion: FacetOption; }
type Loader = () => Promise<unknown>;
const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const ROW_KEYS = ["category_id","category_name","distrito_code","distrito_name","distrito_name_status","distrito_name_variant_count","election_id","round","seccion_code","seccion_name","seccion_name_status","seccion_name_variant_count","year"] as const;
const record = (value: unknown): Record<string, unknown> | null => typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean { return Object.keys(value).sort().join("\0") === [...keys].sort().join("\0"); }
function text(value: unknown): string | null { return typeof value === "string" && value.length > 0 && value.trim() === value ? value : null; }
function metadata(value: Record<string, unknown>, prefix: "distrito" | "seccion"): FacetOption | null {
  const code = text(value[`${prefix}_code`]), name = value[`${prefix}_name`], status = value[`${prefix}_name_status`], count = value[`${prefix}_name_variant_count`];
  if (!code || (name !== null && !text(name)) || !Number.isSafeInteger(count) || Number(count) < 0) return null;
  if (status === "present" && typeof name === "string" && count === 1) return { code, name, nameStatus: status, nameVariantCount: count };
  if (status === "missing" && name === null && count === 0) return { code, name, nameStatus: status, nameVariantCount: count };
  if (status === "conflict" && name === null && Number(count) >= 2) return { code, name, nameStatus: status, nameVariantCount: Number(count) };
  return null;
}
function parseRows(payload: unknown): FlatFacet[] {
  const envelope = record(payload);
  if (!envelope || !exactKeys(envelope, ["status","facets","total","truncated"])) throw new AuthorizedOfficialFacetsError(OFFICIAL_FACETS_ERROR.MALFORMED);
  if (envelope["truncated"] !== false || envelope["status"] === "payload_too_large") throw new AuthorizedOfficialFacetsError(OFFICIAL_FACETS_ERROR.MALFORMED);
  if (envelope["status"] !== "ok") {
    if (typeof envelope["status"] === "string") throw new AuthorizedOfficialFacetsError(OFFICIAL_FACETS_ERROR.AUTHORIZATION_DENIED);
    throw new AuthorizedOfficialFacetsError(OFFICIAL_FACETS_ERROR.MALFORMED);
  }
  const facets = envelope["facets"], total = envelope["total"];
  if (!Array.isArray(facets) || facets.length > 200 || !Number.isSafeInteger(total) || total !== facets.length) throw new AuthorizedOfficialFacetsError(OFFICIAL_FACETS_ERROR.MALFORMED);
  const tuples = new Set<string>();
  const rows = facets.map((raw) => {
    const value = record(raw), distrito = value && metadata(value, "distrito"), seccion = value && metadata(value, "seccion");
    const electionId = value && text(value["election_id"]), categoryId = value && text(value["category_id"]), round = value && text(value["round"]), categoryName = value && text(value["category_name"]), year = value?.["year"];
    if (!value || !exactKeys(value, ROW_KEYS) || !electionId || !UUID.test(electionId) || !categoryId || !UUID.test(categoryId) || !round || !categoryName || !Number.isSafeInteger(year) || Number(year) < 0 || !distrito || !seccion) throw new AuthorizedOfficialFacetsError(OFFICIAL_FACETS_ERROR.MALFORMED);
    const tuple = [electionId, categoryId, distrito.code, seccion.code].join("\0");
    if (tuples.has(tuple)) throw new AuthorizedOfficialFacetsError(OFFICIAL_FACETS_ERROR.MALFORMED); tuples.add(tuple);
    return { electionId, year: Number(year), round, categoryId, categoryName, distritoCode: distrito.code, distrito, seccionCode: seccion.code, seccion };
  });
  unique(rows, (r) => r.electionId, (r) => [r.year,r.round]); unique(rows, (r) => r.categoryId, (r) => r.categoryName);
  unique(rows, (r) => r.distritoCode, (r) => r.distrito); unique(rows, (r) => `${r.distritoCode}/${r.seccionCode}`, (r) => r.seccion);
  return rows;
}
function unique<T>(rows: FlatFacet[], key: (row: FlatFacet) => string, project: (row: FlatFacet) => T): T[] {
  const values = new Map<string, string>(), result = new Map<string, T>();
  for (const row of rows) { const id = key(row), projected = project(row), serialized = JSON.stringify(projected); if (values.has(id) && values.get(id) !== serialized) throw new AuthorizedOfficialFacetsError(OFFICIAL_FACETS_ERROR.MALFORMED); values.set(id, serialized); result.set(id, projected); }
  return [...result.values()];
}
function member(rows: FlatFacet[], selection: ExplorationFacetSelection): void {
  if ((!selection.electionId && (selection.categoryId || selection.distritoCode || selection.seccionCode)) || (!selection.categoryId && (selection.distritoCode || selection.seccionCode)) || (!selection.distritoCode && selection.seccionCode)) throw new AuthorizedOfficialFacetsError(OFFICIAL_FACETS_ERROR.NONMEMBER);
  const chain: [unknown, (row: FlatFacet) => boolean][] = [[selection.electionId, (r) => r.electionId === selection.electionId], [selection.categoryId, (r) => r.categoryId === selection.categoryId], [selection.distritoCode, (r) => r.distritoCode === selection.distritoCode], [selection.seccionCode, (r) => r.seccionCode === selection.seccionCode]];
  let scope = rows; for (const [selected, matches] of chain) { if (selected === undefined) continue; scope = scope.filter(matches); if (scope.length === 0) throw new AuthorizedOfficialFacetsError(OFFICIAL_FACETS_ERROR.NONMEMBER); }
}
export class AuthorizedOfficialFacetRepository {
  constructor(private readonly load: Loader) {}
  async facets(selection: ExplorationFacetSelection): Promise<ExplorationFacets> {
    let rows: FlatFacet[]; try { rows = parseRows(await this.load()); } catch (error) { if (error instanceof AuthorizedOfficialFacetsError) throw error; throw new AuthorizedOfficialFacetsError(OFFICIAL_FACETS_ERROR.UNAVAILABLE); }
    member(rows, selection);
    const elections = unique(rows, (r) => r.electionId, (r) => ({ id: r.electionId, year: r.year, round: r.round, label: `${r.year} ${r.round}` }));
    const categories = selection.electionId ? unique(rows.filter((r) => r.electionId === selection.electionId), (r) => r.categoryId, (r) => ({ id: r.categoryId, name: r.categoryName })) : [];
    const districtRows = selection.electionId && selection.categoryId ? rows.filter((r) => r.electionId === selection.electionId && r.categoryId === selection.categoryId) : [];
    const distritos = unique(districtRows, (r) => r.distritoCode, (r) => r.distrito);
    const sectionRows = selection.distritoCode ? districtRows.filter((r) => r.distritoCode === selection.distritoCode) : [];
    return { elections, categories, distritos, secciones: unique(sectionRows, (r) => `${r.distritoCode}/${r.seccionCode}`, (r) => r.seccion), circuitos: [], establecimientos: [], mesas: [], availableLevels: [] };
  }
}
export function createAuthorizedOfficialFacetRepository(): AuthorizedOfficialFacetRepository {
  return new AuthorizedOfficialFacetRepository(async () => authorizedOfficialFacets(await createSupabaseServerClient()));
}
