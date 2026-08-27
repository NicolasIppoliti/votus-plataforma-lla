import { createSupabaseServerClient } from "../../../../../lib/supabase/server-client";
import { authorizedFiscalizacionCoverage, type AuthorizedFiscalizacionCoverage } from "../../../../../lib/workspace/context";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const KEYS = ["election_id", "category_id", "distrito_code", "seccion_code", "opt_in"] as const;
const PRIVATE_HEADERS = { "cache-control": "private, no-store, max-age=0" };

function one(params: URLSearchParams, key: string): string | null {
  const values = params.getAll(key);
  if (values.length > 1) throw new Error("invalid request");
  return values[0] ?? null;
}

function safePayload(payload: unknown): AuthorizedFiscalizacionCoverage | null {
  if (typeof payload !== "object" || payload === null) return null;
  const value = payload as Record<string, unknown>, status = value["status"];
  if (status === "opt_in_required" || status === "source_inconsistent") return { status };
  if (status === "authorization_denied" && (typeof value["authorization_status"] === "string" || value["authorization_status"] === null)) return { status, authorization_status: value["authorization_status"] };
  if (value["source_kind"] !== "fiscalizacion" || value["is_random_sample"] !== false || value["vote_data"] !== "not_included") return null;
  if (status === "payload_too_large" && value["authorization_status"] === "authorized" && value["truncated"] === true) return { status, authorization_status: "authorized", source_kind: "fiscalizacion", is_random_sample: false, vote_data: "not_included", truncated: true };
  if (!["ok", "denominator_unavailable", "selection_invalid", "source_unavailable"].includes(status as string) || value["authorization_status"] !== "authorized" || typeof value["truncated"] !== "boolean") return null;
  const uncovered = value["uncovered"] as Record<string, unknown> | undefined, exclusions = value["exclusions"] as Record<string, unknown> | undefined;
  if (!uncovered || !exclusions) return null;
  const uncoveredItems = uncovered["items"], exclusionItems = exclusions["items"];
  if (!Number.isSafeInteger(value["observed_units"]) || (value["observed_units"] as number) < 0 || !Number.isSafeInteger(value["denominator_units"]) || (value["denominator_units"] as number) < (value["observed_units"] as number)) return null;
  if (!Array.isArray(uncoveredItems) || !Number.isSafeInteger(uncovered["total"]) || (uncovered["total"] as number) < uncoveredItems.length || uncoveredItems.length > 100 || uncovered["truncated"] !== ((uncovered["total"] as number) > 100)) return null;
  if (!Array.isArray(exclusionItems) || !Number.isSafeInteger(exclusions["total"]) || (exclusions["total"] as number) < exclusionItems.length || exclusionItems.length > 20 || exclusions["truncated"] !== ((exclusions["total"] as number) > 20)) return null;
  const cleanUncovered = uncoveredItems.map((item) => { const row = item as Record<string, unknown>; return { code: row["code"], circuito_code: row["circuito_code"], establecimiento_code: row["establecimiento_code"], establecimiento_name: row["establecimiento_name"] }; });
  const cleanExclusions = exclusionItems.map((item) => { const row = item as Record<string, unknown>; return { reason: row["reason"], rows: row["rows"] }; });
  if (cleanUncovered.some((item) => typeof item.code !== "number" || typeof item.circuito_code !== "string" || typeof item.establecimiento_code !== "string" || typeof item.establecimiento_name !== "string")) return null;
  if (cleanExclusions.some((item) => typeof item.reason !== "string" || !Number.isSafeInteger(item.rows) || (item.rows as number) < 0)) return null;
  const truncated = uncovered["truncated"] as boolean || exclusions["truncated"] as boolean;
  if (value["truncated"] !== truncated) return null;
  return { status: status as "ok" | "denominator_unavailable" | "selection_invalid" | "source_unavailable", authorization_status: "authorized", source_kind: "fiscalizacion", is_random_sample: false, vote_data: "not_included", observed_units: value["observed_units"] as number, denominator_units: value["denominator_units"] as number, uncovered: { items: cleanUncovered, total: uncovered["total"] as number, truncated: uncovered["truncated"] as boolean }, exclusions: { items: cleanExclusions, total: exclusions["total"] as number, truncated: exclusions["truncated"] as boolean }, truncated };
}

function parse(request: Request) {
  if (request.url.length > 2_048) throw new Error("invalid request");
  const params = new URL(request.url).searchParams;
  if ([...params.keys()].some((key) => !KEYS.includes(key as (typeof KEYS)[number]))) throw new Error("invalid request");
  const electionId = one(params, "election_id");
  const categoryId = one(params, "category_id");
  const distritoCode = one(params, "distrito_code");
  const seccionCode = one(params, "seccion_code");
  const optIn = one(params, "opt_in");
  if (!electionId || !UUID.test(electionId) || !categoryId || !UUID.test(categoryId) || !distritoCode || !/^\d{2}$/.test(distritoCode) || !seccionCode || !/^\d{3}$/.test(seccionCode) || (optIn !== null && optIn !== "true" && optIn !== "false")) throw new Error("invalid request");
  return { selection: { electionId, categoryId, distritoCode, seccionCode }, optIn: optIn === "true" };
}

export async function GET(request: Request): Promise<Response> {
  try {
    const { selection, optIn } = parse(request);
    const payload = safePayload(await authorizedFiscalizacionCoverage(await createSupabaseServerClient(), selection, optIn));
    if (!payload) throw new Error("unsafe coverage payload");
    return Response.json(payload, { headers: PRIVATE_HEADERS });
  } catch (error) {
    const invalid = error instanceof Error && error.message === "invalid request";
    return Response.json({ status: invalid ? "invalid_request" : "unavailable" }, { status: invalid ? 400 : 403, headers: PRIVATE_HEADERS });
  }
}
