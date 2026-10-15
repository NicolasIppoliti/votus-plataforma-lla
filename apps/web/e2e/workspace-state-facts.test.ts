import { expect, it } from "vitest";
import { sanitizeWorkspaceStateFacts } from "./workspace-state-facts";

it("keeps only known UI copy and a route pathname, never arbitrary page text or query values", () => {
  const facts = sanitizeWorkspaceStateFacts({
    pathname: "/review?returnTo=private-value",
    headings: ["Cola de revisión", "Seleccioná una organización", "Synthetic Person"],
    alerts: ["No tenés autorización para acceder a esta organización.", "synthetic@example.invalid", "synthetic-password"],
    statuses: ["Organización activa.", "Tu acceso a la organización activa cambió. Seleccioná una organización autorizada nuevamente."],
  });
  expect(facts).toEqual({
    pathname: "/review",
    headings: ["Cola de revisión", "Seleccioná una organización", "[unrecognized UI text]"],
    alerts: ["No tenés autorización para acceder a esta organización.", "[unrecognized UI text]", "[unrecognized UI text]"],
    statuses: ["Organización activa.", "Tu acceso a la organización activa cambió. Seleccioná una organización autorizada nuevamente."],
  });
  expect(JSON.stringify(facts)).not.toMatch(/private-value|Synthetic Person|synthetic@|synthetic-password/);
});

it("bounds the capture and redacts unexpected paths", () => {
  const facts = sanitizeWorkspaceStateFacts({ pathname: "/private-value", headings: Array(100).fill("Cola de revisión"), alerts: [], statuses: [] });
  expect(facts.pathname).toBe("[unrecognized route]");
  expect(facts.headings).toHaveLength(20);
});
