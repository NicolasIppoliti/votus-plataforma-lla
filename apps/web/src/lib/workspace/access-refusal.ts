/**
 * Why the workspace refused a read (#426). "Select an organization" and "your
 * session context ended" each have a next step; only the rest is a denial.
 */
export const ACCESS_REFUSAL = {
  SELECTION_REQUIRED: "selection_required",
  CONTEXT_ENDED: "context_ended",
  DENIED: "denied",
} as const;
export type AccessRefusal = (typeof ACCESS_REFUSAL)[keyof typeof ACCESS_REFUSAL];

export function classifyAccessRefusal(authorizationStatus: string): AccessRefusal {
  if (authorizationStatus === "selection_required") return ACCESS_REFUSAL.SELECTION_REQUIRED;
  if (authorizationStatus === "context_expired" || authorizationStatus === "context_revoked") return ACCESS_REFUSAL.CONTEXT_ENDED;
  return ACCESS_REFUSAL.DENIED;
}
