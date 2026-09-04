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
      election_round: "legislativas",
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

describe("sanitizeMunicipalOfficialBundle", () => {
  it.each(["missing", "source_unavailable"])(
    "rejects %s provenance metadata before evidence can reach status ok",
    async (metadataStatus) => {
      const baseline = await sanitizeMunicipalOfficialBundle(
        validBundle(),
        ELECTION_ID,
        CATEGORY_ID,
      );
      expect(baseline.status).toBe("ok");

      const bundle = validBundle();
      const source = bundle.provenance.sources[0] as Record<string, unknown>;
      if (metadataStatus === "missing") delete source["metadata_status"];
      else source["metadata_status"] = metadataStatus;

      await expect(
        sanitizeMunicipalOfficialBundle(bundle, ELECTION_ID, CATEGORY_ID),
      ).resolves.toEqual({ status: "malformed" });
    },
  );
});
