import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { assertLocalUrl, parseSpan, summarize, waterfall, type Span } from "./page-waterfalls-report.ts";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = path.resolve(WEB, "../..");
const DB = "supabase_db_votus-plataforma-lla";
const NEXT = createRequire(import.meta.url).resolve("next/dist/bin/next");
const REPORTS = {
  baseline: path.join(ROOT, "docs/research/page-waterfalls-490-baseline.json"),
  candidate: path.join(ROOT, "docs/research/page-waterfalls-490-candidate.json"),
} as const;
class ProfileFailure extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.code = code; }
}
function command(executable: string, args: string[]): string {
  try { return execFileSync(executable, args, { cwd: WEB, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 30_000 }); }
  catch { throw new ProfileFailure("local_command_failed"); }
}
function fixturePreflight() {
  if (command("docker", ["inspect", "--format", "{{.State.Running}}", DB]).trim() !== "true") throw new ProfileFailure("local_database_not_running");
  const helpers = command("docker", ["exec", DB, "psql", "-U", "postgres", "-d", "postgres", "-Atc", "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('e2e_setup_authorized_fiscal_fixture','e2e_cleanup_authorized_fiscal_fixture');"]).trim();
  if (helpers !== "2") throw new ProfileFailure("local_fixture_helpers_missing");
}
function localEnvironment() {
  let status: Record<string, string>;
  try { status = JSON.parse(command("pnpm", ["exec", "supabase", "status", "--workdir", ROOT, "--output", "json"])) as Record<string, string>; }
  catch { throw new ProfileFailure("local_status_unavailable"); }
  const api = status.API_URL;
  if (!api || !status.ANON_KEY || !status.SERVICE_ROLE_KEY) throw new ProfileFailure("local_status_incomplete");
  assertLocalUrl(api);
  const binding = command("docker", ["port", "supabase_kong_votus-plataforma-lla", "8000/tcp"]);
  if (!binding.split("\n").some(line => line.trim() === `127.0.0.1:${new URL(api).port}`)) throw new ProfileFailure("local_api_publication_mismatch");
  // The privileged key is returned only to fixture setup/teardown, never to Next.
  return { api, anon: status.ANON_KEY, admin: status.SERVICE_ROLE_KEY };
}
async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer(); server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") { server.close(); reject(new ProfileFailure("port_reservation_failed")); return; }
      server.close(error => error ? reject(error) : resolve(address.port));
    });
  });
}
async function exit(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const done = new Promise<void>(resolve => child.once("exit", () => resolve()));
  child.kill("SIGTERM");
  await Promise.race([done, new Promise<never>((_, reject) => {
    const timer = setTimeout(() => reject(new ProfileFailure("owned_server_shutdown_timeout")), 10_000); timer.unref();
  })]);
}
async function build(env: NodeJS.ProcessEnv) {
  const child = spawn("pnpm", ["build:next"], { cwd: WEB, env, stdio: "ignore" });
  const code = await new Promise<number | null>((resolve, reject) => { child.once("error", reject); child.once("exit", resolve); });
  if (code !== 0) throw new ProfileFailure("production_build_failed");
}
async function server(env: NodeJS.ProcessEnv, spans: Span[], monitorSpans: Span[]) {
  const port = await freePort();
  const baseURL = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [NEXT, "start", "--hostname", "127.0.0.1", "--port", String(port)], { cwd: WEB, env, stdio: ["ignore", "pipe", "ignore"] });
  let buffer = "";
  child.stdout!.on("data", (chunk: Buffer) => {
    buffer += chunk.toString();
    if (buffer.length > 65_536) buffer = "";
    let newline: number;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const span = parseSpan(buffer.slice(0, newline)); buffer = buffer.slice(newline + 1);
      if (span && spans.length < 30_000) spans.push(span);
      if (span?.route === "/api/session" && monitorSpans.length < 30_000) monitorSpans.push(span);
    }
  });
  // Never retain or echo arbitrary server logs or stderr.
  let launchError = false; child.once("error", () => { launchError = true; });
  try {
    for (let attempt = 0; attempt < 150; attempt++) {
      if (launchError || child.exitCode !== null) throw new ProfileFailure("owned_server_start_failed");
      try { if ((await fetch(`${baseURL}/login`, { signal: AbortSignal.timeout(1_000) })).ok) return { baseURL, child }; } catch { /* readiness only */ }
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    throw new ProfileFailure("owned_server_start_timeout");
  } catch (error) { await exit(child); throw error; }
}
async function login(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Correo electrónico").fill(email);
  await page.getByLabel("Contraseña").fill(password);
  await page.getByRole("button", { name: "Iniciar sesión" }).click();
  await page.waitForURL(url => url.pathname === "/");
}
async function selectOrganization(page: Page, organization: string) {
  const mobile = page.getByRole("button", { name: "Abrir navegación" });
  if (await mobile.isVisible()) await mobile.click();
  const selector = page.getByRole("combobox", { name: "Organización", exact: true });
  await selector.selectOption(organization);
  const response = page.waitForResponse(result => new URL(result.url()).pathname === "/api/workspace" && result.request().method() === "POST");
  await page.getByRole("button", { name: "Cambiar organización" }).click();
  if (!(await response).ok()) throw new ProfileFailure("workspace_selection_failed");
  await page.reload();
}
interface Sample {
  route: "/" | "/drilldown" | "/compare";
  kind: "cold_first_visit" | "warm_repeat" | "navigation";
  outcome: "ok" | "error";
  ttfbMs: number | null;
  filterToResultMs: number | null;
  waterfall: ReturnType<typeof waterfall>;
  relatedRequests: ReturnType<typeof waterfall>[];
}
async function sample(page: Page, route: Sample["route"], url: string, kind: Sample["kind"], spans: Span[]): Promise<Sample> {
  let start = performance.now();
  let spanOffset = spans.length;
  try {
    let response;
    if (kind === "navigation") {
      // An actual Next Link transition, rather than a second hard document load.
      await page.goto("/");
      await page.evaluate(target => {
        const anchor = Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href]")).find(item => new URL(item.href).pathname === target);
        if (!anchor) throw new Error("navigation_link_missing");
        anchor.id = "profile-navigation-target";
      }, route);
      start = performance.now();
      spanOffset = spans.length;
      response = await Promise.all([
        page.waitForResponse(result => new URL(result.url()).pathname === route && result.request().headers()["rsc"] === "1"),
        page.locator("#profile-navigation-target").click(),
      ]).then(([result]) => result);
      await page.waitForURL(value => value.pathname === route);
    } else response = await page.goto(url, { waitUntil: "networkidle" });
    if (!response) throw new ProfileFailure("missing_document_response");
    await response.finished();
    await page.locator("main").waitFor();
    const finishedMs = performance.now();
    const timing = response.request().timing();
    const requestId = response.headers()["x-votus-profile-request"];
    // Drain stdout after the HTTP stream; raw trace identifiers remain only in memory.
    await page.waitForTimeout(100);
    const requestSpans = spans.filter(span => span.requestId === requestId);
    const ok = response.ok() && new URL(page.url()).pathname === route && requestSpans.some(span => span.name.startsWith("page."));
    return { route, kind, outcome: ok ? "ok" : "error", ttfbMs: timing.responseStart >= 0 && timing.requestStart >= 0 ? timing.responseStart - timing.requestStart : null,
      filterToResultMs: kind === "navigation" ? finishedMs - start : null, waterfall: waterfall(requestSpans.slice(0, 200)),
      relatedRequests: [...new Set(spans.slice(spanOffset).filter(span => span.route === route && span.requestId !== requestId).map(span => span.requestId))].slice(0, 20).map(id => waterfall(spans.filter(span => span.requestId === id).slice(0, 200))) }; 
  } catch {
    return { route, kind, outcome: "error", ttfbMs: null, filterToResultMs: null, waterfall: waterfall([]), relatedRequests: [] };
  }
}
function summaries(samples: Sample[]) {
  return ["/", "/drilldown", "/compare"].flatMap(route => ["cold_first_visit", "warm_repeat", "navigation"].map(kind => {
    const matching = samples.filter(sample => sample.route === route && sample.kind === kind);
    const successful = matching.filter(sample => sample.outcome === "ok");
    return { route, kind, errors: matching.length - successful.length,
      ttfb: summarize(successful.flatMap(sample => sample.ttfbMs === null ? [] : [sample.ttfbMs])),
      filterToResult: summarize(successful.flatMap(sample => sample.filterToResultMs === null ? [] : [sample.filterToResultMs])),
      criticalEnvelope: summarize(successful.flatMap(sample => sample.waterfall.criticalEnvelopeMs === null ? [] : [sample.waterfall.criticalEnvelopeMs])),
      operations: Object.fromEntries([...new Set(successful.flatMap(sample => sample.waterfall.spans.map(span => span.name)))].map(name => [name, {
        calls: successful.reduce((total, sample) => total + (sample.waterfall.counts[name] ?? 0), 0),
        timing: summarize(successful.flatMap(sample => sample.waterfall.spans.filter(span => span.name === name).map(span => span.durationMs))),
      }])) };
  }));
}
export async function runProfile(variant: keyof typeof REPORTS, n: number) {
  if (!Number.isInteger(n) || n < 10 || n > 20) throw new ProfileFailure("sample_count_must_be_10_to_20");
  const samples: Sample[] = [], spans: Span[] = [], monitorSpans: Span[] = [];
  let browser: Browser | undefined, context: BrowserContext | undefined, active: Awaited<ReturnType<typeof server>> | undefined;
  let admin: SupabaseClient | undefined, userId: string | undefined, fixture: Record<string, unknown> | undefined;
  let blocker: string | null = null;
  let productionBuild: "not_run" | "passed" = "not_run";
  const sha = command("git", ["rev-parse", "HEAD"]).trim();
  try {
    const local = localEnvironment();
    // Do not inherit service-role credentials into the measured Next process.
    const env: NodeJS.ProcessEnv = { PATH: process.env.PATH, HOME: process.env.HOME, NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1",
      NEXT_PUBLIC_SUPABASE_URL: local.api, NEXT_PUBLIC_SUPABASE_ANON_KEY: local.anon, VOTUS_PROFILE_SPANS: "1" };
    await build(env);
    productionBuild = "passed";
    fixturePreflight();
    admin = createClient(local.api, local.admin, { auth: { persistSession: false, autoRefreshToken: false } });
    const email = `profile-${randomUUID()}@example.test`, password = randomBytes(24).toString("hex");
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error || !created.data.user) throw new ProfileFailure("fixture_user_creation_failed");
    userId = created.data.user.id;
    const setup = await admin.rpc("e2e_setup_authorized_fiscal_fixture", { p_user_id: userId, p_distrito_code: "02", p_seccion_code: "027" });
    if (setup.error || typeof setup.data?.organization_id !== "string") throw new ProfileFailure("fixture_workspace_creation_failed");
    fixture = setup.data;
    const election2023 = await admin.from("election").select("id").eq("year", 2023).eq("round", "generales").single();
    const election2025 = await admin.from("election").select("id").eq("year", 2025).eq("round", "legislativas").single();
    const category = await admin.from("category").select("id").eq("name", "DIPUTADO NACIONAL").single();
    if (!election2023.data || !election2025.data || !category.data) throw new ProfileFailure("official_corpus_not_unique_or_missing");
    const common = { distritoCode: "02", seccionCode: "027" };
    const urls: Record<Sample["route"], string> = {
      "/": "/",
      "/drilldown": `/drilldown?${new URLSearchParams({ ...common, electionId: election2025.data.id, categoryId: category.data.id, level: "seccion" })}`,
      "/compare": `/compare?${new URLSearchParams({ ...common, electionId: election2023.data.id, categoryId: category.data.id, bElectionId: election2025.data.id, bCategoryId: category.data.id })}`,
    };
    browser = await chromium.launch();
    active = await server(env, spans, monitorSpans);
    context = await browser.newContext({ baseURL: active.baseURL });
    const page = await context.newPage();
    await login(page, email, password);
    await selectOrganization(page, String(setup.data.organization_id));
    const state = await context.storageState(); // memory only; never written to observations
    await context.close(); context = undefined;
    await exit(active.child); active = undefined;
    for (const route of ["/", "/drilldown", "/compare"] as const) {
      for (let index = 0; index < n; index++) {
        spans.length = 0;
        active = await server(env, spans, monitorSpans);
        context = await browser.newContext({ baseURL: active.baseURL, storageState: state });
        const current = await context.newPage();
        samples.push(await sample(current, route, urls[route], "cold_first_visit", spans));
        samples.push(await sample(current, route, urls[route], "warm_repeat", spans));
        if (route !== "/") samples.push(await sample(current, route, urls[route], "navigation", spans));
        await context.close(); context = undefined;
        await exit(active.child); active = undefined;
      }
    }
  } catch (error) { blocker = error instanceof ProfileFailure ? error.code : "profiling_failed_without_safe_diagnostic"; }
  finally {
    try { await context?.close(); await browser?.close(); if (active) await exit(active.child); }
    catch { blocker = "owned_browser_or_server_cleanup_failed"; }
    if (admin && fixture) {
      const cleaned = await admin.rpc("e2e_cleanup_authorized_fiscal_fixture", { p_fixture: fixture });
      if (cleaned.error) blocker = "owned_workspace_cleanup_failed";
    }
    if (admin && userId) { const cleaned = await admin.auth.admin.deleteUser(userId); if (cleaned.error) blocker = "owned_user_cleanup_failed"; }
  }
  const report = { schemaVersion: 1, variant, status: blocker ? "blocked" : "collected", blocker, baselineSha: sha, workingTree: "uncommitted", environment: "local_only", runtime: process.version, productionBuild,
    optimization: { status: "not_attempted", reason: "No measured baseline or real-route revocation evidence; do not promote request memoization." },
    requestedSamplesPerRouteAndTemperature: n, corpus: { electionA: "2023 generales", electionB: "2025 legislativas", category: "DIPUTADO NACIONAL", distrito: "02", seccion: "027", sourceKind: "official", workspace: samples.length ? "synthetic_authorized" : "not_created", corpusStatus: samples.length ? "selected" : "planned_not_sampled" },
    protocol: { cold: "fresh Next process, login readiness probe only; database caches not flushed", warm: "repeat document visit in same process", navigation: "real primary Next Link; selector state may differ from full corpus URL", sqlTiming: "not available", criticalPath: "observed instrumented envelope and parent/interval waterfall; not an inferred SQL dependency graph", completion: "HTTP response finished and main visible; not proof of hydrated evidence completion" },
    sessionMonitor: { spanCount: monitorSpans.length, byOperation: Object.fromEntries([...new Set(monitorSpans.map(span => span.name))].map(name => [name, summarize(monitorSpans.filter(span => span.name === name).map(span => span.durationMs))])) }, summaries: summaries(samples), samples };
  const json = `${JSON.stringify(report, null, 2)}\n`;
  if (Buffer.byteLength(json) > 4_000_000) throw new ProfileFailure("report_size_limit");
  await writeFile(REPORTS[variant], json, { mode: 0o600 });
  console.info(JSON.stringify({ variant, status: report.status, blocker, successfulSamples: samples.filter(sample => sample.outcome === "ok").length }));
  if (blocker) process.exitCode = 1;
}
const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  const variant = process.argv[2] ?? "baseline";
  if (variant !== "baseline" && variant !== "candidate") throw new ProfileFailure("variant_must_be_baseline_or_candidate");
  runProfile(variant, Number(process.argv[3] ?? 10)).catch(() => { console.error("profile_runner_failed_without_safe_diagnostic"); process.exitCode = 1; });
}
