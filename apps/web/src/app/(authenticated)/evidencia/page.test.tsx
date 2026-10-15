import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ facets: vi.fn(), bundle: vi.fn(), completeness: vi.fn(), circuits: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }), useSearchParams: () => new URLSearchParams() }));
vi.mock("@/lib/supabase/server-client", () => ({ createSupabaseServerClient: async () => ({}) }));
vi.mock("@/lib/workspace/context", () => ({ authorizedOfficialBundle: mocks.bundle, authorizedOfficialSectionCompleteness: mocks.completeness, authorizedOfficialSectionCircuitOutcomes: mocks.circuits }));
vi.mock("@/lib/workspace/official-facets", async original => ({ ...await original<typeof import("@/lib/workspace/official-facets")>(), createAuthorizedOfficialFacetRepository: () => ({ facets: mocks.facets }) }));
const { default: Page } = await import("./page");
const electionId = "10000000-0000-4000-8000-000000000001", categoryId = "20000000-0000-4000-8000-000000000001";
const params = { electionId, categoryId, distritoCode: "02", seccionCode: "027" };
const facet = (code: string, name: string) => ({ code, name, nameStatus: "present", nameVariantCount: 1 });
const authorized = { authorization_status: "authorized", truncated: false, source_kind: "official" };
function bundle() {
  const audit = [{ kind: "official", rows: 2, votes: 300 }];
  const parties = [{ identity_status: "canonical", canonical_party_id: "party", display_name: "Agrupación", list_id: null, votes: 300, vote_share: "1" }];
  return {
    result: { ...authorized, status: "ok", category_name: "DIPUTADOS", level: "seccion", source_granularity: "mesa", election_year: 2025, election_round: "generales", total_votes: 300, mesa_count: 2, parties, source_audit: audit, source_exclusions: [{ kind: "fiscalizacion", rows: 1, votes: 20 }], archive_entry_ids: ["archive-1"] },
    schools: { ...authorized, status: "ok", level: "seccion", source_audit: audit, source_exclusions: [], exclusions: [], schools: [{ circuito_code: "00248", code: "E1", name: "Establecimiento", mesa_count: 2, total_votes: 300, parties, archive_entry_ids: ["archive-1"] }] },
    reference: { ...authorized, status: "ok", total: 1, source_exclusions: [], items: [{ jurisdiction_id: "jurisdiction", election_id: electionId, category_id: categoryId, year: 2025, round: "generales", category_name: "DIPUTADOS", distrito_code: "02", distrito_name: "Buenos Aires", seccion_code: "027", seccion_name: "Coronel Rosales", circuito_code: "00248", circuito_name: null, establecimiento_code: "E1", establecimiento_name: "Establecimiento", mesa_code: 1 }] },
    provenance: { ...authorized, status: "ok", total: 1, source_audit: audit, source_exclusions: [], archive_entry_ids: ["archive-1"], sources: [{ id: "archive-1", metadata_status: "available", capability: "results", mime: "application/json", bytes: 120, fetched_at: "2025-10-26T10:00:00Z", status: "ok", sha256: "a".repeat(64) }] },
  };
}
function completeness(status: "complete" | "partial" = "complete") {
  return { status: "ok", authorization_status: "authorized", source_kind: "official", level: "seccion", completeness: { status, reason: null, unlisted_status_mesas: null, quarantined_mesas: null, unattributed_quarantined: null, counts: { expected: 2, counted: status === "complete" ? 2 : 1, not_counted: status === "complete" ? 0 : 1, missing: 0, unexpected: 0, quarantined: 0, unattributed_quarantined: 0 }, category_applicability: "district_reported_categories", sources: { catalogue_archive_entry_ids: ["archive-1"], status_archive_entry_ids: ["archive-1"] } } };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.facets.mockResolvedValue({ elections: [{ id: electionId, year: 2025, round: "generales", label: "2025 generales" }], categories: [{ id: categoryId, name: "DIPUTADOS" }], distritos: [facet("02", "Buenos Aires")], secciones: [facet("027", "Coronel Rosales")], circuitos: [], establecimientos: [], mesas: [], availableLevels: ["seccion"], exclusions: [] });
  mocks.bundle.mockResolvedValue(bundle()); mocks.completeness.mockResolvedValue(completeness());
  mocks.circuits.mockResolvedValue({ ...authorized, status: "ok", level: "seccion", circuit_membership: "unknown", circuits: [], unassigned: { catalogue_mesas_without_membership: 0, membership_quarantined_mesas: 0, membership_quarantine_reasons: {}, completeness_quarantines: 0, completeness_quarantine_reasons: {}, unexpected_status_mesas: 0 } });
});
async function render(query: Record<string, string | string[] | undefined> = params) { return renderToStaticMarkup(await Page({ searchParams: Promise.resolve(query) }) as ReactElement); }
it("renders the real evidence workbench with authorized provenance and section completeness", async () => {
  const html = await render();
  for (const text of ["Evidencia y calidad de datos", "Qué respalda este dato", "Qué permite esta evidencia", "Inspeccionar las unidades", "Escrutinio completo: 2 de 2", "Ver trazabilidad", "archive-1", "120 bytes", "Pertenencia a circuitos desconocida", "Fuente excluida fiscalización: 1 fila(s) / 20 voto(s)"]) expect(html).toContain(text);
  expect(mocks.bundle).toHaveBeenCalledWith({}, { ...params, circuitoCode: null, establecimientoCode: null, mesaCode: null, requestedLevel: "seccion" });
  expect(html).not.toContain("49.300"); expect(html).not.toContain("Casos de consulta");
});
it("labels facet exclusions in Spanish at the rendered page boundary and preserves unknown reasons", async () => {
  const facets = await mocks.facets();
  mocks.facets.mockResolvedValue({ ...facets, exclusions: [
    { reason: "non_official_source_rows", rows: 3 },
    { reason: "future_exclusion", rows: 2 },
  ] });
  const html = await render();
  expect(html).toContain("Opciones excluidas: filas de fuente no oficial; 3 fila(s).");
  expect(html).not.toContain("non_official_source_rows");
  expect(html).toContain("Opciones excluidas: future_exclusion; 2 fila(s).");
});
it("does not request result evidence until an exact authorized section is chosen", async () => {
  expect(await render({})).toContain("Seleccione una elección, categoría, distrito y sección");
  expect(mocks.bundle).not.toHaveBeenCalled();
});
it("rejects repeated parameters before any authorized reads", async () => {
  expect(await render({ ...params, electionId: [electionId, electionId] })).toContain("Parámetros repetidos");
  expect(mocks.facets).not.toHaveBeenCalled(); expect(mocks.bundle).not.toHaveBeenCalled();
});
it("rejects an out-of-facet section without querying the bundle", async () => {
  expect(await render({ ...params, seccionCode: "999" })).toContain("La selección no pertenece a las opciones autorizadas");
  expect(mocks.bundle).not.toHaveBeenCalled();
});
it.each([ ["authorization_denied", "Consulta no autorizada"], ["no_rows", "Consulta vacía"], ["payload_too_large", "Respuesta fuera de límite"] ])("clears every figure and provenance on %s", async (status, label) => {
  const part = { status, authorization_status: status === "authorization_denied" ? "denied" : "authorized", truncated: status === "payload_too_large" };
  mocks.bundle.mockResolvedValue({ result: part, schools: part, reference: part, provenance: part });
  const html = await render(); expect(html).toContain(label); expect(html).not.toContain("archive-1"); expect(html).not.toContain("300"); expect(html).not.toContain("2 de 2");
});
it("keeps unavailable completeness distinct from unknown in the map caption", async () => {
  mocks.completeness.mockRejectedValue(new Error("unavailable"));
  const html = await render();
  expect(html).toContain("Completitud no disponible · Coronel Rosales");
  expect(html).not.toContain("Completitud desconocida · Coronel Rosales");
});
it("surfaces authorized refusal exclusions by reason without exposing unsafe fields", async () => {
  const part = { ...authorized, status: "source_unavailable", reason: "missing_lineage", counts: { rows: 2 }, source_exclusions: [{ kind: "fiscalizacion", rows: 2, votes: 40, notes: "UNSAFE_NOTES" }] };
  mocks.bundle.mockResolvedValue({ result: part, schools: part, reference: part, provenance: part });
  const html = await render();
  expect(html).toContain("missing_lineage"); expect(html).toContain("2 fila(s) / 40 voto(s)");
  expect(html).not.toContain("UNSAFE_NOTES"); expect(html).not.toContain("archive-1");
});
it("translates non-official row reasons in rendered refusal evidence without losing counts", async () => {
  const part = { ...authorized, status: "source_unavailable", reason: "non_official_source_rows", counts: { non_official_source_rows: 3 }, exclusions: [{ reason: "non_official_source_rows", rows: 3, votes: 40 }] };
  mocks.bundle.mockResolvedValue({ result: part, schools: part, reference: part, provenance: part });
  const html = await render();
  expect(html).toContain("filas de fuente no oficial");
  expect(html).not.toContain("non_official_source_rows");
  expect(html).toContain("3 fila(s) / 40 voto(s)");
});
it("does not mistake partial or unknown completeness for complete coverage", async () => {
  mocks.completeness.mockResolvedValue(completeness("partial"));
  expect(await render()).toContain("Escrutinio parcial: 1 de 2");
  mocks.completeness.mockResolvedValue({ status: "ok", authorization_status: "authorized", source_kind: "official", level: "seccion", completeness: { status: "unknown", reason: "no_expected_catalogue", counts: null, category_applicability: "district_reported_categories", sources: null } });
  const html = await render(); expect(html).toContain("Completitud desconocida"); expect(html).not.toContain("100%");
});
it("retains unassigned quarantine reasons even when circuit membership is unknown", async () => {
  mocks.circuits.mockResolvedValue({ ...authorized, status: "ok", level: "seccion", circuit_membership: "unknown", circuits: [], unassigned: { catalogue_mesas_without_membership: 2, membership_quarantined_mesas: 1, membership_quarantine_reasons: { conflicting_membership: 1 }, completeness_quarantines: 1, completeness_quarantine_reasons: { unreadable_key: 1 }, unexpected_status_mesas: 0 } });
  const html = await render();
  expect(html).toContain("conflicting_membership: 1");
  expect(html).toContain("unreadable_key: 1");
  expect(html).not.toMatch(/\d+ de \d+ unidades visibles/);
});
it("reaches the exact partial circuit table with every omission category", async () => {
  mocks.circuits.mockResolvedValue({ ...authorized, status: "ok", level: "seccion", circuit_membership: "known", category_applicability: "district_reported_categories", circuits: [{ circuito_code: "00248", positive_total: 0, parties: [], status: "partial", counts: { expected: 3, counted: 2, not_counted: 1, missing: 0, unexpected: 0, quarantined: 0 } }], unassigned: { catalogue_mesas_without_membership: 0, membership_quarantined_mesas: 0, membership_quarantine_reasons: {}, completeness_quarantines: 0, completeness_quarantine_reasons: {}, unexpected_status_mesas: 0 } });
  const html = await render();
  for (const text of ["Circuito 00248", "2/3 mesas", "1 no escrutadas", "0 sin estado", "0 fuera del catálogo", "0 en cuarentena", "Ver límites de lectura", "1 de 1 unidades visibles"]) expect(html).toContain(text);
  expect(html).not.toContain("Circuito de demostración");
});
it("qualifies missing hashes and archive error status outside the disclosure", async () => {
  const payload = bundle(); Object.assign(payload.provenance.sources[0]!, { status: "error", sha256: null }); mocks.bundle.mockResolvedValue(payload);
  const html = await render();
  expect(html.indexOf("el archivo informa estado error")).toBeLessThan(html.indexOf("<summary>Archivo y procedencia"));
  expect(html).toContain("no disponible");
});
it("distinguishes a technical failure and supplies a selection-bound retry", async () => {
  mocks.bundle.mockRejectedValue(new Error("UNSAFE_FAILURE"));
  const html = await render();
  expect(html).toContain("Evidencia no disponible"); expect(html).toContain("Reintentar carga"); expect(html).not.toContain("UNSAFE_FAILURE"); expect(html).not.toContain("archive-1");
});
it("fails closed for unsafe provenance and mixed official figures", async () => {
  const payload = bundle(); Object.assign(payload.provenance.sources[0]!, { source_url: "UNSAFE_SENTINEL" });
  mocks.bundle.mockResolvedValue(payload);
  let html = await render(); expect(html).toContain("Respuesta no válida"); expect(html).not.toContain("UNSAFE_SENTINEL"); expect(html).not.toContain("archive-1");
  const mixed = bundle(); mixed.result.source_kind = "fiscalizacion"; mocks.bundle.mockResolvedValue(mixed);
  html = await render(); expect(html).toContain("Respuesta no válida"); expect(html).not.toContain("300");
});
