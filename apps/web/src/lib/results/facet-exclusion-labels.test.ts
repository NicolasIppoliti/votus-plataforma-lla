import { expect, it } from "vitest";
import { facetExclusionLabel } from "./facet-exclusion-labels";

it.each([
  ["non_official_source_rows", "filas de fuente no oficial"],
  ["official_rows_with_incomplete_lineage", "filas oficiales con linaje incompleto"],
  ["coarse_facets_overflow", "opciones generales"],
  ["circuitos_overflow", "circuitos"],
  ["establecimientos_overflow", "establecimientos"],
  ["mesas_overflow", "mesas"],
])("labels %s without changing the transport reason", (reason, label) => {
  expect(facetExclusionLabel(reason)).toBe(label);
});

it.each(["future_exclusion", "constructor", "__proto__", "toString"])("preserves unknown reason %s verbatim", reason => {
  expect(facetExclusionLabel(reason)).toBe(reason);
});
