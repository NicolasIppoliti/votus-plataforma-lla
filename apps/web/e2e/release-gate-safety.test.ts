import { chromium } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type {
	FullConfig,
	FullResult,
	Suite,
	TestCase,
	TestResult,
} from "@playwright/test/reporter";
import ReleaseGateReporter from "./release-gate-reporter";
import { etlVerificationMain } from "../scripts/etl-verification";
import { startOwnedEtlChild } from "../scripts/owned-etl-child";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { PlaywrightFailure, playwrightFailure } from "./playwright-failure-diagnostics";
import {
	assertSourceInventory,
	productEnvironment,
	matchingProjectResourcesActive,
	listOwnedNetworks,
	removeOwnedNetworks,
	releaseGateMain,
	persistReleaseGateRecoveryRecord,
	retireReleaseGateRecoveryRecord,
	runPlaywright,
} from "../scripts/e2e-release-gate";
import {
	RELEASE_GATE_TIMING_PHASE,
	RELEASE_GATE_TIMING_PREFIX,
	createReleaseGateTiming,
} from "../scripts/e2e-gate-timing";
import {
	EXPECTED_E2E_SPECS,
	assertE2eEnvironment,
	assertGateReport,
	assertLoopbackSessionCookieDelta,
	classifyStaleOwnership,
	emptyStorageState,
	planOwnedCleanup,
	planStaleWorkdirReap,
	sameCookieIdentity,
	storageStateForSpec,
	type CleanupAction,
	type GateOwnership,
	type GateTestResult,
} from "./gate-contract";
import {
	RELEASE_GATE_MODE,
	createReleaseGatePlan,
	ReleaseGateCleanupError,
	assertExactMigrationInventory,
	assertStackStatus,
	assertSyntheticMigrationDoesNotCollide,
	assertTs7Version,
	cleanupDiagnosticsLine,
	formatPgTapFailure,
	cleanupReleaseGate,
	migrationVersionFromFileName,
	establishOwnership,
	planOwnedSqlInvocation,
	reserveUniquePorts,
	runOwnedCleanup,
	runProductionReleasePhases,
	runReleaseGateCli,
	SUPABASE_START_TIMEOUT_MS,
	type PortReservation,
	type ReleaseGateCleanupDependencies,
	type ReleaseGatePlan,
} from "../scripts/e2e-gate-runtime";
import { reportReleaseGateFailure } from "../scripts/e2e-release-gate";
const { createServer, randomUUID, spawn, spawnSync, tmpdir, open, sidecarFault, prelaunchRead } = vi.hoisted(() => ({
	sidecarFault: { kind: "" as string, renamed: false, linked: false, descriptors: new Map<number, string>() },
	prelaunchRead: { armed: false, gate: undefined as Promise<void> | undefined, entered: undefined as (() => void) | undefined },
	spawn: vi.fn(),
	open: vi.fn(),
	createServer: vi.fn(),
	randomUUID: vi.fn(),
	spawnSync: vi.fn(),
	tmpdir: vi.fn(),
}));

vi.mock("node:fs", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:fs")>();
	return { ...actual,
		openSync: (file: Parameters<typeof actual.openSync>[0], flags: Parameters<typeof actual.openSync>[1], mode?: number) => {
			const fd = actual.openSync(file, flags, mode);
			sidecarFault.descriptors.set(fd, String(file));
			return fd;
		},
		closeSync: (fd: number) => { sidecarFault.descriptors.delete(fd); return actual.closeSync(fd); },
		writeFileSync: (file: Parameters<typeof actual.writeFileSync>[0], data: string, options?: Parameters<typeof actual.writeFileSync>[2]) => {
			const name = typeof file === "number" ? sidecarFault.descriptors.get(file) ?? "" : String(file);
			if (sidecarFault.kind === "pending-partial-write" && name.endsWith(".pending.tmp")) {
				actual.writeFileSync(file, data.slice(0, 5));
				throw new Error("PRIVATE_FAULT_WRITE");
			}
			if (sidecarFault.kind === "promotion-write" && name.endsWith(".tmp") && !name.endsWith(".pending.tmp")) throw new Error("PRIVATE_FAULT_WRITE");
			return actual.writeFileSync(file, data, options);
		},
		fsyncSync: (fd: number) => {
			const name = sidecarFault.descriptors.get(fd) ?? "";
			if (sidecarFault.kind === "pending-fsync" && name.endsWith(".pending.tmp")) throw new Error("PRIVATE_FAULT_FSYNC");
			if (sidecarFault.kind === "promotion-fsync" && name.endsWith(".tmp") && !name.endsWith(".pending.tmp")) throw new Error("PRIVATE_FAULT_FSYNC");
			if (sidecarFault.kind === "pending-dir-fsync" && sidecarFault.linked && actual.fstatSync(fd).isDirectory()) throw new Error("PRIVATE_FAULT_FSYNC");
			if (sidecarFault.kind === "promotion-dir-fsync" && sidecarFault.renamed && actual.fstatSync(fd).isDirectory()) throw new Error("PRIVATE_FAULT_FSYNC");
			return actual.fsyncSync(fd);
		},
		linkSync: (from: string, to: string) => { actual.linkSync(from, to); sidecarFault.linked = true; },
		renameSync: (from: string, to: string) => {
			if (sidecarFault.kind === "promotion-rename" && from.endsWith(".tmp") && !from.endsWith(".pending.tmp")) throw new Error("PRIVATE_FAULT_RENAME");
			actual.renameSync(from, to);
			if (from.endsWith(".tmp") && !from.endsWith(".pending.tmp")) sidecarFault.renamed = true;
		},
	};
});
vi.mock("node:fs/promises", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:fs/promises")>();
	return { ...actual, open, readFile: async (...args: Parameters<typeof actual.readFile>) => {
		const value = await actual.readFile(...args);
		if (prelaunchRead.armed && prelaunchRead.gate && String(args[0]).endsWith("/.votus-e2e-owner.json")) {
			const gate = prelaunchRead.gate;
			prelaunchRead.gate = undefined;
			prelaunchRead.entered?.();
			await gate;
		}
		return value;
	} };
});
vi.mock("node:child_process", async (importOriginal) => ({
	...(await importOriginal<typeof import("node:child_process")>()),
	spawn,
	spawnSync,
}));
vi.mock("node:crypto", async (importOriginal) => ({
	...(await importOriginal<typeof import("node:crypto")>()),
	randomUUID,
}));
vi.mock("node:net", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:net")>();
	return { ...actual, default: { ...actual, createServer } };
});
vi.mock("node:os", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:os")>();
	return { ...actual, default: { ...actual, tmpdir }, tmpdir };
});

describe("owned ETL child", () => {
	it("spawns the isolated verification asynchronously and completes only on close", async () => {
		const child = Object.assign(new EventEmitter(), { pid: 321, exitCode: null });
		spawn.mockReturnValueOnce(child);
		const job = startOwnedEtlChild({ cwd: "/workspace", env: { DATABASE_URL: "private" } });
		expect(spawn).toHaveBeenCalledWith("uv", ["run", "--project", "etl", "etl-verify"], {
			cwd: "/workspace", env: { DATABASE_URL: "private" }, detached: true, stdio: ["ignore", "ignore", "pipe"],
		});
		let settled = false;
		void job.completed.then(() => { settled = true; });
		await Promise.resolve();
		expect(settled).toBe(false);
		child.emit("close", 0);
		await expect(job.completed).resolves.toBeUndefined();
		spawn.mockReset();
	});

	it("stops only the owned child and confirms close and group absence", async () => {
		vi.useFakeTimers();
		const child = Object.assign(new EventEmitter(), { pid: 321, exitCode: null, kill: vi.fn(() => true) });
		spawn.mockReturnValueOnce(child);
		let exists = true;
		const kill = vi.spyOn(process, "kill").mockImplementation((pid, signal) => {
			expect(pid).toBe(-321);
			if (signal === 0 && !exists) throw Object.assign(new Error("gone"), { code: "ESRCH" });
			expect(signal).toBe(0);
			return true;
		});
		try {
			const job = startOwnedEtlChild({ cwd: "/workspace", env: {} });
			const stopping = job.stop();
			expect(job.stop()).toBe(stopping);
			await vi.advanceTimersByTimeAsync(5_000);
			expect(child.kill).toHaveBeenCalledWith("SIGTERM");
			expect(child.kill).toHaveBeenCalledWith("SIGKILL");
			expect(kill.mock.calls.every(([, signal]) => signal === 0)).toBe(true);
			exists = false;
			let settled = false;
			void stopping.then(() => { settled = true; });
			await Promise.resolve();
			expect(settled).toBe(false);
			child.emit("close", 0);
			await expect(stopping).resolves.toBeUndefined();
			await expect(job.completed).resolves.toBeUndefined();
		} finally { kill.mockRestore(); spawn.mockReset(); vi.clearAllTimers(); vi.useRealTimers(); }
	});

	it.each([undefined, 0, -1])("rejects invalid group PID %s without signaling", async (pid) => {
		const child = Object.assign(new EventEmitter(), { pid, exitCode: null });
		spawn.mockReturnValueOnce(child);
		const kill = vi.spyOn(process, "kill").mockImplementation(() => true);
		try {
			const job = startOwnedEtlChild({ cwd: "/workspace", env: {} });
			await expect(job.stop()).rejects.toThrow("identity invalid");
			expect(kill).not.toHaveBeenCalled();
			child.emit("close", 0);
			await job.completed;
		} finally { kill.mockRestore(); spawn.mockReset(); }
	});

	it("redacts a spawn error and never signals an unowned group", async () => {
		const child = Object.assign(new EventEmitter(), { pid: undefined, exitCode: null });
		spawn.mockReturnValueOnce(child);
		const kill = vi.spyOn(process, "kill").mockImplementation(() => true);
		try {
			const job = startOwnedEtlChild({ cwd: "/workspace", env: {} });
			child.emit("error", new Error("private command and environment"));
			await expect(job.completed).rejects.toThrow("details redacted");
			child.emit("close", null);
			await expect(job.stop()).resolves.toBeUndefined();
			expect(kill).not.toHaveBeenCalled();
		} finally { kill.mockRestore(); spawn.mockReset(); }
	});

	it("rejects timeout even if the child closes successfully during cleanup", async () => {
		vi.useFakeTimers();
		let exists = true;
		const child = Object.assign(new EventEmitter(), { pid: 321, exitCode: null, kill: vi.fn(() => {
			exists = false;
			queueMicrotask(() => child.emit("close", 0));
			return true;
		}) });
		spawn.mockReturnValueOnce(child);
		const kill = vi.spyOn(process, "kill").mockImplementation((pid, signal) => {
			expect(pid).toBe(-321);
			if (signal === 0 && !exists) throw Object.assign(new Error("gone"), { code: "ESRCH" });
			if (signal === "SIGTERM") exists = false;
			return true;
		});
		try {
			const job = startOwnedEtlChild({ cwd: "/workspace", env: {} });
			const outcome = expect(job.completed).rejects.toThrow("timed out");
			await vi.advanceTimersByTimeAsync(600_000);
			expect(child.kill).toHaveBeenCalledWith("SIGTERM");
			await outcome;
			await expect(job.stop()).resolves.toBeUndefined();
			expect(kill).toHaveBeenCalledWith(-321, 0);
		} finally { kill.mockRestore(); spawn.mockReset(); vi.clearAllTimers(); vi.useRealTimers(); }
	});

	it("does not signal an already signal-exited owner and rejects unconfirmed settlement", async () => {
		vi.useFakeTimers();
		const child = Object.assign(new EventEmitter(), {
			pid: 321, exitCode: null, signalCode: "SIGTERM", kill: vi.fn(() => true),
		});
		spawn.mockReturnValueOnce(child);
		const probe = vi.spyOn(process, "kill").mockImplementation((pid, signal) => {
			expect([pid, signal]).toEqual([-321, 0]);
			return true;
		});
		try {
			const job = startOwnedEtlChild({ cwd: "/workspace", env: {} });
			const stopping = expect(job.stop()).rejects.toThrow(/group remains|settlement unconfirmed/);
			await vi.advanceTimersByTimeAsync(10_000);
			await stopping;
			expect(child.kill).not.toHaveBeenCalled();
			child.emit("close", 1);
			await expect(job.completed).rejects.toThrow("details redacted");
		} finally { probe.mockRestore(); spawn.mockReset(); vi.clearAllTimers(); vi.useRealTimers(); }
	});

	it("rejects stop when the group remains after escalation and close is unconfirmed", async () => {
		vi.useFakeTimers();
		const child = Object.assign(new EventEmitter(), { pid: 321, exitCode: null, kill: vi.fn(() => true) });
		spawn.mockReturnValueOnce(child);
		const kill = vi.spyOn(process, "kill").mockImplementation(() => true);
		try {
			const job = startOwnedEtlChild({ cwd: "/workspace", env: {} });
			const stopping = expect(job.stop()).rejects.toThrow("settlement unconfirmed");
			await vi.advanceTimersByTimeAsync(10_000);
			await stopping;
			expect(child.kill).toHaveBeenCalledWith("SIGKILL");
			child.emit("close", 0);
			await job.completed;
		} finally { kill.mockRestore(); spawn.mockReset(); vi.clearAllTimers(); vi.useRealTimers(); }
	});

	it.each(["EACCES", "EPERM"])("refuses an unconfirmed group probe %s without signaling", async (code) => {
		const child = Object.assign(new EventEmitter(), { pid: 321, exitCode: null, kill: vi.fn(() => true) });
		spawn.mockReturnValueOnce(child);
		const probe = vi.spyOn(process, "kill").mockImplementation(() => { throw Object.assign(new Error("private probe"), { code }); });
		try {
			const job = startOwnedEtlChild({ cwd: "/workspace", env: {} });
			await expect(job.stop()).rejects.toThrow("status unconfirmed; details redacted");
			expect(child.kill).not.toHaveBeenCalled();
			child.emit("close", 1);
			await expect(job.completed).rejects.toThrow("details redacted");
		} finally { probe.mockRestore(); spawn.mockReset(); }
	});

	it.each(["false", "throws"])("redacts a failed child signal when kill %s", async (behavior) => {
		const child = Object.assign(new EventEmitter(), { pid: 321, exitCode: null, kill: vi.fn(() => {
			if (behavior === "throws") throw new Error("private child signal");
			return false;
		}) });
		spawn.mockReturnValueOnce(child);
		const probe = vi.spyOn(process, "kill").mockImplementation((pid, signal) => {
			expect([pid, signal]).toEqual([-321, 0]);
			return true;
		});
		try {
			const job = startOwnedEtlChild({ cwd: "/workspace", env: {} });
			await expect(job.stop()).rejects.toThrow("ETL child signal unconfirmed; details redacted");
			expect(child.kill).toHaveBeenCalledWith("SIGTERM");
			child.emit("close", 1);
			await expect(job.completed).rejects.toThrow("details redacted");
		} finally { probe.mockRestore(); spawn.mockReset(); }
	});

	it("rejects child error without treating it as close and clears its timeout", async () => {
		vi.useFakeTimers();
		const child = Object.assign(new EventEmitter(), { pid: 321, exitCode: null, kill: vi.fn(() => true) });
		spawn.mockReturnValueOnce(child);
		const probe = vi.spyOn(process, "kill").mockImplementation(() => true);
		try {
			const job = startOwnedEtlChild({ cwd: "/workspace", env: {} });
			child.emit("error", new Error("private spawn failure"));
			await expect(job.completed).rejects.toThrow("ETL child failed; details redacted");
			expect(vi.getTimerCount()).toBe(0);
			const stopped = expect(job.stop()).rejects.toThrow("settlement unconfirmed");
			await vi.advanceTimersByTimeAsync(10_000);
			await stopped;
			expect(probe.mock.calls.every(([, signal]) => signal === 0)).toBe(true);
		} finally { probe.mockRestore(); spawn.mockReset(); vi.clearAllTimers(); vi.useRealTimers(); }
	});

	it("rejects unsupported platforms before spawning", () => {
		const platform = vi.spyOn(process, "platform", "get").mockReturnValue("win32");
		try {
			expect(() => startOwnedEtlChild({ cwd: "/workspace", env: {} })).toThrow("POSIX process groups required");
			expect(spawn).not.toHaveBeenCalled();
		} finally { platform.mockRestore(); spawn.mockReset(); }
	});

	it("fails closed when the owner closes but its group remains", async () => {
		const child = Object.assign(new EventEmitter(), { pid: 321, exitCode: null });
		spawn.mockReturnValueOnce(child);
		const kill = vi.spyOn(process, "kill").mockImplementation(() => true);
		try {
			const job = startOwnedEtlChild({ cwd: "/workspace", env: {} });
			child.emit("close", 0);
			await job.completed;
			await expect(job.stop()).rejects.toThrow("group remains");
			expect(kill.mock.calls.every(([, signal]) => signal === 0)).toBe(true);
		} finally { kill.mockRestore(); spawn.mockReset(); }
	});
});

const OWNERSHIP: GateOwnership = {
	workdir: "/private/tmp/votus-e2e-owned",
	projectId: "votus-e2e-project",
	token: "token",
};
const ACTIONS: CleanupAction[] = [
	{ kind: "stop-stack", projectId: OWNERSHIP.projectId },
	{ kind: "remove-owned-containers", projectId: OWNERSHIP.projectId },
	{ kind: "remove-owned-volumes", projectId: OWNERSHIP.projectId },
	{ kind: "remove-owned-networks", projectId: OWNERSHIP.projectId },
	{ kind: "remove-workdir", workdir: OWNERSHIP.workdir },
];
const ENV = {
	NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
	NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
	SUPABASE_SERVICE_ROLE_KEY: "service",
	VOTUS_E2E_TEST_USER_EMAIL: "fixture@example.test",
	VOTUS_E2E_TEST_USER_PASSWORD: randomBytes(24).toString("base64url"),
	VOTUS_E2E_BASE_URL: "http://127.0.0.1:4100",
	VOTUS_E2E_STORAGE_STATE: "/owned/auth-state.json",
	VOTUS_E2E_BASE_URL_COMPARISON: "http://127.0.0.1:4101",
	VOTUS_E2E_BASE_URL_FISCALIZACION: "http://127.0.0.1:4102",
	VOTUS_E2E_BASE_URL_MUNICIPAL: "http://127.0.0.1:4103",
	VOTUS_E2E_BASE_URL_PROVENANCE: "http://127.0.0.1:4104",
};
const PASSED: GateTestResult[] = EXPECTED_E2E_SPECS.map((spec) => ({
	spec,
	status: "passed",
}));
const STALE_EVIDENCE = {
	tempRoot: "/private/tmp",
	expectedWorkdir: "/private/tmp/votus-e2e-stale",
	marker: {
		workdir: "/private/tmp/votus-e2e-stale",
		projectId: "votus-e2e-stale",
		token: "token",
	},
	ageMs: 3_600_000,
	staleAfterMs: 900_000,
	repositoryMatches: true,
	ownerProcessActive: false,
	projectResourcesActive: false,
} as const;
function fixtureFunctionBody(fixtureSql: string, name: string) {
	const match = fixtureSql.match(new RegExp(`create function public\\.${name}\\([\\s\\S]*?as \\$\\$([\\s\\S]*?)end \\$\\$;`));
	expect(match, `fixture function ${name}`).not.toBeNull();
	return match![1]!;
}
describe("release-gate phase timing", () => {
	it("emits deterministic phase durations from the injected clock", async () => {
		let now = 100;
		const output: string[] = [];
		const timing = createReleaseGateTiming({
			now: () => now,
			writeOutput: (chunk) => output.push(chunk),
		});

		await timing.measure(RELEASE_GATE_TIMING_PHASE.PREFLIGHT_PORTS, async () => {
			now = 112;
		});
		await timing.measure(RELEASE_GATE_TIMING_PHASE.PGTAP, async () => {
			now = 137;
		});
		timing.emit();

		expect(output[0]).toContain("preflight/ports=12ms completed");
		expect(output[0]).toContain("pgTAP=25ms completed");
		expect(output[1]).toBe(
			`${RELEASE_GATE_TIMING_PREFIX}${JSON.stringify({
				schemaVersion: 1,
				phases: [
					{ name: "preflight_ports", durationMs: 12, status: "completed" },
					{ name: "supabase_startup", durationMs: 0, status: "not_started" },
					{ name: "migrations", durationMs: 0, status: "not_started" },
					{ name: "pgtap", durationMs: 25, status: "completed" },
					{ name: "rollback_reapply", durationMs: 0, status: "not_started" },
					{ name: "production_build", durationMs: 0, status: "not_started" },
					{ name: "next_server_lifecycle", durationMs: 0, status: "not_started" },
					{ name: "playwright", durationMs: 0, status: "not_started" },
					{ name: "cleanup", durationMs: 0, status: "not_started" },
				],
			})}\n`,
		);
	});

	it("records a failed phase without changing its causal error or exposing it", async () => {
		let now = 200;
		const output: string[] = [];
		const timing = createReleaseGateTiming({
			now: () => now,
			writeOutput: (chunk) => output.push(chunk),
		});
		const failure = new Error("private credential value at /private/path");

		await expect(
			timing.measure(RELEASE_GATE_TIMING_PHASE.PLAYWRIGHT, async () => {
				now = 209;
				throw failure;
			}),
		).rejects.toBe(failure);
		timing.emit();

		expect(output[1]).toContain(
			'{"name":"playwright","durationMs":9,"status":"failed"}',
		);
		expect(output.join("")).not.toContain("private credential");
		expect(output.join("")).not.toContain("/private/path");
	});

	it("keeps the gate failure authoritative when timing output fails", async () => {
		const timingOutputFailure = new Error("timing output unavailable");
		spawnSync.mockReturnValueOnce({
			error: new Error("pnpm preflight unavailable"),
			status: null,
			stdout: "",
		});
		const writeOutput = vi
			.spyOn(process.stdout, "write")
			.mockImplementation(() => {
				throw timingOutputFailure;
			});

		try {
			await expect(releaseGateMain([])).rejects.toThrow(
				"pnpm is unavailable or failed its preflight check",
			);
			expect(spawnSync).toHaveBeenCalledOnce();
			expect(writeOutput).toHaveBeenCalledOnce();
		} finally {
			writeOutput.mockRestore();
			spawnSync.mockReset();
		}
	});
});

async function inspectReleaseGatePlan(
	options: readonly string[] = [],
): Promise<ReleaseGatePlan> {
	let output = "";
	let executed = false;
	await runReleaseGateCli(["--inspect-plan", ...options], {
		execute: async () => {
			executed = true;
		},
		writeOutput: (chunk) => {
			output += chunk;
		},
	});
	expect(executed).toBe(false);
	return JSON.parse(output) as ReleaseGatePlan;
}
describe("explicit release-gate lanes", () => {
	it.each(["--plan", "--unknown"]) ("rejects unsupported release-gate flags %s before effects", async (flag) => {
		const executePlan = vi.fn();
		await expect(releaseGateMain([flag], { executePlan })).rejects.toThrow(/unknown|unsupported/);
		expect(executePlan).not.toHaveBeenCalled();
	});
	it.each(["sql", "browser"])("inspects the complete %s lane without effects", async (lane) => {
		const full = await inspectReleaseGatePlan();
		const plan = await inspectReleaseGatePlan(["--lane", lane]);
		expect(plan.mode).toBe(lane);
		expect(plan.migrationVersions).toEqual(full.migrationVersions);
		expect(plan.rollbackReapplyProofs).toEqual(full.rollbackReapplyProofs);
		expect(plan.rollbackReapplyProofs).toHaveLength(2);
		expect(plan.selectedSpecs).toEqual(lane === "sql" ? [] : EXPECTED_E2E_SPECS);
		expect(plan.runBrowser).toBe(lane === "browser");
		expect(plan.requireBrowserCapability).toBe(lane === "browser");
		expect(plan.pgTapProofs).toEqual(lane === "sql" ? full.pgTapProofs : []);
		expect(plan.setupProofs).toEqual(lane === "sql" ? full.setupProofs : []);
		expect(plan.postPgTapCleanupProofs).toEqual(lane === "sql" ? full.postPgTapCleanupProofs : []);
		if (lane === "sql") expect(plan.pgTapProofs).toHaveLength(13);
	});

	it.each([
		["--lane"], ["--lane", "invalid"], ["--lane", "sql", "browser"],
		["--lane", "sql", "--lane", "sql"], ["--lane=sql"],
		...["--focused", "--release-proof-only", "--scale-proof-only", "--rollback-proofs-only"]
			.map((flag) => ["--lane", "browser", flag]),
	])("rejects invalid lane arguments before effects: %j", async (...argv) => {
		const executePlan = vi.fn();
		await expect(releaseGateMain(argv, { executePlan })).rejects.toThrow("lane");
		expect(executePlan).not.toHaveBeenCalled();
	});

	// Reuse the existing isolated-workdir lifecycle with fake process/network boundaries.
	async function runLane(argv: string[], fault = "", entry: "release" | "etl" = "release", staleSidecar: boolean | "missing-marker" | "conflicting-marker" | "active-owner" | "unknown-owner" | "legacy" | "malformed" | "unknown-docker" | "same-suffix-container" | "same-suffix-volume" | "pending-child" | "pending-corrupt" | "pending-conflict" = false) {
		const tempRoot = mkdtempSync("/tmp/votus-e2e-unit-");
		sidecarFault.kind = fault.startsWith("sidecar-") ? fault.slice("sidecar-".length) : "";
		sidecarFault.renamed = false; sidecarFault.linked = false;
		const token = "12345678-1234-4123-8123-123456789abc";
		const staleToken = "87654321-4321-4321-8321-abcdefabcdef";
		const staleWorkdir = join(tempRoot, `votus-e2e-${staleToken}`);
		const staleRecord = `${staleWorkdir}.recovery.json`;
		if (staleSidecar) {
			if (["missing-marker", "conflicting-marker", "pending-conflict"].includes(String(staleSidecar))) {
				mkdirSync(staleWorkdir);
				writeFileSync(join(staleWorkdir, "partial"), "partial");
				if (staleSidecar === "conflicting-marker" || staleSidecar === "pending-conflict")
					writeFileSync(join(staleWorkdir, ".votus-e2e-owner.json"), JSON.stringify({ workdir: staleWorkdir, projectId: "other", token: staleToken }));
			}
			writeFileSync(staleRecord, staleSidecar === "malformed" || staleSidecar === "pending-corrupt" ? "PRIVATE_RECOVERY_CONTENT{invalid" : `${JSON.stringify({
				schemaVersion: staleSidecar === "legacy" ? 1 : 2, ...(staleSidecar === "legacy" ? {} : { ownerPid: 987654321 }), ...(staleSidecar === "pending-child" || staleSidecar === "pending-conflict" ? { status: "pending_child" } : {}), workdir: staleWorkdir,
				projectId: `votus-e2e-${staleToken.replaceAll("-", "").slice(0, 20)}`,
				token: staleToken, repositoryRoot: resolve(fileURLToPath(import.meta.url), "../../../.."),
			})}\n`, { mode: 0o600 });
			const old = new Date(Date.now() - 31 * 60_000);
			utimesSync(staleRecord, old, old);
		}
		const trace: string[] = [];
		const commands: { command: string; args: readonly string[]; cwd?: string; env?: NodeJS.ProcessEnv }[] = [];
		const output: string[] = [];
		let port = 46000;
		let sqlCount = 0;
		let migrationCount = 0;
		let interrupt: (() => void) | undefined;
		let failure: unknown;
		let releasePrelaunch!: () => void;
		let markPrelaunchEntered!: () => void;
		let cleanupBeforePrelaunchSettlement = false;
		const prelaunchEntered = new Promise<void>((resolve) => { markPrelaunchEntered = resolve; });
		if (fault === "etl-prelaunch-signal") {
			prelaunchRead.gate = new Promise<void>((resolve) => { releasePrelaunch = resolve; });
			prelaunchRead.entered = markPrelaunchEntered;
		}
		vi.useFakeTimers();
		tmpdir.mockReturnValue(tempRoot);
		randomUUID.mockReturnValue(token);
		createServer.mockImplementation(() => ({
			once: vi.fn(), listen: vi.fn((_port, _host, ready) => ready()),
			address: () => ({ port: port++ }), close: vi.fn((done) => done()),
		}));
		const browser = vi.spyOn(chromium, "executablePath").mockReturnValue(
			argv.includes("sql") ? `${tempRoot}/absent-chromium` : fileURLToPath(import.meta.url),
		);
		const readinessRequests: { url: string; options: RequestInit | undefined }[] = [];
		const cancelBody = vi.fn().mockResolvedValue(undefined);
		const timeout = vi.spyOn(AbortSignal, "timeout");
		const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, options) => {
			if (String(input).includes("/rest/v1/")) {
				trace.push("readiness");
				readinessRequests.push({ url: String(input), options });
				if (fault === "redirect") throw new TypeError("synthetic-anon synthetic-service redirect");
				if (fault === "timeout") throw new DOMException("synthetic-anon synthetic-service timeout", "TimeoutError");
				const response = new Response(null, { status: fault.startsWith("http-") ? Number(fault.slice(5)) : 200 });
				Object.defineProperty(response, "body", { value: { cancel: cancelBody } });
				return response;
			}
			return new Response(null, { status: 200 });
		});
		let groupExists = true;
		let markEtlStarted!: () => void;
		const etlStarted = new Promise<void>((resolve) => { markEtlStarted = resolve; });
		const groupProbe = vi.spyOn(process, "kill").mockImplementation((pid, signal) => {
			if (pid === 987654321) {
				expect(signal).toBe(0);
				if (staleSidecar === "active-owner") return true;
				throw Object.assign(new Error("owner status"), { code: staleSidecar === "unknown-owner" ? "EPERM" : "ESRCH" });
			}
			expect(pid).toBe(-321);
			expect(signal).toBe(0);
			if (!groupExists) throw Object.assign(new Error("group gone"), { code: "ESRCH" });
			return true;
		});
		spawn.mockImplementation((command, args, options) => {
			if (entry === "etl") {
				if (fault === "etl-launch-throw") throw new Error("SECRET_LAUNCH_PRIVATE");
				expect(command).toBe("uv");
				const pendingPath = join(tempRoot, `votus-e2e-${token}.recovery.json`);
				trace.push(existsSync(pendingPath) && (statSync(pendingPath).mode & 0o777) === 0o600 && JSON.parse(readFileSync(pendingPath, "utf8")).status === "pending_child" ? "pending-before-uv" : "missing-pending-before-uv");
				trace.push("etl");
				markEtlStarted();
				commands.push({ command, args: [...args], cwd: options.cwd, env: options.env });
				const child = Object.assign(new EventEmitter(), { pid: fault.startsWith("etl-enoent") ? undefined : 321, exitCode: null, stderr: new PassThrough(), kill: (signal: NodeJS.Signals) => {
					trace.push(signal === "SIGTERM" ? "child-term" : "child-kill");
					groupExists = false;
					void Promise.resolve().then(() => { trace.push("child-close"); child.emit("close", 0); });
					return true;
				} });
				if (fault !== "etl-signal" && fault !== "etl-timeout")
					void Promise.resolve().then(() => {
						groupExists = fault === "etl-group-remains";
						if (fault === "etl-spawn-error" || fault.startsWith("etl-enoent")) child.emit("error", Object.assign(new Error("PRIVATE_OUTPUT_MARKER"), { code: "ENOENT" }));
						if (fault === "etl-failure") child.stderr.end("private postgres:postgres\nE2E_ETL_STAGE apply_migrations\nE2E_ETL_MIGRATION 0022_results_exploration_scale.sql 42710\nPRIVATE_OUTPUT_MARKER\n");
						else if (fault.startsWith("etl-migration-")) {
							const migration = fault === "etl-migration-bad-name" ? "../private.sql 42710" : fault === "etl-migration-bad-state" ? "0022_results_exploration_scale.sql PRIVATE" : "0022_results_exploration_scale.sql 42710";
							child.stderr.end(`private_secret\nE2E_ETL_STAGE ${fault === "etl-migration-other-stage" ? "pytest" : "apply_migrations"}\nE2E_ETL_MIGRATION ${migration}\n${fault === "etl-migration-duplicate" ? `E2E_ETL_MIGRATION ${migration}\n` : ""}`);
						}
						else if (fault === "etl-stage-unknown") child.stderr.end("E2E_ETL_STAGE private_secret\n");
						else if (fault === "etl-stage-malformed") child.stderr.end("E2E_ETL_STAGE pytest;private_secret\n");
						else if (fault === "etl-stage-oversized") child.stderr.end(`E2E_ETL_STAGE pytest${"private_secret".repeat(100)}\n`);
						else if (fault === "etl-stage-midline") child.stderr.end("private_secret E2E_ETL_STAGE pytest\n");
						else if (fault === "etl-stage-duplicate") child.stderr.end("E2E_ETL_STAGE pytest\nE2E_ETL_STAGE pytest\n");
						else if (fault === "etl-long-private") {
							child.stderr.write(`${"private_secret".repeat(200)}\nE2E_ETL_STA`);
							child.stderr.write("GE pytest\n");
							child.stderr.end(`${"PRIVATE_OUTPUT_MARKER".repeat(200)}\n`);
						}
						else child.stderr.end();
						if (fault !== "etl-enoent-no-close") { if (fault === "etl-enoent-close") trace.push("etl-close"); child.emit("close", fault === "etl-failure" || fault === "etl-long-private" || fault.startsWith("etl-stage-") || fault.startsWith("etl-migration-") ? 1 : fault === "etl-exit-999" ? 999 : 0); }
					});
				if (fault === "etl-signal") void Promise.resolve().then(() => interrupt?.());
				return child;
			}
			trace.push("server");
			return {
				exitCode: null as number | null,
				kill() { this.exitCode = 0; },
				once(_event: string, done: () => void) { done(); },
			};
		});
		const originalOnce = process.once.bind(process);
		const signals = vi.spyOn(process, "once").mockImplementation((event, listener) => {
			if (event === "SIGTERM") interrupt = () => listener();
			return event === "SIGINT" || event === "SIGTERM" ? process : originalOnce(event, listener);
		});
		let exited: (() => void) | undefined;
		const signalExit = new Promise<void>((resolve) => { exited = resolve; });
		const exit = vi.spyOn(process, "exit").mockImplementation(() => {
			exited?.(); return undefined as never;
		});
		const stdout = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
			if (String(chunk).includes("lane passed:") || String(chunk).includes("release gate passed:")) {
				expect(trace.at(-1)).toBe("cleanup");
				expect(existsSync(`${tempRoot}/votus-e2e-${token}`)).toBe(false);
			}
			output.push(String(chunk)); return true;
		});
		const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
		const staleResources = new Set(["ps", "volume", "network"]);
		spawnSync.mockImplementation((command, args, options) => {
			commands.push({ command, args: [...args] });
			let phase = "";
			let text = "";
			if (command === "pnpm") {
				text = args[0] === "--version" ? "10.0.0" : "Version 7.0.0";
				if (args[0] === "build:next") phase = "build";
				if (args[1] === "playwright") {
					phase = "playwright";
					expect(args.slice(3)).toEqual(EXPECTED_E2E_SPECS);
					expect(options.env.VOTUS_E2E_GATE_MODE).toBe("full");
				}
			}
			if (staleSidecar && staleResources.has("ps") && command === "docker" && args[0] === "ps") {
				if (staleSidecar === "unknown-docker") return { status: 1, stdout: "PRIVATE_DOCKER_CONTENT" };
				text = `${staleSidecar === "same-suffix-container" ? "unrelated" : "supabase_db"}_votus-e2e-87654321432143218321\n`;
			}
			if (staleSidecar && staleResources.has("volume") && command === "docker" && args[0] === "volume" && args[1] === "ls") text = `${staleSidecar === "same-suffix-volume" ? "unrelated" : "supabase_db"}_votus-e2e-87654321432143218321\n`;
			if (staleSidecar && staleResources.has("network") && command === "docker" && args[0] === "network" && args[1] === "ls") text = "supabase_network_votus-e2e-87654321432143218321\n";
			if (staleSidecar && command === "docker" && args.some((arg: string) => arg.includes("87654321432143218321")) && args.includes("rm")) {
				staleResources.delete(args[0] === "rm" ? "ps" : args[0]!);
				trace.push(`stale-remove:${args.join(" ")}`);
			}
			if (command === "docker" && args[0] === "network" && args[1] === "create") {
				if (staleSidecar) trace.push(existsSync(staleRecord) ? "stale-sidecar-present" : "stale-sidecar-retired");
				phase = "network";
				text = fault === "network-id-empty" ? "\n"
					: fault === "network-id-malformed" ? "PRIVATE_OUTPUT_MARKER"
						: fault === "network-id-multiline" ? `${"b".repeat(64)}\n${"c".repeat(64)}`
							: `${"b".repeat(64)}\n`;
			}
			if (command === "docker" && args[0] === "container" && args[1] === "inspect") {
				phase = "db-inspect";
				text = fault === "identity-json" ? "PRIVATE_OUTPUT_MARKER" : JSON.stringify({
					id: fault === "identity-id" ? "a".repeat(12) : "a".repeat(64),
					name: fault === "identity-name" ? "/supabase_db_unowned" : "/supabase_db_votus-e2e-12345678123441238123",
					project: fault === "identity-project" ? "unowned" : "votus-e2e-12345678123441238123",
					networks: fault === "identity-network" ? { unowned: { NetworkID: "b".repeat(64) } }
						: fault === "identity-extra-network" ? { "supabase_network_votus-e2e-12345678123441238123": { NetworkID: "b".repeat(64) }, unowned: { NetworkID: "b".repeat(64) } }
						: { "supabase_network_votus-e2e-12345678123441238123": {
							NetworkID: fault === "attachment-missing" ? undefined
								: fault === "attachment-nonstring" ? 123
									: fault === "attachment-malformed" ? "PRIVATE_OUTPUT_MARKER"
										: fault === "attachment-different" ? "c".repeat(64) : "b".repeat(64),
						} },
				});
			}
			if (command === "docker" && args[0] === "container" && args[1] === "rm") phase = "db-remove";
			if (command === "docker" && args[0] === "inspect") {
				phase = "publication";
				const additionalBindings: Record<string, unknown> = {
					"etl-multiple-bindings": { HostIp: "127.0.0.1", HostPort: "46006" },
					"etl-requested-multiple-bindings": { HostIp: "127.0.0.1", HostPort: "46006" },
					"etl-mixed-bindings": { HostIp: "::1", HostPort: "46006" },
					"etl-dual-loopback-reversed": { HostIp: "127.0.0.1", HostPort: "46006" },
					"etl-dual-duplicate-v6": { HostIp: "::1", HostPort: "46006" },
					"etl-dual-extra-v6": { HostIp: "::1", HostPort: "46006" },
					"etl-dual-wrong-ipv4-port": { HostIp: "::1", HostPort: "46006" },
					"etl-dual-wrong-ipv6-port": { HostIp: "::1", HostPort: "46007" },
					"etl-dual-missing-field": { HostIp: "::1" },
					"etl-dual-extra-field": { HostIp: "::1", HostPort: "46006", note: "PRIVATE_OUTPUT_MARKER" },
					"etl-wildcard-v4-bindings": { HostIp: "0.0.0.0", HostPort: "46006" },
					"etl-wildcard-v6-bindings": { HostIp: "::", HostPort: "46006" },
					"etl-other-v4-loopback-bindings": { HostIp: "127.0.0.2", HostPort: "46006" },
					"etl-other-host-bindings": { HostIp: "192.0.2.1", HostPort: "46006" },
					"etl-malformed-host-bindings": { HostIp: "PRIVATE_OUTPUT_MARKER", HostPort: "46006" },
					"etl-empty-port-bindings": { HostIp: "127.0.0.1", HostPort: "" },
					"etl-other-port-bindings": { HostIp: "127.0.0.1", HostPort: "46007" },
					"etl-malformed-port-bindings": { HostIp: "127.0.0.1", HostPort: "PRIVATE_OUTPUT_MARKER" },
					"etl-malformed-entry-bindings": "PRIVATE_OUTPUT_MARKER",
				};
				text = entry === "etl"
					? fault === "etl-public-json" ? "PRIVATE_OUTPUT_MARKER{" : fault === "etl-public-lines" ? "{}\n{}" : JSON.stringify({ ...(fault === "etl-missing-binding" ? {} : { "5432/tcp": fault === "etl-null-binding" ? null : fault === "etl-zero-bindings" ? [] : [
						fault === "etl-binding-scalar" ? "PRIVATE_OUTPUT_MARKER" : fault === "etl-binding-missing-field" ? { HostIp: "127.0.0.1" } : { HostIp: ["etl-dual-loopback-reversed", "etl-dual-ipv6-only", "etl-dual-duplicate-v6"].includes(fault) ? "::1" : fault === "etl-public-ip" ? "0.0.0.0" : "127.0.0.1", HostPort: ["etl-public-port", "etl-dual-wrong-ipv4-port"].includes(fault) ? "46007" : fault === "etl-port-type" ? 46006 : "46006" },
						...(Object.hasOwn(additionalBindings, fault) ? [additionalBindings[fault]] : []),
						...(fault === "etl-dual-extra-v6" ? [{ HostIp: "::1", HostPort: "46006" }] : []),
					] }), ...(fault === "etl-extra-port" ? { "8000/tcp": [{ HostIp: "127.0.0.1", HostPort: "46005" }] } : fault === "etl-extra-null-port" ? { "8000/tcp": null } : {}) })
					: ["5432/tcp", "8000/tcp"]
						.map((key) => JSON.stringify({ [key]: [{ HostIp: "127.0.0.1", HostPort: "46000" }] })).join("\n");
				if (entry === "etl" && fault !== "etl-public-json" && fault !== "etl-public-lines") {
					const requested = { "5432/tcp": [
						{ HostIp: "", HostPort: "46006" },
						...(fault === "etl-requested-multiple-bindings" ? [{ HostIp: "", HostPort: "46006" }] : []),
					] };
					text = JSON.stringify({ requested, observed: JSON.parse(text) });
				}
			}
			if (command === "docker" && args[0] === "exec") phase = `sql${++sqlCount}`;
			if (command === "supabase") {
				if (args.includes("--help")) text = "--workdir --ignore-health-check --network-id --project-id --no-backup";
				else if (args[0] === "db" && args[1] === "start") phase = "db-start";
				else if (args[0] === "start") phase = "start";
				else if (args[0] === "migration") phase = `migration${++migrationCount}`;
				else if (args[0] === "test") phase = `pgtap:${String(args[2]).split("/").at(-1)}`;
				else if (args[0] === "status") {
					phase = "status";
					if (fault === "etl-prelaunch-signal") prelaunchRead.armed = true;
					if (fault === "etl-sidecar-collision") writeFileSync(join(tempRoot, `votus-e2e-${token}.recovery.json`), '{"foreign":true}', { mode: 0o600 });
					if (fault === "etl-sidecar-symlink") {
						const foreign = join(tempRoot, "foreign.json");
						writeFileSync(foreign, '{"foreign":true}', { mode: 0o600 });
						symlinkSync(foreign, join(tempRoot, `votus-e2e-${token}.recovery.json`));
					}
					text = fault === "etl-malformed-status" && entry === "etl" ? "PRIVATE_OUTPUT_MARKER{"
						: JSON.stringify(entry === "etl"
							? fault === "etl-nonobject-status" ? null
								: { ...(fault === "etl-missing-url" ? {} : { DB_URL: `postgresql://postgres:postgres@127.0.0.1:${fault === "etl-wrong-port" ? 46007 : 46006}/${fault === "etl-wrong-path" ? "wrong" : "postgres"}` }) }
							: { API_URL: "http://127.0.0.1:46005", DB_URL: "postgresql://postgres:postgres@127.0.0.1:46006/postgres", ANON_KEY: "synthetic-anon", SERVICE_ROLE_KEY: "synthetic-service" });
				} else if (args[0] === "stop") phase = "cleanup";
			}
			if (phase) trace.push(phase);
			if (phase === "db-start" && entry === "etl" && fault.startsWith("etl-marker-")) {
				const marker = join(tempRoot, `votus-e2e-${token}`, ".votus-e2e-owner.json");
				if (fault === "etl-marker-corrupt") writeFileSync(marker, "PRIVATE_MARKER_CONTENT{");
				else if (fault === "etl-marker-missing") rmSync(marker);
			}
			if (phase === "cleanup" && fault === "signal") interrupt?.();
			return phase && phase === fault
				? { status: 1, stdout: "PRIVATE_OUTPUT_MARKER", stderr: "PRIVATE_OUTPUT_MARKER" }
				: { status: 0, stdout: text };
		});
		try {
			const execution = (entry === "etl" ? etlVerificationMain(argv) : releaseGateMain(argv)).catch((error: unknown) => {
				failure = error;
				reportReleaseGateFailure("test gate failure", error, (line) => output.push(line));
			});
			if (entry === "etl") {
				if (fault === "etl-prelaunch-signal") {
					await prelaunchEntered;
					interrupt?.();
					for (let i = 0; i < 20; i++) await vi.advanceTimersByTimeAsync(1);
					cleanupBeforePrelaunchSettlement = trace.includes("cleanup");
					releasePrelaunch();
					await vi.runAllTimersAsync();
				} else if (fault === "etl-enoent-no-close") {
					await etlStarted;
					for (let i = 0; i < 20; i++) await Promise.resolve();
					await vi.advanceTimersByTimeAsync(5_000);
				} else if (fault === "etl-timeout") {
					await Promise.race([
						etlStarted,
						execution.then(() => { throw new Error("ETL child never started"); }),
					]);
					await vi.advanceTimersByTimeAsync(10 * 60_000);
				} else {
					await vi.runAllTimersAsync();
				}
			}
			await execution;
			if (fault === "signal") {
				await signalExit;
				expect(exit).toHaveBeenCalledWith(143);
			}
			const workdirExists = existsSync(`${tempRoot}/votus-e2e-${token}`);
			if (fault === "cleanup" || fault.startsWith("etl-marker-") || fault === "etl-enoent-no-close" || fault === "etl-launch-throw" || fault.startsWith("etl-sidecar-") || fault.startsWith("sidecar-") || fault === "etl-group-remains") expect(workdirExists).toBe(true);
			else if (staleSidecar !== "active-owner" && staleSidecar !== "unknown-owner" && staleSidecar !== "legacy" && staleSidecar !== "malformed" && staleSidecar !== "unknown-docker" && staleSidecar !== "same-suffix-container" && staleSidecar !== "same-suffix-volume" && staleSidecar !== "pending-child" && staleSidecar !== "pending-corrupt" && staleSidecar !== "pending-conflict")
				expect(workdirExists).toBe(false);
			const sidecar = `${tempRoot}/votus-e2e-${token}.recovery.json`;
			let recoveryRecord: unknown;
			if (existsSync(sidecar)) {
				try { recoveryRecord = JSON.parse(readFileSync(sidecar, "utf8")) as unknown; }
				catch { recoveryRecord = "malformed"; }
			}
			const recoveryMode = existsSync(sidecar) ? statSync(sidecar).mode & 0o777 : undefined;
			return { trace, commands, cleanupBeforePrelaunchSettlement, workdirExists, recoverySidecarExists: existsSync(sidecar), recoveryRecord, recoveryMode, ownedWorkdir: join(tempRoot, `votus-e2e-${token}`), staleSidecarExists: existsSync(staleRecord), readinessRequests, cancelCount: cancelBody.mock.calls.length, timeouts: timeout.mock.calls.map(([ms]) => ms), output: output.join(""), failure, exitCode: exit.mock.calls.at(-1)?.[0], killCalls: groupProbe?.mock.calls.map(([pid, signal]) => [pid, signal]) };
		} finally {
			prelaunchRead.armed = false; prelaunchRead.gate = undefined; prelaunchRead.entered = undefined;
			stdout.mockRestore(); stderr.mockRestore(); signals.mockRestore(); exit.mockRestore(); groupProbe?.mockRestore();
			browser.mockRestore(); fetchMock.mockRestore(); timeout.mockRestore();
			vi.clearAllTimers(); vi.useRealTimers();
			sidecarFault.kind = ""; sidecarFault.renamed = false; sidecarFault.linked = false;
			spawnSync.mockReset(); spawn.mockReset(); createServer.mockReset();
			randomUUID.mockReset(); tmpdir.mockReset();
			rmSync(tempRoot, { force: true, recursive: true });
		}
	}

	it("persists pending ownership before uv and promotes it before successful teardown", async () => {
		const result = await runLane(["--run"], "", "etl");
		expect(result.trace).toContain("pending-before-uv");
		expect(result.recoverySidecarExists).toBe(false);
		expect(result.workdirExists).toBe(false);
	});

	it.each(["etl-sidecar-collision", "etl-sidecar-symlink"])("refuses %s before child spawn and retains the owned stack", async (fault) => {
		const result = await runLane(["--run"], fault, "etl");
		expect(result.commands.some(({ command }) => command === "uv")).toBe(false);
		expect(result.trace).not.toContain("cleanup");
		expect(result.workdirExists).toBe(true);
		expect(result.recoverySidecarExists).toBe(true);
		expect(result.output).not.toMatch(/PRIVATE_FAULT|postgres:postgres/);
	});

	it.each(["pending-partial-write", "pending-fsync", "pending-dir-fsync"])("does not spawn or tear down after %s", async (fault) => {
		const result = await runLane(["--run"], `sidecar-${fault}`, "etl");
		expect(result.commands.some(({ command }) => command === "uv")).toBe(false);
		expect(result.trace).not.toContain("cleanup");
		expect(result.workdirExists).toBe(true);
		expect(result.recoverySidecarExists).toBe(fault === "pending-dir-fsync");
		if (fault === "pending-dir-fsync") expect(result.recoveryRecord).toMatchObject({ status: "pending_child" });
		expect(result.output).not.toMatch(/PRIVATE_FAULT|postgres:postgres/);
	});

	it("retains pending ownership when close occurs but the child group remains", async () => {
		const result = await runLane(["--run"], "etl-group-remains", "etl");
		expect(result.trace).toContain("pending-before-uv");
		expect(result.trace).not.toContain("cleanup");
		expect(result.recoveryRecord).toMatchObject({ status: "pending_child" });
		expect(result.workdirExists).toBe(true);
	});

	it.each(["promotion-write", "promotion-fsync", "promotion-rename", "promotion-dir-fsync"])("refuses teardown after %s", async (fault) => {
		const result = await runLane(["--run"], `sidecar-${fault}`, "etl");
		expect(result.trace).toContain("pending-before-uv");
		expect(result.trace).not.toContain("cleanup");
		expect(result.recoveryRecord).toMatchObject(fault === "promotion-dir-fsync" ? { schemaVersion: 2, ownerPid: expect.any(Number) } : { status: "pending_child" });
		if (fault === "promotion-dir-fsync") expect(result.recoveryRecord).not.toHaveProperty("status");
		expect(result.recoveryMode).toBe(0o600);
		expect(result.output).not.toMatch(/PRIVATE_FAULT|postgres:postgres/);
		expect(result.workdirExists).toBe(true);
	});

	it("refuses pending-child evidence after owner death even with matching resources", async () => {
		const result = await runLane(["--run"], "", "etl", "pending-child");
		expect(result.staleSidecarExists).toBe(true);
		expect(result.trace).not.toContain("stale-sidecar-retired");
		expect(result.commands.filter(({ command, args }) => command === "docker" && args.some((arg) => ["rm", "stop"].includes(arg)))).toEqual([]);
	});

	it.each(["pending-corrupt", "pending-conflict"] as const)("refuses %s without stale resource removal even when owner is absent", async (kind) => {
		const result = await runLane(["--run"], "", "etl", kind);
		expect(result.staleSidecarExists).toBe(true);
		expect(result.trace.some((phase) => phase.startsWith("stale-remove:"))).toBe(false);
		expect(result.trace).not.toContain("stale-sidecar-retired");
	});

	it("refuses malformed recovery sidecar before any new network or old resource deletion", async () => {
		const result = await runLane(["--lane", "browser"], "", "release", "malformed");
		expect(result.failure).toBeInstanceOf(Error);
		expect(result.staleSidecarExists).toBe(true);
		expect(result.trace.some((event) => event.startsWith("stale-remove:") || event === "network")).toBe(false);
		expect((result.failure as Error).message).toMatch(/recovery.*redacted/i);
		expect(result.output).not.toContain("PRIVATE_RECOVERY_CONTENT");
	});

	it("retains stale recovery when Docker ownership evidence is unknown", async () => {
		const result = await runLane(["--lane", "browser"], "", "release", "unknown-docker");
		expect(result.failure).toBeInstanceOf(Error);
		expect(result.staleSidecarExists).toBe(true);
		expect(result.trace.some((event) => event.startsWith("stale-remove:") || event === "network")).toBe(false);
		expect(result.output).not.toContain("PRIVATE_DOCKER_CONTENT");
	});

	it.each(["active-owner", "unknown-owner", "legacy"] as const)("retains %s recovery sidecar without deleting old resources", async (owner) => {
		const result = await runLane(["--lane", "browser"], "", "release", owner);
		expect(result.staleSidecarExists).toBe(true);
		expect(result.trace.some((event) => event.startsWith("stale-remove:"))).toBe(false);
		if (owner !== "legacy") expect(result.killCalls).toContainEqual([987654321, 0]);
	});

	it.each(["same-suffix-container", "same-suffix-volume"] as const)("recovery sidecar refuses %s without old removal or new network", async (resource) => {
		const result = await runLane(["--lane", "browser"], "", "release", resource);
		expect(result.failure).toBeInstanceOf(Error);
		expect(result.staleSidecarExists).toBe(true);
		expect(result.commands.some(({ command, args }) => command === "docker" && args.includes("rm") && args.some((arg) => arg.startsWith("unrelated_")))).toBe(false);
		expect(result.trace).not.toContain("network");
		expect(result.output).not.toContain("unrelated_");
	});

	it("recovers stale sidecar with missing marker before new network", async () => {
		const result = await runLane(["--lane", "browser"], "", "release", "missing-marker");
		expect(result.failure).toBeUndefined();
		expect(result.trace.slice(0, 3).every((event) => event.startsWith("stale-remove:"))).toBe(true);
		expect(result.trace[3]).toBe("stale-sidecar-retired");
		expect(result.staleSidecarExists).toBe(false);
		expect(result.commands.filter(({ command, args }) => command === "docker" && args.includes("rm") && args.some((arg) => arg.includes("87654321432143218321")))).toHaveLength(3);
	});

	it("refuses conflicting stale sidecar marker before new network", async () => {
		const result = await runLane(["--lane", "browser"], "", "release", "conflicting-marker");
		expect(result.failure).toBeDefined();
		expect(result.staleSidecarExists).toBe(true);
		expect(result.trace.some((event) => event.startsWith("stale-remove:") || event === "network")).toBe(false);
	});

	it("recovers stale sidecar with missing workdir before creating a new network", async () => {
		const result = await runLane(["--lane", "browser"], "", "release", true);
		expect(result.failure).toBeUndefined();
		expect(result.trace.indexOf("stale-sidecar-retired")).toBe(3);
		expect(result.staleSidecarExists).toBe(false);
		expect(result.commands.some(({ command, args }) => command === "supabase" && args[0] === "stop" && args.includes("votus-e2e-87654321432143218321"))).toBe(false);
	});

	it("removes only the old sidecar project's exact resources before new network creation", async () => {
		const result = await runLane(["--lane", "browser"], "", "release", true);
		const oldProject = "votus-e2e-87654321432143218321";
		const removals = result.commands.filter(({ command, args }) => command === "docker" && args.includes("rm"));
		expect(result.failure).toBeUndefined();
		expect(removals.filter(({ args }) => args.includes(oldProject) || args.some((arg) => arg.includes(oldProject)))).toEqual([
			{ command: "docker", args: ["rm", "-f", `supabase_db_${oldProject}`] },
			{ command: "docker", args: ["volume", "rm", `supabase_db_${oldProject}`] },
			{ command: "docker", args: ["network", "rm", "--", `supabase_network_${oldProject}`] },
		]);
		expect(result.trace.indexOf("stale-sidecar-retired")).toBeGreaterThan(2);
		expect(result.trace.slice(0, 3).every((event) => event.startsWith("stale-remove:"))).toBe(true);
		expect(result.commands.some(({ command, args }) => command === "supabase" && args[0] === "stop" && args.includes(oldProject))).toBe(false);
	});

	it.each(["sql", "browser", "full"])("executes %s through the production CLI and owned cleanup", async (lane) => {
		const result = await runLane(lane === "full" ? [] : ["--lane", lane]);
		expect(result.failure).toBeUndefined();
		expect(result.trace.filter((phase) => phase === "start")).toHaveLength(1);
		expect(result.trace.slice(0, 9)).toEqual(["network", "db-start", "migration1", "db-inspect", "db-remove", "start", "publication", "status", "readiness"]);
		expect(result.readinessRequests).toEqual([{
			url: "http://127.0.0.1:46005/rest/v1/",
			options: {
				method: "HEAD", redirect: "error", signal: expect.any(AbortSignal),
				headers: { apikey: "synthetic-anon", Authorization: "Bearer synthetic-anon", "Accept-Profile": "workspace_api" },
			},
		}]);
		expect(result.timeouts).toEqual([5000]);
		expect(result.cancelCount).toBe(1);
		const workdir = result.commands.find(({ args }) => args[0] === "db" && args[1] === "start")!.args[3];
		const network = "supabase_network_votus-e2e-12345678123441238123";
		expect(result.commands.filter(({ args }) => args[0] === "network" && args[1] === "create")).toHaveLength(1);
		expect(result.commands.find(({ args }) => args[0] === "db" && args[1] === "start")?.args).toEqual([
			"db", "start", "--workdir", workdir, "--network-id", network, "--yes",
		]);
		expect(result.commands.find(({ args }) => args[0] === "container" && args[1] === "inspect")?.args).toEqual([
			"container", "inspect", "--format",
			'{"id":{{json .Id}},"name":{{json .Name}},"project":{{json (index .Config.Labels "com.supabase.cli.project")}},"networks":{{json .NetworkSettings.Networks}}}',
			"supabase_db_votus-e2e-12345678123441238123",
		]);
		expect(result.commands.find(({ args }) => args[0] === "container" && args[1] === "rm")?.args).toEqual([
			"container", "rm", "--force", "--", "a".repeat(64),
		]);
		expect(result.commands.find(({ args }) => args[0] === "start" && !args.includes("--help"))?.args).toEqual([
			"start", "--workdir", workdir, "--exclude",
			"realtime,storage-api,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor",
			"--network-id", network, "--yes",
		]);
		for (const { args } of result.commands.filter(({ args }) => args.includes("--workdir") && !args.includes("--help")))
			expect(args[args.indexOf("--workdir") + 1]).toBe(workdir);
		expect(result.trace.at(-1)).toBe("cleanup");
		const pgTap = result.trace.filter((phase) => phase.startsWith("pgtap:"));
		expect(pgTap).toHaveLength(lane === "browser" ? 0 : 13);
		if (lane !== "browser") {
			expect(result.trace.slice(9, 15)).toEqual([
				"pgtap:results_exploration.sql", "sql1", "pgtap:results_exploration_scale.sql",
				"pgtap:results_exploration_scale_plans.sql", "sql2", "pgtap:results_coverage_scope_binding.sql",
			]);
		}
		expect(result.trace.filter((phase) => /^sql\d$/.test(phase))).toHaveLength(lane === "browser" ? 2 : 4);
		if (lane === "sql") {
			expect(result.trace.slice(-3)).toEqual(["sql3", "sql4", "cleanup"]);
			expect(result.output).toContain("SQL lane passed: 13 pgTAP proofs, 2 rollback/reapply proofs, cleanup complete; partial release coverage");
			expect(result.output).not.toContain("8 passed");
		} else {
			expect(result.trace.slice(-11)).toEqual([
				lane === "browser" ? "sql1" : "sql3", lane === "browser" ? "sql2" : "sql4",
				"migration2", "build", ...Array<string>(5).fill("server"), "playwright", "cleanup",
			]);
			expect(result.output).toContain(lane === "browser" ? "Browser lane passed: 8 passed, 0 skipped, disposable stack cleaned; partial release coverage" : "E2E release gate passed: 8 passed");
		}
	});

	it.each(["network-id-empty", "network-id-malformed", "network-id-multiline"])("rejects %s before DB startup and cleans up once", async (fault) => {
		const result = await runLane(["--lane", "browser"], fault);
		expect(result.failure).toEqual(new Error("owned network identity is invalid; output redacted"));
		expect(result.trace).toEqual(["network", "cleanup"]);
		for (const value of ["PRIVATE_OUTPUT_MARKER", "b".repeat(64), "c".repeat(64)])
			expect(result.output).not.toContain(value);
	});

	it("ETL leaves post-bootstrap migrations to its disposable database, without REST readiness", async () => {
		for (const key of ["DATABASE_URL", "PGHOST", "ETL_TEST_DATABASE_URL", "SUPABASE_DB_URL"])
			vi.stubEnv(key, `ambient-${key}`);
		let result: Awaited<ReturnType<typeof runLane>>;
		try {
			result = await runLane(["--run"], "", "etl");
		} finally {
			vi.unstubAllEnvs();
		}
		expect(result.failure).toBeUndefined();
		expect(result.trace).toEqual(["network", "db-start", "db-inspect", "publication", "status", "pending-before-uv", "etl", "cleanup"]);
		expect(result.commands.filter(({ command, args }) => command === "supabase" && args[0] === "migration" && args[1] === "up")).toHaveLength(0);
		expect(result.readinessRequests).toHaveLength(0);
		const etl = result.commands.find(({ command }) => command === "uv");
		expect(etl).toEqual(expect.objectContaining({
			command: "uv", args: ["run", "--project", "etl", "etl-verify"],
			cwd: expect.any(String),
			env: expect.objectContaining({ ETL_TEST_ADMIN_DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:46006/template1" }),
		}));
		expect(etl?.env?.ETL_TEST_ADMIN_DATABASE_URL).toBe("postgresql://postgres:postgres@127.0.0.1:46006/template1");
		for (const key of ["DATABASE_URL", "PGHOST", "ETL_TEST_DATABASE_URL", "SUPABASE_DB_URL"])
			expect(etl?.env).not.toHaveProperty(key);
		for (const key of ["PATH", "HOME", "TMPDIR"])
			if (process.env[key] !== undefined) expect(etl?.env?.[key]).toBe(process.env[key]);
		expect(result.trace.some((phase) => phase.startsWith("sql") || phase.startsWith("pgtap") || phase === "playwright" || phase === "migration2")).toBe(false);
		expect(result.output).not.toContain("PRIVATE_OUTPUT_MARKER");
	});

	it("ETL does not require workspace_api REST readiness before its migrations", async () => {
		const result = await runLane(["--run"], "http-503", "etl");
		expect(result.failure).toBeUndefined();
		expect(result.trace).toEqual(["network", "db-start", "db-inspect", "publication", "status", "pending-before-uv", "etl", "cleanup"]);
		expect(result.readinessRequests).toHaveLength(0);
	});

	it("ETL default executor cleans up a failing child without success or secret output", async () => {
		const result = await runLane(["--run"], "etl-failure", "etl");
		expect(result.output).toContain('E2E_ETL_DIAGNOSTIC {"schemaVersion":1,"reason":"child_exit","exitCode":1,"stage":"apply_migrations","migration":"0022_results_exploration_scale.sql","sqlstate":"42710"}');
		expect(result.failure).toMatchObject({ stage: "apply_migrations" });
		expect(result.failure).toMatchObject({ message: "ETL child failed; details redacted", reason: "child_exit", exitCode: 1 });
		expect(result.trace.slice(-2)).toEqual(["etl", "cleanup"]);
		expect(result.output).not.toMatch(/passed:|PRIVATE_OUTPUT_MARKER|postgres:postgres|synthetic-service/);
	});

	it.each(["etl-migration-bad-name", "etl-migration-bad-state", "etl-migration-duplicate", "etl-migration-other-stage"])(
		"rejects %s migration evidence without leaking stderr", async (fault) => {
			const result = await runLane(["--run"], fault, "etl");
			if (fault === "etl-migration-other-stage")
				expect(result.output).toContain('"stage":"pytest"}');
			else
				expect(result.output).toContain('"stage":"apply_migrations","migration":null,"sqlstate":null}');
			expect(result.output).not.toMatch(/private_secret|E2E_ETL_MIGRATION|\.\.\/private|PRIVATE_OUTPUT_MARKER/);
		},
	);

	it("recognizes the bounded ETL stage between long private stderr lines", async () => {
		const result = await runLane(["--run"], "etl-long-private", "etl");
		expect(result.failure).toMatchObject({ reason: "child_exit", exitCode: 1, stage: "pytest" });
		expect(result.output).toContain('E2E_ETL_DIAGNOSTIC {"schemaVersion":1,"reason":"child_exit","exitCode":1,"stage":"pytest"}');
		expect(result.output).not.toMatch(/private_secret|PRIVATE_OUTPUT_MARKER|E2E_ETL_STAGE/);
		expect(result.trace.filter((phase) => phase === "cleanup")).toHaveLength(1);
	});

	it.each(["etl-stage-unknown", "etl-stage-malformed", "etl-stage-oversized", "etl-stage-midline", "etl-stage-duplicate"]) (
		"rejects %s stage evidence without leaking stderr", async (fault) => {
			const result = await runLane(["--run"], fault, "etl");
			expect(result.failure).toMatchObject({ reason: "child_exit", stage: null });
			expect(result.output).toContain('E2E_ETL_DIAGNOSTIC {"schemaVersion":1,"reason":"child_exit","exitCode":1,"stage":null}');
			expect(result.output).not.toMatch(/private_secret|E2E_ETL_STAGE/);
		},
	);

	it.each([
		["etl-spawn-error", "spawn_error"],
		["etl-exit-999", "child_exit"],
	] as const)("reports bounded ETL %s without leaking child details", async (fault, reason) => {
		const result = await runLane(["--run"], fault, "etl");
		expect(result.failure).toMatchObject({ reason, exitCode: fault === "etl-exit-999" ? 999 : null });
		expect(result.output).toContain(`E2E_ETL_DIAGNOSTIC {"schemaVersion":1,"reason":"${reason}","exitCode":null,"stage":null}`);
		expect(result.output).not.toMatch(/PRIVATE_OUTPUT_MARKER|passed;|postgres:postgres|synthetic-service|999/);
		expect(result.trace.filter((phase) => phase === "cleanup")).toHaveLength(1);
		expect(result.trace.at(-1)).toBe("cleanup");
	});

	it.each(["etl-enoent-close", "etl-enoent-no-close"])("bounds undefined-PID ENOENT settlement at public entry: %s", async (fault) => {
		const result = await runLane(["--run"], fault, "etl");
		if (fault === "etl-enoent-close") expect(result.failure).toMatchObject({ reason: "spawn_error", exitCode: null });
		else expect((result.failure as AggregateError).errors[0]).toMatchObject({ reason: "spawn_error", exitCode: null });
		expect(result.trace.filter((phase) => phase === "cleanup")).toHaveLength(fault === "etl-enoent-close" ? 1 : 0);
		if (fault === "etl-enoent-close") expect(result.trace.indexOf("etl-close")).toBeLessThan(result.trace.indexOf("cleanup"));
		else {
			expect(result.workdirExists).toBe(true);
			expect(result.recoverySidecarExists).toBe(true);
			expect(result.recoveryMode).toBe(0o600);
			expect(result.recoveryRecord).toEqual({
				schemaVersion: 2,
				status: "pending_child",
				ownerPid: process.pid,
				projectId: "votus-e2e-12345678123441238123",
				workdir: result.ownedWorkdir,
				token: "12345678-1234-4123-8123-123456789abc",
				repositoryRoot: resolve(fileURLToPath(import.meta.url), "../../../.."),
			});
		}
		expect(result.killCalls).toEqual([]);
		expect(result.output).not.toMatch(/PRIVATE_OUTPUT_MARKER|passed;|postgres:postgres/);
	});

	it("stops the owned ETL group before stack cleanup on SIGTERM", async () => {
		const result = await runLane(["--run"], "etl-signal", "etl");
		expect(result.trace.slice(-4)).toEqual(["etl", "child-term", "child-close", "cleanup"]);
		expect(result.killCalls?.every(([, signal]) => signal === 0)).toBe(true);
		expect(result.trace.filter((phase) => phase === "cleanup")).toHaveLength(1);
		expect(result.exitCode).toBe(143);
		expect(result.output).not.toMatch(/passed;|postgres:postgres|synthetic-service/);
	});

	it("prelaunch SIGTERM waits for preparation and never starts ETL", async () => {
		const result = await runLane(["--run"], "etl-prelaunch-signal", "etl");
		expect(result.cleanupBeforePrelaunchSettlement, JSON.stringify(result.trace)).toBe(false);
		expect(result.commands.some(({ command }) => command === "uv")).toBe(false);
		expect(result.trace).not.toContain("etl");
		expect(result.trace.filter((phase) => phase === "cleanup")).toHaveLength(1);
		expect(result.recoverySidecarExists).toBe(false);
		expect(result.exitCode).toBe(143);
		expect(result.output).not.toMatch(/passed;|postgres:postgres|PRIVATE_OUTPUT_MARKER/);
	});

	it("times out an unresponsive ETL child and settles it before stack cleanup", async () => {
		const result = await runLane(["--run"], "etl-timeout", "etl");
		expect(result.failure).toMatchObject({ message: "ETL timed out; details redacted", reason: "timeout", exitCode: null });
		expect(result.output).toContain('E2E_ETL_DIAGNOSTIC {"schemaVersion":1,"reason":"timeout","exitCode":null,"stage":null}');
		expect(result.trace.slice(-4)).toEqual(["etl", "child-term", "child-close", "cleanup"]);
		expect(result.trace.filter((phase) => phase === "cleanup")).toHaveLength(1);
		expect(result.output).not.toMatch(/passed;|postgres:postgres|synthetic-service/);
	});

	it("identifies owned DB identity validation failure after DB start without exposing evidence", async () => {
		const result = await runLane(["--run"], "identity-project", "etl");
		expect(result.trace).toEqual(["network", "db-start", "db-inspect", "cleanup"]);
		expect(result.commands.some(({ command }) => command === "uv")).toBe(false);
		expect(result.output).toContain('E2E_RELEASE_GATE_FAILURE {"schemaVersion":1,"operation":"owned_db_identity_validate","reason":"invalid_identity","exitCode":null}');
		expect(result.output).not.toMatch(/PRIVATE_OUTPUT_MARKER|postgres:postgres|votus-e2e-12345678/);
	});

	it("identifies invalid owned DB port publication after identity validation", async () => {
		const result = await runLane(["--run"], "etl-public-ip", "etl");
		expect(result.trace).toEqual(["network", "db-start", "db-inspect", "publication", "cleanup"]);
		expect(result.commands.some(({ command }) => command === "uv")).toBe(false);
		expect(result.output).toContain('E2E_RELEASE_GATE_FAILURE {"schemaVersion":1,"operation":"owned_db_publication_validate","reason":"invalid_publication","exitCode":null}');
		expect(result.output).not.toMatch(/PRIVATE_OUTPUT_MARKER|postgres:postgres|votus-e2e-12345678/);
	});

	it.each([["db-inspect", "owned_db_identity_inspect"], ["publication", "supabase_publication_inspect"], ["status", "owned_db_status_command"]] as const)("identifies failed %s command after DB startup", async (fault, operation) => {
		const result = await runLane(["--run"], fault, "etl");
		const boundary = fault === "db-inspect" ? ["network", "db-start", "db-inspect", "cleanup"] : fault === "publication" ? ["network", "db-start", "db-inspect", "publication", "cleanup"] : ["network", "db-start", "db-inspect", "publication", "status", "cleanup"];
		expect(result.trace).toEqual(boundary);
		expect(result.commands.some(({ command }) => command === "uv")).toBe(false);
		expect(result.output).toContain(`E2E_RELEASE_GATE_FAILURE {"schemaVersion":1,"operation":"${operation}","reason":"command_failed","exitCode":1}`);
		expect(result.output).not.toMatch(/PRIVATE_OUTPUT_MARKER|postgres:postgres|votus-e2e-12345678/);
	});

	it("identifies child launch constructor failure after validated status", async () => {
		const result = await runLane(["--run"], "etl-launch-throw", "etl");
		expect(result.trace).toEqual(["network", "db-start", "db-inspect", "publication", "status"]);
		expect(result.recoveryRecord).toMatchObject({ status: "pending_child" });
		expect(result.output).toContain('E2E_RELEASE_GATE_FAILURE {"schemaVersion":1,"operation":"owned_etl_child_launch","reason":"launch_failed","exitCode":null}');
		expect(result.output).not.toMatch(/SECRET_LAUNCH_PRIVATE|postgres:postgres|votus-e2e-12345678/);
	});

	it("identifies invalid DB_URL after successful status", async () => {
		const result = await runLane(["--run"], "etl-wrong-path", "etl");
		expect(result.trace).toEqual(["network", "db-start", "db-inspect", "publication", "status", "cleanup"]);
		expect(result.commands.some(({ command }) => command === "uv")).toBe(false);
		expect(result.output).toContain('E2E_RELEASE_GATE_FAILURE {"schemaVersion":1,"operation":"owned_db_status_validate","reason":"invalid_status","exitCode":null}');
		expect(result.output).not.toMatch(/PRIVATE_OUTPUT_MARKER|postgres:postgres|votus-e2e-12345678/);
	});

	it.each([
		["etl-public-json", "json", []], ["etl-public-lines", "schema", ["record_count"]],
		["etl-missing-binding", "schema", ["shape"]], ["etl-null-binding", "schema", ["shape"]],
		["etl-zero-bindings", "schema", ["zero_bindings"]], ["etl-multiple-bindings", "schema", ["multiple_bindings"]],
		["etl-public-ip", "schema", ["host_ip"]], ["etl-public-port", "schema", ["host_port"]],
		["etl-port-type", "schema", ["host_port"]], ["etl-binding-scalar", "schema", ["shape"]],
		["etl-binding-missing-field", "schema", ["shape"]],
		["etl-extra-port", "schema", ["extra_port_key"]], ["etl-extra-null-port", "schema", ["extra_port_key"]],
	] as const)("reports fixed owned DB publication diagnostics for %s", async (fault, stage, issues) => {
		const result = await runLane(["--run"], fault, "etl");
		expect(result.trace).toEqual(["network", "db-start", "db-inspect", "publication", "cleanup"]);
		expect(result.commands.some(({ command }) => command === "uv")).toBe(false);
		expect(result.output).toContain('E2E_RELEASE_GATE_FAILURE {"schemaVersion":1,"operation":"owned_db_publication_validate","reason":"invalid_publication","exitCode":null}');
		const diagnosticLines = result.output.split("\n").filter((line) => line.startsWith("E2E_RELEASE_GATE_PUBLICATION_DIAGNOSTIC "));
		expect(diagnosticLines).toHaveLength(1);
		const diagnostic = JSON.parse(diagnosticLines[0]!.slice("E2E_RELEASE_GATE_PUBLICATION_DIAGNOSTIC ".length));
		if (fault === "etl-multiple-bindings") expect(diagnostic).toMatchObject({ schemaVersion: 1, stage, issues });
		else expect(diagnostic).toEqual({ schemaVersion: 1, stage, issues });
		expect(result.output).not.toMatch(/PRIVATE_OUTPUT_MARKER|46006|46007|127\.0\.0\.1|postgres:postgres|votus-e2e-12345678|ZodError/);
	});

	const requestedBindingSummary = {
		count: "one", exactMatches: "zero", hosts: ["unspecified"], ports: ["expected"], malformedEntries: "zero",
	};

	it("reports duplicate expected bindings without exposing Docker values", async () => {
		const result = await runLane(["--run"], "etl-multiple-bindings", "etl");
		const line = result.output.split("\n").find((value) => value.startsWith("E2E_RELEASE_GATE_PUBLICATION_DIAGNOSTIC "))!;
		expect(JSON.parse(line.slice("E2E_RELEASE_GATE_PUBLICATION_DIAGNOSTIC ".length))).toEqual({
			schemaVersion: 1,
			stage: "schema",
			issues: ["multiple_bindings"],
			bindingEvidence: {
				requested: requestedBindingSummary,
				observed: {
					count: "multiple",
					exactMatches: "multiple",
					hosts: ["expected_ipv4_loopback"],
					ports: ["expected"],
					malformedEntries: "zero",
				},
			},
		});
		expect(result.trace).toEqual(["network", "db-start", "db-inspect", "publication", "cleanup"]);
		expect(result.commands.find(({ command, args }) => command === "docker" && args[0] === "inspect")?.args[2]).toBe('{"requested":{{json .HostConfig.PortBindings}},"observed":{{json .NetworkSettings.Ports}}}');
		expect(result.commands.some(({ command }) => command === "uv")).toBe(false);
		expect(result.output).not.toMatch(/PRIVATE_OUTPUT_MARKER|46006|127\.0\.0\.1|postgres:postgres/);
	});

	it("distinguishes duplicate requested bindings from Docker-only duplicates", async () => {
		const result = await runLane(["--run"], "etl-requested-multiple-bindings", "etl");
		const line = result.output.split("\n").find((value) => value.startsWith("E2E_RELEASE_GATE_PUBLICATION_DIAGNOSTIC "))!;
		expect(JSON.parse(line.slice("E2E_RELEASE_GATE_PUBLICATION_DIAGNOSTIC ".length))).toEqual({
			schemaVersion: 1, stage: "schema", issues: ["multiple_bindings"],
			bindingEvidence: {
				requested: { count: "multiple", exactMatches: "zero", hosts: ["unspecified"], ports: ["expected"], malformedEntries: "zero" },
				observed: { count: "multiple", exactMatches: "multiple", hosts: ["expected_ipv4_loopback"], ports: ["expected"], malformedEntries: "zero" },
			},
		});
		expect(result.commands.some(({ command }) => command === "uv")).toBe(false);
		expect(result.output).not.toMatch(/PRIVATE_OUTPUT_MARKER|46006|127\.0\.0\.1|postgres:postgres/);
	});

	it.each(["etl-mixed-bindings", "etl-dual-loopback-reversed"])("accepts %s exact dual-loopback publication and runs isolated ETL", async (fault) => {
		const result = await runLane(["--run"], fault, "etl");
		expect(result.failure).toBeUndefined();
		expect(result.trace).toEqual(["network", "db-start", "db-inspect", "publication", "status", "pending-before-uv", "etl", "cleanup"]);
		expect(result.commands.filter(({ command }) => command === "uv")).toHaveLength(1);
		expect(result.workdirExists).toBe(false);
		expect(result.recoverySidecarExists).toBe(false);
		expect(result.output).toContain("Isolated ETL verification passed; owned stack cleaned");
		expect(result.output).not.toContain("E2E_RELEASE_GATE_PUBLICATION_DIAGNOSTIC");
		expect(result.output).not.toMatch(/PRIVATE_OUTPUT_MARKER|46006|127\.0\.0\.1|::1|postgres:postgres/);
	});

	it.each([
		"etl-dual-ipv6-only", "etl-multiple-bindings", "etl-dual-duplicate-v6", "etl-dual-extra-v6",
		"etl-extra-port", "etl-extra-null-port", "etl-null-binding",
		"etl-dual-wrong-ipv4-port", "etl-dual-wrong-ipv6-port",
		"etl-dual-missing-field", "etl-dual-extra-field", "etl-malformed-entry-bindings",
		"etl-wildcard-v4-bindings", "etl-wildcard-v6-bindings", "etl-other-host-bindings",
	] as const)("rejects %s as an invalid dual-loopback publication before ETL", async (fault) => {
		const result = await runLane(["--run"], fault, "etl");
		expect(result.failure).toBeInstanceOf(Error);
		expect(result.trace).toEqual(["network", "db-start", "db-inspect", "publication", "cleanup"]);
		expect(result.commands.some(({ command }) => command === "uv")).toBe(false);
		expect(result.output).toContain('"operation":"owned_db_publication_validate","reason":"invalid_publication"');
		expect(result.output).not.toMatch(/PRIVATE_OUTPUT_MARKER|46006|46007|127\.0\.0\.1|::1|0\.0\.0\.0|192\.0\.2\.1|postgres:postgres/);
	});

	it.each([
		["etl-wildcard-v4-bindings", "wildcard_ipv4", "0.0.0.0"],
		["etl-wildcard-v6-bindings", "wildcard_ipv6", "::"],
	] as const)("identifies %s without leaking the host address", async (fault, hostClass, rawAddress) => {
		const result = await runLane(["--run"], fault, "etl");
		const line = result.output.split("\n").find((value) => value.startsWith("E2E_RELEASE_GATE_PUBLICATION_DIAGNOSTIC "))!;
		expect(JSON.parse(line.slice("E2E_RELEASE_GATE_PUBLICATION_DIAGNOSTIC ".length))).toEqual({
			schemaVersion: 1, stage: "schema", issues: ["multiple_bindings"],
			bindingEvidence: { requested: requestedBindingSummary, observed: {
				count: "multiple", exactMatches: "one",
				hosts: ["expected_ipv4_loopback", hostClass],
				ports: ["expected"], malformedEntries: "zero",
			} },
		});
		expect(result.trace).toEqual(["network", "db-start", "db-inspect", "publication", "cleanup"]);
		expect(result.commands.some(({ command }) => command === "uv")).toBe(false);
		expect(result.output).not.toMatch(/PRIVATE_OUTPUT_MARKER|46006|127\.0\.0\.1|postgres:postgres/);
		expect(result.output).not.toContain(rawAddress);
	});

	it("separates a different IPv4 loopback address from the expected address", async () => {
		const result = await runLane(["--run"], "etl-other-v4-loopback-bindings", "etl");
		const line = result.output.split("\n").find((value) => value.startsWith("E2E_RELEASE_GATE_PUBLICATION_DIAGNOSTIC "))!;
		expect(JSON.parse(line.slice("E2E_RELEASE_GATE_PUBLICATION_DIAGNOSTIC ".length))).toEqual({
			schemaVersion: 1, stage: "schema", issues: ["multiple_bindings"],
			bindingEvidence: { requested: requestedBindingSummary, observed: {
				count: "multiple", exactMatches: "one",
				hosts: ["expected_ipv4_loopback", "other_ipv4_loopback"],
				ports: ["expected"], malformedEntries: "zero",
			} },
		});
		expect(result.trace).toEqual(["network", "db-start", "db-inspect", "publication", "cleanup"]);
		expect(result.commands.some(({ command }) => command === "uv")).toBe(false);
		expect(result.output).not.toMatch(/PRIVATE_OUTPUT_MARKER|46006|127\.0\.0\.[12]|postgres:postgres/);
	});

	it.each([
		["etl-other-host-bindings", ["expected_ipv4_loopback", "other_host"], ["expected"], "zero"],
		["etl-malformed-host-bindings", ["expected_ipv4_loopback", "malformed_host"], ["expected"], "zero"],
		["etl-empty-port-bindings", ["expected_ipv4_loopback"], ["expected", "empty"], "zero"],
		["etl-other-port-bindings", ["expected_ipv4_loopback"], ["expected", "other"], "zero"],
		["etl-malformed-port-bindings", ["expected_ipv4_loopback"], ["expected", "malformed"], "zero"],
		["etl-malformed-entry-bindings", ["expected_ipv4_loopback", "malformed_host"], ["expected", "malformed"], "one"],
	] as const)("classifies all observed publication dimensions for %s without raw values", async (fault, hosts, ports, malformedEntries) => {
		const result = await runLane(["--run"], fault, "etl");
		const line = result.output.split("\n").find((value) => value.startsWith("E2E_RELEASE_GATE_PUBLICATION_DIAGNOSTIC "))!;
		expect(JSON.parse(line.slice("E2E_RELEASE_GATE_PUBLICATION_DIAGNOSTIC ".length))).toEqual({
			schemaVersion: 1, stage: "schema", issues: ["multiple_bindings"],
			bindingEvidence: { requested: requestedBindingSummary, observed: {
				count: "multiple", exactMatches: "one", hosts, ports, malformedEntries,
			} },
		});
		expect(result.trace).toEqual(["network", "db-start", "db-inspect", "publication", "cleanup"]);
		expect(result.commands.some(({ command }) => command === "uv")).toBe(false);
		expect(result.output).not.toMatch(/PRIVATE_OUTPUT_MARKER|46006|46007|127\.0\.0\.1|192\.0\.2\.1|postgres:postgres/);
	});

	it.each(["etl-wrong-port", "etl-wrong-path", "etl-public-ip", "etl-public-port", "etl-extra-port", "etl-missing-url", "etl-missing-binding", "etl-multiple-bindings", "etl-malformed-status", "etl-nonobject-status"])("rejects %s before ETL spawn and cleans up", async (fault) => {
		const result = await runLane(["--run"], fault, "etl");
		expect(result.failure).toBeInstanceOf(Error);
		const reachedPhase = fault.startsWith("etl-public-") || fault === "etl-extra-port" || fault === "etl-missing-binding" || fault === "etl-multiple-bindings"
			? "publication" : "status";
		expect(result.trace).toEqual(["network", "db-start", "db-inspect", "publication", ...(reachedPhase === "status" ? ["status"] : []), "cleanup"]);
		expect(result.commands.some(({ command }) => command === "uv")).toBe(false);
		expect(result.output).not.toContain("PRIVATE_OUTPUT_MARKER");
	});

	it.each(["etl-marker-corrupt", "etl-marker-missing"])("reports bounded ETL ownership marker failure for %s and retains uncertain workdir", async (fault) => {
		const result = await runLane(["--run"], fault, "etl");
		expect(result.trace).toEqual(["network", "db-start"]);
		expect(result.commands.some(({ command }) => command === "uv")).toBe(false);
		expect(result.workdirExists).toBe(true);
		expect(result.output).toContain('E2E_RELEASE_GATE_FAILURE {"schemaVersion":1,"operation":"owned_db_marker_validate","reason":"invalid_identity","exitCode":null}');
		expect(result.output).toContain("E2E_RELEASE_GATE_CLEANUP_DIAGNOSTICS");
		expect(result.output).not.toMatch(/PRIVATE_MARKER_CONTENT|votus-e2e-12345678/);
	});

	it("rejects unowned ETL database identity before handoff and cleans up", async () => {
		const result = await runLane(["--run"], "identity-project", "etl");
		expect(result.failure).toMatchObject({ message: "owned database identity mismatch; output redacted" });
		expect(result.trace).toEqual(["network", "db-start", "db-inspect", "cleanup"]);
		expect(result.commands.some(({ command }) => command === "uv")).toBe(false);
		expect(result.readinessRequests).toHaveLength(0);
	});

	it.each(["identity-id", "identity-name", "identity-network", "identity-extra-network"])("refuses ETL database identity %s before child spawn and cleans up once", async (fault) => {
		const result = await runLane(["--run"], fault, "etl");
		expect(result.failure).toMatchObject({ message: "owned database identity mismatch; output redacted" });
		expect(result.trace).toEqual(["network", "db-start", "db-inspect", "cleanup"]);
		expect(result.commands.some(({ command }) => command === "uv")).toBe(false);
		expect(result.trace.filter((phase) => phase === "cleanup")).toHaveLength(1);
	});

	it.each(["identity-json", "identity-id", "identity-name", "identity-project", "identity-network", "identity-extra-network"])("refuses database handoff for %s and cleans up once", async (fault) => {
		const result = await runLane(["--lane", "browser"], fault);
		expect(result.failure).toMatchObject({ message: "owned database identity mismatch; output redacted" });
		expect(result.trace).toEqual(["network", "db-start", "migration1", "db-inspect", "cleanup"]);
		expect(result.readinessRequests).toHaveLength(0);
		expect(result.output).not.toContain("PRIVATE_OUTPUT_MARKER");
		expect(result.output).not.toContain("lane passed:");
	});

	it.each(["attachment-missing", "attachment-nonstring", "attachment-malformed", "attachment-different"])("refuses %s before container removal and cleans up once", async (fault) => {
		const result = await runLane(["--lane", "browser"], fault);
		expect(result.failure).toMatchObject({ message: "owned database identity mismatch; output redacted" });
		expect(result.trace).toEqual(["network", "db-start", "migration1", "db-inspect", "cleanup"]);
		expect(result.commands.filter(({ args }) => args[0] === "container" && args[1] === "rm")).toHaveLength(0);
		expect(result.commands.filter(({ args }) => args[0] === "start" && !args.includes("--help"))).toHaveLength(0);
		for (const value of ["PRIVATE_OUTPUT_MARKER", "b".repeat(64), "c".repeat(64)])
			expect(result.output).not.toContain(value);
	});

	it.each(["db-start", "migration1", "db-inspect", "db-remove", "start"])("stops before readiness and proofs after %s failure", async (fault) => {
		const result = await runLane(["--lane", "browser"], fault);
		const phases = ["network", "db-start", "migration1", "db-inspect", "db-remove", "start"];
		expect(result.failure).toBeDefined();
		expect(result.trace).toEqual([...phases.slice(0, phases.indexOf(fault) + 1), "cleanup"]);
		expect(result.readinessRequests).toHaveLength(0);
		expect(result.output).not.toContain("PRIVATE_OUTPUT_MARKER");
		expect(result.output).not.toContain("lane passed:");
	});

	it.each(["http-503", "http-204", "http-301", "redirect", "timeout"])("fails closed without retries or credential output on REST %s", async (fault) => {
		const result = await runLane(["--lane", "browser"], fault);
		expect(result.failure).toEqual(new Error("workspace_api REST readiness failed; output redacted"));
		expect(result.trace).toEqual(["network", "db-start", "migration1", "db-inspect", "db-remove", "start", "publication", "status", "readiness", "cleanup"]);
		expect(result.readinessRequests).toHaveLength(1);
		expect(result.timeouts).toEqual([5000]);
		expect(result.cancelCount).toBe(fault.startsWith("http-") ? 1 : 0);
		for (const forbidden of ["synthetic-anon", "synthetic-service", "lane passed:", "release gate passed:"])
			expect(result.output).not.toContain(forbidden);
	});

	it.each([
		["sql", "pgtap:results_exploration.sql"], ["sql", "sql1"], ["sql", "sql2"],
		["sql", "sql3"], ["sql", "sql4"], ["sql", "status"], ["sql", "cleanup"], ["sql", "signal"],
		["browser", "sql1"], ["browser", "sql2"], ["browser", "playwright"],
		["browser", "status"], ["browser", "cleanup"], ["browser", "signal"],
	])("does not report success for %s lane failure at %s", async (lane, fault) => {
		const baseline = await runLane(["--lane", lane]);
		expect(baseline.failure).toBeUndefined();
		const result = await runLane(["--lane", lane], fault);
		expect(result.failure).toBeDefined();
		if (fault === "cleanup") {
			expect(result.workdirExists).toBe(true);
			expect(result.recoverySidecarExists).toBe(true);
		}
		expect(result.trace.at(-1)).toBe("cleanup");
		expect(result.trace.filter((phase) => phase === "cleanup")).toHaveLength(1);
		expect(result.output).not.toContain("lane passed:");
		expect(result.output).not.toContain("release gate passed:");
		expect(result.output).not.toContain("PRIVATE_OUTPUT_MARKER");
	});
});

describe("migration release-gate integration", () => {
	const EXPECTED_MIGRATION_VERSIONS = [
		...Array.from({ length: 38 }, (_, index) =>
			String(index + 1).padStart(4, "0"),
		),
		"20260824193650",
		"20260825144358",
		"20260825165116",
		"20260825180048",
		"20260826033130",
		"20260826050000",
		"20260826120000",
		"20260826160000",
		"20260826200000",
		"20260827000000",
		"20260827040000",
		"20260827112658",
		"20260827130000",
		"20260827160000",
		"20260827170000",
		"20260827200000",
		"20260827220000",
		"20260829032228",
		"20260829232200",
		"20260830180653",
		"20260830203643",
		"20260831032044",
		"20260831055357",
		"20260831150450",
		"20260831160422",
		"20260904035355",
		"20260910212254",
		"20260923000000",
		"20260923000001",
	];
	it("inspects the exact production migration and proof plan", async () => {
		const plan = await inspectReleaseGatePlan();
		expect(plan.mode).toBe(RELEASE_GATE_MODE.FULL);
		expect(plan.migrationVersions).toEqual(EXPECTED_MIGRATION_VERSIONS);
		expect(plan.syntheticMigration).toEqual({
			version: "0039",
			fileName: "0039_e2e_service_role_grants.sql",
			sourcePath: "e2e/service-role-grants.sql",
		});
		expect(
			new Set([...plan.migrationVersions, plan.syntheticMigration.version]).size,
		).toBe(68);
		expect(plan.setupProofs).toEqual([
			{
				path: "tests/results_exploration_scale_setup.sql",
				label: "disposable scale fixture setup",
				timeoutMs: 600_000,
				beforePgTapPath: "tests/results_exploration_scale.sql",
			},
		]);
		expect(plan.pgTapProofs).toEqual([
			{
				path: "tests/results_exploration.sql",
				label: "disposable results-exploration pgTAP",
				timeoutMs: 120_000,
			},
			{
				path: "tests/results_exploration_scale.sql",
				label: "disposable scale payload/parity pgTAP",
				timeoutMs: 360_000,
			},
			{
				path: "tests/results_exploration_scale_plans.sql",
				label: "disposable scale EXPLAIN/plan pgTAP",
				timeoutMs: 360_000,
			},
			{
				path: "tests/results_coverage_scope_binding.sql",
				label: "disposable coverage-scope-binding pgTAP",
				timeoutMs: 120_000,
			},
			{
				path: "tests/workspace_foundation.sql",
				label: "disposable workspace-foundation pgTAP",
				timeoutMs: 120_000,
			},
			{
				path: "tests/workspace_administration.sql",
				label: "disposable workspace-administration pgTAP",
				timeoutMs: 120_000,
			},
			{
				path: "tests/workspace_context_invalidation.sql",
				label: "disposable workspace-context invalidation pgTAP",
				timeoutMs: 120_000,
			},
			{
				path: "tests/workspace_review_scope.sql",
				label: "disposable workspace-review-scope pgTAP",
				timeoutMs: 120_000,
			},
			{
				path: "tests/workspace_authorized_facets.sql",
				label: "disposable workspace-authorized-facets pgTAP",
				timeoutMs: 120_000,
			},
			{
				path: "tests/workspace_authorized_operations.sql",
				label: "disposable workspace-authorized-operations pgTAP",
				timeoutMs: 120_000,
			},
			{
				path: "tests/workspace_authorized_projections.sql",
				label: "disposable workspace-authorized-projections pgTAP",
				timeoutMs: 120_000,
			},
			{
				path: "tests/workspace_authorized_fiscal_review.sql",
				label: "disposable workspace-authorized-review pgTAP",
				timeoutMs: 120_000,
			},
			{
				path: "tests/workspace_authorized_fiscal_coverage.sql",
				label: "disposable workspace-authorized-coverage pgTAP",
				timeoutMs: 120_000,
			},
		]);
		expect(plan.postPgTapCleanupProofs).toEqual([
			{
				path: "tests/results_exploration_scale_cleanup.sql",
				label: "disposable scale fixture SQL cleanup",
				timeoutMs: 360_000,
				afterPgTapPath: "tests/results_exploration_scale_plans.sql",
			},
		]);
		expect(plan.rollbackReapplyProofs).toEqual([
			{
				path: "tests/results_exploration_release.sql",
				label: "disposable rollback/reapply proof",
			},
			{
				path: "tests/results_coverage_scope_binding_release.sql",
				label: "disposable coverage-scope-binding rollback/reapply proof",
			},
		]);
		expect(plan.requireBrowserCapability).toBe(true);
		expect(plan.runBrowser).toBe(true);
	});
	it("accepts the exact production migration inventory", async () => {
		const plan = await inspectReleaseGatePlan();
		const names = await assertSourceInventory(
			plan.migrationVersions,
			plan.syntheticMigration,
		);
		expect(names).toHaveLength(plan.migrationVersions.length);
		expect(names.at(-1)).toBe(
			"20260923000001_curate_2023_municipal_identities.sql",
		);
	});
	it("stages only the idempotent role bootstrap before the ETL-owned migration replay", async () => {
		const names = await assertSourceInventory((await inspectReleaseGatePlan()).migrationVersions, (await inspectReleaseGatePlan()).syntheticMigration);
		expect(names.slice(0, 12)).toContain("0009_etl_write_grants.sql");
		expect(names.slice(0, 12)).toContain("0010_etl_writer_no_default_password.sql");
		expect(names.slice(0, 12)).not.toContain("0022_results_exploration_scale.sql");
		const sql = readFileSync(fileURLToPath(new URL("../../../supabase/migrations/0009_etl_write_grants.sql", import.meta.url)), "utf8");
		expect(sql).toMatch(/if not exists[\s\S]*?rolname = 'etl_writer'[\s\S]*?create role etl_writer/i);
	});
	it("runs ETL after database ownership and status without starting application services or replaying production migrations", async () => {
		const plan = createReleaseGatePlan(RELEASE_GATE_MODE.ETL);
		const trace: string[] = [];
		await runProductionReleasePhases(plan, {
			runProductionMigrations: async () => { trace.push("migrations"); },
			startApplicationServices: async () => { trace.push("services"); },
			validateOwnedEtlDatabase: async () => { trace.push("database-owned"); },
			validateStackStatus: async () => {
				trace.push("status");
				return { API_URL: "http://127.0.0.1:54321", DB_URL: "postgresql://postgres:postgres@127.0.0.1:54322/postgres", ANON_KEY: "anon", SERVICE_ROLE_KEY: "service" };
			},
			runOwnedEtl: async () => { trace.push("etl"); },
			runSetupProof: async () => { trace.push("proof"); },
			runPgTapProof: async () => { trace.push("proof"); },
			runPostPgTapCleanupProof: async () => { trace.push("proof"); },
			runRollbackReapplyProof: async () => { trace.push("proof"); },
			installSyntheticMigration: async () => { trace.push("synthetic"); },
		});
		expect(trace).toEqual(["database-owned", "status", "etl"]);
	});
	it("runs every production phase in plan order before installing synthetic 0039", async () => {
		const plan = await inspectReleaseGatePlan();
		const trace: string[] = [];
		const stack = await runProductionReleasePhases(plan, {
			runProductionMigrations: async () => {
				trace.push("production-migrations");
			},
			startApplicationServices: async () => {
				trace.push("application-services");
			},
			validateStackStatus: async () => {
				trace.push("stack-status");
				return {
					API_URL: "http://127.0.0.1:54321",
					DB_URL:
						"postgresql://postgres:postgres@127.0.0.1:54322/postgres",
					ANON_KEY: "anon",
					SERVICE_ROLE_KEY: "service",
				};
			},
			runSetupProof: async (proof) => {
				trace.push(`setup:${proof.label}`);
			},
			runPgTapProof: async (proof) => {
				trace.push(`pgTAP:${proof.label}`);
			},
			runPostPgTapCleanupProof: async (proof) => {
				trace.push(`post-pgTAP-cleanup:${proof.label}`);
			},
			runRollbackReapplyProof: async (proof) => {
				trace.push(`rollback:${proof.label}`);
			},
			installSyntheticMigration: async (migration) => {
				trace.push(`synthetic:${migration.fileName}`);
			},
		});
		expect(trace).toEqual([
			"production-migrations",
			"application-services",
			"stack-status",
			"pgTAP:disposable results-exploration pgTAP",
			"setup:disposable scale fixture setup",
			"pgTAP:disposable scale payload/parity pgTAP",
			"pgTAP:disposable scale EXPLAIN/plan pgTAP",
			"post-pgTAP-cleanup:disposable scale fixture SQL cleanup",
			"pgTAP:disposable coverage-scope-binding pgTAP",
			"pgTAP:disposable workspace-foundation pgTAP",
			"pgTAP:disposable workspace-administration pgTAP",
			"pgTAP:disposable workspace-context invalidation pgTAP",
			"pgTAP:disposable workspace-review-scope pgTAP",
			"pgTAP:disposable workspace-authorized-facets pgTAP",
			"pgTAP:disposable workspace-authorized-operations pgTAP",
			"pgTAP:disposable workspace-authorized-projections pgTAP",
			"pgTAP:disposable workspace-authorized-review pgTAP",
			"pgTAP:disposable workspace-authorized-coverage pgTAP",
			"rollback:disposable rollback/reapply proof",
			"rollback:disposable coverage-scope-binding rollback/reapply proof",
			"synthetic:0039_e2e_service_role_grants.sql",
		]);
		expect(stack.API_URL).toBe("http://127.0.0.1:54321");
	});
	it("stops before status and proofs when application services reject", async () => {
		const later = vi.fn();
		const migrations = vi.fn().mockResolvedValue(undefined);
		await expect(runProductionReleasePhases(await inspectReleaseGatePlan(), {
			runProductionMigrations: migrations,
			startApplicationServices: async () => { throw new Error("services failed"); },
			validateStackStatus: later,
			runSetupProof: later,
			runPgTapProof: later,
			runPostPgTapCleanupProof: later,
			runRollbackReapplyProof: later,
			installSyntheticMigration: later,
		})).rejects.toThrow("services failed");
		expect(migrations).toHaveBeenCalledOnce();
		expect(later).not.toHaveBeenCalled();
	});
	it("propagates a production phase rejection without running later phases", async () => {
		const plan = await inspectReleaseGatePlan();
		const trace: string[] = [];
		await expect(
			runProductionReleasePhases(plan, {
				startApplicationServices: async () => {},
				runProductionMigrations: async () => {
					trace.push("production-migrations");
				},
				validateStackStatus: async () => {
					trace.push("stack-status");
					return {
						API_URL: "http://127.0.0.1:54321",
						DB_URL:
							"postgresql://postgres:postgres@127.0.0.1:54322/postgres",
						ANON_KEY: "anon",
						SERVICE_ROLE_KEY: "service",
					};
				},
				runSetupProof: async (proof) => {
					trace.push(`setup:${proof.label}`);
				},
				runPgTapProof: async (proof) => {
					trace.push(`pgTAP:${proof.label}`);
					if (proof.path === "tests/results_exploration_scale_plans.sql")
						throw new Error("scale plan proof failed");
				},
				runPostPgTapCleanupProof: async (proof) => {
					trace.push(`post-pgTAP-cleanup:${proof.label}`);
				},
				runRollbackReapplyProof: async (proof) => {
					trace.push(`rollback:${proof.label}`);
				},
				installSyntheticMigration: async (migration) => {
					trace.push(`synthetic:${migration.fileName}`);
				},
			}),
		).rejects.toThrow("scale plan proof failed");
		expect(trace).toEqual([
			"production-migrations",
			"stack-status",
			"pgTAP:disposable results-exploration pgTAP",
			"setup:disposable scale fixture setup",
			"pgTAP:disposable scale payload/parity pgTAP",
			"pgTAP:disposable scale EXPLAIN/plan pgTAP",
		]);
	});
	it("does not retry post-pgTAP cleanup or run later phases when cleanup fails", async () => {
		const plan = await inspectReleaseGatePlan(["--scale-proof-only"]);
		const trace: string[] = [];
		await expect(
			runProductionReleasePhases(plan, {
				startApplicationServices: async () => {},
				runProductionMigrations: async () => {
					trace.push("production-migrations");
				},
				validateStackStatus: async () => {
					trace.push("stack-status");
					return {
						API_URL: "http://127.0.0.1:54321",
						DB_URL:
							"postgresql://postgres:postgres@127.0.0.1:54322/postgres",
						ANON_KEY: "anon",
						SERVICE_ROLE_KEY: "service",
					};
				},
				runSetupProof: async (proof) => {
					trace.push(`setup:${proof.label}`);
				},
				runPgTapProof: async (proof) => {
					trace.push(`pgTAP:${proof.label}`);
				},
				runPostPgTapCleanupProof: async (proof) => {
					trace.push(`post-pgTAP-cleanup:${proof.label}`);
					throw new Error("scale fixture cleanup failed");
				},
				runRollbackReapplyProof: async (proof) => {
					trace.push(`rollback:${proof.label}`);
				},
				installSyntheticMigration: async (migration) => {
					trace.push(`synthetic:${migration.fileName}`);
				},
			}),
		).rejects.toThrow("scale fixture cleanup failed");
		expect(trace).toEqual([
			"production-migrations",
			"stack-status",
			"setup:disposable scale fixture setup",
			"pgTAP:disposable scale payload/parity pgTAP",
			"pgTAP:disposable scale EXPLAIN/plan pgTAP",
			"post-pgTAP-cleanup:disposable scale fixture SQL cleanup",
		]);
	});
	it.each([
		{
			defect: "missing",
			actual: EXPECTED_MIGRATION_VERSIONS.slice(0, -1),
		},
		{
			defect: "duplicate",
			actual: [...EXPECTED_MIGRATION_VERSIONS.slice(0, -1), "0028"],
		},
		{
			defect: "skipped",
			actual: [
				...EXPECTED_MIGRATION_VERSIONS.slice(0, 13),
				...EXPECTED_MIGRATION_VERSIONS.slice(14),
				"0038",
			],
		},
		{
			defect: "extra",
			actual: [...EXPECTED_MIGRATION_VERSIONS, "0039"],
		},
	])("rejects a $defect migration inventory", ({ actual }) => {
		expect(() =>
			assertExactMigrationInventory(actual, EXPECTED_MIGRATION_VERSIONS),
		).toThrow(
			"migration inventory must be exactly versions 0001 through 20260923000000 plus 20260923000001",
		);
	});
	it.each([
		"0038missing-separator.sql",
		"0038_nested/path.sql",
		"2026082419365_short_timestamp.sql",
	])("rejects a malformed production migration filename: %s", (fileName) => {
		expect(() => migrationVersionFromFileName(fileName)).toThrow(
			`invalid production migration filename: ${fileName}`,
		);
	});
	it("rejects a synthetic migration version collision", async () => {
		const plan = await inspectReleaseGatePlan();
		expect(() =>
			assertSyntheticMigrationDoesNotCollide(
				["0038_production.sql", "0039_production.sql"],
				plan.syntheticMigration,
			),
		).toThrow(
			"synthetic migration 0039 collides with production migration 0039_production.sql",
		);
	});
	it("inspects release proofs without planning browser execution", async () => {
		const plan = await inspectReleaseGatePlan(["--release-proof-only"]);
		expect(plan.mode).toBe(RELEASE_GATE_MODE.RELEASE_PROOF_ONLY);
		expect(plan.pgTapProofs).toHaveLength(13);
		expect(plan.rollbackReapplyProofs).toHaveLength(2);
		expect(plan.requireBrowserCapability).toBe(true);
		expect(plan.runBrowser).toBe(false);
	});
	it("inspects only the scale proof for focused plan diagnosis", async () => {
		const plan = await inspectReleaseGatePlan(["--scale-proof-only"]);
		expect(plan.mode).toBe(RELEASE_GATE_MODE.SCALE_PROOF_ONLY);
		expect(plan.setupProofs).toEqual([
			{
				path: "tests/results_exploration_scale_setup.sql",
				label: "disposable scale fixture setup",
				timeoutMs: 600_000,
				beforePgTapPath: "tests/results_exploration_scale.sql",
			},
		]);
		expect(plan.pgTapProofs).toEqual([
			{
				path: "tests/results_exploration_scale.sql",
				label: "disposable scale payload/parity pgTAP",
				timeoutMs: 360_000,
			},
			{
				path: "tests/results_exploration_scale_plans.sql",
				label: "disposable scale EXPLAIN/plan pgTAP",
				timeoutMs: 360_000,
			},
		]);
		expect(plan.postPgTapCleanupProofs).toEqual([
			{
				path: "tests/results_exploration_scale_cleanup.sql",
				label: "disposable scale fixture SQL cleanup",
				timeoutMs: 360_000,
				afterPgTapPath: "tests/results_exploration_scale_plans.sql",
			},
		]);
		expect(plan.rollbackReapplyProofs).toEqual([]);
		expect(plan.requireBrowserCapability).toBe(false);
		expect(plan.runBrowser).toBe(false);
	});
	it("runs scale-only setup and proof without unrelated release phases", async () => {
		const plan = await inspectReleaseGatePlan(["--scale-proof-only"]);
		const trace: string[] = [];
		await runProductionReleasePhases(plan, {
			startApplicationServices: async () => {},
			runProductionMigrations: async () => {
				trace.push("production-migrations");
			},
			validateStackStatus: async () => {
				trace.push("stack-status");
				return {
					API_URL: "http://127.0.0.1:54321",
					DB_URL:
						"postgresql://postgres:postgres@127.0.0.1:54322/postgres",
					ANON_KEY: "anon",
					SERVICE_ROLE_KEY: "service",
				};
			},
			runSetupProof: async (proof) => {
				trace.push(`setup:${proof.label}`);
			},
			runPgTapProof: async (proof) => {
				trace.push(`pgTAP:${proof.label}`);
			},
			runPostPgTapCleanupProof: async (proof) => {
				trace.push(`post-pgTAP-cleanup:${proof.label}`);
			},
			runRollbackReapplyProof: async (proof) => {
				trace.push(`rollback:${proof.label}`);
			},
			installSyntheticMigration: async (migration) => {
				trace.push(`synthetic:${migration.fileName}`);
			},
		});
		expect(trace).toEqual([
			"production-migrations",
			"stack-status",
			"setup:disposable scale fixture setup",
			"pgTAP:disposable scale payload/parity pgTAP",
			"pgTAP:disposable scale EXPLAIN/plan pgTAP",
			"post-pgTAP-cleanup:disposable scale fixture SQL cleanup",
		]);
	});
	it("retains exact pgTAP stdout when a focused proof fails", () => {
		expect(
			formatPgTapFailure("scale proof", 1, "not ok 18 - shared blocks=3012\n"),
		).toBe(
			"scale proof failed (exit 1); pgTAP output:\nnot ok 18 - shared blocks=3012",
		);
	});
	it("inspects rollback proofs without browser or pgTAP work", async () => {
		const plan = await inspectReleaseGatePlan(["--rollback-proofs-only"]);
		expect(plan.mode).toBe(RELEASE_GATE_MODE.ROLLBACK_PROOFS_ONLY);
		expect(plan.setupProofs).toEqual([]);
		expect(plan.pgTapProofs).toEqual([]);
		expect(plan.rollbackReapplyProofs).toHaveLength(2);
		expect(plan.requireBrowserCapability).toBe(false);
		expect(plan.runBrowser).toBe(false);
	});
	it("proves the exact mixed-version results-exploration rollback while leaving unrelated 0024 installed", () => {
		const proof = readFileSync(
			new URL(
				"../../../supabase/tests/results_exploration_release.sql",
				import.meta.url,
			),
			"utf8",
		);
		const migrationSequence = Array.from(
			proof.matchAll(
				/\\ir \.\.\/migrations\/(down\/)?(\d{4}|\d{14})_[^\n]+\.sql/g,
			),
			([, down, version]) => `${version}-${down ? "down" : "up"}`,
		);
		expect(proof).toContain("68 as migration_inventory_count");
		expect(migrationSequence.some((entry) => entry.startsWith("0024-"))).toBe(
			false,
		);
		expect(migrationSequence).toEqual([
			"20260923000001-down",
			"20260923000000-down",
			"20260910212254-down",
			"20260904035355-down",
			"20260831160422-down",
			"20260831150450-down",
			"20260831055357-down",
			"20260831032044-down",
			"20260830203643-down",
			"20260830180653-down",
			"20260829232200-down",
			"20260829032228-down",
			"20260827220000-down",
			"20260827200000-down",
			"20260827170000-down",
			"20260827160000-down",
			"20260827130000-down",
			"20260827112658-down",
			"20260827040000-down",
			"20260827000000-down",
			"20260826200000-down",
			"20260826160000-down",
			"20260826120000-down",
			"20260826050000-down",
			"20260826033130-down",
			"20260825180048-down",
			"20260825165116-down",
			"20260825144358-down",
			"20260824193650-down",
			"0038-down",
			"0037-down",
			"0036-down",
			"0035-down",
			"0034-down",
			"0033-down",
			"0032-down",
			"0031-down",
			"0030-down",
			"0029-down",
			"0028-down",
			"0027-down",
			"0026-down",
			"0025-down",
			"0023-down",
			"0022-down",
			"0021-down",
			"0020-down",
			"0020-up",
			"0021-up",
			"0022-up",
			"0023-up",
			"0025-up",
			"0026-up",
			"0027-up",
			"0028-up",
			"0029-up",
			"0030-up",
			"0031-up",
			"0032-up",
			"0033-up",
			"0034-up",
			"0035-up",
			"0036-up",
			"0037-up",
			"0038-up",
			"20260824193650-up",
			"20260825144358-up",
			"20260825165116-up",
			"20260825180048-up",
			"20260826033130-up",
			"20260826050000-up",
			"20260826120000-up",
			"20260826160000-up",
			"20260826200000-up",
			"20260827000000-up",
			"20260827040000-up",
			"20260827112658-up",
			"20260827130000-up",
			"20260827160000-up",
			"20260827170000-up",
			"20260827200000-up",
			"20260827220000-up",
			"20260829032228-up",
			"20260829232200-up",
			"20260830180653-up",
			"20260830203643-up",
			"20260831032044-up",
			"20260831055357-up",
			"20260831150450-up",
			"20260831160422-up",
			"20260904035355-up",
			"20260910212254-up",
			"20260923000000-up",
			"20260923000001-up",
		]);
		expect(proof).toContain(
			"0028 rollback did not restore the exact 0026 facet discovery plan",
		);
		expect(proof).toContain(
			"0026 rollback did not restore the exact optimized five-argument facets definition",
		);
		expect(proof).toContain(
			"0037 forward apply did not preserve the six-argument public/internal facet boundary",
		);
		expect(proof).toContain(
			"0027 rollback changed explorer functions instead of dropping only its index",
		);
		expect(proof).toContain(
			"0027 forward apply installed the wrong non-official partial-index contract",
		);
		expect(proof).toContain(
			"0037 did not preserve bounded 0036 six-argument facet discovery",
		);
		expect(proof).toContain(
			"0037 internal facets base remained directly executable",
		);
	});
	it("hands the full scale and rollback/reapply proofs to production execution", async () => {
		const executedPlans: ReleaseGatePlan[] = [];
		await runReleaseGateCli([], {
			execute: async (plan) => {
				executedPlans.push(plan);
			},
			writeOutput: () => {
				throw new Error("execution mode must not emit an inspection plan");
			},
		});
		expect(executedPlans).toEqual([
			expect.objectContaining({
				mode: RELEASE_GATE_MODE.FULL,
				pgTapProofs: expect.arrayContaining([
					expect.objectContaining({
						path: "tests/results_exploration_scale.sql",
					}),
					expect.objectContaining({
						path: "tests/results_exploration_scale_plans.sql",
					}),
					expect.objectContaining({
						path: "tests/workspace_foundation.sql",
						label: "disposable workspace-foundation pgTAP",
						timeoutMs: 120_000,
					}),
					expect.objectContaining({
						path: "tests/workspace_administration.sql",
						label: "disposable workspace-administration pgTAP",
						timeoutMs: 120_000,
					}),
					expect.objectContaining({
						path: "tests/workspace_context_invalidation.sql",
						label: "disposable workspace-context invalidation pgTAP",
						timeoutMs: 120_000,
					}),
				]),
				postPgTapCleanupProofs: [
					expect.objectContaining({
						path: "tests/results_exploration_scale_cleanup.sql",
					}),
				],
				rollbackReapplyProofs: expect.arrayContaining([
					expect.objectContaining({
						path: "tests/results_exploration_release.sql",
					}),
				]),
			}),
		]);
	});
	it.each([
		{
			phase: "execution",
			argv: ["--release-proof-only", "--rollback-proofs-only"],
		},
		{
			phase: "inspection",
			argv: ["--scale-proof-only", "--rollback-proofs-only", "--inspect-plan"],
		},
	])("rejects conflicting reduced modes before $phase", async ({ argv }) => {
		let executed = false;
		let output = "";
		await expect(
			runReleaseGateCli(argv, {
				execute: async () => {
					executed = true;
				},
				writeOutput: (chunk) => {
					output += chunk;
				},
			}),
		).rejects.toThrow("reduced proof modes cannot be combined");
		expect(executed).toBe(false);
		expect(output).toBe("");
	});
	it("passes the same production plan from parsing to execution", async () => {
		const executedPlans: ReleaseGatePlan[] = [];
		await runReleaseGateCli(["--rollback-proofs-only"], {
			execute: async (plan) => {
				executedPlans.push(plan);
			},
			writeOutput: () => {
				throw new Error("execution mode must not emit an inspection plan");
			},
		});
		expect(executedPlans).toEqual([
			await inspectReleaseGatePlan(["--rollback-proofs-only"]),
		]);
	});
});
describe("base contracts", () => {
	it("keeps the canonical runner compatible with native strip-only mode", () => {
		const source = readFileSync(
			new URL("../scripts/e2e-release-gate.ts", import.meta.url),
			"utf8",
		);
		expect(() => stripTypeScriptTypes(source, { mode: "strip" })).not.toThrow();
	});
	it("keeps the authorized review browser fixture service-role-only and self-cleaning", () => {
		const fixtureSql = readFileSync(
			new URL("./service-role-grants.sql", import.meta.url),
			"utf8",
		);
		expect(fixtureSql).toContain(
			"create function public.e2e_setup_authorized_review_fixture(p_user_id uuid, p_review_item_id uuid) returns jsonb",
		);
		expect(fixtureSql).toContain(
			"create function public.e2e_cleanup_authorized_review_fixture(p_fixture jsonb) returns jsonb",
		);
		expect(fixtureSql).toContain("create function public.e2e_setup_authorized_fiscal_fixture(p_user_id uuid, p_distrito_code text, p_seccion_code text) returns jsonb"); expect(fixtureSql).toContain("'e2e-authorized-fiscal-browser-'||organization_id");
		expect(fixtureSql).toContain("create function public.e2e_extend_authorized_fiscal_fixture(p_fixture jsonb, p_distrito_code text, p_seccion_code text) returns jsonb");
		expect(fixtureSql).toContain("create function public.e2e_cleanup_authorized_fiscal_fixture(p_fixture jsonb) returns jsonb");
		expect(fixtureSql).toContain("create function public.e2e_revoke_authorized_fiscal_fixture(p_fixture jsonb) returns jsonb");
		expect(fixtureSql).toContain("update workspace_private.organization set entitlement_revision = entitlement_revision + 1");
		expect(fixtureSql).toContain("'extra_distrito_code'");
		expect(fixtureSql).toContain("'extra_seccion_code'");
		expect(fixtureSql).toContain("'owns_extra_section_scope'");
		expect(fixtureSql).toContain("fixture_has_extra");
		expect(fixtureSql).toContain("'revoked_scope_count', revoked_scope_count");
		expect(fixtureSql).toContain("delete from workspace_private.organization_section_entitlement where organization_id = fixture_organization_id");
		expect(fixtureSql.match(/security definer set search_path = ''/g)).toHaveLength(6);
		expect(fixtureSql.match(/security definer set search_path = pg_catalog, pg_temp/g) ?? []).toHaveLength(0);
		const extension = fixtureFunctionBody(fixtureSql, "e2e_extend_authorized_fiscal_fixture");
		expect(extension).toMatch(/join workspace_private\.organization_membership membership on membership\.organization_id\s*=\s*organization\.id/);
		expect(extension).toMatch(/where\s+organization\.id\s*=\s*fixture_organization_id\s+and\s+organization\.slug\s*=\s*'e2e-authorized-fiscal-browser-'\|\|fixture_organization_id[\s\S]*?membership\.user_id\s*=\s*fixture_user_id\s+and\s+membership\.revoked_at\s+is\s+null[\s\S]*?\(entitlement\.distrito_code,\s*entitlement\.seccion_code\)\s*=\s*\(fixture_distrito_code,\s*fixture_seccion_code\)\s+and\s+entitlement\.revoked_at\s+is\s+null[\s\S]*?not exists\s*\(select 1 from workspace_private\.organization_section_entitlement other\s+where other\.organization_id\s*=\s*organization\.id\s+and\s+\(other\.distrito_code,\s*other\.seccion_code\)\s*<>\s*\(fixture_distrito_code,\s*fixture_seccion_code\)\)[\s\S]*?for update of organization, membership, entitlement;[\s\S]*?insert into workspace_private\.section_scope/);
		const cleanup = fixtureFunctionBody(fixtureSql, "e2e_cleanup_authorized_fiscal_fixture");
		for (const predicate of [/membership\.organization_id\s*=\s*fixture_organization_id\s+and\s+membership\.user_id\s*=\s*fixture_user_id\s+and\s+membership\.revoked_at\s+is\s+null/, /not exists\s*\(select 1 from workspace_private\.organization_section_entitlement entitlement\s+where entitlement\.organization_id\s*=\s*fixture_organization_id\s+and\s+\(entitlement\.distrito_code,\s*entitlement\.seccion_code\)\s*=\s*\(fixture_distrito_code,\s*fixture_seccion_code\)\)/, /fixture_has_extra and not exists\s*\(select 1 from workspace_private\.organization_section_entitlement entitlement\s+where entitlement\.organization_id\s*=\s*fixture_organization_id\s+and\s+\(entitlement\.distrito_code,\s*entitlement\.seccion_code\)\s*=\s*\(fixture_extra_distrito_code,\s*fixture_extra_seccion_code\)/, /exists\s*\(select 1 from workspace_private\.organization_section_entitlement entitlement\s+where entitlement\.organization_id\s*=\s*fixture_organization_id\s+and\s+\(entitlement\.distrito_code,\s*entitlement\.seccion_code\)\s*<>\s*\(fixture_distrito_code,\s*fixture_seccion_code\)\s+and\s+\(not fixture_has_extra or \(entitlement\.distrito_code,\s*entitlement\.seccion_code\)\s*<>\s*\(fixture_extra_distrito_code,\s*fixture_extra_seccion_code\)\)/]) expect(cleanup).toMatch(predicate);
		expect(cleanup).toMatch(/delete from workspace_private\.organization_membership where organization_id\s*=\s*fixture_organization_id\s+and\s+user_id\s*=\s*fixture_user_id;[\s\S]*?delete from workspace_private\.organization where id\s*=\s*fixture_organization_id\s+and\s+slug\s*=\s*'e2e-authorized-fiscal-browser-'\|\|fixture_organization_id;/);
		for (const guard of [/if fixture_owns_section_scope then[\s\S]*?delete from workspace_private\.section_scope scope\s+where \(scope\.distrito_code,\s*scope\.seccion_code\)\s*=\s*\(fixture_distrito_code,\s*fixture_seccion_code\)[\s\S]*?not exists\s*\(select 1 from workspace_private\.organization_section_entitlement entitlement\s+where \(entitlement\.distrito_code,\s*entitlement\.seccion_code\)\s*=\s*\(scope\.distrito_code,\s*scope\.seccion_code\)\)[\s\S]*?not exists\s*\(select 1 from workspace_private\.review_item_section_scope review_scope\s+where \(review_scope\.distrito_code,\s*review_scope\.seccion_code\)\s*=\s*\(scope\.distrito_code,\s*scope\.seccion_code\)/, /if fixture_has_extra and fixture_owns_extra_section_scope then[\s\S]*?delete from workspace_private\.section_scope scope\s+where \(scope\.distrito_code,\s*scope\.seccion_code\)\s*=\s*\(fixture_extra_distrito_code,\s*fixture_extra_seccion_code\)[\s\S]*?not exists\s*\(select 1 from workspace_private\.organization_section_entitlement entitlement\s+where \(entitlement\.distrito_code,\s*entitlement\.seccion_code\)\s*=\s*\(scope\.distrito_code,\s*scope\.seccion_code\)\)[\s\S]*?not exists\s*\(select 1 from workspace_private\.review_item_section_scope review_scope\s+where \(review_scope\.distrito_code,\s*review_scope\.seccion_code\)\s*=\s*\(scope\.distrito_code,\s*scope\.seccion_code\)/]) expect(cleanup).toMatch(guard);
		const revoke = fixtureFunctionBody(fixtureSql, "e2e_revoke_authorized_fiscal_fixture");
		for (const predicate of [/join workspace_private\.organization_membership membership on membership\.organization_id\s*=\s*organization\.id\s+where organization\.id\s*=\s*fixture_organization_id[\s\S]*?membership\.user_id\s*=\s*fixture_user_id\s+and\s+membership\.revoked_at\s+is\s+null/, /not exists\s*\(select 1 from workspace_private\.organization_section_entitlement entitlement\s+where entitlement\.organization_id\s*=\s*fixture_organization_id\s+and\s+entitlement\.revoked_at\s+is\s+null\s+and\s+\(entitlement\.distrito_code,\s*entitlement\.seccion_code\)\s*=\s*\(fixture_distrito_code,\s*fixture_seccion_code\)/, /fixture_has_extra and not exists\s*\(select 1 from workspace_private\.organization_section_entitlement entitlement\s+where entitlement\.organization_id\s*=\s*fixture_organization_id\s+and\s+entitlement\.revoked_at\s+is\s+null\s+and\s+\(entitlement\.distrito_code,\s*entitlement\.seccion_code\)\s*=\s*\(fixture_extra_distrito_code,\s*fixture_extra_seccion_code\)/, /exists\s*\(select 1 from workspace_private\.organization_section_entitlement entitlement\s+where entitlement\.organization_id\s*=\s*fixture_organization_id\s+and\s+\(entitlement\.distrito_code,\s*entitlement\.seccion_code\)\s*<>\s*\(fixture_distrito_code,\s*fixture_seccion_code\)\s+and\s+\(not fixture_has_extra or \(entitlement\.distrito_code,\s*entitlement\.seccion_code\)\s*<>\s*\(fixture_extra_distrito_code,\s*fixture_extra_seccion_code\)\)/]) expect(revoke).toMatch(predicate);
		expect(revoke).toMatch(/update workspace_private\.organization_section_entitlement set revoked_at\s*=\s*statement_timestamp\(\)\s+where organization_id\s*=\s*fixture_organization_id\s+and\s+revoked_at\s+is\s+null\s+and\s+\(\(distrito_code,\s*seccion_code\)\s*=\s*\(fixture_distrito_code,\s*fixture_seccion_code\)\s+or\s+\(fixture_has_extra\s+and\s+\(distrito_code,\s*seccion_code\)\s*=\s*\(fixture_extra_distrito_code,\s*fixture_extra_seccion_code\)\)\);\s+get diagnostics revoked_scope_count = row_count;\s+if revoked_scope_count <> \(case when fixture_has_extra then 2 else 1 end\)/);
		expect(fixtureSql).toContain(
			"revoke all on function public.e2e_setup_authorized_review_fixture(uuid, uuid) from public, anon, authenticated",
		);
		expect(fixtureSql).toContain(
			"revoke all on function public.e2e_cleanup_authorized_review_fixture(jsonb) from public, anon, authenticated",
		);
		expect(fixtureSql).toContain(
			"grant execute on function public.e2e_setup_authorized_review_fixture(uuid, uuid) to service_role",
		);
		expect(fixtureSql).toContain(
			"grant execute on function public.e2e_cleanup_authorized_review_fixture(jsonb) to service_role",
		);
		for (const signature of ["e2e_setup_authorized_fiscal_fixture(uuid,text,text)", "e2e_extend_authorized_fiscal_fixture(jsonb,text,text)", "e2e_cleanup_authorized_fiscal_fixture(jsonb)", "e2e_revoke_authorized_fiscal_fixture(jsonb)"]) {
			expect(fixtureSql).toContain(`revoke all on function public.${signature} from public, anon, authenticated`); expect(fixtureSql).toContain(`grant execute on function public.${signature} to service_role`);
		}
		expect(fixtureSql).toContain("select pg_notify('pgrst','reload schema')");
		expect(fixtureSql).toContain("delete from workspace_private.workspace_context");
		expect(fixtureSql).toContain("delete from public.review_item");
		expect(fixtureSql).toContain("delete from workspace_private.organization");
		expect(fixtureSql).toContain("'owns_section_scope'");
	});
	it("grants the audit owner the four fixture cleanup DELETE policies", () => {
		const fixtureSql = readFileSync(
			new URL("./service-role-grants.sql", import.meta.url),
			"utf8",
		);
		for (const [policy, table] of [
			["e2e_workspace_audit_organization_delete", "workspace_private.organization"],
			["e2e_workspace_audit_membership_delete", "workspace_private.organization_membership"],
			["e2e_workspace_audit_entitlement_delete", "workspace_private.organization_section_entitlement"],
			["e2e_workspace_audit_section_scope_delete", "workspace_private.section_scope"],
		])
			expect(fixtureSql).toContain(
				`create policy ${policy} on ${table} for delete to workspace_audit_owner using(true);`,
			);
	});
	it("keeps the isolated CI Postgres service passwordless", () => {
		const workflow = readFileSync(
			new URL("../../../.github/workflows/release-gates.yml", import.meta.url),
			"utf8",
		);
		const gateContract = readFileSync(
			new URL("./gate-contract.ts", import.meta.url),
			"utf8",
		);
		const passwordEnvironmentName = ["VOTUS_E2E_TEST_USER", "PASSWORD"].join("_");
		expect(workflow).toContain("POSTGRES_HOST_AUTH_METHOD: trust");
		expect(workflow).not.toContain(`${["POSTGRES", "PASSWORD"].join("_")}:`);
		expect(workflow).toContain("postgresql://postgres@127.0.0.1:54322/template1");
		expect(gateContract).not.toContain(`"${passwordEnvironmentName}"`);
	});
	it("allows an artifact step condition without changing its scope condition", () => {
		expectScopedReleaseJob(
			scopedJob("  e2e-release:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a\n        if: ${{ failure() }}\n"),
		);
	});
	it.each(["if: ${{ failure() }}", "needs: web-static", "strategy: {}"])(
		"rejects the release job-level restriction %s even with an artifact step",
		(restriction) => {
			expect(() => expectScopedReleaseJob(
				`  e2e-release:\n    ${restriction}\n    steps:\n      - uses: actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a\n        if: \${{ failure() }}\n`,
			)).toThrow();
		},
	);
	const etlStrategy = "    strategy:\n      fail-fast: false\n      matrix:\n        case: [ordinary, success, ledger, sql]\n";
	it("allows only the exact isolated ETL matrix", () => {
		expectScopedReleaseJob(scopedJob(`  etl-release:\n${etlStrategy}    steps:\n`));
	});
	it.each([
		etlStrategy.replace("false", "true"),
		etlStrategy.replace("ledger, sql", "ledger, sql, extra"),
		etlStrategy.replace("case:", "include:"),
		`${etlStrategy}      max-parallel: 1\n`,
		"",
	])("rejects an unsupported ETL matrix %s", (strategy) => {
		expect(() => expectScopedReleaseJob(scopedJob(`  etl-release:\n${strategy}    steps:\n`))).toThrow();
	});
	it.each(["web-static", "e2e-release", "e2e-sql"])("rejects the ETL matrix on %s", (job) => {
		expectScopedReleaseJob(scopedJob(`  ${job}:\n    steps:\n`));
		expect(() => expectScopedReleaseJob(scopedJob(`  ${job}:\n${etlStrategy}`))).toThrow();
	});
	it.each(["if: always()", "needs: web-static"])("rejects ETL job restriction %s", (restriction) => {
		expect(() => expectScopedReleaseJob(scopedJob(`  etl-release:\n${etlStrategy}    ${restriction}\n`))).toThrow();
	});
	function scopedJob(releaseJob: string): string {
		const id = releaseJob.match(/^  ([a-z0-9-]+):/)![1];
		const logicalGate = id === "e2e-sql" ? "e2e-release" : id;
		return releaseJob.replace("\n", `\n    needs: scope\n    if: \${{ !cancelled() && needs.scope.result == 'success' && contains(fromJSON(needs.scope.outputs.gates || '[]'), '${logicalGate}') }}\n`);
	}
	function expectScopedReleaseJob(releaseJob: string): void {
		// Match job keys at the workflow's four-space indentation, not nested step keys.
		const id = releaseJob.match(/^  ([a-z0-9-]+):/)![1];
		const logicalGate = id === "e2e-sql" ? "e2e-release" : id;
		expect(releaseJob.match(/^ {4}(?:if|needs):.*$/gm)).toEqual([
			"    needs: scope",
			`    if: \${{ !cancelled() && needs.scope.result == 'success' && contains(fromJSON(needs.scope.outputs.gates || '[]'), '${logicalGate}') }}`,
		]);
		if (releaseJob.startsWith("  etl-release:\n")) {
			expect(releaseJob.match(/^ {4}strategy:\n(?: {6,}.*\n)*/gm)).toEqual([etlStrategy]);
		} else {
			expect(releaseJob).not.toMatch(/^ {4}strategy:/m);
		}
	}
	it("keeps independent release proofs parallel and aggregates their exact results", () => {
		const workflow = readFileSync(
			new URL("../../../.github/workflows/release-gates.yml", import.meta.url),
			"utf8",
		);
		const jobs = workflow.slice(workflow.indexOf("jobs:\n"));
		const jobIds = Array.from(
			jobs.matchAll(/^  ([a-z][a-z0-9-]*):$/gm),
			([, jobId]) => jobId,
		);
		const job = (jobId: string) => {
			const start = jobs.indexOf(`  ${jobId}:\n`);
			const nextStart = jobIds
				.map((id) => jobs.indexOf(`  ${id}:\n`))
				.find((position) => position > start);
			return jobs.slice(start, nextStart);
		};
		const scope = job("scope");
		const webStatic = job("web-static");
		const etlRelease = job("etl-release");
		const e2eRelease = job("e2e-release");
		const e2eSql = job("e2e-sql");
		const verify = job("verify");

		expect(jobIds).toEqual([
			"scope",
			"web-static",
			"etl-release",
			"e2e-release",
			"e2e-sql",
			"verify",
		]);
		expect(workflow).toMatch(/^  pull_request:$/m);
		expect(workflow).toMatch(/^  push:\n    branches: \[main\]$/m);
		expect(workflow).not.toMatch(/^\s+paths(?:-ignore)?:/m);
		expect(workflow).toMatch(/^permissions:\n  contents: read$/m);
		for (const releaseJob of [webStatic, etlRelease, e2eRelease, e2eSql])
			expectScopedReleaseJob(releaseJob);

		expect(scope).toContain("name: scope");
		expect(scope).toContain("gates: ${{ steps.publish.outputs.gates }}");
		expect(scope).toContain("id: publish");
		expect(scope).toContain("SCOPE_JSON: ${{ steps.classify.outputs.json }}");
		expect(scope).toContain("id: classify");
		expect(scope).toContain(`printf '%s\\n' "$scope_json"`);
		expect(scope).toContain(`printf 'json=%s\\n' "$scope_json" >> "$GITHUB_OUTPUT"`);
		expect(scope).toContain("timeout-minutes: 2");
		expect(scope).toContain("persist-credentials: false");
		expect(scope).toContain("fetch-depth: 0");
		expect(scope).toContain("node-version: 24");
		expect(scope).toContain("--all");
		expect(scope).toContain("--base \"${{ github.event.pull_request.base.sha }}\"");
		expect(scope).toContain("--head \"${{ github.sha }}\"");

		expect(webStatic).toContain("timeout-minutes: 10");
		expect(webStatic).toContain("persist-credentials: false");
		expect(webStatic).toContain("version: 12.3.4");
		expect(webStatic).toContain("node-version: 24");
		expect(webStatic).toContain("pnpm/action-setup@");
		expect(webStatic).toContain("actions/setup-node@");
		expect(webStatic.match(/^\s*- run: pnpm install --frozen-lockfile$/gm)).toHaveLength(1);
		expect(webStatic.match(/^\s*- run: pnpm lint$/gm)).toHaveLength(1);
		expect(webStatic.match(/^\s*run: pnpm typecheck$/gm)).toHaveLength(1);
		expect(webStatic.match(/^\s*- run: pnpm test$/gm)).toHaveLength(1);
		expect(webStatic).not.toMatch(/services:|setup-uv|supabase\/setup-cli|playwright install|test:e2e:gate/);

		expect(etlRelease).toContain("timeout-minutes: 15");
		expect(etlRelease).toContain("services:");
		expect(etlRelease).toContain("image: postgres:17");
		expect(etlRelease).toContain("POSTGRES_HOST_AUTH_METHOD: trust");
		expect(etlRelease).toContain("postgresql://postgres@127.0.0.1:54322/template1");
		expect(etlRelease).toContain("astral-sh/setup-uv@");
		expect(etlRelease).toContain('version: "0.8.8"');
		expect(etlRelease).toContain("persist-credentials: false");
		expect(etlRelease).toContain("create role anon nologin");
		expect(etlRelease).toContain("create role authenticated nologin");
		expect(etlRelease).toContain("create role etl_writer login bypassrls password null");
		expect(etlRelease.match(/uv run --project \. --frozen ruff check \./g)).toHaveLength(1);
		expect(etlRelease.match(/uv run --project \. --frozen ruff format --check \./g)).toHaveLength(1);
		expect(etlRelease.match(/uv run --project etl etl-verify/g)).toHaveLength(2);
		expect(etlRelease).toContain("supabase/setup-cli@3c2f5e2ae34c34e428e8e206e2c4d21fa2d20fbf");
		expect(etlRelease).toContain("version: 2.116.0");
		expect(etlRelease).toContain("ETL_CASE: ${{ matrix.case }}");
		expect(etlRelease).toContain('if [ "$ETL_CASE" = "ordinary" ]; then');
		expect(etlRelease).toMatch(/^\s+uv run --project etl etl-verify$/m);
		expect(etlRelease).toContain('uv run --project etl etl-verify --migration-atomicity "$ETL_CASE"');
		expect(etlRelease).not.toMatch(/pnpm|setup-node|playwright/);
		expect(workflow).not.toMatch(/^\s+continue-on-error:/m);

		expect(e2eRelease).toContain("timeout-minutes: 20");
		expect(e2eRelease).toContain("pnpm/action-setup@");
		expect(e2eRelease).toContain("actions/setup-node@");
		expect(e2eRelease).toContain("supabase/setup-cli@");
		expect(e2eRelease).toContain("version: 12.3.4");
		expect(e2eRelease).toContain("node-version: 24");
		expect(e2eRelease).toContain("version: 2.112.0");
		expect(e2eRelease).toContain("persist-credentials: false");
		expect(e2eRelease.match(/^\s*- run: pnpm install --frozen-lockfile$/gm)).toHaveLength(1);
		expect(e2eRelease.match(/pnpm exec playwright install --with-deps chromium/g)).toHaveLength(1);
		expect(e2eRelease.match(/^\s*- run: pnpm evaluate:territorial-renderer -- --verify$/gm)).toHaveLength(1);
		expect(e2eRelease.indexOf("pnpm exec playwright install --with-deps chromium"))
			.toBeLessThan(e2eRelease.indexOf("pnpm evaluate:territorial-renderer -- --verify"));
		expect(e2eRelease.indexOf("pnpm evaluate:territorial-renderer -- --verify"))
			.toBeLessThan(e2eRelease.indexOf("pnpm test:e2e:gate --lane browser"));
		expect(e2eRelease.match(/^\s*- run: pnpm test:e2e:gate --lane browser$/gm)).toHaveLength(1);
		expect(e2eRelease).not.toMatch(/services:|setup-uv|uv run|postgres:17/);

		expect(e2eSql).toContain("timeout-minutes: 20");
		expect(e2eSql).toContain("runs-on: ubuntu-latest");
		expect(e2eSql).toContain("version: 12.3.4");
		expect(e2eSql).toContain("node-version: 24");
		expect(e2eSql).toContain("cache: pnpm");
		expect(e2eSql).toContain("cache-dependency-path: apps/web/pnpm-lock.yaml");
		expect(e2eSql).toContain("version: 2.112.0");
		expect(e2eSql).toContain("persist-credentials: false");
		expect(e2eSql.match(/^\s*- run: .*$/gm)?.map((line) => line.trim())).toEqual([
			"- run: pnpm install --frozen-lockfile",
			"- run: pnpm test:e2e:gate --lane sql",
		]);
		expect(e2eSql.match(/working-directory: apps\/web/g)).toHaveLength(2);
		expect(e2eSql).not.toMatch(/playwright|build|artifact|services:|setup-uv|uv run/);

		expect(verify).toContain("name: verify");
		expect(verify).toContain("timeout-minutes: 2");
		expect(verify).toMatch(
			/needs:\n      - scope\n      - web-static\n      - etl-release\n      - e2e-release\n      - e2e-sql/,
		);
		expect(verify).toContain("if: ${{ always() }}");
		expect(verify).toContain("${{ needs.scope.result }}");
		expect(verify).toContain("${{ needs.web-static.result }}");
		expect(verify).toContain("${{ needs.etl-release.result }}");
		expect(verify).toContain("${{ needs.e2e-release.result }}");
		expect(verify).toContain("E2E_SQL_RESULT: ${{ needs.e2e-sql.result }}");
		expect(verify).toContain("SCOPE_GATES: ${{ needs.scope.outputs.gates }}");

		const actionReferences = Array.from(
			workflow.matchAll(/^\s*- uses: [^@\s]+@([^\s]+)$/gm),
			([, revision]) => revision,
		);
		expect(actionReferences).toHaveLength(17);
		for (const revision of actionReferences)
			expect(revision).toMatch(/^[a-f0-9]{40}$/);
	});

	it("runs TypeScript 7 typechecking once across the release-gate builds", () => {
		const packageManifest = JSON.parse(
			readFileSync(new URL("../package.json", import.meta.url), "utf8"),
		) as { scripts: Record<string, string> };
		const workflow = readFileSync(
			new URL("../../../.github/workflows/release-gates.yml", import.meta.url),
			"utf8",
		);
		const e2eGate = readFileSync(
			new URL("../scripts/e2e-release-gate.ts", import.meta.url),
			"utf8",
		);

		expect(packageManifest.scripts.build).toBe("pnpm typecheck && pnpm build:next");
		expect(packageManifest.scripts["build:next"]).toBe(
			"node --experimental-strip-types ./scripts/production-build.ts",
		);
		expect(packageManifest.scripts["build:next"]).not.toContain("typecheck");
		expect(workflow.match(/^\s*run: pnpm typecheck\s*$/gm)).toHaveLength(1);
		expect(workflow).not.toMatch(
			/^\s*- run: pnpm build(?::next)?\s*$/gm,
		);
		expect(e2eGate.match(/\["build:next"\]/g)).toHaveLength(1);
		expect(e2eGate).toMatch(
			/RELEASE_GATE_TIMING_PHASE\.PRODUCTION_BUILD,\s*async \(\) => \s*\{\s*runChecked\(\s*"pnpm",\s*\["build:next"\]/s,
		);
		expect(e2eGate).not.toMatch(/\["(?:build|typecheck)"\]/);
	});
	it("runs owned setup SQL with in-container cancellation before the host fallback", () => {
		expect(planOwnedSqlInvocation(OWNERSHIP.projectId, 600_000)).toEqual({
			command: "docker",
			args: [
				"exec",
				"-i",
				`supabase_db_${OWNERSHIP.projectId}`,
				"timeout",
				"-s",
				"INT",
				"-k",
				"10",
				"600",
				"psql",
				"-X",
				"-v",
				"ON_ERROR_STOP=1",
				"-U",
				"postgres",
				"-d",
				"postgres",
			],
			hostTimeoutMs: 615_000,
		});
	});
	it.each([
		"foreign-project",
		"votus-e2e-owned;sh",
		"votus-e2e-owned-",
		`votus-e2e-${"a".repeat(30)}`,
	])("rejects unsafe owned SQL project ID %s", (projectId) => {
		expect(() => planOwnedSqlInvocation(projectId, 120_000)).toThrow(
			"owned SQL project ID is invalid",
		);
	});
	it.each([0, -1_000, 1_001, 601_000, Number.NaN])(
		"rejects unsafe owned SQL phase timeout %s",
		(timeoutMs) => {
			expect(() =>
				planOwnedSqlInvocation(OWNERSHIP.projectId, timeoutMs),
			).toThrow("owned SQL phase timeout");
		},
	);
	it("allows a cold CI runner to pull and start Supabase", () => {
		expect(SUPABASE_START_TIMEOUT_MS).toBe(10 * 60_000);
	});
	it("enables Next's test proxy only in every gate-owned product child environment", () => {
		const initialGateSignal = process.env.VOTUS_E2E_TEST_PROXY;
		const parentEnvironment: NodeJS.ProcessEnv = {
			NODE_ENV: "test",
			VOTUS_E2E_TEST_PROXY: "unrecognized",
		};
		for (const scenario of [
			"shared",
			"comparison",
			"fiscalizacion",
			"municipal",
			"provenance",
		] as const)
			expect(productEnvironment(parentEnvironment, scenario)).toMatchObject({
				VOTUS_E2E_TEST_PROXY: "1",
			});
		expect(parentEnvironment.VOTUS_E2E_TEST_PROXY).toBe("unrecognized");
		expect(process.env.VOTUS_E2E_TEST_PROXY).toBe(initialGateSignal);
	});
	it("requires and returns every generated environment value", () => {
		expect(assertE2eEnvironment(ENV)).toEqual(ENV);
		expect(() => assertE2eEnvironment({})).toThrow(
			["VOTUS_E2E_TEST_USER", "PASSWORD"].join("_"),
		);
	});
	it("accepts only the exact eight-pass inventory", () => {
		expect(() => assertGateReport(PASSED, "passed")).not.toThrow();
		expect(() => assertGateReport([], "passed")).toThrow("discovered 0 tests");
		expect(() =>
			assertGateReport([{ ...PASSED[0]!, spec: "e2e/other.spec.ts" }], "passed"),
		).toThrow("spec inventory mismatch");
		expect(() => assertGateReport(PASSED.slice(0, 4), "passed")).toThrow(
			"discovered 4 tests; expected 8",
		);
	});
	it.each(["skipped", "interrupted", "failed", "timedOut"] as const)(
		"rejects %s",
		(status) => {
			expect(() =>
				assertGateReport(
					[{ spec: PASSED[0]!.spec, status }, ...PASSED.slice(1)],
					"passed",
				),
			).toThrow(`${status}=1`);
		},
	);
	it("rejects a non-passing suite", () =>
		expect(() => assertGateReport(PASSED, "interrupted")).toThrow(
			"suite status=interrupted",
		));
	it("plans exact owned cleanup and refuses foreign scope or marker", () => {
		expect(
			planOwnedCleanup("/private/tmp", OWNERSHIP.workdir, OWNERSHIP, OWNERSHIP),
		).toEqual(ACTIONS);
		expect(() =>
			planOwnedCleanup("/private/tmp", "/protected", OWNERSHIP, OWNERSHIP),
		).toThrow("outside");
		expect(() =>
			planOwnedCleanup("/private/tmp", OWNERSHIP.workdir, OWNERSHIP, {
				...OWNERSHIP,
				token: "x",
			}),
		).toThrow("marker mismatch");
	});
	it("runs production Docker network adapters with argv-only redaction", () => {
		const network = `supabase_network_${OWNERSHIP.projectId}`;
		spawnSync.mockReturnValueOnce({ status: 0, stdout: `${network}\n` });
		expect(listOwnedNetworks(OWNERSHIP.projectId)).toEqual([network]);
		expect(spawnSync).toHaveBeenLastCalledWith("docker", ["network", "ls", "--filter", `name=supabase_network_${OWNERSHIP.projectId}`, "--format", "{{.Name}}"], expect.any(Object));
		spawnSync.mockReturnValueOnce({ status: 0, stdout: "" });
		removeOwnedNetworks([network, `--force_${OWNERSHIP.projectId}`]);
		expect(spawnSync).toHaveBeenLastCalledWith("docker", ["network", "rm", "--", network, `--force_${OWNERSHIP.projectId}`], expect.any(Object));
		spawnSync.mockReturnValueOnce({ status: 1, stdout: "network-enumeration-secret", stderr: "network-enumeration-secret" });
		expect(() => listOwnedNetworks(OWNERSHIP.projectId)).toThrowError(new Error("failed to enumerate disposable Supabase networks"));
	});
	const successfulCommand = (stdout = "") => ({ status: 0, stdout });
	const loopbackPublication = (hostIp: string) =>
		["5432/tcp", "8000/tcp"].map((port) =>
			JSON.stringify({ [port]: [{ HostIp: hostIp, HostPort: "46000" }] }),
		).join("\n");
	const MALFORMED_PORT_PUBLICATION = [
		JSON.stringify({ "5432/tcp": [{ HostIp: "127.0.0.1", HostPort: "46000" }] }),
		JSON.stringify({
			"8000/tcp": [{ HostIp: "127.0.0.1", HostPort: "46000" }],
			"8443/tcp": { HostIp: "127.0.0.1", HostPort: "46000" },
		}),
	].join("\n");
	const PUBLICATION_DIAGNOSTIC_PORT_MAPS = [
		JSON.stringify({ "5432/tcp": [{ HostIp: "127.0.0.1", HostPort: "0" }] }),
		JSON.stringify({
			PRIVATE_OUTPUT_MARKER: [
				{ HostIp: "0.0.0.0", HostPort: "46000" },
				{ HostIp: "0.0.0.0", HostPort: "46000" },
			],
		}),
	].join("\n");
	const SINGLE_PUBLICATION_RECORD = JSON.stringify({
		"5432/tcp": [{ HostIp: "127.0.0.1", HostPort: "46000" }],
	});
	const THREE_PUBLICATION_RECORDS = [
		SINGLE_PUBLICATION_RECORD,
		JSON.stringify({ "8000/tcp": [{ HostIp: "::1", HostPort: "46001" }] }),
		JSON.stringify({ "8443/tcp": [{ HostIp: "127.0.0.1", HostPort: "46002" }] }),
	].join("\n");
	const STRUCTURAL_PUBLICATION_RECORDS = [
		JSON.stringify(null),
		JSON.stringify({
			PRIVATE_OUTPUT_MARKER: { HostIp: "127.0.0.1", HostPort: "46000" },
			HostIp: [null],
			"8000/tcp": [{ HostIp: "127.0.0.1", HostPort: "0" }],
		}),
	].join("\n");
	const UNPUBLISHED_RECORDS = [
		JSON.stringify({ "5432/tcp": null, "5433/tcp": [] }),
		JSON.stringify({ "8000/tcp": [], "8443/tcp": null }),
	].join("\n");
	const EXPECTED_PUBLICATION_DIAGNOSTICS = new Map([
		["missing host publication proof", { stage: "json", issues: [] }],
		["publication diagnostic malformed JSON", { stage: "json", issues: [] }],
		["publication diagnostic unexpected error", { stage: "unexpected", issues: [] }],
		["publication diagnostic schema SyntaxError", { stage: "unexpected", issues: [] }],
		["publication diagnostic empty ZodError", { stage: "unexpected", issues: [] }],
		["publication diagnostic unknown issue", { stage: "schema", issues: ["host_port", "unclassified"] }],
		["publication diagnostic schema classes", { stage: "schema", issues: ["host_ip", "host_port"] }],
		["publication diagnostic single record", { stage: "schema", issues: ["record_count"] }],
		["publication diagnostic three records", { stage: "schema", issues: ["record_count"] }],
		["publication diagnostic structural levels", { stage: "schema", issues: ["shape", "host_port"] }],
		["publication diagnostic unpublished bindings", { stage: "schema", issues: ["unpublished"] }],
	]);
	const EXPECTED_PHASE_TRACE = {
		network: ["network", "cleanup"],
		startup: ["network", "db-start", "migration", "startup", "cleanup"],
		publication: ["network", "db-start", "migration", "startup", "publication", "cleanup"],
		migration: ["network", "db-start", "migration", "cleanup"],
		status: ["network", "db-start", "migration", "startup", "publication", "cleanup"],
		pgtap: ["network", "db-start", "migration", "startup", "publication", "pgtap", "cleanup"],
	} as const;
	const EXPECTED_FAILURE_RECORD = {
		PGTAP_UNAVAILABLE: {
			schemaVersion: 1,
			operation: "pgtap",
			reason: "command_failed",
			exitCode: null,
		},
		PGTAP: {
			schemaVersion: 1,
			operation: "pgtap",
			reason: "command_failed",
			exitCode: 7,
		},
		NETWORK_CREATE: {
			schemaVersion: 1,
			operation: "supabase_network_create",
			reason: "command_failed",
			exitCode: 1,
		},
		SUPABASE_START: {
			schemaVersion: 1,
			operation: "supabase_start",
			reason: "command_failed",
			exitCode: 1,
		},
		SUPABASE_START_UNAVAILABLE: {
			schemaVersion: 1,
			operation: "supabase_start",
			reason: "command_failed",
			exitCode: null,
		},
		PUBLICATION_INSPECT: {
			schemaVersion: 1,
			operation: "supabase_publication_inspect",
			reason: "command_failed",
			exitCode: 7,
		},
		PUBLICATION_VALIDATE: {
			schemaVersion: 1,
			operation: "supabase_publication_validate",
			reason: "invalid_publication",
			exitCode: null,
		},
	} as const;
	const INVALID_STARTUP_STATUSES = [-1, 256, 1.5] as const;
	const REJECTION_CASES = [
		["pgTAP safe diagnostics", "pgtap", "disposable scale payload/parity pgTAP failed", 0, loopbackPublication("127.0.0.1"), EXPECTED_FAILURE_RECORD.PGTAP, 0],
		...["pgTAP termination", "pgTAP unrecognized metadata"].map((scenario) => [
			scenario, "pgtap", "disposable scale payload/parity pgTAP failed", 0,
			loopbackPublication("127.0.0.1"), EXPECTED_FAILURE_RECORD.PGTAP_UNAVAILABLE, 0,
		] as const),
		...["malformed JSON", "unexpected error", "schema SyntaxError", "empty ZodError", "unknown issue"].map(
			(variant) => [
				`publication diagnostic ${variant}`, "publication",
				"Supabase host publication proof is absent or invalid", 0,
				variant === "malformed JSON"
					? `${SINGLE_PUBLICATION_RECORD}\nPRIVATE_OUTPUT_MARKER`
					: PUBLICATION_DIAGNOSTIC_PORT_MAPS,
				EXPECTED_FAILURE_RECORD.PUBLICATION_VALIDATE, 0,
			] as const,
		),
		["network creation failure", "network", "disposable Supabase network create", 0, undefined, EXPECTED_FAILURE_RECORD.NETWORK_CREATE, 0],
		["startup failure", "startup", "disposable Supabase start failed", 1, undefined, EXPECTED_FAILURE_RECORD.SUPABASE_START, 0],
		["startup diagnostics", "startup", "disposable Supabase start failed", 1, undefined, EXPECTED_FAILURE_RECORD.SUPABASE_START, 0],
		["startup failure with null status", "startup", "disposable Supabase start failed", null, undefined, EXPECTED_FAILURE_RECORD.SUPABASE_START_UNAVAILABLE, 0],
		...INVALID_STARTUP_STATUSES.map(
			(status) =>
				[
					`startup failure with status ${status}`,
					"startup",
					"disposable Supabase start failed",
					status,
					undefined,
					EXPECTED_FAILURE_RECORD.SUPABASE_START_UNAVAILABLE,
					0,
				] as const,
		),
		["publication inspection command failure", "publication", "disposable Supabase host publication is unavailable or failed its preflight check", 0, loopbackPublication("127.0.0.1"), EXPECTED_FAILURE_RECORD.PUBLICATION_INSPECT, 7],
		["missing host publication proof", "publication", "Supabase host publication proof is absent or invalid", 0, undefined, EXPECTED_FAILURE_RECORD.PUBLICATION_VALIDATE, 0],
		["malformed host publication", "publication", "Supabase host publication proof is absent or invalid", 0, MALFORMED_PORT_PUBLICATION, EXPECTED_FAILURE_RECORD.PUBLICATION_VALIDATE, 0],
		["publication diagnostic schema classes", "publication", "Supabase host publication proof is absent or invalid", 0, PUBLICATION_DIAGNOSTIC_PORT_MAPS, EXPECTED_FAILURE_RECORD.PUBLICATION_VALIDATE, 0],
		[
			"publication diagnostic single record", "publication",
			"Supabase host publication proof is absent or invalid", 0,
			SINGLE_PUBLICATION_RECORD, EXPECTED_FAILURE_RECORD.PUBLICATION_VALIDATE, 0,
		],
		[
			"publication diagnostic three records", "publication",
			"Supabase host publication proof is absent or invalid", 0,
			THREE_PUBLICATION_RECORDS, EXPECTED_FAILURE_RECORD.PUBLICATION_VALIDATE, 0,
		],
		[
			"publication diagnostic structural levels", "publication",
			"Supabase host publication proof is absent or invalid", 0,
			STRUCTURAL_PUBLICATION_RECORDS, EXPECTED_FAILURE_RECORD.PUBLICATION_VALIDATE, 0,
		],
		[
			"publication diagnostic unpublished bindings", "publication",
			"Supabase host publication proof is absent or invalid", 0,
			UNPUBLISHED_RECORDS, EXPECTED_FAILURE_RECORD.PUBLICATION_VALIDATE, 0,
		],
		["IPv4 wildcard host publication", "publication", "Supabase host publication proof is absent or invalid", 0, loopbackPublication("0.0.0.0"), EXPECTED_FAILURE_RECORD.PUBLICATION_VALIDATE, 0],
		["IPv6 wildcard host publication", "publication", "Supabase host publication proof is absent or invalid", 0, loopbackPublication("::"), EXPECTED_FAILURE_RECORD.PUBLICATION_VALIDATE, 0],
		["migration failure", "migration", "disposable Supabase incremental migrations failed", 0, undefined, undefined, 0],
		["IPv4 loopback host publication", "status", "Supabase status is not valid JSON", 0, loopbackPublication("127.0.0.1"), undefined, 0],
		["IPv6 loopback host publication", "status", "Supabase status is not valid JSON", 0, loopbackPublication("::1"), undefined, 0],
	] as const;
	it.each(REJECTION_CASES)(
		"creates the exact owned loopback bridge before canonical Supabase startup and rejects %s",
		async (_scenario, phase, failure, startStatus, publication, expectedRecord, publicationStatus) => {
			const { z } = await import("zod");
			const { releaseGateMain, reportReleaseGateFailure } = await import("../scripts/e2e-release-gate");
			const config = z.config();
			const priorCustomError = Object.getOwnPropertyDescriptor(config, "customError");
			const restoreCustomError = () => {
				if (priorCustomError) Object.defineProperty(config, "customError", priorCustomError);
				else Reflect.deleteProperty(config, "customError");
			};
			const fault = new Map<string, Error>([
				["publication diagnostic unexpected error", new Error("PRIVATE_OUTPUT_MARKER")],
				["publication diagnostic schema SyntaxError", new SyntaxError("PRIVATE_OUTPUT_MARKER")],
				["publication diagnostic empty ZodError", new z.ZodError([])],
				["publication diagnostic unknown issue", new z.ZodError([
					{ code: "unrecognized_keys", keys: ["PRIVATE_OUTPUT_MARKER"], path: [], message: "PRIVATE_OUTPUT_MARKER" },
					{ code: "custom", path: [0, "PRIVATE_OUTPUT_MARKER", 0, "HostPort"], message: "PRIVATE_OUTPUT_MARKER" },
				])],
			]).get(_scenario);
			const formattingFault = vi.fn(() => {
				restoreCustomError();
				throw fault;
			});
			const token = "12345678-1234-4123-8123-123456789abc";
			const projectId = "votus-e2e-12345678123441238123";
			const network = `supabase_network_${projectId}`;
			const tempRoot = mkdtempSync("/tmp/votus-e2e-unit-");
			let port = 46000;
			let networkPresent = false;
			let selectedNetwork: string | undefined;
			const trace: string[] = [];
			tmpdir.mockReturnValue(tempRoot);
			randomUUID.mockReturnValue(token);
			createServer.mockImplementation(() => ({
				once: vi.fn(),
				listen: vi.fn((_port, _host, listening) => listening()),
				address: () => ({ port: port++ }),
				close: vi.fn((done) => done()),
			}));
			spawnSync.mockImplementation((command, args) => {
				if (command === "pnpm")
					return successfulCommand(
						args[0] === "--version" ? "10.0.0\n" : "Version 7.0.0\n",
					);
				if (command === "docker" && args[0] === "info")
					return successfulCommand("29.7.2\n");
				if (command === "docker" && args[0] === "network") {
					if (args[1] === "create") {
						trace.push("network");
						networkPresent = true;
						return phase === "network"
							? { status: 1, stdout: "", stderr: "" }
							: successfulCommand(`${"b".repeat(64)}\n`);
					}
					if (args[1] === "rm") {
						trace.push("cleanup");
						networkPresent = false;
					}
					if (args[1] === "ls")
						return successfulCommand(networkPresent ? `${network}\n` : "");
					return successfulCommand();
				}
				if (command === "docker" && args[0] === "inspect") {
					trace.push("publication");
					if (fault) z.config({ customError: formattingFault });
					return publicationStatus === 0
						? successfulCommand(publication ?? "")
						: {
							status: publicationStatus,
							stdout: "PRIVATE_OUTPUT_MARKER",
							stderr: "PRIVATE_OUTPUT_MARKER",
						};
				}
				if (command === "supabase" && args[0] === "start") {
					if (args[1] === "--help")
						return successfulCommand("--workdir --ignore-health-check --network-id\n");
					trace.push("startup");
					selectedNetwork = args[args.indexOf("--network-id") + 1];
					return {
						status: startStatus,
						stdout: "",
						stderr: _scenario === "startup diagnostics" ? "PRIVATE_OUTPUT_MARKER" : "",
					};
				}
				if (command === "supabase" && args[0] === "db" && args[1] === "start") {
					trace.push("db-start");
					selectedNetwork = args[args.indexOf("--network-id") + 1];
				}
				if (command === "docker" && args[0] === "container" && args[1] === "inspect")
					return successfulCommand(JSON.stringify({ id: "a".repeat(64), name: `/supabase_db_${projectId}`, project: projectId, networks: { [network]: { NetworkID: "b".repeat(64) } } }));
				if (command === "supabase" && args[0] === "migration") {
					trace.push("migration");
					return { status: phase === "migration" ? 1 : 0, stdout: "", stderr: "" };
				}
				if (command === "supabase" && args[0] === "status" && phase === "pgtap")
					return successfulCommand(JSON.stringify({
						API_URL: "http://127.0.0.1:46005",
						DB_URL: "postgresql://postgres:postgres@127.0.0.1:46006/postgres",
						ANON_KEY: "synthetic-anon", SERVICE_ROLE_KEY: "synthetic-service",
					}));
				if (command === "supabase" && args[0] === "test") {
					trace.push("pgtap");
					if (_scenario !== "pgTAP safe diagnostics") return {
						status: null,
						signal: _scenario === "pgTAP termination" ? "SIGTERM" : "PRIVATE_OUTPUT_MARKER",
						error: Object.assign(new Error("PRIVATE_OUTPUT_MARKER"), {
							code: _scenario === "pgTAP termination" ? "ETIMEDOUT" : "PRIVATE_OUTPUT_MARKER",
						}),
						stdout: "not ok PRIVATE_OUTPUT_MARKER\nnot ok 1234567 - private\n",
						stderr: "PRIVATE_OUTPUT_MARKER (SQLSTATE PRIVATE_OUTPUT_MARKER)\n",
					};
					return {
						status: 7, signal: null,
						stdout: "not ok 18 - PRIVATE_OUTPUT_MARKER\n",
						stderr: "PRIVATE_OUTPUT_MARKER (SQLSTATE 57014)\n",
					};
				}
				if (command === "supabase" && args[0] === "--version")
					return successfulCommand("2.115.0\n");
				if (command === "supabase" && args[0] === "stop")
					return successfulCommand("--project-id --no-backup\n");
				return successfulCommand();
			});
			const readiness = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 200 }));
			const writeOutput = vi
				.spyOn(process.stdout, "write")
				.mockImplementation(() => true);
			const originalOnce = process.once.bind(process);
			const signalOnce = vi
				.spyOn(process, "once")
				.mockImplementation((event, listener) =>
					event === "SIGINT" || event === "SIGTERM"
						? process
						: originalOnce(event, listener),
				);
			try {
				let rejection: unknown;
				await expect(
					releaseGateMain(["--scale-proof-only"]).catch((error: unknown) => {
						rejection = error;
						throw error;
					}),
				).rejects.toThrow(failure);
				if (fault) expect(formattingFault).toHaveBeenCalledOnce();
				if (expectedRecord || phase === "migration") {
					const reported: string[] = [];
					const diagnosticCase = EXPECTED_PUBLICATION_DIAGNOSTICS.get(_scenario);
					const writeError = diagnosticCase
						? vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
							reported.push(String(chunk));
							return true;
						})
						: undefined;
					try {
						reportReleaseGateFailure(
							"E2E release gate failed",
							rejection,
							diagnosticCase ? undefined : (line) => reported.push(line),
						);
					} finally {
						writeError?.mockRestore();
					}
					const failureRecords = reported.filter((line) =>
						line.startsWith("E2E_RELEASE_GATE_FAILURE "),
					);
					expect(failureRecords).toHaveLength(expectedRecord ? 1 : 0);
					if (expectedRecord) expect(
						JSON.parse(
							failureRecords[0]!.slice("E2E_RELEASE_GATE_FAILURE ".length),
						),
					).toEqual(expectedRecord);
					if (phase === "pgtap") {
						const prefix = "E2E_RELEASE_GATE_PGTAP_DIAGNOSTIC ";
						const diagnostics = reported.filter((line) => line.startsWith(prefix));
						expect(diagnostics).toHaveLength(1);
						expect(JSON.parse(diagnostics[0]!.slice(prefix.length))).toEqual({
							schemaVersion: 1, proof: "tests/results_exploration_scale.sql",
							exitCode: _scenario === "pgTAP safe diagnostics" ? 7 : null,
							signal: _scenario === "pgTAP termination" ? "SIGTERM" : null,
							spawnErrorCode: _scenario === "pgTAP termination" ? "ETIMEDOUT" : null,
							sqlstates: _scenario === "pgTAP safe diagnostics" ? ["57014"] : [],
							failedAssertions: _scenario === "pgTAP safe diagnostics" ? [18] : [],
						});
						expect(reported.join("")).not.toContain("PRIVATE_OUTPUT_MARKER");
					}
					if (diagnosticCase) {
						expect(spawnSync).toHaveBeenCalledWith(
							"docker",
							[
								"inspect",
								"--format",
								"{{json .NetworkSettings.Ports}}",
								"supabase_db_votus-e2e-12345678123441238123",
								"supabase_kong_votus-e2e-12345678123441238123",
							],
							expect.any(Object),
						);
						const prefix = "E2E_RELEASE_GATE_PUBLICATION_DIAGNOSTIC ";
						const diagnostics = reported.join("").split("\n").filter((line) =>
							line.startsWith(prefix),
						);
						expect(diagnostics).toHaveLength(1);
						expect(JSON.parse(diagnostics[0]!.slice(prefix.length))).toEqual({
							schemaVersion: 1,
							...diagnosticCase,
						});
						expect(reported.join("")).not.toContain("PRIVATE_OUTPUT_MARKER");
					}
					if (expectedRecord?.reason === "command_failed" || phase === "migration")
						expect(reported.join("")).not.toContain("E2E_RELEASE_GATE_PUBLICATION_DIAGNOSTIC ");
					if (
						_scenario === "startup diagnostics" ||
						_scenario === "publication inspection command failure"
					)
						expect(reported.join("")).not.toContain("PRIVATE_OUTPUT_MARKER");
				}
				expect(spawnSync).toHaveBeenCalledWith(
					"docker",
					[
						"network",
						"create",
						"--driver",
						"bridge",
						"--label",
						`com.supabase.cli.project=${projectId}`,
						"--label",
						`com.docker.compose.project=${projectId}`,
						"--opt",
						"com.docker.network.bridge.host_binding_ipv4=127.0.0.1",
						network,
					],
					expect.any(Object),
				);
				expect(trace).toEqual(EXPECTED_PHASE_TRACE[phase]);
				expect(selectedNetwork).toBe(
					phase === "network" ? undefined : network,
				);
				expect(networkPresent).toBe(false);
				expect(existsSync(`${tempRoot}/votus-e2e-${token}`)).toBe(false);
			} finally {
				restoreCustomError();
				readiness.mockRestore();
				signalOnce.mockRestore();
				writeOutput.mockRestore();
				spawnSync.mockReset();
				createServer.mockReset();
				randomUUID.mockReset();
				tmpdir.mockReset();
				rmSync(tempRoot, { force: true, recursive: true });
			}
		},
	);

	it("runs production cleanup in exact-owned order and verifies residuals", async () => {
		const events: string[] = [];
		let containers = [`supabase_db_${OWNERSHIP.projectId}`];
		let volumes = [`supabase_db_${OWNERSHIP.projectId}`];
		let networks = [`supabase_network_${OWNERSHIP.projectId}`];
		let networkProjectId: string | undefined;
		let workdirExists = true;
		const dependencies: ReleaseGateCleanupDependencies<never> = {
			tempRoot: () => "/private/tmp",
			repositoryRoot: fileURLToPath(new URL("../../", import.meta.url)),
			persistRecoveryRecord: async () => undefined,
			retireRecoveryRecord: async () => undefined,
			readOwnershipMarker: async () => JSON.stringify(OWNERSHIP),
			stopServer: async () => undefined,
			verifyServerStopped: async () => undefined,
			stopStack: async () => {
				events.push("stop-stack");
			},
			listOwnedContainers: () => {
				events.push("list-containers");
				return containers;
			},
			removeContainers: async (names) => {
				events.push(`remove-containers:${names.join(",")}`);
				containers = [];
			},
			listOwnedVolumes: () => {
				events.push("list-volumes");
				return volumes;
			},
			removeVolumes: async (names) => {
				events.push(`remove-volumes:${names.join(",")}`);
				volumes = [];
			},
			listOwnedNetworks: (projectId) => {
				networkProjectId = projectId;
				events.push("list-networks");
				return networks;
			},
			removeNetworks: async (names) => {
				events.push(`remove-networks:${names.join(",")}`);
				networks = [];
			},
			removeWorkdir: async () => {
				events.push("remove-workdir");
				workdirExists = false;
			},
			workdirExists: () => {
				events.push("verify-workdir");
				return workdirExists;
			},
		};
		await cleanupReleaseGate(
			{ ownership: OWNERSHIP, stackMutationAttempted: true },
			dependencies,
		);
		expect(events).toEqual([
			"stop-stack",
			"list-containers",
			`remove-containers:supabase_db_${OWNERSHIP.projectId}`,
			"list-volumes",
			`remove-volumes:supabase_db_${OWNERSHIP.projectId}`,
			"list-networks",
			`remove-networks:supabase_network_${OWNERSHIP.projectId}`,
			"list-containers",
			"list-volumes",
			"list-networks",
			"remove-workdir",
			"list-containers",
			"list-volumes",
			"list-networks",
			"verify-workdir",
		]);
		expect(networkProjectId).toBe(OWNERSHIP.projectId);
	});
	it("reaches container cleanup through production cleanup and refuses foreign names", async () => {
		const events: string[] = [];
		const dependencies: ReleaseGateCleanupDependencies<never> = {
			tempRoot: () => "/private/tmp",
			repositoryRoot: fileURLToPath(new URL("../../", import.meta.url)),
			persistRecoveryRecord: async () => undefined,
			retireRecoveryRecord: async () => undefined,
			readOwnershipMarker: async () => JSON.stringify(OWNERSHIP),
			stopServer: async () => undefined,
			verifyServerStopped: async () => undefined,
			stopStack: async () => {
				events.push("stop-stack");
			},
			listOwnedContainers: () => {
				events.push("list-containers");
				return ["foreign-container"];
			},
			removeContainers: async () => {
				events.push("remove-containers");
			},
			listOwnedVolumes: () => [],
			removeVolumes: async () => undefined,
			listOwnedNetworks: () => [],
			removeNetworks: async () => undefined,
			removeWorkdir: async () => {
				events.push("remove-workdir");
			},
			workdirExists: () => false,
		};
		await expect(
			cleanupReleaseGate(
				{ ownership: OWNERSHIP, stackMutationAttempted: true },
				dependencies,
			),
		).rejects.toSatisfy((error: AggregateError) =>
			error.errors.some(
				(item) =>
					item instanceof Error &&
					item.message.includes(
						"refusing to remove an unexpected container",
					),
			),
		);
		expect(events).toContain("stop-stack");
		expect(events).toContain("list-containers");
		expect(events).not.toContain("remove-containers");
		expect(events).not.toContain("remove-workdir");
	});
	it("fails cleanup when residual verification still finds owned state", async () => {
		const ownedContainer = `supabase_db_${OWNERSHIP.projectId}`;
		const dependencies: ReleaseGateCleanupDependencies<never> = {
			tempRoot: () => "/private/tmp",
			repositoryRoot: fileURLToPath(new URL("../../", import.meta.url)),
			persistRecoveryRecord: async () => undefined,
			retireRecoveryRecord: async () => undefined,
			readOwnershipMarker: async () => JSON.stringify(OWNERSHIP),
			stopServer: async () => undefined,
			verifyServerStopped: async () => undefined,
			stopStack: async () => undefined,
			listOwnedContainers: () => [ownedContainer],
			removeContainers: async () => undefined,
			listOwnedVolumes: () => [],
			removeVolumes: async () => undefined,
			listOwnedNetworks: () => [],
			removeNetworks: async () => undefined,
			removeWorkdir: async () => undefined,
			workdirExists: () => false,
		};
		await expect(
			cleanupReleaseGate(
				{ ownership: OWNERSHIP, stackMutationAttempted: true },
				dependencies,
			),
		).rejects.toSatisfy((error: AggregateError) =>
			error.errors.some(
				(item) =>
					item instanceof Error &&
					item.message === "disposable Supabase cleanup left owned Docker state",
			),
		);
	});
	it("assigns authenticated state to every spec except the auth boundary test", () => {
		const path = "/owned/auth-state.json";
		for (const spec of EXPECTED_E2E_SPECS)
			expect(storageStateForSpec(spec, path)).toEqual(
				spec === "e2e/auth.spec.ts" ? emptyStorageState() : path,
			);
		expect(() => storageStateForSpec("e2e/unknown.spec.ts", path)).toThrow(
			"unknown e2e spec",
		);
	});
	it("accepts only policy-compliant server-created cookie deltas on the loopback app host", () => {
		const baseUrl = "http://127.0.0.1:4100";
		const preExistingCookie = {
			name: "unrelated-pre-existing",
			domain: "127.0.0.1",
			path: "/",
			httpOnly: false,
			secure: false,
			sameSite: "Lax" as const,
		};
		const sessionCookies = [
			{
				name: "opaque-session-chunk.0",
				domain: "127.0.0.1",
				path: "/",
				httpOnly: true,
				secure: false,
				sameSite: "Lax" as const,
			},
			{
				name: "opaque-session-chunk.1",
				domain: "127.0.0.1",
				path: "/",
				httpOnly: true,
				secure: false,
				sameSite: "Lax" as const,
			},
		];
		expect(
			assertLoopbackSessionCookieDelta(
				[preExistingCookie],
				[preExistingCookie, ...sessionCookies],
				baseUrl,
			),
		).toEqual(sessionCookies);
		expect(
			sameCookieIdentity(sessionCookies[0]!, {
				...sessionCookies[0]!,
				path: "/other",
			}),
		).toBe(false);
		expect(
			sameCookieIdentity(sessionCookies[0]!, {
				...sessionCookies[0]!,
				domain: "localhost",
			}),
		).toBe(false);
		expect(() =>
			assertLoopbackSessionCookieDelta(
				[preExistingCookie],
				[preExistingCookie],
				baseUrl,
			),
		).toThrow("new session cookie");
		for (const invalidCookie of [
			{ ...sessionCookies[0]!, httpOnly: false },
			{ ...sessionCookies[0]!, secure: true },
			{ ...sessionCookies[0]!, sameSite: "Strict" as const },
			{ ...sessionCookies[0]!, path: "/dashboard" },
			{ ...sessionCookies[0]!, domain: "localhost" },
		])
			expect(() =>
				assertLoopbackSessionCookieDelta([], [invalidCookie], baseUrl),
			).toThrow("session cookie");
	});
	it("keeps stale workdirs live while their canonical network remains", () => { spawnSync.mockReturnValueOnce({ status: 0, stdout: "" }).mockReturnValueOnce({ status: 0, stdout: "" }).mockReturnValueOnce({ status: 0, stdout: `supabase_network_${STALE_EVIDENCE.marker.projectId}\n` }); const active = matchingProjectResourcesActive(STALE_EVIDENCE.marker.projectId); expect(classifyStaleOwnership({ ...STALE_EVIDENCE, projectResourcesActive: active })).toBe("live"); expect(spawnSync).toHaveBeenLastCalledWith("docker", ["network", "ls", "--filter", `name=supabase_network_${STALE_EVIDENCE.marker.projectId}`, "--format", "{{.Name}}"], expect.any(Object)); spawnSync.mockReset(); });
	it("classifies and plans only proven stale owned workdirs", () => {
		expect(classifyStaleOwnership(STALE_EVIDENCE)).toBe("reap");
		expect(planStaleWorkdirReap(STALE_EVIDENCE)).toEqual([
			{ workdir: STALE_EVIDENCE.expectedWorkdir, projectId: "votus-e2e-stale" },
		]);
		expect(
			classifyStaleOwnership({ ...STALE_EVIDENCE, ownerProcessActive: true }),
		).toBe("live");
		expect(
			classifyStaleOwnership({
				...STALE_EVIDENCE,
				projectResourcesActive: true,
			}),
		).toBe("live");
		expect(classifyStaleOwnership({ ...STALE_EVIDENCE, ageMs: 1 })).toBe("live");
		expect(
			classifyStaleOwnership({ ...STALE_EVIDENCE, repositoryMatches: false }),
		).toBe("foreign");
		expect(
			classifyStaleOwnership({
				...STALE_EVIDENCE,
				marker: { ...STALE_EVIDENCE.marker, extra: true },
			}),
		).toBe("ambiguous");
		expect(
			classifyStaleOwnership({
				...STALE_EVIDENCE,
				projectResourcesActive: undefined,
			}),
		).toBe("ambiguous");
	});
});
it("continues every cleanup step, verifies residuals, and aggregates failures", async () => {
	const reached: string[] = [];
	await expect(
		runOwnedCleanup(
			ACTIONS,
			async (action) => {
				reached.push(action.kind);
				if (action.kind !== "remove-workdir") throw new Error(action.kind);
			},
			async () => {
				reached.push("verify");
				throw new Error("residual state");
			},
		),
	).rejects.toSatisfy((error: AggregateError) => error.errors.length === 5);
	expect(reached).toEqual([
		"stop-stack",
		"remove-owned-containers",
		"remove-owned-volumes",
		"remove-owned-networks",
		"remove-workdir",
		"verify",
	]);
});
it("publishes ownership before the first side effect and rolls back marker failure", () => {
	const state: { ownership?: GateOwnership } = {};
	const events: string[] = [];
	expect(() =>
		establishOwnership(state, OWNERSHIP, {
			createWorkdir: () => events.push(`create:${state.ownership?.token}`),
			writeMarker: () => {
				throw new Error("marker failed");
			},
			rollbackWorkdir: () => events.push("rollback"),
		}),
	).toThrow("marker failed");
	expect(events).toEqual(["create:token", "rollback"]);
	expect(state.ownership).toBeUndefined();
});
it("reserves one unique set and releases duplicate reservations", async () => {
	const released: number[] = [];
	const values = [3100, 3100, 3200, 3300];
	const reservations = await reserveUniquePorts(
		3,
		async (): Promise<PortReservation> => {
			const port = values.shift()!;
			return {
				port,
				release: async () => {
					released.push(port);
				},
			};
		},
	);
	expect(reservations.map(({ port }) => port)).toEqual([3100, 3200, 3300]);
	expect(released).toEqual([3100]);
});
it("releases accumulated reservations when a later reservation rejects", async () => {
	const reserveError = new Error("reservation failed");
	let reserveCalls = 0;
	let releaseCalls = 0;
	const reservation = reserveUniquePorts(2, async () => {
		reserveCalls += 1;
		if (reserveCalls === 2) throw reserveError;
		return {
			port: 3100,
			release: async () => {
				releaseCalls += 1;
			},
		};
	});
	await expect(reservation).rejects.toBe(reserveError);
	expect(releaseCalls).toBe(1);
});
it("releases accumulated reservations when duplicate release rejects", async () => {
	const duplicateReleaseError = new Error("duplicate release failed");
	let reserveCalls = 0;
	let accumulatedReleaseCalls = 0;
	let duplicateReleaseCalls = 0;
	const reservation = reserveUniquePorts(2, async () => {
		reserveCalls += 1;
		if (reserveCalls === 1)
			return {
				port: 3100,
				release: async () => {
					accumulatedReleaseCalls += 1;
				},
			};
		return {
			port: 3100,
			release: async () => {
				duplicateReleaseCalls += 1;
				throw duplicateReleaseError;
			},
		};
	});
	await expect(reservation).rejects.toBe(duplicateReleaseError);
	expect(accumulatedReleaseCalls).toBe(1);
	expect(duplicateReleaseCalls).toBe(1);
});
it("attempts every accumulated release and aggregates cleanup failures", async () => {
	const reserveError = new Error("reservation failed");
	const cleanupErrors = new Map([
		[3100, new Error("release 3100 failed")],
		[3200, new Error("release 3200 failed")],
	]);
	const released: number[] = [];
	let reserveCalls = 0;
	const reservation = reserveUniquePorts(3, async () => {
		reserveCalls += 1;
		if (reserveCalls === 3) throw reserveError;
		const port = reserveCalls === 1 ? 3100 : 3200;
		return {
			port,
			release: async () => {
				released.push(port);
				throw cleanupErrors.get(port);
			},
		};
	});
	await expect(reservation).rejects.toSatisfy((error: AggregateError) => {
		expect(error).toBeInstanceOf(AggregateError);
		expect(error.errors).toEqual([
			reserveError,
			cleanupErrors.get(3200),
			cleanupErrors.get(3100),
		]);
		return true;
	});
	expect(released).toEqual([3200, 3100]);
});
describe("release-gate version and endpoint validation", () => {
	const stackStatus = (
		apiUrl: string,
		dbUrl = "postgresql://postgres:postgres@127.0.0.1:43124/postgres",
	) =>
		JSON.stringify({
			API_URL: apiUrl,
			DB_URL: dbUrl,
			ANON_KEY: "anon",
			SERVICE_ROLE_KEY: "service",
		});
	it.each(["http://127.0.0.1:43123", "http://127.0.0.1:43123/"])(
		"accepts the exact generated API endpoint %s",
		(apiUrl) => {
			expect(assertStackStatus(stackStatus(apiUrl), 43123, 43124).API_URL).toBe(
				apiUrl,
			);
		},
	);
	it.each([
		"https://127.0.0.1:43123/",
		"ftp://127.0.0.1:43123/",
		"http://user:password@127.0.0.1:43123/",
		"http://127.0.0.1:43123/rest/v1",
		"http://127.0.0.1:43123/?key=value",
		"http://127.0.0.1:43123/#fragment",
		"http://localhost:43123/",
		"http://127.0.0.1:43124/",
	])("rejects malformed API endpoint %s", (apiUrl) => {
		expect(() => assertStackStatus(stackStatus(apiUrl), 43123, 43124)).toThrow(
			"Supabase API URL",
		);
	});
	it.each([
		"postgres://postgres:postgres@127.0.0.1:43124/postgres",
		"postgresql://other:postgres@127.0.0.1:43124/postgres",
		"postgresql://postgres:other@127.0.0.1:43124/postgres",
		"postgresql://postgres:postgres@localhost:43124/postgres",
		"postgresql://postgres:postgres@127.0.0.1:43125/postgres",
		"postgresql://postgres:postgres@127.0.0.1:43124/other",
		"postgresql://postgres:postgres@127.0.0.1:43124/postgres?",
		"postgresql://postgres:postgres@127.0.0.1:43124/postgres?sslmode=require",
		"postgresql://postgres:postgres@127.0.0.1:43124/postgres#",
		"postgresql://postgres:postgres@127.0.0.1:43124/postgres#fragment",
	])("rejects malformed DB endpoint %s", (dbUrl) => {
		expect(() =>
			assertStackStatus(
				stackStatus("http://127.0.0.1:43123", dbUrl),
				43123,
				43124,
			),
		).toThrow("Supabase DB_URL");
	});
	it("still requires all keys and validates DB_URL independently", () => {
		expect(() =>
			assertStackStatus(
				JSON.stringify({ API_URL: "http://127.0.0.1:43123" }),
				43123,
				43124,
			),
		).toThrow("ANON_KEY");
		expect(() =>
			assertStackStatus(
				stackStatus("http://127.0.0.1:43123", "https://example.test"),
				43123,
				43124,
			),
		).toThrow("DB_URL");
	});
	it.each([
		"Version 7.0.2",
		"Version 7.0.0-dev.20260813",
		"Version 7.1.0-rc.1+build.5",
	])("accepts TypeScript version %s", (output) => {
		expect(() => assertTs7Version(output)).not.toThrow();
	});
	it.each([
		"Version 7.invalid",
		"Version 7.",
		"Version 7.x",
		"Version 7.0",
		"Version 7.01.2",
		"Version 7.0.2 garbage",
		"Version 6.0.3",
		"Version 7.0.0-dev.01",
	])("rejects invalid TypeScript version %s", (output) => {
		expect(() => assertTs7Version(output)).toThrow("TypeScript 7.x");
	});
});
describe("ReleaseGateReporter", () => {
	const supplyCompanion = (text: string) => {
		let position = 0;
		open.mockResolvedValue({
			read: async (buffer: Buffer, offset: number, length: number) => {
				const bytesRead = Buffer.from(text).copy(buffer, offset, position, position + length);
				position += bytesRead;
				return { bytesRead };
			},
			close: async () => undefined,
		});
	};
	const testCaseFor = (spec: string, id: string, title: string) =>
		({
			id,
			title,
			location: { file: fileURLToPath(new URL(spec.startsWith("e2e/") ? `./${spec.slice(4)}` : spec, import.meta.url)) },
		}) as TestCase;
	const cases = EXPECTED_E2E_SPECS.map((spec, index) =>
		testCaseFor(spec, String(index), `${spec} passing case`),
	);
	const suiteFor = (testCases: TestCase[]) =>
		({ allTests: () => testCases }) as Suite;
	const suite = suiteFor(cases);
	const fullResult = { status: "passed" } as FullResult;
	const makeReporter = (
		capture: (content: string) => void,
		writeError: (message: string) => void = () => undefined,
	) =>
		new ReleaseGateReporter({
			receiptPath: "/receipt.json",
			writeReceipt: (target, content) => { if (target === "/receipt.json") capture(content); },
			writeError,
		});
	it("retains safe attempt history and distinct discovery ordinals at a shared declaration", async () => {
		const writes = new Map<string, string>();
		const reporter = new ReleaseGateReporter({
			receiptPath: "/receipt.json",
			writeReceipt: (target, content) => { writes.set(target, content); },
			writeError: () => undefined,
		});
		const first = testCaseFor(EXPECTED_E2E_SPECS[0], "SECRET-ID-1", "SECRET-TITLE");
		first.location.line = 12;
		first.location.column = 3;
		const second = { ...first, id: "SECRET-ID-2" };
		reporter.onBegin({} as FullConfig, suiteFor([first, second, ...cases.slice(1)]));
		for (const [test, status, retry] of [
			[first, "failed", 0], [second, "timedOut", 0], [first, "interrupted", 1],
		] as const)
			reporter.onTestEnd(test, {
				status, retry,
				errors: [
					{ message: "SECRET-ERROR", stack: "SECRET-STACK", snippet: "SECRET-SNIPPET", location: { file: test.location.file, line: 99, column: 7 } },
					{ location: { file: test.location.file.replace("/e2e/", "/e2e/../e2e/"), line: 101, column: 9 } },
				],
			} as TestResult);
		for (const test of [first, second, ...cases.slice(1)])
			reporter.onTestEnd(test, { status: "passed", retry: 2 } as TestResult);
		await expect(reporter.onEnd(fullResult)).resolves.toBeUndefined();
		expect(JSON.parse(writes.get("/receipt.json")!).results).toEqual(
			EXPECTED_E2E_SPECS.map((spec) => ({ spec, status: "passed" })),
		);
		const companion = writes.get("/receipt.json.diagnostics.json");
		expect(companion).toBeDefined();
		expect(companion).not.toMatch(/SECRET|failureLine|title|errors/);
		expect(JSON.parse(companion!).schemaVersion).toBe(2);
		expect(JSON.parse(companion!).attempts).toEqual([
			{ spec: EXPECTED_E2E_SPECS[0], line: 12, column: 3, ordinal: 1, status: "failed", retry: 0 },
			{ spec: EXPECTED_E2E_SPECS[0], line: 12, column: 3, ordinal: 2, status: "timedOut", retry: 0 },
			{ spec: EXPECTED_E2E_SPECS[0], line: 12, column: 3, ordinal: 1, status: "interrupted", retry: 1 },
		].map((attempt) => ({
			...attempt, errorLocations: [{ line: 99, column: 7 }, { line: 101, column: 9 }],
			missingErrorLocations: 0, foreignErrorLocations: 0,
		})));
		supplyCompanion(companion!);
		spawnSync.mockReturnValue({ status: 1 });
		const failure = await runPlaywright({ NODE_ENV: "test" }, "/receipt.json", EXPECTED_E2E_SPECS).catch((error: unknown) => error);
		const output: string[] = [];
		reportReleaseGateFailure("gate", failure, (line) => { output.push(line); });
		expect(output.join("")).toContain(`"companion":${companion}`);
		expect(output.join("")).not.toMatch(/SECRET|failureLine/);
	});
	it("partitions all error metadata without leaking paths or changing canonical failure", async () => {
		const writes = new Map<string, string>();
		const reporter = new ReleaseGateReporter({
			receiptPath: "/receipt.json",
			writeReceipt: (target, content) => { writes.set(target, content); },
			writeError: () => undefined,
		});
		const test = testCaseFor(EXPECTED_E2E_SPECS[0], "SECRET-ID", "SECRET-TITLE");
		test.location.line = 12;
		test.location.column = 3;
		const location = { file: test.location.file, line: 99, column: 7 };
		reporter.onBegin({} as FullConfig, suiteFor([test, ...cases.slice(1)]));
		const errors = [
			{ location }, { location }, {},
			...[0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, NaN, "SECRET"].flatMap((value) => [
				{ location: { ...location, line: value } }, { location: { ...location, column: value } },
			]),
			{ location: { ...location, file: null } },
			{ location: { ...location, file: test.location.file.replace("/e2e/", "/SECRET/") } },
			{ location: { ...location, file: "/SECRET/other.ts", line: 0 } },
			null,
		].map((error) => error === null ? null : ({ ...error, message: "SECRET", stack: "SECRET", snippet: "SECRET", value: "SECRET" }));
		expect(() => reporter.onTestEnd(test, { status: "failed", retry: 0, errors } as TestResult)).not.toThrow();
		reporter.onTestEnd(test, { status: "failed", retry: 1, errors: [] } as unknown as TestResult);
		await expect(reporter.onEnd(fullResult)).resolves.toEqual({ status: "failed" });
		expect(JSON.parse(writes.get("/receipt.json")!).results[0]).toEqual({ spec: EXPECTED_E2E_SPECS[0], status: "failed" });
		const text = writes.get("/receipt.json.diagnostics.json")!;
		expect(text).not.toMatch(/SECRET|file|message|stack|snippet|title|value/);
		supplyCompanion(text);
		const failure = await playwrightFailure(1, false, "/receipt.json");
		expect(failure.diagnostic.companion?.attempts).toEqual([
			{ spec: EXPECTED_E2E_SPECS[0], line: 12, column: 3, ordinal: 1, status: "failed", retry: 0,
				errorLocations: [{ line: 99, column: 7 }, { line: 99, column: 7 }], missingErrorLocations: 16, foreignErrorLocations: 1 },
			{ spec: EXPECTED_E2E_SPECS[0], line: 12, column: 3, ordinal: 1, status: "failed", retry: 1,
				errorLocations: [], missingErrorLocations: 0, foreignErrorLocations: 0 },
		]);
		expect(JSON.parse(failure.line().slice("E2E_PLAYWRIGHT_DIAGNOSTIC ".length))).toEqual(failure.diagnostic);
		const companion = JSON.parse(text);
		for (const malformed of [
			{ ...companion, schemaVersion: 1, attempts: [
				{ spec: EXPECTED_E2E_SPECS[0], line: 12, column: 3, ordinal: 1, status: "failed", retry: 0 },
			] }, // Historical v1 is rejected, never upgraded.
			{ ...companion, attempts: [{ ...companion.attempts[0], errorLocations: [{ line: 1, column: 2, file: "SECRET" }] }] },
			{ ...companion, attempts: [{ ...companion.attempts[0], errorLocations: Array(1025).fill({ line: 1, column: 2 }) }] },
			{ ...companion, attempts: [{ ...companion.attempts[0], missingErrorLocations: -1 }] },
			{ ...companion, attempts: [{ ...companion.attempts[0], errorLocations: [{ line: 0, column: 1 }] }] },
			{ ...companion, attempts: [{ ...companion.attempts[0], errorLocations: [{ line: 1, column: Number.MAX_SAFE_INTEGER + 1 }] }] },
		]) {
			supplyCompanion(JSON.stringify(malformed));
			const rejected = await playwrightFailure(1, false, "/receipt.json");
			expect(rejected.diagnostic.availability).toBe("invalid-schema");
			expect(rejected.line()).not.toMatch(/SECRET|companion/);
		}
		expect(() => new PlaywrightFailure({ ...failure.diagnostic, schemaVersion: 1 } as unknown as ConstructorParameters<typeof PlaywrightFailure>[0]).line()).toThrow();
	});
	it.each([1024, 1025])("preserves %i error coordinates and explicitly rejects overflow on consumption", async (size) => {
		let companion = "";
		const reporter = new ReleaseGateReporter({
			receiptPath: "/receipt.json",
			writeReceipt: (target, content) => { if (target.endsWith(".diagnostics.json")) companion = content; },
			writeError: () => undefined,
		});
		const test = testCaseFor(EXPECTED_E2E_SPECS[0], "id", "title");
		test.location.line = 12;
		test.location.column = 3;
		reporter.onBegin({} as FullConfig, suiteFor([test]));
		reporter.onTestEnd(test, { status: "failed", retry: 0, errors: Array.from({ length: size }, () => ({
			location: { file: test.location.file, line: 99, column: 7 },
		})) } as TestResult);
		await expect(reporter.onEnd(fullResult)).resolves.toEqual({ status: "failed" });
		expect(JSON.parse(companion).attempts[0].errorLocations).toHaveLength(size);
		supplyCompanion(companion);
		const failure = await playwrightFailure(1, false, "/receipt.json");
		expect(failure.diagnostic.availability).toBe(size === 1024 ? "available" : "invalid-schema");
		if (size === 1025) expect(failure.diagnostic.issues).toEqual([{ code: "too_big", count: 1 }]);
	});
	it("emits safe typed Playwright diagnostics through causes alongside cleanup failures", async () => {
		open.mockRejectedValue(Object.assign(new Error("SECRET-FILE"), { code: "ENOENT" }));
		spawnSync.mockReturnValue({ status: 1, stdout: "SECRET-PIPE", stderr: "SECRET-PIPE" });
		const execution = await runPlaywright({ NODE_ENV: "test" }, "/receipt.json", EXPECTED_E2E_SPECS).catch((error: unknown) => error);
		const cleanup = new ReleaseGateCleanupError([{ category: "STACK_STOP", error: new Error("SECRET-CLEANUP") }]);
		const lines: string[] = [];
		const secondCleanup = new ReleaseGateCleanupError([
			{ category: "STACK_STOP", error: new Error("SECRET-SECOND-CLEANUP") },
		]);
		reportReleaseGateFailure("gate", new AggregateError([
			new Error("SECRET-WRAPPER", { cause: execution }), cleanup, secondCleanup,
		]), (line) => { lines.push(line); });
		const output = lines.join("");
		expect(output).toContain('E2E_PLAYWRIGHT_DIAGNOSTIC {"schemaVersion":2,"exitCode":1,"spawn":"completed","availability":"missing"}');
		expect(output.match(/E2E_RELEASE_GATE_CLEANUP_DIAGNOSTICS/g)).toHaveLength(2);
		expect(output).not.toContain("SECRET");
	});
	it.each([
		["unreadable", null], ["invalid-json", "{"],
		["invalid-schema", '{"schemaVersion":2,"attempts":"SECRET","SECRET-KEY":true}'],
		["oversized", " ".repeat(256 * 1024 + 1)],
	] as const)("keeps child failure and safely classifies %s evidence", async (availability, text) => {
		if (text === null) open.mockRejectedValue(new Error("SECRET-READ"));
		else supplyCompanion(text);
		spawnSync.mockReturnValue({ status: null, error: new Error("SECRET-SPAWN") });
		const failure = await runPlaywright({ NODE_ENV: "test" }, "/receipt.json", EXPECTED_E2E_SPECS).catch((error: unknown) => error);
		expect(failure).toBeInstanceOf(Error);
		const output: string[] = [];
		reportReleaseGateFailure("gate", failure, (line) => { output.push(line); });
		const marker = JSON.parse(output[1]!.slice("E2E_PLAYWRIGHT_DIAGNOSTIC ".length));
		expect(marker).toMatchObject({ exitCode: null, spawn: "failed", availability });
		if (availability === "invalid-schema") expect(marker.issues).toEqual([
			{ code: "invalid_type", count: 5 }, { code: "invalid_value", count: 1 },
			{ code: "unrecognized_keys", count: 1 },
		]);
		expect(output.join("")).not.toContain("SECRET");
	});
	it("does not read diagnostics or change successful child decisions", async () => {
		open.mockClear();
		spawnSync.mockReturnValue({ status: 0 });
		await expect(runPlaywright({ NODE_ENV: "test" }, "/receipt.json", EXPECTED_E2E_SPECS)).resolves.toBeUndefined();
		expect(open).not.toHaveBeenCalled();
	});
	it("records reporter rejection and metadata losses even when browser cases pass", async () => {
		const writes = new Map<string, string>();
		const reporter = new ReleaseGateReporter({ receiptPath: "/receipt.json", writeReceipt: (target, content) => { writes.set(target, content); }, writeError: () => undefined });
		const unknown = testCaseFor("./SECRET.spec.ts", "SECRET-ID", "SECRET-TITLE");
		reporter.onBegin({} as FullConfig, suiteFor([...cases, unknown]));
		for (const test of cases) reporter.onTestEnd(test, { status: "passed" } as TestResult);
		await expect(reporter.onEnd(fullResult)).resolves.toEqual({ status: "failed" });
		const companion = writes.get("/receipt.json.diagnostics.json")!;
		expect(JSON.parse(companion)).toMatchObject({
			report: "rejected", attempts: [], unexpectedDiscoveries: 1,
			unmappableAttempts: 0, counts: { skipped: 0 },
		});
		supplyCompanion(companion);
		spawnSync.mockReturnValue({ status: 1 });
		const failure = await runPlaywright({ NODE_ENV: "test" }, "/receipt.json", EXPECTED_E2E_SPECS).catch((error: unknown) => error);
		const output: string[] = [];
		reportReleaseGateFailure("gate", failure, (line) => { output.push(line); });
		expect(output.join("")).toContain('"report":"rejected"');
		expect(output.join("")).not.toContain("SECRET");
	});
	it("counts missing results and unmappable declarations without guessing identities", async () => {
		const writes = new Map<string, string>();
		const reporter = new ReleaseGateReporter({ receiptPath: "/receipt.json", writeReceipt: (target, content) => { writes.set(target, content); }, writeError: () => undefined });
		reporter.onBegin({} as FullConfig, suite);
		reporter.onTestEnd(cases[0]!, { status: "failed", retry: 0 } as TestResult);
		reporter.onTestEnd(testCaseFor("./SECRET.spec.ts", "unknown", "SECRET"), { status: "skipped", retry: 0 } as TestResult);
		for (const test of cases.slice(2)) reporter.onTestEnd(test, { status: "passed" } as TestResult);
		await expect(reporter.onEnd(fullResult)).resolves.toEqual({ status: "failed" });
		expect(JSON.parse(writes.get("/receipt.json.diagnostics.json")!)).toMatchObject({
			attempts: [], missingResults: 1, unexpectedDiscoveries: 1, unmappableAttempts: 2,
			counts: { failed: 1, timedOut: 0, skipped: 1, interrupted: 0 },
		});
	});
	it("keeps canonical success when companion writing fails", async () => {
		const reporter = new ReleaseGateReporter({ receiptPath: "/receipt.json", writeReceipt: (target) => {
			if (target.endsWith(".diagnostics.json")) throw new Error("SECRET-WRITE");
		} });
		reporter.onBegin({} as FullConfig, suite);
		for (const test of cases) reporter.onTestEnd(test, { status: "passed" } as TestResult);
		await expect(reporter.onEnd(fullResult)).resolves.toBeUndefined();
	});
	it("uses the final valid callback outcome for a retry", async () => {
		let receipt = "";
		const reporter = makeReporter((content) => {
			receipt = content;
		});
		reporter.onBegin({} as FullConfig, suite);
		reporter.onTestEnd(cases[0]!, {
			status: "failed",
			errors: [{ location: { file: "/private/failure.spec.ts", line: 42, column: 9 } }],
		} as TestResult);
		for (const testCase of cases)
			reporter.onTestEnd(testCase, { status: "passed" } as TestResult);
		await expect(reporter.onEnd(fullResult)).resolves.toBeUndefined();
		expect(JSON.parse(receipt)).toEqual({
			suiteStatus: "passed",
			results: PASSED,
			selection: {
				mode: "full",
				selectedCount: EXPECTED_E2E_SPECS.length,
				selected: EXPECTED_E2E_SPECS,
				excludedCount: 0,
				excluded: [],
			},
		});
	});
	it("aggregates multiple cases into one selected-spec receipt in focused mode", async () => {
		const selected = "e2e/municipal.spec.ts";
		const previousMode = process.env["VOTUS_E2E_GATE_MODE"];
		const previousSelected = process.env["VOTUS_E2E_SELECTED_SPECS"];
		process.env["VOTUS_E2E_GATE_MODE"] = "focused";
		process.env["VOTUS_E2E_SELECTED_SPECS"] = JSON.stringify([selected]);
		try {
			let receipt = "";
			const errors: string[] = [];
			const reporter = makeReporter(
				(content) => {
					receipt = content;
				},
				(message) => errors.push(message.trim()),
			);
			const testCases = [
				testCaseFor(selected, "municipal-first", "municipal first case"),
				testCaseFor(selected, "municipal-second", "municipal second case"),
			];
			reporter.onBegin({} as FullConfig, suiteFor(testCases));
			for (const testCase of testCases)
				reporter.onTestEnd(testCase, { status: "passed" } as TestResult);

			const outcome = await reporter.onEnd(fullResult);

			expect(outcome, errors.join("\n")).toBeUndefined();
			expect(JSON.parse(receipt)).toEqual({
				suiteStatus: "passed",
				results: [{ spec: selected, status: "passed" }],
				selection: {
					mode: "focused",
					selectedCount: 1,
					selected: [selected],
					excludedCount: 7,
					excluded: EXPECTED_E2E_SPECS.filter((spec) => spec !== selected),
				},
			});
		} finally {
			if (previousMode === undefined) delete process.env["VOTUS_E2E_GATE_MODE"];
			else process.env["VOTUS_E2E_GATE_MODE"] = previousMode;
			if (previousSelected === undefined)
				delete process.env["VOTUS_E2E_SELECTED_SPECS"];
			else process.env["VOTUS_E2E_SELECTED_SPECS"] = previousSelected;
		}
	});
	it("aggregates nine passing test cases into the exact eight-spec receipt", async () => {
		let receipt = "";
		const errors: string[] = [];
		const reporter = makeReporter(
			(content) => {
				receipt = content;
			},
			(message) => errors.push(message.trim()),
		);
		const testCases = EXPECTED_E2E_SPECS.flatMap((spec, index) =>
			spec === "e2e/municipal.spec.ts"
				? [
					testCaseFor(spec, `${index}-first`, "municipal first case"),
					testCaseFor(spec, `${index}-second`, "municipal second case"),
				]
				: [testCaseFor(spec, `${index}-only`, `${spec} only case`)],
		);
		reporter.onBegin({} as FullConfig, suiteFor(testCases));
		for (const testCase of testCases)
			reporter.onTestEnd(testCase, { status: "passed" } as TestResult);

		const outcome = await reporter.onEnd(fullResult);

		expect(outcome, errors.join("\n")).toBeUndefined();
		const report = JSON.parse(receipt) as {
			suiteStatus: string;
			results: GateTestResult[];
		};
		expect(report).toEqual({
			suiteStatus: "passed",
			results: EXPECTED_E2E_SPECS.map((spec) => ({ spec, status: "passed" })),
			selection: {
				mode: "full",
				selectedCount: EXPECTED_E2E_SPECS.length,
				selected: EXPECTED_E2E_SPECS,
				excludedCount: 0,
				excluded: [],
			},
		});
	});
	it("fails closed when an expected spec has no discovered test IDs", async () => {
		let receipt = "";
		const reporter = makeReporter((content) => {
			receipt = content;
		});
		const missingSpec = EXPECTED_E2E_SPECS.at(-1)!;
		const testCases = cases.slice(0, -1);
		reporter.onBegin({} as FullConfig, suiteFor(testCases));
		for (const testCase of testCases)
			reporter.onTestEnd(testCase, { status: "passed" } as TestResult);

		await expect(reporter.onEnd(fullResult)).resolves.toEqual({ status: "failed" });
		expect(JSON.parse(receipt)).toEqual({
			suiteStatus: "failed",
			results: EXPECTED_E2E_SPECS.map((spec) =>
				spec === missingSpec ? { spec, status: "interrupted" } : { spec, status: "passed" },
			),
			selection: {
				mode: "full",
				selectedCount: EXPECTED_E2E_SPECS.length,
				selected: EXPECTED_E2E_SPECS,
				excludedCount: 0,
				excluded: [],
			},
		});
	});
	it.each(["failed", "timedOut", "interrupted", "skipped"] as const)(
		"fails the municipal spec when a later case is %s",
		async (status) => {
			let receipt = "";
			const reporter = makeReporter((content) => {
				receipt = content;
			});
			const municipal = "e2e/municipal.spec.ts";
			const testCases = EXPECTED_E2E_SPECS.flatMap((spec, index) =>
				spec === municipal
					? [
						testCaseFor(spec, `${index}-passed`, "municipal first passing case"),
						testCaseFor(spec, `${index}-${status}`, `municipal later ${status} case`),
					]
					: [testCaseFor(spec, `${index}-only`, `${spec} only case`)],
			);
			reporter.onBegin({} as FullConfig, suiteFor(testCases));
			for (const testCase of testCases)
				reporter.onTestEnd(
					testCase,
					testCase.id.endsWith(`-${status}`)
						? ({
								status,
								errors: [
									{ location: { file: "/private/failure.spec.ts", line: 42, column: 9 } },
								],
							} as TestResult)
						: ({ status: "passed" } as TestResult),
				);

			await expect(reporter.onEnd(fullResult)).resolves.toEqual({
				status: "failed",
			});
			const results = (JSON.parse(receipt) as { results: GateTestResult[] }).results;
			expect(results).toHaveLength(EXPECTED_E2E_SPECS.length);
			expect(results.find(({ spec }) => spec === municipal)).toEqual({
				spec: municipal,
				status,
				failureLine: 42,
			});
		},
	);
	it("records only a valid failure line for non-passing tests", async () => {
		let receipt = "";
		const reporter = makeReporter((content) => {
			receipt = content;
		});
		reporter.onBegin({} as FullConfig, suite);
		reporter.onTestEnd(cases[0]!, {
			status: "failed",
			errors: [
				{
					message: "private error text",
					stack: "private stack text",
					snippet: "private source snippet",
					location: { file: "/private/failure.spec.ts", line: 0, column: 17 },
				},
				{
					message: "fractional private error text",
					location: { file: "/private/failure.spec.ts", line: 1.5, column: 5 },
				},
				{
					message: "second private error text",
					location: { file: "/private/failure.spec.ts", line: 42, column: 9 },
				},
			],
		} as TestResult);
		reporter.onTestEnd(cases[1]!, {
			status: "passed",
			errors: [
				{
					message: "passing result private error text",
					location: { file: "/private/passing.spec.ts", line: 24, column: 3 },
				},
			],
		} as TestResult);
		reporter.onTestEnd(cases[2]!, {
			status: "failed",
			errors: [{ message: "location-less private error text" }],
		} as TestResult);
		for (const testCase of cases.slice(3))
			reporter.onTestEnd(testCase, { status: "passed" } as TestResult);

		await reporter.onEnd({ status: "failed" } as FullResult);

		const results = (JSON.parse(receipt) as { results: unknown[] }).results;
		expect(results[0]).toEqual({
			spec: EXPECTED_E2E_SPECS[0],
			status: "failed",
			failureLine: 42,
		});
		expect(results[1]).toEqual({
			spec: EXPECTED_E2E_SPECS[1],
			status: "passed",
		});
		expect(results[2]).toEqual({
			spec: EXPECTED_E2E_SPECS[2],
			status: "failed",
		});
		for (const privateValue of [
			"private error text",
			"private stack text",
			"private source snippet",
			"/private/failure.spec.ts",
			"column",
		])
			expect(receipt).not.toContain(privateValue);
	});
	it("records a discovered test with no result as interrupted", async () => {
		let receipt = "";
		const reporter = makeReporter((content) => {
			receipt = content;
		});
		reporter.onBegin({} as FullConfig, suite);
		await expect(reporter.onEnd(fullResult)).resolves.toEqual({
			status: "failed",
		});
		expect(JSON.parse(receipt).suiteStatus).toBe("failed");
		expect(JSON.parse(receipt).results[0]).toMatchObject({
			status: "interrupted",
		});
	});
	it("does not count a known ID from outside e2e as completed", async () => {
		let receipt = "";
		const reporter = makeReporter((content) => (receipt = content));
		reporter.onBegin({} as FullConfig, suite);
		for (const testCase of cases.slice(1))
			reporter.onTestEnd(testCase, { status: "passed" } as TestResult);
		reporter.onTestEnd(
			testCaseFor("../outside/auth.spec.ts", cases[0]!.id, "mismatched case"), { status: "passed" } as TestResult,
		);
		await expect(reporter.onEnd(fullResult)).resolves.toEqual({ status: "failed" });
		expect(JSON.parse(receipt).results[0]).toEqual({
			spec: EXPECTED_E2E_SPECS[0], status: "interrupted",
		});
	});
	it("preserves a failure when an outside callback reuses its ID", async () => {
		let receipt = "";
		const reporter = makeReporter((content) => (receipt = content));
		reporter.onBegin({} as FullConfig, suite);
		reporter.onTestEnd(cases[0]!, {
			status: "failed",
			errors: [{ location: { file: "/private/failure.spec.ts", line: 42, column: 9 } }],
		} as TestResult);
		reporter.onTestEnd(
			testCaseFor("../outside/auth.spec.ts", cases[0]!.id, "mismatched case"), { status: "passed" } as TestResult,
		);
		for (const testCase of cases.slice(1))
			reporter.onTestEnd(testCase, { status: "passed" } as TestResult);
		await expect(reporter.onEnd(fullResult)).resolves.toEqual({ status: "failed" });
		expect(JSON.parse(receipt).results[0]).toEqual({
			spec: EXPECTED_E2E_SPECS[0], status: "failed", failureLine: 42,
		});
	});
	it.each(["suite", "result"] as const)(
		"fails closed for an unexpected spec from the %s while retaining the bounded receipt",
		async (source) => {
			let receipt = "";
			const reporter = makeReporter((content) => {
				receipt = content;
			});
			const unexpected = testCaseFor(
				"e2e/unexpected.spec.ts",
				"unexpected",
				"unexpected test case",
			);
			reporter.onBegin(
				{} as FullConfig,
				suiteFor(source === "suite" ? [...cases, unexpected] : cases),
			);
			for (const testCase of [...cases, unexpected])
				reporter.onTestEnd(testCase, { status: "passed" } as TestResult);

			await expect(reporter.onEnd(fullResult)).resolves.toEqual({
				status: "failed",
			});
			const report = JSON.parse(receipt) as {
				suiteStatus: string;
				results: GateTestResult[];
			};
			expect(report.suiteStatus).toBe("failed");
			expect(report.results).toHaveLength(EXPECTED_E2E_SPECS.length);
			expect(report.results).toEqual(
				EXPECTED_E2E_SPECS.map((spec) => ({ spec, status: "passed" })),
			);
		},
	);
});

describe("release-gate cleanup diagnostics", () => {
	it("persists an exclusive, private recovery sidecar outside the owned workdir", async () => {
		const root = mkdtempSync("/tmp/votus-sidecar-test-");
		const token = "12345678-1234-4123-8123-123456789abc";
		const record = {
			workdir: join(root, `votus-e2e-${token}`),
			projectId: `votus-e2e-${token.replaceAll("-", "").slice(0, 20)}`,
			token,
			ownerPid: 12345,
			repositoryRoot: resolve(fileURLToPath(new URL("../../../", import.meta.url))),
		};
		tmpdir.mockReturnValue(root);
		try {
			await persistReleaseGateRecoveryRecord(record);
			const sidecar = `${record.workdir}.recovery.json`;
			expect(JSON.parse(readFileSync(sidecar, "utf8"))).toEqual({ schemaVersion: 2, ...record });
			await expect(persistReleaseGateRecoveryRecord(record)).rejects.toThrow();
			await retireReleaseGateRecoveryRecord(record);
			expect(existsSync(sidecar)).toBe(false);
		} finally {
			tmpdir.mockReset();
			rmSync(root, { recursive: true, force: true });
		}
	});
	it("persists pending-child evidence privately across restart and refuses conflicting retirement", async () => {
		const root = mkdtempSync("/tmp/votus-sidecar-test-");
		const token = "12345678-1234-4123-8123-123456789abc";
		const record = {
			workdir: join(root, `votus-e2e-${token}`),
			projectId: `votus-e2e-${token.replaceAll("-", "").slice(0, 20)}`,
			token, ownerPid: 12345, status: "pending_child" as const,
			repositoryRoot: resolve(fileURLToPath(new URL("../../../", import.meta.url))),
		};
		tmpdir.mockReturnValue(root);
		try {
			await persistReleaseGateRecoveryRecord(record);
			const sidecar = `${record.workdir}.recovery.json`;
			expect(statSync(sidecar).mode & 0o777).toBe(0o600);
			expect(JSON.parse(readFileSync(sidecar, "utf8"))).toEqual({ schemaVersion: 2, ...record });
			await expect(retireReleaseGateRecoveryRecord({ ...record, ownerPid: 12346 })).rejects.toThrow();
			expect(existsSync(sidecar)).toBe(true);
			await retireReleaseGateRecoveryRecord(record);
			expect(existsSync(sidecar)).toBe(false);
		} finally {
			tmpdir.mockReset();
			rmSync(root, { recursive: true, force: true });
		}
	});
	it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])("rejects invalid ownerPid %s before sidecar creation", async (ownerPid) => {
		const root = mkdtempSync("/tmp/votus-sidecar-test-");
		const token = "12345678-1234-4123-8123-123456789abc";
		const record = {
			workdir: join(root, `votus-e2e-${token}`),
			projectId: `votus-e2e-${token.replaceAll("-", "").slice(0, 20)}`,
			token, ownerPid,
			repositoryRoot: resolve(fileURLToPath(new URL("../../../", import.meta.url))),
		};
		tmpdir.mockReturnValue(root);
		try {
			await expect(persistReleaseGateRecoveryRecord(record)).rejects.toThrow("recovery ownership binding invalid");
			expect(existsSync(`${record.workdir}.recovery.json`)).toBe(false);
		} finally {
			tmpdir.mockReset();
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("rejects a regex-valid project identity that stale recovery cannot accept", async () => {
		const root = mkdtempSync("/tmp/votus-sidecar-test-");
		const token = "12345678-1234-4123-8123-123456789abc";
		const record = {
			workdir: join(root, `votus-e2e-${token}`),
			projectId: "votus-e2e-other-valid-project",
			token,
			ownerPid: 12345,
			repositoryRoot: resolve(fileURLToPath(new URL("../../../", import.meta.url))),
		};
		tmpdir.mockReturnValue(root);
		try {
			await expect(persistReleaseGateRecoveryRecord(record)).rejects.toThrow("recovery ownership binding invalid");
			expect(existsSync(`${record.workdir}.recovery.json`)).toBe(false);
		} finally {
			tmpdir.mockReset();
			rmSync(root, { recursive: true, force: true });
		}
	});
	const dependencies = (
		overrides: Partial<ReleaseGateCleanupDependencies<never>> = {},
	): ReleaseGateCleanupDependencies<never> => ({
		tempRoot: () => "/private/tmp",
		repositoryRoot: fileURLToPath(new URL("../../", import.meta.url)),
		persistRecoveryRecord: async () => undefined,
		retireRecoveryRecord: async () => undefined,
		readOwnershipMarker: async () => JSON.stringify(OWNERSHIP),
		stopServer: async () => undefined,
		verifyServerStopped: async () => undefined,
		stopStack: async () => undefined,
		listOwnedContainers: () => [],
		removeContainers: async () => undefined,
		listOwnedVolumes: () => [],
		removeVolumes: async () => undefined,
		listOwnedNetworks: () => [],
		removeNetworks: async () => undefined,
		removeWorkdir: async () => undefined,
		workdirExists: () => false,
		...overrides,
	});

	it.each(["container", "volume"])("same-suffix %s refuses cleanup and preserves recovery evidence", async (kind) => {
		const removed: string[] = [];
		let markerExists = true;
		const token = "12345678-1234-4123-8123-123456789abc";
		const ownership = { workdir: `/private/tmp/votus-e2e-${token}`, projectId: "votus-e2e-12345678123441238123", token };
		const projectId = ownership.projectId;
		await expect(cleanupReleaseGate(
			{ ownership, stackMutationAttempted: true },
			dependencies({
				readOwnershipMarker: async () => JSON.stringify(ownership),
				listOwnedContainers: () => kind === "container" ? [`unrelated_${projectId}`] : [],
				listOwnedVolumes: () => kind === "volume" ? [`unrelated_${projectId}`] : [],
				removeContainers: async () => { removed.push("container"); },
				removeVolumes: async () => { removed.push("volume"); },
				removeWorkdir: async () => { markerExists = false; },
				workdirExists: () => markerExists,
			}),
		)).rejects.toSatisfy((error) => {
			expect(cleanupDiagnosticsLine(error)).toContain(kind === "container" ? "CONTAINER_RESIDUAL_CHECK" : "VOLUME_RESIDUAL_CHECK");
			expect(cleanupDiagnosticsLine(error)).not.toContain("unrelated_");
			return true;
		});
		expect(removed).toEqual([]);
		expect(markerExists).toBe(true);
	});

	it.each(["partial-removal", "residual-probe", "success"])("durable recovery record survives %s and retires only after verified cleanup", async (scenario) => {
		const root = mkdtempSync("/tmp/votus-durable-cleanup-");
		const workdir = join(root, "owned");
		const sidecar = join(root, "recovery.json");
		const ownership = { workdir, projectId: "votus-e2e-durable", token: "durable-token" };
		const repo = fileURLToPath(new URL("../../", import.meta.url));
		const record = { ...ownership, repositoryRoot: repo, ownerPid: process.pid };
		const marker = join(workdir, ".votus-e2e-owner.json");
		mkdirSync(workdir);
		writeFileSync(marker, JSON.stringify(ownership));
		let containerProbes = 0;
		let removedWorkdir = false;
		const persistRecoveryRecord = vi.fn(async (value: typeof record) => {
			expect(value).toEqual(record);
			writeFileSync(sidecar, JSON.stringify(value));
		});
		const retireRecoveryRecord = vi.fn(async () => { rmSync(sidecar); });
		try {
			const cleanup = cleanupReleaseGate(
				{ ownership, stackMutationAttempted: true },
				Object.assign(dependencies({
					tempRoot: () => root,
					readOwnershipMarker: async () => readFileSync(marker, "utf8"),
					removeWorkdir: async () => {
						expect(JSON.parse(readFileSync(sidecar, "utf8"))).toEqual(record);
						if (scenario === "partial-removal") {
							rmSync(marker);
							throw new Error("partial recursive removal");
						}
						removedWorkdir = true;
						rmSync(workdir, { recursive: true });
					},
					workdirExists: () => existsSync(workdir),
					listOwnedContainers: () => {
						if (++containerProbes > 2 && scenario === "residual-probe") throw new Error("residual probe failed");
						return [];
					},
				}), { persistRecoveryRecord, retireRecoveryRecord, repositoryRoot: repo }),
			);
			if (scenario === "success") await expect(cleanup).resolves.toBeUndefined();
			else await expect(cleanup).rejects.toBeInstanceOf(ReleaseGateCleanupError);
			expect(persistRecoveryRecord).toHaveBeenCalledOnce();
			if (scenario === "residual-probe") expect(removedWorkdir).toBe(true);
			if (scenario === "success") {
				expect(retireRecoveryRecord).toHaveBeenCalledOnce();
				expect(existsSync(sidecar)).toBe(false);
			} else {
				expect(retireRecoveryRecord).not.toHaveBeenCalled();
				expect(JSON.parse(readFileSync(sidecar, "utf8"))).toEqual(record);
			}
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("settles the owned ETL child before cleaning its stack and workdir", async () => {
		const reached: string[] = [];
		let settle!: () => void;
		const stopped = new Promise<void>((resolve) => { settle = resolve; });
		const cleanup = cleanupReleaseGate(
			{ ownership: OWNERSHIP, stackMutationAttempted: true, stopOwnedEtlChild: async () => {
				reached.push("etl-stop");
				await stopped;
				reached.push("etl-settled");
			} },
			dependencies({
				stopStack: async () => { reached.push("stack"); },
				removeWorkdir: async () => { reached.push("workdir"); },
			}),
		);
		await Promise.resolve();
		expect(reached).toEqual(["etl-stop"]);
		settle();
		await cleanup;
		expect(reached).toEqual(["etl-stop", "etl-settled", "stack", "workdir"]);
	});

	it("retains owned resources and bounds diagnostics when pending persistence fails", async () => {
		const reached: string[] = [];
		const secret = new Error("password=secret /private/path");
		await expect(cleanupReleaseGate(
			{ ownership: OWNERSHIP, stackMutationAttempted: true, stopOwnedEtlChild: async () => { throw new Error("child not settled"); } },
			dependencies({
				persistRecoveryRecord: async () => { reached.push("persist"); throw secret; },
				stopStack: async () => { reached.push("stack"); },
				removeContainers: async () => { reached.push("containers"); },
				removeWorkdir: async () => { reached.push("workdir"); },
			}),
		)).rejects.toSatisfy((error) => {
			expect(cleanupDiagnosticsLine(error)).toContain('"category":"RECOVERY_RECORD_PERSIST"');
			expect(cleanupDiagnosticsLine(error)).not.toMatch(/password=secret|\/private\/path/);
			return true;
		});
		expect(reached).toEqual(["persist"]);
	});

	it("preserves owned resources if the ETL child cannot be confirmed stopped", async () => {
		const reached: string[] = [];
		const sensitive = new Error("password=secret /private/path");
		await expect(cleanupReleaseGate(
			{ ownership: OWNERSHIP, stackMutationAttempted: true, stopOwnedEtlChild: async () => { throw sensitive; } },
			dependencies({
				stopStack: async () => { reached.push("stack"); },
				removeContainers: async () => { reached.push("containers"); },
				removeVolumes: async () => { reached.push("volumes"); },
				removeNetworks: async () => { reached.push("networks"); },
				removeWorkdir: async () => { reached.push("workdir"); },
			}),
		)).rejects.toSatisfy((error) => {
			expect(error).toBeInstanceOf(ReleaseGateCleanupError);
			expect((error as AggregateError).errors).toContain(sensitive);
			const line = cleanupDiagnosticsLine(error);
			expect(line).toContain('"category":"ETL_CHILD_STOP"');
			expect(line).not.toContain("password=secret");
			return true;
		});
		expect(reached).toEqual([]);
	});

	it("preserves the ownership marker after stack stop fails while continuing safe cleanup", async () => {
		const reached: string[] = [];
		let markerExists = true;
		const original = new Error("password=secret /private/path");
		await expect(
			cleanupReleaseGate(
				{ ownership: OWNERSHIP, stackMutationAttempted: true },
				dependencies({
					stopStack: async () => {
						reached.push("stack");
						throw original;
					},
					listOwnedContainers: () => (reached.push("containers"), []),
					listOwnedVolumes: () => (reached.push("volumes"), []),
					listOwnedNetworks: () => (reached.push("networks"), []),
					removeWorkdir: async () => {
						markerExists = false;
						reached.push("workdir");
					},
					workdirExists: () => markerExists,
				}),
			),
		).rejects.toSatisfy((error) => {
			expect(error).toBeInstanceOf(AggregateError);
			expect((error as AggregateError).errors).toContain(original);
			const line = cleanupDiagnosticsLine(error);
			expect(line).toContain('"category":"STACK_STOP","failureCount":1');
			expect(line).not.toContain("password=secret");
			return true;
		});
		expect(markerExists).toBe(true);
		expect(reached).toEqual(["stack", "containers", "volumes", "networks", "containers", "volumes", "networks"]);
	});

	it("flattens nested failures into canonical category counts without stopping", async () => {
		const nested = new AggregateError([
			new Error("first"),
			new AggregateError([new Error("second")], "nested"),
		], "outer");
		const reached: string[] = [];
		await expect(
			cleanupReleaseGate(
				{
					ownership: OWNERSHIP,
					stackMutationAttempted: true,
					reservations: [{ port: 1, release: async () => { throw new Error("port"); } }],
				},
				dependencies({
					stopStack: async () => { throw nested; },
					removeWorkdir: async () => {
						reached.push("workdir");
					},
				}),
			),
		).rejects.toSatisfy((error: AggregateError) => {
			expect(error.errors).toHaveLength(3);
			expect(cleanupDiagnosticsLine(error)).toBe(
				'E2E_RELEASE_GATE_CLEANUP_DIAGNOSTICS {"schemaVersion":1,"failures":[{"category":"RESERVATION_RELEASE","failureCount":1},{"category":"STACK_STOP","failureCount":2}]}',
			);
			return true;
		});
		expect(reached).toEqual([]);
	});

	it("continues after owned network cleanup and network residual failures", async () => {
		const network = `supabase_network_${OWNERSHIP.projectId}`, reached: string[] = [];
		let networkLists = 0;
		await expect(cleanupReleaseGate(
			{ ownership: OWNERSHIP, stackMutationAttempted: true },
			dependencies({
				removeNetworks: async () => { reached.push("remove-network"); throw new Error(network); },
				listOwnedContainers: () => (reached.push("container-residual"), []),
				listOwnedVolumes: () => (reached.push("volume-residual"), []),
				listOwnedNetworks: () => {
					if (networkLists++ === 0) return [network];
					reached.push("network-residual"); throw new Error(network);
				},
				removeWorkdir: async () => { reached.push("workdir"); },
				workdirExists: () => (reached.push("workdir-residual"), false),
			}),
		)).rejects.toSatisfy((error) => {
			const diagnostics = cleanupDiagnosticsLine(error);
			expect(diagnostics).toContain('"category":"OWNED_NETWORK_CLEANUP","failureCount":1');
			expect(diagnostics).toContain('"category":"NETWORK_RESIDUAL_CHECK","failureCount":1');
			expect(diagnostics).not.toContain(network); return true;
		});
		expect(reached).toEqual(["container-residual", "volume-residual", "remove-network", "container-residual", "volume-residual", "network-residual", "workdir-residual"]);
	});

	it("categorizes nonempty network residuals without exposing their names", async () => {
		const network = `supabase_network_${OWNERSHIP.projectId}`;
		await expect(
			cleanupReleaseGate(
				{ ownership: OWNERSHIP, stackMutationAttempted: true },
				dependencies({
					listOwnedNetworks: () => [network],
					removeNetworks: async () => undefined,
				}),
			),
		).rejects.toSatisfy((error) => {
			const diagnostics = cleanupDiagnosticsLine(error);
			expect(diagnostics).toContain('"category":"NETWORK_RESIDUAL_CHECK","failureCount":1');
			expect(diagnostics).not.toContain(network);
			return true;
		});
	});

	it.each([
		"default",
		"markerless-network",
		`unrelated_${OWNERSHIP.projectId}`,
		`prefix_${OWNERSHIP.projectId}_suffix`,
	])("refuses network candidates without the exact owned network name: %s",
		async (candidate) => {
			let removed = false;
			await expect(
				cleanupReleaseGate(
					{ ownership: OWNERSHIP, stackMutationAttempted: true },
					dependencies({
						listOwnedNetworks: () => [candidate],
						removeNetworks: async () => { removed = true; },
					}),
				),
			).rejects.toSatisfy((error: AggregateError) =>
				error.errors.some(
					(item) =>
						item instanceof Error &&
						item.message ===
							"refusing to remove a network without the exact owned network name",
				),
			);
			expect(removed).toBe(false);
		},
	);

	it.each([
		["read", async (): Promise<string> => { throw new Error("marker read failed"); }],
		["parse", async (): Promise<string> => "{"],
		["mismatch", async (): Promise<string> => JSON.stringify({ ...OWNERSHIP, token: "other" })],
	] as const)("blocks destructive ownership actions after marker %s failures while reading residuals", async (_kind, readOwnershipMarker) => {
		const reached: string[] = [];
		await expect(
			cleanupReleaseGate(
				{ ownership: OWNERSHIP, stackMutationAttempted: true },
				dependencies({
					readOwnershipMarker,
					stopStack: async () => {
						reached.push("stack");
					},
					removeContainers: async () => {
						reached.push("containers");
					},
					removeVolumes: async () => {
						reached.push("volumes");
					},
					removeNetworks: async () => {
						reached.push("networks");
					},
					removeWorkdir: async () => {
						reached.push("workdir");
					},
					listOwnedContainers: () => { reached.push("container-residual"); return []; },
					listOwnedVolumes: () => { reached.push("volume-residual"); return []; },
					listOwnedNetworks: () => { reached.push("network-residual"); return []; },
					workdirExists: () => { reached.push("workdir-residual"); return false; },
				}),
			),
		).rejects.toSatisfy(
			(error) =>
				cleanupDiagnosticsLine(error)?.includes(
					'"category":"OWNERSHIP_MARKER"',
				) ?? false,
		);
		expect(reached).toEqual(["container-residual", "volume-residual", "network-residual", "workdir-residual"]);
	});

	it("has no cleanup diagnostics on success", async () => {
		await expect(cleanupReleaseGate({ ownership: OWNERSHIP, stackMutationAttempted: true }, dependencies())).resolves.toBeUndefined();
		expect(cleanupDiagnosticsLine(undefined)).toBeUndefined();
	});

	it("reports one redacted diagnostics line for direct and signal cleanup failures", async () => {
		const sensitive = new Error("password=secret /private/path token argv host.test:54321 project-id");
		let cleanup: unknown;
		try {
			await cleanupReleaseGate({ stackMutationAttempted: false, reservations: [{ port: 1, release: async () => { throw sensitive; } }] }, dependencies());
		} catch (error) {
			cleanup = error;
		}
		expect((cleanup as AggregateError).errors).toContain(sensitive);
		const direct: string[] = [];
		const signal: string[] = [];
		reportReleaseGateFailure("E2E release gate failed", new AggregateError([new Error("execution"), cleanup]), (line) => direct.push(line));
		reportReleaseGateFailure("E2E signal cleanup failed", cleanup, (line) => signal.push(line));
		for (const value of ["secret", "/private/path", "token", "argv", "host.test", "54321", "project-id"])
			expect([...direct, ...signal].join("")).not.toContain(value);
		for (const output of [direct, signal])
			expect(output.filter((line) => line.startsWith("E2E_RELEASE_GATE_CLEANUP_DIAGNOSTICS"))).toHaveLength(1);
		expect(direct[0]).toBe("E2E release gate failed: details redacted\n");
		expect(signal[0]).toBe("E2E signal cleanup failed: details redacted\n");
	});
});
