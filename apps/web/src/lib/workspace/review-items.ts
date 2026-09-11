import { z } from "zod";

const REVIEW_TIMESTAMP = z.iso.datetime({ offset: true }).max(64);

const REVIEW_ITEM_KIND = {
  AMBIGUOUS_MESA_CIRCUITO: "ambiguous_mesa_circuito",
  AMBIGUOUS_OFFICIAL_MESA_IDENTITY: "ambiguous_official_mesa_identity",
  BLANK_VOTE_CELL: "blank_vote_cell",
  CONTENT_DRIFT: "content_drift",
  DUPLICATE_COLLAPSED: "duplicate_collapsed",
  DUPLICATE_CONFLICT: "duplicate_conflict",
  FETCH_FAILURE: "fetch_failure",
  MESA_ABSENT_FROM_OFFICIAL_IMPORT: "mesa_absent_from_official_import",
  MESA_DISCONTINUITY: "mesa_discontinuity",
  MESA_TALLY_DIVERGENCE: "mesa_tally_divergence",
  PBA_CONFLICTING_DUPLICATE_SEMANTIC_RESULT: "pba_conflicting_duplicate_semantic_result",
  PBA_EXACT_DUPLICATE_SEMANTIC_RESULT: "pba_exact_duplicate_semantic_result",
  PBA_UNREADABLE_VOTE_CELL: "pba_unreadable_vote_cell",
  SOURCE_REEXPORTED: "source_reexported",
  UNMAPPED_JURISDICTION: "unmapped_jurisdiction",
  UNMAPPED_PARTY: "unmapped_party",
  UNMERGEABLE_ROW: "unmergeable_row",
  UNREADABLE_VOTE_CELL: "unreadable_vote_cell",
} as const;

const REVIEW_ITEM_SEVERITY = { ERROR: "error", WARNING: "warning", INFO: "info" } as const;
const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface AuthorizedReviewItem {
  detectedAt: string;
  kind: (typeof REVIEW_ITEM_KIND)[keyof typeof REVIEW_ITEM_KIND];
  severity: (typeof REVIEW_ITEM_SEVERITY)[keyof typeof REVIEW_ITEM_SEVERITY];
}

export type AuthorizedReviewItems =
  | { items: AuthorizedReviewItem[]; status: "ok"; total: number; truncated: boolean }
  | { status: "authorized_empty" }
  | { status: "authorization_denied" }
  | { status: "payload_too_large" }
  | { status: "unavailable" };

type RecordValue = Record<string, unknown>;

function isRecord(value: unknown): value is RecordValue {
  if (typeof value !== "object" || value === null) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value: RecordValue, keys: string[]): boolean {
  const actual = Object.keys(value).sort();
  return actual.length === keys.length && actual.every((key, index) => key === keys[index]);
}

function isSafeTotal(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isItem(value: unknown): value is RecordValue {
  return isRecord(value) && hasExactKeys(value, ["detected_at", "id", "kind", "severity"]);
}

function safeItem(value: RecordValue): AuthorizedReviewItem | null {
  const { detected_at: detectedAt, id, kind, severity } = value;
  if (
    typeof id !== "string" || !CANONICAL_UUID.test(id) ||
    typeof kind !== "string" || !Object.values(REVIEW_ITEM_KIND).includes(kind as AuthorizedReviewItem["kind"]) ||
    typeof severity !== "string" || !Object.values(REVIEW_ITEM_SEVERITY).includes(severity as AuthorizedReviewItem["severity"]) ||
    typeof detectedAt !== "string" || !REVIEW_TIMESTAMP.safeParse(detectedAt).success
  ) return null;
  return { detectedAt, kind: kind as AuthorizedReviewItem["kind"], severity: severity as AuthorizedReviewItem["severity"] };
}

function validExclusions(value: unknown, total: number, limit: number, offset: number, truncated: boolean): boolean {
  if (!Array.isArray(value)) return false;
  if (!truncated) return value.length === 0;
  if (value.length !== 1 || !isRecord(value[0]) || !hasExactKeys(value[0], ["reason", "rows"])) return false;
  return value[0]["reason"] === "pagination_bound" && value[0]["rows"] === total - offset - limit;
}

export function sanitizeReviewItems(value: unknown, limit: number, offset: number): AuthorizedReviewItems {
  if (!isRecord(value) || typeof value["status"] !== "string") return { status: "unavailable" };
  if (value["status"] === "authorization_denied") {
    return hasExactKeys(value, ["authorization_status", "exclusions", "items", "status", "total", "truncated"])
      && (typeof value["authorization_status"] === "string" || value["authorization_status"] === null)
      && Array.isArray(value["items"]) && value["items"].length === 0 && value["total"] === 0
      && value["truncated"] === false && Array.isArray(value["exclusions"]) && value["exclusions"].length === 0
      ? { status: "authorization_denied" } : { status: "unavailable" };
  }
  if (value["status"] === "payload_too_large") {
    const exclusions = value["exclusions"];
    return hasExactKeys(value, ["authorization_status", "exclusions", "items", "status", "total", "truncated"])
      && value["authorization_status"] === "authorized" && Array.isArray(value["items"]) && value["items"].length === 0
      && isSafeTotal(value["total"]) && value["truncated"] === true && Array.isArray(exclusions) && exclusions.length === 1
      && isRecord(exclusions[0]) && hasExactKeys(exclusions[0], ["reason"]) && exclusions[0]["reason"] === "payload_bound"
      ? { status: "payload_too_large" } : { status: "unavailable" };
  }
  if (value["status"] !== "ok" || !hasExactKeys(value, ["authorization_status", "exclusions", "items", "status", "total", "truncated"])) return { status: "unavailable" };
  const { authorization_status: authorizationStatus, exclusions, items, total, truncated } = value;
  if (!Array.isArray(items) || !isSafeTotal(total) || typeof truncated !== "boolean") return { status: "unavailable" };
  if (authorizationStatus === "authorized_empty") {
    return total === 0 && items.length === 0 && !truncated && Array.isArray(exclusions) && exclusions.length === 0
      ? { status: "authorized_empty" } : { status: "unavailable" };
  }
  if (authorizationStatus !== "authorized") return { status: "unavailable" };
  const expectedLength = Math.min(limit, Math.max(0, total - offset));
  const expectedTruncation = total > offset + limit;
  if (items.length !== expectedLength || truncated !== expectedTruncation || !validExclusions(exclusions, total, limit, offset, truncated)) return { status: "unavailable" };
  const safeItems = items.map((item) => isItem(item) ? safeItem(item) : null);
  return safeItems.every((item): item is AuthorizedReviewItem => item !== null)
    ? { items: safeItems, status: "ok", total, truncated } : { status: "unavailable" };
}
