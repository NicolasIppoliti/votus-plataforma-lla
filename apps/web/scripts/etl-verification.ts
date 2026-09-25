import path from "node:path";
import { fileURLToPath } from "node:url";
import { executeOwnedEtlVerification, reportReleaseGateFailure } from "./e2e-release-gate.ts";
export async function etlVerificationMain(
  argv: readonly string[] = process.argv.slice(2),
): Promise<void> {
  if (argv.length !== 1 || (argv[0] !== "--plan" && argv[0] !== "--run"))
    throw new Error("usage: etl-verification.ts --plan|--run");
  if (argv[0] === "--run") {
    await executeOwnedEtlVerification();
    return;
  }
  process.stdout.write("Plan: run etl-verify only inside a fresh isolated, marker-owned Supabase stack; no stack, database, or migration action is performed.\n");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const valid = process.argv.length === 3 && (process.argv[2] === "--plan" || process.argv[2] === "--run");
  void etlVerificationMain().catch((error: unknown) => {
    reportReleaseGateFailure("isolated ETL verification failed", error);
    process.exitCode = valid ? 1 : 2;
  });
}
