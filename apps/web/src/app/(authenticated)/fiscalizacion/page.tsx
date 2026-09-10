import type { ReactNode } from "react";

import { ScopeSelectorForm } from "@/components/ScopeSelectorForm";
import { TableScroll } from "@/components/TableScroll";
import {
  SCOPE_FORM_KIND,
  scopeControlStates,
} from "@/components/scope-selector-behavior";
import {
  formatFacetOptionLabel,
  normalizeExplorationParams,
  type ExplorationFacets,
} from "@/lib/results/exploration";
import { repeatedParams, stringParam } from "@/lib/results/query-params";
import { AuthorizedOfficialFacetsError, OFFICIAL_FACETS_ERROR, createAuthorizedOfficialFacetRepository } from "@/lib/workspace/official-facets";
import type {
  AuthorizedFiscalizacionCoverage,
  AuthorizedFiscalizacionResult,
} from "@/lib/workspace/context";
import {
  loadSafeFiscalizacionCoverage,
  loadSafeFiscalizacionResult,
  type FiscalizacionEvidenceSelection,
} from "@/lib/workspace/fiscalizacion-evidence";

const ALLOWED_QUERY_KEYS = new Set([
  "electionId",
  "categoryId",
  "distritoCode",
  "seccionCode",
]);

interface FiscalizacionPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

interface CoverageFormSelection {
  electionId?: string;
  categoryId?: string;
  distritoCode?: string;
  seccionCode?: string;
}

interface EvidenceCollection<T> {
  items: T[];
  total: number;
  truncated: boolean;
}

interface CoverageUncoveredItem {
  code: number;
  circuito_code: string;
  establecimiento_code: string;
  establecimiento_name: string;
}

interface EvidenceExclusion {
  reason: string;
  rows: number;
}

function CoverageExplorerForm({
  facets,
  selected,
}: {
  facets: ExplorationFacets;
  selected: CoverageFormSelection;
}): ReactNode {
  const controlStates = scopeControlStates(SCOPE_FORM_KIND.COVERAGE, {
    electionId: selected.electionId ?? "",
    categoryId: selected.categoryId ?? "",
    distritoCode: selected.distritoCode ?? "",
    seccionCode: selected.seccionCode ?? "",
  });

  return (
    <section className="fiscalizacion-workspace__filters panel" aria-labelledby="coverage-form-heading">
      <div className="panel__heading">
        <p className="fiscalizacion-workspace__section-label">Alcance y control</p>
        <h2 id="coverage-form-heading">Elegir el alcance de la cobertura</h2>
        <p>
          Mantenga la presencia no oficial separada del denominador de resultados
          oficiales.
        </p>
      </div>
      <ScopeSelectorForm
        action="/fiscalizacion"
        kind={SCOPE_FORM_KIND.COVERAGE}
      >
        <fieldset className="form-grid selector-form">
          <legend className="selector-form__legend">Selectores de cobertura</legend>
          <div className="field">
            <label htmlFor="coverage-election">Elección</label>
            <select
              id="coverage-election"
              name="electionId"
              defaultValue={selected.electionId ?? ""}
              required={controlStates.electionId.required}
              disabled={controlStates.electionId.disabled}
            >
              <option value="">Elegir una elección</option>
              {facets.elections.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="coverage-category">Categoría</label>
            <select
              id="coverage-category"
              name="categoryId"
              defaultValue={selected.categoryId ?? ""}
              required={controlStates.categoryId.required}
              disabled={controlStates.categoryId.disabled}
            >
              <option value="">Elegir una categoría</option>
              {facets.categories.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="coverage-distrito">Distrito</label>
            <select
              id="coverage-distrito"
              name="distritoCode"
              defaultValue={selected.distritoCode ?? ""}
              required={controlStates.distritoCode.required}
              disabled={controlStates.distritoCode.disabled}
            >
              <option value="">Elegir un distrito</option>
              {facets.distritos.map((option) => (
                <option key={option.code} value={option.code}>
                  {formatFacetOptionLabel(option)}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="coverage-seccion">Sección</label>
            <select
              id="coverage-seccion"
              name="seccionCode"
              defaultValue={selected.seccionCode ?? ""}
              required={controlStates.seccionCode.required}
              disabled={controlStates.seccionCode.disabled}
            >
              <option value="">Elegir una sección</option>
              {facets.secciones.map((option) => (
                <option key={option.code} value={option.code}>
                  {formatFacetOptionLabel(option)}
                </option>
              ))}
            </select>
          </div>
        </fieldset>
        <div className="form-actions">
          <button className="button button--primary" type="submit">
            Mostrar cobertura
          </button>
        </div>
      </ScopeSelectorForm>
    </section>
  );
}

function PageHeader(): ReactNode {
  return (
    <header className="page-header fiscalizacion-workspace__header">
      <p className="eyebrow">Fiscalización / evidencia autorizada</p>
      <h1>Fiscalización (no oficial)</h1>
      <p className="page-header__lede">
        Examine la presencia no oficial sin perder de vista el denominador oficial.
      </p>
    </header>
  );
}

function refusal(reason: string): ReactNode {
  return (
    <main className="page-shell fiscalizacion-workspace">
      <div className="shell-container fiscalizacion-workspace__layout">
        <PageHeader />
        <section className="fiscalizacion-workspace__state" role="alert">
          <p>Se rechazó la solicitud: {reason}.</p>
        </section>
      </div>
    </main>
  );
}

function formatCounts(counts: Record<string, number>): string {
  return Object.entries(counts)
    .map(([reason, count]) => `${reason}: ${count}`)
    .join(", ");
}

function collectionNotice(
  label: string,
  collection: EvidenceCollection<unknown>,
): ReactNode {
  return (
    <p role={collection.truncated ? "alert" : "note"}>
      {label}: se muestran {collection.items.length} de {collection.total}
      {collection.truncated ? "; respuesta truncada" : ""}.
    </p>
  );
}

function renderExclusions(
  label: string,
  collection: EvidenceCollection<EvidenceExclusion>,
): ReactNode {
  return (
    <>
      <ul aria-label={label}>
        {collection.items.map((item, index) => (
          <li key={`${item.reason}-${index}`}>
            {item.reason}: {item.rows} filas
          </li>
        ))}
      </ul>
      {collectionNotice(label, collection)}
    </>
  );
}

function evidenceRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

const PRESENTATION_KIND = {
  READY: "ready",
  EMPTY: "empty",
  TECHNICAL_ERROR: "technical_error",
  REFUSED: "refused",
} as const;

const PRESENTATION_REASON = {
  UNAVAILABLE: "unavailable",
  INVALID: "invalid",
  DENIED: "denied",
  OVERSIZED: "oversized",
} as const;

type PresentationReason =
  (typeof PRESENTATION_REASON)[keyof typeof PRESENTATION_REASON];

interface ReadyFiscalizacionPresentation {
  kind: typeof PRESENTATION_KIND.READY;
  coverage: AuthorizedFiscalizacionCoverage;
  result: AuthorizedFiscalizacionResult;
}

interface EmptyFiscalizacionPresentation {
  kind: typeof PRESENTATION_KIND.EMPTY;
}

interface TechnicalErrorFiscalizacionPresentation {
  kind: typeof PRESENTATION_KIND.TECHNICAL_ERROR;
}

interface RefusedFiscalizacionPresentation {
  kind: typeof PRESENTATION_KIND.REFUSED;
  reason: PresentationReason;
}

type FiscalizacionPresentation =
  | ReadyFiscalizacionPresentation
  | EmptyFiscalizacionPresentation
  | TechnicalErrorFiscalizacionPresentation
  | RefusedFiscalizacionPresentation;

function settledValue<T>(result: PromiseSettledResult<T>): T | null {
  return result.status === "fulfilled" ? result.value : null;
}

function settledStatus<T>(result: PromiseSettledResult<T>): string {
  if (result.status === "rejected") return "unavailable (thrown)";
  const value = evidenceRecord(result.value);
  return typeof value?.["status"] === "string"
    ? value["status"]
    : "unavailable (invalid)";
}

function isNonnegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function hasValidReference(evidence: Record<string, unknown>): boolean {
  const reference = evidenceRecord(evidence["reference"]);
  return (
    reference !== null &&
    Object.getPrototypeOf(reference) === Object.prototype &&
    isNonnegativeSafeInteger(reference["denominator_units"])
  );
}

function isExactEmptyCollection(value: unknown): boolean {
  const collection = evidenceRecord(value);
  return (
    collection !== null &&
    Object.getPrototypeOf(collection) === Object.prototype &&
    Object.keys(collection).length === 3 &&
    Array.isArray(collection["items"]) &&
    collection["items"].length === 0 &&
    collection["total"] === 0 &&
    collection["truncated"] === false
  );
}

function hasExactClaims(
  value: unknown,
  evidenceKey: "observed_units" | "reference",
): boolean {
  const evidence = evidenceRecord(value);
  if (
    !evidence ||
    evidence["status"] !== "ok" ||
    evidence["authorization_status"] !== "authorized" ||
    evidence["source_kind"] !== "fiscalizacion" ||
    evidence["is_random_sample"] !== false
  ) {
    return false;
  }
  if (evidenceKey === "observed_units") {
    return (
      evidence["vote_data"] === "not_included" &&
      isNonnegativeSafeInteger(evidence["observed_units"]) &&
      isNonnegativeSafeInteger(evidence["denominator_units"]) &&
      evidence["denominator_units"] >= evidence["observed_units"]
    );
  }
  return hasValidReference(evidence);
}

function hasAuthorizedNoRows(value: unknown): boolean {
  const evidence = evidenceRecord(value);
  return (
    evidence !== null &&
    evidence["status"] === "no_rows" &&
    evidence["authorization_status"] === "authorized" &&
    evidence["source_kind"] === "fiscalizacion" &&
    evidence["is_random_sample"] === false &&
    hasValidReference(evidence) &&
    evidence["truncated"] === false &&
    ["rows", "unmapped", "exclusions", "provenance"].every((key) =>
      isExactEmptyCollection(evidence[key]),
    )
  );
}

function refusalReason(
  coverage: PromiseSettledResult<AuthorizedFiscalizacionCoverage>,
  result: PromiseSettledResult<AuthorizedFiscalizacionResult>,
): PresentationReason {
  const statuses = [settledStatus(coverage), settledStatus(result)];
  if (statuses.includes("authorization_denied")) return PRESENTATION_REASON.DENIED;
  if (statuses.includes("payload_too_large")) return PRESENTATION_REASON.OVERSIZED;
  const coverageValue = settledValue(coverage);
  const resultValue = settledValue(result);
  if (
    statuses.includes("selection_invalid") ||
    statuses.includes("source_inconsistent") ||
    (evidenceRecord(coverageValue)?.["status"] === "ok" &&
      !hasExactClaims(coverageValue, "observed_units")) ||
    (evidenceRecord(resultValue)?.["status"] === "ok" &&
      !hasExactClaims(resultValue, "reference")) ||
    (evidenceRecord(resultValue)?.["status"] === "no_rows" &&
      !hasAuthorizedNoRows(resultValue))
  ) {
    return PRESENTATION_REASON.INVALID;
  }
  return PRESENTATION_REASON.UNAVAILABLE;
}

function fiscalizacionPresentation(
  coverage: PromiseSettledResult<AuthorizedFiscalizacionCoverage>,
  result: PromiseSettledResult<AuthorizedFiscalizacionResult>,
): FiscalizacionPresentation {
  const coverageValue = settledValue(coverage);
  const resultValue = settledValue(result);
  if (coverage.status === "rejected" || result.status === "rejected") {
    return { kind: PRESENTATION_KIND.TECHNICAL_ERROR };
  }
  if (coverageValue && resultValue && hasExactClaims(coverageValue, "observed_units")) {
    if (hasAuthorizedNoRows(resultValue)) return { kind: PRESENTATION_KIND.EMPTY };
    if (hasExactClaims(resultValue, "reference")) {
      return { kind: PRESENTATION_KIND.READY, coverage: coverageValue, result: resultValue };
    }
  }
  return { kind: PRESENTATION_KIND.REFUSED, reason: refusalReason(coverage, result) };
}

function CoverageEvidence({
  result,
}: {
  result: PromiseSettledResult<AuthorizedFiscalizacionCoverage>;
}): ReactNode {
  const value = settledValue(result);
  return (
    <section className="fiscalizacion-workspace__coverage" aria-labelledby="workspace-coverage">
      <p className="fiscalizacion-workspace__section-label">Fuente fiscal</p>
      <h2 id="workspace-coverage">Cobertura autorizada</h2>
      <p role={value ? "status" : "alert"}>
        Estado de cobertura: {settledStatus(result)}.
      </p>
      {value && "observed_units" in value ? (
        <>
          <p>
            Fuente: fiscalización; no es una muestra aleatoria; datos de votos no
            incluidos.
          </p>
          <p>
            {value.observed_units} unidades observadas de {value.denominator_units} del
            denominador oficial.
          </p>
          <ul aria-label="Unidades sin cobertura">
            {(value.uncovered.items as CoverageUncoveredItem[]).map((item) => (
              <li
                key={`${item.circuito_code}-${item.establecimiento_code}-${item.code}`}
              >
                Mesa {item.code}, circuito {item.circuito_code},{" "}
                {item.establecimiento_name} ({item.establecimiento_code})
              </li>
            ))}
          </ul>
          {collectionNotice("Unidades sin cobertura", value.uncovered)}
          {renderExclusions(
            "Exclusiones de cobertura",
            value.exclusions as EvidenceCollection<EvidenceExclusion>,
          )}
          {value.truncated ? (
            <p role="alert">La evidencia de cobertura está truncada.</p>
          ) : null}
        </>
      ) : value && "exclusions" in value ? (
        renderExclusions("Exclusiones de cobertura", value.exclusions)
      ) : value && "truncated" in value && value.truncated ? (
        <p role="alert">La evidencia de cobertura está truncada.</p>
      ) : null}
    </section>
  );
}

function ResultEvidence({
  result,
}: {
  result: PromiseSettledResult<AuthorizedFiscalizacionResult>;
}): ReactNode {
  const value = settledValue(result);
  return (
    <section className="fiscalizacion-workspace__result" aria-labelledby="workspace-result">
      <p className="fiscalizacion-workspace__section-label">Resultado y procedencia</p>
      <h2 id="workspace-result">Resultado autorizado</h2>
      <p role={value ? "status" : "alert"}>
        Estado del resultado: {settledStatus(result)}.
      </p>
      {value && "reference" in value ? (
        <>
          <p>
            Fuente: fiscalización; no es una muestra aleatoria. Referencia:{" "}
            {value.reference.election_year ?? "año no disponible"}{" "}
            {value.reference.election_round ?? "ronda no disponible"},{" "}
            {value.reference.category_name ?? "categoría no disponible"}, distrito{" "}
            {value.reference.distrito_code}, sección {value.reference.seccion_code};
            denominador {value.reference.denominator_units}.
          </p>
          <TableScroll label="Resultados de fiscalización">
            <table className="data-table">
              <caption>Resultados de fiscalización</caption>
              <thead>
                <tr>
                  <th scope="col">Partido</th>
                  <th scope="col">Lista</th>
                  <th scope="col">Nivel</th>
                  <th scope="col">Votos</th>
                  <th scope="col">Filas</th>
                </tr>
              </thead>
              <tbody>
                {value.rows.items.map((row, index) => (
                  <tr key={`${row.list_id}-${row.canonical_party_id}-${index}`}>
                    <td>{row.party_name ?? "Sin mapeo"}</td>
                    <td>{row.list_id ?? "Sin lista"}</td>
                    <td>{row.granularity}</td>
                    <td>{row.votes}</td>
                    <td>{row.rows}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
          {collectionNotice("Resultados", value.rows)}
          <ul aria-label="Listas no mapeadas">
            {value.unmapped.items.map((item, index) => (
              <li key={`${item.list_id}-${index}`}>
                Sin mapeo: {item.list_id ?? "Sin lista"}; {item.votes} votos,{" "}
                {item.rows} filas
              </li>
            ))}
          </ul>
          {collectionNotice("Listas no mapeadas", value.unmapped)}
          {renderExclusions("Exclusiones del resultado", value.exclusions)}
          <ul aria-label="Procedencia del resultado">
            {value.provenance.items.map((item) => (
              <li key={item.id}>
                {item.id}: {item.status}, SHA-256 {item.sha256 ?? "no disponible"},
                obtenido {item.fetched_at}
              </li>
            ))}
          </ul>
          {collectionNotice("Procedencia", value.provenance)}
          {value.truncated ? (
            <p role="alert">La evidencia del resultado está truncada.</p>
          ) : null}
        </>
      ) : value && "exclusions" in value ? (
        renderExclusions("Exclusiones del resultado", value.exclusions)
      ) : value && "truncated" in value && value.truncated ? (
        <p role="alert">La evidencia del resultado está truncada.</p>
      ) : null}
    </section>
  );
}

function AuthorizedEvidence({
  form,
  coverage,
  result,
}: {
  form: ReactNode;
  coverage: PromiseSettledResult<AuthorizedFiscalizacionCoverage>;
  result: PromiseSettledResult<AuthorizedFiscalizacionResult>;
}): ReactNode {
  const presentation = fiscalizacionPresentation(coverage, result);

  const state =
    presentation.kind === PRESENTATION_KIND.EMPTY ? (
      <section className="fiscalizacion-workspace__state" role="status" aria-labelledby="workspace-evidence-empty">
        <h2 id="workspace-evidence-empty">Evidencia sin filas</h2>
        <p>La consulta autorizada no devolvió resultados de fiscalización.</p>
      </section>
    ) : presentation.kind === PRESENTATION_KIND.TECHNICAL_ERROR ? (
      <section className="fiscalizacion-workspace__state" role="alert" aria-labelledby="workspace-evidence-error">
        <h2 id="workspace-evidence-error">Error técnico de evidencia</h2>
        <p>No se pudo cargar la pareja de evidencia. Reintente la consulta.</p>
      </section>
    ) : presentation.kind === PRESENTATION_KIND.REFUSED ? (
      <section className="fiscalizacion-workspace__state" role="alert" aria-labelledby="workspace-evidence-refusal">
        <h2 id="workspace-evidence-refusal">Evidencia no disponible</h2>
        <p>Estado de evidencia: {presentation.reason}.</p>
      </section>
    ) : (
      <section className="fiscalizacion-workspace__evidence" aria-label="Evidencia fiscal autorizada">
        <CoverageEvidence result={{ status: "fulfilled", value: presentation.coverage }} />
        <ResultEvidence result={{ status: "fulfilled", value: presentation.result }} />
      </section>
    );

  return (
    <main className="page-shell fiscalizacion-workspace">
      <div className="shell-container fiscalizacion-workspace__layout">
        <PageHeader />
        {form}
        {state}
      </div>
    </main>
  );
}

async function renderFiscalizacionPage(
  params: Record<string, string | string[] | undefined>,
): Promise<ReactNode> {
  const repeated = repeatedParams(params);
  if (repeated.length > 0) {
    return refusal(
      `los parámetros de consulta repetidos no permiten identificar un único alcance (${repeated.join(", ")})`,
    );
  }

  const electionId = stringParam(params, "electionId");
  const categoryId = stringParam(params, "categoryId");
  const rawDistritoCode = stringParam(params, "distritoCode");
  const rawSeccionCode = stringParam(params, "seccionCode");
  const normalized = normalizeExplorationParams({
    ...(rawDistritoCode ? { distritoCode: rawDistritoCode } : {}),
    ...(rawSeccionCode ? { seccionCode: rawSeccionCode } : {}),
  });
  if (normalized.status === "invalid") {
    return refusal(`${normalized.reason}. ${formatCounts(normalized.counts)}`);
  }

  const selected: CoverageFormSelection = {
    ...(electionId ? { electionId } : {}),
    ...(categoryId ? { categoryId } : {}),
    ...(normalized.value.distritoCode
      ? { distritoCode: normalized.value.distritoCode }
      : {}),
    ...(normalized.value.seccionCode
      ? { seccionCode: normalized.value.seccionCode }
      : {}),
  };

   const distritoCode = normalized.value.distritoCode;
   const seccionCode = normalized.value.seccionCode;
   if (electionId && categoryId && distritoCode && seccionCode) {
     const selection: FiscalizacionEvidenceSelection = { electionId, categoryId, distritoCode, seccionCode };
     const [coverage, result, facets] = await Promise.all([Promise.allSettled([loadSafeFiscalizacionCoverage(selection, true), loadSafeFiscalizacionResult(selection, true)]), createAuthorizedOfficialFacetRepository().facets(selected).catch(() => null)]).then(([evidence, loadedFacets]) => [evidence[0], evidence[1], loadedFacets] as const);
     return <AuthorizedEvidence form={facets ? <CoverageExplorerForm facets={facets} selected={selected} /> : null} coverage={coverage} result={result} />;
   }
   let facets: ExplorationFacets;
   try { facets = await createAuthorizedOfficialFacetRepository().facets(selected); }
   catch (error) { return refusal(error instanceof AuthorizedOfficialFacetsError && error.code === OFFICIAL_FACETS_ERROR.AUTHORIZATION_DENIED ? "No tiene autorización para consultar estas opciones" : "No se pudieron cargar las opciones"); }
   const form = <CoverageExplorerForm facets={facets} selected={selected} />;
   return <main className="page-shell fiscalizacion-workspace"><div className="shell-container fiscalizacion-workspace__layout"><PageHeader />{form}<section className="fiscalizacion-workspace__state" role="status"><p>Elija la elección, la categoría, el distrito y la sección disponibles. La URL resultante se puede reutilizar.</p></section></div></main>;
}

export default async function FiscalizacionPage({
  searchParams,
}: FiscalizacionPageProps): Promise<ReactNode> {
  const params = await searchParams;
  const rejected = Object.keys(params).filter((key) => !ALLOWED_QUERY_KEYS.has(key));
  if (rejected.length > 0) {
    return refusal(
      `parámetros de consulta no admitidos (${rejected.join(", ")})`,
    );
  }
  return renderFiscalizacionPage(params);
}
