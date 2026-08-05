import { describe, expect, it } from "vitest";
import { describeExcluded, ResultsRepository, tallyByKind } from "./repository";
import type { PartyMappingContext, PartyNameSource, ResultRow, RowSource } from "./repository";

/**
 * Threat matrix, "Unofficial-source leakage into official figures"
 * (design.md, table row 3): a default query, an aggregate, and a rendered
 * page must each independently exclude fiscalización rows without an
 * explicit opt-in. This file covers paths 1 (default query, 11.7) and 2
 * (aggregate, 11.8), plus the coverage-refusal rule (11.10, D9.2). Path 3
 * (rendered page, 11.9) lives in the PAGE suites: `compare`, `drilldown` and
 * `municipal` each drive their own guard with a `leakFiscalizacion` harness
 * that simulates this filter regressing.
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

    // Path 2 with its OWN row source, not through `queryOfficial`. The old
    // test exercised path 1 twice and called it independence.
    const aggregate = await repository.aggregateOfficialVotes(BASE_QUERY);

    // Only the 100 official votes must be counted — a naive sum over the
    // fake source's rows would wrongly include the 9999 fiscalización row.
    expect(aggregate.totalVotes).toBe(100);
    expect(aggregate.sourceKind).toBe("official");
  });

  // No "without coverage" case: the opt-in is a REQUIRED parameter, so the
  // state cannot be expressed. A test that had to omit an argument no caller
  // can omit was testing the type system, not the behaviour.

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
      const resolved = new Map<string, { canonicalPartyId: string; displayName: string }>();
      for (const listId of listIds) {
        const name = namesByListId[listId];
        if (name) resolved.set(listId, { canonicalPartyId: `canon-${listId}`, displayName: name });
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

describe("the exclusion tally (rule 3 — a drop is judged by its size)", () => {
  it("test_the_tally_carries_votes_not_only_a_row_count", async () => {
    // 9999 votes hidden behind "1 fiscalizacion" is the shape rule 3 exists
    // for: a row count cannot distinguish a rounding-error drop from one that
    // would have changed the answer.
    const repository = new ResultsRepository(fakeRowSource(MIXED_ROWS));

    const response = await repository.queryOfficial(BASE_QUERY);

    if (response.status !== "ok") throw new Error("expected ok status");
    expect(response.excluded).toEqual({ fiscalizacion: { rows: 1, votes: 9999 } });
    expect(describeExcluded(response.excluded)).toBe("1 fiscalizacion row(s) / 9999 vote(s)");
  });

  it("test_a_source_kind_outside_the_enum_lands_in_its_own_bucket", async () => {
    // Dropped by BOTH filters, so without this bucket it appears on no page.
    const repository = new ResultsRepository(
      fakeRowSource([
        ...MIXED_ROWS,
        { ...MIXED_ROWS[0]!, votes: 41, sourceKind: "provisional" as ResultRow["sourceKind"] },
      ]),
    );

    const response = await repository.queryOfficial(BASE_QUERY);

    if (response.status !== "ok") throw new Error("expected ok status");
    expect(response.excluded["unknown"]).toEqual({ rows: 1, votes: 41 });
  });

  it("test_nothing_dropped_renders_no_note_at_all", () => {
    expect(describeExcluded({})).toBeNull();
    // A zero-row entry is not a drop; rendering "0 official row(s)" beside a
    // figure reads as a disclosure when there is nothing to disclose.
    expect(describeExcluded({ official: { rows: 0, votes: 0 } })).toBeNull();
  });
});

describe("aggregateOfficialVotes reports what it summed", () => {
  it("test_the_summed_tally_names_the_kinds_that_reached_the_total", async () => {
    // Derived from the rows that WERE summed, not re-filtered from them: an
    // earlier version asked `official.filter(r => r.sourceKind !== "official")`
    // and so answered `{}` for every possible input, leaving the page guard
    // that read it unreachable while an inflated total rendered anyway.
    const repository = new ResultsRepository(fakeRowSource(MIXED_ROWS));

    const aggregate = await repository.aggregateOfficialVotes(BASE_QUERY);

    expect(aggregate.totalVotes).toBe(100);
    // The official row is NAMED, not merely absent — a tally that reports
    // nothing cannot be distinguished from a tally that reports nothing wrong.
    expect(aggregate.summedByKind).toEqual({ official: { rows: 1, votes: 100 } });
  });

  it("test_a_widened_filter_would_show_up_in_the_tally", async () => {
    // The property the page guard depends on: whatever reaches the sum reaches
    // this tally. Asserted directly on `tallyByKind`, since the repository's
    // filter is what the guard exists to catch failing.
    expect(tallyByKind(MIXED_ROWS)).toEqual({
      official: { rows: 1, votes: 100 },
      fiscalizacion: { rows: 1, votes: 9999 },
    });
  });
});
