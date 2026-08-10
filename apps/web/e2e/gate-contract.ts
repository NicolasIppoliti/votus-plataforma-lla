import path from "node:path";
export const REQUIRED_E2E_ENV = [
  "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY",
  "VOTUS_E2E_TEST_USER_EMAIL", "VOTUS_E2E_TEST_USER_PASSWORD", "NATIONAL_JURISDICTION_ID",
  "FISCALIZACION_ELECTION_ID", "FISCALIZACION_CATEGORY_ID",
] as const;
export const EXPECTED_E2E_SPECS = [
  "e2e/auth.spec.ts", "e2e/comparison.spec.ts",
  "e2e/fiscalizacion.spec.ts", "e2e/provenance.spec.ts",
] as const;
const ACCEPTED_TEST_STATUS = {
  PASSED: "passed", FAILED: "failed", TIMED_OUT: "timedOut",
  SKIPPED: "skipped", INTERRUPTED: "interrupted",
} as const;
type RequiredEnvironmentName = (typeof REQUIRED_E2E_ENV)[number];
type TestStatus = (typeof ACCEPTED_TEST_STATUS)[keyof typeof ACCEPTED_TEST_STATUS];
export type E2eEnvironment = Record<RequiredEnvironmentName, string>;
export interface GateTestResult { spec: string; status: TestStatus; }
export interface GateOwnership { workdir: string; projectId: string; token: string; }
export type CleanupAction =
  | { kind: "stop-stack"; projectId: string }
  | { kind: "remove-owned-volumes"; projectId: string }
  | { kind: "remove-workdir"; workdir: string };
export function assertE2eEnvironment(environment: Readonly<Record<string, string | undefined>>): E2eEnvironment {
  const missing = REQUIRED_E2E_ENV.filter((name) => !environment[name]);
  if (missing.length > 0) throw new Error(`missing required e2e environment: ${missing.join(", ")}`);
  return Object.fromEntries(REQUIRED_E2E_ENV.map((name) => [name, environment[name]])) as E2eEnvironment;
}
export function assertGateReport(results: readonly GateTestResult[], suiteStatus: string): void {
  const expected = [...EXPECTED_E2E_SPECS].sort();
  const discovered = results.map(({ spec }) => spec).sort();
  const errors: string[] = [];
  if (results.length !== EXPECTED_E2E_SPECS.length)
    errors.push(`discovered ${results.length} tests; expected ${EXPECTED_E2E_SPECS.length}`);
  if (JSON.stringify(discovered) !== JSON.stringify(expected))
    errors.push(`spec inventory mismatch: discovered [${discovered.join(", ")}]`);
  for (const status of Object.values(ACCEPTED_TEST_STATUS)) {
    if (status === ACCEPTED_TEST_STATUS.PASSED) continue;
    const count = results.filter((result) => result.status === status).length;
    if (count > 0) errors.push(`${status}=${count}`);
  }
  const passed = results.filter(({ status }) => status === ACCEPTED_TEST_STATUS.PASSED).length;
  if (passed !== EXPECTED_E2E_SPECS.length)
    errors.push(`passed=${passed}; expected=${EXPECTED_E2E_SPECS.length}`);
  if (suiteStatus !== ACCEPTED_TEST_STATUS.PASSED)
    errors.push(`suite status=${suiteStatus}`);
  if (errors.length > 0)
    throw new Error(`e2e release gate failed: ${errors.join("; ")}`);
}
export function planOwnedCleanup(tempRoot: string, workdir: string,
  expected: GateOwnership, marker: GateOwnership): CleanupAction[] {
  const resolvedTempRoot = path.resolve(tempRoot);
  const resolvedWorkdir = path.resolve(workdir);
  const relative = path.relative(resolvedTempRoot, resolvedWorkdir);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative))
    throw new Error("refusing cleanup outside the OS temporary directory");
  if (
    expected.workdir !== resolvedWorkdir ||
    marker.workdir !== expected.workdir ||
    marker.projectId !== expected.projectId ||
    marker.token !== expected.token
  ) throw new Error("refusing cleanup because the ownership marker mismatch");
  return [
    { kind: "stop-stack", projectId: expected.projectId },
    { kind: "remove-owned-volumes", projectId: expected.projectId },
    { kind: "remove-workdir", workdir: resolvedWorkdir },
  ];
}
