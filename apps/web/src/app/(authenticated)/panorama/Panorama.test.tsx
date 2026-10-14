import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import type { ExplorationOk } from "@/lib/results/exploration";
import type { PanoramaData } from "./load-panorama";
import { Panorama } from "./Panorama";
import { PanoramaChildren } from "./PanoramaChildren";
import { InspectorDistribution } from "../drilldown/DrilldownDistribution";

const { states } = vi.hoisted(() => ({ states: [] as string[] }));
vi.mock("react", async importOriginal => ({ ...await importOriginal<typeof import("react")>(), useState: (initial: unknown) => [states.length ? states.shift() : initial, vi.fn()] }));
vi.mock("../drilldown/TerritorialMapStage", async importOriginal => ({ ...await importOriginal<typeof import("../drilldown/TerritorialMapStage")>(), TerritorialMapStage: ({ heading }: { heading: string }) => <div>Mapa de referencia · {heading}</div> }));
afterEach(() => { states.length = 0; });
const result: ExplorationOk = {
  status: "ok", sourceKind: "official", level: "seccion", sourceGranularity: "mesa",
  electionYear: 2025, electionRound: "legislativas", categoryName: "DIPUTADO NACIONAL", totalVotes: 220,
  mesaCount: 2, archiveEntryIds: [], sourceAudit: [], sourceExclusions: [],
  parties: [1, 2, 3, 4, 5, 6].map(n => ({ identityStatus: "canonical", canonicalPartyId: `p${n}`, displayName: `Grupo ${n}`, listId: null, votes: n * 10, voteShare: n === 1 ? null : String(n / 22) })),
};
const data: PanoramaData = {
  href: "/drilldown?electionId=election&categoryId=category&distritoCode=02&seccionCode=027&level=seccion", exclusions: [],
  circuitOptions: [{ code: "00248", name: "Norte", nameStatus: "present", nameVariantCount: 1 }, { code: "00249", name: "Sur", nameStatus: "present", nameVariantCount: 1 }],
  evidence: {
    status: "ok", result, provenance: { items: [], sourceExclusions: [] },
    reference: { items: [], sourceExclusions: [] },
    schools: { status: "unavailable", exclusions: [], sourceExclusions: [] },
    completeness: { status: "unavailable" },
    circuitOutcomes: {
      status: "ok", authorization_status: "authorized", source_kind: "official", level: "seccion", truncated: false,
      circuit_membership: "known", category_applicability: "district_reported_categories",
      unassigned: { catalogue_mesas_without_membership: 0, membership_quarantined_mesas: 0, membership_quarantine_reasons: {}, completeness_quarantines: 0, completeness_quarantine_reasons: {}, unexpected_status_mesas: 0 },
      circuits: ["00248", "00249"].map(circuito_code => ({ circuito_code, positive_total: 100, status: "complete", counts: { expected: 1, counted: 1, not_counted: 0, missing: 0, unexpected: 0, quarantined: 0 }, parties: [{ identity_status: "canonical", canonical_party_id: "p6", display_name: "Grupo 6", list_id: null, votes: 70 }, { identity_status: "canonical", canonical_party_id: "p5", display_name: "Grupo 5", list_id: null, votes: 30 }] })),
    },
  },
};

it("shares the compact rule with Exploration, keeps every unmapped ID separate and never invents null shares", () => {
  const parties: ExplorationOk["parties"] = [...result.parties,
    { identityStatus: "unmapped", canonicalPartyId: null, displayName: null, listId: "X", votes: 5, voteShare: null },
    { identityStatus: "unmapped", canonicalPartyId: null, displayName: null, listId: "Y", votes: 5, voteShare: "0.02" },
  ];
  const evidence = data.evidence!;
  if (evidence.status !== "ok") throw new Error("fixture must be ok");
  const html = renderToStaticMarkup(<Panorama data={{ ...data, evidence: { ...evidence, result: { ...result, parties } } }} />);
  expect(html).toContain("Otras agrupaciones (2)");
  expect(html).toContain("30 votos · Porcentaje no disponible");
  expect(html).toContain("Lista sin mapear X");
  expect(html).toContain("Lista sin mapear Y");
  expect(html).not.toContain('aria-label="Lista sin mapear X: porcentaje');
  expect(html).not.toContain('aria-label="Otras agrupaciones (2): porcentaje');
  expect(html).not.toContain("Grupo 1");
  const exploration = renderToStaticMarkup(<InspectorDistribution result={{ ...result, parties }} />);
  for (const label of ["Otras agrupaciones (2)", "Lista sin mapear X", "Lista sin mapear Y"]) expect(exploration).toContain(label);
});

it("filters names locally while retaining all child rows and canonical links in the DOM", () => {
  states.push("norte");
  const html = renderToStaticMarkup(<PanoramaChildren data={data} />);
  expect(html).toContain("1 visibles · 2 circuitos disponibles");
  expect(html).toContain('<tr hidden=""><th scope="row"><a href="/drilldown?electionId=election&amp;categoryId=category&amp;distritoCode=02&amp;seccionCode=027&amp;level=circuito&amp;circuitoCode=00249">00249 — Sur</a>');
  expect(html).toContain("00248 — Norte");
  states.push("no coincide");
  expect(renderToStaticMarkup(<PanoramaChildren data={data} />)).toContain("No hay circuitos que coincidan con la búsqueda.");
  const cleared = renderToStaticMarkup(<PanoramaChildren data={data} />);
  expect(cleared).toContain("2 visibles · 2 circuitos disponibles");
  expect(cleared).not.toContain('<tr hidden="">');
  states.push("Argentina");
  const national = renderToStaticMarkup(<Panorama data={data} />);
  expect(national).not.toContain("00249 — Sur");
  expect(national).not.toContain("220");
});

it.each([
  { votes: [50, 50], total: 100, winner: "Empate", margin: "0 pp" },
  { votes: [0, 0], total: 0, winner: "Sin votos positivos", margin: "No disponible" },
])("does not pick a winner for a tied or zero circuit ($winner)", ({ votes, total, winner, margin }) => {
  const evidence = data.evidence!;
  if (evidence.status !== "ok" || evidence.circuitOutcomes?.status !== "ok") throw new Error("fixture must be ok");
  const circuit = evidence.circuitOutcomes.circuits[0]!;
  const html = renderToStaticMarkup(<PanoramaChildren data={{ ...data, evidence: { ...evidence, circuitOutcomes: { ...evidence.circuitOutcomes, circuits: [{ ...circuit, positive_total: total, status: "partial", counts: { ...circuit.counts, expected: 2, missing: 1 }, parties: circuit.parties.map((party, i) => ({ ...party, votes: votes[i]! })) }] } } }} />);
  expect(html).toContain(`${winner} · provisional`);
  expect(html).toContain(margin);
  expect(html).toContain("Parcial · provisorio · 50 % de mesas");
});

it.each(["authorization_denied", "unavailable", "empty"] as const)("never shows child figures for refused evidence (%s)", status => {
  const html = renderToStaticMarkup(<PanoramaChildren data={{ ...data, evidence: { status } }} />);
  expect(html).toContain("Sin filas disponibles");
  expect(html).not.toContain("<table>");
  expect(html).not.toContain("0 visibles");
  expect(html).not.toContain("00248");
});

it("does not invent children when official circuit membership is unknown", () => {
  const evidence = data.evidence!;
  if (evidence.status !== "ok" || evidence.circuitOutcomes?.status !== "ok") throw new Error("fixture must be ok");
  if (evidence.circuitOutcomes.circuit_membership !== "known") throw new Error("fixture membership must be known");
  const { category_applicability: applicability, ...outcomes } = evidence.circuitOutcomes;
  expect(applicability).toBe("district_reported_categories");
  const html = renderToStaticMarkup(<PanoramaChildren data={{ ...data, evidence: { ...evidence, circuitOutcomes: { ...outcomes, circuit_membership: "unknown", circuits: [] } } }} />);
  expect(html).toContain("Sin filas disponibles");
  expect(html).not.toContain("<table>");
});

it.each([undefined, { status: "unavailable" } as const])("discloses unavailable circuit outcomes without fabricated rows (%s)", (circuitOutcomes) => {
  const evidence = data.evidence!;
  if (evidence.status !== "ok") throw new Error("fixture must be ok");
  const { circuitOutcomes: previous, ...withoutOutcomes } = evidence;
  expect(previous?.status).toBe("ok");
  const html = renderToStaticMarkup(<PanoramaChildren data={{ ...data, evidence: { ...withoutOutcomes, ...(circuitOutcomes ? { circuitOutcomes } : {}) } }} />);
  expect(html).toContain("Resultados oficiales por circuito no disponibles. No se muestran unidades ni cifras inventadas.");
  expect(html).not.toContain("<table>");
  expect(html).not.toContain("00248 — Norte");
});

it("titles the neutral Rosales outline as a reference, never as winners (#487)", () => {
  const html = renderToStaticMarkup(<Panorama data={data} />);
  expect(html).toContain("Mapa de referencia · Referencia territorial");
  expect(html).not.toContain("Ganadores en el territorio");
});
