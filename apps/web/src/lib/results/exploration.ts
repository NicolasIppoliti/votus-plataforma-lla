import type { SupabaseClient } from "@supabase/supabase-js";

export const EXPLORATION_LEVEL = {
  DISTRITO: "distrito", SECCION: "seccion", CIRCUITO: "circuito",
  ESTABLECIMIENTO: "establecimiento", MESA: "mesa",
} as const;
export type ExplorationLevel = (typeof EXPLORATION_LEVEL)[keyof typeof EXPLORATION_LEVEL];
const IDENTITY_STATUS = { CANONICAL: "canonical", UNMAPPED: "unmapped" } as const;
type IdentityStatus = (typeof IDENTITY_STATUS)[keyof typeof IDENTITY_STATUS];
export const FACET_NAME_STATUS = {
  PRESENT: "present", MISSING: "missing", CONFLICT: "conflict",
} as const;
export type FacetNameStatus = (typeof FACET_NAME_STATUS)[keyof typeof FACET_NAME_STATUS];
export interface ExplorationFacetSelection {
  electionId?: string; categoryId?: string; distritoCode?: string;
  seccionCode?: string; circuitoCode?: string; establecimientoCode?: string;
}
export interface ExplorationSelection extends ExplorationFacetSelection {
  electionId: string; categoryId: string; distritoCode: string;
  establecimientoCode?: string; mesaCode?: number; requestedLevel: ExplorationLevel;
}
interface ElectionOption { id: string; year: number; round: string; label: string; }
export interface FacetOption {
  code: string; name: string | null; nameStatus: FacetNameStatus; nameVariantCount: number;
}
interface CategoryOption { id: string; name: string; }
interface MesaOption { code: number; }
export interface ExplorationFacetExclusion { reason: string; rows: number; }
export interface ExplorationFacets {
  elections: ElectionOption[]; categories: CategoryOption[];
  distritos: FacetOption[]; secciones: FacetOption[]; circuitos: FacetOption[];
  establecimientos: FacetOption[]; mesas: MesaOption[];
  availableLevels: ExplorationLevel[]; exclusions?: ExplorationFacetExclusion[];
}
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
  electionYear: number; electionRound: string; totalVotes: number;
  mesaCount: number | null; parties: ExplorationParty[]; archiveEntryIds: string[];
  sourceAudit: ExplorationSourceAudit[];
  sourceExclusions: ExplorationSourceAudit[];
}
export interface ExplorationRefusal { status: "no_rows" | "source_unavailable" | "selection_invalid";
  reason: string; counts: Record<string, number>; exclusions?: SchoolBreakdownExclusion[];
  sourceExclusions?: ExplorationSourceAudit[]; }
export type ExplorationResult = ExplorationOk | ExplorationRefusal;
interface RpcResponse { data: unknown; error: { message: string } | null; }
export interface ExplorationRpcClient { rpc(name: string, args: Record<string, unknown>): Promise<RpcResponse>; }
export class ResultsExplorationContractError extends Error {
  constructor(readonly code: "results_exploration_facets_contract" | "results_exploration_official_contract" | "results_exploration_refusal_contract", detail: string) {
    super(`${code}: ${detail}`);
    this.name = "ResultsExplorationContractError";
  }
}
function requireCompleteHierarchy(selection: ExplorationSelection): void {
  if (selection.requestedLevel === EXPLORATION_LEVEL.MESA &&
      (!selection.circuitoCode || !selection.establecimientoCode)) {
    throw new ResultsExplorationContractError("results_exploration_official_contract",
      "mesa requiere los niveles superiores circuito y establecimiento");
  }
  if (selection.requestedLevel === EXPLORATION_LEVEL.ESTABLECIMIENTO && !selection.circuitoCode) {
    throw new ResultsExplorationContractError("results_exploration_official_contract",
      "establecimiento requiere un circuito superior");
  }
  if (selection.requestedLevel !== EXPLORATION_LEVEL.DISTRITO && !selection.seccionCode) {
    throw new ResultsExplorationContractError("results_exploration_official_contract",
      `${selection.requestedLevel} requiere una sección superior`);
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
  return Object.values(EXPLORATION_LEVEL).includes(value as ExplorationLevel);
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
function parseOfficial(value: unknown): ExplorationResult {
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
function parseSchoolBreakdown(value: unknown): SchoolBreakdownResult {
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
function parseTextOptions(value: unknown): FacetOption[] {
  if (!Array.isArray(value)) throw new Error("invalid options");
  return value.map((option) => {
    if (!isRecord(option)) throw new Error("invalid option");
    const name = nullableStringField(option, "name");
    const nameStatus = option["name_status"];
    const nameVariantCount = nonnegativeInteger(option, "name_variant_count");
    if (nameStatus !== FACET_NAME_STATUS.PRESENT && nameStatus !== FACET_NAME_STATUS.MISSING &&
        nameStatus !== FACET_NAME_STATUS.CONFLICT) throw new Error("invalid name_status");
    if ((nameStatus === FACET_NAME_STATUS.PRESENT && (name === null || nameVariantCount !== 1)) ||
        (nameStatus === FACET_NAME_STATUS.MISSING && (name !== null || nameVariantCount !== 0)) ||
        (nameStatus === FACET_NAME_STATUS.CONFLICT && (name !== null || nameVariantCount < 2))) {
      throw new Error("inconsistent facet name metadata");
    }
    return { code: stringField(option, "code"), name, nameStatus, nameVariantCount };
  });
}
export function formatFacetOptionLabel(option: FacetOption): string {
  if (option.nameStatus === FACET_NAME_STATUS.PRESENT) return `${option.code} — ${option.name}`;
  if (option.nameStatus === FACET_NAME_STATUS.MISSING) return `${option.code} — nombre no disponible`;
  return `${option.code} — nombres contradictorios (${option.nameVariantCount} variantes)`;
}
function parseFacetExclusions(value: unknown): ExplorationFacetExclusion[] {
  if (!Array.isArray(value)||value.length>2) throw new Error("invalid facet exclusions"); const reasons=new Set<string>();
  return value.map((raw)=>{if(!isRecord(raw)||Object.keys(raw).sort().join()!=="reason,rows")throw new Error("invalid facet exclusion"); const reason=stringField(raw,"reason"),rows=nonnegativeInteger(raw,"rows"); if(reason.length>128||rows===0||reasons.has(reason))throw new Error("invalid facet exclusion"); reasons.add(reason); return{reason,rows};});
}
function parseFacets(value: unknown): ExplorationFacets {
  try {
    if (!isRecord(value) || value["status"] !== "ok") throw new Error("invalid envelope");
    const elections = value["elections"];
    const categories = value["categories"];
    const mesas = value["mesas"];
    const availableLevels = value["available_levels"];
    if (!Array.isArray(elections) || !Array.isArray(categories) || !Array.isArray(mesas) ||
        !Array.isArray(availableLevels) || !availableLevels.every(isLevel)) {
      throw new Error("invalid arrays");
    }
    return {
      elections: elections.map((option) => {
        if (!isRecord(option)) throw new Error("invalid election");
        return {
          id: stringField(option, "id"),
          year: nonnegativeInteger(option, "year"),
          round: stringField(option, "round"),
          label: stringField(option, "label"),
        };
      }),
      categories: categories.map((option) => {
        if (!isRecord(option)) throw new Error("invalid category");
        return { id: stringField(option, "id"), name: stringField(option, "name") };
      }),
      distritos: parseTextOptions(value["distritos"]),
      secciones: parseTextOptions(value["secciones"]),
      circuitos: parseTextOptions(value["circuitos"]),
      establecimientos: parseTextOptions(value["establecimientos"]),
      mesas: mesas.map((option) => {
        if (!isRecord(option)) throw new Error("invalid mesa");
        return { code: nonnegativeInteger(option, "code") };
      }),
      availableLevels,
      ...(value["exclusions"] === undefined ? {} : { exclusions: parseFacetExclusions(value["exclusions"]) }),
    };
  } catch {
    throw new ResultsExplorationContractError("results_exploration_facets_contract", "respuesta de facetas malformada");
  }
}
interface RawAdministrativeParams {
  distritoCode?: string; seccionCode?: string; circuitoCode?: string;
  establecimientoCode?: string; mesaCode?: string;
}
type NormalizedAdministrativeParams = Omit<RawAdministrativeParams, "mesaCode"> & { mesaCode?: number };
export type NormalizedExplorationParams =
  | { status: "ok"; value: NormalizedAdministrativeParams }
  | { status: "invalid"; reason: string; counts: Record<string, number> };
function numericCode(raw: string | undefined, width: number): string | null | undefined {
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return undefined;
  if (!/^[0-9]+$/.test(trimmed)) return null;
  return trimmed.padStart(width, "0");
}
export function normalizeExplorationParams(raw: RawAdministrativeParams): NormalizedExplorationParams {
  const distritoCode = numericCode(raw.distritoCode, 2);
  const seccionCode = numericCode(raw.seccionCode, 3);
  let circuitoCode: string | null | undefined;
  if (raw.circuitoCode === undefined) {
    circuitoCode = undefined;
  } else {
    const trimmed = raw.circuitoCode.trim();
    const match = /^([0-9]+)([A-Za-z])?$/.exec(trimmed);
    circuitoCode = trimmed.length === 0 ? undefined : match?.[1]
      ? match[1].padStart(match[2] ? 4 : 5, "0") + (match[2]?.toUpperCase() ?? "")
      : null;
  }
  const establecimientoCode = raw.establecimientoCode?.trim() || undefined;
  const rawMesaCode = raw.mesaCode?.trim();
  const mesaCode = !rawMesaCode ? undefined
    : /^[0-9]+$/.test(rawMesaCode) ? Number(rawMesaCode) : null;
  const invalid = Object.fromEntries(Object.entries({ distritoCode, seccionCode, circuitoCode, mesaCode })
    .filter(([, value]) => value === null)
    .map(([key]) => [key, 1]));
  if (Object.keys(invalid).length > 0) {
    return { status: "invalid", reason: "los selectores administrativos están malformados", counts: invalid };
  }
  return {
    status: "ok",
    value: {
      ...(distritoCode ? { distritoCode } : {}),
      ...(seccionCode ? { seccionCode } : {}),
      ...(circuitoCode ? { circuitoCode } : {}),
      ...(establecimientoCode ? { establecimientoCode } : {}),
      ...(typeof mesaCode === "number" ? { mesaCode } : {}),
    },
  };
}
export class ResultsExplorationRepository {
  constructor(private readonly client: ExplorationRpcClient) {}
  async facets(selection: ExplorationFacetSelection): Promise<ExplorationFacets> {
    const { data, error } = await this.client.rpc("results_exploration_facets", {
      p_election_id: selection.electionId ?? null,
      p_category_id: selection.categoryId ?? null,
      p_distrito_code: selection.distritoCode ?? null,
      p_seccion_code: selection.seccionCode ?? null,
      p_circuito_code: selection.circuitoCode ?? null,
      p_establecimiento_code: selection.establecimientoCode ?? null,
    });
    if (error) throw new Error(`results_exploration_facets failed: ${error.message}`);
    return parseFacets(data);
  }
  async official(selection: ExplorationSelection): Promise<ExplorationResult> {
    requireCompleteHierarchy(selection);
    const { data, error } = await this.client.rpc("results_exploration_official", {
      p_election_id: selection.electionId,
      p_category_id: selection.categoryId,
      p_distrito_code: selection.distritoCode,
      p_seccion_code: selection.seccionCode ?? null,
      p_circuito_code: selection.circuitoCode ?? null,
      p_establecimiento_code: selection.establecimientoCode ?? null,
      p_mesa_code: selection.mesaCode ?? null,
      p_requested_level: selection.requestedLevel,
    });
    if (error) throw new Error(`results_exploration_official failed: ${error.message}`);
    return parseOfficial(data);
  }
  async schools(selection: ExplorationSelection): Promise<SchoolBreakdownResult> {
    if (selection.requestedLevel !== EXPLORATION_LEVEL.SECCION || !selection.seccionCode)
      throw new ResultsExplorationContractError("results_exploration_official_contract",
        "el desglose por establecimiento requiere una selección completa de sección");
    const { data, error } = await this.client.rpc("results_exploration_schools", {
      p_election_id: selection.electionId, p_category_id: selection.categoryId,
      p_distrito_code: selection.distritoCode, p_seccion_code: selection.seccionCode,
    });
    if (error) throw new Error(`results_exploration_schools failed: ${error.message}`);
    return parseSchoolBreakdown(data);
  }
}
export function createResultsExplorationRepository(
  client: SupabaseClient,
): ResultsExplorationRepository {
  return new ResultsExplorationRepository({
    rpc: async (name, args) => {
      const response = await client.rpc(name, args);
      return { data: response.data, error: response.error };
    },
  });
}
