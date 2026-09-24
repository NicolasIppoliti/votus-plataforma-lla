import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { bundleMock, clientMock, client } = vi.hoisted(() => {
  const client = { mocked: true };
  return { bundleMock: vi.fn(), clientMock: vi.fn(async () => client), client };
});
vi.mock("@/lib/workspace/context", () => ({ authorizedOfficialBundle: bundleMock }));
vi.mock("@/lib/supabase/server-client", () => ({ createSupabaseServerClient: clientMock }));

const { sanitizeMunicipalOfficialBundle, loadMunicipalOfficialEvidence } = await import("./official-evidence");

const ELECTION_ID = "2025-municipal";
const CATEGORY_ID = "c-concejales";
const ARCHIVE_ENTRY_ID = "pba/2025-municipal-coronel-rosales";
const AUTHORIZED = { authorization_status: "authorized", truncated: false };

function validBundle() {
  return {
    result: {
      status: "ok",
      source_kind: "official",
      category_name: "CONCEJALES",
      level: "seccion",
      source_granularity: "seccion",
      election_year: 2025,
      election_round: "provinciales",
      total_votes: 4200,
      mesa_count: null,
      parties: [{
        identity_status: "canonical",
        canonical_party_id: "lla",
        display_name: "ALIANZA LA LIBERTAD AVANZA",
        list_id: null,
        votes: 4200,
        vote_share: "1",
      }],
      source_audit: [{ kind: "official", rows: 1, votes: 4200 }],
      source_exclusions: [],
      archive_entry_ids: [ARCHIVE_ENTRY_ID],
      ...AUTHORIZED,
    },
    reference: {
      status: "ok",
      source_kind: "official",
      total: 1,
      items: [{
        election_id: ELECTION_ID,
        category_id: CATEGORY_ID,
        year: 2025,
        category_name: "CONCEJALES",
        distrito_code: "02",
        seccion_code: "027",
      }],
      ...AUTHORIZED,
    },
    provenance: {
      status: "ok",
      source_kind: "official",
      total: 1,
      archive_entry_ids: [ARCHIVE_ENTRY_ID],
      sources: [{
        id: ARCHIVE_ENTRY_ID,
        metadata_status: "available",
        fetched_at: "2026-01-01T00:00:00Z",
        status: "ok",
        sha256: "a".repeat(64),
      }],
      ...AUTHORIZED,
    },
  };
}

describe("loadMunicipalOfficialEvidence", () => {
  it("accepts all 153 authorized 2023 mesa references with official result and archive provenance", async () => {
    const previousElection = process.env["MUNICIPAL_2023_ELECTION_ID"];
    const previousCategory = process.env["MUNICIPAL_2023_CATEGORY_ID"];
    try {
      process.env["MUNICIPAL_2023_ELECTION_ID"] = "e-2023";
      process.env["MUNICIPAL_2023_CATEGORY_ID"] = "c-intendente";
      bundleMock.mockReset();
      const bundle = validBundle();
      bundle.result.election_year = 2023;
      bundle.result.election_round = "generales";
      bundle.result.category_name = "INTENDENTE";
      bundle.result.archive_entry_ids = ["national/2023-generales"];
      bundle.provenance.archive_entry_ids = ["national/2023-generales"];
      bundle.provenance.sources[0]!.id = "national/2023-generales";
      bundle.provenance.sources[0]!.sha256 = "2562b18c741ba5740d264e5328f206cb25f709ed0a4f8cf962f301e423e79c6b";
      bundle.reference.items = Array.from({ length: 153 }, (_, index) => ({
        election_id: "e-2023", category_id: "c-intendente", year: 2023,
        category_name: "INTENDENTE", distrito_code: "02", seccion_code: "027",
        mesa_code: String(index + 1).padStart(4, "0"),
      }));
      bundle.reference.total = 153;
      bundleMock.mockResolvedValueOnce(bundle);

      await expect(loadMunicipalOfficialEvidence(2023)).resolves.toMatchObject({
        status: "ok", result: { electionYear: 2023, categoryName: "INTENDENTE", totalVotes: 4200 },
        provenance: [{ archiveEntryId: "national/2023-generales", sha256: "2562b18c741ba5740d264e5328f206cb25f709ed0a4f8cf962f301e423e79c6b" }],
      });
    } finally {
      if (previousElection === undefined) delete process.env["MUNICIPAL_2023_ELECTION_ID"];
      else process.env["MUNICIPAL_2023_ELECTION_ID"] = previousElection;
      if (previousCategory === undefined) delete process.env["MUNICIPAL_2023_CATEGORY_ID"];
      else process.env["MUNICIPAL_2023_CATEGORY_ID"] = previousCategory;
    }
  });

  it("requests and accepts archive-backed 2023 INTENDENTE evidence at the municipal section", async () => {
    const previousElection = process.env["MUNICIPAL_2023_ELECTION_ID"];
    const previousCategory = process.env["MUNICIPAL_2023_CATEGORY_ID"];
    try {
      process.env["MUNICIPAL_2023_ELECTION_ID"] = "e-2023";
      process.env["MUNICIPAL_2023_CATEGORY_ID"] = "c-intendente";
      bundleMock.mockReset();
      clientMock.mockClear();
      const bundle = validBundle();
      bundle.result.election_year = 2023;
      bundle.result.election_round = "generales";
      bundle.result.category_name = "INTENDENTE";
      bundle.reference.items[0]!.year = 2023;
      bundle.reference.items[0]!.category_name = "INTENDENTE";
      bundle.reference.items[0]!.election_id = "e-2023";
      bundle.reference.items[0]!.category_id = "c-intendente";
      bundle.result.archive_entry_ids = ["national/2023-generales"];
      bundle.provenance.archive_entry_ids = ["national/2023-generales"];
      bundle.provenance.sources[0]!.id = "national/2023-generales";
      bundle.provenance.sources[0]!.sha256 = "2562b18c741ba5740d264e5328f206cb25f709ed0a4f8cf962f301e423e79c6b";
      bundleMock.mockResolvedValueOnce(bundle);

      await expect(loadMunicipalOfficialEvidence(2023)).resolves.toMatchObject({
        status: "ok", result: { electionYear: 2023, categoryName: "INTENDENTE" },
        provenance: [{ archiveEntryId: "national/2023-generales" }],
      });
      expect(clientMock).toHaveBeenCalledOnce();
      expect(bundleMock).toHaveBeenCalledWith(client, {
        electionId: "e-2023", categoryId: "c-intendente",
        distritoCode: "02", seccionCode: "027",
        circuitoCode: null, establecimientoCode: null, mesaCode: null,
        requestedLevel: "seccion",
      });
    } finally {
      if (previousElection === undefined) delete process.env["MUNICIPAL_2023_ELECTION_ID"];
      else process.env["MUNICIPAL_2023_ELECTION_ID"] = previousElection;
      if (previousCategory === undefined) delete process.env["MUNICIPAL_2023_CATEGORY_ID"];
      else process.env["MUNICIPAL_2023_CATEGORY_ID"] = previousCategory;
    }
  });
});

async function expectMalformed(bundle: ReturnType<typeof validBundle>) {
  await expect(
    sanitizeMunicipalOfficialBundle(bundle, ELECTION_ID, CATEGORY_ID),
  ).resolves.toEqual({ status: "malformed" });
}

describe("sanitizeMunicipalOfficialBundle", () => {
  it("accepts the selected 2023 provisional INTENDENTE bundle but rejects a mismatched reference", async () => {
    const bundle = validBundle();
    bundle.result.archive_entry_ids = ["national/2023-generales"];
    bundle.provenance.archive_entry_ids = ["national/2023-generales"];
    bundle.provenance.sources[0]!.id = "national/2023-generales";
    bundle.provenance.sources[0]!.sha256 = "2562b18c741ba5740d264e5328f206cb25f709ed0a4f8cf962f301e423e79c6b";
    bundle.result.election_year = 2023;
    bundle.result.election_round = "generales";
    bundle.result.category_name = "INTENDENTE";
    bundle.reference.items[0]!.year = 2023;
    bundle.reference.items[0]!.category_name = "INTENDENTE";
    bundle.reference.items[0]!.election_id = "e-2023";
    bundle.reference.items[0]!.category_id = "c-intendente";
    await expect(sanitizeMunicipalOfficialBundle(bundle, "e-2023", "c-intendente", 2023)).resolves.toMatchObject({ status: "ok", result: { electionYear: 2023, categoryName: "INTENDENTE" } });
    bundle.reference.items[0]!.category_name = "CONCEJALES";
    await expect(sanitizeMunicipalOfficialBundle(bundle, "e-2023", "c-intendente", 2023)).resolves.toEqual({ status: "malformed" });
  });
  it("rejects verified 2023 archive metadata whose provenance status is not ok", async () => {
    const bundle = validBundle();
    bundle.result.election_year = 2023;
    bundle.result.election_round = "generales";
    bundle.result.category_name = "INTENDENTE";
    bundle.reference.items[0]!.year = 2023;
    bundle.reference.items[0]!.category_name = "INTENDENTE";
    bundle.reference.items[0]!.election_id = "e-2023";
    bundle.reference.items[0]!.category_id = "c-intendente";
    bundle.result.archive_entry_ids = ["national/2023-generales"];
    bundle.provenance.archive_entry_ids = ["national/2023-generales"];
    bundle.provenance.sources[0]!.id = "national/2023-generales";
    bundle.provenance.sources[0]!.sha256 = "2562b18c741ba5740d264e5328f206cb25f709ed0a4f8cf962f301e423e79c6b";
    bundle.provenance.sources[0]!.status = "source_unavailable";
    await expect(sanitizeMunicipalOfficialBundle(bundle, "e-2023", "c-intendente", 2023)).resolves.toEqual({ status: "malformed" });
  });

  it("accepts only the complete exact official municipal fixture", async () => {
    await expect(
      sanitizeMunicipalOfficialBundle(validBundle(), ELECTION_ID, CATEGORY_ID),
    ).resolves.toMatchObject({
      status: "ok",
      result: { electionYear: 2025, electionRound: "provinciales", categoryName: "CONCEJALES" },
    });
  });

  it.each(["wrong archive", "wrong hash"])("refuses 2023 %s despite an otherwise valid official bundle", async (fault) => {
    const bundle = validBundle();
    bundle.result.election_year = 2023;
    bundle.result.election_round = "generales";
    bundle.result.category_name = "INTENDENTE";
    bundle.reference.items[0]!.year = 2023;
    bundle.reference.items[0]!.category_name = "INTENDENTE";
    bundle.reference.items[0]!.election_id = "e-2023";
    bundle.reference.items[0]!.category_id = "c-intendente";
    const archiveId = fault === "wrong archive" ? ARCHIVE_ENTRY_ID : "national/2023-generales";
    bundle.result.archive_entry_ids = [archiveId];
    bundle.provenance.archive_entry_ids = [archiveId];
    bundle.provenance.sources[0]!.id = archiveId;
    bundle.provenance.sources[0]!.sha256 = fault === "wrong hash" ? "a".repeat(64) : "2562b18c741ba5740d264e5328f206cb25f709ed0a4f8cf962f301e423e79c6b";
    await expect(sanitizeMunicipalOfficialBundle(bundle, "e-2023", "c-intendente", 2023)).resolves.toEqual({ status: "malformed" });
  });

  it("keeps a valid multi-party official total when the source audit has one aggregate row", async () => {
    const bundle = validBundle();
    bundle.result.parties[0]!.votes = 3000;
    bundle.result.parties.push({
      identity_status: "canonical",
      canonical_party_id: "other",
      display_name: "OTRA LISTA",
      list_id: null,
      votes: 1200,
      vote_share: "0.285714",
    });

    await expect(
      sanitizeMunicipalOfficialBundle(bundle, ELECTION_ID, CATEGORY_ID),
    ).resolves.toMatchObject({ status: "ok", result: { totalVotes: 4200 } });
  });

  it.each([
    ["result year",  (bundle: ReturnType<typeof validBundle>) => { bundle.result.election_year = 2024; }],
    ["result round", (bundle: ReturnType<typeof validBundle>) => { bundle.result.election_round = "legislativas"; }],
    ["result category", (bundle: ReturnType<typeof validBundle>) => { bundle.result.category_name = "DIPUTADOS PROVINCIALES"; }],
    ["reference year", (bundle: ReturnType<typeof validBundle>) => { bundle.reference.items[0]!.year = 2024; }],
    ["reference category", (bundle: ReturnType<typeof validBundle>) => { bundle.reference.items[0]!.category_name = "DIPUTADOS PROVINCIALES"; }],
    ["reference distrito", (bundle: ReturnType<typeof validBundle>) => { bundle.reference.items[0]!.distrito_code = "01"; }],
    ["reference seccion", (bundle: ReturnType<typeof validBundle>) => { bundle.reference.items[0]!.seccion_code = "026"; }],
  ])("rejects wrong municipal identity: %s", async (_case, mutate) => {
    const bundle = validBundle();
    mutate(bundle);
    await expectMalformed(bundle);
  });

  it.each([
    ["missing", (bundle: ReturnType<typeof validBundle>) => { delete (bundle.result as Record<string, unknown>).source_audit; }],
    ["empty", (bundle: ReturnType<typeof validBundle>) => { bundle.result.source_audit = []; }],
    ["multiple", (bundle: ReturnType<typeof validBundle>) => { bundle.result.source_audit.push({ kind: "official", rows: 1, votes: 0 }); }],
    ["mixed", (bundle: ReturnType<typeof validBundle>) => { bundle.result.source_audit.push({ kind: "fiscalizacion", rows: 1, votes: 0 }); }],
    ["unofficial", (bundle: ReturnType<typeof validBundle>) => { bundle.result.source_audit = [{ kind: "fiscalizacion", rows: 1, votes: 4200 }]; }],
    ["zero rows", (bundle: ReturnType<typeof validBundle>) => { bundle.result.source_audit[0]!.rows = 0; }],
    ["unsafe rows", (bundle: ReturnType<typeof validBundle>) => { bundle.result.source_audit[0]!.rows = Number.MAX_SAFE_INTEGER + 1; }],
    ["unsafe votes", (bundle: ReturnType<typeof validBundle>) => { bundle.result.source_audit[0]!.votes = Number.MAX_SAFE_INTEGER + 1; }],
    ["malformed audit", (bundle: ReturnType<typeof validBundle>) => { (bundle.result.source_audit[0] as Record<string, unknown>).votes = "4200"; }],
    ["audit total mismatch", (bundle: ReturnType<typeof validBundle>) => { bundle.result.source_audit[0]!.votes = 4199; }],
    ["party total mismatch", (bundle: ReturnType<typeof validBundle>) => { bundle.result.parties[0]!.votes = 4199; }],
    ["unsafe party votes", (bundle: ReturnType<typeof validBundle>) => { bundle.result.parties[0]!.votes = Number.MAX_SAFE_INTEGER + 1; }],
  ])("rejects %s source evidence before provenance", async (_case, mutate) => {
    const bundle = validBundle();
    mutate(bundle);
    await expectMalformed(bundle);
  });

  it.each(["missing", "source_unavailable"])(
    "rejects %s provenance metadata before evidence can reach status ok",
    async (metadataStatus) => {
      const bundle = validBundle();
      const source = bundle.provenance.sources[0] as Record<string, unknown>;
      if (metadataStatus === "missing") delete source.metadata_status;
      else source.metadata_status = metadataStatus;

      await expectMalformed(bundle);
    },
  );
});
