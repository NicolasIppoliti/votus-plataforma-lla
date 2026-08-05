import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ResultsRepository } from "@/lib/fiscalizacion/repository";
import type { PartyNameSource, ResultRow, RowSource } from "@/lib/fiscalizacion/repository";
import type { SourceRef } from "@/lib/results/types";
import { MUNICIPAL_PARTY_CONTEXT, loadMunicipalView, renderMunicipalView } from "./page";

/**
 * Phase 16c: `curated/party_map.yaml`'s `coronel_rosales_municipal`
 * mappings (list 2206 = the LLA+PRO alliance, Phase 15) were loaded but
 * unreachable — no route ever called `repository.queryOfficial` with the
 * municipal `PartyMappingContext`. This is this project's 8th instance of
 * shipped-correct, tested, unreachable code.
 *
 * Reads ONLY through `ResultsRepository.queryOfficial` — never a second
 * query path that could bypass the `source_kind = 'official'` default
 * (D9.1 threat-matrix control).
 */

function fakeRowSource(rows: ResultRow[]): RowSource {
  return { fetchRows: () => Promise.resolve(rows) };
}

function fakePartyNameSource(namesByListId: Record<string, string>): PartyNameSource {
  return {
    fetchPartyNames: (_context, listIds) => {
      const resolved = new Map<string, { canonicalPartyId: string; displayName: string }>();
      for (const listId of listIds) {
        const name = namesByListId[listId];
        // The canonical id is what identifies the party; the name is display.
        if (name) resolved.set(listId, { canonicalPartyId: `canon-${listId}`, displayName: name });
      }
      return Promise.resolve(resolved);
    },
  };
}

const QUERY = {
  electionId: "2025-legislativas-municipal",
  jurisdictionId: "j-027",
  categoryId: "c-concejales",
};

const MUNICIPAL_ROWS: ResultRow[] = [
  {
    jurisdictionId: "j-027",
    categoryId: "c-concejales",
    listId: "2206",
    votes: 4200,
    sourceKind: "official",
    // The PBA municipal source publishes DISTRITO totals, never mesa.
    granularity: "distrito",
    archiveEntryId: "pba/2025-municipal-coronel-rosales",
  },
];

describe("municipal page — loadMunicipalView", () => {
  it("test_route_renders_pba_municipal_results_with_resolved_party_names", async () => {
    const repository = new ResultsRepository(
      fakeRowSource(MUNICIPAL_ROWS),
      fakePartyNameSource({ "2206": "ALIANZA LA LIBERTAD AVANZA" }),
    );
    const queryOfficialSpy = vi.spyOn(repository, "queryOfficial");

    const view = await loadMunicipalView(repository, QUERY);

    expect(queryOfficialSpy).toHaveBeenCalledWith(QUERY, MUNICIPAL_PARTY_CONTEXT);
    expect(view.status).toBe("ok");
    if (view.status !== "ok") throw new Error("expected ok status");
    expect(view.rows[0]?.partyName).toBe("ALIANZA LA LIBERTAD AVANZA");

    const html = renderToStaticMarkup(renderMunicipalView(view));
    expect(html).toContain("ALIANZA LA LIBERTAD AVANZA");
  });
});

describe("municipal page — renderMunicipalView", () => {
  it("test_a_coarse_source_is_labelled_by_the_jurisdiction_never_by_the_province", () => {
    const html = renderToStaticMarkup(
      renderMunicipalView({
        status: "ok",
        rows: [{ ...MUNICIPAL_ROWS[0]!, partyName: "ALIANZA LA LIBERTAD AVANZA" }],
        excluded: {},
      }),
    );

    // NOT `distrito`. The query filters one `jurisdiction_id`, so the figure
    // covers one partido however the source labelled its rows — announcing the
    // province is the 32.291-vote misattribution rule 8 records.
    expect(html).toContain('granularity: seccion');
    expect(html).not.toContain('granularity: mesa');
    expect(html).not.toContain('granularity: distrito');
    // provenance-display spec: a degraded-granularity figure MUST visibly note
    // it. The source published distrito, so what is missing is everything
    // below the partido — named by the level the rows actually carried.
    expect(html.toLowerCase()).toContain("degraded from distrito");
  });
});

let entryPointRows: ResultRow[] = [];
let entryPointSources: SourceRef[] = [];

afterEach(() => {
  entryPointRows = [];
  entryPointSources = [];
  delete process.env["MUNICIPAL_JURISDICTION_ID"];
  delete process.env["MUNICIPAL_CATEGORY_ID"];
});

describe("municipal page — the badge describes the rows, not a memory of them", () => {
  it("test_granularity_badge_reports_what_the_rows_actually_carry", () => {
    // Phase 17 changed what PBA ingestion WRITES: a partido total is a
    // seccion-level figure in the national scheme, so `resolve_pba_jurisdictions`
    // now stores `granularity: "seccion"`. The badge stayed hardcoded to
    // `distrito`, so the page asserts a level the data contradicts — and the
    // fixture hardcoded `distrito` too, which is why nothing caught it.
    const html = renderToStaticMarkup(
      renderMunicipalView({
        status: "ok",
        rows: [{ ...MUNICIPAL_ROWS[0]!, granularity: "seccion" }],
        excluded: {},
      }),
    );

    expect(html).toContain("seccion");
    expect(html).not.toMatch(/granularity[^>]*distrito/);
  });

  it("test_mixed_granularity_rows_withhold_the_figure_rather_than_double_count", () => {
    const html = renderToStaticMarkup(
      renderMunicipalView({
        status: "ok",
        rows: [
          { ...MUNICIPAL_ROWS[0]!, granularity: "seccion" },
          { ...MUNICIPAL_ROWS[0]!, granularity: "distrito" },
        ],
        excluded: {},
      }),
    );

    // A `distrito` row already contains the `seccion` row beneath it, so the
    // two 4200-vote rows rendered 8400 for a party that got 4200. The page
    // announced the mix and summed across it anyway.
    expect(html).toContain("summing them would double-count");
    expect(html).toContain("No per-party figures");
    // And NO badge: `readGranularity` folds to the coarsest level, so a badge
    // beside the refusal names one of the mixed levels as if it were the set's.
    expect(html).not.toContain('aria-label="granularity:');
    expect(html).not.toContain("8400");
  });
});

/**
 * `MunicipalPage` — the default export that composes the two functions above,
 * resolves `searchParams` and calls `fetchSourceRefs` — had no test. Its
 * siblings in this change (`compare`, `drilldown`, `simulate`) all drive
 * theirs, and rule 1 is the reason.
 */
vi.mock("@/lib/supabase/server-client", () => ({
  createSupabaseServerClient: () => Promise.resolve({}),
}));

vi.mock("@/lib/fiscalizacion/repository", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/fiscalizacion/repository")>();
  return {
    ...actual,
    createResultsRepository: () =>
      Promise.resolve(
        new actual.ResultsRepository(
          { fetchRows: () => Promise.resolve(entryPointRows) },
          {
            // Resolves ONLY for this route's own mapping family. Ignoring the
            // context made the test pass whether `MUNICIPAL_PARTY_CONTEXT` or
            // some other context reached the source — so it proved nothing
            // about the wiring it exists to check.
            fetchPartyNames: (context) =>
              Promise.resolve(
                context.jurisdiction === MUNICIPAL_PARTY_CONTEXT.jurisdiction &&
                context.category === MUNICIPAL_PARTY_CONTEXT.category
                  ? new Map([
                      ["110", { canonicalPartyId: "lla", displayName: "LA LIBERTAD AVANZA" }],
                    ])
                  : new Map(),
              ),
          },
        ),
      ),
    fetchSourceRefs: () => Promise.resolve({ sources: entryPointSources, missing: [] }),
  };
});

describe("municipal page — the real entry point", () => {
  beforeEach(() => {
    process.env["MUNICIPAL_JURISDICTION_ID"] = "j-027";
    process.env["MUNICIPAL_CATEGORY_ID"] = "c-concejales";
  });

  it("test_the_data_path_reaches_the_render_with_its_sources", async () => {
    // The missing-params branch was the only one driven. `sources` reaching
    // `renderMunicipalView` — the whole `createResultsRepository` ->
    // `loadMunicipalView` -> `fetchSourceRefs` chain — had no entry-point test.
    const { default: MunicipalPage } = await import("./page");
    entryPointRows = [{ ...MUNICIPAL_ROWS[0]!, listId: "110" }];
    entryPointSources = [
      {
        archiveEntryId: "pba/2025-municipal-coronel-rosales",
        sha256: "aaaabbbbccccdddd0000111122223333444455556666777788889999aaaabbbb",
        url: "https://example.test/pba-2023.html",
        fetchedAt: "2026-01-01T00:00:00Z",
      },
    ];

    const markup = renderToStaticMarkup(
      (await MunicipalPage({
        searchParams: Promise.resolve({
          electionId: "2025-municipal",
          jurisdictionId: "j-027",
          categoryId: "c-concejales",
        }),
      })) as ReactElement,
    );

    expect(markup).toContain("LA LIBERTAD AVANZA");
    expect(markup).toContain("https://example.test/pba-2023.html");
  });

  it("test_the_page_asks_for_the_parameters_it_needs", async () => {
    const { default: MunicipalPage } = await import("./page");

    const markup = renderToStaticMarkup(
      (await MunicipalPage({ searchParams: Promise.resolve({}) })) as ReactElement,
    );

    expect(markup).toContain("electionId");
    expect(markup).not.toContain("No municipal results found");
  });
});

describe("municipal page — a failed read is not an opt-in prompt", () => {
  it("test_a_denied_read_is_reported_with_its_own_status", async () => {
    // A denied read RAISES. Reusing the leakage guard's
    // `requires_explicit_unofficial_opt_in` for it would make any consumer
    // branching on that status offer an unofficial-data prompt for a read that
    // simply failed.
    const repository = new ResultsRepository({
      fetchRows: () => Promise.reject(new Error("row-level security denied the read")),
    });

    const view = await loadMunicipalView(repository, {
      electionId: "2025-municipal",
      jurisdictionId: "j-027",
      categoryId: "c-concejales",
    });

    expect(view.status).toBe("read_failed");
    if (view.status !== "read_failed") throw new Error("expected read_failed");
    expect(view.reason).toContain("row-level security denied the read");

    const html = renderToStaticMarkup(renderMunicipalView(view));
    expect(html).toContain("row-level security denied the read");
  });
});

describe("municipal page — the mapping is fixed to one race", () => {
  it("test_an_election_outside_the_mapping_year_is_refused", async () => {
    process.env["MUNICIPAL_JURISDICTION_ID"] = "j-027";
    process.env["MUNICIPAL_CATEGORY_ID"] = "c-concejales";
    const { default: MunicipalPage } = await import("./page");

    const markup = renderToStaticMarkup(
      (await MunicipalPage({
        searchParams: Promise.resolve({
          electionId: "2023-municipal",
          jurisdictionId: "j-027",
          categoryId: "c-concejales",
        }),
      })) as ReactElement,
    );

    // The 2023 list ids are NOT the 2025 ones; resolving them through this
    // table names the wrong parties.
    expect(markup).toContain("Refused");
    expect(markup).toContain("2023-municipal");
  });
});

describe("municipal page — the race is pinned, not taken from the request", () => {
  it("test_another_category_is_refused_not_named_through_this_mapping", async () => {
    process.env["MUNICIPAL_JURISDICTION_ID"] = "j-027";
    process.env["MUNICIPAL_CATEGORY_ID"] = "c-concejales";
    const { default: MunicipalPage } = await import("./page");

    const markup = renderToStaticMarkup(
      (await MunicipalPage({
        searchParams: Promise.resolve({
          electionId: "2025-municipal",
          jurisdictionId: "j-027",
          categoryId: "c-diputados",
        }),
      })) as ReactElement,
    );

    expect(markup).toContain("Refused");
    expect(markup).toContain("c-diputados");
  });
});

describe("municipal page — a drop stays visible through a later failure", () => {
  it("test_the_excluded_breakdown_survives_a_source_read_failure", () => {
    // The count existed before the failure; rebuilding the view without it
    // hid a real drop behind a refusal about something else.
    const html = renderToStaticMarkup(
      renderMunicipalView({
        status: "read_failed",
        reason: "row-level security denied the source read",
        excluded: {
          fiscalizacion: { rows: 3, votes: 120 },
          unknown: { rows: 1, votes: 7 },
        },
      }),
    );

    expect(html).toContain("row-level security denied the source read");
    expect(html).toContain("3 fiscalizacion row(s) / 120 vote(s)");
    // The VOTES too: a 3-row drop of 120 votes and a 3-row drop of 6 read
    // identically when only the row count survives.
    expect(html).toContain("1 unknown row(s) / 7 vote(s)");
  });
});

describe("municipal page — path 3 fires when the repository filter regresses", () => {
  it("test_a_leaked_fiscalizacion_row_is_refused_at_the_render", () => {
    // Unreachable while `queryOfficial` filters correctly — that is the point
    // of a third guard. Simulating the regression is the only way to drive it,
    // and without this test the branch is green whether it works or not.
    const html = renderToStaticMarkup(
      renderMunicipalView({
        status: "ok",
        rows: [
          { ...MUNICIPAL_ROWS[0]! },
          { ...MUNICIPAL_ROWS[0]!, sourceKind: "fiscalizacion" },
        ],
        excluded: {},
      }),
    );

    expect(html).toContain("are not official");
    // The BREAKDOWN, in both units — the shape rule 3 exists to protect. Its
    // two siblings pin it; this driver asserted only that the refusal fired,
    // so the per-kind tally could regress to a bare total and stay green.
    expect(html).toContain("1 fiscalizacion row(s) / 4200 vote(s)");
    // Against markup the LEAK PATH would emit: `Coverage:` appears on no
    // municipal branch at all, so asserting its absence could not fail — the
    // exact vacuous-negative shape this suite documents elsewhere.
    expect(html).not.toContain("<li>");
  });
});

describe("municipal page — an untraceable figure says so", () => {
  it("test_an_archive_entry_with_no_source_record_is_named", () => {
    // `fetchSourceRefs` returns `missing` precisely so a figure whose archive
    // entry resolved to nothing is not rendered as traced.
    const html = renderToStaticMarkup(
      renderMunicipalView(
        { status: "ok", rows: MUNICIPAL_ROWS, excluded: {} },
        [],
        ["pba/2025-municipal-coronel-rosales"],
      ),
    );

    expect(html).toContain("resolved to no source record");
    expect(html).toContain("pba/2025-municipal-coronel-rosales");
  });
});

describe("municipal page — a repeated query param reaches the guard", () => {
  it("test_a_repeated_query_param_is_reported_not_treated_as_absent", async () => {
    // Next.js hands `string[]` for a repeated param, and `stringParam`
    // returned `undefined` for those — so a SUPPLIED value vanished and the
    // page asked for a parameter the request had sent twice. The unit test in
    // `query-params.test.ts` is not evidence this page reaches the guard.
    const { default: MunicipalPage } = await import("./page");

    const markup = renderToStaticMarkup(
      (await MunicipalPage({
        searchParams: Promise.resolve({
          electionId: "2025-municipal",
          jurisdictionId: "j-027",
          categoryId: ["c-concejales", "c-diputados"],
        }),
      })) as ReactElement,
    );

    expect(markup).toContain("categoryId");
    expect(markup).toContain("more than once");
  });
});
