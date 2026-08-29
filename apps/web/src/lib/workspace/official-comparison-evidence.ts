import "server-only";
import type { OfficialSelection } from "../../app/api/workspace/official/input";
import { ResultsExplorationRepository, type ExplorationOk, type ExplorationParty, type ExplorationSelection, type ExplorationSourceAudit } from "../results/exploration";
import { createSupabaseServerClient } from "../supabase/server-client";
import { authorizedOfficialComparisonBundle } from "./context";

const ITEM_LIMIT = 100, EXCLUSION_LIMIT = 20, SHA256 = /^[0-9a-f]{64}$/;
const FORBIDDEN_PROVENANCE_KEYS = ["source", "source_url", "sourceUrl", "archived_path", "archivedPath", "notes", "url", "path"] as const;
export const OFFICIAL_COMPARISON_EVIDENCE_STATUS = { OK: "ok", EMPTY: "empty", AUTHORIZATION_DENIED: "authorization_denied", UNAVAILABLE: "unavailable", PAYLOAD_TOO_LARGE: "payload_too_large", MALFORMED: "malformed" } as const;
type OfficialComparisonEvidenceStatus = (typeof OFFICIAL_COMPARISON_EVIDENCE_STATUS)[keyof typeof OFFICIAL_COMPARISON_EVIDENCE_STATUS];
export interface OfficialComparisonReferenceItem { jurisdictionId: string; electionId: string; year: number; round: string; categoryId: string; categoryName: string; distritoCode: string; distritoName: string | null; seccionCode: string; seccionName: string | null; circuitoCode: string | null; circuitoName: string | null; establecimientoCode: string | null; establecimientoName: string | null; mesaCode: number | null; }
export interface OfficialComparisonProvenanceItem { archiveEntryId: string; capability: string; mime: string; bytes: number | null; fetchedAt: string; status: "ok" | "error"; sha256: string | null; }
export interface OfficialComparisonSourceExclusion { kind: string; rows: number; votes: number; }
export interface OfficialComparisonReferenceExclusion { kind: string; reason: "non_official_source"; rows: number; }
interface OfficialComparisonReferenceEvidence { items: OfficialComparisonReferenceItem[]; sourceExclusions: OfficialComparisonReferenceExclusion[]; }
interface OfficialComparisonProvenanceEvidence { items: OfficialComparisonProvenanceItem[]; sourceExclusions: OfficialComparisonSourceExclusion[]; }
export interface AuthorizedOfficialComparisonSideEvidence { result: ExplorationOk; reference: OfficialComparisonReferenceEvidence; provenance: OfficialComparisonProvenanceEvidence; }
interface AuthorizedOfficialComparisonEvidenceOk { status: typeof OFFICIAL_COMPARISON_EVIDENCE_STATUS.OK; left: AuthorizedOfficialComparisonSideEvidence; right: AuthorizedOfficialComparisonSideEvidence; }
interface AuthorizedOfficialComparisonEvidenceState { status: Exclude<OfficialComparisonEvidenceStatus, typeof OFFICIAL_COMPARISON_EVIDENCE_STATUS.OK>; }
export type AuthorizedOfficialComparisonEvidence = AuthorizedOfficialComparisonEvidenceOk | AuthorizedOfficialComparisonEvidenceState;
type Raw = Record<string, unknown>;
const record = (value: unknown): Raw | null => typeof value === "object" && value !== null && !Array.isArray(value) ? value as Raw : null;
const uint = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const text = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.trim() === value;
const nullableText = (value: unknown): value is string | null => value === null || text(value);
const bounded = (value: unknown, limit: number): unknown[] | null => Array.isArray(value) && value.length <= limit ? value : null;
function uniqueText(value: unknown): string[] | null { const values = bounded(value, ITEM_LIMIT); return values && values.every(text) && new Set(values).size === values.length ? values as string[] : null; }
function sameSet(left: readonly string[], right: readonly string[]): boolean { const sorted = [...right].sort(); return left.length === right.length && [...left].sort().every((value, index) => value === sorted[index]); }
function validSectionPair(left: OfficialSelection, right: OfficialSelection): boolean {
  return Boolean(left.seccionCode && right.seccionCode && left.distritoCode === right.distritoCode && left.seccionCode === right.seccionCode && left.requestedLevel === "seccion" && right.requestedLevel === "seccion" && left.circuitoCode === null && right.circuitoCode === null && left.establecimientoCode === null && right.establecimientoCode === null && left.mesaCode === null && right.mesaCode === null);
}
function parserSelection(selection: OfficialSelection): ExplorationSelection { return { electionId: selection.electionId, categoryId: selection.categoryId, distritoCode: selection.distritoCode, seccionCode: selection.seccionCode!, requestedLevel: selection.requestedLevel }; }
function canonicalParties(parties: ExplorationParty[]): boolean {
  const ids = new Set<string>();
  for (const party of parties) {
    if (party.identityStatus !== "canonical" || !party.canonicalPartyId || !text(party.canonicalPartyId) || !party.displayName || !text(party.displayName) || ids.has(party.canonicalPartyId)) return false;
    ids.add(party.canonicalPartyId);
  }
  return parties.length > 0;
}
async function parseResult(value: Raw, selection: OfficialSelection): Promise<ExplorationOk | null> {
  if (value["status"] !== "ok" || value["source_kind"] !== "official" || value["truncated"] !== false || !bounded(value["parties"], ITEM_LIMIT) || !bounded(value["source_audit"], 1) || !bounded(value["source_exclusions"], EXCLUSION_LIMIT) || !uniqueText(value["archive_entry_ids"])?.length) return null;
  try {
    const parsed = await new ResultsExplorationRepository({ rpc: () => Promise.resolve({ data: value, error: null }) }).official(parserSelection(selection));
    return parsed.status === "ok" && parsed.level === "seccion" && canonicalParties(parsed.parties) ? parsed : null;
  } catch { return null; }
}
function parseSourceExclusions(value: unknown): OfficialComparisonSourceExclusion[] | null {
  const items = bounded(value, EXCLUSION_LIMIT); if (!items) return null;
  let previous = ""; const parsed: OfficialComparisonSourceExclusion[] = [];
  for (const item of items) {
    const entry = record(item), kind = entry?.["kind"];
    if (!entry || !text(kind) || kind === "official" || kind <= previous || !uint(entry["rows"]) || entry["rows"] === 0 || !uint(entry["votes"])) return null;
    previous = kind; parsed.push({ kind, rows: entry["rows"], votes: entry["votes"] });
  }
  return parsed;
}
function parseReference(value: Raw, selection: OfficialSelection, result: ExplorationOk): OfficialComparisonReferenceEvidence | null {
  const items = bounded(value["items"], ITEM_LIMIT), rawExclusions = bounded(value["source_exclusions"], EXCLUSION_LIMIT);
  if (value["status"] !== "ok" || value["authorization_status"] !== "authorized" || value["source_kind"] !== "official" || value["truncated"] !== false || !items?.length || !rawExclusions || !uint(value["total"]) || value["total"] !== items.length) return null;
  const sourceExclusions: OfficialComparisonReferenceExclusion[] = []; let previousKind = "";
  for (const item of rawExclusions) {
    const entry = record(item), kind = entry?.["kind"];
    if (!entry || !text(kind) || kind === "official" || kind <= previousKind || entry["reason"] !== "non_official_source" || !uint(entry["rows"]) || entry["rows"] === 0) return null;
    previousKind = kind; sourceExclusions.push({ kind, reason: "non_official_source", rows: entry["rows"] });
  }
  const seen = new Set<string>(), parsed: OfficialComparisonReferenceItem[] = [];
  for (const item of items) {
    const entry = record(item), jurisdictionId = entry?.["jurisdiction_id"];
    if (!entry || !text(jurisdictionId) || seen.has(jurisdictionId) || entry["election_id"] !== selection.electionId || entry["category_id"] !== selection.categoryId || entry["distrito_code"] !== selection.distritoCode || entry["seccion_code"] !== selection.seccionCode || entry["year"] !== result.electionYear || entry["round"] !== result.electionRound || !text(entry["category_name"]) || !nullableText(entry["distrito_name"]) || !nullableText(entry["seccion_name"]) || !nullableText(entry["circuito_code"]) || !nullableText(entry["circuito_name"]) || !nullableText(entry["establecimiento_code"]) || !nullableText(entry["establecimiento_name"]) || !(entry["mesa_code"] === null || uint(entry["mesa_code"]))) return null;
    seen.add(jurisdictionId); parsed.push({ jurisdictionId, electionId: selection.electionId, year: result.electionYear, round: result.electionRound, categoryId: selection.categoryId, categoryName: entry["category_name"], distritoCode: selection.distritoCode, distritoName: entry["distrito_name"] as string | null, seccionCode: selection.seccionCode!, seccionName: entry["seccion_name"] as string | null, circuitoCode: entry["circuito_code"] as string | null, circuitoName: entry["circuito_name"] as string | null, establecimientoCode: entry["establecimiento_code"] as string | null, establecimientoName: entry["establecimiento_name"] as string | null, mesaCode: entry["mesa_code"] as number | null });
  }
  return { items: parsed, sourceExclusions };
}
function auditMatches(value: unknown, expected: ExplorationSourceAudit[]): boolean {
  const items = bounded(value, 1); if (!items || items.length !== expected.length) return false;
  return items.every((item, index) => { const entry = record(item), audit = expected[index]; return audit !== undefined && entry?.["kind"] === "official" && entry["rows"] === audit.rows && entry["votes"] === audit.votes; });
}
function parseProvenance(value: Raw, result: ExplorationOk): OfficialComparisonProvenanceEvidence | null {
  const ids = uniqueText(value["archive_entry_ids"]), sources = bounded(value["sources"], ITEM_LIMIT), sourceExclusions = parseSourceExclusions(value["source_exclusions"]);
  if (value["status"] !== "ok" || value["authorization_status"] !== "authorized" || value["source_kind"] !== "official" || value["truncated"] !== false || !ids?.length || !sameSet(ids, result.archiveEntryIds) || !sources || sources.length !== ids.length || !uint(value["total"]) || value["total"] !== ids.length || !sourceExclusions || !auditMatches(value["source_audit"], result.sourceAudit)) return null;
  const parsed: OfficialComparisonProvenanceItem[] = [];
  for (let index = 0; index < sources.length; index += 1) {
    const source = record(sources[index]);
    if (!source || FORBIDDEN_PROVENANCE_KEYS.some((key) => key in source) || source["id"] !== ids[index] || source["metadata_status"] !== "available" || !text(source["capability"]) || !text(source["mime"]) || !(source["bytes"] === null || uint(source["bytes"])) || !text(source["fetched_at"]) || !Number.isFinite(Date.parse(source["fetched_at"])) || (source["status"] !== "ok" && source["status"] !== "error") || !(source["sha256"] === null || typeof source["sha256"] === "string" && SHA256.test(source["sha256"]))) return null;
    parsed.push({ archiveEntryId: ids[index]!, capability: source["capability"], mime: source["mime"], bytes: source["bytes"] as number | null, fetchedAt: source["fetched_at"], status: source["status"], sha256: source["sha256"] as string | null });
  }
  return { items: parsed, sourceExclusions };
}
function failureStatus(bundle: Raw): AuthorizedOfficialComparisonEvidenceState | null {
  const parts = [record(bundle["comparison"]), record(bundle["leftReference"]), record(bundle["rightReference"]), record(bundle["leftProvenance"]), record(bundle["rightProvenance"])];
  if (parts.some((part) => part === null)) return { status: OFFICIAL_COMPARISON_EVIDENCE_STATUS.MALFORMED };
  const statuses = parts.map((part) => part!["status"]); if (statuses.every((status) => status === "ok")) return null;
  if (statuses.some((status) => status === "authorization_denied")) return { status: OFFICIAL_COMPARISON_EVIDENCE_STATUS.AUTHORIZATION_DENIED };
  if (statuses.some((status) => status === "payload_too_large")) return { status: OFFICIAL_COMPARISON_EVIDENCE_STATUS.PAYLOAD_TOO_LARGE };
  if (statuses.every((status) => status === "no_rows")) return { status: OFFICIAL_COMPARISON_EVIDENCE_STATUS.EMPTY };
  return { status: OFFICIAL_COMPARISON_EVIDENCE_STATUS.UNAVAILABLE };
}
export async function loadAuthorizedOfficialComparisonEvidence(leftSelection: OfficialSelection, rightSelection: OfficialSelection): Promise<AuthorizedOfficialComparisonEvidence> {
  if (!validSectionPair(leftSelection, rightSelection)) return { status: OFFICIAL_COMPARISON_EVIDENCE_STATUS.MALFORMED };
  try {
    const bundle = record(await authorizedOfficialComparisonBundle(await createSupabaseServerClient(), leftSelection, rightSelection));
    if (!bundle) return { status: OFFICIAL_COMPARISON_EVIDENCE_STATUS.MALFORMED }; const failure = failureStatus(bundle); if (failure) return failure;
    const comparison = record(bundle["comparison"]), leftRaw = record(comparison?.["left"]), rightRaw = record(comparison?.["right"]);
    if (!comparison || comparison["status"] !== "ok" || comparison["truncated"] !== false || !leftRaw || !rightRaw) return { status: OFFICIAL_COMPARISON_EVIDENCE_STATUS.MALFORMED };
    const [leftResult, rightResult] = await Promise.all([parseResult(leftRaw, leftSelection), parseResult(rightRaw, rightSelection)]);
    if (!leftResult || !rightResult) return { status: OFFICIAL_COMPARISON_EVIDENCE_STATUS.MALFORMED };
    const leftReferenceRaw = record(bundle["leftReference"]), rightReferenceRaw = record(bundle["rightReference"]), leftProvenanceRaw = record(bundle["leftProvenance"]), rightProvenanceRaw = record(bundle["rightProvenance"]);
    if (!leftReferenceRaw || !rightReferenceRaw || !leftProvenanceRaw || !rightProvenanceRaw) return { status: OFFICIAL_COMPARISON_EVIDENCE_STATUS.MALFORMED };
    const leftReference = parseReference(leftReferenceRaw, leftSelection, leftResult), rightReference = parseReference(rightReferenceRaw, rightSelection, rightResult), leftProvenance = parseProvenance(leftProvenanceRaw, leftResult), rightProvenance = parseProvenance(rightProvenanceRaw, rightResult);
    if (!leftReference || !rightReference || !leftProvenance || !rightProvenance) return { status: OFFICIAL_COMPARISON_EVIDENCE_STATUS.MALFORMED };
    return { status: OFFICIAL_COMPARISON_EVIDENCE_STATUS.OK, left: { result: leftResult, reference: leftReference, provenance: leftProvenance }, right: { result: rightResult, reference: rightReference, provenance: rightProvenance } };
  } catch { return { status: OFFICIAL_COMPARISON_EVIDENCE_STATUS.UNAVAILABLE }; }
}
