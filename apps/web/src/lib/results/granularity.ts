import { GRANULARITY, type Granularity } from "./types";
import type { ResultRow } from "@/lib/fiscalizacion/repository";

/**
 * Coarsest to finest. Hand-written over the shared `GRANULARITY` values: the
 * ordering is what this module adds, and `granularity.test.ts` is what keeps
 * it in step with the const.
 */
export const GRANULARITY_ORDER: Granularity[] = [
  GRANULARITY.DISTRITO,
  GRANULARITY.SECCION,
  GRANULARITY.CIRCUITO,
  GRANULARITY.ESTABLECIMIENTO,
  GRANULARITY.MESA,
];

/**
 * The level a total for ONE jurisdiction carries.
 *
 * NOT `distrito`. Every query filters `jurisdiction_id`, so the figure covers
 * one partido — Coronel de Marina Leonardo Rosales — which is a SECCION in the
 * national scheme and the partido itself in the PBA one. `distrito` is the
 * province, and claiming it is precisely the drop rule 8 records: "dropping
 * the seccion attributed 32.291 Coronel Rosales votes to the whole province."
 *
 * A named constant rather than a literal at the render, because `compare` and
 * `municipal` label the same kind of figure and one of them was hardcoded.
 */
export const JURISDICTION_TOTAL_GRANULARITY: Granularity = GRANULARITY.SECCION;

/**
 * How to label a total summed from `rows` over ONE jurisdiction.
 *
 * Two ways to get this wrong, and both shipped:
 *
 * - Labelling it with the ROW level claims a detail the sum no longer carries
 *   — `mesa` over a figure that is every mesa added together.
 * - Labelling it `distrito` claims the province for a partido total, which is
 *   the 32.291-vote misattribution rule 8 records.
 *
 * So the answer is ALWAYS the jurisdiction's own level. The scope comes from
 * the query's `jurisdiction_id` filter, not from how the source labelled its
 * rows: a coarse source does not widen what the number covers. What varies is
 * only the disclosure — `summedFrom` when finer rows were added together,
 * `degradedFrom` when the source never published anything below the partido.
 */
export function jurisdictionTotalLevel(rowLevel: Granularity): {
  granularity: Granularity;
  degradedFrom?: Granularity;
  summedFrom?: Granularity;
} {
  // ALWAYS the jurisdiction's own level. The figure's scope is set by the
  // query's `jurisdiction_id` filter, not by how the source happened to label
  // its rows: a coarse SOURCE does not widen what the number covers. Returning
  // `distrito` for distrito-labelled rows announced a province figure over a
  // partido total — the 32.291-vote misattribution rule 8 records — while this
  // function's own docstring named that hazard.
  const rowIndex = GRANULARITY_ORDER.indexOf(rowLevel);
  const totalIndex = GRANULARITY_ORDER.indexOf(JURISDICTION_TOTAL_GRANULARITY);
  if (rowIndex === totalIndex) return { granularity: JURISDICTION_TOTAL_GRANULARITY };
  return rowIndex < totalIndex
    // Rows COARSER than the jurisdiction: the detail was never there, and
    // summing adds none.
    ? { granularity: JURISDICTION_TOTAL_GRANULARITY, degradedFrom: rowLevel }
    // Rows FINER: they were added together to reach it.
    : { granularity: JURISDICTION_TOTAL_GRANULARITY, summedFrom: rowLevel };
}

/**
 * The coarser of two optional levels — the strongest claim a PAIR supports.
 *
 * Lived in `compare/page.tsx` as a fourth ordering derivation over
 * `GRANULARITY_ORDER` while every other fold moved here. It answers a question
 * this module owns.
 */
export function coarsestOf(
  a: Granularity | undefined,
  b: Granularity | undefined,
): Granularity | undefined {
  return [a, b]
    .filter((level): level is Granularity => level !== undefined)
    .sort((x, y) => GRANULARITY_ORDER.indexOf(x) - GRANULARITY_ORDER.indexOf(y))[0];
}

export interface GranularityReading {
  granularity: Granularity;
  /**
   * Every distinct level present, when the rows mix more than one.
   *
   * Typed to allow an unrecognized string: `present` collects what the rows
   * actually carry, and a value outside the enum is exactly what
   * `unrecognized` reports. Typing this `Granularity[]` made the type lie
   * about a value its own test asserts.
   */
  mixed: (Granularity | string)[];
  /**
   * Levels this module cannot order.
   *
   * Reported SEPARATELY from `mixed`, because a uniformly-unknown set is not
   * mixed: `present.size === 1` left `mixed` empty while the fold degraded the
   * answer to `distrito`, and every consumer discloses on `mixed.length > 0`.
   * So the badge asserted `distrito` and nobody was told the rows said
   * something else. On `compare` it was worse: both sides uniformly-unknown
   * folded to the same level, `compareResults` saw no mismatch, and the D6
   * refusal never fired.
   */
  unrecognized: string[];
}

/**
 * The coarsest level a set of rows supports, plus whether they mix levels.
 *
 * ONE boundary, because two pages derived this differently: `municipal`
 * computed the coarsest level while `compare` kept `row.granularity` from the
 * LAST row of its loop — so a mixed set collapsed to whatever the iterator
 * happened to see last, and that value then fed the D6 mismatch check that
 * exists to catch exactly this.
 *
 * An empty set reports the coarsest level rather than upgrading to the finest
 * available: no rows is no evidence of fine granularity.
 */
export function readGranularity(rows: { granularity: Granularity }[]): GranularityReading {
  if (rows.length === 0) {
    return { granularity: GRANULARITY.DISTRITO, mixed: [], unrecognized: [] };
  }

  // Typed to hold what the rows CARRY, which may be outside the enum -- the
  // same honesty `mixed` needed.
  const present = new Set<Granularity | string>();
  const unrecognized = new Set<string>();
  let coarsest = GRANULARITY_ORDER.length - 1;
  for (const row of rows) {
    present.add(row.granularity);
    const index = GRANULARITY_ORDER.indexOf(row.granularity);
    if (index === -1) unrecognized.add(row.granularity);
    // An unrecognized level is treated as the coarsest possible: this module
    // cannot say what it contains, so it cannot claim anything finer.
    coarsest = Math.min(coarsest, index === -1 ? 0 : index);
  }

  return {
    granularity: GRANULARITY_ORDER[coarsest] ?? GRANULARITY.DISTRITO,
    mixed: present.size > 1 ? [...present].sort() : [],
    unrecognized: [...unrecognized].sort(),
  };
}

/**
 * Whether these rows can be SUMMED, given what each level contains.
 *
 * THE boundary for this question. It lived in `fiscalizacion/page.tsx` while
 * `drilldown` and `municipal` summed mixed rows and merely disclosed the mix,
 * and `compare` refused outright — three answers to one question, and two of
 * them rendered inflated figures.
 *
 * A `seccion` row already CONTAINS the `mesa` rows beneath it, so adding them
 * double-counts. `partyShare` refused mixed levels while `topParty` and the
 * rendered per-party list summed the very same rows -- two contradictory
 * rules over one row set, and the inflated total could flip which party the
 * whole juxtaposition reported.
 */
/**
 * Per-level {rows, votes} for every level this module cannot order.
 *
 * A LIST OF NAMES was rendered as a row count, so many rows on one unknown
 * level read as "1 row(s)" — a plausible small total hiding the distribution.
 * Lived in `fiscalizacion/page.tsx` while `drilldown` and `municipal` printed
 * the names only: one question, two answers.
 */
export function unrecognizedLevels(
  rows: ResultRow[],
): { granularity: string; rows: number; votes: number }[] {
  const unknown = readGranularity(rows).unrecognized;
  const totals = new Map<string, { rows: number; votes: number }>();
  for (const row of rows) {
    if (!unknown.includes(row.granularity)) continue;
    const entry = totals.get(row.granularity) ?? { rows: 0, votes: 0 };
    totals.set(row.granularity, { rows: entry.rows + 1, votes: entry.votes + row.votes });
  }
  return [...totals.entries()]
    .map(([granularity, tally]) => ({ granularity, ...tally }))
    .sort((a, b) => a.granularity.localeCompare(b.granularity));
}

export function mixedGranularityReason(rows: ResultRow[]): string | null {
  const levels = new Set(rows.map((row) => row.granularity));

  // An unknown level is unsummable even when it is the ONLY one present:
  // this module cannot say what it contains, so it cannot say the rows do not
  // overlap. Keying on `size <= 1` let a uniformly `subcircuito` set through,
  // and `coarsestGranularity` then labelled the computed share `distrito` --
  // a level no row claimed.
  const unknown = readGranularity(rows).unrecognized;
  if (unknown.length > 0) {
    return (
      `rows carry a granularity this page cannot order (${unknown.join(", ")}); ` +
      "their containment relationship is unknown, so they cannot be summed"
    );
  }

  if (levels.size <= 1) return null;
  return (
    `rows mix ${levels.size} granularity levels (${[...levels].sort().join(", ")}); ` +
    "summing them would double-count"
  );
}
