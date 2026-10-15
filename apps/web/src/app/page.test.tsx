import type { ReactElement } from "react";

vi.mock("@/lib/workspace/selection", () => ({ loadWorkspaceSelection: async () => ({ status: "active" }) }));
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { loadAuthorizedOfficialDrilldownEvidence } from "@/lib/workspace/official-drilldown-evidence";
import OperationalBriefingPage from "./(authenticated)/(home)/page";

const { facets } = vi.hoisted(() => ({ facets: vi.fn().mockResolvedValue({ elections: [] }) }));

vi.mock("@/lib/workspace/official-facets", () => ({
  createAuthorizedOfficialFacetRepository: () => ({
    facets,
  }),
}));

vi.mock("@/lib/workspace/official-drilldown-evidence", () => ({
  loadAuthorizedOfficialDrilldownEvidence: vi.fn().mockResolvedValue({ status: "authorization_denied" }),
}));

it("renders the root operational briefing with evidence and review routes", async () => {
  const markup = renderToStaticMarkup(
    await OperationalBriefingPage() as ReactElement,
  );

  expect(markup).toContain("<h1>Panorama</h1>");
  expect(markup).toContain("Una lectura del territorio. Un punto de partida para el análisis.");
  expect(markup).toContain("Resultados oficiales");
  expect(markup).toContain("Otros alcances · flujos separados");
  expect(markup).toContain("La disponibilidad depende del territorio y del acceso autorizado.");
  const hrefs = [...markup.matchAll(/href="([^"]+)"/g)].map((match) => match[1]).filter((href) => href?.startsWith("/"));
  expect([...new Set(hrefs)].sort()).toEqual(["/compare", "/drilldown", "/evidencia", "/fiscalizacion", "/municipal", "/review", "/simulate"]);
  // The approved "Continuar el análisis" row ends with the Evidencia module.
  expect(markup).toMatch(/<a[^>]*aria-label="Revisar evidencia"[^>]*href="\/evidencia"|<a[^>]*href="\/evidencia"[^>]*aria-label="Revisar evidencia"/);
  expect(markup.indexOf("Simular escenario")).toBeLessThan(markup.indexOf("Revisar evidencia"));
  expect(markup.indexOf("Revisar evidencia")).toBeLessThan(markup.indexOf("Atención operativa"));
  expect(markup.indexOf("Explorar resultados")).toBeLessThan(markup.indexOf("Atención operativa"));
  expect(markup.indexOf("Comparar elecciones")).toBeLessThan(markup.indexOf("Atención operativa"));
  expect(markup).toContain('href="/review"');
  expect(markup).toContain('href="/drilldown"');
});

it("renders compact official groups and real child circuit outcomes through the root page", async () => {
  facets.mockResolvedValue({
    elections: [{ id: "election", year: 2025, round: "legislativas" }],
    categories: [{ id: "category", name: "CONCEJALES" }],
    distritos: [{ code: "02" }], secciones: [{ code: "027" }],
    circuitos: [{ code: "00248", name: "Circuito autorizado", nameStatus: "present", nameVariantCount: 1 }],
    availableLevels: ["seccion"],
  });
  vi.mocked(loadAuthorizedOfficialDrilldownEvidence).mockResolvedValueOnce({
    status: "ok", result: {
      status: "ok", sourceKind: "official", electionYear: 2025, electionRound: "provinciales", categoryName: "CONCEJALES", mesaCount: 1, archiveEntryIds: [], sourceAudit: [],
      totalVotes: 210, level: "seccion", sourceGranularity: "mesa", sourceExclusions: [],
      parties: [6, 5, 4, 3, 2, 1].map((n) => ({ identityStatus: "canonical", canonicalPartyId: `p${n}`, displayName: `Grupo ${n}`, listId: null, votes: n * 10, voteShare: String(n / 21) })),
    },
    provenance: { items: [], sourceExclusions: [] }, reference: { items: [], sourceExclusions: [] },
    schools: { status: "unavailable", exclusions: [], sourceExclusions: [] }, completeness: { status: "unavailable" },
    circuitOutcomes: { status: "ok", authorization_status: "authorized", source_kind: "official", level: "seccion", truncated: false, category_applicability: "district_reported_categories", circuit_membership: "known", circuits: [{
      circuito_code: "00248", positive_total: 100, status: "complete",
      counts: { expected: 1, counted: 1, not_counted: 0, missing: 0, unexpected: 0, quarantined: 0 },
      parties: [{ identity_status: "canonical", canonical_party_id: "p6", display_name: "Grupo 6", list_id: null, votes: 70 }, { identity_status: "canonical", canonical_party_id: "p5", display_name: "Grupo 5", list_id: null, votes: 30 }],
    }], unassigned: { catalogue_mesas_without_membership: 0, membership_quarantined_mesas: 0, membership_quarantine_reasons: {}, completeness_quarantines: 0, completeness_quarantine_reasons: {}, unexpected_status_mesas: 0 } },
  });
  const markup = renderToStaticMarkup(await OperationalBriefingPage() as ReactElement);
  expect(markup).toContain('href="/compare?electionId=election&amp;categoryId=category&amp;sourceKind=official&amp;distritoCode=02&amp;seccionCode=027"');
  expect(markup).toContain("CONCEJALES");
  expect(markup).toContain("2025 · provinciales");
  expect.soft(markup).toContain("Otras agrupaciones (2)");
  expect(markup).toContain("30 votos");
  expect.soft(markup).not.toContain("Grupo 1");
  expect.soft(markup).toContain("Ver resultados exactos en Exploración");
  expect.soft(markup).toContain("Elegir dónde profundizar");
  expect.soft(markup).toContain("Buscar territorio");
  expect.soft(markup).toContain("Circuito autorizado");
  expect.soft(markup).toContain("40 pp");
  expect.soft(markup).toContain("circuitoCode=00248");
  facets.mockResolvedValue({ elections: [] });
});

it("does not retain a competing dashboard entry route beside the root briefing", async () => {
  const markup = renderToStaticMarkup(
    await OperationalBriefingPage() as ReactElement,
  );

  expect(markup).not.toContain('href="/dashboard"');
});
