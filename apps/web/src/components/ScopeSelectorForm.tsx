"use client";

import { useEffect, useRef, type ReactNode } from "react";
import {
  enhanceScopeForm,
  type ScopeFormKind,
} from "./scope-selector-behavior";

interface ScopeSelectorFormProps {
  action: string;
  kind: ScopeFormKind;
  children: ReactNode;
}

export function ScopeSelectorForm({
  action,
  kind,
  children,
}: ScopeSelectorFormProps): ReactNode {
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    const form = formRef.current;
    if (!form) return;
    return enhanceScopeForm(form, kind);
  }, [kind]);

  return (
    <form ref={formRef} action={action} method="get">
      {children}
    </form>
  );
}
