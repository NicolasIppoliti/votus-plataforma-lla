import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type {
	FullConfig,
	FullResult,
	Suite,
	TestCase,
	TestResult,
} from "@playwright/test/reporter";
import ReleaseGateReporter from "./release-gate-reporter";
import { assertSourceInventory } from "../scripts/e2e-release-gate";
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
	assertExactMigrationInventory,
	assertStackStatus,
	assertSyntheticMigrationDoesNotCollide,
	assertTs7Version,
	formatPgTapFailure,
	cleanupReleaseGate,
	establishOwnership,
	reserveUniquePorts,
	runOwnedCleanup,
	runProductionReleasePhases,
	runReleaseGateCli,
	SUPABASE_START_TIMEOUT_MS,
	type PortReservation,
	type ReleaseGateCleanupDependencies,
	type ReleaseGatePlan,
} from "../scripts/e2e-gate-runtime";
const OWNERSHIP: GateOwnership = {
	workdir: "/private/tmp/votus-e2e-owned",
	projectId: "votus-e2e-project",
	token: "token",
};
const ACTIONS: CleanupAction[] = [
	{ kind: "stop-stack", projectId: OWNERSHIP.projectId },
	{ kind: "remove-owned-containers", projectId: OWNERSHIP.projectId },
	{ kind: "remove-owned-volumes", projectId: OWNERSHIP.projectId },
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
describe("migration release-gate integration", () => {
	const EXPECTED_MIGRATION_VERSIONS = Array.from({ length: 37 }, (_, index) =>
		String(index + 1).padStart(4, "0"),
	);
	it("inspects the exact production migration and proof plan", async () => {
		const plan = await inspectReleaseGatePlan();
		expect(plan.mode).toBe(RELEASE_GATE_MODE.FULL);
		expect(plan.migrationVersions).toEqual(EXPECTED_MIGRATION_VERSIONS);
		expect(plan.syntheticMigration).toEqual({
			version: "0038",
			fileName: "0038_e2e_service_role_grants.sql",
			sourcePath: "e2e/service-role-grants.sql",
		});
		expect(
			new Set([...plan.migrationVersions, plan.syntheticMigration.version]).size,
		).toBe(38);
		expect(plan.setupProofs).toEqual([
			{
				path: "tests/results_exploration_scale_setup.sql",
				label: "disposable scale fixture setup",
				timeoutMs: 600_000,
				beforePgTapPath: "tests/results_exploration_scale.sql",
			},
		]);
		expect(plan.pgTapProofs).toContainEqual({
			path: "tests/results_coverage_scope_binding.sql",
			label: "disposable coverage-scope-binding pgTAP",
			timeoutMs: 120_000,
		});
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
		await expect(
			assertSourceInventory(plan.migrationVersions, plan.syntheticMigration),
		).resolves.toBeUndefined();
	});
	it("runs every production phase in plan order before installing synthetic 0038", async () => {
		const plan = await inspectReleaseGatePlan();
		const trace: string[] = [];
		const stack = await runProductionReleasePhases(plan, {
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
			"pgTAP:disposable results-exploration pgTAP",
			"setup:disposable scale fixture setup",
			"pgTAP:disposable scale/EXPLAIN proof",
			"pgTAP:disposable coverage-scope-binding pgTAP",
			"rollback:disposable rollback/reapply proof",
			"rollback:disposable coverage-scope-binding rollback/reapply proof",
			"synthetic:0038_e2e_service_role_grants.sql",
		]);
		expect(stack.API_URL).toBe("http://127.0.0.1:54321");
	});
	it("propagates a production phase rejection without running later phases", async () => {
		const plan = await inspectReleaseGatePlan();
		const trace: string[] = [];
		await expect(
			runProductionReleasePhases(plan, {
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
					if (proof.path === "tests/results_exploration_scale.sql")
						throw new Error("scale proof failed");
				},
				runRollbackReapplyProof: async (proof) => {
					trace.push(`rollback:${proof.label}`);
				},
				installSyntheticMigration: async (migration) => {
					trace.push(`synthetic:${migration.fileName}`);
				},
			}),
		).rejects.toThrow("scale proof failed");
		expect(trace).toEqual([
			"production-migrations",
			"stack-status",
			"pgTAP:disposable results-exploration pgTAP",
			"setup:disposable scale fixture setup",
			"pgTAP:disposable scale/EXPLAIN proof",
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
				"0037",
			],
		},
		{
			defect: "extra",
			actual: [...EXPECTED_MIGRATION_VERSIONS, "0038"],
		},
	])("rejects a $defect migration inventory", ({ actual }) => {
		expect(() =>
			assertExactMigrationInventory(actual, EXPECTED_MIGRATION_VERSIONS),
		).toThrow("migration inventory must be exactly versions 0001 through 0037");
	});
	it("rejects a synthetic migration version collision", async () => {
		const plan = await inspectReleaseGatePlan();
		expect(() =>
			assertSyntheticMigrationDoesNotCollide(
				["0037_production.sql", "0038_production.sql"],
				plan.syntheticMigration,
			),
		).toThrow(
			"synthetic migration 0038 collides with production migration 0038_production.sql",
		);
	});
	it("inspects release proofs without planning browser execution", async () => {
		const plan = await inspectReleaseGatePlan(["--release-proof-only"]);
		expect(plan.mode).toBe(RELEASE_GATE_MODE.RELEASE_PROOF_ONLY);
		expect(plan.pgTapProofs).toHaveLength(3);
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
				label: "disposable scale/EXPLAIN proof",
				timeoutMs: 360_000,
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
			"pgTAP:disposable scale/EXPLAIN proof",
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
	it("proves the exact results-exploration rollback through 0037 while leaving unrelated 0024 installed", () => {
		const proof = readFileSync(
			new URL(
				"../../../supabase/tests/results_exploration_release.sql",
				import.meta.url,
			),
			"utf8",
		);
		const migrationSequence = Array.from(
			proof.matchAll(/\\ir \.\.\/migrations\/(down\/)?(\d{4})_[^\n]+\.sql/g),
			([, down, version]) => `${version}-${down ? "down" : "up"}`,
		);
		expect(proof).toContain("37 as migration_inventory_count");
		expect(migrationSequence.some((entry) => entry.startsWith("0024-"))).toBe(
			false,
		);
		expect(migrationSequence).toEqual([
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
				]),
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
	it("allows a cold CI runner to pull and start Supabase", () => {
		expect(SUPABASE_START_TIMEOUT_MS).toBe(10 * 60_000);
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
	it("runs production cleanup in exact-owned order and verifies residuals", async () => {
		const events: string[] = [];
		let containers = [`supabase_db_${OWNERSHIP.projectId}`];
		let volumes = [`supabase_db_${OWNERSHIP.projectId}`];
		let workdirExists = true;
		const dependencies: ReleaseGateCleanupDependencies<never> = {
			tempRoot: () => "/private/tmp",
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
			"remove-workdir",
			"list-containers",
			"list-volumes",
			"verify-workdir",
		]);
	});
	it("reaches container cleanup through production cleanup and refuses foreign names", async () => {
		const events: string[] = [];
		const dependencies: ReleaseGateCleanupDependencies<never> = {
			tempRoot: () => "/private/tmp",
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
						"refusing to remove a container without the exact owned project suffix",
					),
			),
		);
		expect(events).toContain("stop-stack");
		expect(events).toContain("list-containers");
		expect(events).not.toContain("remove-containers");
		expect(events).toContain("remove-workdir");
	});
	it("fails cleanup when residual verification still finds owned state", async () => {
		const ownedContainer = `supabase_db_${OWNERSHIP.projectId}`;
		const dependencies: ReleaseGateCleanupDependencies<never> = {
			tempRoot: () => "/private/tmp",
			readOwnershipMarker: async () => JSON.stringify(OWNERSHIP),
			stopServer: async () => undefined,
			verifyServerStopped: async () => undefined,
			stopStack: async () => undefined,
			listOwnedContainers: () => [ownedContainer],
			removeContainers: async () => undefined,
			listOwnedVolumes: () => [],
			removeVolumes: async () => undefined,
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
	).rejects.toSatisfy((error: AggregateError) => error.errors.length === 4);
	expect(reached).toEqual([
		"stop-stack",
		"remove-owned-containers",
		"remove-owned-volumes",
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
	const cases = EXPECTED_E2E_SPECS.map(
		(spec, index) =>
			({ id: String(index), location: { file: `/repo/${spec}` } }) as TestCase,
	);
	const suite = { allTests: () => cases } as Suite;
	const fullResult = { status: "passed" } as FullResult;
	const makeReporter = (capture: (content: string) => void) =>
		new ReleaseGateReporter({
			receiptPath: "/receipt.json",
			writeReceipt: (_path, content) => capture(content),
			writeError: () => undefined,
		});
	it("is directly driven through the exact passing inventory", async () => {
		let receipt = "";
		const reporter = makeReporter((content) => {
			receipt = content;
		});
		reporter.onBegin({} as FullConfig, suite);
		for (const testCase of cases)
			reporter.onTestEnd(testCase, { status: "passed" } as TestResult);
		await expect(reporter.onEnd(fullResult)).resolves.toBeUndefined();
		expect(JSON.parse(receipt).results).toHaveLength(8);
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
		expect(JSON.parse(receipt).results[0]).toMatchObject({
			status: "interrupted",
		});
	});
});
