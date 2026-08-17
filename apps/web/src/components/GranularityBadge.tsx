import type { ReactNode } from "react";
import type { Granularity } from "@/lib/results/types";

export interface GranularityBadgeProps {
  granularity: Granularity;
  /** Actual coarser source-row level used for this figure. */
  degradedFrom?: Granularity;
  /** Persisted requested level, when it differs from the actual row level. */
  requestedGranularity?: Granularity;
  /**
   * Set when finer rows were SUMMED into this figure.
   *
   * Distinct from `degradedFrom`: "mesa detail was unavailable" and "every
   * mesa was added together" are opposite situations, and folding both into
   * one field made a jurisdiction total built from mesa rows announce that
   * mesa data could not be had.
   */
  summedFrom?: Granularity;
}

/**
 * provenance-display spec: "Visible granularity indicator on every
 * figure". Plain semantic markup — this project has no CSS framework
 * dependency; styling is deliberately out of this component's scope.
 */
export function GranularityBadge({
  granularity,
  degradedFrom,
  requestedGranularity,
  summedFrom,
}: GranularityBadgeProps): ReactNode {
  return (
    <span role="status" aria-label={`granularidad: ${granularity}`}>
      <span>{granularity}</span>
      {degradedFrom ? (
        <span role="alert">
          {` — degradada desde ${degradedFrom} (la fuente publicó totales a nivel ${degradedFrom}, por lo que no hay datos más detallados disponibles)`}
        </span>
      ) : null}
      {requestedGranularity ? (
        <span role="alert">
          {` — granularidad solicitada: ${requestedGranularity}; granularidad real: ${granularity}`}
        </span>
      ) : null}
      {summedFrom ? (
        <span role="note">
          {" "}
          — sumado a partir de filas de nivel {summedFrom}
        </span>
      ) : null}
    </span>
  );
}
