import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { TerritorialBreakdown } from "@/app/(authenticated)/drilldown/TerritorialBreakdown";
import { TerritorialNavigator } from "@/app/(authenticated)/drilldown/TerritorialNavigator";
import type { OfficialSectionCircuitOutcomes } from "@/lib/workspace/official-section-circuit-outcomes";
import { ComparisonChildren } from "@/app/(authenticated)/compare/ComparisonChildren";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));

it("renders a persistent polite atomic status in the territorial breakdown", () => {
  const html = renderToStaticMarkup(<TerritorialBreakdown context="Oficial" total={2}><table><tbody><tr><td>Uno</td></tr><tr><td>Dos</td></tr></tbody></table></TerritorialBreakdown>);
  expect(html).toMatch(/aria-live="polite" aria-atomic="true" role="status"/);
  expect(html).toContain("2 visibles · 2 territorios listados");
});
it("renders initial listed territory counts in the real navigator", () => {
  const html = renderToStaticMarkup(<TerritorialNavigator items={[]} options={[{ name: "Circuito", values: { electionId: "e", categoryId: "c" } }]} title="Circuitos" terminal={false} />);
  expect(html).toMatch(/aria-live="polite" aria-atomic="true" role="status"/);
  expect(html).toContain("1 visibles · 1 territorios listados");
});
it.each([true, false])("preserves terminal/unavailable navigation when terminal=%s", terminal => {
  const html = renderToStaticMarkup(<TerritorialNavigator items={[]} options={[]} title="Territorios" terminal={terminal} />);
  expect(html).toContain(terminal ? "Fin del recorrido" : "No hay un siguiente nivel autorizado disponible.");
  expect(html).not.toContain("No hay coincidencias");
});
it("keeps listed counts separate from electoral comparability counts", () => {
  const side: OfficialSectionCircuitOutcomes = {
    status: "ok", authorization_status: "authorized", source_kind: "official", level: "seccion", truncated: false,
    circuit_membership: "known", category_applicability: "district_reported_categories",
    unassigned: { catalogue_mesas_without_membership: 0, membership_quarantined_mesas: 0, membership_quarantine_reasons: {}, completeness_quarantines: 0, completeness_quarantine_reasons: {}, unexpected_status_mesas: 0 },
    circuits: ["00001", "00002"].map(circuito_code => ({ circuito_code, positive_total: 10, parties: [], status: "partial", counts: { expected: 2, counted: 1, not_counted: 0, missing: 1, unexpected: 0, quarantined: 0 } })),
  };
  const html = renderToStaticMarkup(<ComparisonChildren outcomes={[side, side]} party="p" />);
  expect(html).toContain("2 visibles · 2 territorios listados");
  expect(html).toContain("0 de 2 pares comparables para la agrupación seleccionada");
  expect(html).toContain("Cobertura parcial: 2");
});
it("keeps the comparison filter status mounted when comparability is unavailable", () => {
  const html = renderToStaticMarkup(<ComparisonChildren outcomes={[{ status: "unavailable" }, { status: "unavailable" }]} party="p" />);
  expect(html).toMatch(/aria-live="polite" aria-atomic="true" role="status"/);
  expect(html).toContain("0 visibles · 0 territorios listados");
});
