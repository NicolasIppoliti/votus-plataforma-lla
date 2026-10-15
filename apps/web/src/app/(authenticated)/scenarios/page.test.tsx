import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const loader = vi.hoisted(() => ({ override: null as null | import("@/lib/scenarios/scenario-artifact").ScenarioArtifactResult }));

vi.mock("@/lib/scenarios/scenario-artifact", async () => {
  const actual = await vi.importActual<typeof import("@/lib/scenarios/scenario-artifact")>(
    "@/lib/scenarios/scenario-artifact",
  );
  return {
    ...actual,
    loadScenarioArtifact: async () => loader.override ?? actual.loadScenarioArtifact(),
  };
});

import ScenariosPage from "./page";

async function render() {
  return renderToStaticMarkup(await ScenariosPage());
}

describe("/scenarios", () => {
  it("renders both scenarios from the verified artifact, persistence first", async () => {
    loader.override = null;
    const html = await render();
    expect(html).toContain('aria-label="Recorrido de la página"');
    expect(html).toContain('Simulación / Escenarios');
    expect(html).toContain('aria-label="Contexto del escenario hipotético"');
    expect(html).toContain('<caption>Listas del escenario Persistencia</caption>');
    expect(html).toContain('Escenarios hipotéticos para la renovación municipal.');
    expect(html).toContain("Escenarios Rosales 2027");
    expect(html).toContain("supuestos sin validar");
    const persistence = html.indexOf("Persistencia");
    const ei = html.indexOf("Transferencias estimadas por inferencia ecológica");
    expect(persistence).toBeGreaterThan(-1);
    expect(ei).toBeGreaterThan(persistence);
    expect(html).toContain("ALIANZA LA LIBERTAD AVANZA");
    expect(html).toContain("45,06");
    expect(html).toContain("21,074");
    expect(html).toContain("17,245");
    expect(html).toContain("22,557");
    expect(html).toContain("24,079");
    expect(html.match(/<table/g)).toHaveLength(2);
    expect(html.match(/class="scenario-seat-bar"/g)).toHaveLength(2);
    expect(html.match(/Diferencia vs\. Persistencia/g)).toHaveLength(2);
    expect(html).toContain('aria-label="Bancas de Persistencia:');
    expect(html).toMatch(/ALIANZA LA LIBERTAD AVANZA<\/th><td>[^<]+<\/td><td>4<\/td><td>−1<\/td>/);
    expect(html).toContain('<td>+1</td>');
    expect(html).toContain('<td>0</td>');
  });

  it("does not invent seats for ties or silently match unknown list IDs", async () => {
    const actual = await vi.importActual<typeof import("@/lib/scenarios/scenario-artifact")>("@/lib/scenarios/scenario-artifact");
    const result = await actual.loadScenarioArtifact();
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Verified fixture unavailable");
    const artifact = structuredClone(result.artifact);
    const alternative = artifact.scenarios.find((scenario) => !scenario.default)!;
    alternative.lists[0]!.list_id = "unmapped-list";
    alternative.lists[0]!.label = "Lista sin correspondencia";
    loader.override = { ok: true, artifact };
    let html = await render();
    expect(html).toMatch(/Lista sin correspondencia<\/th><td>[^<]+<\/td><td>\d+<\/td><td>Sin correspondencia<\/td>/);
    alternative.seat_status = "ambiguous_tie";
    html = await render();
    expect(html.match(/class="scenario-seat-bar"/g)).toHaveLength(1);
    expect(html).toContain("Empate ambiguo");
    expect(html).toContain("<td>—</td><td>No disponible</td>");
    loader.override = null;
  });

  it.each([
    ["missing", "no está disponible"],
    ["hash_mismatch", "no coincide con la versión verificada"],
    ["validated_claim", "fuera del alcance"],
    ["invalid_artifact", "no tiene el formato verificado"],
    ["unvalidated_label_missing", "no declara que sus supuestos no están validados"],
    ["seat_total_mismatch", "no suman las 9 bancas"],
    ["default_mismatch", "no declara la persistencia"],
  ] as const)("shows an alert and no numbers when the artifact is refused (%s)", async (reason, message) => {
    loader.override = { ok: false, reason };
    const html = await render();
    expect(html).toContain('role="alert"');
    expect(html).toContain(message);
    expect(html).not.toContain("<table");
    expect(html).not.toContain("ALIANZA");
    expect(html).not.toContain("supuestos sin validar</strong>");
  });
});
