import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { DrilldownSelectionForm } from "@/app/(authenticated)/drilldown/DrilldownSelectionForm";
import { TerritorialNavigator } from "@/app/(authenticated)/drilldown/TerritorialNavigator";
import { FiscalizacionSelectionForm } from "@/app/(authenticated)/fiscalizacion/FiscalizacionSelectionForm";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));
const selected = { electionId: "e1", categoryId: "c1", distritoCode: "02", seccionCode: "027" };
const section = { name: "seccionCode" as const, id: "section", label: "Sección", placeholder: "Elegir una sección", options: [] };

it("reaches the sección definition beside the unchanged selector labels in both production forms", () => {
  const forms = [
    <DrilldownSelectionForm key="explore" selected={selected} fields={[section]} notes={null}>{null}</DrilldownSelectionForm>,
    <FiscalizacionSelectionForm key="coverage" selected={selected} fields={[section]}>{null}</FiscalizacionSelectionForm>,
  ];
  for (const form of forms) {
    const html = renderToStaticMarkup(form);
    expect(html).toContain('<label for="section">Sección</label>');
    expect(html).toContain('aria-label="Qué significa sección"');
    expect(html).toContain('role="tooltip"');
    expect(html).toContain('aria-describedby=');
    expect(html).toContain('En Buenos Aires corresponde a un partido.');
  }
});

it.each([
  ["seccion", "Circuitos", "circuito"],
  ["circuito", "Establecimientos", "establecimiento"],
  ["establecimiento", "Mesas", "mesa"],
])("reaches the %s child-level definition through the production territorial navigator", (level, title, term) => {
  const html = renderToStaticMarkup(<TerritorialNavigator items={[{ name: "Territorio", values: { ...selected, level } }]} options={[]} title={title} terminal={false} />);
  expect(html).toContain(`aria-label="Qué significa ${term}"`);
  expect(html).toContain('role="tooltip"');
});
