import { createSupabaseServerClient } from "../../../../../lib/supabase/server-client";
import { authorizedFiscalizacionResult, FISCAL_RESULT_STATUS, type AuthorizedFiscalizacionResult } from "../../../../../lib/workspace/context";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const KEYS = ["election_id", "category_id", "distrito_code", "seccion_code", "opt_in"] as const;
const PRIVATE_HEADERS = { "cache-control": "private, no-store, max-age=0" };
interface Selection { electionId: string; categoryId: string; distritoCode: string; seccionCode: string }
interface SafeCollection<T> { items: T[]; total: number; truncated: boolean }

function record(value: unknown): Record<string, unknown> | null { return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null; }
function integer(value: unknown): value is number { return Number.isSafeInteger(value) && (value as number) >= 0; }
function nullableString(value: unknown): value is string | null { return value === null || typeof value === "string"; }
function one(params: URLSearchParams, key: string): string | null { const values = params.getAll(key); if (values.length > 1) throw new Error("invalid request"); return values[0] ?? null; }
function collection<T>(value: unknown, limit: number, clean: (item: Record<string, unknown>) => T | null): SafeCollection<T> | null {
  const source = record(value), raw = source?.["items"];
  if (!source || !Array.isArray(raw) || !integer(source["total"]) || typeof source["truncated"] !== "boolean") return null;
  const total = source["total"] as number, items = raw.map((item) => record(item)).map((item) => item && clean(item));
  if (items.some((item) => item === null) || raw.length !== Math.min(total, limit) || source["truncated"] !== (total > limit)) return null;
  return { items: items as T[], total, truncated: source["truncated"] as boolean };
}

function safePayload(payload: unknown, selection: Selection): AuthorizedFiscalizacionResult | null {
  const value = record(payload), status = value?.["status"];
  if (!value || typeof status !== "string") return null;
  if (status === FISCAL_RESULT_STATUS.OPT_IN_REQUIRED) return { status };
  if (status === FISCAL_RESULT_STATUS.SOURCE_INCONSISTENT) { const exclusions = collection(value["exclusions"], 20, (row) => typeof row["reason"] === "string" && integer(row["rows"]) ? { reason: row["reason"], rows: row["rows"] } : null); return exclusions ? { status, exclusions } : null; }
  if (status === FISCAL_RESULT_STATUS.AUTHORIZATION_DENIED && nullableString(value["authorization_status"])) return { status, authorization_status: value["authorization_status"] };
  if (value["source_kind"] !== "fiscalizacion" || value["is_random_sample"] !== false || value["authorization_status"] !== "authorized") return null;
  if (status === FISCAL_RESULT_STATUS.PAYLOAD_TOO_LARGE && value["truncated"] === true) return { status, authorization_status: "authorized", source_kind: "fiscalizacion", is_random_sample: false, truncated: true };
  if (status !== FISCAL_RESULT_STATUS.OK && status !== FISCAL_RESULT_STATUS.NO_ROWS) return null;
  const ref = record(value["reference"]);
  if (!ref || !integer(ref["denominator_units"]) || !nullableString(ref["election_round"]) || !nullableString(ref["category_name"]) || !(ref["election_year"] === null || integer(ref["election_year"])) || ref["distrito_code"] !== selection.distritoCode || ref["seccion_code"] !== selection.seccionCode) return null;
  const rows = collection(value["rows"], 100, (row) => nullableString(row["list_id"]) && nullableString(row["canonical_party_id"]) && nullableString(row["party_name"]) && typeof row["granularity"] === "string" && integer(row["votes"]) && integer(row["rows"]) && ((row["canonical_party_id"] === null) === (row["party_name"] === null)) ? { list_id: row["list_id"], canonical_party_id: row["canonical_party_id"], party_name: row["party_name"], granularity: row["granularity"], votes: row["votes"], rows: row["rows"] } : null);
  const unmapped = collection(value["unmapped"], 100, (row) => nullableString(row["list_id"]) && integer(row["votes"]) && integer(row["rows"]) ? { list_id: row["list_id"], votes: row["votes"], rows: row["rows"] } : null);
  const exclusions = collection(value["exclusions"], 20, (row) => typeof row["reason"] === "string" && integer(row["rows"]) ? { reason: row["reason"], rows: row["rows"] } : null);
  const provenance = collection(value["provenance"], 100, (row) => typeof row["id"] === "string" && (row["sha256"] === null || typeof row["sha256"] === "string" && /^[0-9a-f]{64}$/.test(row["sha256"])) && typeof row["fetched_at"] === "string" && (row["status"] === "ok" || row["status"] === "error") ? { id: row["id"], sha256: row["sha256"], fetched_at: row["fetched_at"], status: row["status"] } : null);
  if (!rows || !unmapped || !exclusions || !provenance) return null;
  if (new Set(rows.items.map((row) => row["granularity"])).size > 1 || (status === FISCAL_RESULT_STATUS.NO_ROWS && (rows.total !== 0 || unmapped.total !== 0 || provenance.total !== 0))) return null;
  const truncated = rows.truncated || unmapped.truncated || exclusions.truncated || provenance.truncated;
  if (value["truncated"] !== truncated) return null;
  const clean = { status, authorization_status: "authorized" as const, source_kind: "fiscalizacion" as const, is_random_sample: false as const, reference: { election_year: ref["election_year"] as number | null, election_round: ref["election_round"], category_name: ref["category_name"], distrito_code: selection.distritoCode, seccion_code: selection.seccionCode, denominator_units: ref["denominator_units"] as number }, rows, unmapped, exclusions, provenance, truncated };
  return JSON.stringify(clean).length <= 120_000 ? clean as AuthorizedFiscalizacionResult : null;
}

function parse(request: Request): { selection: Selection; optIn: boolean } {
  if (request.url.length > 2_048) throw new Error("invalid request"); const params = new URL(request.url).searchParams;
  if ([...params.keys()].some((key) => !KEYS.includes(key as (typeof KEYS)[number]))) throw new Error("invalid request");
  const electionId = one(params, "election_id"), categoryId = one(params, "category_id"), distritoCode = one(params, "distrito_code"), seccionCode = one(params, "seccion_code"), optIn = one(params, "opt_in");
  if (!electionId || !UUID.test(electionId) || !categoryId || !UUID.test(categoryId) || !distritoCode || !/^\d{2}$/.test(distritoCode) || !seccionCode || !/^\d{3}$/.test(seccionCode) || (optIn !== null && optIn !== "true" && optIn !== "false")) throw new Error("invalid request");
  return { selection: { electionId, categoryId, distritoCode, seccionCode }, optIn: optIn === "true" };
}

export async function GET(request: Request): Promise<Response> {
  try { const { selection, optIn } = parse(request); const payload = safePayload(await authorizedFiscalizacionResult(await createSupabaseServerClient(), selection, optIn), selection); if (!payload) throw new Error("unsafe result payload"); return Response.json(payload, { headers: PRIVATE_HEADERS }); }
  catch (error) { const invalid = error instanceof Error && error.message === "invalid request"; return Response.json({ status: invalid ? "invalid_request" : "unavailable" }, { status: invalid ? 400 : 403, headers: PRIVATE_HEADERS }); }
}
