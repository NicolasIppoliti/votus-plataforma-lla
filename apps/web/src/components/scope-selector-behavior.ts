export const SCOPE_FORM_KIND = {
  DRILLDOWN: "drilldown",
  COVERAGE: "coverage",
} as const;
export type ScopeFormKind = (typeof SCOPE_FORM_KIND)[keyof typeof SCOPE_FORM_KIND];

export const SCOPE_CONTROL_NAMES = [
  "electionId",
  "categoryId",
  "distritoCode",
  "seccionCode",
  "circuitoCode",
  "establecimientoCode",
  "mesaCode",
  "level",
] as const;
export type ScopeControlName = (typeof SCOPE_CONTROL_NAMES)[number];

export interface ScopeControl {
  value: string;
  disabled: boolean;
  required: boolean;
}

export type ScopeControls = Partial<Record<ScopeControlName, ScopeControl>>;

export interface ScopeControlFlags {
  disabled: boolean;
  required: boolean;
}

export type ScopeControlStates = Record<ScopeControlName, ScopeControlFlags>;
export type ScopeControlValues = Partial<Record<ScopeControlName, string>>;

const DRILLDOWN_DESCENDANTS: Partial<Record<ScopeControlName, readonly ScopeControlName[]>> = {
  electionId: [
    "categoryId",
    "distritoCode",
    "seccionCode",
    "circuitoCode",
    "establecimientoCode",
    "mesaCode",
    "level",
  ],
  categoryId: [
    "distritoCode",
    "seccionCode",
    "circuitoCode",
    "establecimientoCode",
    "mesaCode",
    "level",
  ],
  distritoCode: [
    "seccionCode",
    "circuitoCode",
    "establecimientoCode",
    "mesaCode",
    "level",
  ],
  seccionCode: ["circuitoCode", "establecimientoCode", "mesaCode"],
  circuitoCode: ["establecimientoCode", "mesaCode"],
  establecimientoCode: ["mesaCode"],
};

const COVERAGE_DESCENDANTS: Partial<Record<ScopeControlName, readonly ScopeControlName[]>> = {
  electionId: ["categoryId", "distritoCode", "seccionCode"],
  categoryId: ["distritoCode", "seccionCode"],
  distritoCode: ["seccionCode"],
};

const LEVEL_REQUIRED_CONTROLS: Record<string, readonly ScopeControlName[]> = {
  distrito: [],
  seccion: ["seccionCode"],
  circuito: ["seccionCode", "circuitoCode"],
  establecimiento: ["seccionCode", "circuitoCode", "establecimientoCode"],
  mesa: ["seccionCode", "circuitoCode", "establecimientoCode", "mesaCode"],
};

function hasValue(controls: ScopeControls, name: ScopeControlName): boolean {
  return (controls[name]?.value ?? "") !== "";
}

function setDisabled(controls: ScopeControls, name: ScopeControlName, disabled: boolean): void {
  const current = controls[name];
  if (current) current.disabled = disabled;
}

function setRequired(controls: ScopeControls, name: ScopeControlName, required: boolean): void {
  const current = controls[name];
  if (current) current.required = required;
}

function scopeDescendants(
  kind: ScopeFormKind,
  changedName: ScopeControlName,
): readonly ScopeControlName[] {
  return (kind === SCOPE_FORM_KIND.DRILLDOWN
    ? DRILLDOWN_DESCENDANTS[changedName]
    : COVERAGE_DESCENDANTS[changedName]) ?? [];
}

function clearDescendants(
  controls: ScopeControls,
  kind: ScopeFormKind,
  changedName: ScopeControlName,
): void {
  for (const name of scopeDescendants(kind, changedName)) {
    const current = controls[name];
    if (current) current.value = "";
  }
}

export function synchronizeScopeControls(
  controls: ScopeControls,
  kind: ScopeFormKind,
  changedName?: ScopeControlName,
): void {
  if (changedName) clearDescendants(controls, kind, changedName);

  const electionReady = hasValue(controls, "electionId");
  const categoryReady = electionReady && hasValue(controls, "categoryId");
  const districtReady = categoryReady && hasValue(controls, "distritoCode");
  const sectionReady = districtReady && hasValue(controls, "seccionCode");
  const circuitReady = sectionReady && hasValue(controls, "circuitoCode");
  const establishmentReady = circuitReady && hasValue(controls, "establecimientoCode");

  setDisabled(controls, "electionId", false);
  setDisabled(controls, "categoryId", !electionReady);
  setDisabled(controls, "distritoCode", !categoryReady);
  setDisabled(controls, "seccionCode", !districtReady);
  setDisabled(controls, "circuitoCode", !sectionReady);
  setDisabled(controls, "establecimientoCode", !circuitReady);
  setDisabled(controls, "mesaCode", !establishmentReady);
  setDisabled(controls, "level", !districtReady);

  for (const name of SCOPE_CONTROL_NAMES) setRequired(controls, name, false);
  for (const name of ["electionId", "categoryId", "distritoCode"] as const) {
    setRequired(controls, name, true);
  }

  if (kind === SCOPE_FORM_KIND.COVERAGE) {
    setRequired(controls, "seccionCode", true);
    return;
  }

  setRequired(controls, "level", true);
  const level = controls.level?.value ?? "";
  for (const name of LEVEL_REQUIRED_CONTROLS[level] ?? []) {
    setRequired(controls, name, true);
  }
}

export function scopeControlStates(
  kind: ScopeFormKind,
  values: ScopeControlValues,
): ScopeControlStates {
  const controls = Object.fromEntries(
    SCOPE_CONTROL_NAMES.map((name) => [name, {
      value: values[name] ?? "",
      disabled: false,
      required: false,
    }]),
  ) as Record<ScopeControlName, ScopeControl>;
  synchronizeScopeControls(controls, kind);
  return Object.fromEntries(
    SCOPE_CONTROL_NAMES.map((name) => [name, {
      disabled: controls[name].disabled,
      required: controls[name].required,
    }]),
  ) as ScopeControlStates;
}

export function omitBlankSingletonControls(data: FormData): void {
  const names = new Set<string>();
  data.forEach((_value, name) => names.add(name));
  for (const name of names) {
    const values = data.getAll(name);
    if (values.length === 1 && values[0] === "") data.delete(name);
  }
}

function isScopeControlName(value: string): value is ScopeControlName {
  return SCOPE_CONTROL_NAMES.some((name) => name === value);
}

export function enhanceScopeForm(form: HTMLFormElement, kind: ScopeFormKind): () => void {
  const controls: ScopeControls = {};
  for (const name of SCOPE_CONTROL_NAMES) {
    const element = form.elements.namedItem(name);
    if (element instanceof HTMLSelectElement) controls[name] = element;
  }
  const refreshSubmitter = form.querySelector<HTMLButtonElement>(
    'button[type="submit"][formnovalidate]',
  );
  synchronizeScopeControls(controls, kind);

  const handleChange = (event: Event): void => {
    const target = event.target;
    if (!(target instanceof HTMLSelectElement) || !isScopeControlName(target.name)) return;
    synchronizeScopeControls(controls, kind, target.name);
    if (refreshSubmitter && scopeDescendants(kind, target.name).length > 0) {
      form.requestSubmit(refreshSubmitter);
    }
  };
  const handleFormData = (event: Event): void => {
    omitBlankSingletonControls((event as FormDataEvent).formData);
  };

  form.addEventListener("change", handleChange);
  form.addEventListener("formdata", handleFormData);
  return () => {
    form.removeEventListener("change", handleChange);
    form.removeEventListener("formdata", handleFormData);
  };
}
