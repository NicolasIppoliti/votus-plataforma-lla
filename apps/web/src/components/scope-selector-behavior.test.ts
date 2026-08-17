import { describe, expect, it } from "vitest";
import {
  SCOPE_CONTROL_NAMES,
  SCOPE_FORM_KIND,
  omitBlankSingletonControls,
  synchronizeScopeControls,
  type ScopeControlName,
  type ScopeControls,
} from "./scope-selector-behavior";

function controlSet(values: Partial<Record<ScopeControlName, string>> = {}): ScopeControls {
  return Object.fromEntries(
    SCOPE_CONTROL_NAMES.map((name) => [name, {
      value: values[name] ?? "",
      disabled: false,
      required: false,
    }]),
  );
}

function control(controls: ScopeControls, name: ScopeControlName) {
  const result = controls[name];
  if (!result) throw new Error(`control ${name} is missing`);
  return result;
}

describe("scope selector behavior", () => {
  it.each([
    ["electionId", [
      "categoryId", "distritoCode", "seccionCode", "circuitoCode",
      "establecimientoCode", "mesaCode", "level",
    ]],
    ["categoryId", [
      "distritoCode", "seccionCode", "circuitoCode", "establecimientoCode", "mesaCode", "level",
    ]],
    ["distritoCode", [
      "seccionCode", "circuitoCode", "establecimientoCode", "mesaCode", "level",
    ]],
    ["seccionCode", ["circuitoCode", "establecimientoCode", "mesaCode"]],
    ["circuitoCode", ["establecimientoCode", "mesaCode"]],
    ["establecimientoCode", ["mesaCode"]],
  ] as const)("clears drilldown descendants when %s changes", (changedName, descendants) => {
    const controls = controlSet({
      electionId: "e-2025",
      categoryId: "c-diputados",
      distritoCode: "02",
      seccionCode: "027",
      circuitoCode: "00001",
      establecimientoCode: "E1",
      mesaCode: "7",
      level: "mesa",
    });

    synchronizeScopeControls(controls, SCOPE_FORM_KIND.DRILLDOWN, changedName);

    for (const name of descendants) expect(control(controls, name).value).toBe("");
    expect(control(controls, changedName).value).not.toBe("");
  });

  it("disables drilldown descendants from the first blank dependency", () => {
    const controls = controlSet({
      electionId: "e-2025",
      categoryId: "c-diputados",
      distritoCode: "02",
      level: "mesa",
    });

    synchronizeScopeControls(controls, SCOPE_FORM_KIND.DRILLDOWN);

    expect(control(controls, "categoryId").disabled).toBe(false);
    expect(control(controls, "distritoCode").disabled).toBe(false);
    expect(control(controls, "seccionCode").disabled).toBe(false);
    expect(control(controls, "level").disabled).toBe(false);
    for (const name of ["circuitoCode", "establecimientoCode", "mesaCode"] as const) {
      expect(control(controls, name).disabled).toBe(true);
    }
  });

  it.each([
    ["distrito", []],
    ["seccion", ["seccionCode"]],
    ["circuito", ["seccionCode", "circuitoCode"]],
    ["establecimiento", ["seccionCode", "circuitoCode", "establecimientoCode"]],
    ["mesa", ["seccionCode", "circuitoCode", "establecimientoCode", "mesaCode"]],
  ] as const)("requires exactly the drilldown chain for %s", (level, requiredNames) => {
    const controls = controlSet({
      electionId: "e-2025",
      categoryId: "c-diputados",
      distritoCode: "02",
      seccionCode: "027",
      circuitoCode: "00001",
      establecimientoCode: "E1",
      mesaCode: "7",
      level,
    });

    synchronizeScopeControls(controls, SCOPE_FORM_KIND.DRILLDOWN, "level");

    for (const name of ["electionId", "categoryId", "distritoCode", "level"] as const) {
      expect(control(controls, name).required).toBe(true);
    }
    for (const name of [
      "seccionCode", "circuitoCode", "establecimientoCode", "mesaCode",
    ] as const) {
      expect(control(controls, name).required).toBe(new Set<string>(requiredNames).has(name));
    }
  });

  it("clears and disables coverage descendants while keeping section required", () => {
    const controls = controlSet({
      electionId: "e-2025",
      categoryId: "c-diputados",
      distritoCode: "02",
      seccionCode: "027",
    });
    control(controls, "categoryId").value = "c-senadores";

    synchronizeScopeControls(controls, SCOPE_FORM_KIND.COVERAGE, "categoryId");

    expect(control(controls, "distritoCode").value).toBe("");
    expect(control(controls, "seccionCode").value).toBe("");
    expect(control(controls, "distritoCode").disabled).toBe(false);
    expect(control(controls, "seccionCode").disabled).toBe(true);
    for (const name of ["electionId", "categoryId", "distritoCode", "seccionCode"] as const) {
      expect(control(controls, name).required).toBe(true);
    }
  });

  it("omits blank singleton controls without rewriting repeated or nonblank entries", () => {
    const data = new FormData();
    data.append("electionId", "e-2025");
    data.append("categoryId", "");
    data.append("external", "");
    data.append("external", "kept");

    omitBlankSingletonControls(data);

    expect([...data.entries()]).toEqual([
      ["electionId", "e-2025"],
      ["external", ""],
      ["external", "kept"],
    ]);
  });
});
