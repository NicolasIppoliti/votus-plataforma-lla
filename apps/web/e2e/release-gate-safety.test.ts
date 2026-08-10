import { describe, expect, it } from "vitest";
import type { FullConfig, FullResult, Suite, TestCase, TestResult } from "@playwright/test/reporter";
import ReleaseGateReporter from "./release-gate-reporter";
import { EXPECTED_E2E_SPECS, assertE2eEnvironment, assertGateReport, planOwnedCleanup,
  type CleanupAction, type GateOwnership, type GateTestResult } from "./gate-contract";
import { assertStackStatus, assertTs7Version, establishOwnership, reserveUniquePorts,
  runOwnedCleanup, type PortReservation } from "../scripts/e2e-gate-runtime";
const OWNERSHIP: GateOwnership = { workdir: "/private/tmp/votus-e2e-owned",
  projectId: "votus-e2e-project", token: "token" };
const ACTIONS: CleanupAction[] = [{ kind: "stop-stack", projectId: OWNERSHIP.projectId },
  { kind: "remove-owned-volumes", projectId: OWNERSHIP.projectId }, { kind: "remove-workdir", workdir: OWNERSHIP.workdir }];
const ENV = {
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321", NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
  SUPABASE_SERVICE_ROLE_KEY: "service", VOTUS_E2E_TEST_USER_EMAIL: "fixture@example.test",
  VOTUS_E2E_TEST_USER_PASSWORD: "password", NATIONAL_JURISDICTION_ID: "national",
  FISCALIZACION_ELECTION_ID: "fiscal-election", FISCALIZACION_CATEGORY_ID: "fiscal-category",
};
const PASSED: GateTestResult[] = EXPECTED_E2E_SPECS.map((spec) => ({ spec, status: "passed" }));
describe("base contracts", () => {
  it("requires and returns every generated environment value", () => {
    expect(assertE2eEnvironment(ENV)).toEqual(ENV);
    expect(() => assertE2eEnvironment({})).toThrow("VOTUS_E2E_TEST_USER_PASSWORD");
  });
  it("accepts only the exact four-pass inventory", () => {
    expect(() => assertGateReport(PASSED, "passed")).not.toThrow();
    expect(() => assertGateReport([], "passed")).toThrow("discovered 0 tests");
    expect(() => assertGateReport([{ ...PASSED[0]!, spec: "e2e/other.spec.ts" }], "passed")).toThrow("spec inventory mismatch");
  });
  it.each(["skipped", "interrupted", "failed", "timedOut"] as const)("rejects %s", (status) => {
    expect(() => assertGateReport([{ spec: PASSED[0]!.spec, status }, ...PASSED.slice(1)], "passed")).toThrow(`${status}=1`);
  });
  it("rejects a non-passing suite", () => expect(() =>
    assertGateReport(PASSED, "interrupted")).toThrow("suite status=interrupted"));
  it("plans exact owned cleanup and refuses foreign scope or marker", () => {
    expect(planOwnedCleanup("/private/tmp", OWNERSHIP.workdir, OWNERSHIP, OWNERSHIP)).toEqual(ACTIONS);
    expect(() => planOwnedCleanup("/private/tmp", "/protected", OWNERSHIP, OWNERSHIP)).toThrow("outside");
    expect(() => planOwnedCleanup("/private/tmp", OWNERSHIP.workdir, OWNERSHIP,
      { ...OWNERSHIP, token: "x" })).toThrow("marker mismatch");
  });
});
it("continues every cleanup step, verifies residuals, and aggregates failures", async () => {
    const reached: string[] = [];
    await expect(runOwnedCleanup(ACTIONS, async (action) => { reached.push(action.kind);
      if (action.kind !== "remove-workdir") throw new Error(action.kind);
    }, async () => { reached.push("verify"); throw new Error("residual state"); }))
      .rejects.toSatisfy((error: AggregateError) => error.errors.length === 3);
    expect(reached).toEqual(["stop-stack", "remove-owned-volumes", "remove-workdir", "verify"]);
});
it("publishes ownership before the first side effect and rolls back marker failure", () => {
    const state: { ownership?: GateOwnership } = {}; const events: string[] = [];
    expect(() => establishOwnership(state, OWNERSHIP, {
      createWorkdir: () => events.push(`create:${state.ownership?.token}`),
      writeMarker: () => { throw new Error("marker failed"); },
      rollbackWorkdir: () => events.push("rollback"),
    })).toThrow("marker failed");
    expect(events).toEqual(["create:token", "rollback"]);
    expect(state.ownership).toBeUndefined();
});
it("reserves one unique set and releases duplicate reservations", async () => {
    const released: number[] = []; const values = [3100, 3100, 3200, 3300];
    const reservations = await reserveUniquePorts(3, async (): Promise<PortReservation> => {
      const port = values.shift()!; return { port, release: async () => { released.push(port); } }; });
    expect(reservations.map(({ port }) => port)).toEqual([3100, 3200, 3300]);
    expect(released).toEqual([3100]);
});
it("requires the exact generated loopback API endpoint and all keys", () => {
    const valid = JSON.stringify({ API_URL: "http://127.0.0.1:43123", ANON_KEY: "anon", SERVICE_ROLE_KEY: "service" });
    expect(assertStackStatus(valid, 43123).API_URL).toBe("http://127.0.0.1:43123");
    expect(() => assertStackStatus(valid.replace("43123", "43124"), 43123)).toThrow("API port");
    expect(() => assertStackStatus(valid.replace("127.0.0.1", "example.test"), 43123)).toThrow("loopback");
    expect(() => assertStackStatus(JSON.stringify({ API_URL: "http://127.0.0.1:43123" }), 43123))
      .toThrow("ANON_KEY");
});
it("accepts only an explicit 7.x compiler version", () => {
    expect(() => assertTs7Version("Version 7.0.2")).not.toThrow();
    expect(() => assertTs7Version("Version 6.0.3")).toThrow("TypeScript 7.x");
});
describe("ReleaseGateReporter", () => {
  const cases = EXPECTED_E2E_SPECS.map((spec, index) => ({ id: String(index),
    location: { file: `/repo/${spec}` } } as TestCase));
  const suite = { allTests: () => cases } as Suite;
  const fullResult = { status: "passed" } as FullResult;
  const makeReporter = (capture: (content: string) => void) => new ReleaseGateReporter({ receiptPath: "/receipt.json",
    writeReceipt: (_path, content) => capture(content), writeError: () => undefined });
  it("is directly driven through the exact passing inventory", async () => {
    let receipt = "";
    const reporter = makeReporter((content) => { receipt = content; });
    reporter.onBegin({} as FullConfig, suite);
    for (const testCase of cases) reporter.onTestEnd(testCase, { status: "passed" } as TestResult);
    await expect(reporter.onEnd(fullResult)).resolves.toBeUndefined();
    expect(JSON.parse(receipt).results).toHaveLength(4);
  });
  it("records a discovered test with no result as interrupted", async () => {
    let receipt = "";
    const reporter = makeReporter((content) => { receipt = content; });
    reporter.onBegin({} as FullConfig, suite);
    await expect(reporter.onEnd(fullResult)).resolves.toEqual({ status: "failed" });
    expect(JSON.parse(receipt).results[0]).toMatchObject({ status: "interrupted" });
  });
});
