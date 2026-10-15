import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { ComparisonSelectionForm } from "./(authenticated)/compare/ComparisonSelectionForm";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));
import { TableRegion } from "@/components/TableRegion";
import { Table } from "@/components/ui/table";
import { EvidenceContext } from "./(authenticated)/evidencia/EvidenceContext";

const css = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

it("keeps the full selected evidence and comparison labels readable outside native clipped controls", () => {
  const label = "Diputados nacionales · categoría de nombre extenso";
  const html = renderToStaticMarkup(<EvidenceContext fields={[{ name: "categoryId", label: "Categoría", value: "c", options: [{ value: "c", label }] }]}><p>Resultado</p></EvidenceContext>);
  expect(html).toContain(`class="responsive-select__value" data-mobile-select-value="" aria-hidden="true">${label}</span>`);
  const comparison = renderToStaticMarkup(<ComparisonSelectionForm selected={{ leftElectionId: "e" }} groups={[{ id: "a", title: "A", description: "Selección", className: "", fields: [{ key: "leftElectionId", id: "election-a", label: "Elección A", placeholder: "Elegir", options: [{ value: "e", label }] }] }]}><p>Resultado</p></ComparisonSelectionForm>);
  expect(comparison).toContain(`class="responsive-select__value" data-mobile-select-value="" aria-hidden="true">${label}</span>`);
  expect(comparison).toContain('id="election-a"');
  expect(css("./globals.css")).toMatch(/\.responsive-select__value\s*\{[^}]*overflow-wrap: anywhere/);
});

it("does not display a stale full-value mirror for an empty selection", () => {
  const html = renderToStaticMarkup(<EvidenceContext fields={[{ name: "categoryId", label: "Categoría", value: "", options: [{ value: "c", label: "Anterior" }] }]}><p>Sin selección</p></EvidenceContext>);
  expect(html).not.toContain('aria-hidden="true">Anterior</span>');
  expect(html).toContain('for="evidence-categoryId"');
});

it("stacks simulation geography copy above its switch on narrow screens", () => {
  expect(css("./(authenticated)/simulate/workbench.css")).toMatch(/@media \(max-width: 480px\)\s*\{\s*\.simulation-geography > header\s*\{[^}]*flex-direction: column;[^}]*align-items: stretch/);
});

it("brings Panorama content forward without clipping the circuit map", () => {
  const mobile = css("./(authenticated)/panorama/panorama.module.css").split("/* Issue 501 mobile */")[1] ?? "";
  expect(mobile).toMatch(/\.heading\s*\{[^}]*margin-bottom: 12px/);
  expect(mobile).toMatch(/\.map > section > svg\s*\{[^}]*height: auto;[^}]*max-height: none/);
  expect(mobile).toMatch(/\.context\s*\{[^}]*padding-block: 8px/);
});

it("reduces Exploration pre-map spacing without hiding context or shrinking touch targets", () => {
  const mobile = css("./(authenticated)/drilldown/drilldown.module.css").split("/* Issue 501 mobile */")[1] ?? "";
  expect(mobile).toMatch(/\.selectionBoundary\s*\{[^}]*gap: 12px/);
  expect(mobile).toMatch(/\.filterRow\s*\{[^}]*gap: 8px/);
  expect(mobile).toMatch(/\.guidance\s*\{[^}]*line-height: 1.35/);
  const spacingRules = mobile.split("/* Reference-only geography")[0];
  expect(spacingRules).not.toContain("display: none");
});

it("makes horizontal table navigation discoverable while bounding long mobile tables", () => {
  const html = renderToStaticMarkup(<TableRegion mobileHint label="Resultados municipales"><Table><tbody><tr><td>Dato</td></tr></tbody></Table></TableRegion>);
  expect(html).toContain('aria-label="Resultados municipales" tabindex="0"');
  expect(html).toContain("Desplazá horizontalmente para ver todas las columnas.");
  for (const path of ["municipal/municipal.module.css", "fiscalizacion/fiscalizacion.module.css"]) {
    const mobile = css(`./(authenticated)/${path}`).split("/* Issue 501 mobile */")[1] ?? "";
    expect(mobile).toMatch(/max-height: 360px/);
    expect(mobile).toMatch(/overflow: auto/);
    expect(mobile).toMatch(/overscroll-behavior-inline: contain/);
  }
});
