import type { ReactNode } from "react";
import { ComparisonSelectionForm } from "./ComparisonSelectionForm";
import type { OfficialSelection } from "@/app/api/workspace/official/input";
import { GranularityBadge } from "@/components/GranularityBadge";
import { TableScroll } from "@/components/TableScroll";
import { compareResults, type UnitResult } from "@/lib/results/compare";
import type { ExplorationFacets, FacetOption } from "@/lib/results/exploration";
import { repeatedParams, stringParam } from "@/lib/results/query-params";
import {
  OFFICIAL_COMPARISON_EVIDENCE_STATUS,
  loadAuthorizedOfficialComparisonEvidence,
  type AuthorizedOfficialComparisonSideEvidence,
  type OfficialComparisonUnmappedSide,
} from "@/lib/workspace/official-comparison-evidence";
import {
  AuthorizedOfficialFacetsError,
  OFFICIAL_FACETS_ERROR,
  createAuthorizedOfficialFacetRepository,
} from "@/lib/workspace/official-facets";

interface ComparePageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const QUERY_KEY = {
  LEFT_ELECTION_ID: "leftElectionId",
  LEFT_CATEGORY_ID: "leftCategoryId",
  RIGHT_ELECTION_ID: "rightElectionId",
  RIGHT_CATEGORY_ID: "rightCategoryId",
  DISTRITO_CODE: "distritoCode",
  SECCION_CODE: "seccionCode",
} as const;

const ALLOWED_QUERY_KEYS: ReadonlySet<string> = new Set(Object.values(QUERY_KEY));
const LEGACY_QUERY_KEYS = new Set([
  "election2023",
  "election2025",
  "categoryId",
  "jurisdictionId",
  "partyCategory",
  "partyJurisdiction",
  "aggregateTo",
  "left_election_id",
  "left_category_id",
  "right_election_id",
  "right_category_id",
]);

const numberFormatter = new Intl.NumberFormat("es-AR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function formatPercentage(value: number): string {
  return `${numberFormatter.format(value)} %`;
}

function formatSwing(value: number): string {
  const normalized = Math.abs(value) < 0.005 ? 0 : value;
  return `${normalized > 0 ? "+" : ""}${numberFormatter.format(normalized)} puntos porcentuales`;
}

function refusalPage(message: ReactNode): ReactNode {
  return (
    <main className="page-shell">
      <div className="shell-container">
        <h1>Comparación oficial autorizada</h1>
        <p role="alert">{message}</p>
      </div>
    </main>
  );
}

function sameFacet(left: FacetOption, right: FacetOption): boolean {
  return left.code === right.code &&
    left.name === right.name &&
    left.nameStatus === right.nameStatus &&
    left.nameVariantCount === right.nameVariantCount;
}

interface SideCounts {
  leftOnly: number;
  rightOnly: number;
}

interface CommonFacetResult {
  options: FacetOption[];
  unique: SideCounts;
}

interface LoadedFacetUniqueCounts {
  distrito?: SideCounts;
  seccion?: SideCounts;
}

function commonFacets(left: FacetOption[], right: FacetOption[]): CommonFacetResult {
  const leftByCode = new Map(left.map((option) => [option.code, option]));
  const rightByCode = new Map(right.map((option) => [option.code, option]));
  const options: FacetOption[] = [];
  for (const option of left) {
    const peer = rightByCode.get(option.code);
    if (peer === undefined) continue;
    if (sameFacet(option, peer)) {
      options.push(option);
      continue;
    }
    options.push({
      code: option.code,
      name: null,
      nameStatus: "conflict",
      nameVariantCount: Math.max(2, option.nameVariantCount, peer.nameVariantCount),
    });
  }
  return {
    options,
    unique: {
      leftOnly: [...leftByCode.keys()].filter((code) => !rightByCode.has(code)).length,
      rightOnly: [...rightByCode.keys()].filter((code) => !leftByCode.has(code)).length,
    },
  };
}

function optionLabel(option: FacetOption): string {
  if (option.nameStatus === "present") return `${option.code} — ${option.name}`;
  if (option.nameStatus === "missing") return `${option.code} — nombre no disponible`;
  return `${option.code} — nombres contradictorios`;
}

interface CompareSelectorProps {
  elections: ExplorationFacets["elections"];
  leftCategories: ExplorationFacets["categories"];
  rightCategories: ExplorationFacets["categories"];
  distritos: FacetOption[];
  secciones: FacetOption[];
  selected: Partial<Record<(typeof QUERY_KEY)[keyof typeof QUERY_KEY], string>>;
  unique?: LoadedFacetUniqueCounts;
  message: string;
  alert?: boolean;
  children?: ReactNode;
}

function CompareSelector({
  elections,
  leftCategories,
  rightCategories,
  distritos,
  secciones,
  selected,
  unique,
  message,
  alert = false,
  children,
}: CompareSelectorProps): ReactNode {
  const leftElectionId = selected[QUERY_KEY.LEFT_ELECTION_ID];
  const rightElectionId = selected[QUERY_KEY.RIGHT_ELECTION_ID];
  const leftCategoryId = selected[QUERY_KEY.LEFT_CATEGORY_ID];
  const rightCategoryId = selected[QUERY_KEY.RIGHT_CATEGORY_ID];
  const distritoCode = selected[QUERY_KEY.DISTRITO_CODE];
  const options = {
    leftElectionId: elections.filter((option) => option.year === 2023).map((option) => option.id),
    rightElectionId: elections.filter((option) => option.year === 2025).map((option) => option.id),
    leftCategoryId: leftCategories.map((option) => option.id),
    rightCategoryId: rightCategories.map((option) => option.id),
    distritoCode: distritos.map((option) => option.code),
    seccionCode: secciones.map((option) => option.code),
  };

  return (
    <main className="page-shell official-compare">
      <div className="shell-container official-compare__layout">
        <header className="page-header official-compare__header">
          <p className="official-compare__section-label">Resultados oficiales / comparación autorizada</p>
          <h1>Comparación oficial autorizada</h1>
          <p className="official-compare__context">
            Compare dos selecciones oficiales independientes dentro de una misma sección autorizada.
          </p>
        </header>
        <section className="panel official-compare__selection" aria-labelledby="compare-selector-heading">
          <div className="panel__heading">
            <h2 id="compare-selector-heading">Elegir selecciones y sección compartida</h2>
          </div>
          <ComparisonSelectionForm key={JSON.stringify(selected)} selected={selected} options={options} applied={Boolean(children)}>
            <div className="official-compare__selector-grid">
              <fieldset className="official-compare__side" aria-labelledby="compare-edit-a-heading">
                <legend id="compare-edit-a-heading">Lado A <span>Selección oficial de 2023</span></legend>
                <div className="field">
                  <label htmlFor="compare-left-election">Elección izquierda (2023)</label>
                  <select id="compare-left-election" name={QUERY_KEY.LEFT_ELECTION_ID} defaultValue={leftElectionId ?? ""} required>
                    <option value="">Elegir elección de 2023</option>
                    {elections.filter((option) => option.year === 2023).map((option) => (
                      <option key={option.id} value={option.id}>{option.label}</option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="compare-left-category">Categoría izquierda</label>
                  <select id="compare-left-category" name={QUERY_KEY.LEFT_CATEGORY_ID} defaultValue={leftCategoryId ?? ""} disabled={!leftElectionId} required>
                    <option value="">Elegir categoría izquierda</option>
                    {leftCategories.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
                  </select>
                </div>
              </fieldset>
              <fieldset className="official-compare__side" aria-labelledby="compare-edit-b-heading">
                <legend id="compare-edit-b-heading">Lado B <span>Selección oficial de 2025</span></legend>
                <div className="field">
                  <label htmlFor="compare-right-election">Elección derecha (2025)</label>
                  <select id="compare-right-election" name={QUERY_KEY.RIGHT_ELECTION_ID} defaultValue={rightElectionId ?? ""} required>
                    <option value="">Elegir elección de 2025</option>
                    {elections.filter((option) => option.year === 2025).map((option) => (
                      <option key={option.id} value={option.id}>{option.label}</option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="compare-right-category">Categoría derecha</label>
                  <select id="compare-right-category" name={QUERY_KEY.RIGHT_CATEGORY_ID} defaultValue={rightCategoryId ?? ""} disabled={!rightElectionId} required>
                    <option value="">Elegir categoría derecha</option>
                    {rightCategories.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
                  </select>
                </div>
              </fieldset>
              <fieldset className="official-compare__shared" aria-labelledby="compare-shared-heading">
                <legend id="compare-shared-heading">Jurisdicción compartida <span>Solo opciones presentes en ambos lados</span></legend>
                <div className="field">
                  <label htmlFor="compare-distrito">Distrito compartido</label>
                  <select id="compare-distrito" name={QUERY_KEY.DISTRITO_CODE} defaultValue={distritoCode ?? ""} disabled={!leftCategoryId || !rightCategoryId} required>
                    <option value="">Elegir distrito compartido</option>
                    {distritos.map((option) => <option key={option.code} value={option.code}>{optionLabel(option)}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="compare-seccion">Sección compartida</label>
                  <select id="compare-seccion" name={QUERY_KEY.SECCION_CODE} defaultValue={selected[QUERY_KEY.SECCION_CODE] ?? ""} disabled={!distritoCode} required>
                    <option value="">Elegir sección compartida</option>
                    {secciones.map((option) => <option key={option.code} value={option.code}>{optionLabel(option)}</option>)}
                  </select>
                </div>
              </fieldset>
            </div>
          </ComparisonSelectionForm>
              {!alert && unique && (
                <aside aria-label="Opciones no compartidas">
                  {unique.distrito && <p>Opciones no compartidas — Distrito: {unique.distrito.leftOnly} Lado A / {unique.distrito.rightOnly} Lado B (disponibles solo en ese lado).</p>}
                  {unique.seccion && <p>Opciones no compartidas — Sección: {unique.seccion.leftOnly} Lado A / {unique.seccion.rightOnly} Lado B (disponibles solo en ese lado).</p>}
                </aside>
              )}
        </section>
        <p className="official-compare__state" role={alert ? "alert" : "status"}>{message}</p>
        {children}
      </div>
    </main>
  );
}

function unmappedPartiesRefusal(sides: OfficialComparisonUnmappedSide[]): string {
  const labels = { left: "lado izquierdo", right: "lado derecho" } as const;
  const details = sides.map(({ side, partyCount, totalVotes }) => `${labels[side]}: ${partyCount} ${partyCount === 1 ? "partido" : "partidos"} sin mapear, ${totalVotes} votos`);
  return `La comparación se rechazó porque contiene identidades partidarias sin mapear. ${details.join(". ")}. No se muestran cifras parciales.`;
}

function hasOnlyOfficialRenderedEvidence(side: unknown): boolean {
  if (typeof side !== "object" || side === null || Array.isArray(side)) return false;
  const result = (side as Record<string, unknown>)["result"];
  if (typeof result !== "object" || result === null || Array.isArray(result)) return false;
  const sourceAudit = (result as Record<string, unknown>)["sourceAudit"];
  return (result as Record<string, unknown>)["sourceKind"] === "official" &&
    Array.isArray(sourceAudit) &&
    sourceAudit.length > 0 &&
      sourceAudit.every((entry) => {
      if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return false;
      const audit = entry as Record<string, unknown>;
      const rows = audit["rows"], votes = audit["votes"];
      return audit["kind"] === "official" && typeof rows === "number" && Number.isSafeInteger(rows) && rows >= 0 && typeof votes === "number" && Number.isSafeInteger(votes) && votes >= 0;
    });
}

function evidenceRefusal(status: string): string {
  if (status === OFFICIAL_COMPARISON_EVIDENCE_STATUS.AUTHORIZATION_DENIED) {
    return "No tiene autorización vigente para consultar toda la comparación.";
  }
  if (status === OFFICIAL_COMPARISON_EVIDENCE_STATUS.PAYLOAD_TOO_LARGE) {
    return "La comparación autorizada excede el límite seguro y no se muestran cifras.";
  }
  if (status === OFFICIAL_COMPARISON_EVIDENCE_STATUS.MALFORMED) {
    return "La evidencia autorizada no superó la validación integral y no se muestran cifras.";
  }
  if (status === OFFICIAL_COMPARISON_EVIDENCE_STATUS.EMPTY) {
    return "No hay evidencia oficial completa para ambas selecciones.";
  }
  return "La evidencia oficial autorizada no está disponible y no se muestran cifras.";
}

function unit(side: AuthorizedOfficialComparisonSideEvidence, unitId: string): UnitResult {
  return {
    unitId,
    parties: side.result.parties.map((party) => ({
      party: party.canonicalPartyId!,
      votes: party.votes,
    })),
  };
}

function displayName(
  primary: AuthorizedOfficialComparisonSideEvidence,
  fallback: AuthorizedOfficialComparisonSideEvidence,
  canonicalPartyId: string | null | undefined,
): string {
  if (!canonicalPartyId) return "?";
  return primary.result.parties.find((party) => party.canonicalPartyId === canonicalPartyId)?.displayName ??
    fallback.result.parties.find((party) => party.canonicalPartyId === canonicalPartyId)?.displayName ??
    canonicalPartyId;
}

function sourceNotes(side: AuthorizedOfficialComparisonSideEvidence, label: string, sideLabel: string): ReactNode {
  return (
    <section className="official-compare__side-evidence" aria-labelledby={`exclusions-${label}`}>
      <h3 id={`exclusions-${label}`}>Cobertura y exclusiones — {sideLabel}</h3>
      {side.result.sourceAudit.map((entry) => (
        <p role="note" key={`${label}-audit-${entry.kind}`}>{label}: {entry.rows} fila(s) oficiales incluidas.</p>
      ))}
      {side.result.sourceExclusions.map((entry) => (
        <p role="note" key={`${label}-excluded-${entry.kind}`}>{label}: {entry.rows} fila(s) de fuente {entry.kind} excluidas de todas las cifras.</p>
      ))}
    </section>
  );
}

function provenance(side: AuthorizedOfficialComparisonSideEvidence, sideId: string, sideLabel: string): ReactNode {
  return (
    <section className="official-compare__side-evidence" aria-labelledby={`provenance-${sideId}`}>
      <h3 id={`provenance-${sideId}`}>Procedencia oficial — {sideLabel}</h3>
      <ul aria-label={`procedencia ${sideLabel}`}>
        {side.provenance.items.map((item) => (
          <li key={item.archiveEntryId}>
            <span className="evidence-text">{item.archiveEntryId}</span>: {item.capability}; {item.mime}; {item.bytes === null ? "tamaño no disponible" : `${item.bytes} bytes`}; recuperado {item.fetchedAt}; estado {item.status}; SHA-256 {item.sha256 ?? "no disponible"}.
          </li>
        ))}
      </ul>
    </section>
  );
}

function comparisonContext(
  leftElection: ExplorationFacets["elections"][number],
  rightElection: ExplorationFacets["elections"][number],
  leftCategory: ExplorationFacets["categories"][number],
  rightCategory: ExplorationFacets["categories"][number],
  unitId: string,
): ReactNode {
  return (
    <section className="official-compare__contexts" aria-label="Contexto de comparación autorizada">
      <article className="official-compare__side" aria-labelledby="compare-side-a-heading">
        <h2 id="compare-side-a-heading">Lado A</h2>
        <p>Elección: {leftElection.label}</p>
        <p>Categoría: {leftCategory.name}</p>
      </article>
      <article className="official-compare__side" aria-labelledby="compare-side-b-heading">
        <h2 id="compare-side-b-heading">Lado B</h2>
        <p>Elección: {rightElection.label}</p>
        <p>Categoría: {rightCategory.name}</p>
      </article>
      <article className="official-compare__shared">
        <h2>Jurisdicción compartida</h2>
        <p>{unitId}</p>
      </article>
    </section>
  );
}

export default async function ComparePage({ searchParams }: ComparePageProps): Promise<ReactNode> {
  const params = await searchParams;
  const repeated = repeatedParams(params);
  if (repeated.length > 0) {
    return refusalPage(<>Se rechazó la solicitud: estos parámetros se proporcionaron más de una vez: {repeated.join(", ")}.</>);
  }
  const suppliedKeys = Object.keys(params);
  const legacy = suppliedKeys.filter((key) => LEGACY_QUERY_KEYS.has(key));
  if (legacy.length > 0) {
    return refusalPage(<>Se rechazó la solicitud: los parámetros heredados {legacy.join(", ")} ya no están permitidos.</>);
  }
  const unknown = suppliedKeys.filter((key) => !ALLOWED_QUERY_KEYS.has(key));
  if (unknown.length > 0) {
    return refusalPage(<>Se rechazó la solicitud: parámetros de consulta no admitidos: {unknown.join(", ")}.</>);
  }

  const selected: CompareSelectorProps["selected"] = Object.fromEntries(
    Object.values(QUERY_KEY)
      .map((key) => [key, stringParam(params, key)] as const)
      .filter((entry): entry is readonly [(typeof QUERY_KEY)[keyof typeof QUERY_KEY], string] => entry[1] !== undefined),
  );
  const leftElectionId = selected[QUERY_KEY.LEFT_ELECTION_ID];
  const rightElectionId = selected[QUERY_KEY.RIGHT_ELECTION_ID];
  const leftCategoryId = selected[QUERY_KEY.LEFT_CATEGORY_ID];
  const rightCategoryId = selected[QUERY_KEY.RIGHT_CATEGORY_ID];
  const distritoCode = selected[QUERY_KEY.DISTRITO_CODE];
  const seccionCode = selected[QUERY_KEY.SECCION_CODE];

  const repository = createAuthorizedOfficialFacetRepository();
  let cold: ExplorationFacets;
  try {
    cold = await repository.facets({});
  } catch (error) {
    const message = error instanceof AuthorizedOfficialFacetsError && error.code === OFFICIAL_FACETS_ERROR.AUTHORIZATION_DENIED
      ? "No tiene autorización para cargar las opciones de comparación."
      : "No se pudieron cargar las opciones autorizadas.";
    return refusalPage(message);
  }

  const selectedLeftElection = cold.elections.find((option) => option.id === leftElectionId && option.year === 2023);
  const selectedRightElection = cold.elections.find((option) => option.id === rightElectionId && option.year === 2025);
  if ((leftElectionId && !selectedLeftElection) || (rightElectionId && !selectedRightElection)) {
    return <CompareSelector elections={cold.elections} leftCategories={[]} rightCategories={[]} distritos={[]} secciones={[]} selected={selected} message="La elección seleccionada no pertenece al año y alcance autorizados." alert />;
  }

  let leftCategories: ExplorationFacets["categories"] = [];
  let rightCategories: ExplorationFacets["categories"] = [];
  try {
    const [leftFacets, rightFacets] = await Promise.all([
      selectedLeftElection ? repository.facets({ electionId: selectedLeftElection.id }) : Promise.resolve(null),
      selectedRightElection ? repository.facets({ electionId: selectedRightElection.id }) : Promise.resolve(null),
    ]);
    leftCategories = leftFacets?.categories ?? [];
    rightCategories = rightFacets?.categories ?? [];
  } catch {
    return <CompareSelector elections={cold.elections} leftCategories={[]} rightCategories={[]} distritos={[]} secciones={[]} selected={selected} message="No se pudieron cargar las categorías autorizadas." alert />;
  }

  const leftCategory = leftCategories.find((option) => option.id === leftCategoryId);
  const rightCategory = rightCategories.find((option) => option.id === rightCategoryId);
  if ((leftCategoryId && !leftCategory) || (rightCategoryId && !rightCategory)) {
    return <CompareSelector elections={cold.elections} leftCategories={leftCategories} rightCategories={rightCategories} distritos={[]} secciones={[]} selected={selected} message="Una categoría seleccionada no pertenece a su elección autorizada." alert />;
  }

  let distritos: FacetOption[] = [];
    const unique: LoadedFacetUniqueCounts = {};
  if (selectedLeftElection && selectedRightElection && leftCategory && rightCategory) {
    try {
      const [leftScope, rightScope] = await Promise.all([
        repository.facets({ electionId: selectedLeftElection.id, categoryId: leftCategory.id }),
        repository.facets({ electionId: selectedRightElection.id, categoryId: rightCategory.id }),
      ]);
      const common = commonFacets(leftScope.distritos, rightScope.distritos);
      distritos = common.options;
      unique.distrito = common.unique;
    } catch {
      return <CompareSelector elections={cold.elections} leftCategories={leftCategories} rightCategories={rightCategories} distritos={[]} secciones={[]} selected={selected} message="No se pudieron cargar los distritos compartidos autorizados." alert />;
    }
  }
  const selectedDistrito = distritos.find((option) => option.code === distritoCode);
  if (distritoCode && !selectedDistrito) {
    return <CompareSelector elections={cold.elections} leftCategories={leftCategories} rightCategories={rightCategories} distritos={distritos} secciones={[]} selected={selected} message="El distrito no es compartido por ambas selecciones autorizadas." alert />;
  }

  let secciones: FacetOption[] = [];
  if (selectedLeftElection && selectedRightElection && leftCategory && rightCategory && selectedDistrito) {
    try {
      const [leftScope, rightScope] = await Promise.all([
        repository.facets({ electionId: selectedLeftElection.id, categoryId: leftCategory.id, distritoCode: selectedDistrito.code }),
        repository.facets({ electionId: selectedRightElection.id, categoryId: rightCategory.id, distritoCode: selectedDistrito.code }),
      ]);
      const common = commonFacets(leftScope.secciones, rightScope.secciones);
      secciones = common.options;
      unique.seccion = common.unique;
    } catch {
      return <CompareSelector elections={cold.elections} leftCategories={leftCategories} rightCategories={rightCategories} distritos={distritos} secciones={[]} selected={selected} message="No se pudieron cargar las secciones compartidas autorizadas." alert />;
    }
  }
  const selectedSeccion = secciones.find((option) => option.code === seccionCode);
  if (seccionCode && !selectedSeccion) {
    return <CompareSelector elections={cold.elections} leftCategories={leftCategories} rightCategories={rightCategories} distritos={distritos} secciones={secciones} selected={selected} message="La sección no es compartida por ambas selecciones autorizadas." alert />;
  }

  const ready = selectedLeftElection && selectedRightElection && leftCategory && rightCategory && selectedDistrito && selectedSeccion;
  if (!ready) {
    return <CompareSelector elections={cold.elections} leftCategories={leftCategories} rightCategories={rightCategories} distritos={distritos} secciones={secciones} selected={selected} unique={unique} message="Complete ambas selecciones y una sección exacta compartida para comparar." />;
  }

  const sectionSelection = {
    distritoCode: selectedDistrito.code,
    seccionCode: selectedSeccion.code,
    circuitoCode: null,
    establecimientoCode: null,
    mesaCode: null,
    requestedLevel: "seccion" as const,
  };
  const leftSelection: OfficialSelection = {
    ...sectionSelection,
    electionId: selectedLeftElection.id,
    categoryId: leftCategory.id,
  };
  const rightSelection: OfficialSelection = {
    ...sectionSelection,
    electionId: selectedRightElection.id,
    categoryId: rightCategory.id,
  };
  const evidence = await loadAuthorizedOfficialComparisonEvidence(leftSelection, rightSelection);
  if (evidence.status === OFFICIAL_COMPARISON_EVIDENCE_STATUS.UNMAPPED_PARTIES) {
    return refusalPage(unmappedPartiesRefusal(evidence.sides));
  }
  if (evidence.status !== OFFICIAL_COMPARISON_EVIDENCE_STATUS.OK) {
    return <CompareSelector elections={cold.elections} leftCategories={leftCategories} rightCategories={rightCategories} distritos={distritos} secciones={secciones} selected={selected} message={evidenceRefusal(evidence.status)} alert />;
  }
  if (!hasOnlyOfficialRenderedEvidence(evidence.left) || !hasOnlyOfficialRenderedEvidence(evidence.right)) {
    return refusalPage("La evidencia oficial autorizada no superó la validación integral y no se muestran cifras.");
  }

  const unitId = `${selectedDistrito.code}/${selectedSeccion.code}`;
  const comparison = compareResults({
    granularity2023: evidence.left.result.sourceGranularity,
    granularity2025: evidence.right.result.sourceGranularity,
    units2023: [unit(evidence.left, unitId)],
    units2025: [unit(evidence.right, unitId)],
  });
  if (comparison.status === "requires_explicit_aggregation") {
    return refusalPage(<>Granularidad mixta: la selección izquierda usa {comparison.granularity2023} y la derecha usa {comparison.granularity2025}. Esta comparación no hace suposiciones ni muestra cifras con niveles incompatibles (D6).</>);
  }
  if (comparison.status !== "ok") {
    return refusalPage("La comparación canónica no superó sus controles y no se muestran cifras.");
  }

  const swing = comparison.swings[0];
  if (!swing || comparison.swings.length !== 1 || comparison.discontinuities.length > 0) {
    return refusalPage("La comparación no produjo una única sección canónica compartida y no se muestran cifras.");
  }
  const leftName = (id: string | null | undefined) => displayName(evidence.left, evidence.right, id);
  const rightName = (id: string | null | undefined) => displayName(evidence.right, evidence.left, id);
  const summedFrom = evidence.left.result.sourceGranularity === evidence.right.result.sourceGranularity && evidence.left.result.sourceGranularity !== "seccion"
    ? evidence.left.result.sourceGranularity
    : undefined;

  return (
    <CompareSelector
      elections={cold.elections}
      leftCategories={leftCategories}
      rightCategories={rightCategories}
      distritos={distritos}
      secciones={secciones}
      selected={selected}
      unique={unique}
      message="Comparación aplicada"
    >
        {comparisonContext(selectedLeftElection, selectedRightElection, leftCategory, rightCategory, unitId)}
        <section className="official-compare__results" aria-labelledby="compare-results-heading">
          <h2 id="compare-results-heading">Resultados exactos</h2>
          <GranularityBadge granularity="seccion" {...(summedFrom ? { summedFrom } : {})} />
        <p>{unitId}: {swing.flipped ? `cambió de ${leftName(swing.fromParty)} → ${rightName(swing.toParty)}` : "sin cambio"}.</p>
        <TableScroll label={`Tabla exacta de participación y variación por partido en ${unitId}`}>
          <table className="data-table">
            <caption>Participación oficial y variación en puntos porcentuales</caption>
            <thead><tr><th scope="col">Partido izquierdo</th><th scope="col">Participación izquierda</th><th scope="col">Partido derecho</th><th scope="col">Participación derecha</th><th scope="col">Variación</th></tr></thead>
            <tbody>
              {[...swing.swings].sort((left, right) => left.party.localeCompare(right.party)).map((partySwing) => {
                const share2023 = swing.shares2023.find((share) => share.party === partySwing.party)?.sharePercent ?? 0;
                const share2025 = swing.shares2025.find((share) => share.party === partySwing.party)?.sharePercent ?? 0;
                return (
                  <tr key={partySwing.party}>
                    <th scope="row">{leftName(partySwing.party)}</th>
                    <td className="table-cell--number">{formatPercentage(share2023)}</td>
                    <td>{rightName(partySwing.party)}</td>
                    <td className="table-cell--number">{formatPercentage(share2025)}</td>
                    <td className="table-cell--number">{formatSwing(partySwing.swingPercentPoints)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableScroll>
        </section>
        <aside className="official-compare__evidence" aria-labelledby="compare-evidence-heading">
          <h2 id="compare-evidence-heading">Evidencia oficial por lado</h2>
          <article className="official-compare__evidence-side">
            {sourceNotes(evidence.left, "Izquierda", "Lado A")}
            <section className="official-compare__side-evidence" aria-labelledby="reference-left">
              <h3 id="reference-left">Referencia oficial — Lado A</h3>
              <p>Izquierda: {evidence.left.reference.items.length} referencia(s), elección {selectedLeftElection.label}, categoría {leftCategory.name}, sección {unitId}.</p>
            </section>
            {provenance(evidence.left, "left", "Lado A")}
          </article>
          <article className="official-compare__evidence-side">
            {sourceNotes(evidence.right, "Derecha", "Lado B")}
            <section className="official-compare__side-evidence" aria-labelledby="reference-right">
              <h3 id="reference-right">Referencia oficial — Lado B</h3>
              <p>Derecha: {evidence.right.reference.items.length} referencia(s), elección {selectedRightElection.label}, categoría {rightCategory.name}, sección {unitId}.</p>
            </section>
            {provenance(evidence.right, "right", "Lado B")}
          </article>
        </aside>
    </CompareSelector>
  );
}
