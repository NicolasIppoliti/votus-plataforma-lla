import type { ReactNode } from "react";
import { Alert } from "@/components/ui/alert";

const STATES = {
  empty: { role: "status", treatment: "neutral" },
  denied: { role: "alert", treatment: "warning" },
  unavailable: { role: "alert", treatment: "warning" },
  truncated: { role: "alert", treatment: "warning" },
  error: { role: "alert", treatment: "danger" },
  loading: { role: "status", treatment: "neutral" },
} as const;

interface EvidenceStateProps {
  state: keyof typeof STATES;
  title: string;
  titleId: string;
  eyebrow?: string;
  children?: ReactNode;
  action?: ReactNode;
}

export function EvidenceState({ state, title, titleId, eyebrow, children, action }: EvidenceStateProps) {
  const { role, treatment } = STATES[state];
  return (
    <Alert
      className="evidence-state"
      data-state={state}
      data-treatment={treatment}
      role={role}
      aria-labelledby={titleId}
    >
      {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
      <h2 id={titleId}>{title}</h2>
      {children}
      {action}
    </Alert>
  );
}
