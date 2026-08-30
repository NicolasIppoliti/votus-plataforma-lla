import "server-only";

import { normalizeExplorationParams } from "@/lib/results/exploration";
import { createSupabaseServerClient } from "@/lib/supabase/server-client";
import { authorizedFiscalizacionCoverage, authorizedFiscalizacionResult, FISCAL_RESULT_STATUS, type AuthorizedFiscalizacionCoverage, type AuthorizedFiscalizacionResult } from "@/lib/workspace/context";

const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const EVIDENCE_QUERY_KEYS = ["election_id", "category_id", "distrito_code", "seccion_code", "opt_in"] as const;

export interface FiscalizacionEvidenceSelection { electionId: string; categoryId: string; distritoCode: string; seccionCode: string }
export interface FiscalizacionEvidenceRequest { selection: FiscalizacionEvidenceSelection; optIn: boolean }
interface SafeCollection<T> { items: T[]; total: number; truncated: boolean }

function oneQueryValue(params: URLSearchParams, key: string): string | null {
  const values = params.getAll(key);
  if (values.length > 1) throw new Error("invalid request");
  return values[0] ?? null;
}

export function normalizeFiscalizacionEvidenceRequest(request: Request): FiscalizacionEvidenceRequest {
  if (request.url.length > 2_048) throw new Error("invalid request");
  const params = new URL(request.url).searchParams;
  if ([...params.keys()].some((key) => !EVIDENCE_QUERY_KEYS.includes(key as (typeof EVIDENCE_QUERY_KEYS)[number]))) throw new Error("invalid request");
  const electionId = oneQueryValue(params, "election_id");
  const categoryId = oneQueryValue(params, "category_id");
  const rawDistritoCode = oneQueryValue(params, "distrito_code");
  const rawSeccionCode = oneQueryValue(params, "seccion_code");
  const optIn = oneQueryValue(params, "opt_in");
  const normalized = normalizeExplorationParams({
    ...(rawDistritoCode !== null ? { distritoCode: rawDistritoCode } : {}),
    ...(rawSeccionCode !== null ? { seccionCode: rawSeccionCode } : {}),
  });
  if (!electionId || !CANONICAL_UUID.test(electionId) || !categoryId || !CANONICAL_UUID.test(categoryId) || normalized.status === "invalid" || !normalized.value.distritoCode || !normalized.value.seccionCode || (optIn !== null && optIn !== "true" && optIn !== "false")) throw new Error("invalid request");
  return {
    selection: {
      electionId,
      categoryId,
      distritoCode: normalized.value.distritoCode,
      seccionCode: normalized.value.seccionCode,
    },
    optIn: optIn === "true",
  };
}

const record = (value: unknown): Record<string, unknown> | null => typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
const integer = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const nullableString = (value: unknown): value is string | null => value === null || typeof value === "string";

function collection<T>(value: unknown, limit: number, clean: (item: Record<string, unknown>) => T | null): SafeCollection<T> | null {
  const source = record(value), raw = source?.["items"];
  if (!source || !Array.isArray(raw) || !integer(source["total"]) || typeof source["truncated"] !== "boolean") return null;
  const total = source["total"] as number, items = raw.map(record).map((item) => item && clean(item));
  if (items.some((item) => item === null) || raw.length !== Math.min(total, limit) || source["truncated"] !== (total > limit)) return null;
  return { items: items as T[], total, truncated: source["truncated"] as boolean };
}

export function sanitizeFiscalizacionCoverage(payload: unknown): AuthorizedFiscalizacionCoverage | null {
  const value = record(payload), status = value?.["status"];
  if (!value) return null;
  if (status === "opt_in_required") return { status };
  if (status === "source_inconsistent") {
    if (!("exclusions" in value)) return null;
    const exclusions = collection(value["exclusions"], 20, (row) => typeof row["reason"] === "string" && integer(row["rows"]) ? { reason: row["reason"], rows: row["rows"] } : null);
    return exclusions ? { status, exclusions } : null;
  }
  if (status === "authorization_denied" && nullableString(value["authorization_status"])) return { status, authorization_status: value["authorization_status"] };
  if (value["source_kind"] !== "fiscalizacion" || value["is_random_sample"] !== false || value["vote_data"] !== "not_included") return null;
  if (status === "payload_too_large" && value["authorization_status"] === "authorized" && value["truncated"] === true) return { status, authorization_status: "authorized", source_kind: "fiscalizacion", is_random_sample: false, vote_data: "not_included", truncated: true };
  if (!["ok", "denominator_unavailable", "selection_invalid", "source_unavailable"].includes(status as string) || value["authorization_status"] !== "authorized" || typeof value["truncated"] !== "boolean" || !integer(value["observed_units"]) || !integer(value["denominator_units"]) || value["denominator_units"] < value["observed_units"]) return null;
  const uncovered = collection(value["uncovered"], 100, (row) => typeof row["code"] === "number" && typeof row["circuito_code"] === "string" && typeof row["establecimiento_code"] === "string" && typeof row["establecimiento_name"] === "string" ? { code: row["code"], circuito_code: row["circuito_code"], establecimiento_code: row["establecimiento_code"], establecimiento_name: row["establecimiento_name"] } : null);
  const exclusions = collection(value["exclusions"], 20, (row) => typeof row["reason"] === "string" && integer(row["rows"]) ? { reason: row["reason"], rows: row["rows"] } : null);
  if (!uncovered || !exclusions || value["truncated"] !== (uncovered.truncated || exclusions.truncated)) return null;
  return { status: status as Extract<AuthorizedFiscalizacionCoverage, { observed_units: number }>["status"], authorization_status: "authorized", source_kind: "fiscalizacion", is_random_sample: false, vote_data: "not_included", observed_units: value["observed_units"], denominator_units: value["denominator_units"], uncovered, exclusions, truncated: value["truncated"] };
}

export function sanitizeFiscalizacionResult(payload: unknown, selection: FiscalizacionEvidenceSelection): AuthorizedFiscalizacionResult | null {
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
  if (!rows || !unmapped || !exclusions || !provenance || new Set(rows.items.map((row) => row.granularity)).size > 1 || (status === FISCAL_RESULT_STATUS.NO_ROWS && (rows.total !== 0 || unmapped.total !== 0 || provenance.total !== 0))) return null;
  const truncated = rows.truncated || unmapped.truncated || exclusions.truncated || provenance.truncated;
  if (value["truncated"] !== truncated) return null;
  const clean = { status, authorization_status: "authorized" as const, source_kind: "fiscalizacion" as const, is_random_sample: false as const, reference: { election_year: ref["election_year"] as number | null, election_round: ref["election_round"], category_name: ref["category_name"], distrito_code: selection.distritoCode, seccion_code: selection.seccionCode, denominator_units: ref["denominator_units"] as number }, rows, unmapped, exclusions, provenance, truncated };
  return JSON.stringify(clean).length <= 120_000 ? clean as AuthorizedFiscalizacionResult : null;
}

export async function loadSafeFiscalizacionCoverage(selection: FiscalizacionEvidenceSelection, optIn: boolean): Promise<AuthorizedFiscalizacionCoverage> {
  const safe = sanitizeFiscalizacionCoverage(await authorizedFiscalizacionCoverage(await createSupabaseServerClient(), selection, optIn));
  if (!safe) throw new Error("Unsafe fiscalizacion coverage payload");
  return safe;
}
export async function loadSafeFiscalizacionResult(selection: FiscalizacionEvidenceSelection, optIn: boolean): Promise<AuthorizedFiscalizacionResult> {
  const safe = sanitizeFiscalizacionResult(await authorizedFiscalizacionResult(await createSupabaseServerClient(), selection, optIn), selection);
  if (!safe) throw new Error("Unsafe fiscalizacion result payload");
  return safe;
}
