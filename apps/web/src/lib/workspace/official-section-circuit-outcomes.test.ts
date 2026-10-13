import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { officialSectionCircuitRpcSchema, parseOfficialSectionCircuitOutcomes } from "./official-section-circuit-outcomes";

// Exact known branch keys from 20261013000000; do not spread other RPC envelopes.
function payload() {
  return { status: "ok", authorization_status: "authorized", source_kind: "official", level: "seccion",
    circuit_membership: "known", category_applicability: "district_reported_categories", truncated: false,
    unassigned: { catalogue_mesas_without_membership: 0, membership_quarantined_mesas: 0,
      membership_quarantine_reasons: {}, completeness_quarantines: 0, completeness_quarantine_reasons: {}, unexpected_status_mesas: 0 },
    circuits: [{ circuito_code: "00248", positive_total: 100, status: "complete",
      counts: { expected: 1, counted: 1, not_counted: 0, missing: 0, unexpected: 0, quarantined: 0 },
      parties: [{ identity_status: "unmapped", canonical_party_id: null, display_name: null, list_id: "110", votes: 100 }] }] };
}
describe("strict circuit RPC adapter", () => {
  it("accepts the exact known SQL branch", () => expect(parseOfficialSectionCircuitOutcomes(payload()).status).toBe("ok"));
  it("accepts the exact membership unknown SQL branch without category_applicability", () => {
    const p = payload();
    expect(parseOfficialSectionCircuitOutcomes({ status: "ok", authorization_status: "authorized", source_kind: "official", level: "seccion",
      circuit_membership: "unknown", circuits: [], unassigned: p.unassigned, truncated: false }).status).toBe("ok");
  });
  it.each(["extra", "counts", "votes", "status", "duplicates", "reasons"])("refuses invalid %s", (kind) => {
    const p = payload();
    if (kind === "extra") Object.assign(p, { invented: true });
    if (kind === "counts") p.circuits[0]!.counts.counted = 0;
    if (kind === "votes") p.circuits[0]!.positive_total = 99;
    if (kind === "status") p.circuits[0]!.status = "partial";
    if (kind === "duplicates") p.circuits.push(p.circuits[0]!);
    if (kind === "reasons") p.unassigned.completeness_quarantines = 1;
    expect(parseOfficialSectionCircuitOutcomes(p).status).toBe("unavailable");
  });
  it.each([
    { status: "authorization_denied", authorization_status: "scope_denied", truncated: false },
    { status: "authorization_denied", authorization_status: "scope_required", reason: "an exact section is required for an authorized official operation", truncated: false },
    { status: "payload_too_large", authorization_status: "authorized", total_bytes: 120001, truncated: true },
    { status: "payload_too_large", authorization_status: "authorized", total_circuits: 201, truncated: true },
    { status: "source_unavailable", authorization_status: "authorized", reason: "conflicting_result_identity", truncated: false },
    { status: "source_unavailable", authorization_status: "authorized", reason: "mesa_results_required", truncated: false },
    { status: "source_unavailable", authorization_status: "authorized", reason: "official rows without exact section identity were excluded", exclusions: [{ reason: "official_rows_without_section_identity" }], source_exclusions: [], truncated: false },
    { status: "selection_invalid", authorization_status: "authorized", reason: "unknown election_id", counts: { unknown_election_id: 1 }, source_exclusions: [], truncated: false },
    { status: "no_rows", authorization_status: "authorized", reason: "no official rows exist for the selected scope", counts: { selected_rows: 0, requested_level_seccion: 0 }, source_exclusions: [], truncated: false },
    { status: "source_unavailable", authorization_status: "authorized", reason: "the selected scope mixes source granularities and cannot be summed safely", counts: { included_mesa_rows: 2, included_seccion_rows: 1 }, source_exclusions: [], truncated: false },
  ])("mirrors and suppresses exact refusal $status/$reason", p => {
    expect(officialSectionCircuitRpcSchema.safeParse(p).success).toBe(true);
    expect(parseOfficialSectionCircuitOutcomes(p)).toEqual({ status: "unavailable" });
    expect(officialSectionCircuitRpcSchema.safeParse({ ...p, extra: 1 }).success).toBe(false);
  });
  it("never exposes refused payloads", () => {
    expect(parseOfficialSectionCircuitOutcomes({ status: "source_unavailable", authorization_status: "authorized", reason: "mesa_results_required", truncated: false }).status).toBe("unavailable");
    expect(parseOfficialSectionCircuitOutcomes({ status: "payload_too_large", authorization_status: "authorized", total_circuits: 201, truncated: true }).status).toBe("unavailable");
  });
});
