import "server-only";
import { z } from "zod";
import { createSupabaseServerClient } from "../supabase/server-client";
import { authorizedOfficialSectionCompleteness } from "./context";
import type { OfficialSectionSelection } from "../../app/api/workspace/official/input";

const uint = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const archiveIds = z.array(z.string().min(1)).max(100);
const counts = z.object({ expected: uint, counted: uint, not_counted: uint, missing: uint, unexpected: uint, quarantined: uint, unattributed_quarantined: uint }).strict();
const envelope = { status: z.literal("ok"), authorization_status: z.literal("authorized"),
  source_kind: z.literal("official"), level: z.literal("seccion") };
const known = z.object({
  status: z.enum(["complete", "partial"]), reason: z.null(), unlisted_status_mesas: z.null(), quarantined_mesas: z.null(), unattributed_quarantined: z.null(), counts,
  category_applicability: z.literal("district_reported_categories"),
  sources: z.object({ catalogue_archive_entry_ids: archiveIds.min(1), status_archive_entry_ids: archiveIds }).strict(),
}).strict();
const unknown = z.union([
  z.object({ status: z.literal("unknown"), reason: z.literal("no_expected_catalogue"), counts: z.null(),
    category_applicability: z.literal("district_reported_categories"), sources: z.null() }).strict(),
  z.object({ status: z.literal("unknown"), reason: z.literal("section_absent_from_catalogue"), counts: z.null(),
    unlisted_status_mesas: uint, quarantined_mesas: uint, unattributed_quarantined: uint, category_applicability: z.literal("district_reported_categories"),
    sources: z.object({ catalogue_archive_entry_ids: archiveIds, status_archive_entry_ids: archiveIds }).strict() }).strict(),
]);
const success = z.object({ ...envelope, completeness: z.union([known, unknown]) }).strict();

export type SectionCompletenessCounts = z.infer<typeof counts>;
export type OfficialSectionCompleteness =
  | { status: "complete" | "partial"; counts: SectionCompletenessCounts }
  | { status: "unknown"; reason: "no_expected_catalogue" }
  | { status: "unknown"; reason: "section_absent_from_catalogue"; unlisted_status_mesas: number; quarantined_mesas: number; unattributed_quarantined: number }
  | { status: "unavailable" };

/** Section-level denominator from the official expected-mesa catalogue (S6).
 * Counts must reconcile and agree with the stated status; anything else is unavailable,
 * so a partial or malformed payload can never be shown as complete.
 */
export async function loadOfficialSectionCompleteness(selection: OfficialSectionSelection): Promise<OfficialSectionCompleteness> {
  try {
    const parsed = success.safeParse(await authorizedOfficialSectionCompleteness(await createSupabaseServerClient(), selection));
    if (!parsed.success) return { status: "unavailable" };
    const completeness = parsed.data.completeness;
    if (completeness.status === "unknown") {
      if (completeness.reason === "no_expected_catalogue") return { status: "unknown", reason: completeness.reason };
      return { status: "unknown", reason: completeness.reason, unlisted_status_mesas: completeness.unlisted_status_mesas,
        quarantined_mesas: completeness.quarantined_mesas, unattributed_quarantined: completeness.unattributed_quarantined };
    }
    const { expected, counted, not_counted: notCounted, missing, unexpected, quarantined, unattributed_quarantined: unattributed } = completeness.counts;
    const complete = expected > 0 && counted === expected && notCounted === 0 && missing === 0 && unexpected === 0 && quarantined === 0 && unattributed === 0;
    if (expected === 0 || counted + notCounted + missing !== expected || complete !== (completeness.status === "complete"))
      return { status: "unavailable" };
    return { status: completeness.status, counts: completeness.counts };
  } catch { return { status: "unavailable" }; }
}
