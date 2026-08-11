import type { ReactNode } from "react";
import Link from "next/link";
import { GranularityBadge } from "@/components/GranularityBadge";
import { JuxtapositionBadge } from "@/components/JuxtapositionBadge";
import type { ElectionFigure } from "@/components/JuxtapositionBadge";
import { ProvenanceLink } from "@/components/ProvenanceLink";
import { UnmappedListIds } from "@/components/UnmappedListIds";
import { UnorderableLevels } from "@/components/UnorderableLevels";
import {
  createResultsRepository,
  fetchElectionYear,
  fetchSourceRefs,
  unmappedByListId,
  type BaseQuery,
  type PartyMappingContext,
  type ResultRow,
  type ResultsRepository,
  describeExcluded,
  votesByParty,
} from "@/lib/fiscalizacion/repository";
import type { ExcludedByKind, YearLookup } from "@/lib/fiscalizacion/repository";
import { createSupabaseServerClient } from "@/lib/supabase/server-client";
import { repeatedParams, stringParam } from "@/lib/results/query-params";
import {
  jurisdictionTotalLevel,
  mixedGranularityReason,
  readGranularity,
  unrecognizedLevels,
} from "@/lib/results/granularity";
import { pinnedCategoryId, servedJurisdictionId } from "@/lib/results/party-family";
import type { Coverage, SourceRef } from "@/lib/results/types";
import {
  createResultsCoverageRepository,
  type CoverageResult,
} from "@/lib/results/coverage";
import {
  createResultsExplorationRepository,
  normalizeExplorationParams,
  type ExplorationFacets,
} from "@/lib/results/exploration";

/**
 * Legacy tally-view denominator. The production navigation and cold-start
 * route no longer use this fixed figure: `renderCoverageExplorer` derives its
 * denominator from official rows in the selected scope through migration 0021.
 * It remains only for old explicit UUID deep links to the pre-existing tally
 * comparison, whose contract still requires the original non-random label.
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
export function fiscalizacionElection(): { electionId?: string; electionLabel: string } {
  // CONFIGURATION, like the jurisdiction and the category beside it. A
  // hardcoded curated slug (`2025-legislativas-nacional`) can never equal the
  // uuid `election.id` actually holds, so this route refused every real
  // request before it read a single row. The LABEL stays a literal: it names
  // the race these constants were verified against, and is not an id.
  const electionId = process.env["FISCALIZACION_ELECTION_ID"];
  return {
    ...(electionId ? { electionId } : {}),
    electionLabel: "26 Oct 2025 national legislative",
  };
}

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
  // The JURISDICTION comes from the same place every other route gets it:
  // `servedJurisdictionId`, which asks `resolvePartyFamily` and so refuses the
  // SAME collision the other three routes refuse. A separate
  // `FISCALIZACION_JURISDICTION_ID` was a second identity for one Coronel
  // Rosales, joined to the first by nothing — set them differently and this
  // route pinned one id while resolving list ids through the national table
  // for another. Only the CATEGORY is this route's own.
  const served = servedJurisdictionId("national");
  const categoryId = pinnedCategoryId("FISCALIZACION");
  return {
    ...(served.status === "ok" ? { jurisdictionId: served.jurisdictionId } : {}),
    ...(categoryId ? { categoryId } : {}),
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
  const election = fiscalizacionElection();
  if (!election.electionId) {
    return (
      "FISCALIZACION_ELECTION_ID is not configured, so no request can be shown " +
      "to describe the race the coverage denominator and party mapping cover"
    );
  }
  if (request.electionId !== election.electionId) {
    return (
      `this route only serves ${election.electionLabel} ` +
      `(${election.electionId}); got ${request.electionId}`
    );
  }

  const scope = fiscalizacionScope();
  if (!scope.jurisdictionId || !scope.categoryId) {
    return (
      "NATIONAL_JURISDICTION_ID and FISCALIZACION_CATEGORY_ID are not " +
      "configured (or the national and municipal jurisdiction ids collide), " +
      "so the coverage denominator and party mapping cannot be " +
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


export type FiscalizacionView =
  | { status: "refused"; reason: string }
  | {
      status: "read_failed";
      reason: string;
      /** The breakdown counted before this failure, carried through it. */
      excluded?: ExcludedByKind;
      /** What the COMPARISON election's read dropped, counted before this failure. */
      officialExcluded?: ExcludedByKind;
      /** A comparison that was requested and could not be built. */
      comparisonUnavailable?: string;
      /** WHICH list ids failed to map, counted before this failure. */
      unmapped?: { listId: string; rows: number; votes: number }[];
      /** Why those rows cannot be summed, when they cannot. */
      unsummable?: string | null;
      /** How many rows the read returned — the real denominator. */
      totalRows?: number;
      /** Levels this app cannot order, counted before this failure. */
      unrecognized?: { granularity: string; rows: number; votes: number }[];
      /** Whether a curated mapping source was configured for the read. */
      partyMappingConfigured?: boolean;
      /** Rows carrying no list id at all, counted before the failure. */
      withoutListId?: ExcludedByKind;
    }
  | {
      status: "ok";
      rows: ResultRow[];
      coverage: Coverage;
      /**
       * Rows the source-kind filter removed, per kind.
       *
       * `queryFiscalizacion` counts them -- including the `unknown` bucket for
       * a value outside the enum, which BOTH filters drop -- and this seam used
       * to discard the count, so it existed nowhere and rendered nowhere. The
       * three sibling routes carry it through every branch.
       */
      excluded: ExcludedByKind;
      /** Whether a curated mapping source was configured for this read. */
      partyMappingConfigured: boolean;
    };

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

  // A denied read RAISES: `SupabaseRowSource.fetchRows` throws on a Postgres
  // error, so an RLS denial never arrives as a non-ok status. The three
  // sibling routes catch it; this one let it escape into the framework error
  // boundary while its test asserted a shape production cannot produce.
  let response;
  try {
    response = await repository.queryFiscalizacion(
      query,
      { coverage },
      FISCALIZACION_PARTY_CONTEXT,
    );
  } catch (error) {
    // Its OWN status, never the opt-in vocabulary: that string means "you
    // asked for unofficial figures", not "the database refused".
    return {
      status: "read_failed",
      reason: error instanceof Error ? error.message : String(error),
    };
  }

  // The coverage the RESPONSE carries, not the constant this function passed
  // in. `queryFiscalizacion` types it as required, so there is no "came back
  // without a denominator" state to guard — the compiler says so, which is
  // stronger than a branch nothing could reach.
  return {
    status: "ok",
    rows: response.rows,
    coverage: response.coverage,
    excluded: response.excluded,
    partyMappingConfigured: response.partyMappingConfigured,
  };
}

/** An official figure, narrowed so it cannot be handed to the wrong slot. */
export type OfficialFigure = ElectionFigure & {
  sourceKind: "official";
  /** The identity both sides were matched on, carried for the same match here. */
  canonicalPartyId: string;
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
  /**
   * The party's CANONICAL id — what a cross-election match keys on.
   *
   * `null` when nothing resolved, when the top is TIED, or when refused.
   */
  canonicalPartyId: string | null;
  /**
   * The same party's display name, for rendering ONLY.
   *
   * The curated file legitimately spells one canonical party "LA LIBERTAD
   * AVANZA" in 2023 and "ALIANZA LA LIBERTAD AVANZA" in 2025, so matching on
   * it across years gives the two sides zero common keys and the badge reports
   * "no rows for …" about a party that stood.
   */
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
  /** Votes on those rows. Reported, never silently excluded. */
  /** Those votes broken down by the list id that failed to resolve. */
  unmappedByListId: { listId: string; rows: number; votes: number }[];
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
 * The party with the most votes among the rows, or `null` when no row
 * resolved to a party at all.
 *
 * Rows are summed PER PARTY before ranking. `result_row` holds one row per
 * `(mesa, list)` and nothing in the query path groups them, so ranking raw
 * rows ranked a single mesa's single list. One party can also appear under
 * several list ids in one file, which is why the aggregation keys on the
 * CANONICAL PARTY ID rather than on `listId` — and not on the resolved name
 * either: a respelling between elections merges nothing, which is what
 * `test_a_party_respelled_between_elections_still_matches` exists for.
 */
export function topParty(rows: ResultRow[]): TopPartyResult {
  // Refuses to RANK an inflated total -- but unmappability is independent of
  // granularity, so the unmapped tally is still computed and reported below.
  // Zeroing it hid the per-list-id breakdown entirely whenever levels were
  // mixed: a silent exclusion behind a plausible total.
  const refusedReason = mixedSourceKindReason(rows) ?? mixedGranularityReason(rows);

  // Keyed on the CANONICAL id, labelled by the display name. Keying on the
  // name merged nothing across a respelling and split one party in two within
  // a year if the curated file ever spelled it two ways.
  // NOT `votesByParty`: that name belongs to the imported fold, and shadowing
  // it here made the one identity boundary unreachable by name in this scope.
  const totalsByParty = new Map<string, { votes: number; displayName: string }>();
  for (const row of rows) {
    // An unmapped row keeps its votes in the denominator, but it can never BE
    // the answer: naming a party we could not resolve is exactly the
    // fabrication the unmapped state exists to prevent. Both fields are absent
    // (not merely null) when no `PartyNameSource` was supplied at all, and
    // that means the same thing here -- unresolved.
    const id = row.canonicalPartyId;
    const name = row.partyName;
    if (!id || !name) continue;
    const entry = totalsByParty.get(id) ?? { votes: 0, displayName: name };
    totalsByParty.set(id, { votes: entry.votes + row.votes, displayName: entry.displayName });
  }

  let top: { id: string; displayName: string } | null = null;
  let topVotes = -1;
  let tied = false;
  for (const [id, entry] of totalsByParty) {
    if (entry.votes > topVotes) {
      top = { id, displayName: entry.displayName };
      topVotes = entry.votes;
      tied = false;
    } else if (entry.votes === topVotes) {
      tied = true;
    }
  }
  if (tied) {
    // `votes > topVotes` kept whichever party the Map saw first, i.e. row
    // order, and that name then selected which party the whole cross-election
    // juxtaposition reported. A tie is ambiguous, not decided by input order.
    top = null;
  }

  // PER LIST ID, not one aggregate. One id covering 40 % of the votes and
  // forty ids covering 1 % each render identically as a total, and a large
  // plausible total is exactly how a destructive filter survives review.
  return {
    canonicalPartyId: refusedReason ? null : (top?.id ?? null),
    partyName: refusedReason ? null : (top?.displayName ?? null),
    refusedReason,
    // A "tie" computed from an untrustworthy total is not a finding. When the
    // rows cannot be summed at all, `tied` is an ARTIFACT of the same bad
    // arithmetic -- and reporting it told the operator a measured,
    // factual-sounding thing that is not true. The refusal is the cause.
    tied: refusedReason ? false : tied,
    // THE exported fold, in BOTH units. This was a third local copy reporting
    // votes only, so one list id at 400 votes across 1 row and across 200 rows
    // rendered identically — the shape `ExcludedByKind` names in its own doc.
    unmappedByListId: unmappedByListId(rows).entries,
  };
}

/**
 * One party's share of ALL votes in `rows`, or `{ status: "unavailable" }`
 * carrying the reason when no share can be computed.
 *
 * `unavailable` rather than `0`: a party that did not stand in an election has
 * no share, and rendering 0 % beside a real figure reads as a collapse it never
 * suffered. Callers branch on `.status`; there is no `null` to check for. Unmapped rows stay in the denominator -- they are votes that were
 * cast, and excluding them would inflate every share.
 */
export function partyShare(
  rows: ResultRow[],
  canonicalPartyId: string,
  // For the REASON only. `no rows for canon-110` names an internal id at an
  // operator; the match still keys on the id.
  displayName: string = canonicalPartyId,
): ShareResult {
  const mixed = mixedSourceKindReason(rows) ?? mixedGranularityReason(rows);
  if (mixed) {
    return { status: "unavailable", reason: mixed };
  }

  const totalVotes = rows.reduce((sum, row) => sum + row.votes, 0);
  if (totalVotes === 0) {
    return { status: "unavailable", reason: "no votes in the returned rows" };
  }

  // On the CANONICAL id. Matching display names across two elections gave the
  // sides zero common keys whenever the curated file respelled a party, and
  // the badge then reported "no rows for …" about a party that stood.
  const matching = rows.filter((row) => row.canonicalPartyId === canonicalPartyId);
  if (matching.length === 0) {
    // `unavailable`, never 0 %: a party that did not stand has no share, and
    // a rendered 0 reads as a collapse it never suffered.
    return { status: "unavailable", reason: `no rows for ${displayName}` };
  }

  const partyVotes = matching.reduce((sum, row) => sum + row.votes, 0);
  return {
    status: "ok",
    sharePercent: Number(((partyVotes / totalVotes) * 100).toFixed(2)),
  };
}

interface CoverageFormSelection {
  electionId?: string;
  categoryId?: string;
  distritoCode?: string;
  seccionCode?: string;
}

function coverageOptionLabel(code: string, name: string | null): string {
  return name ? `${code} — ${name}` : code;
}

function CoverageExplorerForm({
  facets,
  selected,
}: {
  facets: ExplorationFacets;
  selected: CoverageFormSelection;
}): ReactNode {
  return (
    <form action="/fiscalizacion" method="get">
      <label htmlFor="coverage-election">Election</label>{" "}
      <select id="coverage-election" name="electionId" defaultValue={selected.electionId ?? ""}>
        <option value="">Choose an election</option>
        {facets.elections.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
      </select>{" "}
      <label htmlFor="coverage-category">Category</label>{" "}
      <select id="coverage-category" name="categoryId" defaultValue={selected.categoryId ?? ""}>
        <option value="">Choose a category</option>
        {facets.categories.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
      </select>{" "}
      <label htmlFor="coverage-distrito">Distrito</label>{" "}
      <select id="coverage-distrito" name="distritoCode" defaultValue={selected.distritoCode ?? ""}>
        <option value="">Choose a distrito</option>
        {facets.distritos.map((option) => <option key={option.code} value={option.code}>
          {coverageOptionLabel(option.code, option.name)}
        </option>)}
      </select>{" "}
      <label htmlFor="coverage-seccion">Sección</label>{" "}
      <select id="coverage-seccion" name="seccionCode" defaultValue={selected.seccionCode ?? ""}>
        <option value="">Choose a sección</option>
        {facets.secciones.map((option) => <option key={option.code} value={option.code}>
          {coverageOptionLabel(option.code, option.name)}
        </option>)}
      </select>{" "}
      <button type="submit">Show coverage</button>
    </form>
  );
}

function coverageCounts(counts: Record<string, number>): string {
  return Object.entries(counts).map(([reason, count]) => `${reason}: ${count}`).join(", ");
}

function coverageExclusions(result: CoverageResult): ReactNode {
  if (result.status !== "ok" || result.exclusions.length === 0) return null;
  return (
    <ul aria-label="Coverage exclusions">
      {result.exclusions.map((entry) => (
        <li key={entry.reason}>{entry.reason}: {entry.rows} row(s), {entry.votes} vote(s)</li>
      ))}
    </ul>
  );
}

async function renderCoverageExplorer(
  params: Record<string, string | string[] | undefined>,
): Promise<ReactNode> {
  const repeated = repeatedParams(params);
  if (repeated.length > 0) {
    return <main><h1>Fiscalización coverage</h1><p role="alert">
      Refused: repeated query parameters cannot identify one scope ({repeated.join(", ")}).
    </p></main>;
  }
  const electionId = stringParam(params, "electionId");
  const categoryId = stringParam(params, "categoryId");
  const rawDistritoCode = stringParam(params, "distritoCode");
  const rawSeccionCode = stringParam(params, "seccionCode");
  const normalized = normalizeExplorationParams({
    ...(rawDistritoCode ? { distritoCode: rawDistritoCode } : {}),
    ...(rawSeccionCode ? { seccionCode: rawSeccionCode } : {}),
  });
  if (normalized.status === "invalid") {
    return <main><h1>Fiscalización coverage</h1><p role="alert">
      Refused: {normalized.reason}. {coverageCounts(normalized.counts)}.
    </p></main>;
  }
  const selected: CoverageFormSelection = {
    ...(electionId ? { electionId } : {}), ...(categoryId ? { categoryId } : {}),
    ...(normalized.value.distritoCode ? { distritoCode: normalized.value.distritoCode } : {}),
    ...(normalized.value.seccionCode ? { seccionCode: normalized.value.seccionCode } : {}),
  };
  let client;
  let facets;
  try {
    client = await createSupabaseServerClient();
    facets = await createResultsExplorationRepository(client).facets(selected);
  } catch (error) {
    return <main><h1>Fiscalización coverage</h1><p role="alert">
      Refused: {error instanceof Error ? error.message : String(error)}
    </p></main>;
  }
  const form = <CoverageExplorerForm facets={facets} selected={selected} />;
  const distritoCode = normalized.value.distritoCode;
  const seccionCode = normalized.value.seccionCode;
  if (!electionId || !categoryId || !distritoCode || !seccionCode) {
    return <main><h1>Fiscalización coverage</h1>{form}<p role="status">
      Choose the available election, category, distrito and sección. The resulting URL is reusable.
    </p></main>;
  }
  let result;
  try {
    result = await createResultsCoverageRepository(client).coverage({
      electionId, categoryId, distritoCode, seccionCode,
    });
  } catch (error) {
    return <main><h1>Fiscalización coverage</h1>{form}<p role="alert">
      Refused: {error instanceof Error ? error.message : String(error)}
    </p></main>;
  }
  if (result.status !== "ok") {
    return <main><h1>Fiscalización coverage</h1>{form}<p role="alert">
      Refused: {result.reason}. {coverageCounts(result.counts)}.
    </p></main>;
  }
  const archiveIds = [...result.provenance.officialArchiveEntryIds,
    ...result.provenance.fiscalizacionArchiveEntryIds];
  let sources: SourceRef[];
  try {
    const provenance = await fetchSourceRefs(client, archiveIds);
    if (provenance.missing.length > 0 || provenance.sources.length !== archiveIds.length) {
      return <main><h1>Fiscalización coverage</h1>{form}<p role="alert">
        Refused: coverage provenance is incomplete ({provenance.missing.join(", ")}).
      </p></main>;
    }
    sources = provenance.sources;
  } catch (error) {
    return <main><h1>Fiscalización coverage</h1>{form}<p role="alert">
      Refused: {error instanceof Error ? error.message : String(error)}
    </p></main>;
  }
  const uncovered = result.mesas.filter((mesa) => !mesa.covered).length;
  return (
    <main>
      <h1>Fiscalización coverage</h1>
      {form}
      <p role="note">
        Uncovered means no fiscalización presence, not zero or missing official votes.
        Official results remain separate.
      </p>
      <p role="status">
        {result.mesasCoverage.observedUnits} covered of {result.mesasCoverage.denominatorUnits} official mesas;
        {" "}{uncovered} uncovered. This is not a random sample.
      </p>
      <p>Scope: election {result.electionYear} {result.electionRound}, distrito {result.distritoCode},
        sección {result.seccionCode}. Coverage is {result.isRandomSample ? "random" : "not a random sample"}.</p>
      <h2>Mesas</h2>
      <table>
        <caption>Fiscalización presence by official mesa</caption>
        <thead><tr><th scope="col">Mesa</th><th scope="col">Escuela</th><th scope="col">Coverage</th><th scope="col">Official result</th></tr></thead>
        <tbody>{result.mesas.map((mesa) => <tr key={`${mesa.circuitoCode ?? "unknown"}-${mesa.code}`}>
          <th scope="row">{mesa.code}</th>
          <td>{mesa.establecimientoName ?? mesa.establecimientoCode ?? "School identity unavailable"}</td>
          <td>{mesa.covered ? "Fiscal present" : "No fiscal present"}</td>
          <td>{mesa.officialResultHref ? <Link href={mesa.officialResultHref}>View official votes</Link>
            : "Official-result link unavailable: complete source identity is absent"}</td>
        </tr>)}</tbody>
      </table>
      <h2>Escuelas</h2>
      {result.escuelas.status === "source_unavailable" ? <p role="alert">
        {result.escuelas.reason}. {result.escuelas.exclusions.map((entry) =>
          `${entry.reason}: ${entry.rows} row(s), ${entry.votes} vote(s)`).join(", ")}.
      </p> : <ul aria-label="School coverage">{result.escuelas.items.map((school) =>
        <li key={`${school.circuitoCode}-${school.code}`}>
        Circuito {school.circuitoCode} — {school.name ?? school.code}: {school.observedUnits} of
        {" "}{school.denominatorUnits} mesas covered; not a random sample. {" "}
        <Link href={school.officialResultHref}>View school official votes</Link>
      </li>)}</ul>}
      {coverageExclusions(result)}
      <p role="note">Source audit: {result.sourceAudit.map((entry) =>
        `${entry.kind}: ${entry.rows} rows / ${entry.votes} votes / ${entry.mesas} mesas`).join(", ")}.</p>
      <p role="note">Denominator audit: {result.denominatorAudit.map((entry) =>
        `${entry.kind}: ${entry.rows} rows / ${entry.votes} votes / ${entry.mesas} mesas`).join(", ")}.</p>
      <ProvenanceLink sources={sources} />
    </main>
  );
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
  /** The same, for the OFFICIAL figure — reported in its own section. */
  officialMissingProvenance?: string[];
  /**
   * What the COMPARISON election's read dropped, per kind.
   *
   * Its own note, never merged with the fiscalización read's: they are
   * different queries over different rows, and one cannot describe the other.
   */
  officialExcluded?: ExcludedByKind;
}

/** The source-kind filter's breakdown, or nothing when it dropped nothing. */
function renderExcludedNote(excluded: ExcludedByKind | undefined): ReactNode {
  const summary = describeExcluded(excluded ?? {});
  if (summary === null) return null;
  return (
    <p role="note">
      {summary} were excluded by the fiscalización-source filter and are not in
      any figure on this page.
    </p>
  );
}

/**
 * The COMPARISON election's read tally — one renderer for all three branches.
 *
 * Three copies drifted: the leakage refusal never rendered it at all, so a
 * drop this read counted vanished behind a refusal about a different one.
 */
function renderComparisonExcludedNote(excluded: ExcludedByKind | undefined): ReactNode {
  const tally = describeExcluded(excluded ?? {});
  if (tally === null) return null;
  return (
    <p role="note">
      The comparison election&apos;s own read excluded {tally}.
    </p>
  );
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
    officialMissingProvenance = [],
    officialExcluded,
  }: FiscalizacionRenderOptions = {},
): ReactNode {
  // `read_failed` renders the same way but is a DIFFERENT state: a denied
  // read is not a refusal to serve unofficial figures.
  if (view.status !== "ok") {
    return (
      <main>
        <h1>Fiscalización (unofficial)</h1>
        <p role="alert">Refused: {view.reason}</p>
        {/* NO provenance alert on this branch, and no `render if present`
            either: that made a branch no production input can reach. Every
            non-ok path here is the year-read catch, the pinned-election
            refusal, the out-of-scope refusal, or the `fetchSourceRefs` catch —
            none has an entry-id list, because the read that would have produced
            one refused or failed. Unlike the path-3 guards, there is no seam to
            regress, so a test could only fabricate the state. */}
        {view.status === "read_failed" ? renderExcludedNote(view.excluded) : null}
        {view.status === "read_failed" && view.unmapped ? (
          <UnmappedListIds
            entries={view.unmapped}
            withoutListId={view.withoutListId}
            totalRows={view.totalRows ?? 0}
            unsummable={view.unsummable ?? null}
            mappingConfigured={view.partyMappingConfigured ?? true}
          />
        ) : null}
        {view.status === "read_failed" && view.unrecognized ? (
          <UnorderableLevels entries={view.unrecognized} />
        ) : null}
        {/* From the VIEW on this branch: the `fetchSourceRefs` catch rebuilds a
            `read_failed` after a comparison was already read, so its tally
            exists here even though no entry-id list does. */}
        {renderComparisonExcludedNote(
          (view.status === "read_failed" ? view.officialExcluded : undefined) ??
            officialExcluded,
        )}

        {view.status === "read_failed" && view.comparisonUnavailable ? (
          <p role="note">No comparison figure: {view.comparisonUnavailable}</p>
        ) : null}
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
  // Rendered on EVERY branch. The count existed, was carried to the view, and
  // was then read by nothing — the field's own docstring described a fix this
  // seam never applied.
  const excludedNote = renderExcludedNote(view.excluded);

  // The THIRD independent leakage path. The loader is guarded and the
  // repository filters, but this function accepts any `FiscalizacionView` a
  // caller hands it and renders every row under "Unofficial source" while
  // feeding it into the share. Blocking one path is not blocking the others.
  // AGGREGATED per party. `result_row` holds one row per (mesa, list), so
  // rendering rows verbatim printed the same party several times with
  // different numbers and no mesa label to tell them apart -- each read as
  // that party's figure. The share calculation was fixed to aggregate; this
  // list was not.
  const mixedLevels = mixedGranularityReason(rows);
  const unorderable = unrecognizedLevels(rows);
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
        {excludedNote}
        {/* The third branch. A regression in the repository filter selects this
            path, and the comparison read's tally was counted before it — the
            same "drop hidden behind a refusal about something else" this file
            refuses everywhere else. */}
        {renderComparisonExcludedNote(officialExcluded)}
        {/* WHICH list ids failed to map does not depend on source kinds. This
            branch returned before `topParty` ran, so they were never named —
            the third divergent copy of one decision the siblings carry. */}
        <UnmappedListIds
          entries={unmappedByListId(rows).entries}
          withoutListId={unmappedByListId(rows).withoutListId}
          totalRows={rows.length}
          unsummable={mixedLevels}
          mappingConfigured={view.partyMappingConfigured}
        />
        {/* And the levels this page cannot order — rows it excludes from every
            figure, which is a fact about a different axis than source kind. */}
        <UnorderableLevels entries={unorderable} />
        {officialMissingProvenance.length > 0 ? (
          // Its OWN alert, independent of the badge. The badge renders only when
          // a comparison AND an ok share exist, so an untraceable OFFICIAL entry
          // was counted and then read by nothing whenever the share was
          // unavailable — or whenever a refusal returned before the badge.
          <p role="alert">
            {officialMissingProvenance.length} archive entry/entries backing the
            official comparison figure have no source record (
            {officialMissingProvenance.join(", ")}); that figure cannot be traced
            and must not be quoted.
          </p>
        ) : null}
        {missingProvenance.length > 0 ? (
          <p role="alert">
            {missingProvenance.length} archive entry/entries backing these
            figures have no source record ({missingProvenance.join(", ")}); those
            figures cannot be traced and must not be quoted.
          </p>
        ) : null}
      </main>
    );
  }

  // The two boundary functions directly, like `drilldown` and `municipal`. A
  // page-local wrapper gave the same question a second shape, so a change to
  // what `readGranularity` reports would land in one and not the other.
  const levels = readGranularity(rows);
  const partyTotals = mixedLevels !== null ? [] : votesByParty(rows);

  // Computed for the party the comparison names, not for whichever list
  // happens to rank first here.
  const fiscalizacionShare = comparison
    ? partyShare(rows, comparison.canonicalPartyId, comparison.partyName)
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
      {excludedNote}
      {/* Its OWN note. Merging it into the fiscalización read's would state one
          query's drops as another's. */}
      {renderComparisonExcludedNote(officialExcluded)}
      {officialMissingProvenance.length > 0 ? (
        // Its OWN alert, independent of the badge. The badge renders only when
        // a comparison AND an ok share exist, so an untraceable OFFICIAL entry
        // was counted and then read by nothing whenever the share was
        // unavailable — or whenever a refusal returned before the badge.
        <p role="alert">
          {officialMissingProvenance.length} archive entry/entries backing the
          official comparison figure have no source record (
          {officialMissingProvenance.join(", ")}); that figure cannot be traced
          and must not be quoted.
        </p>
      ) : null}
      {rows.length === 0 ? null : (
        // A denominator describes a FIGURE. Rendered in the empty branch too,
        // "93 of 153 mesas" sat beside "no rows found" — a coverage claim
        // about nothing.
        <p role="note">
          Coverage: {coverage.observedUnits} of {coverage.denominatorUnits} mesas
          — not a random sample; these are exactly the mesas where the party
          had a fiscal present.
        </p>
      )}
      {rows.length === 0 ? (
        <p>No fiscalización rows found for this jurisdiction/category/election.</p>
      ) : (
        <>
          {/* Computed HERE: the empty-rows branch above renders no badge, so
              an empty-set result was never displayed and only a unit test
              reached it. */}
          {/* Through the boundary, like the three sibling pages. `votesByParty`
              sums every row per party across ONE jurisdiction, so the raw row
              level claimed `mesa` over a figure that IS every mesa added up. */}
          {mixedLevels !== null ? null : (
            // Withheld with the figure it describes: a badge over a refused
            // computation names one of the mixed levels as if it were the set's.
            <GranularityBadge {...jurisdictionTotalLevel(levels.granularity)} />
          )}
          <UnorderableLevels entries={unorderable} />
          {mixedLevels ? (
            <p role="alert">No per-party figures: {mixedLevels}.</p>
          ) : (
            <ul>
              {partyTotals.map((entry) => (
                <li key={entry.label}>
                  {entry.label}: {entry.votes} votes
                </li>
              ))}
            </ul>
          )}
          <ProvenanceLink sources={sources} />
        </>
      )}
      <UnmappedListIds
        entries={unmapped.unmappedByListId}
        withoutListId={unmappedByListId(rows).withoutListId}
        totalRows={rows.length}
        unsummable={mixedLevels}
        mappingConfigured={view.partyMappingConfigured}
      />
      {unmapped.tied ? (
        <p role="note">
          Two or more parties are tied at the top, so no party was selected for
          a cross-election comparison.
        </p>
      ) : null}
      {comparison && fiscalizacionShare?.status === "ok" ? (
        <JuxtapositionBadge
          fiscalizacion={{
            electionId: fiscalizacionElection().electionId ?? "(unconfigured)",
            electionLabel: fiscalizacionElection().electionLabel,
            sourceKind: "fiscalizacion",
            // The SAME party the official side reports, so the two numbers
            // describe one party across two elections.
            partyName: comparison.partyName,
            sharePercent: fiscalizacionShare.sharePercent,
            coverage,
          }}
          official={comparison}
          officialSources={officialSources}
          officialMissingProvenance={officialMissingProvenance}
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
  /**
   * The year the comparison election was ACTUALLY held, from its `election`
   * row — `null` when no row carries that id.
   *
   * Passed in rather than parsed out of the id: `election.id` is a uuid and
   * `election.year` is a column, so reading the year off the id string refused
   * every real request. The cross-check this enables is the same one, against
   * the source that has the answer.
   */
  declaredYear: number | null,
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
        "NATIONAL_JURISDICTION_ID and FISCALIZACION_CATEGORY_ID are not " +
        "configured (or the national and municipal jurisdiction ids collide), " +
        "so a comparison cannot be shown to describe the same scope",
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
  // THE boundary. This was the fourth derivation and it disagreed with the
  // other three: first `\d{4}` ANYWHERE accepts `legislativas-2025`, which
  // they refuse, and accepts `2023-2025-comparativa` by silently picking the
  // first of two years — on the axis that selects the party mapping, which is
  // what stops `135`/`20135`/`110` reading as three parties.
  if (declaredYear === null) {
    return {
      status: "refused",
      reason:
        `no election row carries the id ${electionId}, so compareYear ${year} ` +
        `cannot be verified against it`,
    };
  }
  if (declaredYear !== year) {
    return {
      status: "refused",
      reason:
        `compareYear ${year} contradicts election ${electionId}, which was ` +
        `held in ${declaredYear}`,
    };
  }
  if (electionId === fiscalizacionElection().electionId) {
    // Every other axis of a comparison is pinned to match; the ELECTION is the
    // one axis the badge exists to vary. Without this, the same race renders
    // beside itself under "cross-election juxtaposition" -- one election drawn
    // as two, labelled as a trend over time.
    return {
      status: "refused",
      reason:
        `a comparison must be a DIFFERENT election from ` +
        `${fiscalizacionElection().electionId}; got the same one`,
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
    /** The party to MATCH on — resolved from the fiscalización side. */
    canonicalPartyId: string;
    /** The same party's display name, for the rendered figure only. */
    partyName: string;
  },
): Promise<
  | { status: "ok"; figure: OfficialFigure; excluded: ExcludedByKind }
  | { status: "unavailable"; reason: string; excluded: ExcludedByKind }
> {
  const response = await repository.queryOfficial(
    {
      electionId: request.electionId,
      jurisdictionId: request.jurisdictionId,
      categoryId: request.categoryId,
    },
    request.partyContext,
  );

  // Two distinct outcomes -- no official rows, party absent from that
  // election -- used to collapse into one silent `undefined`, so the operator
  // saw the fiscalización figure alone with no sign that a comparison had been
  // requested and could not be built. A REFUSED read is no longer among them:
  // `queryOfficial` cannot return one and the compiler enforces it; a denial
  // throws.
  if (response.rows.length === 0) {
    return {
      status: "unavailable",
      reason: `no official rows for ${request.electionId} in this jurisdiction and category`,
      // Zero rows SURVIVING the filter is not zero rows read: the tally says
      // whether the filter is why.
      excluded: response.excluded,
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
      excluded: response.excluded,
    };
  }

  // The SAME party, never this election's own winner. Reporting each side's
  // top list compared two different parties and presented it as one trend.
  const share = partyShare(response.rows, request.canonicalPartyId, request.partyName);
  if (share.status !== "ok") {
    return {
      status: "unavailable",
      reason: `${request.electionLabel}: ${share.reason}`,
      // THIS read's tally, on the refusal too: a drop counted before a refusal
      // about something else is the silent drop with extra steps.
      excluded: response.excluded,
    };
  }

  return {
    status: "ok",
    // A THIRD independent read on this route. Its own `source_kind` filter
    // removes rows — including the `unknown` bucket both filters drop — and
    // that count belonged to no page: `view.excluded` describes the
    // fiscalización read and cannot stand in for this one.
    excluded: response.excluded,
    figure: {
      electionId: request.electionId,
      electionLabel: request.electionLabel,
      canonicalPartyId: request.canonicalPartyId,
      sourceKind: "official",
      sharePercent: share.sharePercent,
      partyName: request.partyName,
      archiveEntryIds: [...new Set(response.rows.map((row) => row.archiveEntryId))],
    },
  };
}



/**
 * Authenticated operator route for the fiscalización capability
 * (fiscalizacion-analysis spec, Requirement 8). RSC, server-only reads —
 * reaches data ONLY through `repository.queryFiscalizacion()` via
 * `loadFiscalizacionView`.
 */
async function renderLegacyFiscalizacionPage(
  params: Record<string, string | string[] | undefined>,
): Promise<ReactNode> {

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

  // The comparison election's year, from ITS OWN row. Resolved once here and
  // handed to both `comparisonFromParams` call sites, so the two cannot answer
  // the same question differently.
  const compareElectionId = stringParam(params, "compareElectionId");
  const supabaseForYear = await createSupabaseServerClient();
  let compareYear: YearLookup | null = null;
  let pinnedYear: YearLookup | null = null;
  try {
    const pinnedElectionId = fiscalizacionElection().electionId;
    [pinnedYear, compareYear] = await Promise.all([
      pinnedElectionId ? fetchElectionYear(supabaseForYear, pinnedElectionId) : null,
      compareElectionId ? fetchElectionYear(supabaseForYear, compareElectionId) : null,
    ]);
  } catch (error) {
    return renderFiscalizacionView({
      status: "read_failed",
      reason: error instanceof Error ? error.message : String(error),
    });
  }

  // The PINNED side, checked against the same source the comparison side is.
  // `FISCALIZACION_PARTY_CONTEXT.year` is the literal 2025 while the election
  // it describes became opaque configuration in this same change — so pointing
  // `FISCALIZACION_ELECTION_ID` at a 2023 election resolved every list id
  // through the 2025 mapping (LLA is `20135` in 2023 and `110` in 2025) under
  // a coverage denominator naming a different race. The comparison side already
  // refuses this; the side that selects the mapping for every figure did not.
  const pinnedElectionId = fiscalizacionElection().electionId;
  if (
    pinnedElectionId &&
    (pinnedYear?.status !== "ok" || pinnedYear.year !== FISCALIZACION_PARTY_CONTEXT.year)
  ) {
    return renderFiscalizacionView({
      status: "refused",
      reason:
        `FISCALIZACION_ELECTION_ID points at ${pinnedElectionId}, ` +
        (pinnedYear?.status === "no_row"
          ? "which no election row carries"
          : pinnedYear?.status === "unreadable_year"
            ? "whose election row carries no usable year"
            : `which was held in ${pinnedYear?.year}`) +
        `, but this route's party mapping and coverage denominator were ` +
        `verified for ${FISCALIZACION_PARTY_CONTEXT.year}`,
    });
  }

  const outOfScope = outOfScopeReason({ electionId, jurisdictionId, categoryId });
  if (outOfScope) {
    // Refused, not relabelled. See `outOfScopeReason`. A comparison requested
    // in the same URL is still reported: returning here without it left the
    // operator unable to tell "no comparison asked for" from "asked for and
    // never attempted".
    const requested = comparisonFromParams(params, compareYear?.status === "ok" ? compareYear.year : null);
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

  const comparisonRequest = comparisonFromParams(
    params,
    compareYear?.status === "ok" ? compareYear.year : null,
  );
  // Which party to compare comes from THIS election's rows, resolved through
  // its own crosswalk. Absent it, there is nothing to match and no badge.
  const top = view.status === "ok" ? topParty(view.rows) : null;

  let comparison: OfficialFigure | undefined;
  let comparisonUnavailable: string | undefined;
  let officialExcluded: ExcludedByKind | undefined;
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
      // NO second statement. `renderFiscalizacionView` already emits the tie
      // note next to the figure it is about, and both firing printed one fact
      // as two — the rule `drilldown` pins with its own `not.toContain`.
      // The tie still stops the comparison; it is simply stated once.
    } else if (top?.refusedReason) {
      // The actual cause, not a catch-all. Rows can map perfectly and still
      // yield no party when their levels cannot be summed.
      comparisonUnavailable = top.refusedReason;
    } else if (!top?.canonicalPartyId || !top.partyName) {
      // BOTH: the id is what the match keys on and the name is what renders,
      // and `topParty` only ever sets them together.
      comparisonUnavailable = "no row resolved to a curated party to compare";
    } else {
      // The comparison read THROWS on a denial like any other; without this it
      // escaped to the framework instead of the reason this page renders.
      // TYPED, not an evolving `any`. The catch branch sets no `excluded`, and
      // reading it off an implicit `any` typechecked by accident: the answer
      // (`undefined` — a throw counted nothing) was right for a reason the
      // compiler was not enforcing.
      let result: Awaited<ReturnType<typeof loadOfficialComparison>>;
      try {
        result = await loadOfficialComparison(repository, {
          // The comparison's OWN ids, never this election's.
          ...comparisonRequest.request,
          canonicalPartyId: top.canonicalPartyId,
          partyName: top.partyName,
        });
      } catch (error) {
        result = {
          status: "unavailable",
          reason: error instanceof Error ? error.message : String(error),
          // A throw counted nothing, and saying so is the point: `{}` is a
          // tally reporting no drops, not an absent tally.
          excluded: {},
        };
      }
      // The tally travels on BOTH outcomes: a drop counted by this read must
      // not vanish because the comparison it fed could not be built.
      officialExcluded = result.excluded;
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
  // The page's OTHER TWO reads, inside the same guard. `loadFiscalizacionView`
  // catches its own; the comparison query and the provenance fetch escaped to
  // the framework error boundary, so two of three reads bypassed the refusal
  // this page states. `drilldown` fixed exactly this shape.
  const fiscalizacionEntryIds = [
    ...new Set(view.status === "ok" ? view.rows.map((row) => row.archiveEntryId) : []),
  ];
  const officialEntryIds = comparison?.archiveEntryIds ?? [];
  const allEntryIds = [...new Set([...fiscalizacionEntryIds, ...officialEntryIds])];

  let fetched: SourceRef[] = [];
  let reportedMissing: string[] = [];
  try {
    const supabase = await createSupabaseServerClient();
    if (allEntryIds.length > 0) {
      const refs = await fetchSourceRefs(supabase, allEntryIds);
      fetched = refs.sources;
      // The value the function ALREADY returns, not a second computation of
      // the same fact — `isMissing` below was a second reader of it.
      reportedMissing = refs.missing;
    }
  } catch (error) {
    // Carries what was already loaded: a drop counted moments earlier must not
    // vanish behind a refusal about a different read, and a
    // requested-but-impossible comparison stays reported.
    return renderFiscalizacionView({
      status: "read_failed",
      reason: error instanceof Error ? error.message : String(error),
      ...(view.status === "ok"
        ? {
            excluded: view.excluded,
            // Rows WERE read and these were already counted. Dropping them
            // behind a refusal about a THIRD read is the shape this file
            // refuses everywhere else; both siblings carry theirs.
            unmapped: unmappedByListId(view.rows).entries,
            unsummable: mixedGranularityReason(view.rows),
            totalRows: view.rows.length,
            unrecognized: unrecognizedLevels(view.rows),
            partyMappingConfigured: view.partyMappingConfigured,
            withoutListId: unmappedByListId(view.rows).withoutListId,
          }
        : {}),
      // The comparison read's tally too. It was counted before this failure —
      // a different read's drop dropped again, behind a refusal about a third.
      ...(officialExcluded ? { officialExcluded } : {}),
      ...(comparisonUnavailable ? { comparisonUnavailable } : {}),
    });
  }

  // `fetchSourceRefs` can return FEWER refs than asked for: an archive entry
  // with no `source_ref` row yields nothing, and both the fiscalización block
  // and the badge would render a percentage with no provenance and nothing
  // saying provenance was missing. SPLIT per figure, so a missing 2023
  // official record is not reported inside the unofficial block.
  const missingProvenance = reportedMissing.filter((id) =>
    fiscalizacionEntryIds.includes(id),
  );
  const officialMissingProvenance = reportedMissing.filter((id) =>
    officialEntryIds.includes(id),
  );

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
    officialMissingProvenance,
    ...(officialExcluded ? { officialExcluded } : {}),
  });
}

export default async function FiscalizacionPage({
  searchParams,
}: FiscalizacionPageProps): Promise<ReactNode> {
  const params = await searchParams;
  // The pre-existing tally comparison remains reachable only through its
  // explicit UUID-shaped deep link. The production navigation and cold start
  // enter the coverage explorer instead.
  if (stringParam(params, "jurisdictionId") !== undefined) {
    return renderLegacyFiscalizacionPage(params);
  }
  return renderCoverageExplorer(params);
}
