"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  SCOPE_CONTROL_NAMES, SCOPE_FORM_KIND, acceptScopeResponse,
  enhanceScopeForm, hasCompleteScopeParents, hasValidScopeLevel, isScopeSelectionMember,
  mapScopeOptionDescriptors, scopeDependentNames, scopeEndpoint, serializeScopeDraft,
  synchronizeScopeControls, type ScopeControlName, type ScopeControls, type ScopeControlValues,
  type ScopeFormKind, type ScopeMembership, type ScopeOptionPatch,
} from "./scope-selector-behavior";

interface ScopeSelectorFormProps { action: string; kind: ScopeFormKind; children: ReactNode; }

function formControls(form: HTMLFormElement): ScopeControls {
  const controls: ScopeControls = {};
  for (const name of SCOPE_CONTROL_NAMES) {
    const control = form.elements.namedItem(name);
    if (control instanceof HTMLSelectElement) controls[name] = control;
  } return controls;
}
function controlValues(controls: ScopeControls): ScopeControlValues {
  return Object.fromEntries(SCOPE_CONTROL_NAMES.map((name) => [name, controls[name]?.value ?? ""]));
}
function controlMembership(form: HTMLFormElement): ScopeMembership {
  return Object.fromEntries(SCOPE_CONTROL_NAMES.flatMap((name) => {
    const control = form.elements.namedItem(name);
    return control instanceof HTMLSelectElement ? [[name, [...control.options].map(({ value }) => value).filter(Boolean)]] : [];
  }));
}

export function handleScopeSubmit(
  event: SubmitEvent, form: HTMLFormElement, busy: boolean, failed: boolean,
  setError: (message: string) => void,
): void {
  const values = controlValues(formControls(form));
  if (!busy && !failed && form.checkValidity() && hasCompleteScopeParents(values) &&
    hasValidScopeLevel(values) && isScopeSelectionMember(values, controlMembership(form))) return;
  event.preventDefault();
  form.reportValidity();
  if (busy) setError("Espere a que termine la actualización de opciones.");
  else if (failed) setError("Actualice las opciones antes de aplicar la selección.");
  else setError("Revise que la selección sea válida y esté completa.");
}

function patchOptions(form: HTMLFormElement, patches: ScopeOptionPatch[]): void {
  for (const patch of patches) {
    const select = form.elements.namedItem(patch.name);
    if (!(select instanceof HTMLSelectElement)) continue;
    const placeholder = select.options[0]?.value === "" ? select.options[0] : undefined; const selectedValue = select.value;
    const options = patch.options.map((descriptor) => {
      const option = document.createElement("option");
      option.value = descriptor.value;
      option.textContent = descriptor.label;
      if (descriptor.nameStatus) option.dataset.nameStatus = descriptor.nameStatus;
      return option;
    });
    select.replaceChildren(...(placeholder ? [placeholder, ...options] : options)); select.value = selectedValue;
  }
}

export function ScopeSelectorForm({ action, kind, children }: ScopeSelectorFormProps): ReactNode {
  const searchParams = useSearchParams();
  const appliedQuery = searchParams.toString();
  const formRef = useRef<HTMLFormElement>(null);
  const retryRef = useRef<() => void>(() => undefined);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const form = formRef.current;
    if (!form) return;
    const controls = formControls(form);
    let controller: AbortController | null = null;
    let generation = 0;
    let busy = false;
    let failed = false;

    const loadOptions = async (changedName?: ScopeControlName): Promise<void> => {
      controller?.abort();
      controller = new AbortController();
      const requestController = controller;
      const requestGeneration = ++generation;
      const requestDraft = serializeScopeDraft(controlValues(controls));
      busy = true;
      failed = false;
      setLoading(true);
      setError(null);
      if (changedName) {
        for (const name of scopeDependentNames(kind, changedName)) {
          if (controls[name]) controls[name].disabled = true;
        }
      }
      try {
        const response = await fetch(scopeEndpoint(kind), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: requestDraft,
          signal: requestController.signal,
        });
        const payload: unknown = response.ok ? await response.json() : null;
        const patches = mapScopeOptionDescriptors(payload, kind);
        const currentDraft = serializeScopeDraft(controlValues(controls));
        if (!patches || !acceptScopeResponse(
          requestGeneration, requestDraft, requestController.signal.aborted, generation, currentDraft,
        )) throw new Error("scope options unavailable");
        const dependent = changedName ? new Set(scopeDependentNames(kind, changedName)) : null;
        if (dependent && kind === SCOPE_FORM_KIND.DRILLDOWN) dependent.add("level");
        patchOptions(form, dependent ? patches.filter(({ name }) => dependent.has(name)) : patches);
        synchronizeScopeControls(controls, kind);
      } catch {
        if (requestController.signal.aborted || requestGeneration !== generation) return;
        failed = true;
        setError("No se pudieron actualizar las opciones. Inténtelo nuevamente.");
      } finally {
        if (!requestController.signal.aborted && requestGeneration === generation) {
          busy = false;
          setLoading(false);
        }
      }
    };
    retryRef.current = () => { void loadOptions(); };
    const cleanupEnhancement = enhanceScopeForm(form, kind, (name) => { void loadOptions(name); });
    const handleSubmit = (event: SubmitEvent): void => {
      handleScopeSubmit(event, form, busy, failed, setError);
    };
    form.addEventListener("submit", handleSubmit);
    return () => {
      controller?.abort();
      cleanupEnhancement();
      form.removeEventListener("submit", handleSubmit);
    };
  }, [appliedQuery, kind]);

  return <form action={action} method="get" aria-busy={loading || undefined} key={appliedQuery} ref={formRef}>
    {children}
    <p aria-live="polite">{loading ? "Actualizando opciones…" : ""}</p>
    {error ? <p role="alert">{error} <button type="button" onClick={() => retryRef.current()}>Reintentar</button></p> : null}
  </form>;
}
