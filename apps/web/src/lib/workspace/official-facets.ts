import "server-only";
import { EXPLORATION_LEVEL, type ExplorationFacetExclusion, type ExplorationFacetSelection, type ExplorationFacets, type FacetOption } from "@/lib/results/exploration";
import { createSupabaseServerClient } from "@/lib/supabase/server-client";
import { authorizedOfficialFacets } from "@/lib/workspace/context";

export const OFFICIAL_FACETS_ERROR = { AUTHORIZATION_DENIED: "authorization_denied", UNAVAILABLE: "unavailable", PAYLOAD_TOO_LARGE: "payload_too_large", MALFORMED: "malformed", NONMEMBER: "nonmember" } as const;
export const OFFICIAL_FACET_EXCLUSION_REASON = { NON_OFFICIAL_SOURCE_ROWS:"non_official_source_rows", INCOMPLETE_LINEAGE_ROWS:"official_rows_with_incomplete_lineage", COARSE_OVERFLOW:"coarse_facets_overflow", CIRCUIT_OVERFLOW:"circuitos_overflow", ESTABLISHMENT_OVERFLOW:"establecimientos_overflow", MESA_OVERFLOW:"mesas_overflow" } as const;
type OfficialFacetsErrorCode = (typeof OFFICIAL_FACETS_ERROR)[keyof typeof OFFICIAL_FACETS_ERROR];
type OfficialFacetExclusionReason = (typeof OFFICIAL_FACET_EXCLUSION_REASON)[keyof typeof OFFICIAL_FACET_EXCLUSION_REASON];
type OfficialFacetDiagnosticReason = "facets.metadata.distrito_inconsistent" | "facets.metadata.seccion_inconsistent" | "facets.row.round_invalid" | "facets.row.category_name_invalid" | "facets.row.distrito_code_invalid" | "facets.row.seccion_code_invalid";
const diagnosticReasons = new WeakMap<Error, OfficialFacetDiagnosticReason>();
function malformed(reason?: OfficialFacetDiagnosticReason): AuthorizedOfficialFacetsError {
  const error = new AuthorizedOfficialFacetsError(OFFICIAL_FACETS_ERROR.MALFORMED);
  if (reason) diagnosticReasons.set(error, reason);
  return error;
}
export interface OfficialFacetExclusion extends ExplorationFacetExclusion { reason: OfficialFacetExclusionReason; }
export class AuthorizedOfficialFacetsError extends Error {
  readonly exclusions:readonly OfficialFacetExclusion[];
  constructor(readonly code:OfficialFacetsErrorCode,exclusions:readonly OfficialFacetExclusion[]=[]){super(`authorized official facets: ${code}`);this.name="AuthorizedOfficialFacetsError";this.exclusions=Object.freeze(exclusions.map((item)=>Object.freeze({...item})));}
}
interface FlatFacet { electionId: string; year: number; round: string; categoryId: string; categoryName: string; distritoCode: string; distrito: FacetOption; seccionCode: string; seccion: FacetOption; }
interface DeepParent { electionId: string; categoryId: string; distritoCode: string; seccionCode: string; }
interface CircuitFacet extends DeepParent { circuitoCode: string; circuito: FacetOption; }
interface EstablishmentFacet extends CircuitFacet { establecimientoCode: string; establecimiento: FacetOption; }
interface MesaFacet extends DeepParent { circuitoCode: string; establecimientoCode: string; mesaCode: number; }
interface ParsedFacets { rows: FlatFacet[]; circuitos: CircuitFacet[]; establecimientos: EstablishmentFacet[]; mesas: MesaFacet[]; exclusions: OfficialFacetExclusion[]; }
type Loader = (selection: ExplorationFacetSelection) => Promise<unknown>;
const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const ROW_KEYS = ["category_id","category_name","distrito_code","distrito_name","distrito_name_status","distrito_name_variant_count","election_id","round","seccion_code","seccion_name","seccion_name_status","seccion_name_variant_count","year"] as const;
const CIRCUIT_KEYS = ["category_id","circuito_code","circuito_name","circuito_name_status","circuito_name_variant_count","distrito_code","election_id","seccion_code"] as const;
const ESTABLISHMENT_KEYS = ["category_id","circuito_code","distrito_code","election_id","establecimiento_code","establecimiento_name","establecimiento_name_status","establecimiento_name_variant_count","seccion_code"] as const;
const MESA_KEYS = ["category_id","circuito_code","distrito_code","election_id","establecimiento_code","mesa_code","seccion_code"] as const;
const record = (value: unknown): Record<string, unknown> | null => typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean { return Object.keys(value).sort().join("\0") === [...keys].sort().join("\0"); }
function text(value: unknown): string | null { return typeof value === "string" && value.length > 0 && value.trim() === value ? value : null; }
function metadata(value: Record<string, unknown>, prefix: "distrito" | "seccion" | "circuito" | "establecimiento"): FacetOption | null {
  const code = text(value[`${prefix}_code`]), name = value[`${prefix}_name`], status = value[`${prefix}_name_status`], count = value[`${prefix}_name_variant_count`];
  if (!code || (name !== null && !text(name)) || !Number.isSafeInteger(count) || Number(count) < 0) return null;
  if (status === "present" && typeof name === "string" && count === 1) return { code, name, nameStatus: status, nameVariantCount: count };
  if (status === "missing" && name === null && count === 0) return { code, name, nameStatus: status, nameVariantCount: count };
  if (status === "conflict" && name === null && Number(count) >= 2) return { code, name, nameStatus: status, nameVariantCount: Number(count) };
  return null;
}
function parent(value: Record<string, unknown>): DeepParent | null {
  const electionId = text(value["election_id"]), categoryId = text(value["category_id"]), distritoCode = text(value["distrito_code"]), seccionCode = text(value["seccion_code"]);
  return electionId && UUID.test(electionId) && categoryId && UUID.test(categoryId) && distritoCode && seccionCode ? { electionId, categoryId, distritoCode, seccionCode } : null;
}
function noDuplicates<T>(rows: T[], key: (row: T) => string): T[] {
  const values = new Set<string>(); for (const row of rows) { const id=key(row); if(values.has(id)) throw new AuthorizedOfficialFacetsError(OFFICIAL_FACETS_ERROR.MALFORMED); values.add(id); } return rows;
}
function consistent<T>(rows:T[],key:(row:T)=>string,project:(row:T)=>unknown,reason?:OfficialFacetDiagnosticReason):void {
  const values = new Map<string,string>();
  for (const row of rows) {
    const id = key(row), value = JSON.stringify(project(row));
    if (values.has(id) && values.get(id) !== value) {
      const error = new AuthorizedOfficialFacetsError(OFFICIAL_FACETS_ERROR.MALFORMED);
      if (reason) diagnosticReasons.set(error, reason);
      throw error;
    }
    values.set(id, value);
  }
}
function parseExclusions(value:unknown):OfficialFacetExclusion[]{if(!Array.isArray(value)||value.length>4)throw new AuthorizedOfficialFacetsError(OFFICIAL_FACETS_ERROR.MALFORMED);const reasons=new Set<string>();return value.map((raw)=>{const item=record(raw),reason=item?.["reason"],rows=item?.["rows"];if(!item||!exactKeys(item,["reason","rows"])||typeof reason!=="string"||!Object.values(OFFICIAL_FACET_EXCLUSION_REASON).includes(reason as OfficialFacetExclusionReason)||!Number.isSafeInteger(rows)||Number(rows)<=0||reasons.has(reason))throw new AuthorizedOfficialFacetsError(OFFICIAL_FACETS_ERROR.MALFORMED);reasons.add(reason);return{reason:reason as OfficialFacetExclusionReason,rows:Number(rows)};});}
function parseRows(payload: unknown): ParsedFacets {
  const envelope = record(payload), envelopeKeys = ["status","facets","total","truncated","circuitos","establecimientos","mesas","exclusions"];
  if (!envelope || !exactKeys(envelope, envelopeKeys)) throw new AuthorizedOfficialFacetsError(OFFICIAL_FACETS_ERROR.MALFORMED);
  const facets = envelope["facets"], total = envelope["total"], rawCircuits = envelope["circuitos"], rawEstablishments = envelope["establecimientos"], rawMesas = envelope["mesas"], exclusions = parseExclusions(envelope["exclusions"]);
  if (!Array.isArray(facets) || !Array.isArray(rawCircuits) || !Array.isArray(rawEstablishments) || !Array.isArray(rawMesas) || !Number.isSafeInteger(total)) throw new AuthorizedOfficialFacetsError(OFFICIAL_FACETS_ERROR.MALFORMED);
  if(envelope["status"]==="payload_too_large"){const overflowReasons=new Set<OfficialFacetExclusionReason>([OFFICIAL_FACET_EXCLUSION_REASON.COARSE_OVERFLOW,OFFICIAL_FACET_EXCLUSION_REASON.CIRCUIT_OVERFLOW,OFFICIAL_FACET_EXCLUSION_REASON.ESTABLISHMENT_OVERFLOW,OFFICIAL_FACET_EXCLUSION_REASON.MESA_OVERFLOW]);if(envelope["truncated"]!==true||Number(total)<=200||[facets,rawCircuits,rawEstablishments,rawMesas].some((items)=>items.length!==0)||exclusions.length===0||exclusions.some((item)=>!overflowReasons.has(item.reason)||item.rows<=200)||Math.max(...exclusions.map((item)=>item.rows))!==total)throw new AuthorizedOfficialFacetsError(OFFICIAL_FACETS_ERROR.MALFORMED);throw new AuthorizedOfficialFacetsError(OFFICIAL_FACETS_ERROR.PAYLOAD_TOO_LARGE,exclusions);}
  if(envelope["truncated"]!==false)throw new AuthorizedOfficialFacetsError(OFFICIAL_FACETS_ERROR.MALFORMED);
  if(envelope["status"]!=="ok"){if(exclusions.length!==0||facets.length!==0||rawCircuits.length!==0||rawEstablishments.length!==0||rawMesas.length!==0||total!==0)throw new AuthorizedOfficialFacetsError(OFFICIAL_FACETS_ERROR.MALFORMED);throw new AuthorizedOfficialFacetsError(envelope["status"]==="selection_invalid"?OFFICIAL_FACETS_ERROR.NONMEMBER:typeof envelope["status"]==="string"?OFFICIAL_FACETS_ERROR.AUTHORIZATION_DENIED:OFFICIAL_FACETS_ERROR.MALFORMED);}
  const auditReasons = new Set<OfficialFacetExclusionReason>([OFFICIAL_FACET_EXCLUSION_REASON.NON_OFFICIAL_SOURCE_ROWS,OFFICIAL_FACET_EXCLUSION_REASON.INCOMPLETE_LINEAGE_ROWS]);
  if (exclusions.length > 2 || exclusions.some((item) => !auditReasons.has(item.reason)) || [facets,rawCircuits,rawEstablishments,rawMesas].some((items) => items.length > 200) || total !== facets.length) throw new AuthorizedOfficialFacetsError(OFFICIAL_FACETS_ERROR.MALFORMED);
  const rows = noDuplicates(facets.map((raw: unknown) => {
    const value = record(raw), distrito = value && metadata(value,"distrito"), seccion = value && metadata(value,"seccion"), lineage = value && parent(value), distritoCode = value && text(value["distrito_code"]), seccionCode = value && text(value["seccion_code"]), round = value && text(value["round"]), categoryName = value && text(value["category_name"]), year = value?.["year"];
    if (!value || !exactKeys(value,ROW_KEYS)) throw new AuthorizedOfficialFacetsError(OFFICIAL_FACETS_ERROR.MALFORMED);
        if (!distritoCode) throw malformed("facets.row.distrito_code_invalid");
        if (!seccionCode) throw malformed("facets.row.seccion_code_invalid");
        if (!lineage) throw new AuthorizedOfficialFacetsError(OFFICIAL_FACETS_ERROR.MALFORMED);
        if (!round) throw malformed("facets.row.round_invalid");
        if (!categoryName) throw malformed("facets.row.category_name_invalid");
        if (!Number.isSafeInteger(year) || Number(year)<0 || !distrito || !seccion) throw new AuthorizedOfficialFacetsError(OFFICIAL_FACETS_ERROR.MALFORMED);
    return { ...lineage, year:Number(year), round, categoryName, distrito, seccion };
  }), (row) => [row.electionId,row.categoryId,row.distritoCode,row.seccionCode].join("\0"));
  const circuitos = noDuplicates(rawCircuits.map((raw: unknown) => { const value=record(raw), lineage=value&&parent(value), circuito=value&&metadata(value,"circuito"); if(!value||!exactKeys(value,CIRCUIT_KEYS)||!lineage||!circuito) throw new AuthorizedOfficialFacetsError(OFFICIAL_FACETS_ERROR.MALFORMED); return {...lineage,circuitoCode:circuito.code,circuito}; }), (row) => [row.electionId,row.categoryId,row.distritoCode,row.seccionCode,row.circuitoCode].join("\0"));
  const establecimientos = noDuplicates(rawEstablishments.map((raw: unknown) => { const value=record(raw), lineage=value&&parent(value), circuitoCode=value&&text(value["circuito_code"]), establecimiento=value&&metadata(value,"establecimiento"); if(!value||!exactKeys(value,ESTABLISHMENT_KEYS)||!lineage||!circuitoCode||!establecimiento) throw new AuthorizedOfficialFacetsError(OFFICIAL_FACETS_ERROR.MALFORMED); return {...lineage,circuitoCode,circuito:{code:circuitoCode,name:null,nameStatus:"missing" as const,nameVariantCount:0},establecimientoCode:establecimiento.code,establecimiento}; }), (row) => [row.electionId,row.categoryId,row.distritoCode,row.seccionCode,row.circuitoCode,row.establecimientoCode].join("\0"));
  const mesas = noDuplicates(rawMesas.map((raw: unknown) => { const value=record(raw), lineage=value&&parent(value), circuitoCode=value&&text(value["circuito_code"]), establecimientoCode=value&&text(value["establecimiento_code"]), mesaCode=value?.["mesa_code"]; if(!value||!exactKeys(value,MESA_KEYS)||!lineage||!circuitoCode||!establecimientoCode||!Number.isSafeInteger(mesaCode)||Number(mesaCode)<0) throw new AuthorizedOfficialFacetsError(OFFICIAL_FACETS_ERROR.MALFORMED); return {...lineage,circuitoCode,establecimientoCode,mesaCode:Number(mesaCode)}; }), (row) => [row.electionId,row.categoryId,row.distritoCode,row.seccionCode,row.circuitoCode,row.establecimientoCode,row.mesaCode].join("\0"));
  consistent(rows,(r)=>r.electionId,(r)=>[r.year,r.round]); consistent(rows,(r)=>r.categoryId,(r)=>r.categoryName); consistent(rows,(r)=>r.distritoCode,(r)=>r.distrito,"facets.metadata.distrito_inconsistent"); consistent(rows,(r)=>`${r.distritoCode}/${r.seccionCode}`,(r)=>r.seccion,"facets.metadata.seccion_inconsistent");
  return { rows,circuitos,establecimientos,mesas,exclusions };
}
function belongs(parentSelection: ExplorationFacetSelection, row: DeepParent): boolean { return row.electionId===parentSelection.electionId&&row.categoryId===parentSelection.categoryId&&row.distritoCode===parentSelection.distritoCode&&row.seccionCode===parentSelection.seccionCode; }
function assertMember(parsed: ParsedFacets, selection: ExplorationFacetSelection): void {
  if ((!selection.electionId&&(selection.categoryId||selection.distritoCode||selection.seccionCode||selection.circuitoCode||selection.establecimientoCode))||(!selection.categoryId&&(selection.distritoCode||selection.seccionCode||selection.circuitoCode||selection.establecimientoCode))||(!selection.distritoCode&&(selection.seccionCode||selection.circuitoCode||selection.establecimientoCode))||(!selection.seccionCode&&(selection.circuitoCode||selection.establecimientoCode))||(!selection.circuitoCode&&selection.establecimientoCode)) throw new AuthorizedOfficialFacetsError(OFFICIAL_FACETS_ERROR.NONMEMBER);
  let scope=parsed.rows; for(const [selected,match] of [[selection.electionId,(r:FlatFacet)=>r.electionId===selection.electionId],[selection.categoryId,(r:FlatFacet)=>r.categoryId===selection.categoryId],[selection.distritoCode,(r:FlatFacet)=>r.distritoCode===selection.distritoCode],[selection.seccionCode,(r:FlatFacet)=>r.seccionCode===selection.seccionCode]] as const){if(selected===undefined)continue;scope=scope.filter(match);if(scope.length===0)throw new AuthorizedOfficialFacetsError(OFFICIAL_FACETS_ERROR.NONMEMBER);}
  if(parsed.circuitos.some((row)=>!belongs(selection,row))||parsed.establecimientos.some((row)=>!belongs(selection,row)||row.circuitoCode!==selection.circuitoCode)||parsed.mesas.some((row)=>!belongs(selection,row)||row.circuitoCode!==selection.circuitoCode||row.establecimientoCode!==selection.establecimientoCode)) throw new AuthorizedOfficialFacetsError(OFFICIAL_FACETS_ERROR.MALFORMED);
  if(selection.circuitoCode&&!parsed.circuitos.some((r)=>r.circuitoCode===selection.circuitoCode)) throw new AuthorizedOfficialFacetsError(OFFICIAL_FACETS_ERROR.NONMEMBER);
  if(selection.establecimientoCode&&!parsed.establecimientos.some((r)=>r.establecimientoCode===selection.establecimientoCode)) throw new AuthorizedOfficialFacetsError(OFFICIAL_FACETS_ERROR.NONMEMBER);
}
function options<T,U>(rows:T[],key:(row:T)=>string,project:(row:T)=>U):U[] { const result=new Map<string,U>(); for(const row of rows) result.set(key(row),project(row)); return [...result.values()]; }
export class AuthorizedOfficialFacetRepository {
  constructor(private readonly load:Loader) {}
  async facets(selection:ExplorationFacetSelection):Promise<ExplorationFacets>{ let parsed:ParsedFacets;
    try {
      parsed = parseRows(await this.load(selection));
      assertMember(parsed,selection);
    } catch (error) {
      if (error instanceof AuthorizedOfficialFacetsError) {
        if (error.code === OFFICIAL_FACETS_ERROR.MALFORMED) {
          const reason = diagnosticReasons.get(error);
          console.error("[workspace:official_facets]", reason ? { code: error.code, reason } : { code: error.code });
        }
        throw error;
      }
      console.error("[workspace:official_facets]", { code: OFFICIAL_FACETS_ERROR.UNAVAILABLE });
      throw new AuthorizedOfficialFacetsError(OFFICIAL_FACETS_ERROR.UNAVAILABLE);
    }
    const elections=options(parsed.rows,(r)=>r.electionId,(r)=>({id:r.electionId,year:r.year,round:r.round,label:`${r.year} ${r.round}`}));
    const categoryRows=selection.electionId?parsed.rows.filter((r)=>r.electionId===selection.electionId):[], categories=options(categoryRows,(r)=>r.categoryId,(r)=>({id:r.categoryId,name:r.categoryName}));
    const districtRows=selection.categoryId?categoryRows.filter((r)=>r.categoryId===selection.categoryId):[], distritos=options(districtRows,(r)=>r.distritoCode,(r)=>r.distrito);
    const sectionRows=selection.distritoCode?districtRows.filter((r)=>r.distritoCode===selection.distritoCode):[], secciones=options(sectionRows,(r)=>r.seccionCode,(r)=>r.seccion);
    const circuitos=selection.seccionCode?options(parsed.circuitos,(r)=>r.circuitoCode,(r)=>r.circuito):[], establecimientos=selection.circuitoCode?options(parsed.establecimientos,(r)=>r.establecimientoCode,(r)=>r.establecimiento):[], mesas=selection.establecimientoCode?parsed.mesas.map((r)=>({code:r.mesaCode})):[];
    const availableLevels: ExplorationFacets["availableLevels"] = []; if(selection.distritoCode)availableLevels.push(EXPLORATION_LEVEL.DISTRITO); if(selection.seccionCode)availableLevels.push(EXPLORATION_LEVEL.SECCION); if(selection.circuitoCode)availableLevels.push(EXPLORATION_LEVEL.CIRCUITO); if(selection.circuitoCode&&establecimientos.length>0)availableLevels.push(EXPLORATION_LEVEL.ESTABLECIMIENTO); if(selection.establecimientoCode&&mesas.length>0)availableLevels.push(EXPLORATION_LEVEL.MESA);
    return {elections,categories,distritos,secciones,circuitos,establecimientos,mesas,availableLevels,exclusions:parsed.exclusions};
  }
}
export function createAuthorizedOfficialFacetRepository():AuthorizedOfficialFacetRepository { return new AuthorizedOfficialFacetRepository(async(selection)=>authorizedOfficialFacets(await createSupabaseServerClient(),selection)); }
