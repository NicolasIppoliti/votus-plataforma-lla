import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { FacetOption } from "@/lib/results/exploration";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ facets: vi.fn(), evidence: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: mocks.replace }) }));
vi.mock("@/lib/workspace/official-facets", () => ({ AuthorizedOfficialFacetsError: class AuthorizedOfficialFacetsError extends Error {}, OFFICIAL_FACETS_ERROR: { AUTHORIZATION_DENIED: "authorization_denied" }, createAuthorizedOfficialFacetRepository: () => ({ facets: mocks.facets }) }));
vi.mock("@/lib/workspace/official-comparison-evidence", () => ({ OFFICIAL_COMPARISON_EVIDENCE_STATUS: { OK: "ok", EMPTY: "empty", AUTHORIZATION_DENIED: "authorization_denied", UNAVAILABLE: "unavailable", PAYLOAD_TOO_LARGE: "payload_too_large", MALFORMED: "malformed", UNMAPPED_PARTIES: "unmapped_parties" }, loadAuthorizedOfficialComparisonEvidence: mocks.evidence }));
const { default: ComparePage } = await import("./page");
const IDS = { leftElection: "10000000-0000-4000-8000-000000000001", rightElection: "10000000-0000-4000-8000-000000000002", leftCategory: "20000000-0000-4000-8000-000000000001", rightCategory: "20000000-0000-4000-8000-000000000002" } as const;
const PARAMS = { leftElectionId: IDS.leftElection, leftCategoryId: IDS.leftCategory, rightElectionId: IDS.rightElection, rightCategoryId: IDS.rightCategory, distritoCode: "02", seccionCode: "027" };
const elections = [{ id: IDS.leftElection, year: 2023, round: "generales", label: "2023 generales" }, { id: IDS.rightElection, year: 2025, round: "generales", label: "2025 generales" }, { id: "10000000-0000-4000-8000-000000000003", year: 2021, round: "generales", label: "2021 generales" }];
const district: FacetOption = { code: "02", name: "Buenos Aires", nameStatus: "present", nameVariantCount: 1 }, section: FacetOption = { code: "027", name: "Coronel Rosales", nameStatus: "present", nameVariantCount: 1 };
let leftDistricts = [district], rightDistricts = [district];
let leftSections = [section], rightSections = [section];
function facets(selection: Record<string, string | undefined>) { const left = selection.electionId === IDS.leftElection, right = selection.electionId === IDS.rightElection; return { elections, categories: left ? [{ id: IDS.leftCategory, name: "DIPUTADOS 2023" }] : right ? [{ id: IDS.rightCategory, name: "DIPUTADOS 2025" }] : [], distritos: selection.categoryId ? left ? leftDistricts : right ? rightDistricts : [] : [], secciones: selection.distritoCode ? left ? leftSections : right ? rightSections : [] : [], circuitos: [], establecimientos: [], mesas: [], availableLevels: selection.seccionCode ? ["distrito", "seccion"] : [], exclusions: [] }; }
function side(year: 2023 | 2025, electionId: string, categoryId: string, votes: readonly [number, number]) { const archiveEntryId = `official/archive-${year}`, total = votes[0] + votes[1]; return { result: { status: "ok" as const, sourceKind: "official" as const, level: "seccion" as const, sourceGranularity: "mesa" as const, categoryName: `DIPUTADOS ${year}`, electionYear: year, electionRound: "generales", totalVotes: total, mesaCount: 1, parties: [{ identityStatus: "canonical" as const, canonicalPartyId: "party-a", displayName: year === 2023 ? "PARTIDO A 2023" : "PARTIDO A 2025", listId: null, votes: votes[0], voteShare: String(votes[0] / total) }, { identityStatus: "canonical" as const, canonicalPartyId: "party-b", displayName: year === 2023 ? "PARTIDO B 2023" : "PARTIDO B 2025", listId: null, votes: votes[1], voteShare: String(votes[1] / total) }], archiveEntryIds: [archiveEntryId], sourceAudit: [{ kind: "official", rows: 2, votes: total }], sourceExclusions: [{ kind: "fiscalizacion", rows: 1, votes: 999 }] }, reference: { items: [{ jurisdictionId: `${year}-section`, electionId, year, round: "generales", categoryId, categoryName: `DIPUTADOS ${year}`, distritoCode: "02", distritoName: "Buenos Aires", seccionCode: "027", seccionName: "Coronel Rosales", circuitoCode: null, circuitoName: null, establecimientoCode: null, establecimientoName: null, mesaCode: null }], sourceExclusions: [{ kind: "fiscalizacion", reason: "non_official_source" as const, rows: 1 }] }, provenance: { items: [{ archiveEntryId, capability: "national", mime: "text/csv", bytes: 120, fetchedAt: "2026-01-01T00:00:00Z", status: "ok" as const, sha256: "a".repeat(64) }], sourceExclusions: [{ kind: "fiscalizacion", rows: 1, votes: 999 }] } }; }
function evidence() { return { status: "ok" as const, left: side(2023, IDS.leftElection, IDS.leftCategory, [60, 40]), right: side(2025, IDS.rightElection, IDS.rightCategory, [55, 45]) }; }
beforeEach(() => { leftDistricts = [district]; rightDistricts = [district]; leftSections = [section]; rightSections = [section]; mocks.facets.mockReset().mockImplementation(facets); mocks.evidence.mockReset().mockResolvedValue(evidence()); }); afterEach(() => vi.clearAllMocks());
async function render(params: Record<string, string | string[] | undefined>): Promise<string> { return renderToStaticMarkup((await ComparePage({ searchParams: Promise.resolve(params) })) as ReactElement); }
describe("authorized comparison page", () => {
  it("loads authorized facets for independent sides and one shared exact section", async () => { const markup = await render({}); for (const name of ["leftElectionId", "rightElectionId", "leftCategoryId", "rightCategoryId", "distritoCode", "seccionCode"]) expect(markup).toContain(`name="${name}"`); expect(markup).toContain('<form action="/compare" method="get">'); expect(markup).toContain("2023 generales"); expect(markup).toContain("2025 generales"); expect(markup).not.toContain("2021 generales"); expect(mocks.facets).toHaveBeenCalledTimes(1); expect(mocks.evidence).not.toHaveBeenCalled(); await render({ leftElectionId: IDS.leftElection, rightElectionId: IDS.rightElection }); expect(mocks.facets).toHaveBeenCalledWith({ electionId: IDS.leftElection }); expect(mocks.facets).toHaveBeenCalledWith({ electionId: IDS.rightElection }); });
  it("keeps a shared district code when side names differ and loads its sections", async () => { rightDistricts = [{ ...district, name: "Provincia de Buenos Aires" }]; const markup = await render({ ...PARAMS, seccionCode: undefined }); expect(markup).toContain('<option value="02" selected="">02 — nombres contradictorios</option>'); expect(markup).not.toContain("Buenos Aires"); expect(markup).not.toContain("Provincia de Buenos Aires"); expect(markup).toContain("027 — Coronel Rosales"); expect(mocks.facets).toHaveBeenCalledWith({ electionId: IDS.leftElection, categoryId: IDS.leftCategory, distritoCode: "02" }); expect(mocks.facets).toHaveBeenCalledWith({ electionId: IDS.rightElection, categoryId: IDS.rightCategory, distritoCode: "02" }); });
  it("reconciles present and missing metadata without choosing the present name", async () => { rightDistricts = [{ code: "02", name: null, nameStatus: "missing", nameVariantCount: 0 }]; const markup = await render({ ...PARAMS, distritoCode: undefined, seccionCode: undefined }); expect(markup).toContain('<option value="02">02 — nombres contradictorios</option>'); expect(markup).not.toContain("Buenos Aires"); expect(markup).not.toContain("nombre no disponible"); });
  it("keeps a shared conflict when only its variant counts differ", async () => { leftDistricts = [{ code: "02", name: null, nameStatus: "conflict", nameVariantCount: 2 }]; rightDistricts = [{ code: "02", name: null, nameStatus: "conflict", nameVariantCount: 3 }]; const markup = await render({ ...PARAMS, distritoCode: undefined, seccionCode: undefined }); expect(markup).toContain('<option value="02">02 — nombres contradictorios</option>'); });
  it("keeps a shared section code with conflicting metadata reachable for comparison", async () => { rightSections = [{ ...section, name: "Coronel de Marina Rosales" }]; const selectorMarkup = await render({ ...PARAMS, seccionCode: undefined }); expect(selectorMarkup).toContain('<option value="027">027 — nombres contradictorios</option>'); expect(selectorMarkup).not.toContain("Coronel Rosales"); expect(selectorMarkup).not.toContain("Coronel de Marina Rosales"); await render(PARAMS); expect(mocks.evidence).toHaveBeenCalledWith(expect.objectContaining({ seccionCode: "027" }), expect.objectContaining({ seccionCode: "027" })); });
  it("keeps an exactly matching option unchanged", async () => { const markup = await render({ ...PARAMS, distritoCode: undefined, seccionCode: undefined }); expect(markup).toContain('<option value="02">02 — Buenos Aires</option>'); expect(markup).not.toContain("nombres contradictorios"); });
  it("excludes one-sided district codes while disclosing their side-specific counts", async () => { leftDistricts = [...leftDistricts, { code: "99", name: "Distrito unilateral izquierdo", nameStatus: "present", nameVariantCount: 1 }]; rightDistricts = [...rightDistricts, { code: "98", name: "Distrito unilateral derecho", nameStatus: "present", nameVariantCount: 1 }]; const markup = await render({ ...PARAMS, distritoCode: undefined, seccionCode: undefined }); expect(markup).not.toContain('value="99"'); expect(markup).not.toContain('value="98"'); expect(markup).not.toContain("Distrito unilateral izquierdo"); expect(markup).not.toContain("Distrito unilateral derecho"); expect(markup).toContain("Opciones no compartidas — Distrito: 1 Lado A / 1 Lado B (disponibles solo en ese lado)."); });
  it("excludes one-sided section codes and discloses counts separately after a shared district", async () => { leftSections = [...leftSections, { code: "999", name: "Sección unilateral izquierda", nameStatus: "present", nameVariantCount: 1 }]; rightSections = [...rightSections, { code: "998", name: "Sección unilateral derecha", nameStatus: "present", nameVariantCount: 1 }]; const markup = await render({ ...PARAMS, seccionCode: undefined }); expect(markup).not.toContain('value="999"'); expect(markup).not.toContain('value="998"'); expect(markup).not.toContain("Sección unilateral izquierda"); expect(markup).not.toContain("Sección unilateral derecha"); expect(markup).toContain("Opciones no compartidas — Distrito: 0 Lado A / 0 Lado B (disponibles solo en ese lado)."); expect(markup).toContain("Opciones no compartidas — Sección: 1 Lado A / 1 Lado B (disponibles solo en ese lado)."); });
  it("keeps a same-code metadata conflict selectable without counting it as one-sided", async () => { rightDistricts = [{ ...district, name: "Provincia de Buenos Aires" }]; const markup = await render({ ...PARAMS, distritoCode: undefined, seccionCode: undefined }); expect(markup).toContain('<option value="02">02 — nombres contradictorios</option>'); expect(markup).toContain("Opciones no compartidas — Distrito: 0 Lado A / 0 Lado B (disponibles solo en ese lado)."); });
  it("does not represent an unqueried section level as zero exclusions", async () => { const markup = await render({ ...PARAMS, distritoCode: undefined, seccionCode: undefined }); expect(markup).toContain("Opciones no compartidas — Distrito: 0 Lado A / 0 Lado B (disponibles solo en ese lado)."); expect(markup).not.toContain("Opciones no compartidas — Sección:"); });
  it("renders canonical swing figures and URL-free provenance from the all-or-nothing evidence", async () => { const markup = await render(PARAMS); expect(mocks.evidence).toHaveBeenCalledWith(expect.objectContaining({ electionId: IDS.leftElection, categoryId: IDS.leftCategory, distritoCode: "02", seccionCode: "027", requestedLevel: "seccion" }), expect.objectContaining({ electionId: IDS.rightElection, categoryId: IDS.rightCategory, distritoCode: "02", seccionCode: "027", requestedLevel: "seccion" })); for (const text of ["PARTIDO A 2023", "PARTIDO A 2025", "60,00 %", "55,00 %", "-5,00 puntos porcentuales", "Referencia oficial — Lado A", "Izquierda: 1 referencia(s)", "official/archive-2023", "official/archive-2025", "Procedencia oficial — Lado B", "SHA-256"]) expect(markup).toContain(text); expect(markup).not.toMatch(/https?:\/\//); expect(markup).not.toContain("/private/"); expect(markup).not.toContain("999 votos"); });
  it("refuses all rendered output when a successful side is not official-only", async () => { const value = evidence(); Object.assign(value.left.result as { sourceKind: string; totalVotes: number; parties: Array<{ displayName: string; votes: number; voteShare: string }>; archiveEntryIds: string[]; sourceAudit: Array<{ kind: string; rows: number; votes: number }> }, { sourceKind: "fiscalizacion", totalVotes: 1000, parties: [{ ...value.left.result.parties[0]!, displayName: "SENTINEL_LEFT_FIGURE", votes: 777, voteShare: "0.777" }, { ...value.left.result.parties[1]!, displayName: "SENTINEL_LEFT_FIGURE_B", votes: 223, voteShare: "0.223" }], archiveEntryIds: ["SENTINEL_LEFT_ARCHIVE_PROVENANCE"], sourceAudit: [{ kind: "official", rows: 2, votes: 1000 }] }); value.left.reference.items = Array.from({ length: 73 }, (_, index) => ({ ...value.left.reference.items[0]!, jurisdictionId: `SENTINEL_LEFT_REFERENCE_${index}` })); value.left.provenance.items[0]!.archiveEntryId = "SENTINEL_LEFT_ARCHIVE_PROVENANCE"; mocks.evidence.mockResolvedValue(value); const markup = await render(PARAMS); expect(markup).toContain("La evidencia oficial autorizada no superó la validación integral y no se muestran cifras."); for (const sentinel of ["SENTINEL_LEFT_FIGURE", "77,70 %", "73 referencia(s)", "SENTINEL_LEFT_ARCHIVE", "SENTINEL_LEFT_ARCHIVE_PROVENANCE"]) expect(markup).not.toContain(sentinel); });
  it.each([{ sourceAudit: [{ kind: "fiscalizacion", rows: 2, votes: 100 }] }, { sourceAudit: [{ kind: "unknown", rows: 2, votes: 100 }] }, { sourceAudit: [{ kind: "official" }] }, { sourceAudit: { kind: "official", rows: 2, votes: 100 } }, { sourceAudit: undefined }] as const)("refuses all output without identifying a side when included source audit is non-official or malformed", async ({ sourceAudit }) => { const value = evidence(); (value.right.result as { sourceAudit: unknown }).sourceAudit = sourceAudit; mocks.evidence.mockResolvedValue(value); const markup = await render(PARAMS); expect(markup).toContain("La evidencia oficial autorizada no superó la validación integral y no se muestran cifras."); for (const hidden of ["Lado A", "Lado B", "PARTIDO A 2023", "PARTIDO A 2025", "official/archive-2023", "official/archive-2025", "puntos porcentuales"]) expect(markup).not.toContain(hidden); });
  it.each(["left", "right"] as const)("refuses all rendered output when the %s official audit is empty", async (sideName) => { const value = evidence(); (value[sideName].result as { sourceAudit: unknown }).sourceAudit = []; mocks.evidence.mockResolvedValue(value); const markup = await render(PARAMS); expect(markup).toContain("La evidencia oficial autorizada no superó la validación integral y no se muestran cifras."); for (const hidden of ["Lado A", "Lado B", "PARTIDO A 2023", "PARTIDO A 2025", "60,00 %", "55,00 %", "puntos porcentuales", "Referencia oficial", "official/archive", "Procedencia oficial", "Opciones no compartidas", "disponibles solo en ese lado"]) expect(markup).not.toContain(hidden); });
  it("renders each result-owned source exclusion exactly once when all evidence matches", async () => { const markup = await render(PARAMS); expect(markup.match(/Izquierda: 1 fila\(s\) de fuente fiscalizacion excluidas de todas las cifras\./g)).toHaveLength(1); expect(markup.match(/Derecha: 1 fila\(s\) de fuente fiscalizacion excluidas de todas las cifras\./g)).toHaveLength(1); });
  it("refuses a D6 source-granularity mismatch without any figures", async () => { const value = evidence(); Object.assign(value.right.result, { sourceGranularity: "distrito" as const }); mocks.evidence.mockResolvedValue(value); const markup = await render(PARAMS); for (const text of ["Granularidad mixta", "mesa", "distrito"]) expect(markup).toContain(text); expect(markup).not.toContain("puntos porcentuales"); expect(markup).not.toContain("official/archive-2023"); });
  it("renders only safe side-owned counts for an unmapped refusal", async () => { mocks.evidence.mockResolvedValue({ status: "unmapped_parties", sides: [{ side: "left", partyCount: 1, totalVotes: 40 }], raw_list_id: "raw-list", display_name: "unsafe name", provider_side: "secret", left: side(2023, IDS.leftElection, IDS.leftCategory, [60, 40]) }); const markup = await render(PARAMS); for (const text of ["lado izquierdo", "1 partido", "40 votos"]) expect(markup).toContain(text); for (const hidden of ["raw-list", "unsafe name", "secret", "PARTIDO A 2023", "puntos porcentuales", "official/archive"]) expect(markup).not.toContain(hidden); });
  it.each([["authorization_denied", "No tiene autorización"], ["payload_too_large", "excede el límite seguro"], ["malformed", "no superó la validación"], ["unavailable", "no está disponible"]] as const)("renders no figures for %s evidence", async (status, message) => { mocks.evidence.mockResolvedValue({ status }); const markup = await render(PARAMS); expect(markup).toContain(message); expect(markup).not.toContain("puntos porcentuales"); expect(markup).not.toContain("official/archive"); });
  it.each([["repeated", { ...PARAMS, leftElectionId: [IDS.leftElection, IDS.rightElection] }], ["legacy", { ...PARAMS, election2023: IDS.leftElection }], ["unknown", { ...PARAMS, debug: "true" }]])("rejects %s query keys before authorized reads", async (_case, params) => { const markup = await render(params); expect(markup).toContain("Se rechazó la solicitud"); expect(mocks.facets).not.toHaveBeenCalled(); expect(mocks.evidence).not.toHaveBeenCalled(); });
  it("hides authorized facet provider failures", async () => { mocks.facets.mockRejectedValue(new Error("private provider detail")); const markup = await render({}); expect(markup).toContain("No se pudieron cargar las opciones autorizadas"); expect(markup).not.toContain("private provider detail"); });
  it("presents two owned sides, shared scope, and exact official evidence as one ledger", async () => {
    const markup = await render(PARAMS);
    for (const text of ["Lado A", "Lado B", "Jurisdicción compartida", "Resultados exactos", "Evidencia oficial por lado"]) expect(markup).toContain(text);
    expect(markup).toContain('aria-labelledby="compare-side-a-heading"');
    expect(markup).toContain('aria-labelledby="compare-side-b-heading"');
    expect(markup).toContain('aria-label="Tabla exacta de participación y variación por partido en 02/027" tabindex="0"');
    expect(markup).toContain("Referencia oficial — Lado A");
    expect(markup).toContain("Procedencia oficial — Lado B");
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
      const labels = [...markup.matchAll(new RegExp(`<${tag}[^>]*aria-labelledby="([^"]+)"`, "g"))];
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
      expect(fieldsets[index]).toContain('class="official-compare__side"');
      expect(fieldsets[index]).toContain(`aria-labelledby="compare-edit-${side.toLowerCase()}-heading"`);
      expect(fieldsets[index]?.match(/<select\b/g)).toHaveLength(2);
    }
    expect(fieldsets[2]).toContain('aria-labelledby="compare-shared-heading"');
    expect(fieldsets[2]).toContain('value="02" selected=""');
    expect(fieldsets[2]).toContain('value="027" selected=""');
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
    expect(markup).not.toMatch(/<button\b/);
    expect(markup.match(/<select\b[^>]*required=""/g)).toHaveLength(6);
    expect(markup).toContain('<form action="/compare" method="get">');
    expect(markup.match(/class="table-scroll"/g)).toHaveLength(1);
    expect(markup).toContain("Participación oficial y variación en puntos porcentuales</caption>");
    expect(markup.match(/scope="row"/g)).toHaveLength(2);
  });
  it("keeps the selector context while a denied comparison removes both sides of evidence", async () => {
    mocks.evidence.mockResolvedValue({ status: "authorization_denied" });
    const markup = await render(PARAMS);
    expect(markup).toContain("Elección izquierda (2023)");
      expect(markup).not.toContain("Opciones no compartidas");
      expect(markup).not.toContain("disponibles solo en ese lado");
    expect(markup).toContain("Elección derecha (2025)");
    expect(markup).not.toMatch(/PARTIDO A|official\/archive|puntos porcentuales|100 votos/);
  });
});

it("progressively discloses archive detail without hiding source exclusions or result context", async () => {
  const markup = await render(PARAMS);
  const disclosures = [...markup.matchAll(/<details\b[^>]*>[\s\S]*?<\/details>/g)].map(([html]) => html);
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
  expect(visibleMarkup).toContain("Izquierda: 1 fila(s) de fuente fiscalizacion excluidas de todas las cifras.");
  expect(visibleMarkup).toContain("Derecha: 1 fila(s) de fuente fiscalizacion excluidas de todas las cifras.");
  expect(visibleMarkup).toContain("Resultados exactos");
  expect(visibleMarkup).toContain("60,00 %");
  expect(visibleMarkup).toContain("sumado a partir de filas de nivel mesa");
  expect(markup).not.toContain("official-compare__section-label");
});

it("reacts through six native selectors without manual refresh or apply buttons", async () => {
  const markup = await render(PARAMS);
  expect(markup.match(/<select\b/g)).toHaveLength(6);
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

it("charts the full canonical union without inventing a vote share for an absent party", async () => {
  const value = evidence();
  value.right.result.parties[1]!.canonicalPartyId = "party-c";
  value.right.result.parties[1]!.displayName = "PARTIDO C 2025";
  mocks.evidence.mockResolvedValue(value);
  const markup = await render(PARAMS);
  expect(markup.match(/viewBox="0 0 100 12"/g)).toHaveLength(6);
  expect(markup).toContain('aria-label="Lado B: PARTIDO B 2023, 0,00 %"');
  expect(markup).toContain('aria-label="Lado A: PARTIDO C 2025, 0,00 %"');
  expect(markup).toContain('aria-label="Lado B: PARTIDO C 2025, 45,00 %"');
});
