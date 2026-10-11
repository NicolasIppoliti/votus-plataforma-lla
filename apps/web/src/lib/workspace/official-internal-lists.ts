import "server-only";
import { z } from "zod";
import { createSupabaseServerClient } from "../supabase/server-client";
import { authorizedOfficialInternalLists } from "./context";
import type { OfficialSectionSelection } from "../../app/api/workspace/official/input";

const uint = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const text = z.string().min(1);
const envelope = { authorization_status: z.literal("authorized"), truncated: z.literal(false) };
const selectionCounts = z.object({ unknown_election_id: z.literal(1).optional(), unknown_category_id: z.literal(1).optional() })
  .strict().refine((value) => value.unknown_election_id !== undefined || value.unknown_category_id !== undefined);
const granularityCounts = z.object({ included_distrito_rows: uint.optional(), included_seccion_rows: uint.optional(),
  included_circuito_rows: uint.optional(), included_establecimiento_rows: uint.optional(), included_mesa_rows: uint.optional(),
  requested_seccion_rows: z.literal(0).optional() }).strict().refine((value) =>
    Object.entries(value).some(([key, count]) => key.startsWith("included_") && count !== undefined && count > 0));
const listSchema = z.object({
  canonical_party_id: text.nullable(), display_name: text.nullable(), list_id: text.nullable(),
  source_name: text.nullable(), identity_status: z.enum(["canonical", "unmapped"]), votes: uint,
}).strict().refine((list) => list.identity_status === "canonical"
  ? list.canonical_party_id !== null && list.display_name !== null && list.source_name !== null
  : list.canonical_party_id === null || list.source_name === null);
const success = z.object({
  ...envelope, status: z.literal("ok"), source_kind: z.literal("official"), level: z.literal("seccion"),
  source_granularity: z.enum(["mesa", "establecimiento", "circuito", "seccion"]), category_name: text,
  positive_total: uint, lists: z.array(listSchema).max(1000),
  non_positive: z.object({ status: z.literal("unavailable"), reason: z.literal("not_persisted_by_national_ingestion") }).strict(),
}).strict();
const withReason = { ...envelope, reason: text };
const refusal = z.union([
  z.object({ status: z.literal("authorization_denied"), authorization_status: text.refine((s) => s !== "authorized" && s !== "authorized_empty"), truncated: z.literal(false), reason: text.optional() }).strict(),
  z.object({ ...envelope, status: z.literal("source_unavailable"), counts: z.union([
    z.object({ unsupported_internal_list_source: uint.positive() }).strict(),
    z.object({ conflicting_result_identity: uint.positive() }).strict(),
  ]) }).strict(),
  z.object({ ...withReason, status: z.literal("selection_invalid"), counts: selectionCounts }).strict(),
  z.object({ ...withReason, status: z.literal("source_unavailable"), counts: granularityCounts }).strict(),
  z.object({ ...withReason, status: z.literal("no_rows"), counts: z.object({ selected_rows: z.literal(0), requested_level_seccion: z.literal(0) }).strict() }).strict(),
  z.object({ ...envelope, status: z.literal("source_unavailable"), reason: text,
    exclusions: z.array(z.object({ reason: z.literal("official_rows_without_section_identity") }).strict()).length(1),
    source_exclusions: z.array(z.never()).length(0),
  }).strict(),
  z.object({ status: z.literal("payload_too_large"), authorization_status: z.literal("authorized"), truncated: z.literal(true), total_bytes: uint.gt(120000) }).strict(),
]);
export interface ExactShare { numerator: number; denominator: number }
export type OfficialInternalList = z.infer<typeof listSchema> & {
  label: string; withinParty: ExactShare | null; ofPositive: ExactShare | null; singleList: boolean | null;
};
export type OfficialInternalLists = (Omit<z.infer<typeof success>, "lists"> & { lists: OfficialInternalList[] })
  | z.infer<typeof refusal> | { status: "malformed" | "unavailable" };

/** Section-only RPC: finer selectors must not masquerade as a mesa breakdown.
 * T4b owns rendered-page reachability and formatting these exact rational shares.
 */
export async function loadOfficialInternalLists(selection: OfficialSectionSelection): Promise<OfficialInternalLists> {
  try {
    const raw: unknown = await authorizedOfficialInternalLists(await createSupabaseServerClient(), selection);
    const parsed = success.safeParse(raw);
    if (!parsed.success) {
      const denied = refusal.safeParse(raw);
      return denied.success ? denied.data : { status: "malformed" };
    }
    const data = parsed.data, seen = new Set<string | null>();
    const parents = new Map<string, { votes: number; lists: number; name: string | null }>();
    let total = 0;
    for (const list of data.lists) {
      if (seen.has(list.list_id)) return { status: "malformed" };
      seen.add(list.list_id); total += list.votes;
      if (!Number.isSafeInteger(total)) return { status: "malformed" };
      if (list.canonical_party_id !== null) {
        const parent = parents.get(list.canonical_party_id) ?? { votes: 0, lists: 0, name: list.display_name };
        if (parent.name !== list.display_name) return { status: "malformed" };
        parent.votes += list.votes; parent.lists++; parents.set(list.canonical_party_id, parent);
      }
    }
    if (total !== data.positive_total) return { status: "malformed" };
    return { ...data, lists: data.lists.map((list) => {
      const parent = list.canonical_party_id === null ? undefined : parents.get(list.canonical_party_id);
      return { ...list, label: list.identity_status === "unmapped" ? "Lista sin mapear" : list.source_name!,
        withinParty: parent?.votes ? { numerator: list.votes, denominator: parent.votes } : null,
        ofPositive: total ? { numerator: list.votes, denominator: total } : null,
        singleList: parent ? parent.lists === 1 : null };
    }) };
  } catch { return { status: "unavailable" }; }
}
