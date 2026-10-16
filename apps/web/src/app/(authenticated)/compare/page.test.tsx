import { readFileSync } from "node:fs";
import { comparisonFixture } from "../../../../e2e/result-fixture";
import type { ReactElement } from "react";
import { ComparisonMapView, type MapMetric } from "./ComparisonMap";
import type { UnitSwing } from "@/lib/results/compare";
import { renderToStaticMarkup } from "react-dom/server";
import type { FacetOption } from "@/lib/results/exploration";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ facets: vi.fn(), evidence: vi.fn(), geometry: vi.fn(), replace: vi.fn(), completeness: vi.fn(), circuits: vi.fn() }));
vi.mock("@/lib/workspace/official-section-completeness", () => ({ loadOfficialSectionCompleteness: mocks.completeness }));
vi.mock("@/lib/workspace/official-section-circuit-outcomes", () => ({ loadOfficialSectionCircuitOutcomes: mocks.circuits }));
vi.mock("@/lib/workspace/municipal-section-geometry", () => ({ loadMunicipalSectionGeometry: mocks.geometry }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: mocks.replace }), redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); } }));
vi.mock("@/lib/workspace/official-facets", () => ({ AuthorizedOfficialFacetsError: class AuthorizedOfficialFacetsError extends Error {}, OFFICIAL_FACETS_ERROR: { AUTHORIZATION_DENIED: "authorization_denied" }, createAuthorizedOfficialFacetRepository: () => ({ facets: mocks.facets }) }));
vi.mock("@/lib/workspace/official-comparison-evidence", () => ({ OFFICIAL_COMPARISON_EVIDENCE_STATUS: { OK: "ok", EMPTY: "empty", AUTHORIZATION_DENIED: "authorization_denied", UNAVAILABLE: "unavailable", PAYLOAD_TOO_LARGE: "payload_too_large", MALFORMED: "malformed", UNMAPPED_PARTIES: "unmapped_parties" }, loadAuthorizedOfficialComparisonEvidence: mocks.evidence }));
const { default: ComparePage } = await import("./page");
const IDS = { leftElection: "10000000-0000-4000-8000-000000000001", rightElection: "10000000-0000-4000-8000-000000000002", leftCategory: "20000000-0000-4000-8000-000000000001", rightCategory: "20000000-0000-4000-8000-000000000002" } as const;
const PARAMS = { electionId: IDS.leftElection, categoryId: IDS.leftCategory, bElectionId: IDS.rightElection, bCategoryId: IDS.rightCategory, distritoCode: "02", seccionCode: "027" };
const elections = [{ id: IDS.leftElection, year: 2023, round: "generales", label: "2023 generales" }, { id: IDS.rightElection, year: 2025, round: "generales", label: "2025 generales" }, { id: "10000000-0000-4000-8000-000000000003", year: 2021, round: "generales", label: "2021 generales" }];
const district: FacetOption = { code: "02", name: "Buenos Aires", nameStatus: "present", nameVariantCount: 1 }, section: FacetOption = { code: "027", name: "Coronel Rosales", nameStatus: "present", nameVariantCount: 1 };
let leftDistricts = [district], rightDistricts = [district];
let leftSections = [section], rightSections = [section];
function facets(selection: Record<string, string | undefined>) { const left = selection.electionId === IDS.leftElection, right = selection.electionId === IDS.rightElection; return { elections, categories: left ? [{ id: IDS.leftCategory, name: "DIPUTADOS 2023" }] : right ? [{ id: IDS.rightCategory, name: "DIPUTADOS 2025" }] : [], distritos: selection.categoryId ? left ? leftDistricts : right ? rightDistricts : [] : [], secciones: selection.distritoCode ? left ? leftSections : right ? rightSections : [] : [], circuitos: [], establecimientos: [], mesas: [], availableLevels: selection.seccionCode ? ["distrito", "seccion"] : [], exclusions: [] }; }
function side(year: 2023 | 2025, electionId: string, categoryId: string, votes: readonly [number, number]) { const archiveEntryId = `official/archive-${year}`, total = votes[0] + votes[1]; return { result: { status: "ok" as const, sourceKind: "official" as const, level: "seccion" as const, sourceGranularity: "mesa" as const, categoryName: "DIPUTADO NACIONAL", electionYear: year, electionRound: "generales", totalVotes: total, mesaCount: 1, parties: [{ identityStatus: "canonical" as const, canonicalPartyId: "party-a", displayName: year === 2023 ? "PARTIDO A 2023" : "PARTIDO A 2025", listId: null, votes: votes[0], voteShare: String(votes[0] / total) }, { identityStatus: "canonical" as const, canonicalPartyId: "party-b", displayName: year === 2023 ? "PARTIDO B 2023" : "PARTIDO B 2025", listId: null, votes: votes[1], voteShare: String(votes[1] / total) }], archiveEntryIds: [archiveEntryId], sourceAudit: [{ kind: "official", rows: 2, votes: total }], sourceExclusions: [{ kind: "fiscalizacion", rows: 1, votes: 999 }] }, reference: { items: [{ jurisdictionId: `${year}-section`, electionId, year, round: "generales", categoryId, categoryName: `DIPUTADOS ${year}`, distritoCode: "02", distritoName: "Buenos Aires", seccionCode: "027", seccionName: "Coronel Rosales", circuitoCode: null, circuitoName: null, establecimientoCode: null, establecimientoName: null, mesaCode: null }], sourceExclusions: [{ kind: "fiscalizacion", reason: "non_official_source" as const, rows: 1 }] }, provenance: { items: [{ archiveEntryId, capability: "national", mime: "text/csv", bytes: 120, fetchedAt: "2026-01-01T00:00:00Z", status: "ok" as const, sha256: "a".repeat(64) }], sourceExclusions: [{ kind: "fiscalizacion", rows: 1, votes: 999 }] } }; }
function evidence() { return { status: "ok" as const, left: side(2023, IDS.leftElection, IDS.leftCategory, [60, 40]), right: side(2025, IDS.rightElection, IDS.rightCategory, [55, 45]) }; }
beforeEach(() => { mocks.completeness.mockReset().mockResolvedValue({ status: "unavailable" }); mocks.circuits.mockReset().mockResolvedValue({ status: "unavailable" }); leftDistricts = [district]; rightDistricts = [district]; leftSections = [section]; rightSections = [section]; mocks.facets.mockReset().mockImplementation(facets); mocks.evidence.mockReset().mockResolvedValue(evidence()); mocks.geometry.mockReset().mockResolvedValue({ status: "ok", name: "Cnel. de Marina L.Rosales", sha256: "964af68999504c107c71eaccd8470055f990071eccba09f227e81b6dc31df673", fetchedAt: "2026-09-24T03:29:24Z", geometry: { type: "MultiPolygon", coordinates: [[[[-62, -38], [-61, -38], [-61, -37], [-62, -38]]]] } }); }); afterEach(() => vi.clearAllMocks());
async function render(params: Record<string, string | string[] | undefined>): Promise<string> { return renderToStaticMarkup((await ComparePage({ searchParams: Promise.resolve(params) })) as ReactElement); }
it("preserves the merged mobile region reading order through both evidence rails", async () => {
  supportedSpatialEvidence();
  const html = await render(PARAMS);
  const markers = ['id="compare-shared-heading"', 'id="compare-edit-a-heading"', 'id="compare-edit-b-heading"', 'aria-label="Mesa de comparación territorial"', 'aria-labelledby="compare-child-heading"', 'aria-label="Contexto de comparación autorizada"', 'aria-labelledby="compare-chart-heading"', 'aria-label="Tabla exacta de participación', 'id="compare-evidence-a-heading"', 'id="compare-evidence-b-heading"'];
  const positions = markers.map(marker => { const index = html.indexOf(marker); expect(index, marker).toBeGreaterThanOrEqual(0); return index; });
  for (let i = 1; i < positions.length; i++) expect(positions[i], `${markers[i - 1]} before ${markers[i]}`).toBeGreaterThan(positions[i - 1]!);
  expect(html.indexOf('id="compare-side-b-heading"')).toBeGreaterThan(html.indexOf('id="compare-side-a-heading"'));
});

it("folds the secondary chart by default without removing its data", async () => {
  const html = await render(PARAMS);
  expect(html).toMatch(/<details[^>]*data-comparison-chart=""[^>]*><summary>Gráfico de participación oficial por partido<\/summary>/);
  expect(html.match(/<details[^>]*data-comparison-chart=""[^>]*>/)?.[0]).not.toMatch(/\bopen(?:\s|=|>)/);
  expect(html).toContain('aria-labelledby="compare-chart-heading"');
  expect(html).toContain("PARTIDO A 2023");
});

it("folds each official reference while retaining visible evidence and coverage rails", async () => {
  const html = await render(PARAMS);
  for (const side of ["A", "B"]) {
    expect(html).toMatch(new RegExp(`<details[^>]*data-reference-side="${side}"[^>]*><summary>Referencia oficial — Lado ${side}</summary>`));
    expect(html.match(new RegExp(`<details[^>]*data-reference-side="${side}"[^>]*>`))?.[0]).not.toMatch(/\bopen(?:\s|=|>)/);
    expect(html).toContain(`Evidencia oficial — Lado ${side}`);
    expect(html).toContain(`Cobertura y exclusiones — Lado ${side}`);
  }
  expect(html).toContain("referencia(s), elección");
  expect(html).toContain("excluidas de todas las cifras");
});

it("renders one shared map action set for both official panels", async () => {
  supportedSpatialEvidence();
  const html = await render(PARAMS);
  expect(html.match(/>Mostrar mapa interactivo</g)).toHaveLength(1);
  expect(html.match(/>Seleccionar sección y consultar resultados</g)).toHaveLength(1);
  expect(html.match(/>Ir a los resultados exactos de la sección</g)).toHaveLength(1);
  expect(html).toContain('aria-label="Controles compartidos de los mapas"');
});

it("redirects old compare URLs through the real route before authorized reads", async () => {
  await expect(render({ leftElectionId: IDS.leftElection, rightElectionId: IDS.rightElection, leftCategoryId: IDS.leftCategory, rightCategoryId: IDS.rightCategory, distritoCode: "2", seccionCode: "27" })).rejects.toThrow(`REDIRECT:/compare?electionId=${IDS.leftElection}&categoryId=${IDS.leftCategory}&sourceKind=official&distritoCode=02&seccionCode=027&bElectionId=${IDS.rightElection}&bCategoryId=${IDS.rightCategory}`);
  expect(mocks.facets).not.toHaveBeenCalled();
});
it.each([
  { ...PARAMS, sourceKind: "fiscalizacion" },
  { ...PARAMS, distritoCode: "027" },
  { ...PARAMS, leftElectionId: IDS.leftElection },
  { ...PARAMS, circuitoCode: "12" },
  { ...PARAMS, leftElectionId: [IDS.leftElection, IDS.rightElection] },
])("rejects unsafe or conflicting compare context before authorized reads %j", async (params) => {
  expect(await render(params)).toContain("Se rechazó la solicitud");
  expect(mocks.facets).not.toHaveBeenCalled();
  expect(mocks.evidence).not.toHaveBeenCalled();
});
function supportedSpatialEvidence() {
  const original = mocks.facets.getMockImplementation()!;
  mocks.facets.mockImplementation(async (selection: Record<string, string | undefined>) => {
    const result = await original(selection);
    return { ...result, elections: result.elections.map((election: { id: string; round: string; label: string }) => election.id === IDS.rightElection ? { ...election, round: "legislativas", label: "2025 legislativas" } : election), categories: result.categories.map((category: { id: string; name: string }) => ({ ...category, name: "DIPUTADO NACIONAL" })) };
  });
  const value = evidence();
  value.left.result.categoryName = "DIPUTADO NACIONAL";
  value.right.result.categoryName = "DIPUTADO NACIONAL";
  value.right.result.electionRound = "legislativas";
  value.left.reference.items[0]!.categoryName = "DIPUTADO NACIONAL";
  value.right.reference.items[0]!.categoryName = "DIPUTADO NACIONAL";
  value.right.reference.items[0]!.round = "legislativas";
  mocks.evidence.mockResolvedValue(value);
  return value;
}

it("reads shared context for a selected 2023 PASO without asserting unsupported geography", async () => {
  const original = mocks.facets.getMockImplementation()!;
  mocks.facets.mockImplementation(async (selection) => {
    const value = await original(selection);
    return { ...value, elections: value.elections.map((item: typeof elections[number]) => item.year === 2023 ? { ...item, round: "paso", label: "2023 PASO" } : item) };
  });
  const value = evidence();
  value.left.result.electionRound = "paso";
  mocks.evidence.mockResolvedValue(value);
  const markup = await render(PARAMS);
  expect(markup).toContain("Elección: 2023 PASO");
  expect(markup).not.toContain("Lado A — 2023 generales");
  expect(mocks.geometry).not.toHaveBeenCalled();
});

it("uses A/B vocabulary throughout the real rendered page", async () => {
  expect(await render(PARAMS)).not.toMatch(/izquierd|derech/i);
});

it.each(["unmapped", "granularity", "canonical"])("keeps safe editors without any figures for a %s refusal", async (reason) => {
  const value = evidence();
  if (reason === "unmapped") mocks.evidence.mockResolvedValue({ status: "unmapped_parties", sides: [{ side: "left", partyCount: 1, totalVotes: 40 }] });
  if (reason === "granularity") { Object.assign(value.right.result, { sourceGranularity: "distrito" }); mocks.evidence.mockResolvedValue(value); }
  if (reason === "canonical") { value.left.result.parties[1]!.votes = -1; mocks.evidence.mockResolvedValue(value); }
  const markup = await render(PARAMS);
  expect(markup.match(/<select\b/g)).toHaveLength(6);
  for (const selected of Object.values(PARAMS)) expect(markup).toContain(`value="${selected}" selected=""`);
  expect(markup).not.toMatch(/<table|\d+ votos|\d+,\d+ %|official\/archive|Referencia oficial|Procedencia oficial|Comparación aplicada/);
});

it("puts the workbench before selection details and paints static maps on load", async () => {
  supportedSpatialEvidence();
  const markup = await render(PARAMS);
  const workbench = markup.indexOf('aria-label="Mesa de comparación territorial"');
  for (const text of ["La comparación se actualiza al cambiar la selección.", "Opciones no compartidas — Distrito", "Comparación aplicada", 'aria-label="Contexto de comparación autorizada"']) expect(workbench).toBeLessThan(markup.indexOf(text));
});

it("keeps optional map actions and consolidated applied context folded on the rendered page", async () => {
  supportedSpatialEvidence();
  const markup = await render(PARAMS);
  expect(markup.match(/<details[^>]*data-map-controls=""/g)).toHaveLength(1);
  expect(markup).not.toMatch(/<details[^>]*data-map-controls=""[^>]*open/);
  expect(markup).toMatch(/<details[^>]*data-applied-context=""[^>]*><summary><span>Comparación aplicada<\/span><span> · Contexto y límites<\/span><\/summary>/);
  expect(markup).toContain("Mostrar mapa interactivo");
  expect(markup).toContain("Seleccionar sección y consultar resultados");
  expect(markup).toMatch(/<details[^>]*data-child-controls=""[^>]*><summary>Controles del siguiente nivel<\/summary>/);
  expect(markup).toContain("Completitud de la sección");
  expect(markup).toContain("Dos elecciones oficiales");
});

it("consolidates applied context and selection notes into one closed lower disclosure", async () => {
  supportedSpatialEvidence();
  const markup = await render(PARAMS);
  const context = markup.match(/<details[^>]*data-applied-context=""[^>]*>[\s\S]*?<\/details>/)?.[0] ?? "";
  expect(context).toContain("Comparación aplicada");
  expect(context).toContain("Contexto y límites");
  expect(context).toContain("La comparación se actualiza al cambiar la selección.");
  expect(context).toContain("Opciones no compartidas — Distrito");
  expect(context).toContain("Opciones no compartidas — Sección");
  expect(context).toContain('aria-label="Contexto de comparación autorizada"');
  expect(context).not.toMatch(/<details[^>]*open/);
  expect(markup).not.toContain("<summary>Notas de la selección</summary>");
  expect(markup).not.toContain("<h2>Detalles de la selección</h2>");
  expect(markup.match(/Comparación aplicada/g)).toHaveLength(1);
  expect(markup.indexOf('id="compare-child-heading"')).toBeLessThan(markup.indexOf('data-applied-context=""'));
});

it.each([false, true])("orders inspector → child changes → context → exact table with child membership available=%s", async (available) => {
  supportedSpatialEvidence();
  if (available) mocks.circuits.mockResolvedValue({ status: "ok", circuit_membership: "known",
    circuits: [{ circuito_code: "00248", positive_total: 100, status: "complete", parties: [
      { identity_status: "canonical", canonical_party_id: "party-a", votes: 60 },
      { identity_status: "canonical", canonical_party_id: "party-b", votes: 40 },
    ] }], unassigned: { catalogue_mesas_without_membership: 0, membership_quarantined_mesas: 0,
      membership_quarantine_reasons: {}, completeness_quarantines: 0, completeness_quarantine_reasons: {}, unexpected_status_mesas: 0 } });
  const markup = await render(PARAMS);
  const destinations = ['aria-label="Detalle de comparación"', 'id="compare-child-heading"', 'data-applied-context=""',
    'id="compare-results-heading"', 'data-results-for="compare-results-heading"', 'id="compare-evidence-heading"'];
  for (const [index, destination] of destinations.entries()) {
    expect(markup).toContain(destination);
    if (index > 0) expect(markup.indexOf(destinations[index - 1]!)).toBeLessThan(markup.indexOf(destination));
  }
  expect(markup.match(/data-results-for="compare-results-heading"/g)).toHaveLength(1);
  expect(markup.match(/id="compare-child-heading"/g)).toHaveLength(1);
  if (available) {
    expect(markup).toContain("1 de 1 pares comparables");
    expect(markup.indexOf("Cambio por circuito sobre votos positivos incluidos</caption>")).toBeLessThan(markup.indexOf("Participación oficial y variación en puntos porcentuales</caption>"));
  } else expect(markup).toContain("Comparabilidad del siguiente nivel no disponible");
});

it("paints two static maps on load", async () => {
  supportedSpatialEvidence();
  const markup = await render(PARAMS);
  expect(markup.match(/aria-label="Mapa estático/g)).toHaveLength(2);
});

it("offers the three map metrics with participation selected", async () => {
  supportedSpatialEvidence();
  const markup = await render(PARAMS);
  expect(markup).toMatch(/aria-pressed="true"[^>]*>Participación/);
  for (const text of ["Cambio", "Ganadores"]) expect(markup).toMatch(new RegExp(`aria-pressed="false"[^>]*>${text}`));
});

function metricMarkup(metric: MapMetric, party = "party-a", missing = false) {
  const swing: UnitSwing = { unitId: "02/027", flipped: true,
    shares2023: [{ party: "party-a", votes: 60, sharePercent: 60 }, { party: "party-b", votes: 40, sharePercent: 40 }],
    shares2025: [{ party: "party-a", votes: 25, sharePercent: 25 }, { party: "party-b", votes: 75, sharePercent: 75 }], swings: [] };
  if (missing) swing.shares2025 = swing.shares2025.filter(entry => entry.party !== party);
  return renderToStaticMarkup(<ComparisonMapView {...{ electionLabels: ["2023 PASO", "2025 generales"] as [string, string] }} coordinates={[[[[-62, -38], [-61, -38], [-61, -37], [-62, -38]]]]} name="Rosales" fetchedAt="2026-09-24" sha256="verified" swing={swing} leftNames={{ "party-a": "PARTIDO A 2023", "party-b": "PARTIDO B 2023" }} rightNames={{ "party-a": "PARTIDO A 2025", "party-b": "PARTIDO B 2025" }} party={party} metric={metric} onMetric={() => {}} />);
}
it("derives map headings from selected election labels including 2023 PASO", () => {
  const markup = metricMarkup("Participación");
  expect(markup).toContain("Lado A — 2023 PASO");
  expect(markup).toContain("Lado B — 2025 generales");
  expect(markup).not.toContain("2023 generales");
});
it("renders each controlled metric with its own scale and pressed state", () => {
  for (const metric of ["Participación", "Cambio", "Ganadores"] as const) {
    const markup = metricMarkup(metric);
    expect(markup).toMatch(new RegExp(`aria-pressed="true"[^>]*>${metric}`));
    expect(markup.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(markup.match(/aria-label="Mapa estático/g)).toHaveLength(2);
    if (metric === "Participación") {
      expect(markup).toContain("PARTIDO A 2025: 25,00 %");
      expect(markup).toContain("rgba(103,165,182,");
      expect(markup).not.toContain("Leyenda categórica");
    } else if (metric === "Cambio") {
      expect(markup).toContain("Línea de base A; cambio 0,00 pp");
      expect(markup).toContain("PARTIDO A 2025: B − A -35,00 pp");
      expect(markup).toContain("−100 pp");
      expect(markup).toContain("+100 pp");
      expect(markup).toContain("rgba(173,170,159,");
    } else {
      expect(markup).toContain("Ganador: PARTIDO A 2023");
      expect(markup).toContain("Ganador: PARTIDO B 2025");
      expect(markup).toContain("rgba(170,192,241,");
      expect(markup).toContain("Leyenda categórica de ganadores");
      expect(markup).not.toContain("Escala de color común");
      expect(metricMarkup(metric, "party-b")).toContain("Ganador: PARTIDO A 2023");
    }
  }
});
it("updates selected-party fills and computes positive change without changing the winners", () => {
  expect(metricMarkup("Participación", "party-b")).toContain("PARTIDO B 2025: 75,00 %");
  const change = metricMarkup("Cambio", "party-b");
  expect(change).toContain("B − A +35,00 pp");
  expect(change).toContain("rgba(124,181,195,");
});
it("disables absent-observation metrics with accessible reasons rather than zero filling", () => {
  const markup = metricMarkup("Participación", "party-a", true);
  for (const metric of ["Participación", "Cambio"]) expect(markup).toMatch(new RegExp(`disabled="" aria-describedby="metric-reason-${metric}"`));
  expect(markup).toContain("se requieren observaciones de la agrupación en ambos lados");
  expect(markup).toContain("Observación no disponible");
  expect(markup).not.toContain("PARTIDO A 2025: 0,00 %");
});

it("pins the spatial fixture side-B selected-party fill to the interactive raster contract", async () => {
  const value = supportedSpatialEvidence();
  // Only build the pure seed; no e2e environment, database setup, or browser is invoked.
  const { identity, seed } = comparisonFixture("e2e/comparison.spec.ts", "spatial");
  for (const [index, side] of [value.left, value.right].entries()) {
    side.result.parties[0]!.votes = Number(seed.rows.find(row => row.election_id === identity.electionIds[index] && row.list_id === identity.comparisonParty!.listIds[index] && row.jurisdiction_id === identity.jurisdictionId)!.votes);
    side.result.parties[1]!.votes = Number(seed.rows.find(row => row.election_id === identity.electionIds[index] && row.list_id === identity.comparisonOtherParty!.listIds[index])!.votes);
  }
  mocks.evidence.mockResolvedValue(value);
  const markup = await render(PARAMS);
  const sideB = markup.match(/<article[^>]*aria-label="Lado B — 2025 legislativas"[^>]*>[\s\S]*?<\/article>/)?.[0] ?? "";
  expect(sideB).toContain("PARTIDO A 2025: 75,00 %");
  expect(sideB).toContain("rgba(102,208,222,");
  // The e2e screenshot must expect the same selected-party RGB as the route's static map.
  const spec = readFileSync(new URL("../../../../e2e/comparison.spec.ts", import.meta.url), "utf8");
  const expected = spec.match(/const rightFill = \[([^\]]+)\]/)?.[1]?.split(",").map(Number);
  expect(expected).toEqual([102, 208, 222]);
});

it("keeps all six selected native values readable outside the single-line controls on phones", async () => {
  const markup = await render(PARAMS);
  const editor = markup.match(/<form[\s\S]*?<\/form>/)?.[0] ?? "";
  const fullValues = [...editor.matchAll(/<span class="responsive-select__value" data-mobile-select-value="" aria-hidden="true">([^<]*)<\/span>/g)].map(match => match[1]);
  expect(fullValues).toHaveLength(6);
  expect(fullValues).toEqual(expect.arrayContaining(["02 — Buenos Aires", "027 — Coronel Rosales", "2023 generales", "2025 generales", "DIPUTADOS 2023", "DIPUTADOS 2025"]));
  expect(editor).not.toContain("compare-full-values");
});

it("renders the approved header and paired selection without changing authorized query keys", async () => {
  const markup = await render(PARAMS);
  expect(markup).toContain("<h1>Comparación electoral</h1>");
  expect(markup).toContain("Dos muestras. El mismo territorio. Una lectura compartida.");
  expect(markup).toContain('aria-label="Recorrido territorial"');
  expect(markup).toContain("Una selección territorial para ambas vistas.");
  expect(markup).toContain("El zoom no modifica las cifras.");
  for (const text of ["Territorio", "Agrupación", "Todas las agrupaciones", "Elección A (2023)", "Categoría A", "Elección B (2025)", "Categoría B"]) expect(markup).toContain(text);
  expect(markup).toMatch(/<button[^>]*disabled=""[^>]*aria-describedby="compare-swap-reason"[^>]*>[\s\S]*?Intercambiar<\/button>/);
  expect(markup).toContain("A está limitada a 2023 y B a 2025");
  const editor = markup.match(/<form[\s\S]*?<\/form>/)?.[0] ?? "";
  // The shared Agrupación is a fixed reading, not a dead control: the form keeps only its six real selectors.
  expect(editor.match(/<select\b/g)).toHaveLength(6);
  expect(editor).not.toContain('id="compare-group"');
  expect(editor).toMatch(/<div[^>]*role="group"[^>]*aria-describedby="compare-group-reason"[^>]*>[\s\S]*?Agrupación[\s\S]*?Todas las agrupaciones/);
  expect(editor).toMatch(/aria-hidden="true">A<\/span>/);
  expect(editor).toMatch(/aria-hidden="true">B<\/span>/);
  expect(editor.indexOf("Elección A (2023)")).toBeLessThan(editor.indexOf("Intercambiar"));
  expect(editor.indexOf("Intercambiar")).toBeLessThan(editor.indexOf("Elección B (2025)"));
  for (const name of Object.keys(PARAMS)) expect(markup).toContain(`name="${name}"`);
  expect(markup).not.toContain("Datos de demostración");
});

it("places the territorial navigator before paired analytics in the approved comparison workbench", async () => {
  supportedSpatialEvidence();
  const markup = await render(PARAMS);
  expect(markup).toContain('aria-label="Mesa de comparación territorial"');
  expect(markup).toContain('aria-label="Detalle de comparación"');
  expect(markup).toContain('aria-label="Navegador territorial"');
  expect(markup.indexOf('aria-label="Navegador territorial"')).toBeLessThan(markup.indexOf('aria-label="Participación de la agrupación seleccionada"'));
  expect(markup).toContain("Cambio por territorio");
  expect(markup).toContain("Votos A");
  expect(markup).toContain("Votos B");
  expect(markup).toContain("Votos B − A");
});

it("reports unavailable child comparison without inventing coverage when membership is absent", async () => {
  supportedSpatialEvidence();
  mocks.completeness.mockResolvedValue({ status: "unknown", reason: "no_expected_catalogue" });
  mocks.circuits.mockResolvedValue({ status: "unavailable" });
  const markup = await render(PARAMS);
  expect(markup).toContain("Comparabilidad del siguiente nivel no disponible");
  expect(markup).toContain("Completitud desconocida");
  expect(markup).not.toContain("0 de 0 pares comparables");
});

it("refuses incompatible authorized categories before rendering comparison figures", async () => {
  const value = evidence();
  value.right.result.categoryName = "SENADOR NACIONAL";
  mocks.evidence.mockResolvedValue(value);
  const markup = await render(PARAMS);
  expect(markup).toContain("Las categorías oficiales no son compatibles");
  expect(markup.match(/<select\b/g)).toHaveLength(6);
  for (const value of Object.values(PARAMS)) expect(markup).toContain(`value="${value}" selected=""`);
  expect(markup).not.toMatch(/<table|60,00 %|official\/archive/);
});

it("retains partial circuit pairs with reasons instead of zero-filling their change", async () => {
  const circuit = (code: string, status: "complete" | "partial") => ({ circuito_code: code, positive_total: 100, status,
    parties: [{ identity_status: "canonical", canonical_party_id: "party-a", display_name: "PARTIDO A", list_id: null, votes: 60 }, { identity_status: "canonical", canonical_party_id: "party-b", display_name: "PARTIDO B", list_id: null, votes: 40 }],
    counts: { expected: 1, counted: status === "complete" ? 1 : 0, not_counted: 0, missing: status === "complete" ? 0 : 1, unexpected: 0, quarantined: 0 } });
  mocks.circuits.mockResolvedValue({ status: "ok", authorization_status: "authorized", source_kind: "official", level: "seccion", truncated: false, circuit_membership: "known", category_applicability: "district_reported_categories",
    circuits: [circuit("00248", "complete"), circuit("0248A", "partial")], unassigned: { catalogue_mesas_without_membership: 0, membership_quarantined_mesas: 0, membership_quarantine_reasons: {}, completeness_quarantines: 0, completeness_quarantine_reasons: {}, unexpected_status_mesas: 0 } });
  const markup = await render(PARAMS);
  expect(markup).toContain("1 de 2 pares comparables");
  expect(markup).toContain("Cobertura parcial: 1");
  expect(markup).toContain("Circuito 00248");
  const partial = markup.match(/<tr[^>]*><th scope="row">Circuito 0248A[\s\S]*?<\/tr>/)?.[0];
  expect(partial).toContain("Cobertura parcial");
  expect(partial).not.toContain("0,00");
  expect(markup).toContain('id="compare-child-order"');
});

it("shows paired current-reference geography for the exact authorized national deputy elections", async () => {
  supportedSpatialEvidence();
  const markup = await render(PARAMS);
  expect(markup).toContain("Comparación territorial de referencia");
  expect(markup).toContain("2023 generales");
  expect(markup).toContain("2025 legislativas");
  expect(markup).toContain("2026-09-24");
  expect(markup).toContain("Escala común 0–100 % de votos partidarios");
  expect(markup).toContain("Lado A — 2023 generales");
  expect(markup).toContain("Lado B — 2025 legislativas");
  expect(markup).toContain("Mayor participación en la sección: PARTIDO A 2023 — 60,00 % (60 votos de 100 votos partidarios incluidos)");
  expect(markup).toContain("Mayor participación en la sección: PARTIDO A 2025 — 55,00 % (55 votos de 100 votos partidarios incluidos)");
  expect(markup.match(/Mostrar mapa interactivo/g)).toHaveLength(1);
  expect(markup).toContain("no certifica límites históricos");
  for (const side of ["A", "B"]) {
    expect(markup).toMatch(new RegExp(`<details class="[^"]*sideFigures[^"]*"><summary>Cifras — Lado ${side}</summary><p>Denominador: `));
  }
  expect(markup).toContain("Resultados exactos");
  expect(mocks.geometry).toHaveBeenCalledOnce();
});

it("shows different election leaders on one fixed share legend through the authorized route", async () => {
  const value = supportedSpatialEvidence();
  value.right.result.parties[0]!.votes = 25;
  value.right.result.parties[1]!.votes = 75;
  mocks.evidence.mockResolvedValue(value);
  const markup = await render(PARAMS);
  expect(markup).toContain("PARTIDO A 2023 — 60,00 % (60 votos de 100 votos partidarios incluidos)");
  expect(markup).toContain("PARTIDO B 2025 — 75,00 % (75 votos de 100 votos partidarios incluidos)");
  expect(markup).toContain("Participación de la agrupación seleccionada.");
  expect(markup).toContain("Escala de color común: 0 %");
  expect(markup).toContain("100 %");
});

it("refuses tied official leaders at the real route before loading geometry or exposing figures", async () => {
  const value = supportedSpatialEvidence();
  value.left.result.parties[0]!.votes = 50;
  value.left.result.parties[1]!.votes = 50;
  mocks.evidence.mockResolvedValue(value);
  const markup = await render(PARAMS);
  expect(markup).toContain("La comparación canónica no superó sus controles y no se muestran cifras.");
  expect(markup).not.toMatch(/Comparación territorial de referencia|Mapa geográfico|<table|PARTIDO A 2023|PARTIDO A 2025|official\/archive|60,00 %|55,00 %/);
  expect(mocks.geometry).not.toHaveBeenCalled();
});

it("makes the exact-results destination keyboard-focusable for map selection", async () => {
  supportedSpatialEvidence();
  const markup = await render(PARAMS);
  expect(markup).toMatch(/<h2 id="compare-results-heading" tabIndex="-1">Resultados exactos<\/h2>|<h2 id="compare-results-heading" tabindex="-1">Resultados exactos<\/h2>/);
});

it("keeps exact official results when current geometry is unavailable", async () => {
  supportedSpatialEvidence();
  mocks.geometry.mockResolvedValue({ status: "withheld" });
  const markup = await render(PARAMS);
  expect(markup).toContain("Referencia geográfica no disponible");
  expect(markup).toContain("60,00 %");
  expect(markup).toContain("official/archive-2023");
  expect(markup).not.toContain("Comparación territorial de referencia");
});

it("never loads spatial geometry for a mismatched reference pair", async () => {
  const value = supportedSpatialEvidence();
  value.right.reference.items[0]!.categoryId = IDS.leftCategory;
  mocks.evidence.mockResolvedValue(value);
  const markup = await render(PARAMS);
  expect(markup).toContain("Resultados exactos");
  expect(markup).not.toContain("Comparación territorial de referencia");
  expect(mocks.geometry).not.toHaveBeenCalled();
});

it("never loads spatial geometry when one official side is denied", async () => {
  supportedSpatialEvidence();
  mocks.evidence.mockResolvedValue({ status: "authorization_denied" });
  const markup = await render(PARAMS);
  expect(markup).not.toContain("Comparación territorial de referencia");
  expect(markup).not.toContain("60,00 %");
  expect(mocks.geometry).not.toHaveBeenCalled();
});

describe("authorized comparison page", () => {
  it("loads authorized facets for independent sides and one shared exact section", async () => { const markup = await render({}); for (const name of ["electionId", "bElectionId", "categoryId", "bCategoryId", "distritoCode", "seccionCode"]) expect(markup).toContain(`name="${name}"`); expect(markup).toContain('<form action="/compare" method="get">'); expect(markup).toContain("2023 generales"); expect(markup).toContain("2025 generales"); expect(markup).not.toContain("2021 generales"); expect(mocks.facets).toHaveBeenCalledTimes(1); expect(mocks.evidence).not.toHaveBeenCalled(); await render({ electionId: IDS.leftElection, bElectionId: IDS.rightElection }); expect(mocks.facets).toHaveBeenCalledWith({ electionId: IDS.leftElection }); expect(mocks.facets).toHaveBeenCalledWith({ electionId: IDS.rightElection }); });
  it("keeps a shared district code when side names differ and loads its sections", async () => { rightDistricts = [{ ...district, name: "Provincia de Buenos Aires" }]; const markup = await render({ ...PARAMS, seccionCode: undefined }); expect(markup).toContain('<option value="02" selected="">02 — nombres contradictorios</option>'); expect(markup).not.toContain("Buenos Aires"); expect(markup).not.toContain("Provincia de Buenos Aires"); expect(markup).toContain("027 — Coronel Rosales"); expect(mocks.facets).toHaveBeenCalledWith({ electionId: IDS.leftElection, categoryId: IDS.leftCategory, distritoCode: "02" }); expect(mocks.facets).toHaveBeenCalledWith({ electionId: IDS.rightElection, categoryId: IDS.rightCategory, distritoCode: "02" }); });
  it("reconciles present and missing metadata without choosing the present name", async () => { rightDistricts = [{ code: "02", name: null, nameStatus: "missing", nameVariantCount: 0 }]; const markup = await render({ ...PARAMS, distritoCode: undefined, seccionCode: undefined }); expect(markup).toContain('<option value="02">02 — nombres contradictorios</option>'); expect(markup).not.toContain("Buenos Aires"); expect(markup).not.toContain("nombre no disponible"); });
  it("keeps a shared conflict when only its variant counts differ", async () => { leftDistricts = [{ code: "02", name: null, nameStatus: "conflict", nameVariantCount: 2 }]; rightDistricts = [{ code: "02", name: null, nameStatus: "conflict", nameVariantCount: 3 }]; const markup = await render({ ...PARAMS, distritoCode: undefined, seccionCode: undefined }); expect(markup).toContain('<option value="02">02 — nombres contradictorios</option>'); });
  it("keeps a shared section code with conflicting metadata reachable for comparison", async () => { rightSections = [{ ...section, name: "Coronel de Marina Rosales" }]; const selectorMarkup = await render({ ...PARAMS, seccionCode: undefined }); expect(selectorMarkup).toContain('<option value="027">027 — nombres contradictorios</option>'); expect(selectorMarkup).not.toContain("Coronel Rosales"); expect(selectorMarkup).not.toContain("Coronel de Marina Rosales"); await render(PARAMS); expect(mocks.evidence).toHaveBeenCalledWith(expect.objectContaining({ seccionCode: "027" }), expect.objectContaining({ seccionCode: "027" })); });
  it("keeps an exactly matching option unchanged", async () => { const markup = await render({ ...PARAMS, distritoCode: undefined, seccionCode: undefined }); expect(markup).toContain('<option value="02">02 — Buenos Aires</option>'); expect(markup).not.toContain("nombres contradictorios"); });
  it("excludes one-sided district codes while disclosing their side-specific counts", async () => { leftDistricts = [...leftDistricts, { code: "99", name: "Distrito unilateral izquierdo", nameStatus: "present", nameVariantCount: 1 }]; rightDistricts = [...rightDistricts, { code: "98", name: "Distrito unilateral derecho", nameStatus: "present", nameVariantCount: 1 }]; const markup = await render({ ...PARAMS, distritoCode: undefined, seccionCode: undefined }); expect(markup).not.toContain('value="99"'); expect(markup).not.toContain('value="98"'); expect(markup).not.toContain("Distrito unilateral izquierdo"); expect(markup).not.toContain("Distrito unilateral derecho"); expect(markup).toContain("Opciones no compartidas — Distrito: 1 Lado A / 1 Lado B (disponibles solo en ese lado)."); });
  it("excludes one-sided section codes and discloses counts separately after a shared district", async () => { leftSections = [...leftSections, { code: "999", name: "Sección unilateral izquierda", nameStatus: "present", nameVariantCount: 1 }]; rightSections = [...rightSections, { code: "998", name: "Sección unilateral derecha", nameStatus: "present", nameVariantCount: 1 }]; const markup = await render({ ...PARAMS, seccionCode: undefined }); expect(markup).not.toContain('value="999"'); expect(markup).not.toContain('value="998"'); expect(markup).not.toContain("Sección unilateral izquierda"); expect(markup).not.toContain("Sección unilateral derecha"); expect(markup).toContain("Opciones no compartidas — Distrito: 0 Lado A / 0 Lado B (disponibles solo en ese lado)."); expect(markup).toContain("Opciones no compartidas — Sección: 1 Lado A / 1 Lado B (disponibles solo en ese lado)."); });
  it("keeps a same-code metadata conflict selectable without counting it as one-sided", async () => { rightDistricts = [{ ...district, name: "Provincia de Buenos Aires" }]; const markup = await render({ ...PARAMS, distritoCode: undefined, seccionCode: undefined }); expect(markup).toContain('<option value="02">02 — nombres contradictorios</option>'); expect(markup).toContain("Opciones no compartidas — Distrito: 0 Lado A / 0 Lado B (disponibles solo en ese lado)."); });
  it("does not represent an unqueried section level as zero exclusions", async () => { const markup = await render({ ...PARAMS, distritoCode: undefined, seccionCode: undefined }); expect(markup).toContain("Opciones no compartidas — Distrito: 0 Lado A / 0 Lado B (disponibles solo en ese lado)."); expect(markup).not.toContain("Opciones no compartidas — Sección:"); });
  it("renders canonical swing figures and URL-free provenance from the all-or-nothing evidence", async () => { const markup = await render(PARAMS); expect(mocks.evidence).toHaveBeenCalledWith(expect.objectContaining({ electionId: IDS.leftElection, categoryId: IDS.leftCategory, distritoCode: "02", seccionCode: "027", requestedLevel: "seccion" }), expect.objectContaining({ electionId: IDS.rightElection, categoryId: IDS.rightCategory, distritoCode: "02", seccionCode: "027", requestedLevel: "seccion" })); for (const text of ["PARTIDO A 2023", "PARTIDO A 2025", "60,00 %", "55,00 %", "-5,00 puntos porcentuales", "Referencia oficial — Lado A", "A: 1 referencia(s)", "official/archive-2023", "official/archive-2025", "Procedencia oficial — Lado B", "SHA-256"]) expect(markup).toContain(text); expect(markup).not.toMatch(/https?:\/\//); expect(markup).not.toContain("/private/"); expect(markup).not.toContain("999 votos"); });
  it("refuses all rendered output when a successful side is not official-only", async () => { const value = evidence(); Object.assign(value.left.result as { sourceKind: string; totalVotes: number; parties: Array<{ displayName: string; votes: number; voteShare: string }>; archiveEntryIds: string[]; sourceAudit: Array<{ kind: string; rows: number; votes: number }> }, { sourceKind: "fiscalizacion", totalVotes: 1000, parties: [{ ...value.left.result.parties[0]!, displayName: "SENTINEL_LEFT_FIGURE", votes: 777, voteShare: "0.777" }, { ...value.left.result.parties[1]!, displayName: "SENTINEL_LEFT_FIGURE_B", votes: 223, voteShare: "0.223" }], archiveEntryIds: ["SENTINEL_LEFT_ARCHIVE_PROVENANCE"], sourceAudit: [{ kind: "official", rows: 2, votes: 1000 }] }); value.left.reference.items = Array.from({ length: 73 }, (_, index) => ({ ...value.left.reference.items[0]!, jurisdictionId: `SENTINEL_LEFT_REFERENCE_${index}` })); value.left.provenance.items[0]!.archiveEntryId = "SENTINEL_LEFT_ARCHIVE_PROVENANCE"; mocks.evidence.mockResolvedValue(value); const markup = await render(PARAMS); expect(markup).toContain("La evidencia oficial autorizada no superó la validación integral y no se muestran cifras."); for (const sentinel of ["SENTINEL_LEFT_FIGURE", "77,70 %", "73 referencia(s)", "SENTINEL_LEFT_ARCHIVE", "SENTINEL_LEFT_ARCHIVE_PROVENANCE"]) expect(markup).not.toContain(sentinel); });
  it.each([{ sourceAudit: [{ kind: "fiscalizacion", rows: 2, votes: 100 }] }, { sourceAudit: [{ kind: "unknown", rows: 2, votes: 100 }] }, { sourceAudit: [{ kind: "official" }] }, { sourceAudit: { kind: "official", rows: 2, votes: 100 } }, { sourceAudit: undefined }] as const)("refuses all output without identifying a side when included source audit is non-official or malformed", async ({ sourceAudit }) => { const value = evidence(); (value.right.result as { sourceAudit: unknown }).sourceAudit = sourceAudit; mocks.evidence.mockResolvedValue(value); const markup = await render(PARAMS); expect(markup).toContain("La evidencia oficial autorizada no superó la validación integral y no se muestran cifras."); for (const hidden of ["Lado A", "Lado B", "PARTIDO A 2023", "PARTIDO A 2025", "official/archive-2023", "official/archive-2025", "puntos porcentuales"]) expect(markup).not.toContain(hidden); });
  it.each(["left", "right"] as const)("refuses all rendered output when the %s official audit is empty", async (sideName) => { const value = evidence(); (value[sideName].result as { sourceAudit: unknown }).sourceAudit = []; mocks.evidence.mockResolvedValue(value); const markup = await render(PARAMS); expect(markup).toContain("La evidencia oficial autorizada no superó la validación integral y no se muestran cifras."); for (const hidden of ["Lado A", "Lado B", "PARTIDO A 2023", "PARTIDO A 2025", "60,00 %", "55,00 %", "puntos porcentuales", "Referencia oficial", "official/archive", "Procedencia oficial", "Opciones no compartidas", "disponibles solo en ese lado"]) expect(markup).not.toContain(hidden); });
  it("renders each result-owned source exclusion exactly once when all evidence matches", async () => { const markup = await render(PARAMS); expect(markup.match(/A: 1 fila\(s\) de fuente fiscalizacion excluidas de todas las cifras\./g)).toHaveLength(1); expect(markup.match(/B: 1 fila\(s\) de fuente fiscalizacion excluidas de todas las cifras\./g)).toHaveLength(1); });
  it("refuses a D6 source-granularity mismatch without any figures", async () => { const value = evidence(); Object.assign(value.right.result, { sourceGranularity: "distrito" as const }); mocks.evidence.mockResolvedValue(value); const markup = await render(PARAMS); for (const text of ["Granularidad mixta", "mesa", "distrito"]) expect(markup).toContain(text); expect(markup).not.toContain("puntos porcentuales"); expect(markup).not.toContain("official/archive-2023"); });
  it("keeps an unmapped refusal figure-free even when its payload contains side-owned counts", async () => { mocks.evidence.mockResolvedValue({ status: "unmapped_parties", sides: [{ side: "left", partyCount: 1, totalVotes: 40 }], raw_list_id: "raw-list", display_name: "unsafe name", provider_side: "secret", left: side(2023, IDS.leftElection, IDS.leftCategory, [60, 40]) }); const markup = await render(PARAMS); expect(markup).toContain("identidades partidarias sin mapear"); for (const hidden of ["1 partido", "40 votos", "<table"]) expect(markup).not.toContain(hidden); for (const hidden of ["raw-list", "unsafe name", "secret", "PARTIDO A 2023", "puntos porcentuales", "official/archive"]) expect(markup).not.toContain(hidden); });
  it.each([["authorization_denied", "No tiene autorización"], ["payload_too_large", "excede el límite seguro"], ["malformed", "no superó la validación"], ["unavailable", "no está disponible"]] as const)("renders no figures for %s evidence", async (status, message) => { mocks.evidence.mockResolvedValue({ status }); const markup = await render(PARAMS); expect(markup).toContain(message); expect(markup).not.toContain("puntos porcentuales"); expect(markup).not.toContain("official/archive"); });
  it.each([["repeated", { ...PARAMS, electionId: [IDS.leftElection, IDS.rightElection] }], ["legacy", { ...PARAMS, election2023: IDS.leftElection }], ["unknown", { ...PARAMS, debug: "true" }]])("rejects %s query keys before authorized reads", async (_case, params) => { const markup = await render(params); expect(markup).toContain("Se rechazó la solicitud"); expect(mocks.facets).not.toHaveBeenCalled(); expect(mocks.evidence).not.toHaveBeenCalled(); });
  it("hides authorized facet provider failures", async () => { mocks.facets.mockRejectedValue(new Error("private provider detail")); const markup = await render({}); expect(markup).toContain("temporalmente no disponibles"); expect(markup).toContain('data-variant="unavailable"'); expect(markup).toContain('href="/compare"'); expect(markup).not.toContain("private provider detail"); });
  it("presents two owned sides, shared scope, and exact official evidence as one ledger", async () => {
    const markup = await render(PARAMS);
    for (const text of ["Lado A", "Lado B", "Jurisdicción compartida", "Resultados exactos", "Evidencia oficial por lado"]) expect(markup).toContain(text);
    expect(markup).toContain('aria-labelledby="compare-side-a-heading"');
    expect(markup).toContain('aria-labelledby="compare-side-b-heading"');
    expect(markup).toContain('aria-label="Tabla exacta de participación y variación por partido en 02/027" tabindex="0"');
    expect(markup).toContain("Referencia oficial — Lado A");
    expect(markup).toContain("Procedencia oficial — Lado B");
  });
  it("folds the exact party table and selection notes into closed disclosures that name what they hold", async () => {
    const markup = await render(PARAMS);
    expect(markup).toMatch(/<details class="[^"]*exactTable[^"]*" data-results-for="compare-results-heading"><summary>Tabla exacta — \d+ agrupaciones, votos y variación por lado<\/summary><div[^>]*aria-label="Tabla exacta de participación/);
    expect(markup).toMatch(/<details class="[^"]*selectionNotes[^"]*" data-applied-context=""><summary>[\s\S]*?<\/summary><p[^>]*>La comparación se actualiza al cambiar la selección\.<\/p>/);
    expect(markup).toContain("Comparación aplicada");
    expect(markup).not.toMatch(/<details[^>]*open/);
  });
  it("keeps six native edit controls and uniquely labelled sides beside the applied comparison", async () => {
    const markup = await render(PARAMS);
    for (const [name, value] of Object.entries(PARAMS)) {
      expect(markup).toMatch(new RegExp(`<select[^>]*name="${name}"[^>]*>`));
      expect(markup).toContain(`value="${value}" selected=""`);
    }
    const ids = [...markup.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
    expect(new Set(ids).size).toBe(ids.length);
    for (const tag of ["fieldset", "article"]) {
      const labels = [...markup.matchAll(new RegExp(`<${tag}[^>]*aria-labelledby="(compare-(?:edit|side)-[ab]-heading)"`, "g"))];
      expect(labels.length).toBeGreaterThanOrEqual(2);
      for (const [index, side] of ["A", "B"].entries()) {
        expect(markup).toMatch(new RegExp(`id="${labels[index]![1]}"[^>]*>Lado ${side}`));
      }
    }
    for (const text of ["Comparación aplicada", "Resultados exactos", "60,00 %", "55,00 %", "-5,00 puntos porcentuales", "Referencia oficial — Lado A", "Referencia oficial — Lado B", "Procedencia oficial — Lado A", "Procedencia oficial — Lado B", "official/archive-2023", "official/archive-2025"]) expect(markup).toContain(text);
    expect(markup.match(/SHA-256/g)).toHaveLength(2);
    expect(markup).not.toContain("Cambios sin aplicar");
    expect(markup).not.toContain("999 votos");
  });
  it("separates edit panels, shared territory, applied contexts and independently named evidence", async () => {
    const markup = await render(PARAMS);
    const fieldsets = [...markup.matchAll(/<fieldset\b[^>]*>[\s\S]*?<\/fieldset>/g)].map(([html]) => html);
    expect(fieldsets).toHaveLength(3);
    for (const [index, side] of ["A", "B"].entries()) {
      expect(fieldsets[index + 1]).toContain('class="official-compare__side"');
      expect(fieldsets[index + 1]).toContain(`aria-labelledby="compare-edit-${side.toLowerCase()}-heading"`);
      expect(fieldsets[index + 1]?.match(/<select\b/g)).toHaveLength(2);
    }
    expect(fieldsets[0]).toContain('aria-labelledby="compare-shared-heading"');
    expect(fieldsets[0]).toContain('value="02" selected=""');
    expect(fieldsets[0]).toContain('value="027" selected=""');
    const contexts = markup.match(/<section\b[^>]*aria-label="Contexto de comparación autorizada"[^>]*>[\s\S]*?<\/section>/)?.[0];
    expect(contexts).toBeDefined();
    expect(contexts).not.toMatch(/<select|<input|<button/);
    for (const text of ["Lado A", "Lado B", "Elección: 2023 generales", "Elección: 2025 generales", "DIPUTADOS 2023", "DIPUTADOS 2025", "02/027"]) expect(contexts).toContain(text);
    expect(markup.indexOf("Comparación aplicada")).toBeLessThan(markup.indexOf(contexts!));
    const tableScroll = markup.match(/<div\b[^>]*aria-label="Tabla exacta de participación y variación por partido en 02\/027"[^>]*>[\s\S]*?<\/table>/)?.[0];
    expect(tableScroll).toContain('tabindex="0"');
    expect(markup.match(/<table\b/g)).toHaveLength(1);
    for (const text of ["60,00 %", "40,00 %", "55,00 %", "45,00 %", "-5,00 puntos porcentuales", "+5,00 puntos porcentuales"]) expect(tableScroll).toContain(text);
    expect(markup).toContain("02/027: sin cambio.");
    const rails = [...markup.matchAll(/<article\b[^>]*class="official-compare__evidence-side"[^>]*>[\s\S]*?<\/article>/g)].map(([html]) => html);
    expect(rails).toHaveLength(2);
    for (const [index, side] of ["A", "B"].entries()) {
      const rail = rails[index]!;
      const openingTag = rail.slice(0, rail.indexOf(">") + 1);
      const headingId = openingTag.match(/aria-labelledby="([^"]+)"/)?.[1];
      expect(headingId, `Evidence ${side} needs its own accessible name`).toBeDefined();
      expect(rail).toMatch(new RegExp(`id="${headingId}"[^>]*>Evidencia oficial — Lado ${side}<`));
      expect(rail).toContain(`Referencia oficial — Lado ${side}`);
      expect(rail).toContain(`Procedencia oficial — Lado ${side}`);
      expect(rail).toContain(`official/archive-${index === 0 ? 2023 : 2025}`);
      expect(rail).toContain(`SHA-256 ${"a".repeat(64)}`);
    }
    const ids = [...markup.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it.each([
    ["authorization_denied", "Acceso denegado"],
    ["payload_too_large", "Comparación incompleta"],
    ["malformed", "Error de validación"],
    ["unavailable", "Evidencia no disponible"],
  ] as const)("names the %s refusal without exposing either side", async (status, title) => {
    mocks.evidence.mockResolvedValue({ status });
    const markup = await render(PARAMS);
    expect(markup).toContain(`data-variant="${status === "authorization_denied" ? "denied" : status === "malformed" ? "error" : "unavailable"}"`);
    expect(markup).toMatch(/role="alert" aria-labelledby="compare-evidence-state-heading"/);
    expect(markup).toContain(`<h2 id="compare-evidence-state-heading">${title}</h2>`);
    expect(markup).not.toMatch(/<table|PARTIDO A|official\/archive|puntos porcentuales|Referencia oficial|Procedencia oficial|Opciones no compartidas/);
  });
  it("preserves incomplete selection as guidance rather than empty evidence", async () => {
    const markup = await render({});
    expect(markup).toContain('role="status">Complete ambas selecciones y una sección exacta compartida para comparar.');
    expect(markup).not.toContain('data-state="empty"');
    expect(mocks.evidence).not.toHaveBeenCalled();
  });
  it("does not describe a missing complete pair as an authorized zero-row result", async () => {
    mocks.evidence.mockResolvedValue({ status: "empty" });
    const markup = await render(PARAMS);
    expect(markup).toContain("No hay evidencia oficial completa para ambas selecciones.");
    expect(markup).not.toContain('data-state="empty"');
    expect(markup).not.toMatch(/<table|official\/archive|puntos porcentuales/);
  });
  it("keeps the native GET field contract and exact table without manual submit actions", async () => {
    const markup = await render(PARAMS);
    expect(markup).not.toMatch(/<button\b[^>]*type="submit"/);
    expect(markup).toMatch(/<button\b[^>]*type="button"[^>]*disabled=""/);
    expect(markup.match(/<select\b[^>]*required=""/g)).toHaveLength(6);
    expect(markup).toContain('<form action="/compare" method="get">');
    expect(markup.match(/class="table-scroll"/g)).toHaveLength(1);
    expect(markup).toContain("Participación oficial y variación en puntos porcentuales</caption>");
    expect(markup.match(/scope="row"/g)).toHaveLength(2);
  });
  it("keeps the selector context while a denied comparison removes both sides of evidence", async () => {
    mocks.evidence.mockResolvedValue({ status: "authorization_denied" });
    const markup = await render(PARAMS);
    expect(markup).toContain("Elección A (2023)");
      expect(markup).not.toContain("Opciones no compartidas");
      expect(markup).not.toContain("disponibles solo en ese lado");
    expect(markup).toContain("Elección B (2025)");
    expect(markup).not.toMatch(/PARTIDO A|official\/archive|puntos porcentuales|100 votos/);
  });
});

it("progressively discloses archive detail without hiding source exclusions or result context", async () => {
  const markup = await render(PARAMS);
  // Archive detail = the two provenance disclosures; other compact disclosures (exact table, notes) are pinned separately.
  const disclosures = [...markup.matchAll(/<details\b[^>]*>[\s\S]*?<\/details>/g)].map(([html]) => html).filter((html) => html.includes("Procedencia oficial"));
  expect(disclosures).toHaveLength(2);
  for (const [index, side] of ["A", "B"].entries()) {
    const disclosure = disclosures[index]!;
    expect(disclosure).toContain(`>Procedencia oficial — Lado ${side}</summary>`);
    expect(disclosure).not.toMatch(/<details[^>]*\sopen(?:\s|=|>)/);
    expect(disclosure).toContain("SHA-256");
    expect(disclosure).toContain(`official/archive-${index === 0 ? 2023 : 2025}`);
    expect(disclosure).not.toContain("excluidas de todas las cifras");
  }
  const visibleMarkup = markup.replace(/<details\b[^>]*>[\s\S]*?<\/details>/g, "");
  expect(visibleMarkup).toContain("A: 1 fila(s) de fuente fiscalizacion excluidas de todas las cifras.");
  expect(visibleMarkup).toContain("B: 1 fila(s) de fuente fiscalizacion excluidas de todas las cifras.");
  expect(visibleMarkup).toContain("Resultados exactos");
  expect(visibleMarkup).toContain("60,00 %");
  expect(visibleMarkup).toContain("sumado a partir de filas de nivel mesa");
  expect(markup).not.toContain("official-compare__section-label");
});

it("reacts through six native selectors without manual refresh or apply buttons", async () => {
  const markup = await render(PARAMS);
  expect(markup.match(/<select\b[^>]*name="/g)).toHaveLength(6);
  expect(markup).toContain('id="compare-party"');
  expect(markup).toContain('id="compare-child-order"');
  expect(markup).not.toContain("Actualizar opciones");
  expect(markup).not.toContain("Comparar resultados");
  expect(markup).not.toContain("Cambios sin aplicar");
  expect(markup).toContain("La comparación se actualiza al cambiar la selección.");
});

it("renders paired party-share bars on one scale with an explicit party-vote denominator", async () => {
  const markup = await render(PARAMS);
  expect(markup).toContain('aria-labelledby="compare-chart-heading"');
  expect(markup).toContain("Participación por partido");
  expect(markup).toContain("No representa el padrón ni todos los votos emitidos.");
  expect(markup).toContain("Lado A: 100 votos partidarios");
  expect(markup).toContain("Lado B: 100 votos partidarios");
  for (const label of ["Lado A: PARTIDO A 2023, 60,00 %", "Lado B: PARTIDO A 2025, 55,00 %", "Lado A: PARTIDO B 2023, 40,00 %", "Lado B: PARTIDO B 2025, 45,00 %"]) {
    expect(markup).toContain(`aria-label="${label}"`);
  }
  expect(markup.match(/viewBox="0 0 100 12"/g)).toHaveLength(4);
  expect(markup).toContain('width="60"');
  expect(markup).toMatch(/width="55(?:\.0+1)?"/);
  expect(markup).toContain('aria-label="Tabla exacta de participación y variación por partido en 02/027"');
});

it.each(["authorization_denied", "payload_too_large", "malformed", "unavailable", "empty"])("does not create a chart for %s evidence", async (status) => {
  mocks.evidence.mockResolvedValue({ status });
  const markup = await render(PARAMS);
  expect(markup).not.toContain("compare-chart-heading");
  expect(markup).not.toContain('viewBox="0 0 100 12"');
});

it("distinguishes an absent observation from a present zero-vote party across chart and exact table", async () => {
  const value = evidence();
  value.left.result.parties[1]!.votes = 0;
  value.left.result.totalVotes = 60;
  value.left.result.sourceAudit[0]!.votes = 60;
  value.right.result.parties[1]!.canonicalPartyId = "party-c";
  value.right.result.parties[1]!.displayName = "PARTIDO C 2025";
  mocks.evidence.mockResolvedValue(value);
  const markup = await render(PARAMS);
  expect(markup).toContain('aria-label="Lado A: PARTIDO B 2023, 0,00 %"');
  expect(markup).toContain('aria-label="Lado B: PARTIDO C 2025, 45,00 %"');
  expect(markup).not.toContain('aria-label="Lado B: PARTIDO B 2023, 0,00 %"');
  expect(markup).not.toContain('aria-label="Lado A: PARTIDO C 2025, 0,00 %"');
  expect(markup).toContain("Lado B: observación no disponible");
  expect(markup).toContain("Lado A: observación no disponible");
  const rows = [...markup.matchAll(/<tr[^>]*>[\s\S]*?<\/tr>/g)].map(([row]) => row);
  const partyB = rows.find((row) => row.includes('scope="row">PARTIDO B 2023'))!;
  const partyC = rows.find((row) => row.includes('scope="row">PARTIDO C 2025'))!;
  expect(partyB).toContain("0,00 %");
  expect(partyB).toContain("Observación no disponible");
  expect(partyB).not.toContain("puntos porcentuales");
  expect(partyC).toContain("45,00 %");
  expect(partyC).toContain("Observación no disponible");
  expect(partyC).not.toContain("puntos porcentuales");
});
