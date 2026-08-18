import type { ReactNode } from "react";
import { GranularityBadge } from "@/components/GranularityBadge";
import { TableScroll } from "@/components/TableScroll";
import { ScopeSelectorForm } from "@/components/ScopeSelectorForm";
import {
  SCOPE_FORM_KIND,
  scopeControlStates,
} from "@/components/scope-selector-behavior";
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
import { PARTY_FAMILY, partyFamilyRefusal, resolvePartyFamily } from "@/lib/results/party-family";
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
        <section className="panel" aria-labelledby="explorer-form-heading">
          <div className="panel__heading">
            <h2 id="explorer-form-heading">Elegir el alcance de los resultados</h2>
            <p>Use los selectores para crear un enlace directo reutilizable a resultados oficiales.</p>
          </div>
          <ScopeSelectorForm action="/drilldown" kind={SCOPE_FORM_KIND.DRILLDOWN}>
            <fieldset className="form-grid selector-form">
              <legend className="selector-form__legend">Selectores de resultados</legend>
              <div className="field">
                <label htmlFor="explorer-election">Elección</label>
                <select
                  id="explorer-election"
                  name="electionId"
                  defaultValue={selected.electionId ?? ""}
                  required={controlStates.electionId.required}
                  disabled={controlStates.electionId.disabled}
                >
                  <option value="">Elegir una elección</option>
                  {facets.elections.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor="explorer-category">Categoría</label>
                <select
                  id="explorer-category"
                  name="categoryId"
                  defaultValue={selected.categoryId ?? ""}
                  required={controlStates.categoryId.required}
                  disabled={controlStates.categoryId.disabled}
                >
                  <option value="">Elegir una categoría</option>
                  {facets.categories.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor="explorer-distrito">Distrito</label>
                <select
                  id="explorer-distrito"
                  name="distritoCode"
                  defaultValue={selected.distritoCode ?? ""}
                  required={controlStates.distritoCode.required}
                  disabled={controlStates.distritoCode.disabled}
                >
                  <option value="">Elegir un distrito</option>
                  {facets.distritos.map((option) => <option key={option.code} value={option.code}>{formatFacetOptionLabel(option)}</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor="explorer-seccion">Sección</label>
                <select
                  id="explorer-seccion"
                  name="seccionCode"
                  defaultValue={selected.seccionCode ?? ""}
                  required={controlStates.seccionCode.required}
                  disabled={controlStates.seccionCode.disabled}
                >
                  <option value="">Elegir una sección</option>
                  {facets.secciones.map((option) => <option key={option.code} value={option.code}>{formatFacetOptionLabel(option)}</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor="explorer-circuito">Circuito</label>
                <select
                  id="explorer-circuito"
                  name="circuitoCode"
                  defaultValue={selected.circuitoCode ?? ""}
                  required={controlStates.circuitoCode.required}
                  disabled={controlStates.circuitoCode.disabled}
                >
                  <option value="">Cualquier circuito</option>
                  {facets.circuitos.map((option) => <option key={option.code} value={option.code}>{formatFacetOptionLabel(option)}</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor="explorer-establecimiento">Establecimiento</label>
                <select
                  id="explorer-establecimiento"
                  name="establecimientoCode"
                  defaultValue={selected.establecimientoCode ?? ""}
                  required={controlStates.establecimientoCode.required}
                  disabled={controlStates.establecimientoCode.disabled}
                >
                  <option value="">Cualquier establecimiento</option>
                  {facets.establecimientos.map((option) => <option key={option.code} value={option.code}>{formatFacetOptionLabel(option)}</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor="explorer-mesa">Mesa</label>
                <select
                  id="explorer-mesa"
                  name="mesaCode"
                  defaultValue={selected.mesaCode?.toString() ?? ""}
                  required={controlStates.mesaCode.required}
                  disabled={controlStates.mesaCode.disabled}
                >
                  <option value="">Cualquier mesa</option>
                  {facets.mesas.map((option) => <option key={option.code} value={option.code}>{option.code}</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor="explorer-level">Nivel del informe</label>
                <select
                  id="explorer-level"
                  name="level"
                  defaultValue={selected.level ?? ""}
                  required={controlStates.level.required}
                  disabled={controlStates.level.disabled}
                >
                  <option value="">Elegir un nivel</option>
                  {facets.availableLevels.map((level) => <option key={level} value={level}>{level}</option>)}
                </select>
              </div>
            </fieldset>
            <div className="form-actions">
              <button className="button button--secondary" type="submit" formNoValidate>
                Actualizar opciones
              </button>
              <button className="button button--primary" type="submit">Aplicar selección</button>
            </div>
          </ScopeSelectorForm>
        </section>
      );
    }

function formatShare(share: string | null): string {
  return share === null ? "porcentaje no disponible" : `${(Number(share) * 100).toFixed(2)}%`;
}

function formatCounts(counts: Record<string, number>): string {
  return Object.entries(counts).map(([reason, count]) => `${reason}: ${count}`).join(", ");
}

function displaySourceKind(kind: string): string {
  if (kind === "official") return "oficial";
  if (kind === "fiscalizacion") return "fiscalización";
  if (kind === "unknown") return "desconocida";
  return kind;
}

function sourceExclusionNotes(exclusions: ExplorationSourceAudit[], aggregate: string): ReactNode {
  return exclusions.map((exclusion) => <p role="note" key={`${aggregate}-${exclusion.kind}`}>
    Se excluyeron {exclusion.rows} {exclusion.rows === 1 ? "fila" : "filas"} de fuente {displaySourceKind(exclusion.kind)} / {exclusion.votes} {exclusion.votes === 1 ? "voto" : "votos"} del agregado {displaySourceKind(aggregate)}.
  </p>);
}

function schoolExclusionNotes(
  exclusions: SchoolBreakdownExclusion[], sourceExclusions: ExplorationSourceAudit[],
): ReactNode {
return <>{sourceExclusionNotes(sourceExclusions, "establecimiento")}{exclusions.map((exclusion) =>
    <p role="note" key={exclusion.reason}>Se excluyeron {exclusion.rows} fila(s) / {exclusion.votes} voto(s): {exclusion.reason}.</p>)}</>;
}

async function renderOfficialExplorer(
  params: Record<string, string | string[] | undefined>,
): Promise<ReactNode> {
  const rawLevel = stringParam(params, "level");
  const level = Object.values(EXPLORATION_LEVEL).find((candidate) => candidate === rawLevel);
  if (rawLevel && !level) {
    return <main><h1>Explorar resultados oficiales</h1><p role="alert">Se rechazó la solicitud: nivel de informe no compatible {rawLevel}.</p></main>;
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
    return <main><h1>Explorar resultados oficiales</h1><p role="alert">Se rechazó la solicitud: {normalized.reason}. {formatCounts(normalized.counts)}.</p></main>;
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
    return <main><h1>Explorar resultados oficiales</h1><p role="alert">Se rechazó la solicitud: {error instanceof Error ? error.message : String(error)}</p></main>;
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
        return (
          <main className="page-shell">
            <div className="shell-container">
              <header className="page-header">
                <p className="eyebrow">Resultados oficiales / detalle</p>
                <h1>Explorar resultados oficiales</h1>
                <p className="page-header__lede">
                  Seleccione un alcance publicado y conserve la URL resultante como enlace directo reutilizable.
                </p>
              </header>
              {form}
              <p role="status">Elija los selectores disponibles y aplique la selección. La URL resultante es un enlace directo reutilizable.</p>
            </div>
          </main>
        );
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
    return <main><h1>Explorar resultados oficiales</h1>{form}<p role="alert">Se rechazó la solicitud: {error instanceof Error ? error.message : String(error)}</p></main>;
  }
  if (result.status !== "ok") {
    return <main><h1>Explorar resultados oficiales</h1>{form}<p role="alert">Se rechazó la solicitud: {result.reason}. {formatCounts(result.counts)}.</p>
      {sourceExclusionNotes(result.sourceExclusions ?? [], "official")}</main>;
  }
  if (!hasOnlyOfficialSourceAudit(result.sourceAudit)) {
    return <main><h1>Explorar resultados oficiales</h1>{form}<p role="alert">Se rechazó la solicitud: la auditoría de fuentes del agregado incluye filas no oficiales.</p>
      {sourceExclusionNotes(result.sourceExclusions, "official")}</main>;
  }

  let schoolBreakdown: SchoolBreakdownResult | null = null;
  if (level === EXPLORATION_LEVEL.SECCION) {
    if (!seccionCode) {
      return <main><h1>Explorar resultados oficiales</h1>{form}<p role="alert">Se rechazó la solicitud: el desglose por establecimiento requiere seleccionar una sección completa.</p></main>;
    }
    try {
      schoolBreakdown = await repository.schools({
        electionId, categoryId, distritoCode,
        seccionCode, requestedLevel: level,
      });
      } catch (error) {
return <main><h1>Explorar resultados oficiales</h1>{form}<p role="alert">Se rechazó la solicitud: {error instanceof Error ? error.message : String(error)}</p>
          {sourceExclusionNotes(result.sourceExclusions, "oficial")}</main>;
      }
      if (schoolBreakdown.status === "ok" && !hasOnlyOfficialSourceAudit(schoolBreakdown.sourceAudit)) {

      return <main><h1>Explorar resultados oficiales</h1>{form}<p role="alert">Se rechazó la solicitud: la auditoría de fuentes del desglose por establecimiento incluye filas no oficiales.</p>
        {sourceExclusionNotes(result.sourceExclusions, "official")}
        {schoolExclusionNotes(schoolBreakdown.exclusions, schoolBreakdown.sourceExclusions)}</main>;
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
    return <main><h1>Explorar resultados oficiales</h1>{form}<p role="alert">Se rechazó la solicitud: {error instanceof Error ? error.message : String(error)}</p>
      {sourceExclusionNotes(result.sourceExclusions, "oficial")}
      {schoolBreakdown ? schoolExclusionNotes(
        schoolBreakdown.exclusions ?? [], schoolBreakdown.sourceExclusions ?? [],
      ) : null}</main>;
  }

      return (
            <main className="page-shell">
          <div className="shell-container">
            <header className="page-header">
              <p className="eyebrow">Resultados oficiales / detalle</p>
              <h1>Explorar resultados oficiales</h1>
              <p className="page-header__lede">
                Seleccione un alcance publicado y examine la evidencia de resultados oficiales sin perder el contexto de su fuente.
              </p>
            </header>
            {form}
            <h2>Desglose oficial</h2>
            <p role="status">
              {result.totalVotes} votos a nivel {result.level}, obtenidos de filas de fuente {result.sourceGranularity}
              {result.mesaCount === null ? ". La cantidad de mesas no está disponible con la granularidad publicada por la fuente." : ` en ${result.mesaCount} mesas.`}
            </p>
            <p>Tipo de elección: {result.electionYear} {result.electionRound}.</p>
            {sourceExclusionNotes(result.sourceExclusions, "official")}
            <TableScroll label="Votos oficiales y porcentaje por partido">
              <table className="data-table">
                <caption>Votos oficiales y porcentaje por partido</caption>
                <thead><tr><th scope="col">Identidad del partido</th><th scope="col">Votos</th><th scope="col">Porcentaje</th></tr></thead>
                <tbody>
                  {result.parties.map((party, index) => (
                    <tr key={party.canonicalPartyId ?? `${party.listId ?? "missing-list"}-${index}`}>
<th className="evidence-text" scope="row">{party.identityStatus === "canonical" ? party.displayName : `Lista sin mapear ${party.listId ?? "(ID de lista no disponible)"}`}</th>
                      <td>{party.votes} votos</td>
                      <td>{formatShare(party.voteShare)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
            {schoolBreakdown?.status === "ok" ? (
              <section aria-labelledby="school-breakdown-heading">
                <h2 id="school-breakdown-heading">Desglose oficial por establecimiento</h2>
                {schoolExclusionNotes(schoolBreakdown.exclusions, schoolBreakdown.sourceExclusions)}
                <TableScroll label="Votos oficiales por circuito y establecimiento">
                  <table className="data-table">
                    <caption>Votos oficiales por circuito y establecimiento</caption>
                    <thead><tr><th scope="col">Establecimiento</th><th scope="col">Mesas</th><th scope="col">Identidad del partido</th><th scope="col">Votos</th><th scope="col">Porcentaje</th></tr></thead>
                    <tbody>{schoolBreakdown.schools.flatMap((school) => school.parties.map((party, index) => (
                      <tr key={`${school.circuitoCode}-${school.code}-${party.canonicalPartyId ?? party.listId ?? index}`}>
                        <th className="evidence-text" scope="row">Circuito {school.circuitoCode} — {school.code}{school.name ? ` — ${school.name}` : ""}</th>
                        <td>{school.mesaCount} mesas</td>
                        <td className="evidence-text">{party.identityStatus === "canonical" ? party.displayName : `Lista sin mapear ${party.listId ?? "(ID de lista no disponible)"}`}</td>
                        <td>{party.votes} votos</td><td>{formatShare(party.voteShare)}</td>
                      </tr>
                    )))}</tbody>
                  </table>
                </TableScroll>
              </section>
            ) : schoolBreakdown ? (
<section aria-labelledby="school-breakdown-heading"><h2 id="school-breakdown-heading">Desglose oficial por establecimiento</h2>
                <p role="alert">Se rechazó la solicitud: {schoolBreakdown.reason}. {formatCounts(schoolBreakdown.counts)}.</p>
                {schoolExclusionNotes(schoolBreakdown.exclusions ?? [], schoolBreakdown.sourceExclusions ?? [])}</section>
            ) : null}
            {missing.length > 0 ? <p role="alert">{missing.length} entrada(s) de archivo no se resolvieron a un registro de fuente ({missing.join(", ")}); estas cifras no se pueden rastrear.</p> : null}
            <div className="evidence-container">
              <ProvenanceLink sources={sources} />
            </div>
          </div>
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
        <h1>Detalle de resultados</h1>
        <p role="alert">
          Se rechazó la solicitud: estos parámetros de consulta se proporcionaron
          más de una vez y no se pueden resolver a un único valor: {repeated.join(", ")}.
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
        <h1>Detalle de resultados</h1>
        <p>
          Proporcione los parámetros de consulta <code>electionId</code>,{" "}
          <code>jurisdictionId</code> y <code>categoryId</code>.
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
        <h1>Detalle de resultados</h1>
        <p role="alert">
          Se rechazó la solicitud: proporcione <code>partyCategory</code> y{" "}
          <code>partyJurisdiction</code>. Los ID de lista solo tienen sentido mediante
          el mapeo de partidos de su propia elección.
        </p>
      </main>
    );
  }

  // The legacy input is checked against this route's trusted national context;
  // it cannot select the municipal mapping for the same physical jurisdiction.
  const family = resolvePartyFamily(jurisdictionId, PARTY_FAMILY.NATIONAL);
  if (family.status !== "ok" || partyJurisdiction !== family.family) {
    return (
      <main>
        <h1>Detalle de resultados</h1>
        <p role="alert">
          Se rechazó la solicitud: {partyFamilyRefusal(family, partyJurisdiction)}.
          Un ID de lista resuelto mediante la familia incorrecta nombra al partido
          equivocado.
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
        <h1>Detalle de resultados</h1>
        <p role="alert">
          Se rechazó la solicitud: {error instanceof Error ? error.message : String(error)}
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
        <h1>Detalle de resultados</h1>
        <p role="alert">
          Se rechazó la solicitud: {error instanceof Error ? error.message : String(error)}
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
        <h1>Detalle de resultados</h1>
        <p role="alert">
          Se rechazó la solicitud: la categoría {categoryId}{" "}
          {categoryName.status === "no_row"
            ? "no aparece en ninguna fila de categoría"
            : categoryName.status === "unreadable_name"
              ? "aparece en una fila cuyo nombre no es válido"
              : `se llama ${categoryName.name}`}
          , no {partyCategory}. Resolver un ID de lista mediante el mapeo de otra
          categoría nombra al partido equivocado.
        </p>
      </main>
    );
  }
  if (year.status !== "ok") {
    // No row, no year — and a mapping year nobody established is exactly what
    // resolves `110` and `20135` as two parties.
    return (
      <main>
        <h1>Detalle de resultados</h1>
        <p role="alert">
          Se rechazó la solicitud:{" "}
          {year.status === "no_row"
            ? `ninguna fila de elección tiene el ID ${electionId}`
            : `la fila de elección de ${electionId} no contiene un año válido`}
          , por lo que se desconoce el año del mapeo de partidos que corresponde usar.
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
      { year: year.year, jurisdiction: PARTY_FAMILY.NATIONAL, category: partyCategory },
    );
  } catch (error) {
    return (
      <main>
        <h1>Detalle de resultados</h1>
        <p role="alert">
          Se rechazó la solicitud: {error instanceof Error ? error.message : String(error)}
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
        {excludedSummary} se excluyeron por el filtro de fuente oficial y no
        forman parte de ninguna cifra de esta página.
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
      const foreignSourceReason = foreign.length > 0
        ? "las filas no son exclusivamente de fuente oficial; las cifras oficiales y de fiscalización nunca se combinan en un mismo número"
        : null;
      if (foreign.length > 0) {

    return (
      <main>
        <h1>Detalle de resultados</h1>
        <p role="alert">
          Se rechazó la solicitud: {describeExcluded(tallyByKind(foreign))} de{" "}
          {response.rows.length} filas no son oficiales. Las cifras oficiales y de
          fiscalización nunca se combinan en un mismo número.
        </p>
        {excludedNote}
        {/* Counted before this refusal, and about a different fact entirely:
            WHICH list ids failed to map does not depend on source kinds, on
            the aggregate, or on whether a later read succeeded. */}
        <UnmappedListIds entries={unmapped.entries}
        withoutListId={unmapped.withoutListId} totalRows={rows.length} unsummable={foreignSourceReason ?? unsummable}
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
        <h1>Detalle de resultados</h1>
        <p role="alert">
          Se rechazó la solicitud: {error instanceof Error ? error.message : String(error)}
        </p>
        {excludedSummary !== null ? (
          // The drop was already counted before this failure; hiding it behind
          // a refusal about something else is the silent drop with extra steps.
          <p role="note">
            {excludedSummary} se excluyeron por el filtro de fuente oficial.
          </p>
        ) : null}
        {aggregate && describeExcluded(aggregate.excluded) !== null ? (
          // Path 2's own tally, when path 2 got far enough to produce one. It
          // is a DIFFERENT read, so the note above cannot stand in for it.
          <p role="note">
            La lectura propia del total oficial excluyó{" "}
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
        <h1>Detalle de resultados</h1>
        <p role="alert">
          Se rechazó la solicitud: el total oficial se calculó con filas que no son
          oficiales ({aggregateForeign}). Las cifras oficiales y de fiscalización
          nunca se combinan en un mismo número.
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
            La lectura propia del total oficial excluyó{" "}
            {describeExcluded(aggregate.excluded)}.
          </p>
        ) : null}
        {missingProvenance.length > 0 ? (
          // Counted before this refusal, so hiding it behind a refusal about a
          // different fact is the silent drop with extra steps. The three
          // sibling pages carry theirs through their own refusals.
          <p role="alert">
            {missingProvenance.length} entrada(s) de archivo que respaldan estas
            cifras no se resolvieron a un registro de fuente (
            {missingProvenance.join(", ")}); esas cifras no se pueden rastrear.
          </p>
        ) : null}
      </main>
    );
  }

  return (
    <main>
      <h1>Detalle de resultados</h1>
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
          El total y las filas siguientes provienen de lecturas separadas y no
          coinciden: {aggregate.totalVotes} frente a{" "}
          {rows.reduce((sum, row) => sum + row.votes, 0)}. No considere ninguna
          cifra válida hasta explicar la diferencia.
        </p>
      ) : null}
      {missingProvenance.length > 0 ? (
        <p role="alert">
          {missingProvenance.length} entrada(s) de archivo que respaldan estas
          cifras no se resolvieron a un registro de fuente (
          {missingProvenance.join(", ")}); esas cifras no se pueden rastrear.
        </p>
      ) : null}
      {describeExcluded(aggregate.excluded) !== null ? (
        // Path 2 is an INDEPENDENT read, so its own drops are reported even
        // when path 1 returned nothing — path 1's note describes a different
        // read and cannot stand in for this one.
        <p role="note">
          La lectura propia del total oficial excluyó{" "}
          {describeExcluded(aggregate.excluded)}
          {unsummable !== null
            ? " — ese total no se muestra porque sus filas no se pueden sumar, pero la exclusión ocurrió y se informa en lugar de descartarse"
            : ""}
          .
        </p>
      ) : null}
      {rows.length === 0 || unsummable !== null || aggregate.unsummableReason !== null ? null : (
      <p role="note">
        Total oficial: {aggregate.totalVotes} votos (solo fuente {displaySourceKind(aggregate.sourceKind)})
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
          No hay total oficial: las filas leídas {aggregate.unsummableReason}. Un
          total que duplica el conteo es peor que no tener total.
        </p>
      ) : null}
      {excludedNote}
      <UnmappedListIds entries={unmapped.entries}
        withoutListId={unmapped.withoutListId} totalRows={rows.length} unsummable={unsummable}
          mappingConfigured={response.partyMappingConfigured}
        />
      {unsummable !== null ? (
        <p role="alert">
          No hay cifras por partido: {unsummable}. Aquí no se muestra ninguna
          cifra para las filas; un total que duplica el conteo es peor que no
          tener total.
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
            Esta lectura no devolvió filas. La lectura propia del total oficial
            sí devolvió filas, pero no se pueden sumar; no es posible informar
            una cifra ni una ausencia para esta jurisdicción, categoría y elección.
          </p>
        ) : aggregate.totalVotes > 0 ? (
          // NOT "no results". An independent read holds votes, so the honest
          // statement is that the two disagree — the case the alert above
          // exists for, and the one where suppressing it hid the most.
          <p role="alert">
            Esta lectura no devolvió filas, mientras que la lectura propia del
            total oficial contiene {aggregate.totalVotes} votos. No se puede
            confiar en ninguna cifra hasta explicar la diferencia.
          </p>
        ) : (
          <p>No se encontraron resultados oficiales para esta jurisdicción, categoría y elección.</p>
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
                  {entry.label}: {entry.votes} votos
                </li>
              ))}
            </ul>
          )}
          <div className="evidence-container">
        <ProvenanceLink sources={sources} />
          </div>
        </>
      )}
    </main>
  );
}
