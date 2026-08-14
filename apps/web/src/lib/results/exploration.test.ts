import { describe, expect, it } from "vitest";
import { formatFacetOptionLabel, ResultsExplorationContractError, ResultsExplorationRepository,
  normalizeExplorationParams, type ExplorationSelection } from "./exploration";
const SELECTION: ExplorationSelection = {
  electionId: "00000000-0000-0000-0000-000000000001",
  categoryId: "00000000-0000-0000-0000-000000000002",
  distritoCode: "02", seccionCode: "027", requestedLevel: "seccion",
};
const DISTRICT_SELECTION: ExplorationSelection = { electionId: SELECTION.electionId,
  categoryId: SELECTION.categoryId, distritoCode: SELECTION.distritoCode, requestedLevel: "distrito" };
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
  it("returns exact figures, actual granularity, election shape, and explicit unmapped identity", async () => {
    const fake = rpcClient({ results_exploration_official: {
      status: "ok", source_kind: "official", level: "seccion", source_granularity: "mesa",
      election_year: 2025, election_round: "legislativas", total_votes: 300, mesa_count: 2,
      source_audit: [{ kind: "official", rows: 4, votes: 300 }],
      source_exclusions: [{ kind: "fiscalizacion", rows: 2, votes: 1776 },
        { kind: "unknown", rows: 1, votes: 9 }],
      parties: [
        { identity_status: "canonical", canonical_party_id: "lla",
          display_name: "LA LIBERTAD AVANZA", list_id: null, votes: 200,
          vote_share: "0.66666666666666666667" },
        { identity_status: "unmapped", canonical_party_id: null,
          display_name: null, list_id: "999", votes: 100,
          vote_share: "0.33333333333333333333" },
      ],
      archive_entry_ids: ["national/2025-legislativas"],
    } });
    const result = await new ResultsExplorationRepository(fake.client).official(SELECTION);
    expect(result).toMatchObject({
      status: "ok", sourceKind: "official", level: "seccion", sourceGranularity: "mesa",
      electionYear: 2025, electionRound: "legislativas", totalVotes: 300, mesaCount: 2,
      sourceAudit: [{ kind: "official", rows: 4, votes: 300 }],
      sourceExclusions: [{ kind: "fiscalizacion", rows: 2, votes: 1776 },
        { kind: "unknown", rows: 1, votes: 9 }],
      parties: [{ identityStatus: "canonical", canonicalPartyId: "lla", votes: 200 },
        { identityStatus: "unmapped", listId: "999", votes: 100 }],
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
  it("parses a bounded official section-wide school breakdown without merging circuit identities", async () => {
    const fake = rpcClient({ results_exploration_schools: {
      status: "ok", source_kind: "official", level: "seccion",
      source_audit: [{ kind: "official", rows: 3, votes: 350 }], source_exclusions: [], exclusions: [],
      schools: [
        { circuito_code: "00001", code: "E1", name: "School one", mesa_count: 2, total_votes: 300,
          archive_entry_ids: ["national/2025-legislativas"], parties: [
          { identity_status: "canonical", canonical_party_id: "lla", display_name: "LA LIBERTAD AVANZA",
            list_id: null, votes: 200, vote_share: "0.66666666666666666667" },
          { identity_status: "unmapped", canonical_party_id: null, display_name: null,
            list_id: "999", votes: 100, vote_share: "0.33333333333333333333" }] },
        { circuito_code: "00002", code: "E1", name: "School two", mesa_count: 1, total_votes: 50,
          archive_entry_ids: ["national/2025-legislativas"], parties: [{ identity_status: "canonical",
            canonical_party_id: "lla", display_name: "LA LIBERTAD AVANZA", list_id: null,
            votes: 50, vote_share: "1" }] },
      ],
    } });
    const result = await new ResultsExplorationRepository(fake.client).schools(SELECTION);
    expect(result).toMatchObject({ status: "ok", sourceKind: "official", schools: [
      { circuitoCode: "00001", code: "E1", mesaCount: 2, totalVotes: 300,
        parties: [{ displayName: "LA LIBERTAD AVANZA", votes: 200 }, { listId: "999", votes: 100 }] },
      { circuitoCode: "00002", code: "E1", mesaCount: 1, totalVotes: 50 },
    ] });
    expect(fake.calls[0]).toEqual({ name: "results_exploration_schools", args: {
      p_election_id: SELECTION.electionId, p_category_id: SELECTION.categoryId,
      p_distrito_code: "02", p_seccion_code: "027",
    } });
  });
  it("keeps mesa count unavailable when the source did not publish mesa rows", async () => {
    const fake = rpcClient({ results_exploration_official: {
      status: "ok", source_kind: "official", level: "distrito", source_granularity: "distrito",
      election_year: 2025, election_round: "provinciales", total_votes: 23,
      source_audit: [{ kind: "official", rows: 1, votes: 23 }],
      source_exclusions: [],
      mesa_count: null, parties: [{ identity_status: "unmapped", canonical_party_id: null,
        display_name: null, list_id: "77", votes: 23, vote_share: "1" }],
      archive_entry_ids: ["pba/2025-distrito-027"],
    } });
    await expect(new ResultsExplorationRepository(fake.client).official({ electionId: SELECTION.electionId,
      categoryId: SELECTION.categoryId, distritoCode: SELECTION.distritoCode,
      requestedLevel: "distrito" })).resolves.toMatchObject({ status: "ok", mesaCount: null,
        sourceGranularity: "distrito" });
  });
  it.each([
    ["party votes", 23, 22, "1"], ["party share", 23, 23, "0.5"], ["zero-total share", 0, 0, "0"],
  ])("refuses inconsistent %s", async (_case, totalVotes, votes, voteShare) => {
    const fake = rpcClient({ results_exploration_official: {
      status: "ok", source_kind: "official", level: "distrito", source_granularity: "distrito",
      election_year: 2025, election_round: "provinciales", total_votes: totalVotes, mesa_count: null,
      source_audit: [{ kind: "official", rows: 1, votes: totalVotes }], source_exclusions: [],
      parties: [{ identity_status: "unmapped",
        canonical_party_id: null, display_name: null, list_id: "77", votes, vote_share: voteShare }],
      archive_entry_ids: ["pba/2025-distrito-027"],
    } });
    await expect(new ResultsExplorationRepository(fake.client).official(DISTRICT_SELECTION))
      .rejects.toBeInstanceOf(ResultsExplorationContractError);
  });
  it("accepts the SQL zero-total contract", async () => {
    const fake = rpcClient({ results_exploration_official: { status: "ok", source_kind: "official",
      level: "distrito", source_granularity: "distrito", election_year: 2025, election_round: "provinciales",
      total_votes: 0, mesa_count: null, source_audit: [{ kind: "official", rows: 1, votes: 0 }],
      source_exclusions: [],
      parties: [{ identity_status: "unmapped", canonical_party_id: null, display_name: null, list_id: "77",
        votes: 0, vote_share: null }], archive_entry_ids: ["pba/2025-distrito-027"] } });
    await expect(new ResultsExplorationRepository(fake.client).official(DISTRICT_SELECTION))
      .resolves.toMatchObject({ status: "ok", totalVotes: 0 });
  });
  it("refuses an aggregate whose row-derived audit includes fiscalizacion", async () => {
    const fake = rpcClient({ results_exploration_official: {
      status: "ok", source_kind: "official", level: "seccion", source_granularity: "mesa",
      election_year: 2025, election_round: "legislativas", total_votes: 360, mesa_count: 2,
      source_audit: [{ kind: "official", rows: 4, votes: 300 }, { kind: "fiscalizacion", rows: 1, votes: 60 }],
      source_exclusions: [],
      parties: [], archive_entry_ids: ["national/2025-legislativas", "fiscalizacion/leaked"],
    } });
    await expect(new ResultsExplorationRepository(fake.client).official(SELECTION)).rejects.toEqual(
      new ResultsExplorationContractError("results_exploration_official_contract", "malformed success payload"));
  });
  it("preserves scoped refusal counts by reason and level", async () => {
    const reason = "the published source granularity cannot support the requested finer scope";
    const fake = rpcClient({ results_exploration_official: {
      status: "source_unavailable", reason,
      counts: { included_distrito_rows: 1, requested_mesa_rows: 0 },
      source_exclusions: [{ kind: "fiscalizacion", rows: 3, votes: 90 }],
    } });
    await expect(new ResultsExplorationRepository(fake.client).official(SELECTION)).resolves.toEqual({
      status: "source_unavailable", reason,
      counts: { includedDistritoRows: 1, requestedMesaRows: 0 },
      sourceExclusions: [{ kind: "fiscalizacion", rows: 3, votes: 90 }],
    });
  });
  it("parses non-mesa school exclusions separately by official reason and excluded source", async () => {
    const fake = rpcClient({ results_exploration_schools: {
      status: "ok", source_kind: "official", level: "seccion",
      source_audit: [{ kind: "official", rows: 1, votes: 30 }],
      source_exclusions: [{ kind: "fiscalizacion", rows: 2, votes: 80 },
        { kind: "unknown", rows: 1, votes: 9 }], exclusions: [
        { reason: "official_rows_without_mesa_granularity", rows: 1, votes: 30 }],
      schools: [{ circuito_code: "00001", code: "E1", name: null, mesa_count: 1,
        total_votes: 30, archive_entry_ids: ["national/2025-legislativas"],
        parties: [{ identity_status: "unmapped", canonical_party_id: null,
          display_name: null, list_id: "110", votes: 30, vote_share: "1" }] }],
    } });
    await expect(new ResultsExplorationRepository(fake.client).schools(SELECTION)).resolves.toMatchObject({
      status: "ok", sourceAudit: [{ kind: "official", rows: 1, votes: 30 }],
      sourceExclusions: [{ kind: "fiscalizacion", rows: 2, votes: 80 },
        { kind: "unknown", rows: 1, votes: 9 }], exclusions: [
        { reason: "official_rows_without_mesa_granularity", rows: 1, votes: 30 }],
    });
  });
  it.each([
    ["selection_invalid", "the section school breakdown exceeds the bounded payload limit",
      { schools: 501, payload_school_limit: 500 }],
    ["selection_invalid", "one complete establecimiento identity carries conflicting names",
      { ambiguous_establecimiento_name: 1 }],
  ])("retains school exclusion evidence when %s refuses", async (status, reason, counts) => {
    const fake = rpcClient({ results_exploration_schools: { status, reason, counts,
      exclusions: [{ reason: "official_rows_without_mesa_code", rows: 2, votes: 40 }],
      source_exclusions: [{ kind: "fiscalizacion", rows: 3, votes: 90 }] } });
    await expect(new ResultsExplorationRepository(fake.client).schools(SELECTION)).resolves.toEqual({
      status, reason, counts: Object.fromEntries(Object.entries(counts).map(([key, value]) =>
        [key.replace(/_([a-z])/g, (_match, letter: string) => letter.toUpperCase()), value])),
      exclusions: [{ reason: "official_rows_without_mesa_code", rows: 2, votes: 40 }],
      sourceExclusions: [{ kind: "fiscalizacion", rows: 3, votes: 90 }],
    });
  });
  it.each([[{ reason: "missing", rows: 1, votes: -1 }], [{ reason: "missing", rows: 0, votes: 1 }]])(
    "fails closed on malformed school refusal exclusions %#", async (exclusions) => {
      const fake = rpcClient({ results_exploration_schools: { status: "selection_invalid",
        reason: "invalid school scope", counts: { schools: 501 }, exclusions, source_exclusions: [] } });
      await expect(new ResultsExplorationRepository(fake.client).schools(SELECTION)).rejects.toEqual(
        new ResultsExplorationContractError("results_exploration_refusal_contract", "malformed refusal payload"));
    });
  it("fails closed with named errors for malformed success and refusal payloads", async () => {
    const malformedSuccess = rpcClient({
      results_exploration_official: { status: "ok", total_votes: "300", parties: [] },
    });
    const malformedRefusal = rpcClient({
      results_exploration_official: { status: "no_rows", reason: "none", counts: { selected_rows: -1 } },
    });
    await expect(new ResultsExplorationRepository(malformedSuccess.client).official(SELECTION)).rejects.toEqual(
      new ResultsExplorationContractError("results_exploration_official_contract", "malformed success payload"));
    await expect(new ResultsExplorationRepository(malformedRefusal.client).official(SELECTION)).rejects.toEqual(
      new ResultsExplorationContractError("results_exploration_refusal_contract", "malformed refusal payload"));
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
