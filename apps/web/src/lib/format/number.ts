/**
 * The one boundary for numbers shown to people (#451). Every vote count,
 * percentage and margin in the authenticated routes goes through here, so a
 * chart and the table beside it can never disagree on "14.550" vs "14550".
 */
const COUNT = new Intl.NumberFormat("es-AR");
const FIXED_2 = new Intl.NumberFormat("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const DECIMAL = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 2 });
const EXACT_FRACTION = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 20, useGrouping: false });

/** Integer counts: votes, rows, mesas. */
export function formatCount(value: number): string {
  return COUNT.format(value);
}

/** Exactly two decimals: percentages and swings that are compared side by side. */
export function formatFixed2(value: number): string {
  return FIXED_2.format(value);
}

/** Up to two decimals: margins in percentage points. */
export function formatDecimal(value: number): string {
  return DECIMAL.format(value);
}

/** Statutory evidence: integers grouped, fractions exact and ungrouped. */
export function formatExactNumber(value: number): string {
  return Number.isInteger(value) ? COUNT.format(value) : EXACT_FRACTION.format(value);
}
