import type { ReactNode } from "react";
import styles from "./drilldown.module.css";
import { DrilldownDistribution } from "./DrilldownDistribution";

import { DrilldownSelectionForm, type SelectionField } from "./DrilldownSelectionForm";
import {
  canonicalScopeSearchParams,
} from "@/components/scope-selector-behavior";
import { TableRegion } from "@/components/TableRegion";
import {
  Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
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
  children: ReactNode;
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

function ExplorerForm({ facets, selected, children }: ExplorerFormProps): ReactNode {
  const values = {
    electionId: selected.electionId ?? "",
    categoryId: selected.categoryId ?? "",
    distritoCode: selected.distritoCode ?? "",
    seccionCode: selected.seccionCode ?? "",
    circuitoCode: selected.circuitoCode ?? "",
    establecimientoCode: selected.establecimientoCode ?? "",
    mesaCode: selected.mesaCode?.toString() ?? "",
    level: selected.level ?? "",
  };
  const namedOptions = (options: ExplorationFacets["distritos"]) => options.map((option) => ({
    value: option.code, label: formatFacetOptionLabel(option),
  }));
  const fields: SelectionField[] = [
    { name: "electionId", id: "explorer-election", label: "Elección", placeholder: "Elegir una elección", options: facets.elections.map((option) => ({ value: option.id, label: option.label })) },
    { name: "categoryId", id: "explorer-category", label: "Categoría", placeholder: "Elegir una categoría", options: facets.categories.map((option) => ({ value: option.id, label: option.name })) },
    { name: "distritoCode", id: "explorer-distrito", label: "Distrito", placeholder: "Elegir un distrito", options: namedOptions(facets.distritos) },
    { name: "seccionCode", id: "explorer-seccion", label: "Sección", placeholder: "Elegir una sección", options: namedOptions(facets.secciones) },
    { name: "circuitoCode", id: "explorer-circuito", label: "Circuito", placeholder: "Cualquier circuito", options: namedOptions(facets.circuitos) },
    { name: "establecimientoCode", id: "explorer-establecimiento", label: "Establecimiento", placeholder: "Cualquier establecimiento", options: namedOptions(facets.establecimientos) },
    { name: "mesaCode", id: "explorer-mesa", label: "Mesa", placeholder: "Cualquier mesa", options: facets.mesas.map((option) => ({ value: String(option.code), label: String(option.code) })) },
    { name: "level", id: "explorer-level", label: "Nivel del informe", placeholder: "Elegir un nivel", options: facets.availableLevels.map((level) => ({ value: level, label: level })) },
  ];
  return <DrilldownSelectionForm selected={values} fields={fields} notes={facetExclusionNotes(facets.exclusions ?? [])}>
    {children}
  </DrilldownSelectionForm>;
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

function ResultEvidence({ evidence, selection }: { evidence: EvidenceOk; selection: OfficialSelection }): ReactNode {
  const { result, schools, reference, provenance } = evidence;
  if (result.sourceKind !== "official" || result.sourceAudit.some(({ kind }) => kind !== "official") || schools.status === "ok" && (schools.sourceKind !== "official" || schools.sourceAudit.some(({ kind }) => kind !== "official"))) return <section className={styles.state} role="alert">Se rechazó la solicitud: la evidencia renderizada no es exclusivamente oficial.</section>;
  return (
    <>
        <section className={styles.context} aria-labelledby="submitted-scope-heading">
          <h3 id="submitted-scope-heading">Alcance aplicado</h3>
          <dl className={styles.scope}>
            <div><dt>Elección</dt><dd>{selection.electionId}</dd></div>
            <div><dt>Categoría</dt><dd>{selection.categoryId}</dd></div>
            <div><dt>Distrito</dt><dd>{selection.distritoCode}</dd></div>
            <div><dt>Sección</dt><dd>{selection.seccionCode}</dd></div>
            <div><dt>Circuito</dt><dd>{selection.circuitoCode ?? "Cualquier circuito"}</dd></div>
            <div><dt>Establecimiento</dt><dd>{selection.establecimientoCode ?? "Cualquier establecimiento"}</dd></div>
            <div><dt>Mesa</dt><dd>{selection.mesaCode ?? "Cualquier mesa"}</dd></div>
            <div><dt>Nivel del informe</dt><dd>{selection.requestedLevel}</dd></div>
          </dl>
        </section>
      <section className={styles.results} aria-labelledby="official-results-heading">
        <h2 id="official-results-heading">Desglose oficial autorizado</h2>
      <p role="status">
        {result.totalVotes} votos a nivel {result.level}, obtenidos de filas de fuente {result.sourceGranularity}
        {result.mesaCount === null
          ? ". La cantidad de mesas no está disponible con la granularidad publicada por la fuente."
          : ` en ${result.mesaCount} mesas.`}
      </p>
      <p>Tipo de elección: {result.electionYear} {result.electionRound}.</p>
      {sourceExclusionNotes(result.sourceExclusions, "oficial")}
      <DrilldownDistribution result={result} />
      <TableRegion label="Votos oficiales y porcentaje por partido">
        <Table className="data-table">
          <TableCaption>Votos oficiales y porcentaje por partido</TableCaption>
          <TableHeader><TableRow><TableHead scope="col">Identidad del partido</TableHead><TableHead scope="col">Votos</TableHead><TableHead scope="col">Porcentaje</TableHead></TableRow></TableHeader>
          <TableBody>
            {result.parties.map((party, index) => (
              <TableRow key={party.canonicalPartyId ?? `${party.listId ?? "missing-list"}-${index}`}>
                <TableHead className="evidence-text" scope="row">
                  {party.identityStatus === "canonical" ? party.displayName : `Lista sin mapear ${party.listId ?? "(ID de lista no disponible)"}`}
                </TableHead>
                <TableCell>{party.votes} votos</TableCell>
                <TableCell>{formatShare(party.voteShare)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableRegion>

      <section aria-labelledby="school-breakdown-heading">
        <h2 id="school-breakdown-heading">Desglose oficial autorizado por establecimiento</h2>
        {schools.status === "unavailable"
          ? <>
              <p role="note">El desglose por establecimientos no está disponible para la granularidad publicada por la fuente.</p>
              {schoolExclusionNotes(schools.exclusions, schools.sourceExclusions)}
            </>
          : <>
              {schoolExclusionNotes(schools.exclusions, schools.sourceExclusions)}
              <TableRegion label="Votos oficiales por circuito y establecimiento">
                <Table className="data-table">
                  <TableCaption>Votos oficiales por circuito y establecimiento</TableCaption>
                  <TableHeader><TableRow><TableHead scope="col">Establecimiento</TableHead><TableHead scope="col">Mesas</TableHead><TableHead scope="col">Identidad del partido</TableHead><TableHead scope="col">Votos</TableHead><TableHead scope="col">Porcentaje</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {schools.schools.flatMap((school) => school.parties.map((party, index) => (
                      <TableRow key={`${school.circuitoCode}-${school.code}-${party.canonicalPartyId ?? party.listId ?? index}`}>
                        <TableCell className="evidence-text">Circuito {school.circuitoCode} — {school.code}{school.name ? ` — ${school.name}` : ""}</TableCell>
                        <TableCell>{school.mesaCount} mesas</TableCell>
                        <TableCell className="evidence-text">{party.identityStatus === "canonical" ? party.displayName : `Lista sin mapear ${party.listId ?? "(ID de lista no disponible)"}`}</TableCell>
                        <TableCell>{party.votes} votos</TableCell>
                        <TableCell>{formatShare(party.voteShare)}</TableCell>
                      </TableRow>
                    )))}
                  </TableBody>
                </Table>
              </TableRegion>
            </>}
      </section>
      </section>

      <section className={styles.evidence} aria-labelledby="official-evidence-heading">
        <h2 id="official-evidence-heading">Referencias de la consulta</h2>
        <section aria-labelledby="reference-heading">
          <h3 id="reference-heading">Referencia electoral autorizada</h3>
        {reference.sourceExclusions.map((entry) => (
          <p role="note" key={`reference-${entry.kind}`}>
            Se excluyeron {entry.rows} fila(s) de referencia de fuente {displaySourceKind(entry.kind)}: {entry.reason}.
          </p>
        ))}
        <TableRegion label="Referencia electoral autorizada">
          <Table className="data-table">
            <TableCaption>Referencia electoral autorizada</TableCaption>
            <TableHeader><TableRow><TableHead scope="col">Jurisdicción</TableHead><TableHead scope="col">Elección</TableHead><TableHead scope="col">Categoría</TableHead><TableHead scope="col">Alcance</TableHead></TableRow></TableHeader>
            <TableBody>{reference.items.map((item) => (
              <TableRow key={item.jurisdictionId}>
                <TableHead className="evidence-text" scope="row">{item.jurisdictionId}</TableHead>
                <TableCell>{item.year} {item.round} ({item.electionId})</TableCell>
                <TableCell>{item.categoryName} ({item.categoryId})</TableCell>
                <TableCell>Distrito {item.distritoCode}{item.distritoName ? ` — ${item.distritoName}` : ""}; sección {item.seccionCode}{item.seccionName ? ` — ${item.seccionName}` : ""}{item.circuitoCode ? `; circuito ${item.circuitoCode}` : ""}{item.establecimientoCode ? `; establecimiento ${item.establecimientoCode}` : ""}{item.mesaCode !== null ? `; mesa ${item.mesaCode}` : ""}</TableCell>
              </TableRow>
            ))}</TableBody>
          </Table>
        </TableRegion>
      </section>

        <section aria-labelledby="provenance-heading">
          <h3 id="provenance-heading">Procedencia segura</h3>
        {sourceExclusionNotes(provenance.sourceExclusions, "procedencia")}
        <details className={styles.provenance}>
          <summary>Archivo y procedencia</summary>
        <ul aria-label="procedencia">
          {provenance.items.map((item) => (
            <li key={item.archiveEntryId}>
              <span className="evidence-text">{item.archiveEntryId}</span>: {item.capability}; {item.mime}; {item.bytes === null ? "tamaño no disponible" : `${item.bytes} bytes`}; recuperado {item.fetchedAt}; estado {item.status}; SHA-256 {item.sha256 ?? "no disponible"}.
            </li>
          ))}
        </ul>
        </details>
        </section>
      </section>
    </>
  );
}

function ExplorerHeader(): ReactNode {
  return (
    <header className={styles.header}>
      <h1>Explorador oficial</h1>
      <p className="page-header__lede">Explore el territorio, compare la distribución del voto y consulte la evidencia oficial de cada selección.</p>
    </header>
  );
}

function PageShell({ facets, selected, children }: ExplorerFormProps): ReactNode {
  return (
    <main className={`page-shell ${styles.root}`}>
      <div className={`shell-container ${styles.layout}`}>
        <ExplorerHeader />
        <ExplorerForm facets={facets} selected={selected}>{children}</ExplorerForm>
      </div>
    </main>
  );
}

function refusalPage(message: ReactNode): ReactNode {
  return (
    <main className={`page-shell ${styles.root}`}>
      <div className={`shell-container ${styles.layout}`}>
        <ExplorerHeader />
        <section className={styles.state} role="alert">{message}</section>
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

  const baseReady = Boolean(electionId && categoryId && effectiveCodes.distritoCode && effectiveCodes.seccionCode && level);
  const levelReady = level === EXPLORATION_LEVEL.SECCION ||
    level === EXPLORATION_LEVEL.CIRCUITO && Boolean(effectiveCodes.circuitoCode) ||
    level === EXPLORATION_LEVEL.ESTABLECIMIENTO && Boolean(effectiveCodes.circuitoCode && effectiveCodes.establecimientoCode) ||
    level === EXPLORATION_LEVEL.MESA && Boolean(effectiveCodes.circuitoCode && effectiveCodes.establecimientoCode && typeof effectiveCodes.mesaCode === "number");
  if (!hierarchyMatches || !baseReady || !levelReady || !electionId || !categoryId || !effectiveCodes.distritoCode || !effectiveCodes.seccionCode || !level) {
    return <PageShell facets={facets} selected={selected}><section className={styles.state} role="status">Elija una sección exacta y los selectores requeridos para el nivel del informe.</section></PageShell>;
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
      <PageShell facets={facets} selected={selected}>
        <section className={styles.state} role="alert">
          <p>{refusalMessage(evidence.status)}</p>
          {evidence.status === OFFICIAL_DRILLDOWN_EVIDENCE_STATUS.UNAVAILABLE
            ? <a href={`/drilldown?${canonicalScopeSearchParams({
                electionId: selection.electionId,
                categoryId: selection.categoryId,
                distritoCode: selection.distritoCode,
                seccionCode: selection.seccionCode ?? "",
                circuitoCode: selection.circuitoCode ?? "",
                establecimientoCode: selection.establecimientoCode ?? "",
                mesaCode: selection.mesaCode?.toString() ?? "",
                level: selection.requestedLevel,
              })}`}>Reintentar carga</a>
            : null}
          {evidence.status === OFFICIAL_DRILLDOWN_EVIDENCE_STATUS.AUTHORIZATION_DENIED
            ? null
            : <RefusalEvidence evidence={evidence.evidence} />}
        </section>
      </PageShell>
    );
  }

  return <PageShell facets={facets} selected={selected}>
    <ResultEvidence evidence={evidence} selection={selection} />
  </PageShell>;
}
