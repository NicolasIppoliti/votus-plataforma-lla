import { createHash } from "node:crypto";

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

export interface ResultScenarioIdentity {
  scenario: Exclude<ServerScenario, "shared">;
  comparisonParty?: ComparisonPartyIdentity;
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

export function resultScenarioIdentity(spec: string): ResultScenarioIdentity {
  const scenario = SCENARIO_BY_SPEC[spec as DataScenarioSpec];
  if (!scenario) throw new Error(`unknown data scenario: ${spec}`);
  const prefix = `e2e-${scenario}`;
  const electionIds =
    scenario === "comparison"
      ? [
          deterministicUuid(`${prefix}-election-2023`),
          deterministicUuid(`${prefix}-election-2025`),
        ]
      : [deterministicUuid(`${prefix}-election`)];
  const electionYears = scenario === "comparison" ? [2023, 2025] : [2025];
  const electionRounds = electionYears.map((year) => `${prefix}-round-${year}`);
  const archiveEntryIds =
    scenario === "comparison"
      ? [`${prefix}-result-2023`, `${prefix}-result-2025`]
      : scenario === "fiscalizacion"
        ? [
            `${prefix}-result-official-covered`,
            `${prefix}-result-fiscalizacion`,
            `${prefix}-result-official-uncovered`,
          ]
        : [`${prefix}-result-official`, `${prefix}-result-fiscalizacion`];
  const jurisdictionId = deterministicUuid(`${prefix}-jurisdiction`);
  const comparisonParty =
    scenario === "comparison"
      ? {
          canonicalPartyId: deterministicUuid(`${prefix}-canonical-party`),
          displayName: `${prefix}-canonical-party`,
          jurisdiction: "national",
          listIds: electionYears.map((year) => `${prefix}-list-${year}`),
          mappingIds: electionYears.map((year) =>
            deterministicUuid(`${prefix}-party-mapping-${year}`),
          ),
        }
      : undefined;
  const jurisdictionIds =
    scenario === "fiscalizacion"
      ? [jurisdictionId, deterministicUuid(`${prefix}-jurisdiction-uncovered`)]
      : [jurisdictionId];
  return {
    scenario,
    ...(comparisonParty ? { comparisonParty } : {}),
    categoryId: deterministicUuid(`${prefix}-category`),
    categoryName: `${prefix}-synthetic-category`,
    jurisdictionId,
    jurisdictionIds,
    distritoCode: scenario === "fiscalizacion" ? "82" : scenario === "provenance" ? "83" : scenario === "comparison" ? "84" : "85",
    seccionCode: scenario === "fiscalizacion" ? "827" : scenario === "provenance" ? "837" : scenario === "comparison" ? "847" : "857",
    electionIds,
    electionYears,
    electionRounds,
    archiveEntryIds,
  };
}

export function resultNaturalKey(row: ResultNaturalKeyInput): string {
  return `result:${row.archiveEntryId}|${row.electionId}|${row.jurisdictionId}|${row.categoryId}|${row.listId ?? "null"}|${row.sourceKind}`;
}

export function planResultNaturalKeys(spec: string): string[] {
  const identity = resultScenarioIdentity(spec);
  const sourceKinds =
    identity.scenario === "comparison"
      ? ["official", "official"]
      : identity.scenario === "fiscalizacion"
        ? ["official", "fiscalizacion", "official"]
        : ["official", "fiscalizacion"];
  const resultJurisdictions =
    identity.scenario === "fiscalizacion"
      ? [
          identity.jurisdictionIds[0]!,
          identity.jurisdictionIds[0]!,
          identity.jurisdictionIds[1]!,
        ]
      : identity.archiveEntryIds.map(() => identity.jurisdictionId);
  return [
    `category:${identity.categoryName}`,
    ...identity.jurisdictionIds.map((_, index) =>
      identity.scenario === "fiscalizacion"
        ? `jurisdiction:${identity.distritoCode}|${identity.seccionCode}|0000${index + 1}|E1|${index + 1}`
        : identity.scenario === "provenance"
          ? `jurisdiction:${identity.distritoCode}|${identity.seccionCode}|00001|E1|1`
          : `jurisdiction:${identity.distritoCode}|${identity.seccionCode}|null|null|null`,
    ),
    ...identity.electionYears.map(
      (year, index) => `election:${year}|${identity.electionRounds[index]}`,
    ),
    ...identity.archiveEntryIds.map((archiveEntryId, index) =>
      resultNaturalKey({
        archiveEntryId,
        electionId: identity.electionIds[index] ?? identity.electionIds[0]!,
        jurisdictionId: resultJurisdictions[index]!,
        categoryId: identity.categoryId,
        listId: identity.comparisonParty?.listIds[index] ?? null,
        sourceKind: sourceKinds[index]!,
      }),
    ),
  ];
}

export function planComparisonPartyNaturalKeys(spec: string): string[] {
  const identity = resultScenarioIdentity(spec);
  const party = identity.comparisonParty;
  if (!party) throw new Error(`scenario has no comparison party: ${spec}`);
  return [
    `party_canonical:${party.canonicalPartyId}`,
    ...identity.electionYears.map(
      (year, index) =>
        `party_mapping:${year}|${party.jurisdiction}|${identity.categoryName}|${party.listIds[index]}`,
    ),
  ];
}

export function planComparisonPartyCleanup(spec: string): string[] {
  const party = resultScenarioIdentity(spec).comparisonParty;
  if (!party) throw new Error(`scenario has no comparison party: ${spec}`);
  return [
    ...party.mappingIds.map((id) => `party_mapping:${id}`),
    `party_canonical:${party.canonicalPartyId}`,
  ];
}

export function planResultCleanup(spec: string): string[] {
  const identity = resultScenarioIdentity(spec);
  return [
    `category:${identity.categoryId}`,
    ...identity.jurisdictionIds.map((id) => `jurisdiction:${id}`),
    ...identity.electionIds.map((id) => `election:${id}`),
    ...(identity.scenario === "fiscalizacion" ||
    identity.scenario === "provenance"
      ? identity.archiveEntryIds.map((id) => `archive_entry:${id}`)
      : []),
    ...identity.archiveEntryIds.map((id) => `result_row:${id}`),
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
