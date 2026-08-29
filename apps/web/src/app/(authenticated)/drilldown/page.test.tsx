import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  facets: vi.fn(),
  loadEvidence: vi.fn(),
  createClient: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/supabase/server-client", () => ({
  createSupabaseServerClient: mocks.createClient,
}));
vi.mock("@/lib/workspace/official-facets", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/workspace/official-facets")>();
  return {
    ...actual,
    createAuthorizedOfficialFacetRepository: () => ({ facets: mocks.facets }),
  };
});
vi.mock("@/lib/workspace/official-drilldown-evidence", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/workspace/official-drilldown-evidence")>();
  return { ...actual, loadAuthorizedOfficialDrilldownEvidence: mocks.loadEvidence };
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

function okEvidence() {
  return {
    status: "ok",
    result: {
      status: "ok", sourceKind: "official", level: "seccion", sourceGranularity: "mesa",
      electionYear: 2025, electionRound: "generales", totalVotes: 300, mesaCount: 2,
      sourceAudit: [{ kind: "official", rows: 2, votes: 300 }],
      sourceExclusions: [{ kind: "fiscalizacion", rows: 1, votes: 20 }],
      parties: [{ identityStatus: "canonical", canonicalPartyId: "lla", displayName: "LLA", listId: null, votes: 300, voteShare: "1" }],
      archiveEntryIds: ["archive-1"],
    },
    schools: {
      status: "ok", sourceKind: "official", level: "seccion",
      sourceAudit: [{ kind: "official", rows: 2, votes: 300 }],
      sourceExclusions: [], exclusions: [],
      schools: [{ circuitoCode: "00001", code: "E1", name: "School", mesaCount: 2, totalVotes: 300,
        parties: [{ identityStatus: "canonical", canonicalPartyId: "lla", displayName: "LLA", listId: null, votes: 300, voteShare: "1" }],
        archiveEntryIds: ["archive-1"] }],
    },
    reference: {
      items: [{ jurisdictionId: "30000000-0000-4000-8000-000000000001", electionId: FACETS.elections[0]!.id,
        year: 2025, round: "generales", categoryId: FACETS.categories[0]!.id, categoryName: "DIPUTADOS",
        distritoCode: "02", distritoName: "Buenos Aires", seccionCode: "027", seccionName: "Coronel Rosales",
        circuitoCode: "00001", circuitoName: null, establecimientoCode: "E1", establecimientoName: "School", mesaCode: 1 }],
      sourceExclusions: [{ kind: "fiscalizacion", reason: "non_official_source", rows: 1 }],
    },
    provenance: {
      items: [{ archiveEntryId: "archive-1", capability: "results", mime: "application/json", bytes: 120,
        fetchedAt: "2025-10-26T10:00:00Z", status: "ok", sha256: "a".repeat(64) }],
      sourceExclusions: [{ kind: "fiscalizacion", rows: 1, votes: 20 }],
    },
  };
}

describe("DrilldownPage authorized official evidence", () => {
  beforeEach(() => {
    mocks.facets.mockReset().mockResolvedValue(FACETS);
    mocks.loadEvidence.mockReset().mockResolvedValue(okEvidence());
    mocks.createClient.mockReset().mockResolvedValue({
      rpc: () => Promise.resolve({ data: null, error: { message: "legacy result RPC must not run" } }),
    });
  });

  async function render(params: Record<string, string | string[] | undefined> = COMPLETE_SECTION): Promise<string> {
    return renderToStaticMarkup((await DrilldownPage({ searchParams: Promise.resolve(params) })) as ReactElement);
  }

  it("loads and renders a complete exact-section selection through the authorized evidence module", async () => {
    const markup = await render();

    expect(mocks.loadEvidence).toHaveBeenCalledWith({
      electionId: COMPLETE_SECTION.electionId,
      categoryId: COMPLETE_SECTION.categoryId,
      distritoCode: "02",
      seccionCode: "027",
      circuitoCode: null,
      establecimientoCode: null,
      mesaCode: null,
      requestedLevel: "seccion",
    });
    expect(mocks.createClient).not.toHaveBeenCalled();
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

  it("refuses widened unofficial evidence at the rendered page guard", async () => {
    const widened = okEvidence(); widened.result.sourceKind = "fiscalizacion" as never;
    mocks.loadEvidence.mockResolvedValueOnce(widened);
    const markup = await render();
    expect(markup).toContain("no es exclusivamente oficial"); expect(markup).not.toContain("300 votos a nivel seccion");
  });

  it("renders source exclusions independently without admitting them into official figures", async () => {
    const markup = await render();

    expect(markup).toContain("Se excluyeron 1 fila de fuente fiscalización / 20 votos del agregado oficial");
    expect(markup).toContain("Se excluyeron 1 fila de fuente fiscalización / 20 votos del agregado procedencia");
    expect(markup).toContain("Se excluyeron 1 fila(s) de referencia de fuente fiscalización");
    expect(markup).not.toContain("320 votos");
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
    expect(mocks.loadEvidence).not.toHaveBeenCalled();
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("rejects district-level evidence before any authorized read", async () => {
    const markup = await render({ ...COMPLETE_SECTION, seccionCode: undefined, level: "distrito" });

    expect(markup).toContain("el nivel distrito no está disponible");
    expect(mocks.facets).not.toHaveBeenCalled();
    expect(mocks.loadEvidence).not.toHaveBeenCalled();
  });

  it("rejects repeated canonical input before any authorized read", async () => {
    const markup = await render({ ...COMPLETE_SECTION, electionId: [COMPLETE_SECTION.electionId, COMPLETE_SECTION.electionId] });

    expect(markup).toContain("se proporcionaron más de una vez");
    expect(mocks.facets).not.toHaveBeenCalled();
    expect(mocks.loadEvidence).not.toHaveBeenCalled();
  });

  it("keeps authorized facets reachable until an exact section is complete", async () => {
    const markup = await render({ electionId: COMPLETE_SECTION.electionId });

    expect(mocks.facets).toHaveBeenCalledWith({ electionId: COMPLETE_SECTION.electionId });
    expect(mocks.loadEvidence).not.toHaveBeenCalled();
    expect(markup).toContain('<form action="/drilldown" method="get">');
    expect(markup).toContain("Elija una sección exacta");
  });

  it.each([
    ["empty", "No se encontraron resultados oficiales"],
    ["authorization_denied", "no pertenece al alcance autorizado"],
    ["unavailable", "no está disponible"],
    ["payload_too_large", "fue truncada; no se muestra ninguna cifra parcial"],
    ["malformed", "no superó la validación de integridad"],
  ])("renders the %s status as a refusal without figures", async (status, message) => {
    mocks.loadEvidence.mockResolvedValue({ status });

    const markup = await render();

    expect(markup).toContain(message);
    expect(markup).not.toContain("300 votos a nivel seccion");
    expect(markup).not.toContain("LLA");
    expect(markup).not.toContain("archive-1");
  });

  it("renders only bounded typed refusal evidence and no transport locations", async () => {
    mocks.loadEvidence.mockResolvedValue({
      status: "unavailable",
      evidence: [{
        part: "provenance",
        reason: "safe unavailable reason",
        counts: { selected_rows: 2 },
        exclusions: [{ reason: "missing_mesa", rows: 1, votes: 10 }],
        sourceExclusions: [{ kind: "fiscalizacion", rows: 2, votes: 20 }],
      }],
    });

    const markup = await render();

    for (const text of ["safe unavailable reason", "selected_rows: 2", "missing_mesa", "fiscalización", "2 fila(s) / 20 voto(s)"])
      expect(markup).toContain(text);
    expect(markup).not.toContain("https://");
    expect(markup).not.toContain("href=");
  });
});
