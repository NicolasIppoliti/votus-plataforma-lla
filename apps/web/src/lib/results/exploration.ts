import {
  parseOfficialExploration,
  parseSchoolBreakdown,
  ResultsExplorationContractError,
  type ExplorationResult,
  type SchoolBreakdownResult,
} from "./exploration-contract";

export {
  hasOnlyOfficialSourceAudit,
  ResultsExplorationContractError,
} from "./exploration-contract";
export type {
  ExplorationOk,
  ExplorationParty,
  ExplorationRefusal,
  ExplorationResult,
  ExplorationSourceAudit,
  SchoolBreakdownExclusion,
  SchoolBreakdownItem,
  SchoolBreakdownOk,
  SchoolBreakdownResult,
} from "./exploration-contract";

export const EXPLORATION_LEVEL = {
  DISTRITO: "distrito", SECCION: "seccion", CIRCUITO: "circuito",
  ESTABLECIMIENTO: "establecimiento", MESA: "mesa",
} as const;
export type ExplorationLevel = (typeof EXPLORATION_LEVEL)[keyof typeof EXPLORATION_LEVEL];
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
export function hierarchyInvalid(selection: ExplorationSelection): string | null {
  if (selection.requestedLevel === EXPLORATION_LEVEL.MESA &&
      (!selection.circuitoCode || !selection.establecimientoCode)) {
    return "mesa requiere los niveles superiores circuito y establecimiento";
  }
  if (selection.requestedLevel === EXPLORATION_LEVEL.ESTABLECIMIENTO && !selection.circuitoCode) {
    return "establecimiento requiere un circuito superior";
  }
  if (selection.requestedLevel !== EXPLORATION_LEVEL.DISTRITO && !selection.seccionCode) {
    return `${selection.requestedLevel} requiere una sección superior`;
  }
  return null;
}
function requireCompleteHierarchy(selection: ExplorationSelection): void {
  const reason = hierarchyInvalid(selection);
  if (reason) {
    throw new ResultsExplorationContractError("results_exploration_official_contract", reason);
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
function isLevel(value: unknown): value is ExplorationLevel {
  return Object.values(EXPLORATION_LEVEL).includes(value as ExplorationLevel);
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
  constructor(private readonly client: {
    rpc(name: string, args: Record<string, unknown>): Promise<{
      data: unknown; error: { message: string } | null;
    }>;
  }) {}
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
    return parseOfficialExploration(data);
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
