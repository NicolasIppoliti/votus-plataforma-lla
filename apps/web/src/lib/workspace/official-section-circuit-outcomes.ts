import "server-only";
import { z } from "zod";
import { createSupabaseServerClient } from "../supabase/server-client";
import { authorizedOfficialSectionCircuitOutcomes } from "./context";
import type { OfficialSectionSelection } from "../../app/api/workspace/official/input";

const uint = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const text = z.string().min(1);
const reasons = z.record(text, uint);
const unassignedSchema = z.object({ catalogue_mesas_without_membership: uint, membership_quarantined_mesas: uint,
  membership_quarantine_reasons: reasons, completeness_quarantines: uint, completeness_quarantine_reasons: reasons,
  unexpected_status_mesas: uint }).strict();
const party = z.union([
  z.object({ identity_status: z.literal("canonical"), canonical_party_id: text, display_name: text, list_id: z.null(), votes: uint }).strict(),
  z.object({ identity_status: z.literal("unmapped"), canonical_party_id: z.null(), display_name: z.null(), list_id: text.nullable(), votes: uint }).strict(),
]);
const circuit = z.object({ circuito_code: z.string().regex(/^([0-9]{5}|[0-9]{4}[A-Z])$/), positive_total: uint,
  parties: z.array(party).max(100), status: z.enum(["complete", "partial"]),
  counts: z.object({ expected: uint.refine(n => n > 0), counted: uint, not_counted: uint, missing: uint, unexpected: uint, quarantined: uint }).strict() }).strict();
const envelope = { status: z.literal("ok"), authorization_status: z.literal("authorized"), source_kind: z.literal("official"),
  level: z.literal("seccion"), truncated: z.literal(false), unassigned: unassignedSchema };
const success = z.union([
  z.object({ ...envelope, circuit_membership: z.literal("known"), category_applicability: z.literal("district_reported_categories"), circuits: z.array(circuit).min(1).max(200) }).strict(),
  z.object({ ...envelope, circuit_membership: z.literal("unknown"), circuits: z.array(circuit).length(0) }).strict(),
]);
// Refusals returned directly by this RPC or inherited unchanged from official_result.
const denied = z.union([
  z.object({ status: z.literal("authorization_denied"), authorization_status: text.refine(s => s !== "authorized"), truncated: z.literal(false) }).strict(),
  z.object({ status: z.literal("authorization_denied"), authorization_status: z.literal("scope_required"),
    reason: z.literal("an exact section is required for an authorized official operation"), truncated: z.literal(false) }).strict(),
]);
const bounded = z.union([
  z.object({ status: z.literal("payload_too_large"), authorization_status: z.literal("authorized"), total_circuits: uint, truncated: z.literal(true) }).strict(),
  z.object({ status: z.literal("payload_too_large"), authorization_status: z.literal("authorized"), total_bytes: uint, truncated: z.literal(true) }).strict(),
]);
const sourceExclusions = z.array(z.object({ kind: text, rows: uint, votes: uint }).strict()).max(20);
const refused = z.union([
  z.object({ status: z.literal("source_unavailable"), authorization_status: z.literal("authorized"),
    reason: z.enum(["conflicting_result_identity", "mesa_results_required"]), truncated: z.literal(false) }).strict(),
  z.object({ status: z.literal("source_unavailable"), authorization_status: z.literal("authorized"),
    reason: z.literal("official rows without exact section identity were excluded"),
    exclusions: z.array(z.object({ reason: z.literal("official_rows_without_section_identity") }).strict()),
    source_exclusions: sourceExclusions, truncated: z.literal(false) }).strict(),
  z.object({ status: z.enum(["selection_invalid", "no_rows", "source_unavailable"]), authorization_status: z.literal("authorized"),
    reason: text, counts: reasons, source_exclusions: sourceExclusions, truncated: z.literal(false) }).strict(),
]);
export const officialSectionCircuitRpcSchema = z.union([success, denied, bounded, refused]);
export type CircuitOutcome = z.infer<typeof circuit>;
export type OfficialSectionCircuitOutcomes = z.infer<typeof success> | { status: "unavailable" };
const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
/** Strictly mirrors RPC branches; refusals and malformed envelopes never carry displayed figures. */
export function parseOfficialSectionCircuitOutcomes(value: unknown): OfficialSectionCircuitOutcomes {
  const parsed = officialSectionCircuitRpcSchema.safeParse(value);
  if (!parsed.success || parsed.data.status !== "ok") return { status: "unavailable" };
  const data = parsed.data, u = data.unassigned;
  if (sum(Object.values(u.completeness_quarantine_reasons)) !== u.completeness_quarantines ||
    Object.values(u.membership_quarantine_reasons).some(n => n === 0 || n > u.membership_quarantined_mesas) ||
    (u.membership_quarantined_mesas === 0) !== (Object.keys(u.membership_quarantine_reasons).length === 0) ||
    (u.membership_quarantined_mesas > 0 && sum(Object.values(u.membership_quarantine_reasons)) < u.membership_quarantined_mesas)) return { status: "unavailable" };
  const unassigned = u.catalogue_mesas_without_membership + u.membership_quarantined_mesas + u.completeness_quarantines + u.unexpected_status_mesas;
  if (!Number.isSafeInteger(unassigned) || new Set(data.circuits.map(c => c.circuito_code)).size !== data.circuits.length) return { status: "unavailable" };
  for (const c of data.circuits) {
    const n = c.counts;
    const complete = n.counted === n.expected && n.not_counted === 0 && n.missing === 0 && n.unexpected === 0 && n.quarantined === 0 && unassigned === 0;
    const identities = c.parties.map(p => p.identity_status === "canonical" ? `canonical:${p.canonical_party_id}` : `unmapped:${p.list_id}`);
    if (n.counted + n.not_counted + n.missing !== n.expected || complete !== (c.status === "complete") ||
      sum(c.parties.map(p => p.votes)) !== c.positive_total || new Set(identities).size !== identities.length) return { status: "unavailable" };
  }
  return data;
}
export async function loadOfficialSectionCircuitOutcomes(selection: OfficialSectionSelection): Promise<OfficialSectionCircuitOutcomes> {
  try { return parseOfficialSectionCircuitOutcomes(await authorizedOfficialSectionCircuitOutcomes(await createSupabaseServerClient(), selection)); }
  catch { return { status: "unavailable" }; }
}
