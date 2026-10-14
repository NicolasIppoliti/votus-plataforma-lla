import { describe, expect, it } from "vitest";
import { simulationDisplayLabel } from "./display-label";

describe("simulationDisplayLabel", () => {
  it.each([
    ["pba_municipal", "Concejales (concejo municipal)"],
    ["pba_provincial", "Legisladores provinciales (PBA)"],
    ["national", "Diputados nacionales"],
    ["seccion", "sección"], ["circuito", "circuito"], ["mesa", "mesa"],
    ["establecimiento", "establecimiento"], ["distrito", "distrito"],
    ["unknown", "no informado (unknown)"],
  ])("labels %s without silently guessing", (value, expected) => {
    expect(simulationDisplayLabel(value)).toBe(expected);
  });
});
