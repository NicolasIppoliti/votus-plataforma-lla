/**
 * Shared value types for the results-analysis and provenance-display
 * capabilities (design.md "Interfaces / Contracts"). Const-object-first
 * per the TypeScript convention: flat interfaces, no inline nesting.
 */

export const GRANULARITY = {
  MESA: "mesa",
  ESTABLECIMIENTO: "establecimiento",
  CIRCUITO: "circuito",
  SECCION: "seccion",
  DISTRITO: "distrito",
} as const;
export type Granularity = (typeof GRANULARITY)[keyof typeof GRANULARITY];

export const SOURCE_KIND = {
  OFFICIAL: "official",
  FISCALIZACION: "fiscalizacion",
} as const;
export type SourceKind = (typeof SOURCE_KIND)[keyof typeof SOURCE_KIND];

/** Traces a figure to its archived source (provenance-display spec). */
export interface SourceRef {
  archiveEntryId: string;
  sha256: string;
  url: string;
  fetchedAt: string;
}

/**
 * Required whenever `sourceKind` is `fiscalizacion` (design.md D9.2).
 * `isRandomSample` is the literal type `false` — no code path can ever
 * assert this coverage is a random sample. The observed 93/153 mesas are
 * exactly the mesas where LLA had a fiscal present, which is a structural,
 * non-random bias, not a sampling shortfall.
 */
export interface Coverage {
  observedUnits: number;
  denominatorUnits: number;
  denominatorBasis: string;
  isRandomSample: false;
}
