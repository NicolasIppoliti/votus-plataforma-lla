"use client";

import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import styles from "./comparison.module.css";

const KEYS = ["leftElectionId", "rightElectionId", "leftCategoryId", "rightCategoryId", "distritoCode", "seccionCode"] as const;
type Key = (typeof KEYS)[number];
type Values = Partial<Record<Key, string>>;

interface SelectionOption {
  value: string;
  label: string;
}

interface SelectionField {
  key: Key;
  id: string;
  label: string;
  placeholder: string;
  options: SelectionOption[];
}

export interface SelectionGroup {
  id: string;
  title: string;
  description: string;
  className: string;
  fields: SelectionField[];
}

interface Props {
  selected: Values;
  groups: SelectionGroup[];
  children: ReactNode;
}

interface SelectionState {
  servedKey: string;
  requestedKey: string | null;
  draft: Values;
}

// Facets belong to their served ancestors, never to a newly edited parent.
const PARENTS: Record<Key, Key[]> = {
  leftElectionId: [],
  rightElectionId: [],
  leftCategoryId: ["leftElectionId"],
  rightCategoryId: ["rightElectionId"],
  distritoCode: ["leftElectionId", "rightElectionId", "leftCategoryId", "rightCategoryId"],
  seccionCode: ["leftElectionId", "rightElectionId", "leftCategoryId", "rightCategoryId", "distritoCode"],
};

function selectionKey(values: Values): string {
  const params = new URLSearchParams();
  for (const key of KEYS) if (values[key]) params.set(key, values[key]);
  return params.toString();
}

export function ComparisonSelectionForm({ selected, groups, children }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const servedKey = selectionKey(selected);
  const [state, setState] = useState<SelectionState>({ servedKey, requestedKey: null, draft: selected });
  const latestDraft = useRef(selected);

  if (state.servedKey !== servedKey) {
    // An intermediate response cannot overwrite a more recent independent edit.
    const matchesRequest = state.requestedKey === null || state.requestedKey === servedKey;
    setState({
      servedKey,
      requestedKey: matchesRequest ? null : state.requestedKey,
      draft: matchesRequest ? selected : state.draft,
    });
  }

  useEffect(() => { latestDraft.current = state.draft; }, [state.draft]);

  useEffect(() => {
    function restoreHistory() {
      const params = new URLSearchParams(window.location.search);
      const draft: Values = {};
      for (const key of KEYS) {
        const value = params.get(key);
        if (value) draft[key] = value;
      }
      latestDraft.current = draft;
      setState((previous) => ({ ...previous, draft, requestedKey: selectionKey(draft) }));
    }
    window.addEventListener("popstate", restoreHistory);
    return () => window.removeEventListener("popstate", restoreHistory);
  }, []);

  function change(key: Key, value: string) {
    const draft = { ...latestDraft.current, [key]: value };
    for (const descendant of KEYS) {
      if (PARENTS[descendant].includes(key)) delete draft[descendant];
    }
    latestDraft.current = draft;
    const requestedKey = selectionKey(draft);
    setState((previous) => ({ ...previous, draft, requestedKey }));
    startTransition(() => {
      router.replace(requestedKey ? `/compare?${requestedKey}` : "/compare", { scroll: false });
    });
  }

  const fields = groups.flatMap((group) => group.fields);
  const parentsResolved = (key: Key) => PARENTS[key].every((parent) =>
    Boolean(state.draft[parent]) && state.draft[parent] === selected[parent] &&
    fields.find((field) => field.key === parent)?.options.some((option) => option.value === state.draft[parent]),
  );
  const showResults = !isPending && selectionKey(state.draft) === servedKey;

  return (
    <>
      <section className="panel official-compare__selection" aria-labelledby="compare-selector-heading">
        <div className="panel__heading">
          <h2 id="compare-selector-heading">Elegir selecciones y sección compartida</h2>
        </div>
        <form action="/compare" method="get" onSubmit={(event) => event.preventDefault()}>
          <div className="official-compare__selector-grid">
            {groups.map((group) => (
              <fieldset key={group.id} className={group.className} aria-labelledby={group.id}>
                <legend id={group.id}>{group.title} <span>{group.description}</span></legend>
                {group.fields.map((field) => (
                  <div className="field" key={field.key}>
                    <label htmlFor={field.id}>{field.label}</label>
                    <select
                      id={field.id}
                      name={field.key}
                      value={state.draft[field.key] ?? ""}
                      disabled={!parentsResolved(field.key)}
                      onChange={(event) => change(field.key, event.target.value)}
                      required
                    >
                      <option value="">{field.placeholder}</option>
                      {field.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </select>
                  </div>
                ))}
              </fieldset>
            ))}
          </div>
        </form>
        <p className={styles.guidance}>La comparación se actualiza al cambiar la selección.</p>
      </section>
      {showResults ? children : (
        <p className={styles.pending} role="status" aria-live="polite">Actualizando comparación… Los resultados se mostrarán cuando la selección esté verificada.</p>
      )}
    </>
  );
}
