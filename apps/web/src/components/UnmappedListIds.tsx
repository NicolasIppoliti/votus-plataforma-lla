import type { ReactNode } from "react";
import { describeExcluded, type ExcludedByKind } from "@/lib/fiscalizacion/repository";

export interface UnmappedListIdsProps {
  entries: { listId: string; rows: number; votes: number }[];
  /**
   * Rows carrying no list id at all — reported separately, because they are
   * not list ids that failed to map.
   */
  withoutListId?: ExcludedByKind | undefined;
  /**
   * Whether a curated mapping source was configured for this read.
   *
   * With none, EVERY row comes back unresolved, and saying "resolved to no
   * curated party" would state a fact about the curated table that is really a
   * fact about the caller's configuration.
   */
  mappingConfigured?: boolean | undefined;
  /**
   * Which read these entries came from, when a page shows more than one.
   *
   * `compare` merged two years into one list, so a list id present in both
   * rendered as a single cross-year sum with nothing naming the year — and the
   * two reads are different queries over different rows.
   */
  label?: string | undefined;
  /** How many rows the page read in total, for the "N of M" framing. */
  totalRows: number;
  /**
   * Why the rows cannot be summed, or `null` when they can.
   *
   * Vote totals are omitted while this is set: a `seccion` row already contains
   * the `mesa` rows beneath it, so adding them reports more votes than were
   * cast. WHICH ids failed to map is independent of that and always shown.
   */
  unsummable: string | null;
}

/**
 * ONE presentation of the unmapped-list-id breakdown.
 *
 * `unmappedByListId` was centralised in the repository; its rendering was not,
 * so three pages carried three variants — two byte-identical and a third with
 * different wording and a different ARIA role. This repo keeps regressing on
 * exactly that shape, so the markup lives here with the fold's own rule.
 */
export function UnmappedListIds({
  entries,
  totalRows,
  unsummable,
  withoutListId,
  mappingConfigured = true,
  label,
}: UnmappedListIdsProps): ReactNode {
  const rows = entries.reduce((sum, entry) => sum + entry.rows, 0);
  const votes = entries.reduce((sum, entry) => sum + entry.votes, 0);
  const noListIdSummary = describeExcluded(withoutListId ?? {});
  const noListIdRows = Object.values(withoutListId ?? {}).reduce((sum, tally) => sum + tally.rows, 0);
  if (rows === 0 && noListIdRows === 0) return null;
  return (
    <>
      {/* Only when there IS something to break down. With no entries the
          header read "0 of 400 rows resolved to no curated party" above an
          empty list — a count of zero stated as a finding, which is what
          `describeExcluded` refuses by filtering empty tallies out. */}
      {rows === 0 ? null : (
      <p role="alert">
        {label ? `${label}: ` : ""}
        {rows} of {totalRows} rows{unsummable === null ? ` (${votes} votes)` : ""}{" "}
        {mappingConfigured
          ? "resolved to no curated party"
          : "could not be resolved because no curated mapping source is configured for this read"}
        . They remain in every denominator as votes that were cast, but no party
        can be named for them. By list id:
      </p>
      )}
      {rows === 0 ? null : (
      <ul>
        {entries.map((entry) => (
          <li key={entry.listId}>
            {entry.listId}: {entry.rows} rows
            {unsummable === null ? `, ${entry.votes} votes` : ""}
          </li>
        ))}
      </ul>
      )}
      {noListIdSummary === null ? null : (
        // PER SOURCE KIND. One aggregate collapsed at least two distinct
        // shapes, and a large plausible total is how a destructive filter
        // survives review.
        <p role="note">
          {noListIdRows} row(s) carry no list id at all — they are not list ids
          that failed to map. By source kind: {noListIdSummary}.
        </p>
      )}
      {unsummable === null ? null : (
        <p role="note">
          Vote totals are omitted here for the same reason the per-party figures
          are: these rows mix granularity levels and cannot be added.
        </p>
      )}
    </>
  );
}
