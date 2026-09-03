import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import OperationalBriefingPage from "./(authenticated)/page";

it("renders the root operational briefing with evidence and review routes", () => {
  const markup = renderToStaticMarkup(
    <OperationalBriefingPage /> as ReactElement,
  );

  expect(markup).toContain("<h1>Panel de Votus</h1>");
  expect(markup).toContain("Evidencia y revisión");
  expect(markup).toContain('href="/review"');
  expect(markup).toContain('href="/drilldown"');
});

it("does not retain a competing dashboard entry route beside the root briefing", () => {
  const markup = renderToStaticMarkup(
    <OperationalBriefingPage /> as ReactElement,
  );

  expect(markup).not.toContain('href="/dashboard"');
});
