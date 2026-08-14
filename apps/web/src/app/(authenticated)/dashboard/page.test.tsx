import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import DashboardPage from "./page";

const WORKFLOW_LINKS = [
  ["/drilldown", "Explore results"],
  ["/fiscalizacion", "Fiscalización (unofficial)"],
  ["/review", "Review"],
  ["/simulate", "Seat simulation"],
  ["/compare", "Compare election outcomes"],
  ["/municipal", "Municipal council analysis"],
] as const;

it("renders the dashboard as the grouped workflow entry point", () => {
  const markup = renderToStaticMarkup(<DashboardPage /> as ReactElement);

  expect(markup).toContain('<main class="page-shell">');
  expect(markup).not.toContain('id="main-content"');
  expect(markup).toContain("<h1>Votus dashboard</h1>");
  expect(markup).toContain("official and public evidence");
  expect(markup).toContain('aria-labelledby="evidence-workflows"');
  expect(markup).toContain('aria-labelledby="prepared-workflows"');

  for (const [href, label] of WORKFLOW_LINKS) {
    expect(markup).toContain(`href="${href}"`);
    expect(markup).toContain(label);
  }
});

it("sets an honest expectation for context-dependent workflows", () => {
  const markup = renderToStaticMarkup(<DashboardPage /> as ReactElement);

  expect(markup).toContain("Prepared context required");
  expect(markup).toContain("deep-linked context");
  expect(markup).toContain("does not start a data-selection workflow");
});
