import { describe, expect, it } from "vitest";
import { ResultsExplorationContractError, ResultsExplorationRepository,
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
      p_seccion_code: null, p_circuito_code: null,
    } }]);
  });
  it("returns exact figures, actual granularity, election shape, and explicit unmapped identity", async () => {
    const fake = rpcClient({ results_exploration_official: {
      status: "ok", source_kind: "official", level: "seccion", source_granularity: "mesa",
      election_year: 2025, election_round: "legislativas", total_votes: 300, mesa_count: 2,
      source_audit: [{ kind: "official", rows: 4, votes: 300 }],
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
      parties: [{ identityStatus: "canonical", canonicalPartyId: "lla", votes: 200 },
        { identityStatus: "unmapped", listId: "999", votes: 100 }],
    });
  });
  it("keeps mesa count unavailable when the source did not publish mesa rows", async () => {
    const fake = rpcClient({ results_exploration_official: {
      status: "ok", source_kind: "official", level: "distrito", source_granularity: "distrito",
      election_year: 2025, election_round: "provinciales", total_votes: 23,
      source_audit: [{ kind: "official", rows: 1, votes: 23 }],
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
      source_audit: [{ kind: "official", rows: 1, votes: totalVotes }], parties: [{ identity_status: "unmapped",
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
    } });
    await expect(new ResultsExplorationRepository(fake.client).official(SELECTION)).resolves.toEqual({
      status: "source_unavailable", reason,
      counts: { includedDistritoRows: 1, requestedMesaRows: 0 },
    });
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
      status: "invalid", reason: "administrative selectors are malformed",
      counts: { distritoCode: 1, seccionCode: 1 },
    });
  });
});
