import type { SupabaseClient } from "@supabase/supabase-js";

export interface CoverageSelection {
  electionId: string;
  categoryId: string;
  distritoCode: string;
  seccionCode: string;
}

export interface CoverageFigure {
  observedUnits: number;
  denominatorUnits: number;
  isRandomSample: false;
}

export interface CoverageExclusion {
  reason: string;
  rows: number;
  votes: number;
}

export interface CoverageAudit {
  kind: string;
  rows: number;
  votes: number;
  mesas: number;
}

export interface CoverageMesa {
  code: number;
  circuitoCode: string | null;
  establecimientoCode: string | null;
  establecimientoName: string | null;
  covered: boolean;
  officialResultHref: string | null;
}

export interface CoverageSchool extends CoverageFigure {
  circuitoCode: string;
  code: string;
  name: string | null;
  officialArchiveEntryIds: string[];
  officialResultHref: string;
}

interface CoverageSchoolsAvailable {
  status: "available";
  exclusions: CoverageExclusion[];
  items: CoverageSchool[];
}

interface CoverageSchoolsUnavailable {
  status: "source_unavailable";
  reason: string;
  exclusions: CoverageExclusion[];
  items: [];
}

export type CoverageSchools = CoverageSchoolsAvailable | CoverageSchoolsUnavailable;

export interface CoverageProvenance {
  officialArchiveEntryIds: string[];
  fiscalizacionArchiveEntryIds: string[];
}

export interface CoverageOk {
  status: "ok";
  sourceKind: "fiscalizacion";
  isRandomSample: false;
  electionYear: number;
  electionRound: string;
  distritoCode: string;
  seccionCode: string;
  mesasCoverage: CoverageFigure;
  mesas: CoverageMesa[];
  escuelas: CoverageSchools;
  sourceAudit: CoverageAudit[];
  denominatorAudit: CoverageAudit[];
  exclusions: CoverageExclusion[];
  provenance: CoverageProvenance;
}

export interface CoverageRefusal {
  status: "denominator_unavailable" | "selection_invalid" | "source_inconsistent";
  reason: string;
  counts: Record<string, number>;
}

export type CoverageResult = CoverageOk | CoverageRefusal;

interface RpcResponse {
  data: unknown;
  error: { message: string } | null;
}

export interface CoverageRpcClient {
  rpc(name: string, args: Record<string, unknown>): Promise<RpcResponse>;
}

export class CoverageContractError extends Error {
  constructor(detail: string) {
    super(`results_exploration_coverage_contract: ${detail}`);
    this.name = "CoverageContractError";
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

function nullableString(value: Record<string, unknown>, key: string): string | null {
  const field = value[key];
  if (field !== null && typeof field !== "string") throw new Error(`invalid ${key}`);
  return field;
}

function integer(value: Record<string, unknown>, key: string): number {
  const field = value[key];
  if (typeof field !== "number" || !Number.isSafeInteger(field) || field < 0) {
    throw new Error(`invalid ${key}`);
  }
  return field;
}

function counts(value: unknown): Record<string, number> {
  if (!isRecord(value)) throw new Error("invalid counts");
  return Object.fromEntries(Object.entries(value).map(([key, count]) => {
    if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 0) {
      throw new Error("invalid counts");
    }
    return [key.replace(/_([a-z])/g, (_match, letter: string) => letter.toUpperCase()), count];
  }));
}

function figure(value: unknown): CoverageFigure {
  if (!isRecord(value) || value["is_random_sample"] !== false) throw new Error("invalid coverage");
  const observedUnits = integer(value, "observed_units");
  const denominatorUnits = integer(value, "denominator_units");
  if (denominatorUnits === 0 || observedUnits > denominatorUnits) throw new Error("invalid coverage");
  return { observedUnits, denominatorUnits, isRandomSample: false };
}

function exclusions(value: unknown): CoverageExclusion[] {
  if (!Array.isArray(value)) throw new Error("invalid exclusions");
  return value.map((entry) => {
    if (!isRecord(entry)) throw new Error("invalid exclusion");
    return { reason: stringField(entry, "reason"), rows: integer(entry, "rows"),
      votes: integer(entry, "votes") };
  });
}

function audit(value: unknown, expectedKind: "official" | "fiscalizacion"): CoverageAudit[] {
  if (!Array.isArray(value) || value.length !== 1 || !isRecord(value[0])) {
    throw new Error("invalid source audit");
  }
  const entry = value[0];
  if (entry["kind"] !== expectedKind) throw new Error("invalid source audit");
  return [{ kind: expectedKind, rows: integer(entry, "rows"), votes: integer(entry, "votes"),
    mesas: integer(entry, "mesas") }];
}

function archiveIds(value: unknown): string[] {
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string" && entry.length > 0)) {
    throw new Error("invalid provenance");
  }
  if (new Set(value).size !== value.length) throw new Error("invalid provenance");
  return value;
}

function resultHref(selection: CoverageSelection, mesa: Omit<CoverageMesa, "officialResultHref">): string | null {
  if (!mesa.circuitoCode || !mesa.establecimientoCode) return null;
  const params = new URLSearchParams({
    electionId: selection.electionId,
    categoryId: selection.categoryId,
    distritoCode: selection.distritoCode,
    seccionCode: selection.seccionCode,
    circuitoCode: mesa.circuitoCode,
    establecimientoCode: mesa.establecimientoCode,
    mesaCode: String(mesa.code),
    level: "mesa",
  });
  return `/drilldown?${params.toString()}`;
}

function schoolResultHref(selection: CoverageSelection, circuitoCode: string, code: string): string {
  const params = new URLSearchParams({
    electionId: selection.electionId,
    categoryId: selection.categoryId,
    distritoCode: selection.distritoCode,
    seccionCode: selection.seccionCode,
    circuitoCode,
    establecimientoCode: code,
    level: "establecimiento",
  });
  return `/drilldown?${params.toString()}`;
}

function parseSuccess(value: Record<string, unknown>, selection: CoverageSelection): CoverageOk {
  if (value["source_kind"] !== "fiscalizacion" || value["is_random_sample"] !== false) {
    throw new Error("invalid envelope");
  }
  const distritoCode = stringField(value, "distrito_code");
  const seccionCode = stringField(value, "seccion_code");
  if (distritoCode !== selection.distritoCode || seccionCode !== selection.seccionCode) {
    throw new Error("scope mismatch");
  }
  const mesasCoverage = figure(value["mesas_coverage"]);
  if (!Array.isArray(value["mesas"])) throw new Error("invalid mesas");
  const mesas = value["mesas"].map((raw): CoverageMesa => {
    if (!isRecord(raw) || typeof raw["covered"] !== "boolean") throw new Error("invalid mesa");
    const identity = {
      code: integer(raw, "code"),
      circuitoCode: nullableString(raw, "circuito_code"),
      establecimientoCode: nullableString(raw, "establecimiento_code"),
      establecimientoName: nullableString(raw, "establecimiento_name"),
      covered: raw["covered"],
    };
    return { ...identity, officialResultHref: resultHref(selection, identity) };
  });
  if (mesas.length !== mesasCoverage.denominatorUnits ||
      mesas.filter((mesa) => mesa.covered).length !== mesasCoverage.observedUnits) {
    throw new Error("mesa coverage mismatch");
  }
  const schoolEnvelope = value["escuelas"];
  if (!isRecord(schoolEnvelope)) {
    throw new Error("invalid escuelas");
  }
  const schoolItems = schoolEnvelope["items"];
  if (!Array.isArray(schoolItems)) throw new Error("invalid escuelas");
  const schoolExclusions = exclusions(schoolEnvelope["exclusions"]);
  let escuelas: CoverageSchools;
  if (schoolEnvelope["status"] === "source_unavailable") {
    if (schoolItems.length !== 0) throw new Error("invalid escuelas");
    escuelas = { status: "source_unavailable", reason: stringField(schoolEnvelope, "reason"),
      exclusions: schoolExclusions, items: [] };
  } else if (schoolEnvelope["status"] === "available") {
    const items = schoolItems.map((raw): CoverageSchool => {
        if (!isRecord(raw)) throw new Error("invalid school");
        const circuitoCode = stringField(raw, "circuito_code");
        const code = stringField(raw, "code");
        return { circuitoCode, code, name: nullableString(raw, "name"), ...figure(raw),
          officialArchiveEntryIds: archiveIds(raw["official_archive_entry_ids"]),
          officialResultHref: schoolResultHref(selection, circuitoCode, code) };
      });
    const identities = new Set<string>();
    for (const school of items) {
      const identity = JSON.stringify([school.circuitoCode, school.code]);
      if (identities.has(identity)) throw new Error("duplicate school identity");
      identities.add(identity);
      const schoolMesas = mesas.filter((mesa) => mesa.circuitoCode === school.circuitoCode &&
        mesa.establecimientoCode === school.code);
      if (schoolMesas.length !== school.denominatorUnits ||
          schoolMesas.filter((mesa) => mesa.covered).length !== school.observedUnits) {
        throw new Error("school coverage mismatch");
      }
    }
    escuelas = { status: "available", exclusions: schoolExclusions, items };
  } else {
    throw new Error("invalid escuelas");
  }
  const sourceAudit = audit(value["source_audit"], "fiscalizacion");
  const denominatorAudit = audit(value["denominator_audit"], "official");
  if (sourceAudit[0]?.mesas !== mesasCoverage.observedUnits ||
      denominatorAudit[0]?.mesas !== mesasCoverage.denominatorUnits ||
      denominatorAudit[0].rows === 0) throw new Error("audit mismatch");
  if (!isRecord(value["provenance"])) throw new Error("invalid provenance");
  const provenance = {
    officialArchiveEntryIds: archiveIds(value["provenance"]["official_archive_entry_ids"]),
    fiscalizacionArchiveEntryIds: archiveIds(value["provenance"]["fiscalizacion_archive_entry_ids"]),
  };
  if (provenance.officialArchiveEntryIds.length === 0 ||
      (sourceAudit[0].rows === 0) !== (provenance.fiscalizacionArchiveEntryIds.length === 0)) {
    throw new Error("provenance mismatch");
  }
  return {
    status: "ok", sourceKind: "fiscalizacion", isRandomSample: false,
    electionYear: integer(value, "election_year"), electionRound: stringField(value, "election_round"),
    distritoCode, seccionCode, mesasCoverage, mesas, escuelas, sourceAudit, denominatorAudit,
    exclusions: exclusions(value["exclusions"]), provenance,
  };
}

function parseCoverage(value: unknown, selection: CoverageSelection): CoverageResult {
  try {
    if (!isRecord(value)) throw new Error("invalid envelope");
    const status = value["status"];
    if (status === "denominator_unavailable" || status === "selection_invalid" ||
        status === "source_inconsistent") {
      return { status, reason: stringField(value, "reason"), counts: counts(value["counts"]) };
    }
    if (status !== "ok") throw new Error("invalid status");
    return parseSuccess(value, selection);
  } catch {
    throw new CoverageContractError("malformed or inconsistent payload");
  }
}

export class ResultsCoverageRepository {
  constructor(private readonly client: CoverageRpcClient) {}

  async coverage(selection: CoverageSelection): Promise<CoverageResult> {
    const { data, error } = await this.client.rpc("results_exploration_coverage", {
      p_election_id: selection.electionId,
      p_category_id: selection.categoryId,
      p_distrito_code: selection.distritoCode,
      p_seccion_code: selection.seccionCode,
    });
    if (error) throw new Error(`results_exploration_coverage failed: ${error.message}`);
    return parseCoverage(data, selection);
  }
}

export function createResultsCoverageRepository(client: SupabaseClient): ResultsCoverageRepository {
  return new ResultsCoverageRepository({
    rpc: async (name, args) => {
      const response = await client.rpc(name, args);
      return { data: response.data, error: response.error };
    },
  });
}
