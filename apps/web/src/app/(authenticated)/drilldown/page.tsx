import type { ReactNode } from "react";
import { GranularityBadge } from "@/components/GranularityBadge";
import { ProvenanceLink } from "@/components/ProvenanceLink";
import {
  createResultsRepository,
  describeExcluded,
  fetchSourceRefs,
  tallyByKind,
  votesByParty,
} from "@/lib/fiscalizacion/repository";
import { createSupabaseServerClient } from "@/lib/supabase/server-client";
import { repeatedParams, stringParam } from "@/lib/results/query-params";
import {
  jurisdictionTotalLevel,
  mixedGranularityReason,
  readGranularity,
  unrecognizedLevels,
} from "@/lib/results/granularity";
import { electionYear } from "@/lib/results/election-id";
import { partyFamilyRefusal, resolvePartyFamily } from "@/lib/results/party-family";

interface DrilldownPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}


/**
 * Single-jurisdiction drilldown (RSC, server-only reads), officially
 * sourced only — this view never exercises `queryFiscalizacion`; the
 * unofficial opt-in path is a distinct, explicit request the design does
 * not fold into the default drilldown.
 */
export default async function DrilldownPage({ searchParams }: DrilldownPageProps): Promise<ReactNode> {
  const params = await searchParams;

  // Refused BEFORE anything is read: `stringParam` yields `undefined` for a
  // repeated param, so without this a supplied value looks absent.
  const repeated = repeatedParams(params);
  if (repeated.length > 0) {
    return (
      <main>
        <h1>Drilldown</h1>
        <p role="alert">
          Refused: these query parameters were supplied more than once and
          cannot be resolved to one value: {repeated.join(", ")}.
        </p>
      </main>
    );
  }
  const electionId = stringParam(params, "electionId");
  const jurisdictionId = stringParam(params, "jurisdictionId");
  const categoryId = stringParam(params, "categoryId");
  const partyCategory = stringParam(params, "partyCategory");
  // Same reason as `compare`: a second mapping family exists, so pinning
  // national while accepting any jurisdiction resolves through the wrong one.
  const partyJurisdiction = stringParam(params, "partyJurisdiction");

  if (!electionId || !jurisdictionId || !categoryId) {
    return (
      <main>
        <h1>Drilldown</h1>
        <p>
          Provide <code>electionId</code>, <code>jurisdictionId</code> and{" "}
          <code>categoryId</code> query parameters.
        </p>
      </main>
    );
  }

  // BEFORE the family guard. Run after it, an omitted `partyJurisdiction`
  // reached the mismatch branch and rendered "j-027 is mapped by the national
  // party table, not undefined" — blaming a mismatch on a request that simply
  // left the parameter out, while this dedicated refusal could never fire for
  // it. `compare` and `municipal` both order params first; this was the fourth
  // divergent copy of one decision.
  const year = electionYear(electionId);
  if (year === null || !partyCategory || !partyJurisdiction) {
    return (
      <main>
        <h1>Drilldown</h1>
        <p role="alert">
          Refused: provide <code>partyCategory</code> and{" "}
          <code>partyJurisdiction</code>, and an election id that
          carries its year — list ids are only meaningful through their own
          election&apos;s party mapping.
        </p>
      </main>
    );
  }

  // THE boundary, not a third copy of the decision.
  const family = resolvePartyFamily(jurisdictionId);
  if (family.status !== "ok" || partyJurisdiction !== family.family) {
    return (
      <main>
        <h1>Drilldown</h1>
        <p role="alert">
          Refused:{" "}
          {partyFamilyRefusal(family, partyJurisdiction)}
          . A list id resolved through the wrong family names the wrong party.
        </p>
      </main>
    );
  }

  const repository = await createResultsRepository();
  // WITH a party mapping. Without one no name ever resolves, so every row
  // rendered a raw list id — and `110` and `20135` are the SAME party in two
  // files, presented as if they were two identities. `compare` refuses without
  // a category for exactly this; `municipal` passes a context; this page did
  // neither.
  // A denied read THROWS (`SupabaseRowSource.fetchRows` raises on a Postgres
  // error), so that is the path an RLS denial actually takes; the non-ok
  // branch below is defensive.
  let response, aggregate, sources, missingProvenance: string[] = [];
  try {
    response = await repository.queryOfficial(
      { electionId, jurisdictionId, categoryId },
      { year, jurisdiction: partyJurisdiction, category: partyCategory },
    );
  } catch (error) {
    return (
      <main>
        <h1>Drilldown</h1>
        <p role="alert">
          Refused: {error instanceof Error ? error.message : String(error)}
        </p>
      </main>
    );
  }
  // No refusal branch: `queryOfficial` cannot return one. A denied read
  // throws and the try above catches it.
  // PATH 3: the page checks WHAT IT IS ABOUT TO RENDER. It is unreachable
  // while `queryOfficial`'s filter works -- that is what defence in depth
  // looks like -- and it fires the moment that filter regresses, which is the
  // only thing a third guard can usefully do. Driven in tests by a repository
  // whose `queryOfficial` leaks.
  // The breakdown is computed BEFORE the guard: a drop already counted must
  // not disappear behind a refusal about something else.
  const excludedSummary = describeExcluded(response.excluded);
  const excludedNote =
    excludedSummary !== null ? (
      <p role="note">
        {excludedSummary} were excluded by the official-source filter and are
        not in any figure
        on this page.
      </p>
    ) : null;

  const foreign = response.rows.filter((row) => row.sourceKind !== "official");
  if (foreign.length > 0) {
    return (
      <main>
        <h1>Drilldown</h1>
        <p role="alert">
          Refused: {describeExcluded(tallyByKind(foreign))} of{" "}
          {response.rows.length} rows are not official. Official and
          fiscalización figures are never combined in one number.
        </p>
        {excludedNote}
      </main>
    );
  }
  const rows = response.rows;
  // THE shared boundary. Taking `rows[0]` claimed the level of whichever row
  // the query happened to return first, which can be finer than the set
  // supports — the third page to derive this differently.
  // AGGREGATED per party. `result_row` holds ONE ROW PER (mesa, list), so
  // rendering rows verbatim printed the same party N times with N different
  // numbers and no mesa label to tell them apart -- each line reading as that
  // party's figure, and the list visibly failing to sum to the total above it.

  const levels = readGranularity(rows);
  // Can these rows be ADDED? A `seccion` row already contains the `mesa` rows
  // beneath it, so this page used to disclose the mix and then sum it anyway:
  // one seccion row of 10 plus one mesa row of 10 inside it rendered 20 votes
  // for a party that got 10. Disclosure is not permission.
  const unsummable = mixedGranularityReason(rows);
  // The SIZE of each unorderable level, not just its name: many rows on one
  // unknown level read as "1 row(s)" when only the names are printed.
  const unrecognized = unrecognizedLevels(rows);
  const partyTotals = unsummable !== null ? [] : votesByParty(rows);


  // BOTH remaining reads inside the same guard. The aggregate is a second
  // independent query and `fetchSourceRefs` is a third; each throws on a
  // Postgres error, and both sat outside the catch — so a denial on either
  // escaped to the framework instead of the refusal this page states.
  try {
    // The AGGREGATE path of D9.1's threat matrix. Its only caller was its own
    // test, so one of the three independent leakage paths was unreachable
    // from production — blocking it blocked nothing.
    aggregate = await repository.aggregateOfficialVotes({
      electionId,
      jurisdictionId,
      categoryId,
    });
    const supabase = await createSupabaseServerClient();
    const refs = await fetchSourceRefs(
      supabase,
      [...new Set(rows.map((row) => row.archiveEntryId))],
    );
    sources = refs.sources;
    missingProvenance = refs.missing;
  } catch (error) {
    return (
      <main>
        <h1>Drilldown</h1>
        <p role="alert">
          Refused: {error instanceof Error ? error.message : String(error)}
        </p>
        {excludedSummary !== null ? (
          // The drop was already counted before this failure; hiding it behind
          // a refusal about something else is the silent drop with extra steps.
          <p role="note">
            {excludedSummary} were excluded by the official-source filter.
          </p>
        ) : null}
        {aggregate && describeExcluded(aggregate.excluded) !== null ? (
          // Path 2's own tally, when path 2 got far enough to produce one. It
          // is a DIFFERENT read, so the note above cannot stand in for it.
          <p role="note">
            The official total&apos;s own read excluded{" "}
            {describeExcluded(aggregate.excluded)}.
          </p>
        ) : null}
      </main>
    );
  }

  // PATH 3 over BOTH displayed reads. `aggregateOfficialVotes` fetches and
  // filters independently, so its total is a second number the render used to
  // print with no guard of its own: a regression there folded fiscalización
  // votes into "Official total" while this check looked only at path 1's rows.
  const aggregateForeign = describeExcluded(
    Object.fromEntries(
      Object.entries(aggregate.summedByKind).filter(([kind]) => kind !== "official"),
    ),
  );
  if (aggregateForeign !== null) {
    return (
      <main>
        <h1>Drilldown</h1>
        <p role="alert">
          Refused: the official total was summed from rows that are not
          official ({aggregateForeign}). Official and fiscalización figures are
          never combined in one number.
        </p>
        {excludedNote}
        {describeExcluded(aggregate.excluded) !== null ? (
          // Path 2's OWN drops. Path 1's note describes a different read and
          // cannot stand in for it — least of all here, where a foreign row
          // reaching path 2's sum guarantees its tally is non-empty.
          <p role="note">
            The official total&apos;s own read excluded{" "}
            {describeExcluded(aggregate.excluded)}.
          </p>
        ) : null}
        {missingProvenance.length > 0 ? (
          // Counted before this refusal, so hiding it behind a refusal about a
          // different fact is the silent drop with extra steps. The three
          // sibling pages carry theirs through their own refusals.
          <p role="alert">
            {missingProvenance.length} archive entry/entries backing these
            figures resolved to no source record ({missingProvenance.join(", ")}
            ); those figures cannot be traced.
          </p>
        ) : null}
      </main>
    );
  }

  return (
    <main>
      <h1>Drilldown</h1>
      {unsummable === null &&
      aggregate.totalVotes !== rows.reduce((sum, row) => sum + row.votes, 0) ? (
        // TWO INDEPENDENT READS. That independence is the point of D9.1's
        // three paths, and it means the two can legitimately disagree — RLS
        // scope, a mid-write, a different row set. Rendering them adjacent
        // without reconciliation presented one consistent view of two
        // different reads.
        <p role="alert">
          The total below and the rows beneath it come from separate reads and
          do not agree: {aggregate.totalVotes} versus{" "}
          {rows.reduce((sum, row) => sum + row.votes, 0)}. Treat neither as the
          figure until the difference is explained.
        </p>
      ) : null}
      {missingProvenance.length > 0 ? (
        <p role="alert">
          {missingProvenance.length} archive entry/entries backing these figures
          resolved to no source record ({missingProvenance.join(", ")}); those
          figures cannot be traced.
        </p>
      ) : null}
      {describeExcluded(aggregate.excluded) !== null ? (
        // Path 2 is an INDEPENDENT read, so its own drops are reported even
        // when path 1 returned nothing — path 1's note describes a different
        // read and cannot stand in for this one.
        <p role="note">
          The official total&apos;s own read excluded{" "}
          {describeExcluded(aggregate.excluded)}
          {unsummable !== null
            ? " — that total is not shown here because its rows cannot be summed, but the drop happened and is reported rather than discarded"
            : ""}
          .
        </p>
      ) : null}
      {rows.length === 0 || unsummable !== null ? null : (
      <p role="note">
        Official total: {aggregate.totalVotes} votes ({aggregate.sourceKind} source
        only)
        {describeExcluded(aggregate.excluded) !== null
          ? `, excluding ${describeExcluded(aggregate.excluded)} on its own read`
          : ""}
        .
      </p>
      )}
      {excludedNote}
      {unsummable !== null ? (
        <p role="alert">
          No per-party figures: {unsummable}. The rows are shown by nothing
          here; a total that double-counts is worse than no total.
        </p>
      ) : null}
      {unrecognized.length > 0 ? (
        <>
          <p role="alert">
            {unrecognized.reduce((sum, entry) => sum + entry.rows, 0)} row(s)
            carry a granularity this page cannot order, so their containment
            relationship is unknown and no level is shown for them at all. By
            level:
          </p>
          <ul>
            {unrecognized.map((entry) => (
              <li key={entry.granularity}>
                {entry.granularity}: {entry.rows} rows, {entry.votes} votes
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {rows.length === 0 ? (
        aggregate.totalVotes > 0 ? (
          // NOT "no results". An independent read holds votes, so the honest
          // statement is that the two disagree — the case the alert above
          // exists for, and the one where suppressing it hid the most.
          <p role="alert">
            This read returned no rows while the official total&apos;s own read
            holds {aggregate.totalVotes} votes. Neither figure can be trusted
            until the difference is explained.
          </p>
        ) : (
          <p>No official results found for this jurisdiction/category/election.</p>
        )
      ) : (
        <>
          {/* Through the boundary, like `compare` and `municipal`. These are
              per-party totals over one jurisdiction, so the raw row level
              claimed `mesa` over a figure that IS every mesa added up. */}
          {unsummable !== null ? null : (
            // Withheld with the figure it describes. `readGranularity`
            // folds to the COARSEST level, so a badge here names one of the
            // mixed levels as if it were the set's — hiding the mix the
            // refusal beside it exists to announce.
            <GranularityBadge {...jurisdictionTotalLevel(levels.granularity)} />
          )}
          {unsummable !== null ? null : (
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
    </main>
  );
}
