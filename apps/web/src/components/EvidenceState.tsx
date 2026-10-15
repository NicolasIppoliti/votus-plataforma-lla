import type { ReactNode } from "react";
import { Alert, type AlertVariant } from "@/components/ui/alert";

const STATES = {
  empty: { treatment: "neutral" },
  denied: { treatment: "warning" },
  unavailable: { treatment: "warning" },
  truncated: { treatment: "warning" },
  error: { treatment: "danger" },
  loading: { treatment: "neutral" },
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
  const { treatment } = STATES[state];
  const variant: AlertVariant = state === "error" || state === "denied" || state === "empty" ? state : state === "loading" ? "needs-selection" : "unavailable";
  return (
    <Alert
      className="evidence-state"
      data-state={state}
      data-treatment={treatment}
      variant={variant}
      action={action}
      aria-labelledby={titleId}
    >
      {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
      <h2 id={titleId}>{title}</h2>
      {children}
    </Alert>
  );
}
