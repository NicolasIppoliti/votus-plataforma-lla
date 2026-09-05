import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { sanitizeMunicipalOfficialBundle } = await import("./official-evidence");

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

async function expectMalformed(bundle: ReturnType<typeof validBundle>) {
  await expect(
    sanitizeMunicipalOfficialBundle(bundle, ELECTION_ID, CATEGORY_ID),
  ).resolves.toEqual({ status: "malformed" });
}

describe("sanitizeMunicipalOfficialBundle", () => {
  it("accepts only the complete exact official municipal fixture", async () => {
    await expect(
      sanitizeMunicipalOfficialBundle(validBundle(), ELECTION_ID, CATEGORY_ID),
    ).resolves.toMatchObject({
      status: "ok",
      result: { electionYear: 2025, electionRound: "provinciales", categoryName: "CONCEJALES" },
    });
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
