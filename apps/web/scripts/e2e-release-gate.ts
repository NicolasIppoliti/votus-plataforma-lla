import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { closeSync, existsSync, fsyncSync, linkSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
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
import { OwnedEtlFailure, startOwnedEtlChild } from "./owned-etl-child.ts";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";
import { z } from "zod";
import { PlaywrightFailure, playwrightFailure } from "../e2e/playwright-failure-diagnostics.ts";
import {
	EXPECTED_E2E_SPECS,
	classifyStaleOwnership,
	planStaleWorkdirReap,
	planOwnedCleanup,
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
	ReleaseGateCleanupError,
	cleanupReleaseGate,
	createReleaseGatePlan,
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
	type ReleaseGateRecoveryRecord,
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
const PGTAP_PROOFS = createReleaseGatePlan(RELEASE_GATE_MODE.FULL).pgTapProofs;
const SPAWN_ERROR_CODES = [
	"EACCES", "EAGAIN", "EFAULT", "EINTR", "EINVAL", "EIO",
	"EMFILE", "ENFILE", "ENOENT", "ENOMEM", "ENOBUFS", "ETIMEDOUT",
];
const RELEASE_GATE_FAILURE_OPERATION = {
	PGTAP: "pgtap",
	SUPABASE_START: "supabase_start",
	SUPABASE_NETWORK_CREATE: "supabase_network_create",
	SUPABASE_PUBLICATION_INSPECT: "supabase_publication_inspect",
	SUPABASE_PUBLICATION_VALIDATE: "supabase_publication_validate",
	OWNED_DB_IDENTITY_VALIDATE: "owned_db_identity_validate",
	OWNED_DB_MARKER_VALIDATE: "owned_db_marker_validate",
	OWNED_DB_PUBLICATION_VALIDATE: "owned_db_publication_validate",
	OWNED_DB_STATUS_VALIDATE: "owned_db_status_validate",
	OWNED_DB_IDENTITY_INSPECT: "owned_db_identity_inspect",
	OWNED_DB_STATUS_COMMAND: "owned_db_status_command",
	OWNED_ETL_CHILD_LAUNCH: "owned_etl_child_launch",
	OWNED_ETL_RUNNER_BOOTSTRAP: "owned_etl_runner_bootstrap",
} as const;
type ReleaseGateFailureOperation =
	(typeof RELEASE_GATE_FAILURE_OPERATION)[keyof typeof RELEASE_GATE_FAILURE_OPERATION];
const RELEASE_GATE_FAILURE_REASON = {
	COMMAND_FAILED: "command_failed",
	INVALID_PUBLICATION: "invalid_publication",
	INVALID_IDENTITY: "invalid_identity",
	INVALID_STATUS: "invalid_status",
	LAUNCH_FAILED: "launch_failed",
} as const;
type ReleaseGateFailureReason =
	(typeof RELEASE_GATE_FAILURE_REASON)[keyof typeof RELEASE_GATE_FAILURE_REASON];
const PUBLICATION_ISSUE = {
	RECORD_COUNT: "record_count",
	ZERO_BINDINGS: "zero_bindings",
	MULTIPLE_BINDINGS: "multiple_bindings",
	EXTRA_PORT_KEY: "extra_port_key",
	SHAPE: "shape",
	UNPUBLISHED: "unpublished",
	HOST_IP: "host_ip",
	HOST_PORT: "host_port",
	UNCLASSIFIED: "unclassified",
} as const;
type PublicationIssue = (typeof PUBLICATION_ISSUE)[keyof typeof PUBLICATION_ISSUE];
const BINDING_COUNT = ["zero", "one", "multiple", "invalid"] as const;
const BINDING_HOST_CLASS = ["expected_ipv4_loopback", "other_ipv4_loopback", "ipv6_loopback", "wildcard_ipv4", "wildcard_ipv6", "unspecified", "other_host", "malformed_host"] as const;
const BINDING_PORT_CLASS = ["expected", "empty", "other", "malformed"] as const;
const bindingSummarySchema = z.strictObject({
	count: z.enum(BINDING_COUNT),
	exactMatches: z.enum(BINDING_COUNT),
	hosts: z.array(z.enum(BINDING_HOST_CLASS)).max(BINDING_HOST_CLASS.length),
	ports: z.array(z.enum(BINDING_PORT_CLASS)).max(BINDING_PORT_CLASS.length),
	malformedEntries: z.enum(BINDING_COUNT),
});
const publicationDiagnosticSchema = z.strictObject({
	stage: z.enum(["json", "schema", "unexpected"]),
	issues: z.array(z.enum(Object.values(PUBLICATION_ISSUE))).max(Object.keys(PUBLICATION_ISSUE).length),
	bindingEvidence: z.strictObject({ requested: bindingSummarySchema, observed: bindingSummarySchema }).optional(),
});
type PublicationDiagnostic = z.infer<typeof publicationDiagnosticSchema>;

function bindingCount(value: number): (typeof BINDING_COUNT)[number] {
	return value === 0 ? "zero" : value === 1 ? "one" : "multiple";
}

function summarizeBindings(bindings: readonly unknown[], expectedPort: string): z.infer<typeof bindingSummarySchema> {
	let exactMatches = 0;
	let malformedEntries = 0;
	const hosts = new Set<(typeof BINDING_HOST_CLASS)[number]>();
	const ports = new Set<(typeof BINDING_PORT_CLASS)[number]>();
	for (const value of bindings) {
		const binding = value && typeof value === "object" && !Array.isArray(value)
			? value as Record<string, unknown> : null;
		const exactShape = binding !== null && Object.keys(binding).sort().join(",") === "HostIp,HostPort";
		if (!exactShape) malformedEntries++;
		const hostIp = binding?.HostIp;
		const host = hostIp === "127.0.0.1" ? "expected_ipv4_loopback"
			: typeof hostIp === "string" && net.isIP(hostIp) === 4 && hostIp.startsWith("127.") ? "other_ipv4_loopback"
				: hostIp === "::1" ? "ipv6_loopback"
				: hostIp === "0.0.0.0" ? "wildcard_ipv4"
					: hostIp === "::" ? "wildcard_ipv6"
						: hostIp === "" ? "unspecified"
							: typeof hostIp === "string" && net.isIP(hostIp) !== 0 ? "other_host" : "malformed_host";
		const hostPort = binding?.HostPort;
		const port = hostPort === expectedPort ? "expected" : hostPort === "" ? "empty"
			: typeof hostPort === "string" && /^[0-9]+$/.test(hostPort) && Number(hostPort) >= 1 && Number(hostPort) <= 65_535 ? "other" : "malformed";
		hosts.add(host);
		ports.add(port);
		if (exactShape && host === "expected_ipv4_loopback" && port === "expected") exactMatches++;
	}
	return {
		count: bindingCount(bindings.length),
		exactMatches: bindingCount(exactMatches),
		hosts: BINDING_HOST_CLASS.filter((host) => hosts.has(host)),
		ports: BINDING_PORT_CLASS.filter((port) => ports.has(port)),
		malformedEntries: bindingCount(malformedEntries),
	};
}
interface PgTapDiagnostic {
	proof: string | null;
	signal: string | null;
	spawnErrorCode: string | null;
	sqlstates: string[];
	failedAssertions: number[];
}
interface ReleaseGateFailureMetadata {
	operation: ReleaseGateFailureOperation;
	reason: ReleaseGateFailureReason;
	exitCode: number | null;
	publicationDiagnostic?: PublicationDiagnostic;
	pgTapDiagnostic?: PgTapDiagnostic;
}
class ReleaseGateFailure extends Error {
	readonly metadata: ReleaseGateFailureMetadata;

	constructor(message: string, metadata: ReleaseGateFailureMetadata) {
		super(message);
		this.metadata = metadata;
	}
}
// This capability lives only as long as the parent's marker-owned database stack.
// All SQL input is generated here; bootstrap authority is never passed to the child.
function provisionOwnedMigrationRunner(containerId: string): string {
	const token = randomUUID();
	const role = `votus_etl_runner_${token.replaceAll("-", "")}`;
	const password = randomBytes(32).toString("base64url");
	const marker = `votus-etl-runner:${token}`;
	const sql = `\\set QUIET 1
BEGIN;
SET LOCAL log_statement = 'none';
SET LOCAL log_min_error_statement = 'panic';
DO $bootstrap$
BEGIN
  IF session_user <> 'supabase_admin' OR current_user <> 'supabase_admin'
    OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE oid = 10 AND rolname = current_user AND rolsuper)
  THEN RAISE EXCEPTION 'invalid bootstrap identity'; END IF;
END
$bootstrap$;
CREATE ROLE "${role}" LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${password}';
GRANT postgres TO "${role}" WITH ADMIN FALSE, INHERIT FALSE, SET TRUE;
COMMENT ON ROLE "${role}" IS '${marker}';
COMMIT;
SELECT oid FROM pg_roles WHERE rolname = '${role}';
`;
	const failure = (reason: ReleaseGateFailureReason, exitCode: number | null) =>
		new ReleaseGateFailure("owned ETL migration runner bootstrap failed; details redacted", {
			operation: RELEASE_GATE_FAILURE_OPERATION.OWNED_ETL_RUNNER_BOOTSTRAP, reason, exitCode,
		});
	let result: ReturnType<typeof spawnSync>;
	try {
		result = spawnSync("docker", [
			"exec", "-i", "--user", "postgres", containerId,
			"psql", "-U", "supabase_admin", "-d", "postgres", "-XAt", "-v", "ON_ERROR_STOP=1",
		], {
			cwd: REPO_ROOT, env: process.env, input: sql, encoding: "utf8",
			stdio: ["pipe", "pipe", "pipe"], timeout: 15_000,
		});
	} catch {
		throw failure(RELEASE_GATE_FAILURE_REASON.COMMAND_FAILED, null);
	}
	if (result.error || result.status !== 0)
		throw failure(RELEASE_GATE_FAILURE_REASON.COMMAND_FAILED, result.status);
	const output = result.stdout;
	if (typeof output !== "string" || !/^[1-9][0-9]{0,9}\n$/.test(output) || Number(output) > 4_294_967_295)
		throw failure(RELEASE_GATE_FAILURE_REASON.INVALID_IDENTITY, null);
	return JSON.stringify({ role, password, marker, oid: Number(output) });
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
	operation?: ReleaseGateFailureOperation,
): string {
	const result = commandResult(command, args, cwd);
	if (result.error || result.status !== 0) {
		const message = `${label} is unavailable or failed its preflight check`;
		if (operation)
			throw new ReleaseGateFailure(message, {
				operation,
				reason: RELEASE_GATE_FAILURE_REASON.COMMAND_FAILED,
				exitCode: result.status,
			});
		throw new Error(message);
	}
	return result.stdout;
}
function runChecked(
	command: string,
	args: readonly string[],
	label: string,
	cwd = REPO_ROOT,
	environment: NodeJS.ProcessEnv = process.env,
	timeout = 120_000,
	operation?: ReleaseGateFailureOperation,
): void {
	const result = spawnSync(command, args, {
		cwd,
		env: environment,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
		timeout,
	});
	if (result.error || result.status !== 0) {
		const message = `${label} failed (exit ${result.status ?? "unavailable"}); output redacted`;
		if (operation)
			throw new ReleaseGateFailure(message, {
				operation,
				reason: RELEASE_GATE_FAILURE_REASON.COMMAND_FAILED,
				exitCode: result.status,
			});
		throw new Error(message);
	}
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
	if (result.error || result.status !== 0) {
		// Recognize only numbered TAP failures and explicitly tagged SQLSTATE tokens.
		// Bound inspection and emitted metadata; descriptions and other output stay private.
		const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.slice(0, 65_536);
		const sqlstates = Array.from(
			output.matchAll(/\(SQLSTATE ([0-9A-Z]{5})\)/g),
			(match) => match[1]!,
		);
		const failedAssertions = Array.from(
			output.matchAll(/^[ \t]*not ok ([1-9][0-9]{0,5})(?= - |[ \t]*$)/gm),
			(match) => Number(match[1]),
		);
		throw new ReleaseGateFailure(
			formatPgTapFailure(label, result.status, result.stdout ?? ""),
			{
				operation: RELEASE_GATE_FAILURE_OPERATION.PGTAP,
				reason: RELEASE_GATE_FAILURE_REASON.COMMAND_FAILED,
				exitCode: result.status,
				pgTapDiagnostic: {
					proof: PGTAP_PROOFS.find((proof) => proof.label === label)?.path ?? null,
					signal: result.signal,
					spawnErrorCode:
						result.error && "code" in result.error && typeof result.error.code === "string"
							? result.error.code : null,
					sqlstates: [...new Set(sqlstates)].slice(0, 16),
					failedAssertions: [...new Set(failedAssertions)].slice(0, 16),
				},
			},
		);
	}
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
const exactToolVersion = z.string().regex(/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/);
const toolchainPinsSchema = z.object({
	engines: z.object({ node: exactToolVersion, pnpm: exactToolVersion }),
	devDependencies: z.object({ supabase: exactToolVersion }),
});
function readToolchainPins(): z.infer<typeof toolchainPinsSchema> {
	try {
		return toolchainPinsSchema.parse(JSON.parse(readFileSync(path.join(WEB_ROOT, "package.json"), "utf8")));
	} catch {
		throw new Error("Invalid project toolchain pins; exact Node, pnpm and Supabase CLI versions are required");
	}
}
function assertPinnedVersion(actual: string, expected: string, label: string): void {
	if (actual.trim() !== expected)
		throw new Error(`${label} version mismatch; expected ${expected}. Use the project-pinned toolchain`);
}
function assertIsolationCapabilities(requireBrowser: boolean): void {
	if (process.env.SUPABASE_EXPERIMENTAL_STACK !== undefined)
		throw new Error("Unset SUPABASE_EXPERIMENTAL_STACK; the owned gate requires the verified legacy backend");
	const pins = readToolchainPins();
	assertPinnedVersion(process.versions.node, pins.engines.node, "Node.js");
	assertPinnedVersion(requireCommand("pnpm", ["--version"], "pnpm", WEB_ROOT), pins.engines.pnpm, "pnpm");
	assertPinnedVersion(requireCommand("supabase", ["--version"], "Supabase CLI", WEB_ROOT), pins.devDependencies.supabase, "Supabase CLI");
	requireCommand("docker", ["info", "--format", "{{.ServerVersion}}"], "Docker");
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
		!startHelp.includes("--network-id") ||
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
	throw await playwrightFailure(result.status, Boolean(result.error), receiptPath);
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
function recoveryRecordPath(record: ReleaseGateRecoveryRecord): string {
	const root = path.resolve(os.tmpdir());
	if (!Number.isSafeInteger(record.ownerPid) || record.ownerPid <= 0 ||
		record.repositoryRoot !== REPO_ROOT || path.dirname(record.workdir) !== root ||
		!/^votus-e2e-[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(path.basename(record.workdir)) ||
		record.token !== path.basename(record.workdir).slice("votus-e2e-".length) ||
		record.projectId !== `votus-e2e-${record.token.replaceAll("-", "").slice(0, 20)}`)
		throw new Error("recovery ownership binding invalid; details redacted");
	return path.join(root, `${path.basename(record.workdir)}.recovery.json`);
}

export async function persistReleaseGateRecoveryRecord(record: ReleaseGateRecoveryRecord): Promise<void> {
	const target = recoveryRecordPath(record);
	// Publish only complete evidence, without replacing any existing ownership record.
	const staged = `${target}.${randomUUID()}.${record.status === "pending_child" ? "pending.tmp" : "tmp"}`;
	let created = false;
	try {
		const fd = openSync(staged, "wx", 0o600);
		created = true;
		try {
			writeFileSync(fd, `${JSON.stringify({ schemaVersion: 2, ...record })}\n`);
			fsyncSync(fd);
		} finally {
			closeSync(fd);
		}
		linkSync(staged, target);
		const directoryFd = openSync(path.dirname(target), "r");
		try {
			fsyncSync(directoryFd);
		} finally {
			closeSync(directoryFd);
		}
	} finally {
		if (created) unlinkSync(staged);
	}
}

export async function promotePendingReleaseGateRecoveryRecord(record: ReleaseGateRecoveryRecord): Promise<void> {
	const pending = { ...record, status: "pending_child" as const };
	const target = recoveryRecordPath(pending);
	const root = path.dirname(target);
	const expected = `${JSON.stringify({ schemaVersion: 2, ...pending })}\n`;
	const current = lstatSync(target);
	if (!current.isFile() || current.isSymbolicLink() || (current.mode & 0o777) !== 0o600 || readFileSync(target, "utf8") !== expected)
		throw new Error("pending recovery record binding invalid; details redacted");
	const staged = path.join(root, `${path.basename(target)}.${randomUUID()}.tmp`);
	const fd = openSync(staged, "wx", 0o600);
	try {
		writeFileSync(fd, `${JSON.stringify({ schemaVersion: 2, ...record })}\n`);
		fsyncSync(fd);
	} finally {
		closeSync(fd);
	}
	// Recheck immediately before replacement; never promote a changed or foreign record.
	const latest = lstatSync(target);
	if (!latest.isFile() || latest.isSymbolicLink() || latest.ino !== current.ino || readFileSync(target, "utf8") !== expected)
		throw new Error("pending recovery record changed; details redacted");
	renameSync(staged, target);
	const directoryFd = openSync(root, "r");
	try { fsyncSync(directoryFd); } finally { closeSync(directoryFd); }
}

export async function retireReleaseGateRecoveryRecord(record: ReleaseGateRecoveryRecord): Promise<void> {
	const target = recoveryRecordPath(record);
	const current = JSON.parse(readFileSync(target, "utf8")) as Record<string, unknown>;
	if (!lstatSync(target).isFile() || !current || Array.isArray(current) ||
		Object.keys(current).sort().join(",") !== (record.status === "pending_child" ? "ownerPid,projectId,repositoryRoot,schemaVersion,status,token,workdir" : "ownerPid,projectId,repositoryRoot,schemaVersion,token,workdir") ||
		Object.entries({ schemaVersion: 2, ...record }).some(([key, value]) => current[key] !== value))
		throw new Error("recovery record binding invalid; details redacted");
	unlinkSync(target);
}

const RELEASE_GATE_CLEANUP_DEPENDENCIES: ReleaseGateCleanupDependencies<OwnedNextServer> =
	{
		tempRoot: () => os.tmpdir(),
		repositoryRoot: REPO_ROOT,
		persistRecoveryRecord: persistReleaseGateRecoveryRecord,
		promotePendingRecoveryRecord: promotePendingReleaseGateRecoveryRecord,
		retireRecoveryRecord: retireReleaseGateRecoveryRecord,
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
const HOST_BINDING_SCHEMA = z.object({
	HostIp: z.enum(["127.0.0.1", "::1"]),
	HostPort: z
		.string()
		.regex(/^\d+$/)
		.refine((port) => Number(port) >= 1 && Number(port) <= 65_535),
});
const PORT_MAP_SCHEMA = z
	.record(z.string(), z.array(HOST_BINDING_SCHEMA).nullable())
	.refine((ports) => Object.values(ports).some((bindings) => bindings?.length));
const LOOPBACK_HOST_PUBLICATION_SCHEMA = z.array(PORT_MAP_SCHEMA).length(2);

function publicationSchemaDiagnostic(
	error: z.ZodError,
): PublicationDiagnostic | undefined {
	if (error.issues.length === 0) return undefined;
	const present = new Set<PublicationIssue>();
	for (const issue of error.issues) {
		const [mapIndex, portKey, bindingIndex, field] = issue.path;
		const mapPath =
			typeof mapIndex === "number" &&
			Number.isSafeInteger(mapIndex) &&
			mapIndex >= 0;
		const portPath = mapPath && typeof portKey === "string";
		const bindingPath =
			portPath &&
			typeof bindingIndex === "number" &&
			Number.isSafeInteger(bindingIndex) &&
			bindingIndex >= 0;
		const bindingField = issue.path.length === 4 && bindingPath;
		if (
			issue.path.length === 0 &&
			(issue.code === "too_small" || issue.code === "too_big") &&
			issue.origin === "array"
		)
			present.add(PUBLICATION_ISSUE.RECORD_COUNT);
		else if (
			issue.code === "invalid_type" &&
			((issue.path.length === 1 && mapPath && issue.expected === "record") ||
				(issue.path.length === 2 && portPath && issue.expected === "array") ||
				(issue.path.length === 3 && bindingPath && issue.expected === "object"))
		)
			present.add(PUBLICATION_ISSUE.SHAPE);
		else if (issue.path.length === 1 && mapPath && issue.code === "custom")
			present.add(PUBLICATION_ISSUE.UNPUBLISHED);
		else if (bindingField && field === "HostIp" && issue.code === "invalid_value")
			present.add(PUBLICATION_ISSUE.HOST_IP);
		else if (
			bindingField &&
			field === "HostPort" &&
			((issue.code === "invalid_type" && issue.expected === "string") ||
				(issue.code === "invalid_format" && issue.format === "regex") ||
				issue.code === "custom")
		)
			present.add(PUBLICATION_ISSUE.HOST_PORT);
		else
			present.add(PUBLICATION_ISSUE.UNCLASSIFIED);
	}
	return {
		stage: "schema",
		issues: Object.values(PUBLICATION_ISSUE).filter((issue) => present.has(issue)),
	};
}

function assertEtlDatabasePublication(projectId: string, expectedPort: number): void {
	const output = requireCommand("docker", ["inspect", "--format", '{"requested":{{json .HostConfig.PortBindings}},"observed":{{json .NetworkSettings.Ports}}}', `supabase_db_${projectId}`], "disposable Supabase host publication", REPO_ROOT, RELEASE_GATE_FAILURE_OPERATION.SUPABASE_PUBLICATION_INSPECT);
	let diagnostic: PublicationDiagnostic = { stage: "json", issues: [] };
	try {
		const lines = output.trim().split("\n");
		if (lines.length !== 1) {
			diagnostic = { stage: "schema", issues: [PUBLICATION_ISSUE.RECORD_COUNT] };
			throw new Error();
		}
		const projection: unknown = JSON.parse(lines[0]!);
		const fields = projection && typeof projection === "object" && !Array.isArray(projection)
			? projection as Record<string, unknown> : {};
		const ports: unknown = fields.observed;
		const requested = fields.requested && typeof fields.requested === "object" && !Array.isArray(fields.requested)
			? (fields.requested as Record<string, unknown>)["5432/tcp"] : undefined;
		const ipv4 = z.strictObject({ HostIp: z.literal("127.0.0.1"), HostPort: z.literal(String(expectedPort)) });
		const ipv6 = z.strictObject({ HostIp: z.literal("::1"), HostPort: z.literal(String(expectedPort)) });
		const schema = z.strictObject({ "5432/tcp": z.union([
			z.tuple([ipv4]),
			z.tuple([ipv4, ipv6]),
			z.tuple([ipv6, ipv4]),
		]) });
		const result = schema.safeParse(ports);
		if (!result.success) {
			let issue: PublicationIssue = PUBLICATION_ISSUE.SHAPE;
			let bindingEvidence: PublicationDiagnostic["bindingEvidence"];
			if (ports && typeof ports === "object" && !Array.isArray(ports)) {
				const map = ports as Record<string, unknown>;
				const bindings = map["5432/tcp"];
				if (Object.keys(map).some((key) => key !== "5432/tcp")) issue = PUBLICATION_ISSUE.EXTRA_PORT_KEY;
				else if (Array.isArray(bindings)) {
					if (bindings.length === 0) issue = PUBLICATION_ISSUE.ZERO_BINDINGS;
					else if (bindings.length > 1) {
						issue = PUBLICATION_ISSUE.MULTIPLE_BINDINGS;
						bindingEvidence = {
							requested: Array.isArray(requested) ? summarizeBindings(requested, String(expectedPort))
								: { count: "invalid", exactMatches: "zero", hosts: [], ports: [], malformedEntries: "zero" },
							observed: summarizeBindings(bindings, String(expectedPort)),
						};
					}
					else if (bindings[0] && typeof bindings[0] === "object" && !Array.isArray(bindings[0])) {
						const binding = bindings[0] as Record<string, unknown>;
						if (Object.keys(binding).sort().join(",") === "HostIp,HostPort") {
							if (binding.HostIp !== "127.0.0.1") issue = PUBLICATION_ISSUE.HOST_IP;
							else if (binding.HostPort !== String(expectedPort)) issue = PUBLICATION_ISSUE.HOST_PORT;
						}
					}
				}
			}
			diagnostic = { stage: "schema", issues: [issue], ...(bindingEvidence ? { bindingEvidence } : {}) };
			throw new Error();
		}
		return;
	} catch {
		throw new ReleaseGateFailure("owned ETL database publication invalid; output redacted", {
			operation: RELEASE_GATE_FAILURE_OPERATION.OWNED_DB_PUBLICATION_VALIDATE,
			reason: RELEASE_GATE_FAILURE_REASON.INVALID_PUBLICATION,
			exitCode: null,
			publicationDiagnostic: diagnostic,
		});
	}
}

function assertEtlDatabaseStatus(output: string, expectedPort: number) {
	let status: unknown;
	try { status = JSON.parse(output); } catch { throw new ReleaseGateFailure("owned ETL database status invalid; output redacted", {
		operation: RELEASE_GATE_FAILURE_OPERATION.OWNED_DB_STATUS_VALIDATE, reason: RELEASE_GATE_FAILURE_REASON.INVALID_STATUS, exitCode: null,
	}); }
	const expectedUrl = `postgresql://postgres:postgres@127.0.0.1:${expectedPort}/postgres`;
	if (!status || typeof status !== "object" || !("DB_URL" in status) || status.DB_URL !== expectedUrl)
		throw new ReleaseGateFailure("owned ETL database status invalid; output redacted", {
			operation: RELEASE_GATE_FAILURE_OPERATION.OWNED_DB_STATUS_VALIDATE, reason: RELEASE_GATE_FAILURE_REASON.INVALID_STATUS, exitCode: null,
		});
	return { DB_URL: expectedUrl, API_URL: "", ANON_KEY: "", SERVICE_ROLE_KEY: "" };
}

function assertLoopbackHostPublication(projectId: string): void {
	const output = requireCommand(
		"docker",
		[
			"inspect",
			"--format",
			"{{json .NetworkSettings.Ports}}",
			`supabase_db_${projectId}`,
			`supabase_kong_${projectId}`,
		],
		"disposable Supabase host publication",
		REPO_ROOT,
		RELEASE_GATE_FAILURE_OPERATION.SUPABASE_PUBLICATION_INSPECT,
	);
	let decoded = false;
	try {
		const publications = output.trim().split("\n").map((publication) => JSON.parse(publication));
		decoded = true;
		LOOPBACK_HOST_PUBLICATION_SCHEMA.parse(publications);
	} catch (error) {
		const fallback: PublicationDiagnostic = {
			stage: !decoded && error instanceof SyntaxError ? "json" : "unexpected",
			issues: [],
		};
		const publicationDiagnostic =
			decoded && error instanceof z.ZodError
				? publicationSchemaDiagnostic(error) ?? fallback
				: fallback;
		throw new ReleaseGateFailure(
			"Supabase host publication proof is absent or invalid",
			{
				operation: RELEASE_GATE_FAILURE_OPERATION.SUPABASE_PUBLICATION_VALIDATE,
				reason: RELEASE_GATE_FAILURE_REASON.INVALID_PUBLICATION,
				exitCode: null,
				publicationDiagnostic,
			},
		);
	}
}

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
async function recoverStaleSidecar(tempRoot: string, name: string): Promise<void> {
	if (!/^votus-e2e-[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.recovery\.json$/.test(name)) return;
	const sidecar = path.join(tempRoot, name);
	const info = lstatSync(sidecar);
	if (Date.now() - info.mtimeMs <= STALE_AFTER_MS) return;
	const invalid = () => new Error("stale recovery ownership evidence invalid; details redacted");
	if (!info.isFile() || (info.mode & 0o777) !== 0o600 || info.size > 4096) throw invalid();
	let decoded: unknown;
	try { decoded = JSON.parse(readFileSync(sidecar, "utf8")); } catch { throw invalid(); }
	if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) throw invalid();
	const value = decoded as Record<string, unknown>;
	const keys = Object.keys(value).sort().join(",");
	const pending = keys === "ownerPid,projectId,repositoryRoot,schemaVersion,status,token,workdir" && value.status === "pending_child";
	if (!pending && keys !== "ownerPid,projectId,repositoryRoot,schemaVersion,token,workdir") throw invalid();
	const token = name.slice("votus-e2e-".length, -".recovery.json".length);
	const workdir = path.join(tempRoot, `votus-e2e-${token}`);
	const projectId = `votus-e2e-${token.replaceAll("-", "").slice(0, 20)}`;
	if (value.schemaVersion !== 2 || !Number.isSafeInteger(value.ownerPid) || (value.ownerPid as number) <= 0 || value.workdir !== workdir || value.token !== token || value.projectId !== projectId || typeof value.repositoryRoot !== "string" || path.resolve(tempRoot) !== tempRoot) throw invalid();
	if (value.repositoryRoot !== REPO_ROOT || pending) return;
	try {
		process.kill(value.ownerPid as number, 0);
		return;
	} catch (error) {
		if (!(error instanceof Error) || !("code" in error) || error.code !== "ESRCH") return;
	}
	const active = matchingProcessActive(workdir, projectId);
	if (active !== false) return;
	if (matchingProjectResourcesActive(projectId) === undefined)
		throw new Error("stale recovery Docker ownership evidence unavailable; output redacted");
	const record: ReleaseGateRecoveryRecord = { workdir, projectId, token, repositoryRoot: REPO_ROOT, ownerPid: value.ownerPid as number };
	if (existsSync(workdir)) {
		if (!lstatSync(workdir).isDirectory()) throw new Error("recovery workdir is not a directory");
		let markerText: string | undefined;
		try { markerText = await readFile(path.join(workdir, OWNER_FILE), "utf8"); }
		catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error("recovery workdir marker unavailable");
		}
		if (markerText !== undefined) {
			let marker: unknown;
			try { marker = JSON.parse(markerText); } catch { throw new Error("recovery workdir marker unavailable"); }
			if (JSON.stringify(marker) !== JSON.stringify({ workdir, projectId, token })) throw new Error("recovery workdir marker conflict");
		}
	}
	await cleanupReleaseGate({ ownership: record, stackMutationAttempted: true }, {
		...RELEASE_GATE_CLEANUP_DEPENDENCIES,
		validatedRecoveryMarker: record,
		recoveryOwnerPid: record.ownerPid,
		skipStackStop: true,
		removeWorkdir: async (candidate) => { if (existsSync(candidate)) await rm(candidate, { recursive: true }); },
		persistRecoveryRecord: async () => {
			const current = JSON.parse(readFileSync(sidecar, "utf8")) as unknown;
			if (!current || typeof current !== "object" || Array.isArray(current) ||
				Object.keys(current).sort().join(",") !== "ownerPid,projectId,repositoryRoot,schemaVersion,token,workdir" ||
				Object.entries({ schemaVersion: 2, ...record }).some(([key, value]) => (current as Record<string, unknown>)[key] !== value))
				throw new Error("recovery sidecar changed");
		},
	});
}
async function reapStaleOwnedWorkdirs(
	expectedMigrations: readonly string[],
	syntheticMigration: ReleaseGateSyntheticMigration,
): Promise<void> {
	const tempRoot = os.tmpdir();
	const entries = await readdir(tempRoot, { withFileTypes: true });
	for (const entry of entries) {
		if (entry.name.endsWith(".recovery.json") && entry.name.startsWith("votus-e2e-")) {
			await recoverStaleSidecar(tempRoot, entry.name);
			continue;
		}
		if (!entry.isDirectory() || !entry.name.startsWith("votus-e2e-")) continue;
		const candidate = path.join(tempRoot, entry.name);
		if (existsSync(`${candidate}.recovery.json`)) continue;
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
export function productEnvironment(
	common: NodeJS.ProcessEnv,
	scenario: ServerScenario,
): NodeJS.ProcessEnv {
	const spec =
		scenario === "shared" ? undefined : DATA_SPEC_BY_SCENARIO[scenario];
	const identity = spec ? resultScenarioIdentity(spec) : undefined;
	const prefix = `e2e-${scenario}`;
	return {
		...common,
		VOTUS_E2E_TEST_PROXY: "1",
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
	const network = `supabase_network_${ownership.projectId}`;
	const networkId = await timing.measure(RELEASE_GATE_TIMING_PHASE.SUPABASE_STARTUP, async () => {
		const networkResult = commandResult("docker", [
			"network",
			"create",
			"--driver",
			"bridge",
			"--label",
			`com.supabase.cli.project=${ownership.projectId}`,
			"--label",
			`com.docker.compose.project=${ownership.projectId}`,
			"--opt",
			"com.docker.network.bridge.host_binding_ipv4=127.0.0.1",
			network,
		]);
		if (networkResult.error || networkResult.status !== 0)
			throw new ReleaseGateFailure(
				`disposable Supabase network create failed (exit ${networkResult.status ?? "unavailable"}); output redacted`,
				{
					operation: RELEASE_GATE_FAILURE_OPERATION.SUPABASE_NETWORK_CREATE,
					reason: RELEASE_GATE_FAILURE_REASON.COMMAND_FAILED,
					exitCode: networkResult.status,
				},
			);
		const createdNetworkId = networkResult.stdout.trim();
		if (!/^[a-f0-9]{64}$/.test(createdNetworkId))
			throw new Error("owned network identity is invalid; output redacted");
		runChecked(
			"supabase",
			[
				"db",
				"start",
				"--workdir",
				ownership.workdir,
				"--network-id",
				network,
				"--yes",
			],
			"disposable Supabase start",
			REPO_ROOT,
			process.env,
			SUPABASE_START_TIMEOUT_MS,
			RELEASE_GATE_FAILURE_OPERATION.SUPABASE_START,
		);
		return createdNetworkId;
	});
	const timed =
		<TArgs extends unknown[], TResult>(
			phase: (typeof RELEASE_GATE_TIMING_PHASE)[keyof typeof RELEASE_GATE_TIMING_PHASE],
			action: (...args: TArgs) => Promise<TResult>,
		) =>
		async (...args: TArgs): Promise<TResult> =>
			await timing.measure(phase, async () => await action(...args));
	const validateOwnedDatabase = async (): Promise<string> => {
		if (plan.mode === RELEASE_GATE_MODE.ETL) {
			try {
				const marker = JSON.parse(await readFile(path.join(ownership.workdir, OWNER_FILE), "utf8"));
				planOwnedCleanup(os.tmpdir(), ownership.workdir, ownership, marker);
			} catch {
				throw new ReleaseGateFailure("owned ETL database marker invalid; details redacted", {
					operation: RELEASE_GATE_FAILURE_OPERATION.OWNED_DB_MARKER_VALIDATE,
					reason: RELEASE_GATE_FAILURE_REASON.INVALID_IDENTITY,
					exitCode: null,
				});
			}
		} else {
			const marker = JSON.parse(await readFile(path.join(ownership.workdir, OWNER_FILE), "utf8"));
			planOwnedCleanup(os.tmpdir(), ownership.workdir, ownership, marker);
		}
		const identityOutput = requireCommand("docker", [
			"container", "inspect", "--format",
			'{"id":{{json .Id}},"name":{{json .Name}},"project":{{json (index .Config.Labels "com.supabase.cli.project")}},"networks":{{json .NetworkSettings.Networks}}}',
			`supabase_db_${ownership.projectId}`,
		], "owned database identity inspection", REPO_ROOT, RELEASE_GATE_FAILURE_OPERATION.OWNED_DB_IDENTITY_INSPECT);
		try {
			const identity = z.object({
				id: z.string().regex(/^[a-f0-9]{64}$/),
				name: z.literal(`/supabase_db_${ownership.projectId}`),
				project: z.literal(ownership.projectId),
				networks: z.record(z.string(), z.object({ NetworkID: z.literal(networkId) })),
			}).parse(JSON.parse(identityOutput));
			const attached = Object.keys(identity.networks);
			if (attached.length !== 1 || attached[0] !== network) throw new Error();
			return identity.id;
		} catch {
			throw new ReleaseGateFailure("owned database identity mismatch; output redacted", {
				operation: RELEASE_GATE_FAILURE_OPERATION.OWNED_DB_IDENTITY_VALIDATE,
				reason: RELEASE_GATE_FAILURE_REASON.INVALID_IDENTITY,
				exitCode: null,
			});
		}
	};
	let ownedEtlDatabaseId: string | undefined;
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
		validateOwnedEtlDatabase: async () => {
			ownedEtlDatabaseId = await validateOwnedDatabase();
			assertEtlDatabasePublication(ownership.projectId, supabasePorts[1]!);
		},
		startApplicationServices: timed(RELEASE_GATE_TIMING_PHASE.SUPABASE_STARTUP, async () => {
			// A running DB makes top-level start short-circuit. Remove only its container:
			// the existing named volume skips fresh initialization and retains migrations.
			const id = await validateOwnedDatabase();
			runChecked("docker", ["container", "rm", "--force", "--", id], "owned database container handoff");
			runChecked("supabase", [
				"start", "--workdir", ownership.workdir, "--exclude", EXCLUDED_SERVICES,
				"--network-id", network, "--yes",
			], "disposable Supabase start", REPO_ROOT, process.env,
			SUPABASE_START_TIMEOUT_MS, RELEASE_GATE_FAILURE_OPERATION.SUPABASE_START);
			assertLoopbackHostPublication(ownership.projectId);
		}),
		validateStackStatus: async () => {
			const statusOutput = requireCommand(
				"supabase",
				["status", "--workdir", ownership.workdir, "-o", "json"],
				"disposable Supabase status",
				REPO_ROOT,
				plan.mode === RELEASE_GATE_MODE.ETL ? RELEASE_GATE_FAILURE_OPERATION.OWNED_DB_STATUS_COMMAND : undefined,
			);
			const status = plan.mode === RELEASE_GATE_MODE.ETL
				? assertEtlDatabaseStatus(statusOutput, supabasePorts[1]!)
				: assertStackStatus(statusOutput, supabasePorts[0]!, supabasePorts[1]!);
			// ETL needs the owned database, not workspace_api (installed in a later
			// migration by the disposable-database verifier).
			if (plan.mode === RELEASE_GATE_MODE.ETL) return status;
			try {
				const response = await fetch(new URL("/rest/v1/", status.API_URL), {
					method: "HEAD",
					headers: {
						apikey: status.ANON_KEY,
						Authorization: `Bearer ${status.ANON_KEY}`,
						"Accept-Profile": "workspace_api",
					},
					redirect: "error",
					signal: AbortSignal.timeout(5_000),
				});
				await response.body?.cancel();
				if (response.status !== 200) throw new Error();
			} catch {
				throw new Error("workspace_api REST readiness failed; output redacted");
			}
			return status;
		},
		runOwnedEtl: async (status) => {
			if (state.interrupted) throw new Error(`interrupted by ${state.interrupted}`);
			const url = new URL(status.DB_URL);
			if (url.pathname !== "/postgres" || url.search || url.hash)
				throw new Error("owned ETL database identity invalid");
			url.pathname = "/template1";
			const env: NodeJS.ProcessEnv = {
				NODE_ENV: process.env.NODE_ENV,
				ETL_TEST_ADMIN_DATABASE_URL: url.href,
				ETL_VERIFY_STAGE_REPORT: "1",
			};
			for (const key of ["PATH", "HOME", "TMPDIR", "XDG_CACHE_HOME", "UV_CACHE_DIR", "SSL_CERT_FILE", "SSL_CERT_DIR", "LANG", "LC_ALL"]) {
				if (process.env[key] !== undefined) env[key] = process.env[key];
			}
			// Durable non-reapable ownership evidence must precede child construction.
			const pending = { ...ownership, repositoryRoot: REPO_ROOT, ownerPid: process.pid, status: "pending_child" as const };
			let settleLaunch!: () => void;
			const launchSettled = new Promise<void>((resolve) => { settleLaunch = resolve; });
			let launchUnconfirmed = false;
			let child: ReturnType<typeof startOwnedEtlChild> | undefined;
			// Signal cleanup must wait for prelaunch persistence or child construction
			// to settle before it can decide whether teardown is safe.
			state.stopOwnedEtlChild = async () => {
				await launchSettled;
				if (launchUnconfirmed) throw new Error("ETL launch settlement unconfirmed");
				await child?.stop();
			};
			try {
				try {
					const marker = JSON.parse(await readFile(path.join(ownership.workdir, OWNER_FILE), "utf8"));
					planOwnedCleanup(os.tmpdir(), ownership.workdir, ownership, marker);
					await persistReleaseGateRecoveryRecord(pending);
				} catch {
					launchUnconfirmed = true;
					state.pendingEtlRecovery = true;
					throw new Error("pending ETL recovery persistence failed; details redacted");
				}
				state.pendingEtlRecovery = true;
				if (state.interrupted) throw new Error(`interrupted by ${state.interrupted}`);
				const containerId = await validateOwnedDatabase();
				if (state.interrupted) throw new Error(`interrupted by ${state.interrupted}`);
				if (containerId !== ownedEtlDatabaseId)
					throw new ReleaseGateFailure("owned ETL database identity changed; details redacted", {
						operation: RELEASE_GATE_FAILURE_OPERATION.OWNED_DB_IDENTITY_VALIDATE,
						reason: RELEASE_GATE_FAILURE_REASON.INVALID_IDENTITY, exitCode: null,
					});
				assertEtlDatabasePublication(ownership.projectId, supabasePorts[1]!);
				env.ETL_TEST_MIGRATION_RUNNER = provisionOwnedMigrationRunner(containerId);
				if (state.interrupted) throw new Error(`interrupted by ${state.interrupted}`);
				try {
					child = startOwnedEtlChild({ cwd: REPO_ROOT, env });
				} catch {
					launchUnconfirmed = true;
					throw new ReleaseGateFailure("owned ETL child launch failed; details redacted", {
						operation: RELEASE_GATE_FAILURE_OPERATION.OWNED_ETL_CHILD_LAUNCH,
						reason: RELEASE_GATE_FAILURE_REASON.LAUNCH_FAILED,
						exitCode: null,
					});
				}
				state.stopOwnedEtlChild = child.stop;
			} finally {
				settleLaunch();
			}
			if (!child) throw new Error("owned ETL child unavailable; details redacted");
			await child.completed;
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
		// Lanes select orchestration; browser evidence still requires the full inventory.
		VOTUS_E2E_GATE_MODE: plan.mode === RELEASE_GATE_MODE.BROWSER ? RELEASE_GATE_MODE.FULL : plan.mode,
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
	const signalHandlers: Array<["SIGINT" | "SIGTERM", () => void]> = [];
	for (const signal of ["SIGINT", "SIGTERM"] as const) {
		const handler = () => {
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
		};
		process.once(signal, handler);
		signalHandlers.push([signal, handler]);
	}
	let failure: unknown;
	try {
		try {
			await executeGate(state, plan, timing);
		} catch (error) {
			failure = error;
		}
		try {
			await timing.measure(RELEASE_GATE_TIMING_PHASE.CLEANUP, cleanOnce);
		} catch (error) {
			failure = failure
				? new AggregateError([failure, error], "gate execution and cleanup both failed")
				: error;
		}
	} finally {
		for (const [signal, handler] of signalHandlers) process.removeListener(signal, handler);
	}
	emitTiming();
	if (failure) throw failure;
	if (state.interrupted) throw new Error(`interrupted by ${state.interrupted}`);
	if (plan.mode === RELEASE_GATE_MODE.ETL) {
		process.stdout.write("Isolated ETL verification passed; owned stack cleaned\n");
		return;
	}
	if (plan.mode === RELEASE_GATE_MODE.SQL || plan.mode === RELEASE_GATE_MODE.BROWSER) {
		process.stdout.write(
			plan.mode === RELEASE_GATE_MODE.SQL
				? "SQL lane passed: 13 pgTAP proofs, 2 rollback/reapply proofs, cleanup complete; partial release coverage\n"
				: "Browser lane passed: 8 passed, 0 skipped, disposable stack cleaned; partial release coverage\n",
		);
		return;
	}
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
	const pending = [error];
	const seen = new Set<unknown>();
	while (pending.length > 0) {
		const error = pending.pop();
		if (seen.has(error)) continue;
		seen.add(error);
		if (error instanceof AggregateError) pending.push(...error.errors);
		if (error instanceof Error && error.cause !== undefined) pending.push(error.cause);
		reportDiagnostic(error, writeError);
	}
}

function reportDiagnostic(error: unknown, writeError: (chunk: string) => void): void {
	if (error instanceof OwnedEtlFailure) writeError(`E2E_ETL_DIAGNOSTIC ${JSON.stringify({
		schemaVersion: 1,
		reason: error.reason,
		exitCode: Number.isInteger(error.exitCode) && error.exitCode !== null && error.exitCode >= 0 && error.exitCode <= 255 ? error.exitCode : null,
		stage: error.stage,
		...(error.stage === "apply_migrations" && error.reason === "child_exit" ? { migration: error.migration, sqlstate: error.sqlstate } : {}),
		...(error.stage === "grant_test_privileges" && error.reason === "child_exit" && error.grant ? { grant: error.grant } : {}),
		...(error.stage === "pytest" && error.reason === "child_exit" && error.pytest ? { pytest: {
			outcome: error.pytest.outcome,
			exitCode: error.pytest.exitCode,
			tests: error.pytest.tests,
			skipped: error.pytest.skipped,
			failed: error.pytest.failed,
		} } : {}),
	})}\n`);
	if (error instanceof PlaywrightFailure) writeError(error.line());
	if (error instanceof ReleaseGateFailure)
		writeError(
			`E2E_RELEASE_GATE_FAILURE ${JSON.stringify({
				schemaVersion: 1,
				operation: error.metadata.operation,
				reason: error.metadata.reason,
				exitCode:
					Number.isInteger(error.metadata.exitCode) &&
					error.metadata.exitCode !== null &&
					error.metadata.exitCode >= 0 &&
					error.metadata.exitCode <= 255
						? error.metadata.exitCode
						: null,
			})}\n`,
		);
	if (error instanceof ReleaseGateFailure && error.metadata.pgTapDiagnostic) {
		const diagnostic = error.metadata.pgTapDiagnostic;
		writeError(`E2E_RELEASE_GATE_PGTAP_DIAGNOSTIC ${JSON.stringify({
			schemaVersion: 1,
			proof: PGTAP_PROOFS.find((proof) => proof.path === diagnostic.proof)?.path ?? null,
			exitCode:
				Number.isInteger(error.metadata.exitCode) && error.metadata.exitCode !== null &&
				error.metadata.exitCode >= 0 && error.metadata.exitCode <= 255
					? error.metadata.exitCode : null,
			signal:
				typeof diagnostic.signal === "string" && Object.hasOwn(os.constants.signals, diagnostic.signal)
					? diagnostic.signal : null,
			spawnErrorCode: SPAWN_ERROR_CODES.find((code) => code === diagnostic.spawnErrorCode) ?? null,
			sqlstates: diagnostic.sqlstates
				.filter((code) => typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)).slice(0, 16),
			failedAssertions: diagnostic.failedAssertions
				.filter((number) => Number.isInteger(number) && number > 0 && number <= 999_999).slice(0, 16),
		})}\n`);
	}
	if (error instanceof ReleaseGateFailure && error.metadata.publicationDiagnostic) {
		const parsed = publicationDiagnosticSchema.safeParse(error.metadata.publicationDiagnostic);
		const diagnostic = parsed.success ? parsed.data : { stage: "unexpected" as const, issues: [] };
		writeError(
			`E2E_RELEASE_GATE_PUBLICATION_DIAGNOSTIC ${JSON.stringify({
				schemaVersion: 1,
				stage: diagnostic.stage,
				issues: diagnostic.issues,
				...("bindingEvidence" in diagnostic && diagnostic.bindingEvidence ? { bindingEvidence: diagnostic.bindingEvidence } : {}),
			})}\n`,
		);
	}
	if (error instanceof ReleaseGateCleanupError) {
		const diagnostics = cleanupDiagnosticsLine(error);
		if (diagnostics) writeError(`${diagnostics}\n`);
	}
}

export async function executeOwnedEtlVerification(): Promise<void> {
	await executeReleaseGatePlan(createReleaseGatePlan(RELEASE_GATE_MODE.ETL));
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
