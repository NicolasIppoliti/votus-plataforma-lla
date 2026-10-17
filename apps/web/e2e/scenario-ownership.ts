import { createHash } from "node:crypto";
import { createRequire } from "node:module";
const pasoInternasFixture = createRequire(import.meta.url)("./fixtures/paso-2023-rosales-presidente.json") as typeof import("./fixtures/paso-2023-rosales-presidente.json");

export const DATA_SCENARIO_SPECS = [
  "e2e/comparison.spec.ts",
  "e2e/fiscalizacion.spec.ts",
  "e2e/municipal.spec.ts",
  "e2e/provenance.spec.ts",
] as const;

export const SERVER_SCENARIOS = [
  "shared",
  "comparison",
  "fiscalizacion",
  "municipal",
  "provenance",
] as const;

export type ServerScenario = (typeof SERVER_SCENARIOS)[number];
export type DataScenarioSpec = (typeof DATA_SCENARIO_SPECS)[number];

export interface ComparisonPartyIdentity {
  canonicalPartyId: string;
  displayName: string;
  jurisdiction: string;
  listIds: string[];
  mappingIds: string[];
}

export interface ComparisonLeftOnlySectionIdentity {
  jurisdictionId: string;
  distritoCode: string;
  seccionCode: string;
  archiveEntryId: string;
}

export interface ResultScenarioIdentity {
  scenario: Exclude<ServerScenario, "shared">;
  comparisonParty?: ComparisonPartyIdentity;
  comparisonOtherParty?: ComparisonPartyIdentity;
  comparisonLeftOnlySection?: ComparisonLeftOnlySectionIdentity;
  categoryId: string;
  categoryName: string;
  jurisdictionId: string;
  jurisdictionIds: string[];
  distritoCode: string;
  seccionCode: string;
  electionIds: string[];
  electionYears: number[];
  electionRounds: string[];
  archiveEntryIds: string[];
}

export interface ScenarioServer {
  scenario: ServerScenario;
  port: number;
}

interface ResultNaturalKeyInput {
  archiveEntryId: string;
  electionId: string;
  jurisdictionId: string;
  categoryId: string;
  listId: string | null;
  sourceKind: string;
}

const SCENARIO_BY_SPEC: Record<
  DataScenarioSpec,
  ResultScenarioIdentity["scenario"]
> = {
  "e2e/comparison.spec.ts": "comparison",
  "e2e/fiscalizacion.spec.ts": "fiscalizacion",
  "e2e/municipal.spec.ts": "municipal",
  "e2e/provenance.spec.ts": "provenance",
};

export function assertUniqueScenarioKeys(keys: readonly string[]): void {
  const known = new Set(SERVER_SCENARIOS);
  const seen = new Set<string>();
  for (const key of keys) {
    if (!known.has(key as ServerScenario))
      throw new Error(`unknown scenario key: ${key}`);
    if (seen.has(key)) throw new Error(`duplicate scenario key: ${key}`);
    seen.add(key);
  }
}

assertUniqueScenarioKeys(Object.values(SCENARIO_BY_SPEC));

function deterministicUuid(name: string): string {
  const hex = createHash("sha256").update(`votus-e2e:${name}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export type ComparisonFixtureVariant = "spatial" | "paso" | "filters";
export const PASO_NAMED_LISTS = ["132-3008", "132-3007", "135-3016"];
export function pasoOwnedParty(listId: string) { return `e2e-provenance-paso-${listId.split("-")[0]}`; }
export function pasoOwnedMappingId(listId: string) { return deterministicUuid(`provenance-paso-mapping-${listId}`); }
export function pasoOwnedListId(listId: string) { return deterministicUuid(`provenance-paso-list-${listId}`); }

export function resultScenarioIdentity(spec: string, variant?: ComparisonFixtureVariant): ResultScenarioIdentity {
  const scenario = SCENARIO_BY_SPEC[spec as DataScenarioSpec];
  if (!scenario) throw new Error(`unknown data scenario: ${spec}`);
  if (variant !== undefined && !((variant === "spatial" || variant === "filters") && scenario === "comparison" || variant === "paso" && scenario === "provenance")) throw new Error("unsupported comparison fixture variant");
  const prefix = `e2e-${scenario}${variant ? `-${variant}` : ""}`;
  const electionIds =
    scenario === "comparison"
      ? [
          deterministicUuid(`${prefix}-election-2023`),
          deterministicUuid(`${prefix}-election-2025`),
        ]
      : [deterministicUuid(`${prefix}-election`)];
  const electionYears = scenario === "comparison" ? [2023, 2025] : variant === "paso" ? [2023] : [2025];
  const electionRounds = variant === "paso" ? ["paso"] : variant === "spatial" ? ["generales", "legislativas"] : scenario === "municipal" ? ["provinciales"] : electionYears.map((year) => `${prefix}-round-${year}`);
  const archiveEntryIds =
    scenario === "comparison"
      ? [`national/${prefix}-result-2023`, `national/${prefix}-result-2025`]
      : scenario === "fiscalizacion"
        ? [
            `${prefix}-result-official-covered`,
            `${prefix}-result-fiscalizacion`,
            `${prefix}-result-official-uncovered`,
          ]
        : scenario === "municipal"
          ? ["pba/2025-distrito-027", `${prefix}-result-official-unmapped`,
              `${prefix}-result-fiscalizacion`]
          : variant === "paso" ? [`national/${prefix}-result-official`, `national/${prefix}-result-unused`]
          : [`${prefix}-result-official`, `${prefix}-result-fiscalizacion`];
  const jurisdictionId = deterministicUuid(`${prefix}-jurisdiction`);
  const comparisonParty =
    scenario === "comparison" || scenario === "municipal"
      ? {
          canonicalPartyId: deterministicUuid(`${prefix}-canonical-party`),
          displayName: scenario === "municipal" ? "ALIANZA LA LIBERTAD AVANZA" : `${prefix}-canonical-party`,
          jurisdiction: scenario === "municipal" ? "coronel_rosales_municipal" : "national",
          listIds: scenario === "municipal" ? ["2206"] : electionYears.map((year) => `${prefix}-list-${year}`),
          mappingIds: electionYears.map((year) =>
            deterministicUuid(`${prefix}-party-mapping-${year}`),
          ),
        }
      : undefined;
  const comparisonOtherParty = variant === "spatial" ? {
    canonicalPartyId: deterministicUuid(`${prefix}-other-canonical-party`),
    displayName: `${prefix}-other-canonical-party`,
    jurisdiction: "national",
    listIds: electionYears.map((year) => `${prefix}-other-list-${year}`),
    mappingIds: electionYears.map((year) => deterministicUuid(`${prefix}-other-party-mapping-${year}`)),
  } : undefined;
  const comparisonLeftOnlySection =
    scenario === "comparison" && variant !== "filters"
      ? {
          jurisdictionId: deterministicUuid(`${prefix}-left-only-jurisdiction`),
          distritoCode: variant === "spatial" ? "02" : "84",
          seccionCode: variant === "spatial" ? "028" : "848",
          archiveEntryId: `national/${prefix}-left-only-result-2023`,
        }
      : undefined;
  const jurisdictionIds =
    variant === "filters" ? Array.from({ length: 10 }, (_, index) => index === 0 ? jurisdictionId : deterministicUuid(`${prefix}-jurisdiction-${index + 1}`)) :
    scenario === "fiscalizacion"
      ? [jurisdictionId, deterministicUuid(`${prefix}-jurisdiction-uncovered`)]
      : comparisonLeftOnlySection
        ? [jurisdictionId, comparisonLeftOnlySection.jurisdictionId]
        : [jurisdictionId];
  return {
    scenario,
    ...(comparisonParty ? { comparisonParty } : {}),
    ...(comparisonOtherParty ? { comparisonOtherParty } : {}),
    ...(comparisonLeftOnlySection ? { comparisonLeftOnlySection } : {}),
    categoryId: deterministicUuid(`${prefix}-category`),
    categoryName: variant === "paso" ? "PRESIDENTE/A" : variant === "spatial" ? "DIPUTADO NACIONAL" : scenario === "municipal" ? "CONCEJALES" : `${prefix}-synthetic-category`,
    jurisdictionId,
    jurisdictionIds,
    distritoCode: variant === "spatial" || scenario === "municipal" ? "02" : scenario === "fiscalizacion" ? "82" : scenario === "provenance" ? "83" : "84",
    seccionCode: variant === "spatial" || scenario === "municipal" ? "027" : scenario === "fiscalizacion" ? "827" : scenario === "provenance" ? "837" : "847",
    electionIds,
    electionYears,
    electionRounds,
    archiveEntryIds,
  };
}

export function resultNaturalKey(row: ResultNaturalKeyInput): string {
  return `result:${row.archiveEntryId}|${row.electionId}|${row.jurisdictionId}|${row.categoryId}|${row.listId ?? "null"}|${row.sourceKind}`;
}

export function ownedResultArchiveEntryIds(
  identity: ResultScenarioIdentity,
): string[] {
  return [...new Set([
    ...identity.archiveEntryIds,
    ...(identity.comparisonLeftOnlySection
      ? [identity.comparisonLeftOnlySection.archiveEntryId]
      : []),
  ])];
}

function plannedResultArchiveEntryIds(identity: ResultScenarioIdentity): string[] {
  return identity.scenario === "municipal"
    ? [
        identity.archiveEntryIds[0]!,
        identity.archiveEntryIds[0]!,
        identity.archiveEntryIds[2]!,
      ]
    : identity.archiveEntryIds;
}

export function planCompletenessNaturalKeys(spec: string, variant?: ComparisonFixtureVariant): string[] {
  if (variant === "filters") {
    const i = resultScenarioIdentity(spec, variant);
    return i.electionIds.flatMap(election => Array.from({ length: 10 }, (_, index) => [
      `official_expected_mesa:${election}|${i.distritoCode}|${i.seccionCode}|${index + 1}`,
      `official_mesa_count_status:${election}|${i.categoryId}|${i.distritoCode}|${i.seccionCode}|${index + 1}`,
    ]).flat());
  }
  if (spec !== "e2e/provenance.spec.ts") throw new Error("unsupported completeness scenario");
  const identity = resultScenarioIdentity(spec);
  const section = `${identity.distritoCode}|${identity.seccionCode}`;
  return [
    ...[1, 2, 3].map((mesa) => `official_expected_mesa:${identity.electionIds[0]}|${section}|${mesa}`),
    ...[1, 2].map((mesa) => `official_mesa_count_status:${identity.electionIds[0]}|${identity.categoryId}|${section}|${mesa}`),
  ];
}

export function planCircuitMembershipNaturalKeys(spec: string, variant?: ComparisonFixtureVariant): string[] {
  planCompletenessNaturalKeys(spec, variant);
  const i = resultScenarioIdentity(spec, variant);
  if (variant === "filters") return i.electionIds.flatMap(election => Array.from({ length: 10 }, (_, index) => `official_mesa_circuit_membership:${election}|${i.distritoCode}|${i.seccionCode}|${index + 1}`));
  return [1, 2, 3].map(m => `official_mesa_circuit_membership:${i.electionIds[0]}|${i.distritoCode}|${i.seccionCode}|${m}`);
}

export function planCompletenessCleanup(spec: string): string[] {
  planCompletenessNaturalKeys(spec);
  const archive = resultScenarioIdentity(spec).archiveEntryIds[0]!;
  return [`official_expected_mesa:${archive}`, `official_mesa_count_status:${archive}`];
}

export function planResultNaturalKeys(spec: string, variant?: ComparisonFixtureVariant): string[] {
  const identity = resultScenarioIdentity(spec, variant);
  if (variant === "filters") return [
    `category:${identity.categoryName}`,
    ...identity.jurisdictionIds.map((_, index) => `jurisdiction:${identity.distritoCode}|${identity.seccionCode}|${String(index + 1).padStart(5, "0")}|E1|${index + 1}`),
    ...identity.electionYears.map((year, index) => `election:${year}|${identity.electionRounds[index]}`),
    ...identity.electionIds.flatMap((electionId, side) => identity.jurisdictionIds.map(jurisdictionId => resultNaturalKey({
      archiveEntryId: identity.archiveEntryIds[side]!, electionId, jurisdictionId, categoryId: identity.categoryId,
      listId: identity.comparisonParty!.listIds[side]!, sourceKind: "official",
    }))),
    ...planScenarioPartyNaturalKeys(spec, variant),
  ];
  if (variant === "paso") return [
    `category:${identity.categoryName}`, `jurisdiction:${identity.distritoCode}|${identity.seccionCode}|null|null|null`, `election:2023|paso`,
    ...pasoInternasFixture.section_lists.map((list) => resultNaturalKey({ archiveEntryId: identity.archiveEntryIds[0]!, electionId: identity.electionIds[0]!, jurisdictionId: identity.jurisdictionId, categoryId: identity.categoryId, listId: list.list_id, sourceKind: "official" })),
    ...[...new Set(PASO_NAMED_LISTS.map(pasoOwnedParty))].map((id) => `party_canonical:${id}`),
    ...PASO_NAMED_LISTS.flatMap((id) => [`party_mapping:2023|national|PRESIDENTE/A|${id}`, `list_identity:2023|national|PRESIDENTE/A|${id}`]),
  ];
  const sourceKinds =
    identity.scenario === "comparison"
      ? ["official", "official"]
      : identity.scenario === "fiscalizacion"
        ? ["official", "fiscalizacion", "official"]
        : identity.scenario === "municipal"
          ? ["official", "official", "fiscalizacion"]
          : ["official", "fiscalizacion"];
  const resultArchiveEntryIds = plannedResultArchiveEntryIds(identity);
  const resultJurisdictions =
    identity.scenario === "fiscalizacion"
      ? [
          identity.jurisdictionIds[0]!,
          identity.jurisdictionIds[0]!,
          identity.jurisdictionIds[1]!,
        ]
      : resultArchiveEntryIds.map(() => identity.jurisdictionId);
  return [
    `category:${identity.categoryName}`,
    ...identity.jurisdictionIds.map((_, index) =>
      identity.scenario === "fiscalizacion"
        ? `jurisdiction:${identity.distritoCode}|${identity.seccionCode}|0000${index + 1}|E1|${index + 1}`
        : identity.scenario === "provenance"
          ? `jurisdiction:${identity.distritoCode}|${identity.seccionCode}|00001|E1|1`
          : identity.comparisonLeftOnlySection && index === 1
            ? `jurisdiction:${identity.comparisonLeftOnlySection.distritoCode}|${identity.comparisonLeftOnlySection.seccionCode}|null|null|null`
            : `jurisdiction:${identity.distritoCode}|${identity.seccionCode}|null|null|null`,
    ),
    ...identity.electionYears.map(
      (year, index) => `election:${year}|${identity.electionRounds[index]}`,
    ),
        ...resultArchiveEntryIds.map((archiveEntryId, index) =>
          resultNaturalKey({
            archiveEntryId,
            electionId: identity.scenario === "comparison"
              ? identity.electionIds[index]!
              : identity.electionIds[0]!,
            jurisdictionId: resultJurisdictions[index]!,
            categoryId: identity.categoryId,
            listId: identity.scenario === "municipal"
              ? ["2206", "110", "2206"][index]!
              : identity.comparisonParty?.listIds[index] ?? null,
            sourceKind: sourceKinds[index]!,
          }),
        ),
        ...(identity.comparisonOtherParty
          ? identity.archiveEntryIds.map((archiveEntryId, index) => resultNaturalKey({
              archiveEntryId, electionId: identity.electionIds[index]!,
              jurisdictionId: identity.jurisdictionId, categoryId: identity.categoryId,
              listId: identity.comparisonOtherParty!.listIds[index]!, sourceKind: "official",
            })) : []),
        ...(identity.comparisonLeftOnlySection
          ? [resultNaturalKey({
              archiveEntryId: identity.comparisonLeftOnlySection.archiveEntryId,
              electionId: identity.electionIds[0]!,
              jurisdictionId: identity.comparisonLeftOnlySection.jurisdictionId,
              categoryId: identity.categoryId,
              listId: identity.comparisonParty!.listIds[0]!,
              sourceKind: "official",
            })]
          : []),
         ...(identity.scenario === "municipal" || identity.scenario === "comparison"
           ? planScenarioPartyNaturalKeys(spec, variant)
           : []),
      ];
    }

    export function planScenarioPartyNaturalKeys(spec: string, variant?: ComparisonFixtureVariant): string[] {
  const identity = resultScenarioIdentity(spec, variant);
  const party = identity.comparisonParty;
  if (!party) throw new Error(`scenario has no comparison party: ${spec}`);
  return [party, identity.comparisonOtherParty].filter((value): value is ComparisonPartyIdentity => !!value)
    .flatMap((owned) => [
      `party_canonical:${owned.canonicalPartyId}`,
      ...identity.electionYears.map((year, index) =>
        `party_mapping:${year}|${owned.jurisdiction}|${identity.categoryName}|${owned.listIds[index]}`),
    ]);
}

export function planScenarioPartyCleanup(spec: string, variant?: ComparisonFixtureVariant): string[] {
  const identity = resultScenarioIdentity(spec, variant);
  if (!identity.comparisonParty) throw new Error(`scenario has no comparison party: ${spec}`);
  return [identity.comparisonParty, identity.comparisonOtherParty]
    .filter((value): value is ComparisonPartyIdentity => !!value)
    .flatMap((party) => [
      ...party.mappingIds.map((id) => `party_mapping:${id}`),
      `party_canonical:${party.canonicalPartyId}`,
    ]);
}

export function planResultCleanup(spec: string, variant?: ComparisonFixtureVariant): string[] {
  const identity = resultScenarioIdentity(spec, variant);
  const resultRowArchiveEntryIds = [
    ...plannedResultArchiveEntryIds(identity),
    ...(identity.comparisonLeftOnlySection
      ? [identity.comparisonLeftOnlySection.archiveEntryId]
      : []),
  ];
  return [
    ...[...new Set(variant === "paso" ? [identity.archiveEntryIds[0]!] : resultRowArchiveEntryIds)].map((id) => `result_row:${id}`),
    ...(variant === "paso" ? [
      ...[...new Set(PASO_NAMED_LISTS.map(pasoOwnedParty))].map((id) => `party_canonical:${id}`),
      ...PASO_NAMED_LISTS.flatMap((id) => [`party_mapping:${pasoOwnedMappingId(id)}`, `list_identity:${pasoOwnedListId(id)}`]),
    ] : []),
    ...(identity.scenario === "municipal" || identity.scenario === "comparison"
      ? planScenarioPartyCleanup(spec, variant)
      : []),
    ...identity.electionIds.map((id) => `election:${id}`),
    ...ownedResultArchiveEntryIds(identity).map((id) => `archive_entry:${id}`),
    ...identity.jurisdictionIds.map((id) => `jurisdiction:${id}`),
    `category:${identity.categoryId}`,
  ];
}

export function planScenarioServers(
  ports: readonly number[],
): ScenarioServer[] {
  if (ports.length !== SERVER_SCENARIOS.length)
    throw new Error(`server port count must be ${SERVER_SCENARIOS.length}`);
  if (new Set(ports).size !== ports.length)
    throw new Error("duplicate server port");
  return SERVER_SCENARIOS.map((scenario, index) => ({
    scenario,
    port: ports[index]!,
  }));
}

export function scenarioBaseUrl(
  spec: DataScenarioSpec,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): string {
  const scenario = resultScenarioIdentity(spec).scenario.toUpperCase();
  const value = environment[`VOTUS_E2E_BASE_URL_${scenario}`];
  if (!value) throw new Error(`missing scenario base URL for ${spec}`);
  return value;
}
