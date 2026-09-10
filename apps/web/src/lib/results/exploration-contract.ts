import type { ExplorationLevel } from "./exploration";

const IDENTITY_STATUS = { CANONICAL: "canonical", UNMAPPED: "unmapped" } as const;
type IdentityStatus = (typeof IDENTITY_STATUS)[keyof typeof IDENTITY_STATUS];

export interface ExplorationParty {
  identityStatus: IdentityStatus; canonicalPartyId: string | null; displayName: string | null;
  listId: string | null; votes: number; voteShare: string | null;
}
export interface ExplorationSourceAudit { kind: string; rows: number; votes: number; }
export interface SchoolBreakdownExclusion { reason: string; rows: number; votes: number; }
export interface SchoolBreakdownItem {
  circuitoCode: string; code: string; name: string | null; mesaCount: number;
  totalVotes: number; parties: ExplorationParty[]; archiveEntryIds: string[];
}
export interface SchoolBreakdownOk {
  status: "ok"; sourceKind: "official"; level: "seccion";
  schools: SchoolBreakdownItem[]; sourceAudit: ExplorationSourceAudit[];
  exclusions: SchoolBreakdownExclusion[]; sourceExclusions: ExplorationSourceAudit[];
}
export type SchoolBreakdownResult = SchoolBreakdownOk | ExplorationRefusal;
export interface ExplorationOk {
  status: "ok"; sourceKind: "official"; level: ExplorationLevel; sourceGranularity: ExplorationLevel;
  electionYear: number; electionRound: string; categoryName: string; totalVotes: number;
  mesaCount: number | null; parties: ExplorationParty[]; archiveEntryIds: string[];
  sourceAudit: ExplorationSourceAudit[];
  sourceExclusions: ExplorationSourceAudit[];
}
export interface ExplorationRefusal {
  status: "no_rows" | "source_unavailable" | "selection_invalid";
  reason: string; counts: Record<string, number>; exclusions?: SchoolBreakdownExclusion[];
  sourceExclusions?: ExplorationSourceAudit[];
}
export type ExplorationResult = ExplorationOk | ExplorationRefusal;

export class ResultsExplorationContractError extends Error {
  constructor(
    readonly code: "results_exploration_facets_contract" | "results_exploration_official_contract" | "results_exploration_refusal_contract",
    detail: string,
  ) {
    super(`${code}: ${detail}`);
    this.name = "ResultsExplorationContractError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function stringField(value: Record<string, unknown>, key: string): string {
  const field = value[key];
  if (typeof field !== "string" || field.length === 0) throw new Error(`invalid ${key}`);
  return field;
}
function nonblankStringField(value: Record<string, unknown>, key: string): string {
  const field = stringField(value, key);
  if (field.trim().length === 0) throw new Error(`invalid ${key}`);
  return field;
}
function nullableStringField(value: Record<string, unknown>, key: string): string | null {
  const field = value[key];
  if (field !== null && typeof field !== "string") throw new Error(`invalid ${key}`);
  return field;
}
function nonnegativeInteger(value: Record<string, unknown>, key: string): number {
  const field = value[key];
  if (typeof field !== "number" || !Number.isSafeInteger(field) || field < 0) {
    throw new Error(`invalid ${key}`);
  }
  return field;
}
function nullableNonnegativeInteger(value: Record<string, unknown>, key: string): number | null {
  return value[key] === null ? null : nonnegativeInteger(value, key);
}
function countFields(value: unknown): Record<string, number> {
  if (!isRecord(value)) throw new Error("invalid counts");
  return Object.fromEntries(Object.entries(value).map(([key, count]) => {
    if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 0) {
      throw new Error("invalid counts");
    }
    return [key.replace(/_([a-z])/g, (_match, letter: string) => letter.toUpperCase()), count];
  }));
}
function parseRefusal(value: Record<string, unknown>): ExplorationRefusal | null {
  const status = value["status"];
  if (status !== "no_rows" && status !== "source_unavailable" && status !== "selection_invalid") {
    return null;
  }
  try {
    return { status, reason: stringField(value, "reason"), counts: countFields(value["counts"]),
      ...("exclusions" in value ? { exclusions: parseExclusions(value["exclusions"]) } : {}),
      ...("source_exclusions" in value
        ? { sourceExclusions: parseSourceExclusions(value["source_exclusions"]) } : {}) };
  } catch {
    throw new ResultsExplorationContractError("results_exploration_refusal_contract", "malformed refusal payload");
  }
}
function parseParty(value: unknown): ExplorationParty {
  if (!isRecord(value)) throw new Error("invalid party");
  const identityStatus = value["identity_status"];
  if (identityStatus !== IDENTITY_STATUS.CANONICAL && identityStatus !== IDENTITY_STATUS.UNMAPPED) {
    throw new Error("invalid identity_status");
  }
  const canonicalPartyId = nullableStringField(value, "canonical_party_id");
  const displayName = nullableStringField(value, "display_name");
  const listId = nullableStringField(value, "list_id");
  if (identityStatus === IDENTITY_STATUS.CANONICAL && (!canonicalPartyId || !displayName || listId !== null)) {
    throw new Error("invalid canonical identity");
  }
  if (identityStatus === IDENTITY_STATUS.UNMAPPED && (canonicalPartyId !== null || displayName !== null)) {
    throw new Error("invalid unmapped identity");
  }
  const share = value["vote_share"];
  if (share !== null && (typeof share !== "string" || !Number.isFinite(Number(share)))) {
    throw new Error("invalid vote_share");
  }
  return {
    identityStatus,
    canonicalPartyId,
    displayName,
    listId,
    votes: nonnegativeInteger(value, "votes"),
    voteShare: share,
  };
}
function shareMatches(party: ExplorationParty, totalVotes: number): boolean {
  if (totalVotes === 0) return party.voteShare === null;
  if (party.voteShare === null) return false;
  const match = /^(0|1)(?:\.(\d+))?$/.exec(party.voteShare);
  if (!match?.[1]) return false;
  const scale = 10n ** BigInt(match[2]?.length ?? 0),
    represented = BigInt(match[1]) * scale + BigInt(match[2] ?? "0"),
    error = represented * BigInt(totalVotes) - BigInt(party.votes) * scale;
  return (error < 0n ? -error : error) * 2n <= BigInt(totalVotes);
}
function isLevel(value: unknown): value is ExplorationLevel {
  return ["distrito", "seccion", "circuito", "establecimiento", "mesa"].includes(value as string);
}
function parseSourceAudit(value: unknown): ExplorationSourceAudit[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error("invalid source_audit");
  let previous = "";
  return value.map((entry) => {
    if (!isRecord(entry)) throw new Error("invalid source_audit");
    const kind = stringField(entry, "kind");
    const rows = nonnegativeInteger(entry, "rows");
    const votes = nonnegativeInteger(entry, "votes");
    if (rows === 0 || kind <= previous) throw new Error("invalid source_audit");
    previous = kind;
    return { kind, rows, votes };
  });
}
function parseSourceExclusions(value: unknown): ExplorationSourceAudit[] {
  if (!Array.isArray(value)) throw new Error("invalid source_exclusions");
  let previous = "";
  return value.map((entry) => {
    if (!isRecord(entry)) throw new Error("invalid source_exclusions");
    const kind = stringField(entry, "kind");
    const rows = nonnegativeInteger(entry, "rows");
    const votes = nonnegativeInteger(entry, "votes");
    if (rows === 0 || kind === "official" || kind <= previous)
      throw new Error("invalid source_exclusions");
    previous = kind;
    return { kind, rows, votes };
  });
}
function parseExclusions(value: unknown): SchoolBreakdownExclusion[] {
  if (!Array.isArray(value)) throw new Error("invalid exclusions");
  let previous = "";
  return value.map((entry) => {
    if (!isRecord(entry)) throw new Error("invalid exclusions");
    const reason = stringField(entry, "reason");
    const rows = nonnegativeInteger(entry, "rows");
    const votes = nonnegativeInteger(entry, "votes");
    if (rows === 0 || reason <= previous) throw new Error("invalid exclusions");
    previous = reason;
    return { reason, rows, votes };
  });
}
export function hasOnlyOfficialSourceAudit(audit: ExplorationSourceAudit[]): boolean {
  return audit.length === 1 && audit[0]?.kind === "official";
}
export function parseOfficialExploration(value: unknown): ExplorationResult {
  if (!isRecord(value)) {
    throw new ResultsExplorationContractError("results_exploration_official_contract", "malformed success payload");
  }
  const refused = parseRefusal(value);
  if (refused) {
    if (!("source_exclusions" in value)) throw new ResultsExplorationContractError(
      "results_exploration_refusal_contract", "malformed refusal payload");
    return refused;
  }
  try {
    const level = value["level"];
    const sourceGranularity = value["source_granularity"];
    const totalVotes = nonnegativeInteger(value, "total_votes");
    const categoryName = nonblankStringField(value, "category_name");
    const sourceAudit = parseSourceAudit(value["source_audit"]);
    const sourceExclusions = parseSourceExclusions(value["source_exclusions"]);
    const parties = value["parties"];
    const archiveEntryIds = value["archive_entry_ids"];
    if (
      value["status"] !== "ok" || value["source_kind"] !== "official" ||
      !hasOnlyOfficialSourceAudit(sourceAudit) ||
      !isLevel(level) || !isLevel(sourceGranularity) ||
      !Array.isArray(parties) || !Array.isArray(archiveEntryIds) ||
      !archiveEntryIds.every((entry) => typeof entry === "string")
    ) throw new Error("invalid envelope");
    if (sourceAudit.reduce((sum, entry) => sum + entry.votes, 0) !== totalVotes) {
      throw new Error("invalid source_audit");
    }
    const parsedParties = parties.map(parseParty);
    if (parsedParties.reduce((sum, party) => sum + party.votes, 0) !== totalVotes ||
        !parsedParties.every((party) => shareMatches(party, totalVotes))) {
      throw new Error("invalid parties");
    }
    return {
      status: "ok",
      sourceKind: "official",
      level,
      sourceGranularity,
      electionYear: nonnegativeInteger(value, "election_year"),
      electionRound: stringField(value, "election_round"),
      categoryName,
      totalVotes,
      mesaCount: nullableNonnegativeInteger(value, "mesa_count"),
      parties: parsedParties,
      archiveEntryIds,
      sourceAudit,
      sourceExclusions,
    };
  } catch (error) {
    if (error instanceof ResultsExplorationContractError) throw error;
    throw new ResultsExplorationContractError("results_exploration_official_contract", "malformed success payload");
  }
}
export function parseSchoolBreakdown(value: unknown): SchoolBreakdownResult {
  if (!isRecord(value)) throw new ResultsExplorationContractError(
    "results_exploration_official_contract", "malformed school breakdown payload");
  const refused = parseRefusal(value);
  if (refused) {
    if (!("exclusions" in value) || !("source_exclusions" in value))
      throw new ResultsExplorationContractError(
        "results_exploration_refusal_contract", "malformed refusal payload");
    return refused;
  }
  try {
    const sourceAudit = parseSourceAudit(value["source_audit"]);
    const schools = value["schools"];
    const exclusions = value["exclusions"];
    const sourceExclusions = parseSourceExclusions(value["source_exclusions"]);
    if (value["status"] !== "ok" || value["source_kind"] !== "official" ||
        value["level"] !== "seccion" || !hasOnlyOfficialSourceAudit(sourceAudit) ||
        !Array.isArray(schools) || schools.length === 0 || schools.length > 500 ||
        !Array.isArray(exclusions)) throw new Error("invalid envelope");
    const parsedSchools = schools.map((school): SchoolBreakdownItem => {
      if (!isRecord(school)) throw new Error("invalid school");
      const totalVotes = nonnegativeInteger(school, "total_votes");
      const parties = school["parties"];
      const archiveEntryIds = school["archive_entry_ids"];
      if (!Array.isArray(parties) || parties.length === 0 || !Array.isArray(archiveEntryIds) ||
          archiveEntryIds.length === 0 || !archiveEntryIds.every((id) => typeof id === "string"))
        throw new Error("invalid school arrays");
      const parsedParties = parties.map(parseParty);
      if (parsedParties.reduce((sum, party) => sum + party.votes, 0) !== totalVotes ||
          !parsedParties.every((party) => shareMatches(party, totalVotes)))
        throw new Error("invalid school parties");
      return { circuitoCode: stringField(school, "circuito_code"),
        code: stringField(school, "code"), name: nullableStringField(school, "name"),
        mesaCount: nonnegativeInteger(school, "mesa_count"), totalVotes,
        parties: parsedParties, archiveEntryIds };
    });
    const parsedExclusions = parseExclusions(exclusions);
    const includedVotes = parsedSchools.reduce((sum, school) => sum + school.totalVotes, 0);
    if (sourceAudit.reduce((sum, entry) => sum + entry.votes, 0) !== includedVotes)
      throw new Error("invalid audit totals");
    return { status: "ok", sourceKind: "official", level: "seccion",
      schools: parsedSchools, sourceAudit, sourceExclusions, exclusions: parsedExclusions };
  } catch {
    throw new ResultsExplorationContractError("results_exploration_official_contract",
      "malformed school breakdown payload");
  }
}
