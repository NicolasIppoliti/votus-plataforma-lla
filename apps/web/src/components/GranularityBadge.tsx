import type { ReactNode } from "react";
import type { Granularity } from "@/lib/results/types";

export interface GranularityBadgeProps {
  granularity: Granularity;
  /** Set when the requested (finer) level was unavailable (design.md D7). */
  degradedFrom?: Granularity;
}

/**
 * provenance-display spec: "Visible granularity indicator on every
 * figure". Plain semantic markup — this project has no CSS framework
 * dependency; styling is deliberately out of this component's scope.
 */
export function GranularityBadge({
  granularity,
  degradedFrom,
}: GranularityBadgeProps): ReactNode {
  return (
    <span role="status" aria-label={`granularity: ${granularity}`}>
      <span>{granularity}</span>
      {degradedFrom ? (
        <span role="alert">
          {" "}
          — degraded from {degradedFrom} (requested {degradedFrom}-level data was
          unavailable)
        </span>
      ) : null}
    </span>
  );
}
