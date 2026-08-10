import { describe, expect, it } from "vitest";

import {
  DATA_SCENARIO_SPECS,
  SERVER_SCENARIOS,
  assertUniqueScenarioKeys,
  planResultNaturalKeys,
  planResultCleanup,
  planScenarioServers,
  resultScenarioIdentity,
} from "./scenario-ownership";
import { runOwnedServerCleanup } from "../scripts/e2e-gate-runtime";

describe("parallel scenario ownership", () => {
  it("keeps every mutable identity and cleanup target pairwise disjoint", () => {
    const identities = DATA_SCENARIO_SPECS.map(resultScenarioIdentity);
    const cleanupPlans = DATA_SCENARIO_SPECS.map(planResultCleanup);
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    for (const identity of identities) {
      expect(identity.categoryId).toMatch(uuid);
      expect(identity.jurisdictionId).toMatch(uuid);
      expect(identity.electionIds.every((id) => uuid.test(id))).toBe(true);
    }
    for (const [index, left] of identities.entries()) {
      for (const right of identities.slice(index + 1)) {
        expect(left.categoryId).not.toBe(right.categoryId);
        expect(left.jurisdictionId).not.toBe(right.jurisdictionId);
        expect(left.electionIds.filter((id) => right.electionIds.includes(id))).toEqual([]);
        expect(left.archiveEntryIds.filter((id) => right.archiveEntryIds.includes(id))).toEqual([]);
      }
    }
    for (const [index, left] of cleanupPlans.entries())
      for (const right of cleanupPlans.slice(index + 1))
        expect(left.filter((target) => right.includes(target))).toEqual([]);
  });

  it("keeps category, jurisdiction, election and result natural keys pairwise disjoint", () => {
    const naturalKeys = DATA_SCENARIO_SPECS.map(planResultNaturalKeys);
    for (const keys of naturalKeys) {
      expect(keys.some((key) => key.includes("DIPUTADO NACIONAL"))).toBe(false);
      expect(new Set(keys).size).toBe(keys.length);
    }
    for (const [index, left] of naturalKeys.entries())
      for (const right of naturalKeys.slice(index + 1))
        expect(left.filter((key) => right.includes(key))).toEqual([]);
  });

  it("fails closed on unknown and duplicate scenario keys", () => {
    expect(() => resultScenarioIdentity("e2e/unknown.spec.ts")).toThrow("unknown data scenario");
    expect(() => assertUniqueScenarioKeys(["comparison", "comparison"])).toThrow("duplicate scenario key");
  });

  it("owns one unique reserved port per production server", () => {
    const ports = SERVER_SCENARIOS.map((_, index) => 4100 + index);
    expect(planScenarioServers(ports)).toEqual(
      SERVER_SCENARIOS.map((scenario, index) => ({ scenario, port: ports[index] })),
    );
    expect(() => planScenarioServers(ports.slice(1))).toThrow("server port count");
    expect(() => planScenarioServers(ports.map(() => 4100))).toThrow("duplicate server port");
  });
});

it("cleans and verifies every owned server independently", async () => {
  const servers = planScenarioServers(SERVER_SCENARIOS.map((_, index) => 4200 + index));
  const reached: string[] = [];
  await expect(runOwnedServerCleanup(
    servers,
    async ({ scenario }) => { reached.push(`stop:${scenario}`); if (scenario === "comparison") throw new Error("stop"); },
    async ({ scenario }) => { reached.push(`verify:${scenario}`); if (scenario === "municipal") throw new Error("residual"); },
  )).rejects.toSatisfy((error: AggregateError) => error.errors.length === 2);
  expect(reached).toEqual([
    ...SERVER_SCENARIOS.map((scenario) => `stop:${scenario}`),
    ...SERVER_SCENARIOS.map((scenario) => `verify:${scenario}`),
  ]);
});
