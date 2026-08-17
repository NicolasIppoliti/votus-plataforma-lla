import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { SourceRef } from "@/lib/results/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ResultRow } from "@/lib/fiscalizacion/repository";

/**
 * Both sides of a comparison must be READ before they can be compared. This
 * page turned a refused read into `[]`, so both years defaulted to the same
 * granularity, `compareResults` saw no mismatch, and the page rendered an
 * empty-but-successful comparison — defeating the D6 refusal exactly when one
 * year is missing.
 */

let rowsByElection: Record<string, ResultRow[]> = {};
/** The curated mapping per year: one party, a different id in each file. */
const PARTY_NAMES: Record<
  number,
  Record<string, { canonicalPartyId: string; displayName: string }>
> = {
  // ONE canonical id, two display spellings and two list ids. This is the
  // real curated shape, and it is what makes the comparison honest: the
  // spelling changed between files, the party did not.
  2023: {
    "20135": { canonicalPartyId: "lla", displayName: "LA LIBERTAD AVANZA" },
    "20999": { canonicalPartyId: "fp", displayName: "UNION POR LA PATRIA" },
  },
  2025: {
    "110": { canonicalPartyId: "lla", displayName: "ALIANZA LA LIBERTAD AVANZA" },
    "999": { canonicalPartyId: "fp", displayName: "FUERZA PATRIA" },
  },
};
let refuseElection: string | null = null;
let sourceRefs: SourceRef[] = [];
/** When true, the repository's own filter is bypassed — a simulated regression. */
let leakFiscalizacion = false;

vi.mock("@/lib/supabase/server-client", () => ({
  createSupabaseServerClient: () => Promise.resolve({}),
}));

const CATEGORY_NAMES: Record<string, string | undefined> = {
  "c-diputados": "DIPUTADO NACIONAL",
  "c-concejales": "CONCEJALES",
};

vi.mock("@/lib/fiscalizacion/repository", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/fiscalizacion/repository")>();
  return {
    ...actual,
    createResultsRepository: () => {
      if (leakFiscalizacion) {
        const leaking = new actual.ResultsRepository({
          fetchRows: (query) => Promise.resolve(rowsByElection[query.electionId] ?? []),
        });
        // Path 1 REGRESSES: the filter is gone. Path 3 must still refuse.
        leaking.queryOfficial = (query) =>
          Promise.resolve({
            status: "ok",
            rows: rowsByElection[query.electionId] ?? [],
            excluded: {}, partyMappingConfigured: true,
          });
        return Promise.resolve(leaking);
      }
      return Promise.resolve(
        // The REAL `ResultsRepository`, driven through fake row and name
        // sources — like drilldown and municipal do. Overwriting
        // `queryOfficial` replaced the very things the page depends on inside
        // it: the `source_kind = "official"` filter, the real name resolution,
        // and the refusal shape. The mock then ASSERTED it behaved the same.
        new actual.ResultsRepository(
          {
            fetchRows: (query) => {
              if (refuseElection && query.electionId === refuseElection) {
                // A denied read RAISES: `SupabaseRowSource.fetchRows` throws on
                // a Postgres error, so this is the shape RLS denial actually
                // takes — not a `status !== "ok"` response.
                return Promise.reject(
                  new Error(`row-level security denied ${query.electionId}`),
                );
              }
              return Promise.resolve(rowsByElection[query.electionId] ?? []);
            },
          },
          {
            fetchPartyNames: (context, listIds) =>
              Promise.resolve(
                // Keyed on the FULL context, not the year alone. Ignoring
                // jurisdiction and category made the page's per-year
                // `PartyMappingContext` plumbing untested — the very wiring the
                // route refuses without, since `2206` names a different party
                // in the municipal table than in the national one.
                context.jurisdiction !== "national" ||
                context.category !== "DIPUTADO NACIONAL"
                  ? new Map()
                  : new Map(
                  listIds
                    .map((id) => [id, PARTY_NAMES[context.year]?.[id]] as const)
                    .filter(
                      (pair): pair is readonly [string, { canonicalPartyId: string; displayName: string }] =>
                        Boolean(pair[1]),
                    ),
                ),
              ),
          },
        ),
      );
    },
    // Stands in for the `category` table, which is what binds `categoryId` to
    // the curated `partyCategory` label.
    fetchCategoryName: (_client: unknown, categoryId: string) =>
      Promise.resolve(
        CATEGORY_NAMES[categoryId] === undefined
          ? { status: "no_row" as const }
          : { status: "ok" as const, name: CATEGORY_NAMES[categoryId]! },
      ),
    fetchElectionYear: (_client: unknown, electionId: string) => {
      // UUIDS FIRST — the shape the database actually stores. A double that
      // only parses the id string reimplements the behaviour this change
      // abandoned, so restoring the old reader would leave the suite green.
      const rows: Record<string, number> = {
        "7769c98d-b286-4e8c-80ce-c2f9ab4fc929": 2023,
        "6dae81f9-c862-4cc5-b3f3-b640e4ea7319": 2025,
      };
      if (electionId in rows) {
        return Promise.resolve({ status: "ok" as const, year: rows[electionId]! });
      }
      const match = /^(\d{4})/.exec(electionId);
      return Promise.resolve(
        match ? { status: "ok" as const, year: Number(match[1]) } : { status: "no_row" as const },
      );
    },
    fetchSourceRefs: () => Promise.resolve({ sources: sourceRefs, missing: [] }),
  };
});

const { default: ComparePage } = await import("./page");

beforeEach(() => {
  process.env["NATIONAL_JURISDICTION_ID"] = "j-027";
});

afterEach(() => {
  delete process.env["NATIONAL_JURISDICTION_ID"];
  rowsByElection = {};
  refuseElection = null;
  leakFiscalizacion = false;
  sourceRefs = [];
});

const PARAMS = {
  election2023: "2023-generales",
  election2025: "2025-legislativas-nacional",
  jurisdictionId: "j-027",
  categoryId: "c-diputados",
  // Each side resolves through its own party mapping, so the category is
  // required — without it the page refuses rather than comparing raw list ids.
  partyCategory: "DIPUTADO NACIONAL",
  partyJurisdiction: "national",
};

describe("compare page", () => {
  it("test_a_refused_year_is_reported_not_compared_as_empty", async () => {
    refuseElection = "2023-generales";
    rowsByElection["2025-legislativas-nacional"] = [
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
      (await ComparePage({ searchParams: Promise.resolve(PARAMS) })) as ReactElement,
    );

    expect(markup).toContain("row-level security denied 2023-generales");
    // Asserted against markup the SUCCESS path actually emits. The previous
    // assertion named an `aria-label` this page never renders, so it was
    // vacuously true and passed with the bug restored.
    expect(markup).not.toContain("sin cambio");
    expect(markup).not.toContain("cambió de");
  });
});

describe("compare page — one party across two files", () => {
  it("test_the_same_party_under_two_list_ids_is_not_reported_as_a_flip", async () => {
    // THE defect this page had: `20135` in the 2023 generales and `110` in
    // 2025 are one party, so keying on the raw id gave the two sides zero
    // common keys and every unit read as a flip between parties that never
    // changed hands.
    rowsByElection["2023-generales"] = [
      {
        jurisdictionId: "j-027",
        categoryId: "c-diputados",
        listId: "20135",
        votes: 100,
        sourceKind: "official",
        granularity: "mesa",
        archiveEntryId: "national/2023-generales",
      },
    ];
    rowsByElection["2025-legislativas-nacional"] = [
      {
        jurisdictionId: "j-027",
        categoryId: "c-diputados",
        listId: "110",
        votes: 140,
        sourceKind: "official",
        granularity: "mesa",
        archiveEntryId: "national/2025-legislativas",
      },
    ];

    const markup = renderToStaticMarkup(
      (await ComparePage({ searchParams: Promise.resolve(PARAMS) })) as ReactElement,
    );

    expect(markup).toContain("sin cambio");
    expect(markup).not.toContain("cambió de");
    // And never a bare list id where a party name belongs.
    expect(markup).not.toContain("20135");
  });
});

describe("compare page — the refusals the operator can trigger", () => {
  it("test_an_unknown_aggregate_to_is_refused_not_cast", async () => {
    // The operator's channel into the D6 refusal, and the one input this page
    // must not trust: `as Granularity` let `banana` through typed as valid.
    const markup = renderToStaticMarkup(
      (await ComparePage({
        searchParams: Promise.resolve({ ...PARAMS, aggregateTo: "banana" }),
      })) as ReactElement,
    );

    expect(markup).toContain("aggregateTo");
    expect(markup).toContain("banana");
  });

  it("test_mixed_levels_on_one_side_are_refused_not_compared", async () => {
    const base = {
      jurisdictionId: "j-027",
      categoryId: "c-diputados",
      listId: "110",
      votes: 10,
      sourceKind: "official" as const,
      archiveEntryId: "national/2023-generales",
    };
    rowsByElection["2023-generales"] = [
      { ...base, granularity: "mesa" },
      { ...base, granularity: "seccion" },
    ];
    rowsByElection["2025-legislativas-nacional"] = [
      { ...base, granularity: "mesa", archiveEntryId: "national/2025-legislativas" },
    ];

    const markup = renderToStaticMarkup(
      (await ComparePage({ searchParams: Promise.resolve(PARAMS) })) as ReactElement,
    );

    // A mix on ONE side is invisible to `compareResults`, which compares the
    // two sides' single reported levels.
    expect(markup).toContain("mezclan niveles de granularidad");
    expect(markup).not.toContain("sin cambio");
  });

  it("test_a_year_with_no_rows_is_refused_not_given_a_level", async () => {
    rowsByElection["2025-legislativas-nacional"] = [
      {
        jurisdictionId: "j-027",
        categoryId: "c-diputados",
        listId: "110",
        votes: 10,
        sourceKind: "official",
        granularity: "mesa",
        archiveEntryId: "national/2025-legislativas",
      },
    ];

    const markup = renderToStaticMarkup(
      (await ComparePage({ searchParams: Promise.resolve(PARAMS) })) as ReactElement,
    );

    // `readGranularity([])` answers `distrito`; feeding that in states a level
    // for data that does not exist.
    expect(markup).toContain("no devolvió filas");
    expect(markup).not.toContain("nivel distrito");
  });
});

describe("compare page — an unmapped id is not an identity", () => {
  it("test_unmapped_rows_are_refused_not_flipped", async () => {
    // The fabricated swing survived here: `unmapped (list 20135)` vs
    // `unmapped (list 110)` are zero common keys, so the page reported a flip
    // between two labels for one party.
    const base = {
      jurisdictionId: "j-027",
      categoryId: "c-diputados",
      votes: 10,
      sourceKind: "official" as const,
      granularity: "mesa" as const,
    };
    rowsByElection["2023-generales"] = [
      { ...base, listId: "99999", archiveEntryId: "national/2023-generales" },
    ];
    rowsByElection["2025-legislativas-nacional"] = [
      { ...base, listId: "88888", archiveEntryId: "national/2025-legislativas" },
    ];

    const markup = renderToStaticMarkup(
      (await ComparePage({ searchParams: Promise.resolve(PARAMS) })) as ReactElement,
    );

    expect(markup).toContain("no se resolvieron a un partido canónico");
    expect(markup).not.toContain("cambió de");
  });
});

describe("compare page — the D6 branches this page exists for", () => {
  // ONE jurisdiction id on both sides, because that is the only shape the
  // production query can return (`.eq("jurisdiction_id", ...)`). Fabricating
  // distinct ids per side made these tests drive an input the entry point
  // cannot produce.
  const row = (electionId: string, granularity: "mesa" | "seccion", listId: string) => ({
    jurisdictionId: "j-027",
    categoryId: "c-diputados",
    listId,
    votes: 10,
    sourceKind: "official" as const,
    granularity,
    archiveEntryId: `national/${electionId}`,
  });

  it("test_a_granularity_mismatch_refuses_until_the_operator_aggregates", async () => {
    // D6 is this page's stated reason to exist and had no entry-point test.
    rowsByElection["2023-generales"] = [row("2023-generales", "seccion", "20135")];
    rowsByElection["2025-legislativas-nacional"] = [
      row("2025-legislativas-nacional", "mesa", "110"),
    ];

    const markup = renderToStaticMarkup(
      (await ComparePage({ searchParams: Promise.resolve(PARAMS) })) as ReactElement,
    );

    // The REFUSAL, by its own text. Both level strings also appear on the
    // success path's aggregation note, so asserting them proved nothing about
    // which branch rendered.
    expect(markup).toContain("role=\"alert\"");
    expect(markup).toContain("explícito");
    expect(markup).not.toContain("sin cambio");
  });

  it("test_an_explicit_aggregation_is_disclosed_in_the_render", async () => {
    rowsByElection["2023-generales"] = [row("2023-generales", "seccion", "20135")];
    rowsByElection["2025-legislativas-nacional"] = [
      row("2025-legislativas-nacional", "mesa", "110"),
    ];

    const markup = renderToStaticMarkup(
      (await ComparePage({
        searchParams: Promise.resolve({ ...PARAMS, aggregateTo: "seccion" }),
      })) as ReactElement,
    );

    // The operator asked for it, so the page must SAY it aggregated rather
    // than presenting the result as directly comparable.
    expect(markup).toContain("Agregado a partir de");
  });
});

describe("compare page — a drop stays visible through a refusal", () => {
  it("test_the_excluded_breakdown_survives_the_d6_refusal", async () => {
    // D6 is the branch this page exists for, and it was the one refusal that
    // returned without the breakdown — so a granularity mismatch hid rows the
    // source-kind filter had already removed.
    const base = {
      jurisdictionId: "j-027",
      categoryId: "c-diputados",
      listId: "110",
      votes: 10,
      sourceKind: "official" as const,
      archiveEntryId: "national/x",
    };
    rowsByElection["2023-generales"] = [
      { ...base, listId: "20135", granularity: "seccion" },
      { ...base, listId: "20135", granularity: "seccion", sourceKind: "fiscalizacion" },
    ];
    rowsByElection["2025-legislativas-nacional"] = [{ ...base, granularity: "mesa" }];

    const markup = renderToStaticMarkup(
      (await ComparePage({ searchParams: Promise.resolve(PARAMS) })) as ReactElement,
    );

    expect(markup).toContain("1 fila fiscalización");
  });
});

describe("compare page — path 3 fires when the repository filter regresses", () => {
  it("test_a_leaked_fiscalizacion_row_is_refused_at_the_render", async () => {
    leakFiscalizacion = true;
    const base = {
      jurisdictionId: "j-027",
      categoryId: "c-diputados",
      listId: "110",
      votes: 10,
      sourceKind: "fiscalizacion" as const,
      granularity: "mesa" as const,
      archiveEntryId: "fiscalizacion/2025-lla",
    };
    rowsByElection["2023-generales"] = [base];
    rowsByElection["2025-legislativas-nacional"] = [base];

    const markup = renderToStaticMarkup(
      (await ComparePage({ searchParams: Promise.resolve(PARAMS) })) as ReactElement,
    );

    // The BREAKDOWN, in both units: a bare "2 row(s)" cannot tell a leaked
    // fiscalización row from a leaked unknown-kind one, and hides the votes.
    expect(markup).toContain("1 fila fiscalización / 10 votos");
    // And the unmapped ids, counted before this refusal and about a different
    // axis: `toCompareUnits` used to run AFTER the guard, so they were never
    // even computed on this path.
    expect(markup).toContain("se resolvieron sin un partido curado");
    expect(markup).toContain("no son oficiales");
    expect(markup).not.toContain("sin cambio");
  });
});

describe("compare page — provenance reaches the render", () => {
  it("test_every_displayed_figure_traces_to_an_archived_source", async () => {
    sourceRefs = [
      {
        archiveEntryId: "national/2025-legislativas",
        sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        url: "https://example.test/2025-legislativas.zip",
        fetchedAt: "2026-01-01T00:00:00Z",
      },
    ];
    const base = {
      jurisdictionId: "j-027",
      categoryId: "c-diputados",
      votes: 10,
      sourceKind: "official" as const,
      granularity: "mesa" as const,
      archiveEntryId: "national/2025-legislativas",
    };
    rowsByElection["2023-generales"] = [{ ...base, listId: "20135" }];
    rowsByElection["2025-legislativas-nacional"] = [{ ...base, listId: "110" }];

    const markup = renderToStaticMarkup(
      (await ComparePage({ searchParams: Promise.resolve(PARAMS) })) as ReactElement,
    );

    expect(markup).toContain("https://example.test/2025-legislativas.zip");
  });
});

describe("compare page — a real flip", () => {
  it("test_a_flip_names_the_parties_never_their_canonical_ids", async () => {
    // The success path that reports a swing had NO driver: every other test
    // asserts `not.toContain("flipped")`, and the fixture mapped both years to
    // one canonical id so no flip could occur. The line rendered `lla`.
    const base = {
      jurisdictionId: "j-027",
      categoryId: "c-diputados",
      sourceKind: "official" as const,
      granularity: "mesa" as const,
      archiveEntryId: "national/x",
    };
    rowsByElection["2023-generales"] = [
      { ...base, listId: "20999", votes: 60 },
      { ...base, listId: "20135", votes: 40 },
    ];
    rowsByElection["2025-legislativas-nacional"] = [
      { ...base, listId: "110", votes: 70 },
      { ...base, listId: "999", votes: 30 },
    ];

    const markup = renderToStaticMarkup(
      (await ComparePage({ searchParams: Promise.resolve(PARAMS) })) as ReactElement,
    );

    expect(markup).toContain("cambió de");
    expect(markup).toContain("ALIANZA LA LIBERTAD AVANZA");
    expect(markup).not.toContain("cambió de lla");
  });
});

describe("compare page — a repeated query param reaches the guard", () => {
  it("test_a_repeated_query_param_is_reported_not_treated_as_absent", async () => {
    // Next.js hands `string[]` for a repeated param, and `stringParam`
    // returned `undefined` for those — so a SUPPLIED value vanished and the
    // page asked for a parameter the request had sent twice. The unit test in
    // `query-params.test.ts` is not evidence this page reaches the guard.
    const markup = renderToStaticMarkup(
      (await ComparePage({
        // `election2023` — the key this page ACTUALLY reads. Repeating
        // `electionId2023`, which it never reads, left the guard firing on a
        // key nothing was at risk of losing: `repeatedParams` is key-agnostic,
        // so the test stayed green while the defect went undriven.
        searchParams: Promise.resolve({ ...PARAMS, election2023: ["a", "b"] }),
      })) as ReactElement,
    );

    expect(markup).toContain("election2023");
    expect(markup).toContain("más de una vez");
    // The half that separates "reported as repeated" from "reported as
    // absent": the page must not ask for a parameter the request sent twice.
    expect(markup).not.toContain("proporcione <code>partyCategory</code>");
    expect(markup).not.toContain("Proporcione");
  });
});

describe("compare page — the figure's level is disclosed", () => {
  it("test_mesa_rows_summed_into_a_jurisdiction_total_say_so", async () => {
    // The disclosure was keyed on the wrong one of the boundary's two disjoint
    // shapes, so with mesa rows — the normal national case, and every fixture
    // here — the badge rendered bare and the note never appeared. A summed
    // figure shipping with no degradation notice is exactly what rule 4
    // forbids.
    rowsByElection["2023-generales"] = [
      {
        jurisdictionId: "j-027",
        categoryId: "c-diputados",
        listId: "20135",
        votes: 100,
        sourceKind: "official",
        granularity: "mesa",
        archiveEntryId: "national/2023-generales",
      },
    ];
    rowsByElection["2025-legislativas-nacional"] = [
      {
        jurisdictionId: "j-027",
        categoryId: "c-diputados",
        listId: "110",
        votes: 140,
        sourceKind: "official",
        granularity: "mesa",
        archiveEntryId: "national/2025-legislativas",
      },
    ];

    const markup = renderToStaticMarkup(
      (await ComparePage({ searchParams: Promise.resolve(PARAMS) })) as ReactElement,
    );

    // NOT `distrito`: that is the province, and these rows are one partido.
    expect(markup).toContain('aria-label="granularidad: seccion"');
    expect(markup).toContain("sumado a partir de filas de nivel mesa");
    expect(markup).toContain("se sumaron para obtenerlos");
    // And NOT the opposite claim: nothing here was unavailable.
    expect(markup).not.toContain("degradada desde");
  });

  it("test_a_category_mismatch_is_refused_before_the_mapping_is_consulted", async () => {
    // NO row fixtures: the guard fires before `createResultsRepository()`, so
    // seeded rows would read as evidence the data path ran when nothing
    // reaches it.
    //
    // That the full `(year, jurisdiction, category)` context reaches
    // `fetchPartyNames` is driven where a party NAME renders — the mock returns
    // an empty map unless all three match — in
    // `test_a_flip_names_the_parties_never_their_canonical_ids` and
    // `test_the_same_party_under_two_list_ids_is_not_reported_as_a_flip`.
    const markup = renderToStaticMarkup(
      (await ComparePage({
        searchParams: Promise.resolve({ ...PARAMS, partyCategory: "CONCEJAL" }),
      })) as ReactElement,
    );

    // `c-diputados` is DIPUTADO NACIONAL, not CONCEJAL. Refused on the axis
    // itself rather than left to degrade into the unmapped path, which only
    // catches ids ABSENT from the wrong table — the easy half.
    expect(markup).toContain("no CONCEJAL");
  });
});

describe("compare page — a mixed pair discloses BOTH sides", () => {
  it("test_one_side_summed_and_one_side_coarse_report_each_fact", async () => {
    // The disclosure was read off whichever side won the coarseness
    // comparison, so the coarse side's `degradedFrom` hid the fine side's sum:
    // every 2025 mesa row folded into one total with nothing saying so.
    rowsByElection["2023-generales"] = [
      {
        jurisdictionId: "j-027",
        categoryId: "c-diputados",
        listId: "20135",
        votes: 100,
        sourceKind: "official",
        granularity: "distrito",
        archiveEntryId: "national/2023-generales",
      },
    ];
    rowsByElection["2025-legislativas-nacional"] = [
      {
        jurisdictionId: "j-027",
        categoryId: "c-diputados",
        listId: "110",
        votes: 140,
        sourceKind: "official",
        granularity: "mesa",
        archiveEntryId: "national/2025-legislativas",
      },
    ];

    const markup = renderToStaticMarkup(
      (await ComparePage({
        searchParams: Promise.resolve({ ...PARAMS, aggregateTo: "distrito" }),
      })) as ReactElement,
    );

    // Both facts, not whichever one the coarser side happened to carry: 2025's
    // mesa rows were summed, and 2023's distrito source never carried the
    // partido detail at all.
    expect(markup).toContain("sumado a partir de filas de nivel mesa");
    expect(markup).toContain("degradada desde distrito");
    expect(markup).toContain("la fuente publicó totales a nivel distrito");
    expect(markup).not.toContain("se solicitó detalle a nivel distrito");
  });
});

describe("compare page — two summed sides do not report one side's level", () => {
  it("test_the_badge_names_the_coarsest_of_the_two_summed_levels", async () => {
    // `??` took the FIRST non-null side, so with 2023 at `mesa` and 2025 at
    // `circuito` the badge announced "summed from mesa" — the finer of the two
    // stated as the figure's level, on the line an operator reads first.
    // (Fixture order matters: `??` and "coarsest" agree when the coarse side
    // happens to come first, and a test seeded that way cannot fail.)
    rowsByElection["2023-generales"] = [
      {
        jurisdictionId: "j-027",
        categoryId: "c-diputados",
        listId: "20135",
        votes: 100,
        sourceKind: "official",
        granularity: "mesa",
        archiveEntryId: "national/2023-generales",
      },
    ];
    rowsByElection["2025-legislativas-nacional"] = [
      {
        jurisdictionId: "j-027",
        categoryId: "c-diputados",
        listId: "110",
        votes: 140,
        sourceKind: "official",
        granularity: "circuito",
        archiveEntryId: "national/2025-legislativas",
      },
    ];

    const markup = renderToStaticMarkup(
      (await ComparePage({
        searchParams: Promise.resolve({ ...PARAMS, aggregateTo: "circuito" }),
      })) as ReactElement,
    );

    expect(markup).toContain("sumado a partir de filas de nivel circuito");
    expect(markup).not.toContain("sumado a partir de filas de nivel mesa");
  });
});

describe("compare page — an unorderable level is reported by size", () => {
  it("test_unorderable_levels_are_reported_by_row_count_not_summed_votes", async () => {
    // Naming the levels alone hid how much of the comparison sits on one this
    // module cannot order — the large-plausible-total shape rule 3 exists for.
    rowsByElection["2023-generales"] = [
      {
        jurisdictionId: "j-027",
        categoryId: "c-diputados",
        listId: "20135",
        votes: 4000,
        sourceKind: "official",
        granularity: "subcircuito" as never,
        archiveEntryId: "national/2023-generales",
      },
      {
        jurisdictionId: "j-027",
        categoryId: "c-diputados",
        listId: "20135",
        votes: 2000,
        sourceKind: "official",
        granularity: "subcircuito" as never,
        archiveEntryId: "national/2023-generales",
      },
    ];
    rowsByElection["2025-legislativas-nacional"] = [
      {
        jurisdictionId: "j-027",
        categoryId: "c-diputados",
        listId: "110",
        votes: 140,
        sourceKind: "official",
        granularity: "mesa",
        archiveEntryId: "national/2025-legislativas",
      },
    ];

    const markup = renderToStaticMarkup(
      (await ComparePage({ searchParams: Promise.resolve(PARAMS) })) as ReactElement,
    );

    // ROWS, never a vote total. The level cannot be ordered, so whether its
    // two rows contain one another is unknown and adding them may count the
    // same votes twice — the rule the shared component states and the inline
    // copy here contradicted.
    expect(markup).toContain("subcircuito: 2 filas");
    expect(markup).not.toContain("6000 votos");
    // NAMED per year: the two reads are independent, and merging them put one
    // year's 400 rows and another's 200+200 on the same indistinguishable line.
    expect(markup).toContain("2023-generales:");
  });
});

describe("compare page — a category collision is refused, not resolved", () => {
  it("test_rows_are_never_resolved_through_another_categorys_mapping", async () => {
    // The hard half: a list id present in BOTH tables. It resolves to a
    // DIFFERENT canonical party under the wrong category, so nothing degrades
    // to unmapped and the page renders a real-looking name — on `compare`, a
    // flip between two parties that never changed hands. No refusal, no note.
    rowsByElection["2023-generales"] = [
      {
        jurisdictionId: "j-027",
        categoryId: "c-diputados",
        listId: "110",
        votes: 100,
        sourceKind: "official",
        granularity: "mesa",
        archiveEntryId: "national/2023-generales",
      },
    ];
    rowsByElection["2025-legislativas-nacional"] = [
      {
        jurisdictionId: "j-027",
        categoryId: "c-diputados",
        listId: "110",
        votes: 140,
        sourceKind: "official",
        granularity: "mesa",
        archiveEntryId: "national/2025-legislativas",
      },
    ];

    const markup = renderToStaticMarkup(
      (await ComparePage({
        searchParams: Promise.resolve({ ...PARAMS, partyCategory: "SENADOR NACIONAL" }),
      })) as ReactElement,
    );

    expect(markup).toContain("no SENADOR NACIONAL");
    // No figure, no swing, no party name reaches the page.
    expect(markup).not.toContain("LA LIBERTAD AVANZA");
    expect(markup).not.toContain("cambió de");
  });
});

describe("compare page — uuid election ids are served", () => {
  it("test_both_sides_uuid_are_compared_not_refused_for_want_of_a_year", async () => {
    // `election.id` is a uuid and `election.year` is a column beside it, so a
    // reader that parses the id refuses every real request. Both sides here
    // carry no year in their text at all.
    rowsByElection["7769c98d-b286-4e8c-80ce-c2f9ab4fc929"] = [
      {
        jurisdictionId: "j-027",
        categoryId: "c-diputados",
        listId: "20135",
        votes: 100,
        sourceKind: "official",
        granularity: "mesa",
        archiveEntryId: "national/2023-generales",
      },
    ];
    rowsByElection["6dae81f9-c862-4cc5-b3f3-b640e4ea7319"] = [
      {
        jurisdictionId: "j-027",
        categoryId: "c-diputados",
        listId: "110",
        votes: 140,
        sourceKind: "official",
        granularity: "mesa",
        archiveEntryId: "national/2025-legislativas",
      },
    ];

    const markup = renderToStaticMarkup(
      (await ComparePage({
        searchParams: Promise.resolve({
          ...PARAMS,
          election2023: "7769c98d-b286-4e8c-80ce-c2f9ab4fc929",
          election2025: "6dae81f9-c862-4cc5-b3f3-b640e4ea7319",
        }),
      })) as ReactElement,
    );

    expect(markup).not.toContain("ninguna fila de elección tiene");
    // SERVED: the comparison itself renders. The party name is not on this
    // line — the unit label is — so asserting it would be asserting about the
    // wrong text.
    expect(markup).toContain("j-027 (jurisdicción completa): sin cambio");
    expect(markup).toContain('aria-label="granularidad: seccion"');
  });
});

describe("compare page — unmapped ids survive the refusals about other axes", () => {
  it("test_the_unmapped_breakdown_survives_the_mixed_granularity_refusal", async () => {
    // `toCompareUnits` counts them BEFORE the refusal, and which ids failed to
    // map does not depend on granularity. Compare was the fourth page to drop
    // this behind a refusal about something else.
    rowsByElection["2023-generales"] = [
      {
        jurisdictionId: "j-027",
        categoryId: "c-diputados",
        listId: "4321",
        votes: 700,
        sourceKind: "official",
        granularity: "mesa",
        archiveEntryId: "national/2023-generales",
      },
      {
        jurisdictionId: "j-027",
        categoryId: "c-diputados",
        listId: "4321",
        votes: 300,
        sourceKind: "official",
        granularity: "seccion",
        archiveEntryId: "national/2023-generales",
      },
    ];
    rowsByElection["2025-legislativas-nacional"] = [
      {
        jurisdictionId: "j-027",
        categoryId: "c-diputados",
        listId: "110",
        votes: 140,
        sourceKind: "official",
        granularity: "mesa",
        archiveEntryId: "national/2025-legislativas",
      },
    ];

    const markup = renderToStaticMarkup(
      (await ComparePage({ searchParams: Promise.resolve(PARAMS) })) as ReactElement,
    );

    expect(markup).toContain("mezclan niveles de granularidad");
    expect(markup).toContain("4321: 2 filas");
    // Votes withheld: the two rows are on containing levels.
    expect(markup).toContain("no se pueden sumar");
  });
});

describe("compare page — a leaked row set that also mixes levels", () => {
  it("test_the_leakage_refusal_withholds_vote_sums_when_levels_mix", async () => {
    // The foreign guard runs BEFORE the mixed-granularity one, so this branch
    // received `unsummable={null}` and printed vote totals across containing
    // levels — the double count the prop exists to prevent. Every existing
    // path-3 fixture used one level, so the gap stayed green.
    leakFiscalizacion = true;
    const base = {
      jurisdictionId: "j-027",
      categoryId: "c-diputados",
      listId: "4321",
      sourceKind: "fiscalizacion" as const,
      archiveEntryId: "fiscalizacion/2025-lla",
    };
    rowsByElection["2023-generales"] = [
      { ...base, votes: 400, granularity: "seccion" as const },
      { ...base, votes: 100, granularity: "mesa" as const },
    ];
    rowsByElection["2025-legislativas-nacional"] = [
      { ...base, votes: 60, granularity: "mesa" as const },
    ];

    const markup = renderToStaticMarkup(
      (await ComparePage({ searchParams: Promise.resolve(PARAMS) })) as ReactElement,
    );

    expect(markup).toContain("no son oficiales");
    // PER YEAR, each labelled. Merged into one line, `4321` read as a single
    // cross-year figure — two different reads over different rows — with
    // nothing naming the year.
    expect(markup).toContain("2023-generales:");
    expect(markup).toContain("2025-legislativas-nacional:");
    expect(markup).toContain("4321: 2 filas");
    expect(markup).toContain("4321: 1 filas");
    expect(markup).not.toContain("4321: 3 filas");
    expect(markup).toContain("no se pueden sumar");
    expect(markup).not.toContain("560 votos");
  });
});

describe("compare page — one unorderable level in both years", () => {
  it("test_each_year_reports_its_own_unorderable_rows", async () => {
    // No fixture put the same level in BOTH years, so the merge that summed
    // them was never driven — including the vote sum it computed on a level
    // this module cannot order.
    const base = {
      jurisdictionId: "j-027",
      categoryId: "c-diputados",
      listId: "110",
      sourceKind: "official" as const,
      granularity: "subcircuito" as never,
      archiveEntryId: "national/2025-legislativas",
    };
    rowsByElection["2023-generales"] = [{ ...base, votes: 400 }];
    rowsByElection["2025-legislativas-nacional"] = [
      { ...base, votes: 200 },
      { ...base, votes: 200 },
    ];

    const markup = renderToStaticMarkup(
      (await ComparePage({ searchParams: Promise.resolve(PARAMS) })) as ReactElement,
    );

    // ONE row for 2023 and TWO for 2025 — not three on a merged line.
    expect(markup).toContain("2023-generales: 1 fila(s) tienen un nivel de granularidad");
    expect(markup).toContain("2025-legislativas-nacional: 2 fila(s) tienen un nivel de granularidad");
    expect(markup).not.toContain("3 fila(s) tienen un nivel de granularidad");
  });
});

describe("compare page — rows with no list id are not unmapped ids", () => {
  it("test_a_row_without_a_list_id_does_not_refuse_the_comparison", async () => {
    // Rule 2: `lista_numero` is empty throughout the 2023 generales file and
    // never populated on a POSITIVO row in 2025. Counting those rows as ids
    // that failed to map refused the whole comparison for the shape the source
    // always had.
    const base = {
      jurisdictionId: "j-027",
      categoryId: "c-diputados",
      sourceKind: "official" as const,
      granularity: "mesa" as const,
      archiveEntryId: "national/2025-legislativas",
    };
    rowsByElection["2023-generales"] = [
      { ...base, listId: "20135", votes: 100 },
      { ...base, listId: null, votes: 12 },
    ];
    rowsByElection["2025-legislativas-nacional"] = [
      { ...base, listId: "110", votes: 140 },
      { ...base, listId: null, votes: 8 },
    ];

    const markup = renderToStaticMarkup(
      (await ComparePage({ searchParams: Promise.resolve(PARAMS) })) as ReactElement,
    );

    // SERVED, not refused for an "unmapped id" nobody supplied.
    expect(markup).not.toContain("no se resolvieron a un partido canónico");
    expect(markup).toContain("sin cambio");
    // And the id-less rows reported in their OWN sentence.
    expect(markup).toContain("no tienen id de lista");
  });
});

describe("compare page — a row with an id but no name is never dropped", () => {
  it("test_it_lands_in_a_visible_bucket_instead_of_leaving_every_figure", async () => {
    // `{canonicalPartyId: set, partyName: null, listId: null}` hit `continue`
    // in `toCompareUnits`: out of every figure and every swing, and out of the
    // unresolved counter too. Its only disclosure was the boundary fold
    // agreeing by coincidence — two definitions of "resolved", either of which
    // could have moved.
    const base = {
      jurisdictionId: "j-027",
      categoryId: "c-diputados",
      sourceKind: "official" as const,
      granularity: "mesa" as const,
      archiveEntryId: "national/2025-legislativas",
    };
    rowsByElection["2023-generales"] = [
      { ...base, listId: "20135", votes: 100 },
      // Resolves to a canonical id the mock has no display name for.
      { ...base, listId: null, votes: 33 },
    ];
    rowsByElection["2025-legislativas-nacional"] = [{ ...base, listId: "110", votes: 140 }];

    const markup = renderToStaticMarkup(
      (await ComparePage({ searchParams: Promise.resolve(PARAMS) })) as ReactElement,
    );

    // VISIBLE, per source kind — not silently absent from every tally.
    expect(markup).toContain("no tienen id de lista");
    expect(markup).toContain("1 fila oficial / 33 votos");
  });
});

describe("compare page — the D6 refusal keeps the no-list-id disclosure", () => {
  it("test_rows_without_a_list_id_are_named_under_a_granularity_mismatch", async () => {
    // The gap: null-listId rows exist on the SUCCESS path test, and the D6
    // test's fixture uses mapped ids on both sides. Neither puts the two
    // together, so D6 — the one refusal this page names for granularity
    // mismatch — rendered the count nowhere.
    const base = {
      jurisdictionId: "j-027",
      categoryId: "c-diputados",
      sourceKind: "official" as const,
      archiveEntryId: "national/2025-legislativas",
    };
    rowsByElection["2023-generales"] = [
      { ...base, listId: "20135", votes: 100, granularity: "seccion" as const },
      { ...base, listId: null, votes: 31, granularity: "seccion" as const },
    ];
    rowsByElection["2025-legislativas-nacional"] = [
      { ...base, listId: "110", votes: 140, granularity: "mesa" as const },
      { ...base, listId: null, votes: 17, granularity: "mesa" as const },
    ];

    const markup = renderToStaticMarkup(
      // NO `aggregateTo`: that parameter resolves the mismatch, which is how
      // this fixture reached the success path instead of the refusal it names.
      (await ComparePage({ searchParams: Promise.resolve(PARAMS) })) as ReactElement,
    );

    // The D6 refusal itself...
    expect(markup).toContain("esta comparación no hace suposiciones");
    // ...and the disclosure it used to return without.
    expect(markup).toContain("no tienen id de lista");
    expect(markup).toContain("1 fila oficial / 31 votos");
    expect(markup).toContain("1 fila oficial / 17 votos");
  });
});
