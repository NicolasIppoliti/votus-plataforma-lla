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
    // PBA's partido total is normalized to national seccion by the crosswalk.
    granularity: "seccion",
    requestedGranularity: "mesa",
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
        partyMappingConfigured: true,
      }),
    );

    // NOT `distrito`. The query filters one `jurisdiction_id`, so the figure
    // covers one partido however the source labelled its rows — announcing the
    // province is the 32.291-vote misattribution rule 8 records.
    expect(html).toContain('granularity: seccion');
    expect(html).not.toContain('aria-label="granularity: mesa"');
    expect(html).not.toContain('aria-label="granularity: distrito"');
    // provenance-display spec: name what the caller requested and the source
    // could not provide, not merely the coarser level the row carries.
    expect(html.toLowerCase()).toContain("requested granularity: mesa");
    expect(html.toLowerCase()).toContain("actual granularity: seccion");
  });

  it("test_exact_and_historical_unknown_requests_do_not_invent_degradation", () => {
    for (const requestedGranularity of ["seccion", null] as const) {
      const html = renderToStaticMarkup(
        renderMunicipalView({
          status: "ok",
          rows: [{ ...MUNICIPAL_ROWS[0]!, requestedGranularity }],
          excluded: {},
          partyMappingConfigured: true,
        }),
      );

      expect(html.toLowerCase()).not.toContain("degraded from");
    }
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
        // MESA rows. `jurisdictionTotalLevel` answers `seccion` on every path,
        // so `granularity` is a constant and asserting it cannot fail — and
        // `seccion` rows are the one level where the boundary emits neither
        // `summedFrom` nor `degradedFrom`, i.e. the single input where the
        // badge carries nothing about the rows at all.
        rows: [{ ...MUNICIPAL_ROWS[0]!, granularity: "mesa" }],
        excluded: {},
        partyMappingConfigured: true,
      }),
    );

    // The ROW-DERIVED part: mesa rows were summed to reach the partido total.
    expect(html).toContain("summed from mesa");
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
        partyMappingConfigured: true,
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
    fetchElectionYear: (_client: unknown, electionId: string) => {
      // The uuid the database stores, mapped the way the `election` table does.
      if (electionId === "bfeb6235-2ac7-4f8d-aa09-a3db8bd1e2da") return Promise.resolve({ status: "ok" as const, year: 2025 });
      const match = /^(\d{4})/.exec(electionId);
      return Promise.resolve(
        match ? { status: "ok" as const, year: Number(match[1]) } : { status: "no_row" as const },
      );
    },
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
    entryPointRows = [{ ...MUNICIPAL_ROWS[0]!, listId: "110" }];
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
    entryPointRows = [{ ...MUNICIPAL_ROWS[0]!, listId: "110" }];
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
        partyMappingConfigured: true,
      }),
    );

    expect(html).toContain("are not official");
    // The BREAKDOWN, in both units — the shape rule 3 exists to protect. Its
    // two siblings pin it; this driver asserted only that the refusal fired,
    // so the per-kind tally could regress to a bare total and stay green.
    expect(html).toContain("1 fiscalizacion row(s) / 4200 vote(s)");
    // No PARTY line. `not.toContain("<li>")` was too broad once the unmapped
    // breakdown started rendering its own list: the refusal legitimately emits
    // `<li>` now, and the claim was never about markup — it is that no figure
    // is attributed to a party.
    expect(html).not.toContain(": 4200 votes");
    expect(html).not.toContain("ALIANZA LA LIBERTAD AVANZA:");
  });
});

describe("municipal page — an untraceable figure says so", () => {
  it("test_an_archive_entry_with_no_source_record_is_named", () => {
    // `fetchSourceRefs` returns `missing` precisely so a figure whose archive
    // entry resolved to nothing is not rendered as traced.
    const html = renderToStaticMarkup(
      renderMunicipalView(
        { status: "ok", rows: MUNICIPAL_ROWS, excluded: {}, partyMappingConfigured: true },
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

describe("municipal page — a uuid election id is served", () => {
  it("test_a_uuid_election_reaches_the_concejales_mapping", async () => {
    // The gate this route applies is `year !== 2025`, and the year now comes
    // from the `election` row. With the id parsed instead, a uuid answered
    // `null` and the page refused every real request.
    process.env["MUNICIPAL_JURISDICTION_ID"] = "j-027";
    process.env["MUNICIPAL_CATEGORY_ID"] = "c-concejales";
    entryPointRows = [{ ...MUNICIPAL_ROWS[0]!, listId: "110" }];
    const { default: MunicipalPage } = await import("./page");

    const markup = renderToStaticMarkup(
      (await MunicipalPage({
        searchParams: Promise.resolve({
          electionId: "bfeb6235-2ac7-4f8d-aa09-a3db8bd1e2da",
          jurisdictionId: "j-027",
          categoryId: "c-concejales",
        }),
      })) as ReactElement,
    );

    expect(markup).not.toContain("is not that election");
    expect(markup).toContain("LA LIBERTAD AVANZA");
  });
});

describe("municipal page — a read failure states the real denominator", () => {
  it("test_the_unmapped_share_is_of_the_rows_read_not_of_itself", () => {
    // `totalRows` was derived from the unmapped entries, so numerator and
    // denominator were the same number and every read-failed page claimed
    // "N of N rows resolved to no curated party" — 100 % unmapped, whatever
    // was actually read.
    const html = renderToStaticMarkup(
      renderMunicipalView({
        status: "read_failed",
        reason: "row-level security denied the source read",
        unmapped: [{ listId: "2206", rows: 1, votes: 40 }],
        unsummable: null,
        totalRows: 400,
        unrecognized: [{ granularity: "subcircuito", rows: 3, votes: 90 }],
      }),
    );

    expect(html).toContain("1 of 400 rows");
    expect(html).not.toContain("1 of 1 rows");
    // And the levels this app cannot order, counted before the same failure.
    expect(html).toContain("subcircuito: 3 rows");
  });
});

describe("municipal page — a read failure names both breakdowns", () => {
  it("test_the_refusal_carries_the_unmapped_ids_and_the_unorderable_levels", () => {
    // `MunicipalView.read_failed` carries `unmapped`, `totalRows` and
    // `unrecognized`, and the refusal branch renders both components — none of
    // it driven through an entry point until now.
    const html = renderToStaticMarkup(
      renderMunicipalView({
        status: "read_failed",
        reason: "row-level security denied the source read",
        unmapped: [{ listId: "2206", rows: 2, votes: 90 }],
        unsummable: null,
        totalRows: 120,
        unrecognized: [{ granularity: "subcircuito", rows: 4, votes: 200 }],
      }),
    );

    expect(html).toContain("row-level security denied the source read");
    expect(html).toContain("2 of 120 rows");
    expect(html).toContain("2206: 2 rows");
    expect(html).toContain("subcircuito: 4 rows");
    // ROWS only for the unorderable level: containment is unknown.
    expect(html).not.toContain("subcircuito: 4 rows, 200 votes");
  });
});

describe("municipal page — no mapping source is not a claim about the data", () => {
  it("test_an_unconfigured_mapping_source_says_so_on_the_success_path", async () => {
    // The two sibling pages have this test; municipal's absence is why its
    // success branch shipped with the component's `true` default and stated a
    // fact about the curated table that is really a fact about config.
    const html = renderToStaticMarkup(
      renderMunicipalView({
        status: "ok",
        rows: [{ ...MUNICIPAL_ROWS[0]!, listId: "2206" }],
        excluded: {},
        partyMappingConfigured: false,
      }),
    );

    expect(html).toContain("no curated mapping source is configured");
    expect(html).not.toContain("resolved to no curated party");
  });
});
