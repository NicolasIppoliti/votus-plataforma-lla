import type { ReactNode } from "react";
import { normalizeExplorationParams, formatFacetOptionLabel, type ExplorationFacets } from "@/lib/results/exploration";
import { repeatedParams } from "@/lib/results/query-params";
import { createAuthorizedOfficialFacetRepository, AuthorizedOfficialFacetsError, OFFICIAL_FACETS_ERROR } from "@/lib/workspace/official-facets";
import { loadAuthorizedOfficialDrilldownEvidence, type OfficialDrilldownEvidence } from "@/lib/workspace/official-drilldown-evidence";
import type { OfficialSectionCompleteness } from "@/lib/workspace/official-section-completeness";
import { EvidenceContext, type EvidenceField } from "./EvidenceContext";
import { EvidenceMap } from "./EvidenceMap";
import { EvidenceUnits } from "./EvidenceUnits";
import styles from "./evidence.module.css";
import { formatCount } from "@/lib/format/number";

type EvidenceOk = Extract<OfficialDrilldownEvidence, { status: "ok" }>;
type Params = Record<string, string | string[] | undefined>;
const keys = ["electionId", "categoryId", "distritoCode", "seccionCode"] as const;
const stateLabels = { empty: "Consulta vacía", authorization_denied: "Consulta no autorizada", unavailable: "Evidencia no disponible", payload_too_large: "Respuesta fuera de límite", malformed: "Respuesta no válida" } as const;
const stateCopy = {
  empty: "No se encontraron resultados oficiales para la selección autorizada. Vacío no significa cero votos.",
  authorization_denied: "La selección no pertenece al alcance autorizado. No se muestran cifras ni procedencia.",
  unavailable: "No se pudo obtener evidencia autorizada para esta selección. No se muestran cifras anteriores.",
  payload_too_large: "La evidencia excede el límite seguro; no se muestra ningún subconjunto como completo.",
  malformed: "La respuesta no superó la validación de integridad. No se seleccionan ni se suman registros para continuar.",
} as const;

function Shell({ children }: { children: ReactNode }) {
  return <main className={`page-shell ${styles.root}`}><div className={`shell-container ${styles.layout}`}>
    <header className={styles.header}><p>Espacio de trabajo / Evidencia</p><h1>Evidencia y calidad de datos</h1><p>Entender qué hay, de dónde viene y qué todavía no se puede afirmar.</p></header>
    {children}
  </div></main>;
}
function Refusal({ title, children }: { title: string; children: ReactNode }) {
  return <section className={styles.notice} role="alert"><h2>{title}</h2>{children}</section>;
}
function completenessText(value: OfficialSectionCompleteness): string {
  if (value.status === "unavailable") return "Completitud no disponible.";
  if (value.status === "unknown") return value.reason === "no_expected_catalogue"
    ? "Completitud desconocida: la fuente oficial de esta elección no publica un catálogo de mesas esperadas."
    : `Completitud desconocida: el catálogo oficial de mesas no lista esta sección; la fuente de resultados informa ${value.unlisted_status_mesas} mesas con estado para ella; ${value.quarantined_mesas} en cuarentena; ${value.unattributed_quarantined} filas sin sección identificable.`;
  const n = value.counts;
  return value.status === "complete"
    ? `Escrutinio completo: ${n.counted} de ${n.expected} mesas esperadas escrutadas según el catálogo oficial de mesas.`
    : `Escrutinio parcial: ${n.counted} de ${n.expected} mesas esperadas escrutadas; ${n.not_counted} no escrutadas; ${n.missing} sin estado en la fuente; ${n.unexpected} fuera del catálogo; ${n.quarantined} en cuarentena; ${n.unattributed_quarantined} filas sin sección identificable para esta elección.`;
}
function Exclusions({ evidence }: { evidence: EvidenceOk }) {
  return <section className={styles.exclusions} aria-labelledby="source-exclusions-heading"><h2 id="source-exclusions-heading">Fuentes y exclusiones</h2>
    <p>Solo fuente oficial. Los conteos de exclusión describen lo que quedó fuera; no se suman a los resultados oficiales.</p>
    {evidence.result.sourceExclusions.length ? evidence.result.sourceExclusions.map(entry => <p role="note" key={entry.kind}>Fuente excluida {entry.kind === "fiscalizacion" ? "fiscalización" : entry.kind}: {formatCount(entry.rows)} fila(s) / {formatCount(entry.votes)} voto(s) del agregado oficial.</p>) : <p>El agregado oficial no informa exclusiones de otras fuentes.</p>}
    {evidence.reference.sourceExclusions.map(entry => <p role="note" key={`reference-${entry.kind}`}>Referencia: fuente excluida {entry.kind}; razón {entry.reason}; {formatCount(entry.rows)} fila(s).</p>)}
    {evidence.provenance.sourceExclusions.map(entry => <p role="note" key={`provenance-${entry.kind}`}>Procedencia: fuente excluida {entry.kind}; {formatCount(entry.rows)} fila(s) / {formatCount(entry.votes)} voto(s).</p>)}
    {evidence.schools.sourceExclusions.map(entry => <p role="note" key={`school-source-${entry.kind}`}>Establecimientos: fuente excluida {entry.kind}; {formatCount(entry.rows)} fila(s) / {formatCount(entry.votes)} voto(s).</p>)}
    {evidence.schools.exclusions.map(entry => <p role="note" key={`school-${entry.reason}`}>Establecimientos: {entry.reason}; {formatCount(entry.rows)} fila(s) / {formatCount(entry.votes)} voto(s).</p>)}
  </section>;
}
function Result({ evidence, title, distrito, rosales }: { evidence: EvidenceOk; title: string; distrito: string; rosales: boolean }) {
  const completeness = evidence.completeness;
  const availability = completeness.status;
  const availabilityLabel = { complete: "Escrutinio completo", partial: "Escrutinio parcial", unknown: "Completitud desconocida", unavailable: "Completitud no disponible" }[availability];
  const known = completeness.status === "complete" || completeness.status === "partial";
  const membership = evidence.circuitOutcomes;
  const counted = known ? completeness.counts.counted : null;
  const expected = known ? completeness.counts.expected : null;
  return <>
    <p className={styles.notice}>Consulta oficial de la sección seleccionada. La presencia de resultados, el escrutinio y la referencia geográfica son ejes independientes.</p>
    <section className={styles.workbench} aria-label="Evidencia territorial">
      <div className={styles.mapPanel}>
        <nav className={styles.trail} aria-label="Recorrido territorial"><span>Argentina</span><span aria-hidden="true">/</span><span>{distrito}</span><span aria-hidden="true">/</span><span aria-current="location">{title}</span></nav>
        <header className={styles.mapHeader}><div><h2>{title}</h2><p>Referencia geográfica; no acredita equivalencia electoral histórica.</p></div><span>Disponibilidad oficial</span></header>
        <EvidenceMap rosales={rosales} title={title} availability={availability} />
        <div className={styles.mapCaption}><strong>{availabilityLabel} · {title}</strong><p>Color = completitud de la sección, no ganador ni intensidad de votos.</p></div>
        <div className={styles.legend} role="group" aria-label="Estados de disponibilidad"><span><i className={styles.completeKey} />Completa</span><span><i className={styles.partialKey} />Parcial</span><span><i className={styles.unknownKey} />Desconocida</span></div>
        <p className={styles.geometryNote}>{rosales ? "Geometría de referencia CNE; no certificada como límite electoral 2025. Aplicabilidad electoral desconocida. Fuente: CNE · recuperada el 24/09/2026." : "Referencia geográfica no disponible para esta selección."}</p>
        <footer className={styles.mapFooter}><span>El mapa no certifica cobertura territorial.</span><a href="#evidence-method">Cómo interpretar la evidencia</a></footer>
      </div>
      <aside className={styles.inspector} aria-labelledby="evidence-reading-heading">
        <p className={styles.overline}>Lectura de la selección</p><h2 id="evidence-reading-heading">Qué respalda este dato</h2>
        <p className={styles.status} role="status">{completenessText(completeness)}</p>
        <p>Completitud de toda la sección. Supone que todas las mesas esperadas de la sección votan esta categoría.</p>
        <section className={styles.reading} aria-labelledby="practical-reading-heading"><h3 id="practical-reading-heading">Qué permite esta evidencia</h3><p>{title} · {evidence.result.electionYear} {evidence.result.electionRound} · {evidence.result.categoryName}</p>
          <dl><div><dt>Se puede interpretar</dt><dd>La disponibilidad de los resultados oficiales consultados y los estados que informa el catálogo de mesas.</dd></div>
            <div><dt>No permite afirmar</dt><dd>Equivalencia electoral histórica de los límites, representatividad de fiscalización ni aptitud automática para Comparación o Simulación.</dd></div>
            <div><dt>Origen de la limitación</dt><dd>{availability === "complete" ? "Sin faltantes en el catálogo para esta sección y categoría." : "Los estados y faltantes se detallan arriba. Motivo de origen no informado cuando la fuente no lo identifica."}</dd></div>
            <div><dt>Impacto de lectura</dt><dd>{availability === "complete" ? "Un escrutinio completo no certifica identidad histórica ni compatibilidad entre bases." : "No presentar los resultados presentes como cobertura completa ni reemplazar faltantes por cero."}</dd></div></dl>
        </section>
        <dl className={styles.metrics}><div><dt>Mesas escrutadas / esperadas</dt><dd>{counted === null ? "No disponible" : `${counted}/${expected}`}</dd></div><div><dt>Estado del escrutinio</dt><dd>{availability === "complete" ? "Completo" : availability === "partial" ? "Parcial" : availability === "unavailable" ? "No disponible" : "Desconocido"}</dd></div></dl>
        <p>Granularidad de origen: {evidence.result.sourceGranularity}. Mesas con resultados: {evidence.result.mesaCount ?? "no disponible"}. No son el denominador esperado.</p>
        <section className={styles.reading}><h3>Referencia geográfica</h3><p>{rosales ? "Referencia CNE; el mapa informa su carga o indisponibilidad. Aplicabilidad electoral desconocida." : "No disponible para esta selección."}</p><p>Una geometría válida no acredita equivalencia electoral histórica.</p></section>
        <a className={styles.traceLink} href="#official-evidence-heading">Ver trazabilidad</a><p>Un SHA registrado no demuestra que se hayan verificado los bytes del archivo.</p>
        {membership?.status === "ok" ? <p>{membership.circuit_membership === "known" ? "Pertenencia a circuitos conocida según la fuente independiente." : "Pertenencia a circuitos desconocida. No se inventan circuitos ni denominadores."}</p> : <p>Pertenencia a circuitos no disponible.</p>}
      </aside>
    </section>
    <EvidenceUnits membership={membership ?? { status: "unavailable" }} rosales={rosales} />
    <Exclusions evidence={evidence} />
    <section className={styles.provenance} aria-labelledby="official-evidence-heading"><h2 id="official-evidence-heading">Trazabilidad autorizada</h2>
      <p>Metadatos del archivo expuestos por la consulta autorizada; no certifican integridad de bytes ni cobertura alojada fuera de la selección.</p>
      {evidence.provenance.items.filter(item => item.status !== "ok" || item.sha256 === null).map(item => <p role="note" key={item.archiveEntryId}>{item.archiveEntryId}: {item.status !== "ok" ? "el archivo informa estado error" : "SHA-256 no disponible"}. No se afirma verificación de integridad.</p>)}
      <details><summary>Archivo y procedencia</summary>{evidence.provenance.items.map(item => <dl key={item.archiveEntryId}>
        <div><dt>Archivo</dt><dd>{item.archiveEntryId}</dd></div><div><dt>Capacidad / MIME / tamaño</dt><dd>{item.capability} / {item.mime} / {item.bytes === null ? "tamaño no disponible" : `${item.bytes} bytes`}</dd></div>
        <div><dt>Fecha de obtención / estado</dt><dd>{item.fetchedAt} / {item.status}</dd></div><div><dt>SHA-256 registrado</dt><dd>{item.sha256 ?? "no disponible"}</dd></div>
      </dl>)}</details>
      <details><summary>Referencia electoral autorizada</summary><ul>{evidence.reference.items.map(item => <li key={item.jurisdictionId}>{item.jurisdictionId}: {item.year} {item.round}; {item.categoryName}; distrito {item.distritoCode}; sección {item.seccionCode}{item.circuitoCode ? `; circuito ${item.circuitoCode}` : ""}{item.mesaCode === null ? "" : `; mesa ${item.mesaCode}`}.</li>)}</ul></details>
    </section>
    <Boundaries />
  </>;
}
function Boundaries() {
  return <section className={styles.boundaries} aria-labelledby="evidence-method"><h2 id="evidence-method">Lo que Votus permite hoy</h2><div>
    <article><h3>Completitud de una sección, no del país</h3><p>El catálogo oficial permite informar mesas esperadas, escrutadas, no escrutadas y faltantes para una sección exacta. Sin catálogo, la completitud es desconocida, nunca 100 %.</p></article>
    <article><h3>Fiscalización separada y opt-in</h3><p>La fuente interna no es una muestra aleatoria. Se consulta en su módulo separado y nunca se combina con resultados oficiales.</p></article>
    <article><h3>Trazabilidad autorizada, sin rutas ni notas libres</h3><p>Solo metadatos seguros del archivo. Un SHA registrado no prueba verificación del archivo. No se exponen URL de origen, rutas, notas libres ni datos personales.</p></article>
    <article><h3>Revisión de lectura, no resolución</h3><p>Revisión de datos conserva la cola autorizada paginada de tipo, severidad y fecha. No se ofrece una acción de resolución.</p></article>
    <article><h3>Desconocido no significa vacío</h3><p>Consulta vacía, acceso no autorizado, evidencia no disponible y respuesta no válida son estados distintos. Los faltantes nunca se reemplazan por cero.</p></article>
    <article><h3>Fuentes y archivos no certifican cobertura total</h3><p>Las unidades visibles no son un denominador territorial. Comparación y Simulación requieren bases compatibles y verificadas; esta pantalla no concede esa aptitud.</p></article>
  </div></section>;
}

export default async function EvidencePage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  if (repeatedParams(params).length) return <Shell><Refusal title="Respuesta no válida"><p>Parámetros repetidos; no se consulta evidencia.</p></Refusal></Shell>;
  if (Object.keys(params).some(key => !keys.includes(key as typeof keys[number]))) return <Shell><Refusal title="Respuesta no válida"><p>Parámetros no compatibles con la consulta de evidencia oficial.</p></Refusal></Shell>;
  const values = Object.fromEntries(keys.map(key => [key, typeof params[key] === "string" ? params[key] : ""])) as Record<typeof keys[number], string>;
  const normalized = normalizeExplorationParams(Object.fromEntries(["distritoCode", "seccionCode"].filter(key => values[key as keyof typeof values]).map(key => [key, values[key as keyof typeof values]])));
  if (normalized.status !== "ok") return <Shell><Refusal title="Respuesta no válida"><p>Alcance territorial no válido.</p></Refusal></Shell>;
  values.distritoCode = normalized.value.distritoCode ?? ""; values.seccionCode = normalized.value.seccionCode ?? "";
  let facets: ExplorationFacets;
  try {
    facets = await createAuthorizedOfficialFacetRepository().facets(Object.fromEntries(keys.filter(key => values[key]).map(key => [key, values[key]])));
  } catch (error) {
    const denied = error instanceof AuthorizedOfficialFacetsError && (error.code === OFFICIAL_FACETS_ERROR.AUTHORIZATION_DENIED || error.code === OFFICIAL_FACETS_ERROR.NONMEMBER);
    const bounded = error instanceof AuthorizedOfficialFacetsError && error.code === OFFICIAL_FACETS_ERROR.PAYLOAD_TOO_LARGE;
    return <Shell><Refusal title={denied ? "Consulta no autorizada" : bounded ? "Respuesta fuera de límite" : "Evidencia no disponible"}><p>No se pudieron obtener las opciones autorizadas. No se muestran cifras ni procedencia.</p></Refusal></Shell>;
  }
  const fields: EvidenceField[] = [
    { name: "electionId", label: "Elección", value: values.electionId, options: facets.elections.map(item => ({ value: item.id, label: item.label })) },
    { name: "categoryId", label: "Categoría", value: values.categoryId, options: facets.categories.map(item => ({ value: item.id, label: item.name })) },
    { name: "distritoCode", label: "Distrito", value: values.distritoCode, options: facets.distritos.map(item => ({ value: item.code, label: formatFacetOptionLabel(item) })) },
    { name: "seccionCode", label: "Sección", value: values.seccionCode, options: facets.secciones.map(item => ({ value: item.code, label: formatFacetOptionLabel(item) })) },
  ];
  if (fields.some(field => field.value && !field.options.some(option => option.value === field.value))) return <Shell><Refusal title="Consulta no autorizada"><p>La selección no pertenece a las opciones autorizadas.</p></Refusal></Shell>;
  let content: ReactNode;
  let showFacetExclusions = true;
  if (keys.some(key => !values[key])) content = <><p className={styles.notice} role="status">Seleccione una elección, categoría, distrito y sección para consultar evidencia oficial. Disponibilidad y completitud: no disponible hasta tener una selección exacta autorizada.</p><Boundaries /></>;
  else {
    const evidence = await loadAuthorizedOfficialDrilldownEvidence({ ...values, circuitoCode: null, establecimientoCode: null, mesaCode: null, requestedLevel: "seccion" });
    if (evidence.status !== "ok") {
      showFacetExclusions = evidence.status !== "authorization_denied";
      content = <Refusal title={stateLabels[evidence.status]}>
        <p>{stateCopy[evidence.status]}</p>
        {evidence.status === "unavailable" && <a href={`/evidencia?${new URLSearchParams(values)}`}>Reintentar carga</a>}
        {evidence.status !== "authorization_denied" && evidence.evidence?.map(part => <section key={part.part} aria-label={`Evidencia de rechazo: ${part.part}`}>
          <h3>{part.part}</h3>
          {part.reason && <p>{part.reason}</p>}
          {part.counts && Object.entries(part.counts).map(([reason, count]) => <p role="note" key={reason}>{reason}: {count}.</p>)}
          {part.exclusions?.map(entry => <p role="note" key={entry.reason}>Exclusión {entry.reason}: {formatCount(entry.rows)} fila(s){entry.votes === undefined ? "." : ` / ${formatCount(entry.votes)} voto(s).`}</p>)}
          {part.sourceExclusions?.map(entry => <p role="note" key={entry.kind}>Fuente excluida {entry.kind}: {formatCount(entry.rows)} fila(s){entry.votes === undefined ? "." : ` / ${formatCount(entry.votes)} voto(s).`}</p>)}
        </section>)}
      </Refusal>;
    }
    else content = <Result evidence={evidence} title={facets.secciones.find(item => item.code === values.seccionCode)?.name ?? fields[3]!.options.find(item => item.value === values.seccionCode)!.label} distrito={facets.distritos.find(item => item.code === values.distritoCode)?.name ?? fields[2]!.options.find(item => item.value === values.distritoCode)!.label} rosales={values.distritoCode === "02" && values.seccionCode === "027"} />;
  }
  return <Shell><EvidenceContext key={new URLSearchParams(values).toString()} fields={fields}>
    {showFacetExclusions && (facets.exclusions ?? []).map(entry => <p className={styles.notice} role="note" key={entry.reason}>Opciones excluidas: {entry.reason}; {formatCount(entry.rows)} fila(s).</p>)}
    {content}
  </EvidenceContext></Shell>;
}
