"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import styles from "./fiscalizacion.module.css";
import {
  SCOPE_FORM_KIND, canonicalScopeSearchParams, scopeControlStates,
  scopeDependentNames, synchronizeScopeControls, type ScopeControl,
} from "@/components/scope-selector-behavior";

const CONTROL_NAMES = ["electionId", "categoryId", "distritoCode", "seccionCode"] as const;
type CoverageControlName = (typeof CONTROL_NAMES)[number];
type CoverageSelection = Record<CoverageControlName, string>;
export interface CoverageField {
  name: CoverageControlName;
  id: string;
  label: string;
  placeholder: string;
  options: { value: string; label: string }[];
}
interface Props {
  selected: CoverageSelection;
  fields: CoverageField[] | null;
  children: ReactNode;
}
interface SelectionState {
  servedKey: string;
  requestedKey: string | null;
  draft: CoverageSelection;
}
const selectionKey = (values: CoverageSelection) => canonicalScopeSearchParams(values).toString();

export function FiscalizacionSelectionForm({ selected, fields, children }: Props) {
  const router = useRouter();
  const servedKey = selectionKey(selected);
  const [state, setState] = useState<SelectionState>({ servedKey, requestedKey: null, draft: selected });
  const latestDraft = useRef(selected);

  if (state.servedKey !== servedKey) {
    // Intermediate responses cannot replace a newer independent edit.
    const matchesRequest = state.requestedKey === null || state.requestedKey === servedKey;
    setState({ servedKey, requestedKey: matchesRequest ? null : state.requestedKey,
      draft: matchesRequest ? selected : state.draft });
  }
  useEffect(() => { latestDraft.current = state.draft; }, [state.draft]);
  useEffect(() => {
    function restoreHistory() {
      const params = new URLSearchParams(window.location.search);
      const draft = Object.fromEntries(CONTROL_NAMES.map((name) => [name, params.get(name) ?? ""])) as CoverageSelection;
      latestDraft.current = draft;
      setState((previous) => ({ ...previous, draft, requestedKey: selectionKey(draft) }));
    }
    window.addEventListener("popstate", restoreHistory);
    return () => window.removeEventListener("popstate", restoreHistory);
  }, []);

  function change(name: CoverageControlName, value: string) {
    const controls = Object.fromEntries(CONTROL_NAMES.map((key) => [key, {
      value: key === name ? value : latestDraft.current[key], disabled: false, required: false,
    }])) as Record<CoverageControlName, ScopeControl>;
    synchronizeScopeControls(controls, SCOPE_FORM_KIND.COVERAGE, name);
    const draft = Object.fromEntries(CONTROL_NAMES.map((key) => [key, controls[key].value])) as CoverageSelection;
    latestDraft.current = draft;
    const requestedKey = selectionKey(draft);
    setState((previous) => ({ ...previous, draft, requestedKey }));
    // Returning to the served selection must also supersede any outstanding response.
    router.replace(requestedKey ? `/fiscalizacion?${requestedKey}` : "/fiscalizacion", { scroll: false });
  }

  const controlStates = scopeControlStates(SCOPE_FORM_KIND.COVERAGE, state.draft);
  const parentsResolved = (name: CoverageControlName) => CONTROL_NAMES
    .filter((parent) => scopeDependentNames(SCOPE_FORM_KIND.COVERAGE, parent).includes(name))
    .every((parent) => state.draft[parent] === selected[parent]);
  // A matching served scope is already verified, even when an obsolete navigation is pending.
  const showEvidence = selectionKey(state.draft) === servedKey;

  return <>
    {fields ? <section className={styles.filters} aria-labelledby="coverage-form-heading">
      <div className="panel__heading"><h2 id="coverage-form-heading">Elegir el alcance de la cobertura</h2></div>
      <form action="/fiscalizacion" method="get" aria-busy={!showEvidence || undefined} onSubmit={(event) => event.preventDefault()}>
        <div className={styles.selectorGroups}>
          {[{ title: "Elección", names: ["electionId", "categoryId"] },
            { title: "Territorio", names: ["distritoCode", "seccionCode"] }].map((group) => (
            <fieldset className={styles.selectorGroup} key={group.title}>
              <legend>{group.title}</legend>
              <div className={styles.fields}>
                {fields.filter((field) => group.names.includes(field.name)).map((field) => <div className="field" key={field.name}>
                  <label htmlFor={field.id}>{field.label}</label>
                  <select id={field.id} name={field.name} value={state.draft[field.name]}
                    required={controlStates[field.name].required}
                    disabled={controlStates[field.name].disabled || !parentsResolved(field.name)}
                    onChange={(event) => change(field.name, event.target.value)}>
                    <option value="">{field.placeholder}</option>
                    {field.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </div>)}
              </div>
            </fieldset>
          ))}
        </div>
      </form>
      <p className={styles.guidance}>La cobertura y los resultados se actualizan al cambiar la selección.</p>
    </section> : null}
    {showEvidence ? children : <p className={styles.state} role="status" aria-live="polite">
      Actualizando evidencia… La cobertura y los resultados se mostrarán cuando la selección esté verificada.
    </p>}
  </>;
}
