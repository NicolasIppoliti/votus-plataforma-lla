import type { ReactNode } from "react";
import { GranularityBadge } from "@/components/GranularityBadge";
import { TableScroll } from "@/components/TableScroll";
import { UnmappedListIds } from "@/components/UnmappedListIds";
import { UnorderableLevels } from "@/components/UnorderableLevels";
import {
  describeExcluded,
  tallyByKind,
  type ExcludedByKind,
  type ResultRow,
  unmappedByListId,
  votesByParty,
} from "@/lib/results/result-rows";
import { repeatedParams, stringParam } from "@/lib/results/query-params";
import {
  jurisdictionTotalLevel,
  mixedGranularityReason,
  readGranularity,
  unrecognizedLevels,
} from "@/lib/results/granularity";
import {
  loadMunicipalOfficialEvidence, MUNICIPAL_JURISDICTION_ID,
  type MunicipalOfficialEvidence,
  type OfficialProvenanceMetadata,
} from "@/lib/workspace/official-evidence";

export type MunicipalView =
  // The authorized adapter cannot produce an unofficial opt-in state.
  | {
      status: "ok";
      rows: ResultRow[];
      excluded: ExcludedByKind;
      partyMappingConfigured: boolean;
      sourceAudit?: ExcludedByKind;
    }
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
const MUNICIPAL_EVIDENCE_IDENTITY = { year: 2025, round: "provinciales", categoryName: "CONCEJALES" } as const;
function auditByKind(entries: { kind: string; rows: number; votes: number }[]): ExcludedByKind { return entries.reduce<ExcludedByKind>((totals, { kind, rows, votes }) => ({ ...totals, [kind]: { rows: (totals[kind]?.rows ?? 0) + rows, votes: (totals[kind]?.votes ?? 0) + votes } }), {}); }
function hasValidOfficialSourceAudit(rows: ResultRow[], sourceAudit: ExcludedByKind | undefined): boolean {
  if (!sourceAudit || typeof sourceAudit !== "object") return false;
  const sourceKinds = Object.keys(sourceAudit);
  if (sourceKinds.length !== 1 || sourceKinds[0] !== "official" || !Object.hasOwn(sourceAudit, "official")) return false;
  const officialAudit = sourceAudit.official;
  if (!officialAudit || !Number.isSafeInteger(officialAudit.rows) || officialAudit.rows <= 0 || !Number.isSafeInteger(officialAudit.votes) || officialAudit.votes < 0) return false;
  let renderedVotes = 0;
  for (const row of rows) {
    if (row.sourceKind !== "official" || !Number.isSafeInteger(row.votes) || row.votes < 0) return false;
    renderedVotes += row.votes;
    if (!Number.isSafeInteger(renderedVotes)) return false;
  }
  return officialAudit.votes === renderedVotes;
}
export function municipalViewFromOfficialEvidence(evidence: Extract<MunicipalOfficialEvidence, { status: "ok" }>, categoryId: string): MunicipalView {
  const { result } = evidence;
  if (result.electionYear !== MUNICIPAL_EVIDENCE_IDENTITY.year || result.electionRound !== MUNICIPAL_EVIDENCE_IDENTITY.round || result.categoryName !== MUNICIPAL_EVIDENCE_IDENTITY.categoryName) return { status: "read_failed", reason: "No se pudo leer la evidencia municipal autorizada." };
  if (result.sourceKind !== "official") return { status: "read_failed", reason: "la evidencia municipal no es de fuente oficial" };
  const officialAudit = result.sourceAudit[0];
  const partyVotes = result.parties.reduce((sum, party) => sum + party.votes, 0);
  if (result.sourceAudit.length !== 1 || officialAudit?.kind !== "official" || !Number.isSafeInteger(officialAudit.rows) || officialAudit.rows <= 0 || !Number.isSafeInteger(officialAudit.votes) || officialAudit.votes < 0 || !Number.isSafeInteger(result.totalVotes) || result.totalVotes < 0 || result.parties.some((party) => !Number.isSafeInteger(party.votes) || party.votes < 0) || !Number.isSafeInteger(partyVotes) || officialAudit.votes !== result.totalVotes || partyVotes !== result.totalVotes || result.sourceExclusions.some((entry) => !Number.isSafeInteger(entry.rows) || entry.rows < 0 || !Number.isSafeInteger(entry.votes) || entry.votes < 0) || result.archiveEntryIds.length !== 1) return { status: "read_failed", reason: "la auditoría oficial municipal no coincide con las cifras autorizadas" };
  const archiveEntryId = result.archiveEntryIds[0]!;
  return { status: "ok", rows: result.parties.map((party) => ({ jurisdictionId: MUNICIPAL_JURISDICTION_ID, categoryId,
    listId: party.listId, votes: party.votes, sourceKind: "official", granularity: result.sourceGranularity,
    requestedGranularity: result.level, archiveEntryId, partyName: party.displayName,
    canonicalPartyId: party.canonicalPartyId })), excluded: auditByKind(result.sourceExclusions), sourceAudit: auditByKind(result.sourceAudit), partyMappingConfigured: true };
}

type MunicipalProvenance = Omit<OfficialProvenanceMetadata, "status"> & { status?: string; url?: string };
function OfficialProvenance({ sources }: { sources: MunicipalProvenance[] }): ReactNode {
  return <ul aria-label="procedencia">{sources.map((source) => <li key={source.archiveEntryId}><span>{source.archiveEntryId}</span>{" — sha256: "}
    {source.sha256 ? <code>{source.sha256}</code> : <strong role="alert">sin hash — esta entrada no puede verificarse</strong>}{" — descargada el "}<time dateTime={source.fetchedAt}>{source.fetchedAt}</time>{source.status ? <> — estado: {source.status}</> : null}</li>)}</ul>;
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
  sources: MunicipalProvenance[] = [],
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
        <OfficialProvenance sources={sources} />
      </main>
    );
  }

  const { rows } = view;
  if (!hasValidOfficialSourceAudit(rows, view.sourceAudit)) return municipalRefusal("la auditoría de fuente oficial no es válida.");
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
  const sourceAudit = describeExcluded(view.sourceAudit ?? {}); const sourceAuditNote = sourceAudit ? <p role="note">Auditoría de fuente: {sourceAudit}.</p> : null;

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
      <OfficialProvenance sources={sources} />
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
      <OfficialProvenance sources={sources} />
    </main>;
  }

  if (rows.length === 0) {
    return municipalState(
      "No se encontraron resultados municipales para esta jurisdicción, categoría y elección.",
      "status",
    );
  }

  return (
    <main className="page-shell official-municipal">
      <div className="shell-container official-municipal__layout">
        <header className="page-header official-municipal__header">
          <p className="official-municipal__section-label">Resultados oficiales / municipal autorizado</p>
          <h1>Resultados municipales (Concejales)</h1>
          <p className="official-municipal__context">
            Cifras oficiales exactas para la sección fija 02/027. La fiscalización no forma parte de estos resultados.
          </p>
        </header>
        <section className="official-municipal__selection" aria-labelledby="municipal-context-heading">
          <h2 id="municipal-context-heading">Contexto de la consulta</h2>
          <dl className="official-municipal__context-list">
            <div><dt>Alcance autorizado</dt><dd>Distrito 02 / sección 027</dd></div>
            <div><dt>Categoría</dt><dd>Concejales</dd></div>
            <div><dt>Granularidad solicitada</dt><dd>Sección</dd></div>
          </dl>
        </section>
        <section className="official-municipal__results" aria-labelledby="municipal-results-heading">
          <div className="official-municipal__section-heading">
            <h2 id="municipal-results-heading">Resultados exactos</h2>
            <p role="status">Resultados oficiales autorizados por partido.</p>
          </div>
          {unsummable !== null ? (
            <p role="alert">
              No hay cifras por partido: {unsummable}. Un total que duplica el
              conteo es peor que no tener total.
            </p>
          ) : (
            <>
              <GranularityBadge
                granularity={totalLevel.granularity}
                {...(totalLevel.summedFrom !== undefined
                  ? { summedFrom: totalLevel.summedFrom }
                  : {})}
                {...(totalLevel.degradedFrom !== undefined
                  ? { degradedFrom: totalLevel.degradedFrom }
                  : {})}
                {...(requestedLevel !== undefined && requestedLevel !== levels.granularity
                  ? { requestedGranularity: requestedLevel }
                  : {})}
              />
              <TableScroll label="Tabla de resultados oficiales exactos por partido">
                <table className="data-table official-municipal__table">
                  <caption>Resultados oficiales exactos por partido y votos</caption>
                  <thead>
                    <tr>
                      <th scope="col">Partido</th>
                      <th scope="col" className="table-cell--number">Votos exactos</th>
                    </tr>
                  </thead>
                  <tbody>
                    {partyTotals.map((entry) => (
                      <tr key={entry.label}>
                        <th scope="row">{entry.label}</th>
                        <td className="table-cell--number">{entry.votes}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableScroll>
            </>
          )}
        </section>
        <aside className="official-municipal__evidence" aria-labelledby="municipal-evidence-heading">
          <h2 id="municipal-evidence-heading">Evidencia oficial</h2>
          <section aria-labelledby="municipal-coverage-heading">
            <h3 id="municipal-coverage-heading">Cobertura y exclusiones</h3>
            {sourceAuditNote}
            {excludedNote}
            <UnmappedListIds
              entries={unmapped.entries}
              withoutListId={unmapped.withoutListId}
              totalRows={rows.length}
              unsummable={unsummable}
              mappingConfigured={view.partyMappingConfigured}
            />
            <UnorderableLevels entries={unrecognized} />
          </section>
          <section aria-labelledby="municipal-provenance-heading">
            <h3 id="municipal-provenance-heading">Archivo y procedencia</h3>
            <OfficialProvenance sources={sources} />
          </section>
        </aside>
      </div>
    </main>
  );
}

function municipalState(message: ReactNode, role: "alert" | "status"): ReactNode {
  return (
    <main className="page-shell official-municipal">
      <div className="shell-container official-municipal__layout">
        <header className="page-header official-municipal__header">
          <p className="official-municipal__section-label">Resultados oficiales / municipal autorizado</p>
          <h1>Municipal (Concejales)</h1>
        </header>
        <section className="official-municipal__state" role={role} aria-labelledby="municipal-state-heading">
          <h2 id="municipal-state-heading">Estado de la evidencia</h2>
          <p>{message}</p>
        </section>
      </div>
    </main>
  );
}

function municipalRefusal(reason: ReactNode): ReactNode {
  return municipalState(<>Se rechazó la solicitud: {reason}</>, "alert");
}

interface MunicipalPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}


/**
 * Authenticated operator route for PBA municipal (Concejales) results.
 * Production figures come only from the workspace-authorized official bundle.
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
  const suppliedKeys = Object.keys(params);
  const electionId = stringParam(params, "electionId");
  const legacyJurisdictionId = stringParam(params, "jurisdictionId");
  const legacyCategoryId = stringParam(params, "categoryId");
  const legacyPartyFamily = stringParam(params, "partyJurisdiction");
  const legacyPartyCategory = stringParam(params, "partyCategory");
  const configuredElectionId = process.env["MUNICIPAL_ELECTION_ID"] || undefined;
  const categoryId = process.env["MUNICIPAL_CATEGORY_ID"] || undefined;

  if (!configuredElectionId || !categoryId) {
    return municipalRefusal("MUNICIPAL_ELECTION_ID y MUNICIPAL_CATEGORY_ID deben estar configurados.");
  }
  if (electionId && electionId !== configuredElectionId)
    return municipalRefusal(<>esta ruta solo ofrece la elección municipal configurada; se recibió {electionId}.</>);
  if (legacyJurisdictionId || legacyCategoryId || legacyPartyFamily || legacyPartyCategory) {
    return municipalRefusal(<>la sección 02/027, la categoría y la elección son fijas; no se aceptan parámetros de identidad o autorización: {legacyJurisdictionId} {legacyCategoryId} {legacyPartyFamily} {legacyPartyCategory}.</>);
  }
  const unknownKeys = suppliedKeys.filter((key) => key !== "electionId");
  if (unknownKeys.length > 0) {
    return municipalRefusal(<>parámetros de consulta no admitidos: {unknownKeys.join(", ")}.</>);
  }

  if (!electionId) {
    return <main className="page-shell official-municipal"><div className="shell-container official-municipal__layout">
      <header className="page-header official-municipal__header">
        <p className="official-municipal__section-label">Resultados oficiales / municipal autorizado</p>
        <h1>Resultados municipales (Concejales)</h1>
        <p className="official-municipal__context">Seleccione la elección municipal configurada para consultar la sección fija 02/027.</p>
      </header>
      <section className="official-municipal__selection" aria-labelledby="municipal-selection-heading">
        <h2 id="municipal-selection-heading">Selección oficial</h2>
        <form method="get" action="/municipal" className="official-municipal__form">
          <div className="field">
            <label htmlFor="municipal-election">Elección municipal</label>
            <select id="municipal-election" name="electionId" defaultValue={configuredElectionId}>
              <option value={configuredElectionId}>Elección municipal 2025 — Concejales</option>
            </select>
          </div>
          <button className="button button--primary" type="submit">Ver resultados oficiales</button>
        </form>
      </section>
      <p className="official-municipal__state" role="status">La consulta muestra solo resultados oficiales autorizados.</p>
    </div></main>;
  }

  const evidence = await loadMunicipalOfficialEvidence();
  if (evidence.status === "denied")
    return municipalRefusal("El espacio de trabajo no autoriza esta sección municipal.");
  if (evidence.status === "empty")
    return municipalState("No hay resultados oficiales autorizados para esta sección.", "status");
  if (evidence.status === "unavailable")
    return municipalRefusal("La evidencia oficial autorizada no está disponible.");
  if (evidence.status === "malformed")
    return municipalRefusal("La evidencia oficial autorizada tiene un formato inválido.");
  if (evidence.status === "truncated")
    return municipalRefusal("La evidencia oficial autorizada fue truncada; no se muestran cifras parciales.");
  if (evidence.status !== "ok") return municipalRefusal("La evidencia oficial autorizada no es utilizable.");

  const view = municipalViewFromOfficialEvidence(evidence, categoryId);
  return renderMunicipalView(view, view.status === "ok" ? evidence.provenance : []);
}
