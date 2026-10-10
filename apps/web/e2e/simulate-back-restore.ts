import { writeFile } from "node:fs/promises";
import { z } from "zod";

// Facts about the same-document Browser Back restore in simulate.spec.ts (#395).
// Booleans and bounded counts only: no page text leaves this diagnostic boundary.
const length = z.number().int().min(0).max(1_000_000);
const count = z.number().int().min(0).max(1_000);

const captureSchema = z.strictObject({
  version: z.literal(2),
  urlMatchesBaseline: z.boolean(),
  inputMatchesBaseline: z.boolean(),
  resultMatchesBaseline: z.boolean(),
  resultShowsEditedList: z.boolean(),
  resultBusy: z.boolean(),
  resultLength: length,
  baselineLength: length,
  editorFirstListMatchesBaseline: z.boolean(),
  elapsedMs: z.number().int().min(0).max(600_000),
  // Which state the result status line announces, classified; never its text.
  status: z.enum(["current", "updating", "invalid", "absent", "other"]),
  // React Server Component requests for /simulate observed after Browser Back.
  rscRequestsAfterBack: count,
  rscResponsesAfterBack: count,
  rscFailuresAfterBack: count,
});

export type SimulateBackRestoreCapture = z.infer<typeof captureSchema>;

interface OutputLocation {
  outputPath(name: string): string;
}
type Writer = (path: string, body: string, options: { mode: number; flag: "wx" }) => Promise<unknown>;

// The caller owns its assertion; a rejected or failed write never replaces that error.
export async function writeSimulateBackRestore(
  capture: unknown,
  output: OutputLocation,
  writer: Writer = writeFile,
): Promise<boolean> {
  try {
    const parsed = captureSchema.safeParse(capture);
    if (!parsed.success) return false;
    const body = JSON.stringify(parsed.data);
    if (Buffer.byteLength(body, "utf8") > 1024) return false;
    await writer(output.outputPath("simulate-back-restore.json"), body, { mode: 0o600, flag: "wx" });
    return true;
  } catch {
    return false;
  }
}
