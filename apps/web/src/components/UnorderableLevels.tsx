import type { ReactNode } from "react";

export interface UnorderableLevelsProps {
  entries: { granularity: string; rows: number; votes: number }[];
  /** Which read these entries came from, when a page shows more than one. */
  label?: string | undefined;
}

/**
 * ONE presentation of the levels this app cannot order.
 *
 * `unrecognizedLevels` was centralised in `granularity.ts`; its markup was
 * copied into three pages. Same shape as the unmapped-list-id block, which is
 * the duplication this repo keeps regressing on.
 *
 * ROWS only, never a vote total: the copy states that the containment
 * relationship of these rows is unknown, and that is exactly why their votes
 * cannot be added — two rows on one unorderable level may be the same votes
 * counted twice.
 */
export function UnorderableLevels({ entries, label }: UnorderableLevelsProps): ReactNode {
  if (entries.length === 0) return null;
  return (
    <>
      <p role="alert">
        {label ? `${label}: ` : ""}
        {entries.reduce((sum, entry) => sum + entry.rows, 0)} row(s) carry a
        granularity this page cannot order, so their containment relationship is
        unknown and no level is shown for them at all. By level:
      </p>
      <ul>
        {entries.map((entry) => (
          <li key={entry.granularity}>
            {entry.granularity}: {entry.rows} rows
          </li>
        ))}
      </ul>
    </>
  );
}
