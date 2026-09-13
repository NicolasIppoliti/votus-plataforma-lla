"use client";

import type { KeyboardEvent, ReactNode } from "react";

export function AccountDisclosure({ children }: { children: ReactNode }) {
  function handleKeyDown(event: KeyboardEvent<HTMLDetailsElement>) {
    if (event.key !== "Escape" || !event.currentTarget.open) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.open = false;
    event.currentTarget.querySelector("summary")?.focus();
  }

  return (
    <details className="workspace-account" onKeyDown={handleKeyDown}>
      <summary>Cuenta</summary>
      {children}
    </details>
  );
}
