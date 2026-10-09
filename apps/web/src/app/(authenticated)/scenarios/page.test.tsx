import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const loader = vi.hoisted(() => ({ override: null as null | { ok: false; reason: string } }));

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
  });

  it.each([
    ["missing", "no está disponible"],
    ["hash_mismatch", "no coincide con la versión verificada"],
    ["validated_claim", "fuera del alcance"],
    ["invalid_artifact", "no tiene el formato verificado"],
    ["unvalidated_label_missing", "no declara que sus supuestos no están validados"],
    ["seat_total_mismatch", "no suman las 9 bancas"],
    ["default_mismatch", "no declara la persistencia"],
  ])("shows an alert and no numbers when the artifact is refused (%s)", async (reason, message) => {
    loader.override = { ok: false, reason };
    const html = await render();
    expect(html).toContain('role="alert"');
    expect(html).toContain(message);
    expect(html).not.toContain("<table");
    expect(html).not.toContain("ALIANZA");
    expect(html).not.toContain("supuestos sin validar</strong>");
  });
});
