import type { ReactNode } from "react";
import { GranularityBadge } from "@/components/GranularityBadge";
import { UnmappedListIds } from "@/components/UnmappedListIds";
import { UnorderableLevels } from "@/components/UnorderableLevels";
import { ProvenanceLink } from "@/components/ProvenanceLink";
import { TableScroll } from "@/components/TableScroll";
import { compareResults } from "@/lib/results/compare";
import type { CompareInput, UnitResult } from "@/lib/results/compare";
import type { Granularity } from "@/lib/results/types";
import {
  createResultsRepository,
  describeExcluded,
  fetchSourceRefs,
  isPartyResolved,
  unmappedByListId,
  tallyByKind,
} from "@/lib/fiscalizacion/repository";
import type { SourceRef } from "@/lib/results/types";
import type {
  ExcludedByKind,
  OkResultsQueryResponse,
  ResultRow,
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
import { servedJurisdictionId } from "@/lib/results/party-family";
import {
  createResultsExplorationRepository,
  type ExplorationFacets,
} from "@/lib/results/exploration";

interface ComparePageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

interface DisplayNameConflict {
  canonicalPartyId: string;
  names: string[];
}

const CATEGORY_CONFLICT_KIND = {
  ID_NAMES: "id_names",
  NAME_IDS: "name_ids",
} as const;

type CategoryConflictKind =
  (typeof CATEGORY_CONFLICT_KIND)[keyof typeof CATEGORY_CONFLICT_KIND];

interface CategoryIdentityConflict {
  kind: CategoryConflictKind;
  identity: string;
  leftIds: string[];
  leftNames: string[];
  rightIds: string[];
  rightNames: string[];
}

interface CommonCategoryFacetsResult {
  categories: ExplorationFacets["categories"];
  conflicts: CategoryIdentityConflict[];
}

interface CompareSelectorProps {
  elections: ExplorationFacets["elections"];
  categories: ExplorationFacets["categories"];
  electionId2023?: string;
  electionId2025?: string;
  categoryId?: string;
  message?: string;
  messageIsAlert?: boolean;
}

function CompareSelector({
  elections,
  categories,
  electionId2023,
  electionId2025,
  categoryId,
  message,
  messageIsAlert = false,
}: CompareSelectorProps): ReactNode {
  const elections2023 = elections.filter((option) => option.year === 2023);
  const elections2025 = elections.filter((option) => option.year === 2025);
  const pairSelected = Boolean(electionId2023 && electionId2025);

  return (
    <main className="page-shell">
      <div className="shell-container">
        <header className="page-header">
          <p className="eyebrow">Resultados nacionales / comparación</p>
          <h1>Comparación entre 2023 y 2025</h1>
          <p className="page-header__lede">
            Seleccione dos elecciones nacionales y una categoría presente en
            ambas. La URL resultante se puede conservar y compartir.
          </p>
        </header>
        <section className="panel" aria-labelledby="compare-selector-heading">
          <div className="panel__heading">
            <h2 id="compare-selector-heading">
              Elegir elecciones para comparar
            </h2>
            <p>
              Las categorías se habilitan después de elegir una elección de cada
              año.
            </p>
          </div>
          <form action="/compare" method="get">
            <fieldset className="form-grid selector-form">
              <legend className="selector-form__legend">
                Selectores de comparación nacional
              </legend>
              <div className="field">
                <label htmlFor="compare-election-2023">Elección de 2023</label>
                <select
                  id="compare-election-2023"
                  name="election2023"
                  defaultValue={electionId2023 ?? ""}
                  required
                >
                  <option value="">Elegir una elección de 2023</option>
                  {elections2023.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="compare-election-2025">Elección de 2025</label>
                <select
                  id="compare-election-2025"
                  name="election2025"
                  defaultValue={electionId2025 ?? ""}
                  required
                >
                  <option value="">Elegir una elección de 2025</option>
                  {elections2025.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="compare-category">Categoría común</label>
                <select
                  id="compare-category"
                  name="categoryId"
                  defaultValue={categoryId ?? ""}
                  required
                  disabled={!pairSelected}
                  aria-describedby="compare-category-help"
                >
                  <option value="">Elegir una categoría común</option>
                  {categories.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.name}
                    </option>
                  ))}
                </select>
                <p id="compare-category-help">
                  Solo se ofrecen categorías publicadas en las dos elecciones.
                </p>
              </div>
            </fieldset>
            <div className="form-actions">
              <button className="button button--primary" type="submit">
                {pairSelected ? "Comparar elecciones" : "Actualizar opciones"}
              </button>
            </div>
          </form>
        </section>
        {message ? (
          <p role={messageIsAlert ? "alert" : "status"}>{message}</p>
        ) : null}
      </div>
    </main>
  );
}

const comparisonNumberFormatter = new Intl.NumberFormat("es-AR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function formatPercentage(value: number): string {
  return `${comparisonNumberFormatter.format(value)} %`;
}

function formatPercentagePointSwing(value: number): string {
  const normalized = Math.abs(value) < 0.005 ? 0 : value;
  const sign = normalized > 0 ? "+" : "";
  return `${sign}${comparisonNumberFormatter.format(normalized)} puntos porcentuales`;
}

interface CategoryIdentityMaps {
  namesById: Map<string, Set<string>>;
  idsByExactName: Map<string, Set<string>>;
}

function categoryIdentityMaps(
  categories: ExplorationFacets["categories"],
): CategoryIdentityMaps {
  const namesById = new Map<string, Set<string>>();
  const idsByExactName = new Map<string, Set<string>>();
  for (const category of categories) {
    const exactName = category.name.normalize("NFC");
    const names = namesById.get(category.id) ?? new Set<string>();
    names.add(exactName);
    namesById.set(category.id, names);
    const ids = idsByExactName.get(exactName) ?? new Set<string>();
    ids.add(category.id);
    idsByExactName.set(exactName, ids);
  }
  return { namesById, idsByExactName };
}

function sortedSet(values: Set<string> | undefined): string[] {
  return [...(values ?? [])].sort();
}

function commonCategoryFacets(
  left: ExplorationFacets["categories"],
  right: ExplorationFacets["categories"],
): CommonCategoryFacetsResult {
  const leftMaps = categoryIdentityMaps(left);
  const rightMaps = categoryIdentityMaps(right);
  const conflicts: CategoryIdentityConflict[] = [];
  const intersectingIds = [...leftMaps.namesById.keys()]
    .filter((categoryId) => rightMaps.namesById.has(categoryId))
    .sort();

  for (const categoryId of intersectingIds) {
    const leftNames = sortedSet(leftMaps.namesById.get(categoryId));
    const rightNames = sortedSet(rightMaps.namesById.get(categoryId));
    if (
      leftNames.length !== 1 ||
      rightNames.length !== 1 ||
      leftNames[0] !== rightNames[0]
    ) {
      conflicts.push({
        kind: CATEGORY_CONFLICT_KIND.ID_NAMES,
        identity: categoryId,
        leftIds: [categoryId],
        leftNames,
        rightIds: [categoryId],
        rightNames,
      });
    }
  }

  const intersectingNames = [...leftMaps.idsByExactName.keys()]
    .filter((name) => rightMaps.idsByExactName.has(name))
    .sort();
  for (const categoryName of intersectingNames) {
    const leftIds = sortedSet(leftMaps.idsByExactName.get(categoryName));
    const rightIds = sortedSet(rightMaps.idsByExactName.get(categoryName));
    if (
      leftIds.length !== 1 ||
      rightIds.length !== 1 ||
      leftIds[0] !== rightIds[0]
    ) {
      conflicts.push({
        kind: CATEGORY_CONFLICT_KIND.NAME_IDS,
        identity: categoryName,
        leftIds,
        leftNames: [categoryName],
        rightIds,
        rightNames: [categoryName],
      });
    }
  }

  conflicts.sort(
    (leftConflict, rightConflict) =>
      leftConflict.identity.localeCompare(rightConflict.identity) ||
      leftConflict.kind.localeCompare(rightConflict.kind),
  );
  const conflictingIds = new Set(
    conflicts.flatMap(({ leftIds, rightIds }) => [...leftIds, ...rightIds]),
  );
  const categories = intersectingIds.flatMap((categoryId) => {
    const names = sortedSet(leftMaps.namesById.get(categoryId));
    return conflictingIds.has(categoryId) || names.length !== 1
      ? []
      : [{ id: categoryId, name: names[0]! }];
  });
  return { categories, conflicts };
}

function describeCategoryNameConflicts(
  conflicts: CategoryIdentityConflict[],
  leftElectionLabel: string,
  rightElectionLabel: string,
): string {
  const details = conflicts
    .map((conflict) => {
      const reason =
        conflict.kind === CATEGORY_CONFLICT_KIND.ID_NAMES
          ? `la categoría ${conflict.identity} tiene nombres diferentes o ambiguos`
          : `el nombre de categoría ${conflict.identity} tiene IDs diferentes o ambiguos`;
      return `${reason} (${leftElectionLabel}: ${conflict.leftNames.join(", ")} [${conflict.leftIds.length === 1 ? "ID" : "IDs"} ${conflict.leftIds.join(", ")}]; ${rightElectionLabel}: ${conflict.rightNames.join(", ")} [${conflict.rightIds.length === 1 ? "ID" : "IDs"} ${conflict.rightIds.join(", ")}])`;
    })
    .join("; ");
  const refusal =
    conflicts.length === 1
      ? "Esa categoría no se ofrece ni se acepta"
      : "Esas categorías no se ofrecen ni se aceptan";
  return `Se detectaron conflictos de identidad: ${details}. ${refusal} para comparar.`;
}

class OfficialReadError extends Error {
  constructor(
    readonly excludedByYear: string[],
    readonly failures: string[],
  ) {
    const failedElectionIds = failures.map(
      (failure) => failure.split(":", 1)[0],
    );
    super(
      `No se pudo leer ${failedElectionIds.join(", ")}. Fallos: ${failures.join("; ")}`,
    );
    this.name = "OfficialReadError";
  }
}

function settleOfficialReads(
  reads: [
    PromiseSettledResult<OkResultsQueryResponse>,
    PromiseSettledResult<OkResultsQueryResponse>,
  ],
  electionIds: [string, string],
): [OkResultsQueryResponse, OkResultsQueryResponse] {
  const excludedByYear: string[] = [];
  const failures: string[] = [];

  for (const [index, read] of reads.entries()) {
    const electionId = electionIds[index]!;
    if (read.status === "rejected") {
      const reason =
        read.reason instanceof Error
          ? read.reason.message
          : String(read.reason);
      failures.push(`${electionId}: ${reason}`);
      continue;
    }
    const summary = describeExcluded(read.value.excluded);
    if (summary) excludedByYear.push(`${electionId}: ${summary}`);
  }

  if (failures.length > 0)
    throw new OfficialReadError(excludedByYear, failures);
  const [read2023, read2025] = reads;
  if (read2023.status !== "fulfilled" || read2025.status !== "fulfilled") {
    throw new Error("settleOfficialReads: fulfilled reads were not available");
  }
  return [read2023.value, read2025.value];
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
  displayNames: Map<string, string>;
  displayNameConflicts: DisplayNameConflict[];
} {
  const votesByUnitAndParty = new Map<string, Map<string, number>>();
  const mesaPopulationByUnit = new Map<
    string,
    { knownTypes: Set<string>; taggedRows: number; untaggedRows: number }
  >();
  const levels = readGranularity(rows);
  let unresolvedRows = 0;
  let unresolvedVotes = 0;
  // THE fold, not a fourth private copy. The inline one sorted by list id
  // while the boundary sorts by votes, so the same question had two answers.
  const unresolvedReading = unmappedByListId(rows);
  const unresolvedByListId = unresolvedReading.entries;
  const displayNamesByParty = new Map<string, Set<string>>();

  for (const row of rows) {
    const population = mesaPopulationByUnit.get(row.jurisdictionId) ?? {
      knownTypes: new Set<string>(),
      taggedRows: 0,
      untaggedRows: 0,
    };
    if (typeof row.mesaTipo === "string" && row.mesaTipo.length > 0) {
      population.knownTypes.add(row.mesaTipo);
      population.taggedRows += 1;
    } else {
      population.untaggedRows += 1;
    }
    mesaPopulationByUnit.set(row.jurisdictionId, population);

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
    const displayName = row.partyName.trim();
    const names = displayNamesByParty.get(party) ?? new Set<string>();
    if (displayName.length > 0) names.add(displayName);
    displayNamesByParty.set(party, names);
    // `BaseQuery` filters `.eq("jurisdiction_id", ...)`, so EVERY row carries
    // the same id and they all sum into exactly ONE unit. The figure is
    // therefore a jurisdiction total whatever level its rows carry — and the
    // badge used to assert `mesa` over it. The aggregation is real and it is
    // now disclosed below rather than described only in this comment.
    const parties =
      votesByUnitAndParty.get(row.jurisdictionId) ?? new Map<string, number>();
    parties.set(party, (parties.get(party) ?? 0) + row.votes);
    votesByUnitAndParty.set(row.jurisdictionId, parties);
  }

  const units: UnitResult[] = [...votesByUnitAndParty.entries()].map(
    ([unitId, parties]) => {
      const population = mesaPopulationByUnit.get(unitId)!;
      return {
        unitId,
        parties: [...parties.entries()].map(([party, votes]) => ({
          party,
          votes,
        })),
        mesaPopulation: {
          knownTypes: [...population.knownTypes].sort(),
          taggedRows: population.taggedRows,
          untaggedRows: population.untaggedRows,
        },
      };
    },
  );
  const namesByCanonicalId = [...displayNamesByParty.entries()]
    .map(([canonicalPartyId, names]) => ({
      canonicalPartyId,
      names: [...names].sort(),
    }))
    .sort((left, right) =>
      left.canonicalPartyId.localeCompare(right.canonicalPartyId),
    );
  const displayNames = new Map(
    namesByCanonicalId.map(({ canonicalPartyId, names }) => [
      canonicalPartyId,
      names[0] ?? "",
    ]),
  );
  const displayNameConflicts = namesByCanonicalId.filter(
    ({ names }) => names.length > 1,
  );

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
    displayNameConflicts,
  };
}

/**
 * `results-analysis` cross-year comparison view (RSC, server-only reads —
 * design.md's Data Flow: "Next.js RSC (server-only reads)").
 */

export default async function ComparePage({
  searchParams,
}: ComparePageProps): Promise<ReactNode> {
  const params = await searchParams;

  // Refused BEFORE anything is read: `stringParam` yields `undefined` for a
  // repeated param, so without this a supplied value looks absent.
  const repeated = repeatedParams(params);
  if (repeated.length > 0) {
    return (
      <main>
        <h1>Comparación entre 2023 y 2025</h1>
        <p role="alert">
          Se rechazó la solicitud: estos parámetros de consulta se
          proporcionaron más de una vez y no se pueden resolver a un único
          valor: {repeated.join(", ")}.
        </p>
      </main>
    );
  }
  const electionId2023 = stringParam(params, "election2023");
  const electionId2025 = stringParam(params, "election2025");
  const categoryId = stringParam(params, "categoryId");
  const legacyJurisdictionId = stringParam(params, "jurisdictionId");
  const legacyPartyCategory = stringParam(params, "partyCategory");
  const legacyPartyJurisdiction = stringParam(params, "partyJurisdiction");
  const rawAggregateTo = stringParam(params, "aggregateTo");
  // Parse the legacy parameter instead of silently ignoring it, but never pass
  // it into the domain comparison: this page does not load the descendant
  // hierarchy required to perform a real aggregation.
  const aggregateTo = GRANULARITY_ORDER.find(
    (level) => level === rawAggregateTo,
  );

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

  if (aggregateTo) {
    return (
      <main>
        <h1>Comparación entre 2023 y 2025</h1>
        <p role="alert">
          Se rechazó la solicitud: <code>aggregateTo</code> no está disponible
          actualmente porque esta página no carga la jerarquía completa de
          descendientes necesaria para agrupar y recalcular las cifras. No se
          muestran resultados.
        </p>
      </main>
    );
  }

  const served = servedJurisdictionId("national");
  if (served.status !== "ok") {
    return (
      <main className="page-shell">
        <div className="shell-container">
          <h1>Comparación entre 2023 y 2025</h1>
          <p role="alert">
            La comparación nacional no está disponible. Solicite configurar la
            jurisdicción física de Coronel Rosales antes de continuar.
          </p>
        </div>
      </main>
    );
  }

  const facetSource = await (async () => {
    try {
      const repository = createResultsExplorationRepository(
        await createSupabaseServerClient(),
      );
      return { repository, facets: await repository.facets({}) };
    } catch {
      return null;
    }
  })();
  if (!facetSource) {
    return (
      <main className="page-shell">
        <div className="shell-container">
          <h1>Comparación entre 2023 y 2025</h1>
          <p role="alert">
            No se pudieron cargar las elecciones disponibles. Intente nuevamente
            o consulte el estado de las fuentes oficiales.
          </p>
        </div>
      </main>
    );
  }

  const selectedElection2023 = facetSource.facets.elections.find(
    (option) => option.id === electionId2023 && option.year === 2023,
  );
  const selectedElection2025 = facetSource.facets.elections.find(
    (option) => option.id === electionId2025 && option.year === 2025,
  );
  const selectorProps = {
    elections: facetSource.facets.elections,
    ...(electionId2023 ? { electionId2023 } : {}),
    ...(electionId2025 ? { electionId2025 } : {}),
    ...(categoryId ? { categoryId } : {}),
  };

  if (
    (electionId2023 && !selectedElection2023) ||
    (electionId2025 && !selectedElection2025)
  ) {
    return (
      <CompareSelector
        {...selectorProps}
        categories={[]}
        message="La selección no corresponde a una elección oficial disponible del año indicado. Elija otra opción."
        messageIsAlert
      />
    );
  }
  if (!selectedElection2023 || !selectedElection2025) {
    return (
      <CompareSelector
        {...selectorProps}
        categories={[]}
        message="Elija una elección de cada año y actualice las opciones para ver sus categorías comunes."
      />
    );
  }

  const categoryFacets = await (async () => {
    try {
      return await Promise.all([
        facetSource.repository.facets({ electionId: selectedElection2023.id }),
        facetSource.repository.facets({ electionId: selectedElection2025.id }),
      ]);
    } catch {
      return null;
    }
  })();
  if (!categoryFacets) {
    return (
      <CompareSelector
        {...selectorProps}
        categories={[]}
        message="No se pudieron cargar las categorías comunes. Intente nuevamente o elija otro par de elecciones."
        messageIsAlert
      />
    );
  }

  const commonCategoryResult = commonCategoryFacets(
    categoryFacets[0].categories,
    categoryFacets[1].categories,
  );
  const commonCategories = commonCategoryResult.categories;
  if (!categoryId) {
    const conflictMessage =
      commonCategoryResult.conflicts.length > 0
        ? describeCategoryNameConflicts(
            commonCategoryResult.conflicts,
            selectedElection2023.label,
            selectedElection2025.label,
          )
        : undefined;
    return (
      <CompareSelector
        {...selectorProps}
        categories={commonCategories}
        message={
          conflictMessage ??
          (commonCategories.length > 0
            ? "Elija una categoría publicada en ambas elecciones para generar la comparación."
            : "Estas elecciones no comparten una categoría publicada. Elija otro par.")
        }
        messageIsAlert={Boolean(conflictMessage)}
      />
    );
  }

  const selectedCategory = commonCategories.find(
    (option) => option.id === categoryId,
  );
      if (!selectedCategory) {
        const selectedConflict = commonCategoryResult.conflicts.find(
          ({ leftIds, rightIds }) =>
            leftIds.includes(categoryId) || rightIds.includes(categoryId),
        );
        return (
      <CompareSelector
        {...selectorProps}
        categories={commonCategories}
        message={
          selectedConflict
            ? describeCategoryNameConflicts(
                [selectedConflict],
                selectedElection2023.label,
                selectedElection2025.label,
              )
            : "La categoría seleccionada no está disponible en ambas elecciones. Elija una categoría común."
        }
        messageIsAlert
      />
    );
  }

  if (legacyJurisdictionId && legacyJurisdictionId !== served.jurisdictionId) {
    return (
      <CompareSelector
        {...selectorProps}
        categories={commonCategories}
        message="La jurisdicción incluida en el enlace no coincide con el contexto nacional configurado."
        messageIsAlert
      />
    );
  }
  if (legacyPartyCategory && legacyPartyCategory !== selectedCategory.name) {
    return (
      <CompareSelector
        {...selectorProps}
        categories={commonCategories}
        message={`La categoría ${categoryId} se llama ${selectedCategory.name}, no ${legacyPartyCategory}; no coincide con el contexto nacional configurado.`}
        messageIsAlert
      />
    );
  }
  if (legacyPartyJurisdiction && legacyPartyJurisdiction !== "national") {
    return (
      <CompareSelector
        {...selectorProps}
        categories={commonCategories}
        message="La familia de partidos incluida en el enlace no coincide con el contexto nacional configurado."
        messageIsAlert
      />
    );
  }

  const jurisdictionId = served.jurisdictionId;
  const partyCategory = selectedCategory.name;
  const partyJurisdiction = "national";
  const year2023 = selectedElection2023;
  const year2025 = selectedElection2025;

  const repository = await createResultsRepository();
  const baseQuery2023 = {
    electionId: selectedElection2023.id,
    jurisdictionId,
    categoryId,
  };
  const baseQuery2025 = {
    electionId: selectedElection2025.id,
    jurisdictionId,
    categoryId,
  };
  // Each year resolved through ITS OWN party mapping: the id changes between
  // files, the canonical name is what carries across.
  // A denied read THROWS. `SupabaseRowSource.fetchRows` raises on a Postgres
  // error, so RLS denial never arrives as a `status !== "ok"` response — the
  // branch below is defensive, and this is the path an actual denial takes.
  let response2023: OkResultsQueryResponse;
  let response2025: OkResultsQueryResponse;
  try {
    [response2023, response2025] = settleOfficialReads(
      await Promise.allSettled([
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
      ]),
      [selectedElection2023.id, selectedElection2025.id],
    );
  } catch (error) {
    return (
      <main>
        <h1>Comparación entre 2023 y 2025</h1>
        <p role="alert">
          Se rechazó la solicitud:{" "}
          {error instanceof Error ? error.message : String(error)}
        </p>
        {error instanceof OfficialReadError &&
        error.excludedByYear.length > 0 ? (
          <p role="note">
            Filas excluidas por el filtro de fuente oficial y ausentes de todas
            las cifras de esta página: {error.excludedByYear.join("; ")}.
          </p>
        ) : null}
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

  const rawRows2023 = response2023.rows;
  const rawRows2025 = response2025.rows;
  const rows2023 = rawRows2023.filter((row) => row.sourceKind === "official");
  const rows2025 = rawRows2025.filter((row) => row.sourceKind === "official");

  // PATH 3 on this page too: rule 5 wants a rendered-page guard, and taking
  // the query's word for it made the repository filter the only live one.
  const foreign2023 = rawRows2023.filter(
    (row) => row.sourceKind !== "official",
  );
  const foreign2025 = rawRows2025.filter(
    (row) => row.sourceKind !== "official",
  );
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
  const unmappedListIdDisclosure = (
    <>
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
    </>
  );

  if (foreign.length > 0) {
    return (
      <main>
        <h1>Comparación entre 2023 y 2025</h1>
        {excludedNote}
        <p role="alert">
          Se rechazó la solicitud: {foreign.length} fila(s) que llegaron a esta
          página no son oficiales ({electionId2023}:{" "}
          {describeExcluded(tallyByKind(foreign2023)) ?? "ninguna"};{" "}
          {electionId2025}:{" "}
          {describeExcluded(tallyByKind(foreign2025)) ?? "ninguna"}). Las cifras
          oficiales y de fiscalización nunca se combinan en un mismo número.
        </p>
        {unmappedListIdDisclosure}
        {/* PER YEAR, like the unmapped blocks beside them. Merging added rows
            across two independent reads under one line with nothing naming the
            year — and summed VOTES on a level this module cannot order, which
            is the addition both components exist to withhold. */}
        <UnorderableLevels
          label={electionId2023}
          entries={unrecognizedLevels(rows2023)}
        />
        <UnorderableLevels
          label={electionId2025}
          entries={unrecognizedLevels(rows2025)}
        />
      </main>
    );
  }

  const displayNameConflicts = [
    ...compare2023.displayNameConflicts.map((conflict) => ({
      ...conflict,
      year: year2023.year,
    })),
    ...compare2025.displayNameConflicts.map((conflict) => ({
      ...conflict,
      year: year2025.year,
    })),
  ].sort(
    (left, right) =>
      left.year - right.year ||
      left.canonicalPartyId.localeCompare(right.canonicalPartyId),
  );
  if (displayNameConflicts.length > 0) {
    return (
      <main>
        <h1>Comparación entre 2023 y 2025</h1>
        {excludedNote}
        {unmappedListIdDisclosure}
        <p role="alert">
          Se rechazó la comparación: un mismo partido canónico tiene nombres de
          visualización en conflicto dentro del mismo año:{" "}
          {displayNameConflicts
            .map(
              ({ year, canonicalPartyId, names }) =>
                `${year}, ID canónico ${canonicalPartyId}: ${names.join(", ")}`,
            )
            .join("; ")}
          . No se muestran cifras de granularidad, variación ni cambios.
        </p>
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
        {unmappedListIdDisclosure}
        <p role="alert">
          Se rechazó la solicitud: las filas devueltas mezclan niveles de
          granularidad ({[...new Set(mixed)].join(", ")}), por lo que un solo
          nivel no puede describir ninguno de los lados y el control entre años
          no puede detectar la diferencia.
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
        <UnorderableLevels
          label={electionId2023}
          entries={unrecognizedLevels(rows2023)}
        />
        <UnorderableLevels
          label={electionId2025}
          entries={unrecognizedLevels(rows2025)}
        />
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
        {unmappedListIdDisclosure}
        <p role="alert">
          Se rechazó la solicitud:{" "}
          {rows2023.length === 0 && rows2025.length === 0
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

  const yearsWithoutComparableIdentities = [
    ...(compare2023.units.length === 0 ? [selectedElection2023.id] : []),
    ...(compare2025.units.length === 0 ? [selectedElection2025.id] : []),
  ];
  if (yearsWithoutComparableIdentities.length > 0) {
    return (
      <main>
        <h1>Comparación entre 2023 y 2025</h1>
        {excludedNote}
        <p role="alert">
          Se rechazó la solicitud: hay filas oficiales pero sin identidades
          partidarias comparables en{" "}
          {yearsWithoutComparableIdentities.join(", ")}. Estas filas no se
          resolvieron a un partido canónico. Sin un partido canónico resuelto en
          cada año no se puede calcular una comparación.
        </p>
        {unmappedListIdDisclosure}
      </main>
    );
  }

  // PER YEAR, and rows counted before dedup. Summing two already-deduped id
  // lists gave neither a row count nor an id count: an id unmapped in both
  // years counted twice, and 6.000 dropped rows reported as "1".
  const unresolvedRows =
    compare2023.unresolvedRows + compare2025.unresolvedRows;
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
        {unmappedListIdDisclosure}
        {/* Levels this module cannot order are independent of mappability, so
            this refusal is about a different axis than that count. */}
        {/* PER YEAR, like the unmapped blocks beside them. Merging added rows
            across two independent reads under one line with nothing naming the
            year — and summed VOTES on a level this module cannot order, which
            is the addition both components exist to withhold. */}
        <UnorderableLevels
          label={electionId2023}
          entries={unrecognizedLevels(rows2023)}
        />
        <UnorderableLevels
          label={electionId2025}
          entries={unrecognizedLevels(rows2025)}
        />
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
  const degradedFromDetail = coarsestOf(
    level2023.degradedFrom,
    level2025.degradedFrom,
  );

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
  };
  const result = compareResults(compareInput);

  if (result.status === "invalid_comparison_input") {
    return (
      <main>
        <h1>Comparación entre 2023 y 2025</h1>
        {excludedNote}
        {unmappedListIdDisclosure}
        <p role="alert">
          Se rechazó la comparación por datos de comparación inválidos (
          {result.issues.length} problema(s)). No se muestran cifras.
        </p>
      </main>
    );
  }

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
          {result.granularity2023} y los de 2025 a nivel{" "}
          {result.granularity2025}. Esta comparación no hace suposiciones ni
          muestra cifras con niveles incompatibles (design.md D6).
        </p>
        {unmappedListIdDisclosure}
      </main>
    );
  }

  if (result.status === "mesa_population_partial_coverage") {
    return (
      <main>
        <h1>Comparación entre 2023 y 2025</h1>
        {excludedNote}
        {unmappedListIdDisclosure}
        <p role="alert">
          Se rechazó la comparación por cobertura parcial de mesa_tipo. Una
          mezcla de filas etiquetadas y sin etiqueta no describe una población
          completa.
        </p>
        <ul>
          {result.coverages.map((coverage) => (
            <li key={coverage.year}>
              {coverage.year}: tipos conocidos{" "}
              {coverage.knownTypes.join(", ") || "ninguno"};{" "}
              {coverage.taggedRows}{" "}
              {coverage.taggedRows === 1
                ? "fila etiquetada"
                : "filas etiquetadas"}
              ; {coverage.untaggedRows}{" "}
              {coverage.untaggedRows === 1
                ? "fila sin etiqueta"
                : "filas sin etiqueta"}
            </li>
          ))}
        </ul>
      </main>
    );
  }

  if (result.status === "ambiguous_leader") {
    return (
      <main>
        <h1>Comparación entre 2023 y 2025</h1>
        {excludedNote}
        {unmappedListIdDisclosure}
        <p role="alert">
          Se rechazó la comparación: no hay un líder único en{" "}
          {result.ambiguities
            .map(({ unitId, year, parties }) => {
              const partyName = year === "2023" ? fromName : toName;
              return `${unitId}, ${year}: ${parties.map(partyName).sort().join(", ")}`;
            })
            .join("; ")}
          . No se muestran cifras de granularidad, variación ni cambios.
        </p>
      </main>
    );
  }

  const archiveEntryIds = [
    ...new Set([...rows2023, ...rows2025].map((row) => row.archiveEntryId)),
  ];
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
        {unmappedListIdDisclosure}
        <p role="alert">
          Se rechazó la solicitud:{" "}
          {error instanceof Error ? error.message : String(error)}
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
      {result.mesaPopulationMismatch ? (
        <p role="alert">
          La población de mesas no coincide entre años: 2023:{" "}
          {result.mesaPopulationMismatch.types2023.join(", ")}; 2025:{" "}
          {result.mesaPopulationMismatch.types2025.join(", ")}. Interprete las
          variaciones considerando esta diferencia de cobertura.
        </p>
      ) : null}
      {unmappedListIdDisclosure}
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
      {/* ONE row, because the query returns one jurisdiction. Rendering it as a
          list of units suggested a breadth the figures do not have. */}
      <ul>
        {result.swings.map((swing) => (
          <li key={swing.unitId}>
            <p>
              {swing.unitId} (jurisdicción completa):{" "}
              {swing.flipped
                ? `cambió de ${fromName(swing.fromParty)} → ${toName(swing.toParty)}`
                : "sin cambio"}
            </p>
            <TableScroll
              label={`Participación y variación por partido en ${swing.unitId}`}
            >
              <table className="data-table">
                <caption>
                  Participación electoral y variación en puntos porcentuales
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Partido en 2023</th>
                    <th scope="col">Participación 2023</th>
                    <th scope="col">Partido en 2025</th>
                    <th scope="col">Participación 2025</th>
                    <th scope="col">Variación</th>
                  </tr>
                </thead>
                <tbody>
                  {[...swing.swings]
                    .sort((left, right) =>
                      left.party.localeCompare(right.party),
                    )
                    .map((partySwing) => {
                      const share2023 =
                        swing.shares2023.find(
                          (share) => share.party === partySwing.party,
                        )?.sharePercent ?? 0;
                      const share2025 =
                        swing.shares2025.find(
                          (share) => share.party === partySwing.party,
                        )?.sharePercent ?? 0;
                      return (
                        <tr key={partySwing.party}>
                          <th scope="row">{fromName(partySwing.party)}</th>
                          <td className="table-cell--number">
                            {formatPercentage(share2023)}
                          </td>
                          <td>{toName(partySwing.party)}</td>
                          <td className="table-cell--number">
                            {formatPercentage(share2025)}
                          </td>
                          <td className="table-cell--number">
                            {formatPercentagePointSwing(
                              partySwing.swingPercentPoints,
                            )}
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </TableScroll>
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
