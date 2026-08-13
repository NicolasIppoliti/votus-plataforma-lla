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
import {
	EXPECTED_E2E_SPECS,
	assertE2eEnvironment,
	assertGateReport,
	assertLoopbackStorageState,
	classifyStaleOwnership,
	emptyStorageState,
	planOwnedCleanup,
	planStaleWorkdirReap,
	storageStateForSpec,
	type CleanupAction,
	type GateOwnership,
	type GateTestResult,
} from "./gate-contract";
import {
	assertStackStatus,
	assertTs7Version,
	establishOwnership,
	reserveUniquePorts,
	runOwnedCleanup,
	SUPABASE_START_TIMEOUT_MS,
	type PortReservation,
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
const RELEASE_GATE_SOURCE = readFileSync(
	new URL("../scripts/e2e-release-gate.ts", import.meta.url),
	"utf8",
);
describe("migration release-gate integration", () => {
	it("owns the exact production migration inventory through 0023", () => {
		expect(RELEASE_GATE_SOURCE).toContain("Array.from({ length: 23 }");
		expect(RELEASE_GATE_SOURCE).toContain(
			"migration inventory must be exactly versions 0001 through 0023",
		);
	});
	it("executes the 0023 coverage scope binding pgTAP proof", () => {
		expect(RELEASE_GATE_SOURCE).toContain(
			'"tests", "results_coverage_scope_binding.sql"',
		);
		expect(RELEASE_GATE_SOURCE).toContain(
			'"disposable coverage-scope-binding pgTAP"',
		);
	});
	it("executes the 0023 coverage scope binding rollback/reapply proof", () => {
		expect(RELEASE_GATE_SOURCE).toContain(
			'"tests", "results_coverage_scope_binding_release.sql"',
		);
		expect(RELEASE_GATE_SOURCE).toContain(
			'"disposable coverage-scope-binding rollback/reapply proof"',
		);
	});
	it("supports a focused rollback-proof sequence without running pgTAP or browser checks", () => {
		expect(RELEASE_GATE_SOURCE).toContain(
			'process.argv.includes("--rollback-proofs-only")',
		);
		expect(RELEASE_GATE_SOURCE).toContain(
			"Rollback proofs passed: 2 SQL processes, cleanup complete",
		);
	});
	it("keeps the disposable service-role grant migration owned at non-colliding 0024", () => {
		expect(RELEASE_GATE_SOURCE).toContain(
			'const EPHEMERAL_SERVICE_ROLE_MIGRATION = "0024_e2e_service_role_grants.sql";',
		);
		expect(RELEASE_GATE_SOURCE).toContain(
			"path.join(targetMigrations, EPHEMERAL_SERVICE_ROLE_MIGRATION)",
		);
		expect(RELEASE_GATE_SOURCE).toContain(
			"[...sourceNames, EPHEMERAL_SERVICE_ROLE_MIGRATION].sort()",
		);
		expect(RELEASE_GATE_SOURCE).toContain(
			"path.join(target, EPHEMERAL_SERVICE_ROLE_MIGRATION)",
		);
		expect(RELEASE_GATE_SOURCE).not.toContain(
			"0023_e2e_service_role_grants.sql",
		);
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
		const passwordEnvironmentName = ["VOTUS_E2E_TEST_USER", "PASSWORD"].join(
			"_",
		);
    expect(workflow).toContain("POSTGRES_HOST_AUTH_METHOD: trust");
    expect(workflow).not.toContain(`${["POSTGRES", "PASSWORD"].join("_")}:`);
		expect(workflow).toContain(
			"postgresql://postgres@127.0.0.1:54322/template1",
		);
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
			assertGateReport(
				[{ ...PASSED[0]!, spec: "e2e/other.spec.ts" }],
				"passed",
			),
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
	it("removes only exact-owned containers after stopping the stack", () => {
		expect(ACTIONS.map(({ kind }) => kind)).toEqual([
			"stop-stack",
			"remove-owned-containers",
			"remove-owned-volumes",
			"remove-workdir",
		]);
		expect(RELEASE_GATE_SOURCE).toContain(
			"function removeOwnedContainers(projectId: string)",
		);
		expect(RELEASE_GATE_SOURCE).toContain("!name.endsWith(`_${projectId}`)");
		expect(RELEASE_GATE_SOURCE).toContain(
			"refusing to remove a container without the exact owned project suffix",
		);
		expect(RELEASE_GATE_SOURCE).toContain('["rm", "-f", ...containers]');
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
  it("accepts only loopback auth cookies whose domain is independent of port", () => {
		const state = {
			cookies: [
				{
					name: "sb-local-auth-token",
					value: "token",
					domain: "127.0.0.1",
					path: "/",
					expires: -1,
					httpOnly: false,
					secure: false,
					sameSite: "Lax" as const,
				},
			],
			origins: [],
		};
    expect(() => assertLoopbackStorageState(state)).not.toThrow();
		expect(() =>
			assertLoopbackStorageState({
				...state,
				cookies: [{ ...state.cookies[0]!, domain: "127.0.0.1:54321" }],
			}),
		).toThrow("loopback host");
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
		expect(classifyStaleOwnership({ ...STALE_EVIDENCE, ageMs: 1 })).toBe(
			"live",
		);
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
it("requires the exact generated loopback API endpoint and all keys", () => {
	const valid = JSON.stringify({
		API_URL: "http://127.0.0.1:43123",
      DB_URL: "postgresql://postgres@127.0.0.1:43124/postgres",
		ANON_KEY: "anon",
		SERVICE_ROLE_KEY: "service",
	});
	expect(assertStackStatus(valid, 43123).API_URL).toBe(
		"http://127.0.0.1:43123",
	);
	expect(() =>
		assertStackStatus(valid.replace("43123", "43124"), 43123),
	).toThrow("API port");
	expect(() =>
		assertStackStatus(valid.replace("127.0.0.1", "example.test"), 43123),
	).toThrow("loopback");
	expect(() =>
		assertStackStatus(
			JSON.stringify({ API_URL: "http://127.0.0.1:43123" }),
			43123,
		),
	).toThrow("ANON_KEY");
	expect(() =>
		assertStackStatus(
			valid.replace(
				"postgresql://postgres@127.0.0.1:43124/postgres",
				"https://example.test",
			),
			43123,
		),
	).toThrow("DB_URL");
  });
it("accepts only an explicit 7.x compiler version", () => {
    expect(() => assertTs7Version("Version 7.0.2")).not.toThrow();
    expect(() => assertTs7Version("Version 6.0.3")).toThrow("TypeScript 7.x");
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
