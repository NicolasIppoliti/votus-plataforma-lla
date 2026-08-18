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
  2023: {
    "20135": { canonicalPartyId: "lla", displayName: "LA LIBERTAD AVANZA" },
    "20135-nameless": { canonicalPartyId: "lla-nameless", displayName: "" },
    "20136": {
      canonicalPartyId: "lla",
      displayName: "ALIANZA LA LIBERTAD AVANZA",
    },
    "20999": { canonicalPartyId: "fp", displayName: "UNION POR LA PATRIA" },
  },
  2025: {
    "110": {
      canonicalPartyId: "lla",
      displayName: "ALIANZA LA LIBERTAD AVANZA",
    },
    "999": { canonicalPartyId: "fp", displayName: "FUERZA PATRIA" },
  },
};
let refuseElection: string | null = null;
let sourceRefs: SourceRef[] = [];
let sourceRefsFailure: Error | null = null;
/** When true, the repository's own filter is bypassed — a simulated regression. */
let leakFiscalizacion = false;
let facetsUnavailable = false;
let resultsRepositoryCalls = 0;
const facetCalls: Record<string, unknown>[] = [];

const FACET_ELECTIONS = [
  {
    id: "2023-generales",
    year: 2023,
    round: "generales",
    label: "2023 generales",
  },
  {
    id: "7769c98d-b286-4e8c-80ce-c2f9ab4fc929",
    year: 2023,
    round: "generales",
    label: "2023 generales (UUID)",
  },
  {
    id: "2025-legislativas-nacional",
    year: 2025,
    round: "legislativas",
    label: "2025 legislativas",
  },
  {
    id: "6dae81f9-c862-4cc5-b3f3-b640e4ea7319",
    year: 2025,
    round: "legislativas",
    label: "2025 legislativas (UUID)",
  },
  {
    id: "2021-generales",
    year: 2021,
    round: "generales",
    label: "2021 generales",
  },
];
const COMMON_CATEGORY = { id: "c-diputados", name: "DIPUTADO NACIONAL" };
interface FacetCategory {
  id: string;
  name: string;
}
let categoryFacetsByElection: Record<string, FacetCategory[]> = {};

function facetCategories(electionId: unknown) {
  if (typeof electionId === "string") {
    const overriddenCategories = categoryFacetsByElection[electionId];
    if (overriddenCategories) return overriddenCategories;
  }
  if (electionId === "2023-generales") {
    return [
      COMMON_CATEGORY,
      { id: "c-senadores", name: "SENADOR NACIONAL" },
      { id: "c-shared-name-2023", name: "CATEGORÍA HOMÓNIMA" },
    ];
  }
  if (electionId === "2025-legislativas-nacional") {
    return [
      COMMON_CATEGORY,
      { id: "c-parlasur", name: "PARLAMENTARIO DEL MERCOSUR" },
      { id: "c-shared-name-2025", name: "CATEGORÍA HOMÓNIMA" },
    ];
  }
  if (
    electionId === "7769c98d-b286-4e8c-80ce-c2f9ab4fc929" ||
    electionId === "6dae81f9-c862-4cc5-b3f3-b640e4ea7319"
  ) {
    return [COMMON_CATEGORY];
  }
  return [];
}

vi.mock("@/lib/supabase/server-client", () => ({
  createSupabaseServerClient: () =>
    Promise.resolve({
      rpc: (_name: string, args: Record<string, unknown>) => {
        facetCalls.push(args);
        return Promise.resolve(
          facetsUnavailable
            ? { data: null, error: { message: "facets offline" } }
            : {
                data: {
                  status: "ok",
                  elections: FACET_ELECTIONS,
                  categories: facetCategories(args["p_election_id"]),
                  distritos: [],
                  secciones: [],
                  circuitos: [],
                  establecimientos: [],
                  mesas: [],
                  available_levels: [],
                },
                error: null,
              },
        );
      },
    }),
}));

const CATEGORY_NAMES: Record<string, string | undefined> = {
  "c-diputados": "DIPUTADO NACIONAL",
  "c-concejales": "CONCEJALES",
};

vi.mock("@/lib/fiscalizacion/repository", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/fiscalizacion/repository")>();
  return {
    ...actual,
    createResultsRepository: () => {
      resultsRepositoryCalls += 1;
      if (leakFiscalizacion) {
        const leaking = new actual.ResultsRepository({
          fetchRows: (query) =>
            Promise.resolve(rowsByElection[query.electionId] ?? []),
        });
        // Path 1 REGRESSES: the filter is gone. Path 3 must still refuse.
        leaking.queryOfficial = (query) =>
          Promise.resolve({
            status: "ok",
            rows: rowsByElection[query.electionId] ?? [],
            excluded: {},
            partyMappingConfigured: true,
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
              if (
                refuseElection &&
                (refuseElection === "*" || query.electionId === refuseElection)
              ) {
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
                        .map(
                          (id) =>
                            [id, PARTY_NAMES[context.year]?.[id]] as const,
                        )
                        .filter(
                          (
                            pair,
                          ): pair is readonly [
                            string,
                            { canonicalPartyId: string; displayName: string },
                          ] => Boolean(pair[1]),
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
        return Promise.resolve({
          status: "ok" as const,
          year: rows[electionId]!,
        });
      }
      const match = /^(\d{4})/.exec(electionId);
      return Promise.resolve(
        match
          ? { status: "ok" as const, year: Number(match[1]) }
          : { status: "no_row" as const },
      );
    },
    fetchSourceRefs: () =>
      sourceRefsFailure
        ? Promise.reject(sourceRefsFailure)
        : Promise.resolve({ sources: sourceRefs, missing: [] }),
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
  facetsUnavailable = false;
  resultsRepositoryCalls = 0;
  facetCalls.length = 0;
  categoryFacetsByElection = {};
  sourceRefs = [];
  sourceRefsFailure = null;
});

const PARAMS = {
  election2023: "2023-generales",
  election2025: "2025-legislativas-nacional",
  jurisdictionId: "j-027",
  categoryId: "c-diputados",
  partyCategory: "DIPUTADO NACIONAL",
  partyJurisdiction: "national",
};

const CANONICAL_PARAMS = {
  election2023: PARAMS.election2023,
  election2025: PARAMS.election2025,
  categoryId: PARAMS.categoryId,
};

describe("compare page — reachable national selector", () => {
  it("test_the_bare_route_renders_an_accessible_progressive_get_selector", async () => {
    const markup = renderToStaticMarkup(
      (await ComparePage({ searchParams: Promise.resolve({}) })) as ReactElement,
    );
    expect(markup).toContain('<form action="/compare" method="get">');
    expect(markup).toContain('<label for="compare-election-2023">Elección de 2023</label>');
    expect(markup).toContain('<label for="compare-election-2025">Elección de 2025</label>');
    expect(markup).toContain('<label for="compare-category">Categoría común</label>');
    expect(markup).toContain('name="categoryId"');
    expect(markup).toContain("Actualizar opciones");
    expect(markup).not.toContain("Proporcione los parámetros de consulta");
  });

  it("test_the_year_facets_and_category_intersection_are_exact", async () => {
    const markup = renderToStaticMarkup(
      (await ComparePage({
        searchParams: Promise.resolve({ election2023: "2023-generales", election2025: "2025-legislativas-nacional" }),
      })) as ReactElement,
    );
    const left = markup.slice(
      markup.indexOf('id="compare-election-2023"'),
      markup.indexOf('id="compare-election-2025"'),
    );
    const right = markup.slice(
      markup.indexOf('id="compare-election-2025"'),
      markup.indexOf('id="compare-category"'),
    );
    expect(left).toContain("2023 generales");
    expect(left).not.toContain("2025 legislativas");
    expect(left).not.toContain("2021 generales");
    expect(right).toContain("2025 legislativas");
    expect(right).not.toContain("2023 generales");
    expect(markup).toContain("DIPUTADO NACIONAL");
    expect(markup).not.toContain("SENADOR NACIONAL");
    expect(markup).not.toContain("PARLAMENTARIO DEL MERCOSUR");
    expect(markup).not.toContain(">CATEGORÍA HOMÓNIMA</option>");
    expect(facetCalls.map((call) => call["p_election_id"])).toEqual([
      null, "2023-generales", "2025-legislativas-nacional",
    ]);
  });

  for (const conflictingSide of ["2023", "2025"] as const) {
    it(`test_duplicate_category_names_on_${conflictingSide}_refuse_identically_in_both_row_orders`, async () => {
      const conflictingCategories = [
        { id: "c-diputados", name: "DIPUTADO NACIONAL" },
        { id: "c-diputados", name: "DIPUTADOS NACIONALES" },
      ];
      const exactCategories = [COMMON_CATEGORY];
      const renderSelector = async (categories: FacetCategory[]) => {
        categoryFacetsByElection = {
          "2023-generales":
            conflictingSide === "2023" ? categories : exactCategories,
          "2025-legislativas-nacional":
            conflictingSide === "2025" ? categories : exactCategories,
        };
        return renderToStaticMarkup(
          (await ComparePage({
            searchParams: Promise.resolve({
              election2023: "2023-generales",
              election2025: "2025-legislativas-nacional",
              categoryId: "c-diputados",
            }),
          })) as ReactElement,
        );
      };
      const forwardMarkup = await renderSelector(conflictingCategories);
      const reversedMarkup = await renderSelector([...conflictingCategories].reverse());
      expect(forwardMarkup).toBe(reversedMarkup);
      expect(forwardMarkup).toContain('role="alert"');
      expect(forwardMarkup).toContain("categoría c-diputados");
      expect(forwardMarkup).toContain("2023 generales: DIPUTADO NACIONAL");
      expect(forwardMarkup).toContain("2025 legislativas: DIPUTADO NACIONAL");
      expect(forwardMarkup).toContain("DIPUTADOS NACIONALES");
      expect(forwardMarkup).toContain("no se ofrece ni se acepta");
      expect(forwardMarkup).not.toContain('<option value="c-diputados"');
      expect(resultsRepositoryCalls).toBe(0);
    });
  }

  for (const reverseSides of [false, true]) {
    it(`test_same_category_name_under_different_ids_refuses_with_${reverseSides ? "reversed" : "forward"}_election_sides`, async () => {
      const leftId = reverseSides ? "c-right-homonym" : "c-left-homonym";
      const rightId = reverseSides ? "c-left-homonym" : "c-right-homonym";
      categoryFacetsByElection = {
        "2023-generales": [{ id: "c-exacta", name: "CATEGORÍA EXACTA" }, { id: leftId, name: "CATEGORÍA HOMÓNIMA" }, { id: "left-only", name: "NOMBRE 2023" }],
        "2025-legislativas-nacional": [{ id: "c-exacta", name: "CATEGORÍA EXACTA" }, { id: rightId, name: "CATEGORÍA HOMÓNIMA" }, { id: "right-only", name: "NOMBRE 2025" }],
      };
      for (const categoryId of [leftId, rightId]) {
        const markup = renderToStaticMarkup(
          (await ComparePage({ searchParams: Promise.resolve({ election2023: "2023-generales", election2025: "2025-legislativas-nacional", categoryId }) })) as ReactElement,
        );
        expect(markup).toContain('<option value="c-exacta">CATEGORÍA EXACTA</option>');
        expect(markup).toContain('role="alert"');
        expect(markup).toContain(`2023 generales: CATEGORÍA HOMÓNIMA [ID ${leftId}]`);
        expect(markup).toContain(`2025 legislativas: CATEGORÍA HOMÓNIMA [ID ${rightId}]`);
        expect(markup).toContain("no se ofrece ni se acepta");
        expect(markup).not.toContain(`<option value="${leftId}"`);
        expect(markup).not.toContain(`<option value="${rightId}"`);
        expect(markup).not.toContain("NOMBRE 2023");
        expect(markup).not.toContain("NOMBRE 2025");
      }
      expect(resultsRepositoryCalls).toBe(0);
    });
  }

  it("test_the_canonical_url_derives_national_context_and_legacy_tampering_refuses", async () => {
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

    const served = renderToStaticMarkup(
      (await ComparePage({
        searchParams: Promise.resolve(CANONICAL_PARAMS),
      })) as ReactElement,
    );
    expect(served).toContain("j-027 (jurisdicción completa): sin cambio");

    for (const contradiction of [
      { jurisdictionId: "j-other" },
      { partyCategory: "SENADOR NACIONAL" },
      { partyJurisdiction: "coronel_rosales_municipal" },
    ]) {
      const refused = renderToStaticMarkup(
        (await ComparePage({
          searchParams: Promise.resolve({
            ...CANONICAL_PARAMS,
            ...contradiction,
          }),
        })) as ReactElement,
      );
      expect(refused).toContain("contexto nacional");
      expect(refused).not.toContain("sin cambio");
    }
  });

  it("test_selector_tampering_and_configuration_fail_closed_with_actionable_copy", async () => {
    const wrongYear = renderToStaticMarkup(
      (await ComparePage({
        searchParams: Promise.resolve({
          election2023: "2025-legislativas-nacional",
          election2025: "2023-generales",
        }),
      })) as ReactElement,
    );
    expect(wrongYear).toContain("elección oficial disponible del año indicado");

    const wrongCategory = renderToStaticMarkup(
      (await ComparePage({
        searchParams: Promise.resolve({
          election2023: "2023-generales",
          election2025: "2025-legislativas-nacional",
          categoryId: "c-senadores",
        }),
      })) as ReactElement,
    );
    expect(wrongCategory).toContain("no está disponible en ambas elecciones");
    expect(wrongCategory).not.toContain("no devolvió filas");

    delete process.env["NATIONAL_JURISDICTION_ID"];
    const unconfigured = renderToStaticMarkup(
      (await ComparePage({
        searchParams: Promise.resolve({}),
      })) as ReactElement,
    );
    expect(unconfigured).toContain("configurar la jurisdicción nacional");
    expect(unconfigured).not.toContain("NATIONAL_JURISDICTION_ID");

    process.env["NATIONAL_JURISDICTION_ID"] = "j-027";
    facetsUnavailable = true;
    const unavailable = renderToStaticMarkup(
      (await ComparePage({
        searchParams: Promise.resolve({}),
      })) as ReactElement,
    );
    expect(unavailable).toContain(
      "No se pudieron cargar las elecciones disponibles",
    );
    expect(unavailable).not.toContain("facets offline");
    expect(unavailable).not.toContain("results_exploration_facets");
  });
});

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
      (await ComparePage({
        searchParams: Promise.resolve(PARAMS),
      })) as ReactElement,
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
      (await ComparePage({
        searchParams: Promise.resolve(PARAMS),
      })) as ReactElement,
    );

    expect(markup).toContain("sin cambio");
    expect(markup).not.toContain("cambió de");
    expect(markup).not.toContain("20135");
    expect(markup).not.toContain("0 de");
    expect(markup).not.toContain("no tienen id de lista");
  });
});

describe("compare page — canonical display names must be unambiguous", () => {
  it("test_conflicting_names_refuse_identically_in_both_row_orders", async () => {
    const base = {
      jurisdictionId: "j-027",
      categoryId: "c-diputados",
      sourceKind: "official" as const,
      granularity: "mesa" as const,
      archiveEntryId: "national/2023-generales",
    };
    const conflictingRows = [
      { ...base, listId: "20135", votes: 40 },
      { ...base, listId: "20136", votes: 40 },
      { ...base, listId: "20135", votes: 20 },
    ];
    rowsByElection["2025-legislativas-nacional"] = [
      {
        ...base,
        listId: "110",
        votes: 120,
        archiveEntryId: "national/2025-legislativas",
      },
    ];

    rowsByElection["2023-generales"] = conflictingRows;
    const forwardMarkup = renderToStaticMarkup(
      (await ComparePage({
        searchParams: Promise.resolve(PARAMS),
      })) as ReactElement,
    );
    rowsByElection["2023-generales"] = [...conflictingRows].reverse();
    const reversedMarkup = renderToStaticMarkup(
      (await ComparePage({
        searchParams: Promise.resolve(PARAMS),
      })) as ReactElement,
    );

    expect(forwardMarkup).toBe(reversedMarkup);
    expect(forwardMarkup).toContain("Se rechazó la comparación");
    expect(forwardMarkup).toContain("2023");
    expect(forwardMarkup).toContain("ID canónico lla");
    expect(forwardMarkup).toContain(
      "ID canónico lla: ALIANZA LA LIBERTAD AVANZA, LA LIBERTAD AVANZA. No se",
    );
    expect(forwardMarkup).not.toContain('aria-label="granularidad:');
    expect(forwardMarkup).not.toContain("sin cambio");
    expect(forwardMarkup).not.toContain("cambió de");
    expect(forwardMarkup).not.toContain("puntos porcentuales");
    expect(forwardMarkup).not.toContain("%");
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

  it("test_a_same_granularity_legacy_aggregate_request_is_visibly_unsupported", async () => {
    const base = { jurisdictionId: "j-027", categoryId: "c-diputados", votes: 10, sourceKind: "official" as const, granularity: "mesa" as const, archiveEntryId: "national/x" };
    rowsByElection["2023-generales"] = [{ ...base, listId: "20135" }]; rowsByElection["2025-legislativas-nacional"] = [{ ...base, listId: "110" }];
    const markup = renderToStaticMarkup((await ComparePage({ searchParams: Promise.resolve({ ...PARAMS, aggregateTo: "seccion" }) })) as ReactElement);
    expect(markup).toMatch(/role="alert".*aggregateTo<\/code> no está disponible actualmente.*jerarquía completa de descendientes/);
    expect(markup).not.toMatch(/sin cambio|agregado a partir de datos/);
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
      {
        ...base,
        granularity: "mesa",
        archiveEntryId: "national/2025-legislativas",
      },
    ];

    const markup = renderToStaticMarkup(
      (await ComparePage({
        searchParams: Promise.resolve(PARAMS),
      })) as ReactElement,
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
      (await ComparePage({
        searchParams: Promise.resolve(PARAMS),
      })) as ReactElement,
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
      {
        ...base,
        listId: "88888",
        archiveEntryId: "national/2025-legislativas",
      },
    ];

    const markup = renderToStaticMarkup(
      (await ComparePage({
        searchParams: Promise.resolve(PARAMS),
      })) as ReactElement,
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
  const row = (
    electionId: string,
    granularity: ResultRow["granularity"],
    listId: string,
  ) => ({
    jurisdictionId: "j-027",
    categoryId: "c-diputados",
    listId,
    votes: 10,
    sourceKind: "official" as const,
    granularity,
    archiveEntryId: `national/${electionId}`,
  });

  it("test_a_granularity_mismatch_refuses_without_suggesting_an_unavailable_retry", async () => {
    // D6 is this page's stated reason to exist and had no entry-point test.
    rowsByElection["2023-generales"] = [
      row("2023-generales", "seccion", "20135"),
    ];
    rowsByElection["2025-legislativas-nacional"] = [
      row("2025-legislativas-nacional", "mesa", "110"),
    ];

    const markup = renderToStaticMarkup(
      (await ComparePage({
        searchParams: Promise.resolve(PARAMS),
      })) as ReactElement,
    );

    expect(markup).toContain('role="alert"');
    expect(markup).toContain("Esta comparación no hace suposiciones");
    expect(markup).not.toContain("Vuelva a solicitar");
    expect(markup).not.toContain("aggregateTo");
    expect(markup).not.toContain("sin cambio");
  });

  it("test_a_mixed_granularity_legacy_aggregate_request_is_visibly_unsupported", async () => {
    rowsByElection["2023-generales"] = [
      row("2023-generales", "distrito", "20135"),
    ];
    rowsByElection["2025-legislativas-nacional"] = [
      row("2025-legislativas-nacional", "mesa", "110"),
    ];

    const markup = renderToStaticMarkup(
      (await ComparePage({
        searchParams: Promise.resolve({ ...PARAMS, aggregateTo: "mesa" }),
      })) as ReactElement,
    );

    expect(markup).toContain('role="alert"');
    expect(markup).toContain(
      "<code>aggregateTo</code> no está disponible actualmente",
    );
    expect(markup).toContain("jerarquía completa de descendientes");
    expect(markup).not.toContain('aria-label="granularidad:');
    expect(markup).not.toContain("sin cambio");
    expect(markup).not.toContain("agregado a partir de datos");
    expect(resultsRepositoryCalls).toBe(0);
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
      {
        ...base,
        listId: "20135",
        granularity: "seccion",
        sourceKind: "fiscalizacion",
      },
    ];
    rowsByElection["2025-legislativas-nacional"] = [
      { ...base, granularity: "mesa" },
    ];

    const markup = renderToStaticMarkup(
      (await ComparePage({
        searchParams: Promise.resolve(PARAMS),
      })) as ReactElement,
    );

    expect(markup).toContain("1 fila fiscalización");
  });
});

describe("compare page — path 3 fires when the repository filter regresses", () => {
  it("test_leaked_rows_are_audited_but_never_enter_comparable_tallies", async () => {
    leakFiscalizacion = true;
    const base = {
      jurisdictionId: "j-027",
      categoryId: "c-diputados",
      listId: "110",
      granularity: "mesa" as const,
    };
    rowsByElection["2023-generales"] = [
      {
        ...base,
        votes: 20,
        sourceKind: "official",
        archiveEntryId: "national/2023-generales",
      },
      {
        ...base,
        votes: 10,
        sourceKind: "fiscalizacion",
        archiveEntryId: "fiscalizacion/2025-lla",
      },
    ];
    rowsByElection["2025-legislativas-nacional"] = [
      {
        ...base,
        votes: 30,
        sourceKind: "official",
        archiveEntryId: "national/2025-legislativas",
      },
    ];

    const markup = renderToStaticMarkup(
      (await ComparePage({
        searchParams: Promise.resolve(PARAMS),
      })) as ReactElement,
    );

    expect(markup).toContain(
      "2023-generales: 1 fila fiscalización / 10 votos; 2025-legislativas-nacional: ninguna",
    );
    expect(markup.match(/110: 1 filas/g)).toHaveLength(2);
    expect(markup).toContain("110: 1 filas, 20 votos");
    expect(markup).toContain("110: 1 filas, 30 votos");
    expect(markup).not.toContain("110: 2 filas");
    expect(markup).toContain("no son oficiales");
    expect(markup).not.toContain("sin cambio");
  });
});

describe("compare page — provenance reaches the render", () => {
  it("test_every_displayed_figure_traces_to_an_archived_source", async () => {
    sourceRefs = [
      {
        archiveEntryId: "national/2025-legislativas",
        sha256:
          "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
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
      (await ComparePage({
        searchParams: Promise.resolve(PARAMS),
      })) as ReactElement,
    );

    expect(markup).toContain("https://example.test/2025-legislativas.zip");
  });
});

describe("compare page — a tied leader is not a flip", () => {
  it("test_a_tied_leader_names_the_unit_year_and_parties_without_figures", async () => {
    const base = {
      jurisdictionId: "j-027",
      categoryId: "c-diputados",
      sourceKind: "official" as const,
      granularity: "mesa" as const,
      archiveEntryId: "national/x",
    };
    rowsByElection["2023-generales"] = [
      { ...base, listId: "20999", votes: 50 },
      { ...base, listId: "20135", votes: 50 },
    ];
    rowsByElection["2025-legislativas-nacional"] = [
      { ...base, listId: "110", votes: 60 },
      { ...base, listId: "999", votes: 40 },
    ];

    const markup = renderToStaticMarkup(
      (await ComparePage({
        searchParams: Promise.resolve(PARAMS),
      })) as ReactElement,
    );

    expect(markup).toContain("Se rechazó la comparación");
    expect(markup).toContain("j-027");
    expect(markup).toContain("2023");
    expect(markup).toContain("LA LIBERTAD AVANZA, UNION POR LA PATRIA");
    expect(markup).not.toContain('aria-label="granularidad:');
    expect(markup).not.toContain("<ul>");
    expect(markup).not.toContain("sin cambio");
    expect(markup).not.toContain("cambió de");
    expect(markup).not.toContain("puntos porcentuales");
    expect(markup).not.toContain("%");
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
      (await ComparePage({
        searchParams: Promise.resolve(PARAMS),
      })) as ReactElement,
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
      (await ComparePage({
        searchParams: Promise.resolve(PARAMS),
      })) as ReactElement,
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

describe("compare page — row-to-figure metadata is not D6 provenance", () => {
  it("test_distrito_rows_disclose_degraded_detail_without_claiming_aggregation", async () => {
    const base = {
      jurisdictionId: "j-027",
      categoryId: "c-diputados",
      votes: 100,
      sourceKind: "official" as const,
      granularity: "distrito" as const,
      archiveEntryId: "national/x",
    };
    rowsByElection["2023-generales"] = [{ ...base, listId: "20135" }];
    rowsByElection["2025-legislativas-nacional"] = [{ ...base, listId: "110" }];

    const markup = renderToStaticMarkup(
      (await ComparePage({ searchParams: Promise.resolve(PARAMS) })) as ReactElement,
    );

    expect(markup).toContain('aria-label="granularidad: seccion');
    expect(markup).toContain("degradada desde distrito");
    expect(markup).toContain("la fuente publicó totales a nivel distrito");
    expect(markup).toContain("sin cambio");
    expect(markup).not.toContain("agregado a partir de datos");
    expect(markup).not.toContain("decisión explícita del operador");
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
      (await ComparePage({
        searchParams: Promise.resolve(PARAMS),
      })) as ReactElement,
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
        searchParams: Promise.resolve({
          ...PARAMS,
          partyCategory: "SENADOR NACIONAL",
        }),
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
      (await ComparePage({
        searchParams: Promise.resolve(PARAMS),
      })) as ReactElement,
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
      sourceKind: "official" as const,
      archiveEntryId: "national/x",
    };
    rowsByElection["2023-generales"] = [
      { ...base, votes: 400, granularity: "seccion" as const },
      { ...base, votes: 100, granularity: "mesa" as const },
      {
        ...base,
        votes: 5,
        granularity: "mesa" as const,
        sourceKind: "fiscalizacion" as const,
        archiveEntryId: "fiscalizacion/2025-lla",
      },
    ];
    rowsByElection["2025-legislativas-nacional"] = [
      { ...base, votes: 60, granularity: "mesa" as const },
    ];

    const markup = renderToStaticMarkup(
      (await ComparePage({
        searchParams: Promise.resolve(PARAMS),
      })) as ReactElement,
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
      (await ComparePage({
        searchParams: Promise.resolve(PARAMS),
      })) as ReactElement,
    );

    // ONE row for 2023 and TWO for 2025 — not three on a merged line.
    expect(markup).toContain(
      "2023-generales: 1 fila(s) tienen un nivel de granularidad",
    );
    expect(markup).toContain(
      "2025-legislativas-nacional: 2 fila(s) tienen un nivel de granularidad",
    );
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
      (await ComparePage({
        searchParams: Promise.resolve(PARAMS),
      })) as ReactElement,
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
    const base = {
      jurisdictionId: "j-027",
      categoryId: "c-diputados",
      sourceKind: "official" as const,
      granularity: "mesa" as const,
      archiveEntryId: "national/2025-legislativas",
    };
    rowsByElection["2023-generales"] = [
      { ...base, listId: "20135", votes: 100 },
      { ...base, listId: "20135-nameless", votes: 33 },
    ];
    rowsByElection["2025-legislativas-nacional"] = [
      { ...base, listId: "110", votes: 140 },
    ];

    const markup = renderToStaticMarkup(
      (await ComparePage({
        searchParams: Promise.resolve(PARAMS),
      })) as ReactElement,
    );

    expect(markup).toContain("se resolvieron sin un partido curado");
    expect(markup).toContain("20135-nameless: 1 filas, 33 votos");
    expect(markup).not.toContain("no tienen id de lista");
    expect(markup).not.toContain('<th scope="row"></th>');
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
      (await ComparePage({
        searchParams: Promise.resolve(PARAMS),
      })) as ReactElement,
    );

    // The D6 refusal itself...
    expect(markup).toContain("Esta comparación no hace suposiciones");
    // ...and the disclosure it used to return without.
    expect(markup).toContain("no tienen id de lista");
    expect(markup).toContain("1 fila oficial / 31 votos");
    expect(markup).toContain("1 fila oficial / 17 votos");
  });
});

describe("compare page — the shared unmapped audit survives independent refusals", () => {
  type AuditRow = readonly [
    listId: ResultRow["listId"],
    votes: number,
    granularity: ResultRow["granularity"],
    mesaTipo?: ResultRow["mesaTipo"],
  ];
  interface AuditScenario {
    name: string;
    refusal: string;
    setup: () => Record<string, string>;
    unmappedSnippet?: string;
  }

  function auditRow(electionId: string, row: AuditRow): ResultRow {
    const [listId, votes, granularity, mesaTipo] = row;
    return {
      jurisdictionId: "j-027",
      categoryId: "c-diputados",
      listId,
      votes,
      sourceKind: "official",
      granularity,
      archiveEntryId: `national/${electionId}`,
      ...(mesaTipo === undefined ? {} : { mesaTipo }),
    };
  }

  function setupAudit(
    rows2023: readonly AuditRow[],
    rows2025: readonly AuditRow[],
    params: Record<string, string> = PARAMS,
  ): Record<string, string> {
    rowsByElection["2023-generales"] = rows2023.map((row) =>
      auditRow("2023-generales", row),
    );
    rowsByElection["2025-legislativas-nacional"] = rows2025.map((row) =>
      auditRow("2025-legislativas-nacional", row),
    );
    return params;
  }

  const scenarios: AuditScenario[] = [
    {
      name: "name_conflict",
      refusal: "nombres de visualización en conflicto",
      unmappedSnippet: "4321: 1 filas, 5 votos",
      setup: () =>
        setupAudit(
          [["20135", 50, "mesa"], ["20136", 40, "mesa"], ["4321", 5, "mesa"], [null, 31, "mesa"]],
          [["110", 100, "mesa"], [null, 17, "mesa"]],
        ),
    },
    {
      name: "mixed_granularity",
      refusal: "Esta comparación no hace suposiciones",
      setup: () => setupAudit([["20135", 100, "seccion"], [null, 31, "seccion"]], [["110", 140, "mesa"], [null, 17, "mesa"]]),
    },
    {
      name: "mesa_partial_coverage",
      refusal: "cobertura parcial de mesa_tipo",
      setup: () => setupAudit([["20135", 100, "mesa", "NATIVOS"], [null, 31, "mesa", null]], [["110", 140, "mesa", "NATIVOS"], [null, 17, "mesa", "NATIVOS"]]),
    },
    {
      name: "ambiguous_leader",
      refusal: "no hay un líder único",
      setup: () => setupAudit([["20135", 50, "mesa"], ["20999", 50, "mesa"], [null, 31, "mesa"]], [["110", 60, "mesa"], ["999", 40, "mesa"], [null, 17, "mesa"]]),
    },
    {
      name: "invalid_comparison_input",
      refusal: "datos de comparación inválidos",
      setup: () => setupAudit([["20135", -1, "mesa"], [null, 31, "mesa"]], [["110", 140, "mesa"], [null, 17, "mesa"]]),
    },
    {
      name: "post_fold_provenance_failure",
      refusal: "source refs offline",
      setup: () => {
        sourceRefsFailure = new Error("source refs offline");
        return setupAudit([["20135", 100, "mesa"], [null, 31, "mesa"]], [["110", 140, "mesa"], [null, 17, "mesa"]]);
      },
    },
  ];

  for (const scenario of scenarios) {
    it(`test_${scenario.name}_keeps_each_years_unmapped_audit_without_figures`, async () => {
      const markup = renderToStaticMarkup(
        (await ComparePage({ searchParams: Promise.resolve(scenario.setup()) })) as ReactElement,
      );
      expect(markup).toContain(scenario.refusal);
      expect(markup.match(/2023-generales: 1 fila\(s\) no tienen id de lista/g)).toHaveLength(1);
      expect(markup.match(/2025-legislativas-nacional: 1 fila\(s\) no tienen id de lista/g)).toHaveLength(1);
      expect(markup).toContain("1 fila oficial / 31 votos");
      expect(markup).toContain("1 fila oficial / 17 votos");
      if (scenario.unmappedSnippet) {
        expect(markup).toContain(scenario.unmappedSnippet);
      }
      expect(markup).not.toContain('aria-label="granularidad:');
      expect(markup).not.toContain("sin cambio");
      expect(markup).not.toContain("cambió de");
      expect(markup).not.toContain("puntos porcentuales");
    });
  }
});

describe("compare page — independent official reads", () => {
  it("test_one_failure_preserves_the_successful_sides_exact_source_exclusions", async () => {
    refuseElection = "2023-generales";
    rowsByElection["2025-legislativas-nacional"] = [
      {
        jurisdictionId: "j-027",
        categoryId: "c-diputados",
        listId: "110",
        votes: 30,
        sourceKind: "official",
        granularity: "mesa",
        archiveEntryId: "national/2025-legislativas",
      },
      {
        jurisdictionId: "j-027",
        categoryId: "c-diputados",
        listId: "110",
        votes: 7,
        sourceKind: "fiscalizacion",
        granularity: "mesa",
        archiveEntryId: "fiscalizacion/2025-lla",
      },
    ];

    const markup = renderToStaticMarkup(
      (await ComparePage({ searchParams: Promise.resolve(PARAMS) })) as ReactElement,
    );
    expect(markup).toContain("No se pudo leer 2023-generales");
    expect(markup).toContain("2025-legislativas-nacional: 1 fila fiscalización / 7 votos");
    expect(markup).not.toContain("2023-generales: 1 fila fiscalización");
    expect(markup).not.toContain("sin cambio");
  });

  it("test_two_failures_name_both_without_fabricating_exclusions_or_figures", async () => {
    refuseElection = "*";
    const markup = renderToStaticMarkup(
      (await ComparePage({ searchParams: Promise.resolve(PARAMS) })) as ReactElement,
    );
    expect(markup).toContain("2023-generales: row-level security denied 2023-generales");
    expect(markup).toContain("2025-legislativas-nacional: row-level security denied 2025-legislativas-nacional");
    expect(markup).not.toContain("Filas excluidas");
    expect(markup).not.toContain("sin cambio");
    expect(markup).not.toContain("cambió de");
  });
});

describe("compare page — official rows need comparable party identities", () => {
  const row = (listId: string | null, votes: number): ResultRow => ({
    jurisdictionId: "j-027",
    categoryId: "c-diputados",
    listId,
    votes,
    sourceKind: "official",
    granularity: "mesa",
    archiveEntryId: "national/x",
  });

  it("test_both_years_with_only_null_list_ids_refuse_with_per_year_breakdowns", async () => {
    rowsByElection["2023-generales"] = [row(null, 12)];
    rowsByElection["2025-legislativas-nacional"] = [row(null, 8)];
    const markup = renderToStaticMarkup(
      (await ComparePage({ searchParams: Promise.resolve(PARAMS) })) as ReactElement,
    );
    expect(markup).toContain("sin identidades partidarias comparables");
    expect(markup).toContain("2023-generales: 1 fila(s) no tienen id de lista");
    expect(markup).toContain(
      "2025-legislativas-nacional: 1 fila(s) no tienen id de lista",
    );
    expect(markup).toContain("1 fila oficial / 12 votos");
    expect(markup).toContain("1 fila oficial / 8 votos");
    expect(markup).not.toContain("sin cambio");
    expect(markup).not.toContain("cambió de");
  });

  it("test_one_year_without_comparable_identities_refuses_the_whole_result", async () => {
    rowsByElection["2023-generales"] = [row(null, 12)];
    rowsByElection["2025-legislativas-nacional"] = [row("110", 140)];
    const markup = renderToStaticMarkup(
      (await ComparePage({ searchParams: Promise.resolve(PARAMS) })) as ReactElement,
    );
    expect(markup).toContain("sin identidades partidarias comparables");
    expect(markup).toContain("2023-generales");
    expect(markup).toContain("1 fila oficial / 12 votos");
    expect(markup).not.toContain("sin cambio");
    expect(markup).not.toContain("cambió de");
  });
});

describe("compare page — mesa population metadata reaches the operator", () => {
  const row = (year: 2023 | 2025, votes: number, mesaTipo: string | null) => ({
    jurisdictionId: "j-027",
    categoryId: "c-diputados",
    listId: year === 2023 ? "20135" : "110",
    votes,
    sourceKind: "official" as const,
    granularity: "mesa" as const,
    archiveEntryId: `national/${year}`,
    mesaTipo,
  });

  it("test_fully_tagged_population_mismatch_preserves_every_type_in_one_unit", async () => {
    rowsByElection["2023-generales"] = [
      row(2023, 60, "NATIVOS"),
      row(2023, 5, "EXTRANJEROS"),
    ];
    rowsByElection["2025-legislativas-nacional"] = [row(2025, 55, "NATIVOS")];
    const markup = renderToStaticMarkup(
      (await ComparePage({ searchParams: Promise.resolve(PARAMS) })) as ReactElement,
    );
    expect(markup).toContain("La población de mesas no coincide");
    expect(markup).toContain("2023: EXTRANJEROS, NATIVOS");
    expect(markup).toContain("2025: NATIVOS");
  });

  it("test_partial_tagging_refuses_with_known_and_unknown_counts_without_figures", async () => {
    rowsByElection["2023-generales"] = [
      row(2023, 60, "NATIVOS"),
      row(2023, 5, null),
    ];
    rowsByElection["2025-legislativas-nacional"] = [row(2025, 55, "NATIVOS")];
    const markup = renderToStaticMarkup(
      (await ComparePage({ searchParams: Promise.resolve(PARAMS) })) as ReactElement,
    );
    expect(markup).toContain("cobertura parcial de mesa_tipo");
    expect(markup).toContain("2023: tipos conocidos NATIVOS");
    expect(markup).toContain("1 fila etiquetada");
    expect(markup).toContain("1 fila sin etiqueta");
    expect(markup).not.toContain('aria-label="granularidad:');
    expect(markup).not.toContain("sin cambio");
    expect(markup).not.toContain("cambió de");
  });

  it("test_matching_complete_population_metadata_emits_no_diagnostic", async () => {
    rowsByElection["2023-generales"] = [row(2023, 60, "NATIVOS")];
    rowsByElection["2025-legislativas-nacional"] = [row(2025, 55, "NATIVOS")];
    const markup = renderToStaticMarkup(
      (await ComparePage({ searchParams: Promise.resolve(PARAMS) })) as ReactElement,
    );
    expect(markup).not.toContain("La población de mesas no coincide");
    expect(markup).not.toContain("cobertura parcial de mesa_tipo");
    expect(markup).toContain("sin cambio");
  });
});

describe("compare page — numeric comparison reaches the display", () => {
  it("test_each_canonical_party_renders_both_year_shares_and_percentage_point_swing", async () => {
    const base = {
      jurisdictionId: "j-027",
      categoryId: "c-diputados",
      sourceKind: "official" as const,
      granularity: "mesa" as const,
      archiveEntryId: "national/x",
    };
    rowsByElection["2023-generales"] = [
      { ...base, listId: "20135", votes: 60 },
      { ...base, listId: "20999", votes: 40 },
    ];
    rowsByElection["2025-legislativas-nacional"] = [
      { ...base, listId: "110", votes: 55 },
      { ...base, listId: "999", votes: 45 },
    ];

    const markup = renderToStaticMarkup(
      (await ComparePage({ searchParams: Promise.resolve(PARAMS) })) as ReactElement,
    );
    expect(markup).toContain('aria-label="Participación y variación por partido en j-027"');
    expect(markup).toContain("LA LIBERTAD AVANZA");
    expect(markup).toContain("ALIANZA LA LIBERTAD AVANZA");
    expect(markup).toContain("UNION POR LA PATRIA");
    expect(markup).toContain("FUERZA PATRIA");
    expect(markup).toContain("60,00 %");
    expect(markup).toContain("55,00 %");
    expect(markup).toContain("40,00 %");
    expect(markup).toContain("45,00 %");
    expect(markup).toContain("-5,00 puntos porcentuales");
    expect(markup).toContain("+5,00 puntos porcentuales");
    expect(markup).not.toContain(">lla<");
    expect(markup).not.toContain(">fp<");
  });
});
