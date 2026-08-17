import type { ReactNode } from "react";
import { GranularityBadge } from "@/components/GranularityBadge";
import { UnmappedListIds } from "@/components/UnmappedListIds";
import { UnorderableLevels } from "@/components/UnorderableLevels";
import { ProvenanceLink } from "@/components/ProvenanceLink";
import { compareResults } from "@/lib/results/compare";
import type { CompareInput, UnitResult } from "@/lib/results/compare";
import type { Granularity } from "@/lib/results/types";
import {
  createResultsRepository,
  describeExcluded,
  fetchCategoryName,
  fetchElectionYear,
  fetchSourceRefs,
  isPartyResolved,
  unmappedByListId,
  tallyByKind,
} from "@/lib/fiscalizacion/repository";
import type { SourceRef } from "@/lib/results/types";
import type {
  CategoryLookup,
  ExcludedByKind,
  OkResultsQueryResponse,
  ResultRow,
  YearLookup,
} from "@/lib/fiscalizacion/repository";
import { createSupabaseServerClient } from "@/lib/supabase/server-client";
import { repeatedParams, stringParam } from "@/lib/results/query-params";
import {
  GRANULARITY_ORDER,
  coarsestOf,
  JURISDICTION_TOTAL_GRANULARITY,
  jurisdictionTotalLevel,
  mixedGranularityReason,
  readGranularity,
  unrecognizedLevels,
} from "@/lib/results/granularity";
import { partyFamilyRefusal, resolvePartyFamily } from "@/lib/results/party-family";

interface ComparePageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}



/**
 * Groups official rows into `compare.ts`'s per-unit shape, keyed on the
 * CANONICAL PARTY ID and never on `listId` or on the display name. The curated
 * file spells one canonical party "LA LIBERTAD AVANZA" in 2023 and "ALIANZA LA
 * LIBERTAD AVANZA" in 2025, so keying on the name gives the two sides zero
 * common keys — the same fabricated flip as keying on the list id, one layer
 * up.
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
  /** Rows carrying no list id at all — not ids that failed to map. */
  unresolvedWithoutListId: ExcludedByKind;
  /** Canonical id -> the name to show for it. */
  displayNames: Map<string, string>;
} {
  const votesByUnitAndParty = new Map<string, Map<string, number>>();
  const levels = readGranularity(rows);
  let unresolvedRows = 0;
  let unresolvedVotes = 0;
  // THE fold, not a fourth private copy. The inline one sorted by list id
  // while the boundary sorts by votes, so the same question had two answers.
  const unresolvedReading = unmappedByListId(rows);
  const unresolvedByListId = unresolvedReading.entries;
  const displayNames = new Map<string, string>();

  for (const row of rows) {
    // The SAME definition the boundary uses: a row with a canonical id but no
    // display name counted as mapped here, and then rendered the raw id (`lla`)
    // at the operator as if it were a party.
    if (!isPartyResolved(row)) {
      // An unmapped row carries no comparable identity. Falling back to
      // `unmapped (list N)` re-keyed on the raw id, so one party unmapped in
      // both years gave `unmapped (list 20135)` vs `unmapped (list 110)` —
      // zero common keys and a `flipped` claim for a party that never changed
      // hands. The fabricated swing survived on the unmapped path.
      //
      // Rows with NO list id are not ids that failed to map — rule 2:
      // `lista_numero` is empty throughout the 2023 generales file and never
      // populated on a POSITIVO row in 2025. Counting them here refused the
      // whole comparison for a shape the source always had; they are reported
      // in their own sentence by `UnmappedListIds`.
      if (row.listId === null) continue;
      unresolvedRows += 1;
      unresolvedVotes += row.votes;
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
    // `row.partyName` is non-null here: the guard above sends a row without
    // one to the unmapped tally rather than letting it name itself with an id.
    displayNames.set(party, row.partyName);
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
    unresolvedByListId,
    unresolvedWithoutListId: unresolvedReading.withoutListId,
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
        <h1>Comparación entre 2023 y 2025</h1>
        <p role="alert">
          Se rechazó la solicitud: estos parámetros de consulta se proporcionaron
          más de una vez y no se pueden resolver a un único valor: {repeated.join(", ")}.
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
        <h1>Comparación entre 2023 y 2025</h1>
        <p>
          Proporcione los parámetros de consulta <code>election2023</code>,{" "}
          <code>election2025</code>, <code>jurisdictionId</code> y{" "}
          <code>categoryId</code>.
        </p>
      </main>
    );
  }

  if (rawAggregateTo && !aggregateTo) {
    return (
      <main>
        <h1>Comparación entre 2023 y 2025</h1>
        <p role="alert">
          Se rechazó la solicitud: <code>aggregateTo</code> debe ser uno de{" "}
          {GRANULARITY_ORDER.join(", ")}; se recibió {rawAggregateTo}.
        </p>
      </main>
    );
  }

  if (!partyCategory || !partyJurisdiction) {
    // Without the category there is no party mapping to resolve through, and an
    // unresolved comparison is the fabricated-swing case.
    return (
      <main>
        <h1>Comparación entre 2023 y 2025</h1>
        <p role="alert">
          Se rechazó la solicitud: proporcione <code>partyCategory</code> y{" "}
          <code>partyJurisdiction</code>. Cada lado se resuelve mediante su propio
          mapeo de partidos <code>(año, jurisdicción, categoría)</code>, porque un
          mismo partido tiene un ID de lista diferente en cada archivo.
        </p>
      </main>
    );
  }

  // Each side's year from its own `election` ROW. Parsing the ids worked for
  // curated slugs and never for the uuids the database stores, so this page
  // refused every real comparison for want of years it had in a column.
  const supabaseForYears = await createSupabaseServerClient();
  // TYPED, not evolving `any` — the policy `drilldown` states and this file
  // did not follow: an implicit `any` makes every field access typecheck
  // whether the branch that assigns it ran or not.
  let year2023: YearLookup;
  let year2025: YearLookup;
  try {
    [year2023, year2025] = await Promise.all([
      fetchElectionYear(supabaseForYears, electionId2023),
      fetchElectionYear(supabaseForYears, electionId2025),
    ]);
  } catch (error) {
    return (
      <main>
        <h1>Comparación entre 2023 y 2025</h1>
        <p role="alert">
          Se rechazó la solicitud: {error instanceof Error ? error.message : String(error)}
        </p>
      </main>
    );
  }
  let categoryName: CategoryLookup;
  try {
    categoryName = await fetchCategoryName(supabaseForYears, categoryId);
  } catch (error) {
    return (
      <main>
        <h1>Comparación entre 2023 y 2025</h1>
        <p role="alert">
          Se rechazó la solicitud: {error instanceof Error ? error.message : String(error)}
        </p>
      </main>
    );
  }
  if (categoryName.status !== "ok" || categoryName.name !== partyCategory) {
    // The THIRD axis. `2206` names a different party in the municipal table
    // than in the national one; the same holds ACROSS CATEGORIES, and a wrong
    // party here renders as a flip between two that never changed hands.
    return (
      <main>
        <h1>Comparación entre 2023 y 2025</h1>
        <p role="alert">
          Se rechazó la solicitud: la categoría {categoryId}{" "}
          {categoryName.status === "no_row"
            ? "no aparece en ninguna fila de categoría"
            : categoryName.status === "unreadable_name"
              ? "aparece en una fila cuyo nombre no es válido"
              : `se llama ${categoryName.name}`}
          , no {partyCategory}. Resolver un ID de lista mediante el mapeo de otra
          categoría nombra al partido equivocado y fabrica un cambio inexistente.
        </p>
      </main>
    );
  }
  if (year2023.status !== "ok" || year2025.status !== "ok") {
    // NAMED per side: "one of them is unknown" sends the operator to check both.
    return (
      <main>
        <h1>Comparación entre 2023 y 2025</h1>
        <p role="alert">
          Se rechazó la solicitud: no se pudo leer el año de{" "}
          {[
            ...(year2023.status === "ok"
              ? []
              : [`${electionId2023} (${year2023.status === "no_row" ? "sin fila de elección" : "sin año válido"})`]),
            ...(year2025.status === "ok"
              ? []
              : [`${electionId2025} (${year2025.status === "no_row" ? "sin fila de elección" : "sin año válido"})`]),
          ].join(", ")}
          , y sin él no se puede seleccionar un mapeo de partidos.
        </p>
      </main>
    );
  }

  // THE boundary, not a third copy of the decision.
  const family = resolvePartyFamily(jurisdictionId);
  if (family.status !== "ok" || partyJurisdiction !== family.family) {
    return (
      <main>
        <h1>Comparación entre 2023 y 2025</h1>
        <p role="alert">
          Se rechazó la solicitud: {partyFamilyRefusal(family, partyJurisdiction)}.
          Un ID de lista resuelto mediante la familia incorrecta nombra al partido
          equivocado.
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
  let response2023: OkResultsQueryResponse;
  let response2025: OkResultsQueryResponse;
  try {
    [response2023, response2025] = await Promise.all([
    repository.queryOfficial(baseQuery2023, {
      year: year2023.year,
      jurisdiction: partyJurisdiction,
      category: partyCategory,
    }),
    repository.queryOfficial(baseQuery2025, {
      year: year2025.year,
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
        <h1>Comparación entre 2023 y 2025</h1>
        <p role="alert">
          Se rechazó la solicitud: {error instanceof Error ? error.message : String(error)}
        </p>
        <p role="note">
          No se pudo leer uno de los años, por lo que no se informa un desglose por
          tipo de fuente: contar solo el año disponible describiría media comparación.
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
        Filas excluidas por el filtro de fuente oficial y ausentes de todas las
        cifras de esta página: {excludedByYear.join("; ")}.
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
  const compare2023 = toCompareUnits(rows2023);
  const compare2025 = toCompareUnits(rows2025);
  // BEFORE the foreign guard, because that guard runs first: a leaked row set
  // that also mixes levels reached `UnmappedListIds` with `unsummable={null}`
  // and printed the vote sums the prop exists to withhold.
  // PER YEAR. One value fed both blocks, so a mixed 2025 withheld 2023's vote
  // totals for an arithmetic problem in a different query over different rows —
  // the merge this file argues against everywhere else.
  const unsummable2023 = mixedGranularityReason(rows2023);
  const unsummable2025 = mixedGranularityReason(rows2025);

  if (foreign.length > 0) {
    return (
      <main>
        <h1>Comparación entre 2023 y 2025</h1>
        {excludedNote}
        <p role="alert">
          Se rechazó la solicitud: {foreign.length} fila(s) que llegaron a esta
          página no son oficiales ({electionId2023}:{" "}
          {describeExcluded(tallyByKind(foreign2023)) ?? "ninguna"}; {electionId2025}:{" "}
          {describeExcluded(tallyByKind(foreign2025)) ?? "ninguna"}). Las cifras
          oficiales y de fiscalización nunca se combinan en un mismo número.
        </p>
        {/* Both counted before this refusal and about a different axis: which
            list ids failed to map, and which levels cannot be ordered, do not
            depend on source kinds. The three sibling pages carry theirs. */}
        {/* ONE BLOCK PER YEAR. Merging them added votes across two different
            reads and rendered a list id present in both as a single cross-year
            figure with nothing naming the year. */}
        <UnmappedListIds
          label={electionId2023}
          entries={compare2023.unresolvedByListId}
          withoutListId={compare2023.unresolvedWithoutListId}
          mappingConfigured={response2023.partyMappingConfigured}
          totalRows={rows2023.length}
          unsummable={unsummable2023}
        />
        <UnmappedListIds
          label={electionId2025}
          entries={compare2025.unresolvedByListId}
          withoutListId={compare2025.unresolvedWithoutListId}
          mappingConfigured={response2025.partyMappingConfigured}
          totalRows={rows2025.length}
          unsummable={unsummable2025}
        />
        {/* PER YEAR, like the unmapped blocks beside them. Merging added rows
            across two independent reads under one line with nothing naming the
            year — and summed VOTES on a level this module cannot order, which
            is the addition both components exist to withhold. */}
        <UnorderableLevels label={electionId2023} entries={unrecognizedLevels(rows2023)} />
        <UnorderableLevels label={electionId2025} entries={unrecognizedLevels(rows2025)} />
      </main>
    );
  }

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
        <h1>Comparación entre 2023 y 2025</h1>
        {excludedNote}
        {/* Counted by `toCompareUnits` BEFORE this refusal, and about a
            different axis entirely: which list ids resolved to no canonical
            party does not depend on granularity or on row counts. The three
            sibling pages carry theirs through every refusal. */}
        {/* ONE BLOCK PER YEAR. Merging them added votes across two different
            reads and rendered a list id present in both as a single cross-year
            figure with nothing naming the year. */}
        <UnmappedListIds
          label={electionId2023}
          entries={compare2023.unresolvedByListId}
          withoutListId={compare2023.unresolvedWithoutListId}
          mappingConfigured={response2023.partyMappingConfigured}
          totalRows={rows2023.length}
          unsummable={unsummable2023}
        />
        <UnmappedListIds
          label={electionId2025}
          entries={compare2025.unresolvedByListId}
          withoutListId={compare2025.unresolvedWithoutListId}
          mappingConfigured={response2025.partyMappingConfigured}
          totalRows={rows2025.length}
          unsummable={unsummable2025}
        />
        <p role="alert">
          Se rechazó la solicitud: las filas devueltas mezclan niveles de
          granularidad ({[...new Set(mixed)].join(", ")}), por lo que un solo nivel
          no puede describir ninguno de los lados y el control entre años no puede
          detectar la diferencia.
        </p>
        {/* PER LEVEL and in both units, like the three sibling routes. Naming
            the levels alone hid how much of the comparison sits on one this
            module cannot order: many rows on a single unknown level read as
            one problem rather than as most of the data. */}
        {/* THE shared presentation, which reports rows and never a vote total:
            two rows on one unorderable level may be the same votes counted
            twice. This hand-rolled copy printed the sum the component
            refuses. */}
        {/* PER YEAR, like the unmapped blocks beside them. Merging added rows
            across two independent reads under one line with nothing naming the
            year — and summed VOTES on a level this module cannot order, which
            is the addition both components exist to withhold. */}
        <UnorderableLevels label={electionId2023} entries={unrecognizedLevels(rows2023)} />
        <UnorderableLevels label={electionId2025} entries={unrecognizedLevels(rows2025)} />
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
        <h1>Comparación entre 2023 y 2025</h1>
        {excludedNote}
        {/* Counted by `toCompareUnits` BEFORE this refusal, and about a
            different axis entirely: which list ids resolved to no canonical
            party does not depend on granularity or on row counts. The three
            sibling pages carry theirs through every refusal. */}
        {/* ONE BLOCK PER YEAR. Merging them added votes across two different
            reads and rendered a list id present in both as a single cross-year
            figure with nothing naming the year. */}
        <UnmappedListIds
          label={electionId2023}
          entries={compare2023.unresolvedByListId}
          withoutListId={compare2023.unresolvedWithoutListId}
          mappingConfigured={response2023.partyMappingConfigured}
          totalRows={rows2023.length}
          unsummable={unsummable2023}
        />
        <UnmappedListIds
          label={electionId2025}
          entries={compare2025.unresolvedByListId}
          withoutListId={compare2025.unresolvedWithoutListId}
          mappingConfigured={response2025.partyMappingConfigured}
          totalRows={rows2025.length}
          unsummable={unsummable2025}
        />
        <p role="alert">
          Se rechazó la solicitud: {rows2023.length === 0 && rows2025.length === 0
            ? "ningún año"
            : rows2023.length === 0
              ? electionId2023
              : electionId2025}{" "}
          no devolvió filas, por lo que no hay granularidad para comparar ni
          variación para calcular.
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
        <h1>Comparación entre 2023 y 2025</h1>
        {excludedNote}
        <p role="alert">
          Se rechazó la solicitud: {unresolvedRows} fila(s) /{" "}
          {compare2023.unresolvedVotes + compare2025.unresolvedVotes} voto(s) no
          se resolvieron a un partido canónico, y un ID sin mapear no es una
          identidad que pueda compararse entre años.
        </p>
        {/* THE shared presentation. The hand-rolled list beside it was a
            second shape for one fact, and it printed vote sums the component
            withholds when the rows cannot be added. */}
        {/* ONE BLOCK PER YEAR. Merging them added votes across two different
            reads and rendered a list id present in both as a single cross-year
            figure with nothing naming the year. */}
        <UnmappedListIds
          label={electionId2023}
          entries={compare2023.unresolvedByListId}
          withoutListId={compare2023.unresolvedWithoutListId}
          mappingConfigured={response2023.partyMappingConfigured}
          totalRows={rows2023.length}
          unsummable={unsummable2023}
        />
        <UnmappedListIds
          label={electionId2025}
          entries={compare2025.unresolvedByListId}
          withoutListId={compare2025.unresolvedWithoutListId}
          mappingConfigured={response2025.partyMappingConfigured}
          totalRows={rows2025.length}
          unsummable={unsummable2025}
        />
        {/* Levels this module cannot order are independent of mappability, so
            this refusal is about a different axis than that count. */}
        {/* PER YEAR, like the unmapped blocks beside them. Merging added rows
            across two independent reads under one line with nothing naming the
            year — and summed VOTES on a level this module cannot order, which
            is the addition both components exist to withhold. */}
        <UnorderableLevels label={electionId2023} entries={unrecognizedLevels(rows2023)} />
        <UnorderableLevels label={electionId2025} entries={unrecognizedLevels(rows2025)} />
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
        <h1>Comparación entre 2023 y 2025</h1>
        {excludedNote}
        {/* Task 11.14: flagged in the DISPLAY, not only in the API's
            `status` field — an operator scanning this page sees the
            refusal directly, with no figures rendered alongside it. */}
        <p role="alert">
          Granularidad mixta: los datos de 2023 están a nivel{" "}
          {result.granularity2023} y los de 2025 a nivel {result.granularity2025}.
          Vuelva a solicitar la comparación con un parámetro de consulta{" "}
          <code>aggregateTo</code> explícito para combinarlos; esta comparación no
          hace suposiciones (design.md D6).
        </p>
        {/* The FIFTH branch. Rows with no list id are counted and carried,
            and D6 was the one refusal that rendered neither block — the same
            shape this page fixed for `excludedNote` and stopped there. */}
        <UnmappedListIds
          label={electionId2023}
          entries={compare2023.unresolvedByListId}
          withoutListId={compare2023.unresolvedWithoutListId}
          mappingConfigured={response2023.partyMappingConfigured}
          totalRows={rows2023.length}
          unsummable={unsummable2023}
        />
        <UnmappedListIds
          label={electionId2025}
          entries={compare2025.unresolvedByListId}
          withoutListId={compare2025.unresolvedWithoutListId}
          mappingConfigured={response2025.partyMappingConfigured}
          totalRows={rows2025.length}
          unsummable={unsummable2025}
        />
      </main>
    );
  }

  const archiveEntryIds = [...new Set([...rows2023, ...rows2025].map((row) => row.archiveEntryId))];
  let sources: SourceRef[] = [];
  let missingProvenance: string[] = [];
  try {
    const supabase = await createSupabaseServerClient();
    const refs = await fetchSourceRefs(supabase, archiveEntryIds);
    sources = refs.sources;
    missingProvenance = refs.missing;
  } catch (error) {
    return (
      <main>
        <h1>Comparación entre 2023 y 2025</h1>
        {excludedNote}
        <p role="alert">
          Se rechazó la solicitud: {error instanceof Error ? error.message : String(error)}
        </p>
      </main>
    );
  }

  return (
    <main>
      <h1>Comparación entre 2023 y 2025</h1>
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
      {/* Rows with no list id are not ids that failed to map, and the SUCCESS
          path must say so too — they are votes that were cast and are in every
          denominator. Per year, because the two reads are independent. */}
      <UnmappedListIds
        label={electionId2023}
        entries={compare2023.unresolvedByListId}
        withoutListId={compare2023.unresolvedWithoutListId}
        mappingConfigured={response2023.partyMappingConfigured}
        totalRows={rows2023.length}
        unsummable={unsummable2023}
      />
      <UnmappedListIds
        label={electionId2025}
        entries={compare2025.unresolvedByListId}
        withoutListId={compare2025.unresolvedWithoutListId}
        mappingConfigured={response2025.partyMappingConfigured}
        totalRows={rows2025.length}
        unsummable={unsummable2025}
      />
      {missingProvenance.length > 0 ? (
        // DISCLOSED, not refused, and deliberately: an untraceable archive
        // entry does not make the votes wrong, it makes them unquotable. The
        // integrity failures this page refuses for — mixed levels, unmapped
        // identities, leaked source kinds — all make the FIGURE itself
        // unsound; this one leaves it sound and unciteable, which is a
        // different thing an operator must be able to see and weigh.
        <p role="alert">
          {missingProvenance.length} entrada(s) de archivo que respaldan estas
          cifras no se resolvieron a un registro de fuente (
          {missingProvenance.join(", ")}); esas cifras no se pueden rastrear.
        </p>
      ) : null}
      {summedFromRows ? (
        <p role="note">
          Estas cifras son totales jurisdiccionales: la consulta devuelve todas
          las filas de una jurisdicción, y las filas de nivel{" "}
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
          se sumaron para obtenerlos. La insignia muestra el nivel de la CIFRA,
          no el de las filas que la respaldan.
        </p>
      ) : null}
      {result.aggregatedFrom ? (
        <p>
          Agregado a partir de datos de nivel {result.aggregatedFrom} por decisión
          explícita del operador.
        </p>
      ) : null}
      {/* ONE row, because the query returns one jurisdiction. Rendering it as a
          list of units suggested a breadth the figures do not have. */}
      <ul>
        {result.swings.map((swing) => (
          <li key={swing.unitId}>
            {swing.unitId} (jurisdicción completa):{" "}
            {swing.flipped
              ? `cambió de ${fromName(swing.fromParty)} → ${toName(swing.toParty)}`
              : "sin cambio"}
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
