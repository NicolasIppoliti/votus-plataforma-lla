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
  distrito: ["level"],
  seccion: ["level", "seccionCode"],
  circuito: ["level", "seccionCode", "circuitoCode"],
  establecimiento: ["level", "seccionCode", "circuitoCode", "establecimientoCode"],
  mesa: ["level", "seccionCode", "circuitoCode", "establecimientoCode", "mesaCode"],
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

export function scopeDependentNames(
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
  const currentLevel = controls.level?.value ?? "";
  const descendants = scopeDependentNames(kind, changedName);
  for (const name of descendants) if (name !== "level" && controls[name]) controls[name].value = "";
  if (kind === SCOPE_FORM_KIND.DRILLDOWN && controls.level &&
    descendants.some((name) => LEVEL_REQUIRED_CONTROLS[currentLevel]?.includes(name))) controls.level.value = "";
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

export type ScopeOptionDescriptor = { value: string; label: string; nameStatus?: string };
export type ScopeOptionPatch = { name: ScopeControlName; options: ScopeOptionDescriptor[] };
export type ScopeMembership = Partial<Record<ScopeControlName, readonly string[]>>;

export function scopeEndpoint(kind: ScopeFormKind): string {
  return kind === SCOPE_FORM_KIND.DRILLDOWN ? "/api/drilldown/scope-options" : "/api/fiscalizacion/scope-options"; }

function canonicalEntries(values: ScopeControlValues): [ScopeControlName, string][] {
  return SCOPE_CONTROL_NAMES.flatMap((name) => {
    const value = values[name] ?? "";
    return value === "" ? [] : [[name, value]];
  }); }

export function serializeScopeDraft(values: ScopeControlValues): string {
  const draft: Record<string, string | number> = {};
  for (const [name, value] of canonicalEntries(values)) draft[name] = name === "mesaCode" && /^\d+$/.test(value) ? Number(value) : value;
  return JSON.stringify(draft);
}

export function canonicalScopeSearchParams(values: ScopeControlValues): URLSearchParams {
  return new URLSearchParams(canonicalEntries(values)); }

export function hasCompleteScopeParents(values: ScopeControlValues): boolean {
  const chain = SCOPE_CONTROL_NAMES.slice(0, 7);
  return chain.every((name, index) => !values[name] || chain.slice(0, index).every((parent) => Boolean(values[parent])));
}

export function hasValidScopeLevel(values: ScopeControlValues): boolean {
  const requiredByLevel: Record<string, ScopeControlName> = {
    distrito: "distritoCode", seccion: "seccionCode", circuito: "circuitoCode",
    establecimiento: "establecimientoCode", mesa: "mesaCode",
  };
  const required = values.level ? requiredByLevel[values.level] : undefined;
  return !values.level || Boolean(required && values[required]);
}

export function isScopeSelectionMember(values: ScopeControlValues, membership: ScopeMembership): boolean {
  return SCOPE_CONTROL_NAMES.every((name) => !values[name] || Boolean(membership[name]?.includes(values[name])));
}

export function acceptScopeResponse(
  requestGeneration: number, requestDraft: string, aborted: boolean,
  currentGeneration: number, currentDraft: string,
): boolean {
  return !aborted && requestGeneration === currentGeneration && requestDraft === currentDraft;
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : null; }

function simpleOptions(value: unknown, valueKey: string, labelKey: string): ScopeOptionDescriptor[] | null {
  if (!Array.isArray(value)) return null;
  const result: ScopeOptionDescriptor[] = [];
  for (const item of value) {
    const record = objectValue(item);
    if (!record || (typeof record[valueKey] !== "string" && typeof record[valueKey] !== "number") ||
      (typeof record[labelKey] !== "string" && typeof record[labelKey] !== "number")) return null;
    result.push({ value: String(record[valueKey]), label: String(record[labelKey]) });
  }
  return result;
}

function namedOptions(value: unknown): ScopeOptionDescriptor[] | null {
  if (!Array.isArray(value)) return null;
  const result: ScopeOptionDescriptor[] = [];
  for (const item of value) {
    const record = objectValue(item), status = record?.nameStatus;
    if (!record || typeof record.code !== "string" || !["present", "missing", "conflict"].includes(String(status)) ||
      (record.name !== null && typeof record.name !== "string") || !Number.isInteger(record.nameVariantCount) ||
      (status === "present" ? !record.name || record.nameVariantCount !== 1 : record.name !== null) ||
      (status === "missing" ? record.nameVariantCount !== 0 : status === "conflict" && Number(record.nameVariantCount) < 2)) return null;
    const label = status === "present" ? `${record.code} — ${record.name}` : status === "missing"
      ? `${record.code} — nombre no disponible` : `${record.code} — nombres contradictorios (${record.nameVariantCount} variantes)`;
    result.push({ value: record.code, label, nameStatus: String(status) });
  }
  return result;
}

export function mapScopeOptionDescriptors(value: unknown, kind: ScopeFormKind): ScopeOptionPatch[] | null {
  const response = objectValue(value), facets = objectValue(response?.facets);
  const expectedCapability = kind === SCOPE_FORM_KIND.DRILLDOWN ? "official-exploration" : "coverage-scope-options";
  if (!response || response.meaning !== "scope-options-only" || response.capability !== expectedCapability || !facets) return null;
  const elections = simpleOptions(facets.elections, "id", "label"), categories = simpleOptions(facets.categories, "id", "name");
  const distritos = namedOptions(facets.distritos), secciones = namedOptions(facets.secciones);
  const circuitos = namedOptions(facets.circuitos), establecimientos = namedOptions(facets.establecimientos);
  const mesas = simpleOptions(facets.mesas, "code", "code");
  const levels = Array.isArray(facets.availableLevels) && facets.availableLevels.every((item) =>
    typeof item === "string" && Object.hasOwn(LEVEL_REQUIRED_CONTROLS, item))
    ? facets.availableLevels.map((level) => ({ value: level, label: level })) : null;
  if ([elections, categories, distritos, secciones, circuitos, establecimientos, mesas, levels].some((options) => options === null)) return null;
  return [
    ["electionId", elections], ["categoryId", categories], ["distritoCode", distritos], ["seccionCode", secciones],
    ["circuitoCode", circuitos], ["establecimientoCode", establecimientos], ["mesaCode", mesas], ["level", levels],
  ].map(([name, options]) => ({ name, options })) as ScopeOptionPatch[];
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

export function enhanceScopeForm(
  form: HTMLFormElement,
  kind: ScopeFormKind,
  onLocalChange?: (name: ScopeControlName) => void,
): () => void {
  const controls: ScopeControls = {};
  for (const name of SCOPE_CONTROL_NAMES) {
    const element = form.elements.namedItem(name);
    if (element instanceof HTMLSelectElement) controls[name] = element;
  }
  synchronizeScopeControls(controls, kind);

  const handleChange = (event: Event): void => {
    const target = event.target;
    if (!(target instanceof HTMLSelectElement) || !isScopeControlName(target.name)) return;
    synchronizeScopeControls(controls, kind, target.name);
    onLocalChange?.(target.name);
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
