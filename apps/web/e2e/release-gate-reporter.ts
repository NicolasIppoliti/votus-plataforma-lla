import path from "node:path";
import { writeFileSync } from "node:fs";
import type { FullConfig, FullResult, Reporter, Suite, TestCase, TestResult } from "@playwright/test/reporter";
import { assertGateReport, type GateTestResult } from "./gate-contract";
interface ReporterOptions { receiptPath?: string;
  writeReceipt?: (path: string, content: string) => void; writeError?: (message: string) => void; }
export default class ReleaseGateReporter implements Reporter {
  private discovered: TestCase[] = [];
  private readonly results = new Map<string, GateTestResult>();
  private readonly receiptPath: string | undefined;
  private readonly writeReceipt: (path: string, content: string) => void;
  private readonly writeError: (message: string) => void;
  constructor(options: ReporterOptions = {}) {
    this.receiptPath = options.receiptPath ?? process.env["VOTUS_E2E_RESULT_FILE"];
    this.writeReceipt = options.writeReceipt ?? ((target, content) => writeFileSync(target, content, { mode: 0o600 }));
    this.writeError = options.writeError ?? ((message) => process.stderr.write(message));
  }
  onBegin(config: FullConfig, suite: Suite): void {
    void config;
    this.discovered = suite.allTests();
  }
  onTestEnd(test: TestCase, result: TestResult): void {
    const spec = `e2e/${path.basename(test.location.file)}`;
    const failureLine = result.status === "passed"
      ? undefined
      : result.errors?.find(({ location }) =>
          Number.isInteger(location?.line) && location!.line > 0)?.location?.line;
    this.results.set(test.id, failureLine === undefined
      ? { spec, status: result.status }
      : { spec, status: result.status, failureLine });
  }
  async onEnd(result: FullResult): Promise<{ status: FullResult["status"] } | void> {
    const completed = this.discovered.map((test) => {
      const recorded = this.results.get(test.id);
      return recorded ?? { spec: `e2e/${path.basename(test.location.file)}`, status: "interrupted" as const };
    });
    if (!this.receiptPath) {
      this.writeError("e2e release gate failed: VOTUS_E2E_RESULT_FILE is missing\n");
      return { status: "failed" };
    }
    this.writeReceipt(this.receiptPath, JSON.stringify({ suiteStatus: result.status, results: completed }));
    try {
      assertGateReport(completed, result.status);
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown reporter contract failure";
      this.writeError(`${message}\n`);
      return { status: "failed" };
    }
  }
}
