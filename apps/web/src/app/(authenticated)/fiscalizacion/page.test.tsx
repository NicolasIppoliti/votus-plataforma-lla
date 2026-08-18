import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readGranularity, unrecognizedLevels } from "@/lib/results/granularity";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ResultsRepository } from "@/lib/fiscalizacion/repository";
import type { ResultRow, RowSource } from "@/lib/fiscalizacion/repository";
import type { CoverageOk, CoverageResult } from "@/lib/results/coverage";
import type { SourceRef } from "@/lib/results/types";
import FiscalizacionPage, {
	FISCALIZACION_COVERAGE,
	FISCALIZACION_PARTY_CONTEXT,
	loadFiscalizacionView,
	renderCoverageExplorer,
	renderFiscalizacionView,
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
let refuseSourceReadWith: string | null = null;
let sourceRefReadCount = 0;
let sourceRefRequestedIds: string[] = [];
interface PartyNameFixture {
	canonicalPartyId: string;
	displayName: string;
}
let partyNameOverrides: Map<string, PartyNameFixture> | null = null;
let coverageRpcResults: Record<string, unknown> = {};

const COVERAGE_CONTROL_NAMES = [
  "electionId",
  "categoryId",
  "distritoCode",
  "seccionCode",
] as const;
type CoverageControlName = (typeof COVERAGE_CONTROL_NAMES)[number];

function coverageSelectOpeningTag(markup: string, name: CoverageControlName): string {
  const match = markup.match(new RegExp(`<select[^>]*name="${name}"[^>]*>`));
  if (!match) throw new Error(`select ${name} was not rendered`);
  return match[0];
}

function expectCoverageControlState(
  markup: string,
  name: CoverageControlName,
  state: { required: boolean; disabled: boolean },
): void {
  const tag = coverageSelectOpeningTag(markup, name);
  expect(/\srequired(?:=""|(?=[\s>]))/.test(tag)).toBe(state.required);
  expect(/\sdisabled(?:=""|(?=[\s>]))/.test(tag)).toBe(state.disabled);
}

// Restored after EVERY test: `process.env` and `repositoryRows` are shared
// module state, so leaving them set makes results depend on execution order.
afterEach(() => {
  delete process.env["NATIONAL_JURISDICTION_ID"];
  delete process.env["FISCALIZACION_CATEGORY_ID"];
  delete process.env["FISCALIZACION_ELECTION_ID"];
  repositoryRows = [];
  sourceRefs = [];
  refuseQueryWith = null;
  refuseSourceReadWith = null;
  sourceRefReadCount = 0;
  sourceRefRequestedIds = [];
	partyNameOverrides = null;
  coverageRpcResults = {};
});

vi.mock("@/lib/supabase/server-client", () => ({
	createSupabaseServerClient: () =>
		Promise.resolve({
			rpc: (name: string) =>
				Promise.resolve({ data: coverageRpcResults[name], error: null }),
  }),
}));

vi.mock("@/lib/fiscalizacion/repository", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("@/lib/fiscalizacion/repository")>();
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
                        partyNameOverrides ??
                          new Map([
                            [
                              "110",
                              {
                                canonicalPartyId: "canon-110",
                                displayName: "LA LIBERTAD AVANZA",
                              },
                            ],
                            [
                              "999",
                              {
                                canonicalPartyId: "canon-999",
                                displayName: "FUERZA PATRIA",
                              },
                            ],
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
				repository.queryFiscalizacion = () =>
					Promise.reject(new Error(refuseQueryWith as string));
      }
      return Promise.resolve(repository);
    },
    // Computes `missing` the way the real function does — a mock that always
    // answers `[]` cannot exercise the untraceable-entry path it feeds.
    // Stands in for the `election` table: the fixture ids carry their year, so
    // the double reads it off them. Production reads the `year` COLUMN — the
    // point of the change is that the id string is not the source.
    fetchElectionYear: (_client: unknown, electionId: string) => {
      // Two uuids mapped the way the `election` table does it: one held in
      // 2025 (the race these constants were verified for) and one in 2023.
			if (electionId === "6dae81f9-c862-4cc5-b3f3-b640e4ea7319")
				return Promise.resolve({ status: "ok" as const, year: 2025 });
			if (electionId === "b5b6a452-836d-40ea-a570-1cbc87fb84f6")
				return Promise.resolve({ status: "ok" as const, year: 2023 });
      const match = /^(\d{4})/.exec(electionId);
      return Promise.resolve(
				match
					? { status: "ok" as const, year: Number(match[1]) }
					: { status: "no_row" as const },
      );
    },
    fetchSourceRefs: (_client: unknown, ids: string[]) => {
      sourceRefReadCount += 1;
      sourceRefRequestedIds = [...ids];
      return refuseSourceReadWith
        ? Promise.reject(new Error(refuseSourceReadWith))
        : Promise.resolve({
        sources: sourceRefs,
						missing: ids.filter(
							(id) => !sourceRefs.some((ref) => ref.archiveEntryId === id),
						),
          });
    },
  };
});

function fakeRowSource(rows: ResultRow[]): RowSource {
  return { fetchRows: () => Promise.resolve(rows) };
}

const QUERY = {
	electionId: "2025-legislativas-nacional",
	jurisdictionId: "j-027",
	categoryId: "c-diputados",
};

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
		const repository = new ResultsRepository(
			fakeRowSource([...FISCALIZACION_ROWS, ...OFFICIAL_ROWS]),
		);
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
		expect(view.rows.every((row) => row.sourceKind === "fiscalizacion")).toBe(
			true,
		);
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
        partyMappingConfigured: true,
      }),
    );

    expect(html.toLowerCase()).toContain("no oficial");
    // Tied to the coverage note's own element: bare `93` and `153` also match
    // a vote count, a percentage, or a slice of a sha256 digest, and neither
    // says which figure the denominator belongs to.
    const coverageNote = html.slice(html.indexOf('role="note"'));
    expect(coverageNote).toContain("93 de 153 mesas");
  });

  it("test_coverage_indicator_states_it_is_not_a_random_sample", () => {
    const html = renderToStaticMarkup(
      renderFiscalizacionView({
        status: "ok",
        rows: FISCALIZACION_ROWS,
        excluded: {},
        coverage: FISCALIZACION_COVERAGE,
        partyMappingConfigured: true,
      }),
    );

    expect(html.toLowerCase()).toContain("no es una muestra aleatoria");
    // Tied to the coverage NOTE's own element. `toContain("93")` also matches
    // a vote count, a percentage or a sha256 digest, and says nothing about
    // which figure it belongs to.
    const note = html.slice(html.indexOf('role="note"'));
    expect(note).toContain("93 de 153 mesas");
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
						{
							...FISCALIZACION_ROW,
							partyName: "LA LIBERTAD AVANZA",
							canonicalPartyId: "canon-110",
						},
          ],
          coverage: FISCALIZACION_COVERAGE,
          partyMappingConfigured: true,
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

    expect(html.toLowerCase()).toContain("fuente oficial");
    // Both source kinds must be visually distinguishable — the two labels
    // must be different strings, never the same badge text reused.
    const unofficialText = html.toLowerCase().match(/fuente no oficial/g) ?? [];
		const officialText = html.toLowerCase().match(/fuente oficial/g) ?? [];
    expect(unofficialText.length).toBeGreaterThan(0);
    expect(officialText.length).toBeGreaterThan(0);
  });

      it("renders the refusal state, not an unlabelled figure, when refused", () => {
        const html = renderToStaticMarkup(
          renderFiscalizacionView({
            status: "refused",
            reason: "no coverage supplied",
          }),
        );

        expect(html.toLowerCase()).toContain("se rechazó");
        expect(html).not.toContain("12578");
      });

      it("withholds unmapped vote totals on a foreign-source refusal", () => {
            const html = renderToStaticMarkup(
              renderFiscalizacionView({
                status: "ok",
                rows: [
                  { ...FISCALIZACION_ROW, listId: "4321", votes: 700 },
                  { ...OFFICIAL_ROW, listId: "9876", votes: 60 },
                ],
                excluded: {},
                coverage: FISCALIZACION_COVERAGE,
                partyMappingConfigured: true,
              }),
            );

            expect(html).toContain("Se rechazó");
            expect(html).toContain("4321: 1 filas");
            expect(html).toContain("9876: 1 filas");
            expect(html).not.toContain("4321: 1 filas, 700 votos");
            expect(html).not.toContain("9876: 1 filas, 60 votos");
            expect(html).toContain("las cifras oficiales y de fiscalización nunca se combinan en un mismo número");
            expect(html).not.toContain("Cobertura:");
            expect(html).not.toContain("LA LIBERTAD AVANZA");
          });

          it("normalizes every foreign source kind without dropping rows or votes", () => {
        const html = renderToStaticMarkup(
          renderFiscalizacionView({
            status: "ok",
            rows: [
              { ...OFFICIAL_ROW, votes: 100 },
              { ...FISCALIZACION_ROW, votes: 20, sourceKind: "provisional" as never },
              { ...FISCALIZACION_ROW, votes: 30, sourceKind: null as never },
            ],
            excluded: {},
            coverage: FISCALIZACION_COVERAGE,
            partyMappingConfigured: true,
          }),
        );

        expect(html).toContain("oficial: 1 fila, 100 votos");
        expect(html).toContain("desconocida: 2 filas, 50 votos");
        expect(html).not.toContain("provisional");
        expect(html).not.toContain("<li>:");
      });
    });

describe("comparisonFromParams (Requirement 9 — juxtaposition must be reachable)", () => {
  it("test_comparison_absent_when_no_query_params_supplied", () => {
    expect(comparisonFromParams({}, null)).toEqual({ status: "none" });
  });

  it("test_comparison_names_the_election_and_carries_no_figure", () => {
    // The scope must be pinned: `comparisonFromParams` refuses an unpinned
    // one on its own rather than skipping its checks.
    process.env["NATIONAL_JURISDICTION_ID"] = "j-027";
    process.env["FISCALIZACION_CATEGORY_ID"] = "c-diputados";
    process.env["FISCALIZACION_ELECTION_ID"] = "2025-legislativas-nacional";

		const comparison = comparisonFromParams(
			{
      compareElectionId: "2023-municipal",
      compareElectionLabel: "2023 municipal (official)",
      compareYear: "2023",
      compareCategory: "DIPUTADO NACIONAL",
      compareJurisdiction: "national",
      compareJurisdictionId: "j-027",
      compareCategoryId: "c-diputados",
      // Ignored on purpose: a share supplied by the request is not evidence.
      compareSharePercent: "29.31",
			},
			2023,
		);

    expect(comparison).toEqual({
      status: "ok",
      request: {
        electionId: "2023-municipal",
        electionLabel: "2023 municipal (official)",
        // The comparison election's OWN ids, not this one's.
        jurisdictionId: "j-027",
        categoryId: "c-diputados",
				partyContext: {
					year: 2023,
					jurisdiction: "national",
					category: "DIPUTADO NACIONAL",
				},
      },
    });
  });

  it("test_incomplete_comparison_params_are_refused_with_the_missing_names", () => {
    // A half-specified comparison must not render a figure with a missing label.
    expect(comparisonFromParams({}, null)).toEqual({ status: "none" });
    // Half-specified is REFUSED, and names what is missing -- distinct from
    // "no comparison was asked for".
		const refused = comparisonFromParams(
			{ compareElectionId: "2023-municipal" },
			null,
		);

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
    // The pinned election is CONFIGURED here: this test is about a request for
    // a different race, not about missing config.
    process.env["FISCALIZACION_ELECTION_ID"] = "2025-legislativas-nacional";
    const markup = renderToStaticMarkup(
      (await FiscalizacionPage({
        searchParams: Promise.resolve({
          electionId: "2023-generales",
          jurisdictionId: "j-027",
          categoryId: "c-diputados",
        }),
      })) as ReactElement,
    );

    expect(markup).toContain("Se rechazó");
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
    process.env["FISCALIZACION_ELECTION_ID"] = "2025-legislativas-nacional";
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

    expect(markup).toContain("comparación entre elecciones");
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
    process.env["FISCALIZACION_ELECTION_ID"] = "2025-legislativas-nacional";

    const markup = renderToStaticMarkup(
      (await FiscalizacionPage({
        searchParams: Promise.resolve({
          electionId: "2025-legislativas-nacional",
          jurisdictionId: "j-999",
          categoryId: "c-diputados",
        }),
      })) as ReactElement,
    );

    expect(markup).toContain("Se rechazó");
    // The refusal SENTENCE. A bare "93" also matches a vote count, a
    // percentage, or a slice of a sha256 digest, so it could not fail.
		expect(markup).toContain(
			"denominador de cobertura de 93 sobre 153 describe una jurisdicción",
		);
  });

  it("test_the_page_refuses_when_the_scope_is_not_configured", async () => {
    // `afterEach` cleared the env vars, so the SCOPE is unpinned here. The
    // pinned election is set, because the election check runs first and this
    // test is about the jurisdiction/category pair rather than about it.
    process.env["FISCALIZACION_ELECTION_ID"] = "2025-legislativas-nacional";
    const markup = renderToStaticMarkup(
      (await FiscalizacionPage({
        searchParams: Promise.resolve({
          electionId: "2025-legislativas-nacional",
          jurisdictionId: "j-027",
          categoryId: "c-diputados",
        }),
      })) as ReactElement,
    );

    expect(markup).toContain("Se rechazó");
    expect(markup).toContain("NATIONAL_JURISDICTION_ID");
  });

  it("test_a_refused_comparison_says_so_instead_of_rendering_nothing", async () => {
    process.env["NATIONAL_JURISDICTION_ID"] = "j-027";
    process.env["FISCALIZACION_CATEGORY_ID"] = "c-diputados";
    process.env["FISCALIZACION_ELECTION_ID"] = "2025-legislativas-nacional";
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
    expect(markup).toContain("Sin cifra comparativa");
    expect(markup).toContain("nacional");
  });

  it("test_every_displayed_figure_traces_to_an_archived_source", async () => {
    // Every entry-point test stubbed `fetchSourceRefs` to empty, so
    // `ProvenanceLink` never rendered a source in any page-level test and
    // nothing asserted the contract the module's own docstring states.
    process.env["NATIONAL_JURISDICTION_ID"] = "j-027";
    process.env["FISCALIZACION_CATEGORY_ID"] = "c-diputados";
    process.env["FISCALIZACION_ELECTION_ID"] = "2025-legislativas-nacional";
    repositoryRows = [{ ...FISCALIZACION_ROW, listId: "110", votes: 60 }];
    sourceRefs = [
      {
        archiveEntryId: "fiscalizacion/2025-lla",
				sha256:
					"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
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
    process.env["FISCALIZACION_ELECTION_ID"] = "2025-legislativas-nacional";
    repositoryRows = [
      { ...FISCALIZACION_ROW, listId: "110", votes: 60 },
			{
				...OFFICIAL_ROW,
				listId: "110",
				votes: 25,
				archiveEntryId: "national/2023-generales",
			},
			{
				...OFFICIAL_ROW,
				listId: "999",
				votes: 75,
				archiveEntryId: "national/2023-generales",
			},
    ];
    sourceRefs = [
      {
        archiveEntryId: "national/2023-generales",
				sha256:
					"aaaabbbbccccdddd0000111122223333444455556666777788889999aaaabbbb",
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

    expect(markup).toContain("comparación entre elecciones");
    // Inside the OFFICIAL figure's own section. Asserting the url appears
    // anywhere in the markup passed while the official ZIP's digest rendered
    // under the unofficial figure.
		const officialSection = markup.slice(
			markup.indexOf('aria-label="cifra oficial"'),
		);
		expect(officialSection).toContain(
			"https://example.test/2023-generales.zip",
		);
		const fiscalizacionBlock = markup.slice(
			0,
			markup.indexOf("comparación entre elecciones"),
		);
		expect(fiscalizacionBlock).not.toContain(
			"https://example.test/2023-generales.zip",
		);
  });

		it.each(["forward", "reverse"] as const)(
			"test_the_page_refuses_conflicting_party_names_before_comparison_success_in_%s_order",
			async (order) => {
				process.env["NATIONAL_JURISDICTION_ID"] = "j-027";
				process.env["FISCALIZACION_CATEGORY_ID"] = "c-diputados";
				process.env["FISCALIZACION_ELECTION_ID"] = "2025-legislativas-nacional";
				partyNameOverrides = new Map([
					[
						"110",
						{
							canonicalPartyId: "canon-110",
							displayName: "LA LIBERTAD AVANZA",
						},
					],
					[
						"20135",
						{
							canonicalPartyId: "canon-110",
							displayName: "ALIANZA LA LIBERTAD AVANZA",
						},
					],
				]);
				const conflictRows: ResultRow[] = [
					{
						...FISCALIZACION_ROW,
						partyName: "LA LIBERTAD AVANZA",
						canonicalPartyId: "canon-110",
						listId: "110",
						votes: 60,
					},
					{
						...FISCALIZACION_ROW,
						partyName: "ALIANZA LA LIBERTAD AVANZA",
						canonicalPartyId: "canon-110",
						listId: "20135",
						votes: 40,
					},
				];
				repositoryRows =
					order === "forward" ? conflictRows : [...conflictRows].reverse();

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

				expect(markup).toContain(
					"los identificadores canónicos de partido tienen nombres no vacíos contradictorios (canon-110: ALIANZA LA LIBERTAD AVANZA | LA LIBERTAD AVANZA)",
				);
				expect(markup).not.toContain("comparación entre elecciones");
				expect(markup).not.toContain("ninguna fila se resolvió a un partido curado");
			},
		);

      it("test_the_page_reports_a_tie_as_a_tie", async () => {
        // Driven through the PAGE. `topParty` unit tests are not evidence that
        // either branch is reached, and both exist precisely to stop the page
        // saying "no row resolved to a curated party" about rows that all did.
        process.env["NATIONAL_JURISDICTION_ID"] = "j-027";
        process.env["FISCALIZACION_CATEGORY_ID"] = "c-diputados";
        process.env["FISCALIZACION_ELECTION_ID"] = "2025-legislativas-nacional";
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

    expect(markup).toContain("empatan en el primer lugar");
    expect(markup).not.toContain("ninguna fila se resolvió a un partido curado");
    // ONCE. Two emitters — the renderer's note and the page's
    // `comparisonUnavailable` — both fired, and `toContain` passes on one copy
    // or ten, so it could not catch the duplication.
    expect(markup.match(/empatan en el primer lugar/g) ?? []).toHaveLength(1);
  });

  it("test_the_page_reports_mixed_granularity_as_such", async () => {
    process.env["NATIONAL_JURISDICTION_ID"] = "j-027";
    process.env["FISCALIZACION_CATEGORY_ID"] = "c-diputados";
    process.env["FISCALIZACION_ELECTION_ID"] = "2025-legislativas-nacional";
    repositoryRows = [
      { ...FISCALIZACION_ROW, listId: "110", granularity: "mesa", votes: 60 },
			{
				...FISCALIZACION_ROW,
				listId: "110",
				granularity: "seccion",
				votes: 40,
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

    expect(markup).toContain("duplicaría el conteo");
    expect(markup).not.toContain("ninguna fila se resolvió a un partido curado");
  });

  it("test_an_unorderable_level_reports_how_many_rows_carry_it", async () => {
    // A LIST OF NAMES was rendered as a row count, so many rows on one
    // unknown level read as "1 row(s)". The fixture needs at least two rows
    // sharing a level, or the wrong count and the right one agree.
    process.env["NATIONAL_JURISDICTION_ID"] = "j-027";
    process.env["FISCALIZACION_CATEGORY_ID"] = "c-diputados";
    process.env["FISCALIZACION_ELECTION_ID"] = "2025-legislativas-nacional";
    repositoryRows = [
			{
				...FISCALIZACION_ROW,
				listId: "110",
				granularity: "subcircuito" as never,
				votes: 30,
			},
			{
				...FISCALIZACION_ROW,
				listId: "110",
				granularity: "subcircuito" as never,
				votes: 20,
			},
			{
				...FISCALIZACION_ROW,
				listId: "999",
				granularity: "subcircuito" as never,
				votes: 50,
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

    expect(markup).toContain("3 fila(s) tienen un nivel de granularidad");
    // ROWS, not summed votes: the level cannot be ordered, so whether its rows
    // contain one another is unknown and adding them may count votes twice.
    expect(markup).toContain("subcircuito: 3 filas");
    expect(markup).not.toContain("subcircuito: 3 filas, 100 votos");
    // And NO badge to point at: an unorderable level makes the set unsummable,
    // so the level "above" the alert was withheld. The copy used to name it.
    expect(markup).not.toContain('aria-label="granularidad:');
  });

  it("test_the_page_refuses_a_category_the_party_mapping_does_not_describe", async () => {
    // The third axis. `FISCALIZACION_PARTY_CONTEXT` names DIPUTADO NACIONAL,
    // so another category resolves party names through the wrong mapping --
    // and this was the one axis with no driver.
    process.env["NATIONAL_JURISDICTION_ID"] = "j-027";
    process.env["FISCALIZACION_CATEGORY_ID"] = "c-diputados";
    process.env["FISCALIZACION_ELECTION_ID"] = "2025-legislativas-nacional";

    const markup = renderToStaticMarkup(
      (await FiscalizacionPage({
        searchParams: Promise.resolve({
          electionId: "2025-legislativas-nacional",
          jurisdictionId: "j-027",
          categoryId: "c-senadores",
        }),
      })) as ReactElement,
    );

    expect(markup).toContain("Se rechazó");
    expect(markup).toContain("DIPUTADO NACIONAL");
  });

  it("test_an_apparent_tie_over_unsummable_rows_reports_the_refusal", async () => {
    // Both conditions at once: two parties level at 40, on levels that cannot
    // be summed. Calling that a tie states a measured fact that is really an
    // artifact of the arithmetic the refusal exists to prevent.
    process.env["NATIONAL_JURISDICTION_ID"] = "j-027";
    process.env["FISCALIZACION_CATEGORY_ID"] = "c-diputados";
    process.env["FISCALIZACION_ELECTION_ID"] = "2025-legislativas-nacional";
    repositoryRows = [
      { ...FISCALIZACION_ROW, listId: "110", granularity: "mesa", votes: 40 },
			{
				...FISCALIZACION_ROW,
				listId: "999",
				granularity: "seccion",
				votes: 40,
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

    expect(markup).toContain("duplicaría el conteo");
    expect(markup).not.toContain("empatan en el primer lugar");
  });

  it("test_an_archive_entry_with_no_source_record_is_announced", async () => {
    // `fetchSourceRefs` can return fewer refs than asked for. The figure used
    // to render anyway, with no provenance and nothing saying so.
    process.env["NATIONAL_JURISDICTION_ID"] = "j-027";
    process.env["FISCALIZACION_CATEGORY_ID"] = "c-diputados";
    process.env["FISCALIZACION_ELECTION_ID"] = "2025-legislativas-nacional";
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

    expect(markup).toContain("no tienen registro de fuente");
    expect(markup).toContain("fiscalizacion/2025-lla");
  });

  it("test_an_official_figure_without_an_archived_source_says_so", async () => {
    // The badge's own alert. `officialSources` empty used to render nothing,
    // so a percentage appeared with no provenance and no statement of it.
    process.env["NATIONAL_JURISDICTION_ID"] = "j-027";
    process.env["FISCALIZACION_CATEGORY_ID"] = "c-diputados";
    process.env["FISCALIZACION_ELECTION_ID"] = "2025-legislativas-nacional";
    repositoryRows = [
      { ...FISCALIZACION_ROW, listId: "110", votes: 60 },
			{
				...OFFICIAL_ROW,
				listId: "110",
				votes: 25,
				archiveEntryId: "national/2023-generales",
			},
			{
				...OFFICIAL_ROW,
				listId: "999",
				votes: 75,
				archiveEntryId: "national/2023-generales",
			},
    ];
    // Only the fiscalización entry has a source record; the official one has none.
    sourceRefs = [
      {
        archiveEntryId: "fiscalizacion/2025-lla",
				sha256:
					"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
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

    expect(markup).toContain("No hay una fuente archivada para esta cifra");
    // Attributed to the OFFICIAL side, never to the fiscalización one. Both
    // alerts share the phrase "have no source record", so the assertion names
    // the SUBJECT each one claims — a bare phrase match would pass on either.
		expect(markup).toContain(
			"respaldan la cifra comparativa oficial no tienen registro de fuente",
		);
    expect(markup).not.toContain("respaldan estas cifras no tienen registro de fuente");
  });

  it("test_a_refused_query_is_reported_as_such_not_as_a_mapping_problem", async () => {
    // RLS denial or a failed query. Every page test so far mocked a repository
    // that always answers `ok`, so both this branch and the "no rows were
    // read" comparison branch were green whether they worked or not.
    process.env["NATIONAL_JURISDICTION_ID"] = "j-027";
    process.env["FISCALIZACION_CATEGORY_ID"] = "c-diputados";
    process.env["FISCALIZACION_ELECTION_ID"] = "2025-legislativas-nacional";
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
    expect(markup).toContain("no se leyeron filas");
    expect(markup).not.toContain("ninguna fila se resolvió a un partido curado");
  });

  it("test_a_comparison_against_the_same_election_is_refused", () => {
    process.env["NATIONAL_JURISDICTION_ID"] = "j-027";
    process.env["FISCALIZACION_CATEGORY_ID"] = "c-diputados";
    process.env["FISCALIZACION_ELECTION_ID"] = "2025-legislativas-nacional";

		const result = comparisonFromParams(
			{
      compareElectionId: "2025-legislativas-nacional",
      compareElectionLabel: "26 Oct 2025 national legislative",
      compareYear: "2025",
      compareCategory: "DIPUTADO NACIONAL",
      compareJurisdiction: "national",
      compareJurisdictionId: "j-027",
      compareCategoryId: "c-diputados",
			},
			2025,
		);

    // One election drawn as two, labelled a trend over time.
    expect(result.status).toBe("refused");
    if (result.status !== "refused") throw new Error("expected refused");
    expect(result.reason).toContain("elección DISTINTA");
  });

  it("test_a_repeated_query_param_is_reported_not_treated_as_absent", async () => {
    // Next.js hands `string[]` for a repeated param. `stringParam` returned
    // `undefined` for those, so a SUPPLIED value vanished: the page then said
    // "Provide electionId" about a request that sent it twice.
    process.env["NATIONAL_JURISDICTION_ID"] = "j-027";
    process.env["FISCALIZACION_CATEGORY_ID"] = "c-diputados";
    process.env["FISCALIZACION_ELECTION_ID"] = "2025-legislativas-nacional";

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
    expect(markup).toContain("más de una vez");
  });

  it("test_zero_rows_is_not_reported_as_a_mapping_failure", async () => {
    // Zero rows resolved to nothing because there were zero rows, not because
    // the crosswalk failed. The catch-all sent the operator after a
    // `party_mapping` problem that does not exist.
    process.env["NATIONAL_JURISDICTION_ID"] = "j-027";
    process.env["FISCALIZACION_CATEGORY_ID"] = "c-diputados";
    process.env["FISCALIZACION_ELECTION_ID"] = "2025-legislativas-nacional";
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

    expect(markup).toContain("no se encontraron filas de fiscalización");
    expect(markup).not.toContain("ninguna fila se resolvió a un partido curado");
  });

      it("test_the_page_offers_source_backed_coverage_selectors_from_a_cold_start", async () => {
        coverageRpcResults = {
          results_exploration_facets: {
            status: "ok",
            elections: [
              {
                id: "e-2025",
                year: 2025,
                round: "legislativas",
                label: "2025 legislativas",
              },
            ],
            categories: [],
            distritos: [
              { code: "02", name: null, name_status: "missing", name_variant_count: 0 },
            ],
            secciones: [
              { code: "027", name: null, name_status: "conflict", name_variant_count: 2 },
            ],
            circuitos: [],
            establecimientos: [],
            mesas: [],
            available_levels: [],
          },
        };
        const markup = renderToStaticMarkup(
          (await FiscalizacionPage({
            searchParams: Promise.resolve({}),
          })) as ReactElement,
        );

        expect(markup).toContain('<main class="page-shell">');
        expect(markup).not.toContain('id="main-content"');
        expect(markup).toContain("Cobertura de fiscalización");
        expect(markup).toContain("Elegir una elección");
        expect(markup).toContain('<option value="02">02 — nombre no disponible</option>');
        expect(markup).toContain('<option value="027">027 — nombres contradictorios (2 variantes)</option>');
        expect(markup).not.toContain("Proporcione los parámetros de consulta <code>electionId</code>");
      });

      it("renders the native coverage validation matrix and dependent prefixes", async () => {
        coverageRpcResults = {
          results_exploration_facets: {
            status: "ok",
            elections: [{ id: "e-2025", year: 2025, round: "legislativas", label: "2025 legislativas" }],
            categories: [{ id: "c-diputados", name: "DIPUTADO NACIONAL" }],
            distritos: [{ code: "02", name: "Buenos Aires", name_status: "present", name_variant_count: 1 }],
            secciones: [{ code: "027", name: "Coronel Rosales", name_status: "present", name_variant_count: 1 }],
            circuitos: [],
            establecimientos: [],
            mesas: [],
            available_levels: [],
          },
        };
        const cases = [
          { label: "cold", params: {}, enabled: ["electionId"] },
          {
            label: "election",
            params: { electionId: "e-2025" },
            enabled: ["electionId", "categoryId"],
          },
          {
            label: "category",
            params: { electionId: "e-2025", categoryId: "c-diputados" },
            enabled: ["electionId", "categoryId", "distritoCode"],
          },
          {
            label: "district",
            params: { electionId: "e-2025", categoryId: "c-diputados", distritoCode: "02" },
            enabled: [...COVERAGE_CONTROL_NAMES],
          },
        ] satisfies Array<{
          label: string;
          params: Record<string, string>;
          enabled: CoverageControlName[];
        }>;

        for (const testCase of cases) {
          const markup = renderToStaticMarkup(
            (await FiscalizacionPage({ searchParams: Promise.resolve(testCase.params) })) as ReactElement,
          );
          for (const name of COVERAGE_CONTROL_NAMES) {
            expectCoverageControlState(markup, name, {
              required: true,
              disabled: !new Set<string>(testCase.enabled).has(name),
            });
          }
          expect(markup).toContain("Actualizar opciones");
          expect(markup).toMatch(/<button[^>]*formNoValidate=""[^>]*>Actualizar opciones<\/button>/);
          expect(markup).toContain(">Mostrar cobertura</button>");
        }
      });

      it("keeps coverage pending and the section natively required until selected", async () => {
        coverageRpcResults = {
          results_exploration_facets: {
            status: "ok",
            elections: [{ id: "e-2025", year: 2025, round: "legislativas", label: "2025 legislativas" }],
            categories: [{ id: "c-diputados", name: "DIPUTADO NACIONAL" }],
            distritos: [{ code: "02", name: "Buenos Aires", name_status: "present", name_variant_count: 1 }],
            secciones: [{ code: "027", name: "Coronel Rosales", name_status: "present", name_variant_count: 1 }],
            circuitos: [], establecimientos: [], mesas: [], available_levels: [],
          },
        };

        const markup = renderToStaticMarkup(
          (await FiscalizacionPage({ searchParams: Promise.resolve({
            electionId: "e-2025",
            categoryId: "c-diputados",
            distritoCode: "02",
          }) })) as ReactElement,
        );

        expectCoverageControlState(markup, "seccionCode", { required: true, disabled: false });
        expect(markup).toContain("Elija la elección, la categoría, el distrito y la sección disponibles");
        expect(markup).not.toContain("Auditoría de la fuente: fiscalización");
      });

      it("keeps repeated coverage parameters on the existing server refusal path", async () => {
        const markup = renderToStaticMarkup(
          (await FiscalizacionPage({ searchParams: Promise.resolve({
            electionId: ["e-2025", "e-2023"],
          }) })) as ReactElement,
        );

        expect(markup).toContain("parámetros de consulta repetidos");
        expect(markup).toContain("electionId");
        expect(markup).not.toContain("Actualizar opciones");
      });

	function auditableCoveragePayload() {
		return {
			status: "ok",
			source_kind: "fiscalizacion",
			is_random_sample: false,
			election_year: 2025,
			election_round: "legislativas",
			distrito_code: "02",
			seccion_code: "027",
			mesas_coverage: {
				observed_units: 1,
				denominator_units: 2,
				is_random_sample: false,
			},
			mesas: [
				{
					code: 1,
					circuito_code: "00001",
					establecimiento_code: "E1",
					establecimiento_name: "Fixture school",
					covered: true,
				},
				{
					code: 2,
					circuito_code: "00001",
					establecimiento_code: null,
					establecimiento_name: null,
					covered: false,
				},
			],
			escuelas: {
				status: "available",
				exclusions: [
					{
						reason: "official_rows_without_establecimiento_code",
						rows: 1,
						votes: 100,
					},
				],
				items: [
					{
						circuito_code: "00001",
						code: "E1",
						name: "Fixture school",
						observed_units: 1,
						denominator_units: 1,
						is_random_sample: false,
						official_archive_entry_ids: ["national/2025-legislativas"],
					},
				],
			},
			source_audit: [{ kind: "fiscalizacion", rows: 1, votes: 999, mesas: 1 }],
			denominator_audit: [{ kind: "official", rows: 2, votes: 300, mesas: 2 }],
			exclusions: [
				{
					reason: "fiscalizacion_rows_without_official_mesa_mapping",
					rows: 1,
					votes: 50,
				},
			],
			provenance: {
				official_archive_entry_ids: ["national/2025-legislativas"],
				fiscalizacion_archive_entry_ids: ["fiscalizacion/runtime"],
			},
		};
	}

	async function renderAuditableCoverage(
		payload = auditableCoveragePayload(),
	) {
		coverageRpcResults = {
			results_exploration_facets: {
				status: "ok",
				elections: [],
				categories: [],
				distritos: [],
				secciones: [],
				circuitos: [],
				establecimientos: [],
				mesas: [],
				available_levels: [],
			},
			results_exploration_coverage: payload,
		};
		return renderToStaticMarkup(
			(await FiscalizacionPage({
				searchParams: Promise.resolve({
					electionId: "20000000-0000-0000-0000-000000000001",
					categoryId: "20000000-0000-0000-0000-000000000003",
					distritoCode: "02",
					seccionCode: "027",
				}),
			})) as ReactElement,
		);
	}

	function renderedCoverageResult(): CoverageOk {
		return {
			status: "ok",
			sourceKind: "fiscalizacion",
			isRandomSample: false,
			electionYear: 2025,
			electionRound: "legislativas",
			distritoCode: "02",
			seccionCode: "027",
			mesasCoverage: {
				observedUnits: 1,
				denominatorUnits: 2,
				isRandomSample: false,
			},
			mesas: [
				{
					code: 1,
					circuitoCode: "00001",
					establecimientoCode: "E1",
					establecimientoName: "Guard fixture school",
					covered: true,
					officialResultHref: "/drilldown?mesaCode=1",
				},
				{
					code: 2,
					circuitoCode: "00001",
					establecimientoCode: "E1",
					establecimientoName: "Guard fixture school",
					covered: false,
					officialResultHref: "/drilldown?mesaCode=2",
				},
			],
			escuelas: {
				status: "available",
				exclusions: [],
				items: [
					{
						circuitoCode: "00001",
						code: "E1",
						name: "Guard fixture school",
						observedUnits: 1,
						denominatorUnits: 2,
						isRandomSample: false,
						officialArchiveEntryIds: ["national/2025-legislativas"],
						officialResultHref:
							"/drilldown?level=establecimiento&establecimientoCode=E1",
					},
				],
			},
			sourceAudit: [{ kind: "fiscalizacion", rows: 1, votes: 90, mesas: 1 }],
			denominatorAudit: [{ kind: "official", rows: 2, votes: 300, mesas: 2 }],
			exclusions: [],
			provenance: {
				officialArchiveEntryIds: ["national/2025-legislativas"],
				fiscalizacionArchiveEntryIds: ["fiscalizacion/runtime"],
			},
		};
	}

	async function renderInjectedCoverage(result: unknown): Promise<string> {
		coverageRpcResults = {
			results_exploration_facets: {
				status: "ok",
				elections: [],
				categories: [],
				distritos: [],
				secciones: [],
				circuitos: [],
				establecimientos: [],
				mesas: [],
				available_levels: [],
			},
		};
		sourceRefs = [
			{
				archiveEntryId: "national/2025-legislativas",
				sha256: "a".repeat(64),
				url: "https://example.test/official-guard-source",
				fetchedAt: "2026-08-10T00:00:00Z",
			},
			{
				archiveEntryId: "fiscalizacion/runtime",
				sha256: "b".repeat(64),
				url: "https://example.test/fiscalizacion-guard-source",
				fetchedAt: "2026-08-10T00:00:00Z",
			},
		];

		const page = await renderCoverageExplorer(
			{
				electionId: "20000000-0000-0000-0000-000000000001",
				categoryId: "20000000-0000-0000-0000-000000000003",
				distritoCode: "02",
				seccionCode: "027",
			},
			// This is intentionally the one test-only boundary that widens a payload.
			// It simulates a parser/repository regression so the rendered page must
			// independently prove the source-isolation invariants before rendering.
			async () => result as CoverageResult,
		);
		return renderToStaticMarkup(page as ReactElement);
	}

	const renderedGuardViolations: {
		name: string;
		widen: (valid: CoverageOk) => unknown;
	}[] = [
		{
			name: "success envelope source kind is official",
			widen: (valid) => ({ ...valid, sourceKind: "official" }),
		},
		{
			name: "numerator audit kind is official",
			widen: (valid) => ({
				...valid,
				sourceAudit: [{ ...valid.sourceAudit[0], kind: "official" }],
			}),
		},
		{
			name: "denominator audit kind is fiscalizacion",
			widen: (valid) => ({
				...valid,
				denominatorAudit: [
					{ ...valid.denominatorAudit[0], kind: "fiscalizacion" },
				],
			}),
		},
		{
			name: "envelope claims a random sample",
			widen: (valid) => ({ ...valid, isRandomSample: true }),
		},
		{
			name: "mesa coverage claims a random sample",
			widen: (valid) => ({
				...valid,
				mesasCoverage: { ...valid.mesasCoverage, isRandomSample: true },
			}),
		},
		{
			name: "school coverage claims a random sample",
			widen: (valid) => ({
				...valid,
				escuelas: {
					...valid.escuelas,
					items: valid.escuelas.items.map((school) => ({
						...school,
						isRandomSample: true,
					})),
				},
			}),
		},
		{
			name: "numerator audit has more than one entry",
			widen: (valid) => ({
				...valid,
				sourceAudit: [...valid.sourceAudit, ...valid.sourceAudit],
			}),
		},
		{
			name: "numerator audit is empty",
			widen: (valid) => ({ ...valid, sourceAudit: [] }),
		},
		{
			name: "denominator audit has more than one entry",
			widen: (valid) => ({
				...valid,
				denominatorAudit: [
					...valid.denominatorAudit,
					...valid.denominatorAudit,
				],
			}),
		},
		{
			name: "denominator audit is empty",
			widen: (valid) => ({ ...valid, denominatorAudit: [] }),
		},
		{
			name: "mesa payload omits a denominator unit",
			widen: (valid) => ({ ...valid, mesas: valid.mesas.slice(0, 1) }),
		},
		{
			name: "covered mesa count exceeds observed units",
			widen: (valid) => ({
				...valid,
				mesas: valid.mesas.map((mesa) => ({ ...mesa, covered: true })),
			}),
		},
		{
			name: "observed units exceed the denominator",
			widen: (valid) => ({
				...valid,
				mesasCoverage: { ...valid.mesasCoverage, observedUnits: 3 },
			}),
		},
	];

	it.each(renderedGuardViolations)(
		"refuses before success rendering when $name",
		async ({ widen }) => {
			const markup = await renderInjectedCoverage(widen(renderedCoverageResult()));

			expect(markup).toContain(
				"Se rechazó la solicitud: la evidencia de cobertura no superó la verificación de aislamiento de fuentes de la página.",
			);
			expect(markup).not.toContain("1 mesas cubiertas de 2 mesas oficiales");
			expect(markup).not.toContain("Auditoría de la fuente:");
			expect(markup).not.toContain("Auditoría del denominador:");
			expect(markup).not.toContain("Guard fixture school");
			expect(markup).not.toContain("Ver votos oficiales");
			expect(markup).not.toContain("no es una muestra aleatoria");
			expect(markup).not.toContain("official-guard-source");
			expect(markup).not.toContain("fiscalizacion-guard-source");
			expect(sourceRefReadCount).toBe(0);
		},
	);

      it("retains the form and exclusion breakdowns when the rendered guard refuses", async () => {
        const valid = renderedCoverageResult();
        valid.escuelas.exclusions = [
          { reason: "official_rows_without_establecimiento_code", rows: 3, votes: 44 },
        ];
        valid.exclusions = [
          { reason: "fiscalizacion_rows_without_official_mesa_mapping", rows: 2, votes: 17 },
        ];
        const markup = await renderInjectedCoverage({ ...valid, sourceKind: "official" });

        expect(markup).toContain('<form action="/fiscalizacion" method="get">');
        expect(markup).toContain(
          "Se rechazó la solicitud: la evidencia de cobertura no superó la verificación de aislamiento de fuentes de la página.",
        );
        expect(markup).toContain(
          "filas oficiales sin código de establecimiento: 3 filas, 44 votos",
        );
        expect(markup).toContain(
          "filas de fiscalización sin correspondencia con una mesa oficial: 2 filas, 17 votos",
        );
        expect(markup).not.toContain("1 mesas cubiertas de 2 mesas oficiales");
        expect(markup).not.toContain("Auditoría de la fuente:");
        expect(markup).not.toContain("Auditoría del denominador:");
        expect(markup).not.toContain("Guard fixture school");
        expect(markup).not.toContain("Ver votos oficiales");
        expect(markup).not.toContain("official-guard-source");
        expect(sourceRefReadCount).toBe(0);
      });

      it("renders valid injected coverage after the rendered-page guard", async () => {
        const markup = await renderInjectedCoverage(renderedCoverageResult());

        expect(markup).toContain("1 mesas cubiertas de 2 mesas oficiales");
        expect(markup).toContain("Guard fixture school");
        expect(markup).toContain("Auditoría de la fuente: fiscalización");
        expect(markup).toContain("official-guard-source");
        expect(sourceRefReadCount).toBe(1);
      });

      it("deduplicates shared official and fiscalizacion provenance before fetching", async () => {
        sourceRefs = [
          {
            archiveEntryId: "shared/archive",
            sha256: "c".repeat(64),
            url: "https://example.test/shared-source",
            fetchedAt: "2026-08-10T00:00:00Z",
          },
        ];
        const payload = auditableCoveragePayload();
        payload.provenance = {
          official_archive_entry_ids: ["shared/archive"],
          fiscalizacion_archive_entry_ids: ["shared/archive"],
        };

        const markup = await renderAuditableCoverage(payload);

        expect(markup).toContain("1 mesas cubiertas de 2 mesas oficiales");
        expect(markup).toContain("https://example.test/shared-source");
        expect(markup).not.toContain("la procedencia de la cobertura está incompleta");
        expect(sourceRefReadCount).toBe(1);
        expect(sourceRefRequestedIds).toEqual(["shared/archive"]);
      });

    it("keeps the mesa evidence table labelled, scoped, and focusable", async () => {
		const markup = await renderInjectedCoverage(renderedCoverageResult());

		expect(markup).toContain(
			'<div class="table-scroll" role="region" aria-label="Presencia de fiscalización por mesa oficial" tabindex="0">',
		);
		expect(markup).toContain('<table class="data-table">');
		expect(markup).toContain(
			"<caption>Presencia de fiscalización por mesa oficial</caption>",
		);
		expect(markup.match(/scope="col"/g) ?? []).toHaveLength(4);
		expect(markup).toContain('class="evidence-text">Guard fixture school</td>');
	});

	it("renders mesas with the same circuit and code at distinct schools without duplicate keys", async () => {
		sourceRefs = [
			{
				archiveEntryId: "national/2025-legislativas",
				sha256: "a".repeat(64),
				url: "https://example.test/official",
				fetchedAt: "2026-08-10T00:00:00Z",
			},
			{
				archiveEntryId: "fiscalizacion/runtime",
				sha256: "b".repeat(64),
				url: "https://example.test/internal",
				fetchedAt: "2026-08-10T00:00:00Z",
			},
		];
		const payload = auditableCoveragePayload();
		payload.mesas = [
			{
				code: 1,
				circuito_code: "00001",
				establecimiento_code: "E1",
				establecimiento_name: "North school",
				covered: true,
			},
			{
				code: 1,
				circuito_code: "00001",
				establecimiento_code: "E2",
				establecimiento_name: "South school",
				covered: false,
			},
		];
		payload.escuelas = {
			status: "available",
			exclusions: [],
			items: [
				{
					circuito_code: "00001",
					code: "E1",
					name: "North school",
					observed_units: 1,
					denominator_units: 1,
					is_random_sample: false,
					official_archive_entry_ids: ["national/2025-legislativas"],
				},
				{
					circuito_code: "00001",
					code: "E2",
					name: "South school",
					observed_units: 0,
					denominator_units: 1,
					is_random_sample: false,
					official_archive_entry_ids: ["national/2025-legislativas"],
				},
			],
		};

		coverageRpcResults = {
			results_exploration_facets: {
				status: "ok",
				elections: [],
				categories: [],
				distritos: [],
				secciones: [],
				circuitos: [],
				establecimientos: [],
				mesas: [],
				available_levels: [],
			},
			results_exploration_coverage: payload,
		};
		const page = (await FiscalizacionPage({
			searchParams: Promise.resolve({
				electionId: "20000000-0000-0000-0000-000000000001",
				categoryId: "20000000-0000-0000-0000-000000000003",
				distritoCode: "02",
				seccionCode: "027",
			}),
		})) as ReactElement;
		const rowKeys: string[] = [];
		const collectRowKeys = (node: ReactNode): void => {
			if (Array.isArray(node)) {
				for (const child of node) collectRowKeys(child);
				return;
			}
			if (!isValidElement<{ children?: ReactNode }>(node)) return;
			if (node.type === "tr" && node.key !== null) rowKeys.push(String(node.key));
			collectRowKeys(node.props.children);
		};
		collectRowKeys(page);

		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => undefined);
		let markup: string;
		let errors: string;
		try {
			markup = renderToStaticMarkup(page);
			errors = consoleError.mock.calls.flat().map(String).join("\n");
		} finally {
			consoleError.mockRestore();
		}

		expect(markup).toContain("North school");
		expect(markup).toContain("South school");
		expect(rowKeys).toHaveLength(2);
		expect(new Set(rowKeys).size).toBe(rowKeys.length);
		expect(errors).not.toContain("Encountered two children with the same key");
	});

	it("test_incomplete_provenance_refusal_retains_all_exclusion_breakdowns", async () => {
		sourceRefs = [
			{
				archiveEntryId: "national/2025-legislativas",
				sha256: "a".repeat(64),
				url: "https://example.test/official",
				fetchedAt: "2026-08-10T00:00:00Z",
			},
		];
		const markup = await renderAuditableCoverage();

		expect(markup).toContain("la procedencia de la cobertura está incompleta");
		expect(markup).toContain(
			"filas oficiales sin código de establecimiento: 1 fila, 100 votos",
		);
		expect(markup).toContain(
			"filas de fiscalización sin correspondencia con una mesa oficial: 1 fila, 50 votos",
		);
	});

	it("test_source_reference_failure_retains_all_exclusion_breakdowns", async () => {
		refuseSourceReadWith = "source reference read failed";
		const markup = await renderAuditableCoverage();

		expect(markup).toContain("Se rechazó la solicitud: source reference read failed");
		expect(markup).toContain(
			"filas oficiales sin código de establecimiento: 1 fila, 100 votos",
		);
		expect(markup).toContain(
			"filas de fiscalización sin correspondencia con una mesa oficial: 1 fila, 50 votos",
		);
	});

	it("renders source_unavailable school exclusion evidence", async () => {
		sourceRefs = [
			{
				archiveEntryId: "national/2025-legislativas",
				sha256: "a".repeat(64),
				url: "https://example.test/official",
				fetchedAt: "2026-08-10T00:00:00Z",
			},
			{
				archiveEntryId: "fiscalizacion/runtime",
				sha256: "b".repeat(64),
				url: "https://example.test/internal",
				fetchedAt: "2026-08-10T00:00:00Z",
			},
		];
		const payload = auditableCoveragePayload();
		payload.mesas[0]!.circuito_code = null as never;
		payload.mesas[0]!.establecimiento_code = null as never;
		payload.mesas[1]!.establecimiento_code = null as never;
		payload.escuelas = {
			status: "source_unavailable",
			reason: "the registered source publishes no complete establecimiento data",
			exclusions: [
				{
					reason: "official_rows_without_circuito_and_establecimiento_code",
					rows: 1,
					votes: 100,
				},
				{
					reason: "official_rows_without_establecimiento_code",
					rows: 1,
					votes: 200,
				},
			],
			items: [],
		} as never;

		const markup = await renderAuditableCoverage(payload);

		expect(markup).toContain(
			"the registered source publishes no complete establecimiento data",
		);
		expect(markup).toContain("Exclusiones de establecimientos");
		expect(markup).toContain(
			"filas oficiales sin código de circuito ni de establecimiento: 1 fila, 100 votos",
		);
		expect(markup).toContain(
			"filas oficiales sin código de establecimiento: 1 fila, 200 votos",
		);
	});

	it("renders section-only denominator unavailability as localized evidence, not a rejected request", async () => {
		coverageRpcResults = {
			results_exploration_facets: {
				status: "ok",
				elections: [],
				categories: [],
				distritos: [],
				secciones: [],
				circuitos: [],
				establecimientos: [],
				mesas: [],
				available_levels: [],
			},
			results_exploration_coverage: {
				status: "denominator_unavailable",
				reason: "no official mesa rows exist for the selected scope",
				counts: { official_mesa_rows: 0, fiscalizacion_rows: 0 },
				exclusions: [
					{
						reason: "official_rows_without_mesa_granularity",
						rows: 8,
						votes: 32_291,
					},
				],
			},
		};

		const markup = renderToStaticMarkup(
			(await FiscalizacionPage({
				searchParams: Promise.resolve({
					electionId: "20000000-0000-0000-0000-000000000001",
					categoryId: "20000000-0000-0000-0000-000000000003",
					distritoCode: "02",
					seccionCode: "027",
				}),
			})) as ReactElement,
		);

		expect(markup).toContain("Cobertura no disponible para este alcance");
		expect(markup).toContain(
			"La fuente oficial seleccionada publica resultados únicamente a nivel sección, no por mesa",
		);
		expect(markup).toContain(
			"No se estimó la cobertura porque no existe un denominador oficial por mesa",
		);
		expect(markup).toContain(
			"Las cifras oficiales y de fiscalización permanecen separadas",
		);
		expect(markup).toContain(
			"filas oficiales publicadas a nivel sección, sin detalle por mesa: 8 filas, 32.291 votos",
		);
		expect(markup).toContain('role="status"');
		expect(markup).not.toContain("Se rechazó la solicitud");
		expect(markup).not.toContain(
			"no official mesa rows exist for the selected scope",
		);
		expect(markup).not.toContain("official_rows_without_mesa_granularity");
	});

	it("test_the_production_entry_renders_every_refusal_exclusion", async () => {
		coverageRpcResults = {
			results_exploration_facets: {
				status: "ok",
				elections: [],
				categories: [],
				distritos: [],
				secciones: [],
				circuitos: [],
				establecimientos: [],
				mesas: [],
				available_levels: [],
			},
			results_exploration_coverage: {
				status: "denominator_unavailable",
				reason: "no official mesa rows exist for the selected scope",
				counts: { official_mesa_rows: 0, fiscalizacion_rows: 3 },
				exclusions: [
					{
						reason: "official_rows_without_mesa_identity",
						rows: 2,
						votes: 300,
					},
					{
						reason: "fiscalizacion_rows_without_official_mesa_mapping",
						rows: 3,
						votes: 999,
					},
				],
			},
		};
		const markup = renderToStaticMarkup(
			(await FiscalizacionPage({
				searchParams: Promise.resolve({
					electionId: "20000000-0000-0000-0000-000000000001",
					categoryId: "20000000-0000-0000-0000-000000000003",
					distritoCode: "02",
					seccionCode: "027",
				}),
			})) as ReactElement,
		);
		expect(markup).toContain(
			"filas oficiales sin identidad completa de mesa: 2 filas, 300 votos",
		);
		expect(markup).toContain(
			"filas de fiscalización sin correspondencia con una mesa oficial: 3 filas, 999 votos",
		);
		expect(markup).not.toContain("official_rows_without_mesa_identity");
		expect(markup).not.toContain(
			"fiscalizacion_rows_without_official_mesa_mapping",
		);
	});

  it("test_the_production_entry_renders_coverage_and_official_result_links", async () => {
    sourceRefs = [
			{
				archiveEntryId: "national/2025-legislativas",
				sha256: "a".repeat(64),
				url: "https://example.test/official",
				fetchedAt: "2026-08-10T00:00:00Z",
			},
			{
				archiveEntryId: "fiscalizacion/runtime",
				sha256: "b".repeat(64),
				url: "https://example.test/internal",
				fetchedAt: "2026-08-10T00:00:00Z",
			},
    ];
    coverageRpcResults = {
			results_exploration_facets: {
				status: "ok",
				elections: [],
				categories: [],
				distritos: [],
				secciones: [],
				circuitos: [],
				establecimientos: [],
				mesas: [],
				available_levels: [],
			},
      results_exploration_coverage: {
				status: "ok",
				source_kind: "fiscalizacion",
				is_random_sample: false,
				election_year: 2025,
				election_round: "legislativas",
				distrito_code: "02",
				seccion_code: "027",
				mesas_coverage: {
					observed_units: 1,
					denominator_units: 3,
					is_random_sample: false,
				},
            mesas: [
					{
						code: 1,
						circuito_code: "00001",
						establecimiento_code: "E1",
						establecimiento_name: "Fixture school",
						covered: true,
						official_result_href: "/drilldown?mesaCode=1",
					},
					{
						code: 2,
						circuito_code: "00002",
						establecimiento_code: "E1",
						establecimiento_name: "Other fixture school",
						covered: false,
						official_result_href: "/drilldown?mesaCode=2",
					},
					{
						code: 3,
						circuito_code: "00003",
						establecimiento_code: null,
						establecimiento_name: null,
						covered: false,
						official_result_href: null,
					},
            ],

				escuelas: {
					status: "available",
					exclusions: [
						{
							reason: "official_rows_without_establecimiento_code",
							rows: 1,
							votes: 60,
						},
					],
					items: [
						{
							circuito_code: "00001",
							code: "E1",
							name: "Fixture school",
							observed_units: 1,
							denominator_units: 1,
							is_random_sample: false,
							official_archive_entry_ids: ["national/2025-legislativas"],
						},
						{
							circuito_code: "00002",
							code: "E1",
							name: "Other fixture school",
							observed_units: 0,
							denominator_units: 1,
							is_random_sample: false,
							official_archive_entry_ids: ["national/2025-legislativas"],
						},
					],
				},
				source_audit: [
					{ kind: "fiscalizacion", rows: 1, votes: 999, mesas: 1 },
				],
				denominator_audit: [
					{ kind: "official", rows: 3, votes: 320, mesas: 3 },
				],
				exclusions: [],
				provenance: {
					official_archive_entry_ids: ["national/2025-legislativas"],
					fiscalizacion_archive_entry_ids: ["fiscalizacion/runtime"],
				},
      },
    };
		const markup = renderToStaticMarkup(
			(await FiscalizacionPage({
				searchParams: Promise.resolve({
      electionId: "20000000-0000-0000-0000-000000000001",
      categoryId: "20000000-0000-0000-0000-000000000003",
					distritoCode: "02",
					seccionCode: "027",
				}),
			})) as ReactElement,
		);

      expect(markup).toContain("1 mesas cubiertas de 3 mesas oficiales");
      expect(markup).toContain("2 sin cobertura");

    expect(markup).toContain("no es una muestra aleatoria");
		expect(markup).toContain(
			"Circuito 00001 — Fixture school: 1 de 1 mesas cubiertas",
		);
		expect(markup).toContain(
			"Circuito 00002 — Other fixture school: 0 de 1 mesas cubiertas",
		);
		expect(markup).toContain("Exclusiones de establecimientos");
		expect(markup).toContain(
			"filas oficiales sin código de establecimiento: 1 fila, 60 votos",
		);
		expect(markup).toContain(
			"circuitoCode=00001&amp;establecimientoCode=E1&amp;level=establecimiento",
		);
		expect(markup).toContain(
			"circuitoCode=00002&amp;establecimientoCode=E1&amp;level=establecimiento",
		);
		expect(markup).toContain('href="/drilldown?electionId=');
    expect(markup).toContain("mesaCode=2");
		expect(markup).toContain(
			"Sin cobertura significa que no hay presencia de fiscalización, no que los votos oficiales sean cero o falten",
		);
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
			{
				...FISCALIZACION_ROW,
				partyName: "LA LIBERTAD AVANZA",
				canonicalPartyId: "canon-110",
				votes: 40,
			},
			{
				...FISCALIZACION_ROW,
				partyName: "LA LIBERTAD AVANZA",
				canonicalPartyId: "canon-110",
				votes: 40,
			},
      // A single row that outranks either of the rows above.
			{
				...FISCALIZACION_ROW,
				partyName: "FUERZA PATRIA",
				canonicalPartyId: "canon-999",
				votes: 60,
			},
    ];

		expect(partyShare(rows, "canon-110")).toEqual({
			status: "ok",
			sharePercent: 57.14,
		});
  });

  it("test_unmapped_rows_stay_in_the_denominator_without_becoming_a_party", () => {
    const rows: ResultRow[] = [
			{
				...FISCALIZACION_ROW,
				partyName: "LA LIBERTAD AVANZA",
				canonicalPartyId: "canon-110",
				votes: 50,
			},
      // Three unmapped rows. They are votes that were cast, so they belong in
      // the denominator — but they are not a party and can never be reported
      // as one.
      { ...FISCALIZACION_ROW, partyName: null, votes: 20 },
      { ...FISCALIZACION_ROW, partyName: null, votes: 20 },
      { ...FISCALIZACION_ROW, partyName: null, votes: 20 },
    ];

		expect(partyShare(rows, "canon-110")).toEqual({
			status: "ok",
			sharePercent: 45.45,
		});
    expect(topParty(rows).partyName).toBe("LA LIBERTAD AVANZA");
    // Per list id, which is the shape the render consumes — a bare total is
    // what `unmappedByListId` replaced.
		expect(topParty(rows).unmappedByListId).toEqual([
			{ listId: "110", rows: 3, votes: 60 },
		]);
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
		const request = comparisonFromParams(
			{
      compareElectionId: "2023-generales",
      compareElectionLabel: "22 Oct 2023 generales",
      compareYear: "2023",
      compareCategory: "DIPUTADO NACIONAL",
      compareJurisdiction: "national",
      compareJurisdictionId: "j-027",
      compareCategoryId: "c-diputados",
      compareSharePercent: "99.99",
			},
			2023,
		);

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
							[
								"110",
								{
									canonicalPartyId: "canon-110",
									displayName: "LA LIBERTAD AVANZA",
								},
							],
							[
								"999",
								{ canonicalPartyId: "canon-999", displayName: "FUERZA PATRIA" },
							],
            ]),
          ),
      },
    );

    const figure = await loadOfficialComparison(repository, {
      electionId: "2023-generales",
      electionLabel: "22 Oct 2023 generales",
      jurisdictionId: QUERY.jurisdictionId,
      categoryId: QUERY.categoryId,
			partyContext: {
				year: 2023,
				jurisdiction: "national",
				category: "DIPUTADO NACIONAL",
			},
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
      // THIS read's own drops, reported whatever the outcome: it is a third
      // independent query and the fiscalización read's tally cannot describe
      // it. The fixture's fiscalización row is removed by the official filter
      // here, and 12.578 votes leaving a comparison unremarked is precisely
      // the drop rule 3 exists to surface.
      excluded: { fiscalizacion: { rows: 1, votes: 12578 } },
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
							[
								"110",
								{
									canonicalPartyId: "canon-110",
									displayName: "LA LIBERTAD AVANZA",
								},
							],
							[
								"999",
								{ canonicalPartyId: "canon-999", displayName: "FUERZA PATRIA" },
							],
            ]),
          ),
      },
    );

    return loadOfficialComparison(repository, {
      electionId: "2023-municipal",
      electionLabel: "2023 municipal",
      jurisdictionId: QUERY.jurisdictionId,
      categoryId: QUERY.categoryId,
			partyContext: {
				year: 2023,
				jurisdiction: "national",
				category: "DIPUTADO NACIONAL",
			},
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
			partyContext: {
				year: 2023,
				jurisdiction: "national",
				category: "DIPUTADO NACIONAL",
			},
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
	const NAMED = (
		partyName: string | null,
		votes: number,
		listId: string | null = "x",
	): ResultRow => ({
    ...FISCALIZACION_ROW,
    listId,
    partyName,
		canonicalPartyId:
			partyName === null ? null : (CANON[partyName] ?? `canon-${partyName}`),
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
      unmappedByListId: [],
    });
  });

	it.each(["forward", "reverse"] as const)(
		"test_top_party_refuses_conflicting_names_for_one_canonical_id_in_%s_order",
		(order) => {
			const rows = [
				NAMED("LA LIBERTAD AVANZA", 30, "110"),
				NAMED("ALIANZA LA LIBERTAD AVANZA", 30, "20135"),
				NAMED("FUERZA PATRIA", 50, "999"),
			];

			expect(topParty(order === "forward" ? rows : [...rows].reverse())).toEqual({
				canonicalPartyId: null,
				partyName: null,
				refusedReason:
					"los identificadores canónicos de partido tienen nombres no vacíos contradictorios (canon-110: ALIANZA LA LIBERTAD AVANZA | LA LIBERTAD AVANZA)",
				tied: false,
				unmappedByListId: [],
			});
		},
	);

	it.each(["forward", "reverse"] as const)(
		"test_party_share_refuses_conflicting_names_for_one_canonical_id_in_%s_order",
		(order) => {
			const rows = [
				NAMED("LA LIBERTAD AVANZA", 30, "110"),
				NAMED("ALIANZA LA LIBERTAD AVANZA", 20, "20135"),
			];

			expect(
				partyShare(
					order === "forward" ? rows : [...rows].reverse(),
					"canon-110",
					"CALLER DISPLAY NAME",
				),
			).toEqual({
				status: "unavailable",
				reason:
					"los identificadores canónicos de partido tienen nombres no vacíos contradictorios (canon-110: ALIANZA LA LIBERTAD AVANZA | LA LIBERTAD AVANZA)",
			});
		},
	);

  it("test_an_unmapped_row_is_never_named_the_top_party", () => {
    // It still counts in the denominator — we just cannot say whose it is.
    const rows = [NAMED(null, 90), NAMED("FUERZA PATRIA", 10)];

    expect(topParty(rows)).toEqual({
      canonicalPartyId: "canon-999",
      partyName: "FUERZA PATRIA",
      refusedReason: null,
      tied: false,
      // Counted and broken down, not silently skipped.
      unmappedByListId: [{ listId: "x", rows: 1, votes: 90 }],
    });
		expect(partyShare(rows, "canon-999")).toEqual({
			status: "ok",
			sharePercent: 10,
		});
  });

  it("test_a_tie_at_the_top_selects_no_party", () => {
    // `votes > topVotes` kept whichever party the Map saw first — row order —
    // and that name then selected which party the whole juxtaposition
    // reported.
		const result = topParty([
			NAMED("LA LIBERTAD AVANZA", 5000),
			NAMED("FUERZA PATRIA", 5000),
		]);

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
      { listId: "777", rows: 1, votes: 400 },
      { listId: "888", rows: 1, votes: 5 },
    ]);
  });

  it("test_the_aggregates_refuse_mixed_source_kinds_themselves", () => {
    // Their OWN guard, not the caller's: `loadOfficialComparison` calls
    // `partyShare` on a row set `renderFiscalizacionView` never sees.
    const rows: ResultRow[] = [
			{
				...FISCALIZACION_ROW,
				partyName: "LA LIBERTAD AVANZA",
				canonicalPartyId: "canon-110",
				votes: 60,
			},
			{
				...OFFICIAL_ROW,
				partyName: "LA LIBERTAD AVANZA",
				canonicalPartyId: "canon-110",
				votes: 25,
			},
    ];

    const share = partyShare(rows, "canon-110");
    expect(share.status).toBe("unavailable");
    if (share.status !== "unavailable") throw new Error("expected unavailable");
    expect(share.reason).toContain("tipos de fuente");
    expect(topParty(rows).partyName).toBeNull();
  });

  it("test_a_comparison_in_another_jurisdiction_is_refused", () => {
    process.env["NATIONAL_JURISDICTION_ID"] = "j-027";
    process.env["FISCALIZACION_CATEGORY_ID"] = "c-diputados";
    process.env["FISCALIZACION_ELECTION_ID"] = "2025-legislativas-nacional";

		const result = comparisonFromParams(
			{
      compareElectionId: "2023-generales",
      compareElectionLabel: "22 Oct 2023 generales",
      compareYear: "2023",
      compareCategory: "DIPUTADO NACIONAL",
      compareJurisdiction: "national",
      compareJurisdictionId: "j-999",
      compareCategoryId: "c-diputados",
			},
			2023,
		);

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
			{
				fetchPartyNames: () =>
					Promise.resolve(
						new Map([
							[
								"110",
								{
									canonicalPartyId: "canon-110",
									displayName: "LA LIBERTAD AVANZA",
								},
							],
						]),
					),
			},
    );
    // Bypasses the repository's own filter the way a regression would.
    vi.spyOn(repository, "queryOfficial").mockResolvedValue({
      status: "ok",
			rows: [
				{
					...FISCALIZACION_ROW,
					listId: "110",
					partyName: "LA LIBERTAD AVANZA",
					canonicalPartyId: "canon-110",
					votes: 60,
				},
			],
      excluded: {},
      partyMappingConfigured: true,
    });

    return loadOfficialComparison(repository, {
      electionId: "2023-generales",
      electionLabel: "22 Oct 2023 generales",
      jurisdictionId: QUERY.jurisdictionId,
      categoryId: QUERY.categoryId,
			partyContext: {
				year: 2023,
				jurisdiction: "national",
				category: "DIPUTADO NACIONAL",
			},
      canonicalPartyId: "canon-110",
      partyName: "LA LIBERTAD AVANZA",
    }).then((result) => {
      expect(result.status).toBe("unavailable");
			if (result.status !== "unavailable")
				throw new Error("expected unavailable");
      expect(result.reason).toContain("filas no oficiales");
    });
  });

  it("test_a_uniformly_unknown_granularity_is_refused_not_summed", () => {
    // Size-1 is not safety: this module cannot say what a level it does not
    // know contains, so it cannot say the rows do not overlap.
    const rows: ResultRow[] = [
			{
				...FISCALIZACION_ROW,
				partyName: "LA LIBERTAD AVANZA",
				canonicalPartyId: "canon-110",
				granularity: "subcircuito" as never,
				votes: 40,
			},
			{
				...FISCALIZACION_ROW,
				partyName: "FUERZA PATRIA",
				canonicalPartyId: "canon-999",
				granularity: "subcircuito" as never,
				votes: 60,
			},
    ];

    const share = partyShare(rows, "canon-110");
    expect(share.status).toBe("unavailable");
    if (share.status !== "unavailable") throw new Error("expected unavailable");
    expect(share.reason).toContain("no puede ordenar");
    expect(topParty(rows).partyName).toBeNull();
  });

  it("test_mixed_granularity_refuses_every_party_figure", () => {
    // A `seccion` row already CONTAINS the `mesa` rows beneath it. The refusal
    // branch existed but nothing drove it, so `topParty` and the rendered
    // per-party list summed the very same rows the share refused.
    const rows: ResultRow[] = [
			{
				...FISCALIZACION_ROW,
				partyName: "LA LIBERTAD AVANZA",
				canonicalPartyId: "canon-110",
				granularity: "mesa",
				votes: 40,
			},
			{
				...FISCALIZACION_ROW,
				partyName: "LA LIBERTAD AVANZA",
				canonicalPartyId: "canon-110",
				granularity: "seccion",
				votes: 40,
			},
			{
				...FISCALIZACION_ROW,
				partyName: "FUERZA PATRIA",
				canonicalPartyId: "canon-999",
				granularity: "mesa",
				votes: 50,
			},
    ];

    const share = partyShare(rows, "canon-110");
    expect(share.status).toBe("unavailable");
    if (share.status !== "unavailable") throw new Error("expected unavailable");
    expect(share.reason).toContain("duplicaría el conteo");

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
    expect(html).toContain("Sin cifra comparativa");
  });

  it("test_the_leakage_refusal_still_reports_the_comparison_it_could_not_build", () => {
    const html = renderToStaticMarkup(
      renderFiscalizacionView(
        {
          status: "ok",
          rows: [FISCALIZACION_ROW, OFFICIAL_ROW],
          excluded: {},
          coverage: FISCALIZACION_COVERAGE,
          partyMappingConfigured: true,
        },
				{
					comparisonUnavailable:
						"no row resolved to a curated party to compare",
				},
      ),
    );

    // The FULL phrase: "are not" carries no refusal semantics on its own.
    expect(html).toContain("no son de fiscalización");
    expect(html).toContain("Sin cifra comparativa");
  });

  it("test_the_render_path_refuses_a_view_carrying_official_rows_and_keeps_the_comparison_tally", () => {
    // The THIRD leakage path. The loader is guarded and the repository
    // filters, but `renderFiscalizacionView` accepts any view a caller hands
    // it — and nothing drove that branch, so the suite was green whether it
    // worked or not.
    const html = renderToStaticMarkup(
			renderFiscalizacionView(
				{
        status: "ok",
        // NON-EMPTY on purpose: the repository's drops and the render filter's
        // are two different counts, and one must not stand in for the other.
        excluded: { unknown: { rows: 3, votes: 41 } },
        rows: [FISCALIZACION_ROW, OFFICIAL_ROW],
        coverage: FISCALIZACION_COVERAGE,
        partyMappingConfigured: true,
				},
				{
        // The comparison read's OWN tally, counted before this refusal fired.
        officialExcluded: { fiscalizacion: { rows: 2, votes: 640 } },
				},
			),
    );

    expect(html).toContain("3 filas desconocida");
    // A THIRD read's drop, on the branch that never rendered it: it belongs to
    // neither the repository's tally above nor the render filter's below.
    expect(html).toContain("elección comparada");
    expect(html).toContain("2 filas fiscalización / 640 votos");
    expect(html).toContain("Se rechazó");
    // The official votes appear ONLY inside the exclusion breakdown, labelled
    // as excluded — never as a party figure. Asserting a bare `not
    // .toContain("100")` was both weak (it matches `1005`, a hash, a
    // percentage) and wrong: rule 3 requires the excluded amount be reported.
    expect(html).toContain("oficial: 1 fila, 100 votos");
    expect(html).not.toContain("LA LIBERTAD AVANZA");
    expect(html).not.toContain("Cobertura:");
  });

  it("test_mixed_granularity_keeps_reporting_what_failed_to_map", () => {
    // Refusing to RANK mixed levels is right; reporting zero unmapped votes
    // while 400 failed to resolve is a silent exclusion behind a total.
    const result = topParty([
			{
				...FISCALIZACION_ROW,
				partyName: "LA LIBERTAD AVANZA",
				canonicalPartyId: "canon-110",
				granularity: "mesa",
				votes: 10,
			},
			{
				...FISCALIZACION_ROW,
				partyName: null,
				listId: "777",
				granularity: "seccion",
				votes: 400,
			},
    ]);

    expect(result.partyName).toBeNull();
    expect(result.refusedReason).toContain("duplicaría el conteo");
		expect(result.unmappedByListId).toEqual([
			{ listId: "777", rows: 1, votes: 400 },
		]);
  });

  it("test_mixed_granularity_renders_no_per_party_list", () => {
    const html = renderToStaticMarkup(
      renderFiscalizacionView({
        status: "ok",
        excluded: {},
        rows: [
					{
						...FISCALIZACION_ROW,
						partyName: "LA LIBERTAD AVANZA",
						canonicalPartyId: "canon-110",
						granularity: "mesa",
						votes: 40,
					},
					{
						...FISCALIZACION_ROW,
						partyName: "LA LIBERTAD AVANZA",
						canonicalPartyId: "canon-110",
						granularity: "seccion",
						votes: 40,
					},
        ],
        coverage: FISCALIZACION_COVERAGE,
        partyMappingConfigured: true,
      }),
    );

    // The list is a DISPLAYED figure, printed beside the coverage note.
    expect(html).toContain("Sin cifras por partido");
    expect(html).not.toContain("80 votos");
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
    process.env["FISCALIZACION_ELECTION_ID"] = "2025-legislativas-nacional";

		const result = comparisonFromParams(
			{
      compareElectionId: "2023-generales",
      compareElectionLabel: "22 Oct 2023 generales",
      // 2023 rows resolved through the 2025 mapping: LLA is `20135` in one and
      // `110` in the other.
      compareYear: "2025",
      compareCategory: "DIPUTADO NACIONAL",
      compareJurisdiction: "national",
      compareJurisdictionId: "j-027",
      compareCategoryId: "c-diputados",
      // The election row says 2023 — the TRUTH the request contradicts.
			},
			2023,
		);

    expect(result.status).toBe("refused");
    if (result.status !== "refused") throw new Error("expected refused");
    expect(result.reason).toContain("2023-generales");
    // The reason names what the election actually was, so the operator can see
    // which of the two values is wrong.
    expect(result.reason).toContain("realizada en 2023");
  });

  it("test_a_non_national_comparison_is_refused_rather_than_mapped_as_national", () => {
    process.env["NATIONAL_JURISDICTION_ID"] = "j-027";
    process.env["FISCALIZACION_CATEGORY_ID"] = "c-diputados";
    process.env["FISCALIZACION_ELECTION_ID"] = "2025-legislativas-nacional";

    // PBA's `distrito 027` is a PARTIDO; national distrito 02 / seccion 027 is
    // Coronel Rosales. Resolving a municipal comparison through the national
    // mapping is that scheme collision on the comparison side.
    expect(
			comparisonFromParams(
				{
        compareElectionId: "2023-municipal",
        compareElectionLabel: "2023 municipal",
        compareYear: "2023",
        // Same office and category as the pinned side, so the refusal below
        // is about the JURISDICTION scheme and nothing else.
        compareCategory: "DIPUTADO NACIONAL",
        compareJurisdiction: "pba",
        compareJurisdictionId: "j-027",
        compareCategoryId: "c-diputados",
				},
				2023,
			),
    ).toEqual({
      status: "refused",
      // REFUSED, with a reason. `undefined` is what "nothing was asked for"
      // returns, so asserting it would let a silent drop pass under a name
      // that promises a refusal.
      reason: expect.stringContaining("nacional"),
    });
  });

  it("test_a_party_absent_from_the_rows_has_no_share_rather_than_zero", () => {
    // The absent party is asked for by its CANONICAL ID, and the row present
    // carries a DIFFERENT id under a name that is not it. Asking with a display
    // string instead made the row match neither field, so `unavailable` came
    // back whether `partyShare` keyed on the id or on the name — the identity
    // boundary this file exists to defend, untested by its own test.
    const result = partyShare(
      [NAMED("FUERZA PATRIA", 10)],
      "canon-110",
      "LA LIBERTAD AVANZA",
    );

    expect(result.status).toBe("unavailable");
		if (result.status !== "unavailable")
			throw new Error("expected unavailable");
    // The REASON names the party a human recognises, not the internal id.
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
							[
								"20135",
								{
									canonicalPartyId: "canon-110",
									displayName: "LA LIBERTAD AVANZA",
								},
							],
							[
								"999",
								{ canonicalPartyId: "canon-999", displayName: "FUERZA PATRIA" },
							],
            ]),
          ),
      },
    );

    const figure = await loadOfficialComparison(repository, {
      electionId: "2023-generales",
      electionLabel: "22 Oct 2023 generales",
      jurisdictionId: QUERY.jurisdictionId,
      categoryId: QUERY.categoryId,
			partyContext: {
				year: 2023,
				jurisdiction: "national",
				category: "DIPUTADO NACIONAL",
			},
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
			{
				fetchPartyNames: () =>
					Promise.resolve(
						new Map([
							[
								"999",
								{ canonicalPartyId: "canon-999", displayName: "FUERZA PATRIA" },
							],
						]),
					),
			},
    );

    const figure = await loadOfficialComparison(repository, {
      electionId: "2023-generales",
      electionLabel: "22 Oct 2023 generales",
      jurisdictionId: QUERY.jurisdictionId,
      categoryId: QUERY.categoryId,
			partyContext: {
				year: 2023,
				jurisdiction: "national",
				category: "DIPUTADO NACIONAL",
			},
      canonicalPartyId: "canon-110",
      partyName: "LA LIBERTAD AVANZA",
    });

    // A party that did not stand in the comparison election has no share.
    // Rendering 0 % would read as a collapse it never suffered -- and the
    // REASON travels with the refusal so the page can say why.
    expect(figure.status).toBe("unavailable");
		if (figure.status !== "unavailable")
			throw new Error("expected unavailable");
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
    process.env["FISCALIZACION_ELECTION_ID"] = "2025-legislativas-nacional";
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

    expect(markup).toContain("2 filas oficial");
    expect(markup).toContain("El filtro de fuente de fiscalización excluyó");
  });
});

describe("fiscalizacion page — the figure's level is disclosed", () => {
  it("test_mesa_rows_summed_into_a_jurisdiction_total_say_so", async () => {
    // `votesByParty` sums every row per party across one jurisdiction, so the
    // raw row level claimed `mesa` over a figure that IS every mesa added up.
    // The fourth page to derive this label its own way.
    process.env["NATIONAL_JURISDICTION_ID"] = "j-027";
    process.env["FISCALIZACION_CATEGORY_ID"] = "c-diputados";
    process.env["FISCALIZACION_ELECTION_ID"] = "2025-legislativas-nacional";
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
    expect(markup).toContain('aria-label="granularidad: seccion"');
    expect(markup).toContain("sumado a partir de filas de nivel mesa");
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
						{
							...FISCALIZACION_ROW,
							partyName: "LA LIBERTAD AVANZA",
							canonicalPartyId: "canon-110",
						},
          ],
          coverage: FISCALIZACION_COVERAGE,
          partyMappingConfigured: true,
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

    expect(html).toContain("tipo de fuente SIN VERIFICAR");
    // It must not borrow the label it failed to earn. Scoped to the BADGE's
    // own label form ("— official source"): the page has other prose carrying
    // the words, so a bare substring here would be asserting about the wrong
    // text.
    expect(html).not.toContain("— fuente oficial");
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
    expect(html).toContain("2 filas desconocida / 31 votos");
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
						{
							...FISCALIZACION_ROW,
							partyName: "LA LIBERTAD AVANZA",
							canonicalPartyId: "canon-110",
						},
          ],
          coverage: FISCALIZACION_COVERAGE,
          partyMappingConfigured: true,
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

    expect(html).toContain("sin hash — no puede verificarse");
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
			fakeRowSource([
				{ ...OFFICIAL_ROW, listId: "20135", votes: 40 },
				{ ...OFFICIAL_ROW, listId: "999", votes: 60 },
			]),
      {
        fetchPartyNames: () =>
          Promise.resolve(
            new Map([
							[
								"20135",
								{
									canonicalPartyId: "canon-110",
									displayName: "LA LIBERTAD AVANZA",
								},
							],
							[
								"999",
								{ canonicalPartyId: "canon-999", displayName: "FUERZA PATRIA" },
							],
            ]),
          ),
      },
    );

    const result = await loadOfficialComparison(repository, {
      electionId: "2023-generales",
      electionLabel: "22 Oct 2023 generales",
      jurisdictionId: QUERY.jurisdictionId,
      categoryId: QUERY.categoryId,
			partyContext: {
				year: 2023,
				jurisdiction: "national",
				category: "DIPUTADO NACIONAL",
			},
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
    process.env["FISCALIZACION_ELECTION_ID"] = "2025-legislativas-nacional";
    repositoryRows = [
      { ...FISCALIZACION_ROW, listId: "110", votes: 60 },
			{
				...OFFICIAL_ROW,
				listId: "110",
				votes: 25,
				archiveEntryId: "national/2023-generales",
			},
			{
				...OFFICIAL_ROW,
				listId: "999",
				votes: 75,
				archiveEntryId: "national/2023-generales",
			},
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

    expect(await renderPage()).toContain("sin hash — no puede verificarse");
  });

  it("test_an_untraceable_official_entry_is_named_on_the_page", async () => {
    // `officialMissingProvenance` — the official side's own entry resolving to
    // no source record, reported separately from the fiscalización side's.
    seedJuxtaposition();
    sourceRefs = [
      {
        archiveEntryId: "fiscalizacion/2025-lla",
				sha256:
					"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        url: "https://example.test/fiscalizacion-2025.csv",
        fetchedAt: "2026-01-01T00:00:00Z",
      },
    ];

    const markup = await renderPage();

    expect(markup).toContain("national/2023-generales");
    expect(markup).toContain("no se puede rastrear");
  });
});

describe("fiscalizacion page — the pinned election is configuration", () => {
  it("test_an_unconfigured_election_refuses_instead_of_pinning_a_slug", async () => {
    // It was a hardcoded curated slug (`2025-legislativas-nacional`), which can
    // never equal the uuid `election.id` holds — so this route refused every
    // real request before reading a row. Unset, it must SAY so rather than
    // compare against a literal nothing in the database can match.
    delete process.env["FISCALIZACION_ELECTION_ID"];
    process.env["NATIONAL_JURISDICTION_ID"] = "j-027";
    process.env["FISCALIZACION_CATEGORY_ID"] = "c-diputados";

    const markup = renderToStaticMarkup(
      (await FiscalizacionPage({
        searchParams: Promise.resolve({
          electionId: "6dae81f9-c862-4cc5-b3f3-b640e4ea7319",
          jurisdictionId: "j-027",
          categoryId: "c-diputados",
        }),
      })) as ReactElement,
    );

    expect(markup).toContain("FISCALIZACION_ELECTION_ID no está configurada");
  });

  it("test_a_configured_uuid_election_is_served", async () => {
    // The whole point: a uuid reaches the rows instead of failing a string
    // comparison against a slug.
		process.env["FISCALIZACION_ELECTION_ID"] =
			"6dae81f9-c862-4cc5-b3f3-b640e4ea7319";
    process.env["NATIONAL_JURISDICTION_ID"] = "j-027";
    process.env["FISCALIZACION_CATEGORY_ID"] = "c-diputados";
    repositoryRows = [{ ...FISCALIZACION_ROW, listId: "110", votes: 60 }];

    const markup = renderToStaticMarkup(
      (await FiscalizacionPage({
        searchParams: Promise.resolve({
          electionId: "6dae81f9-c862-4cc5-b3f3-b640e4ea7319",
          jurisdictionId: "j-027",
          categoryId: "c-diputados",
        }),
      })) as ReactElement,
    );

    expect(markup).not.toContain("esta ruta solo ofrece");
    expect(markup).toContain("Cobertura:");
  });
});

describe("fiscalizacion page — the pinned election's year is read, not assumed", () => {
  it("test_an_election_from_another_year_is_refused_not_mapped_through_2025", async () => {
    // The asymmetry this closes: the COMPARISON side was checked against
    // `election.year` while the pinned side — the one that selects the mapping
    // for every figure on the page — was a literal. `FISCALIZACION_ELECTION_ID`
    // is an opaque uuid an operator cannot eyeball, and the label beside it is
    // a hardcoded string that cannot disagree with it. Pointed at a 2023
    // election, every LLA row (`20135` in 2023, `110` in 2025) would drop out
    // as unmapped under a denominator naming a different race.
		process.env["FISCALIZACION_ELECTION_ID"] =
			"b5b6a452-836d-40ea-a570-1cbc87fb84f6";
    process.env["NATIONAL_JURISDICTION_ID"] = "j-027";
    process.env["FISCALIZACION_CATEGORY_ID"] = "c-diputados";

    const markup = renderToStaticMarkup(
      (await FiscalizacionPage({
        searchParams: Promise.resolve({
          electionId: "b5b6a452-836d-40ea-a570-1cbc87fb84f6",
          jurisdictionId: "j-027",
          categoryId: "c-diputados",
        }),
      })) as ReactElement,
    );

    expect(markup).toContain("realizada en 2023");
    expect(markup).toContain("verificaron para 2025");
    // No figure and no denominator reach the page.
    expect(markup).not.toContain("Cobertura:");
  });
});

describe("fiscalizacion page — the comparison read reports its own drops", () => {
  it("test_the_comparison_elections_excluded_rows_reach_the_page", () => {
    // A THIRD independent read. Its `source_kind` filter removes rows — the
    // `unknown` bucket among them, which BOTH filters drop — and that count
    // used to appear on no page: `view.excluded` describes the fiscalización
    // read and cannot stand in for this one.
    const html = renderToStaticMarkup(
      renderFiscalizacionView(
        {
          status: "ok",
					rows: [
						{
							...FISCALIZACION_ROW,
							partyName: "LA LIBERTAD AVANZA",
							canonicalPartyId: "canon-110",
						},
					],
          coverage: FISCALIZACION_COVERAGE,
          partyMappingConfigured: true,
          excluded: { unknown: { rows: 1, votes: 9 } },
        },
        {
          officialExcluded: {
            fiscalizacion: { rows: 2, votes: 640 },
            unknown: { rows: 1, votes: 55 },
          },
        },
      ),
    );

    expect(html).toContain("elección comparada");
    expect(html).toContain("2 filas fiscalización / 640 votos");
    expect(html).toContain("1 fila desconocida / 55 votos");
    // NOT merged with the fiscalización read's tally, which is a different
    // query over different rows.
    expect(html).toContain("1 fila desconocida / 9 votos");
  });
});

describe("fiscalizacion page — the comparison tally reaches the rendered page", () => {
  it("test_the_comparison_reads_drops_are_rendered_through_a_real_request", async () => {
    // Threading it into the render had no driver: deleting the assignment left
    // every test green while the count vanished again.
    process.env["FISCALIZACION_ELECTION_ID"] = "2025-legislativas-nacional";
    process.env["NATIONAL_JURISDICTION_ID"] = "j-027";
    process.env["FISCALIZACION_CATEGORY_ID"] = "c-diputados";
    repositoryRows = [
      { ...FISCALIZACION_ROW, listId: "110", votes: 60 },
      // Rows the COMPARISON election's official filter removes: one
      // fiscalización, one carrying a value outside the enum that BOTH
      // filters drop and that would otherwise appear nowhere.
			{
				...OFFICIAL_ROW,
				listId: "110",
				votes: 25,
				archiveEntryId: "national/2023-generales",
			},
      {
        ...OFFICIAL_ROW,
        listId: "110",
        votes: 44,
        sourceKind: "provisional" as never,
        archiveEntryId: "national/2023-generales",
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

    expect(markup).toContain("elección comparada");
    expect(markup).toContain("1 fila fiscalización / 60 votos");
    expect(markup).toContain("1 fila desconocida / 44 votos");
  });
});

describe("fiscalizacion page — a source-read failure keeps the comparison tally", () => {
  it("test_the_comparison_reads_drops_survive_a_later_failure", () => {
    // Counted by the comparison read, then discarded when `fetchSourceRefs`
    // threw: a drop hidden behind a refusal about a THIRD read. `excluded` and
    // `comparisonUnavailable` already survived that catch; this did not.
    const html = renderToStaticMarkup(
      renderFiscalizacionView({
        status: "read_failed",
        reason: "row-level security denied the source read",
        excluded: { unknown: { rows: 1, votes: 9 } },
        officialExcluded: { fiscalizacion: { rows: 2, votes: 640 } },
      }),
    );

    expect(html).toContain("row-level security denied the source read");
    expect(html).toContain("elección comparada");
    expect(html).toContain("2 filas fiscalización / 640 votos");
    // Its own note, not merged with the fiscalización read's.
    expect(html).toContain("1 fila desconocida / 9 votos");
  });
});

describe("fiscalizacion page — a failed source read keeps what the other reads counted", () => {
  it("test_the_comparison_tally_survives_a_source_read_failure_through_the_page", async () => {
    // The catch rebuilds a `read_failed` view AFTER the comparison read has
    // already happened, so its tally exists and used to be dropped on the
    // floor — a drop hidden behind a refusal about a third read.
    refuseSourceReadWith = "row-level security denied the source read";
    process.env["FISCALIZACION_ELECTION_ID"] = "2025-legislativas-nacional";
    process.env["NATIONAL_JURISDICTION_ID"] = "j-027";
    process.env["FISCALIZACION_CATEGORY_ID"] = "c-diputados";
    repositoryRows = [
      { ...FISCALIZACION_ROW, listId: "110", votes: 60 },
			{
				...OFFICIAL_ROW,
				listId: "110",
				votes: 25,
				archiveEntryId: "national/2023-generales",
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

    expect(markup).toContain("row-level security denied the source read");
    expect(markup).toContain("elección comparada");
    expect(markup).toContain("1 fila fiscalización / 60 votos");
  });
});

describe("fiscalizacion page — unmapped rows on containing levels are not added", () => {
  it("test_unmapped_votes_across_two_levels_are_withheld_not_double_counted", () => {
    // ONE unmapped list id on two levels where the coarser CONTAINS the finer:
    // a seccion row of 400 and a mesa row of 100 inside it. Adding them reports
    // 500 for votes that were cast once — and the page directly above refuses
    // to publish any per-party figure for these same rows.
    //
    // Every existing mixed-granularity fixture uses MAPPED rows, and the one
    // test pairing unmapped with mixed levels has a single row, so no addition
    // happens and it passes either way.
    const html = renderToStaticMarkup(
      renderFiscalizacionView({
        status: "ok",
        rows: [
					{
						...FISCALIZACION_ROW,
						listId: "777",
						votes: 400,
						granularity: "seccion",
					},
					{
						...FISCALIZACION_ROW,
						listId: "777",
						votes: 100,
						granularity: "mesa",
					},
        ],
        coverage: FISCALIZACION_COVERAGE,
        partyMappingConfigured: true,
        excluded: {},
      }),
    );

    // WHICH id failed to map, and how many rows: independent of granularity.
    expect(html).toContain("777: 2 filas");
    expect(html).toContain("no se pueden sumar");
    // The double-counted total must not appear anywhere.
    expect(html).not.toContain("500 votos");
    expect(html).not.toContain("(500 votos)");
  });
});

describe("fiscalizacion page — a source-read failure keeps every earlier count", () => {
  it("test_the_unmapped_and_unorderable_breakdowns_survive_through_the_page", async () => {
    // The catch rebuilds `read_failed` AFTER the rows were read and
    // `topParty` ran, so both breakdowns are facts counted before it. They
    // used to vanish behind a refusal about a THIRD read.
    refuseSourceReadWith = "row-level security denied the source read";
    process.env["FISCALIZACION_ELECTION_ID"] = "2025-legislativas-nacional";
    process.env["NATIONAL_JURISDICTION_ID"] = "j-027";
    process.env["FISCALIZACION_CATEGORY_ID"] = "c-diputados";
    repositoryRows = [
      { ...FISCALIZACION_ROW, listId: "110", votes: 60 },
      // Unmapped, and on a level this app cannot order.
			{
				...FISCALIZACION_ROW,
				listId: "4321",
				votes: 700,
				granularity: "subcircuito" as never,
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

    expect(markup).toContain("row-level security denied the source read");
    expect(markup).toContain("4321: 1 filas");
    // The real denominator, not the unmapped count restated.
    expect(markup).toContain("1 de 2 filas");
    expect(markup).toContain("subcircuito: 1 filas");
  });
});

describe("fiscalizacion page — no mapping source is not a claim about the data", () => {
  it("test_an_unconfigured_mapping_source_says_so_on_the_success_path", async () => {
    // The leakage branch threaded `mappingConfigured` and the success branch
    // did not, so the component's `true` default made the page state a fact
    // about the curated table that is really a fact about the caller's config.
    const html = renderToStaticMarkup(
      renderFiscalizacionView({
        status: "ok",
        rows: [{ ...FISCALIZACION_ROW, listId: "4321" }],
        coverage: FISCALIZACION_COVERAGE,
        excluded: {},
        partyMappingConfigured: false,
      }),
    );

    expect(html).toContain("no hay una fuente de mapeo curado configurada");
    expect(html).not.toContain("se resolvieron sin un partido curado");
  });
});

describe("fiscalizacion page — responsive selectors and evidence presentation", () => {
  it("groups the coverage filters without changing their GET names", async () => {
    coverageRpcResults = {
      results_exploration_facets: {
        status: "ok",
        elections: [{ id: "e-2025", year: 2025, round: "legislativas", label: "2025 legislativas" }],
        categories: [{ id: "c-diputados", name: "DIPUTADO NACIONAL" }],
        distritos: [{ code: "02", name: "Buenos Aires", name_status: "present", name_variant_count: 1 }],
        secciones: [{ code: "027", name: "Coronel Rosales", name_status: "present", name_variant_count: 1 }],
        circuitos: [],
        establecimientos: [],
        mesas: [],
        available_levels: [],
      },
    };

    const markup = renderToStaticMarkup(
      (await FiscalizacionPage({ searchParams: Promise.resolve({}) })) as ReactElement,
    );

    expect(markup).toMatch(/<header class="page-header">/);
    expect(markup).toContain(
      '<section class="panel" aria-labelledby="coverage-form-heading">',
    );
    expect(markup).toContain('<form action="/fiscalizacion" method="get">');
    expect(markup).toContain('<fieldset class="form-grid selector-form">');
    expect(markup).toContain(
      '<legend class="selector-form__legend">Selectores de cobertura</legend>',
    );
    expect(markup).toContain('name="electionId"');
    expect(markup).toContain('name="categoryId"');
    expect(markup).toContain('name="distritoCode"');
    expect(markup).toContain('name="seccionCode"');
  });
});
