import type { ReactNode } from "react";
import { GranularityBadge } from "@/components/GranularityBadge";
import { UnmappedListIds } from "@/components/UnmappedListIds";
import { UnorderableLevels } from "@/components/UnorderableLevels";
import { ProvenanceLink } from "@/components/ProvenanceLink";
import {
  createResultsRepository,
  fetchSourceRefs,
  type BaseQuery,
  type PartyMappingContext,
  type OkResultsQueryResponse,
  type ResultsRepository,
  describeExcluded,
  fetchElectionYear,
  tallyByKind,
  unmappedByListId,
  votesByParty,
} from "@/lib/fiscalizacion/repository";
import type { ExcludedByKind, YearLookup } from "@/lib/fiscalizacion/repository";
import { createSupabaseServerClient } from "@/lib/supabase/server-client";
import { repeatedParams, stringParam } from "@/lib/results/query-params";
import type { SourceRef } from "@/lib/results/types";
import {
  jurisdictionTotalLevel,
  mixedGranularityReason,
  readGranularity,
  unrecognizedLevels,
} from "@/lib/results/granularity";
import {
  partyFamilyRefusal,
  pinnedCategoryId,
  resolvePartyFamily,
} from "@/lib/results/party-family";

/**
 * Phase 16c: `curated/party_map.yaml`'s `coronel_rosales_municipal`
 * mappings (2025 CONCEJALES, list 2206 = LLA+PRO alliance) were loaded
 * into `party_mapping` in Phase 15 but no route ever read them — only the
 * national DIPUTADO NACIONAL path (`/fiscalizacion`) was wired. Same
 * shape this change has hit eight times: shipped correct, tested,
 * unreachable code.
 */
export const MUNICIPAL_PARTY_CONTEXT: PartyMappingContext = {
  year: 2025,
  jurisdiction: "coronel_rosales_municipal",
  category: "CONCEJALES",
};

export type MunicipalQuery = BaseQuery;
export type MunicipalView =
  // `OkResultsQueryResponse`, not the wider `ResultsQueryResponse`:
  // `loadMunicipalView` only calls `queryOfficial`, which cannot refuse, so
  // the opt-in variant was a status nothing here could produce.
  | OkResultsQueryResponse
  | {
      status: "read_failed";
      reason: string;
      /**
       * The filter's breakdown, CARRIED THROUGH the failure.
       *
       * Constructing a fresh `read_failed` view discarded the `excluded` map
       * the successful query had already returned, so a drop counted moments
       * earlier vanished behind a refusal about something else.
       */
      excluded?: ExcludedByKind;
      /** WHICH list ids failed to map, counted before this failure. */
      unmapped?: { listId: string; rows: number; votes: number }[];
      /** Why those rows cannot be summed, when they cannot. */
      unsummable?: string | null;
      /**
       * How many rows the read actually returned.
       *
       * Deriving it from the unmapped entries made numerator and denominator
       * the same number, so every read-failed page claimed "N of N rows
       * resolved to no curated party" — 100 % unmapped, whatever was read.
       */
      totalRows?: number;
      /** Levels this app cannot order, counted before the failure. */
      unrecognized?: { granularity: string; rows: number; votes: number }[];
      /** Whether a curated mapping source was configured for the read. */
      partyMappingConfigured?: boolean;
      /** Rows carrying no list id at all, counted before the failure. */
      withoutListId?: ExcludedByKind;
    };

/**
 * Reads through `ResultsRepository.queryOfficial` ONLY — never a second
 * query path that could bypass the `source_kind = 'official'` default
 * (D9.1 threat-matrix control). Municipal results are always official;
 * there is no fiscalización coverage opt-in on this route.
 */
export async function loadMunicipalView(
  repository: ResultsRepository,
  query: MunicipalQuery,
): Promise<MunicipalView> {
  // A denied read RAISES: `SupabaseRowSource.fetchRows` throws on a Postgres
  // error, so RLS denial never arrives as a non-ok status. `compare` and
  // `drilldown` both catch it; this route let it escape into the framework's
  // error boundary instead of the stated refusal.
  try {
    return await repository.queryOfficial(query, MUNICIPAL_PARTY_CONTEXT);
  } catch (error) {
    // A DISTINCT status. `requires_explicit_unofficial_opt_in` is the
    // source-kind leakage guard's vocabulary — it means "you asked for
    // unofficial figures, opt in explicitly". Mapping an RLS denial onto it
    // corrupts the one signal D9.1 depends on, and any consumer branching on
    // it would offer an opt-in prompt for a read that simply failed.
    return {
      status: "read_failed",
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Pure render function, testable via `renderToStaticMarkup` without
 * mounting the async RSC page component (same convention as
 * `renderFiscalizacionView`).
 *
 * The badge reports what the ROWS carry, not what this page remembers about
 * the source. Phase 17 changed what PBA ingestion writes: a partido total is a
 * SECCION-level figure in the national scheme (PBA distrito `027` is the
 * partido; national distrito `02` / seccion `027` is Coronel Rosales), so
 * `resolve_pba_jurisdictions` stores `granularity: "seccion"`. The hardcoded
 * `distrito` outlived that change and asserted a level the data contradicts —
 * and the fixture hardcoded `distrito` too, so nothing caught it.
 *
 * The DISCLOSURE stays, and `jurisdictionTotalLevel` now names it: rows
 * coarser than the partido carry `degradedFrom` set to the level the source
 * actually published, rows finer carry `summedFrom`. A hardcoded
 * `degradedFrom="mesa"` claimed the same missing detail whatever the rows
 * said; provenance-display's "Degraded-granularity figure discloses the
 * degradation" scenario needs the operator to see which level it really was.
 */
export function renderMunicipalView(
  view: MunicipalView,
  sources: Parameters<typeof ProvenanceLink>[0]["sources"] = [],
  /** Archive entries backing these figures that have no source record. */
  missingProvenance: string[] = [],
): ReactNode {
  if (view.status !== "ok") {
    const carried = describeExcluded(
      view.status === "read_failed" ? (view.excluded ?? {}) : {},
    );
    return (
      <main>
        <h1>Municipal (Concejales)</h1>
        <p role="alert">Refused: {view.reason}</p>
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
        {carried !== null ? (
          <p role="note">
            {carried} were excluded by the official-source filter before this
            failure.
          </p>
        ) : null}
      </main>
    );
  }

  const { rows } = view;
  // Computed BEFORE the path-3 guard, for the same reason it is carried
  // through `read_failed`: a drop already counted must not vanish behind a
  // refusal about something else.
  const excludedSummary = describeExcluded(view.excluded);
  const excludedNote =
    excludedSummary !== null ? (
      <p role="note">
        {excludedSummary} were excluded by the official-source filter and are
        not in any figure on this page.
      </p>
    ) : null;

  // PATH 3. See `drilldown`: unreachable while the repository filter holds,
  // live the moment it does not.
  const levels = readGranularity(rows);
  // Disclosure is not permission: this page announced the mix and then summed
  // across it anyway, so a seccion row and a mesa row inside it were added
  // together. See `mixedGranularityReason`.
  const unsummable = mixedGranularityReason(rows);
  // The SIZE of each unorderable level, not just its name: many rows on one
  // unknown level read as "1 row(s)" when only the names are printed.
  const unrecognized = unrecognizedLevels(rows);
  // PER LIST ID, and the ONLY place unresolved rows are reported:
  // `votesByParty` leaves them out of the ranked list entirely.
  // UNCONDITIONAL. Unmappability is independent of granularity, and this is a
  // per-list-id SIZE rather than a total claimed about the election, so zeroing
  // it when levels mix hid which ids failed to map behind a refusal about
  // arithmetic. `topParty` documents the same rule and its test locks it in.
  const unmapped = unmappedByListId(rows);

  const foreignRows = rows.filter((row) => row.sourceKind !== "official");
  if (foreignRows.length > 0) {
    return (
      <main>
        <h1>Municipal (Concejales)</h1>
        <p role="alert">
          Refused: {describeExcluded(tallyByKind(foreignRows))} of {rows.length}{" "}
          rows are not official. Official and fiscalización figures are never
          combined in one number.
        </p>
        {excludedNote}
        {/* Both counted before this refusal and about facts it does not touch:
            which list ids failed to map, and which levels cannot be ordered,
            do not depend on source kinds. The sibling pages carry theirs. */}
        <UnmappedListIds
          entries={unmapped.entries}
          withoutListId={unmapped.withoutListId}
          totalRows={rows.length}
          unsummable={unsummable}
          mappingConfigured={view.partyMappingConfigured}
        />
        <UnorderableLevels entries={unrecognized} />
      {missingProvenance.length > 0 ? (
        <p role="alert">
          {missingProvenance.length} archive entry/entries backing these figures
          resolved to no source record ({missingProvenance.join(", ")}); those
          figures cannot be traced.
        </p>
      ) : null}
      </main>
    );
  }
  // AGGREGATED per party. `result_row` holds ONE ROW PER (mesa, list), so
  // rendering rows verbatim printed the same party N times with N different
  // numbers and no mesa label to tell them apart -- each line reading as that
  // party's figure, and the list visibly failing to sum to the total above it.

  const partyTotals = unsummable !== null ? [] : votesByParty(rows);


  return (
    <main>
      <h1>Municipal (Concejales)</h1>
      {excludedNote}
      <UnmappedListIds
        entries={unmapped.entries}
        withoutListId={unmapped.withoutListId}
        totalRows={rows.length}
        unsummable={unsummable}
        mappingConfigured={view.partyMappingConfigured}
      />
      {missingProvenance.length > 0 ? (
        <p role="alert">
          {missingProvenance.length} archive entry/entries backing these figures
          resolved to no source record ({missingProvenance.join(", ")}); those
          figures cannot be traced.
        </p>
      ) : null}
      {unsummable !== null ? (
        <p role="alert">
          No per-party figures: {unsummable}. A total that double-counts is
          worse than no total.
        </p>
      ) : null}
      <UnorderableLevels entries={unrecognized} />
      {/* No rows, no granularity claim: `readGranularity([])` answers
          `distrito` so the fold cannot upgrade, but rendering that as a badge
          asserts a level for data that does not exist. Withheld with the
          figure too: `readGranularity` folds to the COARSEST level, so a badge
          beside a refusal names one of the mixed levels as if it were the
          set's — hiding the mix the refusal exists to announce. */}
      {rows.length === 0 || unsummable !== null ? null : (
        <GranularityBadge {...jurisdictionTotalLevel(levels.granularity)} />
      )}
      {rows.length === 0 ? (
        <p>No municipal results found for this jurisdiction/category/election.</p>
      ) : (
        <>
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

interface MunicipalPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}


/**
 * Authenticated operator route for PBA municipal (Concejales) results.
 * RSC, server-only reads — reaches data ONLY through
 * `repository.queryOfficial()` via `loadMunicipalView`. Linked from
 * `(authenticated)/layout.tsx` so it is reachable by an operator
 * navigating the app, not merely addressable by URL.
 */
export default async function MunicipalPage({
  searchParams,
}: MunicipalPageProps): Promise<ReactNode> {
  const params = await searchParams;

  // Refused BEFORE anything is read: `stringParam` yields `undefined` for a
  // repeated param, so without this a supplied value looks absent.
  const repeated = repeatedParams(params);
  if (repeated.length > 0) {
    return (
      <main>
        <h1>Municipal (Concejales)</h1>
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

  // The mapping is fixed to ONE race; the election is not. A 2023 municipal
  // election resolved its list ids through the 2025 table, which is the same
  // "one party, three ids" failure the sibling pages refuse for — `135` in the
  // 2023 PASO, `20135` in the generales, `110` in 2025.
  // The jurisdiction and category this route's mapping describes. They are
  // database ids, so they are CONFIGURATION -- and an unconfigured scope
  // refuses, because accepting any id while pinning the concejales mapping
  // reads DIPUTADO NACIONAL rows and names them through the wrong table. The
  // sibling pages refuse for exactly this; this is the file that did it.
  // THE boundary, like its siblings. Reading the env directly left this route
  // on the old behaviour: with both ids configured the same, `compare` and
  // `drilldown` refuse the collision while this page served every list id
  // through the municipal table — `2206` naming a party for national rows.
  // FIRST, before every scope guard. Running them first meant an omitted
  // `jurisdictionId` reached `resolvePartyFamily(undefined)` and refused with
  // "jurisdiction  is not the municipal one this route serves" — an empty
  // interpolation where an id belongs, naming the wrong cause for a request
  // that simply left the parameter out. `electionId &&` on each guard was the
  // symptom of that ordering.
  if (!electionId || !jurisdictionId || !categoryId) {
    return (
      <main>
        <h1>Municipal (Concejales)</h1>
        <p>
          Provide <code>electionId</code>, <code>jurisdictionId</code> and{" "}
          <code>categoryId</code> query parameters.
        </p>
      </main>
    );
  }

  const family = resolvePartyFamily(jurisdictionId);
  const scopeCategoryId = pinnedCategoryId("MUNICIPAL");
  if (family.status !== "ok" || family.family !== "coronel_rosales_municipal") {
    return (
      <main>
        <h1>Municipal (Concejales)</h1>
        <p role="alert">
          Refused:{" "}
          {partyFamilyRefusal(family, "coronel_rosales_municipal")}
          .
        </p>
      </main>
    );
  }
  if (!scopeCategoryId) {
    return (
      <main>
        <h1>Municipal (Concejales)</h1>
        <p role="alert">
          Refused: MUNICIPAL_CATEGORY_ID is not configured, so a request cannot be shown to describe the race this
          route&apos;s party mapping covers.
        </p>
      </main>
    );
  }
  if (categoryId !== scopeCategoryId) {
    return (
      <main>
        <h1>Municipal (Concejales)</h1>
        <p role="alert">
          Refused: this route resolves list ids through the{" "}
          {MUNICIPAL_PARTY_CONTEXT.category} mapping for one jurisdiction; got
          jurisdiction {jurisdictionId} category {categoryId}.
        </p>
      </main>
    );
  }

  // From the `election` ROW. Parsing the id string worked for a curated slug
  // and never for the uuid the database stores, so this route refused every
  // real request while the year sat in a column beside the id.
  const supabaseForYear = await createSupabaseServerClient();
  let year: YearLookup;
  try {
    year = await fetchElectionYear(supabaseForYear, electionId);
  } catch (error) {
    return (
      <main>
        <h1>Municipal (Concejales)</h1>
        <p role="alert">
          Refused: {error instanceof Error ? error.message : String(error)}
        </p>
      </main>
    );
  }
  if (year.status !== "ok" || year.year !== MUNICIPAL_PARTY_CONTEXT.year) {
    return (
      <main>
        <h1>Municipal (Concejales)</h1>
        <p role="alert">
          Refused: this route resolves list ids through the{" "}
          {MUNICIPAL_PARTY_CONTEXT.year} {MUNICIPAL_PARTY_CONTEXT.category} mapping,
          and {electionId} is not that election{" "}
          {year.status === "no_row"
            ? "(no election row carries that id)"
            : year.status === "unreadable_year"
              ? "(its election row carries no usable year)"
              : `(it is ${year.year})`}
          . A list id means nothing outside its own election&apos;s mapping.
        </p>
      </main>
    );
  }

  const repository = await createResultsRepository();
  const view = await loadMunicipalView(repository, { electionId, jurisdictionId, categoryId });

  let sources: SourceRef[];
  let missingProvenance: string[] = [];
  try {
    const supabase = await createSupabaseServerClient();
    if (view.status === "ok") {
      const refs = await fetchSourceRefs(supabase, [
        ...new Set(view.rows.map((row) => row.archiveEntryId)),
      ]);
      sources = refs.sources;
      // `.missing` is why `fetchSourceRefs` returns a pair: an id resolving to
      // no `archive_entry` row used to vanish, so provenance rendered for a
      // SUBSET of the figures and said nothing about the rest. The three
      // sibling routes render it; this one dropped it.
      missingProvenance = refs.missing;
    } else {
      sources = [];
    }
  } catch (error) {
    return renderMunicipalView({
      status: "read_failed",
      reason: error instanceof Error ? error.message : String(error),
      ...(view.status === "ok"
        ? {
            excluded: view.excluded,
            // The same fact `drilldown` carries through the same failure.
            // Preserving `excluded` and discarding this was one refusal with
            // two policies.
            unmapped: unmappedByListId(view.rows).entries,
            unsummable: mixedGranularityReason(view.rows),
            totalRows: view.rows.length,
            unrecognized: unrecognizedLevels(view.rows),
            partyMappingConfigured: view.partyMappingConfigured,
            withoutListId: unmappedByListId(view.rows).withoutListId,
          }
        : {}),
    });
  }

  return renderMunicipalView(view, sources, missingProvenance);
}
