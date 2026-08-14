import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { SourceRef } from "@/lib/results/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PartyMappingContext, ResultRow } from "@/lib/fiscalizacion/repository";
import type {
  ExplorationResult,
  SchoolBreakdownResult,
} from "@/lib/results/exploration";

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
let refuseLookupWith: string | null = null;
let refuseSourceReadWith: string | null = null;
let mappingConfigured = true;
let aggregateHoldsVotes: number | null = null;
let aggregateUnsummable: string | null = null;
let aggregateEntryIds: string[] = ["national/2025-legislativas"];
let leakAggregate = false;
let leakFiscalizacion = false;
const explorationRpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
let explorationRpcResult: unknown = { status: "no_rows", reason: "fixture has no rows",
  counts: { selected_rows: 0 }, source_exclusions: [] };
let explorationSchoolsResult: unknown = { status: "source_unavailable",
  reason: "the registered source publishes no establecimiento data",
  counts: { establecimiento_identity_available_rows: 0 }, exclusions: [], source_exclusions: [] };
const EXPLORATION_FACETS = {
  status: "ok",
  elections: [{ id: "2025-legislativas-nacional", year: 2025, round: "legislativas", label: "2025 legislativas" }],
  categories: [{ id: "c-diputados", name: "DIPUTADO NACIONAL" }],
  distritos: [{ code: "02", name: "Buenos Aires", name_status: "present", name_variant_count: 1 }],
  secciones: [{ code: "027", name: "Coronel Rosales", name_status: "present", name_variant_count: 1 }],
  circuitos: [{ code: "00001", name: null, name_status: "missing", name_variant_count: 0 }],
  establecimientos: [{ code: "E1", name: null, name_status: "conflict", name_variant_count: 3 }],
  mesas: [{ code: 7 }],
  available_levels: ["seccion", "circuito", "establecimiento", "mesa"],
};
let explorationFacetResult: unknown = EXPLORATION_FACETS;
let explorationRpcError: string | null = null;
let explorationRepositoryBypass: ExplorationResult | null = null;
let explorationSchoolRepositoryBypass: SchoolBreakdownResult | null = null;
let explorationSchoolsError: string | null = null;

vi.mock("@/lib/supabase/server-client", () => ({
  createSupabaseServerClient: () => Promise.resolve({
    rpc: (name: string, args: Record<string, unknown>) => {
      explorationRpcCalls.push({ name, args });
      return Promise.resolve({
        data: name === "results_exploration_facets" ? explorationFacetResult
          : name === "results_exploration_schools" ? explorationSchoolsResult : explorationRpcResult,
        error: name === "results_exploration_official" && explorationRpcError
          ? { message: explorationRpcError }
          : null,
      });
    },
  }),
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
      const repository = new actual.ResultsRepository(
        {
          fetchRows: () =>
            // A denied read RAISES — the shape RLS denial actually takes.
            refuseWith
              ? Promise.reject(new Error(refuseWith))
              : Promise.resolve(repositoryRows),
        },
        // NO mapping source when unconfigured: the state the page must not
        // report as a fact about the curated table.
        ...(mappingConfigured ? [
        {
          // Keyed on the FULL context: the page refuses without
          // `partyCategory`/`partyJurisdiction` and derives the year from the
          // election id, yet nothing proved any of it reached the name source.
          fetchPartyNames: (context: PartyMappingContext) =>
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
        ] : []),
      );

      if (aggregateHoldsVotes !== null) {
        // Path 2 is an INDEPENDENT fetch, so it can legitimately hold rows path
        // 1 does not see — RLS scope, a mid-write, a different row set. No
        // harness could express that: `leakAggregate` sums the same fixture.
        const held = aggregateHoldsVotes;
        repository.aggregateOfficialVotes = () =>
          Promise.resolve({
            totalVotes: held,
            sourceKind: "official" as const,
            excluded: {},
            summedByKind: { official: { rows: 1, votes: held } },
            unsummableReason: aggregateUnsummable,
            archiveEntryIds: aggregateEntryIds,
          });
      }
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
            unsummableReason: null,
            archiveEntryIds: aggregateEntryIds,
          });
      }
      if (leakFiscalizacion) {
        // The filter REGRESSES. Path 3 exists for exactly this and is
        // unreachable while path 1 works, so simulating the failure is the
        // only way to drive it — the comment claimed a test that did not exist.
        repository.queryOfficial = () =>
          Promise.resolve({ status: "ok", rows: repositoryRows, excluded: {}, partyMappingConfigured: true });
      }
      return Promise.resolve(repository);
    },
    // Stands in for the `category` table, which is what binds `categoryId` to
    // the curated `partyCategory` label.
    fetchCategoryName: (_client: unknown, categoryId: string) =>
      refuseLookupWith
        ? Promise.reject(new Error(refuseLookupWith))
        : Promise.resolve(
            CATEGORY_NAMES[categoryId] === undefined
              ? { status: "no_row" as const }
              : { status: "ok" as const, name: CATEGORY_NAMES[categoryId]! },
          ),
    fetchElectionYear: (_client: unknown, electionId: string) => {
      // A UUID mapped to a year, exactly as the `election` table does it —
      // proving a uuid is SERVED, not merely refused differently.
      if (electionId === "6dae81f9-c862-4cc5-b3f3-b640e4ea7319") {
        return Promise.resolve({ status: "ok" as const, year: 2025 });
      }
      const match = /^(\d{4})/.exec(electionId);
      return Promise.resolve(
        match ? { status: "ok" as const, year: Number(match[1]) } : { status: "no_row" as const },
      );
    },
    fetchSourceRefs: (_client: unknown, ids: string[]) =>
      refuseSourceReadWith
        ? Promise.reject(new Error(refuseSourceReadWith))
        : // Computes `missing` the way the real function does. A double that
          // always answers `[]` cannot exercise the untraceable-entry path it
          // feeds — the fiscalización suite fixed this same shape.
          Promise.resolve({
            sources: sourceRefs,
            missing: ids.filter((id) => !sourceRefs.some((ref) => ref.archiveEntryId === id)),
          }),
  };
});

vi.mock("@/lib/results/exploration", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/results/exploration")>();
  return { ...actual, createResultsExplorationRepository: (client: Parameters<typeof actual.createResultsExplorationRepository>[0]) => {
    const repository = actual.createResultsExplorationRepository(client);
        if (!explorationRepositoryBypass && !explorationSchoolRepositoryBypass) return repository;
        return {
          facets: repository.facets.bind(repository),
          official: explorationRepositoryBypass
            ? () => Promise.resolve(explorationRepositoryBypass!)
            : repository.official.bind(repository),
              schools: explorationSchoolsError
                ? () => Promise.reject(new Error(explorationSchoolsError!))
                : explorationSchoolRepositoryBypass
                  ? () => Promise.resolve(explorationSchoolRepositoryBypass!)
                  : repository.schools.bind(repository),

        };
      } };
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
  aggregateHoldsVotes = null;
  aggregateUnsummable = null;
  aggregateEntryIds = ["national/2025-legislativas"];
  refuseLookupWith = null;
  refuseSourceReadWith = null;
  mappingConfigured = true;
  sourceRefs = [];
  explorationRpcCalls.length = 0;
  explorationRpcResult = { status: "no_rows", reason: "fixture has no rows",
    counts: { selected_rows: 0 }, source_exclusions: [] };
  explorationSchoolsResult = { status: "source_unavailable",
    reason: "the registered source publishes no establecimiento data",
    counts: { establecimiento_identity_available_rows: 0 }, exclusions: [], source_exclusions: [] };
  explorationFacetResult = EXPLORATION_FACETS;
  explorationRpcError = null;
      explorationRepositoryBypass = null;
      explorationSchoolRepositoryBypass = null;
      explorationSchoolsError = null;

});

const PARAMS = {
  electionId: "2025-legislativas-nacional",
  jurisdictionId: "j-027",
  categoryId: "c-diputados",
  // List ids resolve only through their own election's mapping.
  partyCategory: "DIPUTADO NACIONAL",
  partyJurisdiction: "national",
};
const EXPLORER_PARAMS = { electionId: "2025-legislativas-nacional", categoryId: "c-diputados",
  distritoCode: "02", seccionCode: "027", level: "seccion" };
const officialRpc = (level = "seccion") => ({ status: "ok", source_kind: "official", level,
  source_granularity: "mesa", election_year: 2025, election_round: "legislativas",
  total_votes: 300, mesa_count: 2, source_audit: [{ kind: "official", rows: 4, votes: 300 }],
  source_exclusions: [],
  parties: [{ identity_status: "canonical", canonical_party_id: "lla", display_name: "LA LIBERTAD AVANZA",
    list_id: null, votes: 300, vote_share: "1" }], archive_entry_ids: ["national/2025-legislativas"] });

describe("drilldown page", () => {
  it("renders authenticated selectors from a cold start", async () => {
    const markup = renderToStaticMarkup((await DrilldownPage({ searchParams: Promise.resolve({}) })) as ReactElement);
    expect(explorationRpcCalls.map((call) => call.name)).toEqual(["results_exploration_facets"]);
    expect(markup).toContain('<main class="page-shell">');
    expect(markup).not.toContain('id="main-content"');
    for (const text of ["Explorar resultados oficiales", '<form action="/drilldown" method="get">',
      "2025 legislativas", "DIPUTADO NACIONAL"]) expect(markup).toContain(text);
  });

  it("distinguishes missing and conflicting facet names without changing option values", async () => {
    const markup = renderToStaticMarkup((await DrilldownPage({ searchParams: Promise.resolve({}) })) as ReactElement);
    expect(markup).toContain('<option value="00001">00001 — nombre no disponible</option>');
    expect(markup).toContain('<option value="E1">E1 — nombres contradictorios (3 variantes)</option>');
  });

  it("renders the selected establishment and reaches mesa facet discovery with its complete lineage", async () => {
    const markup = renderToStaticMarkup((await DrilldownPage({ searchParams: Promise.resolve({
      electionId: "2025-legislativas-nacional", categoryId: "c-diputados",
      distritoCode: "2", seccionCode: "27", circuitoCode: "1",
      establecimientoCode: "E1", mesaCode: "7", level: "mesa",
    }) })) as ReactElement);
    expect(markup).toContain('<option value="E1" selected="">');
        expect(explorationRpcCalls).toEqual([
          { name: "results_exploration_facets", args: {
            p_election_id: "2025-legislativas-nacional", p_category_id: "c-diputados",
            p_distrito_code: "02", p_seccion_code: "027", p_circuito_code: "00001",
            p_establecimiento_code: "E1",
          } },
          { name: "results_exploration_official", args: {
            p_election_id: "2025-legislativas-nacional", p_category_id: "c-diputados",
            p_distrito_code: "02", p_seccion_code: "027", p_circuito_code: "00001",
            p_establecimiento_code: "E1", p_mesa_code: 7, p_requested_level: "mesa",
          } },
        ]);
  });

  it("drops stale descendants when a changed parent no longer exposes them", async () => {
    explorationFacetResult = { ...EXPLORATION_FACETS,
      establecimientos: [{ code: "E2", name: "New parent", name_status: "present", name_variant_count: 1 }],
      mesas: [],
    };
    const markup = renderToStaticMarkup((await DrilldownPage({ searchParams: Promise.resolve({
      electionId: "2025-legislativas-nacional", categoryId: "c-diputados",
      distritoCode: "2", seccionCode: "27", circuitoCode: "1",
      establecimientoCode: "E1", mesaCode: "7", level: "mesa",
    }) })) as ReactElement);
    expect(markup).not.toContain('<option value="E1" selected="">');
    expect(markup).not.toContain('<option value="7" selected="">');
    expect(explorationRpcCalls.some((call) => call.name === "results_exploration_official")).toBe(false);
  });

  it("keeps the selector form reachable after applying only an election", async () => {
    const markup = renderToStaticMarkup((await DrilldownPage({ searchParams: Promise.resolve({
      electionId: "2025-legislativas-nacional", categoryId: "", distritoCode: "",
      seccionCode: "", circuitoCode: "", establecimientoCode: "", mesaCode: "", level: "",
    }) })) as ReactElement);
    expect(markup).toContain('<label for="explorer-category">Categoría</label>');
    expect(explorationRpcCalls[0]?.args).toMatchObject({
      p_election_id: "2025-legislativas-nacional", p_category_id: null,
    });
  });

  it.each([["seccion", {}], ["circuito", { circuitoCode: "1" }],
    ["establecimiento", { circuitoCode: "1", establecimientoCode: "E1" }],
    ["mesa", { circuitoCode: "1", establecimientoCode: "E1", mesaCode: "7" }]])(
    "drives the %s repository level from a production selector", async (level, extra) => {
    explorationRpcResult = officialRpc(level);

    await DrilldownPage({ searchParams: Promise.resolve({
      electionId: "2025-legislativas-nacional", categoryId: "c-diputados",
      distritoCode: "2", seccionCode: "27", level, ...extra,
    }) });

    const call = explorationRpcCalls.find((entry) => entry.name === "results_exploration_official");
    expect(call?.args["p_requested_level"]).toBe(level);
  });

  it("refuses an orphan mesa at the page entry point without mocking RPC success", async () => {
    explorationRpcResult = officialRpc("mesa");
    const markup = renderToStaticMarkup((await DrilldownPage({ searchParams: Promise.resolve({
      electionId: "2025-legislativas-nacional", categoryId: "c-diputados",
      distritoCode: "2", seccionCode: "27", mesaCode: "7", level: "mesa",
    }) })) as ReactElement);
    expect(markup).toContain("Se rechazó la solicitud:");
    expect(markup).toContain("mesa requiere los niveles superiores circuito y establecimiento");
    expect(explorationRpcCalls.some((call) => call.name === "results_exploration_official")).toBe(false);
  });

  it("renders a copied deep link with canonical and unmapped figures plus RPC provenance", async () => {
    explorationRpcResult = { ...officialRpc("mesa"), mesa_count: 1,
      source_audit: [{ kind: "official", rows: 2, votes: 300 }],
      parties: [
        { identity_status: "canonical", canonical_party_id: "lla", display_name: "LA LIBERTAD AVANZA", list_id: null, votes: 200, vote_share: "0.6667" },
        { identity_status: "unmapped", canonical_party_id: null, display_name: null, list_id: "999", votes: 100, vote_share: "0.3333" },
      ],
    };
    sourceRefs = [{
      archiveEntryId: "national/2025-legislativas", sha256: "e3b0c442",
      url: "https://example.test/2025.zip", fetchedAt: "2026-01-01T00:00:00Z",
    }];

    const markup = renderToStaticMarkup((await DrilldownPage({ searchParams: Promise.resolve({
      electionId: "2025-legislativas-nacional", categoryId: "c-diputados",
       distritoCode: "2", seccionCode: "27", circuitoCode: "1",
       establecimientoCode: "E1", mesaCode: "7", level: "mesa",
    }) })) as ReactElement);

    for (const text of ["LA LIBERTAD AVANZA", "200 votos", "66.67%", "Lista sin mapear 999",
      "https://example.test/2025.zip"]) expect(markup).toContain(text);
    expect(markup).not.toContain("Proporcione los parámetros de consulta <code>jurisdictionId</code>");
  });

  it("renders every official school in a section with composite identity, parties, mesas, and provenance", async () => {
    explorationRpcResult = officialRpc("seccion");
    explorationSchoolsResult = { status: "ok", source_kind: "official", level: "seccion",
      source_audit: [{ kind: "official", rows: 3, votes: 350 }], source_exclusions: [], exclusions: [], schools: [
        { circuito_code: "00001", code: "E1", name: "School one", mesa_count: 2, total_votes: 300,
          archive_entry_ids: ["national/2025-legislativas"], parties: [{ identity_status: "canonical",
            canonical_party_id: "lla", display_name: "LA LIBERTAD AVANZA", list_id: null,
            votes: 300, vote_share: "1" }] },
        { circuito_code: "00002", code: "E1", name: "School two", mesa_count: 1, total_votes: 50,
          archive_entry_ids: ["national/2025-legislativas"], parties: [{ identity_status: "unmapped",
            canonical_party_id: null, display_name: null, list_id: "999", votes: 50, vote_share: "1" }] },
      ] };
    sourceRefs = [{ archiveEntryId: "national/2025-legislativas", sha256: "e3b0c442",
      url: "https://example.test/2025.zip", fetchedAt: "2026-01-01T00:00:00Z" }];
    const markup = renderToStaticMarkup((await DrilldownPage({ searchParams: Promise.resolve(EXPLORER_PARAMS) })) as ReactElement);
    for (const text of ["Desglose oficial por establecimiento", "Circuito 00001 — E1 — School one",
      "Circuito 00002 — E1 — School two", "2 mesas", "Lista sin mapear 999", "50 votos"])
      expect(markup).toContain(text);
  });

  it("renders the actual official boundary result and fails closed on RPC errors", async () => {
    explorationRpcResult = officialRpc();
    const params = EXPLORER_PARAMS;
    const ok = renderToStaticMarkup((await DrilldownPage({ searchParams: Promise.resolve(params) })) as ReactElement);
    expect(ok).toContain("300 votos a nivel seccion, obtenidos de filas de fuente mesa en 2 mesas");

    explorationRpcError = "row-level security denied exploration";
    const refused = renderToStaticMarkup((await DrilldownPage({ searchParams: Promise.resolve(params) })) as ReactElement);
    expect(refused).toContain("Se rechazó la solicitud: results_exploration_official failed: row-level security denied exploration");
  });

  it("renders every source kind excluded by the official RPC", async () => {
    explorationRpcResult = { ...officialRpc(), source_exclusions: [
      { kind: "fiscalizacion", rows: 2, votes: 1776 }, { kind: "unknown", rows: 1, votes: 9 }] };
    const markup = renderToStaticMarkup((await DrilldownPage({ searchParams:
      Promise.resolve(EXPLORER_PARAMS) })) as ReactElement);
    expect(markup).toContain("Se excluyeron 2 filas de fuente fiscalización / 1776 votos del agregado oficial");
    expect(markup).toContain("Se excluyeron 1 fila de fuente desconocida / 9 votos del agregado oficial");
    expect(markup).toContain("300 votos a nivel seccion");
  });

  it("renders source exclusions when an official-only scope refuses for no rows", async () => {
    explorationRpcResult = { status: "no_rows", reason: "no official rows exist",
      counts: { selected_rows: 0 },
      source_exclusions: [{ kind: "fiscalizacion", rows: 2, votes: 1776 }] };
    const markup = renderToStaticMarkup((await DrilldownPage({ searchParams:
      Promise.resolve(EXPLORER_PARAMS) })) as ReactElement);
    expect(markup).toContain("Se rechazó la solicitud: no official rows exist");
    expect(markup).toContain("Se excluyeron 2 filas de fuente fiscalización / 1776 votos del agregado oficial");
  });

      it("retains aggregate exclusions when the rendered aggregate audit refuses", async () => {
        explorationRepositoryBypass = {
          status: "ok", sourceKind: "official", level: "seccion", sourceGranularity: "mesa",
          electionYear: 2025, electionRound: "legislativas", totalVotes: 999, mesaCount: 1,
          sourceAudit: [
            { kind: "official", rows: 2, votes: 999 },
            { kind: "fiscalizacion", rows: 1, votes: 77 },
          ],
          sourceExclusions: [
            { kind: "fiscalizacion", rows: 3, votes: 88 },
            { kind: "unknown", rows: 2, votes: 11 },
          ],
          parties: [{ identityStatus: "canonical", canonicalPartyId: "leaked", displayName: "LEAKED PARTY", listId: null, votes: 999, voteShare: "1" }],
          archiveEntryIds: ["national/2025-legislativas"],
        };

        const markup = renderToStaticMarkup((await DrilldownPage({
          searchParams: Promise.resolve(EXPLORER_PARAMS),
        })) as ReactElement);

        expect(markup).toContain('<form action="/drilldown" method="get">');
        expect(markup).toContain("Se rechazó la solicitud: la auditoría de fuentes del agregado incluye filas no oficiales.");
        expect(markup).toContain("Se excluyeron 3 filas de fuente fiscalización / 88 votos del agregado oficial");
        expect(markup).toContain("Se excluyeron 2 filas de fuente desconocida / 11 votos del agregado oficial");
        expect(markup).not.toContain("999 votos a nivel seccion");
        expect(markup).not.toContain("LEAKED PARTY");
        expect(markup).not.toContain("Votos oficiales y porcentaje por partido");
        expect(markup).not.toContain("https://example.test");
      });

      it("retains aggregate source exclusions when the school read throws", async () => {
            explorationRepositoryBypass = {
              status: "ok", sourceKind: "official", level: "seccion", sourceGranularity: "mesa",
              electionYear: 2025, electionRound: "legislativas", totalVotes: 999, mesaCount: 1,
              sourceAudit: [{ kind: "official", rows: 2, votes: 999 }],
              sourceExclusions: [{ kind: "fiscalizacion", rows: 3, votes: 88 }],
              parties: [{ identityStatus: "canonical", canonicalPartyId: "leaked", displayName: "LEAKED PARTY", listId: null, votes: 999, voteShare: "1" }],
              archiveEntryIds: ["national/2025-legislativas"],
            };
            explorationSchoolsError = "row-level security denied the school read";

            const markup = renderToStaticMarkup((await DrilldownPage({
              searchParams: Promise.resolve(EXPLORER_PARAMS),
            })) as ReactElement);

            expect(markup).toContain('<form action="/drilldown" method="get">');
            expect(markup).toContain("row-level security denied the school read");
            expect(markup).toContain("Se excluyeron 3 filas de fuente fiscalización / 88 votos del agregado oficial");
            expect(markup).not.toContain("Desglose oficial");
            expect(markup).not.toContain("Desglose oficial por establecimiento");
            expect(markup).not.toContain("LEAKED PARTY");
            expect(markup).not.toContain("999 votos a nivel seccion");
            expect(markup).not.toContain("https://example.test");
          });

          it("retains aggregate and school exclusions when the rendered school audit refuses", async () => {
        explorationRepositoryBypass = {
          status: "ok", sourceKind: "official", level: "seccion", sourceGranularity: "mesa",
          electionYear: 2025, electionRound: "legislativas", totalVotes: 300, mesaCount: 2,
          sourceAudit: [{ kind: "official", rows: 4, votes: 300 }],
          sourceExclusions: [{ kind: "unknown", rows: 2, votes: 19 }],
          parties: [{ identityStatus: "canonical", canonicalPartyId: "lla", displayName: "LA LIBERTAD AVANZA", listId: null, votes: 300, voteShare: "1" }],
          archiveEntryIds: ["national/2025-legislativas"],
        };
        explorationSchoolRepositoryBypass = {
          status: "ok", sourceKind: "official", level: "seccion",
          sourceAudit: [
            { kind: "official", rows: 3, votes: 260 },
            { kind: "fiscalizacion", rows: 1, votes: 40 },
          ],
          sourceExclusions: [{ kind: "fiscalizacion", rows: 4, votes: 73 }],
          exclusions: [{ reason: "official_rows_without_mesa_code", rows: 5, votes: 41 }],
          schools: [{
            circuitoCode: "00001", code: "E1", name: "Leaked school", mesaCount: 1,
            totalVotes: 260, archiveEntryIds: ["national/2025-legislativas"],
            parties: [{ identityStatus: "canonical", canonicalPartyId: "lla", displayName: "LA LIBERTAD AVANZA", listId: null, votes: 260, voteShare: "1" }],
          }],
        };

        const markup = renderToStaticMarkup((await DrilldownPage({
          searchParams: Promise.resolve(EXPLORER_PARAMS),
        })) as ReactElement);

        expect(markup).toContain('<form action="/drilldown" method="get">');
        expect(markup).toContain("Se rechazó la solicitud: la auditoría de fuentes del desglose por establecimiento incluye filas no oficiales.");
        expect(markup).toContain("Se excluyeron 2 filas de fuente desconocida / 19 votos del agregado oficial");
        expect(markup).toContain("Se excluyeron 4 filas de fuente fiscalización / 73 votos del agregado establecimiento");
        expect(markup).toContain("Se excluyeron 5 fila(s) / 41 voto(s): official_rows_without_mesa_code");
        expect(markup).not.toContain("Votos oficiales y porcentaje por partido");
        expect(markup).not.toContain("Votos oficiales por circuito y establecimiento");
        expect(markup).not.toContain("Leaked school");
        expect(markup).not.toContain("https://example.test");
      });

      it("retains every known exclusion when the source-reference read refuses", async () => {
        explorationRpcResult = {
          ...officialRpc("seccion"),
          source_exclusions: [
            { kind: "fiscalizacion", rows: 4, votes: 88 },
            { kind: "unknown", rows: 2, votes: 9 },
          ],
        };
        explorationSchoolsResult = {
          status: "ok", source_kind: "official", level: "seccion",
          source_audit: [{ kind: "official", rows: 3, votes: 300 }],
          source_exclusions: [{ kind: "fiscalizacion", rows: 3, votes: 77 }],
          exclusions: [{ reason: "official_rows_without_mesa_code", rows: 5, votes: 44 }],
          schools: [{
            circuito_code: "00001", code: "E1", name: "Unusable school", mesa_count: 1,
            total_votes: 300, archive_entry_ids: ["national/2025-legislativas"],
            parties: [{ identity_status: "canonical", canonical_party_id: "lla", display_name: "LA LIBERTAD AVANZA", list_id: null, votes: 300, vote_share: "1" }],
          }],
        };
        refuseSourceReadWith = "row-level security denied the source read";

        const markup = renderToStaticMarkup((await DrilldownPage({
          searchParams: Promise.resolve(EXPLORER_PARAMS),
        })) as ReactElement);

        expect(markup).toContain('<form action="/drilldown" method="get">');
        expect(markup).toContain("row-level security denied the source read");
        expect(markup).toContain("Se excluyeron 4 filas de fuente fiscalización / 88 votos del agregado oficial");
        expect(markup).toContain("Se excluyeron 2 filas de fuente desconocida / 9 votos del agregado oficial");
        expect(markup).toContain("Se excluyeron 3 filas de fuente fiscalización / 77 votos del agregado establecimiento");
        expect(markup).toContain("Se excluyeron 5 fila(s) / 44 voto(s): official_rows_without_mesa_code");
        expect(markup).not.toContain("Desglose oficial");
        expect(markup).not.toContain("Votos oficiales y porcentaje por partido");
        expect(markup).not.toContain("Desglose oficial por establecimiento");
        expect(markup).not.toContain("Unusable school");
      });

      it("renders official and fiscalizacion non-mesa school exclusions independently", async () => {
    explorationRpcResult = officialRpc();
    explorationSchoolsResult = { status: "ok", source_kind: "official", level: "seccion",
      source_audit: [{ kind: "official", rows: 1, votes: 10 }],
      source_exclusions: [{ kind: "fiscalizacion", rows: 1, votes: 70 }],
      exclusions: [{ reason: "official_rows_without_mesa_granularity", rows: 1, votes: 20 }],
      schools: [{ circuito_code: "00001", code: "E1", name: null, mesa_count: 1,
        total_votes: 10, archive_entry_ids: ["national/2025-legislativas"],
        parties: [{ identity_status: "unmapped", canonical_party_id: null,
          display_name: null, list_id: "110", votes: 10, vote_share: "1" }] }] };
    const markup = renderToStaticMarkup((await DrilldownPage({ searchParams:
      Promise.resolve(EXPLORER_PARAMS) })) as ReactElement);
    expect(markup).toContain("Se excluyeron 1 fila de fuente fiscalización / 70 votos del agregado establecimiento");
    expect(markup).toContain("Se excluyeron 1 fila(s) / 20 voto(s): official_rows_without_mesa_granularity");
  });

  it.each([
    ["the section school breakdown exceeds the bounded payload limit", { schools: 501, payload_school_limit: 500 }],
    ["one complete establecimiento identity carries conflicting names", { ambiguous_establecimiento_name: 1 }],
  ])("renders school exclusion evidence when refusing: %s", async (reason, counts) => {
    explorationRpcResult = officialRpc();
    explorationSchoolsResult = { status: "selection_invalid", reason, counts,
      exclusions: [{ reason: "official_rows_without_mesa_code", rows: 2, votes: 40 }],
      source_exclusions: [{ kind: "fiscalizacion", rows: 3, votes: 90 }] };
    const markup = renderToStaticMarkup((await DrilldownPage({ searchParams:
      Promise.resolve(EXPLORER_PARAMS) })) as ReactElement);
    expect(markup).toContain(`Se rechazó la solicitud: ${reason}`);
    expect(markup).toContain("Se excluyeron 2 fila(s) / 40 voto(s): official_rows_without_mesa_code");
    expect(markup).toContain("Se excluyeron 3 filas de fuente fiscalización / 90 votos del agregado establecimiento");
  });

  it("refuses a widened aggregate at the render even if parser protection regresses", async () => {
    explorationRepositoryBypass = {
      status: "ok", sourceKind: "official", level: "seccion", sourceGranularity: "mesa",
      electionYear: 2025, electionRound: "legislativas", totalVotes: 999, mesaCount: 1,
      sourceAudit: [{ kind: "official", rows: 1, votes: 100 }, { kind: "fiscalizacion", rows: 1, votes: 899 }],
      sourceExclusions: [],
      parties: [{ identityStatus: "canonical", canonicalPartyId: "leaked", displayName: "LEAKED PARTY", listId: null, votes: 999, voteShare: "1" }],
      archiveEntryIds: ["national/2025-legislativas", "fiscalizacion/leaked"],
    };
    const markup = renderToStaticMarkup((await DrilldownPage({ searchParams: Promise.resolve(EXPLORER_PARAMS) })) as ReactElement);
    expect(markup).toContain("Se rechazó la solicitud:");
    expect(markup).not.toContain("999 votos");
    expect(markup).not.toContain("LEAKED PARTY");
  });

  it.each([
    ["party total", { votes: 299, vote_share: "1" }],
    ["party share", { votes: 300, vote_share: "0.5" }],
  ])("never renders an inconsistent aggregate %s", async (_case, inconsistency) => {
    explorationRpcResult = { ...officialRpc(), parties: [{
      identity_status: "canonical", canonical_party_id: "invalid", display_name: "INVALID FIGURE",
      list_id: null, ...inconsistency }] };
    const markup = renderToStaticMarkup((await DrilldownPage({ searchParams: Promise.resolve(EXPLORER_PARAMS) })) as ReactElement);
    expect(markup).toContain("Se rechazó la solicitud:"); expect(markup).not.toContain("INVALID FIGURE");
  });

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

    expect(markup).toContain("No se encontraron resultados oficiales");
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
    expect(markup).toContain("sumarlas duplicaría el conteo");
    expect(markup).toContain("No hay cifras por partido");
    // And NO badge: `readGranularity` folds to the coarsest level, so a badge
    // beside the refusal names one of the mixed levels as if it were the set's.
    expect(markup).not.toContain('aria-label="granularidad:');
    expect(markup).not.toContain("20 votos");
    // The independent read's total is built the same way, so it goes too.
    expect(markup).not.toContain("Total oficial:");
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
    expect(markup).toContain("Total oficial: 100 votos");
    expect(markup).toContain("1 fila fiscalización");
    // The value outside the enum is named, not folded into silence.
    expect(markup).toContain("1 fila desconocida");
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
    expect(markup).toContain("no son oficiales");
    // And the BREAKDOWN, in both units: a bare "1 of 1 rows" cannot tell a
    // leaked fiscalización row from a leaked unknown-kind one, and hides how
    // many votes came with it.
    expect(markup).toContain("1 fila fiscalización / 100 votos");
    expect(markup).not.toContain("Total oficial:");
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
    expect(markup).toContain("más de una vez");
  });
});

describe("drilldown page — an omitted param is named as omitted", () => {
  it("test_a_missing_party_jurisdiction_is_not_reported_as_a_mismatch", async () => {
    // Run after the family guard, this rendered "j-027 is mapped by the
    // national party table, not undefined" — the wrong cause, with an empty
    // interpolation where a value belongs.
    const withoutJurisdiction = { ...PARAMS };
    Reflect.deleteProperty(withoutJurisdiction, "partyJurisdiction");

    const markup = renderToStaticMarkup(
      (await DrilldownPage({
        searchParams: Promise.resolve(withoutJurisdiction),
      })) as ReactElement,
    );

    expect(markup).toContain("partyJurisdiction");
    expect(markup).not.toContain("no undefined");
    expect(markup).not.toContain("mapea la jurisdicción");
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
    expect(markup).toContain('aria-label="granularidad: seccion"');
    expect(markup).toContain("sumado a partir de filas de nivel mesa");
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

    expect(markup).toContain("sin hash — esta entrada no puede verificarse");
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

    expect(markup).toContain("se calculó con filas que no son oficiales");
    expect(markup).toContain("1 fila fiscalización / 60 votos");
    // Path 2's OWN drop, which path 1 never saw. Counted moments before this
    // refusal and then discarded behind it.
    // No apostrophe in the needle: `renderToStaticMarkup` escapes it to
    // `&#x27;`, so the literal sentence never appears verbatim.
    expect(markup).toContain("lectura propia del total oficial excluyó");
    expect(markup).toContain("4 filas desconocida / 777 votos");
    // The inflated number must not reach the page at all.
    expect(markup).not.toContain("Total oficial:");
  });
});

describe("drilldown page — the year comes from the election row", () => {
  it("test_a_uuid_election_id_is_served_not_refused_for_want_of_a_year", async () => {
    // The defect this replaced: the year was parsed out of the election id, so
    // a uuid — which is what the database actually stores — answered `null` and
    // every real request refused with "provide an election id that carries its
    // year". The id was fine; the reader was looking in the wrong place.
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
      (await DrilldownPage({
        searchParams: Promise.resolve({
          ...PARAMS,
          electionId: "6dae81f9-c862-4cc5-b3f3-b640e4ea7319",
        }),
      })) as ReactElement,
    );

    // SERVED: the figure renders, and no year-shaped refusal appears.
    expect(markup).not.toContain("contiene su año");
    expect(markup).not.toContain("ninguna fila de elección tiene el ID");
    expect(markup).toContain("LA LIBERTAD AVANZA: 100 votos");
  });
});

describe("drilldown page — unmapped list ids are counted, not just labelled", () => {
  it("test_unresolved_list_ids_are_broken_down_per_id_in_both_units", async () => {
    // `votesByParty` LABELS an unresolved row (`unmapped (list 4321)`) but does
    // not count it, and a label without a size is not a breakdown: one id
    // covering 40 % of the votes and forty ids covering 1 % render identically.
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
        // Absent from the mapping fixture, so it resolves to no party.
        listId: "4321",
        votes: 700,
        sourceKind: "official",
        granularity: "mesa",
        archiveEntryId: "national/2025-legislativas",
      },
    ];

    const markup = renderToStaticMarkup(
      (await DrilldownPage({ searchParams: Promise.resolve(PARAMS) })) as ReactElement,
    );

    expect(markup).toContain("4321: 1 filas, 700 votos");
    expect(markup).toContain("se resolvieron sin un partido curado");
  });
});

describe("drilldown page — the guards that bound each axis", () => {
  it("test_a_category_that_is_not_the_requested_one_is_refused", async () => {
    // `categoryId` filters the rows and `partyCategory` keys the mapping. A
    // list id present in BOTH tables resolves to a different canonical party
    // under the wrong one — a real name, no alarm.
    const markup = renderToStaticMarkup(
      (await DrilldownPage({
        searchParams: Promise.resolve({ ...PARAMS, partyCategory: "SENADOR NACIONAL" }),
      })) as ReactElement,
    );

    expect(markup).toContain("no SENADOR NACIONAL");
  });

  it("test_a_category_id_no_row_carries_is_refused_as_such", async () => {
    // Distinct from a mismatch: nothing to compare against, said plainly.
    const markup = renderToStaticMarkup(
      (await DrilldownPage({
        searchParams: Promise.resolve({ ...PARAMS, categoryId: "c-nope" }),
      })) as ReactElement,
    );

    expect(markup).toContain("no aparece en ninguna fila de categoría");
  });

  it("test_a_jurisdiction_outside_the_configured_family_is_refused", async () => {
    // Only the OMITTED-param case was driven; the family mismatch itself — the
    // branch that stops national rows resolving through the municipal table —
    // had no driver.
    const markup = renderToStaticMarkup(
      (await DrilldownPage({
        searchParams: Promise.resolve({ ...PARAMS, jurisdictionId: "j-999" }),
      })) as ReactElement,
    );

    expect(markup).toContain("ninguna tabla de partidos configurada mapea la jurisdicción");
  });

  it("test_an_election_id_no_row_carries_is_refused_not_defaulted", async () => {
    // A mapping year nobody established is what resolves `110` and `20135` as
    // two parties.
    const markup = renderToStaticMarkup(
      (await DrilldownPage({
        searchParams: Promise.resolve({ ...PARAMS, electionId: "no-such-election" }),
      })) as ReactElement,
    );

    expect(markup).toContain("ninguna fila de elección tiene el ID");
  });

  it("test_a_failed_lookup_is_reported_not_swallowed", async () => {
    // The lookups THROW on a Postgres error like every other read; without the
    // catch the failure escaped into the framework instead of this page's
    // refusal.
    refuseLookupWith = "row-level security denied the category read";

    const markup = renderToStaticMarkup(
      (await DrilldownPage({ searchParams: Promise.resolve(PARAMS) })) as ReactElement,
    );

    expect(markup).toContain("row-level security denied the category read");
  });
});

describe("drilldown page — the two reads disagree about whether there is data", () => {
  it("test_no_rows_while_the_official_total_holds_votes_is_stated_once", async () => {
    // The state the page's own comment calls "the one where suppressing it hid
    // the most", and the one no fixture reached: path 1 returns nothing while
    // path 2 — an independent fetch — holds votes.
    aggregateHoldsVotes = 250;
    repositoryRows = [];

    const markup = renderToStaticMarkup(
      (await DrilldownPage({ searchParams: Promise.resolve(PARAMS) })) as ReactElement,
    );

    // NOT "no official results found": an independent read holds votes.
    expect(markup).not.toContain("No se encontraron resultados oficiales");
    expect(markup).toContain("no devolvió filas, mientras que la lectura propia del total oficial");
    // ONCE. Both alerts firing printed one disagreement as two.
    expect(markup).not.toContain("provienen de lecturas separadas y no coinciden");
  });
});

describe("drilldown page — the unmapped breakdown survives every refusal", () => {
  const seedUnmapped = () => {
    repositoryRows = [
      {
        jurisdictionId: "j-027",
        categoryId: "c-diputados",
        listId: "4321",
        votes: 700,
        sourceKind: "official",
        granularity: "subcircuito" as never,
        archiveEntryId: "national/2025-legislativas",
      },
    ];
  };

  it("test_a_mixed_source_refusal_withholds_unmapped_vote_totals", async () => {
        leakFiscalizacion = true;
        repositoryRows = [
          {
            jurisdictionId: "j-027",
            categoryId: "c-diputados",
            listId: "4321",
            votes: 700,
            sourceKind: "official",
            granularity: "mesa",
            archiveEntryId: "national/2025-legislativas",
          },
          {
            jurisdictionId: "j-027",
            categoryId: "c-diputados",
            listId: "9876",
            votes: 60,
            sourceKind: "fiscalizacion",
            granularity: "mesa",
            archiveEntryId: "fiscalizacion/2025-lla",
          },
        ];

        const markup = renderToStaticMarkup(
          (await DrilldownPage({ searchParams: Promise.resolve(PARAMS) })) as ReactElement,
        );

        expect(markup).toContain("no son oficiales");
        expect(markup).toContain("4321: 1 filas");
        expect(markup).toContain("9876: 1 filas");
        expect(markup).not.toContain("4321: 1 filas, 700 votos");
        expect(markup).not.toContain("9876: 1 filas, 60 votos");
        expect(markup).toContain("las cifras oficiales y de fiscalización nunca se combinan en un mismo número");
        expect(markup).not.toContain("Total oficial:");
        expect(markup).not.toContain("Desglose oficial");
      });

      it("test_it_survives_the_path_three_leakage_refusal", async () => {
    // Which ids failed to map does not depend on source kinds. Counted before
    // the guard and then dropped behind a refusal about something else.
    seedUnmapped();
    repositoryRows.push({
      jurisdictionId: "j-027",
      categoryId: "c-diputados",
      listId: "110",
      votes: 60,
      sourceKind: "fiscalizacion",
      granularity: "mesa",
      archiveEntryId: "fiscalizacion/2025-lla",
    });
    leakFiscalizacion = true;

    const markup = renderToStaticMarkup(
      (await DrilldownPage({ searchParams: Promise.resolve(PARAMS) })) as ReactElement,
    );

    expect(markup).toContain("no son oficiales");
    expect(markup).toContain("4321: 1 filas");
    // And the unorderable level, wired into the same refusal and driven by
    // nothing: five branches carried it, one test reached the success path.
    expect(markup).toContain("subcircuito: 1 filas");
  });

  it("test_it_survives_a_failed_source_read", async () => {
    seedUnmapped();
    refuseSourceReadWith = "row-level security denied the source read";

    const markup = renderToStaticMarkup(
      (await DrilldownPage({ searchParams: Promise.resolve(PARAMS) })) as ReactElement,
    );

    expect(markup).toContain("row-level security denied the source read");
    expect(markup).toContain("4321: 1 filas");
  });
});

describe("drilldown page — a level this app cannot order is named", () => {
  it("test_an_unorderable_granularity_is_reported_per_level_through_the_page", async () => {
    // `UnorderableLevels` is wired into five render branches across two pages
    // and nothing drove any of them — the unreachable-capability shape this
    // change kept finding elsewhere.
    repositoryRows = [
      {
        jurisdictionId: "j-027",
        categoryId: "c-diputados",
        listId: "110",
        votes: 100,
        sourceKind: "official",
        granularity: "subcircuito" as never,
        archiveEntryId: "national/2025-legislativas",
      },
      {
        jurisdictionId: "j-027",
        categoryId: "c-diputados",
        listId: "110",
        votes: 40,
        sourceKind: "official",
        granularity: "subcircuito" as never,
        archiveEntryId: "national/2025-legislativas",
      },
    ];

    const markup = renderToStaticMarkup(
      (await DrilldownPage({ searchParams: Promise.resolve(PARAMS) })) as ReactElement,
    );

    expect(markup).toContain("no puede ordenar");
    // ROWS, never a summed vote total: containment is unknown for this level.
    expect(markup).toContain("subcircuito: 2 filas");
    expect(markup).not.toContain("140 votos");
  });
});

describe("drilldown page — an unsummable aggregate is never printed", () => {
  it("test_the_empty_rows_alert_fires_when_path_2_is_summable", async () => {
    // The COMPANION of the test below: it pins that this fixture really does
    // reach the empty-rows alert, so the absence asserted there means the
    // guard fired and not that the fixture missed the branch.
    aggregateHoldsVotes = 250;
    repositoryRows = [];

    const markup = renderToStaticMarkup(
      (await DrilldownPage({ searchParams: Promise.resolve(PARAMS) })) as ReactElement,
    );

    // Sanity: this fixture DOES reach the empty-rows alert when path 2 is
    // summable, which is what the sibling test pins.
    expect(markup).toContain("no devolvió filas, mientras que la lectura propia del total oficial");
  });

  it("test_an_unsummable_aggregate_states_why_instead_of_a_total", async () => {
    aggregateUnsummable = "las filas mezclan 2 niveles de granularidad (mesa, seccion); sumarlas duplicaría el conteo";
    aggregateHoldsVotes = 250;
    repositoryRows = [];

    const markup = renderToStaticMarkup(
      (await DrilldownPage({ searchParams: Promise.resolve(PARAMS) })) as ReactElement,
    );

    expect(markup).toContain("No hay total oficial");
    // The number itself reaches no site on the page.
    expect(markup).not.toContain("250");
    // And NOT an absence claim: `mixedGranularityReason` needs two levels, so
    // path 2 cannot be unsummable without having READ rows. Withholding the
    // total is not the same as there being no data.
    expect(markup).not.toContain("No se encontraron resultados oficiales");
  });
});

describe("drilldown page — the official total traces to its own sources", () => {
  it("test_path_2s_archive_entries_are_resolved_too", async () => {
    // Provenance was resolved from path 1's rows only, and `Official total`
    // comes from an INDEPENDENT fetch whose row set can differ — so that
    // displayed figure shipped with no source record and could not even appear
    // in `missing`. The existing provenance test shares one entry between both
    // reads, so they coincide and the gap stays invisible.
    // The double is what lets path 2 report a DIFFERENT entry than path 1 —
    // which is the whole point: the two reads are independent.
    aggregateHoldsVotes = 100;
    aggregateEntryIds = ["national/2023-generales"];
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
    sourceRefs = [
      {
        archiveEntryId: "national/2025-legislativas",
        sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        url: "https://example.test/2025-legislativas.zip",
        fetchedAt: "2026-01-01T00:00:00Z",
      },
    ];

    const markup = renderToStaticMarkup(
      (await DrilldownPage({ searchParams: Promise.resolve(PARAMS) })) as ReactElement,
    );

    // The aggregate's OWN entry has no source record, and the page says so
    // instead of quietly tracing only the rows below the total.
    expect(markup).toContain("national/2023-generales");
    expect(markup).toContain("no se pueden rastrear");
  });
});

describe("drilldown page — no mapping source is not a claim about the data", () => {
  it("test_an_unconfigured_mapping_source_says_so_instead_of_no_curated_party", async () => {
    // With no `PartyNameSource`, EVERY row comes back unresolved, and
    // "resolved to no curated party" would state a fact about the curated
    // table that is really a fact about the caller's configuration — the
    // substitution `resolvePartyNames` documents, one function downstream.
    mappingConfigured = false;
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

    expect(markup).toContain("no hay una fuente de mapeo curado configurada");
    expect(markup).not.toContain("se resolvieron sin un partido curado");
  });
});

describe("drilldown page — responsive selector and evidence presentation", () => {
      it("groups the selector controls without changing the GET contract", async () => {
        const markup = renderToStaticMarkup(
          (await DrilldownPage({ searchParams: Promise.resolve({}) })) as ReactElement,
        );

        expect(markup).toMatch(/<header class="page-header">/);
        expect(markup).toContain(
          '<section class="panel" aria-labelledby="explorer-form-heading">',
        );
        expect(markup).toContain('<form action="/drilldown" method="get">');
        expect(markup).toContain('<fieldset class="form-grid selector-form">');
        expect(markup).toContain(
          '<legend class="selector-form__legend">Selectores de resultados</legend>',
        );
        expect(markup.match(/class="field"/g) ?? []).toHaveLength(8);
      });

      it("keeps every result table in a labelled focusable evidence region", async () => {
        const schoolName = `Escuela-${"n".repeat(72)}`;
        explorationRpcResult = officialRpc("seccion");
        explorationSchoolsResult = {
          status: "ok",
          source_kind: "official",
          level: "seccion",
          source_audit: [{ kind: "official", rows: 1, votes: 300 }],
          source_exclusions: [],
          exclusions: [],
          schools: [
            {
              circuito_code: "00001",
              code: "E1",
              name: schoolName,
              mesa_count: 2,
              total_votes: 300,
              archive_entry_ids: ["national/2025-legislativas"],
              parties: [
                {
                  identity_status: "canonical",
                  canonical_party_id: "lla",
                  display_name: "LA LIBERTAD AVANZA",
                  list_id: null,
                  votes: 300,
                  vote_share: "1",
                },
              ],
            },
          ],
        };

        const markup = renderToStaticMarkup(
          (await DrilldownPage({ searchParams: Promise.resolve(EXPLORER_PARAMS) })) as ReactElement,
        );

        expect(markup.match(/<table class="data-table">/g) ?? []).toHaveLength(2);
        expect(markup.match(/class="table-scroll"/g) ?? []).toHaveLength(2);
        expect(markup).toContain(
          'aria-label="Votos oficiales y porcentaje por partido" tabindex="0"',
        );
        expect(markup).toContain(
          'aria-label="Votos oficiales por circuito y establecimiento" tabindex="0"',
        );
        expect(markup).toContain("<caption>Votos oficiales y porcentaje por partido</caption>");
        expect(markup).toContain(
          "<caption>Votos oficiales por circuito y establecimiento</caption>",
        );
        expect(markup.match(/scope="col"/g) ?? []).toHaveLength(8);
        expect(markup).toContain(
          `class="evidence-text" scope="row">Circuito 00001 — E1 — ${schoolName}</th>`,
        );
      });
    });
