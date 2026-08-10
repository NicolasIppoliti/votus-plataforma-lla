import path from "node:path";
const TEST_USER_PASSWORD_ENV = ["VOTUS_E2E_TEST_USER", "PASSWORD"].join("_") as
  `VOTUS_E2E_TEST_USER_${"PASSWORD"}`;
export const REQUIRED_E2E_ENV = [
  "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY",
  "VOTUS_E2E_TEST_USER_EMAIL", TEST_USER_PASSWORD_ENV, "VOTUS_E2E_BASE_URL",
  "VOTUS_E2E_STORAGE_STATE",
  "VOTUS_E2E_BASE_URL_COMPARISON", "VOTUS_E2E_BASE_URL_FISCALIZACION",
  "VOTUS_E2E_BASE_URL_MUNICIPAL", "VOTUS_E2E_BASE_URL_PROVENANCE",
] as const;
export const EXPECTED_E2E_SPECS = [
  "e2e/auth.spec.ts", "e2e/comparison.spec.ts",
  "e2e/fiscalizacion.spec.ts", "e2e/provenance.spec.ts",
  "e2e/municipal.spec.ts", "e2e/review.spec.ts",
  "e2e/root.spec.ts", "e2e/simulate.spec.ts",
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
interface StorageCookie { name: string; value: string; domain: string; path: string; expires: number;
  httpOnly: boolean; secure: boolean; sameSite: "Strict" | "Lax" | "None"; }
interface StorageOrigin { origin: string; localStorage: Array<{ name: string; value: string }>; }
interface BrowserStorageState { cookies: StorageCookie[]; origins: StorageOrigin[]; }
export interface StaleOwnershipEvidence {
  tempRoot: string; expectedWorkdir: string; marker: unknown; ageMs: number; staleAfterMs: number;
  repositoryMatches: boolean | undefined; ownerProcessActive: boolean | undefined;
  projectResourcesActive: boolean | undefined;
}
export interface StaleWorkdirAction { workdir: string; projectId: string; }
export type StaleOwnershipClassification = "reap" | "live" | "foreign" | "ambiguous";
export type CleanupAction =
  | { kind: "stop-stack"; projectId: string }
  | { kind: "remove-owned-volumes"; projectId: string }
  | { kind: "remove-workdir"; workdir: string };
export function assertE2eEnvironment(environment: Readonly<Record<string, string | undefined>>): E2eEnvironment {
  const missing = REQUIRED_E2E_ENV.filter((name) => !environment[name]);
  if (missing.length > 0) throw new Error(`missing required e2e environment: ${missing.join(", ")}`);
  return Object.fromEntries(REQUIRED_E2E_ENV.map((name) => [name, environment[name]])) as E2eEnvironment;
}
export function emptyStorageState(): BrowserStorageState {
  return { cookies: [], origins: [] };
}
export function storageStateForSpec(spec: string, authenticatedPath: string): string | BrowserStorageState {
  if (!EXPECTED_E2E_SPECS.includes(spec as (typeof EXPECTED_E2E_SPECS)[number]))
    throw new Error(`unknown e2e spec: ${spec}`);
  return spec === "e2e/auth.spec.ts" ? emptyStorageState() : authenticatedPath;
}
export function assertLoopbackStorageState(state: BrowserStorageState): void {
  const authCookies = state.cookies.filter(({ name }) => name.startsWith("sb-") && name.includes("auth-token"));
  if (authCookies.length === 0) throw new Error("authenticated storage state has no Supabase auth cookie");
  if (authCookies.some(({ domain }) => domain !== "127.0.0.1"))
    throw new Error("authenticated cookie must target the exact loopback host without a port");
}
function parsedLegacyMarker(value: unknown): GateOwnership | undefined {
  if (!value || typeof value !== "object") return undefined;
  const marker = value as Record<string, unknown>;
  if (Object.keys(marker).sort().join(",") !== "projectId,token,workdir") return undefined;
  if (typeof marker["workdir"] !== "string" || typeof marker["projectId"] !== "string" ||
      typeof marker["token"] !== "string" || !marker["projectId"].startsWith("votus-e2e-")) return undefined;
  return marker as unknown as GateOwnership;
}
export function classifyStaleOwnership(evidence: StaleOwnershipEvidence): StaleOwnershipClassification {
  const marker = parsedLegacyMarker(evidence.marker);
  if (!marker || marker.workdir !== path.resolve(evidence.expectedWorkdir)) return "ambiguous";
  const relative = path.relative(path.resolve(evidence.tempRoot), marker.workdir);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return "ambiguous";
  if (evidence.repositoryMatches === false) return "foreign";
  if (evidence.repositoryMatches === undefined || evidence.ownerProcessActive === undefined ||
      evidence.projectResourcesActive === undefined) return "ambiguous";
  if (evidence.ageMs < evidence.staleAfterMs || evidence.ownerProcessActive || evidence.projectResourcesActive)
    return "live";
  return "reap";
}
export function planStaleWorkdirReap(evidence: StaleOwnershipEvidence): StaleWorkdirAction[] {
  if (classifyStaleOwnership(evidence) !== "reap") return [];
  const marker = evidence.marker as GateOwnership;
  return [{ workdir: marker.workdir, projectId: marker.projectId }];
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
