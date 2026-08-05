import type { ReactNode } from "react";
import { GranularityBadge } from "@/components/GranularityBadge";
import { ProvenanceLink } from "@/components/ProvenanceLink";
import { compareResults } from "@/lib/results/compare";
import type { CompareInput, UnitResult } from "@/lib/results/compare";
import type { Granularity } from "@/lib/results/types";
import {
  createResultsRepository,
  describeExcluded,
  fetchSourceRefs,
  tallyByKind,
} from "@/lib/fiscalizacion/repository";
import type { ResultRow } from "@/lib/fiscalizacion/repository";
import { createSupabaseServerClient } from "@/lib/supabase/server-client";
import { repeatedParams, stringParam } from "@/lib/results/query-params";
import {
  GRANULARITY_ORDER,
  coarsestOf,
  JURISDICTION_TOTAL_GRANULARITY,
  jurisdictionTotalLevel,
  readGranularity,
  unrecognizedLevels,
} from "@/lib/results/granularity";
import { electionYear } from "@/lib/results/election-id";
import { partyFamilyRefusal, resolvePartyFamily } from "@/lib/results/party-family";

interface ComparePageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}



/**
 * Groups official rows into `compare.ts`'s per-unit shape, keyed on the
 * RESOLVED PARTY NAME and never on `listId`.
 *
 * The same party carries `135` in the 2023 PASO, `20135` in the 2023
 * generales and `110` in 2025, so keying on the raw id gives the two sides
 * ZERO keys in common by construction: every unit read as `flipped X → Y` for
 * a party that never changed hands, on the page whose entire purpose is the
 * cross-year swing. Calling that "a disclosed simplification" in a docstring
 * disclosed nothing to the operator reading the swing list.
 *
 * A row whose id resolves to no canonical party is not comparable at all and
 * is reported, never keyed on its raw id under an `unmapped` label -- that
 * fallback re-created the same zero-common-keys flip it was meant to avoid.
 */
function toCompareUnits(rows: ResultRow[]): {
  granularity: Granularity;
  mixed: (Granularity | string)[];
  /** Levels this module cannot order — disclosed like `mixed`. */
  unrecognized: string[];
  units: UnitResult[];
  /** How many ROWS resolved to no canonical party. */
  unresolvedRows: number;
  /** The VOTES on those rows — how much of the comparison was discarded. */
  unresolvedVotes: number;
  /**
   * Which list ids they carried, with the size of each drop.
   *
   * Per id and in both units, like every sibling tally: a row count alone made
   * a 6.462.906-vote drop and a 6-vote drop render identically, and this is
   * the one place that says how much of the comparison went missing.
   */
  unresolvedByListId: { listId: string; rows: number; votes: number }[];
  /** Canonical id -> the name to show for it. */
  displayNames: Map<string, string>;
} {
  const votesByUnitAndParty = new Map<string, Map<string, number>>();
  const levels = readGranularity(rows);
  let unresolvedRows = 0;
  let unresolvedVotes = 0;
  const unresolvedByListId = new Map<string, { rows: number; votes: number }>();
  const displayNames = new Map<string, string>();

  for (const row of rows) {
    if (!row.canonicalPartyId) {
      // An unmapped row carries no comparable identity. Falling back to
      // `unmapped (list N)` re-keyed on the raw id, so one party unmapped in
      // both years gave `unmapped (list 20135)` vs `unmapped (list 110)` —
      // zero common keys and a `flipped` claim for a party that never changed
      // hands. The fabricated swing survived on the unmapped path.
      unresolvedRows += 1;
      unresolvedVotes += row.votes;
      const key = row.listId ?? "(no list id)";
      const entry = unresolvedByListId.get(key) ?? { rows: 0, votes: 0 };
      unresolvedByListId.set(key, { rows: entry.rows + 1, votes: entry.votes + row.votes });
      continue;
    }
    // The CANONICAL ID, not the display name. The curated file spells one
    // canonical party "LA LIBERTAD AVANZA" in 2023 and "ALIANZA LA LIBERTAD
    // AVANZA" in 2025, so keying on the name gives the two sides zero common
    // keys — the same fabricated flip as keying on the list id, one layer up.
    const party = row.canonicalPartyId;
    // The NAME travels with the key. `fromParty`/`toParty` are these keys, so
    // rendering them printed the internal id (`lla`) to the operator on the
    // page whose whole purpose is the swing.
    displayNames.set(party, row.partyName ?? party);
    // `BaseQuery` filters `.eq("jurisdiction_id", ...)`, so EVERY row carries
    // the same id and they all sum into exactly ONE unit. The figure is
    // therefore a jurisdiction total whatever level its rows carry — and the
    // badge used to assert `mesa` over it. The aggregation is real and it is
    // now disclosed below rather than described only in this comment.
    const parties = votesByUnitAndParty.get(row.jurisdictionId) ?? new Map<string, number>();
    parties.set(party, (parties.get(party) ?? 0) + row.votes);
    votesByUnitAndParty.set(row.jurisdictionId, parties);
  }

  const units: UnitResult[] = [...votesByUnitAndParty.entries()].map(([unitId, parties]) => ({
    unitId,
    parties: [...parties.entries()].map(([party, votes]) => ({ party, votes })),
  }));

  return {
    granularity: levels.granularity,
    mixed: levels.mixed,
    unrecognized: levels.unrecognized,
    units,
    unresolvedRows,
    unresolvedVotes,
    unresolvedByListId: [...unresolvedByListId.entries()]
      .map(([listId, tally]) => ({ listId, ...tally }))
      .sort((a, b) => a.listId.localeCompare(b.listId)),
    displayNames,
  };
}

/**
 * `results-analysis` cross-year comparison view (RSC, server-only reads —
 * design.md's Data Flow: "Next.js RSC (server-only reads)").
 */

export default async function ComparePage({ searchParams }: ComparePageProps): Promise<ReactNode> {
  const params = await searchParams;

  // Refused BEFORE anything is read: `stringParam` yields `undefined` for a
  // repeated param, so without this a supplied value looks absent.
  const repeated = repeatedParams(params);
  if (repeated.length > 0) {
    return (
      <main>
        <h1>Compare 2023 vs 2025</h1>
        <p role="alert">
          Refused: these query parameters were supplied more than once and
          cannot be resolved to one value: {repeated.join(", ")}.
        </p>
      </main>
    );
  }
  const electionId2023 = stringParam(params, "election2023");
  const electionId2025 = stringParam(params, "election2025");
  const jurisdictionId = stringParam(params, "jurisdictionId");
  const categoryId = stringParam(params, "categoryId");
  const rawAggregateTo = stringParam(params, "aggregateTo");
  // VALIDATED, not cast. `?aggregateTo=banana` reached `compareResults` typed
  // as a valid `Granularity`, and this is the operator's channel into the D6
  // refusal — the one input that must not be trusted blindly.
  const aggregateTo = GRANULARITY_ORDER.find((level) => level === rawAggregateTo);
  const partyCategory = stringParam(params, "partyCategory");
  // The mapping FAMILY, not a hardcoded `"national"`. `municipal/page.tsx`
  // proves a second one exists (`coronel_rosales_municipal`, list `2206`), so
  // pinning national while accepting any `jurisdictionId` resolves a municipal
  // category through the wrong table — every row unmapped, or worse, a
  // national party with a colliding id.
  const partyJurisdiction = stringParam(params, "partyJurisdiction");

  if (!electionId2023 || !electionId2025 || !jurisdictionId || !categoryId) {
    return (
      <main>
        <h1>Compare 2023 vs 2025</h1>
        <p>
          Provide <code>election2023</code>, <code>election2025</code>,{" "}
          <code>jurisdictionId</code> and <code>categoryId</code> query parameters.
        </p>
      </main>
    );
  }

  if (rawAggregateTo && !aggregateTo) {
    return (
      <main>
        <h1>Compare 2023 vs 2025</h1>
        <p role="alert">
          Refused: <code>aggregateTo</code> must be one of{" "}
          {GRANULARITY_ORDER.join(", ")}; got {rawAggregateTo}.
        </p>
      </main>
    );
  }

  const year2023 = electionYear(electionId2023);
  const year2025 = electionYear(electionId2025);
  if (!partyCategory || !partyJurisdiction || year2023 === null || year2025 === null) {
    // Without both years and the category there is no party mapping to resolve
    // through, and an unresolved comparison is the fabricated-swing case.
    return (
      <main>
        <h1>Compare 2023 vs 2025</h1>
        <p role="alert">
          Refused: provide <code>partyCategory</code> and{" "}
          <code>partyJurisdiction</code>, and election ids that
          carry their year — each side is resolved through its own{" "}
          <code>(year, jurisdiction, category)</code> party mapping, because the
          same party carries a different list id in each file.
        </p>
      </main>
    );
  }

  // THE boundary, not a third copy of the decision.
  const family = resolvePartyFamily(jurisdictionId);
  if (family.status !== "ok" || partyJurisdiction !== family.family) {
    return (
      <main>
        <h1>Compare 2023 vs 2025</h1>
        <p role="alert">
          Refused:{" "}
          {partyFamilyRefusal(family, partyJurisdiction)}
          . A list id resolved through the wrong family names the wrong party.
        </p>
      </main>
    );
  }

  const repository = await createResultsRepository();
  const baseQuery2023 = { electionId: electionId2023, jurisdictionId, categoryId };
  const baseQuery2025 = { electionId: electionId2025, jurisdictionId, categoryId };
  // Each year resolved through ITS OWN party mapping: the id changes between
  // files, the canonical name is what carries across.
  // A denied read THROWS. `SupabaseRowSource.fetchRows` raises on a Postgres
  // error, so RLS denial never arrives as a `status !== "ok"` response — the
  // branch below is defensive, and this is the path an actual denial takes.
  let response2023, response2025;
  try {
    [response2023, response2025] = await Promise.all([
    repository.queryOfficial(baseQuery2023, {
      year: year2023,
      jurisdiction: partyJurisdiction,
      category: partyCategory,
    }),
    repository.queryOfficial(baseQuery2025, {
      year: year2025,
      jurisdiction: partyJurisdiction,
      category: partyCategory,
    }),
    ]);
  } catch (error) {
    // The breakdown of whichever side DID resolve is lost here: `excludedByYear`
    // is computed below, and both responses are needed to build it. Stated
    // rather than left implicit — a partial read tells us nothing reliable
    // about what the other side's filter dropped.
    return (
      <main>
        <h1>Compare 2023 vs 2025</h1>
        <p role="alert">
          Refused: {error instanceof Error ? error.message : String(error)}
        </p>
        <p role="note">
          One year failed to read, so no source-kind breakdown is reported: a
          count from the year that did resolve would describe half a comparison.
        </p>
      </main>
    );
  }

  // The filter's breakdown, per YEAR — computed BEFORE any refusal branch.
  // Rendering it only on the success path meant a mixed-granularity or
  // zero-row refusal returned first and the removed rows appeared on no page
  // at all: the silent drop, hidden behind a refusal about something else.
  const excludedByYear = [
    // No `status === "ok"` ternary: `queryOfficial` cannot refuse and the
    // compiler enforces it. A silent `{}` fallback is the shape this branch
    // was opened to kill.
    [electionId2023, response2023.excluded] as const,
    [electionId2025, response2025.excluded] as const,
  ].flatMap(([electionId, excluded]) => {
    const summary = describeExcluded(excluded);
    return summary === null ? [] : [`${electionId}: ${summary}`];
  });

  const excludedNote =
    excludedByYear.length > 0 ? (
      <p role="note">
        Excluded by the official-source filter and absent from every figure
        on this page: {excludedByYear.join("; ")}.
      </p>
    ) : null;

  // No `status !== "ok"` branch: `queryOfficial` cannot refuse, and the
  // compiler now says so. A denied read throws, and the try above catches it.
  const rows2023 = response2023.rows;
  const rows2025 = response2025.rows;

  // PATH 3 on this page too: rule 5 wants a rendered-page guard, and taking
  // the query's word for it made the repository filter the only live one.
  const foreign2023 = rows2023.filter((row) => row.sourceKind !== "official");
  const foreign2025 = rows2025.filter((row) => row.sourceKind !== "official");
  const foreign = [...foreign2023, ...foreign2025];
  if (foreign.length > 0) {
    return (
      <main>
        <h1>Compare 2023 vs 2025</h1>
        {excludedNote}
        <p role="alert">
          Refused: {foreign.length} row(s) reaching this page are not official
          ({electionId2023}: {describeExcluded(tallyByKind(foreign2023)) ?? "none"};{" "}
          {electionId2025}: {describeExcluded(tallyByKind(foreign2025)) ?? "none"}).
          Official and fiscalización figures are never combined in one number.
        </p>
      </main>
    );
  }

  const compare2023 = toCompareUnits(rows2023);
  const compare2025 = toCompareUnits(rows2025);
  // Mixed levels on ONE side are invisible to `compareResults`'s D6 mismatch
  // check, which compares the two sides' single reported levels.
  // Unrecognized levels count too: a uniformly-unknown set is not "mixed",
  // and both sides folding to `distrito` made `compareResults` see no mismatch
  // so the D6 refusal never fired.
  const mixed = [
    ...compare2023.mixed,
    ...compare2025.mixed,
    ...compare2023.unrecognized,
    ...compare2025.unrecognized,
  ];
  if (mixed.length > 0) {
    return (
      <main>
        <h1>Compare 2023 vs 2025</h1>
        {excludedNote}
        <p role="alert">
          Refused: the returned rows mix granularity levels ({[...new Set(mixed)].join(", ")}),
          so a single level cannot describe either side and the cross-year
          mismatch check cannot see the difference.
        </p>
        {/* PER LEVEL and in both units, like the three sibling routes. Naming
            the levels alone hid how much of the comparison sits on one this
            module cannot order: many rows on a single unknown level read as
            one problem rather than as most of the data. */}
        {[
          [electionId2023, unrecognizedLevels(rows2023)] as const,
          [electionId2025, unrecognizedLevels(rows2025)] as const,
        ]
          .filter(([, levels]) => levels.length > 0)
          .map(([electionId, levels]) => (
            <ul key={electionId} aria-label={`unorderable-levels-${electionId}`}>
              {levels.map((entry) => (
                <li key={entry.granularity}>
                  {electionId} — {entry.granularity}: {entry.rows} rows,{" "}
                  {entry.votes} votes
                </li>
              ))}
            </ul>
          ))}
      </main>
    );
  }
  if (rows2023.length === 0 || rows2025.length === 0) {
    // `readGranularity([])` answers `distrito` so the fold cannot upgrade —
    // but feeding that into `compareResults` states a level for data that does
    // not exist, and renders "2023 is distrito-level, 2025 is mesa-level" as a
    // finding. `municipal` guards its badge the same way.
    return (
      <main>
        <h1>Compare 2023 vs 2025</h1>
        {excludedNote}
        <p role="alert">
          Refused: {rows2023.length === 0 && rows2025.length === 0
            ? "neither year"
            : rows2023.length === 0
              ? electionId2023
              : electionId2025}{" "}
          returned no rows, so there is no granularity to compare and no swing
          to compute.
        </p>
      </main>
    );
  }

  // PER YEAR, and rows counted before dedup. Summing two already-deduped id
  // lists gave neither a row count nor an id count: an id unmapped in both
  // years counted twice, and 6.000 dropped rows reported as "1".
  const unresolvedRows = compare2023.unresolvedRows + compare2025.unresolvedRows;
  if (unresolvedRows > 0) {
    return (
      <main>
        <h1>Compare 2023 vs 2025</h1>
        {excludedNote}
        <p role="alert">
          Refused: {unresolvedRows} row(s) /{" "}
          {compare2023.unresolvedVotes + compare2025.unresolvedVotes} vote(s)
          resolved to no canonical party, and an unmapped id is not an identity
          that can be compared across years.
        </p>
        <ul>
          <li>
            {electionId2023}: {compare2023.unresolvedRows} row(s) /{" "}
            {compare2023.unresolvedVotes} vote(s) across{" "}
            {compare2023.unresolvedByListId.length} id(s)
            {compare2023.unresolvedByListId.length > 0
              ? ` (${compare2023.unresolvedByListId
                  .map((entry) => `${entry.listId}: ${entry.rows} row(s) / ${entry.votes} vote(s)`)
                  .join(", ")})`
              : ""}
          </li>
          <li>
            {electionId2025}: {compare2025.unresolvedRows} row(s) /{" "}
            {compare2025.unresolvedVotes} vote(s) across{" "}
            {compare2025.unresolvedByListId.length} id(s)
            {compare2025.unresolvedByListId.length > 0
              ? ` (${compare2025.unresolvedByListId
                  .map((entry) => `${entry.listId}: ${entry.rows} row(s) / ${entry.votes} vote(s)`)
                  .join(", ")})`
              : ""}
          </li>
        </ul>
      </main>
    );
  }

  // The level the FIGURE has, not the level its rows had. Summing mesa rows
  // into one jurisdiction total makes the result a jurisdiction figure; saying
  // `mesa` would claim a detail the number no longer carries.
  // Each side labelled through the boundary, then the coarser label wins:
  // a comparison cannot claim more precision than its weaker side carries.
  const level2023 = jurisdictionTotalLevel(compare2023.granularity);
  const level2025 = jurisdictionTotalLevel(compare2025.granularity);
  // Through `coarsestOf`, not a second inline copy of the same comparison:
  // one file holding two shapes of one question is how they drift apart.
  // The CONSTANT, not a comparison. `jurisdictionTotalLevel` returns
  // `JURISDICTION_TOTAL_GRANULARITY` on every path, so both sides are always
  // equal and `coarsestOf` here presented a decision that no fixture could make
  // differ. The two real uses of `coarsestOf` are below, on the disclosures,
  // where the sides genuinely disagree.
  const figureGranularity = JURISDICTION_TOTAL_GRANULARITY;
  // From BOTH sides, never off whichever won the coarseness comparison. The
  // two shapes are disjoint per side, so with 2023 at `distrito` and 2025 at
  // `mesa` the coarser side carries `degradedFrom` and reading `summedFrom`
  // from it discarded the other side's sum: every 2025 mesa row folded into one
  // total with nothing on the page saying so.
  // The COARSEST of the two, not whichever side happened to be non-null.
  // With 2023 summed from `mesa` and 2025 from `circuito`, `??` made the badge
  // announce "summed from mesa" and state one side's level as the figure's.
  // The coarser is the strongest claim the pair supports.
  const summedFromRows = coarsestOf(level2023.summedFrom, level2025.summedFrom);
  // Same rule as `summedFromRows` above, deliberately: `??` takes the first
  // non-null side, which is only harmless while `jurisdictionTotalLevel` emits
  // a constant here. Two shapes of one decision is how they drift apart.
  const degradedFromDetail = coarsestOf(level2023.degradedFrom, level2025.degradedFrom);

  // EACH SIDE'S OWN SPELLING. One canonical party is written "LA LIBERTAD
  // AVANZA" in 2023 and "ALIANZA LA LIBERTAD AVANZA" in 2025; showing the 2023
  // name for the 2025 side would report a name that file never used. Falls
  // back to the other year, then to the canonical id, so a party present on
  // one side only still renders something truthful.
  const nameIn = (
    primary: Map<string, string>,
    fallback: Map<string, string>,
    canonicalId: string | null | undefined,
  ) =>
    canonicalId
      ? (primary.get(canonicalId) ?? fallback.get(canonicalId) ?? canonicalId)
      : "?";
  const fromName = (id: string | null | undefined) =>
    nameIn(compare2023.displayNames, compare2025.displayNames, id);
  const toName = (id: string | null | undefined) =>
    nameIn(compare2025.displayNames, compare2023.displayNames, id);

  const { granularity: granularity2023, units: units2023 } = compare2023;
  const { granularity: granularity2025, units: units2025 } = compare2025;

  const compareInput: CompareInput = {
    granularity2023,
    granularity2025,
    units2023,
    units2025,
    ...(aggregateTo ? { aggregateTo } : {}),
  };
  const result = compareResults(compareInput);

  if (result.status === "requires_explicit_aggregation") {
    return (
      <main>
        <h1>Compare 2023 vs 2025</h1>
        {excludedNote}
        {/* Task 11.14: flagged in the DISPLAY, not only in the API's
            `status` field — an operator scanning this page sees the
            refusal directly, with no figures rendered alongside it. */}
        <p role="alert">
          Mixed granularity: 2023 data is at {result.granularity2023}-level and 2025
          data is at {result.granularity2025}-level. Re-request with an explicit{" "}
          <code>aggregateTo</code> query parameter to combine them — this comparison
          refuses to guess (design.md D6).
        </p>
      </main>
    );
  }

  const archiveEntryIds = [...new Set([...rows2023, ...rows2025].map((row) => row.archiveEntryId))];
  let sources, missingProvenance: string[] = [];
  try {
    const supabase = await createSupabaseServerClient();
    const refs = await fetchSourceRefs(supabase, archiveEntryIds);
    sources = refs.sources;
    missingProvenance = refs.missing;
  } catch (error) {
    return (
      <main>
        <h1>Compare 2023 vs 2025</h1>
        {excludedNote}
        <p role="alert">
          Refused: {error instanceof Error ? error.message : String(error)}
        </p>
      </main>
    );
  }

  return (
    <main>
      <h1>Compare 2023 vs 2025</h1>
      {/* The FIGURE's level, not the rows'. Every row sums into one
          jurisdiction unit, so `result.granularity` -- derived from the rows --
          claimed `mesa` over a jurisdiction total while the note below said the
          opposite. The unit is one PARTIDO, so the total is seccion-level:
          `distrito` here would attribute Coronel Rosales's votes to the whole
          province. `summedFrom` states which rows were added together;
          `degradedFrom` states which detail the source never carried. */}
      <GranularityBadge
        granularity={figureGranularity}
        {...(summedFromRows ? { summedFrom: summedFromRows } : {})}
        {...(degradedFromDetail ? { degradedFrom: degradedFromDetail } : {})}
      />
      {excludedNote}
      {missingProvenance.length > 0 ? (
        <p role="alert">
          {missingProvenance.length} archive entry/entries backing these figures
          resolved to no source record ({missingProvenance.join(", ")}); those
          figures cannot be traced.
        </p>
      ) : null}
      {summedFromRows ? (
        <p role="note">
          These figures are jurisdiction totals: the query returns every row for
          one jurisdiction, and rows at{" "}
          {[
            ...new Set(
              // Only the sides that WERE summed. Naming both regardless
              // attributed an aggregation to a side whose source never carried
              // the detail — the badge says `degradedFrom` for that one.
              [level2023.summedFrom, level2025.summedFrom].filter(
                (level): level is Granularity => level !== undefined,
              ),
            ),
          ].join(", ")}{" "}
          level were summed into it. The badge shows the level of the FIGURE,
          not of the rows behind it.
        </p>
      ) : null}
      {result.aggregatedFrom ? (
        <p>
          Aggregated from {result.aggregatedFrom}-level data per an explicit operator
          choice.
        </p>
      ) : null}
      {/* ONE row, because the query returns one jurisdiction. Rendering it as a
          list of units suggested a breadth the figures do not have. */}
      <ul>
        {result.swings.map((swing) => (
          <li key={swing.unitId}>
            {swing.unitId} (whole jurisdiction):{" "}
            {swing.flipped
              ? `flipped ${fromName(swing.fromParty)} → ${toName(swing.toParty)}`
              : "no flip"}
          </li>
        ))}
      </ul>
      {/* No discontinuities section: `BaseQuery` filters
          `.eq("jurisdiction_id", ...)` and both sides pass the SAME id, so each
          year yields exactly ONE unit with the same `unitId`. A unit present in
          one year and absent from the other cannot occur, and rendering the
          section implied a per-unit view this query shape cannot produce.
          Restoring it needs a query that spans jurisdictions. */}
      <ProvenanceLink sources={sources} />
    </main>
  );
}
