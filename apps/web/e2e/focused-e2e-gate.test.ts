import { describe, expect, it, vi } from "vitest";
import {
	EXPECTED_E2E_SPECS,
	type GateTestResult,
} from "./gate-contract";
import {
	assertFocusedGateReport,
	createReceiptSelection,
} from "./release-gate-reporter";
import {
	releaseGateMain,
	runPlaywright,
} from "../scripts/e2e-release-gate";
import {
	RELEASE_GATE_MODE,
	createReleaseGatePlan,
	parseFocusedE2eSelection,
	playwrightCommandArgs,
	runReleaseGateCli,
} from "../scripts/e2e-gate-runtime";

const { spawnSync } = vi.hoisted(() => ({ spawnSync: vi.fn() }));

vi.mock("node:child_process", async (importOriginal) => ({
	...(await importOriginal<typeof import("node:child_process")>()),
	spawnSync,
}));

const SELECTED: readonly string[] = [
	"e2e/root.spec.ts",
	"e2e/comparison.spec.ts",
];
const PASSED: GateTestResult[] = SELECTED.map((spec) => ({
	spec,
	status: "passed",
}));

describe("focused e2e release gate", () => {
	it("accepts only canonical selected specs and preserves caller order", () => {
		expect(parseFocusedE2eSelection(SELECTED)).toEqual(SELECTED);
	});

	it("runs browser phases for focused selections and reserves skips for migration-only plans", () => {
		expect(createReleaseGatePlan(RELEASE_GATE_MODE.FOCUSED, SELECTED)).toMatchObject({
		requireBrowserCapability: true,
		runBrowser: true,
	});
		expect(
		createReleaseGatePlan(RELEASE_GATE_MODE.ROLLBACK_PROOFS_ONLY),
	).toMatchObject({
		requireBrowserCapability: false,
		runBrowser: false,
	});
	});

	it.each([
		{ argv: [] },
		{ argv: [""] },
		{ argv: ["e2e/root.spec.ts", "e2e/root.spec.ts"] },
		{ argv: ["/repo/apps/web/e2e/root.spec.ts"] },
		{ argv: ["e2e/../root.spec.ts"] },
		{ argv: ["e2e/root.spec.ts\u0000"] },
		{ argv: ["e2e/root.spec.js"] },
		{ argv: ["e2e"] },
		{ argv: ["e2e/unknown.spec.ts"] },
		{ argv: ["--inspect-plan"] },
	])("rejects unsafe or noncanonical focused selection %#", ({ argv }) => {
		expect(() => parseFocusedE2eSelection(argv)).toThrow(
		"focused E2E selection",
	);
	});

	it("rejects invalid CLI input before any provisioning subprocess", async () => {
		await expect(
			releaseGateMain(["--focused", "e2e/root.spec.ts", "e2e/root.spec.ts"]),
		).rejects.toThrow(
			"focused E2E selection: duplicate focused E2E spec: e2e/root.spec.ts",
		);
		expect(spawnSync).not.toHaveBeenCalled();
	});

	it("accepts pnpm's forwarded separator through the release-gate entry point", async () => {
		const executePlan = vi.fn(async () => undefined);
		await releaseGateMain(["--focused", "--", "e2e/root.spec.ts"], {
			executePlan,
			writeOutput: () => undefined,
		});
		expect(executePlan).toHaveBeenCalledWith(
			expect.objectContaining({
				mode: RELEASE_GATE_MODE.FOCUSED,
				selectedSpecs: ["e2e/root.spec.ts"],
			}),
		);
	});

	it.each([
		{ argv: ["--focused"], message: "requires one or more canonical spec paths" },
		{
			argv: ["--focused", "--"],
			message: "requires one or more canonical spec paths",
		},
		{
			argv: ["--focused", "--", "--", "e2e/root.spec.ts"],
			message: "contains an unsafe path",
		},
		{
			argv: ["--focused", "e2e/root.spec.ts", "--"],
			message: "contains an unsafe path",
		},
		{
			argv: ["--focused", "e2e/root.spec.ts", "--inspect-plan"],
			message: "contains an unsafe path",
		},
		{
			argv: ["e2e/root.spec.ts", "--focused"],
			message: "arguments must begin with --focused",
		},
	])("rejects invalid focused CLI grammar before provisioning %#", async ({ argv, message }) => {
		const executePlan = vi.fn(async () => undefined);
		await expect(
			releaseGateMain(argv, { executePlan, writeOutput: () => undefined }),
		).rejects.toThrow(message);
		expect(executePlan).not.toHaveBeenCalled();
	});

	it("emits a bounded focused selection summary before execution", async () => {
		let output = "";
		const execute = vi.fn(async () => undefined);
		await runReleaseGateCli(["--focused", ...SELECTED], {
			execute,
			writeOutput: (chunk) => {
				output += chunk;
			},
		});
		expect(execute).toHaveBeenCalledOnce();
		expect(output).toBe(
		"E2E selection: mode=focused selected=2 [e2e/root.spec.ts, e2e/comparison.spec.ts] excluded=6 [e2e/auth.spec.ts, e2e/fiscalizacion.spec.ts, e2e/provenance.spec.ts, e2e/municipal.spec.ts, e2e/review.spec.ts, e2e/simulate.spec.ts]\n",
		);
	});

	it("passes each selected spec as a distinct Playwright argv token", () => {
		expect(playwrightCommandArgs(SELECTED)).toEqual([
			"exec",
			"playwright",
			"test",
			...SELECTED,
		]);
	});

	it("drives the focused entry point through browser execution with the selected receipt inventory", async () => {
		const output: string[] = [];
		const executePlan = vi.fn(async (plan) => {
			expect(plan).toMatchObject({
				mode: RELEASE_GATE_MODE.FOCUSED,
				selectedSpecs: SELECTED,
				requireBrowserCapability: true,
				runBrowser: true,
			});
			expect(createReceiptSelection(plan.selectedSpecs)).toEqual({
				mode: "focused",
				selectedCount: 2,
				selected: [...SELECTED],
				excludedCount: 6,
				excluded: EXPECTED_E2E_SPECS.filter((spec) => !SELECTED.includes(spec)),
			});
			spawnSync.mockReturnValueOnce({ error: undefined, status: 0 });
			await runPlaywright(
				{ NODE_ENV: "test" },
				"/ignored/receipt.json",
				plan.selectedSpecs,
			);
		});

		await releaseGateMain(["--focused", ...SELECTED], {
			executePlan,
			writeOutput: (chunk) => output.push(chunk),
		});

		expect(executePlan).toHaveBeenCalledOnce();
		expect(spawnSync).toHaveBeenCalledWith(
			"pnpm",
			["exec", "playwright", "test", ...SELECTED],
			expect.objectContaining({ cwd: expect.any(String) }),
		);
		expect(output).toEqual([
			"E2E selection: mode=focused selected=2 [e2e/root.spec.ts, e2e/comparison.spec.ts] excluded=6 [e2e/auth.spec.ts, e2e/fiscalizacion.spec.ts, e2e/provenance.spec.ts, e2e/municipal.spec.ts, e2e/review.spec.ts, e2e/simulate.spec.ts]\n",
		]);
	});

	it("records and validates the exact selected and excluded receipt inventory", () => {
		expect(createReceiptSelection(SELECTED)).toEqual({
		mode: "focused",
		selectedCount: 2,
		selected: [...SELECTED],
		excludedCount: 6,
		excluded: EXPECTED_E2E_SPECS.filter((spec) => !SELECTED.includes(spec)),
	});
		expect(() => assertFocusedGateReport(PASSED, "passed", SELECTED)).not.toThrow();
		expect(() =>
		assertFocusedGateReport(PASSED.slice(0, 1), "passed", SELECTED),
	).toThrow("discovered 1 tests; expected 2");
		expect(() =>
		assertFocusedGateReport(
			[...PASSED, { spec: "e2e/auth.spec.ts", status: "passed" }],
			"passed",
			SELECTED,
		),
	).toThrow("discovered 3 tests; expected 2");
		expect(() =>
		assertFocusedGateReport(
			[{ spec: "e2e/auth.spec.ts", status: "passed" }, PASSED[1]!],
			"passed",
			SELECTED,
		),
	).toThrow("spec inventory mismatch");
	});

	it("keeps the full gate bound to all eight canonical specs", () => {
		const plan = createReleaseGatePlan(RELEASE_GATE_MODE.FULL);
		expect(plan.selectedSpecs).toEqual(EXPECTED_E2E_SPECS);
	});
});
