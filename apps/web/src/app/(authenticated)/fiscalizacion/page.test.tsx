import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readGranularity, unrecognizedLevels } from "@/lib/results/granularity";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ResultsRepository } from "@/lib/fiscalizacion/repository";
import type { ResultRow, RowSource } from "@/lib/fiscalizacion/repository";
import type { SourceRef } from "@/lib/results/types";
import FiscalizacionPage, { FISCALIZACION_COVERAGE, FISCALIZACION_PARTY_CONTEXT, loadFiscalizacionView, renderFiscalizacionView,
  comparisonFromParams,
  loadOfficialComparison,
  topParty,
  partyShare,
} from "./page";

/**
 * fiscalizacion-analysis spec, "An operator route reaches fiscalización
 * through the opt-in path" (Requirement 8) — this route was previously
 * complete and unreachable: no page called `repository.queryFiscalizacion()`
 * (Phase 13 preamble). These tests exercise the page's own data-loading and
 * rendering functions directly (RSC pages have no client-side DOM to mount),
 * matching the existing convention in `GranularityBadge.test.tsx` and
 * `repository.test.ts`'s `fakeRowSource` seam.
 */

/** Rows the mocked repository returns for the entry-point tests. */
let repositoryRows: ResultRow[] = [];
/** Sources the mocked `fetchSourceRefs` returns for the entry-point tests. */
let sourceRefs: SourceRef[] = [];
/** When set, the mocked repository refuses the fiscalización query. */
let refuseQueryWith: string | null = null;

// Restored after EVERY test: `process.env` and `repositoryRows` are shared
// module state, so leaving them set makes results depend on execution order.
afterEach(() => {
  delete process.env["NATIONAL_JURISDICTION_ID"];
  delete process.env["FISCALIZACION_CATEGORY_ID"];
  repositoryRows = [];
  sourceRefs = [];
  refuseQueryWith = null;
});

vi.mock("@/lib/supabase/server-client", () => ({
  createSupabaseServerClient: () => Promise.resolve({}),
}));

vi.mock("@/lib/fiscalizacion/repository", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/fiscalizacion/repository")>();
  return {
    ...actual,
    createResultsRepository: () => {
      const repository = new actual.ResultsRepository(
        { fetchRows: () => Promise.resolve(repositoryRows) },
        {
          fetchPartyNames:
            // Keyed on the FULL context. Ignoring it meant every entry-point
            // test resolved party names whether the route's mapping context
            // reached the source or not — the wiring the page refuses without
            // was the one thing no test drove.
            (context) =>
              // The comparison side resolves through ITS OWN year, so the year
              // is not pinned here — the jurisdiction and category are, and
              // those are what the route hardcodes.
              context.jurisdiction !== "national" ||
              context.category !== "DIPUTADO NACIONAL"
                ? Promise.resolve(new Map())
                : Promise.resolve(
              new Map([
                ["110", { canonicalPartyId: "canon-110", displayName: "LA LIBERTAD AVANZA" }],
                ["999", { canonicalPartyId: "canon-999", displayName: "FUERZA PATRIA" }],
              ]),
            ),
        },
      );
      if (refuseQueryWith) {
        // The production refusal paths — RLS denial, a failed query — which
        // a repository that always answers `ok` can never reach.
        // A denied read THROWS from `fetchRows`. Overriding
        // `queryFiscalizacion` to return the opt-in status asserted a shape
        // production cannot produce, and left the real path untested.
        repository.queryFiscalizacion = () => Promise.reject(new Error(refuseQueryWith as string));
      }
      return Promise.resolve(repository);
    },
    // Computes `missing` the way the real function does — a mock that always
    // answers `[]` cannot exercise the untraceable-entry path it feeds.
    fetchSourceRefs: (_client: unknown, ids: string[]) =>
      Promise.resolve({
        sources: sourceRefs,
        missing: ids.filter((id) => !sourceRefs.some((ref) => ref.archiveEntryId === id)),
      }),
  };
});

function fakeRowSource(rows: ResultRow[]): RowSource {
  return { fetchRows: () => Promise.resolve(rows) };
}

const QUERY = { electionId: "2025-legislativas-nacional", jurisdictionId: "j-027", categoryId: "c-diputados" };

const FISCALIZACION_ROWS: ResultRow[] = [
  {
    jurisdictionId: "j-027",
    categoryId: "c-diputados",
    listId: "110",
    votes: 12578,
    sourceKind: "fiscalizacion",
    granularity: "mesa",
    archiveEntryId: "fiscalizacion/2025-lla",
  },
];

/** A single fiscalización row to vary in the figure tests. */
const FISCALIZACION_ROW: ResultRow = {
  jurisdictionId: "j-027",
  categoryId: "c-diputados",
  listId: "110",
  votes: 12578,
  sourceKind: "fiscalizacion",
  granularity: "mesa",
  archiveEntryId: "fiscalizacion/2025-lla",
};

/** A single official row to vary in the comparison tests. */
const OFFICIAL_ROW: ResultRow = {
  jurisdictionId: "j-027",
  categoryId: "c-diputados",
  listId: "110",
  votes: 100,
  sourceKind: "official",
  granularity: "mesa",
  // 2023: this row stands in for the COMPARISON election, so hardcoding the
  // 2025 entry made the cross-election provenance assertion pass on a figure
  // carrying the wrong archive entry.
  archiveEntryId: "national/2023-generales",
};

const OFFICIAL_ROWS: ResultRow[] = [
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

describe("fiscalizacion page — loadFiscalizacionView", () => {
  it("test_route_requests_fiscalizacion_through_the_opt_in_path", async () => {
    const repository = new ResultsRepository(fakeRowSource([...FISCALIZACION_ROWS, ...OFFICIAL_ROWS]));
    const queryFiscalizacionSpy = vi.spyOn(repository, "queryFiscalizacion");
    const queryOfficialSpy = vi.spyOn(repository, "queryOfficial");

    const view = await loadFiscalizacionView(repository, QUERY);

    expect(queryFiscalizacionSpy).toHaveBeenCalledWith(
      QUERY,
      { coverage: FISCALIZACION_COVERAGE },
      FISCALIZACION_PARTY_CONTEXT,
    );
    expect(queryOfficialSpy).not.toHaveBeenCalled();
    expect(view.status).toBe("ok");
    if (view.status !== "ok") throw new Error("expected ok status");
    expect(view.rows.every((row) => row.sourceKind === "fiscalizacion")).toBe(true);
  });

});

describe("fiscalizacion page — renderFiscalizacionView", () => {
  it("test_every_fiscalizacion_figure_carries_unofficial_indicator_and_coverage", () => {
    const html = renderToStaticMarkup(
      renderFiscalizacionView({
        status: "ok",
        rows: FISCALIZACION_ROWS,
        excluded: {},
        coverage: FISCALIZACION_COVERAGE,
      }),
    );

    expect(html.toLowerCase()).toContain("unofficial");
    // Tied to the coverage note's own element: bare `93` and `153` also match
    // a vote count, a percentage, or a slice of a sha256 digest, and neither
    // says which figure the denominator belongs to.
    const coverageNote = html.slice(html.indexOf('role="note"'));
    expect(coverageNote).toContain("93 of 153 mesas");
  });

  it("test_coverage_indicator_states_it_is_not_a_random_sample", () => {
    const html = renderToStaticMarkup(
      renderFiscalizacionView({
        status: "ok",
        rows: FISCALIZACION_ROWS,
        excluded: {},
        coverage: FISCALIZACION_COVERAGE,
      }),
    );

    expect(html.toLowerCase()).toContain("not a random sample");
    // Tied to the coverage NOTE's own element. `toContain("93")` also matches
    // a vote count, a percentage or a sha256 digest, and says nothing about
    // which figure it belongs to.
    const note = html.slice(html.indexOf('role="note"'));
    expect(note).toContain("93 of 153 mesas");
  });

  it("test_official_figure_inside_the_view_carries_its_own_official_indicator", () => {
    const html = renderToStaticMarkup(
      renderFiscalizacionView(
        {
          status: "ok",
          excluded: {},
          // The row must RESOLVE to the compared party: the badge only renders
          // when both sides describe the same one, so an unmapped row yields
          // no badge at all rather than an unmatched pair of numbers.
          rows: [
            { ...FISCALIZACION_ROW, partyName: "LA LIBERTAD AVANZA", canonicalPartyId: "canon-110" },
          ],
          coverage: FISCALIZACION_COVERAGE,
        },
        {
          comparison: {
            electionId: "2023-municipal-coronel-rosales",
            electionLabel: "2023 municipal",
            sourceKind: "official",
            sharePercent: 29.31,
            canonicalPartyId: "canon-110",
            partyName: "LA LIBERTAD AVANZA",
            archiveEntryIds: ["national/2023-generales"],
          },
        },
      ),
    );

    expect(html.toLowerCase()).toContain("official source");
    // Both source kinds must be visually distinguishable — the two labels
    // must be different strings, never the same badge text reused.
    const unofficialText = html.toLowerCase().match(/unofficial source/g) ?? [];
    const officialText = html.toLowerCase().match(/(?<!un)official source/g) ?? [];
    expect(unofficialText.length).toBeGreaterThan(0);
    expect(officialText.length).toBeGreaterThan(0);
  });

  it("renders the refusal state, not an unlabelled figure, when refused", () => {
    const html = renderToStaticMarkup(
      renderFiscalizacionView({ status: "refused", reason: "no coverage supplied" }),
    );

    expect(html.toLowerCase()).toContain("refus");
    expect(html).not.toContain("12578");
  });
});

describe("comparisonFromParams (Requirement 9 — juxtaposition must be reachable)", () => {
  it("test_comparison_absent_when_no_query_params_supplied", () => {
    expect(comparisonFromParams({})).toEqual({ status: "none" });
  });

  it("test_comparison_names_the_election_and_carries_no_figure", () => {
    // The scope must be pinned: `comparisonFromParams` refuses an unpinned
    // one on its own rather than skipping its checks.
    process.env["NATIONAL_JURISDICTION_ID"] = "j-027";
    process.env["FISCALIZACION_CATEGORY_ID"] = "c-diputados";

    const comparison = comparisonFromParams({
      compareElectionId: "2023-municipal",
      compareElectionLabel: "2023 municipal (official)",
      compareYear: "2023",
      compareCategory: "DIPUTADO NACIONAL",
      compareJurisdiction: "national",
      compareJurisdictionId: "j-027",
      compareCategoryId: "c-diputados",
      // Ignored on purpose: a share supplied by the request is not evidence.
      compareSharePercent: "29.31",
    });

    expect(comparison).toEqual({
      status: "ok",
      request: {
        electionId: "2023-municipal",
        electionLabel: "2023 municipal (official)",
        // The comparison election's OWN ids, not this one's.
        jurisdictionId: "j-027",
        categoryId: "c-diputados",
        partyContext: { year: 2023, jurisdiction: "national", category: "DIPUTADO NACIONAL" },
      },
    });
  });


  it("test_incomplete_comparison_params_are_refused_with_the_missing_names", () => {
    // A half-specified comparison must not render a figure with a missing label.
    expect(comparisonFromParams({})).toEqual({ status: "none" });
    // Half-specified is REFUSED, and names what is missing -- distinct from
    // "no comparison was asked for".
    const refused = comparisonFromParams({ compareElectionId: "2023-municipal" });

    expect(refused.status).toBe("refused");
    if (refused.status !== "refused") throw new Error("expected refused");
    // EVERY missing name, not the first one. A reason listing one field would
    // send the operator back for another round per field.
    for (const name of [
      "compareElectionLabel",
      "compareYear",
      "compareCategory",
      "compareJurisdiction",
      "compareJurisdictionId",
      "compareCategoryId",
    ]) {
      expect(refused.reason).toContain(name);
    }
  });
});

describe("fiscalizacion page — the real entry point", () => {
  /**
   * `FiscalizacionPage` is what an HTTP request reaches. Every other test in
   * this file calls the helpers directly, which is exactly how the badge
   * shipped with a production call site hardcoding `comparison: undefined`
   * while its component tests passed.
   */
  it("test_the_page_refuses_an_election_its_constants_were_not_verified_against", async () => {
    const markup = renderToStaticMarkup(
      (await FiscalizacionPage({
        searchParams: Promise.resolve({
          electionId: "2023-generales",
          jurisdictionId: "j-027",
          categoryId: "c-diputados",
        }),
      })) as ReactElement,
    );

    expect(markup).toContain("Refused");
    expect(markup).toContain("2025-legislativas-nacional");
  });

  it("test_the_page_renders_the_juxtaposition_through_a_real_request", async () => {
    // The WHOLE wiring: params -> comparison request -> official query ->
    // party match -> badge. Every other comparison test calls the helpers
    // directly, which is exactly how the badge shipped with a production call
    // site hardcoding `comparison: undefined` while its component tests
    // passed.
    process.env["NATIONAL_JURISDICTION_ID"] = "j-027";
    process.env["FISCALIZACION_CATEGORY_ID"] = "c-diputados";
    repositoryRows = [
      { ...FISCALIZACION_ROW, listId: "110", votes: 60 },
      { ...FISCALIZACION_ROW, listId: "999", votes: 40 },
      { ...OFFICIAL_ROW, listId: "110", votes: 25 },
      { ...OFFICIAL_ROW, listId: "999", votes: 75 },
    ];

    const markup = renderToStaticMarkup(
      (await FiscalizacionPage({
        searchParams: Promise.resolve({
          electionId: "2025-legislativas-nacional",
          jurisdictionId: "j-027",
          categoryId: "c-diputados",
          compareElectionId: "2023-generales",
          compareElectionLabel: "22 Oct 2023 generales",
          compareYear: "2023",
          compareCategory: "DIPUTADO NACIONAL",
          compareJurisdiction: "national",
          compareJurisdictionId: "j-027",
          compareCategoryId: "c-diputados",
        }),
      })) as ReactElement,
    );

    expect(markup).toContain("cross-election juxtaposition");
    // ONE party on both sides, and each side's own number: 60 % of the
    // fiscalización rows, 25 % of the official ones — never the official
    // side's own winner at 75 %.
    expect(markup).toContain("60%");
    expect(markup).toContain("25%");
    expect(markup).not.toContain("75%");
  });

  it("test_the_page_refuses_a_jurisdiction_the_coverage_denominator_does_not_describe", async () => {
    process.env["NATIONAL_JURISDICTION_ID"] = "j-027";
    process.env["FISCALIZACION_CATEGORY_ID"] = "c-diputados";

    const markup = renderToStaticMarkup(
      (await FiscalizacionPage({
        searchParams: Promise.resolve({
          electionId: "2025-legislativas-nacional",
          jurisdictionId: "j-999",
          categoryId: "c-diputados",
        }),
      })) as ReactElement,
    );

    expect(markup).toContain("Refused");
    // The refusal SENTENCE. A bare "93" also matches a vote count, a
    // percentage, or a slice of a sha256 digest, so it could not fail.
    expect(markup).toContain("93-of-153 coverage denominator describes one jurisdiction");
  });

  it("test_the_page_refuses_when_the_scope_is_not_configured", async () => {
    // `afterEach` cleared the env vars, so the scope is unpinned here. This
    // branch -- the guard that stops an unpinned scope from labelling any
    // jurisdiction with the 93-of-153 denominator -- had no test: the one
    // request that ran without them exited on the electionId check first.
    const markup = renderToStaticMarkup(
      (await FiscalizacionPage({
        searchParams: Promise.resolve({
          electionId: "2025-legislativas-nacional",
          jurisdictionId: "j-027",
          categoryId: "c-diputados",
        }),
      })) as ReactElement,
    );

    expect(markup).toContain("Refused");
    expect(markup).toContain("NATIONAL_JURISDICTION_ID");
  });

  it("test_a_refused_comparison_says_so_instead_of_rendering_nothing", async () => {
    process.env["NATIONAL_JURISDICTION_ID"] = "j-027";
    process.env["FISCALIZACION_CATEGORY_ID"] = "c-diputados";
    repositoryRows = [{ ...FISCALIZACION_ROW, listId: "110", votes: 60 }];

    const markup = renderToStaticMarkup(
      (await FiscalizacionPage({
        searchParams: Promise.resolve({
          electionId: "2025-legislativas-nacional",
          jurisdictionId: "j-027",
          categoryId: "c-diputados",
          compareElectionId: "2023-municipal",
          compareElectionLabel: "2023 municipal",
          compareYear: "2023",
          compareCategory: "CONCEJALES",
          compareJurisdiction: "pba",
          compareJurisdictionId: "j-027",
          compareCategoryId: "c-concejales",
        }),
      })) as ReactElement,
    );

    // Rendering nothing left the operator unable to tell "no comparison
    // requested" from "requested and impossible".
    expect(markup).toContain("No comparison figure");
    expect(markup).toContain("national");
  });

  it("test_every_displayed_figure_traces_to_an_archived_source", async () => {
    // Every entry-point test stubbed `fetchSourceRefs` to empty, so
    // `ProvenanceLink` never rendered a source in any page-level test and
    // nothing asserted the contract the module's own docstring states.
    process.env["NATIONAL_JURISDICTION_ID"] = "j-027";
    process.env["FISCALIZACION_CATEGORY_ID"] = "c-diputados";
    repositoryRows = [{ ...FISCALIZACION_ROW, listId: "110", votes: 60 }];
    sourceRefs = [
      {
        archiveEntryId: "fiscalizacion/2025-lla",
        sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        url: "https://example.test/fiscalizacion-2025.csv",
        fetchedAt: "2026-01-01T00:00:00Z",
      },
    ];

    const markup = renderToStaticMarkup(
      (await FiscalizacionPage({
        searchParams: Promise.resolve({
          electionId: "2025-legislativas-nacional",
          jurisdictionId: "j-027",
          categoryId: "c-diputados",
        }),
      })) as ReactElement,
    );

    expect(markup).toContain("https://example.test/fiscalizacion-2025.csv");
    expect(markup).toContain("e3b0c442");
  });

  it("test_the_official_comparison_figure_traces_to_its_own_archive_entry", async () => {
    // The official side comes from a DIFFERENT election and a different
    // archive entry. Fetching sources from the fiscalización rows alone left
    // that figure displayed with no provenance at all.
    process.env["NATIONAL_JURISDICTION_ID"] = "j-027";
    process.env["FISCALIZACION_CATEGORY_ID"] = "c-diputados";
    repositoryRows = [
      { ...FISCALIZACION_ROW, listId: "110", votes: 60 },
      { ...OFFICIAL_ROW, listId: "110", votes: 25, archiveEntryId: "national/2023-generales" },
      { ...OFFICIAL_ROW, listId: "999", votes: 75, archiveEntryId: "national/2023-generales" },
    ];
    sourceRefs = [
      {
        archiveEntryId: "national/2023-generales",
        sha256: "aaaabbbbccccdddd0000111122223333444455556666777788889999aaaabbbb",
        url: "https://example.test/2023-generales.zip",
        fetchedAt: "2026-01-01T00:00:00Z",
      },
    ];

    const markup = renderToStaticMarkup(
      (await FiscalizacionPage({
        searchParams: Promise.resolve({
          electionId: "2025-legislativas-nacional",
          jurisdictionId: "j-027",
          categoryId: "c-diputados",
          compareElectionId: "2023-generales",
          compareElectionLabel: "22 Oct 2023 generales",
          compareYear: "2023",
          compareCategory: "DIPUTADO NACIONAL",
          compareJurisdiction: "national",
          compareJurisdictionId: "j-027",
          compareCategoryId: "c-diputados",
        }),
      })) as ReactElement,
    );

    expect(markup).toContain("cross-election juxtaposition");
    // Inside the OFFICIAL figure's own section. Asserting the url appears
    // anywhere in the markup passed while the official ZIP's digest rendered
    // under the unofficial figure.
    const officialSection = markup.slice(markup.indexOf('aria-label="official figure"'));
    expect(officialSection).toContain("https://example.test/2023-generales.zip");
    const fiscalizacionBlock = markup.slice(0, markup.indexOf("cross-election juxtaposition"));
    expect(fiscalizacionBlock).not.toContain("https://example.test/2023-generales.zip");
  });

  it("test_the_page_reports_a_tie_as_a_tie", async () => {
    // Driven through the PAGE. `topParty` unit tests are not evidence that
    // either branch is reached, and both exist precisely to stop the page
    // saying "no row resolved to a curated party" about rows that all did.
    process.env["NATIONAL_JURISDICTION_ID"] = "j-027";
    process.env["FISCALIZACION_CATEGORY_ID"] = "c-diputados";
    repositoryRows = [
      { ...FISCALIZACION_ROW, listId: "110", votes: 50 },
      { ...FISCALIZACION_ROW, listId: "999", votes: 50 },
    ];

    const markup = renderToStaticMarkup(
      (await FiscalizacionPage({
        searchParams: Promise.resolve({
          electionId: "2025-legislativas-nacional",
          jurisdictionId: "j-027",
          categoryId: "c-diputados",
          compareElectionId: "2023-generales",
          compareElectionLabel: "22 Oct 2023 generales",
          compareYear: "2023",
          compareCategory: "DIPUTADO NACIONAL",
          compareJurisdiction: "national",
          compareJurisdictionId: "j-027",
          compareCategoryId: "c-diputados",
        }),
      })) as ReactElement,
    );

    expect(markup).toContain("tied at the top");
    expect(markup).not.toContain("no row resolved to a curated party");
  });

  it("test_the_page_reports_mixed_granularity_as_such", async () => {
    process.env["NATIONAL_JURISDICTION_ID"] = "j-027";
    process.env["FISCALIZACION_CATEGORY_ID"] = "c-diputados";
    repositoryRows = [
      { ...FISCALIZACION_ROW, listId: "110", granularity: "mesa", votes: 60 },
      { ...FISCALIZACION_ROW, listId: "110", granularity: "seccion", votes: 40 },
    ];

    const markup = renderToStaticMarkup(
      (await FiscalizacionPage({
        searchParams: Promise.resolve({
          electionId: "2025-legislativas-nacional",
          jurisdictionId: "j-027",
          categoryId: "c-diputados",
          compareElectionId: "2023-generales",
          compareElectionLabel: "22 Oct 2023 generales",
          compareYear: "2023",
          compareCategory: "DIPUTADO NACIONAL",
          compareJurisdiction: "national",
          compareJurisdictionId: "j-027",
          compareCategoryId: "c-diputados",
        }),
      })) as ReactElement,
    );

    expect(markup).toContain("double-count");
    expect(markup).not.toContain("no row resolved to a curated party");
  });


  it("test_an_unorderable_level_reports_how_many_rows_carry_it", async () => {
    // A LIST OF NAMES was rendered as a row count, so many rows on one
    // unknown level read as "1 row(s)". The fixture needs at least two rows
    // sharing a level, or the wrong count and the right one agree.
    process.env["NATIONAL_JURISDICTION_ID"] = "j-027";
    process.env["FISCALIZACION_CATEGORY_ID"] = "c-diputados";
    repositoryRows = [
      { ...FISCALIZACION_ROW, listId: "110", granularity: "subcircuito" as never, votes: 30 },
      { ...FISCALIZACION_ROW, listId: "110", granularity: "subcircuito" as never, votes: 20 },
      { ...FISCALIZACION_ROW, listId: "999", granularity: "subcircuito" as never, votes: 50 },
    ];

    const markup = renderToStaticMarkup(
      (await FiscalizacionPage({
        searchParams: Promise.resolve({
          electionId: "2025-legislativas-nacional",
          jurisdictionId: "j-027",
          categoryId: "c-diputados",
        }),
      })) as ReactElement,
    );

    expect(markup).toContain("3 row(s) carry a granularity");
    expect(markup).toContain("subcircuito: 3 rows, 100 votes");
    // And NO badge to point at: an unorderable level makes the set unsummable,
    // so the level "above" the alert was withheld. The copy used to name it.
    expect(markup).not.toContain('aria-label="granularity:');
  });

  it("test_the_page_refuses_a_category_the_party_mapping_does_not_describe", async () => {
    // The third axis. `FISCALIZACION_PARTY_CONTEXT` names DIPUTADO NACIONAL,
    // so another category resolves party names through the wrong mapping --
    // and this was the one axis with no driver.
    process.env["NATIONAL_JURISDICTION_ID"] = "j-027";
    process.env["FISCALIZACION_CATEGORY_ID"] = "c-diputados";

    const markup = renderToStaticMarkup(
      (await FiscalizacionPage({
        searchParams: Promise.resolve({
          electionId: "2025-legislativas-nacional",
          jurisdictionId: "j-027",
          categoryId: "c-senadores",
        }),
      })) as ReactElement,
    );

    expect(markup).toContain("Refused");
    expect(markup).toContain("DIPUTADO NACIONAL");
  });

  it("test_an_apparent_tie_over_unsummable_rows_reports_the_refusal", async () => {
    // Both conditions at once: two parties level at 40, on levels that cannot
    // be summed. Calling that a tie states a measured fact that is really an
    // artifact of the arithmetic the refusal exists to prevent.
    process.env["NATIONAL_JURISDICTION_ID"] = "j-027";
    process.env["FISCALIZACION_CATEGORY_ID"] = "c-diputados";
    repositoryRows = [
      { ...FISCALIZACION_ROW, listId: "110", granularity: "mesa", votes: 40 },
      { ...FISCALIZACION_ROW, listId: "999", granularity: "seccion", votes: 40 },
    ];

    const markup = renderToStaticMarkup(
      (await FiscalizacionPage({
        searchParams: Promise.resolve({
          electionId: "2025-legislativas-nacional",
          jurisdictionId: "j-027",
          categoryId: "c-diputados",
          compareElectionId: "2023-generales",
          compareElectionLabel: "22 Oct 2023 generales",
          compareYear: "2023",
          compareCategory: "DIPUTADO NACIONAL",
          compareJurisdiction: "national",
          compareJurisdictionId: "j-027",
          compareCategoryId: "c-diputados",
        }),
      })) as ReactElement,
    );

    expect(markup).toContain("double-count");
    expect(markup).not.toContain("tied at the top");
  });

  it("test_an_archive_entry_with_no_source_record_is_announced", async () => {
    // `fetchSourceRefs` can return fewer refs than asked for. The figure used
    // to render anyway, with no provenance and nothing saying so.
    process.env["NATIONAL_JURISDICTION_ID"] = "j-027";
    process.env["FISCALIZACION_CATEGORY_ID"] = "c-diputados";
    repositoryRows = [{ ...FISCALIZACION_ROW, listId: "110", votes: 60 }];
    sourceRefs = [];

    const markup = renderToStaticMarkup(
      (await FiscalizacionPage({
        searchParams: Promise.resolve({
          electionId: "2025-legislativas-nacional",
          jurisdictionId: "j-027",
          categoryId: "c-diputados",
        }),
      })) as ReactElement,
    );

    expect(markup).toContain("have no source record");
    expect(markup).toContain("fiscalizacion/2025-lla");
  });

  it("test_an_official_figure_without_an_archived_source_says_so", async () => {
    // The badge's own alert. `officialSources` empty used to render nothing,
    // so a percentage appeared with no provenance and no statement of it.
    process.env["NATIONAL_JURISDICTION_ID"] = "j-027";
    process.env["FISCALIZACION_CATEGORY_ID"] = "c-diputados";
    repositoryRows = [
      { ...FISCALIZACION_ROW, listId: "110", votes: 60 },
      { ...OFFICIAL_ROW, listId: "110", votes: 25, archiveEntryId: "national/2023-generales" },
      { ...OFFICIAL_ROW, listId: "999", votes: 75, archiveEntryId: "national/2023-generales" },
    ];
    // Only the fiscalización entry has a source record; the official one has none.
    sourceRefs = [
      {
        archiveEntryId: "fiscalizacion/2025-lla",
        sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        url: "https://example.test/fiscalizacion-2025.csv",
        fetchedAt: "2026-01-01T00:00:00Z",
      },
    ];

    const markup = renderToStaticMarkup(
      (await FiscalizacionPage({
        searchParams: Promise.resolve({
          electionId: "2025-legislativas-nacional",
          jurisdictionId: "j-027",
          categoryId: "c-diputados",
          compareElectionId: "2023-generales",
          compareElectionLabel: "22 Oct 2023 generales",
          compareYear: "2023",
          compareCategory: "DIPUTADO NACIONAL",
          compareJurisdiction: "national",
          compareJurisdictionId: "j-027",
          compareCategoryId: "c-diputados",
        }),
      })) as ReactElement,
    );

    expect(markup).toContain("No archived source for this figure");
    // Reported on the OFFICIAL side only: the fiscalización block's own
    // missing-provenance alert must not claim the official entry.
    const fiscalizacionBlock = markup.slice(0, markup.indexOf("cross-election juxtaposition"));
    expect(fiscalizacionBlock).not.toContain("have no source record");
  });

  it("test_a_refused_query_is_reported_as_such_not_as_a_mapping_problem", async () => {
    // RLS denial or a failed query. Every page test so far mocked a repository
    // that always answers `ok`, so both this branch and the "no rows were
    // read" comparison branch were green whether they worked or not.
    process.env["NATIONAL_JURISDICTION_ID"] = "j-027";
    process.env["FISCALIZACION_CATEGORY_ID"] = "c-diputados";
    refuseQueryWith = "row-level security denied the read";

    const markup = renderToStaticMarkup(
      (await FiscalizacionPage({
        searchParams: Promise.resolve({
          electionId: "2025-legislativas-nacional",
          jurisdictionId: "j-027",
          categoryId: "c-diputados",
          compareElectionId: "2023-generales",
          compareElectionLabel: "22 Oct 2023 generales",
          compareYear: "2023",
          compareCategory: "DIPUTADO NACIONAL",
          compareJurisdiction: "national",
          compareJurisdictionId: "j-027",
          compareCategoryId: "c-diputados",
        }),
      })) as ReactElement,
    );

    expect(markup).toContain("row-level security denied the read");
    expect(markup).toContain("no rows were read");
    expect(markup).not.toContain("no row resolved to a curated party");
  });

  it("test_a_comparison_against_the_same_election_is_refused", () => {
    process.env["NATIONAL_JURISDICTION_ID"] = "j-027";
    process.env["FISCALIZACION_CATEGORY_ID"] = "c-diputados";

    const result = comparisonFromParams({
      compareElectionId: "2025-legislativas-nacional",
      compareElectionLabel: "26 Oct 2025 national legislative",
      compareYear: "2025",
      compareCategory: "DIPUTADO NACIONAL",
      compareJurisdiction: "national",
      compareJurisdictionId: "j-027",
      compareCategoryId: "c-diputados",
    });

    // One election drawn as two, labelled a trend over time.
    expect(result.status).toBe("refused");
    if (result.status !== "refused") throw new Error("expected refused");
    expect(result.reason).toContain("DIFFERENT election");
  });

  it("test_a_repeated_query_param_is_reported_not_treated_as_absent", async () => {
    // Next.js hands `string[]` for a repeated param. `stringParam` returned
    // `undefined` for those, so a SUPPLIED value vanished: the page then said
    // "Provide electionId" about a request that sent it twice.
    process.env["NATIONAL_JURISDICTION_ID"] = "j-027";
    process.env["FISCALIZACION_CATEGORY_ID"] = "c-diputados";

    const markup = renderToStaticMarkup(
      (await FiscalizacionPage({
        searchParams: Promise.resolve({
          electionId: ["2025-legislativas-nacional", "2023-generales"],
          jurisdictionId: "j-027",
          categoryId: "c-diputados",
        }),
      })) as ReactElement,
    );

    expect(markup).toContain("electionId");
    expect(markup).toContain("more than once");
  });

  it("test_zero_rows_is_not_reported_as_a_mapping_failure", async () => {
    // Zero rows resolved to nothing because there were zero rows, not because
    // the crosswalk failed. The catch-all sent the operator after a
    // `party_mapping` problem that does not exist.
    process.env["NATIONAL_JURISDICTION_ID"] = "j-027";
    process.env["FISCALIZACION_CATEGORY_ID"] = "c-diputados";
    repositoryRows = [];

    const markup = renderToStaticMarkup(
      (await FiscalizacionPage({
        searchParams: Promise.resolve({
          electionId: "2025-legislativas-nacional",
          jurisdictionId: "j-027",
          categoryId: "c-diputados",
          compareElectionId: "2023-generales",
          compareElectionLabel: "22 Oct 2023 generales",
          compareYear: "2023",
          compareCategory: "DIPUTADO NACIONAL",
          compareJurisdiction: "national",
          compareJurisdictionId: "j-027",
          compareCategoryId: "c-diputados",
        }),
      })) as ReactElement,
    );

    expect(markup).toContain("no fiscalización rows");
    expect(markup).not.toContain("no row resolved to a curated party");
  });

  it("test_the_page_asks_for_the_parameters_it_needs", async () => {
    const markup = renderToStaticMarkup(
      (await FiscalizacionPage({ searchParams: Promise.resolve({}) })) as ReactElement,
    );

    expect(markup).toContain("electionId");
  });
});

describe("fiscalizacion page — the figures it displays", () => {
  /**
   * `result_row` holds ONE ROW PER (mesa, list); nothing in the query path
   * groups them. Ranking raw rows therefore ranks a single mesa's single
   * list, and dividing that by the total across every mesa produces a number
   * that is not any party's vote share — rendered directly beside the
   * official figure.
   */
  it("test_share_percent_aggregates_every_row_of_the_party", () => {
    const rows: ResultRow[] = [
      // One party, split across two mesas: 80 of 140.
      { ...FISCALIZACION_ROW, partyName: "LA LIBERTAD AVANZA", canonicalPartyId: "canon-110", votes: 40 },
      { ...FISCALIZACION_ROW, partyName: "LA LIBERTAD AVANZA", canonicalPartyId: "canon-110", votes: 40 },
      // A single row that outranks either of the rows above.
      { ...FISCALIZACION_ROW, partyName: "FUERZA PATRIA", canonicalPartyId: "canon-999", votes: 60 },
    ];

    expect(partyShare(rows, "canon-110")).toEqual({ status: "ok", sharePercent: 57.14 });
  });

  it("test_unmapped_rows_stay_in_the_denominator_without_becoming_a_party", () => {
    const rows: ResultRow[] = [
      { ...FISCALIZACION_ROW, partyName: "LA LIBERTAD AVANZA", canonicalPartyId: "canon-110", votes: 50 },
      // Three unmapped rows. They are votes that were cast, so they belong in
      // the denominator — but they are not a party and can never be reported
      // as one.
      { ...FISCALIZACION_ROW, partyName: null, votes: 20 },
      { ...FISCALIZACION_ROW, partyName: null, votes: 20 },
      { ...FISCALIZACION_ROW, partyName: null, votes: 20 },
    ];

    expect(partyShare(rows, "canon-110")).toEqual({ status: "ok", sharePercent: 45.45 });
    expect(topParty(rows).partyName).toBe("LA LIBERTAD AVANZA");
    expect(topParty(rows).unmappedVotes).toBe(60);
  });

  it("test_granularity_reports_the_coarsest_level_present", () => {
    const rows: ResultRow[] = [
      { ...FISCALIZACION_ROW, granularity: "mesa" },
      { ...FISCALIZACION_ROW, granularity: "seccion" },
      { ...FISCALIZACION_ROW, granularity: "circuito" },
    ];

    // Degradation must be visible: one badge describes the whole list, and
    // the coarsest level present is the strongest claim the set supports.
    expect(readGranularity(rows).granularity).toBe("seccion");
  });

  // No empty-set case here: every badge is gated on `rows.length > 0`, so no
  // rendered figure can observe it. The fold belongs to `readGranularity` and
  // `granularity.test.ts` owns it — asserting it through this wrapper claimed
  // coverage of behaviour no entry point reaches.

  it("test_a_comparison_figure_is_never_built_from_a_supplied_share", () => {
    const request = comparisonFromParams({
      compareElectionId: "2023-generales",
      compareElectionLabel: "22 Oct 2023 generales",
      compareYear: "2023",
      compareCategory: "DIPUTADO NACIONAL",
      compareJurisdiction: "national",
      compareJurisdictionId: "j-027",
      compareCategoryId: "c-diputados",
      compareSharePercent: "99.99",
    });

    // The share must come from archived rows, never from the request. An
    // operator-supplied number stamped `sourceKind: "official"` renders with
    // an official-source badge and traces to a URL.
    expect(request).not.toHaveProperty("sharePercent");
    expect(request).not.toHaveProperty("sourceKind");
  });

  it("test_an_official_comparison_is_read_from_the_repository", async () => {
    const repository = new ResultsRepository(
      fakeRowSource([
        ...FISCALIZACION_ROWS,
        { ...OFFICIAL_ROW, listId: "110", votes: 30 },
        { ...OFFICIAL_ROW, listId: "110", votes: 30 },
        { ...OFFICIAL_ROW, listId: "999", votes: 40 },
      ]),
      {
        fetchPartyNames: () =>
          Promise.resolve(
            new Map([
              ["110", { canonicalPartyId: "canon-110", displayName: "LA LIBERTAD AVANZA" }],
              ["999", { canonicalPartyId: "canon-999", displayName: "FUERZA PATRIA" }],
            ]),
          ),
      },
    );

    const figure = await loadOfficialComparison(repository, {
      electionId: "2023-generales",
      electionLabel: "22 Oct 2023 generales",
      jurisdictionId: QUERY.jurisdictionId,
      categoryId: QUERY.categoryId,
      partyContext: { year: 2023, jurisdiction: "national", category: "DIPUTADO NACIONAL" },
      canonicalPartyId: "canon-110",
      partyName: "LA LIBERTAD AVANZA",
    });

    // Two rows for one party, summed before ranking: 60 of 100.
    expect(figure).toEqual({
      status: "ok",
      figure: {
        electionId: "2023-generales",
        electionLabel: "22 Oct 2023 generales",
        sourceKind: "official",
        sharePercent: 60,
        canonicalPartyId: "canon-110",
        partyName: "LA LIBERTAD AVANZA",
        // The comparison election's OWN archive entries travel with the
        // figure: without them the official share renders untraceable.
        archiveEntryIds: ["national/2023-generales"],
      },
    });
  });

  it("test_comparison_is_always_official_never_fiscalizacion", () => {
    // The juxtaposition badge exists to contrast an unofficial figure against an
    // official one from a DIFFERENT election. A comparison that could itself be
    // fiscalización would defeat the contrast the requirement exists to enforce.
    // The request cannot influence this: the figure is built by
    // `loadOfficialComparison`, which reads `queryOfficial` rows only.
    const repository = new ResultsRepository(
      // The two branches must produce DIFFERENT numbers. With LLA at 100 % of
      // both row sets, inverting the filter gave 100 either way and the test
      // passed on the defect it was written to catch. Here official LLA is
      // 25 of 100 and fiscalización LLA is 100 %.
      fakeRowSource([
        { ...FISCALIZACION_ROW, listId: "110", votes: 12578 },
        { ...OFFICIAL_ROW, listId: "110", votes: 25 },
        { ...OFFICIAL_ROW, listId: "999", votes: 75 },
      ]),
      {
        fetchPartyNames: () =>
          Promise.resolve(
            new Map([
              ["110", { canonicalPartyId: "canon-110", displayName: "LA LIBERTAD AVANZA" }],
              ["999", { canonicalPartyId: "canon-999", displayName: "FUERZA PATRIA" }],
            ]),
          ),
      },
    );

    return loadOfficialComparison(repository, {
      electionId: "2023-municipal",
      electionLabel: "2023 municipal",
      jurisdictionId: QUERY.jurisdictionId,
      categoryId: QUERY.categoryId,
      partyContext: { year: 2023, jurisdiction: "national", category: "DIPUTADO NACIONAL" },
      canonicalPartyId: "canon-110",
      partyName: "LA LIBERTAD AVANZA",
    }).then((comparison) => {
      expect(comparison.status).toBe("ok");
      if (comparison.status !== "ok") throw new Error("expected ok");
      expect(comparison.figure.sourceKind).toBe("official");
      // Asserting the LITERAL proves nothing: `loadOfficialComparison` writes
      // "official" unconditionally, so that assertion passes even when every
      // row it read was fiscalización. The fixture holds a fiscalización row
      // for the SAME party in the same jurisdiction and category, with a far
      // larger vote count, so the SHARE is what proves it was excluded: 100 %
      // of the official rows, not a figure diluted by the 12 578-vote
      // fiscalización row.
      expect(comparison.figure.sharePercent).toBe(25);
    });
  });

  it("test_no_official_rows_yields_no_comparison_rather_than_a_zero", async () => {
    const repository = new ResultsRepository(fakeRowSource(FISCALIZACION_ROWS));

    const figure = await loadOfficialComparison(repository, {
      electionId: "2023-generales",
      electionLabel: "22 Oct 2023 generales",
      jurisdictionId: QUERY.jurisdictionId,
      categoryId: QUERY.categoryId,
      partyContext: { year: 2023, jurisdiction: "national", category: "DIPUTADO NACIONAL" },
      canonicalPartyId: "canon-110",
      partyName: "LA LIBERTAD AVANZA",
    });

    // A 0 % official figure beside a real fiscalización figure reads as a
    // measured collapse, not as an absent source.
    expect(figure.status).toBe("unavailable");
  });
});

describe("fiscalizacion page — the juxtaposition compares ONE party", () => {
  /**
   * The badge put "whichever list ranked first in 2025" beside "whichever list
   * ranked first in 2023". Those are not the same party, and the same party
   * does not even carry the same list id across the two files: LLA is `135` in
   * the 2023 PASO, `20135` in the 2023 generales and `110` in 2025. The badge
   * read as a party-over-time comparison and was not one.
   */
  // The canonical id travels WITH the name: the repository resolves both
  // together, and a fixture that set only one would let a name-keyed fold pass.
  const CANON: Record<string, string> = {
    "LA LIBERTAD AVANZA": "canon-110",
    "ALIANZA LA LIBERTAD AVANZA": "canon-110",
    "FUERZA PATRIA": "canon-999",
  };
  const NAMED = (partyName: string | null, votes: number, listId: string | null = "x"): ResultRow => ({
    ...FISCALIZACION_ROW,
    listId,
    partyName,
    canonicalPartyId: partyName === null ? null : (CANON[partyName] ?? `canon-${partyName}`),
    votes,
  });

  it("test_top_party_aggregates_every_list_that_maps_to_it", () => {
    expect(
      topParty([
        NAMED("LA LIBERTAD AVANZA", 30, "110"),
        NAMED("LA LIBERTAD AVANZA", 30, "20135"),
        NAMED("FUERZA PATRIA", 50, "999"),
      ]),
    ).toEqual({
      canonicalPartyId: "canon-110",
      partyName: "LA LIBERTAD AVANZA",
      refusedReason: null,
      tied: false,
      unmappedRows: 0,
      unmappedVotes: 0,
      unmappedByListId: [],
    });
  });

  it("test_an_unmapped_row_is_never_named_the_top_party", () => {
    // It still counts in the denominator — we just cannot say whose it is.
    const rows = [NAMED(null, 90), NAMED("FUERZA PATRIA", 10)];

    expect(topParty(rows)).toEqual({
      canonicalPartyId: "canon-999",
      partyName: "FUERZA PATRIA",
      refusedReason: null,
      tied: false,
      // Counted and broken down, not silently skipped.
      unmappedRows: 1,
      unmappedVotes: 90,
      unmappedByListId: [{ listId: "x", votes: 90 }],
    });
    expect(partyShare(rows, "canon-999")).toEqual({ status: "ok", sharePercent: 10 });
  });

  it("test_a_tie_at_the_top_selects_no_party", () => {
    // `votes > topVotes` kept whichever party the Map saw first — row order —
    // and that name then selected which party the whole juxtaposition
    // reported.
    const result = topParty([NAMED("LA LIBERTAD AVANZA", 5000), NAMED("FUERZA PATRIA", 5000)]);

    expect(result.tied).toBe(true);
    expect(result.partyName).toBeNull();
  });

  it("test_unmapped_votes_are_broken_down_by_list_id", () => {
    // One id covering most of the votes and many ids covering a little each
    // render identically as a total.
    const result = topParty([
      NAMED("LA LIBERTAD AVANZA", 10),
      NAMED(null, 400, "777"),
      NAMED(null, 5, "888"),
    ]);

    expect(result.unmappedByListId).toEqual([
      { listId: "777", votes: 400 },
      { listId: "888", votes: 5 },
    ]);
  });

  it("test_the_aggregates_refuse_mixed_source_kinds_themselves", () => {
    // Their OWN guard, not the caller's: `loadOfficialComparison` calls
    // `partyShare` on a row set `renderFiscalizacionView` never sees.
    const rows: ResultRow[] = [
      { ...FISCALIZACION_ROW, partyName: "LA LIBERTAD AVANZA", canonicalPartyId: "canon-110", votes: 60 },
      { ...OFFICIAL_ROW, partyName: "LA LIBERTAD AVANZA", canonicalPartyId: "canon-110", votes: 25 },
    ];

    const share = partyShare(rows, "canon-110");
    expect(share.status).toBe("unavailable");
    if (share.status !== "unavailable") throw new Error("expected unavailable");
    expect(share.reason).toContain("source kinds");
    expect(topParty(rows).partyName).toBeNull();
  });

  it("test_a_comparison_in_another_jurisdiction_is_refused", () => {
    process.env["NATIONAL_JURISDICTION_ID"] = "j-027";
    process.env["FISCALIZACION_CATEGORY_ID"] = "c-diputados";

    const result = comparisonFromParams({
      compareElectionId: "2023-generales",
      compareElectionLabel: "22 Oct 2023 generales",
      compareYear: "2023",
      compareCategory: "DIPUTADO NACIONAL",
      compareJurisdiction: "national",
      compareJurisdictionId: "j-999",
      compareCategoryId: "c-diputados",
    });

    // One party over time in ONE place. A different place renders two
    // unrelated figures as a trend.
    expect(result.status).toBe("refused");
    if (result.status !== "refused") throw new Error("expected refused");
    expect(result.reason).toContain("j-999");
  });

  it("test_a_query_returning_fiscalizacion_rows_yields_no_official_figure", () => {
    // The `official` label came from the module writing the string, not from
    // anything checking the rows. A repository whose filter regressed would
    // render a fiscalización figure under the official-source badge.
    const repository = new ResultsRepository(
      fakeRowSource([{ ...FISCALIZACION_ROW, listId: "110", votes: 60 }]),
      { fetchPartyNames: () => Promise.resolve(new Map([["110", { canonicalPartyId: "canon-110", displayName: "LA LIBERTAD AVANZA" }]])) },
    );
    // Bypasses the repository's own filter the way a regression would.
    vi.spyOn(repository, "queryOfficial").mockResolvedValue({
      status: "ok",
      rows: [{ ...FISCALIZACION_ROW, listId: "110", partyName: "LA LIBERTAD AVANZA", canonicalPartyId: "canon-110", votes: 60 }],
      excluded: {},
    });

    return loadOfficialComparison(repository, {
      electionId: "2023-generales",
      electionLabel: "22 Oct 2023 generales",
      jurisdictionId: QUERY.jurisdictionId,
      categoryId: QUERY.categoryId,
      partyContext: { year: 2023, jurisdiction: "national", category: "DIPUTADO NACIONAL" },
      canonicalPartyId: "canon-110",
      partyName: "LA LIBERTAD AVANZA",
    }).then((result) => {
      expect(result.status).toBe("unavailable");
      if (result.status !== "unavailable") throw new Error("expected unavailable");
      expect(result.reason).toContain("non-official");
    });
  });

  it("test_a_uniformly_unknown_granularity_is_refused_not_summed", () => {
    // Size-1 is not safety: this module cannot say what a level it does not
    // know contains, so it cannot say the rows do not overlap.
    const rows: ResultRow[] = [
      { ...FISCALIZACION_ROW, partyName: "LA LIBERTAD AVANZA", canonicalPartyId: "canon-110", granularity: "subcircuito" as never, votes: 40 },
      { ...FISCALIZACION_ROW, partyName: "FUERZA PATRIA", canonicalPartyId: "canon-999", granularity: "subcircuito" as never, votes: 60 },
    ];

    const share = partyShare(rows, "canon-110");
    expect(share.status).toBe("unavailable");
    if (share.status !== "unavailable") throw new Error("expected unavailable");
    expect(share.reason).toContain("cannot order");
    expect(topParty(rows).partyName).toBeNull();
  });

  it("test_mixed_granularity_refuses_every_party_figure", () => {
    // A `seccion` row already CONTAINS the `mesa` rows beneath it. The refusal
    // branch existed but nothing drove it, so `topParty` and the rendered
    // per-party list summed the very same rows the share refused.
    const rows: ResultRow[] = [
      { ...FISCALIZACION_ROW, partyName: "LA LIBERTAD AVANZA", canonicalPartyId: "canon-110", granularity: "mesa", votes: 40 },
      { ...FISCALIZACION_ROW, partyName: "LA LIBERTAD AVANZA", canonicalPartyId: "canon-110", granularity: "seccion", votes: 40 },
      { ...FISCALIZACION_ROW, partyName: "FUERZA PATRIA", canonicalPartyId: "canon-999", granularity: "mesa", votes: 50 },
    ];

    const share = partyShare(rows, "canon-110");
    expect(share.status).toBe("unavailable");
    if (share.status !== "unavailable") throw new Error("expected unavailable");
    expect(share.reason).toContain("double-count");

    // The ranking must refuse too: 40 + 40 would beat 50 and hand the whole
    // juxtaposition to the wrong party.
    expect(topParty(rows).partyName).toBeNull();
  });

  it("test_a_refused_view_still_reports_the_comparison_it_could_not_build", () => {
    // Both refusal branches print two reasons; neither had a driver, so they
    // were green whether they worked or not.
    const html = renderToStaticMarkup(
      renderFiscalizacionView(
        { status: "refused", reason: "out of scope" },
        {
          comparisonUnavailable:
            "the request itself was refused, so no comparison was attempted",
        },
      ),
    );

    expect(html).toContain("out of scope");
    expect(html).toContain("No comparison figure");
  });

  it("test_the_leakage_refusal_still_reports_the_comparison_it_could_not_build", () => {
    const html = renderToStaticMarkup(
      renderFiscalizacionView(
        {
          status: "ok",
          rows: [FISCALIZACION_ROW, OFFICIAL_ROW],
          excluded: {},
          coverage: FISCALIZACION_COVERAGE,
        },
        { comparisonUnavailable: "no row resolved to a curated party to compare" },
      ),
    );

    // The FULL phrase: "are not" carries no refusal semantics on its own.
    expect(html).toContain("are not fiscalización");
    expect(html).toContain("No comparison figure");
  });

  it("test_the_render_path_refuses_a_view_carrying_official_rows", () => {
    // The THIRD leakage path. The loader is guarded and the repository
    // filters, but `renderFiscalizacionView` accepts any view a caller hands
    // it — and nothing drove that branch, so the suite was green whether it
    // worked or not.
    const html = renderToStaticMarkup(
      renderFiscalizacionView({
        status: "ok",
        // NON-EMPTY on purpose: the repository's drops and the render filter's
        // are two different counts, and one must not stand in for the other.
        excluded: { unknown: { rows: 3, votes: 41 } },
        rows: [FISCALIZACION_ROW, OFFICIAL_ROW],
        coverage: FISCALIZACION_COVERAGE,
      }),
    );

    expect(html).toContain("3 unknown");
    expect(html).toContain("Refused");
    // The official votes appear ONLY inside the exclusion breakdown, labelled
    // as excluded — never as a party figure. Asserting a bare `not
    // .toContain("100")` was both weak (it matches `1005`, a hash, a
    // percentage) and wrong: rule 3 requires the excluded amount be reported.
    expect(html).toContain("official: 1 rows, 100 votes");
    expect(html).not.toContain("LA LIBERTAD AVANZA");
    expect(html).not.toContain("Coverage:");
  });

  it("test_mixed_granularity_keeps_reporting_what_failed_to_map", () => {
    // Refusing to RANK mixed levels is right; reporting zero unmapped votes
    // while 400 failed to resolve is a silent exclusion behind a total.
    const result = topParty([
      { ...FISCALIZACION_ROW, partyName: "LA LIBERTAD AVANZA", canonicalPartyId: "canon-110", granularity: "mesa", votes: 10 },
      { ...FISCALIZACION_ROW, partyName: null, listId: "777", granularity: "seccion", votes: 400 },
    ]);

    expect(result.partyName).toBeNull();
    expect(result.refusedReason).toContain("double-count");
    expect(result.unmappedVotes).toBe(400);
    expect(result.unmappedByListId).toEqual([{ listId: "777", votes: 400 }]);
  });

  it("test_mixed_granularity_renders_no_per_party_list", () => {
    const html = renderToStaticMarkup(
      renderFiscalizacionView({
        status: "ok",
        excluded: {},
        rows: [
          { ...FISCALIZACION_ROW, partyName: "LA LIBERTAD AVANZA", canonicalPartyId: "canon-110", granularity: "mesa", votes: 40 },
          { ...FISCALIZACION_ROW, partyName: "LA LIBERTAD AVANZA", canonicalPartyId: "canon-110", granularity: "seccion", votes: 40 },
        ],
        coverage: FISCALIZACION_COVERAGE,
      }),
    );

    // The list is a DISPLAYED figure, printed beside the coverage note.
    expect(html).toContain("No per-party figures");
    expect(html).not.toContain("80 votes");
  });


  it("test_an_unorderable_granularity_is_reported_not_absorbed", () => {
    const rows: ResultRow[] = [
      { ...FISCALIZACION_ROW, granularity: "subcircuito" as never },
      { ...FISCALIZACION_ROW, granularity: "mesa" },
    ];

    expect(readGranularity(rows).granularity).toBe("distrito");
    expect(unrecognizedLevels(rows)).toEqual([
      { granularity: "subcircuito", rows: 1, votes: 12578 },
    ]);
  });

  it("test_a_comparison_year_contradicting_its_election_is_refused", () => {
    process.env["NATIONAL_JURISDICTION_ID"] = "j-027";
    process.env["FISCALIZACION_CATEGORY_ID"] = "c-diputados";

    const result = comparisonFromParams({
      compareElectionId: "2023-generales",
      compareElectionLabel: "22 Oct 2023 generales",
      // 2023 rows resolved through the 2025 mapping: LLA is `20135` in one and
      // `110` in the other.
      compareYear: "2025",
      compareCategory: "DIPUTADO NACIONAL",
      compareJurisdiction: "national",
      compareJurisdictionId: "j-027",
      compareCategoryId: "c-diputados",
    });

    expect(result.status).toBe("refused");
    if (result.status !== "refused") throw new Error("expected refused");
    expect(result.reason).toContain("2023-generales");
  });

  it("test_a_non_national_comparison_is_refused_rather_than_mapped_as_national", () => {
    process.env["NATIONAL_JURISDICTION_ID"] = "j-027";
    process.env["FISCALIZACION_CATEGORY_ID"] = "c-diputados";

    // PBA's `distrito 027` is a PARTIDO; national distrito 02 / seccion 027 is
    // Coronel Rosales. Resolving a municipal comparison through the national
    // mapping is that scheme collision on the comparison side.
    expect(
      comparisonFromParams({
        compareElectionId: "2023-municipal",
        compareElectionLabel: "2023 municipal",
        compareYear: "2023",
        // Same office and category as the pinned side, so the refusal below
        // is about the JURISDICTION scheme and nothing else.
        compareCategory: "DIPUTADO NACIONAL",
        compareJurisdiction: "pba",
        compareJurisdictionId: "j-027",
        compareCategoryId: "c-diputados",
      }),
    ).toEqual({
      status: "refused",
      // REFUSED, with a reason. `undefined` is what "nothing was asked for"
      // returns, so asserting it would let a silent drop pass under a name
      // that promises a refusal.
      reason: expect.stringContaining("national"),
    });
  });

  it("test_a_party_absent_from_the_rows_has_no_share_rather_than_zero", () => {
    const result = partyShare([NAMED("FUERZA PATRIA", 10)], "LA LIBERTAD AVANZA");

    expect(result.status).toBe("unavailable");
    if (result.status !== "unavailable") throw new Error("expected unavailable");
    expect(result.reason).toContain("LA LIBERTAD AVANZA");
  });

  it("test_the_official_comparison_reports_the_same_party_not_its_own_winner", async () => {
    const repository = new ResultsRepository(
      fakeRowSource([
        // Official rows where a DIFFERENT party wins.
        { ...OFFICIAL_ROW, listId: "20135", votes: 25 },
        { ...OFFICIAL_ROW, listId: "999", votes: 75 },
      ]),
      {
        fetchPartyNames: () =>
          Promise.resolve(
            new Map([
              // SAME canonical id as list `110` on the 2025 side, and a
              // DIFFERENT display name — the real curated shape. That is what
              // makes this the driver for a cross-year match: keyed on the
              // name, the two sides share no key and the badge reports "no
              // rows for …" about a party that stood.
              ["20135", { canonicalPartyId: "canon-110", displayName: "LA LIBERTAD AVANZA" }],
              ["999", { canonicalPartyId: "canon-999", displayName: "FUERZA PATRIA" }],
            ]),
          ),
      },
    );

    const figure = await loadOfficialComparison(repository, {
      electionId: "2023-generales",
      electionLabel: "22 Oct 2023 generales",
      jurisdictionId: QUERY.jurisdictionId,
      categoryId: QUERY.categoryId,
      partyContext: { year: 2023, jurisdiction: "national", category: "DIPUTADO NACIONAL" },
      canonicalPartyId: "canon-110",
      partyName: "LA LIBERTAD AVANZA",
    });

    // 25 of 100 — the matched party's share, NOT the 75 of the official
    // winner. Reporting the official side's own top list would compare two
    // different parties and call it one trend.
    expect(figure.status).toBe("ok");
    if (figure.status !== "ok") throw new Error("expected ok");
    expect(figure.figure.sharePercent).toBe(25);
    expect(figure.figure.partyName).toBe("LA LIBERTAD AVANZA");
  });

  it("test_a_party_missing_from_the_comparison_election_yields_no_badge", async () => {
    const repository = new ResultsRepository(
      fakeRowSource([{ ...OFFICIAL_ROW, listId: "999", votes: 75 }]),
      { fetchPartyNames: () => Promise.resolve(new Map([["999", { canonicalPartyId: "canon-999", displayName: "FUERZA PATRIA" }]])) },
    );

    const figure = await loadOfficialComparison(repository, {
      electionId: "2023-generales",
      electionLabel: "22 Oct 2023 generales",
      jurisdictionId: QUERY.jurisdictionId,
      categoryId: QUERY.categoryId,
      partyContext: { year: 2023, jurisdiction: "national", category: "DIPUTADO NACIONAL" },
      canonicalPartyId: "canon-110",
      partyName: "LA LIBERTAD AVANZA",
    });

    // A party that did not stand in the comparison election has no share.
    // Rendering 0 % would read as a collapse it never suffered -- and the
    // REASON travels with the refusal so the page can say why.
    expect(figure.status).toBe("unavailable");
    if (figure.status !== "unavailable") throw new Error("expected unavailable");
    expect(figure.reason).toContain("LA LIBERTAD AVANZA");
  });
});

describe("fiscalizacion page — the filter's drops reach the operator", () => {
  it("test_excluded_rows_are_reported_per_kind", async () => {
    // `queryFiscalizacion` counts what it drops; the view carried the count
    // and nothing read it, so official rows removed from an unofficial figure
    // were reported nowhere.
    process.env["NATIONAL_JURISDICTION_ID"] = "j-027";
    process.env["FISCALIZACION_CATEGORY_ID"] = "c-diputados";
    repositoryRows = [
      { ...FISCALIZACION_ROW, listId: "110", votes: 60 },
      { ...OFFICIAL_ROW, listId: "110", votes: 25 },
      { ...OFFICIAL_ROW, listId: "999", votes: 75 },
    ];

    const markup = renderToStaticMarkup(
      (await FiscalizacionPage({
        searchParams: Promise.resolve({
          electionId: "2025-legislativas-nacional",
          jurisdictionId: "j-027",
          categoryId: "c-diputados",
        }),
      })) as ReactElement,
    );

    expect(markup).toContain("2 official");
    expect(markup).toContain("excluded by the fiscalización-source filter");
  });
});

describe("fiscalizacion page — the figure's level is disclosed", () => {
  it("test_mesa_rows_summed_into_a_jurisdiction_total_say_so", async () => {
    // `votesByParty` sums every row per party across one jurisdiction, so the
    // raw row level claimed `mesa` over a figure that IS every mesa added up.
    // The fourth page to derive this label its own way.
    process.env["NATIONAL_JURISDICTION_ID"] = "j-027";
    process.env["FISCALIZACION_CATEGORY_ID"] = "c-diputados";
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
      (await FiscalizacionPage({
        searchParams: Promise.resolve({
          electionId: "2025-legislativas-nacional",
          jurisdictionId: "j-027",
          categoryId: "c-diputados",
        }),
      })) as ReactElement,
    );

    // NOT `distrito` (the province) and NOT `mesa` (a detail the sum dropped).
    expect(markup).toContain('aria-label="granularity: seccion"');
    expect(markup).toContain("summed from mesa");
  });
});

describe("fiscalizacion page — an unlabelled source kind is never borrowed", () => {
  it("test_a_source_kind_outside_the_enum_renders_as_unverified", () => {
    // Defence in depth, like path 3: `SupabaseRowSource` casts
    // `row["source_kind"] as SourceKind` without validating, so a third value
    // can reach the badge at runtime while the types say it cannot.
    //
    // Driven at the RENDERER, not through `FiscalizacionPage`, and that is the
    // furthest out it can go: `loadOfficialComparison` writes the literal
    // `sourceKind: "official"` after refusing foreign rows, so the page cannot
    // express the state at all. Simulating it here is the only way to drive
    // the label a mislabelled figure would carry.
    const html = renderToStaticMarkup(
      renderFiscalizacionView(
        {
          status: "ok",
          // The row must RESOLVE to the compared party, or no badge renders
          // at all and the assertion could not fail.
          rows: [
            { ...FISCALIZACION_ROW, partyName: "LA LIBERTAD AVANZA", canonicalPartyId: "canon-110" },
          ],
          coverage: FISCALIZACION_COVERAGE,
          excluded: {},
        },
        {
          comparison: {
            electionId: "2023-municipal-coronel-rosales",
            electionLabel: "2023 municipal",
            sourceKind: "provisional" as never,
            sharePercent: 29.31,
            canonicalPartyId: "canon-110",
            partyName: "LA LIBERTAD AVANZA",
            archiveEntryIds: ["national/2023-generales"],
          },
        },
      ),
    );

    expect(html).toContain("UNVERIFIED source kind");
    // It must not borrow the label it failed to earn. Scoped to the BADGE's
    // own label form ("— official source"): the page has other prose carrying
    // the words, so a bare substring here would be asserting about the wrong
    // text.
    expect(html).not.toContain("— official source");
  });
});


describe("fiscalizacion page — a read failure keeps what was already known", () => {
  it("test_a_read_failed_view_still_reports_the_comparison_it_could_not_build", () => {
    // Production sets this exact pair: the `fetchSourceRefs` catch returns
    // `read_failed` carrying `comparisonUnavailable`. Two independent
    // renderers emit that sentence — one from the OPTIONS param, one from the
    // VIEW field — and only the first had a driver.
    const html = renderToStaticMarkup(
      renderFiscalizacionView({
        status: "read_failed",
        reason: "row-level security denied the source read",
        comparisonUnavailable: "the 2023 comparison row set was empty",
        excluded: { unknown: { rows: 2, votes: 31 } },
      }),
    );

    expect(html).toContain("row-level security denied the source read");
    expect(html).toContain("the 2023 comparison row set was empty");
    // And the drop counted before the failure, in both units.
    expect(html).toContain("2 unknown row(s) / 31 vote(s)");
  });
});

describe("fiscalizacion page — an unhashed comparison source is flagged", () => {
  it("test_the_juxtaposition_badge_reports_a_source_it_cannot_verify", () => {
    // `JuxtapositionBadge`'s own unhashed branch had no driver at all, and it
    // sits on the display that decides whether an operator may quote a figure.
    const html = renderToStaticMarkup(
      renderFiscalizacionView(
        {
          status: "ok",
          rows: [
            { ...FISCALIZACION_ROW, partyName: "LA LIBERTAD AVANZA", canonicalPartyId: "canon-110" },
          ],
          coverage: FISCALIZACION_COVERAGE,
          excluded: {},
        },
        {
          comparison: {
            electionId: "2023-municipal-coronel-rosales",
            electionLabel: "2023 municipal",
            sourceKind: "official",
            sharePercent: 29.31,
            canonicalPartyId: "canon-110",
            partyName: "LA LIBERTAD AVANZA",
            archiveEntryIds: ["national/2023-generales"],
          },
          officialSources: [
            {
              archiveEntryId: "national/2023-generales",
              sha256: null,
              url: "https://example.test/2023-generales.zip",
              fetchedAt: "2026-01-01T00:00:00Z",
            },
          ],
        },
      ),
    );

    expect(html).toContain("unhashed — cannot be verified");
  });
});

describe("fiscalizacion page — one party across two spellings", () => {
  it("test_a_party_respelled_between_elections_still_matches", async () => {
    // The real curated shape: ONE canonical party written "ALIANZA LA LIBERTAD
    // AVANZA" in 2025 and "LA LIBERTAD AVANZA" in 2023, under different list
    // ids. Keyed on the display name the two sides share no key, and the page
    // printed "no rows for …" — a party-did-not-stand claim about a party that
    // stood. Every other fixture spells it identically on both sides, so this
    // is the one that can fail.
    const repository = new ResultsRepository(
      fakeRowSource([{ ...OFFICIAL_ROW, listId: "20135", votes: 40 }, { ...OFFICIAL_ROW, listId: "999", votes: 60 }]),
      {
        fetchPartyNames: () =>
          Promise.resolve(
            new Map([
              ["20135", { canonicalPartyId: "canon-110", displayName: "LA LIBERTAD AVANZA" }],
              ["999", { canonicalPartyId: "canon-999", displayName: "FUERZA PATRIA" }],
            ]),
          ),
      },
    );

    const result = await loadOfficialComparison(repository, {
      electionId: "2023-generales",
      electionLabel: "22 Oct 2023 generales",
      jurisdictionId: QUERY.jurisdictionId,
      categoryId: QUERY.categoryId,
      partyContext: { year: 2023, jurisdiction: "national", category: "DIPUTADO NACIONAL" },
      canonicalPartyId: "canon-110",
      // The 2025 SPELLING, which appears in no 2023 row.
      partyName: "ALIANZA LA LIBERTAD AVANZA",
    });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("expected ok");
    expect(result.figure.sharePercent).toBe(40);
    // The figure carries the identity it was matched on, so the next hop
    // cannot fall back to the name.
    expect(result.figure.canonicalPartyId).toBe("canon-110");
  });
});

describe("fiscalizacion page — the badge's own branches, through the page", () => {
  const seedJuxtaposition = () => {
    process.env["NATIONAL_JURISDICTION_ID"] = "j-027";
    process.env["FISCALIZACION_CATEGORY_ID"] = "c-diputados";
    repositoryRows = [
      { ...FISCALIZACION_ROW, listId: "110", votes: 60 },
      { ...OFFICIAL_ROW, listId: "110", votes: 25, archiveEntryId: "national/2023-generales" },
      { ...OFFICIAL_ROW, listId: "999", votes: 75, archiveEntryId: "national/2023-generales" },
    ];
  };

  const renderPage = async () =>
    renderToStaticMarkup(
      (await FiscalizacionPage({
        searchParams: Promise.resolve({
          electionId: "2025-legislativas-nacional",
          jurisdictionId: "j-027",
          categoryId: "c-diputados",
          compareElectionId: "2023-generales",
          compareElectionLabel: "22 Oct 2023 generales",
          compareYear: "2023",
          compareCategory: "DIPUTADO NACIONAL",
          compareJurisdiction: "national",
          compareJurisdictionId: "j-027",
          compareCategoryId: "c-diputados",
        }),
      })) as ReactElement,
    );

  it("test_an_unhashed_archive_entry_reaches_the_page_as_unverifiable", async () => {
    // `sha256: string | null` travels with no `?? ""`, and this branch decides
    // whether an operator may quote the figure. It was driven only by calling
    // the renderer directly — rule 1 asks for the rendered page.
    seedJuxtaposition();
    sourceRefs = [
      {
        archiveEntryId: "fiscalizacion/2025-lla",
        sha256: null,
        url: "https://example.test/fiscalizacion-2025.csv",
        fetchedAt: "2026-01-01T00:00:00Z",
      },
      {
        archiveEntryId: "national/2023-generales",
        sha256: null,
        url: "https://example.test/2023-generales.zip",
        fetchedAt: "2026-01-01T00:00:00Z",
      },
    ];

    expect(await renderPage()).toContain("unhashed — cannot be verified");
  });

  it("test_an_untraceable_official_entry_is_named_on_the_page", async () => {
    // `officialMissingProvenance` — the official side's own entry resolving to
    // no source record, reported separately from the fiscalización side's.
    seedJuxtaposition();
    sourceRefs = [
      {
        archiveEntryId: "fiscalizacion/2025-lla",
        sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        url: "https://example.test/fiscalizacion-2025.csv",
        fetchedAt: "2026-01-01T00:00:00Z",
      },
    ];

    const markup = await renderPage();

    expect(markup).toContain("national/2023-generales");
    expect(markup).toContain("cannot be traced");
  });
});
