import type { ReactNode } from "react";
import { GranularityBadge } from "@/components/GranularityBadge";
import { JuxtapositionBadge } from "@/components/JuxtapositionBadge";
import type { ElectionFigure } from "@/components/JuxtapositionBadge";
import { ProvenanceLink } from "@/components/ProvenanceLink";
import {
  createResultsRepository,
  fetchSourceRefs,
  type BaseQuery,
  type PartyMappingContext,
  type ResultRow,
  type ResultsRepository,
} from "@/lib/fiscalizacion/repository";
import { createSupabaseServerClient } from "@/lib/supabase/server-client";
import { GRANULARITY } from "@/lib/results/types";
import type { Coverage, Granularity, SourceRef } from "@/lib/results/types";

/**
 * fiscalizacion-analysis spec, Requirement 8. The 26 Oct 2025 fiscalización
 * sheet's sourced coverage (design.md D9.2): 93 of 153 Coronel Rosales
 * mesas, exactly the mesas where the party had a fiscal present — never a
 * random sample. This is the ONLY coverage value this route ever supplies;
 * the route does not accept an operator-controlled coverage override.
 */
export const FISCALIZACION_COVERAGE: Coverage = {
  observedUnits: 93,
  denominatorUnits: 153,
  denominatorBasis: "distinct mesa_id, distrito_id=02 seccion_id=027 (26 Oct 2025)",
  isRandomSample: false,
};

/**
 * The curated `party_mapping` scope for this route (task 15.14): this page
 * is always the 26 Oct 2025 national legislativas race, so the scope is a
 * fixed constant rather than derived from the request — same pattern as
 * `FISCALIZACION_COVERAGE`.
 */
export const FISCALIZACION_PARTY_CONTEXT: PartyMappingContext = {
  year: 2025,
  jurisdiction: "national",
  category: "DIPUTADO NACIONAL",
};

/**
 * The ONE election `FISCALIZACION_COVERAGE` and `FISCALIZACION_PARTY_CONTEXT`
 * were verified against.
 *
 * Both constants are fixed while `electionId` and `categoryId` came from the
 * query string, so a request for any other race got ITS rows labelled with
 * this race's identity, this race's 93-of-153 coverage denominator, and party
 * names resolved against the wrong `(year, category)` mapping. The route now
 * refuses such a request rather than mislabelling it.
 */
export const FISCALIZACION_ELECTION = {
  electionId: "2025-legislativas-nacional",
  electionLabel: "26 Oct 2025 national legislative",
} as const;

/**
 * The jurisdiction and category the constants above describe.
 *
 * `denominatorBasis` says `distrito_id=02 seccion_id=027` and the party
 * context says `DIPUTADO NACIONAL`, but both `jurisdictionId` and
 * `categoryId` arrived from the query string, so a senadores request for
 * another jurisdiction got its rows labelled with Coronel Rosales's
 * 93-of-153 denominator and resolved through the diputados mapping. Guarding
 * only `electionId` fixed one axis of three.
 *
 * These are database ids, so they are configuration rather than literals.
 * Absent configuration the route refuses: an unpinned scope is exactly the
 * mislabelling this guard exists to prevent.
 */
export function fiscalizacionScope(): { jurisdictionId?: string; categoryId?: string } {
  return {
    ...(process.env["FISCALIZACION_JURISDICTION_ID"]
      ? { jurisdictionId: process.env["FISCALIZACION_JURISDICTION_ID"] }
      : {}),
    ...(process.env["FISCALIZACION_CATEGORY_ID"]
      ? { categoryId: process.env["FISCALIZACION_CATEGORY_ID"] }
      : {}),
  };
}

/**
 * Every reason a request falls outside the scope the constants were verified
 * against, or `null` when it is in scope.
 */
export function outOfScopeReason(request: {
  electionId: string;
  jurisdictionId: string;
  categoryId: string;
}): string | null {
  if (request.electionId !== FISCALIZACION_ELECTION.electionId) {
    return (
      `this route only serves ${FISCALIZACION_ELECTION.electionLabel} ` +
      `(${FISCALIZACION_ELECTION.electionId}); got ${request.electionId}`
    );
  }

  const scope = fiscalizacionScope();
  if (!scope.jurisdictionId || !scope.categoryId) {
    return (
      "FISCALIZACION_JURISDICTION_ID and FISCALIZACION_CATEGORY_ID are not " +
      "configured, so the coverage denominator and party mapping cannot be " +
      "shown to describe the requested scope"
    );
  }
  if (request.jurisdictionId !== scope.jurisdictionId) {
    return (
      `the 93-of-153 coverage denominator describes one jurisdiction ` +
      `(${scope.jurisdictionId}); got ${request.jurisdictionId}`
    );
  }
  if (request.categoryId !== scope.categoryId) {
    return (
      `the party mapping was verified for ${FISCALIZACION_PARTY_CONTEXT.category} ` +
      `(${scope.categoryId}); got ${request.categoryId}`
    );
  }
  return null;
}

export type FiscalizacionQuery = BaseQuery;

/**
 * Coarsest to finest.
 *
 * This is a HAND-WRITTEN ordering over the shared `GRANULARITY` values, not a
 * derivation of them: a level added to that const would be silently absent
 * here and every row carrying it would be reported as `distrito`, a claim
 * nobody made. `test_granularity_order_covers_every_shared_level` is what actually
 * enforces the correspondence.
 */
export const GRANULARITY_ORDER: Granularity[] = [
  GRANULARITY.DISTRITO,
  GRANULARITY.SECCION,
  GRANULARITY.CIRCUITO,
  GRANULARITY.ESTABLECIMIENTO,
  GRANULARITY.MESA,
];

export type FiscalizacionView =
  | { status: "refused"; reason: string }
  | { status: "ok"; rows: ResultRow[]; coverage: Coverage };

/**
 * The single function through which this route reaches fiscalización
 * data. It always calls `repository.queryFiscalizacion` with an explicit
 * `coverage` opt-in — never `queryOfficial`, and never a second query
 * path (spec Requirement 8, scenario "The route requests fiscalización
 * explicitly"). Coverage is NOT OVERRIDABLE (scenario "The route refuses to
 * render without coverage"): there is no parameter through which a caller
 * could supply none, so an unlabelled figure is unreachable by construction
 * rather than by a runtime check.
 */
export async function loadFiscalizacionView(
  repository: ResultsRepository,
  query: FiscalizacionQuery,
): Promise<FiscalizacionView> {
  // `FISCALIZACION_COVERAGE` is the ONLY coverage this route has, so there is
  // no reachable "coverage missing" state to refuse. The parameter that used
  // to allow one could only ever be exercised by its own test -- a guard whose
  // only call sites are tests is the defect, not the protection. What keeps an
  // unlabelled figure unreachable is that the constant is not overridable at
  // all, and `outOfScopeReason` refuses any request the constant does not
  // describe.
  const coverage = FISCALIZACION_COVERAGE;

  const response = await repository.queryFiscalizacion(
    query,
    { coverage },
    FISCALIZACION_PARTY_CONTEXT,
  );

  if (response.status !== "ok") {
    return { status: "refused", reason: response.reason };
  }

  return { status: "ok", rows: response.rows, coverage };
}

/** An official figure, narrowed so it cannot be handed to the wrong slot. */
export type OfficialFigure = ElectionFigure & {
  sourceKind: "official";
  partyName: string;
  /**
   * The archive entries the figure was computed from.
   *
   * Reading the share out of `result_row` instead of the query string fixed
   * where the number comes from; dropping its `archiveEntryId` left the
   * DISPLAYED figure just as untraceable. The comparison election is a
   * different archive entry from the fiscalización rows, so its sources have
   * to travel with it.
   */
  archiveEntryIds: string[];
};

/** A computed figure, or the reason there is none. */
export type ShareResult =
  | { status: "ok"; sharePercent: number }
  | { status: "unavailable"; reason: string };

/** The top party, plus what had to be skipped to find it. */
export interface TopPartyResult {
  /** `null` when nothing resolved, when the top is TIED, or when refused. */
  partyName: string | null;
  /**
   * Why no party was selected, when that is not simply "nothing resolved".
   *
   * `partyName: null` had three causes and one message, so a row set that
   * mapped perfectly but mixed granularity levels was reported as "no row
   * resolved to a curated party" -- a statement that is false about every row
   * in it.
   */
  refusedReason: string | null;
  /** Whether two or more parties share the top position. */
  tied: boolean;
  /** Rows whose list id resolved to no curated party. */
  unmappedRows: number;
  /** Votes on those rows. Reported, never silently excluded. */
  unmappedVotes: number;
  /** Those votes broken down by the list id that failed to resolve. */
  unmappedByListId: { listId: string; votes: number }[];
}

/**
 * Whether these rows may be combined into one figure at all.
 *
 * Official and fiscalización numbers are never summed together, and this is
 * the AGGREGATES' own guard: the caller checking before it calls them is
 * precisely "blocking one path is not blocking the others".
 */
export function mixedSourceKindReason(rows: ResultRow[]): string | null {
  const kinds = new Set(rows.map((row) => row.sourceKind));
  if (kinds.size <= 1) return null;
  // The aggregates' OWN guard, not the caller's. `renderFiscalizacionView`
  // checking before it calls them is precisely "blocking one path is not
  // blocking the others" -- `loadOfficialComparison` calls `partyShare` on a
  // different row set entirely.
  return (
    `rows mix source kinds (${[...kinds].sort().join(", ")}); official and ` +
    "fiscalización figures are never combined in one number"
  );
}

/**
 * Whether these rows can be SUMMED, given what each level contains.
 *
 * A `seccion` row already CONTAINS the `mesa` rows beneath it, so adding them
 * double-counts. `partyShare` refused mixed levels while `topParty` and the
 * rendered per-party list summed the very same rows -- two contradictory
 * rules over one row set, and the inflated total could flip which party the
 * whole juxtaposition reported.
 */
export function mixedGranularityReason(rows: ResultRow[]): string | null {
  const levels = new Set(rows.map((row) => row.granularity));

  // An unknown level is unsummable even when it is the ONLY one present:
  // this module cannot say what it contains, so it cannot say the rows do not
  // overlap. Keying on `size <= 1` let a uniformly `subcircuito` set through,
  // and `coarsestGranularity` then labelled the computed share `distrito` --
  // a level no row claimed.
  const unknown = [...levels].filter((level) => !GRANULARITY_ORDER.includes(level)).sort();
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

/**
 * The party with the most votes among the rows, or `null` when no row
 * resolved to a party at all.
 *
 * Rows are summed PER PARTY before ranking. `result_row` holds one row per
 * `(mesa, list)` and nothing in the query path groups them, so ranking raw
 * rows ranked a single mesa's single list. One party can also appear under
 * several list ids in one file, which is why the aggregation keys on the
 * resolved name rather than on `listId`.
 */
export function topParty(rows: ResultRow[]): TopPartyResult {
  // Refuses to RANK an inflated total -- but unmappability is independent of
  // granularity, so the unmapped tally is still computed and reported below.
  // Zeroing it hid the per-list-id breakdown entirely whenever levels were
  // mixed: a silent exclusion behind a plausible total.
  const refusedReason = mixedSourceKindReason(rows) ?? mixedGranularityReason(rows);

  const votesByParty = new Map<string, number>();
  for (const row of rows) {
    // An unmapped row keeps its votes in the denominator, but it can never BE
    // the answer: naming a party we could not resolve is exactly the
    // fabrication the unmapped state exists to prevent. `partyName` is absent
    // (not merely null) when no `PartyNameSource` was supplied at all, and
    // both mean the same thing here -- unresolved.
    const name = row.partyName;
    if (!name) continue;
    votesByParty.set(name, (votesByParty.get(name) ?? 0) + row.votes);
  }

  let top: string | null = null;
  let topVotes = -1;
  let tied = false;
  for (const [name, votes] of votesByParty) {
    if (votes > topVotes) {
      top = name;
      topVotes = votes;
      tied = false;
    } else if (votes === topVotes) {
      tied = true;
    }
  }
  if (tied) {
    // `votes > topVotes` kept whichever party the Map saw first, i.e. row
    // order, and that name then selected which party the whole cross-election
    // juxtaposition reported. A tie is ambiguous, not decided by input order.
    top = null;
  }

  const unmapped = rows.filter((row) => !row.partyName);
  // PER LIST ID, not one aggregate. One id covering 40 % of the votes and
  // forty ids covering 1 % each render identically as a total, and a large
  // plausible total is exactly how a destructive filter survives review.
  const byListId = new Map<string, number>();
  for (const row of unmapped) {
    const key = row.listId ?? "(no list id)";
    byListId.set(key, (byListId.get(key) ?? 0) + row.votes);
  }

  return {
    partyName: refusedReason ? null : top,
    refusedReason,
    // A "tie" computed from an untrustworthy total is not a finding. When the
    // rows cannot be summed at all, `tied` is an ARTIFACT of the same bad
    // arithmetic -- and reporting it told the operator a measured,
    // factual-sounding thing that is not true. The refusal is the cause.
    tied: refusedReason ? false : tied,
    unmappedRows: unmapped.length,
    unmappedVotes: unmapped.reduce((sum, row) => sum + row.votes, 0),
    unmappedByListId: [...byListId.entries()]
      .map(([listId, votes]) => ({ listId, votes }))
      .sort((a, b) => b.votes - a.votes),
  };
}

/**
 * One party's share of ALL votes in `rows`, or `null` when that party has no
 * rows at all.
 *
 * `null` rather than `0`: a party that did not stand in an election has no
 * share, and rendering 0 % beside a real figure reads as a collapse it never
 * suffered. Unmapped rows stay in the denominator -- they are votes that were
 * cast, and excluding them would inflate every share.
 */
export function partyShare(rows: ResultRow[], partyName: string): ShareResult {
  const mixed = mixedSourceKindReason(rows) ?? mixedGranularityReason(rows);
  if (mixed) {
    return { status: "unavailable", reason: mixed };
  }

  const totalVotes = rows.reduce((sum, row) => sum + row.votes, 0);
  if (totalVotes === 0) {
    return { status: "unavailable", reason: "no votes in the returned rows" };
  }

  const matching = rows.filter((row) => row.partyName === partyName);
  if (matching.length === 0) {
    // `unavailable`, never 0 %: a party that did not stand has no share, and
    // a rendered 0 reads as a collapse it never suffered.
    return { status: "unavailable", reason: `no rows for ${partyName}` };
  }

  const partyVotes = matching.reduce((sum, row) => sum + row.votes, 0);
  return {
    status: "ok",
    sharePercent: Number(((partyVotes / totalVotes) * 100).toFixed(2)),
  };
}

/**
 * Coarsest granularity present among the rows.
 *
 * A single badge describes the whole list, so deriving it from `rows[0]`
 * described one row and the `?? "mesa"` fallback UPGRADED an unknown to the
 * finest granularity available -- the opposite of what a degradation label is
 * for. Mixed rows must announce the coarsest level present, because that is
 * the strongest claim the set as a whole supports.
 */
export interface GranularityResult {
  granularity: Granularity;
  /**
   * Levels present that this module does not know how to order, with HOW
   * MUCH each covers.
   *
   * A list of names alone was rendered as a row count, so 500 rows carrying
   * one unknown level read as "1 row(s)" -- a plausible small total hiding
   * the real distribution. Same per-key shape as `unmappedByListId` and
   * `foreignByKind`.
   */
  unrecognized: { granularity: string; rows: number; votes: number }[];
}

export function coarsestGranularity(rows: ResultRow[]): GranularityResult {
  // No rows is no evidence of a fine level. Starting the fold at the finest
  // level and returning it unchanged would claim mesa granularity for an
  // empty set -- the same upgrade the `?? "mesa"` fallback performed.
  if (rows.length === 0) {
    return { granularity: GRANULARITY.DISTRITO, unrecognized: [] };
  }

  let coarsest = GRANULARITY_ORDER.length - 1;
  const unrecognized = new Map<string, { rows: number; votes: number }>();
  for (const row of rows) {
    const index = GRANULARITY_ORDER.indexOf(row.granularity);
    if (index === -1) {
      // Treated as the coarsest possible AND reported WITH its magnitude.
      // Absorbing it silently renders a plausible level while the fact that
      // rows carried an unmappable one never reaches the operator.
      const entry = unrecognized.get(row.granularity) ?? { rows: 0, votes: 0 };
      unrecognized.set(row.granularity, {
        rows: entry.rows + 1,
        votes: entry.votes + row.votes,
      });
      coarsest = 0;
      continue;
    }
    coarsest = Math.min(coarsest, index);
  }

  return {
    granularity: GRANULARITY_ORDER[coarsest] ?? GRANULARITY.DISTRITO,
    unrecognized: [...unrecognized.entries()]
      .map(([granularity, totals]) => ({ granularity, ...totals }))
      .sort((a, b) => b.votes - a.votes),
  };
}

/**
 * Pure render function, testable via `renderToStaticMarkup` without
 * mounting the async RSC page component. Every fiscalización figure MUST
 * carry a visible unofficial-source indicator AND its coverage denominator
 * (scenario "Every rendered fiscalización figure is labelled unofficial").
 * When an official `comparison` figure is supplied for context, it carries
 * its OWN, visually distinct official-source indicator (scenario "Official
 * figures are never rendered inside the fiscalización view without their
 * own label") via `JuxtapositionBadge`.
 */
export interface FiscalizacionRenderOptions {
  comparison?: OfficialFigure;
  /** Sources backing the FISCALIZACIÓN figure. */
  sources?: Parameters<typeof ProvenanceLink>[0]["sources"];
  /** Why no comparison figure was supplied, when one was requested. */
  comparisonUnavailable?: string;
  /** Sources backing the OFFICIAL figure — never merged with the above. */
  officialSources?: SourceRef[];
  /** Fiscalización archive entries that have no `source_ref` row at all. */
  missingProvenance?: string[];
}

export function renderFiscalizacionView(
  view: FiscalizacionView,
  // NAMED, not six positionals of which four were optional. This whole change
  // is about figures rendering under the wrong label; a signature where
  // inserting an argument silently shifts every one after it is that same
  // shape, one level up.
  {
    comparison,
    sources = [],
    comparisonUnavailable,
    officialSources = [],
    missingProvenance = [],
  }: FiscalizacionRenderOptions = {},
): ReactNode {
  if (view.status === "refused") {
    return (
      <main>
        <h1>Fiscalización (unofficial)</h1>
        <p role="alert">Refused: {view.reason}</p>
        {comparisonUnavailable ? (
          // Both reasons, not whichever came first. A refused view AND a
          // requested-but-impossible comparison are two separate things the
          // operator has to fix.
          <p role="note">No comparison figure: {comparisonUnavailable}</p>
        ) : null}
      </main>
    );
  }

  const { rows, coverage } = view;

  // The THIRD independent leakage path. The loader is guarded and the
  // repository filters, but this function accepts any `FiscalizacionView` a
  // caller hands it and renders every row under "Unofficial source" while
  // feeding it into the share. Blocking one path is not blocking the others.
  const official = rows.filter((row) => row.sourceKind !== "fiscalizacion");
  // PER KIND. Every other exclusion in this file breaks down; a bare total is
  // how a destructive filter survives review.
  const foreignTotals = new Map<string, { rows: number; votes: number }>();
  for (const row of official) {
    const entry = foreignTotals.get(row.sourceKind) ?? { rows: 0, votes: 0 };
    foreignTotals.set(row.sourceKind, {
      rows: entry.rows + 1,
      votes: entry.votes + row.votes,
    });
  }
  const foreignByKind = [...foreignTotals.entries()]
    .map(([sourceKind, totals]) => ({ sourceKind, ...totals }))
    .sort((a, b) => b.votes - a.votes);

  if (official.length > 0) {
    return (
      <main>
        <h1>Fiscalización (unofficial)</h1>
        <p role="alert">
          Refused: {official.length} of {rows.length} rows are not
          fiscalización. Official and fiscalización figures are never combined
          in one number. By source kind:
        </p>
        <ul>
          {foreignByKind.map((entry) => (
            <li key={entry.sourceKind}>
              {entry.sourceKind}: {entry.rows} rows, {entry.votes} votes
            </li>
          ))}
        </ul>
        {comparisonUnavailable ? (
          // Both reasons, same as the refused-view branch above. Returning
          // early dropped a requested-and-impossible comparison entirely.
          <p role="note">No comparison figure: {comparisonUnavailable}</p>
        ) : null}
      </main>
    );
  }

  // AGGREGATED per party. `result_row` holds one row per (mesa, list), so
  // rendering rows verbatim printed the same party several times with
  // different numbers and no mesa label to tell them apart -- each read as
  // that party's figure. The share calculation was fixed to aggregate; this
  // list was not.
  const mixedLevels = mixedGranularityReason(rows);
  // Computed for the non-empty render only: the empty branch shows no badge,
  // so an empty-set result was never displayed and only a unit test reached it.
  const levels = coarsestGranularity(rows);
  const unrecognizedLevels = levels.unrecognized;
  const votesByParty = (() => {
    if (mixedLevels) return [];
    const totals = new Map<string, number>();
    for (const row of rows) {
      const label = row.partyName ?? `unmapped (list ${row.listId ?? "?"})`;
      totals.set(label, (totals.get(label) ?? 0) + row.votes);
    }
    return [...totals.entries()]
      .map(([label, votes]) => ({ label, votes }))
      .sort((a, b) => b.votes - a.votes);
  })();

  // Computed for the party the comparison names, not for whichever list
  // happens to rank first here.
  const fiscalizacionShare = comparison
    ? partyShare(rows, comparison.partyName)
    : null;
  const unmapped = topParty(rows);

  return (
    <main>
      <h1>Fiscalización (unofficial)</h1>
      <p role="status">
        Unofficial source — party-internal fiscalización, not an official
        Junta Electoral result.
      </p>
      {missingProvenance.length > 0 ? (
        <p role="alert">
          {missingProvenance.length} archive entry/entries backing these
          figures have no source record ({missingProvenance.join(", ")}); those
          figures cannot be traced and must not be quoted.
        </p>
      ) : null}
      <p role="note">
        Coverage: {coverage.observedUnits} of {coverage.denominatorUnits} mesas
        — not a random sample; these are exactly the mesas where the party
        had a fiscal present.
      </p>
      {rows.length === 0 ? (
        <p>No fiscalización rows found for this jurisdiction/category/election.</p>
      ) : (
        <>
          {/* Computed HERE: the empty-rows branch above renders no badge, so
              an empty-set result was never displayed and only a unit test
              reached it. */}
          <GranularityBadge granularity={levels.granularity} />
          {unrecognizedLevels.length > 0 ? (
            <>
              <p role="alert">
                {unrecognizedLevels.reduce((sum, entry) => sum + entry.rows, 0)}{" "}
                row(s) carry a granularity this page cannot order; the level
                above is the coarsest possible, not a measured one. By level:
              </p>
              <ul>
                {unrecognizedLevels.map((entry) => (
                  <li key={entry.granularity}>
                    {entry.granularity}: {entry.rows} rows, {entry.votes} votes
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          {mixedLevels ? (
            <p role="alert">No per-party figures: {mixedLevels}.</p>
          ) : (
            <ul>
              {votesByParty.map((entry) => (
                <li key={entry.label}>
                  {entry.label}: {entry.votes} votes
                </li>
              ))}
            </ul>
          )}
          <ProvenanceLink sources={sources} />
        </>
      )}
      {unmapped.unmappedRows > 0 ? (
        <>
          <p role="note">
            {unmapped.unmappedRows} of {rows.length} rows ({unmapped.unmappedVotes}{" "}
            votes) resolved to no curated party and are excluded from every
            named-party figure below, though they remain in every denominator.
            By list id:
          </p>
          <ul>
            {unmapped.unmappedByListId.map((entry) => (
              <li key={entry.listId}>
                {entry.listId}: {entry.votes} votes
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {unmapped.tied ? (
        <p role="note">
          Two or more parties are tied at the top, so no party was selected for
          a cross-election comparison.
        </p>
      ) : null}
      {comparison && fiscalizacionShare?.status === "ok" ? (
        <JuxtapositionBadge
          fiscalizacion={{
            electionId: FISCALIZACION_ELECTION.electionId,
            electionLabel: FISCALIZACION_ELECTION.electionLabel,
            sourceKind: "fiscalizacion",
            // The SAME party the official side reports, so the two numbers
            // describe one party across two elections.
            partyName: comparison.partyName,
            sharePercent: fiscalizacionShare.sharePercent,
            coverage,
          }}
          official={comparison}
          officialSources={officialSources}
        />
      ) : null}
      {comparison && fiscalizacionShare?.status === "unavailable" ? (
        // The FISCALIZACIÓN side failing was the half of this path that was
        // never wired: the official side resolved, the badge did not render,
        // and nothing said why.
        <p role="note">
          No comparison figure: {fiscalizacionShare.reason}
        </p>
      ) : null}
      {comparisonUnavailable ? (
        // A requested comparison that could not be built says so. Rendering
        // nothing left the operator unable to tell "no comparison asked for"
        // from "asked for and impossible".
        <p role="note">No comparison figure: {comparisonUnavailable}</p>
      ) : null}
    </main>
  );
}

interface FiscalizacionPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/** Which election to compare against — never the figure itself. */
export interface ComparisonRequest {
  electionId: string;
  electionLabel: string;
  /**
   * The comparison election's own jurisdiction and category ids.
   *
   * These were taken from the 2025 request and reused verbatim to query 2023,
   * which asserted without checking. They must be supplied.
   *
   * `jurisdiction` carries NO `election_id` (migration 0001) -- one row per
   * real place, shared across every election, which is what migration 0012's
   * reconciliation established. So the same place HAS the same id in 2023 and
   * 2025, and requiring the comparison's id to equal the pinned one is a
   * sameness test rather than a coincidence. A PARTY id is the opposite: LLA
   * is `135`, `20135` and `110` across the three files, which is why the
   * party side goes through each election's own mapping instead.
   *
   * `category` is the same shape: no `election_id`, and `name` is UNIQUE
   * (migration 0001), so one row per category name across every election.
   * "DIPUTADO NACIONAL" in 2023 and in 2025 is one `category.id`, which is
   * what makes the sameness check below a check rather than a coincidence.
   */
  jurisdictionId: string;
  categoryId: string;
  /**
   * The comparison election's OWN party mapping scope. A party's list id
   * changes between files -- LLA is `135` in the 2023 PASO, `20135` in the
   * 2023 generales and `110` in 2025 -- so the two sides can only be matched
   * through each file's own `(year, jurisdiction, category)` mapping.
   */
  partyContext: PartyMappingContext;
}

/** Nothing asked for, something unservable, or a usable request. */
export type ComparisonRequestResult =
  | { status: "none" }
  | { status: "refused"; reason: string }
  | { status: "ok"; request: ComparisonRequest };

/**
 * Reads WHICH election to compare against from the request. It deliberately
 * returns no share.
 *
 * This function used to accept `compareSharePercent` from the query string and
 * stamp `sourceKind: "official"` on it, so any operator-supplied number
 * rendered with an official-source badge and no `SourceRef`. The
 * provenance-display contract requires every displayed figure to trace to an
 * archived source; that one traced to a URL. The share now comes from
 * `loadOfficialComparison`, which reads it out of `result_row`.
 *
 * A half-specified request yields none at all, so a figure never renders with
 * a missing label.
 */
export function comparisonFromParams(
  params: Record<string, string | string[] | undefined>,
): ComparisonRequestResult {
  const electionId = stringParam(params, "compareElectionId");
  const electionLabel = stringParam(params, "compareElectionLabel");
  const rawYear = stringParam(params, "compareYear");
  const category = stringParam(params, "compareCategory");
  const jurisdiction = stringParam(params, "compareJurisdiction");
  const jurisdictionId = stringParam(params, "compareJurisdictionId");
  const categoryId = stringParam(params, "compareCategoryId");

  // "Nothing was asked for" and "what was asked for is not servable" are
  // different answers. Collapsing both into `undefined` rendered the
  // fiscalización figure alone, with no sign a comparison had been requested
  // -- the same defect `loadOfficialComparison` documents one function later.
  const supplied = [
    electionId,
    electionLabel,
    rawYear,
    category,
    jurisdiction,
    jurisdictionId,
    categoryId,
  ];
  if (supplied.every((value) => value === undefined)) {
    return { status: "none" };
  }
  const missing = [
    ["compareElectionId", electionId],
    ["compareElectionLabel", electionLabel],
    ["compareYear", rawYear],
    ["compareCategory", category],
    ["compareJurisdiction", jurisdiction],
    ["compareJurisdictionId", jurisdictionId],
    ["compareCategoryId", categoryId],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);
  if (
    missing.length > 0 ||
    !electionId ||
    !electionLabel ||
    !rawYear ||
    !category ||
    !jurisdiction ||
    !jurisdictionId ||
    !categoryId
  ) {
    return {
      status: "refused",
      reason: `comparison request is missing ${missing.join(", ")}`,
    };
  }

  // Asserted, not assumed. `national` was hardcoded into the comparison
  // election's mapping context while the request could name any election --
  // including a municipal one, whose `distrito 027` is a PARTIDO rather than
  // national distrito 02 / seccion 027. Resolving that through the national
  // mapping is the scheme collision, applied to the comparison side.
  const scope = fiscalizacionScope();
  if (!scope.jurisdictionId || !scope.categoryId) {
    // REFUSES rather than skipping. Both checks below used to no-op when the
    // scope was unpinned, so this exported function passed any jurisdiction
    // or category on its own. `outOfScopeReason` refusing is the CALLER
    // refusing -- blocking one path is not blocking the others.
    return {
      status: "refused",
      reason:
        "FISCALIZACION_JURISDICTION_ID and FISCALIZACION_CATEGORY_ID are not " +
        "configured, so a comparison cannot be shown to describe the same scope",
    };
  }
  if (jurisdictionId !== scope.jurisdictionId) {
    // The primary side is pinned by `outOfScopeReason`; the comparison side
    // had no equivalent. A different jurisdiction id renders "LA LIBERTAD
    // AVANZA 60 % vs 25 %" as one party's trend across two elections in two
    // different PLACES -- the same shape as attributing Coronel Rosales's
    // votes to the whole province. The badge compares one party over time in
    // ONE place, so the place has to be the same one.
    return {
      status: "refused",
      reason:
        `a comparison must describe the same jurisdiction as the figure it ` +
        `sits beside (${scope.jurisdictionId}); got ${jurisdictionId}`,
    };
  }

  if (jurisdiction !== "national") {
    return {
      status: "refused",
      reason:
        `only a national comparison is servable: PBA's distrito 027 is a ` +
        `PARTIDO while national distrito 02 / seccion 027 is Coronel Rosales, ` +
        `and this page's crosswalk was verified for national only; got ` +
        `${jurisdiction}`,
    };
  }

  const year = Number(rawYear);
  if (!Number.isInteger(year)) {
    return { status: "refused", reason: `compareYear is not a year: ${rawYear}` };
  }

  // A juxtaposition is ONE party, in ONE place, for ONE office, across two
  // elections. Everything except the election must therefore match the pinned
  // side; the comparison used to accept any `(year, category, categoryId)`
  // tuple from the request. `compareElectionId=2023-generales` with
  // `compareYear=2025` resolved 2023 rows through the 2025 `party_mapping`,
  // where LLA is `110` rather than `20135`: the 2023 LLA rows drop out as
  // unmapped and any 2023 row carrying `110` is named LLA when it is not.
  // First four-digit run. Verified against the only election ids this
  // deployment registers -- `2023-generales`, `2023-paso`, `2023-balotaje`,
  // `2025-legislativas-nacional` -- all of which lead with the year. An id
  // without one skips the check rather than guessing.
  const declaredYear = electionId.match(/\d{4}/)?.[0];
  if (!declaredYear) {
    // REFUSED, not skipped. An id with no year makes `compareYear`
    // unverifiable, and an unverifiable year is what resolves 2023 rows
    // through the 2025 `party_mapping` -- exactly what this check exists to
    // stop. Skipping it silently accepted the case it was written for.
    return {
      status: "refused",
      reason:
        `the election id ${electionId} carries no year, so compareYear ` +
        `${year} cannot be verified against it`,
    };
  }
  if (Number(declaredYear) !== year) {
    return {
      status: "refused",
      reason: `compareYear ${year} contradicts the election id ${electionId}`,
    };
  }
  if (electionId === FISCALIZACION_ELECTION.electionId) {
    // Every other axis of a comparison is pinned to match; the ELECTION is the
    // one axis the badge exists to vary. Without this, the same race renders
    // beside itself under "cross-election juxtaposition" -- one election drawn
    // as two, labelled as a trend over time.
    return {
      status: "refused",
      reason:
        `a comparison must be a DIFFERENT election from ` +
        `${FISCALIZACION_ELECTION.electionId}; got the same one`,
    };
  }
  if (category !== FISCALIZACION_PARTY_CONTEXT.category) {
    return {
      status: "refused",
      reason:
        `a comparison must be the same office as the figure it sits beside ` +
        `(${FISCALIZACION_PARTY_CONTEXT.category}); got ${category}`,
    };
  }
  if (categoryId !== scope.categoryId) {
    return {
      status: "refused",
      reason:
        `a comparison must be the same category as the figure it sits beside ` +
        `(${scope.categoryId}); got ${categoryId}`,
    };
  }

  return {
    status: "ok",
    request: {
      electionId,
      electionLabel,
      jurisdictionId,
      categoryId,
      // Checked above, not assumed: this is the only scope whose crosswalk
      // the page has been verified against.
      partyContext: { year, jurisdiction, category },
    },
  };
}

/**
 * Builds the official comparison figure by READING the comparison election's
 * archived rows, through the same repository the rest of the route uses.
 *
 * `sourceKind` is `official` because `queryOfficial` filters to official rows,
 * not because the caller said so. Absent official rows yield NO figure: a 0 %
 * official share rendered beside a real fiscalización figure reads as a
 * measured collapse rather than as an absent source.
 */
export async function loadOfficialComparison(
  repository: ResultsRepository,
  request: ComparisonRequest & {
    /** The party to report — resolved from the fiscalización side. */
    partyName: string;
  },
): Promise<
  | { status: "ok"; figure: OfficialFigure }
  | { status: "unavailable"; reason: string }
> {
  const response = await repository.queryOfficial(
    {
      electionId: request.electionId,
      jurisdictionId: request.jurisdictionId,
      categoryId: request.categoryId,
    },
    request.partyContext,
  );

  // Three distinct outcomes -- refused query, no official rows, party absent
  // from that election -- used to collapse into one silent `undefined`, so the
  // operator saw the fiscalización figure alone with no sign that a comparison
  // had been requested and could not be built.
  if (response.status !== "ok") {
    return { status: "unavailable", reason: response.reason };
  }
  if (response.rows.length === 0) {
    return {
      status: "unavailable",
      reason: `no official rows for ${request.electionId} in this jurisdiction and category`,
    };
  }

  // VERIFIED, not assumed. The docstring claimed the `official` label holds
  // "because `queryOfficial` filters to official rows" -- and then never
  // checked. `partyShare` is no backstop either: `mixedSourceKindReason`
  // fires only when kinds MIX, so a uniformly fiscalización row set passes
  // clean and renders under the official-source badge.
  const foreign = [
    ...new Set(
      response.rows.filter((row) => row.sourceKind !== "official").map((row) => row.sourceKind),
    ),
  ].sort();
  if (foreign.length > 0) {
    return {
      status: "unavailable",
      reason: `the comparison query returned non-official rows (${foreign.join(", ")})`,
    };
  }

  // The SAME party, never this election's own winner. Reporting each side's
  // top list compared two different parties and presented it as one trend.
  const share = partyShare(response.rows, request.partyName);
  if (share.status !== "ok") {
    return {
      status: "unavailable",
      reason: `${request.electionLabel}: ${share.reason}`,
    };
  }

  return {
    status: "ok",
    figure: {
      electionId: request.electionId,
      electionLabel: request.electionLabel,
      sourceKind: "official",
      sharePercent: share.sharePercent,
      partyName: request.partyName,
      archiveEntryIds: [...new Set(response.rows.map((row) => row.archiveEntryId))],
    },
  };
}

/**
 * One query param, or why it cannot be used.
 *
 * Next.js hands `string[]` for a REPEATED param. Collapsing that to
 * `undefined` made a supplied value vanish: the page answered "Provide
 * electionId" to a request that sent it twice, and a repeated `compare*`
 * param was named in the missing list the operator had actually filled in.
 * Supplied-but-unusable is a third state, the same split this module already
 * makes between `none` and `refused`.
 */
function stringParam(
  params: Record<string, string | string[] | undefined>,
  key: string,
): string | undefined {
  const value = params[key];
  return typeof value === "string" ? value : undefined;
}

/** Every param supplied more than once, named. */
function repeatedParams(
  params: Record<string, string | string[] | undefined>,
): string[] {
  return Object.entries(params)
    .filter(([, value]) => Array.isArray(value))
    .map(([key]) => key)
    .sort();
}

/**
 * Authenticated operator route for the fiscalización capability
 * (fiscalizacion-analysis spec, Requirement 8). RSC, server-only reads —
 * reaches data ONLY through `repository.queryFiscalizacion()` via
 * `loadFiscalizacionView`.
 */
export default async function FiscalizacionPage({
  searchParams,
}: FiscalizacionPageProps): Promise<ReactNode> {
  const params = await searchParams;

  const repeated = repeatedParams(params);
  if (repeated.length > 0) {
    return renderFiscalizacionView({
      status: "refused",
      reason:
        `these query parameters were supplied more than once and cannot be ` +
        `resolved to one value: ${repeated.join(", ")}`,
    });
  }

  const electionId = stringParam(params, "electionId");
  const jurisdictionId = stringParam(params, "jurisdictionId");
  const categoryId = stringParam(params, "categoryId");

  if (!electionId || !jurisdictionId || !categoryId) {
    return (
      <main>
        <h1>Fiscalización (unofficial)</h1>
        <p>
          Provide <code>electionId</code>, <code>jurisdictionId</code> and{" "}
          <code>categoryId</code> query parameters.
        </p>
      </main>
    );
  }

  const outOfScope = outOfScopeReason({ electionId, jurisdictionId, categoryId });
  if (outOfScope) {
    // Refused, not relabelled. See `outOfScopeReason`. A comparison requested
    // in the same URL is still reported: returning here without it left the
    // operator unable to tell "no comparison asked for" from "asked for and
    // never attempted".
    const requested = comparisonFromParams(params);
    return renderFiscalizacionView(
      { status: "refused", reason: outOfScope },
      {
        ...(requested.status === "none"
          ? {}
          : {
              comparisonUnavailable:
                requested.status === "refused"
                  ? requested.reason
                  : "the request itself was refused, so no comparison was attempted",
            }),
      },
    );
  }

  const repository = await createResultsRepository();
  const view = await loadFiscalizacionView(repository, {
    electionId,
    jurisdictionId,
    categoryId,
  });

  const comparisonRequest = comparisonFromParams(params);
  // Which party to compare comes from THIS election's rows, resolved through
  // its own crosswalk. Absent it, there is nothing to match and no badge.
  const top = view.status === "ok" ? topParty(view.rows) : null;

  let comparison: OfficialFigure | undefined;
  let comparisonUnavailable: string | undefined;
  if (comparisonRequest.status === "refused") {
    comparisonUnavailable = comparisonRequest.reason;
  } else if (comparisonRequest.status === "ok") {
    if (view.status !== "ok") {
      // The VIEW was refused -- RLS denial, a failed query -- so no row was
      // ever read. Falling through to "no row resolved to a curated party"
      // sent the operator after a mapping problem that does not exist.
      comparisonUnavailable = `no rows were read: ${view.reason}`;
    } else if (view.status === "ok" && view.rows.length === 0) {
      // Zero rows resolved to nothing because there were none, not because
      // the crosswalk failed. `renderFiscalizacionView` already says this in
      // its own empty branch; the page used to contradict it.
      comparisonUnavailable =
        "no fiscalización rows were found for this jurisdiction, category and " +
        "election, so there is no party to compare";
    } else if (top?.tied) {
      // The TIE, named as such. Reporting "no row resolved to a curated
      // party" for a tie states something false: every row may have resolved.
      comparisonUnavailable =
        "two or more parties are tied at the top, so no single party could be " +
        "selected to compare";
    } else if (top?.refusedReason) {
      // The actual cause, not a catch-all. Rows can map perfectly and still
      // yield no party when their levels cannot be summed.
      comparisonUnavailable = top.refusedReason;
    } else if (!top?.partyName) {
      comparisonUnavailable = "no row resolved to a curated party to compare";
    } else {
      const result = await loadOfficialComparison(repository, {
        // The comparison's OWN ids, never this election's.
        ...comparisonRequest.request,
        partyName: top.partyName,
      });
      if (result.status === "ok") {
        comparison = result.figure;
      } else {
        comparisonUnavailable = result.reason;
      }
    }
  }

  // Fetched AFTER the comparison so the official side's own archive entries
  // are included. Fetching only the fiscalización rows' entries left the
  // official figure displayed with no `SourceRef` at all.
  const supabase = await createSupabaseServerClient();
  const fiscalizacionEntryIds = [
    ...new Set(view.status === "ok" ? view.rows.map((row) => row.archiveEntryId) : []),
  ];
  const officialEntryIds = comparison?.archiveEntryIds ?? [];
  const allEntryIds = [...new Set([...fiscalizacionEntryIds, ...officialEntryIds])];
  const fetched =
    allEntryIds.length > 0 ? await fetchSourceRefs(supabase, allEntryIds) : [];

  // SPLIT per figure. One undifferentiated list rendered the 2023 official
  // ZIP's digest under the unofficial figure, with nothing saying which
  // number it backed.
  // `fetchSourceRefs` can return FEWER refs than asked for: an archive entry
  // with no `source_ref` row yielded an empty list, and both the fiscalización
  // block and the badge then rendered a percentage with no provenance and
  // nothing saying provenance was missing.
  const isMissing = (id: string) =>
    !fetched.some((source) => source.archiveEntryId === id);
  // SPLIT per figure, like `sources`/`officialSources`. Merging them reported
  // a missing 2023 official record inside the unofficial block, as "entries
  // backing THESE figures" -- the wrong figure, and a second report of what
  // the badge's own alert already covers.
  const missingProvenance = fiscalizacionEntryIds.filter(isMissing);

  const sources = fetched.filter((source) =>
    fiscalizacionEntryIds.includes(source.archiveEntryId),
  );
  const officialSources = fetched.filter((source) =>
    officialEntryIds.includes(source.archiveEntryId),
  );

  return renderFiscalizacionView(view, {
    ...(comparison ? { comparison } : {}),
    sources,
    ...(comparisonUnavailable ? { comparisonUnavailable } : {}),
    officialSources,
    missingProvenance,
  });
}
