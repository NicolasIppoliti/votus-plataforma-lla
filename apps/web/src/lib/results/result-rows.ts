import type { Granularity, SourceKind } from "./types";

export interface ResultRow {
  jurisdictionId: string;
  categoryId: string;
  listId: string | null;
  votes: number;
  sourceKind: SourceKind;
  granularity: Granularity;
  /**
   * Requested level, or null when historical request intent is unknown.
   * Optional only for manually constructed rows; the database boundary rejects a missing value.
   */
  requestedGranularity?: Granularity | null;
  /**
   * Mesa population declared by the source (`NATIVOS`, `EXTRANJEROS`, or
   * another non-empty source value). `null` means the persisted row is
   * explicitly untagged; optional only for manually constructed fixtures.
   */
  mesaTipo?: string | null;
  archiveEntryId: string;
  /**
   * The curated `party_mapping` -> `party_canonical` display name for
   * `listId` (task 15.14). Explicitly `null` when no `PartyNameSource` was
   * supplied, or when the exact `(year, jurisdiction, category, listId)`
   * key has no curated mapping entry — an unmapped list id MUST surface as
   * this defined `null` "unmapped" state, never as a bare `listId` a page
   * renders as if it were a name (party-identity-mapping spec, "Query
   * encounters an unmapped list id"). Optional so every pre-existing
   * `ResultRow` fixture across the codebase stays valid without an update;
   * `ResultsRepository.resolvePartyNames` always sets it explicitly (to a
   * name or to `null`) on every row it returns.
   */
  partyName?: string | null;
  /**
   * The canonical party this row's list id maps to, or `null` when unmapped.
   *
   * THE identity across years. `partyName` is a DISPLAY string: the curated
   * file spells one canonical party "LA LIBERTAD AVANZA" in 2023 and "ALIANZA
   * LA LIBERTAD AVANZA" in 2025, so comparing on it fabricates a flip exactly
   * the way comparing on the raw list id did.
   */
  canonicalPartyId?: string | null;
}

/**
 * A drop, counted in BOTH the units it can be judged in.
 *
 * A row count alone made a 6.462.906-vote drop and a 6-vote drop render
 * identically, and the size of what vanished is the whole question — the
 * sibling tallies (`foreignByKind`, `unmappedByListId`) already carried votes
 * for exactly this reason.
 */
export type ExcludedByKind = Record<string, { rows: number; votes: number }>;

/**
 * ONE phrasing of a drop, so the four surfaces cannot drift apart again.
 * `null` when nothing was dropped — callers render no note at all.
 */
export function describeExcluded(excluded: ExcludedByKind): string | null {
  const entries = Object.entries(excluded).filter(([, tally]) => tally.rows > 0);
  if (entries.length === 0) return null;
  return entries
    .map(([kind, tally]) => {
      const sourceLabel = kind === "official"
        ? "oficial"
        : kind === "fiscalizacion"
          ? "fiscalización"
          : kind === "unknown"
            ? "desconocida"
            : kind;
      return `${tally.rows} ${tally.rows === 1 ? "fila" : "filas"} ${sourceLabel} / ${tally.votes} ${tally.votes === 1 ? "voto" : "votos"}`;
    })
    .join(", ");
}

/**
 * Foreign rows tallied the same way an exclusion is, so the ONE phrasing in
 * `describeExcluded` covers this refusal too.
 *
 * A bare "3 of 400 rows are not official" made a leaked `fiscalizacion` row and
 * a leaked `unknown`-kind row read identically and never showed the votes —
 * the large-plausible-total shape rule 3 names.
 */
export function tallyByKind(rows: ResultRow[]): ExcludedByKind {
  const tally: ExcludedByKind = {};
  for (const row of rows) {
    const key =
      row.sourceKind === "official" || row.sourceKind === "fiscalizacion"
        ? row.sourceKind
        : "unknown";
    const current = tally[key] ?? { rows: 0, votes: 0 };
    tally[key] = { rows: current.rows + 1, votes: current.votes + row.votes };
  }
  return tally;
}

/**
 * Per-party totals, ranked. ONE fold.
 *
 * `result_row` holds one row per `(mesa, list)`, so rendering rows verbatim
 * printed the same party N times with N different numbers — and three pages
 * each carried an identical copy of this Map fold, including the
 * `unmapped (list …)` label. A rule-4 fix to how an unresolved list id is
 * shown would have landed in one of the three.
 */
export function votesByParty(rows: ResultRow[]): { label: string; votes: number }[] {
  // Keyed on the CANONICAL ID and labelled by the display name. Folding on the
  // name merged two canonical parties that happen to share a string and split
  // one party the curated file respells between years — the identity mistake
  // `topParty` refuses one file over.
  //
  // UNRESOLVED rows are not here at all. They have their own reported section
  // (`unmappedByListId`), and emitting `unmapped (list 4321): 700 votes` inside
  // the ranked party list put the same votes in two places, one of them where a
  // reader sums them as a party's figure.
  const displayNamesByCanonicalId = new Map<string, Set<string>>();
  for (const row of rows) {
    if (!row.canonicalPartyId || !row.partyName) continue;
    const displayNames = displayNamesByCanonicalId.get(row.canonicalPartyId) ?? new Set<string>();
    displayNames.add(row.partyName);
    displayNamesByCanonicalId.set(row.canonicalPartyId, displayNames);
  }
  const conflicts = [...displayNamesByCanonicalId.entries()]
    .filter(([, displayNames]) => displayNames.size > 1)
    .sort(([leftId], [rightId]) => leftId.localeCompare(rightId));
  if (conflicts.length > 0) {
    const details = conflicts
      .map(
        ([canonicalPartyId, displayNames]) =>
          `${canonicalPartyId} -> ${[...displayNames].sort().join(", ")}`,
      )
      .join("; ");
    if (conflicts.length === 1) {
      const [canonicalPartyId, displayNames] = conflicts[0]!;
      throw new Error(
        `votesByParty: canonical party ${canonicalPartyId} has conflicting display names: ` +
          [...displayNames].sort().join(", "),
      );
    }
    throw new Error(`votesByParty: canonical parties have conflicting display names: ${details}`);
  }

  const totals = new Map<string, { votes: number; label: string }>();
  for (const row of rows) {
    if (!row.canonicalPartyId || !row.partyName) continue;
    const entry = totals.get(row.canonicalPartyId) ?? { votes: 0, label: row.partyName };
    totals.set(row.canonicalPartyId, { votes: entry.votes + row.votes, label: entry.label });
  }
  return [...totals.values()]
    .map(({ label, votes }) => ({ label, votes }))
    .sort((a, b) => b.votes - a.votes);
}

/**
 * Whether a row carries a usable party identity.
 *
 * ONE predicate. `compare` re-derived it inline, so a row was excluded from
 * every figure there while the disclosure depended on this fold agreeing by
 * coincidence — two definitions of "resolved" that a change to either would
 * separate, leaving rows in no tally on the page at all.
 */
function isPartyResolved(
  row: ResultRow,
): row is ResultRow & { partyName: string; canonicalPartyId: string } {
  return (
    typeof row.partyName === "string" &&
    row.partyName.trim().length > 0 &&
    typeof row.canonicalPartyId === "string" &&
    row.canonicalPartyId.trim().length > 0
  );
}

export function unmappedByListId(rows: ResultRow[]): {
  entries: { listId: string; rows: number; votes: number }[];
  /**
   * Rows carrying NO list id at all, PER SOURCE KIND — not parties that failed
   * to map.
   *
   * One aggregate collapsed at least two distinct shapes (rule 2: legitimately
   * nullable historical rows, and current POSITIVO rows whose source identity
   * comes from `agrupacion_id`), and a large plausible total is how a destructive
   * filter survives review.
   */
  withoutListId: ExcludedByKind;
} {
  const totals = new Map<string, { rows: number; votes: number }>();
  const withoutListIdRows: ResultRow[] = [];
  for (const row of rows) {
    if (isPartyResolved(row)) continue;
    if (row.listId === null) {
      // NOT a list id that failed to map. Historical persisted rows may
      // legitimately carry null, while current source identity comes from
      // `agrupacion_id`; these are non-party rows. Bucketing them under
      // "resolved to no curated party" reports a shape the source never had.
      withoutListIdRows.push(row);
      continue;
    }
    const entry = totals.get(row.listId) ?? { rows: 0, votes: 0 };
    totals.set(row.listId, { rows: entry.rows + 1, votes: entry.votes + row.votes });
  }
  return {
    entries: [...totals.entries()]
      .map(([listId, tally]) => ({ listId, ...tally }))
      .sort((a, b) => b.votes - a.votes),
    withoutListId: tallyByKind(withoutListIdRows),
  };
}
