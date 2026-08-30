import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ bundle: vi.fn(), client: vi.fn() }));
vi.mock("server-only", () => ({})); vi.mock("../supabase/server-client", () => ({ createSupabaseServerClient: mocks.client }));
vi.mock("./context", () => ({ authorizedOfficialComparisonBundle: mocks.bundle }));
const { loadAuthorizedOfficialComparisonEvidence } = await import("./official-comparison-evidence");
const LEFT = { electionId: "10000000-0000-4000-8000-000000000001", categoryId: "20000000-0000-4000-8000-000000000001", distritoCode: "02", seccionCode: "027", circuitoCode: null, establecimientoCode: null, mesaCode: null, requestedLevel: "seccion" as const };
const RIGHT = { ...LEFT, electionId: "10000000-0000-4000-8000-000000000002", categoryId: "20000000-0000-4000-8000-000000000002" };
const authorized = { authorization_status: "authorized", truncated: false };
const sourceExclusions = [{ kind: "fiscalizacion", rows: 2, votes: 20 }, { kind: "telegrama", rows: 3, votes: 30 }];
function result(year: number, sourceGranularity: "mesa" | "seccion", archiveEntryId: string) { return { status: "ok", source_kind: "official", level: "seccion", source_granularity: sourceGranularity, election_year: year, election_round: "generales", total_votes: 100, mesa_count: sourceGranularity === "mesa" ? 1 : null, parties: [{ identity_status: "canonical", canonical_party_id: "canonical-party", display_name: year === 2023 ? "Party 2023" : "Party 2025", list_id: null, votes: 100, vote_share: "1" }], source_audit: [{ kind: "official", rows: 1, votes: 100 }], source_exclusions: sourceExclusions.map((entry) => ({ ...entry })), archive_entry_ids: [archiveEntryId], truncated: false }; }
function reference(selection: typeof LEFT, year: number, total = 1) { const item = { election_id: selection.electionId, year, round: "generales", category_id: selection.categoryId, category_name: `Category ${year}`, distrito_code: selection.distritoCode, distrito_name: "Buenos Aires", seccion_code: selection.seccionCode, seccion_name: "Exact section", circuito_code: null, circuito_name: null, establecimiento_code: null, establecimiento_name: null }; return { status: "ok", source_kind: "official", items: Array.from({ length: Math.min(total, 200) }, (_, index) => ({ ...item, jurisdiction_id: `${year}-reference-${index + 1}`, mesa_code: index + 1 })), source_exclusions: sourceExclusions.map(({ kind, rows }) => ({ kind, reason: "non_official_source", rows })), total, authorization_status: "authorized", truncated: total > 200 }; }
function provenance(archiveEntryId: string) { return { status: "ok", source_kind: "official", source_audit: [{ kind: "official", rows: 1, votes: 100 }], source_exclusions: sourceExclusions.map((entry) => ({ ...entry })), archive_entry_ids: [archiveEntryId], sources: [{ id: archiveEntryId, metadata_status: "available", capability: "national", mime: "text/csv", bytes: 120, fetched_at: "2026-01-01T00:00:00Z", status: "ok", sha256: "a".repeat(64) }], total: 1, ...authorized }; }
function validBundle() { const leftArchive = "official/archive-2023", rightArchive = "official/archive-2025"; return { comparison: { status: "ok", left: result(2023, "mesa", leftArchive), right: result(2025, "mesa", rightArchive), truncated: false }, leftReference: reference(LEFT, 2023), rightReference: reference(RIGHT, 2025), leftProvenance: provenance(leftArchive), rightProvenance: provenance(rightArchive) }; }
beforeEach(() => { mocks.client.mockReset().mockResolvedValue({}); mocks.bundle.mockReset().mockResolvedValue(validBundle()); });
describe("loadAuthorizedOfficialComparisonEvidence", () => {
  it("returns one all-or-nothing authorized comparison with independent sides and safe evidence", async () => {
    await expect(loadAuthorizedOfficialComparisonEvidence(LEFT, RIGHT)).resolves.toMatchObject({ status: "ok", left: { result: { electionYear: 2023, parties: [{ canonicalPartyId: "canonical-party", displayName: "Party 2023" }] }, reference: { items: [{ electionId: LEFT.electionId, categoryId: LEFT.categoryId, seccionCode: "027" }] }, provenance: { items: [{ archiveEntryId: "official/archive-2023", capability: "national" }] } }, right: { result: { electionYear: 2025, parties: [{ canonicalPartyId: "canonical-party", displayName: "Party 2025" }] }, reference: { items: [{ electionId: RIGHT.electionId, categoryId: RIGHT.categoryId, seccionCode: "027" }] }, provenance: { items: [{ archiveEntryId: "official/archive-2025", capability: "national" }] } } });
    expect(mocks.bundle).toHaveBeenCalledWith({}, LEFT, RIGHT);
    const evidence = await loadAuthorizedOfficialComparisonEvidence(LEFT, RIGHT); expect(evidence.status === "ok" ? Object.keys(evidence.left.provenance.items[0] ?? {}).sort() : []).toEqual(["archiveEntryId", "bytes", "capability", "fetchedAt", "mime", "sha256", "status"]);
  });
  it("accepts a complete 153-item reference but refuses an explicitly truncated 201-item reference", async () => {
    const complete = validBundle(); complete.leftReference = reference(LEFT, 2023, 153); complete.rightReference = reference(RIGHT, 2025, 153); mocks.bundle.mockResolvedValueOnce(complete);
    const evidence = await loadAuthorizedOfficialComparisonEvidence(LEFT, RIGHT);
    expect(evidence.status === "ok" ? [evidence.left.reference.items.length, evidence.right.reference.items.length] : []).toEqual([153, 153]);
    const oversized = validBundle(); oversized.leftReference = reference(LEFT, 2023, 201); mocks.bundle.mockResolvedValueOnce(oversized);
    await expect(loadAuthorizedOfficialComparisonEvidence(LEFT, RIGHT)).resolves.toEqual({ status: "malformed" });
  });
  it("returns only code-owned side totals when a valid party identity is unmapped", async () => {
    const bundle = validBundle(); Object.assign(bundle.comparison.left.parties[0]!, { identity_status: "unmapped", canonical_party_id: null, display_name: null, list_id: "raw-list" }); mocks.bundle.mockResolvedValue(bundle);
    const evidence = await loadAuthorizedOfficialComparisonEvidence(LEFT, RIGHT);
    expect(evidence).toEqual({ status: "unmapped_parties", sides: [{ side: "left", partyCount: 1, totalVotes: 100 }] });
    expect(JSON.stringify(evidence)).not.toMatch(/raw-list|Party 2025|official\/archive|source_url/);
  });
  it.each([
    ["different sections", { ...RIGHT, seccionCode: "028" }], ["missing exact section", { ...RIGHT, seccionCode: null }],
    ["deeper circuit selection", { ...RIGHT, circuitoCode: "00001" }], ["non-section level", { ...RIGHT, requestedLevel: "distrito" as const }],
  ])("refuses %s before any read", async (_case, right) => { await expect(loadAuthorizedOfficialComparisonEvidence(LEFT, right)).resolves.toEqual({ status: "malformed" }); expect(mocks.bundle).not.toHaveBeenCalled(); });
  describe.each(["left", "right"] as const)("%s-side exclusion parity", (side) => {
    it.each([
      ["missing", (b: ReturnType<typeof validBundle>) => (side === "left" ? b.leftReference : b.rightReference).source_exclusions.pop()],
      ["extra", (b: ReturnType<typeof validBundle>) => (side === "left" ? b.leftProvenance : b.rightProvenance).source_exclusions.push({ kind: "web", rows: 1, votes: 1 })],
      ["kind", (b: ReturnType<typeof validBundle>) => { (side === "left" ? b.leftReference : b.rightReference).source_exclusions[0]!.kind = "carga_manual"; }],
      ["rows", (b: ReturnType<typeof validBundle>) => { (side === "left" ? b.leftReference : b.rightReference).source_exclusions[0]!.rows += 1; }],
      ["provenance votes", (b: ReturnType<typeof validBundle>) => { (side === "left" ? b.leftProvenance : b.rightProvenance).source_exclusions[0]!.votes += 1; }],
      ["reordered", (b: ReturnType<typeof validBundle>) => { (side === "left" ? b.leftProvenance : b.rightProvenance).source_exclusions.reverse(); }],
    ] as const)("refuses a %s mismatch without returning side data", async (_mismatch, mutate) => {
      const bundle = validBundle(); mutate(bundle); mocks.bundle.mockResolvedValue(bundle);
      const evidence = await loadAuthorizedOfficialComparisonEvidence(LEFT, RIGHT);
      expect(evidence).toEqual({ status: "malformed" }); expect(evidence).not.toHaveProperty("left"); expect(evidence).not.toHaveProperty("right");
    });
  });
  it.each([
    ["duplicate canonical IDs", (b: ReturnType<typeof validBundle>) => { b.comparison.left.parties.push({ ...b.comparison.left.parties[0]!, votes: 0, vote_share: "0" }); }],
    ["blank canonical ID", (b: ReturnType<typeof validBundle>) => { b.comparison.right.parties[0]!.canonical_party_id = " "; }],
    ["truncated comparison side", (b: ReturnType<typeof validBundle>) => { b.comparison.right.truncated = true; }],
    ["truncated reference", (b: ReturnType<typeof validBundle>) => { b.leftReference.truncated = true; }],
    ["duplicate archive IDs", (b: ReturnType<typeof validBundle>) => { b.rightProvenance.archive_entry_ids.push(b.rightProvenance.archive_entry_ids[0]!); }],
    ["non-exact archive set", (b: ReturnType<typeof validBundle>) => { b.leftProvenance.archive_entry_ids[0] = "official/other"; b.leftProvenance.sources[0]!.id = "official/other"; }],
    ["unsafe provenance URL", (b: ReturnType<typeof validBundle>) => { Object.assign(b.rightProvenance.sources[0]!, { source_url: "https://private.invalid/archive" }); }],
    ["unsafe provenance path", (b: ReturnType<typeof validBundle>) => { Object.assign(b.leftProvenance.sources[0]!, { archived_path: "/private/archive.csv" }); }],
    ["non-official result audit", (b: ReturnType<typeof validBundle>) => { b.comparison.left.source_audit[0]!.kind = "fiscalizacion"; }],
    ["non-official provenance audit", (b: ReturnType<typeof validBundle>) => { b.rightProvenance.source_audit[0]!.kind = "fiscalizacion"; }],
    ["foreign reference section", (b: ReturnType<typeof validBundle>) => { b.leftReference.items[0]!.seccion_code = "028"; }],
  ])("fails the whole evidence closed for %s", async (_case, mutate) => { const bundle = validBundle(); mutate(bundle); mocks.bundle.mockResolvedValue(bundle); await expect(loadAuthorizedOfficialComparisonEvidence(LEFT, RIGHT)).resolves.toEqual({ status: "malformed" }); });
  it.each([["authorization_denied", "authorization_denied"], ["payload_too_large", "payload_too_large"], ["operation_unavailable", "unavailable"]])("returns no partial figures when one side reports %s", async (rawStatus, expectedStatus) => { const bundle = validBundle(); mocks.bundle.mockResolvedValue({ ...bundle, comparison: { status: rawStatus, side: "right", truncated: rawStatus === "payload_too_large" } }); const evidence = await loadAuthorizedOfficialComparisonEvidence(LEFT, RIGHT); expect(evidence).toEqual({ status: expectedStatus }); expect(evidence).not.toHaveProperty("left"); expect(evidence).not.toHaveProperty("right"); });
  it("hides transport failures without returning partial provider data", async () => { mocks.bundle.mockRejectedValue(new Error("private provider failure")); await expect(loadAuthorizedOfficialComparisonEvidence(LEFT, RIGHT)).resolves.toEqual({ status: "unavailable" }); });
});
