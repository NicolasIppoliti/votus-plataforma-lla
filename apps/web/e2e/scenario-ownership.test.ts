import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  DATA_SCENARIO_SPECS,
  SERVER_SCENARIOS,
  assertUniqueScenarioKeys,
  planScenarioPartyCleanup,
  planScenarioPartyNaturalKeys,
  planResultNaturalKeys,
  planResultCleanup,
  planScenarioServers,
  resultNaturalKey,
  resultScenarioIdentity,
} from "./scenario-ownership";
import { runOwnedServerCleanup } from "../scripts/e2e-gate-runtime";
import {
  assertResultFixtureOwnership,
  comparisonFixture,
  sourceIsolationFixture,
} from "./result-fixture";

describe("parallel scenario ownership", () => {
  it("binds a separate supported comparison identity without changing the default or colliding with municipal ownership", () => {
    const spec = "e2e/comparison.spec.ts";
    const baseline = resultScenarioIdentity(spec);
    const supported = resultScenarioIdentity(spec, "spatial");
    expect([supported.distritoCode, supported.seccionCode, supported.categoryName, ...supported.electionRounds]).toEqual([
      "02", "027", "DIPUTADO NACIONAL", "generales", "legislativas",
    ]);
    expect(resultScenarioIdentity(spec)).toEqual(baseline);
    expect(supported.jurisdictionId).not.toBe(baseline.jurisdictionId);
    expect(planResultCleanup(spec, "spatial").filter((key) => planResultCleanup(spec).includes(key))).toEqual([]);
    const municipal = planResultNaturalKeys("e2e/municipal.spec.ts");
    expect(planResultNaturalKeys(spec, "spatial").filter((key) => municipal.includes(key))).toEqual([
      "jurisdiction:02|027|null|null|null",
    ]);
    const runner = readFileSync(new URL("../playwright.config.ts", import.meta.url), "utf8");
    expect(runner).toMatch(/fullyParallel:\s*false[\s\S]*workers:\s*1/);
    expect(supported.distritoCode + "/" + supported.seccionCode).toBe("02/027");
    expect(resultScenarioIdentity("e2e/municipal.spec.ts").seccionCode).toBe("027");
  });
  it("keeps the spatial authorization extension inside district 02 with a distinct owned section", () => {
    const spec = "e2e/comparison.spec.ts";
    const spatial = comparisonFixture(spec, "spatial");
    const extension = spatial.identity.comparisonLeftOnlySection!;
    expect(extension.distritoCode).toBe(spatial.identity.distritoCode);
    expect(extension.seccionCode).toBe("028");
    expect(extension.seccionCode).not.toBe(spatial.identity.seccionCode);
    expect(spatial.seed.jurisdictions[1]).toMatchObject({
      id: extension.jurisdictionId, distrito_code: "02", seccion_code: "028",
    });
    expect(planResultNaturalKeys(spec, "spatial")).toContain("jurisdiction:02|028|null|null|null");
    expect(planResultCleanup(spec, "spatial")).toContain(`jurisdiction:${extension.jurisdictionId}`);
    expect(assertResultFixtureOwnership(spec, spatial.seed, "spatial")).toContain(extension.archiveEntryId);
    const original = comparisonFixture(spec);
    expect([original.identity.distritoCode, original.identity.seccionCode,
      original.identity.comparisonLeftOnlySection?.distritoCode,
      original.identity.comparisonLeftOnlySection?.seccionCode]).toEqual(["84", "847", "84", "848"]);
  });

  it("seeds two mapped spatial leaders with exact shares and complete owned cleanup", () => {
    const spec = "e2e/comparison.spec.ts";
    const { identity, seed } = comparisonFixture(spec, "spatial");
    const original = comparisonFixture(spec).seed;
    const municipal = sourceIsolationFixture("e2e/municipal.spec.ts").seed;
    expect(seed.rows.map((row) => row["votes"])).toEqual([6_000, 9_000, 4_000, 3_000, 5_000]);
    expect(seed.rows.slice(0, 4).map((row) => row["list_id"])).toEqual([
      identity.comparisonParty!.listIds[0], identity.comparisonParty!.listIds[1],
      identity.comparisonOtherParty!.listIds[0], identity.comparisonOtherParty!.listIds[1],
    ]);
    expect(seed.partyCanonical).toEqual([
      { id: identity.comparisonParty!.canonicalPartyId, display_name: identity.comparisonParty!.displayName },
      { id: identity.comparisonOtherParty!.canonicalPartyId, display_name: identity.comparisonOtherParty!.displayName },
    ]);
    expect(seed.partyMappings).toHaveLength(4);
    expect(planScenarioPartyNaturalKeys(spec, "spatial").filter((key) => key.startsWith("party_"))).toHaveLength(6);
    expect(planScenarioPartyCleanup(spec, "spatial")).toEqual([
      ...identity.comparisonParty!.mappingIds.map((id) => `party_mapping:${id}`),
      `party_canonical:${identity.comparisonParty!.canonicalPartyId}`,
      ...identity.comparisonOtherParty!.mappingIds.map((id) => `party_mapping:${id}`),
      `party_canonical:${identity.comparisonOtherParty!.canonicalPartyId}`,
    ]);
    expect(planResultNaturalKeys(spec, "spatial").filter((key) => key.startsWith("result:"))).toHaveLength(5);
    expect(planResultCleanup(spec, "spatial")).toEqual(expect.arrayContaining(planScenarioPartyCleanup(spec, "spatial")));
    expect(assertResultFixtureOwnership(spec, seed, "spatial")).toHaveLength(3);
    expect(original.rows.map((row) => row["votes"])).toEqual([10_000, 12_000, 5_000]);
    expect(original.partyMappings).toHaveLength(2);
    expect(municipal.partyMappings).toHaveLength(1);
    const missing = comparisonFixture(spec, "spatial").seed;
    missing.partyMappings!.pop();
    expect(() => assertResultFixtureOwnership(spec, missing, "spatial")).toThrow();
  });

  it("accepts only the supported fixture under its bound ownership plan", () => {
    const spec = "e2e/comparison.spec.ts";
    const { seed, identity } = comparisonFixture(spec, "spatial");
    expect(seed.category["name"]).toBe("DIPUTADO NACIONAL");
    expect(seed.jurisdictions[0]?.["distrito_code"]).toBe("02");
    expect(seed.jurisdictions[0]?.["seccion_code"]).toBe("027");
    expect(seed.elections.map((entry) => entry["round"])).toEqual(["generales", "legislativas"]);
    expect(assertResultFixtureOwnership(spec, seed, "spatial")).toEqual([
      ...identity.archiveEntryIds, identity.comparisonLeftOnlySection!.archiveEntryId,
    ].sort());
    expect(() => assertResultFixtureOwnership(spec, seed)).toThrow();
    expect(() => assertResultFixtureOwnership(spec, comparisonFixture(spec).seed, "spatial")).toThrow();
    const wrong = comparisonFixture(spec, "spatial").seed;
    wrong.elections[1]!["round"] = "generales";
    expect(() => assertResultFixtureOwnership(spec, wrong, "spatial")).toThrow();
    expect(() => resultScenarioIdentity("e2e/municipal.spec.ts", "spatial")).toThrow("unsupported comparison fixture variant");
    expect(() => resultScenarioIdentity(spec, "arbitrary" as "spatial")).toThrow("unsupported comparison fixture variant");
  });

  it("keeps every mutable identity and cleanup target pairwise disjoint", () => {
    const identities = DATA_SCENARIO_SPECS.map((spec) => resultScenarioIdentity(spec));
    const cleanupPlans = DATA_SCENARIO_SPECS.map((spec) => planResultCleanup(spec));
    const uuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    for (const identity of identities) {
      expect(identity.categoryId).toMatch(uuid);
      expect(identity.jurisdictionId).toMatch(uuid);
      expect(identity.electionIds.every((id) => uuid.test(id))).toBe(true);
    }
    for (const [index, left] of identities.entries()) {
      for (const right of identities.slice(index + 1)) {
        expect(left.categoryId).not.toBe(right.categoryId);
        expect(left.jurisdictionId).not.toBe(right.jurisdictionId);
        expect(
          left.electionIds.filter((id) => right.electionIds.includes(id)),
        ).toEqual([]);
        expect(
          left.archiveEntryIds.filter((id) =>
            right.archiveEntryIds.includes(id),
          ),
        ).toEqual([]);
      }
    }
    for (const [index, left] of cleanupPlans.entries())
      for (const right of cleanupPlans.slice(index + 1))
        expect(left.filter((target) => right.includes(target))).toEqual([]);
  });

  it("keeps category, jurisdiction, election and result natural keys pairwise disjoint", () => {
    const naturalKeys = DATA_SCENARIO_SPECS.map((spec) => planResultNaturalKeys(spec));
    for (const keys of naturalKeys) {
      expect(keys.some((key) => key.includes("DIPUTADO NACIONAL"))).toBe(false);
      expect(new Set(keys).size).toBe(keys.length);
    }
    for (const [index, left] of naturalKeys.entries())
      for (const right of naturalKeys.slice(index + 1))
        expect(left.filter((key) => right.includes(key))).toEqual([]);
  });

  it("owns deterministic cross-year party mappings and their exact cleanup", () => {
    const spec = "e2e/comparison.spec.ts";
    const identity = resultScenarioIdentity(spec);
    const party = identity.comparisonParty;
    const leftOnlySection = identity.comparisonLeftOnlySection;
    expect(party).toBeDefined();
    expect(leftOnlySection).toBeDefined();
    if (!party) throw new Error("comparison party identity is missing");
    if (!leftOnlySection)
      throw new Error("comparison left-only section identity is missing");

    expect(new Set(party.listIds).size).toBe(2);
    expect(party.mappingIds.every((id) => /^[0-9a-f-]{36}$/.test(id))).toBe(
      true,
    );
    expect(resultScenarioIdentity(spec).comparisonParty).toEqual(party);
    expect(planScenarioPartyNaturalKeys(spec)).toEqual([
      `party_canonical:${party.canonicalPartyId}`,
      ...identity.electionYears.map(
        (year, index) =>
          `party_mapping:${year}|national|${identity.categoryName}|${party.listIds[index]}`,
      ),
    ]);
    expect(planScenarioPartyCleanup(spec)).toEqual([
      ...party.mappingIds.map((id) => `party_mapping:${id}`),
      `party_canonical:${party.canonicalPartyId}`,
    ]);
    expect(planResultCleanup(spec)).toEqual([
      ...identity.archiveEntryIds.map((id) => `result_row:${id}`),
      `result_row:${leftOnlySection.archiveEntryId}`,
      ...party.mappingIds.map((id) => `party_mapping:${id}`),
      `party_canonical:${party.canonicalPartyId}`,
      ...identity.electionIds.map((id) => `election:${id}`),
      ...identity.archiveEntryIds.map((id) => `archive_entry:${id}`),
      `archive_entry:${leftOnlySection.archiveEntryId}`,
      `jurisdiction:${identity.jurisdictionId}`,
      `jurisdiction:${leftOnlySection.jurisdictionId}`,
      `category:${identity.categoryId}`,
    ]);
    for (const [index, archiveEntryId] of identity.archiveEntryIds.entries()) {
      expect(planResultNaturalKeys(spec)).toContain(
        resultNaturalKey({
          archiveEntryId,
          electionId: identity.electionIds[index]!,
          jurisdictionId: identity.jurisdictionId,
          categoryId: identity.categoryId,
          listId: party.listIds[index]!,
          sourceKind: "official",
        }),
      );
    }
  });

  it("accepts every comparison result archive entry owned by its production fixture", () => {
    const spec = "e2e/comparison.spec.ts";
    const { identity, seed } = comparisonFixture(spec);
    const leftOnlySection = identity.comparisonLeftOnlySection;
    if (!leftOnlySection)
      throw new Error("comparison left-only section identity is missing");

    expect(assertResultFixtureOwnership(spec, seed)).toEqual(
      [...identity.archiveEntryIds, leftOnlySection.archiveEntryId].sort(),
    );
  });

  it("derives a distinct lowercase SHA-256 digest for every comparison archive entry", () => {
    const archiveEntries = comparisonFixture("e2e/comparison.spec.ts").seed
      .archiveEntries ?? [];
    const sha256 = archiveEntries.map((entry) => entry["sha256"]);

    expect(
      sha256.every(
        (value) => typeof value === "string" && /^[0-9a-f]{64}$/.test(value),
      ),
    ).toBe(true);
    expect(new Set(archiveEntries.map((entry) => entry["id"])).size).toBe(
      archiveEntries.length,
    );
    expect(new Set(sha256).size).toBe(archiveEntries.length);
  });

  it("derives the same SHA-256 digest for the same comparison archive entry ID", () => {
    const first = comparisonFixture("e2e/comparison.spec.ts").seed
      .archiveEntries ?? [];
    const second = comparisonFixture("e2e/comparison.spec.ts").seed
      .archiveEntries ?? [];

    expect(second.map((entry) => entry["sha256"])).toEqual(
      first.map((entry) => entry["sha256"]),
    );
  });

  it("accepts municipal rows with distinct natural keys that share an archive cleanup target", () => {
    const spec = "e2e/municipal.spec.ts";
    const identity = resultScenarioIdentity(spec);
    const { seed } = sourceIsolationFixture(spec);
    seed.rows[1]!["archive_entry_id"] = identity.archiveEntryIds[0]!;

    expect(assertResultFixtureOwnership(spec, seed)).toEqual(
      [identity.archiveEntryIds[0]!, identity.archiveEntryIds[2]!].sort(),
    );
  });

  it("rejects duplicate municipal result natural keys before seeding", () => {
    const spec = "e2e/municipal.spec.ts";
    const { seed } = sourceIsolationFixture(spec);
    seed.rows[1] = {
      ...seed.rows[0]!,
      votes: 9_999,
      source_row_index: 99,
    };

    expect(() => assertResultFixtureOwnership(spec, seed)).toThrow(
      "duplicate result natural key",
    );
  });

  it("rejects missing, unknown, and out-of-scope result ownership before seeding", () => {
    const spec = "e2e/municipal.spec.ts";
    const missing = sourceIsolationFixture(spec).seed;
    delete missing.rows[0]!["archive_entry_id"];
    expect(() => assertResultFixtureOwnership(spec, missing)).toThrow(
      "missing result archive entry",
    );

    const unknown = sourceIsolationFixture(spec).seed;
    unknown.rows[0]!["archive_entry_id"] = "unowned-archive-entry";
    expect(() => assertResultFixtureOwnership(spec, unknown)).toThrow(
      "unowned result archive entry",
    );

    for (const [field, value] of [
      ["election_id", "outside-scenario-election"],
      ["jurisdiction_id", "outside-scenario-jurisdiction"],
      ["category_id", "outside-scenario-category"],
      ["source_kind", "outside-scenario-source"],
    ] as const) {
      const outsideScope = sourceIsolationFixture(spec).seed;
      outsideScope.rows[0]![field] = value;
      expect(() => assertResultFixtureOwnership(spec, outsideScope)).toThrow(
        "fixture seed does not exactly match owned identity",
      );
    }
  });

  it("plans municipal archive ownership by full result natural key", () => {
    const spec = "e2e/municipal.spec.ts";
    const identity = resultScenarioIdentity(spec);
    const resultKeys = planResultNaturalKeys(spec).filter((key) =>
      key.startsWith("result:"),
    );

    expect(resultKeys).toEqual([
      resultNaturalKey({
        archiveEntryId: identity.archiveEntryIds[0]!,
        electionId: identity.electionIds[0]!,
        jurisdictionId: identity.jurisdictionId,
        categoryId: identity.categoryId,
        listId: "2206",
        sourceKind: "official",
      }),
      resultNaturalKey({
        archiveEntryId: identity.archiveEntryIds[0]!,
        electionId: identity.electionIds[0]!,
        jurisdictionId: identity.jurisdictionId,
        categoryId: identity.categoryId,
        listId: "110",
        sourceKind: "official",
      }),
      resultNaturalKey({
        archiveEntryId: identity.archiveEntryIds[2]!,
        electionId: identity.electionIds[0]!,
        jurisdictionId: identity.jurisdictionId,
        categoryId: identity.categoryId,
        listId: "2206",
        sourceKind: "fiscalizacion",
      }),
    ]);
  });

  it("cleans each municipal result archive once while retaining every owned archive entry", () => {
    const spec = "e2e/municipal.spec.ts";
    const identity = resultScenarioIdentity(spec);
    const cleanup = planResultCleanup(spec);

    expect(cleanup.filter((target) => target.startsWith("result_row:"))).toEqual([
      `result_row:${identity.archiveEntryIds[0]}`,
      `result_row:${identity.archiveEntryIds[2]}`,
    ]);
    expect(cleanup.filter((target) => target.startsWith("archive_entry:"))).toEqual(
      identity.archiveEntryIds.map((id) => `archive_entry:${id}`),
    );
  });

  it("keeps otherwise identical result rows disjoint across elections", () => {
    const row = {
      archiveEntryId: "shared-entry",
      jurisdictionId: "shared-jurisdiction",
      categoryId: "shared-category",
      listId: null,
      sourceKind: "official",
    };

    expect(resultNaturalKey({ ...row, electionId: "election-2023" })).not.toBe(
      resultNaturalKey({ ...row, electionId: "election-2025" }),
    );
  });

  it("uses collision-free normalized administrative code pairs and the real municipal scope", () => {
    const expected = [
      ["e2e/fiscalizacion.spec.ts", "82", "827"], ["e2e/provenance.spec.ts", "83", "837"],
      ["e2e/comparison.spec.ts", "84", "847"], ["e2e/municipal.spec.ts", "02", "027"],
    ] as const;
    const pairs = expected.map(([spec, distritoCode, seccionCode]) => {
      const identity = resultScenarioIdentity(spec);
      expect(identity.distritoCode).toBe(distritoCode);
      expect(identity.seccionCode).toBe(seccionCode);
      expect(identity.distritoCode).toMatch(/^\d{2}$/);
      expect(identity.seccionCode).toMatch(/^\d{3}$/);
      return `${identity.distritoCode}/${identity.seccionCode}`;
    });
    expect(new Set(pairs).size).toBe(DATA_SCENARIO_SPECS.length);
  });

  it("owns the municipal mapping, archives, and dependency-ordered cleanup", () => {
    const spec = "e2e/municipal.spec.ts";
    const identity = resultScenarioIdentity(spec);
    const party = identity.comparisonParty;
    expect(identity.categoryName).toBe("CONCEJALES");
    expect(party?.listIds).toEqual(["2206"]);
    expect(planScenarioPartyNaturalKeys(spec)).toContain(
      "party_mapping:2025|coronel_rosales_municipal|CONCEJALES|2206");
    expect(planResultNaturalKeys(spec).join("|")).toContain("|110|official");
    expect(planScenarioPartyNaturalKeys(spec).join("|")).not.toContain("|110");
    const runtime = readFileSync(new URL("../scripts/e2e-release-gate.ts", import.meta.url), "utf8");
    expect(runtime).toMatch(/CORONEL_ROSALES_JURISDICTION_ID[\s\S]*MUNICIPAL_ELECTION_ID[\s\S]*MUNICIPAL_CATEGORY_ID/);
    expect(runtime).not.toMatch(/NATIONAL_JURISDICTION_ID|MUNICIPAL_JURISDICTION_ID/);
    expect(planResultCleanup(spec)).toEqual([
      ...[identity.archiveEntryIds[0]!, identity.archiveEntryIds[2]!].map(
        (id) => `result_row:${id}`,
      ),
      ...identity.comparisonParty!.mappingIds.map((id) => `party_mapping:${id}`),
      `party_canonical:${identity.comparisonParty!.canonicalPartyId}`,
      ...identity.electionIds.map((id) => `election:${id}`),
      ...identity.archiveEntryIds.map((id) => `archive_entry:${id}`),
      ...identity.jurisdictionIds.map((id) => `jurisdiction:${id}`),
      `category:${identity.categoryId}`,
    ]);
  });

  it("owns provenance archive entries needed by the reachable explorer journey", () => {
    const identity = resultScenarioIdentity("e2e/provenance.spec.ts");

    expect(planResultCleanup("e2e/provenance.spec.ts")).toEqual(
      expect.arrayContaining(
        identity.archiveEntryIds.map((id) => `archive_entry:${id}`),
      ),
    );
  });

  it("owns the complete provenance mesa lineage used by the cold selector chain", () => {
    const identity = resultScenarioIdentity("e2e/provenance.spec.ts");
    expect(planResultNaturalKeys("e2e/provenance.spec.ts")).toContain(
      `jurisdiction:${identity.distritoCode}|${identity.seccionCode}|00001|E1|1`,
    );
  });

  it("grants the service-role fixture every table it mutates", () => {
    const grants = readFileSync(
      new URL("./service-role-grants.sql", import.meta.url),
      "utf8",
    );

    for (const table of [
      "category",
      "jurisdiction",
      "election",
      "archive_entry",
      "result_row",
      "party_canonical",
      "party_mapping",
    ]) {
      expect(grants).toContain(`public.${table}`);
    }
    expect(grants).toContain(
      "grant select, insert, delete\non table public.party_canonical",
    );
    expect(grants).not.toMatch(
      /grant[^;]*update[^;]*party_(canonical|mapping)/s,
    );
    expect(grants).not.toMatch(/\b(to|grant)\s+(anon|authenticated)\b/i);
  });

  it("fails closed on unknown and duplicate scenario keys", () => {
    expect(() => resultScenarioIdentity("e2e/unknown.spec.ts")).toThrow(
      "unknown data scenario",
    );
    expect(() =>
      assertUniqueScenarioKeys(["comparison", "comparison"]),
    ).toThrow("duplicate scenario key");
  });

  it("owns one unique reserved port per production server", () => {
    const ports = SERVER_SCENARIOS.map((_, index) => 4100 + index);
    expect(planScenarioServers(ports)).toEqual(
      SERVER_SCENARIOS.map((scenario, index) => ({
        scenario,
        port: ports[index],
      })),
    );
    expect(() => planScenarioServers(ports.slice(1))).toThrow(
      "server port count",
    );
    expect(() => planScenarioServers(ports.map(() => 4100))).toThrow(
      "duplicate server port",
    );
  });
});

it("cleans and verifies every owned server independently", async () => {
  const servers = planScenarioServers(
    SERVER_SCENARIOS.map((_, index) => 4200 + index),
  );
  const reached: string[] = [];
  await expect(
    runOwnedServerCleanup(
      servers,
      async ({ scenario }) => {
        reached.push(`stop:${scenario}`);
        if (scenario === "comparison") throw new Error("stop");
      },
      async ({ scenario }) => {
        reached.push(`verify:${scenario}`);
        if (scenario === "municipal") throw new Error("residual");
      },
    ),
  ).rejects.toSatisfy((error: AggregateError) => error.errors.length === 2);
  expect(reached).toEqual([
    ...SERVER_SCENARIOS.map((scenario) => `stop:${scenario}`),
    ...SERVER_SCENARIOS.map((scenario) => `verify:${scenario}`),
  ]);
});
