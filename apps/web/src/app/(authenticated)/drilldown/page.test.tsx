import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  facets: vi.fn(),
  bundle: vi.fn(),
  createClient: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/supabase/server-client", () => ({
  createSupabaseServerClient: mocks.createClient,
}));
vi.mock("@/lib/workspace/context", () => ({
  authorizedOfficialBundle: mocks.bundle,
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
    mocks.facets.mockReset().mockResolvedValue(FACETS);
    mocks.bundle.mockReset().mockResolvedValue(authorizedBundle());
    mocks.createClient.mockReset().mockResolvedValue({
      rpc: () => Promise.resolve({ data: null, error: { message: "legacy result RPC must not run" } }),
    });
  });

  async function render(params: Record<string, string | string[] | undefined> = COMPLETE_SECTION): Promise<string> {
    return renderToStaticMarkup((await DrilldownPage({ searchParams: Promise.resolve(params) })) as ReactElement);
  }

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
    expect(markup).not.toContain("href=");
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
    const evidence = markup.slice(markup.indexOf('aria-labelledby="official-evidence-heading"'));
    expect(evidence).toContain('<h3 id="submitted-scope-heading">Alcance aplicado</h3>');
    for (const entry of [
      `Elección</dt><dd>${COMPLETE_SECTION.electionId}`,
      `Categoría</dt><dd>${COMPLETE_SECTION.categoryId}`,
      "Distrito</dt><dd>02", "Sección</dt><dd>027", "Circuito</dt><dd>00001",
      "Establecimiento</dt><dd>E1", "Mesa</dt><dd>1", "Nivel del informe</dt><dd>mesa",
    ]) expect(evidence).toContain(entry);
    expect(evidence).toContain("Referencia electoral autorizada");
    expect(evidence).toContain(`SHA-256 ${"a".repeat(64)}`);
    expect(markup).toContain("300 votos a nivel mesa");
    expect(markup).toContain("<td>300 votos</td><td>100.00%</td>");
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
    const links = [...markup.matchAll(/<a\b[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/g)];
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
    expect(markup.match(/Lista sin mapear 999/g)).toHaveLength(2);
    expect(markup.match(/porcentaje no disponible/g)).toHaveLength(2);
    expect(markup).not.toMatch(/>999<|\d+\.\d+%/);
    expect(markup).toContain("SHA-256");
    expect(markup).not.toContain("no superó la validación");
  });

  it("presents the official explorer hierarchy with adjacent labelled evidence tables", async () => {
    const markup = await render();

    for (const text of [
      "<h1>Explorador oficial</h1>",
      "Definir el alcance",
      "Resultados y evidencia",
      "Evidencia y archivo",
      'role="region" aria-label="Votos oficiales y porcentaje por partido" tabindex="0"',
      'role="region" aria-label="Votos oficiales por circuito y establecimiento" tabindex="0"',
      'role="region" aria-label="Referencia electoral autorizada" tabindex="0"',
    ]) expect(markup).toContain(text);
    expect(markup).toContain('aria-labelledby="official-results-heading"');
    expect(markup).toContain('aria-labelledby="official-evidence-heading"');
  });

  it("keeps a denied result status-only inside the explorer state region", async () => {
    mocks.bundle.mockResolvedValueOnce(stateBundle({ status: "authorization_denied", authorization_status: "scope_denied", truncated: false }));

    const markup = await render();

    expect(markup).toContain('role="alert"');
    expect(markup).toContain("la selección no pertenece al alcance autorizado");
    expect(markup).not.toContain("Resultados y evidencia");
    expect(markup).not.toContain("Evidencia y archivo");
    expect(markup).not.toContain("Reintentar carga");
    expect(markup).not.toContain("href=");
    expect(markup).not.toContain("300 votos a nivel seccion");
  });
});
