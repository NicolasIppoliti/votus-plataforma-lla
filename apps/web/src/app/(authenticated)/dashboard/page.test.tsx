import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import DashboardPage from "./page";

const WORKFLOW_LINKS = [
  ["/drilldown", "Explorar resultados"],
  ["/fiscalizacion", "Fiscalización (no oficial)"],
  ["/review", "Revisión"],
  ["/simulate", "Simulación de bancas"],
  ["/compare", "Comparar resultados electorales"],
  ["/municipal", "Análisis de concejos municipales"],
] as const;

it("renders the dashboard as the grouped workflow entry point", () => {
  const markup = renderToStaticMarkup(<DashboardPage /> as ReactElement);

  expect(markup).toContain('<main class="page-shell">');
  expect(markup).not.toContain('id="main-content"');
  expect(markup).toContain("<h1>Panel de Votus</h1>");
  expect(markup).toContain("evidencia oficial y pública");
  expect(markup).toContain('aria-labelledby="evidence-workflows"');
  expect(markup).toContain('aria-labelledby="prepared-workflows"');

  for (const [href, label] of WORKFLOW_LINKS) {
    expect(markup).toContain(`href="${href}"`);
    expect(markup).toContain(label);
  }
});

it("presents review as a read-only consultation workflow", () => {
  const markup = renderToStaticMarkup(<DashboardPage /> as ReactElement);

  expect(markup).toContain("Pendientes para consulta");
  expect(markup).toContain("<h3>Consultar elementos de revisión</h3>");
  expect(markup).toContain(
    "Inspeccione los elementos pendientes y la evidencia registrada",
  );
  expect(markup).not.toContain("Resolver elementos de revisión");
});

it("sets an honest expectation for context-dependent workflows", () => {
  const markup = renderToStaticMarkup(<DashboardPage /> as ReactElement);

  expect(markup).toContain("Se requiere un contexto preparado");
  expect(markup).toContain("enlace directo");
  expect(markup).toContain("no inicia un flujo de selección de datos");
});
