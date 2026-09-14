"use client";

import { useState, type ChangeEvent, type ReactNode } from "react";

const KEYS = ["leftElectionId", "rightElectionId", "leftCategoryId", "rightCategoryId", "distritoCode", "seccionCode"] as const;
type Key = (typeof KEYS)[number];
type Values = Partial<Record<Key, string>>;

interface Props {
  selected: Values;
  options: Record<Key, string[]>;
  applied: boolean;
  children: ReactNode;
}

// Options belong to the submitted ancestors, not to a newly edited election or scope.
const PARENTS: Record<Key, Key[]> = {
  leftElectionId: [],
  rightElectionId: [],
  leftCategoryId: ["leftElectionId"],
  rightCategoryId: ["rightElectionId"],
  distritoCode: ["leftElectionId", "rightElectionId", "leftCategoryId", "rightCategoryId"],
  seccionCode: ["leftElectionId", "rightElectionId", "leftCategoryId", "rightCategoryId", "distritoCode"],
};

export function ComparisonSelectionForm({ selected, options, applied, children }: Props) {
  const [draft, setDraft] = useState(selected);
  const parentsResolved = (key: Key, values: Values) => PARENTS[key].every(
    (parent) => Boolean(values[parent]) && values[parent] === selected[parent] && options[parent].includes(values[parent]!),
  );
  const ready = KEYS.every((key) => Boolean(draft[key]) && options[key].includes(draft[key]!) && parentsResolved(key, draft));
  const dirty = applied && KEYS.some((key) => (draft[key] ?? "") !== (selected[key] ?? ""));

  function change(event: ChangeEvent<HTMLFormElement>) {
    const target = event.target;
    if (!(target instanceof HTMLSelectElement)) return;
    const changed = KEYS.find((key) => key === target.name);
    if (!changed) return;
    const next = { ...draft, [changed]: target.value };
    for (const key of KEYS) {
      const control = event.currentTarget.elements.namedItem(key);
      if (!(control instanceof HTMLSelectElement)) continue;
      const resolved = parentsResolved(key, next);
      if (PARENTS[key].includes(changed)) {
        // Reverting to the applied ancestry restores its canonical selection.
        next[key] = resolved ? selected[key] ?? "" : "";
      }
      if (!resolved || !options[key].includes(next[key] ?? "")) next[key] = "";
      control.disabled = !resolved;
      control.value = next[key] ?? "";
    }
    setDraft(next);
  }

  return (
    <form action="/compare" method="get" onChange={change}>
      {children}
      <div className="form-actions">
        <button className="button button--primary" type="submit" formNoValidate>Actualizar opciones</button>
        {ready && <button className="button button--primary" type="submit">Comparar resultados</button>}
      </div>
      {dirty && <p role="status">Cambios sin aplicar</p>}
    </form>
  );
}
