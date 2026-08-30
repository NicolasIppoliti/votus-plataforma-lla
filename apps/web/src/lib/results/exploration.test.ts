import { describe, expect, it } from "vitest";
import {
  formatFacetOptionLabel,
  normalizeExplorationParams,
  ResultsExplorationContractError,
  ResultsExplorationRepository,
  type ExplorationSelection,
} from "./exploration";

const SELECTION: ExplorationSelection = {
  electionId: "00000000-0000-0000-0000-000000000001",
  categoryId: "00000000-0000-0000-0000-000000000002",
  distritoCode: "02", seccionCode: "027", requestedLevel: "seccion",
};
function rpcClient(results: Record<string, unknown>) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  return { calls, client: { rpc(name: string, args: Record<string, unknown>) {
    calls.push({ name, args });
    return Promise.resolve({ data: results[name], error: null });
  } } };
}

describe("official results exploration repository", () => {
  it("loads source-backed selectors from a cold start", async () => {
    const fake = rpcClient({ results_exploration_facets: {
      status: "ok",
      elections: [{ id: SELECTION.electionId, year: 2025, round: "legislativas", label: "2025 legislativas" }],
      categories: [], distritos: [], secciones: [], circuitos: [], establecimientos: [],
      mesas: [], available_levels: [],
    } });
    const result = await new ResultsExplorationRepository(fake.client).facets({});
    expect(result.elections).toEqual([{ id: SELECTION.electionId, year: 2025,
      round: "legislativas", label: "2025 legislativas" }]);
    expect(fake.calls).toEqual([{ name: "results_exploration_facets", args: {
      p_election_id: null, p_category_id: null, p_distrito_code: null,
      p_seccion_code: null, p_circuito_code: null, p_establecimiento_code: null,
    } }]);
  });

  it("reaches the production facets RPC with the complete establishment-scoped lineage", async () => {
    const fake = rpcClient({ results_exploration_facets: {
      status: "ok", elections: [], categories: [], distritos: [], secciones: [], circuitos: [],
      establecimientos: [], mesas: [{ code: 7 }], available_levels: ["mesa"],
    } });
    await new ResultsExplorationRepository(fake.client).facets({
      electionId: SELECTION.electionId, categoryId: SELECTION.categoryId,
      distritoCode: "02", seccionCode: "027", circuitoCode: "00001",
      establecimientoCode: "E1",
    });
    expect(fake.calls).toEqual([{ name: "results_exploration_facets", args: {
      p_election_id: SELECTION.electionId, p_category_id: SELECTION.categoryId,
      p_distrito_code: "02", p_seccion_code: "027", p_circuito_code: "00001",
      p_establecimiento_code: "E1",
    } }]);
  });

  it("parses and formats explicit facet name states", async () => {
    const fake = rpcClient({ results_exploration_facets: {
      status: "ok", elections: [], categories: [],
      distritos: [
        { code: "02", name: "Buenos Aires", name_status: "present", name_variant_count: 1 },
        { code: "03", name: null, name_status: "missing", name_variant_count: 0 },
        { code: "04", name: null, name_status: "conflict", name_variant_count: 2 },
      ], secciones: [], circuitos: [], establecimientos: [], mesas: [], available_levels: [],
    } });
    const result = await new ResultsExplorationRepository(fake.client).facets({});
    expect(result.distritos).toEqual([
      { code: "02", name: "Buenos Aires", nameStatus: "present", nameVariantCount: 1 },
      { code: "03", name: null, nameStatus: "missing", nameVariantCount: 0 },
      { code: "04", name: null, nameStatus: "conflict", nameVariantCount: 2 },
    ]);
    expect(result.distritos.map(formatFacetOptionLabel)).toEqual([
      "02 — Buenos Aires", "03 — nombre no disponible", "04 — nombres contradictorios (2 variantes)",
    ]);
  });

  it.each([
    ["unknown status", { code: "02", name: null, name_status: "unknown", name_variant_count: 0 }],
    ["negative count", { code: "02", name: null, name_status: "missing", name_variant_count: -1 }],
    ["fractional count", { code: "02", name: null, name_status: "missing", name_variant_count: 0.5 }],
    ["present without a name", { code: "02", name: null, name_status: "present", name_variant_count: 1 }],
    ["missing with a name", { code: "02", name: "Picked", name_status: "missing", name_variant_count: 0 }],
    ["conflict with one variant", { code: "02", name: null, name_status: "conflict", name_variant_count: 1 }],
    ["conflict with a name", { code: "02", name: "Picked", name_status: "conflict", name_variant_count: 2 }],
  ])("fails closed on facet option %s", async (_case, option) => {
    const fake = rpcClient({ results_exploration_facets: {
      status: "ok", elections: [], categories: [], distritos: [option], secciones: [],
      circuitos: [], establecimientos: [], mesas: [], available_levels: [],
    } });
    await expect(new ResultsExplorationRepository(fake.client).facets({})).rejects.toEqual(
      new ResultsExplorationContractError("results_exploration_facets_contract", "respuesta de facetas malformada"));
  });

  it.each(["", "   "])("treats a blank form selector (%j) as absent", (blank) => {
    expect(normalizeExplorationParams({ distritoCode: blank, seccionCode: blank,
      circuitoCode: blank, establecimientoCode: blank, mesaCode: blank })).toEqual({
      status: "ok", value: {},
    });
  });

  it("refuses an orphan mesa before crossing the RPC boundary", async () => {
    const fake = rpcClient({});
    await expect(new ResultsExplorationRepository(fake.client).official({
      ...SELECTION, mesaCode: 7, requestedLevel: "mesa",
    })).rejects.toEqual(new ResultsExplorationContractError(
      "results_exploration_official_contract", "mesa requiere los niveles superiores circuito y establecimiento"));
    expect(fake.calls).toEqual([]);
  });
});

describe("query-string administrative code normalization", () => {
  it("normalizes every supported administrative selector once", () => {
    expect(normalizeExplorationParams({ distritoCode: " 2 ", seccionCode: "27", circuitoCode: "12a",
      establecimientoCode: " E-14 ", mesaCode: "7" })).toEqual({ status: "ok", value: {
      distritoCode: "02", seccionCode: "027", circuitoCode: "0012A",
      establecimientoCode: "E-14", mesaCode: 7 } });
  });

  it("refuses malformed codes instead of comparing pass-through values", () => {
    expect(normalizeExplorationParams({ distritoCode: "O2", seccionCode: "2_7" })).toEqual({
      status: "invalid", reason: "los selectores administrativos están malformados",
      counts: { distritoCode: 1, seccionCode: 1 },
    });
  });
});
