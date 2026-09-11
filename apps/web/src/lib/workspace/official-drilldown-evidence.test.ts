import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ bundle: vi.fn(), client: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("../supabase/server-client", () => ({ createSupabaseServerClient: mocks.client }));
vi.mock("./context", () => ({ authorizedOfficialBundle: mocks.bundle }));
const { loadAuthorizedOfficialDrilldownEvidence } = await import("./official-drilldown-evidence");

const selection = {
  electionId: "10000000-0000-4000-8000-000000000001",
  categoryId: "20000000-0000-4000-8000-000000000001",
  distritoCode: "02", seccionCode: "027", circuitoCode: null,
  establecimientoCode: null, mesaCode: null, requestedLevel: "seccion" as const,
};
const audit = [{ kind: "official", rows: 2, votes: 300 }];
const exclusions = [{ kind: "fiscalizacion", rows: 1, votes: 20, source_url: "secret" }];
const parties = [{ identity_status: "canonical", canonical_party_id: "lla", display_name: "LLA", list_id: null, votes: 300, vote_share: "1" }];
const authorized = { authorization_status: "authorized", truncated: false };

function validBundle() {
  return {
    result: { status: "ok", source_kind: "official", category_name: "DIPUTADOS", level: "seccion", source_granularity: "mesa", election_year: 2025, election_round: "generales", total_votes: 300, mesa_count: 2, parties, source_audit: audit, source_exclusions: exclusions, archive_entry_ids: ["archive-1"], ...authorized },
    schools: { status: "ok", source_kind: "official", level: "seccion", source_audit: audit, source_exclusions: exclusions, exclusions: [], schools: [{ circuito_code: "00001", code: "E1", name: "School", mesa_count: 2, total_votes: 300, parties, archive_entry_ids: ["archive-1"] }], ...authorized },
    reference: { status: "ok", source_kind: "official", items: [{ jurisdiction_id: "30000000-0000-4000-8000-000000000001", election_id: selection.electionId, year: 2025, round: "generales", category_id: selection.categoryId, category_name: "DIPUTADOS", distrito_code: "02", distrito_name: "Buenos Aires", seccion_code: "027", seccion_name: "Coronel Rosales", circuito_code: "00001", circuito_name: null, establecimiento_code: "E1", establecimiento_name: "School", mesa_code: 1 }], source_exclusions: [{ kind: "fiscalizacion", reason: "non_official_source", rows: 1, notes: "secret" }], total: 1, ...authorized },
    provenance: { status: "ok", source_kind: "official", source_audit: audit, source_exclusions: exclusions, archive_entry_ids: ["archive-1", "archive-2"], sources: [
      { id: "archive-1", metadata_status: "available", capability: "results", mime: "application/json", bytes: 120, fetched_at: "2025-10-26T10:00:00Z", status: "ok", sha256: "a".repeat(64) },
      { id: "archive-2", metadata_status: "available", capability: "results", mime: "application/json", bytes: null, fetched_at: "2025-10-26T11:00:00Z", status: "error", sha256: null },
    ], total: 2, ...authorized },
  };
}

function resizeReference(bundle: ReturnType<typeof validBundle>, total: number): void {
  const item = bundle.reference.items[0]!;
  bundle.reference.items = Array.from({ length: Math.min(total, 200) }, (_, index) => ({ ...item, jurisdiction_id: `reference-${index + 1}`, mesa_code: index + 1 }));
  bundle.reference.total = total;
  bundle.reference.truncated = total > 200;
}

beforeEach(() => { mocks.client.mockReset().mockResolvedValue({});
  mocks.bundle.mockReset().mockResolvedValue(validBundle()); });

describe("loadAuthorizedOfficialDrilldownEvidence", () => {
  it("returns one sanitized, cross-authorized official drilldown", async () => {
    await expect(loadAuthorizedOfficialDrilldownEvidence(selection)).resolves.toMatchObject({ status: "ok", result: { level: "seccion", totalVotes: 300 },
      schools: { schools: [{ circuitoCode: "00001", code: "E1" }] },
      reference: { items: [{ electionId: selection.electionId, seccionCode: "027" }], sourceExclusions: [{ kind: "fiscalizacion", reason: "non_official_source", rows: 1 }] },
      provenance: { items: [{ archiveEntryId: "archive-1", capability: "results", status: "ok" },
        { archiveEntryId: "archive-2", capability: "results", status: "error" }], sourceExclusions: [{ kind: "fiscalizacion", rows: 1, votes: 20 }] }, });
    const evidence = await loadAuthorizedOfficialDrilldownEvidence(selection);
    expect(evidence.status === "ok" ? [Object.keys(evidence.reference.sourceExclusions[0] ?? {}).sort(), Object.keys(evidence.provenance.sourceExclusions[0] ?? {}).sort()] : []).toEqual([["kind", "reason", "rows"], ["kind", "rows", "votes"]]);
    expect(evidence.status === "ok" ? Object.keys(evidence.provenance.items[0] ?? {}).sort() : []).toEqual(["archiveEntryId", "bytes", "capability", "fetchedAt", "mime", "sha256", "status"]);
    expect(mocks.bundle).toHaveBeenCalledWith({}, selection);
  });

  it("keeps valid official evidence when schools lack complete mesa source granularity", async () => {
    const bundle = validBundle();
    mocks.bundle.mockResolvedValueOnce({
      ...bundle,
      schools: {
        status: "source_unavailable",
        reason: "the registered source publishes no complete establecimiento data",
        counts: { complete_establecimientos: 0, excluded_rows: 2, excluded_votes: 300 },
        exclusions: [{ reason: "official_rows_without_mesa_granularity", rows: 2, votes: 300 }],
        source_exclusions: [],
        ...authorized,
      },
    });

    const evidence = await loadAuthorizedOfficialDrilldownEvidence(selection);

    expect(evidence).toMatchObject({
      status: "ok",
      result: { level: "seccion", totalVotes: 300 },
      reference: { items: [{ electionId: selection.electionId, seccionCode: "027" }] },
      provenance: { items: [
        { archiveEntryId: "archive-1", capability: "results", status: "ok" },
        { archiveEntryId: "archive-2", capability: "results", status: "error" },
      ] },
      schools: {
        status: "unavailable",
        exclusions: [{ reason: "official_rows_without_mesa_granularity", rows: 2, votes: 300 }],
        sourceExclusions: [],
      },
    });
    expect(evidence.status === "ok" ? evidence.schools : null).toEqual({
      status: "unavailable",
      exclusions: [{ reason: "official_rows_without_mesa_granularity", rows: 2, votes: 300 }],
      sourceExclusions: [],
    });
  });

  it("rejects an invalid unavailable-school envelope while other evidence is valid", async () => {
    const bundle = validBundle();
    mocks.bundle.mockResolvedValueOnce({
      ...bundle,
      schools: { status: "source_unavailable", ...authorized },
    });

    await expect(loadAuthorizedOfficialDrilldownEvidence(selection)).resolves.toEqual({ status: "malformed" });
  });

  it("accepts 153 complete references and refuses the explicitly truncated 201st reference", async () => {
    const complete = validBundle(); resizeReference(complete, 153); mocks.bundle.mockResolvedValueOnce(complete);
    const evidence = await loadAuthorizedOfficialDrilldownEvidence(selection);
    expect(evidence.status === "ok" ? evidence.reference.items.length : 0).toBe(153);
    const oversized = validBundle(); resizeReference(oversized, 201); mocks.bundle.mockResolvedValueOnce(oversized);
    await expect(loadAuthorizedOfficialDrilldownEvidence(selection)).resolves.toEqual({ status: "malformed" });
  });

  it.each([
    ["no_rows", "empty", { authorization_status: "authorized", truncated: false }],
    ["authorization_denied", "authorization_denied", { authorization_status: "scope_denied", truncated: false }],
    ["payload_too_large", "payload_too_large", { authorization_status: "authorized", truncated: true }],
  ])("maps a coherent %s bundle to %s", async (rawStatus, expected, fields) => {
    const part = { status: rawStatus, counts: {}, exclusions: [], source_exclusions: [], items: [], archive_entry_ids: [], sources: [], schools: [], parties: [], total: 0, source_kind: "official", ...fields };
    mocks.bundle.mockResolvedValue({ result: part, schools: part, reference: part, provenance: part });
    await expect(loadAuthorizedOfficialDrilldownEvidence(selection)).resolves.toEqual({ status: expected });
  });

  it("preserves row-only reference exclusions from the real refusal contract", async () => {
    const part = {
      status: "source_unavailable",
      reason: "source unavailable",
      counts: {},
      exclusions: [],
      source_exclusions: [],
      authorization_status: "authorized",
      truncated: false,
    };
    mocks.bundle.mockResolvedValue({
      result: part,
      schools: part,
      reference: {
        ...part,
        exclusions: [{ reason: "official_rows_without_section_identity", rows: 2 }],
        source_exclusions: [{ kind: "fiscalizacion", rows: 3 }],
      },
      provenance: part,
    });

    const evidence = await loadAuthorizedOfficialDrilldownEvidence(selection);

    expect(evidence).toMatchObject({ status: "unavailable" });
    expect(evidence.status === "unavailable"
      ? evidence.evidence?.find((item) => item.part === "reference")
      : null).toEqual({
        part: "reference",
        reason: "source unavailable",
        exclusions: [{ reason: "official_rows_without_section_identity", rows: 2 }],
        sourceExclusions: [{ kind: "fiscalizacion", rows: 3 }],
      });
  });

  it("normalizes a coherent denial before optional provenance details", async () => {
    const denial = {
      status: "authorization_denied",
      authorization_status: "scope_denied",
      truncated: false,
    };
    mocks.bundle.mockResolvedValue({
      result: denial,
      schools: denial,
      reference: denial,
      provenance: { ...denial, reason: null },
    });

    await expect(loadAuthorizedOfficialDrilldownEvidence(selection)).resolves.toEqual({
      status: "authorization_denied",
    });
  });

  it("preserves only bounded per-part refusal evidence", async () => {
    const names = ["result", "schools", "reference", "provenance"] as const;
    const parts = names.map((part, index) => ({ status: "source_unavailable", reason: `${part} unavailable`, counts: { rows: index },
      source_exclusions: part === "result" ? [{ kind: "fiscalizacion", rows: 3, votes: 90, source_url: "secret" }] : [],
      exclusions: part === "schools" ? [{ reason: "missing_mesa", rows: 2, votes: 40, notes: "secret" }] : [],
      authorization_status: "authorized", truncated: false, secret: "hidden" }));
    mocks.bundle.mockResolvedValue(Object.fromEntries(names.map((name, index) => [name, parts[index]])));
    await expect(loadAuthorizedOfficialDrilldownEvidence(selection)).resolves.toEqual({ status: "unavailable", evidence: [
      { part: "result", reason: "result unavailable", counts: { rows: 0 }, sourceExclusions: [{ kind: "fiscalizacion", rows: 3, votes: 90 }] },
      { part: "schools", reason: "schools unavailable", counts: { rows: 1 }, exclusions: [{ reason: "missing_mesa", rows: 2, votes: 40 }] },
      { part: "reference", reason: "reference unavailable", counts: { rows: 2 } },
      { part: "provenance", reason: "provenance unavailable", counts: { rows: 3 } },
    ] });
  });

  it.each([
    ["mixed state", (bundle: ReturnType<typeof validBundle>) => { bundle.reference.status = "no_rows"; }],
    ["wrong result level", (bundle: ReturnType<typeof validBundle>) => { bundle.result.level = "distrito"; }],
    ["foreign reference", (bundle: ReturnType<typeof validBundle>) => { bundle.reference.items[0]!.seccion_code = "028"; }],
    ["duplicate archive ids", (bundle: ReturnType<typeof validBundle>) => { bundle.provenance.archive_entry_ids = ["archive-1", "archive-1"]; }],
    ["missing provenance metadata", (bundle: ReturnType<typeof validBundle>) => { bundle.provenance.sources[0]!.metadata_status = "source_unavailable"; }],
    ["unsafe provenance", (bundle: ReturnType<typeof validBundle>) => { Object.assign(bundle.provenance.sources[0]!, { source_url: "https://secret.invalid" }); }],
    ["unavailable displayed provenance", (bundle: ReturnType<typeof validBundle>) => { bundle.result.archive_entry_ids = ["archive-3"]; }],
    ["missing archive lineage", (bundle: ReturnType<typeof validBundle>) => { bundle.result.archive_entry_ids = []; }],
    ["non-official audit", (bundle: ReturnType<typeof validBundle>) => { bundle.provenance.source_audit = [{ kind: "fiscalizacion", rows: 2, votes: 300 }]; }],
    ["malformed audit", (bundle: ReturnType<typeof validBundle>) => { bundle.provenance.source_audit = [{ kind: "official", rows: 0, votes: 300 }]; }],
    ["truncated success", (bundle: ReturnType<typeof validBundle>) => { bundle.schools.truncated = true; }],
  ])("fails the whole bundle closed for %s", async (_case, mutate) => {
    const bundle = validBundle(); mutate(bundle); mocks.bundle.mockResolvedValue(bundle);
    await expect(loadAuthorizedOfficialDrilldownEvidence(selection)).resolves.toEqual({ status: "malformed" });
  });

  it("requires an exact section and hides transport failures", async () => {
    await expect(loadAuthorizedOfficialDrilldownEvidence({ ...selection, seccionCode: null })).resolves.toEqual({ status: "malformed" });
    expect(mocks.bundle).not.toHaveBeenCalled();
    mocks.bundle.mockRejectedValue(new Error("private transport detail"));
    await expect(loadAuthorizedOfficialDrilldownEvidence(selection)).resolves.toEqual({ status: "unavailable" });
  });
});
