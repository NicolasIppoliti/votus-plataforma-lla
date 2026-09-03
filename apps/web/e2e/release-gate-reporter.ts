import path from "node:path";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type {
	FullConfig,
	FullResult,
	Reporter,
	Suite,
	TestCase,
	TestResult,
} from "@playwright/test/reporter";
import {
	assertGateReport,
	EXPECTED_E2E_SPECS,
	type GateTestResult,
} from "./gate-contract";

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

export default class ReleaseGateReporter implements Reporter {
	private readonly expectedTestIdsBySpec = new Map<string, string[]>();
	private readonly expectedSpecsByTestId = new Map<string, string>();
	private readonly results = new Map<string, GateTestResult>();
	private readonly unexpectedTestIds = new Set<string>();
	private readonly receiptPath: string | undefined;
	private readonly writeReceipt: (path: string, content: string) => void;
	private readonly writeError: (message: string) => void;

	constructor(options: ReporterOptions = {}) {
		this.receiptPath = options.receiptPath ?? process.env["VOTUS_E2E_RESULT_FILE"];
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
		for (const spec of EXPECTED_E2E_SPECS)
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
		const completed = EXPECTED_E2E_SPECS.map((spec) => {
			const expectedTestIds = this.expectedTestIdsBySpec.get(spec) ?? [];
			const nonPassing = expectedTestIds
				.map(
					(testId) =>
						this.results.get(testId) ?? {
							spec,
							status: "interrupted" as const,
						},
				)
				.find(({ status }) => status !== "passed");
			if (expectedTestIds.length === 0)
				return { spec, status: "interrupted" as const };
			if (!nonPassing) return { spec, status: "passed" as const };
			return nonPassing.failureLine === undefined
				? { spec, status: nonPassing.status }
				: {
					spec,
					status: nonPassing.status,
					failureLine: nonPassing.failureLine,
				};
		});
		return completed;
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
			assertGateReport(completed, suiteStatus);
			this.writeReceipt(
				this.receiptPath,
				JSON.stringify({ suiteStatus, results: completed }),
			);
			return;
		} catch (error) {
			const message =
				error instanceof Error ? error.message : "unknown reporter contract failure";
			const failureSuiteStatus = suiteStatus === "passed" ? "failed" : suiteStatus;
			this.writeReceipt(
				this.receiptPath,
				JSON.stringify({ suiteStatus: failureSuiteStatus, results: completed }),
			);
			this.writeError(`${message}\n`);
			return { status: "failed" };
		}
	}
}
