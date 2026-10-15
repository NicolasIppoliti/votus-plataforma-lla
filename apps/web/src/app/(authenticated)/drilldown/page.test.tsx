import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  facets: vi.fn(),
  bundle: vi.fn(),
  internas: vi.fn(),
  completeness: vi.fn(),
  circuits: vi.fn(),
  createClient: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/supabase/server-client", () => ({
  createSupabaseServerClient: mocks.createClient,
}));
vi.mock("@/lib/workspace/context", () => ({
  authorizedOfficialBundle: mocks.bundle,
  authorizedOfficialInternalLists: mocks.internas,
  authorizedOfficialSectionCompleteness: mocks.completeness,
  authorizedOfficialSectionCircuitOutcomes: mocks.circuits,
}));
vi.mock("@/lib/workspace/official-facets", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/workspace/official-facets")>();
  return {
    ...actual,
    createAuthorizedOfficialFacetRepository: () => ({ facets: mocks.facets }),
  };
});

const { default: DrilldownPage } = await import("./page");

const FACETS = {
  elections: [{ id: "10000000-0000-4000-8000-000000000001", year: 2025, round: "generales", label: "2025 generales" }],
  categories: [{ id: "20000000-0000-4000-8000-000000000001", name: "DIPUTADOS" }],
  distritos: [{ code: "02", name: "Buenos Aires", nameStatus: "present", nameVariantCount: 1 }],
  secciones: [{ code: "027", name: "Coronel Rosales", nameStatus: "present", nameVariantCount: 1 }],
  circuitos: [{ code: "00001", name: null, nameStatus: "missing", nameVariantCount: 0 }],
  establecimientos: [{ code: "E1", name: "School", nameStatus: "present", nameVariantCount: 1 }],
  mesas: [{ code: 1 }],
  availableLevels: ["distrito", "seccion", "circuito", "establecimiento", "mesa"],
  exclusions: [],
};
const COMPLETE_SECTION = {
  electionId: FACETS.elections[0]!.id,
  categoryId: FACETS.categories[0]!.id,
  distritoCode: "02",
  seccionCode: "027",
  level: "seccion",
};
const authorized = { authorization_status: "authorized", truncated: false };
const audit = [{ kind: "official", rows: 2, votes: 300 }];
const exclusions = [{ kind: "fiscalizacion", rows: 1, votes: 20, source_url: "private" }];
const parties = [{ identity_status: "canonical", canonical_party_id: "lla", display_name: "LLA", list_id: null, votes: 300, vote_share: "1" }];

function authorizedBundle() {
  return {
    result: { status: "ok", source_kind: "official", category_name: "DIPUTADOS", level: "seccion", source_granularity: "mesa", election_year: 2025, election_round: "generales", total_votes: 300, mesa_count: 2, parties, source_audit: audit, source_exclusions: exclusions, archive_entry_ids: ["archive-1"], ...authorized },
    schools: { status: "ok", source_kind: "official", level: "seccion", source_audit: audit, source_exclusions: exclusions, exclusions: [], schools: [{ circuito_code: "00001", code: "E1", name: "School", mesa_count: 2, total_votes: 300, parties, archive_entry_ids: ["archive-1"] }], ...authorized },
    reference: { status: "ok", source_kind: "official", items: [{ jurisdiction_id: "30000000-0000-4000-8000-000000000001", election_id: COMPLETE_SECTION.electionId, year: 2025, round: "generales", category_id: COMPLETE_SECTION.categoryId, category_name: "DIPUTADOS", distrito_code: "02", distrito_name: "Buenos Aires", seccion_code: "027", seccion_name: "Coronel Rosales", circuito_code: "00001", circuito_name: null, establecimiento_code: "E1", establecimiento_name: "School", mesa_code: 1 }], source_exclusions: [{ kind: "fiscalizacion", reason: "non_official_source", rows: 1, notes: "private" }], total: 1, ...authorized },
    provenance: { status: "ok", source_kind: "official", source_audit: audit, source_exclusions: exclusions, archive_entry_ids: ["archive-1", "archive-2"], sources: [
      { id: "archive-1", metadata_status: "available", capability: "results", mime: "application/json", bytes: 120, fetched_at: "2025-10-26T10:00:00Z", status: "ok", sha256: "a".repeat(64) },
      { id: "archive-2", metadata_status: "available", capability: "results", mime: "application/json", bytes: null, fetched_at: "2025-10-26T11:00:00Z", status: "error", sha256: null },
    ], total: 2, ...authorized },
  };
}

function stateBundle(part: Record<string, unknown>) {
  return { result: part, schools: part, reference: part, provenance: part };
}

function unavailableBundle() {
  const names = ["result", "schools", "reference", "provenance"] as const;
  const parts = names.map((part, index) => ({ status: "source_unavailable", reason: `${part} unavailable`, counts: { rows: index }, source_exclusions: part === "result" ? [{ kind: "fiscalizacion", rows: 3, votes: 90 }] : [], exclusions: part === "schools" ? [{ reason: "missing_mesa", rows: 2, votes: 40 }] : [], authorization_status: "authorized", truncated: false }));
  return Object.fromEntries(names.map((name, index) => [name, parts[index]]));
}

describe("DrilldownPage authorized official evidence", () => {
  beforeEach(() => {
    mocks.circuits.mockReset();
    mocks.facets.mockReset().mockResolvedValue(FACETS);
    mocks.bundle.mockReset().mockResolvedValue(authorizedBundle());
    mocks.internas.mockReset();
    mocks.completeness.mockReset();
    mocks.createClient.mockReset().mockResolvedValue({
      rpc: () => Promise.resolve({ data: null, error: { message: "legacy result RPC must not run" } }),
    });
  });

  async function render(params: Record<string, string | string[] | undefined> = COMPLETE_SECTION): Promise<string> {
    return renderToStaticMarkup((await DrilldownPage({ searchParams: Promise.resolve(params) })) as ReactElement);
  }

  it("renders the national reference as a locator with disclosed provenance and one action", async () => {
    const markup = await render({});
    expect(markup).toContain('data-map-kind="locator"');
    const card = markup.slice(markup.indexOf('data-map-kind="locator"'), markup.indexOf('aria-label="Detalle territorial"'));
    expect(markup).toMatch(/<details[^>]*><summary>Procedencia de la referencia nacional<\/summary>[\s\S]*?sha256[\s\S]*?<\/details>/);
    expect(card).not.toContain('>Volver a Argentina</a>');
    expect(card).not.toContain('>Ir a Buenos Aires</a>');
    expect(markup).toContain('>Ir a la selección electoral exacta</a>');
  });

  it("keeps exact evidence in a collapsed disclosure and bounds territorial and establishment tables", async () => {
    const markup = await render();
    expect(markup).toMatch(/<details[^>]*class="[^"]*exactDisclosure[^"]*"[^>]*>/);
    const exact = markup.slice(markup.indexOf('<summary>Mostrar resultados exactos</summary>'));
    expect(exact).toContain('Alcance aplicado');
    expect(exact).toContain('Desglose oficial autorizado');
    expect(exact).toContain('Referencias de la consulta');
    expect(markup).not.toMatch(/<details[^>]*open/);
    expect(markup).toContain('Desglose territorial');
    expect(markup).toContain('Filtrar territorios');
    expect(markup).toContain('class="boundedEstablishments"');
  });

  it("shows the real official distribution and interpretation guidance in the inspector", async () => {
    const bundle = authorizedBundle();
    const votes = [120, 60, 45, 30, 30, 15];
    mocks.bundle.mockResolvedValue({ ...bundle, result: { ...bundle.result, parties: votes.map((votes, i) => ({ identity_status: i === 5 ? "unmapped" : "canonical", canonical_party_id: i === 5 ? null : `p${i}`, display_name: i === 5 ? null : `Grupo ${i}`, list_id: i === 5 ? "999" : null, votes, vote_share: String(votes / 300) })) } });
    const markup = await render();
    const inspector = markup.slice(markup.indexOf('aria-label="Detalle territorial"'), markup.indexOf('Desglose territorial', markup.indexOf('aria-label="Detalle territorial"')));
    expect(inspector).toContain("Distribución de votos");
    expect(inspector).toContain("Otras agrupaciones (1)");
    expect(inspector).toContain("Lista sin mapear 999");
    expect(inspector).toContain("40,00 %");
    expect(inspector).toContain("Antes de interpretar");
    expect(inspector).toContain("comparabilidad temporal");
  });

  it("ports the approved header, compact filters, map stage and inspector through the real page", async () => {
    const markup = await render();
    expect(markup).toContain("<h1>Exploración territorial</h1>");
    expect(markup).toContain("El territorio como punto de partida.");
    const filters = markup.slice(markup.indexOf('aria-label="Filtros de exploración"'), markup.indexOf('aria-label="Mesa de trabajo territorial"'));
    for (const label of ["Territorio", "Elección", "Categoría", "Agrupación", "Todas las agrupaciones", "Alcance fijo", "La cámara no cambia los resultados"]) expect(filters).toContain(label);
    for (const name of ["circuitoCode", "establecimientoCode", "mesaCode", "level"]) expect(filters).not.toMatch(new RegExp(`<select[^>]*name="${name}"`));
    expect(filters).toMatch(/<select[^>]*id="explorer-party"[^>]*disabled/);
    for (const label of ["Referencia territorial", "Vista territorial", 'aria-label="Acercar mapa"', 'aria-label="Alejar mapa"', 'aria-label="Restablecer vista"', 'aria-label="Norte"', "Vista de referencia · 100 %", "Contorno de referencia", "Detalle territorial", "Navegador territorial", "Circuitos de Coronel Rosales", "Volver a Buenos Aires", "% de los votos positivos", "Votos positivos"]) expect(markup).toContain(label);
    expect(markup).toContain('aria-label="Abrir 00001 — nombre no disponible"');
    expect(markup.indexOf('aria-label="Navegador territorial"')).toBeLessThan(markup.indexOf('aria-label="Liderazgo observado"'));
  });

  it.each([
    ["circuito", { circuitoCode: "00001" }, "Establecimientos de", "Abrir E1 — School", "Volver a Coronel Rosales"],
    ["establecimiento", { circuitoCode: "00001", establecimientoCode: "E1" }, "Mesas de", "Abrir Mesa 1", "Volver a 00001"],
    ["mesa", { circuitoCode: "00001", establecimientoCode: "E1", mesaCode: "1" }, "Mesa seleccionada", null, "Volver a School"],
  ])("reaches facet-backed navigator and ancestor reference at %s", async (level, codes, title, child, back) => {
    const bundle = authorizedBundle(); bundle.result.level = level;
    mocks.bundle.mockResolvedValue(bundle);
    const markup = await render({ ...COMPLETE_SECTION, ...codes, level });
    expect(markup).toContain(title);
    expect(markup).toContain(back);
    if (child) expect(markup).toContain(`aria-label="${child}"`);
    else expect(markup).toContain("Fin del recorrido");
    expect(markup).toContain("Contorno de referencia: Coronel Rosales");
    expect(markup).toContain("sin geometría propia");
  });

  it("offers next-level search only for at least ten authorized children", async () => {
    expect(await render()).not.toContain('id="navigator-search"');
    mocks.facets.mockResolvedValue({ ...FACETS, circuitos: Array.from({ length: 10 }, (_, i) => ({ code: String(i + 1).padStart(5, "0"), name: null, nameStatus: "missing", nameVariantCount: 0 })) });
    const markup = await render();
    expect(markup).toContain('id="navigator-search"');
    expect(markup.match(/aria-label="Abrir /g)).toHaveLength(10);
  });

  it("titles the map by what it shows and labels the party share by its denominator (#487)", async () => {
    const reference = await render({});
    expect(reference).not.toContain("Ganadores en el territorio");
    expect(reference).toContain("<h2>Referencia territorial</h2>");

    const selected = await render();
    expect(selected).not.toContain("Ganadores en el territorio");
    expect(selected).toContain("<h2>Referencia territorial</h2>");
    expect(selected).not.toMatch(/<p>Participación [0-9]/);
    expect(selected).toMatch(/<p>[0-9.,]+ % de los votos positivos · margen /);
    expect(selected).toContain("Sobre votos positivos; no representa participación del padrón.");

    mocks.circuits.mockResolvedValue({
      status: "ok", authorization_status: "authorized", source_kind: "official", level: "seccion",
      circuit_membership: "known", category_applicability: "district_reported_categories", truncated: false,
      unassigned: { catalogue_mesas_without_membership: 0, membership_quarantined_mesas: 0,
        membership_quarantine_reasons: {}, completeness_quarantines: 0, completeness_quarantine_reasons: {}, unexpected_status_mesas: 0 },
      circuits: [{ circuito_code: "00001", positive_total: 100, status: "complete",
        counts: { expected: 1, counted: 1, not_counted: 0, missing: 0, unexpected: 0, quarantined: 0 },
        parties: [{ identity_status: "canonical", canonical_party_id: "p1", display_name: "Grupo 1", list_id: null, votes: 60 },
          { identity_status: "canonical", canonical_party_id: "p2", display_name: "Grupo 2", list_id: null, votes: 40 }] }],
    });
    const observed = await render();
    expect(observed).not.toContain("Ganadores en el territorio");
    expect(observed).toContain("<h2>Primer lugar observado por circuito</h2>");
  });

  it("reaches circuit legend and exact provisional table through the real page", async () => {
    mocks.circuits.mockResolvedValue({
      status: "ok", authorization_status: "authorized", source_kind: "official", level: "seccion",
      circuit_membership: "known", category_applicability: "district_reported_categories", truncated: false,
      unassigned: { catalogue_mesas_without_membership: 0, membership_quarantined_mesas: 0,
        membership_quarantine_reasons: {}, completeness_quarantines: 0, completeness_quarantine_reasons: {}, unexpected_status_mesas: 0 },
      circuits: [
        { circuito_code: "00248", positive_total: 100, status: "partial",
          counts: { expected: 3, counted: 2, not_counted: 1, missing: 0, unexpected: 0, quarantined: 0 },
          parties: [{ identity_status: "unmapped", canonical_party_id: null, display_name: null, list_id: "110", votes: 60 },
            { identity_status: "canonical", canonical_party_id: "other", display_name: "Otra agrupación", list_id: null, votes: 40 }] },
        { circuito_code: "0248B", positive_total: 20, status: "complete",
          counts: { expected: 1, counted: 1, not_counted: 0, missing: 0, unexpected: 0, quarantined: 0 },
          parties: [{ identity_status: "canonical", canonical_party_id: "a", display_name: "Agrupación A", list_id: null, votes: 10 },
            { identity_status: "canonical", canonical_party_id: "b", display_name: "Agrupación B", list_id: null, votes: 10 }] },
        { circuito_code: "0248C", positive_total: 0, status: "complete",
          counts: { expected: 1, counted: 1, not_counted: 0, missing: 0, unexpected: 0, quarantined: 0 }, parties: [] },
      ],
    });
    const markup = await render();
    for (const text of ["Resultados por circuito", "Geometría de referencia CNE; no certificada como límite electoral 2025",
      "&lt;5 pp", "5–15 pp", "&gt;15 pp", "provisorio · 66 % de mesas", "Lista sin mapear 110", "Empate",
      "Sin votos positivos", "superposición en la fuente", "Margen pp", "Votos positivos", "Mesas escrutadas/esperadas"])
      expect(markup).toContain(text);
    expect(markup).toMatch(/<details[^>]*><summary>Notas de la leyenda<\/summary>/);
    expect(markup).toContain("Preparando mapa de circuitos…");
    expect(markup).not.toContain("Mostrar mapa de circuitos");
    expect(markup.indexOf('aria-labelledby="circuit-map-heading"')).toBeLessThan(markup.indexOf('aria-label="Detalle territorial"'));
    expect(markup.indexOf('aria-label="Resultados exactos por circuito"')).toBeLessThan(markup.indexOf('<summary>Mostrar resultados exactos</summary>'));
    expect(markup.indexOf('aria-label="Resultados exactos por circuito"')).toBeLessThan(markup.indexOf('aria-labelledby="school-breakdown-heading"'));
    expect(markup).toContain('data-hatched="true"');
    expect(markup).toContain("20,00");
    expect(mocks.circuits).toHaveBeenCalled();
  });

  it.each([
    [60, 40, "canonical", "Mayoría", "20,00 pp"],
    [50, 50, "canonical", "Empate", "0,00 pp"],
    [0, 0, "canonical", "Sin votos positivos", "no disponible"],
    [60, 40, "unmapped", "Lista sin mapear 110", "20,00 pp"],
  ])("inspects every official group truthfully (%s/%s, %s)", async (first, second, status, leader, margin) => {
    const bundle = authorizedBundle();
    mocks.bundle.mockResolvedValue({ ...bundle, result: { ...bundle.result, total_votes: first + second,
      source_audit: [{ kind: "official", rows: 2, votes: first + second }], parties: [
        { identity_status: "canonical", canonical_party_id: "minority", display_name: "Minoría", list_id: null, votes: second, vote_share: first + second ? String(second / (first + second)) : null },
        { identity_status: status, canonical_party_id: status === "canonical" ? "majority" : null, display_name: status === "canonical" ? "Mayoría" : null, list_id: status === "canonical" ? null : "110", votes: first, vote_share: first + second ? String(first / (first + second)) : null },
      ] } });
    const markup = await render();
    const inspector = markup.slice(markup.indexOf('aria-label="Detalle territorial"'), markup.indexOf('aria-labelledby="submitted-scope-heading"'));
    expect(inspector).toContain(leader);
    expect(inspector).toContain(margin);
    expect(inspector).toContain(`${first + second} votos positivos`);
    expect(inspector.indexOf("Completitud no disponible.")).toBeGreaterThan(inspector.indexOf("Liderazgo observado"));
  });

  it("builds only canonical ancestor links from authorized names and clears descendants", async () => {
    const markup = await render();
    const trail = markup.slice(markup.indexOf('aria-label="Ruta de exploración"'), markup.indexOf("</nav>"));
    const links = [...trail.matchAll(/href="([^"]+)"/g)].map(match => match[1]!.replaceAll("&amp;", "&"));
    expect(links).toEqual([
      `/drilldown?electionId=${COMPLETE_SECTION.electionId}&categoryId=${COMPLETE_SECTION.categoryId}`,
      `/drilldown?electionId=${COMPLETE_SECTION.electionId}&categoryId=${COMPLETE_SECTION.categoryId}&distritoCode=02`,
    ]);
    expect(trail).toContain('aria-current="location">Coronel Rosales');
    expect(trail).not.toContain("level=distrito");
  });

  it("does not show a circuit map when independent membership is unknown", async () => {
    mocks.circuits.mockResolvedValue({ status: "ok", authorization_status: "authorized", source_kind: "official", level: "seccion",
      circuit_membership: "unknown", circuits: [], truncated: false,
      unassigned: { catalogue_mesas_without_membership: 3, membership_quarantined_mesas: 0, membership_quarantine_reasons: {},
        completeness_quarantines: 0, completeness_quarantine_reasons: {}, unexpected_status_mesas: 0 } });
    const markup = await render();
    expect(markup).toContain("Pertenencia de mesas a circuitos desconocida: no se muestra un mapa de circuitos.");
    expect(markup).not.toContain("Mostrar mapa de circuitos");
  });

  it("does not show figures from a non-reconciling circuit payload", async () => {
    mocks.circuits.mockResolvedValue({ status: "ok", authorization_status: "authorized", source_kind: "official", level: "seccion",
      circuit_membership: "known", category_applicability: "district_reported_categories", truncated: false,
      unassigned: { catalogue_mesas_without_membership: 0, membership_quarantined_mesas: 0, membership_quarantine_reasons: {},
        completeness_quarantines: 0, completeness_quarantine_reasons: {}, unexpected_status_mesas: 0 },
      circuits: [{ circuito_code: "00248", positive_total: 999999, parties: [], status: "complete",
        counts: { expected: 1, counted: 1, not_counted: 0, missing: 0, unexpected: 0, quarantined: 0 } }] });
    const markup = await render();
    expect(markup).toContain("Resultados por circuito no disponibles.");
    expect(markup).not.toContain("999999");
    expect(markup).not.toContain("Mostrar mapa de circuitos");
  });

  it("reaches exact official internas through the rendered PASO page", async () => {
    const bundle = authorizedBundle();
    bundle.result.election_year = 2023; bundle.result.election_round = "paso";
    bundle.result.category_name = "PRESIDENTE/A";
    mocks.bundle.mockResolvedValue(bundle);
    mocks.internas.mockResolvedValue({ ...authorized, status: "ok", source_kind: "official", level: "seccion",
      source_granularity: "mesa", category_name: "PRESIDENTE/A", positive_total: 100,
      non_positive: { status: "unavailable", reason: "not_persisted_by_national_ingestion" },
      lists: [
        { canonical_party_id: "jxc", display_name: "Juntos por el Cambio", list_id: "3008", source_name: "La Fuerza del Cambio", identity_status: "canonical", votes: 60 },
        { canonical_party_id: "jxc", display_name: "Juntos por el Cambio", list_id: "3007", source_name: "El Cambio de Nuestras Vidas", identity_status: "canonical", votes: 20 },
        { canonical_party_id: "lla", display_name: "La Libertad Avanza", list_id: "3016", source_name: "Libertad por Siempre", identity_status: "canonical", votes: 20 },
        { canonical_party_id: null, display_name: null, list_id: "9999", source_name: null, identity_status: "unmapped", votes: 0 },
      ] });
    const markup = await render();
    expect(markup).toContain("Internas");
    expect(mocks.internas).toHaveBeenCalled();
    for (const text of ["La Fuerza del Cambio", "75,00%", "60,00%", "Lista única", "Lista sin mapear", "0 votos", "No disponible", "ingesta nacional", "Fuente: oficial", "Granularidad: mesa"])
      expect(markup).toContain(text);
    expect(markup).not.toContain("9999");
    expect(markup).toContain('aria-label="Internas: votos y porcentajes por agrupación"');
    expect(markup).toContain('tabindex="0"');
  });

  it.each([
    ["authorization_denied", "Acceso denegado"], ["no_rows", "no encontró listas"],
    ["unavailable", "Volvé a intentar"], ["malformed", "validación de integridad"],
    ["payload_too_large", "No se muestran cifras parciales"],
  ])("suppresses internal figures in %s state", async (status, message) => {
    const bundle = authorizedBundle();
    bundle.result.election_year = 2023; bundle.result.election_round = "paso";
    bundle.result.category_name = "PRESIDENTE/A";
    mocks.bundle.mockResolvedValue(bundle);
    mocks.internas.mockResolvedValue(status === "authorization_denied"
      ? { status, authorization_status: "denied", truncated: false }
      : status === "no_rows" ? { status, ...authorized, reason: "no_rows", counts: { selected_rows: 0, requested_level_seccion: 0 } }
      : status === "payload_too_large" ? { status, authorization_status: "authorized", truncated: true, total_bytes: 120001 }
      : { status });
    if (status === "unavailable") mocks.internas.mockRejectedValue(new Error("transport unavailable"));
    const markup = await render();
    expect(markup).toContain(message);
    expect(markup).not.toContain('aria-label="Internas: votos y porcentajes por agrupación"');
  });

  it("does not request internas for other elections", async () => {
    await render();
    expect(mocks.internas).not.toHaveBeenCalled();
  });

  it.each(["DIPUTADOS/AS NACIONALES", "PRESIDENTE Y VICE"])("does not request internas for the 2023 PASO category %s", async (categoryName) => {
    const bundle = authorizedBundle();
    bundle.result.election_year = 2023; bundle.result.election_round = "paso";
    bundle.result.category_name = categoryName;
    mocks.bundle.mockResolvedValue(bundle);
    await render();
    expect(mocks.internas).not.toHaveBeenCalled();
  });

  it("does not request internas for the 2023 generales presidential category", async () => {
    const bundle = authorizedBundle();
    bundle.result.election_year = 2023; bundle.result.election_round = "generales";
    bundle.result.category_name = "PRESIDENTE/A";
    mocks.bundle.mockResolvedValue(bundle);
    await render();
    expect(mocks.internas).not.toHaveBeenCalled();
  });

  it("places canonical filters before the national workbench and inspector", async () => {
    const markup = await render({});
    expect(markup).toContain("Argentina: referencia geográfica");
    expect(markup).toContain('aria-label="Mesa de trabajo territorial"');
    expect(markup.indexOf('id="explorer-election"')).toBeLessThan(markup.indexOf('aria-label="Mesa de trabajo territorial"'));
    expect(markup).toContain('aria-label="Detalle territorial"');
    expect(markup).toContain('aria-current="location">Argentina');
    expect(markup).toContain("Vista continental americana");
    expect(markup).toContain("Vista completa desde el polo sur");
    const national = markup.slice(markup.indexOf('aria-label="Evidencia de referencia argentina"'), markup.indexOf('aria-label="Evidencia de referencia Buenos Aires"'));
    expect(national).toContain("Vista continental americana");
    expect(markup).toContain('href="#explorer-election"');
    expect(mocks.bundle).not.toHaveBeenCalled();
  });

  it("offers a geographic Buenos Aires anchor and a safe Coronel Rosales selection path without provincial results", async () => {
    const markup = await render({});
    expect(markup).toContain("Buenos Aires: referencia geográfica");
    expect(markup).toContain("FUENTE: Instituto Geográfico Nacional de la República Argentina");
    expect(markup).toContain("No hay resultados electorales provinciales disponibles en este mapa.");
    expect(markup).toContain("Coronel Rosales");
    expect(markup).toContain("distrito nacional 02");
    expect(markup).toContain("sección 027");
    expect(markup).toContain('href="#explorer-election"');
    expect(markup).not.toContain("135 partidos");
    expect(markup).not.toContain("level=distrito");
    expect(mocks.bundle).not.toHaveBeenCalled();
  });

  it("loads and renders a complete exact-section selection through the authorized evidence module", async () => {
    const markup = await render();

    expect(mocks.bundle).toHaveBeenCalledWith(expect.anything(), {
      electionId: COMPLETE_SECTION.electionId,
      categoryId: COMPLETE_SECTION.categoryId,
      distritoCode: "02",
      seccionCode: "027",
      circuitoCode: null,
      establecimientoCode: null,
      mesaCode: null,
      requestedLevel: "seccion",
    });
    expect(mocks.createClient).toHaveBeenCalled();
    for (const text of [
      "300 votos a nivel seccion",
      "LLA",
      "Circuito 00001 — E1 — School",
      "30000000-0000-4000-8000-000000000001",
      "archive-1",
      "application/json",
      "SHA-256",
    ]) expect(markup).toContain(text);
    expect(markup).not.toContain("https://");
    expect(markup).toContain('aria-label="Ruta de exploración"');
    expect(markup).toContain('aria-current="location">Coronel Rosales');
  });

  it("renders the complete normalized submitted mesa identity beside exact authorized evidence", async () => {
    const bundle = authorizedBundle();
    bundle.result.level = "mesa";
    mocks.bundle.mockResolvedValueOnce(bundle);
    const markup = await render({
      level: "mesa", mesaCode: "001", establecimientoCode: "E1", circuitoCode: "1",
      seccionCode: "27", distritoCode: "2",
      categoryId: COMPLETE_SECTION.categoryId, electionId: COMPLETE_SECTION.electionId,
    });
    expect(markup).toContain("300 votos a nivel mesa");
    expect(markup).toContain('aria-labelledby="official-evidence-heading"');
    const evidence = markup;
    expect(markup.indexOf('aria-labelledby="submitted-scope-heading"')).toBeLessThan(markup.indexOf('aria-labelledby="official-results-heading"'));
    expect(evidence).toContain('<h3 id="submitted-scope-heading">Alcance aplicado</h3>');
    for (const entry of [
      `Elección</dt><dd>${COMPLETE_SECTION.electionId}`,
      `Categoría</dt><dd>${COMPLETE_SECTION.categoryId}`,
      "Distrito</dt><dd>02", "Sección</dt><dd>027", "Circuito</dt><dd>00001",
      "Establecimiento</dt><dd>E1", "Mesa</dt><dd>1", "Nivel</dt><dd>Mesa",
    ]) expect(evidence).toContain(entry);
    expect(evidence).toContain("Referencia electoral autorizada");
    expect(evidence).toContain(`SHA-256 ${"a".repeat(64)}`);
    expect(markup).toContain("300 votos a nivel mesa");
    expect(markup).toMatch(/<td\b[^>]*>300 votos<\/td><td\b[^>]*>100,00%<\/td>/);
    expect(mocks.bundle).toHaveBeenCalledWith(expect.anything(), {
      electionId: COMPLETE_SECTION.electionId, categoryId: COMPLETE_SECTION.categoryId,
      distritoCode: "02", seccionCode: "027", circuitoCode: "00001",
      establecimientoCode: "E1", mesaCode: 1, requestedLevel: "mesa",
    });
  });

  it("renders valid section evidence with an explicit unavailable school breakdown", async () => {
    const bundle = authorizedBundle();
    mocks.bundle.mockResolvedValueOnce({
      ...bundle,
      schools: {
        status: "source_unavailable",
        reason: "the source has no complete mesa identity",
        counts: { complete_establecimientos: 0, excluded_rows: 2, excluded_votes: 300 },
        exclusions: [{ reason: "official_rows_without_mesa_granularity", rows: 2, votes: 300 }],
        source_exclusions: [],
        ...authorized,
      },
    });

    const markup = await render();

    expect(markup).toContain("300 votos a nivel seccion");
    expect(markup).toContain("archive-1");
    expect(markup).toContain(
      "El desglose por establecimientos no está disponible para la granularidad publicada por la fuente.",
    );
    expect(markup).toContain(
      "Se excluyeron 2 fila(s) / 300 voto(s): official_rows_without_mesa_granularity.",
    );
    expect(markup).not.toContain("Votos oficiales por circuito y establecimiento");
    expect(markup).not.toContain("no superó la validación de integridad");
  });

  it("rejects widened fiscal evidence before it reaches the rendered result", async () => {
    const widened = authorizedBundle();
    widened.result.source_kind = "fiscalizacion";
    mocks.bundle.mockResolvedValueOnce(widened);

    const markup = await render();

    expect(markup).toContain("no superó la validación de integridad");
    expect(markup).not.toContain("300 votos a nivel seccion");
  });

  it("renders source exclusions independently without admitting them into official figures", async () => {
    const markup = await render();

    expect(markup).toContain("Se excluyeron 1 fila de fuente fiscalización / 20 votos del agregado oficial");
    expect(markup).toContain("Se excluyeron 1 fila de fuente fiscalización / 20 votos del agregado procedencia");
    expect(markup).toContain("Se excluyeron 1 fila(s) de referencia de fuente fiscalización");
    expect(markup).not.toContain("320 votos");
  });

  it("renders row-only reference exclusions without an undefined vote count", async () => {
    const bundle = unavailableBundle();
    mocks.bundle.mockResolvedValueOnce({
      ...bundle,
      reference: {
        ...bundle.reference,
        exclusions: [{ reason: "official_rows_without_section_identity", rows: 2 }],
        source_exclusions: [{ kind: "fiscalizacion", rows: 3 }],
      },
    });

    const markup = await render();

    expect(markup).toContain("Exclusión official_rows_without_section_identity: 2 fila(s).");
    expect(markup).toContain("Fuente excluida fiscalización: 3 fila(s).");
    expect(markup).not.toContain("undefined");
  });

  it("does not render denied envelope payload through the real evidence adapter", async () => {
    const deniedPart = {
      status: "authorization_denied",
      authorization_status: "scope_denied",
      truncated: false,
      reason: "SENTINEL_DENIAL_REASON",
      counts: { SENTINEL_COUNT: 987654 },
      exclusions: [{ reason: "SENTINEL_EXCLUSION", rows: 123456, votes: 654321 }],
      source_exclusions: [{ kind: "SENTINEL_SOURCE", rows: 123456, votes: 654321 }],
      total: 987654,
      parties: [{ canonical_party_id: "SENTINEL_PARTY_ID", list_id: "SENTINEL_LIST_ID", votes: 654321, vote_share: "0.987654" }],
      items: [{ jurisdiction_id: "SENTINEL_REFERENCE_ID" }],
      archive_entry_ids: ["SENTINEL_ARCHIVE_ID"],
      sources: [{ id: "SENTINEL_PROVENANCE_ID" }],
      schools: [{ code: "SENTINEL_SCHOOL_ID" }],
    };
    mocks.bundle.mockResolvedValueOnce(stateBundle(deniedPart));

    const markup = await render();

    expect(markup).toContain("Se rechazó la solicitud: la selección no pertenece al alcance autorizado.");
    expect(markup).toContain("Elegir el alcance de los resultados");
    for (const forbidden of ["SENTINEL_DENIAL_REASON", "SENTINEL_COUNT", "987654", "SENTINEL_EXCLUSION", "123456", "654321", "SENTINEL_SOURCE", "0.987654", "SENTINEL_PARTY_ID", "SENTINEL_LIST_ID", "SENTINEL_REFERENCE_ID", "SENTINEL_ARCHIVE_ID", "SENTINEL_PROVENANCE_ID", "SENTINEL_SCHOOL_ID"])
      expect(markup).not.toContain(forbidden);
  });

  it.each([
    ["jurisdictionId", "j-027"],
    ["partyCategory", "DIPUTADOS"],
    ["partyJurisdiction", "national"],
  ])("rejects legacy key %s before any authorized read", async (key, value) => {
    const markup = await render({ ...COMPLETE_SECTION, [key]: value });

    expect(markup).toContain("parámetros heredados");
    expect(markup).toContain(key);
    expect(mocks.facets).not.toHaveBeenCalled();
    expect(mocks.bundle).not.toHaveBeenCalled();
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("rejects district-level evidence before any authorized read", async () => {
    const markup = await render({ ...COMPLETE_SECTION, seccionCode: undefined, level: "distrito" });

    expect(markup).toContain("el nivel distrito no está disponible");
    expect(mocks.facets).not.toHaveBeenCalled();
    expect(mocks.bundle).not.toHaveBeenCalled();
  });

  it("rejects repeated canonical input before any authorized read", async () => {
    const markup = await render({ ...COMPLETE_SECTION, electionId: [COMPLETE_SECTION.electionId, COMPLETE_SECTION.electionId] });

    expect(markup).toContain("se proporcionaron más de una vez");
    expect(mocks.facets).not.toHaveBeenCalled();
    expect(mocks.bundle).not.toHaveBeenCalled();
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("keeps authorized facets reachable until an exact section is complete", async () => {
    const markup = await render({ electionId: COMPLETE_SECTION.electionId });

    expect(mocks.facets).toHaveBeenCalledWith({ electionId: COMPLETE_SECTION.electionId });
    expect(mocks.bundle).not.toHaveBeenCalled();
    expect(markup).toContain('<form action="/drilldown" method="get">');
    expect(markup).toContain("Elija una sección exacta");
  });

  it.each([
    ["empty", "No se encontraron resultados oficiales", { status: "no_rows", authorization_status: "authorized", truncated: false }],
    ["authorization_denied", "no pertenece al alcance autorizado", { status: "authorization_denied", authorization_status: "scope_denied", truncated: false }],
    ["unavailable", "no está disponible", { status: "source_unavailable", authorization_status: "authorized", truncated: false, reason: "safe unavailable reason" }],
    ["payload_too_large", "fue truncada; no se muestra ninguna cifra parcial", { status: "payload_too_large", authorization_status: "authorized", truncated: true }],
  ])("renders the %s status as a refusal without figures", async (_status, message, fields) => {
    const part = { counts: {}, exclusions: [], source_exclusions: [], items: [], archive_entry_ids: [], sources: [], schools: [], parties: [], total: 0, source_kind: "official", ...fields };
    mocks.bundle.mockResolvedValueOnce(stateBundle(part));

    const markup = await render();

    expect(markup).toContain(message);
    expect(markup).not.toContain("300 votos a nivel seccion");
    expect(markup).not.toContain("LLA");
    expect(markup).not.toContain("archive-1");
  });

  it("renders malformed evidence as a refusal without figures", async () => {
    mocks.bundle.mockResolvedValueOnce({});

    const markup = await render();

    expect(markup).toContain("no superó la validación de integridad");
    expect(markup).not.toContain("300 votos a nivel seccion");
    expect(markup).not.toContain("LLA");
    expect(markup).not.toContain("archive-1");
  });

  it("offers exactly one canonical full-selection retry while retaining only bounded unavailable diagnostics", async () => {
    const bundle = unavailableBundle();
    mocks.bundle.mockResolvedValueOnce({
      ...bundle,
      result: { ...bundle.result, source_url: "https://transport.invalid/raw", total_votes: 987654,
        parties, archive_entry_ids: ["LEAK_ARCHIVE"], sha256: "b".repeat(64) },
    });
    const markup = await render({
      ...COMPLETE_SECTION, distritoCode: "2", seccionCode: "27", circuitoCode: "1",
      establecimientoCode: "E1", mesaCode: "001", level: "mesa",
      returnTo: "https://external.invalid/raw",
    });

    for (const text of ["provenance unavailable", "rows: 3", "missing_mesa", "fiscalización", "2 fila(s) / 40 voto(s)"])
      expect(markup).toContain(text);
    for (const forbidden of ["https://", "http://", "transport.invalid", "external.invalid", "returnTo", "987654", "LEAK_ARCHIVE", "b".repeat(64), "SHA-256", 'aria-label="procedencia"', "LLA", "votos a nivel"])
      expect(markup).not.toContain(forbidden);
    const links = [...markup.matchAll(/<a\b[^>]*href="(\/drilldown\?[^"]*)"[^>]*>(.*?)<\/a>/g)];
    expect(links).toHaveLength(1);
    expect(links[0]?.[2]).toBe("Reintentar carga");
    expect(links[0]?.[1]?.replaceAll("&amp;", "&")).toBe(
      `/drilldown?electionId=${COMPLETE_SECTION.electionId}&categoryId=${COMPLETE_SECTION.categoryId}` +
      "&distritoCode=02&seccionCode=027&circuitoCode=00001&establecimientoCode=E1&mesaCode=1&level=mesa",
    );
  });

  it("renders an unmapped list and zero totals with unavailable shares truthfully", async () => {
    const bundle = authorizedBundle();
    const zeroParties = [{ identity_status: "unmapped", canonical_party_id: null,
      display_name: null, list_id: "999", votes: 0, vote_share: null }];
    const zeroAudit = [{ kind: "official", rows: 2, votes: 0 }];
    mocks.bundle.mockResolvedValueOnce({
      ...bundle,
      result: { ...bundle.result, total_votes: 0, parties: zeroParties, source_audit: zeroAudit },
      schools: { ...bundle.schools, source_audit: zeroAudit, schools: bundle.schools.schools.map((school) =>
        ({ ...school, total_votes: 0, parties: zeroParties })) },
      provenance: { ...bundle.provenance, source_audit: zeroAudit },
    });
    const markup = await render();
    expect(markup).toContain("0 votos a nivel seccion");
    expect(markup.slice(markup.indexOf('<summary>Mostrar resultados exactos</summary>')).match(/Lista sin mapear 999/g)).toHaveLength(4);
    expect(markup.match(/Lista sin mapear 999/g)).toHaveLength(5);
    expect(markup.match(/porcentaje no disponible/g)).toHaveLength(4);
    expect(markup).not.toMatch(/>999<|\d+\.\d+%/);
    expect(markup).toContain("SHA-256");
    expect(markup).not.toContain("no superó la validación");
  });

  it("presents the official explorer hierarchy with adjacent labelled evidence tables", async () => {
    const markup = await render();

    for (const text of [
      "<h1>Exploración territorial</h1>",
      "Distribución del voto oficial",
      "Archivo y procedencia",
      'role="region" aria-label="Votos oficiales y porcentaje por partido" tabindex="0"',
      'role="region" aria-label="Votos oficiales por circuito y establecimiento" tabindex="0"',
      'role="region" aria-label="Referencia electoral autorizada" tabindex="0"',
    ]) expect(markup).toContain(text);
    expect(markup).toContain('aria-labelledby="official-results-heading"');
    expect(markup).toContain('aria-labelledby="official-evidence-heading"');
    expect(markup).toContain('aria-label="Mesa de trabajo territorial"');
    expect(markup.indexOf('aria-label="Mesa de trabajo territorial"')).toBeLessThan(markup.indexOf('aria-labelledby="official-results-heading"'));
    expect(markup.indexOf('aria-label="Detalle territorial"')).toBeLessThan(markup.indexOf('aria-label="Votos oficiales y porcentaje por partido"'));
    expect(markup).toMatch(/<th\b[^>]*scope="row"[^>]*>LLA<\/th>/);
    expect(markup).toMatch(/<th\b[^>]*scope="row"[^>]*>30000000-0000-4000-8000-000000000001<\/th>/);
    // A school repeats across party rows; it is not the row's unique identity.
    expect(markup).toMatch(/<td\b[^>]*>Circuito 00001 — E1 — School<\/td>/);
    expect(markup.match(/scope="row"/g)).toHaveLength(2);
    expect(markup).toContain('<form action="/drilldown" method="get">');
    expect(markup).not.toContain("Aplicar selección");
    expect(markup).toContain("Los resultados se actualizan al cambiar la selección.");
    expect([...markup.matchAll(/<select\b[^>]*name="([^"]+)"/g)].map(match => match[1])).toEqual([
      "distritoCode", "seccionCode", "electionId", "categoryId",
    ]);
    expect(markup).not.toContain('class="button button--primary"');
  });

  it("renders every authorized party on a common share scale beside the exact table", async () => {
    const bundle = authorizedBundle();
    mocks.bundle.mockResolvedValueOnce({ ...bundle, result: { ...bundle.result, parties: [
      { identity_status: "canonical", canonical_party_id: "a", display_name: "Partido A", list_id: null, votes: 225, vote_share: "0.75" },
      { identity_status: "unmapped", canonical_party_id: null, display_name: null, list_id: "999", votes: 75, vote_share: "0.25" },
      { identity_status: "canonical", canonical_party_id: "zero", display_name: "Sin votos", list_id: null, votes: 0, vote_share: "0" },
    ] } });
    const markup = await render();
    const chart = markup.slice(markup.indexOf('aria-labelledby="drilldown-distribution-heading"'), markup.indexOf('role="region" aria-label="Votos oficiales y porcentaje por partido"'));
    expect(chart).toContain("Base: 300 votos partidarios");
    expect(chart).toContain("No representa el padrón ni todos los votos emitidos");
    for (const label of ["Partido A: 225 votos, 75,00 %", "Lista sin mapear 999: 75 votos, 25,00 %", "Sin votos: 0 votos, 0,00 %"]) {
      expect(chart).toContain(`aria-label="${label}"`);
    }
    expect(chart.match(/role="img"/g)).toHaveLength(3);
    for (const width of [75, 25, 0]) expect(chart).toContain(`width="${width}"`);
    expect(chart).toContain("100 %");
    expect(markup).toContain("75,00%");
    expect(markup).toContain("25,00%");
    const disclosure = markup.slice(markup.indexOf("<summary>Archivo y procedencia</summary>"), markup.indexOf("</details>", markup.indexOf("<summary>Archivo y procedencia</summary>")));
    expect(disclosure).toContain("SHA-256");
    expect(disclosure).not.toContain("Se excluyeron");
  });

  it("keeps a denied result status-only inside the explorer state region", async () => {
    mocks.bundle.mockResolvedValueOnce(stateBundle({ status: "authorization_denied", authorization_status: "scope_denied", truncated: false }));

    const markup = await render();

    expect(markup).toContain('role="alert"');
    expect(markup).toContain("la selección no pertenece al alcance autorizado");
    expect(markup).not.toContain("Resultados y evidencia");
    expect(markup).not.toContain("Evidencia y archivo");
    expect(markup).not.toContain("Reintentar carga");
    expect(markup).not.toContain('href="/drilldown?');
    expect(markup).not.toContain("300 votos a nivel seccion");
    expect(markup).not.toContain("Distribución del voto oficial");
  });
});

describe("DrilldownPage section completeness", () => {
  const counts = (expected: number, counted: number, notCounted: number, missing: number, unexpected: number) =>
    ({ expected, counted, not_counted: notCounted, missing, unexpected, quarantined: 0, unattributed_quarantined: 0 });
  const known = (status: "complete" | "partial", values: ReturnType<typeof counts>) => ({
    status: "ok", authorization_status: "authorized", source_kind: "official", level: "seccion",
    // Exact RPC shape (20261012000000): unlisted_status_mesas is always present, null when known.
    completeness: { status, reason: null, unlisted_status_mesas: null, quarantined_mesas: null, unattributed_quarantined: null, counts: values, category_applicability: "district_reported_categories",
      sources: { catalogue_archive_entry_ids: ["archive-1"], status_archive_entry_ids: ["archive-1"] } },
  });

  beforeEach(() => {
    mocks.facets.mockReset().mockResolvedValue(FACETS);
    mocks.bundle.mockReset().mockResolvedValue(authorizedBundle());
    mocks.internas.mockReset();
    mocks.completeness.mockReset();
    mocks.createClient.mockReset().mockResolvedValue({
      rpc: () => Promise.resolve({ data: null, error: { message: "legacy result RPC must not run" } }),
    });
  });

  async function render(params: Record<string, string | string[] | undefined> = COMPLETE_SECTION): Promise<string> {
    return renderToStaticMarkup((await DrilldownPage({ searchParams: Promise.resolve(params) })) as ReactElement);
  }

  it("states a complete count against the official expected-mesa catalogue for the exact section", async () => {
    mocks.completeness.mockResolvedValue(known("complete", counts(153, 153, 0, 0, 0)));
    const markup = await render();
    expect(mocks.completeness).toHaveBeenCalledWith(expect.anything(), {
      electionId: COMPLETE_SECTION.electionId, categoryId: COMPLETE_SECTION.categoryId, distritoCode: "02", seccionCode: "027",
    });
    expect(markup).toContain("Escrutinio completo: 153 de 153 mesas esperadas escrutadas según el catálogo oficial de mesas.");
    expect(markup).toContain("Supone que todas las mesas esperadas de la sección votan esta categoría.");
  });

  it("reports every partial-count reason separately, never as a single total", async () => {
    mocks.completeness.mockResolvedValue(known("partial", counts(153, 150, 2, 1, 0)));
    const markup = await render();
    expect(markup).toContain("Escrutinio parcial: 150 de 153 mesas esperadas escrutadas; 2 no escrutadas; 1 sin estado en la fuente; 0 fuera del catálogo.");
    expect(markup).not.toContain("Escrutinio completo");
  });

  it("keeps an election without a catalogue unknown, never complete or 100 %", async () => {
    mocks.completeness.mockResolvedValue({ status: "ok", authorization_status: "authorized", source_kind: "official", level: "seccion",
      completeness: { status: "unknown", reason: "no_expected_catalogue", counts: null,
        category_applicability: "district_reported_categories", sources: null } });
    const markup = await render();
    expect(markup).toContain("Completitud desconocida: la fuente oficial de esta elección no publica un catálogo de mesas esperadas.");
    expect(markup).not.toMatch(/Escrutinio (completo|parcial)/);
  });

  it("discloses section and election quarantine without claiming complete", async () => {
    const values = counts(153, 153, 0, 0, 0);
    values.quarantined = 1;
    values.unattributed_quarantined = 2;
    mocks.completeness.mockResolvedValue(known("partial", values));
    expect(await render()).toContain("Escrutinio parcial: 153 de 153 mesas esperadas escrutadas; 0 no escrutadas; 0 sin estado en la fuente; 0 fuera del catálogo; 1 en cuarentena por conflicto en la fuente; 2 filas de la fuente sin sección identificable para esta elección.");
    mocks.completeness.mockResolvedValue(known("complete", values));
    expect(await render()).toContain("Completitud no disponible.");
  });

  it("discloses status mesas and quarantine for a section absent from the catalogue", async () => {
    mocks.completeness.mockResolvedValue({ status: "ok", authorization_status: "authorized", source_kind: "official", level: "seccion",
      completeness: { status: "unknown", reason: "section_absent_from_catalogue", counts: null,
        unlisted_status_mesas: 4, quarantined_mesas: 1, unattributed_quarantined: 2,
        category_applicability: "district_reported_categories",
        sources: { catalogue_archive_entry_ids: [], status_archive_entry_ids: ["archive-1"] } } });
    expect(await render()).toContain("Completitud desconocida: el catálogo oficial de mesas no lista esta sección; la fuente de resultados informa 4 mesas con estado para ella; 1 en cuarentena por conflicto en la fuente; 2 filas de la fuente sin sección identificable para esta elección.");
  });

  it("refuses counts that do not reconcile instead of showing them", async () => {
    mocks.completeness.mockResolvedValue(known("complete", counts(153, 150, 0, 0, 0)));
    const markup = await render();
    expect(markup).toContain("Completitud no disponible.");
    expect(markup).not.toContain("150 de 153");
  });

  it("labels the completeness of a deeper selection as section-wide", async () => {
    const bundle = authorizedBundle();
    bundle.result.level = "mesa";
    mocks.bundle.mockResolvedValueOnce(bundle);
    mocks.completeness.mockResolvedValue(known("complete", counts(153, 153, 0, 0, 0)));
    const markup = await render({ ...COMPLETE_SECTION, circuitoCode: "00001", establecimientoCode: "E1", mesaCode: "1", level: "mesa" });
    expect(markup).toContain("300 votos a nivel mesa");
    expect(markup).toContain("Escrutinio completo: 153 de 153 mesas esperadas escrutadas según el catálogo oficial de mesas.");
    expect(markup).toContain("Referida a toda la sección, no solo a la selección.");
  });
});
