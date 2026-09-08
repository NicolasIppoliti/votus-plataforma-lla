import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type {
	FullConfig,
	FullResult,
	Reporter,
	Suite,
	TestCase,
	TestResult,
} from "@playwright/test/reporter";
import {
	EXPECTED_E2E_SPECS,
	assertGateReport,
	type GateTestResult,
} from "./gate-contract";

const RECEIPT_MODE = {
	FULL: "full",
	FOCUSED: "focused",
} as const;

type ReceiptMode = (typeof RECEIPT_MODE)[keyof typeof RECEIPT_MODE];

export interface GateReceiptSelection {
	mode: ReceiptMode;
	selectedCount: number;
	selected: readonly string[];
	excludedCount: number;
	excluded: readonly string[];
}

interface ReporterOptions {
	receiptPath?: string;
	writeReceipt?: (path: string, content: string) => void;
	writeError?: (message: string) => void;
}

const E2E_ROOT = path.dirname(fileURLToPath(import.meta.url));
const UNEXPECTED_E2E_SPEC = "e2e/__unexpected__.spec.ts";

function relativeTestSpec(test: TestCase): string {
	const relative = path.relative(E2E_ROOT, path.resolve(test.location.file));
	const basename = path.basename(relative);
	if (path.dirname(relative) !== "." || !basename) return UNEXPECTED_E2E_SPEC;
	return `e2e/${basename}`;
}

function resultFailureLine(result: TestResult): number | undefined {
	if (result.status === "passed") return undefined;
	return result.errors
		?.find(
			({ location }) =>
				Number.isInteger(location?.line) && location!.line > 0,
		)
		?.location?.line;
}

function exactSelectedSpecs(selected: readonly string[]): readonly string[] {
	if (selected.length === 0) throw new Error("focused reporter selection is empty");
	const seen = new Set<string>();
	for (const spec of selected) {
		if (
			!EXPECTED_E2E_SPECS.includes(spec as (typeof EXPECTED_E2E_SPECS)[number]) ||
			seen.has(spec)
		)
			throw new Error("focused reporter selection is invalid");
		seen.add(spec);
	}
	return [...selected];
}

export function createReceiptSelection(
	selected: readonly string[],
	mode: ReceiptMode = RECEIPT_MODE.FOCUSED,
): GateReceiptSelection {
	const exactSelected = exactSelectedSpecs(selected);
	const excluded = EXPECTED_E2E_SPECS.filter(
		(spec) => !exactSelected.includes(spec),
	);
	return {
		mode,
		selectedCount: exactSelected.length,
		selected: exactSelected,
		excludedCount: excluded.length,
		excluded,
	};
}

function configuredReceiptSelection(): GateReceiptSelection {
	const mode = process.env["VOTUS_E2E_GATE_MODE"];
	if (!mode || mode === RECEIPT_MODE.FULL)
		return createReceiptSelection(EXPECTED_E2E_SPECS, RECEIPT_MODE.FULL);
	if (mode !== RECEIPT_MODE.FOCUSED)
		throw new Error("focused reporter mode is invalid");
	try {
		const selected = JSON.parse(
			process.env["VOTUS_E2E_SELECTED_SPECS"] ?? "",
		) as unknown;
		if (!Array.isArray(selected) || selected.some((spec) => typeof spec !== "string"))
			throw new Error("invalid selection");
		return createReceiptSelection(selected, RECEIPT_MODE.FOCUSED);
	} catch {
		throw new Error("focused reporter selection is invalid");
	}
}

export function assertFocusedGateReport(
	results: readonly GateTestResult[],
	suiteStatus: string,
	selected: readonly string[],
): void {
	const expected = [...exactSelectedSpecs(selected)].sort();
	const discovered = results.map(({ spec }) => spec).sort();
	const errors: string[] = [];
	if (results.length !== expected.length)
		errors.push(`discovered ${results.length} tests; expected ${expected.length}`);
	if (JSON.stringify(discovered) !== JSON.stringify(expected))
		errors.push(`spec inventory mismatch: discovered [${discovered.join(", ")}]`);
	for (const status of ["failed", "timedOut", "skipped", "interrupted"] as const) {
		const count = results.filter((result) => result.status === status).length;
		if (count > 0) errors.push(`${status}=${count}`);
	}
	const passed = results.filter((result) => result.status === "passed").length;
	if (passed !== expected.length)
		errors.push(`passed=${passed}; expected=${expected.length}`);
	if (suiteStatus !== "passed") errors.push(`suite status=${suiteStatus}`);
	if (errors.length > 0)
		throw new Error(`e2e focused gate failed: ${errors.join("; ")}`);
}

export default class ReleaseGateReporter implements Reporter {
	private readonly expectedTestIdsBySpec = new Map<string, string[]>();
	private readonly expectedSpecsByTestId = new Map<string, string>();
	private readonly results = new Map<string, GateTestResult>();
	private readonly unexpectedTestIds = new Set<string>();
	private readonly receiptPath: string | undefined;
	private readonly selection: GateReceiptSelection;
	private readonly writeReceipt: (path: string, content: string) => void;
	private readonly writeError: (message: string) => void;

	constructor(options: ReporterOptions = {}) {
		this.receiptPath = options.receiptPath ?? process.env["VOTUS_E2E_RESULT_FILE"];
		this.selection = configuredReceiptSelection();
		this.writeReceipt =
		options.writeReceipt ??
		((target, content) => writeFileSync(target, content, { mode: 0o600 }));
		this.writeError = options.writeError ?? ((message) => process.stderr.write(message));
	}

	onBegin(config: FullConfig, suite: Suite): void {
		void config;
		this.results.clear();
		this.expectedSpecsByTestId.clear();
		this.unexpectedTestIds.clear();
		this.expectedTestIdsBySpec.clear();
		for (const spec of this.selection.selected)
			this.expectedTestIdsBySpec.set(spec, []);
		for (const test of suite.allTests()) {
			const spec = relativeTestSpec(test);
			const expectedTestIds = this.expectedTestIdsBySpec.get(spec);
			if (!expectedTestIds || this.expectedSpecsByTestId.has(test.id)) {
				this.unexpectedTestIds.add(test.id);
				continue;
			}
			expectedTestIds.push(test.id);
			this.expectedSpecsByTestId.set(test.id, spec);
		}
	}

	onTestEnd(test: TestCase, result: TestResult): void {
		const spec = relativeTestSpec(test);
		if (this.expectedSpecsByTestId.get(test.id) !== spec) {
			this.unexpectedTestIds.add(test.id);
			return;
		}
		const failureLine = resultFailureLine(result);
		this.results.set(
			test.id,
			failureLine === undefined
				? { spec, status: result.status }
				: { spec, status: result.status, failureLine },
		);
	}

	private aggregatedResults(): GateTestResult[] {
		return this.selection.selected.map((spec) => {
			const expectedTestIds = this.expectedTestIdsBySpec.get(spec) ?? [];
			if (expectedTestIds.length === 0)
				return { spec, status: "interrupted" as const };
			const nonPassing = expectedTestIds
				.map(
					(testId) =>
						this.results.get(testId) ?? {
							spec,
							status: "interrupted" as const,
						},
				)
				.find(({ status }) => status !== "passed");
			if (!nonPassing) return { spec, status: "passed" as const };
			return nonPassing.failureLine === undefined
				? { spec, status: nonPassing.status }
				: {
					spec,
					status: nonPassing.status,
					failureLine: nonPassing.failureLine,
				};
		});
	}

	async onEnd(
		result: FullResult,
	): Promise<{ status: FullResult["status"] } | void> {
		if (!this.receiptPath) {
			this.writeError("e2e release gate failed: VOTUS_E2E_RESULT_FILE is missing\n");
			return { status: "failed" };
		}
		const completed = this.aggregatedResults();
		const suiteStatus =
			this.unexpectedTestIds.size > 0 && result.status === "passed"
				? "failed"
				: result.status;
		try {
			if (this.selection.mode === RECEIPT_MODE.FULL)
				assertGateReport(completed, suiteStatus);
			else assertFocusedGateReport(completed, suiteStatus, this.selection.selected);
			this.writeReceipt(
				this.receiptPath,
				JSON.stringify({
					suiteStatus,
					results: completed,
					selection: this.selection,
				}),
			);
			return;
		} catch (error) {
			const message =
				error instanceof Error ? error.message : "unknown reporter contract failure";
			const failureSuiteStatus = suiteStatus === "passed" ? "failed" : suiteStatus;
			this.writeReceipt(
				this.receiptPath,
				JSON.stringify({
					suiteStatus: failureSuiteStatus,
					results: completed,
					selection: this.selection,
				}),
			);
			this.writeError(`${message}\n`);
			return { status: "failed" };
		}
	}
}
