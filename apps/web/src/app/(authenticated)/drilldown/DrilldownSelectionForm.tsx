"use client";
import { ResponsiveSelect } from "@/components/ResponsiveSelect";

import { createContext, useContext, useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { SlidersHorizontal } from "lucide-react";
import styles from "./drilldown.module.css";
import {
  SCOPE_CONTROL_NAMES, SCOPE_FORM_KIND, canonicalScopeSearchParams,
  scopeControlStates, scopeDependentNames, synchronizeScopeControls,
  type ScopeControl, type ScopeControlName, type ScopeControlValues,
} from "@/components/scope-selector-behavior";

interface SelectionOption {
  value: string;
  label: string;
  shortLabel?: string;
}

export interface SelectionField {
  name: ScopeControlName;
  id: string;
  label: string;
  placeholder: string;
  options: SelectionOption[];
}

interface Props {
  selected: ScopeControlValues;
  fields: SelectionField[];
  notes: ReactNode;
  children: ReactNode;
  header?: ReactNode;
}

interface SelectionState {
  servedKey: string;
  requestedKey: string | null;
  draft: ScopeControlValues;
}

const SelectionNavigation = createContext<{ navigate: (values: ScopeControlValues) => void }>({ navigate: () => {} });
export const useSelectionNavigation = () => useContext(SelectionNavigation);

const selectionKey = (values: ScopeControlValues) => canonicalScopeSearchParams(values).toString();

export function DrilldownSelectionForm({ selected, fields, notes, children, header }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const servedKey = selectionKey(selected);
  const [state, setState] = useState<SelectionState>({ servedKey, requestedKey: null, draft: selected });
  const latestDraft = useRef(selected);
  const focusNavigator = useRef(false);
  useEffect(() => {
    if (focusNavigator.current && !isPending && selectionKey(state.draft) === servedKey) {
      const title = document.getElementById("navigator-title");
      title?.focus();
      title?.scrollIntoView({ block: "nearest", behavior: "instant" });
      focusNavigator.current = false;
    }
  }, [isPending, servedKey, state.draft]);

  if (state.servedKey !== servedKey) {
    // A served intermediate selection must never overwrite a newer independent edit.
    const matchesRequest = state.requestedKey === null || state.requestedKey === servedKey;
    setState({ servedKey, requestedKey: matchesRequest ? null : state.requestedKey,
      draft: matchesRequest ? selected : state.draft });
  }

  useEffect(() => { latestDraft.current = state.draft; }, [state.draft]);
  useEffect(() => {
    function restoreHistory() {
      const params = new URLSearchParams(window.location.search);
      const draft = Object.fromEntries(SCOPE_CONTROL_NAMES.map((name) => [name, params.get(name) ?? ""]));
      latestDraft.current = draft;
      setState((previous) => ({ ...previous, draft, requestedKey: selectionKey(draft) }));
    }
    window.addEventListener("popstate", restoreHistory);
    return () => window.removeEventListener("popstate", restoreHistory);
  }, []);

  function change(name: ScopeControlName, value: string) {
    const controls = Object.fromEntries(SCOPE_CONTROL_NAMES.map((key) => [key, {
      value: key === name ? value : latestDraft.current[key] ?? "", disabled: false, required: false,
    }])) as Record<ScopeControlName, ScopeControl>;
    synchronizeScopeControls(controls, SCOPE_FORM_KIND.DRILLDOWN, name);
    const draft = Object.fromEntries(SCOPE_CONTROL_NAMES.map((key) => [key, controls[key].value]));
    if (name === "seccionCode") draft.level = value ? "seccion" : "";
    request(draft);
  }

  function request(draft: ScopeControlValues, history: "push" | "replace" = "replace") {
    latestDraft.current = draft;
    const requestedKey = selectionKey(draft);
    setState((previous) => ({ ...previous, draft, requestedKey }));
    // Always supersede an outstanding request, including a return to the served selection.
    startTransition(() => router[history](requestedKey ? `/drilldown?${requestedKey}` : "/drilldown", { scroll: false }));
  }
  function navigate(values: ScopeControlValues) {
    focusNavigator.current = true;
    // Deliberate territorial traversal is a Back/Forward waypoint; filter edits are not.
    request(values, "push");
  }

  const controlStates = scopeControlStates(SCOPE_FORM_KIND.DRILLDOWN, state.draft);
  const parentsResolved = (name: ScopeControlName) => SCOPE_CONTROL_NAMES
    .filter((parent) => scopeDependentNames(SCOPE_FORM_KIND.DRILLDOWN, parent).includes(name))
    .every((parent) => state.draft[parent] === selected[parent]);
  const showEvidence = !isPending && selectionKey(state.draft) === servedKey;

  const renderField = (field: SelectionField) => <div className={styles.filter} key={field.name}>
    <label htmlFor={field.id}>{field.label}</label>
    <ResponsiveSelect id={field.id} name={field.name} value={state.draft[field.name] ?? ""}
      required={controlStates[field.name].required}
      disabled={controlStates[field.name].disabled || !parentsResolved(field.name)}
      onChange={(event) => change(field.name, event.target.value)}>
      <option value="">{field.placeholder}</option>
      {field.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </ResponsiveSelect>
  </div>;
  const territoryOption = fields.find(field => field.name === "seccionCode")?.options.find(option => option.value === state.draft.seccionCode)
    ?? fields.find(field => field.name === "distritoCode")?.options.find(option => option.value === state.draft.distritoCode);
  const territoryName = territoryOption?.shortLabel ?? territoryOption?.label ?? "Elegir territorio";
  return <SelectionNavigation.Provider value={{ navigate }}><div className={styles.selectionBoundary} onClick={(event) => {
    const anchor = (event.target as HTMLElement).closest<HTMLAnchorElement>("a[data-territorial-navigation]");
    if (!anchor || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    const params = new URL(anchor.href).searchParams;
    navigate(Object.fromEntries(SCOPE_CONTROL_NAMES.map(name => [name, params.get(name) ?? ""])));
  }}>
    {showEvidence ? header : <header className={styles.header}><h1>Exploración territorial</h1><p>El territorio como punto de partida.</p></header>}
    <section className={styles.filters} aria-label="Filtros de exploración">
      <h2 id="explorer-form-heading" className="sr-only">Elegir el alcance de los resultados</h2>
      <form action="/drilldown" method="get" aria-busy={!showEvidence || undefined} onSubmit={(event) => event.preventDefault()}>
        <div className={styles.filterRow}>
          <div className={styles.filter}><span className={styles.filterLabel}>Territorio</span>
            <details className={styles.territoryPicker}><summary>{territoryName}</summary><div className={styles.territoryOptions}>
              {fields.filter(field => ["distritoCode", "seccionCode"].includes(field.name)).map(renderField)}
            </div></details>
          </div>
          {fields.filter(field => ["electionId", "categoryId"].includes(field.name)).map(renderField)}
          <div className={styles.filter}><label htmlFor="explorer-party">Agrupación</label>
            <ResponsiveSelect id="explorer-party" disabled aria-describedby="party-highlight-note"><option>Todas las agrupaciones</option></ResponsiveSelect>
          </div>
          <div className={styles.filterSummary}><SlidersHorizontal xmlns={undefined} aria-hidden="true" size={18} /><span>Alcance fijo<small>La cámara no cambia los resultados</small></span></div>
        </div>
      </form>
      <p id="party-highlight-note" className={styles.guidance}>Agrupación sin resaltado: se conservan todas las identidades, incluidas las listas sin mapear. Los resultados se actualizan al cambiar la selección.</p>
      {showEvidence ? notes : null}
    </section>
    {showEvidence ? children : <section className={styles.state}>
      <p role="status" aria-live="polite">Actualizando resultados… La evidencia se mostrará cuando la selección esté verificada.</p>
      <button type="button" onClick={() => request(selected)}>Volver a la selección verificada</button>
    </section>}
  </div></SelectionNavigation.Provider>;
}
