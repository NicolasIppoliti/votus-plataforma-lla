import type { ReactNode } from "react";

import { ScopeSelectorForm } from "@/components/ScopeSelectorForm";
import {
  SCOPE_FORM_KIND,
  scopeControlStates,
} from "@/components/scope-selector-behavior";
import { TableScroll } from "@/components/TableScroll";
import {
  EXPLORATION_LEVEL,
  formatFacetOptionLabel,
  normalizeExplorationParams,
  type ExplorationFacetExclusion,
  type ExplorationFacets,
  type ExplorationLevel,
  type ExplorationSourceAudit,
  type SchoolBreakdownExclusion,
} from "@/lib/results/exploration";
import { repeatedParams, stringParam } from "@/lib/results/query-params";
import {
  AuthorizedOfficialFacetsError,
  OFFICIAL_FACETS_ERROR,
  createAuthorizedOfficialFacetRepository,
} from "@/lib/workspace/official-facets";
import {
  OFFICIAL_DRILLDOWN_EVIDENCE_STATUS,
  loadAuthorizedOfficialDrilldownEvidence,
  type OfficialDrilldownEvidence,
} from "@/lib/workspace/official-drilldown-evidence";
import type { OfficialSelection } from "@/app/api/workspace/official/input";

interface DrilldownPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

interface ExplorerFormProps {
  facets: ExplorationFacets;
  selected: {
    electionId?: string;
    categoryId?: string;
    distritoCode?: string;
    seccionCode?: string;
    circuitoCode?: string;
    establecimientoCode?: string;
    mesaCode?: number;
    level?: ExplorationLevel;
  };
}

const LEGACY_QUERY_KEYS = ["jurisdictionId", "partyCategory", "partyJurisdiction"] as const;
const FACET_EXCLUSION_LABELS = {
  non_official_source_rows: "filas de fuente no oficial",
  official_rows_with_incomplete_lineage: "filas oficiales con linaje incompleto",
  coarse_facets_overflow: "opciones generales",
  circuitos_overflow: "circuitos",
  establecimientos_overflow: "establecimientos",
  mesas_overflow: "mesas",
} as const;

type EvidenceOk = Extract<OfficialDrilldownEvidence, { status: "ok" }>;
type EvidenceRefusal = Exclude<OfficialDrilldownEvidence, { status: "ok" }>;
type EvidenceRefusalWithDetails = Exclude<EvidenceRefusal, { status: "authorization_denied" }>;

function ExplorerForm({ facets, selected }: ExplorerFormProps): ReactNode {
  const controlStates = scopeControlStates(SCOPE_FORM_KIND.DRILLDOWN, {
    electionId: selected.electionId ?? "",
    categoryId: selected.categoryId ?? "",
    distritoCode: selected.distritoCode ?? "",
    seccionCode: selected.seccionCode ?? "",
    circuitoCode: selected.circuitoCode ?? "",
    establecimientoCode: selected.establecimientoCode ?? "",
    mesaCode: selected.mesaCode?.toString() ?? "",
    level: selected.level ?? "",
  });

  return (
    <section className="official-explorer__filters panel" aria-labelledby="explorer-form-heading">
      <div className="panel__heading">
        <p className="official-explorer__section-label">Definir el alcance</p>
        <h2 id="explorer-form-heading">Elegir el alcance de los resultados</h2>
        <p>Use los selectores para crear un enlace directo reutilizable a resultados oficiales.</p>
      </div>
      <ScopeSelectorForm action="/drilldown" kind={SCOPE_FORM_KIND.DRILLDOWN}>
        <fieldset className="form-grid selector-form">
          <legend className="selector-form__legend">Selectores de resultados</legend>
          <div className="field">
            <label htmlFor="explorer-election">Elección</label>
            <select id="explorer-election" name="electionId" defaultValue={selected.electionId ?? ""}
              required={controlStates.electionId.required} disabled={controlStates.electionId.disabled}>
              <option value="">Elegir una elección</option>
              {facets.elections.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="explorer-category">Categoría</label>
            <select id="explorer-category" name="categoryId" defaultValue={selected.categoryId ?? ""}
              required={controlStates.categoryId.required} disabled={controlStates.categoryId.disabled}>
              <option value="">Elegir una categoría</option>
              {facets.categories.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="explorer-distrito">Distrito</label>
            <select id="explorer-distrito" name="distritoCode" defaultValue={selected.distritoCode ?? ""}
              required={controlStates.distritoCode.required} disabled={controlStates.distritoCode.disabled}>
              <option value="">Elegir un distrito</option>
              {facets.distritos.map((option) => <option key={option.code} value={option.code}>{formatFacetOptionLabel(option)}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="explorer-seccion">Sección</label>
            <select id="explorer-seccion" name="seccionCode" defaultValue={selected.seccionCode ?? ""}
              required={controlStates.seccionCode.required} disabled={controlStates.seccionCode.disabled}>
              <option value="">Elegir una sección</option>
              {facets.secciones.map((option) => <option key={option.code} value={option.code}>{formatFacetOptionLabel(option)}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="explorer-circuito">Circuito</label>
            <select id="explorer-circuito" name="circuitoCode" defaultValue={selected.circuitoCode ?? ""}
              required={controlStates.circuitoCode.required} disabled={controlStates.circuitoCode.disabled}>
              <option value="">Cualquier circuito</option>
              {facets.circuitos.map((option) => <option key={option.code} value={option.code}>{formatFacetOptionLabel(option)}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="explorer-establecimiento">Establecimiento</label>
            <select id="explorer-establecimiento" name="establecimientoCode" defaultValue={selected.establecimientoCode ?? ""}
              required={controlStates.establecimientoCode.required} disabled={controlStates.establecimientoCode.disabled}>
              <option value="">Cualquier establecimiento</option>
              {facets.establecimientos.map((option) => <option key={option.code} value={option.code}>{formatFacetOptionLabel(option)}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="explorer-mesa">Mesa</label>
            <select id="explorer-mesa" name="mesaCode" defaultValue={selected.mesaCode?.toString() ?? ""}
              required={controlStates.mesaCode.required} disabled={controlStates.mesaCode.disabled}>
              <option value="">Cualquier mesa</option>
              {facets.mesas.map((option) => <option key={option.code} value={option.code}>{option.code}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="explorer-level">Nivel del informe</label>
            <select id="explorer-level" name="level" defaultValue={selected.level ?? ""}
              required={controlStates.level.required} disabled={controlStates.level.disabled}>
              <option value="">Elegir un nivel</option>
              {facets.availableLevels.map((level) => <option key={level} value={level}>{level}</option>)}
            </select>
          </div>
        </fieldset>
        <div className="form-actions">
          <button className="button button--primary" type="submit">Aplicar selección</button>
        </div>
      </ScopeSelectorForm>
      {facetExclusionNotes(facets.exclusions ?? [])}
    </section>
  );
}

function formatShare(share: string | null): string {
  return share === null ? "porcentaje no disponible" : `${(Number(share) * 100).toFixed(2)}%`;
}

function formatCounts(counts: Readonly<Record<string, number>>): string {
  return Object.entries(counts).map(([reason, count]) => `${reason}: ${count}`).join(", ");
}

function displaySourceKind(kind: string): string {
  if (kind === "official") return "oficial";
  if (kind === "fiscalizacion") return "fiscalización";
  if (kind === "unknown") return "desconocida";
  return kind;
}

function facetExclusionNotes(
  exclusions: readonly ExplorationFacetExclusion[],
  overflow = false,
): ReactNode {
  return exclusions.map((exclusion) => {
    const label = FACET_EXCLUSION_LABELS[exclusion.reason as keyof typeof FACET_EXCLUSION_LABELS] ?? `razón no reconocida (${exclusion.reason})`;
    return (
      <p role="note" key={exclusion.reason}>
        {overflow
          ? `La profundidad ${label} excede el límite seguro: ${exclusion.rows} filas.`
          : `Se excluyeron ${exclusion.rows} ${exclusion.rows === 1 ? "fila" : "filas"} de las opciones: ${label}.`}
      </p>
    );
  });
}

function sourceExclusionNotes(
  exclusions: readonly ExplorationSourceAudit[],
  aggregate: string,
): ReactNode {
  return exclusions.map((exclusion) => (
    <p role="note" key={`${aggregate}-${exclusion.kind}`}>
      Se excluyeron {exclusion.rows} {exclusion.rows === 1 ? "fila" : "filas"} de fuente {displaySourceKind(exclusion.kind)} / {exclusion.votes} {exclusion.votes === 1 ? "voto" : "votos"} del agregado {aggregate}.
    </p>
  ));
}

function schoolExclusionNotes(
  exclusions: readonly SchoolBreakdownExclusion[],
  sourceExclusions: readonly ExplorationSourceAudit[],
): ReactNode {
  return (
    <>
      {sourceExclusionNotes(sourceExclusions, "establecimiento")}
      {exclusions.map((exclusion) => (
        <p role="note" key={exclusion.reason}>
          Se excluyeron {exclusion.rows} fila(s) / {exclusion.votes} voto(s): {exclusion.reason}.
        </p>
      ))}
    </>
  );
}

function RefusalEvidence({ evidence }: { evidence: EvidenceRefusalWithDetails["evidence"] | undefined }): ReactNode {
  if (!evidence?.length) return null;
  return evidence.map((part) => (
    <section key={part.part} aria-label={`Evidencia de rechazo: ${part.part}`}>
      <h2>{part.part}</h2>
      {part.reason ? <p>{part.reason}</p> : null}
      {part.counts ? <p role="note">Conteos: {formatCounts(part.counts)}.</p> : null}
      {part.exclusions?.map((entry) => (
        <p role="note" key={`${part.part}-exclusion-${entry.reason}`}>
          Exclusión {entry.reason}: {entry.rows} fila(s){entry.votes === undefined ? "." : ` / ${entry.votes} voto(s).`}
        </p>
      ))}
      {part.sourceExclusions?.map((entry) => (
        <p role="note" key={`${part.part}-source-${entry.kind}`}>
          Fuente excluida {displaySourceKind(entry.kind ?? "unknown")}: {entry.rows} fila(s){entry.votes === undefined ? "." : ` / ${entry.votes} voto(s).`}
        </p>
      ))}
    </section>
  ));
}

function refusalMessage(status: EvidenceRefusal["status"]): string {
  if (status === OFFICIAL_DRILLDOWN_EVIDENCE_STATUS.EMPTY) return "No se encontraron resultados oficiales para la selección autorizada.";
  if (status === OFFICIAL_DRILLDOWN_EVIDENCE_STATUS.AUTHORIZATION_DENIED) return "Se rechazó la solicitud: la selección no pertenece al alcance autorizado.";
  if (status === OFFICIAL_DRILLDOWN_EVIDENCE_STATUS.PAYLOAD_TOO_LARGE) return "Se rechazó la solicitud: la evidencia autorizada excede el límite seguro y fue truncada; no se muestra ninguna cifra parcial.";
  if (status === OFFICIAL_DRILLDOWN_EVIDENCE_STATUS.MALFORMED) return "Se rechazó la solicitud: la evidencia autorizada no superó la validación de integridad.";
  return "Se rechazó la solicitud: la evidencia autorizada no está disponible.";
}

function ResultEvidence({ evidence }: { evidence: EvidenceOk }): ReactNode {
  const { result, schools, reference, provenance } = evidence;
  if (result.sourceKind !== "official" || result.sourceAudit.some(({ kind }) => kind !== "official") || schools.status === "ok" && (schools.sourceKind !== "official" || schools.sourceAudit.some(({ kind }) => kind !== "official"))) return <section className="official-explorer__state" role="alert">Se rechazó la solicitud: la evidencia renderizada no es exclusivamente oficial.</section>;
  return (
    <>
      <section className="official-explorer__results" aria-labelledby="official-results-heading">
        <p className="official-explorer__section-label">Resultados y evidencia</p>
        <h2 id="official-results-heading">Desglose oficial autorizado</h2>
      <p role="status">
        {result.totalVotes} votos a nivel {result.level}, obtenidos de filas de fuente {result.sourceGranularity}
        {result.mesaCount === null
          ? ". La cantidad de mesas no está disponible con la granularidad publicada por la fuente."
          : ` en ${result.mesaCount} mesas.`}
      </p>
      <p>Tipo de elección: {result.electionYear} {result.electionRound}.</p>
      {sourceExclusionNotes(result.sourceExclusions, "oficial")}
      <TableScroll label="Votos oficiales y porcentaje por partido">
        <table className="data-table">
          <caption>Votos oficiales y porcentaje por partido</caption>
          <thead><tr><th scope="col">Identidad del partido</th><th scope="col">Votos</th><th scope="col">Porcentaje</th></tr></thead>
          <tbody>
            {result.parties.map((party, index) => (
              <tr key={party.canonicalPartyId ?? `${party.listId ?? "missing-list"}-${index}`}>
                <th className="evidence-text" scope="row">
                  {party.identityStatus === "canonical" ? party.displayName : `Lista sin mapear ${party.listId ?? "(ID de lista no disponible)"}`}
                </th>
                <td>{party.votes} votos</td>
                <td>{formatShare(party.voteShare)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScroll>

      <section aria-labelledby="school-breakdown-heading">
        <h2 id="school-breakdown-heading">Desglose oficial autorizado por establecimiento</h2>
        {schools.status === "unavailable"
          ? <>
              <p role="note">El desglose por establecimientos no está disponible para la granularidad publicada por la fuente.</p>
              {schoolExclusionNotes(schools.exclusions, schools.sourceExclusions)}
            </>
          : <>
              {schoolExclusionNotes(schools.exclusions, schools.sourceExclusions)}
              <TableScroll label="Votos oficiales por circuito y establecimiento">
                <table className="data-table">
                  <caption>Votos oficiales por circuito y establecimiento</caption>
                  <thead><tr><th scope="col">Establecimiento</th><th scope="col">Mesas</th><th scope="col">Identidad del partido</th><th scope="col">Votos</th><th scope="col">Porcentaje</th></tr></thead>
                  <tbody>
                    {schools.schools.flatMap((school) => school.parties.map((party, index) => (
                      <tr key={`${school.circuitoCode}-${school.code}-${party.canonicalPartyId ?? party.listId ?? index}`}>
                        <th className="evidence-text" scope="row">Circuito {school.circuitoCode} — {school.code}{school.name ? ` — ${school.name}` : ""}</th>
                        <td>{school.mesaCount} mesas</td>
                        <td className="evidence-text">{party.identityStatus === "canonical" ? party.displayName : `Lista sin mapear ${party.listId ?? "(ID de lista no disponible)"}`}</td>
                        <td>{party.votes} votos</td>
                        <td>{formatShare(party.voteShare)}</td>
                      </tr>
                    )))}
                  </tbody>
                </table>
              </TableScroll>
            </>}
      </section>
      </section>

      <section className="official-explorer__evidence" aria-labelledby="official-evidence-heading">
        <p className="official-explorer__section-label">Evidencia y archivo</p>
        <h2 id="official-evidence-heading">Referencias de la consulta</h2>
        <section aria-labelledby="reference-heading">
          <h3 id="reference-heading">Referencia electoral autorizada</h3>
        {reference.sourceExclusions.map((entry) => (
          <p role="note" key={`reference-${entry.kind}`}>
            Se excluyeron {entry.rows} fila(s) de referencia de fuente {displaySourceKind(entry.kind)}: {entry.reason}.
          </p>
        ))}
        <TableScroll label="Referencia electoral autorizada">
          <table className="data-table">
            <caption>Referencia electoral autorizada</caption>
            <thead><tr><th scope="col">Jurisdicción</th><th scope="col">Elección</th><th scope="col">Categoría</th><th scope="col">Alcance</th></tr></thead>
            <tbody>{reference.items.map((item) => (
              <tr key={item.jurisdictionId}>
                <th className="evidence-text" scope="row">{item.jurisdictionId}</th>
                <td>{item.year} {item.round} ({item.electionId})</td>
                <td>{item.categoryName} ({item.categoryId})</td>
                <td>Distrito {item.distritoCode}{item.distritoName ? ` — ${item.distritoName}` : ""}; sección {item.seccionCode}{item.seccionName ? ` — ${item.seccionName}` : ""}{item.circuitoCode ? `; circuito ${item.circuitoCode}` : ""}{item.establecimientoCode ? `; establecimiento ${item.establecimientoCode}` : ""}{item.mesaCode !== null ? `; mesa ${item.mesaCode}` : ""}</td>
              </tr>
            ))}</tbody>
          </table>
        </TableScroll>
      </section>

        <section aria-labelledby="provenance-heading">
          <h3 id="provenance-heading">Procedencia segura</h3>
        {sourceExclusionNotes(provenance.sourceExclusions, "procedencia")}
        <ul aria-label="procedencia">
          {provenance.items.map((item) => (
            <li key={item.archiveEntryId}>
              <span className="evidence-text">{item.archiveEntryId}</span>: {item.capability}; {item.mime}; {item.bytes === null ? "tamaño no disponible" : `${item.bytes} bytes`}; recuperado {item.fetchedAt}; estado {item.status}; SHA-256 {item.sha256 ?? "no disponible"}.
            </li>
          ))}
        </ul>
        </section>
      </section>
    </>
  );
}

function ExplorerHeader(): ReactNode {
  return (
    <header className="official-explorer__header page-header">
      <p className="eyebrow">Resultados oficiales / explorador</p>
      <h1>Explorador oficial</h1>
      <p className="page-header__lede">Seleccione un alcance publicado y examine evidencia oficial autorizada sin exponer ubicaciones de origen.</p>
      <p className="official-explorer__context">Las cifras, exclusiones y referencias se conservan junto a la evidencia que las califica.</p>
    </header>
  );
}

function PageShell({ form, children }: { form: ReactNode; children: ReactNode }): ReactNode {
  return (
    <main className="page-shell official-explorer">
      <div className="shell-container official-explorer__layout">
        <ExplorerHeader />
        {form}
        {children}
      </div>
    </main>
  );
}

function refusalPage(message: ReactNode): ReactNode {
  return (
    <main className="page-shell official-explorer">
      <div className="shell-container official-explorer__layout">
        <ExplorerHeader />
        <section className="official-explorer__state" role="alert">{message}</section>
      </div>
    </main>
  );
}

export default async function DrilldownPage({ searchParams }: DrilldownPageProps): Promise<ReactNode> {
  const params = await searchParams;
  const repeated = repeatedParams(params);
  if (repeated.length > 0) {
    return refusalPage(<>Se rechazó la solicitud: estos parámetros se proporcionaron más de una vez: {repeated.join(", ")}.</>);
  }

  const legacyKeys = LEGACY_QUERY_KEYS.filter((key) => Object.hasOwn(params, key));
  if (legacyKeys.length > 0) {
    return refusalPage(<>Se rechazó la solicitud: los parámetros heredados {legacyKeys.join(", ")} ya no están permitidos.</>);
  }

  const rawLevel = stringParam(params, "level");
  const level = Object.values(EXPLORATION_LEVEL).find((candidate) => candidate === rawLevel);
  if (rawLevel && !level) {
    return refusalPage(<>Se rechazó la solicitud: nivel de informe no compatible {rawLevel}.</>);
  }
  if (level === EXPLORATION_LEVEL.DISTRITO) {
    return refusalPage("Se rechazó la solicitud: el nivel distrito no está disponible hasta que exista autorización distrital completa.");
  }

  const normalized = normalizeExplorationParams(Object.fromEntries(
    ["distritoCode", "seccionCode", "circuitoCode", "establecimientoCode", "mesaCode"]
      .map((key) => [key, stringParam(params, key)] as const)
      .filter((entry): entry is readonly [string, string] => entry[1] !== undefined),
  ));
  if (normalized.status === "invalid") {
    return refusalPage(<>Se rechazó la solicitud: {normalized.reason}. {formatCounts(normalized.counts)}.</>);
  }

  const electionId = stringParam(params, "electionId");
  const categoryId = stringParam(params, "categoryId");
  let facets: ExplorationFacets;
  try {
    facets = await createAuthorizedOfficialFacetRepository().facets({
      ...(electionId ? { electionId } : {}),
      ...(categoryId ? { categoryId } : {}),
      ...(normalized.value.distritoCode ? { distritoCode: normalized.value.distritoCode } : {}),
      ...(normalized.value.seccionCode ? { seccionCode: normalized.value.seccionCode } : {}),
      ...(normalized.value.circuitoCode ? { circuitoCode: normalized.value.circuitoCode } : {}),
      ...(normalized.value.establecimientoCode ? { establecimientoCode: normalized.value.establecimientoCode } : {}),
    });
  } catch (error) {
    if (error instanceof AuthorizedOfficialFacetsError && error.code === OFFICIAL_FACETS_ERROR.PAYLOAD_TOO_LARGE) {
      return refusalPage(<><span>Se rechazó la solicitud: las opciones autorizadas exceden el límite seguro.</span>{facetExclusionNotes(error.exclusions, true)}</>);
    }
    const reason = error instanceof AuthorizedOfficialFacetsError
      ? error.code === OFFICIAL_FACETS_ERROR.AUTHORIZATION_DENIED
        ? "No tiene autorización para consultar estas opciones"
        : error.code === OFFICIAL_FACETS_ERROR.NONMEMBER
          ? "La selección no pertenece al alcance autorizado"
          : "No se pudieron cargar las opciones autorizadas"
      : "No se pudieron cargar las opciones autorizadas";
    return refusalPage(<>Se rechazó la solicitud: {reason}.</>);
  }

  const requestedDistrito = normalized.value.distritoCode;
  const distritoMatches = !requestedDistrito || facets.distritos.some((option) => option.code === requestedDistrito);
  const requestedSeccion = normalized.value.seccionCode;
  const seccionMatches = distritoMatches && (!requestedSeccion || facets.secciones.some((option) => option.code === requestedSeccion));
  const requestedCircuito = normalized.value.circuitoCode;
  const circuitoMatches = seccionMatches && (!requestedCircuito || facets.circuitos.some((option) => option.code === requestedCircuito));
  const requestedEstablecimiento = normalized.value.establecimientoCode;
  const establecimientoMatches = circuitoMatches && (!requestedEstablecimiento || facets.establecimientos.some((option) => option.code === requestedEstablecimiento));
  const requestedMesa = normalized.value.mesaCode;
  const mesaMatches = establecimientoMatches && (requestedMesa === undefined || facets.mesas.some((option) => option.code === requestedMesa));
  const hierarchyMatches = distritoMatches && seccionMatches && circuitoMatches && establecimientoMatches && mesaMatches;

  const effectiveCodes = {
    ...(distritoMatches && requestedDistrito ? { distritoCode: requestedDistrito } : {}),
    ...(seccionMatches && requestedSeccion ? { seccionCode: requestedSeccion } : {}),
    ...(circuitoMatches && requestedCircuito ? { circuitoCode: requestedCircuito } : {}),
    ...(establecimientoMatches && requestedEstablecimiento ? { establecimientoCode: requestedEstablecimiento } : {}),
    ...(mesaMatches && typeof requestedMesa === "number" ? { mesaCode: requestedMesa } : {}),
  };
  const selected = {
    ...(electionId ? { electionId } : {}),
    ...(categoryId ? { categoryId } : {}),
    ...effectiveCodes,
    ...(level ? { level } : {}),
  };
  const form = <ExplorerForm facets={facets} selected={selected} />;

  const baseReady = Boolean(electionId && categoryId && effectiveCodes.distritoCode && effectiveCodes.seccionCode && level);
  const levelReady = level === EXPLORATION_LEVEL.SECCION ||
    level === EXPLORATION_LEVEL.CIRCUITO && Boolean(effectiveCodes.circuitoCode) ||
    level === EXPLORATION_LEVEL.ESTABLECIMIENTO && Boolean(effectiveCodes.circuitoCode && effectiveCodes.establecimientoCode) ||
    level === EXPLORATION_LEVEL.MESA && Boolean(effectiveCodes.circuitoCode && effectiveCodes.establecimientoCode && typeof effectiveCodes.mesaCode === "number");
  if (!hierarchyMatches || !baseReady || !levelReady || !electionId || !categoryId || !effectiveCodes.distritoCode || !effectiveCodes.seccionCode || !level) {
    return <PageShell form={form}><section className="official-explorer__state" role="status">Elija una sección exacta y los selectores requeridos para el nivel del informe.</section></PageShell>;
  }

  const selection: OfficialSelection = {
    electionId,
    categoryId,
    distritoCode: effectiveCodes.distritoCode,
    seccionCode: effectiveCodes.seccionCode,
    circuitoCode: effectiveCodes.circuitoCode ?? null,
    establecimientoCode: effectiveCodes.establecimientoCode ?? null,
    mesaCode: effectiveCodes.mesaCode ?? null,
    requestedLevel: level,
  };
  const evidence = await loadAuthorizedOfficialDrilldownEvidence(selection);
  if (evidence.status !== OFFICIAL_DRILLDOWN_EVIDENCE_STATUS.OK) {
    return (
      <PageShell form={form}>
        <section className="official-explorer__state" role="alert">
          <p>{refusalMessage(evidence.status)}</p>
          {evidence.status === OFFICIAL_DRILLDOWN_EVIDENCE_STATUS.AUTHORIZATION_DENIED
            ? null
            : <RefusalEvidence evidence={evidence.evidence} />}
        </section>
      </PageShell>
    );
  }

  return <PageShell form={form}><ResultEvidence evidence={evidence} /></PageShell>;
}
