import { describe, expect, it } from "vitest";
import { ResultsRepository } from "./repository";
import type { PartyMappingContext, PartyNameSource, ResultRow, RowSource } from "./repository";

/**
 * Threat matrix, "Unofficial-source leakage into official figures"
 * (design.md, table row 3): a default query, an aggregate, and a rendered
 * page must each independently exclude fiscalización rows without an
 * explicit opt-in. This file covers paths 1 (default query, 11.7) and 2
 * (aggregate, 11.8), plus the coverage-refusal rule (11.10, D9.2). Path 3
 * (rendered page, 11.9) lives in `e2e/provenance.spec.ts`.
 */

function fakeRowSource(rows: ResultRow[]): RowSource {
  return {
    fetchRows: () => Promise.resolve(rows),
  };
}

const BASE_QUERY = { electionId: "e1", jurisdictionId: "j1", categoryId: "c1" };

const MIXED_ROWS: ResultRow[] = [
  {
    jurisdictionId: "j1",
    categoryId: "c1",
    listId: "135",
    votes: 100,
    sourceKind: "official",
    granularity: "mesa",
    archiveEntryId: "national/2025-legislativas",
  },
  {
    jurisdictionId: "j1",
    categoryId: "c1",
    listId: "135",
    votes: 9999,
    sourceKind: "fiscalizacion",
    granularity: "mesa",
    archiveEntryId: "fiscalizacion/2025-lla",
  },
];

describe("ResultsRepository (threat matrix — unofficial-source leakage)", () => {
  it("test_default_query_excludes_fiscalizacion", async () => {
    const repository = new ResultsRepository(fakeRowSource(MIXED_ROWS));

    const response = await repository.queryOfficial(BASE_QUERY);

    expect(response.status).toBe("ok");
    if (response.status !== "ok") throw new Error("expected ok status");
    expect(response.rows.every((row) => row.sourceKind === "official")).toBe(true);
    expect(response.rows.some((row) => row.votes === 9999)).toBe(false);
  });

  it("test_aggregate_excludes_fiscalizacion_without_opt_in", async () => {
    const repository = new ResultsRepository(fakeRowSource(MIXED_ROWS));

    const aggregate = await repository.aggregateOfficialVotes(BASE_QUERY);

    // Only the 100 official votes must be counted — a naive sum over the
    // fake source's rows would wrongly include the 9999 fiscalización row.
    expect(aggregate.totalVotes).toBe(100);
    expect(aggregate.sourceKind).toBe("official");
  });

  it("test_fiscalizacion_query_without_coverage_is_refused", async () => {
    const repository = new ResultsRepository(fakeRowSource(MIXED_ROWS));

    const response = await repository.queryFiscalizacion(BASE_QUERY);

    expect(response.status).toBe("requires_explicit_unofficial_opt_in");
  });

  it("returns fiscalización rows only once a valid coverage opt-in is supplied", async () => {
    const repository = new ResultsRepository(fakeRowSource(MIXED_ROWS));

    const response = await repository.queryFiscalizacion(BASE_QUERY, {
      coverage: {
        observedUnits: 93,
        denominatorUnits: 153,
        denominatorBasis: "distinct mesa_id, distrito_id=02 seccion_id=027",
        isRandomSample: false,
      },
    });

    expect(response.status).toBe("ok");
    if (response.status !== "ok") throw new Error("expected ok status");
    expect(response.rows.every((row) => row.sourceKind === "fiscalizacion")).toBe(true);
    // Never combined with official rows in one figure (D9.1).
    expect(response.rows.some((row) => row.sourceKind === "official")).toBe(false);
  });
});

/**
 * Phase 15, task 15.14: the read path renders raw `list 110` instead of a
 * party name because nothing joins `party_mapping`. `PartyNameSource` is
 * the repository-level seam that closes that gap — a fake in these unit
 * tests, `SupabasePartyNameSource` (querying `party_mapping` joined to
 * `party_canonical`) in production.
 */
const PARTY_CONTEXT: PartyMappingContext = {
  year: 2025,
  jurisdiction: "national",
  category: "DIPUTADO NACIONAL",
};

function fakePartyNameSource(namesByListId: Record<string, string>): PartyNameSource {
  return {
    fetchPartyNames: (_context, listIds) => {
      const resolved = new Map<string, string>();
      for (const listId of listIds) {
        const name = namesByListId[listId];
        if (name) resolved.set(listId, name);
      }
      return Promise.resolve(resolved);
    },
  };
}

describe("ResultsRepository (party-name resolution — task 15.14)", () => {
  it("test_rows_carry_a_resolved_party_name_when_a_mapping_exists", async () => {
    const rows: ResultRow[] = [
      {
        jurisdictionId: "j1",
        categoryId: "c1",
        listId: "110",
        votes: 161,
        sourceKind: "official",
        granularity: "mesa",
        archiveEntryId: "national/2025-legislativas",
      },
    ];
    const repository = new ResultsRepository(
      fakeRowSource(rows),
      fakePartyNameSource({ "110": "ALIANZA LA LIBERTAD AVANZA" }),
    );

    const response = await repository.queryOfficial(BASE_QUERY, PARTY_CONTEXT);

    expect(response.status).toBe("ok");
    if (response.status !== "ok") throw new Error("expected ok status");
    expect(response.rows[0]?.partyName).toBe("ALIANZA LA LIBERTAD AVANZA");
  });

  it("test_unmapped_list_id_renders_as_unmapped_not_as_a_bare_number", async () => {
    const rows: ResultRow[] = [
      {
        jurisdictionId: "j1",
        categoryId: "c1",
        listId: "999999",
        votes: 5,
        sourceKind: "official",
        granularity: "mesa",
        archiveEntryId: "national/2025-legislativas",
      },
    ];
    const repository = new ResultsRepository(fakeRowSource(rows), fakePartyNameSource({}));

    const response = await repository.queryOfficial(BASE_QUERY, PARTY_CONTEXT);

    expect(response.status).toBe("ok");
    if (response.status !== "ok") throw new Error("expected ok status");
    // `partyName` is explicitly `null` (a defined "unmapped" state) — never
    // silently left for the page to fall back to rendering the raw
    // `listId` as if it were a name.
    expect(response.rows[0]?.partyName).toBeNull();
    expect(response.rows[0]?.listId).toBe("999999");
  });
});
