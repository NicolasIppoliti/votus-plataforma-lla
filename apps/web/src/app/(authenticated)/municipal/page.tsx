import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { GranularityBadge } from "@/components/GranularityBadge";
import { UnmappedListIds } from "@/components/UnmappedListIds";
import { UnorderableLevels } from "@/components/UnorderableLevels";
import { ProvenanceLink } from "@/components/ProvenanceLink";
import {
  createResultsRepository,
  fetchSourceRefs,
  type BaseQuery,
  PartyMappingReadError,
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
  PARTY_FAMILY,
  pinnedCategoryId,
  servedJurisdictionId,
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
  jurisdiction: PARTY_FAMILY.MUNICIPAL,
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
      /** Archive entries known before party mapping failed. */
      archiveEntryIds?: string[];
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
    if (error instanceof PartyMappingReadError) {
      return {
        status: "read_failed",
        reason: `No se pudo resolver el mapeo municipal de partidos: ${error.message}`,
        excluded: error.excluded,
        unsummable: mixedGranularityReason(error.rows),
        totalRows: error.rows.length,
        unrecognized: unrecognizedLevels(error.rows),
        partyMappingConfigured: true,
        withoutListId: tallyByKind(error.rows.filter((row) => row.listId === null)),
        archiveEntryIds: [...new Set(error.rows.map((row) => row.archiveEntryId))],
      };
    }
    return {
      status: "read_failed",
      reason: `No se pudo completar la lectura municipal: ${error instanceof Error ? error.message : String(error)}`,
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
        <p role="alert">Se rechazó la lectura: {view.reason}</p>
        {view.status === "read_failed" && (view.unmapped || view.withoutListId) ? (
          <UnmappedListIds
            entries={view.unmapped ?? []}
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
            {carried} se excluyeron por el filtro de fuente oficial antes de esta
            falla.
          </p>
        ) : null}
        {missingProvenance.length > 0 ? (
          <p role="alert">No se pudo verificar la procedencia de {missingProvenance.join(", ")}.</p>
        ) : null}
        <ProvenanceLink sources={sources} />
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
        {excludedSummary} se excluyeron por el filtro de fuente oficial y no
        forman parte de ninguna cifra de esta página.
      </p>
    ) : null;

  // PATH 3. See `drilldown`: unreachable while the repository filter holds,
  // live the moment it does not.
  const levels = readGranularity(rows);
  const requestedLevels = new Set(
    rows
      .map((row) => row.requestedGranularity)
      .filter((level): level is NonNullable<typeof level> => level != null),
  );
  const requestedLevel =
    requestedLevels.size === 1 && rows.every((row) => row.requestedGranularity != null)
      ? [...requestedLevels][0]
      : undefined;
  const totalLevel = jurisdictionTotalLevel(levels.granularity);
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
          Se rechazó la solicitud: {describeExcluded(tallyByKind(foreignRows))} de{" "}
          {rows.length} filas no son oficiales. Las cifras oficiales y de
          fiscalización nunca se combinan en un mismo número.
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
          {missingProvenance.length} entrada(s) de archivo que respaldan estas
          cifras no se resolvieron a un registro de fuente (
          {missingProvenance.join(", ")}); esas cifras no se pueden rastrear.
        </p>
      ) : null}
      <ProvenanceLink sources={sources} />
      </main>
    );
  }

  let partyTotals: ReturnType<typeof votesByParty> = [];
  try {
    partyTotals = unsummable !== null ? [] : votesByParty(rows);
  } catch {
    return <main>
      <h1>Municipal (Concejales)</h1>
      <p role="alert">Se rechazó la solicitud: un mismo partido canónico tiene nombres
        incompatibles. No se muestran cifras hasta resolver el conflicto.</p>
      {excludedNote}
      <UnmappedListIds entries={unmapped.entries} withoutListId={unmapped.withoutListId}
        totalRows={rows.length} unsummable={unsummable} mappingConfigured={view.partyMappingConfigured} />
      <UnorderableLevels entries={unrecognized} />
      {missingProvenance.length > 0 ? <p role="alert">No se pudo verificar la procedencia de {missingProvenance.join(", ")}.</p> : null}
      <ProvenanceLink sources={sources} />
    </main>;
  }

  return (
    <main>
      <h1>Resultados municipales (Concejales)</h1>
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
          {missingProvenance.length} entrada(s) de archivo que respaldan estas
          cifras no se resolvieron a un registro de fuente (
          {missingProvenance.join(", ")}); esas cifras no se pueden rastrear.
        </p>
      ) : null}
      {unsummable !== null ? (
        <p role="alert">
          No hay cifras por partido: {unsummable}. Un total que duplica el
          conteo es peor que no tener total.
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
        <GranularityBadge
          granularity={totalLevel.granularity}
          {...(totalLevel.summedFrom !== undefined
            ? { summedFrom: totalLevel.summedFrom }
            : {})}
          {...(requestedLevel !== undefined && requestedLevel !== levels.granularity
            ? { requestedGranularity: requestedLevel }
            : {})}
        />
      )}
      {rows.length === 0 ? (
        <p>No se encontraron resultados municipales para esta jurisdicción, categoría y elección.</p>
      ) : (
        <>
          {unsummable !== null ? null : (
          <ul>
            {partyTotals.map((entry) => (
              <li key={entry.label}>
                {entry.label}: {entry.votes} voto(s)
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

function municipalRefusal(reason: ReactNode): ReactNode {
  return <main><h1>Municipal (Concejales)</h1>
<p role="alert">Se rechazó la solicitud: {reason}</p></main>;
}

interface MunicipalPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}


/**
 * Authenticated operator route for PBA municipal (Concejales) results.
 * RSC, server-only reads — reaches data ONLY through
 * `repository.queryOfficial()` via `loadMunicipalView`. Its dashboard card
 * keeps the prepared route discoverable without presenting a context-dependent
 * request as a primary-navigation destination.
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
          Se rechazó la solicitud: estos parámetros de consulta se proporcionaron
          más de una vez y no se pueden resolver a un único valor: {repeated.join(", ")}.
        </p>
      </main>
    );
  }
  const electionId = stringParam(params, "electionId");
  const legacyJurisdictionId = stringParam(params, "jurisdictionId");
  const legacyCategoryId = stringParam(params, "categoryId");
  const legacyPartyFamily = stringParam(params, "partyJurisdiction");
  const legacyPartyCategory = stringParam(params, "partyCategory");
  const configuredElectionId = process.env["MUNICIPAL_ELECTION_ID"] || undefined;
  const served = servedJurisdictionId(PARTY_FAMILY.MUNICIPAL);
  const categoryId = pinnedCategoryId("MUNICIPAL");

  if (served.status !== "ok" || !configuredElectionId || !categoryId) {
    return (
      <main>
        <h1>Municipal (Concejales)</h1>
        <p role="alert">
          Se rechazó la solicitud: CORONEL_ROSALES_JURISDICTION_ID,
          MUNICIPAL_ELECTION_ID y MUNICIPAL_CATEGORY_ID deben estar configurados.
        </p>
      </main>
    );
  }
  if (electionId && electionId !== configuredElectionId)
    return municipalRefusal(<>esta ruta solo ofrece la elección municipal configurada; se recibió {electionId}.</>);
  if (legacyJurisdictionId && legacyJurisdictionId !== served.jurisdictionId)
    return municipalRefusal(<>la jurisdicción heredada {legacyJurisdictionId} no coincide con la configurada.</>);
  if (legacyCategoryId && legacyCategoryId !== categoryId)
    return municipalRefusal(<>la categoría heredada {legacyCategoryId} no coincide con CONCEJALES.</>);
  if (legacyPartyFamily || legacyPartyCategory)
    return municipalRefusal("la familia y la categoría del mapeo se derivan de esta ruta y no se aceptan como parámetros.");

  // From the `election` ROW. Parsing the id string worked for a curated slug
  // and never for the uuid the database stores, so this route refused every
  // real request while the year sat in a column beside the id.
  const supabaseForYear = await createSupabaseServerClient();
  let year: YearLookup;
  try {
    year = await fetchElectionYear(supabaseForYear, configuredElectionId);
  } catch (error) {
    return (
      <main>
        <h1>Municipal (Concejales)</h1>
        <p role="alert">
          Se rechazó la solicitud: {error instanceof Error ? error.message : String(error)}
        </p>
      </main>
    );
  }
  if (year.status !== "ok" || year.year !== MUNICIPAL_PARTY_CONTEXT.year) {
    return (
      <main>
        <h1>Municipal (Concejales)</h1>
        <p role="alert">
          Se rechazó la solicitud: MUNICIPAL_ELECTION_ID no es de 2025 o no
          identifica una elección legible. No se aplicará el mapeo CONCEJALES.
        </p>
      </main>
    );
  }

  if (!electionId) {
    return <main className="page-shell"><div className="shell-container">
      <h1>Resultados municipales (Concejales)</h1>
      <form method="get" action="/municipal">
        <label htmlFor="municipal-election">Elección municipal</label>
        <select id="municipal-election" name="electionId" defaultValue={configuredElectionId}>
          <option value={configuredElectionId}>Elección municipal 2025 — Concejales</option>
        </select>
        <button type="submit">Ver resultados oficiales</button>
      </form>
    </div></main>;
  }
  if (legacyJurisdictionId || legacyCategoryId) {
    redirect(`/municipal?electionId=${encodeURIComponent(configuredElectionId)}`);
  }

  const jurisdictionId = served.jurisdictionId;
  const repository = await createResultsRepository();
  const view = await loadMunicipalView(repository, { electionId, jurisdictionId, categoryId });

  let sources: SourceRef[];
  let missingProvenance: string[] = [];
  try {
    const archiveEntryIds = view.status === "ok"
      ? [...new Set(view.rows.map((row) => row.archiveEntryId))]
      : (view.archiveEntryIds ?? []);
    if (archiveEntryIds.length === 0) {
      sources = [];
    } else {
      const supabase = await createSupabaseServerClient();
      const refs = await fetchSourceRefs(supabase, archiveEntryIds);
      sources = refs.sources;
      missingProvenance = refs.missing;
    }
  } catch (error) {
    return renderMunicipalView({
      ...(view.status === "ok"
        ? {
            excluded: view.excluded,
            unmapped: unmappedByListId(view.rows).entries,
            unsummable: mixedGranularityReason(view.rows),
            totalRows: view.rows.length,
            unrecognized: unrecognizedLevels(view.rows),
            partyMappingConfigured: view.partyMappingConfigured,
            withoutListId: unmappedByListId(view.rows).withoutListId,
          }
        : view),
      status: "read_failed",
      reason: error instanceof Error ? error.message : String(error),
    });
  }

  return renderMunicipalView(view, sources, missingProvenance);
}
