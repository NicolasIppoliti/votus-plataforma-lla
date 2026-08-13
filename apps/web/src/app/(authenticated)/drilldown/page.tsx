import type { ReactNode } from "react";
import { GranularityBadge } from "@/components/GranularityBadge";
import { UnmappedListIds } from "@/components/UnmappedListIds";
import { UnorderableLevels } from "@/components/UnorderableLevels";
import { ProvenanceLink } from "@/components/ProvenanceLink";
import {
  createResultsRepository,
  describeExcluded,
  fetchCategoryName,
  fetchElectionYear,
  fetchSourceRefs,
  tallyByKind,
  unmappedByListId,
  votesByParty,
} from "@/lib/fiscalizacion/repository";
import type {
  CategoryLookup,
  ResultsRepository,
  YearLookup,
} from "@/lib/fiscalizacion/repository";
import type { SourceRef } from "@/lib/results/types";
import { createSupabaseServerClient } from "@/lib/supabase/server-client";
import { repeatedParams, stringParam } from "@/lib/results/query-params";
import {
  jurisdictionTotalLevel,
  mixedGranularityReason,
  readGranularity,
  unrecognizedLevels,
} from "@/lib/results/granularity";
import { partyFamilyRefusal, resolvePartyFamily } from "@/lib/results/party-family";
import {
  createResultsExplorationRepository,
  EXPLORATION_LEVEL,
  formatFacetOptionLabel,
  hasOnlyOfficialSourceAudit,
  normalizeExplorationParams,
  type ExplorationFacets,
  type ExplorationLevel,
  type ExplorationSourceAudit,
  type SchoolBreakdownExclusion,
  type SchoolBreakdownResult,
} from "@/lib/results/exploration";

interface DrilldownPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

interface ExplorerFormProps {
  facets: ExplorationFacets;
  selected: {
    electionId?: string; categoryId?: string; distritoCode?: string;
    seccionCode?: string; circuitoCode?: string; establecimientoCode?: string;
    mesaCode?: number; level?: ExplorationLevel;
  };
}

function ExplorerForm({ facets, selected }: ExplorerFormProps): ReactNode {
  return (
    <form action="/drilldown" method="get">
      <label htmlFor="explorer-election">Election</label>{" "}<select id="explorer-election" name="electionId" defaultValue={selected.electionId ?? ""}>
        <option value="">Choose an election</option>
        {facets.elections.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select>{" "}
      <label htmlFor="explorer-category">Category</label>{" "}<select id="explorer-category" name="categoryId" defaultValue={selected.categoryId ?? ""}>
        <option value="">Choose a category</option>
        {facets.categories.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}</select>{" "}
      <label htmlFor="explorer-distrito">Distrito</label>{" "}<select id="explorer-distrito" name="distritoCode" defaultValue={selected.distritoCode ?? ""}>
        <option value="">Choose a distrito</option>
        {facets.distritos.map((option) => <option key={option.code} value={option.code}>{formatFacetOptionLabel(option)}</option>)}</select>{" "}
      <label htmlFor="explorer-seccion">Sección</label>{" "}<select id="explorer-seccion" name="seccionCode" defaultValue={selected.seccionCode ?? ""}>
        <option value="">Choose a sección</option>
        {facets.secciones.map((option) => <option key={option.code} value={option.code}>{formatFacetOptionLabel(option)}</option>)}</select>{" "}
      <label htmlFor="explorer-circuito">Circuito</label>{" "}<select id="explorer-circuito" name="circuitoCode" defaultValue={selected.circuitoCode ?? ""}>
        <option value="">Any circuito</option>
        {facets.circuitos.map((option) => <option key={option.code} value={option.code}>{formatFacetOptionLabel(option)}</option>)}</select>{" "}
      <label htmlFor="explorer-establecimiento">Establecimiento</label>{" "}<select id="explorer-establecimiento" name="establecimientoCode" defaultValue={selected.establecimientoCode ?? ""}>
        <option value="">Any establecimiento</option>
        {facets.establecimientos.map((option) => <option key={option.code} value={option.code}>{formatFacetOptionLabel(option)}</option>)}</select>{" "}
      <label htmlFor="explorer-mesa">Mesa</label>{" "}<select id="explorer-mesa" name="mesaCode" defaultValue={selected.mesaCode?.toString() ?? ""}>
        <option value="">Any mesa</option>
        {facets.mesas.map((option) => <option key={option.code} value={option.code}>{option.code}</option>)}</select>{" "}
      <label htmlFor="explorer-level">Report level</label>{" "}<select id="explorer-level" name="level" defaultValue={selected.level ?? ""}>
        <option value="">Choose a level</option>
        {facets.availableLevels.map((level) => <option key={level} value={level}>{level}</option>)}</select>{" "}
      <button type="submit">Apply selection</button>
    </form>
  );
}

function formatShare(share: string | null): string {
  return share === null ? "share unavailable" : `${(Number(share) * 100).toFixed(2)}%`;
}

function formatCounts(counts: Record<string, number>): string {
  return Object.entries(counts).map(([reason, count]) => `${reason}: ${count}`).join(", ");
}

function sourceExclusionNotes(exclusions: ExplorationSourceAudit[], aggregate: string): ReactNode {
  return exclusions.map((exclusion) => <p role="note" key={`${aggregate}-${exclusion.kind}`}>
    Excluded {exclusion.rows} {exclusion.kind} rows / {exclusion.votes} votes from the {aggregate} aggregate.
  </p>);
}

function schoolExclusionNotes(
  exclusions: SchoolBreakdownExclusion[], sourceExclusions: ExplorationSourceAudit[],
): ReactNode {
  return <>{sourceExclusionNotes(sourceExclusions, "school")}{exclusions.map((exclusion) =>
    <p role="note" key={exclusion.reason}>Excluded {exclusion.rows} rows / {exclusion.votes} votes: {exclusion.reason}.</p>)}</>;
}

async function renderOfficialExplorer(
  params: Record<string, string | string[] | undefined>,
): Promise<ReactNode> {
  const rawLevel = stringParam(params, "level");
  const level = Object.values(EXPLORATION_LEVEL).find((candidate) => candidate === rawLevel);
  if (rawLevel && !level) {
    return <main><h1>Explore official results</h1><p role="alert">Refused: unsupported report level {rawLevel}.</p></main>;
  }
  const rawCodes = {
    distritoCode: stringParam(params, "distritoCode"),
    seccionCode: stringParam(params, "seccionCode"),
    circuitoCode: stringParam(params, "circuitoCode"),
    establecimientoCode: stringParam(params, "establecimientoCode"),
    mesaCode: stringParam(params, "mesaCode"),
  };
  const normalized = normalizeExplorationParams(Object.fromEntries(
    Object.entries(rawCodes).filter((entry): entry is [string, string] => entry[1] !== undefined),
  ));
  if (normalized.status === "invalid") {
    return <main><h1>Explore official results</h1><p role="alert">Refused: {normalized.reason}. {formatCounts(normalized.counts)}.</p></main>;
  }

  const electionId = stringParam(params, "electionId");
  const categoryId = stringParam(params, "categoryId");
  const client = await createSupabaseServerClient();
  const repository = createResultsExplorationRepository(client);
  let facets: ExplorationFacets;
  try {
    facets = await repository.facets({
      ...(electionId ? { electionId } : {}),
      ...(categoryId ? { categoryId } : {}),
      ...(normalized.value.distritoCode ? { distritoCode: normalized.value.distritoCode } : {}),
      ...(normalized.value.seccionCode ? { seccionCode: normalized.value.seccionCode } : {}),
      ...(normalized.value.circuitoCode ? { circuitoCode: normalized.value.circuitoCode } : {}),
      ...(normalized.value.establecimientoCode ? { establecimientoCode: normalized.value.establecimientoCode } : {}),
    });
  } catch (error) {
    return <main><h1>Explore official results</h1><p role="alert">Refused: {error instanceof Error ? error.message : String(error)}</p></main>;
  }

  const requestedCircuito = normalized.value.circuitoCode;
  const circuitoMatches = !requestedCircuito || facets.circuitos.some((option) => option.code === requestedCircuito);
  const requestedEstablecimiento = normalized.value.establecimientoCode;
  const establecimientoMatches = circuitoMatches && (!requestedEstablecimiento ||
    facets.establecimientos.some((option) => option.code === requestedEstablecimiento));
  const requestedMesa = normalized.value.mesaCode;
  const mesaMatches = establecimientoMatches && (requestedMesa === undefined ||
    facets.mesas.some((option) => option.code === requestedMesa));
  const hierarchyMatches = circuitoMatches && establecimientoMatches && mesaMatches;
  const effectiveCodes = {
    ...(normalized.value.distritoCode ? { distritoCode: normalized.value.distritoCode } : {}),
    ...(normalized.value.seccionCode ? { seccionCode: normalized.value.seccionCode } : {}),
    ...(circuitoMatches && requestedCircuito ? { circuitoCode: requestedCircuito } : {}),
    ...(establecimientoMatches && requestedEstablecimiento ? { establecimientoCode: requestedEstablecimiento } : {}),
    ...(mesaMatches && typeof requestedMesa === "number" ? { mesaCode: requestedMesa } : {}),
  };
  const selected = {
    ...(electionId ? { electionId } : {}), ...(categoryId ? { categoryId } : {}),
    ...effectiveCodes, ...(level ? { level } : {}),
  };
  const form = <ExplorerForm facets={facets} selected={selected} />;
  const distritoCode = effectiveCodes.distritoCode;
  const seccionCode = effectiveCodes.seccionCode;
  const baseReady = Boolean(electionId && categoryId && distritoCode && level);
  const scopeReady = level === EXPLORATION_LEVEL.DISTRITO || Boolean(seccionCode);
  if (!hierarchyMatches || !baseReady || !scopeReady || !electionId || !categoryId || !distritoCode || !level) {
    return <main><h1>Explore official results</h1>{form}<p role="status">Choose the available selectors, then apply the selection. The resulting URL is a reusable deep link.</p></main>;
  }

  let result;
  try {
    result = await repository.official({
      electionId, categoryId, distritoCode,
      ...(seccionCode ? { seccionCode } : {}),
      ...(effectiveCodes.circuitoCode ? { circuitoCode: effectiveCodes.circuitoCode } : {}),
      ...(effectiveCodes.establecimientoCode ? { establecimientoCode: effectiveCodes.establecimientoCode } : {}),
      ...(typeof effectiveCodes.mesaCode === "number" ? { mesaCode: effectiveCodes.mesaCode } : {}),
      requestedLevel: level,
    });
  } catch (error) {
    return <main><h1>Explore official results</h1>{form}<p role="alert">Refused: {error instanceof Error ? error.message : String(error)}</p></main>;
  }
  if (result.status !== "ok") {
    return <main><h1>Explore official results</h1>{form}<p role="alert">Refused: {result.reason}. {formatCounts(result.counts)}.</p>
      {sourceExclusionNotes(result.sourceExclusions ?? [], "official")}</main>;
  }
  if (!hasOnlyOfficialSourceAudit(result.sourceAudit)) {
    return <main><h1>Explore official results</h1>{form}<p role="alert">Refused: the aggregate source audit includes non-official rows.</p></main>;
  }

  let schoolBreakdown: SchoolBreakdownResult | null = null;
  if (level === EXPLORATION_LEVEL.SECCION) {
    if (!seccionCode) {
      return <main><h1>Explore official results</h1>{form}<p role="alert">Refused: school breakdown requires a complete seccion selection.</p></main>;
    }
    try {
      schoolBreakdown = await repository.schools({
        electionId, categoryId, distritoCode,
        seccionCode, requestedLevel: level,
      });
    } catch (error) {
      return <main><h1>Explore official results</h1>{form}<p role="alert">Refused: {error instanceof Error ? error.message : String(error)}</p></main>;
    }
    if (schoolBreakdown.status === "ok" && !hasOnlyOfficialSourceAudit(schoolBreakdown.sourceAudit)) {
      return <main><h1>Explore official results</h1>{form}<p role="alert">Refused: the school breakdown source audit includes non-official rows.</p></main>;
    }
  }

  let sources: SourceRef[] = [];
  let missing: string[] = [];
  try {
    const schoolArchiveIds = schoolBreakdown?.status === "ok"
      ? schoolBreakdown.schools.flatMap((school) => school.archiveEntryIds) : [];
    const sourceResult = await fetchSourceRefs(client, [...new Set([...result.archiveEntryIds, ...schoolArchiveIds])]);
    sources = sourceResult.sources;
    missing = sourceResult.missing;
  } catch (error) {
    return <main><h1>Explore official results</h1>{form}<p role="alert">Refused: {error instanceof Error ? error.message : String(error)}</p></main>;
  }

  return (
    <main>
      <h1>Explore official results</h1>
      {form}
      <h2>Official breakdown</h2>
      <p role="status">
        {result.totalVotes} votes at {result.level} level from {result.sourceGranularity} source rows
        {result.mesaCount === null ? ". Mesa count is unavailable at the published source granularity." : ` across ${result.mesaCount} mesas.`}
      </p>
      <p>Election shape: {result.electionYear} {result.electionRound}.</p>
      {sourceExclusionNotes(result.sourceExclusions, "official")}
      <table>
        <caption>Official votes and share by party</caption>
        <thead><tr><th scope="col">Party identity</th><th scope="col">Votes</th><th scope="col">Share</th></tr></thead>
        <tbody>
          {result.parties.map((party, index) => (
            <tr key={party.canonicalPartyId ?? `${party.listId ?? "missing-list"}-${index}`}>
              <th scope="row">{party.identityStatus === "canonical" ? party.displayName : `Unmapped list ${party.listId ?? "(list id unavailable)"}`}</th>
              <td>{party.votes} votes</td>
              <td>{formatShare(party.voteShare)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {schoolBreakdown?.status === "ok" ? (
        <section aria-labelledby="school-breakdown-heading">
          <h2 id="school-breakdown-heading">Official school breakdown</h2>
          {schoolExclusionNotes(schoolBreakdown.exclusions, schoolBreakdown.sourceExclusions)}
          <table>
            <caption>Official votes by circuit and establishment</caption>
            <thead><tr><th scope="col">Establishment</th><th scope="col">Mesas</th><th scope="col">Party identity</th><th scope="col">Votes</th><th scope="col">Share</th></tr></thead>
            <tbody>{schoolBreakdown.schools.flatMap((school) => school.parties.map((party, index) => (
              <tr key={`${school.circuitoCode}-${school.code}-${party.canonicalPartyId ?? party.listId ?? index}`}>
                <th scope="row">Circuito {school.circuitoCode} — {school.code}{school.name ? ` — ${school.name}` : ""}</th>
                <td>{school.mesaCount} mesas</td>
                <td>{party.identityStatus === "canonical" ? party.displayName : `Unmapped list ${party.listId ?? "(list id unavailable)"}`}</td>
                <td>{party.votes} votes</td><td>{formatShare(party.voteShare)}</td>
              </tr>
            )))}</tbody>
          </table>
        </section>
      ) : schoolBreakdown ? (
        <section aria-labelledby="school-breakdown-heading"><h2 id="school-breakdown-heading">Official school breakdown</h2>
          <p role="alert">Refused: {schoolBreakdown.reason}. {formatCounts(schoolBreakdown.counts)}.</p>
          {schoolExclusionNotes(schoolBreakdown.exclusions ?? [], schoolBreakdown.sourceExclusions ?? [])}</section>
      ) : null}
      {missing.length > 0 ? <p role="alert">{missing.length} archive entry/entries resolved to no source record ({missing.join(", ")}); these figures cannot be traced.</p> : null}
      <ProvenanceLink sources={sources} />
    </main>
  );
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

  if (!jurisdictionId && !partyCategory && !partyJurisdiction) {
    return renderOfficialExplorer(params);
  }

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
  if (!partyCategory || !partyJurisdiction) {
    return (
      <main>
        <h1>Drilldown</h1>
        <p role="alert">
          Refused: provide <code>partyCategory</code> and{" "}
          <code>partyJurisdiction</code> — list ids are only meaningful through
          their own election&apos;s party mapping.
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

  // The year comes from the `election` ROW, not from the id string. Parsing the
  // id worked for a curated slug and never for a uuid, so every real request
  // refused for want of a year the database had in a column all along.
  const supabaseForYear = await createSupabaseServerClient();
  let year: YearLookup;
  try {
    year = await fetchElectionYear(supabaseForYear, electionId);
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
  let categoryName: CategoryLookup;
  try {
    categoryName = await fetchCategoryName(supabaseForYear, categoryId);
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
  if (categoryName.status !== "ok" || categoryName.name !== partyCategory) {
    // The THIRD axis, bounded like the other two. `categoryId` filters the
    // rows and `partyCategory` keys the mapping, and nothing tied them: any
    // list id present in both tables resolved to a different canonical party
    // under the wrong one, with no refusal and no note.
    return (
      <main>
        <h1>Drilldown</h1>
        <p role="alert">
          Refused: category {categoryId} is{" "}
          {categoryName.status === "no_row"
            ? "carried by no category row"
            : categoryName.status === "unreadable_name"
              ? "carried by a row whose name is unusable"
              : categoryName.name}
          , not {partyCategory}. A list id resolved through another
          category&apos;s mapping names the wrong party.
        </p>
      </main>
    );
  }
  if (year.status !== "ok") {
    // No row, no year — and a mapping year nobody established is exactly what
    // resolves `110` and `20135` as two parties.
    return (
      <main>
        <h1>Drilldown</h1>
        <p role="alert">
          Refused:{" "}
          {year.status === "no_row"
            ? `no election row carries the id ${electionId}`
            : `the election row for ${electionId} carries no usable year`}
          , so the year its party mapping must be read through is unknown.
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
  // TYPED rather than evolving `any`: these are read after two try/catch
  // blocks, and an implicit `any` made every field access typecheck whether the
  // branch that assigns it ran or not.
  let response: Awaited<ReturnType<ResultsRepository["queryOfficial"]>>;
  // `| undefined` because the catch below READS it: `aggregateOfficialVotes`
  // may be what threw, and then path 2 produced no tally to report. The
  // evolving `any` let that read typecheck without the possibility existing in
  // the type at all.
  let aggregate: Awaited<ReturnType<ResultsRepository["aggregateOfficialVotes"]>> | undefined;
  let sources: SourceRef[] = [];
  let missingProvenance: string[] = [];
  try {
    response = await repository.queryOfficial(
      { electionId, jurisdictionId, categoryId },
      { year: year.year, jurisdiction: partyJurisdiction, category: partyCategory },
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

  const rows = response.rows;
  // Can these rows be ADDED? A `seccion` row already contains the `mesa` rows
  // beneath it, so this page used to disclose the mix and then sum it anyway:
  // one seccion row of 10 plus one mesa row of 10 inside it rendered 20 votes
  // for a party that got 10. Disclosure is not permission.
  const unsummable = mixedGranularityReason(rows);
  // PER LIST ID, and the ONLY place unresolved rows are reported:
  // `votesByParty` leaves them out of the ranked list entirely.
  // UNCONDITIONAL. Unmappability is independent of granularity, and this is a
  // per-list-id SIZE rather than a total claimed about the election, so zeroing
  // it when levels mix hid which ids failed to map behind a refusal about
  // arithmetic. `topParty` documents the same rule and its test locks it in.
  const unmapped = unmappedByListId(rows);
  // The SIZE of each unorderable level, not just its name: many rows on one
  // unknown level read as "1 row(s)" when only the names are printed.
  const unrecognized = unrecognizedLevels(rows);

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
        {/* Counted before this refusal, and about a different fact entirely:
            WHICH list ids failed to map does not depend on source kinds, on
            the aggregate, or on whether a later read succeeded. */}
        <UnmappedListIds entries={unmapped.entries}
        withoutListId={unmapped.withoutListId} totalRows={rows.length} unsummable={unsummable}
          mappingConfigured={response.partyMappingConfigured}
        />
        {/* And the levels this page cannot order, counted with it and just as
            independent of what these refusals are about. */}
        <UnorderableLevels entries={unrecognized} />
      </main>
    );
  }
  // THE shared boundary. Taking `rows[0]` claimed the level of whichever row
  // the query happened to return first, which can be finer than the set
  // supports — the third page to derive this differently.
  // AGGREGATED per party. `result_row` holds ONE ROW PER (mesa, list), so
  // rendering rows verbatim printed the same party N times with N different
  // numbers and no mesa label to tell them apart -- each line reading as that
  // party's figure, and the list visibly failing to sum to the total above it.

  const levels = readGranularity(rows);
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
    // BOTH reads' entries. Resolving path 1's only left `Official total` — a
    // displayed figure from an independent fetch — with no source record, and
    // unable to appear in `missing` either.
    const refs = await fetchSourceRefs(supabase, [
      ...new Set([...rows.map((row) => row.archiveEntryId), ...aggregate.archiveEntryIds]),
    ]);
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
        {/* And WHICH ids failed to map, counted before this failure and
            independent of it. */}
        <UnmappedListIds entries={unmapped.entries}
        withoutListId={unmapped.withoutListId} totalRows={rows.length} unsummable={unsummable}
          mappingConfigured={response.partyMappingConfigured}
        />
        {/* And the levels this page cannot order, counted with it and just as
            independent of what these refusals are about. */}
        <UnorderableLevels entries={unrecognized} />
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
        {/* Counted before this refusal, and about a different fact entirely:
            WHICH list ids failed to map does not depend on source kinds, on
            the aggregate, or on whether a later read succeeded. */}
        <UnmappedListIds entries={unmapped.entries}
        withoutListId={unmapped.withoutListId} totalRows={rows.length} unsummable={unsummable}
          mappingConfigured={response.partyMappingConfigured}
        />
        {/* And the levels this page cannot order, counted with it and just as
            independent of what these refusals are about. */}
        <UnorderableLevels entries={unrecognized} />
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
      {rows.length > 0 &&
      unsummable === null &&
      // Path 2's total is not a figure to compare against when ITS rows cannot
      // be summed: the disagreement would be with a double count.
      aggregate.unsummableReason === null &&
      aggregate.totalVotes !== rows.reduce((sum, row) => sum + row.votes, 0) ? (
        // `rows.length > 0` because the empty case has its OWN alert below,
        // which states the same disagreement in the terms that actually apply
        // there. Both firing printed one fact as two.
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
      {rows.length === 0 || unsummable !== null || aggregate.unsummableReason !== null ? null : (
      <p role="note">
        Official total: {aggregate.totalVotes} votes ({aggregate.sourceKind} source
        only)
        {/* NOT repeated here: the same tally already has its own note above,
            and one drop printed twice reads as two. */}
        .
      </p>
      )}
      {aggregate.unsummableReason !== null ? (
        // Path 2's OWN levels. `unsummable` is computed from path 1's rows and
        // path 2 fetches independently, so a mixed set reaching only it made
        // `Official total` a double count rendered as the official figure.
        <p role="alert">
          No official total: the rows that read summed {aggregate.unsummableReason}.
          A total that double-counts is worse than no total.
        </p>
      ) : null}
      {excludedNote}
      <UnmappedListIds entries={unmapped.entries}
        withoutListId={unmapped.withoutListId} totalRows={rows.length} unsummable={unsummable}
          mappingConfigured={response.partyMappingConfigured}
        />
      {unsummable !== null ? (
        <p role="alert">
          No per-party figures: {unsummable}. The rows are shown by nothing
          here; a total that double-counts is worse than no total.
        </p>
      ) : null}
      <UnorderableLevels entries={unrecognized} />
      {rows.length === 0 ? (
        aggregate.unsummableReason !== null ? (
          // NOT "no results" either. `mixedGranularityReason` needs at least
          // two levels, so path 2 cannot be unsummable without having READ
          // rows — the total is withheld, but the data is not absent, and
          // saying it is states a fact nobody established.
          <p role="alert">
            This read returned no rows. The official total&apos;s own read did
            return rows, and they cannot be summed, so neither a figure nor an
            absence can be reported for this jurisdiction/category/election.
          </p>
        ) : aggregate.totalVotes > 0 ? (
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
