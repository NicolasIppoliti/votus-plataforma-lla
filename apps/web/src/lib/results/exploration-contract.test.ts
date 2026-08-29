import { describe, expect, it } from "vitest";
import {
  parseOfficialExploration,
  parseSchoolBreakdown,
  ResultsExplorationContractError,
} from "./exploration-contract";

describe("official results exploration contract", () => {
  it("returns exact figures, actual granularity, election shape, and explicit unmapped identity", () => {
    const result = parseOfficialExploration({
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
    });
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

  it("parses a bounded official section-wide school breakdown without merging circuit identities", () => {
    const result = parseSchoolBreakdown({
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
    });
    expect(result).toMatchObject({ status: "ok", sourceKind: "official", schools: [
      { circuitoCode: "00001", code: "E1", mesaCount: 2, totalVotes: 300,
        parties: [{ displayName: "LA LIBERTAD AVANZA", votes: 200 }, { listId: "999", votes: 100 }] },
      { circuitoCode: "00002", code: "E1", mesaCount: 1, totalVotes: 50 },
    ] });
  });

  it("keeps mesa count unavailable when the source did not publish mesa rows", () => {
    expect(parseOfficialExploration({
      status: "ok", source_kind: "official", level: "distrito", source_granularity: "distrito",
      election_year: 2025, election_round: "provinciales", total_votes: 23,
      source_audit: [{ kind: "official", rows: 1, votes: 23 }],
      source_exclusions: [], mesa_count: null, parties: [{ identity_status: "unmapped",
        canonical_party_id: null, display_name: null, list_id: "77", votes: 23, vote_share: "1" }],
      archive_entry_ids: ["pba/2025-distrito-027"],
    })).toMatchObject({ status: "ok", mesaCount: null, sourceGranularity: "distrito" });
  });

  it.each([
    ["party votes", 23, 22, "1"], ["party share", 23, 23, "0.5"], ["zero-total share", 0, 0, "0"],
  ])("refuses inconsistent %s", (_case, totalVotes, votes, voteShare) => {
    expect(() => parseOfficialExploration({
      status: "ok", source_kind: "official", level: "distrito", source_granularity: "distrito",
      election_year: 2025, election_round: "provinciales", total_votes: totalVotes, mesa_count: null,
      source_audit: [{ kind: "official", rows: 1, votes: totalVotes }], source_exclusions: [],
      parties: [{ identity_status: "unmapped",
        canonical_party_id: null, display_name: null, list_id: "77", votes, vote_share: voteShare }],
      archive_entry_ids: ["pba/2025-distrito-027"],
    })).toThrow(ResultsExplorationContractError);
  });

  it("accepts the SQL zero-total contract", () => {
    expect(parseOfficialExploration({ status: "ok", source_kind: "official",
      level: "distrito", source_granularity: "distrito", election_year: 2025, election_round: "provinciales",
      total_votes: 0, mesa_count: null, source_audit: [{ kind: "official", rows: 1, votes: 0 }],
      source_exclusions: [],
      parties: [{ identity_status: "unmapped", canonical_party_id: null, display_name: null, list_id: "77",
        votes: 0, vote_share: null }], archive_entry_ids: ["pba/2025-distrito-027"] }))
      .toMatchObject({ status: "ok", totalVotes: 0 });
  });

  it("refuses an aggregate whose row-derived audit includes fiscalizacion", () => {
    expect(() => parseOfficialExploration({
      status: "ok", source_kind: "official", level: "seccion", source_granularity: "mesa",
      election_year: 2025, election_round: "legislativas", total_votes: 360, mesa_count: 2,
      source_audit: [{ kind: "official", rows: 4, votes: 300 },
        { kind: "fiscalizacion", rows: 1, votes: 60 }],
      source_exclusions: [], parties: [],
      archive_entry_ids: ["national/2025-legislativas", "fiscalizacion/leaked"],
    })).toThrow(new ResultsExplorationContractError(
      "results_exploration_official_contract", "malformed success payload"));
  });

  it("preserves scoped refusal counts by reason and level", () => {
    const reason = "the published source granularity cannot support the requested finer scope";
    expect(parseOfficialExploration({
      status: "source_unavailable", reason,
      counts: { included_distrito_rows: 1, requested_mesa_rows: 0 },
      source_exclusions: [{ kind: "fiscalizacion", rows: 3, votes: 90 }],
    })).toEqual({
      status: "source_unavailable", reason,
      counts: { includedDistritoRows: 1, requestedMesaRows: 0 },
      sourceExclusions: [{ kind: "fiscalizacion", rows: 3, votes: 90 }],
    });
  });

  it("parses non-mesa school exclusions separately by official reason and excluded source", () => {
    expect(parseSchoolBreakdown({
      status: "ok", source_kind: "official", level: "seccion",
      source_audit: [{ kind: "official", rows: 1, votes: 30 }],
      source_exclusions: [{ kind: "fiscalizacion", rows: 2, votes: 80 },
        { kind: "unknown", rows: 1, votes: 9 }], exclusions: [
        { reason: "official_rows_without_mesa_granularity", rows: 1, votes: 30 }],
      schools: [{ circuito_code: "00001", code: "E1", name: null, mesa_count: 1,
        total_votes: 30, archive_entry_ids: ["national/2025-legislativas"],
        parties: [{ identity_status: "unmapped", canonical_party_id: null,
          display_name: null, list_id: "110", votes: 30, vote_share: "1" }] }],
    })).toMatchObject({
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
  ] as const)("retains school exclusion evidence when %s refuses", (status, reason, counts) => {
    expect(parseSchoolBreakdown({ status, reason, counts,
      exclusions: [{ reason: "official_rows_without_mesa_code", rows: 2, votes: 40 }],
      source_exclusions: [{ kind: "fiscalizacion", rows: 3, votes: 90 }] })).toEqual({
      status, reason, counts: Object.fromEntries(Object.entries(counts).map(([key, value]) =>
        [key.replace(/_([a-z])/g, (_match, letter: string) => letter.toUpperCase()), value])),
      exclusions: [{ reason: "official_rows_without_mesa_code", rows: 2, votes: 40 }],
      sourceExclusions: [{ kind: "fiscalizacion", rows: 3, votes: 90 }],
    });
  });

  it.each([[{ reason: "missing", rows: 1, votes: -1 }], [{ reason: "missing", rows: 0, votes: 1 }]])(
    "fails closed on malformed school refusal exclusions %#", (exclusions) => {
      expect(() => parseSchoolBreakdown({ status: "selection_invalid",
        reason: "invalid school scope", counts: { schools: 501 }, exclusions,
        source_exclusions: [] })).toThrow(new ResultsExplorationContractError(
        "results_exploration_refusal_contract", "malformed refusal payload"));
    });

  it("fails closed with named errors for malformed success and refusal payloads", () => {
    expect(() => parseOfficialExploration(
      { status: "ok", total_votes: "300", parties: [] },
    )).toThrow(new ResultsExplorationContractError(
      "results_exploration_official_contract", "malformed success payload"));
    expect(() => parseOfficialExploration(
      { status: "no_rows", reason: "none", counts: { selected_rows: -1 } },
    )).toThrow(new ResultsExplorationContractError(
      "results_exploration_refusal_contract", "malformed refusal payload"));
  });
});
