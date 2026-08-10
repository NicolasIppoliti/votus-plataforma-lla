import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";
import { EXPECTED_E2E_SPECS, classifyStaleOwnership, planOwnedCleanup,
  planStaleWorkdirReap } from "../e2e/gate-contract.ts";
import type { CleanupAction, GateOwnership } from "../e2e/gate-contract.ts";
import { SERVER_SCENARIOS, planScenarioServers, resultScenarioIdentity, type ScenarioServer,
  type ServerScenario } from "../e2e/scenario-ownership.ts";
import {
  assertStackStatus, assertTs7Version, establishOwnership, reserveUniquePorts, runOwnedCleanup,
  runOwnedServerCleanup, type PortReservation,
} from "./e2e-gate-runtime.ts";
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REQUIRE = createRequire(import.meta.url);
const NEXT_CLI = REQUIRE.resolve("next/dist/bin/next");
const WEB_ROOT = path.resolve(SCRIPT_DIR, "..");
const REPO_ROOT = path.resolve(WEB_ROOT, "../..");
const SOURCE_SUPABASE = path.join(REPO_ROOT, "supabase");
const OWNER_FILE = ".votus-e2e-owner.json";
const STALE_AFTER_MS = 30 * 60 * 1000;
const EXPECTED_MIGRATIONS = Array.from({ length: 19 }, (_, index) => String(index + 1).padStart(4, "0"));
const EXCLUDED_SERVICES =
  "realtime,storage-api,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor";
interface OwnedNextServer extends ScenarioServer { child: ChildProcess; }
interface GateState { ownership?: GateOwnership; stackMutationAttempted: boolean;
  servers?: OwnedNextServer[]; reservations?: PortReservation[]; interrupted?: string; }
interface PlaywrightReceipt { suiteStatus: string; results: Array<{ spec: string; status: string }>; }
function commandResult(command: string, args: readonly string[], cwd = REPO_ROOT) {
  return spawnSync(command, args, { cwd, encoding: "utf8", env: process.env,
    stdio: ["ignore", "pipe", "pipe"], timeout: 15_000 });
}
function requireCommand(command: string, args: readonly string[], label: string, cwd = REPO_ROOT): string {
  const result = commandResult(command, args, cwd);
  if (result.error || result.status !== 0)
    throw new Error(`${label} is unavailable or failed its preflight check`);
  return result.stdout;
}
function runChecked(command: string, args: readonly string[], label: string, cwd = REPO_ROOT,
  environment: NodeJS.ProcessEnv = process.env, timeout = 120_000): void {
  const result = spawnSync(command, args, { cwd, env: environment, encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"], timeout });
  if (result.error || result.status !== 0)
    throw new Error(`${label} failed (exit ${result.status ?? "unavailable"}); output redacted`);
}
function replaceExactly(source: string, pattern: RegExp, replacement: string, label: string): string {
  const match = source.match(pattern);
  if (!match || match.index === undefined)
    throw new Error(`cannot isolate Supabase config: expected exactly one ${label}`);
  const remainder = source.slice(match.index + match[0].length);
  if (pattern.test(remainder))
    throw new Error(`cannot isolate Supabase config: found duplicate ${label}`);
  return source.replace(pattern, replacement);
}
async function reservePort(): Promise<PortReservation> {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string")
        return void server.close(() => reject(new Error("failed to allocate an isolated port")));
      let released = false;
      resolve({
        port: address.port,
        release: async () => { if (released) return; released = true;
          await new Promise<void>((done, fail) => server.close((error) => error ? fail(error) : done())); },
      });
    });
  });
}
async function assertSourceInventory(): Promise<void> {
  const migrationFiles = (await readdir(path.join(SOURCE_SUPABASE, "migrations")))
    .filter((name) => /^\d{4}_.+\.sql$/.test(name)).sort();
  const versions = migrationFiles.map((name) => name.slice(0, 4));
  if (JSON.stringify(versions) !== JSON.stringify(EXPECTED_MIGRATIONS))
    throw new Error("migration inventory must be exactly versions 0001 through 0019");
  const specFiles = (await readdir(path.join(WEB_ROOT, "e2e")))
    .filter((name) => name.endsWith(".spec.ts")).map((name) => `e2e/${name}`).sort();
  if (JSON.stringify(specFiles) !== JSON.stringify([...EXPECTED_E2E_SPECS].sort()))
    throw new Error("Playwright spec inventory must be exactly the eight release-gate specs");
}
function assertIsolationCapabilities(): void {
  requireCommand("pnpm", ["--version"], "pnpm");
  requireCommand("docker", ["info", "--format", "{{.ServerVersion}}"], "Docker");
  requireCommand("supabase", ["--version"], "Supabase CLI");
  assertTs7Version(requireCommand("pnpm", ["exec", "tsc", "--version"], "TypeScript compiler", WEB_ROOT));
  const startHelp = requireCommand("supabase", ["start", "--help"], "Supabase start");
  const stopHelp = requireCommand("supabase", ["stop", "--help"], "Supabase stop");
  if (!startHelp.includes("--workdir") || !stopHelp.includes("--project-id") || !stopHelp.includes("--no-backup"))
    throw new Error("Supabase CLI lacks the isolation and owned-cleanup flags required by the gate");
  if (!existsSync(chromium.executablePath()))
    throw new Error("Playwright Chromium is not installed; run the package-supported browser install first");
}
async function createIsolatedWorkdir(nextPort: number, ports: readonly number[],
  state: GateState): Promise<void> {
  // Docker truncation can make an exact-id stop miss containers; keep this under 40.
  const token = randomUUID();
  const projectId = `votus-e2e-${token.replaceAll("-", "").slice(0, 20)}`;
  const workdir = path.join(os.tmpdir(), `votus-e2e-${token}`);
  const ownership = { workdir, projectId, token };
  establishOwnership(state, ownership, {
    createWorkdir: () => mkdirSync(workdir, { mode: 0o700 }),
    writeMarker: () => writeFileSync(path.join(workdir, OWNER_FILE), `${JSON.stringify(ownership)}\n`, { mode: 0o600 }),
    rollbackWorkdir: () => rmSync(workdir, { recursive: true, force: true }),
  });
  const targetSupabase = path.join(workdir, "supabase");
  await mkdir(path.join(targetSupabase, "migrations"), { recursive: true });
  const migrationNames = (await readdir(path.join(SOURCE_SUPABASE, "migrations")))
    .filter((name) => /^\d{4}_.+\.sql$/.test(name)).sort();
  for (const name of migrationNames.slice(0, 12))
    await cp(path.join(SOURCE_SUPABASE, "migrations", name), path.join(targetSupabase, "migrations", name));
  await cp(path.join(SOURCE_SUPABASE, "config.toml"), path.join(targetSupabase, "config.toml"));
  let config = await readFile(path.join(targetSupabase, "config.toml"), "utf8");
  config = replaceExactly(config, /^project_id = .+$/m, `project_id = "${projectId}"`, "project_id");
  const portLabels = [
    ["api", /^port = 54321$/m, ports[0]], ["db", /^port = 54322$/m, ports[1]],
    ["shadow db", /^shadow_port = 54320$/m, ports[2]], ["studio", /^port = 54323$/m, ports[3]],
    ["mailpit", /^port = 54324$/m, ports[4]], ["smtp", /^# smtp_port = 54325$/m, ports[5]],
    ["pop3", /^# pop3_port = 54326$/m, ports[6]], ["analytics", /^port = 54327$/m, ports[7]],
    ["pooler", /^port = 54329$/m, ports[8]], ["edge inspector", /^inspector_port = 8083$/m, ports[9]],
  ] as const;
  for (const [label, pattern, port] of portLabels)
    config = replaceExactly(config, pattern, `${label === "shadow db" ? "shadow_port" : label === "edge inspector" ? "inspector_port" : label === "smtp" ? "smtp_port" : label === "pop3" ? "pop3_port" : "port"} = ${port}`, `${label} port`);
  config = replaceExactly(config, /^site_url = .+$/m, `site_url = "http://127.0.0.1:${nextPort}"`, "auth site_url");
  config = replaceExactly(config, /^additional_redirect_urls = .+$/m,
    `additional_redirect_urls = ["http://127.0.0.1:${nextPort}"]`, "auth redirects");
  config = replaceExactly(config, /(\[db\.seed\](?:(?!\n\[)[\s\S])*?\n)enabled = true/, "$1enabled = false", "seed setting");
  await writeFile(path.join(targetSupabase, "config.toml"), config, { mode: 0o600 });
}
async function installRemainingMigrations(workdir: string): Promise<void> {
  const targetMigrations = path.join(workdir, "supabase", "migrations");
  const migrationNames = (await readdir(path.join(SOURCE_SUPABASE, "migrations")))
    .filter((name) => /^\d{4}_.+\.sql$/.test(name)).sort();
  for (const name of migrationNames.slice(12))
    await cp(path.join(SOURCE_SUPABASE, "migrations", name), path.join(targetMigrations, name));
  await cp(path.join(WEB_ROOT, "e2e", "service-role-grants.sql"), path.join(targetMigrations, "0020_e2e_service_role_grants.sql"));
}
async function waitForServer(url: string, child: ChildProcess): Promise<void> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error("production Next server exited before becoming ready");
    try {
      const response = await fetch(url, { redirect: "manual" });
      if (response.status < 500) return;
    } catch { /* still binding */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("production Next server did not become ready within 60 seconds");
}
async function runPlaywright(environment: NodeJS.ProcessEnv, receiptPath: string): Promise<void> {
  const result = spawnSync("pnpm", ["exec", "playwright", "test"],
    { cwd: WEB_ROOT, env: environment, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (!result.error && result.status === 0) return;
  let summary = "no reporter receipt";
  try {
    const receipt = JSON.parse(await readFile(receiptPath, "utf8")) as PlaywrightReceipt;
    const counts = new Map<string, number>();
    for (const testResult of receipt.results)
      counts.set(testResult.status, (counts.get(testResult.status) ?? 0) + 1);
    summary = `${receipt.results.length} discovered, ${[...counts.entries()].map(([status, count]) =>
      `${status}=${count}`).join(", ")}, suite=${receipt.suiteStatus}, non-passing=[${receipt.results
      .filter(({ status }) => status !== "passed").map(({ spec, status }) => `${spec}:${status}`).join(", ")}]`;
  } catch { /* missing receipt is a failure */ }
  throw new Error(`Playwright release suite failed (exit ${result.status ?? "unavailable"}; ${summary}); output redacted`);
}
async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([new Promise<void>((resolve) => child.once("exit", () => resolve())),
    new Promise<void>((resolve) => setTimeout(resolve, 5_000))]);
  if (child.exitCode === null) {
    child.kill("SIGKILL");
    await Promise.race([new Promise<void>((resolve) => child.once("exit", () => resolve())),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Next server did not stop")), 5_000))]);
  }
}
async function verifyServerStopped(server: OwnedNextServer): Promise<void> {
  if (server.child.exitCode === null)
    throw new Error(`production Next server still runs: ${server.scenario}:${server.port}`);
}
async function verifyResiduals(ownership: GateOwnership): Promise<void> {
  const errors: unknown[] = [];
  const checks = [["ps", "-a", "--filter", `name=${ownership.projectId}`, "--format", "{{.Names}}"],
    ["volume", "ls", "--filter", `name=${ownership.projectId}`, "--format", "{{.Name}}"]] as const;
  for (const args of checks) {
    const result = commandResult("docker", args);
    if (result.error || result.status !== 0 || result.stdout.trim())
      errors.push(new Error("disposable Supabase cleanup left owned Docker state"));
  }
  if (existsSync(ownership.workdir)) errors.push(new Error("disposable workdir still exists"));
  if (errors.length > 0) throw new AggregateError(errors, "residual cleanup verification failed");
}
function removeOwnedVolumes(projectId: string): void {
  const result = commandResult("docker", ["volume", "ls", "--filter", `name=${projectId}`, "--format", "{{.Name}}"]);
  if (result.error || result.status !== 0)
    throw new Error("failed to enumerate disposable Supabase volumes");
  const volumes = result.stdout.split("\n").filter(Boolean);
  if (volumes.some((name) => !name.endsWith(`_${projectId}`)))
    throw new Error("refusing to remove a volume without the exact owned project suffix");
  if (volumes.length > 0)
    runChecked("docker", ["volume", "rm", ...volumes], "owned Supabase volume cleanup", REPO_ROOT, process.env, 15_000);
}
function addErrors(target: unknown[], error: unknown): void {
  if (error instanceof AggregateError) target.push(...error.errors); else target.push(error);
}
function markerStrings(marker: unknown): { workdir: string; projectId: string } | undefined {
  if (!marker || typeof marker !== "object") return undefined;
  const value = marker as Record<string, unknown>;
  if (typeof value["workdir"] !== "string" || typeof value["projectId"] !== "string") return undefined;
  return { workdir: value["workdir"], projectId: value["projectId"] };
}
async function matchesRepository(candidate: string): Promise<boolean> {
  try {
    const target = path.join(candidate, "supabase", "migrations");
    const sourceNames = (await readdir(path.join(SOURCE_SUPABASE, "migrations")))
      .filter((name) => /^\d{4}_.+\.sql$/.test(name)).sort();
    const targetNames = (await readdir(target)).filter((name) => /^\d{4}_.+\.sql$/.test(name)).sort();
    const expected = [...sourceNames, "0020_e2e_service_role_grants.sql"].sort();
    if (JSON.stringify(targetNames) !== JSON.stringify(expected)) return false;
    for (const name of sourceNames)
      if (await readFile(path.join(target, name), "utf8") !==
          await readFile(path.join(SOURCE_SUPABASE, "migrations", name), "utf8")) return false;
    return await readFile(path.join(target, "0020_e2e_service_role_grants.sql"), "utf8") ===
      await readFile(path.join(WEB_ROOT, "e2e", "service-role-grants.sql"), "utf8");
  } catch { return false; }
}
function matchingProcessActive(workdir: string, projectId: string): boolean | undefined {
  const result = commandResult("ps", ["-axo", "command="]);
  if (result.error || result.status !== 0) return undefined;
  return result.stdout.split("\n").some((line) => line.includes(workdir) || line.includes(projectId));
}
function matchingProjectResourcesActive(projectId: string): boolean | undefined {
  const checks = [
    ["ps", "-a", "--filter", `name=${projectId}`, "--format", "{{.Names}}"],
    ["volume", "ls", "--filter", `name=${projectId}`, "--format", "{{.Name}}"],
  ] as const;
  let active = false;
  for (const args of checks) {
    const result = commandResult("docker", args);
    if (result.error || result.status !== 0) return undefined;
    if (result.stdout.trim()) active = true;
  }
  return active;
}
async function reapStaleOwnedWorkdirs(): Promise<void> {
  const tempRoot = os.tmpdir();
  const entries = await readdir(tempRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith("votus-e2e-")) continue;
    const candidate = path.join(tempRoot, entry.name);
    let marker: unknown;
    let markerAgeMs: number;
    try {
      const markerPath = path.join(candidate, OWNER_FILE);
      marker = JSON.parse(await readFile(markerPath, "utf8"));
      markerAgeMs = Date.now() - (await stat(markerPath)).mtimeMs;
    } catch { continue; }
    const strings = markerStrings(marker);
    const evidence = {
      tempRoot, expectedWorkdir: candidate, marker, ageMs: markerAgeMs,
      staleAfterMs: STALE_AFTER_MS, repositoryMatches: await matchesRepository(candidate),
      ownerProcessActive: strings ? matchingProcessActive(strings.workdir, strings.projectId) : undefined,
      projectResourcesActive: strings ? matchingProjectResourcesActive(strings.projectId) : undefined,
    };
    if (classifyStaleOwnership(evidence) !== "reap") continue;
    for (const action of planStaleWorkdirReap(evidence))
      await rm(action.workdir, { recursive: true });
  }
}
async function cleanup(state: GateState): Promise<void> {
  const errors: unknown[] = [];
  if (state.servers) try {
    await runOwnedServerCleanup(state.servers,
      ({ child }) => stopChild(child), verifyServerStopped);
  } catch (error) { addErrors(errors, error); }
  for (const reservation of state.reservations ?? [])
    try { await reservation.release(); } catch (error) { addErrors(errors, error); }
  if (!state.ownership) {
    if (errors.length > 0) throw new AggregateError(errors, "cleanup failed");
    return;
  }
  const ownership = state.ownership;
  let actions: CleanupAction[] = [];
  try {
    const marker = JSON.parse(await readFile(path.join(ownership.workdir, OWNER_FILE), "utf8")) as GateOwnership;
    actions = planOwnedCleanup(os.tmpdir(), ownership.workdir, ownership, marker);
  } catch (error) { addErrors(errors, error); }
  try {
    await runOwnedCleanup(actions, async (action) => {
      if (action.kind === "stop-stack" && state.stackMutationAttempted)
        runChecked("supabase", ["stop", "--workdir", ownership.workdir, "--project-id", action.projectId,
          "--no-backup", "--yes"], "disposable Supabase cleanup", REPO_ROOT, process.env, 15_000);
      else if (action.kind === "remove-owned-volumes" && state.stackMutationAttempted)
        removeOwnedVolumes(action.projectId);
      else if (action.kind === "remove-workdir") await rm(action.workdir, { recursive: true });
    }, () => verifyResiduals(ownership));
  } catch (error) { addErrors(errors, error); }
  if (errors.length > 0) throw new AggregateError(errors, "cleanup failed");
}
const DATA_SPEC_BY_SCENARIO = {
  comparison: "e2e/comparison.spec.ts",
  fiscalizacion: "e2e/fiscalizacion.spec.ts",
  municipal: "e2e/municipal.spec.ts",
  provenance: "e2e/provenance.spec.ts",
} as const;
function productEnvironment(common: NodeJS.ProcessEnv, scenario: ServerScenario): NodeJS.ProcessEnv {
  const spec = scenario === "shared" ? undefined : DATA_SPEC_BY_SCENARIO[scenario];
  const identity = spec ? resultScenarioIdentity(spec) : undefined;
  const prefix = `e2e-${scenario}`;
  return {
    ...common,
    NATIONAL_JURISDICTION_ID: identity && scenario !== "municipal"
      ? identity.jurisdictionId : `${prefix}-unused-national`,
    MUNICIPAL_JURISDICTION_ID: identity && scenario === "municipal"
      ? identity.jurisdictionId : `${prefix}-unused-municipal`,
    MUNICIPAL_CATEGORY_ID: identity && scenario === "municipal"
      ? identity.categoryId : `${prefix}-unused-municipal-category`,
    FISCALIZACION_ELECTION_ID: identity && scenario === "fiscalizacion"
      ? identity.electionIds[0] : `${prefix}-unused-fiscalizacion-election`,
    FISCALIZACION_CATEGORY_ID: identity && scenario === "fiscalizacion"
      ? identity.categoryId : `${prefix}-unused-fiscalizacion-category`,
  };
}
async function executeGate(state: GateState): Promise<void> {
  await assertSourceInventory();
  assertIsolationCapabilities();
  await reapStaleOwnedWorkdirs();
  const reservations = await reserveUniquePorts(10 + SERVER_SCENARIOS.length, reservePort);
  state.reservations = reservations;
  const nextReservations = reservations.slice(0, SERVER_SCENARIOS.length);
  const supabaseReservations = reservations.slice(SERVER_SCENARIOS.length);
  if (nextReservations.length !== SERVER_SCENARIOS.length || supabaseReservations.length !== 10)
    throw new Error("port reservation failed");
  const serverPlan = planScenarioServers(nextReservations.map(({ port }) => port));
  const nextPort = serverPlan[0]!.port;
  const supabasePorts = supabaseReservations.map(({ port }) => port);
  await createIsolatedWorkdir(nextPort, supabasePorts, state);
  const ownership = state.ownership;
  if (!ownership) throw new Error("disposable ownership was not established");
  for (const reservation of supabaseReservations) await reservation.release();
  if (state.interrupted) throw new Error(`interrupted by ${state.interrupted}`);
  state.stackMutationAttempted = true;
  runChecked("supabase", ["start", "--workdir", ownership.workdir, "--exclude", EXCLUDED_SERVICES, "--yes"],
    "disposable Supabase start");
  await installRemainingMigrations(ownership.workdir);
  runChecked("supabase", ["migration", "up", "--local", "--include-all", "--workdir", ownership.workdir, "--yes"],
    "disposable Supabase incremental migrations");
  const statusOutput = requireCommand("supabase", ["status", "--workdir", ownership.workdir, "-o", "json"],
    "disposable Supabase status");
  const stack = assertStackStatus(statusOutput, supabasePorts[0]!);
  const baseURLs = Object.fromEntries(serverPlan.map(({ scenario, port }) =>
    [scenario, `http://127.0.0.1:${port}`])) as Record<ServerScenario, string>;
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    NEXT_PUBLIC_SUPABASE_URL: stack.API_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY: stack.ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: stack.SERVICE_ROLE_KEY,
    VOTUS_E2E_TEST_USER_EMAIL: `votus-e2e-${randomUUID()}@example.test`,
    VOTUS_E2E_TEST_USER_PASSWORD: randomBytes(24).toString("base64url"),
    VOTUS_E2E_BASE_URL: baseURLs.shared,
    VOTUS_E2E_BASE_URL_COMPARISON: baseURLs.comparison,
    VOTUS_E2E_BASE_URL_FISCALIZACION: baseURLs.fiscalizacion,
    VOTUS_E2E_BASE_URL_MUNICIPAL: baseURLs.municipal,
    VOTUS_E2E_BASE_URL_PROVENANCE: baseURLs.provenance,
    VOTUS_E2E_STORAGE_STATE: path.join(ownership.workdir, "authenticated-state.json"),
    VOTUS_E2E_RESULT_FILE: path.join(ownership.workdir, "playwright-result.json"),
  };
  runChecked("pnpm", ["build"], "production Next build", WEB_ROOT,
    productEnvironment(environment, "shared"));
  if (state.interrupted) throw new Error(`interrupted by ${state.interrupted}`);
  state.servers = [];
  for (const [index, server] of serverPlan.entries()) {
    await nextReservations[index]!.release();
    const child = spawn(process.execPath,
      [NEXT_CLI, "start", "-H", "127.0.0.1", "-p", String(server.port)],
      { cwd: WEB_ROOT, env: productEnvironment(environment, server.scenario), stdio: "ignore" });
    state.servers.push({ ...server, child });
    await waitForServer(`${baseURLs[server.scenario]}/login`, child);
  }
  await runPlaywright(environment, environment.VOTUS_E2E_RESULT_FILE!);
}
async function main(): Promise<void> {
  const state: GateState = { stackMutationAttempted: false };
  let cleanupPromise: Promise<void> | undefined;
  const cleanOnce = () => (cleanupPromise ??= cleanup(state));
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      state.interrupted = signal;
      void Promise.race([cleanOnce(), new Promise<never>((_, reject) => setTimeout(() =>
        reject(new Error("signal cleanup timed out")), 120_000))]).catch((error: unknown) => process.stderr.write(
        `E2E signal cleanup failed: ${error instanceof Error ? error.message : "unknown"}\n`))
        .finally(() => process.exit(signal === "SIGINT" ? 130 : 143));
    });
  }
  let failure: unknown;
  try { await executeGate(state); } catch (error) { failure = error; }
  try { await cleanOnce(); } catch (error) { failure = failure
    ? new AggregateError([failure, error], "gate execution and cleanup both failed") : error; }
  if (failure) throw failure;
  process.stdout.write("E2E release gate passed: 8 passed, 0 skipped, disposable stack cleaned\n");
}
main().catch((error: unknown) => { const message = error instanceof Error ? error.message : "unknown failure";
  process.stderr.write(`E2E release gate failed: ${message}\n`); process.exitCode = 1; });
