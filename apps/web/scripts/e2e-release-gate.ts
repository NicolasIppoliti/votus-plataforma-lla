import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import {
	cp,
	mkdir,
	readFile,
	readdir,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";
import {
	EXPECTED_E2E_SPECS,
	classifyStaleOwnership,
	planStaleWorkdirReap,
	type GateTestResult,
} from "../e2e/gate-contract.ts";
import {
	SERVER_SCENARIOS,
	planScenarioServers,
	resultScenarioIdentity,
	type ScenarioServer,
	type ServerScenario,
} from "../e2e/scenario-ownership.ts";
import {
	RELEASE_GATE_MODE,
	assertExactMigrationInventory,
	assertStackStatus,
	assertSyntheticMigrationDoesNotCollide,
	assertTs7Version,
	migrationVersionFromFileName,
	cleanupDiagnosticsLine,
	cleanupReleaseGate,
	formatPgTapFailure,
	establishOwnership,
	planOwnedSqlInvocation,
	playwrightCommandArgs,
	reserveUniquePorts,
	runProductionReleasePhases,
	runReleaseGateCli,
	SUPABASE_START_TIMEOUT_MS,
	type PortReservation,
	type ReleaseGateCleanupDependencies,
	type ReleaseGateCleanupState,
	type ReleaseGatePlan,
	type ReleaseGateSyntheticMigration,
} from "./e2e-gate-runtime.ts";
import {
	RELEASE_GATE_TIMING_PHASE,
	createReleaseGateTiming,
} from "./e2e-gate-timing.ts";
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REQUIRE = createRequire(import.meta.url);
const NEXT_CLI = REQUIRE.resolve("next/dist/bin/next");
const WEB_ROOT = path.resolve(SCRIPT_DIR, "..");
const REPO_ROOT = path.resolve(WEB_ROOT, "../..");
const SOURCE_SUPABASE = path.join(REPO_ROOT, "supabase");
const OWNER_FILE = ".votus-e2e-owner.json";
const STALE_AFTER_MS = 30 * 60 * 1000;
const EXCLUDED_SERVICES =
	"realtime,storage-api,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor";
interface OwnedNextServer extends ScenarioServer {
	child: ChildProcess;
}
interface GateState extends ReleaseGateCleanupState<OwnedNextServer> {
	servers?: OwnedNextServer[];
	reservations?: PortReservation[];
	interrupted?: string;
}
interface PlaywrightReceipt {
	suiteStatus: string;
	results: GateTestResult[];
}
function commandResult(
	command: string,
	args: readonly string[],
	cwd = REPO_ROOT,
) {
	return spawnSync(command, args, {
		cwd,
		encoding: "utf8",
		env: process.env,
		stdio: ["ignore", "pipe", "pipe"],
		timeout: 15_000,
	});
}
function requireCommand(
	command: string,
	args: readonly string[],
	label: string,
	cwd = REPO_ROOT,
): string {
	const result = commandResult(command, args, cwd);
	if (result.error || result.status !== 0)
		throw new Error(`${label} is unavailable or failed its preflight check`);
	return result.stdout;
}
function runChecked(
	command: string,
	args: readonly string[],
	label: string,
	cwd = REPO_ROOT,
	environment: NodeJS.ProcessEnv = process.env,
	timeout = 120_000,
): void {
	const result = spawnSync(command, args, {
		cwd,
		env: environment,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
		timeout,
	});
	if (result.error || result.status !== 0)
		throw new Error(
			`${label} failed (exit ${result.status ?? "unavailable"}); output redacted`,
		);
}
function runEvidence(
	command: string,
	args: readonly string[],
	label: string,
	cwd = REPO_ROOT,
	timeout = 120_000,
): void {
	const result = spawnSync(command, args, {
		cwd,
		env: process.env,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
		timeout,
	});
	if (result.error || result.status !== 0)
		throw new Error(formatPgTapFailure(label, result.status, result.stdout));
	process.stdout.write(`${label}:\n${result.stdout.trim()}\n`);
}
async function expandSqlIncludes(
	file: string,
	seen = new Set<string>(),
): Promise<string> {
	const resolved = path.resolve(file);
	if (seen.has(resolved)) throw new Error(`recursive SQL include: ${resolved}`);
	const nextSeen = new Set(seen).add(resolved);
	const lines = (await readFile(resolved, "utf8")).split("\n");
	const expanded: string[] = [];
	for (const line of lines) {
		const include = line.match(/^\\ir\s+(.+)\s*$/);
		expanded.push(
			include
				? await expandSqlIncludes(
						path.resolve(path.dirname(resolved), include[1]!),
						nextSeen,
					)
				: line,
		);
	}
	return expanded.join("\n");
}
function runOwnedSqlEvidence(
	projectId: string,
	sql: string,
	label: string,
	timeout = 120_000,
): void {
	const invocation = planOwnedSqlInvocation(projectId, timeout);
	const result = spawnSync(invocation.command, invocation.args, {
		cwd: REPO_ROOT,
		env: process.env,
		input: sql,
		encoding: "utf8",
		stdio: ["pipe", "pipe", "pipe"],
		timeout: invocation.hostTimeoutMs,
	});
	if (result.error || result.status !== 0)
		throw new Error(
			`${label} failed (exit ${result.status ?? "unavailable"}); output redacted`,
		);
	process.stdout.write(`${label}:\n${result.stdout.trim()}\n`);
}
function replaceExactly(
	source: string,
	pattern: RegExp,
	replacement: string,
	label: string,
): string {
	const match = source.match(pattern);
	if (!match || match.index === undefined)
		throw new Error(
			`cannot isolate Supabase config: expected exactly one ${label}`,
		);
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
				return void server.close(() =>
					reject(new Error("failed to allocate an isolated port")),
				);
			let released = false;
			resolve({
				port: address.port,
				release: async () => {
					if (released) return;
					released = true;
					await new Promise<void>((done, fail) =>
						server.close((error) => (error ? fail(error) : done())),
					);
				},
			});
		});
	});
}
async function readExactSourceMigrationNames(
	expectedMigrations: readonly string[],
	syntheticMigration: ReleaseGateSyntheticMigration,
): Promise<readonly string[]> {
	const entries = await readdir(path.join(SOURCE_SUPABASE, "migrations"), {
		withFileTypes: true,
	});
	const migrationEntries = entries.filter((entry) => entry.name.endsWith(".sql"));
	for (const entry of migrationEntries)
		if (!entry.isFile())
			throw new Error(
				`production migration inventory entry must be a regular file: ${entry.name}`,
			);
	const migrationFiles = migrationEntries.map(({ name }) => name).sort();
	const versions = migrationFiles.map(migrationVersionFromFileName);
	assertExactMigrationInventory(versions, expectedMigrations);
	assertSyntheticMigrationDoesNotCollide(migrationFiles, syntheticMigration);
	return migrationFiles;
}

async function assertE2eSpecInventory(): Promise<void> {
	const specFiles = (await readdir(path.join(WEB_ROOT, "e2e")))
		.filter((name) => name.endsWith(".spec.ts"))
		.map((name) => `e2e/${name}`)
		.sort();
	if (
		JSON.stringify(specFiles) !== JSON.stringify([...EXPECTED_E2E_SPECS].sort())
	)
		throw new Error(
			"Playwright spec inventory must be exactly the eight release-gate specs",
		);
}

export async function assertSourceInventory(
	expectedMigrations: readonly string[],
	syntheticMigration: ReleaseGateSyntheticMigration,
): Promise<readonly string[]> {
	const migrationNames = await readExactSourceMigrationNames(
		expectedMigrations,
		syntheticMigration,
	);
	await assertE2eSpecInventory();
	return migrationNames;
}
function assertIsolationCapabilities(requireBrowser: boolean): void {
	requireCommand("pnpm", ["--version"], "pnpm");
	requireCommand("docker", ["info", "--format", "{{.ServerVersion}}"], "Docker");
	requireCommand("supabase", ["--version"], "Supabase CLI");
	assertTs7Version(
		requireCommand(
			"pnpm",
			["exec", "tsc", "--version"],
			"TypeScript compiler",
			WEB_ROOT,
		),
	);
	const startHelp = requireCommand(
		"supabase",
		["start", "--help"],
		"Supabase start",
	);
	const stopHelp = requireCommand(
		"supabase",
		["stop", "--help"],
		"Supabase stop",
	);
	if (
		!startHelp.includes("--workdir") ||
		!startHelp.includes("--ignore-health-check") ||
		!stopHelp.includes("--project-id") ||
		!stopHelp.includes("--no-backup")
	)
		throw new Error(
			"Supabase CLI lacks the isolation and owned-cleanup flags required by the gate",
		);
	if (requireBrowser && !existsSync(chromium.executablePath()))
		throw new Error(
			"Playwright Chromium is not installed; run the package-supported browser install first",
		);
}
async function createIsolatedWorkdir(
	nextPort: number,
	ports: readonly number[],
	migrationNames: readonly string[],
	state: GateState,
): Promise<void> {
	// Docker truncation can make an exact-id stop miss containers; keep this under 40.
	const token = randomUUID();
	const projectId = `votus-e2e-${token.replaceAll("-", "").slice(0, 20)}`;
	const workdir = path.join(os.tmpdir(), `votus-e2e-${token}`);
	const ownership = { workdir, projectId, token };
	establishOwnership(state, ownership, {
		createWorkdir: () => mkdirSync(workdir, { mode: 0o700 }),
		writeMarker: () =>
			writeFileSync(
				path.join(workdir, OWNER_FILE),
				`${JSON.stringify(ownership)}\n`,
				{ mode: 0o600 },
			),
		rollbackWorkdir: () => rmSync(workdir, { recursive: true, force: true }),
	});
	const targetSupabase = path.join(workdir, "supabase");
	await mkdir(path.join(targetSupabase, "migrations"), { recursive: true });
	for (const name of migrationNames.slice(0, 12))
		await cp(
			path.join(SOURCE_SUPABASE, "migrations", name),
			path.join(targetSupabase, "migrations", name),
		);
	await cp(
		path.join(SOURCE_SUPABASE, "config.toml"),
		path.join(targetSupabase, "config.toml"),
	);
	let config = await readFile(path.join(targetSupabase, "config.toml"), "utf8");
	config = replaceExactly(
		config,
		/^project_id = .+$/m,
		`project_id = "${projectId}"`,
		"project_id",
	);
	const portLabels = [
		["api", /^port = 54321$/m, ports[0]],
		["db", /^port = 54322$/m, ports[1]],
		["shadow db", /^shadow_port = 54320$/m, ports[2]],
		["studio", /^port = 54323$/m, ports[3]],
		["mailpit", /^port = 54324$/m, ports[4]],
		["smtp", /^# smtp_port = 54325$/m, ports[5]],
		["pop3", /^# pop3_port = 54326$/m, ports[6]],
		["analytics", /^port = 54327$/m, ports[7]],
		["pooler", /^port = 54329$/m, ports[8]],
		["edge inspector", /^inspector_port = 8083$/m, ports[9]],
	] as const;
	for (const [label, pattern, port] of portLabels)
		config = replaceExactly(
			config,
			pattern,
			`${label === "shadow db" ? "shadow_port" : label === "edge inspector" ? "inspector_port" : label === "smtp" ? "smtp_port" : label === "pop3" ? "pop3_port" : "port"} = ${port}`,
			`${label} port`,
		);
	config = replaceExactly(
		config,
		/^site_url = .+$/m,
		`site_url = "http://127.0.0.1:${nextPort}"`,
		"auth site_url",
	);
	config = replaceExactly(
		config,
		/^additional_redirect_urls = .+$/m,
		`additional_redirect_urls = ["http://127.0.0.1:${nextPort}"]`,
		"auth redirects",
	);
	config = replaceExactly(
		config,
		/(\[db\.seed\](?:(?!\n\[)[\s\S])*?\n)enabled = true/,
		"$1enabled = false",
		"seed setting",
	);
	await writeFile(path.join(targetSupabase, "config.toml"), config, {
		mode: 0o600,
	});
}
async function installProductionMigrations(
	workdir: string,
	migrationNames: readonly string[],
): Promise<void> {
	const targetMigrations = path.join(workdir, "supabase", "migrations");
	for (const name of migrationNames.slice(12))
		await cp(
			path.join(SOURCE_SUPABASE, "migrations", name),
			path.join(targetMigrations, name),
		);
}
async function installSyntheticMigration(
	workdir: string,
	migration: ReleaseGateSyntheticMigration,
): Promise<void> {
	const targetMigrations = path.join(workdir, "supabase", "migrations");
	const productionFileNames = (await readdir(targetMigrations)).filter((name) =>
		/^\d{4}_.+\.sql$/.test(name),
	);
	assertSyntheticMigrationDoesNotCollide(productionFileNames, migration);
	await cp(
		path.join(WEB_ROOT, migration.sourcePath),
		path.join(targetMigrations, migration.fileName),
	);
}
async function waitForServer(url: string, child: ChildProcess): Promise<void> {
	const deadline = Date.now() + 60_000;
	while (Date.now() < deadline) {
		if (child.exitCode !== null)
			throw new Error("production Next server exited before becoming ready");
		try {
			const response = await fetch(url, { redirect: "manual" });
			if (response.status < 500) return;
		} catch {
			/* still binding */
		}
		await new Promise((resolve) => setTimeout(resolve, 250));
	}
	throw new Error(
		"production Next server did not become ready within 60 seconds",
	);
}
export async function runPlaywright(
	environment: NodeJS.ProcessEnv,
	receiptPath: string,
	selectedSpecs: readonly string[],
): Promise<void> {
	const result = spawnSync("pnpm", playwrightCommandArgs(selectedSpecs), {
		cwd: WEB_ROOT,
		env: environment,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	});
	if (!result.error && result.status === 0) return;
	let summary = "no reporter receipt";
	try {
		const receipt = JSON.parse(
			await readFile(receiptPath, "utf8"),
		) as PlaywrightReceipt;
		const counts = new Map<string, number>();
		for (const testResult of receipt.results)
			counts.set(testResult.status, (counts.get(testResult.status) ?? 0) + 1);
		summary = `${receipt.results.length} discovered, ${[...counts.entries()]
			.map(([status, count]) => `${status}=${count}`)
			.join(", ")}, suite=${receipt.suiteStatus}, non-passing=[${receipt.results
			.filter(({ status }) => status !== "passed")
			.map(({ spec, status, failureLine }) =>
				`${spec}:${status}${failureLine === undefined ? "" : `@${failureLine}`}`,
			)
			.join(", ")}]`;
	} catch {
		/* missing receipt is a failure */
	}
	throw new Error(
		`Playwright release suite failed (exit ${result.status ?? "unavailable"}; ${summary}); output redacted`,
	);
}
async function stopChild(child: ChildProcess): Promise<void> {
	if (child.exitCode !== null) return;
	child.kill("SIGTERM");
	await Promise.race([
		new Promise<void>((resolve) => child.once("exit", () => resolve())),
		new Promise<void>((resolve) => setTimeout(resolve, 5_000)),
	]);
	if (child.exitCode === null) {
		child.kill("SIGKILL");
		await Promise.race([
			new Promise<void>((resolve) => child.once("exit", () => resolve())),
			new Promise<never>((_, reject) =>
				setTimeout(() => reject(new Error("Next server did not stop")), 5_000),
			),
		]);
	}
}
async function verifyServerStopped(server: OwnedNextServer): Promise<void> {
	if (server.child.exitCode === null)
		throw new Error(
			`production Next server still runs: ${server.scenario}:${server.port}`,
		);
}
function listOwnedContainers(projectId: string): readonly string[] {
	const result = commandResult("docker", [
		"ps",
		"-a",
		"--filter",
		`name=${projectId}`,
		"--format",
		"{{.Names}}",
	]);
	if (result.error || result.status !== 0)
		throw new Error("failed to enumerate disposable Supabase containers");
	return result.stdout.split("\n").filter(Boolean);
}
function listOwnedVolumes(projectId: string): readonly string[] {
	const result = commandResult("docker", [
		"volume",
		"ls",
		"--filter",
		`name=${projectId}`,
		"--format",
		"{{.Name}}",
	]);
	if (result.error || result.status !== 0)
		throw new Error("failed to enumerate disposable Supabase volumes");
	return result.stdout.split("\n").filter(Boolean);
}
export function listOwnedNetworks(projectId: string): readonly string[] {
	const result = commandResult("docker", [
		"network",
		"ls",
		"--filter",
		`name=supabase_network_${projectId}`,
		"--format",
		"{{.Name}}",
	]);
	if (result.error || result.status !== 0)
		throw new Error("failed to enumerate disposable Supabase networks");
	return result.stdout.split("\n").filter(Boolean);
}
const RELEASE_GATE_CLEANUP_DEPENDENCIES: ReleaseGateCleanupDependencies<OwnedNextServer> =
	{
		tempRoot: () => os.tmpdir(),
		readOwnershipMarker: (workdir) =>
			readFile(path.join(workdir, OWNER_FILE), "utf8"),
		stopServer: ({ child }) => stopChild(child),
		verifyServerStopped,
		stopStack: (workdir, projectId) => {
			runChecked(
				"supabase",
				[
					"stop",
					"--workdir",
					workdir,
					"--project-id",
					projectId,
					"--no-backup",
					"--yes",
				],
				"disposable Supabase cleanup",
				REPO_ROOT,
				process.env,
				15_000,
			);
			return Promise.resolve();
		},
		listOwnedContainers,
		removeContainers: (containers) => {
			runChecked(
				"docker",
				["rm", "-f", ...containers],
				"owned Supabase container cleanup",
				REPO_ROOT,
				process.env,
				15_000,
			);
			return Promise.resolve();
		},
		listOwnedVolumes,
		removeVolumes: (volumes) => {
			runChecked(
				"docker",
				["volume", "rm", ...volumes],
				"owned Supabase volume cleanup",
				REPO_ROOT,
				process.env,
				15_000,
			);
			return Promise.resolve();
		},
		listOwnedNetworks,
		removeNetworks: removeOwnedNetworks,
		removeWorkdir: (workdir) => rm(workdir, { recursive: true }),
		workdirExists: existsSync,
	};
export function removeOwnedNetworks(networks: readonly string[]): Promise<void> {
	runChecked(
		"docker",
		["network", "rm", "--", ...networks],
		"owned Supabase network cleanup",
		REPO_ROOT,
		process.env,
		15_000,
	);
	return Promise.resolve();
}
function markerStrings(
	marker: unknown,
): { workdir: string; projectId: string } | undefined {
	if (!marker || typeof marker !== "object") return undefined;
	const value = marker as Record<string, unknown>;
	if (
		typeof value["workdir"] !== "string" ||
		typeof value["projectId"] !== "string"
	)
		return undefined;
	return { workdir: value["workdir"], projectId: value["projectId"] };
}
async function matchesRepository(
	candidate: string,
	expectedMigrations: readonly string[],
	syntheticMigration: ReleaseGateSyntheticMigration,
): Promise<boolean> {
	try {
		const target = path.join(candidate, "supabase", "migrations");
		const sourceNames = await readExactSourceMigrationNames(
			expectedMigrations,
			syntheticMigration,
		);
		const targetEntries = (await readdir(target, { withFileTypes: true })).filter(
			(entry) => entry.name.endsWith(".sql"),
		);
		if (targetEntries.some((entry) => !entry.isFile())) return false;
		const targetNames = targetEntries
			.map(({ name }) => name)
			.sort();
		for (const name of targetNames) migrationVersionFromFileName(name);
		assertSyntheticMigrationDoesNotCollide(sourceNames, syntheticMigration);
		const expected = [...sourceNames, syntheticMigration.fileName].sort();
		if (JSON.stringify(targetNames) !== JSON.stringify(expected)) return false;
		for (const name of sourceNames)
			if (
				(await readFile(path.join(target, name), "utf8")) !==
				(await readFile(path.join(SOURCE_SUPABASE, "migrations", name), "utf8"))
			)
				return false;
		return (
			(await readFile(path.join(target, syntheticMigration.fileName), "utf8")) ===
			(await readFile(path.join(WEB_ROOT, syntheticMigration.sourcePath), "utf8"))
		);
	} catch {
		return false;
	}
}
function matchingProcessActive(
	workdir: string,
	projectId: string,
): boolean | undefined {
	const result = commandResult("ps", ["-axo", "command="]);
	if (result.error || result.status !== 0) return undefined;
	return result.stdout
		.split("\n")
		.some((line) => line.includes(workdir) || line.includes(projectId));
}
export function matchingProjectResourcesActive(
	projectId: string,
): boolean | undefined {
	const checks = [
		["ps", "-a", "--filter", `name=${projectId}`, "--format", "{{.Names}}"],
		["volume", "ls", "--filter", `name=${projectId}`, "--format", "{{.Name}}"],
		["network", "ls", "--filter", `name=supabase_network_${projectId}`, "--format", "{{.Name}}"],
	] as const;
	let active = false;
	for (const args of checks) {
		const result = commandResult("docker", args);
		if (result.error || result.status !== 0) return undefined;
		if (result.stdout.trim()) active = true;
	}
	return active;
}
async function reapStaleOwnedWorkdirs(
	expectedMigrations: readonly string[],
	syntheticMigration: ReleaseGateSyntheticMigration,
): Promise<void> {
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
		} catch {
			continue;
		}
		const strings = markerStrings(marker);
		const evidence = {
			tempRoot,
			expectedWorkdir: candidate,
			marker,
			ageMs: markerAgeMs,
			staleAfterMs: STALE_AFTER_MS,
			repositoryMatches: await matchesRepository(
				candidate,
				expectedMigrations,
				syntheticMigration,
			),
			ownerProcessActive: strings
				? matchingProcessActive(strings.workdir, strings.projectId)
				: undefined,
			projectResourcesActive: strings
				? matchingProjectResourcesActive(strings.projectId)
				: undefined,
		};
		if (classifyStaleOwnership(evidence) !== "reap") continue;
		for (const action of planStaleWorkdirReap(evidence))
			await rm(action.workdir, { recursive: true });
	}
}
const DATA_SPEC_BY_SCENARIO = {
	comparison: "e2e/comparison.spec.ts",
	fiscalizacion: "e2e/fiscalizacion.spec.ts",
	municipal: "e2e/municipal.spec.ts",
	provenance: "e2e/provenance.spec.ts",
} as const;
function productEnvironment(
	common: NodeJS.ProcessEnv,
	scenario: ServerScenario,
): NodeJS.ProcessEnv {
	const spec =
		scenario === "shared" ? undefined : DATA_SPEC_BY_SCENARIO[scenario];
	const identity = spec ? resultScenarioIdentity(spec) : undefined;
	const prefix = `e2e-${scenario}`;
	return {
		...common,
		CORONEL_ROSALES_JURISDICTION_ID:
			identity?.jurisdictionId ?? `${prefix}-unused-jurisdiction`,
		MUNICIPAL_ELECTION_ID:
			identity && scenario === "municipal"
				? identity.electionIds[0]
				: `${prefix}-unused-municipal-election`,
		MUNICIPAL_CATEGORY_ID:
			identity && scenario === "municipal"
				? identity.categoryId
				: `${prefix}-unused-municipal-category`,
		FISCALIZACION_ELECTION_ID:
			identity && scenario === "fiscalizacion"
				? identity.electionIds[0]
				: `${prefix}-unused-fiscalizacion-election`,
		FISCALIZACION_CATEGORY_ID:
			identity && scenario === "fiscalizacion"
				? identity.categoryId
				: `${prefix}-unused-fiscalizacion-category`,
	};
}
async function executeGate(
	state: GateState,
	plan: ReleaseGatePlan,
	timing: ReturnType<typeof createReleaseGateTiming>,
): Promise<void> {
	const migrationNames = await timing.measure(
		RELEASE_GATE_TIMING_PHASE.PREFLIGHT_PORTS,
		async () =>
			await assertSourceInventory(
				plan.migrationVersions,
				plan.syntheticMigration,
			),
	);
	await timing.measure(RELEASE_GATE_TIMING_PHASE.PREFLIGHT_PORTS, async () => {
		assertIsolationCapabilities(plan.requireBrowserCapability);
	});
	await timing.measure(
		RELEASE_GATE_TIMING_PHASE.PREFLIGHT_PORTS,
		async () =>
			await reapStaleOwnedWorkdirs(
				plan.migrationVersions,
				plan.syntheticMigration,
			),
	);
	const reservations = await timing.measure(
		RELEASE_GATE_TIMING_PHASE.PREFLIGHT_PORTS,
		async () =>
			await reserveUniquePorts(10 + SERVER_SCENARIOS.length, reservePort),
	);
	state.reservations = reservations;
	const nextReservations = reservations.slice(0, SERVER_SCENARIOS.length);
	const supabaseReservations = reservations.slice(SERVER_SCENARIOS.length);
	if (
		nextReservations.length !== SERVER_SCENARIOS.length ||
		supabaseReservations.length !== 10
	)
		throw new Error("port reservation failed");
	const serverPlan = planScenarioServers(
		nextReservations.map(({ port }) => port),
	);
	const nextPort = serverPlan[0]!.port;
	const supabasePorts = supabaseReservations.map(({ port }) => port);
	await timing.measure(RELEASE_GATE_TIMING_PHASE.PREFLIGHT_PORTS, async () => {
		await createIsolatedWorkdir(nextPort, supabasePorts, migrationNames, state);
	});
	const ownership = state.ownership;
	if (!ownership) throw new Error("disposable ownership was not established");
	for (const reservation of supabaseReservations) await reservation.release();
	if (state.interrupted) throw new Error(`interrupted by ${state.interrupted}`);
	state.stackMutationAttempted = true;
	await timing.measure(RELEASE_GATE_TIMING_PHASE.SUPABASE_STARTUP, async () => {
		runChecked(
			"supabase",
			[
				"start",
				"--workdir",
				ownership.workdir,
				"--exclude",
				EXCLUDED_SERVICES,
				"--ignore-health-check",
				"--yes",
			],
			"disposable Supabase start",
			REPO_ROOT,
			process.env,
			SUPABASE_START_TIMEOUT_MS,
		);
	});
	const timed =
		<TArgs extends unknown[], TResult>(
			phase: (typeof RELEASE_GATE_TIMING_PHASE)[keyof typeof RELEASE_GATE_TIMING_PHASE],
			action: (...args: TArgs) => Promise<TResult>,
		) =>
		async (...args: TArgs): Promise<TResult> =>
			await timing.measure(phase, async () => await action(...args));
	const stack = await runProductionReleasePhases(plan, {
		runProductionMigrations: timed(
			RELEASE_GATE_TIMING_PHASE.MIGRATIONS,
			async () => {
				await installProductionMigrations(ownership.workdir, migrationNames);
				runChecked(
					"supabase",
					[
						"migration",
						"up",
						"--local",
						"--include-all",
						"--workdir",
						ownership.workdir,
						"--yes",
					],
					"disposable Supabase incremental migrations",
				);
			},
		),
		validateStackStatus: async () => {
			const statusOutput = requireCommand(
				"supabase",
				["status", "--workdir", ownership.workdir, "-o", "json"],
				"disposable Supabase status",
			);
			return assertStackStatus(
				statusOutput,
				supabasePorts[0]!,
				supabasePorts[1]!,
			);
		},
		runSetupProof: timed(RELEASE_GATE_TIMING_PHASE.PGTAP, async (proof) => {
			runOwnedSqlEvidence(
				ownership.projectId,
				await expandSqlIncludes(path.join(SOURCE_SUPABASE, proof.path)),
				proof.label,
				proof.timeoutMs,
			);
		}),
		runPgTapProof: timed(RELEASE_GATE_TIMING_PHASE.PGTAP, async (proof) => {
			runEvidence(
				"supabase",
				[
					"test",
					"db",
					path.join(SOURCE_SUPABASE, proof.path),
					"--local",
					"--workdir",
					ownership.workdir,
				],
				proof.label,
				REPO_ROOT,
				proof.timeoutMs,
			);
		}),
		runPostPgTapCleanupProof: timed(
			RELEASE_GATE_TIMING_PHASE.PGTAP,
			async (proof) => {
				runOwnedSqlEvidence(
					ownership.projectId,
					await expandSqlIncludes(path.join(SOURCE_SUPABASE, proof.path)),
					proof.label,
					proof.timeoutMs,
				);
			},
		),
		runRollbackReapplyProof: timed(
			RELEASE_GATE_TIMING_PHASE.ROLLBACK_REAPPLY,
			async (proof) => {
				runOwnedSqlEvidence(
					ownership.projectId,
					await expandSqlIncludes(path.join(SOURCE_SUPABASE, proof.path)),
					proof.label,
				);
			},
		),
		installSyntheticMigration: timed(
			RELEASE_GATE_TIMING_PHASE.ROLLBACK_REAPPLY,
			async (migration) => {
				await installSyntheticMigration(ownership.workdir, migration);
				runChecked(
					"supabase",
					[
						"migration",
						"up",
						"--local",
						"--include-all",
						"--workdir",
						ownership.workdir,
						"--yes",
					],
					"disposable Supabase synthetic migration",
				);
			},
		),
	});
	if (!plan.runBrowser) return;
	const baseURLs = Object.fromEntries(
		serverPlan.map(({ scenario, port }) => [
			scenario,
			`http://127.0.0.1:${port}`,
		]),
	) as Record<ServerScenario, string>;
	const environment: NodeJS.ProcessEnv = {
		...process.env,
		NEXT_PUBLIC_SUPABASE_URL: stack.API_URL,
		NEXT_PUBLIC_SUPABASE_ANON_KEY: stack.ANON_KEY,
		SUPABASE_SERVICE_ROLE_KEY: stack.SERVICE_ROLE_KEY,
		VOTUS_E2E_TEST_USER_EMAIL: `votus-e2e-${randomUUID()}@example.test`,
		VOTUS_E2E_TEST_USER_PASSWORD: randomBytes(24).toString("base64url"),
		VOTUS_E2E_BASE_URL: baseURLs.shared,
		VOTUS_E2E_BASE_URL_COMPARISON: baseURLs.comparison,
		VOTUS_E2E_BASE_URL_FISCALIZACION: baseURLs.fiscalizacion,
		VOTUS_E2E_BASE_URL_MUNICIPAL: baseURLs.municipal,
		VOTUS_E2E_BASE_URL_PROVENANCE: baseURLs.provenance,
		VOTUS_E2E_STORAGE_STATE: path.join(
			ownership.workdir,
			"authenticated-state.json",
		),
		VOTUS_E2E_RESULT_FILE: path.join(ownership.workdir, "playwright-result.json"),
		VOTUS_E2E_GATE_MODE: plan.mode,
		VOTUS_E2E_SELECTED_SPECS: JSON.stringify(plan.selectedSpecs),
	};
	await timed(RELEASE_GATE_TIMING_PHASE.PRODUCTION_BUILD, async () => {
		runChecked(
			"pnpm",
			["build:next"],
			"production Next build",
			WEB_ROOT,
			productEnvironment(environment, "shared"),
		);
	})();
	if (state.interrupted) throw new Error(`interrupted by ${state.interrupted}`);
	await timed(RELEASE_GATE_TIMING_PHASE.NEXT_SERVER_LIFECYCLE, async () => {
		state.servers = [];
		for (const [index, server] of serverPlan.entries()) {
			await nextReservations[index]!.release();
			const child = spawn(
				process.execPath,
				[NEXT_CLI, "start", "-H", "127.0.0.1", "-p", String(server.port)],
				{
					cwd: WEB_ROOT,
					env: productEnvironment(environment, server.scenario),
					stdio: "ignore",
				},
			);
			state.servers.push({ ...server, child });
			await waitForServer(`${baseURLs[server.scenario]}/login`, child);
		}
	})();
	await timed(RELEASE_GATE_TIMING_PHASE.PLAYWRIGHT, async () => {
		await runPlaywright(
			environment,
			environment.VOTUS_E2E_RESULT_FILE!,
			plan.selectedSpecs,
		);
	})();
}
async function executeReleaseGatePlan(plan: ReleaseGatePlan): Promise<void> {
	const state: GateState = { stackMutationAttempted: false };
	const timing = createReleaseGateTiming({
		now: () => Date.now(),
		writeOutput: (chunk) => process.stdout.write(chunk),
	});
	const emitTiming = () => {
		try {
			timing.emit();
		} catch {
			/* Timing output must not replace a gate result. */
		}
	};
	let cleanupPromise: Promise<void> | undefined;
	const cleanOnce = () =>
		(cleanupPromise ??= cleanupReleaseGate(
			state,
			RELEASE_GATE_CLEANUP_DEPENDENCIES,
		));
	for (const signal of ["SIGINT", "SIGTERM"] as const) {
		process.once(signal, () => {
			state.interrupted = signal;
			void Promise.race([
				timing.measure(RELEASE_GATE_TIMING_PHASE.CLEANUP, cleanOnce),
				new Promise<never>((_, reject) =>
					setTimeout(() => reject(new Error("signal cleanup timed out")), 120_000),
				),
			])
				.catch((error: unknown) =>
					reportReleaseGateFailure("E2E signal cleanup failed", error),
				)
				.finally(() => {
					emitTiming();
					process.exit(signal === "SIGINT" ? 130 : 143);
				});
		});
	}
	let failure: unknown;
	try {
		await executeGate(state, plan, timing);
	} catch (error) {
		failure = error;
	}
	try {
		await timing.measure(RELEASE_GATE_TIMING_PHASE.CLEANUP, cleanOnce);
	} catch (error) {
		failure = failure
			? new AggregateError(
					[failure, error],
					"gate execution and cleanup both failed",
				)
			: error;
	}
	emitTiming();
	if (failure) throw failure;
	process.stdout.write(
		plan.mode === RELEASE_GATE_MODE.ROLLBACK_PROOFS_ONLY
			? "Rollback proofs passed: 2 SQL processes, cleanup complete\n"
			: plan.mode === RELEASE_GATE_MODE.SCALE_PROOF_ONLY
				? "Scale proof passed: fixture setup, pgTAP/EXPLAIN, and cleanup complete\n"
				: plan.mode === RELEASE_GATE_MODE.RELEASE_PROOF_ONLY
					? "Release proof passed: coverage scope binding, rollback/reapply, scale, pgTAP, and cleanup complete\n"
					: plan.mode === RELEASE_GATE_MODE.FOCUSED
						? `Focused E2E diagnostic passed: selected=${plan.selectedSpecs.length}, discovered=${plan.selectedSpecs.length}, excluded=${EXPECTED_E2E_SPECS.length - plan.selectedSpecs.length}, skipped=0, disposable stack cleaned\n`
						: "E2E release gate passed: 8 passed, 0 skipped, disposable stack cleaned\n",
	);
}
export function reportReleaseGateFailure(
	label: string,
	error: unknown,
	writeError: (chunk: string) => void = (chunk) => process.stderr.write(chunk),
): void {
	writeError(`${label}: details redacted\n`);
	const diagnostics = cleanupDiagnosticsLine(error);
	if (diagnostics) writeError(`${diagnostics}\n`);
}

export interface ReleaseGateMainDependencies {
	executePlan?(plan: ReleaseGatePlan): Promise<void>;
	writeOutput?(chunk: string): void;
}

export async function releaseGateMain(
	argv: readonly string[] = process.argv.slice(2),
	dependencies: ReleaseGateMainDependencies = {},
): Promise<void> {
	await runReleaseGateCli(argv, {
		execute: dependencies.executePlan ?? executeReleaseGatePlan,
		writeOutput:
			dependencies.writeOutput ??
			((chunk) => {
				process.stdout.write(chunk);
			}),
	});
}
const directEntry = process.argv[1];
if (directEntry && path.resolve(directEntry) === fileURLToPath(import.meta.url))
	void releaseGateMain().catch((error: unknown) => {
		reportReleaseGateFailure("E2E release gate failed", error);
		process.exitCode = 1;
	});
