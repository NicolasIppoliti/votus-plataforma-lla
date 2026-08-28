import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const { redirectMock } = vi.hoisted(() => ({
  redirectMock: vi.fn((url: string): never => { throw new Error(`redirect:${url}`); }),
}));

vi.mock("next/navigation", () => ({ redirect: redirectMock }));
import type { ResultRow } from "@/lib/fiscalizacion/repository";
import type { SourceRef } from "@/lib/results/types";
import { type MunicipalView, renderMunicipalView } from "./page";

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
  it("test_renderMunicipalView_renders_resolved_party_names", async () => {
    const view = { status: "ok" as const,
      rows: [{ ...MUNICIPAL_ROWS[0]!, partyName: "ALIANZA LA LIBERTAD AVANZA", canonicalPartyId: "lla" }],
      excluded: {}, partyMappingConfigured: true };

    expect(view.status).toBe("ok");
    expect(view.rows[0]?.partyName).toBe("ALIANZA LA LIBERTAD AVANZA");

    const html = renderToStaticMarkup(renderMunicipalView(view));
    expect(html).toContain("ALIANZA LA LIBERTAD AVANZA");
  });
});

describe("municipal page — renderMunicipalView", () => {
  it("test_unmapped_fixture_keeps_official_figure_and_source_exclusion_visible", () => {
    const html = renderToStaticMarkup(
      renderMunicipalView({
        status: "ok",
        rows: [{ ...MUNICIPAL_ROWS[0]!, listId: null, votes: 11_111 }],
        excluded: { fiscalizacion: { rows: 1, votes: 22_222 } }, sourceAudit: { official: { rows: 1, votes: 11_111 } },
        partyMappingConfigured: true,
      }),
    );

    expect(html).toContain("Por tipo de fuente: 1 fila oficial / 11111 votos.");
    expect(html).toContain("granularidad: seccion");
    expect(html).toContain("1 fila fiscalización / 22222 votos");
    expect(html).not.toContain("33333");
  });

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
    expect(html).toContain('granularidad: seccion');
    expect(html).not.toContain('aria-label="granularidad: mesa"');
    expect(html).not.toContain('aria-label="granularidad: distrito"');
    // provenance-display spec: name what the caller requested and the source
    // could not provide, not merely the coarser level the row carries.
    expect(html.toLowerCase()).toContain("granularidad solicitada: mesa");
    expect(html.toLowerCase()).toContain("granularidad real: seccion");
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

      expect(html.toLowerCase()).not.toContain("degradado desde");
    }
  });
});

let entryPointRows: ResultRow[] = [];
let entryPointSources: SourceRef[] = [];
let entryPointMappingFailure: Error | null = null;
let authorizedEvidenceState: { status: "denied" | "malformed" | "unavailable" | "truncated" } | null = null; let authorizedEvidenceSource: "official" | "fiscalizacion" = "official";

afterEach(() => {
  entryPointRows = [];
  entryPointSources = [];
  entryPointMappingFailure = null;
  authorizedEvidenceState = null; authorizedEvidenceSource = "official";
  redirectMock.mockClear();
  delete process.env["CORONEL_ROSALES_JURISDICTION_ID"];
  delete process.env["MUNICIPAL_ELECTION_ID"];
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
    expect(html).toContain("sumado a partir de filas de nivel mesa");
    expect(html).not.toMatch(/granularidad[^>]*distrito/);
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
    expect(html).toContain("sumarlas duplicaría el conteo");
    expect(html).toContain("No hay cifras por partido");
    // And NO badge: `readGranularity` folds to the coarsest level, so a badge
    // beside the refusal names one of the mixed levels as if it were the set's.
    expect(html).not.toContain('aria-label="granularidad:');
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

vi.mock("@/lib/workspace/official-evidence", () => ({ MUNICIPAL_JURISDICTION_ID: "02/027",
  loadMunicipalOfficialEvidence: () => Promise.resolve(authorizedEvidenceState ?? (entryPointMappingFailure || process.env["MUNICIPAL_ELECTION_ID"]?.startsWith("2023") ? { status: "malformed" } : { status: "ok", result: {
    status: "ok", sourceKind: authorizedEvidenceSource, level: "seccion", sourceGranularity: "seccion", electionYear: 2025, electionRound: "legislativas", totalVotes: entryPointRows.filter((row) => row.sourceKind === "official").reduce((sum, row) => sum + row.votes, 0), mesaCount: null,
    parties: entryPointRows.filter((row) => row.sourceKind === "official").map((row) => ({ identityStatus: row.listId === "2206" ? "canonical" : "unmapped", canonicalPartyId: row.listId === "2206" ? "lla" : null, displayName: row.listId === "2206" ? "ALIANZA LA LIBERTAD AVANZA" : null, listId: row.listId === "2206" ? null : row.listId, votes: row.votes, voteShare: "1" })), archiveEntryIds: [...new Set(entryPointRows.map((row) => row.archiveEntryId))], sourceAudit: [{ kind: "official", rows: 1, votes: 4200 }], sourceExclusions: entryPointRows.filter((row) => row.sourceKind !== "official").map((row) => ({ kind: row.sourceKind, rows: 1, votes: row.votes })),
  }, provenance: entryPointSources.map(({ archiveEntryId, sha256, fetchedAt }) => ({ archiveEntryId, sha256, fetchedAt, status: "ok" })) })),
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
                  entryPointMappingFailure
                    ? Promise.reject(entryPointMappingFailure)
                    : Promise.resolve(
                        context.jurisdiction === "coronel_rosales_municipal" &&
                        context.category === "CONCEJALES"
                          ? new Map([
                              ["2206", { canonicalPartyId: "lla", displayName: "ALIANZA LA LIBERTAD AVANZA" }],
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
    process.env["CORONEL_ROSALES_JURISDICTION_ID"] = "j-027";
    process.env["MUNICIPAL_ELECTION_ID"] = "2025-municipal";
    process.env["MUNICIPAL_CATEGORY_ID"] = "c-concejales";
  });

  it("test_authorized_denial_wins_even_when_the_legacy_repository_has_rows", async () => {
    const { default: MunicipalPage } = await import("./page");
    entryPointRows = [{ ...MUNICIPAL_ROWS[0]!, listId: "2206" }];
    authorizedEvidenceState = { status: "denied" };

    const markup = renderToStaticMarkup(
      (await MunicipalPage({
        searchParams: Promise.resolve({ electionId: "2025-municipal" }),
      })) as ReactElement,
    );

    expect(markup).toContain("El espacio de trabajo no autoriza esta sección municipal");
    expect(markup).not.toContain("4200 voto(s)");
  });

  it("test_production_refuses_unofficial_evidence", async () => { authorizedEvidenceSource = "fiscalizacion"; entryPointRows = [{ ...MUNICIPAL_ROWS[0]!, listId: "2206" }]; const { default: Page } = await import("./page"); const html = renderToStaticMarkup((await Page({ searchParams: Promise.resolve({ electionId: "2025-municipal" }) })) as ReactElement); expect(html).toContain("no es de fuente oficial"); expect(html).not.toContain("4200 voto(s)"); });

  it("test_the_data_path_reaches_the_render_with_its_sources", async () => {
    // The missing-params branch was the only one driven. `sources` reaching
    // `renderMunicipalView` — the whole `createResultsRepository` ->
    // `loadMunicipalView` -> `fetchSourceRefs` chain — had no entry-point test.
    const { default: MunicipalPage } = await import("./page");
    entryPointRows = [{ ...MUNICIPAL_ROWS[0]!, listId: "2206" }];
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
        }),
      })) as ReactElement,
    );

        expect(markup).toContain("ALIANZA LA LIBERTAD AVANZA");
        expect(markup).toContain("aaaabbbbccccdddd");
        expect(markup).not.toContain("https://example.test/pba-2023.html");
      });

      it("test_malformed_authorized_evidence_hides_figures", async () => {
        const { default: Page } = await import("./page"); authorizedEvidenceState = { status: "malformed" };
        const html = renderToStaticMarkup((await Page({ searchParams: Promise.resolve({ electionId: "2025-municipal" }) })) as ReactElement);
        expect(html).toContain("formato inválido"); expect(html).not.toContain("4200 voto(s)");
      });

      it("test_bare_route_renders_one_accessible_configured_election_selector", async () => {
        const { default: Page } = await import("./page");
        const html = renderToStaticMarkup((await Page({ searchParams: Promise.resolve({}) })) as ReactElement);
        for (const fact of ['<label for="municipal-election">Elección municipal</label>',
          'name="electionId"']) expect(html).toContain(fact);
        expect(html.match(/<option/g)).toHaveLength(1);
        expect(html).not.toContain("UUID");
      });

      it("test_matching_legacy_scope_is_not_used_as_authority", async () => {
        const { default: Page } = await import("./page");
        const html = renderToStaticMarkup((await Page({ searchParams: Promise.resolve({ electionId: "2025-municipal",
          jurisdictionId: "j-027", categoryId: "c-concejales" }) })) as ReactElement);
        expect(html).toContain("no se aceptan parámetros de identidad o autorización");
      });

      it("test_untrusted_or_mismatched_legacy_context_refuses", async () => {
        const { default: Page } = await import("./page");
        for (const params of [{ jurisdictionId: "j-999" },
          { partyJurisdiction: "national" }, { partyCategory: "DIPUTADO NACIONAL" }]) {
          const html = renderToStaticMarkup((await Page({ searchParams: Promise.resolve({
            electionId: "2025-municipal", ...params }) })) as ReactElement);
          expect(html).toContain("Se rechazó la solicitud");
        }
        expect(redirectMock).not.toHaveBeenCalled();
      });

      it("test_missing_or_non_2025_operational_config_refuses", async () => {
        const { default: Page } = await import("./page");
        delete process.env["MUNICIPAL_ELECTION_ID"];
        let html = renderToStaticMarkup((await Page({ searchParams: Promise.resolve({}) })) as ReactElement);
        expect(html).toContain("MUNICIPAL_ELECTION_ID");
        process.env["MUNICIPAL_ELECTION_ID"] = "2023-municipal";
        html = renderToStaticMarkup((await Page({ searchParams: Promise.resolve({ electionId: "2023-municipal" }) })) as ReactElement);
        expect(html).toContain("formato inválido");
      });

    });

describe("municipal page — a failed read is not an opt-in prompt", () => {
  it("test_a_denied_read_is_reported_with_its_own_status", async () => {
    // A denied read RAISES. Reusing the leakage guard's
    // `requires_explicit_unofficial_opt_in` for it would make any consumer
    // branching on that status offer an unofficial-data prompt for a read that
    // simply failed.
    const view = { status: "read_failed" as const, reason: "row-level security denied the read" };

    expect(view.status).toBe("read_failed");
    expect(view.reason).toContain("row-level security denied the read");

        const html = renderToStaticMarkup(renderMunicipalView(view));
        expect(html).toContain("row-level security denied the read");
      });

      it("test_mapping_failure_keeps_known_audit_without_inventing_unmapped_ids", async () => {
        const view: MunicipalView = { status: "read_failed",
          reason: "No se pudo resolver el mapeo municipal",
          excluded: { fiscalizacion: { rows: 1, votes: 90 } },
          unrecognized: [{ granularity: "subcircuito", rows: 1, votes: 90 }] };
        const html = renderToStaticMarkup(renderMunicipalView(view));
        expect(view.reason).toContain("No se pudo resolver el mapeo municipal");
        expect(view.unmapped).toBeUndefined();
        expect(html).toMatch(/1 fila fiscalización \/ 90 votos|no tienen id de lista|subcircuito: 1 filas/);
        expect(html).not.toContain("2206: 1 filas");
      });
    });

    describe("municipal page — the mapping is fixed to one race", () => {
  it("test_an_election_outside_the_mapping_year_is_refused", async () => {
    process.env["CORONEL_ROSALES_JURISDICTION_ID"] = "j-027";
    process.env["MUNICIPAL_ELECTION_ID"] = "2025-municipal";
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
    expect(markup).toContain("Se rechazó la solicitud");
    expect(markup).toContain("2023-municipal");
  });
});

describe("municipal page — the race is pinned, not taken from the request", () => {
  it("test_another_category_is_refused_not_named_through_this_mapping", async () => {
    process.env["CORONEL_ROSALES_JURISDICTION_ID"] = "j-027";
    process.env["MUNICIPAL_ELECTION_ID"] = "2025-municipal";
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

    expect(markup).toContain("Se rechazó la solicitud");
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
    expect(html).toContain("3 filas fiscalización / 120 votos");
    // The VOTES too: a 3-row drop of 120 votes and a 3-row drop of 6 read
    // identically when only the row count survives.
    expect(html).toContain("1 fila desconocida / 7 votos");
  });
});

describe("municipal page — path 3 fires when the repository filter regresses", () => {
  it("test_a_leaked_fiscalizacion_row_is_refused_at_the_render", () => {
    // Unreachable while `queryOfficial` filters correctly — that is the point
    // of a third guard. Simulating the regression is the only way to drive it,
    // and without this test the branch is green whether it works or not.
    const html = renderToStaticMarkup(
      renderMunicipalView(
        {
          status: "ok",
          rows: [
{ ...MUNICIPAL_ROWS[0]! },
{ ...MUNICIPAL_ROWS[0]!, sourceKind: "fiscalizacion" },
          ],
          excluded: {},
          partyMappingConfigured: true,
        },
        [{ archiveEntryId: "a", sha256: "a".repeat(64),
          url: "https://example.test/municipal.csv", fetchedAt: "2026-01-01" }],
      ),
    );

    expect(html).toContain("no son oficiales");
    // The BREAKDOWN, in both units — the shape rule 3 exists to protect. Its
    // two siblings pin it; this driver asserted only that the refusal fired,
    // so the per-kind tally could regress to a bare total and stay green.
    expect(html).toContain("1 fila fiscalización / 4200 votos");
    // No PARTY line. `not.toContain("<li>")` was too broad once the unmapped
    // breakdown started rendering its own list: the refusal legitimately emits
    // `<li>` now, and the claim was never about markup — it is that no figure
    // is attributed to a party.
        expect(html).not.toContain(": 4200 votos");
        expect(html).not.toContain("ALIANZA LA LIBERTAD AVANZA:");
        expect(html).not.toContain("https://example.test/municipal.csv");
      });
    });

    it("test_votes_by_party_name_conflict_refuses_but_keeps_audit", () => {
      const row = { ...MUNICIPAL_ROWS[0]!, canonicalPartyId: "lla" };
      const html = renderToStaticMarkup(renderMunicipalView({ status: "ok",
        rows: [{ ...row, partyName: "LLA" }, { ...row, partyName: "ALIANZA LLA" }],
        excluded: { fiscalizacion: { rows: 1, votes: 90 } }, partyMappingConfigured: true },
        [{ archiveEntryId: "a", sha256: "b".repeat(64),
          url: "https://example.test/conflict.csv", fetchedAt: "2026-01-01" }]));
      for (const fact of ["Se rechazó", "nombres incompatibles",
        "1 fila fiscalización / 90 votos"])
        expect(html).toContain(fact);
      expect(html).not.toContain("8400 voto(s)");
    });

describe("municipal page — an untraceable figure says so", () => {
      it("test_an_archive_entry_with_no_source_record_is_named", () => {
        const html = renderToStaticMarkup(renderMunicipalView(
          { status: "ok", rows: MUNICIPAL_ROWS, excluded: {}, partyMappingConfigured: true }, [],
          ["pba/2025-municipal-coronel-rosales"],
        ));
        expect(html).toContain("no se resolvieron a un registro de fuente");
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
    expect(markup).toContain("más de una vez");
  });
});

describe("municipal page — a uuid election id is served", () => {
  it("test_a_uuid_election_reaches_the_concejales_mapping", async () => {
    // The gate this route applies is `year !== 2025`, and the year now comes
    // from the `election` row. With the id parsed instead, a uuid answered
    // `null` and the page refused every real request.
    process.env["CORONEL_ROSALES_JURISDICTION_ID"] = "j-027";
    process.env["MUNICIPAL_ELECTION_ID"] = "bfeb6235-2ac7-4f8d-aa09-a3db8bd1e2da";
    process.env["MUNICIPAL_CATEGORY_ID"] = "c-concejales";
    entryPointRows = [{ ...MUNICIPAL_ROWS[0]!, listId: "2206" }];
    const { default: MunicipalPage } = await import("./page");

    const markup = renderToStaticMarkup(
      (await MunicipalPage({
        searchParams: Promise.resolve({
          electionId: "bfeb6235-2ac7-4f8d-aa09-a3db8bd1e2da",
        }),
      })) as ReactElement,
    );

    expect(markup).not.toContain("no corresponde a esa elección");
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

    expect(html).toContain("1 de 400 filas");
    expect(html).not.toContain("1 de 1 filas");
    // And the levels this app cannot order, counted before the same failure.
    expect(html).toContain("subcircuito: 3 filas");
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
    expect(html).toContain("2 de 120 filas");
    expect(html).toContain("2206: 2 filas");
    expect(html).toContain("subcircuito: 4 filas");
    // ROWS only for the unorderable level: containment is unknown.
    expect(html).not.toContain("subcircuito: 4 filas, 200 votos");
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

    expect(html).toContain("no hay una fuente de mapeo curado configurada");
    expect(html).not.toContain("se resolvieron sin un partido curado");
  });
});
