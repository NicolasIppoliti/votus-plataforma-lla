import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SCOPE_CONTROL_NAMES,
  SCOPE_FORM_KIND,
  acceptScopeResponse,
  canonicalScopeSearchParams,
  enhanceScopeForm,
  hasCompleteScopeParents,
  hasValidScopeLevel,
  isScopeSelectionMember,
  mapScopeOptionDescriptors,
  omitBlankSingletonControls,
  scopeEndpoint,
  serializeScopeDraft,
  synchronizeScopeControls,
  type ScopeControlName,
  type ScopeControls,
  type ScopeFormKind,
} from "./scope-selector-behavior";

class FakeSelect {
  disabled = false;
  required = false;

  constructor(
    readonly name: ScopeControlName,
    public value: string,
  ) {}
}

function enhancedFormHarness(kind: ScopeFormKind) {
  vi.stubGlobal("HTMLSelectElement", FakeSelect);
  const selectedValues: Record<ScopeControlName, string> = {
    electionId: "e-2025",
    categoryId: "c-diputados",
    distritoCode: "02",
    seccionCode: "027",
    circuitoCode: "00001",
    establecimientoCode: "E1",
    mesaCode: "7",
    level: "mesa",
  };
  const controls = Object.fromEntries(
    SCOPE_CONTROL_NAMES.map((name) => [name, new FakeSelect(name, selectedValues[name])]),
  ) as Record<ScopeControlName, FakeSelect>;
  const listeners = new Map<string, Set<EventListener>>();
  const refreshSubmitter = { formNoValidate: true };
  const requestSubmit = vi.fn();
  const onLocalChange = vi.fn();
  const form = {
    elements: { namedItem: (name: string) => controls[name as ScopeControlName] ?? null },
    querySelector: (selector: string) =>
      selector === 'button[type="submit"][formnovalidate]' ? refreshSubmitter : null,
    requestSubmit,
    addEventListener: (name: string, listener: EventListener) => {
      const registered = listeners.get(name) ?? new Set<EventListener>();
      registered.add(listener);
      listeners.set(name, registered);
    },
    removeEventListener: (name: string, listener: EventListener) => {
      listeners.get(name)?.delete(listener);
    },
  } as unknown as HTMLFormElement;
  const cleanup = enhanceScopeForm(form, kind, onLocalChange);

  return {
    cleanup,
    onLocalChange,
    refreshSubmitter,
    requestSubmit,
    dispatchChange(name: ScopeControlName): void {
      const event = { target: controls[name] } as unknown as Event;
      for (const listener of listeners.get("change") ?? []) listener(event);
    },
  };
}

afterEach(() => vi.unstubAllGlobals());

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

  it.each([
    ["electionId", "distrito", ""], ["categoryId", "distrito", ""], ["distritoCode", "distrito", ""], ["seccionCode", "seccion", "seccion"],
    ["seccionCode", "circuito", ""], ["seccionCode", "establecimiento", ""], ["seccionCode", "mesa", ""], ["circuitoCode", "circuito", "circuito"],
    ["circuitoCode", "establecimiento", ""], ["circuitoCode", "mesa", ""], ["establecimientoCode", "establecimiento", "establecimiento"], ["establecimientoCode", "mesa", ""],
  ] as const)("keeps only a compatible level after %s changes from %s", (changedName, level, expected) => {
    const controls = controlSet({ electionId: "e", categoryId: "c", distritoCode: "02", seccionCode: "027", circuitoCode: "1", establecimientoCode: "E1", mesaCode: "7", level });
    synchronizeScopeControls(controls, SCOPE_FORM_KIND.DRILLDOWN, changedName); const values = Object.fromEntries(SCOPE_CONTROL_NAMES.map((name) => [name, control(controls, name).value]));
    expect([control(controls, "level").value, hasCompleteScopeParents(values), hasValidScopeLevel(values)]).toEqual([expected, true, true]);
    expect(() => JSON.parse(serializeScopeDraft(values))).not.toThrow();
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

  it.each([
    [SCOPE_FORM_KIND.DRILLDOWN, "categoryId"],
    [SCOPE_FORM_KIND.DRILLDOWN, "level"],
    [SCOPE_FORM_KIND.COVERAGE, "distritoCode"],
  ] as const)("keeps the URL mechanics local when %s control %s changes", (kind, changedName) => {
    const harness = enhancedFormHarness(kind);

    harness.dispatchChange(changedName);

    expect(harness.requestSubmit).not.toHaveBeenCalled();
    expect(harness.onLocalChange).toHaveBeenCalledWith(changedName);
    harness.cleanup();
  });

  it("serializes canonical drafts and URLs in fixed order while omitting blanks", () => {
    const values = { level: "seccion", categoryId: "cat", electionId: "election", mesaCode: "", distritoCode: "02" };
    expect(serializeScopeDraft(values)).toBe('{"electionId":"election","categoryId":"cat","distritoCode":"02","level":"seccion"}');
    expect(canonicalScopeSearchParams(values).toString()).toBe("electionId=election&categoryId=cat&distritoCode=02&level=seccion");
  });

  it("guards parent chains, levels, and client option membership", () => {
    expect(hasCompleteScopeParents({ electionId: "e", categoryId: "c", seccionCode: "027" })).toBe(false);
    expect(hasCompleteScopeParents({ electionId: "e", categoryId: "c", distritoCode: "02" })).toBe(true);
    expect(hasValidScopeLevel({ distritoCode: "02", level: "mesa" })).toBe(false);
    expect(hasValidScopeLevel({ distritoCode: "02", seccionCode: "027", level: "seccion" })).toBe(true);
    expect(isScopeSelectionMember({ electionId: "other" }, { electionId: ["e"] })).toBe(false);
    expect(isScopeSelectionMember({ electionId: "e", level: "seccion" }, { electionId: ["e"], level: ["seccion"] })).toBe(true);
  });

  it("rejects stale request generations, changed drafts, and aborted requests", () => {
    expect(acceptScopeResponse(2, "draft", false, 2, "draft")).toBe(true);
    expect(acceptScopeResponse(1, "draft", false, 2, "draft")).toBe(false);
    expect(acceptScopeResponse(2, "old", false, 2, "new")).toBe(false);
    expect(acceptScopeResponse(2, "draft", true, 2, "draft")).toBe(false);
  });

  it.each([
    [SCOPE_FORM_KIND.DRILLDOWN, "/api/drilldown/scope-options"],
    [SCOPE_FORM_KIND.COVERAGE, "/api/fiscalizacion/scope-options"],
  ] as const)("uses the fixed scope-options endpoint for %s", (kind, endpoint) => {
    expect(scopeEndpoint(kind)).toBe(endpoint);
  });

  it("maps safe option descriptors without losing server order or name status", () => {
    const patches = mapScopeOptionDescriptors({
      capability: "official-exploration", meaning: "scope-options-only", selection: {},
      facets: {
        elections: [{ id: "e", label: "Election", year: 2025, round: "general" }],
        categories: [{ id: "c", name: "Category" }],
        distritos: [
          { code: "02", name: null, nameStatus: "missing", nameVariantCount: 0 },
          { code: "01", name: "Capital", nameStatus: "present", nameVariantCount: 1 },
        ], secciones: [], circuitos: [], establecimientos: [], mesas: [{ code: 7 }],
        availableLevels: ["distrito"],
      },
    }, SCOPE_FORM_KIND.DRILLDOWN);
    expect(patches?.find(({ name }) => name === "distritoCode")?.options).toEqual([
      { value: "02", label: "02 — nombre no disponible", nameStatus: "missing" },
      { value: "01", label: "01 — Capital", nameStatus: "present" },
    ]);
    expect(mapScopeOptionDescriptors({ error: "provider detail" }, SCOPE_FORM_KIND.DRILLDOWN)).toBeNull();
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
