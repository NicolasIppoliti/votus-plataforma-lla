/** Display-only boundary: preserve machine reasons in transport and unknown values in evidence. */
const labels: Record<string, string> = {
  non_official_source_rows: "filas de fuente no oficial",
  official_rows_with_incomplete_lineage: "filas oficiales con linaje incompleto",
  coarse_facets_overflow: "opciones generales",
  circuitos_overflow: "circuitos",
  establecimientos_overflow: "establecimientos",
  mesas_overflow: "mesas",
};

export function facetExclusionLabel(reason: string): string {
  return Object.hasOwn(labels, reason) ? labels[reason]! : reason;
}
