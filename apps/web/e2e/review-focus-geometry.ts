import { writeFile } from "node:fs/promises";
import { z } from "zod";

const controls = [
  "unlabelled", "skip-link", "nav-trigger", "nav-close", "last-drawer-link",
  "org-select", "org-submit", "header-count", "sign-out", "review-table-region",
  "pager-next-entry", "pager-next-50", "pager-next-100", "pager-previous-50",
] as const;
export type ReviewFocusControl = (typeof controls)[number];
const coordinate = z.number().min(-1_000_000).max(1_000_000);
const dimension = z.number().min(0).max(1_000_000);
const rect = z.strictObject({
  left: coordinate, top: coordinate, right: coordinate, bottom: coordinate,
  width: dimension, height: dimension,
});
const captureSchema = z.strictObject({
  control: z.enum(controls),
  snapshot: z.strictObject({
    effectiveOpacity: z.number().min(0).max(1),
    opaque: z.boolean(), intersects: z.literal(false), contained: z.boolean(),
    target: rect,
    viewport: z.strictObject({
      innerWidth: dimension, innerHeight: dimension,
      outerWidth: dimension, outerHeight: dimension,
      scrollX: coordinate, scrollY: coordinate,
    }),
    dialog: z.strictObject({
      rect, clientHeight: dimension, scrollHeight: dimension, scrollTop: coordinate,
    }).nullable(),
  }),
});

interface OutputLocation {
  outputPath(name: string): string;
}
type Writer = (path: string, body: string, options: { mode: number; flag: "wx" }) => Promise<unknown>;

// No error text escapes this optional diagnostic boundary; the caller owns its assertion.
export async function writeReviewFocusGeometry(
  capture: unknown,
  output: OutputLocation,
  writer: Writer = writeFile,
): Promise<boolean> {
  try {
    const parsed = captureSchema.safeParse(capture);
    if (!parsed.success) return false;
    const body = JSON.stringify(parsed.data);
    if (Buffer.byteLength(body, "utf8") > 4096) return false;
    await writer(output.outputPath("review-focus-geometry.json"), body, { mode: 0o600, flag: "wx" });
    return true;
  } catch {
    return false;
  }
}
