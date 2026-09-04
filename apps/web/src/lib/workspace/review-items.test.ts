import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const rpcState = vi.hoisted(() => ({ data: null as unknown }));
const CLAIMS = {
  exp: Math.floor(Date.now() / 1_000) + 60,
  session_id: "10000000-0000-4000-8000-000000000001",
  sub: "10000000-0000-4000-8000-000000000002",
};

function clientFor(data: unknown) {
  return {
    auth: { getClaims: async () => ({ data: { claims: CLAIMS }, error: null }) },
    schema: () => ({ rpc: async () => ({ data, error: null }) }),
  } as never;
}

vi.mock("@/lib/supabase/server-client", () => ({
  createSupabaseServerClient: async () => clientFor(rpcState.data),
}));

const { authorizedReviewItems } = await import("./context");
const { default: ReviewPage } = await import("../../app/(authenticated)/review/page");

const ITEM = {
  detected_at: "2026-02-01T12:00:00Z",
  id: "10000000-0000-4000-8000-000000000003",
  kind: "fetch_failure",
  severity: "error",
};

function ok(items: unknown[] = [ITEM], total = items.length, truncated = false, exclusions: unknown[] = []) {
  return { authorization_status: "authorized", exclusions, items, status: "ok", total, truncated };
}

function read(data: unknown, limit = 50, offset = 0) {
  return authorizedReviewItems(clientFor(data), limit, offset);
}

describe("authorizedReviewItems", () => {
  it("fails closed rather than disclosing raw item identifiers or sensitive fields", async () => {
    const result = await read(ok([{ ...ITEM, subject_ref: "sensitive-subject-sentinel" }]));

    expect(result).toEqual({ status: "unavailable" });
  });

  it("constructs the valid presentation union without retaining item identifiers", async () => {
    await expect(read(ok())).resolves.toEqual({
      items: [{ detectedAt: ITEM.detected_at, kind: "fetch_failure", severity: "error" }],
      status: "ok",
      total: 1,
      truncated: false,
    });
  });

  it.each([
    ["authorized empty", { authorization_status: "authorized_empty", exclusions: [], items: [], status: "ok", total: 0, truncated: false }, "authorized_empty"],
    ["denied", { authorization_status: null, exclusions: [], items: [], status: "authorization_denied", total: 0, truncated: false }, "authorization_denied"],
    ["payload bound", { authorization_status: "authorized", exclusions: [{ reason: "payload_bound" }], items: [], status: "payload_too_large", total: 101, truncated: true }, "payload_too_large"],
  ])("maps %s to a figure-free safe variant", async (_name, data, status) => {
    await expect(read(data)).resolves.toEqual({ status });
  });

  it.each([
    ["zero limit", ok([], 1, true, [{ reason: "pagination_bound", rows: 1 }]), 0, 0],
    ["final page", ok([ITEM], 51, false), 50, 50],
    ["beyond end", ok([], 1, false), 50, 2],
  ])("accepts exact %s pagination", async (_name, data, limit, offset) => {
    await expect(read(data, limit, offset)).resolves.toMatchObject({ status: "ok" });
  });

  it.each([
    "ambiguous_mesa_circuito",
    "ambiguous_official_mesa_identity",
    "blank_vote_cell",
    "content_drift",
    "duplicate_collapsed",
    "duplicate_conflict",
    "fetch_failure",
    "mesa_absent_from_official_import",
    "mesa_discontinuity",
    "mesa_tally_divergence",
    "pba_conflicting_duplicate_semantic_result",
    "pba_exact_duplicate_semantic_result",
    "pba_unreadable_vote_cell",
    "source_reexported",
    "unmapped_jurisdiction",
    "unmapped_party",
    "unmergeable_row",
    "unreadable_vote_cell",
  ])("accepts the active SQL kind %s through the production facade", async (kind) => {
    await expect(read(ok([{ ...ITEM, kind }]))).resolves.toMatchObject({ status: "ok" });
  });

  it.each([
    ["extra envelope field", { ...ok(), scope: "sensitive-scope" }],
    ["noncanonical ID", ok([{ ...ITEM, id: "A0000000-0000-4000-8000-000000000003" }])],
    ["unknown kind", ok([{ ...ITEM, kind: "future_kind" }])],
    ["disallowed severity", ok([{ ...ITEM, severity: "info" }])],
    ["invalid timestamp", ok([{ ...ITEM, detected_at: "not-a-timestamp" }])],
    ["unsafe total", ok([], Number.MAX_SAFE_INTEGER + 1)],
    ["impossible truncation", ok([ITEM], 1, true, [{ reason: "pagination_bound", rows: 0 }])],
  ])("fails closed for %s", async (_name, data) => {
    await expect(read(data)).resolves.toEqual({ status: "unavailable" });
  });

  it("keeps sensitive numeric and string sentinels out of complete page output", async () => {
    rpcState.data = ok([{ ...ITEM, subject_ref: "sensitive-string-sentinel" }], 8675309);
    const markup = renderToStaticMarkup((await ReviewPage({ searchParams: Promise.resolve({}) })) as ReactElement);

    expect(markup).toContain("La cola de revisión no está disponible por el momento.");
    expect(markup).not.toContain("sensitive-string-sentinel");
    expect(markup).not.toContain("8675309");
    expect(markup).not.toContain(ITEM.id);
  });
});
