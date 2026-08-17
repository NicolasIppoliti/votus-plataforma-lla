import { describe, expect, it } from "vitest";
import {
  describeExcluded,
  isPartyResolved,
  fetchSourceRefs,
  SupabasePartyNameSource,
  SupabaseRowSource,
  unmappedByListId,
  votesByParty,
  fetchCategoryName,
  fetchElectionYear,
  ResultsRepository,
} from "./repository";
import type {
  PartyMappingContext,
  PartyNameSource,
  ResultRow,
  RowSource,
} from "./repository";

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

  it("test_the_aggregate_sums_official_rows_only", async () => {
    // NOT "without opt in": `aggregateOfficialVotes` takes no opt-in at all, so
    // that condition is unexpressable and no assertion here exercises it.
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

  it("test_the_opt_in_path_returns_fiscalizacion_rows_only", async () => {
    // NOT "only once an opt-in is supplied": `optIn` is a required parameter,
    // so the without-opt-in state cannot be expressed and no assertion here
    // exercises it. The name says what the assertions check.
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

  it("test_an_unmapped_list_id_resolves_to_an_explicit_null", async () => {
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
    expect(describeExcluded(response.excluded)).toBe("1 fila fiscalización / 9999 votos");
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

  it("test_a_widened_filter_shows_up_in_the_tally", async () => {
    // The FILTER is widened, not the tally. Overriding the return value and
    // reading it back proved nothing: the assertion passed however
    // `aggregateOfficialVotes` filtered, including not at all.
    //
    // `officialRows` is the seam that decides what gets summed. Regressing it
    // to "everything" is what a real widening looks like, and `summedByKind`
    // is then computed by the production code from what the seam returned.
    class WidenedRepository extends ResultsRepository {
      protected override officialRows(rows: ResultRow[]): ResultRow[] {
        return rows;
      }
    }
    const repository = new WidenedRepository(fakeRowSource(MIXED_ROWS));

    const aggregate = await repository.aggregateOfficialVotes(BASE_QUERY);

    // The foreign kind is NAMED — which is what the page guard reads — and the
    // total is inflated by it, which is what the guard exists to catch.
    expect(aggregate.summedByKind["fiscalizacion"]).toEqual({ rows: 1, votes: 9999 });
    expect(aggregate.totalVotes).toBe(10099);
    // And `excluded` does NOT claim those same votes were dropped: both halves
    // come from one seam, so a row cannot be reported as summed AND removed.
    expect(aggregate.excluded).toEqual({});
  });
});

/**
 * A Supabase double narrow enough to be honest: it records the table and the
 * filter, and answers one row.
 */
function fakeLookupClient(table: string, row: Record<string, unknown> | null) {
  const calls: { table: string; column: string; value: string }[] = [];
  const client = {
    from(name: string) {
      return {
        select() {
          return {
            eq(column: string, value: string) {
              calls.push({ table: name, column, value });
              return {
                maybeSingle: () =>
                  Promise.resolve({ data: name === table ? row : null, error: null }),
              };
            },
          };
        },
      };
    },
  };
  return { client, calls };
}

describe("fetchElectionYear (the year comes from the row, not the id)", () => {
  it("test_the_year_is_read_from_the_election_row", async () => {
    // The uuid carries NO year in its text, and the row says 2023. An id-string
    // reader answers null here; this is the assertion that tells them apart.
    const { client, calls } = fakeLookupClient("election", { year: 2023 });

    const year = await fetchElectionYear(
      client as never,
      "6dae81f9-c862-4cc5-b3f3-b640e4ea7319",
    );

    expect(year).toEqual({ status: "ok", year: 2023 });
    expect(calls).toEqual([
      { table: "election", column: "id", value: "6dae81f9-c862-4cc5-b3f3-b640e4ea7319" },
    ]);
  });

  it("test_an_id_that_looks_like_a_year_still_answers_the_row", async () => {
    // A slug LEADING with a year is exactly where the two readers agree by
    // accident. The row says otherwise, and the row wins.
    const { client } = fakeLookupClient("election", { year: 2019 });

    expect(await fetchElectionYear(client as never, "2023-generales")).toEqual({
      status: "ok",
      year: 2019,
    });
  });

  it("test_no_election_row_is_a_refusal_not_a_year", async () => {
    const { client } = fakeLookupClient("election", null);

    // NO ROW, said as such — distinct from a row whose year is unusable. Three
    // pages state one of those as a fact about the database.
    expect(await fetchElectionYear(client as never, "2023-generales")).toEqual({
      status: "no_row",
    });
  });
});

describe("fetchCategoryName (the third axis)", () => {
  it("test_the_label_is_read_from_the_category_row", async () => {
    const { client, calls } = fakeLookupClient("category", { name: "DIPUTADO NACIONAL" });

    const name = await fetchCategoryName(client as never, "c-1");

    expect(name).toEqual({ status: "ok", name: "DIPUTADO NACIONAL" });
    expect(calls).toEqual([{ table: "category", column: "id", value: "c-1" }]);
  });

  it("test_no_category_row_is_a_refusal", async () => {
    const { client } = fakeLookupClient("category", null);

    expect(await fetchCategoryName(client as never, "c-nope")).toEqual({ status: "no_row" });
  });
});

describe("votesByParty folds on identity, not on the label", () => {
  const row = (canonicalPartyId: string | null, partyName: string | null, votes: number, listId = "x"): ResultRow => ({
    jurisdictionId: "j1",
    categoryId: "c1",
    listId,
    votes,
    sourceKind: "official",
    granularity: "mesa",
    archiveEntryId: "a1",
    canonicalPartyId,
    partyName,
  });

  it("test_one_party_with_conflicting_names_refuses_in_every_row_order", () => {
    const rows = [
      row("canon-110", "LA LIBERTAD AVANZA", 40),
      row("canon-110", "ALIANZA LA LIBERTAD AVANZA", 60),
    ];
    const expectedError =
      "votesByParty: canonical party canon-110 has conflicting display names: " +
      "ALIANZA LA LIBERTAD AVANZA, LA LIBERTAD AVANZA";

    for (const orderedRows of [rows, [...rows].reverse()]) {
      expect(() => votesByParty(orderedRows)).toThrow(expectedError);
    }
  });

  it("test_two_parties_sharing_a_name_are_not_merged", () => {
    // The other direction: two canonical parties that happen to share a string
    // folded into one number.
    expect(
      votesByParty([row("canon-1", "PARTIDO X", 30), row("canon-2", "PARTIDO X", 20)]),
    ).toEqual([
      { label: "PARTIDO X", votes: 30 },
      { label: "PARTIDO X", votes: 20 },
    ]);
  });

  it("test_unresolved_rows_are_absent_from_the_ranked_list", () => {
    // They have their OWN reported section. Emitting them here too put the same
    // votes in two places, one of them where a reader sums a party's figure.
    expect(votesByParty([row(null, null, 700, "4321"), row("canon-1", "PARTIDO X", 30)])).toEqual([
      { label: "PARTIDO X", votes: 30 },
    ]);
    expect(unmappedByListId([row(null, null, 700, "4321")]).entries).toEqual([
      { listId: "4321", rows: 1, votes: 700 },
    ]);
  });
});

describe("every path reports its drops from the rows it kept", () => {
  /** Widens THE keep-filter, so every query path regresses at once. */
  class WidenedRepository extends ResultsRepository {
    protected override keep(rows: ResultRow[]): ResultRow[] {
      return rows;
    }
  }

  it("test_path_1_never_reports_a_returned_row_as_removed", async () => {
    // Path 1 re-derived `excluded` with a SECOND predicate, so a widened
    // keep-filter reported the fiscalización row as returned AND as dropped.
    // Driven through the widened seam — a plain repository cannot fail this.
    const repository = new WidenedRepository(fakeRowSource(MIXED_ROWS));

    const response = await repository.queryOfficial(BASE_QUERY);

    expect(response.rows).toHaveLength(2);
    expect(response.excluded).toEqual({});
  });

  it("test_the_fiscalizacion_query_never_reports_a_returned_row_as_removed", async () => {
    const repository = new WidenedRepository(fakeRowSource(MIXED_ROWS));

    const response = await repository.queryFiscalizacion(BASE_QUERY, {
      coverage: { observedUnits: 93, denominatorUnits: 153, isRandomSample: false, denominatorBasis: "test" },
    });

    expect(response.rows).toHaveLength(2);
    expect(response.excluded).toEqual({});
  });

  it("test_path_2_never_reports_a_summed_row_as_removed", async () => {
    const repository = new WidenedRepository(fakeRowSource(MIXED_ROWS));

    const aggregate = await repository.aggregateOfficialVotes(BASE_QUERY);

    expect(aggregate.excluded).toEqual({});
    expect(aggregate.summedByKind["fiscalizacion"]).toEqual({ rows: 1, votes: 9999 });
  });
});

describe("a lookup distinguishes an absent row from an unusable value", () => {
  it("test_a_row_whose_year_is_unusable_is_not_reported_as_a_missing_row", async () => {
    // `null` for both let three pages state "no election row carries that id"
    // as a fact about the database when the row existed and its year was the
    // problem. Different states, different refusals.
    const { client } = fakeLookupClient("election", { year: null });

    expect(await fetchElectionYear(client as never, "e1")).toEqual({
      status: "unreadable_year",
    });
  });

  it("test_a_row_whose_name_is_unusable_is_not_reported_as_a_missing_row", async () => {
    const { client } = fakeLookupClient("category", { name: 42 });

    expect(await fetchCategoryName(client as never, "c1")).toEqual({
      status: "unreadable_name",
    });
  });
});

/**
 * A PostgREST-shaped double that models what the SERVER actually guarantees.
 *
 * The rows are returned in an ARBITRARY order per request — Postgres gives no
 * ordering inside a tie — and only `.order("id")` + `.gt("id", …)` produce a
 * stable sequence. A double that slices a fixed array would model a total
 * order the real path does not have, and would stay green against the
 * repeat-and-skip defect offset pagination has.
 */
function fakeKeysetClient(
  rows: Record<string, unknown>[],
  maxRows = 1000,
  onSelect?: (columns: string) => void,
) {
  return {
    from() {
      let after: string | null = null;
      let limit = maxRows;
      const chain: Record<string, unknown> = {};
      chain["select"] = (columns: string) => {
        onSelect?.(columns);
        return chain;
      };
      for (const method of ["eq", "in"]) chain[method] = () => chain;
      chain["order"] = () => chain;
      chain["limit"] = (n: number) => {
        limit = Math.min(n, maxRows);
        return chain;
      };
      chain["gt"] = (_column: string, value: string) => {
        after = value;
        return chain;
      };
      chain["then"] = (resolve: (r: { data: unknown; error: null }) => unknown) => {
        const source = [...rows].sort((a, b) => String(a["id"]).localeCompare(String(b["id"])));
        const cursor = after;
        const start = cursor === null ? 0 : source.findIndex((r) => String(r["id"]) > cursor);
        const page = start === -1 ? [] : source.slice(start, start + limit);
        return resolve({ data: page, error: null });
      };
      return chain;
    },
  };
}

describe("SupabaseRowSource reads every row, not the first page", () => {
  const row = (i: number) => ({
    // A UNIQUE id — the only key `result_row` has that cannot tie. `list_id`
    // and `archive_entry_id` repeat across every mesa in a jurisdiction.
    id: String(i).padStart(6, "0"),
    jurisdiction_id: "j1",
    category_id: "c1",
    list_id: String(i),
    votes: 1,
    source_kind: "official",
    granularity: "mesa",
    requested_granularity: "mesa",
    archive_entry_id: "a1",
  });

  it("test_a_result_set_larger_than_one_page_is_read_to_exhaustion", async () => {
    // PostgREST caps a select at `max-rows` and returns TRUNCATED data with no
    // error. Every figure downstream would then be a sum over a silent,
    // arbitrary subset — large, plausible, and wrong. `result_row` holds
    // 18.17M rows, so this is not a theoretical cap.
    const rows = Array.from({ length: 2500 }, (_, i) => row(i));
    const source = new SupabaseRowSource(fakeKeysetClient(rows) as never);

    const read = await source.fetchRows({
      electionId: "e1",
      jurisdictionId: "j1",
      categoryId: "c1",
    });

    expect(read).toHaveLength(2500);
    expect(read.reduce((sum, r) => sum + r.votes, 0)).toBe(2500);
    expect(read[0]?.requestedGranularity).toBe("mesa");
  });

  it("test_all_supported_granularities_are_accepted_and_historical_null_stays_unknown", async () => {
    const selections: string[] = [];
    const granularities = ["mesa", "establecimiento", "circuito", "seccion", "distrito"] as const;
    const source = new SupabaseRowSource(
      fakeKeysetClient(
        granularities.map((granularity, index) => ({
          ...row(index),
          granularity,
          requested_granularity: index === 0 ? null : granularity,
        })),
        1000,
        (columns) => selections.push(columns),
      ) as never,
    );

    const read = await source.fetchRows(BASE_QUERY);

    expect(selections[0]).toContain("requested_granularity");
    expect(read.map(({ granularity }) => granularity)).toEqual(granularities);
    expect(read[0]?.requestedGranularity).toBeNull();
  });

  it.each([
    ["actual", { granularity: "subcircuito" }, "result_row.granularity must be one of"],
    [
      "requested",
      { requested_granularity: "subcircuito" },
      "result_row.requested_granularity must be null or one of",
    ],
  ])("test_unknown_%s_granularity_refuses", async (_field, override, errorPrefix) => {
    const source = new SupabaseRowSource(fakeKeysetClient([{ ...row(1), ...override }]) as never);

    await expect(source.fetchRows(BASE_QUERY)).rejects.toThrow(
      `ResultsRepository: ${errorPrefix} mesa, establecimiento, circuito, seccion, distrito`,
    );
  });

  it("test_missing_requested_granularity_refuses", async () => {
    const withoutRequestedGranularity = Object.fromEntries(
      Object.entries(row(1)).filter(([key]) => key !== "requested_granularity"),
    );
    const source = new SupabaseRowSource(fakeKeysetClient([withoutRequestedGranularity]) as never);

    await expect(source.fetchRows(BASE_QUERY)).rejects.toThrow(
      "ResultsRepository: result_row.requested_granularity must be null or one of " +
        "mesa, establecimiento, circuito, seccion, distrito; received undefined",
    );
  });

  it("test_a_server_cap_below_the_page_size_does_not_end_the_read", async () => {
    // The loop used to stop on "shorter than the page I asked for". A server
    // whose `max-rows` is BELOW that returns a short FIRST page for a reason
    // that has nothing to do with exhaustion — silent truncation, reintroduced
    // by the exit condition of the loop written to prevent it.
    const rows = Array.from({ length: 1200 }, (_, i) => row(i));
    const source = new SupabaseRowSource(fakeKeysetClient(rows, 400) as never);

    const read = await source.fetchRows({
      electionId: "e1",
      jurisdictionId: "j1",
      categoryId: "c1",
    });

    expect(read).toHaveLength(1200);
  });

  it.each([
    ["zero number", 0, 0],
    ["maximum number", 2147483647, 2147483647],
    ["zero string", "0", 0],
    ["leading-zero string", "00042", 42],
    ["maximum string", "2147483647", 2147483647],
  ])("test_result_row_votes_accepts_%s", async (_case, votes, expected) => {
    const source = new SupabaseRowSource(fakeKeysetClient([{ ...row(1), votes }]) as never);

    const rows = await source.fetchRows(BASE_QUERY);

    expect(rows[0]?.votes).toBe(expected);
  });

  it.each([
    ["empty string", ""],
    ["space", " "],
    ["leading space", " 42"],
    ["trailing space", "42 "],
    ["positive sign", "+42"],
    ["negative number", -1],
    ["negative string", "-1"],
    ["fraction number", 1.5],
    ["fraction string", "1.5"],
    ["exponent string", "1e3"],
    ["alphabetic string", "x"],
    ["unsafe integer", Number.MAX_SAFE_INTEGER + 1],
    ["integer overflow number", 2147483648],
    ["integer overflow string", "2147483648"],
    ["null", null],
    ["undefined", undefined],
    ["boolean", true],
    ["object", { value: 42 }],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
  ])("test_result_row_votes_refuses_%s", async (_case, votes) => {
    const source = new SupabaseRowSource(fakeKeysetClient([{ ...row(1), votes }]) as never);

    await expect(source.fetchRows(BASE_QUERY)).rejects.toThrow(
      "result_row.votes must be a nonnegative 32-bit integer",
    );
  });
});

describe("SupabasePartyNameSource batches and checks its bound", () => {
  /** Keyset-shaped, and it caps every response the way the server does. */
  const mappingClient = (
    rowsFor: (batch: string[]) => Record<string, unknown>[],
    maxRows = 1000,
  ) => {
    const batches: string[][] = [];
    const client = {
      from() {
        let batch: string[] = [];
        let after: string | null = null;
        let limit = maxRows;
        const chain: Record<string, unknown> = {};
        chain["select"] = () => chain;
        chain["eq"] = () => chain;
        chain["order"] = () => chain;
        chain["limit"] = (n: number) => {
          limit = Math.min(n, maxRows);
          return chain;
        };
        chain["gt"] = (_column: string, value: string) => {
          after = value;
          return chain;
        };
        chain["in"] = (_column: string, ids: string[]) => {
          batch = ids;
          // `in` runs before `gt` in the builder chain, so every page of a
          // batch records it. Deduped by content: the claim is how many
          // DISTINCT batches were requested, not how many requests.
          if (!batches.some((seen) => seen.join() === ids.join())) batches.push(ids);
          return chain;
        };
        chain["then"] = (resolve: (r: { data: unknown; error: null }) => unknown) => {
          const all = rowsFor(batch)
            .map((row, index) => ({ id: String(index).padStart(6, "0"), ...row }))
            .sort((a, b) => String(a["id"]).localeCompare(String(b["id"])));
          const cursor = after;
          const start = cursor === null ? 0 : all.findIndex((r) => String(r["id"]) > cursor);
          const page = start === -1 ? [] : all.slice(start, start + limit);
          return resolve({ data: page, error: null });
        };
        return chain;
      },
    };
    return { client, batches };
  };

  const context = { year: 2025, jurisdiction: "national", category: "DIPUTADO NACIONAL" };

  it("test_valid_party_mapping_identifiers_are_preserved", async () => {
    const { client } = mappingClient(() => [
      {
        list_id: "list-110",
        canonical_party_id: "canonical-lla",
        party_canonical: { display_name: "ALIANZA LA LIBERTAD AVANZA" },
      },
    ]);

    const names = await new SupabasePartyNameSource(client as never).fetchPartyNames(context, [
      "list-110",
    ]);

    expect(names).toEqual(
      new Map([
        [
          "list-110",
          {
            canonicalPartyId: "canonical-lla",
            displayName: "ALIANZA LA LIBERTAD AVANZA",
          },
        ],
      ]),
    );
  });

  it.each([
    ["missing", undefined],
    ["null", null],
    ["numeric", 110],
    ["object", { id: "110" }],
    ["empty", ""],
  ])("test_party_mapping_list_id_refuses_%s", async (_case, listId) => {
    const mapping: Record<string, unknown> = {
      list_id: listId,
      canonical_party_id: "canonical-lla",
      party_canonical: { display_name: "ALIANZA LA LIBERTAD AVANZA" },
    };
    if (_case === "missing") delete mapping["list_id"];
    const { client } = mappingClient(() => [mapping]);

    await expect(
      new SupabasePartyNameSource(client as never).fetchPartyNames(context, ["list-110"]),
    ).rejects.toThrow("party_mapping.list_id must be a non-empty string");
  });

  it.each([
    ["missing", undefined],
    ["null", null],
    ["numeric", 110],
    ["object", { id: "canonical-lla" }],
    ["empty", ""],
  ])("test_party_mapping_canonical_party_id_refuses_%s", async (_case, canonicalPartyId) => {
    const mapping: Record<string, unknown> = {
      list_id: "list-110",
      canonical_party_id: canonicalPartyId,
      party_canonical: { display_name: "ALIANZA LA LIBERTAD AVANZA" },
    };
    if (_case === "missing") delete mapping["canonical_party_id"];
    const { client } = mappingClient(() => [mapping]);

    await expect(
      new SupabasePartyNameSource(client as never).fetchPartyNames(context, ["list-110"]),
    ).rejects.toThrow("party_mapping.canonical_party_id must be a non-empty string");
  });

  it("test_more_ids_than_one_batch_are_read_in_several_requests", async () => {
    // 450 ids cannot travel in one GET URL safely, and a single unbounded
    // request is what the server truncates. Every id must be asked for.
    const ids = Array.from({ length: 450 }, (_, i) => String(i));
    const { client, batches } = mappingClient((batch) =>
      batch.map((id) => ({
        list_id: id,
        canonical_party_id: `canon-${id}`,
        party_canonical: { display_name: `PARTY ${id}` },
      })),
    );

    const names = await new SupabasePartyNameSource(client as never).fetchPartyNames(context, ids);

    expect(batches).toHaveLength(3);
    expect(batches.flat()).toHaveLength(450);
    expect(names.size).toBe(450);
  });

  it("test_a_list_id_mapping_to_two_parties_refuses_rather_than_picking", async () => {
    // Two canonical parties for one list id is an ambiguous identity. Picking
    // one silently is the fabrication the whole mapping layer exists to stop.
    const { client } = mappingClient((batch) =>
      batch.flatMap((id) => [
        { list_id: id, canonical_party_id: "canon-a", party_canonical: { display_name: "A" } },
        { list_id: id, canonical_party_id: "canon-b", party_canonical: { display_name: "B" } },
      ]),
    );

    await expect(
      new SupabasePartyNameSource(client as never).fetchPartyNames(context, ["110"]),
    ).rejects.toThrow("110 -> canon-a, canon-b");
  });

  it("test_an_ambiguous_id_is_caught_even_when_another_id_has_no_mapping", async () => {
    // The count check `page.length > batch.length` balanced out here: two rows
    // for `110` and none for `999` is 2 rows for 2 ids, so the refusal never
    // fired and the loop kept whichever row came last — a silent pick on an
    // ambiguous identity.
    const { client } = mappingClient((batch) =>
      batch.includes("110")
        ? [
            { list_id: "110", canonical_party_id: "canon-a", party_canonical: { display_name: "A" } },
            { list_id: "110", canonical_party_id: "canon-b", party_canonical: { display_name: "B" } },
          ]
        : [],
    );

    await expect(
      new SupabasePartyNameSource(client as never).fetchPartyNames(context, ["110", "999"]),
    ).rejects.toThrow("110 -> canon-a, canon-b");
  });

  it("test_one_canonical_party_with_conflicting_display_names_refuses_in_every_row_order", async () => {
    const mappings = [
      { list_id: "list-a", canonical_party_id: "canon-shared", party_canonical: { display_name: "A" } },
      { list_id: "list-b", canonical_party_id: "canon-shared", party_canonical: { display_name: "B" } },
    ];
    const expectedError =
      "SupabasePartyNameSource: in (2025, national, DIPUTADO NACIONAL) these canonical parties " +
      "have conflicting display names, so no name can be chosen for them: canon-shared -> A, B";

    for (const orderedMappings of [mappings, [...mappings].reverse()]) {
      // A one-row server cap puts the two mappings on separate pages. Reassigning
      // the keyset ids makes each iteration exercise the opposite page order.
      const { client } = mappingClient(
        () => orderedMappings.map((mapping, index) => ({ ...mapping, id: String(index) })),
        1,
      );

      await expect(
        new SupabasePartyNameSource(client as never).fetchPartyNames(context, ["list-a", "list-b"]),
      ).rejects.toThrow(expectedError);
    }
  });

  it("test_canonical_relation_accepts_an_object_or_exactly_one_element_array", async () => {
    const { client } = mappingClient(() => [
      { list_id: "object", canonical_party_id: "canon-object", party_canonical: { display_name: "Object" } },
      { list_id: "array", canonical_party_id: "canon-array", party_canonical: [{ display_name: "Array" }] },
    ]);

    const names = await new SupabasePartyNameSource(client as never).fetchPartyNames(context, [
      "object",
      "array",
    ]);

    expect(names.get("object")?.displayName).toBe("Object");
    expect(names.get("array")?.displayName).toBe("Array");
  });

  it.each([
    ["empty array", []],
    ["multiple rows", [{ display_name: "A" }, { display_name: "A" }]],
    ["null", null],
    ["malformed object", { other: "A" }],
    ["empty name", { display_name: "" }],
  ])("test_canonical_relation_refuses_%s", async (_case, partyCanonical) => {
    const { client } = mappingClient(() => [
      { list_id: "list-a", canonical_party_id: "canon-a", party_canonical: partyCanonical },
    ]);

    await expect(
      new SupabasePartyNameSource(client as never).fetchPartyNames(context, ["list-a"]),
    ).rejects.toThrow(
      "SupabasePartyNameSource: list id list-a has malformed party_canonical relation in " +
        "(2025, national, DIPUTADO NACIONAL); expected an object or exactly one-element array " +
        "with a non-empty string display_name",
    );
  });
});

describe("SupabasePartyNameSource pages each batch to exhaustion", () => {
  const context = { year: 2025, jurisdiction: "national", category: "DIPUTADO NACIONAL" };

  it("test_a_server_cap_below_the_batch_size_does_not_lose_mappings", async () => {
    // A row COUNT cannot detect this: fewer resolved ids than requested is
    // also what a legitimately unmapped id looks like, so a short read and "no
    // curated mapping" are indistinguishable from outside. Reading to
    // exhaustion is the only honest answer — and a lost mapping renders as
    // "resolved to no curated party", a claim about the curated data.
    const ids = Array.from({ length: 150 }, (_, i) => String(i));
    const { client } = ((): { client: unknown } => {
      let after: string | null = null;
      const all = ids.map((id, index) => ({
        id: String(index).padStart(6, "0"),
        list_id: id,
        canonical_party_id: `canon-${id}`,
        party_canonical: { display_name: `PARTY ${id}` },
      }));
      return {
        client: {
          from() {
            const chain: Record<string, unknown> = {};
            for (const method of ["select", "eq", "in", "order", "limit"]) chain[method] = () => chain;
            chain["gt"] = (_c: string, value: string) => {
              after = value;
              return chain;
            };
            chain["then"] = (resolve: (r: { data: unknown; error: null }) => unknown) => {
              const cursor = after;
              const start = cursor === null ? 0 : all.findIndex((r) => r.id > cursor);
              // A server cap of 40 — well below both BATCH and PAGE.
              const page = start === -1 ? [] : all.slice(start, start + 40);
              return resolve({ data: page, error: null });
            };
            return chain;
          },
        },
      };
    })();

    const names = await new SupabasePartyNameSource(client as never).fetchPartyNames(context, ids);

    expect(names.size).toBe(150);
  });
});

describe("unmappedByListId separates the two ways a row has no party", () => {
  const row = (listId: string | null, votes: number): ResultRow => ({
    jurisdictionId: "j1",
    categoryId: "c1",
    listId,
    votes,
    sourceKind: "official",
    granularity: "mesa",
    archiveEntryId: "a1",
    canonicalPartyId: null,
    partyName: null,
  });

  it("test_a_row_with_no_list_id_is_not_a_list_id_that_failed_to_map", () => {
    // Historical persisted rows may legitimately have `list_id: null`; the
    // current source identity comes from `agrupacion_id`, not an empty
    // `lista_numero`. These are non-party rows, and bucketing them under
    // "(no list id)" would report them as ids that failed to map.
    const reading = unmappedByListId([row(null, 40), row("4321", 700)]);

    expect(reading.entries).toEqual([{ listId: "4321", rows: 1, votes: 700 }]);
    // PER SOURCE KIND: one aggregate collapsed distinct historical nullable
    // rows and current POSITIVO rows into a single number.
    expect(reading.withoutListId).toEqual({ official: { rows: 1, votes: 40 } });
    expect(reading.entries.some((entry) => entry.listId === "(no list id)")).toBe(false);
  });
});

describe("fetchSourceRefs reads every entry, not the first page", () => {
  const sourceRefClient = (sha256: unknown, omitSha256 = false) => {
    let after: string | null = null;
    const row: Record<string, unknown> = {
      id: "a1",
      sha256,
      source_url: "https://example.test/a1",
      fetched_at: "2026-01-01T00:00:00Z",
    };
    if (omitSha256) delete row["sha256"];
    return {
      from() {
        const chain: Record<string, unknown> = {};
        for (const method of ["select", "in", "order", "limit"]) chain[method] = () => chain;
        chain["gt"] = (_column: string, value: string) => {
          after = value;
          return chain;
        };
        chain["then"] = (resolve: (result: { data: unknown; error: null }) => unknown) =>
          resolve({ data: after === null ? [row] : [], error: null });
        return chain;
      },
    };
  };

  it.each([
    ["explicit null", null],
    ["lowercase 64-character hex", "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"],
  ])("test_source_ref_sha256_accepts_%s_unchanged", async (_case, sha256) => {
    const refs = await fetchSourceRefs(sourceRefClient(sha256) as never, ["a1"]);

    expect(refs.sources[0]?.sha256).toBe(sha256);
  });

  it.each([
    ["missing", undefined],
    ["undefined", undefined],
    ["number", 42],
    ["empty", ""],
    ["63 characters", "a".repeat(63)],
    ["non-hex", `${"a".repeat(63)}g`],
    ["uppercase", "A".repeat(64)],
  ])("test_source_ref_sha256_refuses_%s", async (_case, sha256) => {
    await expect(
      fetchSourceRefs(sourceRefClient(sha256, _case === "missing") as never, ["a1"]),
    ).rejects.toThrow("archive_entry.sha256 must be null or lowercase 64-character hex");
  });

  it("test_a_server_cap_below_the_batch_does_not_report_entries_as_missing", async () => {
    // A truncated response here does not lose a row quietly: it lands in
    // `missing`, which the pages render as "this figure cannot be traced" — a
    // claim about the ARCHIVE produced by a short read.
    const ids = Array.from({ length: 300 }, (_, i) => `entry-${String(i).padStart(4, "0")}`);
    const all = ids.map((id) => ({
      id,
      sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      source_url: `https://example.test/${id}`,
      fetched_at: "2026-01-01T00:00:00Z",
    }));
    let after: string | null = null;
    const client = {
      from() {
        const chain: Record<string, unknown> = {};
        for (const method of ["select", "in", "order", "limit"]) chain[method] = () => chain;
        chain["gt"] = (_c: string, value: string) => {
          after = value;
          return chain;
        };
        chain["then"] = (resolve: (r: { data: unknown; error: null }) => unknown) => {
          const cursor = after;
          const start = cursor === null ? 0 : all.findIndex((row) => row.id > cursor);
          // A server cap of 50 — below both BATCH and PAGE.
          return resolve({ data: start === -1 ? [] : all.slice(start, start + 50), error: null });
        };
        return chain;
      },
    };

    const refs = await fetchSourceRefs(client as never, ids);

    expect(refs.sources).toHaveLength(300);
    expect(refs.missing).toEqual([]);
  });
});

describe("the columns identity and provenance depend on are checked", () => {
  const resultRowRecord = (listId: unknown): Record<string, unknown> => ({
    id: "000001",
    jurisdiction_id: "j1",
    category_id: "c1",
    list_id: listId,
    votes: 10,
    source_kind: "official",
    granularity: "mesa",
    requested_granularity: "mesa",
    archive_entry_id: "a1",
  });

  it.each([
    ["string", "110"],
    ["leading-zero string", "00110"],
    ["explicit null", null],
  ])("test_result_row_list_id_accepts_%s_unchanged", async (_case, listId) => {
    const source = new SupabaseRowSource(fakeKeysetClient([resultRowRecord(listId)]) as never);

    const rows = await source.fetchRows(BASE_QUERY);

    expect(rows[0]?.listId).toBe(listId);
  });

  it.each([
    ["missing", undefined],
    ["undefined", undefined],
    ["empty", ""],
    ["whitespace-only", "   "],
    ["leading whitespace", " 110"],
    ["trailing whitespace", "110 "],
    ["numeric", 110],
    ["object", { id: "110" }],
    ["boolean", true],
  ])("test_result_row_list_id_refuses_%s", async (_case, listId) => {
    const record = resultRowRecord(listId);
    if (_case === "missing") delete record["list_id"];
    const source = new SupabaseRowSource(fakeKeysetClient([record]) as never);

    await expect(source.fetchRows(BASE_QUERY)).rejects.toThrow(
      "result_row.list_id must be null or a non-empty trimmed string",
    );
  });

  it("test_a_numeric_list_id_refuses_instead_of_emptying_the_mapping", async () => {
    // `SupabasePartyNameSource` keys its map with `String(list_id)`, so a
    // numeric column misses on EVERY row and `resolvePartyNames` writes
    // `partyName: null` — the defined "no curated mapping" state. The page
    // would report the curated table as empty because of a column type.
    const source = new SupabaseRowSource(
      fakeKeysetClient([
        {
          id: "000001",
          jurisdiction_id: "j1",
          category_id: "c1",
          list_id: 110,
          votes: 10,
          source_kind: "official",
          granularity: "mesa",
          archive_entry_id: "a1",
        },
      ]) as never,
    );

    await expect(
      source.fetchRows({ electionId: "e1", jurisdictionId: "j1", categoryId: "c1" }),
    ).rejects.toThrow("result_row.list_id must be null or a non-empty trimmed string");
  });

  it("test_an_entry_with_no_source_url_is_not_reported_as_traced", async () => {
    // Present in `sources` and absent from `missing` renders the figure as
    // TRACED with nothing behind it — unverifiable shown as verified, which is
    // worse than the blank digest the `sha256` comment already rejects.
    let after: string | null = null;
    const rows = [
      { id: "a1", sha256: null, source_url: null, fetched_at: "2026-01-01T00:00:00Z" },
    ];
    const client = {
      from() {
        const chain: Record<string, unknown> = {};
        for (const method of ["select", "in", "order", "limit"]) chain[method] = () => chain;
        chain["gt"] = (_c: string, value: string) => {
          after = value;
          return chain;
        };
        chain["then"] = (resolve: (r: { data: unknown; error: null }) => unknown) =>
          resolve({ data: after === null ? rows : [], error: null });
        return chain;
      },
    };

    await expect(fetchSourceRefs(client as never, ["a1"])).rejects.toThrow(
      "has no usable source_url",
    );
  });
});

describe("one definition of a resolved party", () => {
  const row = (
    canonicalPartyId: string | null,
    partyName: string | null,
    listId: string | null,
  ): ResultRow => ({
    jurisdictionId: "j1",
    categoryId: "c1",
    listId,
    votes: 55,
    sourceKind: "official",
    granularity: "mesa",
    archiveEntryId: "a1",
    canonicalPartyId,
    partyName,
  });

  it("test_a_row_with_an_id_but_no_name_is_unresolved_and_lands_in_a_bucket", () => {
    // `compare` re-derived this test inline, so a row shaped
    // `{canonicalPartyId: set, partyName: null, listId: null}` was excluded
    // from every figure there while its disclosure depended on THIS fold
    // agreeing by coincidence. One predicate, both places.
    expect(isPartyResolved(row("canon-1", null, null))).toBe(false);

    const reading = unmappedByListId([row("canon-1", null, null)]);

    expect(reading.withoutListId).toEqual({ official: { rows: 1, votes: 55 } });
  });
});
