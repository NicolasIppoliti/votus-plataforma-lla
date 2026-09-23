import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const { redirectMock } = vi.hoisted(() => ({
  redirectMock: vi.fn((url: string): never => { throw new Error(`redirect:${url}`); }),
}));

vi.mock("next/navigation", () => ({ redirect: redirectMock }));
import type { ResultRow } from "@/lib/results/result-rows";
import type { SourceRef } from "@/lib/results/types";
import {
  loadMunicipalOfficialEvidence,
  type MunicipalOfficialEvidence,
} from "@/lib/workspace/official-evidence";
import {
  municipalViewFromOfficialEvidence,
  type MunicipalView,
  renderMunicipalView,
} from "./page";

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
      excluded: {}, sourceAudit: { official: { rows: 1, votes: 4200 } }, partyMappingConfigured: true };

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
        excluded: {}, sourceAudit: { official: { rows: 1, votes: 4200 } },
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
          excluded: {}, sourceAudit: { official: { rows: 1, votes: 4200 } },
          partyMappingConfigured: true,
        }),
      );

      expect(html.toLowerCase()).not.toContain("degradado desde");
    }
  });
});

let entryPointRows: ResultRow[] = [];
let entryPointSources: SourceRef[] = [];
let authorizedEvidenceState: Exclude<MunicipalOfficialEvidence, { status: "ok" }> | null = null;
let authorizedEvidenceSource: "official" | "fiscalizacion" = "official";
let authorizedEvidenceIdentity = { year: 2025, round: "provinciales", categoryName: "CONCEJALES" };
let authorizedEvidenceAudit = [{ kind: "official", rows: 1, votes: 4200 }];
let authorized2023Canonical = false;

afterEach(() => {
  entryPointRows = [];
  entryPointSources = [];
  authorizedEvidenceState = null;
  authorizedEvidenceSource = "official";
  authorizedEvidenceIdentity = { year: 2025, round: "provinciales", categoryName: "CONCEJALES" };
  authorizedEvidenceAudit = [{ kind: "official", rows: 1, votes: 4200 }];
  authorized2023Canonical = false;
  vi.mocked(loadMunicipalOfficialEvidence).mockClear();
  redirectMock.mockClear();
  delete process.env["CORONEL_ROSALES_JURISDICTION_ID"];
  delete process.env["MUNICIPAL_ELECTION_ID"];
  delete process.env["MUNICIPAL_CATEGORY_ID"];
  delete process.env["MUNICIPAL_2023_ELECTION_ID"];
  delete process.env["MUNICIPAL_2023_CATEGORY_ID"];
});

describe("municipal page — the badge describes the rows, not a memory of them", () => {
  it("test_uniform_distrito_rows_disclose_degradation_not_summation", () => {
    const html = renderToStaticMarkup(
      renderMunicipalView({
        status: "ok",
        rows: [{ ...MUNICIPAL_ROWS[0]!, granularity: "distrito" }],
        excluded: {}, sourceAudit: { official: { rows: 1, votes: 4200 } },
        partyMappingConfigured: true,
      }),
    );

    expect(html).toContain("degradada desde distrito");
    expect(html).not.toContain("sumado a partir de filas de nivel distrito");
  });

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
        excluded: {}, sourceAudit: { official: { rows: 1, votes: 4200 } },
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
        excluded: {}, sourceAudit: { official: { rows: 2, votes: 8400 } },
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
    expect(html).not.toContain("8400 voto(s)");
    expect(html).not.toContain('aria-labelledby="municipal-distribution-heading"');
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

vi.mock("@/lib/workspace/official-evidence", () => ({ MUNICIPAL_JURISDICTION_ID: "02/027", MUNICIPAL_2023_ARCHIVE: { id: "national/2023-generales", sha256: "2562b18c741ba5740d264e5328f206cb25f709ed0a4f8cf962f301e423e79c6b" },
  loadMunicipalOfficialEvidence: vi.fn(() => Promise.resolve(authorizedEvidenceState ?? (process.env["MUNICIPAL_ELECTION_ID"]?.startsWith("2023") ? { status: "malformed" } : { status: "ok", result: {
    status: "ok", sourceKind: authorizedEvidenceSource, level: "seccion", sourceGranularity: "seccion", categoryName: authorizedEvidenceIdentity.categoryName, electionYear: authorizedEvidenceIdentity.year, electionRound: authorizedEvidenceIdentity.round, totalVotes: entryPointRows.filter((row) => row.sourceKind === "official").reduce((sum, row) => sum + row.votes, 0), mesaCount: null,
    parties: entryPointRows.filter((row) => row.sourceKind === "official").map((row) => ({ identityStatus: authorized2023Canonical || row.listId === "2206" ? "canonical" : "unmapped", canonicalPartyId: authorized2023Canonical ? "LLA" : row.listId === "2206" ? "lla" : null, displayName: authorized2023Canonical ? "LA LIBERTAD AVANZA" : row.listId === "2206" ? "ALIANZA LA LIBERTAD AVANZA" : null, listId: authorized2023Canonical || row.listId === "2206" ? null : row.listId, votes: row.votes, voteShare: "1" })), archiveEntryIds: [...new Set(entryPointRows.map((row) => row.archiveEntryId))], sourceAudit: authorizedEvidenceAudit, sourceExclusions: entryPointRows.filter((row) => row.sourceKind !== "official").map((row) => ({ kind: row.sourceKind, rows: 1, votes: row.votes })),
  }, provenance: entryPointSources.map(({ archiveEntryId, sha256, fetchedAt }) => ({ archiveEntryId, sha256, fetchedAt, status: "ok" })) }))),
}));

describe("municipal page — the real entry point", () => {
  it("selects the authorized 2023 provisional ballot and displays its raw category", async () => {
    process.env["MUNICIPAL_2023_ELECTION_ID"] = "e-2023";
    process.env["MUNICIPAL_2023_CATEGORY_ID"] = "c-intendente";
    authorizedEvidenceIdentity = { year: 2023, round: "generales", categoryName: "INTENDENTE" };
    authorized2023Canonical = true;
    entryPointRows = [{ ...MUNICIPAL_ROWS[0]!, listId: "20135" }];
    entryPointRows[0]!.archiveEntryId = "national/2023-generales";
    entryPointSources = [{ archiveEntryId: "national/2023-generales", sha256: "2562b18c741ba5740d264e5328f206cb25f709ed0a4f8cf962f301e423e79c6b", url: "https://example.test/2023.zip", fetchedAt: "2026-01-01" }];
    const { default: Page } = await import("./page");
    const html = renderToStaticMarkup((await Page({ searchParams: Promise.resolve({ year: "2023" }) })) as ReactElement);
    expect(loadMunicipalOfficialEvidence).toHaveBeenCalledWith(2023);
    for (const text of ["2023", "Generales", "INTENDENTE", "provisorio", "LA LIBERTAD AVANZA", "Distrito 02 · Sección 027"])
      expect(html).toContain(text);
    expect(html).toContain('<th scope="row">LA LIBERTAD AVANZA</th>');
    expect(html).toContain('<td class="table-cell--number">4200</td>');
    expect(html).not.toContain("20135");
    expect(html).not.toContain("<dd>2025 · Provinciales");
    expect(html).toContain("153 mesas y 10 códigos de circuito");
    expect(html).toContain("no cobertura confirmada de esta proyección");
  });
  it("displays an unknown 2023 list as unmapped, never as a bare number", async () => {
    process.env["MUNICIPAL_2023_ELECTION_ID"] = "e-2023";
    process.env["MUNICIPAL_2023_CATEGORY_ID"] = "c-intendente";
    authorizedEvidenceIdentity = { year: 2023, round: "generales", categoryName: "INTENDENTE" };
    entryPointRows = [{ ...MUNICIPAL_ROWS[0]!, listId: "99999", archiveEntryId: "national/2023-generales" }];
    entryPointSources = [{ archiveEntryId: "national/2023-generales", sha256: "2562b18c741ba5740d264e5328f206cb25f709ed0a4f8cf962f301e423e79c6b", url: "https://example.test/2023.zip", fetchedAt: "2026-01-01" }];
    const { default: Page } = await import("./page");
    const html = renderToStaticMarkup((await Page({ searchParams: Promise.resolve({ year: "2023" }) })) as ReactElement);
    expect(html).toContain("se resolvieron sin un partido curado");
    expect(html).toContain("Por id de lista:</p><ul><li>99999: 1 filas, 4200 votos</li>");
    expect(html).not.toContain('<th scope="row">99999</th>');
  });

  it("refuses a 2025 result returned for the 2023 selection without exposing provenance", async () => {
    process.env["MUNICIPAL_2023_ELECTION_ID"] = "e-2023";
    process.env["MUNICIPAL_2023_CATEGORY_ID"] = "c-intendente";
    authorizedEvidenceIdentity = { year: 2025, round: "provinciales", categoryName: "CONCEJALES" };
    entryPointRows = [{ ...MUNICIPAL_ROWS[0]!, archiveEntryId: "national/2023-generales" }];
    entryPointSources = [{ archiveEntryId: "national/2023-generales", sha256: "a".repeat(64), url: "https://example.test", fetchedAt: "2026-01-01" }];
    const { default: Page } = await import("./page");
    const html = renderToStaticMarkup((await Page({ searchParams: Promise.resolve({ year: "2023" }) })) as ReactElement);
    expect(html).toContain("Se rechazó");
    expect(html).toContain("No se pudo leer la evidencia municipal autorizada");
    expect(html).not.toContain("national/2023-generales");
    expect(html).not.toContain("4200");
  });

  it.each(["denied", "empty", "malformed", "unavailable"] as const)("2023 %s never displays figures or archive facts", async (status) => {
    process.env["MUNICIPAL_2023_ELECTION_ID"] = "e-2023";
    process.env["MUNICIPAL_2023_CATEGORY_ID"] = "c-intendente";
    entryPointRows = [{ ...MUNICIPAL_ROWS[0]! }];
    authorizedEvidenceState = { status };
    const { default: Page } = await import("./page");
    const html = renderToStaticMarkup((await Page({ searchParams: Promise.resolve({ year: "2023" }) })) as ReactElement);
    expect(html).not.toContain("4200");
    expect(html).not.toContain("153 mesas");
    if (status === "unavailable") expect(html).toContain('href="/municipal?year=2023"');
  });

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

  it.each([
    ["wrong year", { year: 2024 }],
    ["wrong round", { round: "legislativas" }],
    ["wrong category", { categoryName: "DIPUTADOS PROVINCIALES" }],
  ])("refuses %s before figures or provenance reach the page", async (_case, identity) => {
    entryPointRows = [{ ...MUNICIPAL_ROWS[0]!, listId: "2206" }];
    authorizedEvidenceIdentity = { ...authorizedEvidenceIdentity, ...identity };
    entryPointSources = [{
      archiveEntryId: "SENTINEL-PROVENANCE",
      sha256: "f".repeat(64),
      url: "https://example.test/sentinel",
      fetchedAt: "SENTINEL-FETCHED-AT",
    }];
    const { default: Page } = await import("./page");
    const html = renderToStaticMarkup(
      (await Page({ searchParams: Promise.resolve({ electionId: "2025-municipal" }) })) as ReactElement,
    );

    expect(html).toContain("No se pudo leer la evidencia municipal autorizada");
    for (const secret of ["4200", "ALIANZA LA LIBERTAD AVANZA", "SENTINEL-PROVENANCE", "SENTINEL-FETCHED-AT"])
      expect(html).not.toContain(secret);
  });

  it("test_production_refuses_an_empty_official_source_audit", async () => {
    entryPointRows = [{ ...MUNICIPAL_ROWS[0]!, listId: "2206" }];
    authorizedEvidenceAudit = [];
    entryPointSources = [{
      archiveEntryId: "SENTINEL-MALFORMED-AUDIT-PROVENANCE",
      sha256: "e".repeat(64),
      url: "https://example.test/malformed-audit",
      fetchedAt: "SENTINEL-MALFORMED-AUDIT-FETCHED-AT",
    }];
    const { default: Page } = await import("./page");

    const html = renderToStaticMarkup(
      (await Page({
        searchParams: Promise.resolve({ electionId: "2025-municipal" }),
      })) as ReactElement,
    );

    expect(html).toContain("auditoría oficial");
    expect(html).not.toContain("4200 voto(s)");
    expect(html).not.toContain("ALIANZA LA LIBERTAD AVANZA");
    expect(html).not.toContain("SENTINEL-MALFORMED-AUDIT-PROVENANCE");
    expect(html).not.toContain("SENTINEL-MALFORMED-AUDIT-FETCHED-AT");
  });

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

      it("test_authorized_page_renders_a_route_local_exact_results_table_with_adjacent_evidence", async () => {
        const { default: MunicipalPage } = await import("./page");
        entryPointRows = [{ ...MUNICIPAL_ROWS[0]!, listId: "2206" }];
        entryPointSources = [{
          archiveEntryId: "pba/2025-municipal-coronel-rosales",
          sha256: "aaaabbbbccccdddd0000111122223333444455556666777788889999aaaabbbb",
          url: "https://example.test/pba-2023.html",
          fetchedAt: "2026-01-01T00:00:00Z",
        }];

        const markup = renderToStaticMarkup(
          (await MunicipalPage({
            searchParams: Promise.resolve({ electionId: "2025-municipal" }),
          })) as ReactElement,
        );

        expect(markup).toContain('aria-labelledby="municipal-results-heading"');
        expect(markup).toContain('role="region" aria-label="Tabla de resultados oficiales exactos por partido" tabindex="0"');
        expect(markup).toContain("<caption>Resultados oficiales exactos por partido y votos</caption>");
        expect(markup).toContain('<th scope="col">Partido</th>');
        expect(markup).toContain('<th scope="col" class="table-cell--number">Votos exactos</th>');
        expect(markup).toContain('<th scope="row">ALIANZA LA LIBERTAD AVANZA</th>');
        expect(markup).toContain('<td class="table-cell--number">4200</td>');
        expect(markup).not.toContain("ALIANZA LA LIBERTAD AVANZA: 4200 voto(s)");
        expect(markup).toContain('aria-labelledby="municipal-distribution-heading"');
        expect(markup).toContain('aria-label="ALIANZA LA LIBERTAD AVANZA: 4.200 votos"');
        expect(markup).toContain("2025 · Provinciales");
        expect(markup).toContain("<summary>Archivo y procedencia</summary>");
        const positions = ["Contexto de la consulta", "Votos por partido identificado", "<caption>", "<summary>"].map((label) => markup.indexOf(label));
        expect(positions).toEqual([...positions].sort((a, b) => a - b));
        expect(markup).not.toContain("<aside");
        expect(markup).toContain("aaaabbbbccccdddd");
      });

      it("test_malformed_authorized_evidence_hides_figures", async () => {
        const { default: Page } = await import("./page"); authorizedEvidenceState = { status: "malformed" };
        const html = renderToStaticMarkup((await Page({ searchParams: Promise.resolve({ electionId: "2025-municipal" }) })) as ReactElement);
        expect(html).toContain("formato inválido"); expect(html).not.toContain("4200 voto(s)");
      });

      it("test_valid_unavailable_request_offers_only_truthful_native_continuations", async () => {
        const { default: Page } = await import("./page");
        authorizedEvidenceState = { status: "unavailable" };

        const html = renderToStaticMarkup((await Page({
          searchParams: Promise.resolve({ electionId: "2025-municipal" }),
        })) as ReactElement);

        expect(html).toContain("La evidencia oficial autorizada no está disponible");
        expect(html).toContain('<a href="/municipal?electionId=2025-municipal">Reintentar misma consulta</a>');
        expect(html).toContain('<a href="/municipal">Volver a elección configurada</a>');
        for (const sentinel of ["Resultados exactos", "ALIANZA LA LIBERTAD AVANZA", "4200", "Archivo y procedencia", "procedencia"])
          expect(html).not.toContain(sentinel);
      });

      it("test_other_refusal_and_empty_states_hide_figures_evidence_and_retry", async () => {
        const { default: Page } = await import("./page");
        const sentinels = ["Resultados exactos", "ALIANZA LA LIBERTAD AVANZA", "4200", "Archivo y procedencia", "procedencia", "Reintentar misma consulta", "Volver a elección configurada"];
        for (const [state, message] of [
          [{ status: "denied" }, "no autoriza"],
          [{ status: "malformed" }, "formato inválido"], [{ status: "truncated" }, "truncada"],
          [{ status: "empty" }, "No hay resultados oficiales"],
        ] as const) {
          authorizedEvidenceState = state;
          const html = renderToStaticMarkup((await Page({ searchParams: Promise.resolve({ electionId: "2025-municipal" }) })) as ReactElement);
          expect(html).toContain(message);
          for (const sentinel of sentinels) expect(html).not.toContain(sentinel);
        }
        for (const searchParams of [{ unexpected: "x" }, { jurisdictionId: "j-027" }, { categoryId: "c-otro" }, { partyCategory: "CONCEJALES" }, { electionId: ["2025-municipal", "2025-municipal"] }]) {
          authorizedEvidenceState = null;
          const html = renderToStaticMarkup((await Page({ searchParams: Promise.resolve(searchParams) }) as ReactElement));
          expect(html).toContain("Se rechazó la solicitud");
          for (const sentinel of sentinels) expect(html).not.toContain(sentinel);
        }
      });

      it("test_bare_route_loads_the_configured_authorized_evidence_without_a_submit", async () => {
        const { default: Page } = await import("./page");
        entryPointRows = [{ ...MUNICIPAL_ROWS[0]!, listId: "2206" }];
        const html = renderToStaticMarkup((await Page({ searchParams: Promise.resolve({}) })) as ReactElement);

        expect(loadMunicipalOfficialEvidence).toHaveBeenCalledExactlyOnceWith();
        for (const fact of ["Coronel Rosales", "Distrito 02 · Sección 027", "Concejales", "ALIANZA LA LIBERTAD AVANZA", '<td class="table-cell--number">4200</td>'])
          expect(html).toContain(fact);
        expect(html).not.toContain("<form");
        expect(html).not.toContain("Ver resultados oficiales");
        expect(html).not.toContain("UUID");
      });

      it("test_bare_route_keeps_authorized_failure_states_distinct_and_closed", async () => {
        const { default: Page } = await import("./page");
        entryPointRows = [{ ...MUNICIPAL_ROWS[0]!, listId: "2206" }];
        for (const [status, message] of [
          ["denied", "no autoriza"], ["empty", "No hay resultados oficiales"],
          ["unavailable", "no está disponible"], ["malformed", "formato inválido"],
          ["truncated", "truncada"],
        ] as const) {
          authorizedEvidenceState = { status };
          const html = renderToStaticMarkup((await Page({ searchParams: Promise.resolve({}) })) as ReactElement);
          expect(html).toContain(message);
          for (const sentinel of ["ALIANZA LA LIBERTAD AVANZA", "4200", "procedencia", "<table", "<form"])
            expect(html).not.toContain(sentinel);
          expect(html.includes("Reintentar misma consulta")).toBe(status === "unavailable");
          if (status === "unavailable")
            expect(html).toContain('<a href="/municipal?electionId=2025-municipal">Reintentar misma consulta</a>');
        }
      });

      it("test_query_and_config_guards_refuse_before_the_automatic_read", async () => {
        const { default: Page } = await import("./page");
        for (const params of [
          { electionId: ["2025-municipal", "2025-municipal"] },
          { electionId: "other-election" }, { unexpected: "x" },
          { jurisdictionId: "j-027" }, { categoryId: "c-concejales" },
          { partyJurisdiction: "national" }, { partyCategory: "CONCEJALES" },
        ]) {
          const html = renderToStaticMarkup((await Page({ searchParams: Promise.resolve(params) })) as ReactElement);
          expect(html).toContain("Se rechazó la solicitud");
          expect(loadMunicipalOfficialEvidence).not.toHaveBeenCalled();
        }
        delete process.env["MUNICIPAL_CATEGORY_ID"];
        const html = renderToStaticMarkup((await Page({ searchParams: Promise.resolve({}) })) as ReactElement);
        expect(html).toContain("deben estar configurados");
        expect(loadMunicipalOfficialEvidence).not.toHaveBeenCalled();
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
        expect(html).not.toContain("Reintentar misma consulta");
        expect(html).not.toContain("Volver a elección configurada");
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
          excluded: {}, sourceAudit: { official: { rows: 2, votes: 8400 } },
          partyMappingConfigured: true,
        },
        [{ archiveEntryId: "a", sha256: "a".repeat(64),
          url: "https://example.test/municipal.csv", fetchedAt: "2026-01-01" }],
      ),
    );

    expect(html).toContain("la auditoría de fuente oficial no es válida");
    for (const secret of ["4200", "ALIANZA LA LIBERTAD AVANZA", "https://example.test/municipal.csv"])
      expect(html).not.toContain(secret);
      });
    });

    it("test_votes_by_party_name_conflict_refuses_but_keeps_audit", () => {
      const row = { ...MUNICIPAL_ROWS[0]!, canonicalPartyId: "lla" };
      const html = renderToStaticMarkup(renderMunicipalView({ status: "ok",
        rows: [{ ...row, partyName: "LLA" }, { ...row, partyName: "ALIANZA LLA" }],
        excluded: { fiscalizacion: { rows: 1, votes: 90 } }, sourceAudit: { official: { rows: 2, votes: 8400 } }, partyMappingConfigured: true },
        [{ archiveEntryId: "a", sha256: "b".repeat(64),
          url: "https://example.test/conflict.csv", fetchedAt: "2026-01-01" }]));
      for (const fact of ["Se rechazó", "nombres incompatibles",
        "1 fila fiscalización / 90 votos"])
        expect(html).toContain(fact);
      expect(html).not.toContain("8400 voto(s)");
    expect(html).not.toContain('aria-labelledby="municipal-distribution-heading"');
    });

describe("municipal evidence — the rendered-page defense boundary", () => {
  const validEvidence: Extract<MunicipalOfficialEvidence, { status: "ok" }> = {
    status: "ok",
    result: {
      status: "ok",
      sourceKind: "official",
      categoryName: "CONCEJALES",
      level: "seccion",
      sourceGranularity: "seccion",
      electionYear: 2025,
      electionRound: "provinciales",
      totalVotes: 4200,
      mesaCount: null,
      parties: [{
        identityStatus: "canonical",
        canonicalPartyId: "lla",
        displayName: "ALIANZA LA LIBERTAD AVANZA",
        listId: null,
        votes: 4200,
        voteShare: "1",
      }],
      archiveEntryIds: ["pba/2025-municipal-coronel-rosales"],
      sourceAudit: [{ kind: "official", rows: 1, votes: 4200 }],
      sourceExclusions: [{ kind: "fiscalizacion", rows: 2, votes: 30 }],
    },
    provenance: [],
  };

  it.each([
    ["empty audit", []],
    ["mixed audit", [
      { kind: "official", rows: 1, votes: 4200 },
      { kind: "fiscalizacion", rows: 1, votes: 1 },
    ]],
    ["multiple official audits", [
      { kind: "official", rows: 1, votes: 4200 },
      { kind: "official", rows: 1, votes: 4200 },
    ]],
    ["non-official audit", [{ kind: "fiscalizacion", rows: 1, votes: 4200 }]],
    ["zero-row audit", [{ kind: "official", rows: 0, votes: 4200 }]],
    ["audit vote mismatch", [{ kind: "official", rows: 1, votes: 4199 }]],
  ])("refuses %s before constructing rows", (_case, sourceAudit) => {
    const view = municipalViewFromOfficialEvidence({
      ...validEvidence,
      result: {
        ...validEvidence.result,
        sourceAudit: sourceAudit as typeof validEvidence.result.sourceAudit,
      },
    }, "c-concejales");

    expect(view.status).toBe("read_failed");
    expect(view).not.toHaveProperty("rows");
    expect(view).toEqual({ status: "read_failed", reason: "la auditoría oficial municipal no coincide con las cifras autorizadas" });
  });

  it("refuses a party total that disagrees with the official total", () => {
    const view = municipalViewFromOfficialEvidence({
      ...validEvidence,
      result: {
        ...validEvidence.result,
        parties: [{ ...validEvidence.result.parties[0]!, votes: 4199 }],
      },
    }, "c-concejales");

    expect(view.status).toBe("read_failed");
    expect(view).not.toHaveProperty("rows");
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
        excluded: {}, sourceAudit: { official: { rows: 1, votes: 4200 } },
        partyMappingConfigured: false,
      }),
    );

    expect(html).toContain("no hay una fuente de mapeo curado configurada");
    expect(html).not.toContain("se resolvieron sin un partido curado");
  });
});


describe("municipal page — truthful identified-party distribution", () => {
  const identified = { ...MUNICIPAL_ROWS[0]!, canonicalPartyId: "first", partyName: "Partido identificado", votes: 1 };

  it("keeps zero parties and unresolved evidence without assigning or aggregating it into the chart", () => {
    const html = renderToStaticMarkup(renderMunicipalView({
      status: "ok",
      rows: [identified,
        { ...identified, canonicalPartyId: "zero", partyName: "Partido sin votos", votes: 0 },
        { ...MUNICIPAL_ROWS[0]!, listId: "unmapped", votes: 3 },
        { ...MUNICIPAL_ROWS[0]!, listId: null, votes: 2 },
      ],
      excluded: { fiscalizacion: { rows: 1, votes: 9 } },
      sourceAudit: { official: { rows: 4, votes: 6 } },
      partyMappingConfigured: true,
    }));

    expect(html).toContain("Votos por partido identificado");
    expect(html).toContain("Escala común: de 0 a 1 votos");
    expect(html).toContain('aria-label="Partido identificado: 1 votos"');
    expect(html).toContain('aria-label="Partido sin votos: 0 votos"');
    expect(html).toContain('width="100"');
    expect(html).toContain('width="0"');
    expect(html.match(/role="img"/g)).toHaveLength(2);
    expect(html).toContain("Las filas sin partido identificado se informan por separado");
    expect(html).toContain("unmapped: 1 filas, 3 votos");
    expect(html).toContain("Por tipo de fuente: 1 fila oficial / 2 votos");
    expect(html).toContain("1 fila fiscalización / 9 votos");
    expect(html).not.toContain(" %");
    const details = html.slice(html.indexOf("<details"));
    expect(details).not.toContain("unmapped");
    expect(details).not.toContain("fiscalización");
  });

  it("keeps verification warnings outside the supporting archive disclosure", () => {
    const html = renderToStaticMarkup(renderMunicipalView({
      status: "ok", rows: [identified], excluded: {},
      sourceAudit: { official: { rows: 1, votes: 1 } }, partyMappingConfigured: true,
    }, [{ archiveEntryId: "synthetic-source", sha256: "", fetchedAt: "2026-01-01", status: "unavailable" }]));
    expect(html).toContain("<summary>Archivo y procedencia</summary>");
    const visible = html.slice(0, html.indexOf("<details"));
    expect(visible).toContain("sin hash");
    expect(visible).toContain("estado: unavailable");
  });

  it("states an all-zero distribution without inventing a positive axis maximum", () => {
    const html = renderToStaticMarkup(renderMunicipalView({
      status: "ok", rows: [{ ...identified, votes: 0 }], excluded: {},
      sourceAudit: { official: { rows: 1, votes: 0 } }, partyMappingConfigured: true,
    }));
    expect(html).toContain("Todos los partidos identificados tienen 0 votos");
    expect(html).toContain("Partido identificado");
    expect(html).not.toContain("Escala común: de 0 a 1 votos");
    expect(html).not.toContain("<svg");
    expect(html).toContain('<td class="table-cell--number">0</td>');
  });

  it("distinguishes no identified parties from a zero-vote distribution", () => {
    const html = renderToStaticMarkup(renderMunicipalView({
      status: "ok", rows: [{ ...MUNICIPAL_ROWS[0]!, listId: "unmapped" }],
      excluded: {}, sourceAudit: { official: { rows: 1, votes: 4200 } }, partyMappingConfigured: true,
    }));
    expect(html).toContain("No hay partidos identificados para representar");
    expect(html).toContain("unmapped: 1 filas, 4200 votos");
    expect(html).not.toContain("Todos los partidos identificados tienen 0 votos");
    expect(html).not.toContain("<svg");
  });
});
