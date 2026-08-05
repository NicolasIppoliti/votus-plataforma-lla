import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { SourceRef } from "@/lib/results/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ResultRow } from "@/lib/fiscalizacion/repository";

/**
 * A refused query and an empty result are different answers. This page turned
 * the first into the second: `response.status === "ok" ? response.rows : []`
 * discarded the refusal, and the page then rendered "No official results
 * found" — a factual claim about the data — for a read the database declined.
 */

let repositoryRows: ResultRow[] = [];
let refuseWith: string | null = null;
let sourceRefs: SourceRef[] = [];
/** When true, the repository's own filter is bypassed — a simulated regression. */
let leakAggregate = false;
let leakFiscalizacion = false;

vi.mock("@/lib/supabase/server-client", () => ({
  createSupabaseServerClient: () => Promise.resolve({}),
}));

vi.mock("@/lib/fiscalizacion/repository", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/fiscalizacion/repository")>();
  return {
    ...actual,
    createResultsRepository: () => {
      const repository = new actual.ResultsRepository(
        {
          fetchRows: () =>
            // A denied read RAISES — the shape RLS denial actually takes.
            refuseWith
              ? Promise.reject(new Error(refuseWith))
              : Promise.resolve(repositoryRows),
        },
        {
          // Keyed on the FULL context: the page refuses without
          // `partyCategory`/`partyJurisdiction` and derives the year from the
          // election id, yet nothing proved any of it reached the name source.
          fetchPartyNames: (context) =>
            context.year !== 2025 ||
            context.jurisdiction !== "national" ||
            context.category !== "DIPUTADO NACIONAL"
              ? Promise.resolve(new Map())
              : Promise.resolve(
                  new Map([
                    ["110", { canonicalPartyId: "lla", displayName: "LA LIBERTAD AVANZA" }],
                  ]),
                ),
        },
      );

      if (leakAggregate) {
        // Path 2 REGRESSES: its filter widens, so the sum runs over EVERY row.
        // That is what a broken filter produces — and `summedByKind`, derived
        // from the rows that were summed, then names the kind that got in.
        repository.aggregateOfficialVotes = () =>
          Promise.resolve({
            totalVotes: repositoryRows.reduce((sum, row) => sum + row.votes, 0),
            sourceKind: "official" as const,
            // DIFFERENT from path 1's: an independent read drops its own rows,
            // and a fixture where both tallies match lets path 1's note stand
            // in for path 2's — the substitution this page forbids in writing.
            excluded: { unknown: { rows: 4, votes: 777 } },
            summedByKind: actual.tallyByKind(repositoryRows),
          });
      }
      if (leakFiscalizacion) {
        // The filter REGRESSES. Path 3 exists for exactly this and is
        // unreachable while path 1 works, so simulating the failure is the
        // only way to drive it — the comment claimed a test that did not exist.
        repository.queryOfficial = () =>
          Promise.resolve({ status: "ok", rows: repositoryRows, excluded: {} });
      }
      return Promise.resolve(repository);
    },
    fetchSourceRefs: () => Promise.resolve({ sources: sourceRefs, missing: [] }),
  };
});

const { default: DrilldownPage } = await import("./page");

beforeEach(() => {
  process.env["NATIONAL_JURISDICTION_ID"] = "j-027";
});

afterEach(() => {
  delete process.env["NATIONAL_JURISDICTION_ID"];
  repositoryRows = [];
  refuseWith = null;
  leakFiscalizacion = false;
  leakAggregate = false;
  sourceRefs = [];
});

const PARAMS = {
  electionId: "2025-legislativas-nacional",
  jurisdictionId: "j-027",
  categoryId: "c-diputados",
  // List ids resolve only through their own election's mapping.
  partyCategory: "DIPUTADO NACIONAL",
  partyJurisdiction: "national",
};

describe("drilldown page", () => {
  it("test_a_refused_query_is_reported_not_rendered_as_no_results", async () => {
    refuseWith = "row-level security denied the read";

    const markup = renderToStaticMarkup(
      (await DrilldownPage({ searchParams: Promise.resolve(PARAMS) })) as ReactElement,
    );

    expect(markup).toContain("row-level security denied the read");
    // "No official results found" asserts something about the DATA. Saying it
    // about a refused read states a fact nobody established.
    expect(markup).not.toContain("No official results found");
  });

  it("test_an_empty_result_still_says_it_found_nothing", async () => {
    repositoryRows = [];

    const markup = renderToStaticMarkup(
      (await DrilldownPage({ searchParams: Promise.resolve(PARAMS) })) as ReactElement,
    );

    expect(markup).toContain("No official results found");
  });
});

describe("drilldown page — mixed levels are not summed", () => {
  it("test_mixed_granularity_rows_withhold_the_figure_rather_than_double_count", async () => {
    const base = {
      jurisdictionId: "j-027",
      categoryId: "c-diputados",
      listId: "110",
      votes: 10,
      sourceKind: "official" as const,
      archiveEntryId: "national/2025-legislativas",
    };
    repositoryRows = [
      { ...base, granularity: "mesa" },
      { ...base, granularity: "seccion" },
    ];

    const markup = renderToStaticMarkup(
      (await DrilldownPage({ searchParams: Promise.resolve(PARAMS) })) as ReactElement,
    );

    // A `seccion` row already CONTAINS the mesa row beneath it, so adding them
    // reports 20 votes for a party that got 10. Disclosing the mix and then
    // summing it anyway was the defect: disclosure is not permission.
    expect(markup).toContain("summing them would double-count");
    expect(markup).toContain("No per-party figures");
    // And NO badge: `readGranularity` folds to the coarsest level, so a badge
    // beside the refusal names one of the mixed levels as if it were the set's.
    expect(markup).not.toContain('aria-label="granularity:');
    expect(markup).not.toContain("20 votes");
    // The independent read's total is built the same way, so it goes too.
    expect(markup).not.toContain("Official total:");
  });
});

describe("drilldown page — the source-kind filter reports what it dropped", () => {
  it("test_excluded_rows_are_named_per_kind", async () => {
    // A row the filter removes appears in no figure. Counting it and rendering
    // nothing left the count dead — and a NULL or unknown `source_kind` is
    // dropped by EVERY query, so it would appear nowhere at all.
    repositoryRows = [
      {
        jurisdictionId: "j-027",
        categoryId: "c-diputados",
        listId: "110",
        votes: 100,
        sourceKind: "official",
        granularity: "mesa",
        archiveEntryId: "national/2025-legislativas",
      },
      {
        jurisdictionId: "j-027",
        categoryId: "c-diputados",
        listId: "110",
        votes: 60,
        sourceKind: "fiscalizacion",
        granularity: "mesa",
        archiveEntryId: "fiscalizacion/2025-lla",
      },
      {
        jurisdictionId: "j-027",
        categoryId: "c-diputados",
        listId: "110",
        votes: 5,
        sourceKind: "encuesta" as never,
        granularity: "mesa",
        archiveEntryId: "otro/2025",
      },
    ];

    const markup = renderToStaticMarkup(
      (await DrilldownPage({ searchParams: Promise.resolve(PARAMS) })) as ReactElement,
    );

    // The AGGREGATE path: the total must count official rows only. 100, never
    // 165 — that is what makes this one of the three independent guards
    // rather than a number that trusts the query above it.
    expect(markup).toContain("Official total: 100 votes");
    expect(markup).toContain("1 fiscalizacion");
    // The value outside the enum is named, not folded into silence.
    expect(markup).toContain("1 unknown");
  });
});

describe("drilldown page — path 3 fires when the repository filter regresses", () => {
  it("test_a_leaked_fiscalizacion_row_is_refused_at_the_render", async () => {
    leakFiscalizacion = true;
    repositoryRows = [
      {
        jurisdictionId: "j-027",
        categoryId: "c-diputados",
        listId: "110",
        votes: 100,
        sourceKind: "fiscalizacion",
        granularity: "mesa",
        archiveEntryId: "fiscalizacion/2025-lla",
      },
    ];

    const markup = renderToStaticMarkup(
      (await DrilldownPage({ searchParams: Promise.resolve(PARAMS) })) as ReactElement,
    );

    // The FULL phrase: `"are not"` carries no refusal semantics on its own.
    expect(markup).toContain("are not official");
    // And the BREAKDOWN, in both units: a bare "1 of 1 rows" cannot tell a
    // leaked fiscalización row from a leaked unknown-kind one, and hides how
    // many votes came with it.
    expect(markup).toContain("1 fiscalizacion row(s) / 100 vote(s)");
    expect(markup).not.toContain("Official total:");
  });
});

describe("drilldown page — provenance reaches the render", () => {
  it("test_every_displayed_figure_traces_to_an_archived_source", async () => {
    // Both siblings mocked `fetchSourceRefs` to `[]`, so every success-path
    // test rendered an empty `<ul>` and nothing asserted a source ever reached
    // the page.
    sourceRefs = [
      {
        archiveEntryId: "national/2025-legislativas",
        sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        url: "https://example.test/2025-legislativas.zip",
        fetchedAt: "2026-01-01T00:00:00Z",
      },
    ];
    repositoryRows = [
      {
        jurisdictionId: "j-027",
        categoryId: "c-diputados",
        listId: "110",
        votes: 100,
        sourceKind: "official",
        granularity: "mesa",
        archiveEntryId: "national/2025-legislativas",
      },
    ];

    const markup = renderToStaticMarkup(
      (await DrilldownPage({ searchParams: Promise.resolve(PARAMS) })) as ReactElement,
    );

    expect(markup).toContain("https://example.test/2025-legislativas.zip");
    expect(markup).toContain("e3b0c442");
  });
});

describe("drilldown page — a repeated query param reaches the guard", () => {
  it("test_a_repeated_query_param_is_reported_not_treated_as_absent", async () => {
    // Next.js hands `string[]` for a repeated param, and `stringParam`
    // returned `undefined` for those — so a SUPPLIED value vanished and the
    // page asked for a parameter the request had sent twice. The unit test in
    // `query-params.test.ts` is not evidence this page reaches the guard.
    const markup = renderToStaticMarkup(
      (await DrilldownPage({
        searchParams: Promise.resolve({ ...PARAMS, jurisdictionId: ["j-027", "j-028"] }),
      })) as ReactElement,
    );

    expect(markup).toContain("jurisdictionId");
    expect(markup).toContain("more than once");
  });
});

describe("drilldown page — an omitted param is named as omitted", () => {
  it("test_a_missing_party_jurisdiction_is_not_reported_as_a_mismatch", async () => {
    // Run after the family guard, this rendered "j-027 is mapped by the
    // national party table, not undefined" — the wrong cause, with an empty
    // interpolation where a value belongs.
    const { partyJurisdiction: _omitted, ...withoutJurisdiction } = PARAMS;

    const markup = renderToStaticMarkup(
      (await DrilldownPage({
        searchParams: Promise.resolve(withoutJurisdiction),
      })) as ReactElement,
    );

    expect(markup).toContain("partyJurisdiction");
    expect(markup).not.toContain("not undefined");
    expect(markup).not.toContain("is mapped by the");
  });
});

describe("drilldown page — the figure's level is disclosed", () => {
  it("test_mesa_rows_summed_into_a_jurisdiction_total_say_so", async () => {
    // `votesByParty` sums every row per party across one jurisdiction, so the
    // raw row level claimed `mesa` over a figure that IS every mesa added up —
    // the third page to derive this label its own way while the boundary
    // existed.
    repositoryRows = [
      {
        jurisdictionId: "j-027",
        categoryId: "c-diputados",
        listId: "110",
        votes: 100,
        sourceKind: "official",
        granularity: "mesa",
        archiveEntryId: "national/2025-legislativas",
      },
    ];

    const markup = renderToStaticMarkup(
      (await DrilldownPage({ searchParams: Promise.resolve(PARAMS) })) as ReactElement,
    );

    // NOT `distrito` (the province) and NOT `mesa` (a detail the sum dropped).
    expect(markup).toContain('aria-label="granularity: seccion"');
    expect(markup).toContain("summed from mesa");
  });
});

describe("drilldown page — an unhashed source is not silently quotable", () => {
  it("test_a_source_without_a_digest_says_it_cannot_be_verified", async () => {
    // `sha256` travels as `string | null` deliberately — NO `?? ""` — so an
    // unhashed entry renders as unverifiable rather than as a blank that reads
    // like a digest. Every page fixture carried a digest, so the branch that
    // decides whether a figure is quotable had no entry-point driver.
    sourceRefs = [
      {
        archiveEntryId: "national/2025-legislativas",
        sha256: null,
        url: "https://example.test/2025-legislativas.zip",
        fetchedAt: "2026-01-01T00:00:00Z",
      },
    ];
    repositoryRows = [
      {
        jurisdictionId: "j-027",
        categoryId: "c-diputados",
        listId: "110",
        votes: 100,
        sourceKind: "official",
        granularity: "mesa",
        archiveEntryId: "national/2025-legislativas",
      },
    ];

    const markup = renderToStaticMarkup(
      (await DrilldownPage({ searchParams: Promise.resolve(PARAMS) })) as ReactElement,
    );

    expect(markup).toContain("unhashed — this entry cannot be verified");
  });
});

describe("drilldown page — path 3 covers the aggregate too", () => {
  it("test_a_total_summed_from_foreign_rows_is_refused_at_the_render", async () => {
    // `aggregateOfficialVotes` is an independent fetch with its own filter, so
    // its total is a SECOND displayed number. The render-side guard inspected
    // only path 1's rows, so a regression here printed fiscalización votes
    // inside "Official total" with nothing refusing.
    leakAggregate = true;
    repositoryRows = [
      {
        jurisdictionId: "j-027",
        categoryId: "c-diputados",
        listId: "110",
        votes: 100,
        sourceKind: "official",
        granularity: "mesa",
        archiveEntryId: "national/2025-legislativas",
      },
      // The row a widened filter lets into the sum.
      {
        jurisdictionId: "j-027",
        categoryId: "c-diputados",
        listId: "110",
        votes: 60,
        sourceKind: "fiscalizacion",
        granularity: "mesa",
        archiveEntryId: "fiscalizacion/2025-lla",
      },
    ];

    const markup = renderToStaticMarkup(
      (await DrilldownPage({ searchParams: Promise.resolve(PARAMS) })) as ReactElement,
    );

    expect(markup).toContain("summed from rows that are not official");
    expect(markup).toContain("1 fiscalizacion row(s) / 60 vote(s)");
    // Path 2's OWN drop, which path 1 never saw. Counted moments before this
    // refusal and then discarded behind it.
    // No apostrophe in the needle: `renderToStaticMarkup` escapes it to
    // `&#x27;`, so the literal sentence never appears verbatim.
    expect(markup).toContain("own read excluded");
    expect(markup).toContain("4 unknown row(s) / 777 vote(s)");
    // The inflated number must not reach the page at all.
    expect(markup).not.toContain("Official total:");
  });
});
