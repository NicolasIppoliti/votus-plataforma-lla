"use client";

import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import styles from "./drilldown.module.css";
import {
  SCOPE_CONTROL_NAMES, SCOPE_FORM_KIND, canonicalScopeSearchParams,
  scopeControlStates, scopeDependentNames, synchronizeScopeControls,
  type ScopeControl, type ScopeControlName, type ScopeControlValues,
} from "@/components/scope-selector-behavior";

interface SelectionOption {
  value: string;
  label: string;
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
}

interface SelectionState {
  servedKey: string;
  requestedKey: string | null;
  draft: ScopeControlValues;
}

const GROUPS = [
  { title: "Elección", names: ["electionId", "categoryId"] },
  { title: "Territorio", names: ["distritoCode", "seccionCode"] },
  { title: "Detalle del informe", names: ["circuitoCode", "establecimientoCode", "mesaCode", "level"] },
];

const selectionKey = (values: ScopeControlValues) => canonicalScopeSearchParams(values).toString();

export function DrilldownSelectionForm({ selected, fields, notes, children }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const servedKey = selectionKey(selected);
  const [state, setState] = useState<SelectionState>({ servedKey, requestedKey: null, draft: selected });
  const latestDraft = useRef(selected);

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
    latestDraft.current = draft;
    const requestedKey = selectionKey(draft);
    setState((previous) => ({ ...previous, draft, requestedKey }));
    // Always supersede an outstanding request, including a return to the served selection.
    startTransition(() => router.replace(requestedKey ? `/drilldown?${requestedKey}` : "/drilldown", { scroll: false }));
  }

  const controlStates = scopeControlStates(SCOPE_FORM_KIND.DRILLDOWN, state.draft);
  const parentsResolved = (name: ScopeControlName) => SCOPE_CONTROL_NAMES
    .filter((parent) => scopeDependentNames(SCOPE_FORM_KIND.DRILLDOWN, parent).includes(name))
    .every((parent) => state.draft[parent] === selected[parent]);
  const showEvidence = !isPending && selectionKey(state.draft) === servedKey;

  return <>
    <section className={styles.filters} aria-labelledby="explorer-form-heading">
      <div className="panel__heading">
        <h2 id="explorer-form-heading">Elegir el alcance de los resultados</h2>
      </div>
      <form action="/drilldown" method="get" aria-busy={!showEvidence || undefined} onSubmit={(event) => event.preventDefault()}>
        <div className={styles.selectorGroups}>
        {GROUPS.map((group) => <fieldset className={styles.selectorGroup} key={group.title}>
          <legend>{group.title}</legend>
          <div className={styles.fields}>
          {fields.filter((field) => group.names.includes(field.name)).map((field) => <div className="field" key={field.name}>
            <label htmlFor={field.id}>{field.label}</label>
            <select id={field.id} name={field.name} value={state.draft[field.name] ?? ""}
              required={controlStates[field.name].required}
              disabled={controlStates[field.name].disabled || !parentsResolved(field.name)}
              onChange={(event) => change(field.name, event.target.value)}>
              <option value="">{field.placeholder}</option>
              {field.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </div>)}
          </div>
        </fieldset>)}
        </div>
      </form>
      <p className={styles.guidance}>Los resultados se actualizan al cambiar la selección.</p>
      {showEvidence ? notes : null}
    </section>
    {showEvidence ? children : <p className={styles.state} role="status" aria-live="polite">
      Actualizando resultados… La evidencia se mostrará cuando la selección esté verificada.
    </p>}
  </>;
}
