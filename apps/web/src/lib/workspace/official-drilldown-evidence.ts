import "server-only";

import {
  parseOfficialExploration, parseSchoolBreakdown,
  type ExplorationOk, type SchoolBreakdownOk,
} from "../results/exploration-contract";
import { hierarchyInvalid, type ExplorationSelection } from "../results/exploration";
import { createSupabaseServerClient } from "../supabase/server-client";
import { authorizedOfficialBundle } from "./context";
import type { OfficialSelection } from "../../app/api/workspace/official/input";

const ITEM_LIMIT = 100;
const SCHOOL_LIMIT = 500;
const EXCLUSION_LIMIT = 20;
const SHA256 = /^[0-9a-f]{64}$/;
const FORBIDDEN_PROVENANCE_KEYS = ["source", "source_url", "sourceUrl", "archived_path", "archivedPath", "notes", "url", "path"] as const;
const REFUSAL_FIELD = { REASON: "reason", KIND: "kind" } as const; type RefusalField = (typeof REFUSAL_FIELD)[keyof typeof REFUSAL_FIELD];

export const OFFICIAL_DRILLDOWN_EVIDENCE_STATUS = {
  OK: "ok", EMPTY: "empty", AUTHORIZATION_DENIED: "authorization_denied",
  UNAVAILABLE: "unavailable", PAYLOAD_TOO_LARGE: "payload_too_large", MALFORMED: "malformed",
} as const;
export type OfficialDrilldownEvidenceStatus =
  (typeof OFFICIAL_DRILLDOWN_EVIDENCE_STATUS)[keyof typeof OFFICIAL_DRILLDOWN_EVIDENCE_STATUS];

export interface OfficialReferenceItem {
  jurisdictionId: string; electionId: string; year: number; round: string;
  categoryId: string; categoryName: string; distritoCode: string; distritoName: string | null;
  seccionCode: string; seccionName: string | null; circuitoCode: string | null;
  circuitoName: string | null; establecimientoCode: string | null;
  establecimientoName: string | null; mesaCode: number | null;
}
export interface OfficialProvenanceItem {
  archiveEntryId: string; capability: string; mime: string; bytes: number | null;
  fetchedAt: string; status: "ok" | "error"; sha256: string | null;
}
interface OfficialReferenceSourceExclusion { kind: string; reason: string; rows: number }
interface OfficialSourceExclusion { kind: string; rows: number; votes: number }
interface OfficialReferenceEvidence { items: OfficialReferenceItem[]; sourceExclusions: OfficialReferenceSourceExclusion[] }
interface OfficialProvenanceEvidence { items: OfficialProvenanceItem[]; sourceExclusions: OfficialSourceExclusion[] }
interface OfficialDrilldownEvidenceOk {
  status: typeof OFFICIAL_DRILLDOWN_EVIDENCE_STATUS.OK;
  result: ExplorationOk; schools: SchoolBreakdownOk;
  reference: OfficialReferenceEvidence; provenance: OfficialProvenanceEvidence;
}
interface OfficialRefusalItem { reason?: string; kind?: string; rows: number; votes: number } interface OfficialRefusalPartEvidence { part: string; reason?: string; counts?: Record<string, number>; exclusions?: OfficialRefusalItem[]; sourceExclusions?: OfficialRefusalItem[] }
interface OfficialDrilldownEvidenceState {
  status: Exclude<OfficialDrilldownEvidenceStatus, typeof OFFICIAL_DRILLDOWN_EVIDENCE_STATUS.OK>; evidence?: OfficialRefusalPartEvidence[];
}
export type OfficialDrilldownEvidence = OfficialDrilldownEvidenceOk | OfficialDrilldownEvidenceState;

type Raw = Record<string, unknown>;
const raw = (value: unknown): Raw | null =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? value as Raw : null;
const uint = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const text = (value: unknown): value is string => typeof value === "string" && value.length > 0;
const nullableText = (value: unknown): value is string | null => value === null || text(value);
const bounded = (value: unknown, limit: number): unknown[] | null =>
  Array.isArray(value) && value.length <= limit ? value : null;
const uniqueText = (value: unknown, limit = ITEM_LIMIT): string[] | null => {
  const values = bounded(value, limit);
  return values && values.every(text) && new Set(values).size === values.length ? values as string[] : null;
};

function validCounts(value: unknown): boolean {
  const counts = raw(value);
  return counts !== null && Object.values(counts).every(uint);
}
function validOfficialAudit(value: unknown): boolean {
  const audit = bounded(value, 1), entry = raw(audit?.[0]);
  return audit?.length === 1 && entry?.["kind"] === "official" && uint(entry["rows"]) && entry["rows"] > 0 && uint(entry["votes"]);
}
function sourceExclusions(value: unknown): OfficialSourceExclusion[] | null {
  const exclusions = bounded(value, EXCLUSION_LIMIT); let previous = ""; if (!exclusions) return null;
  const parsed = exclusions.map((item) => { const entry = raw(item), kind = entry?.["kind"];
    if (!entry || !text(kind) || kind === "official" || kind <= previous || !uint(entry["rows"]) || entry["rows"] === 0 || !uint(entry["votes"])) return null;
    previous = kind; return { kind, rows: entry["rows"], votes: entry["votes"] }; });
  return parsed.includes(null) ? null : parsed as OfficialSourceExclusion[];
}
function refusalItems(value: unknown, field: RefusalField): OfficialRefusalItem[] | null {
  const values = bounded(value, EXCLUSION_LIMIT); let previous = ""; if (!values) return null;
  const parsed = values.map((item) => { const entry = raw(item), label = entry?.[field];
    if (!entry || !text(label) || label <= previous || field === REFUSAL_FIELD.KIND && label === "official" || !uint(entry["rows"]) || entry["rows"] === 0 || !uint(entry["votes"])) return null;
    previous = label; return { [field]: label, rows: entry["rows"], votes: entry["votes"] } as OfficialRefusalItem; });
  return parsed.includes(null) ? null : parsed as OfficialRefusalItem[];
}
function refusalEvidence(part: Raw, name: string): OfficialRefusalPartEvidence | null {
  for (const key of ["exclusions", "source_exclusions", "items", "archive_entry_ids", "sources", "schools", "parties"])
    if (key in part && !bounded(part[key], key === "items" || key === "archive_entry_ids" || key === "sources" || key === "parties" ? ITEM_LIMIT : EXCLUSION_LIMIT)) return null;
  const exclusions = "exclusions" in part ? refusalItems(part["exclusions"], REFUSAL_FIELD.REASON) : [], sourceExclusions = "source_exclusions" in part ? refusalItems(part["source_exclusions"], REFUSAL_FIELD.KIND) : [];
  if (!("counts" in part ? validCounts(part["counts"]) : true) || "total" in part && !uint(part["total"]) || "reason" in part && !text(part["reason"]) || !exclusions || !sourceExclusions) return null;
  const counts = raw(part["counts"]); return { part: name, ...(text(part["reason"]) ? { reason: part["reason"] } : {}), ...(counts && Object.keys(counts).length ? { counts: { ...counts } as Record<string, number> } : {}), ...(exclusions.length ? { exclusions } : {}), ...(sourceExclusions.length ? { sourceExclusions } : {}) };
}
function coherentState(parts: Raw[]): OfficialDrilldownEvidenceState | null {
  const statuses = parts.map((part) => part["status"]);
  if (!statuses.every((status) => status === statuses[0])) return { status: OFFICIAL_DRILLDOWN_EVIDENCE_STATUS.MALFORMED };
  const status = statuses[0];
  if (status === "ok") return null;
  const evidence = parts.map((part, index) => refusalEvidence(part, ["result", "schools", "reference", "provenance"][index]!)); if (evidence.some((item) => item === null)) return { status: OFFICIAL_DRILLDOWN_EVIDENCE_STATUS.MALFORMED };
  const safeEvidence = evidence.filter((item): item is OfficialRefusalPartEvidence => item !== null && Object.keys(item).length > 1), state = (value: OfficialDrilldownEvidenceState["status"]): OfficialDrilldownEvidenceState => ({ status: value, ...(safeEvidence.length ? { evidence: safeEvidence } : {}) });
  if (status === "authorization_denied") {
    const authorization = parts[0]?.["authorization_status"];
    return parts.every((part) => text(part["authorization_status"]) && part["authorization_status"] === authorization && authorization !== "authorized" && part["truncated"] === false)
      ? state(OFFICIAL_DRILLDOWN_EVIDENCE_STATUS.AUTHORIZATION_DENIED)
      : { status: OFFICIAL_DRILLDOWN_EVIDENCE_STATUS.MALFORMED };
  }
  if (status === "payload_too_large") return parts.every((part) => part["authorization_status"] === "authorized" && part["truncated"] === true)
    ? state(OFFICIAL_DRILLDOWN_EVIDENCE_STATUS.PAYLOAD_TOO_LARGE)
    : { status: OFFICIAL_DRILLDOWN_EVIDENCE_STATUS.MALFORMED };
  if (status === "source_unavailable" || status === "selection_invalid") return parts.every((part) => part["authorization_status"] === "authorized" && part["truncated"] === false && text(part["reason"]))
    ? state(OFFICIAL_DRILLDOWN_EVIDENCE_STATUS.UNAVAILABLE)
    : { status: OFFICIAL_DRILLDOWN_EVIDENCE_STATUS.MALFORMED };
  if (status === "no_rows") {
    const empty = parts.every((part) => part["authorization_status"] === "authorized" && part["truncated"] === false &&
      (!("source_kind" in part) || part["source_kind"] === "official") &&
      (!("total" in part) || part["total"] === 0) &&
      ["items", "archive_entry_ids", "sources", "schools", "parties"].every((key) => !(key in part) || Array.isArray(part[key]) && part[key].length === 0));
    return empty ? state(OFFICIAL_DRILLDOWN_EVIDENCE_STATUS.EMPTY) : { status: OFFICIAL_DRILLDOWN_EVIDENCE_STATUS.MALFORMED };
  }
  return { status: OFFICIAL_DRILLDOWN_EVIDENCE_STATUS.MALFORMED };
}

function validSuccessEnvelope(part: Raw): boolean {
  return part["status"] === "ok" && part["authorization_status"] === "authorized" &&
    part["source_kind"] === "official" && part["truncated"] === false;
}
function selectionForParser(selection: OfficialSelection): ExplorationSelection {
  return {
    electionId: selection.electionId, categoryId: selection.categoryId,
    distritoCode: selection.distritoCode, requestedLevel: selection.requestedLevel,
    ...(selection.seccionCode ? { seccionCode: selection.seccionCode } : {}),
    ...(selection.circuitoCode ? { circuitoCode: selection.circuitoCode } : {}),
    ...(selection.establecimientoCode ? { establecimientoCode: selection.establecimientoCode } : {}),
    ...(selection.mesaCode !== null ? { mesaCode: selection.mesaCode } : {}),
  };
}
async function parseDisplayedParts(result: Raw, schools: Raw, selection: OfficialSelection) {
  const resultIds = uniqueText(result["archive_entry_ids"]);
  if (!bounded(result["parties"], ITEM_LIMIT) || !bounded(result["source_audit"], EXCLUSION_LIMIT) ||
      !bounded(result["source_exclusions"], EXCLUSION_LIMIT) || !resultIds?.length ||
      !bounded(schools["schools"], SCHOOL_LIMIT) || !bounded(schools["source_audit"], EXCLUSION_LIMIT) ||
      !bounded(schools["source_exclusions"], EXCLUSION_LIMIT) || !bounded(schools["exclusions"], EXCLUSION_LIMIT)) return null;
  const schoolRows = schools["schools"] as unknown[];
  const identities = new Set<string>();
  for (const value of schoolRows) {
    const school = raw(value), parties = bounded(school?.["parties"], ITEM_LIMIT), ids = uniqueText(school?.["archive_entry_ids"]);
    if (!school || !parties || !ids || !text(school["circuito_code"]) || !text(school["code"]) || identities.has(`${school["circuito_code"]}\0${school["code"]}`)) return null;
    identities.add(`${school["circuito_code"]}\0${school["code"]}`);
  }
  const parserSelection = selectionForParser(selection);
  try {
    if (hierarchyInvalid(parserSelection)) return null;
    const parsedResult = parseOfficialExploration(result);
    const parsedSchools = parseSchoolBreakdown(schools);
    return parsedResult.status === "ok" && parsedSchools.status === "ok" && parsedResult.level === selection.requestedLevel
      ? { result: parsedResult, schools: parsedSchools } : null;
  } catch { return null; }
}

function parseReference(value: Raw, selection: OfficialSelection): OfficialReferenceEvidence | null {
  const items = bounded(value["items"], ITEM_LIMIT), exclusions = bounded(value["source_exclusions"], EXCLUSION_LIMIT), sourceExclusions: OfficialReferenceSourceExclusion[] = []; let previous = "";
  if (!items?.length || !exclusions || !uint(value["total"]) || value["total"] !== items.length) return null;
  for (const item of exclusions) { const entry = raw(item), kind = entry?.["kind"];
    if (!entry || !text(kind) || kind === "official" || kind <= previous || entry["reason"] !== "non_official_source" || !uint(entry["rows"]) || entry["rows"] === 0) return null;
    previous = kind; sourceExclusions.push({ kind, reason: "non_official_source", rows: entry["rows"] }); }
  const seen = new Set<string>(), parsed: OfficialReferenceItem[] = [];
  for (const item of items) {
    const entry = raw(item);
    if (!entry || !text(entry["jurisdiction_id"]) || seen.has(entry["jurisdiction_id"] as string) ||
        entry["election_id"] !== selection.electionId || entry["category_id"] !== selection.categoryId ||
        entry["distrito_code"] !== selection.distritoCode || entry["seccion_code"] !== selection.seccionCode ||
        !uint(entry["year"]) || !text(entry["round"]) || !text(entry["category_name"]) ||
        !nullableText(entry["distrito_name"]) || !nullableText(entry["seccion_name"]) ||
        !nullableText(entry["circuito_code"]) || !nullableText(entry["circuito_name"]) ||
        !nullableText(entry["establecimiento_code"]) || !nullableText(entry["establecimiento_name"]) ||
        !(entry["mesa_code"] === null || uint(entry["mesa_code"]))) return null;
    seen.add(entry["jurisdiction_id"] as string);
    parsed.push({ jurisdictionId: entry["jurisdiction_id"] as string, electionId: selection.electionId,
      year: entry["year"] as number, round: entry["round"] as string, categoryId: selection.categoryId,
      categoryName: entry["category_name"] as string, distritoCode: selection.distritoCode,
      distritoName: entry["distrito_name"] as string | null, seccionCode: selection.seccionCode!,
      seccionName: entry["seccion_name"] as string | null, circuitoCode: entry["circuito_code"] as string | null,
      circuitoName: entry["circuito_name"] as string | null, establecimientoCode: entry["establecimiento_code"] as string | null,
      establecimientoName: entry["establecimiento_name"] as string | null, mesaCode: entry["mesa_code"] as number | null });
  }
  return { items: parsed, sourceExclusions };
}

function parseProvenance(value: Raw): OfficialProvenanceEvidence | null {
  const ids = uniqueText(value["archive_entry_ids"]), sources = bounded(value["sources"], ITEM_LIMIT);
  const audit = value["source_audit"], safeExclusions = sourceExclusions(value["source_exclusions"]);
  if (!ids?.length || !sources || !safeExclusions || !uint(value["total"]) || value["total"] !== ids.length ||
      sources.length !== ids.length || !validOfficialAudit(audit)) return null;
  const parsed: OfficialProvenanceItem[] = [];
  for (let index = 0; index < sources.length; index += 1) {
    const source = raw(sources[index]);
    if (!source || FORBIDDEN_PROVENANCE_KEYS.some((key) => key in source) || source["id"] !== ids[index] ||
        source["metadata_status"] !== "available" || !text(source["capability"]) || !text(source["mime"]) ||
        !(source["bytes"] === null || uint(source["bytes"])) || !text(source["fetched_at"]) ||
        !Number.isFinite(Date.parse(source["fetched_at"] as string)) ||
        (source["status"] !== "ok" && source["status"] !== "error") ||
        !(source["sha256"] === null || typeof source["sha256"] === "string" && SHA256.test(source["sha256"]))) return null;
    parsed.push({ archiveEntryId: ids[index]!, capability: source["capability"] as string,
      mime: source["mime"] as string, bytes: source["bytes"] as number | null,
      fetchedAt: source["fetched_at"] as string, status: source["status"], sha256: source["sha256"] as string | null });
  }
  return { items: parsed, sourceExclusions: safeExclusions };
}

export async function loadAuthorizedOfficialDrilldownEvidence(selection: OfficialSelection): Promise<OfficialDrilldownEvidence> {
  if (!selection.seccionCode) return { status: OFFICIAL_DRILLDOWN_EVIDENCE_STATUS.MALFORMED };
  try {
    const bundle = raw(await authorizedOfficialBundle(await createSupabaseServerClient(), selection));
    const result = raw(bundle?.["result"]), schools = raw(bundle?.["schools"]), reference = raw(bundle?.["reference"]), provenance = raw(bundle?.["provenance"]);
    if (!bundle || !result || !schools || !reference || !provenance) return { status: OFFICIAL_DRILLDOWN_EVIDENCE_STATUS.MALFORMED };
    const parts = [result, schools, reference, provenance], state = coherentState(parts);
    if (state) return state;
    if (!parts.every(validSuccessEnvelope)) return { status: OFFICIAL_DRILLDOWN_EVIDENCE_STATUS.MALFORMED };
    const displayed = await parseDisplayedParts(result, schools, selection);
    const safeReference = parseReference(reference, selection), safeProvenance = parseProvenance(provenance);
    if (!displayed || !safeReference || !safeProvenance) return { status: OFFICIAL_DRILLDOWN_EVIDENCE_STATUS.MALFORMED };
    const available = new Set(safeProvenance.items.map((item) => item.archiveEntryId));
    const displayedIds = [...displayed.result.archiveEntryIds, ...displayed.schools.schools.flatMap((school) => school.archiveEntryIds)];
    return displayedIds.every((id) => available.has(id))
      ? { status: OFFICIAL_DRILLDOWN_EVIDENCE_STATUS.OK, ...displayed, reference: safeReference, provenance: safeProvenance }
      : { status: OFFICIAL_DRILLDOWN_EVIDENCE_STATUS.MALFORMED };
  } catch { return { status: OFFICIAL_DRILLDOWN_EVIDENCE_STATUS.UNAVAILABLE }; }
}
