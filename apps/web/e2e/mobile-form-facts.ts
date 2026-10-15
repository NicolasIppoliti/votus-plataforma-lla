import { z } from "zod";

export const MOBILE_FORM_ATTACHMENT = "mobile-form-geometry";
export const MOBILE_FORM_CONTENT_TYPE = "application/vnd.votus.mobile-form-facts+json";
export const MOBILE_FORM_FACTS_LIMIT = 4096;
const dimension = z.number().finite().min(0).max(1_000_000);
const coordinate = z.number().finite().min(-1_000_000).max(1_000_000);
const count = z.number().int().min(0).max(10_000);
const rectangle = { width: dimension, height: dimension, left: coordinate, right: coordinate, scrollWidth: dimension };
export const mobileFormFactsSchema = z.strictObject({
  version: z.literal(1),
  phase: z.enum(["fonts", "page", "field-scroll", "field-geometry", "action-scroll", "action-geometry"]),
  index: count.nullable(),
  viewportWidth: dimension,
  sample: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("page"), documentWidth: dimension, clientWidth: dimension }),
    z.strictObject({
      kind: z.literal("field"), tag: z.enum(["input", "select", "textarea"]), ...rectangle,
      labelCount: count, mirrorPresent: z.boolean(), mirrorWidth: dimension, mirrorScrollWidth: dimension,
      checks: z.strictObject({ target: z.boolean(), bounded: z.boolean(), visibleLabels: z.boolean(), fullSelection: z.boolean() }),
    }),
    z.strictObject({ kind: z.literal("action"), ...rectangle, scrollHeight: dimension, valid: z.boolean() }),
  ]).optional(),
});
export type MobileFormFacts = z.infer<typeof mobileFormFactsSchema>;

/** Inline JSON only. Never follow attachment paths or forward arbitrary text. */
export function mobileFormFactsFromAttachments(attachments: readonly { name: string; contentType: string; body?: Buffer }[] = []): MobileFormFacts | undefined {
  for (const attachment of attachments) {
    if (attachment.name !== MOBILE_FORM_ATTACHMENT || attachment.contentType !== MOBILE_FORM_CONTENT_TYPE || !Buffer.isBuffer(attachment.body) || attachment.body.byteLength > MOBILE_FORM_FACTS_LIMIT) continue;
    try {
      const parsed = mobileFormFactsSchema.safeParse(JSON.parse(attachment.body.toString("utf8")));
      if (parsed.success) return parsed.data;
    } catch { /* An optional diagnostic must never replace the original failure. */ }
  }
  return undefined;
}
