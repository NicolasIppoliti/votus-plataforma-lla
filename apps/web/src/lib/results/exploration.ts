import type { SupabaseClient } from "@supabase/supabase-js";

export const EXPLORATION_LEVEL = {
  DISTRITO: "distrito", SECCION: "seccion", CIRCUITO: "circuito",
  ESTABLECIMIENTO: "establecimiento", MESA: "mesa",
} as const;
export type ExplorationLevel = (typeof EXPLORATION_LEVEL)[keyof typeof EXPLORATION_LEVEL];
const IDENTITY_STATUS = { CANONICAL: "canonical", UNMAPPED: "unmapped" } as const;
type IdentityStatus = (typeof IDENTITY_STATUS)[keyof typeof IDENTITY_STATUS];
export interface ExplorationFacetSelection {
  electionId?: string; categoryId?: string; distritoCode?: string;
  seccionCode?: string; circuitoCode?: string;
}
export interface ExplorationSelection extends ExplorationFacetSelection {
  electionId: string; categoryId: string; distritoCode: string;
  establecimientoCode?: string; mesaCode?: number; requestedLevel: ExplorationLevel;
}
interface ElectionOption { id: string; year: number; round: string; label: string; }
interface TextOption { code: string; name: string | null; }
interface CategoryOption { id: string; name: string; }
interface MesaOption { code: number; }
export interface ExplorationFacets {
  elections: ElectionOption[]; categories: CategoryOption[];
  distritos: TextOption[]; secciones: TextOption[]; circuitos: TextOption[];
  establecimientos: TextOption[]; mesas: MesaOption[];
  availableLevels: ExplorationLevel[];
}
export interface ExplorationParty {
  identityStatus: IdentityStatus; canonicalPartyId: string | null; displayName: string | null;
  listId: string | null; votes: number; voteShare: string | null;
}
export interface ExplorationSourceAudit { kind: string; rows: number; votes: number; }
export interface ExplorationOk {
  status: "ok"; sourceKind: "official"; level: ExplorationLevel; sourceGranularity: ExplorationLevel;
  electionYear: number; electionRound: string; totalVotes: number;
  mesaCount: number | null; parties: ExplorationParty[]; archiveEntryIds: string[];
  sourceAudit: ExplorationSourceAudit[];
}
export interface ExplorationRefusal { status: "no_rows" | "source_unavailable" | "selection_invalid";
  reason: string; counts: Record<string, number>; }
export type ExplorationResult = ExplorationOk | ExplorationRefusal;
interface RpcResponse { data: unknown; error: { message: string } | null; }
export interface ExplorationRpcClient { rpc(name: string, args: Record<string, unknown>): Promise<RpcResponse>; }
export class ResultsExplorationContractError extends Error {
  constructor(readonly code: "results_exploration_facets_contract" | "results_exploration_official_contract" | "results_exploration_refusal_contract", detail: string) {
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
    return { status, reason: stringField(value, "reason"), counts: countFields(value["counts"]) };
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
export function hasOnlyOfficialSourceAudit(audit: ExplorationSourceAudit[]): boolean {
  return audit.length === 1 && audit[0]?.kind === "official";
}
function parseOfficial(value: unknown): ExplorationResult {
  if (!isRecord(value)) {
    throw new ResultsExplorationContractError("results_exploration_official_contract", "malformed success payload");
  }
  const refused = parseRefusal(value);
  if (refused) return refused;
  try {
    const level = value["level"];
    const sourceGranularity = value["source_granularity"];
    const totalVotes = nonnegativeInteger(value, "total_votes");
    const sourceAudit = parseSourceAudit(value["source_audit"]);
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
    };
  } catch (error) {
    if (error instanceof ResultsExplorationContractError) throw error;
    throw new ResultsExplorationContractError("results_exploration_official_contract", "malformed success payload");
  }
}
function parseTextOptions(value: unknown): TextOption[] {
  if (!Array.isArray(value)) throw new Error("invalid options");
  return value.map((option) => {
    if (!isRecord(option)) throw new Error("invalid option");
    return { code: stringField(option, "code"), name: nullableStringField(option, "name") };
  });
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
    };
  } catch {
    throw new ResultsExplorationContractError("results_exploration_facets_contract", "malformed facets payload");
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
    const match = /^([0-9]+)([A-Za-z])?$/.exec(raw.circuitoCode.trim());
    circuitoCode = match?.[1]
      ? match[1].padStart(match[2] ? 4 : 5, "0") + (match[2]?.toUpperCase() ?? "")
      : null;
  }
  const establecimientoCode = raw.establecimientoCode?.trim() || undefined;
  const mesaCode = raw.mesaCode === undefined || !/^[0-9]+$/.test(raw.mesaCode.trim())
    ? raw.mesaCode === undefined ? undefined : null
    : Number(raw.mesaCode.trim());
  const invalid = Object.fromEntries(Object.entries({ distritoCode, seccionCode, circuitoCode, mesaCode })
    .filter(([, value]) => value === null)
    .map(([key]) => [key, 1]));
  if (Object.keys(invalid).length > 0) {
    return { status: "invalid", reason: "administrative selectors are malformed", counts: invalid };
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
    });
    if (error) throw new Error(`results_exploration_facets failed: ${error.message}`);
    return parseFacets(data);
  }
  async official(selection: ExplorationSelection): Promise<ExplorationResult> {
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
