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

const ENVELOPES = [
  {
    name: "ok",
    data: ok(),
    expected: {
      status: "ok", total: 1, truncated: false,
      items: [{ detectedAt: ITEM.detected_at, kind: "fetch_failure", severity: "error" }],
    },
    copy: "Mostrando 1 de 1.",
  },
  {
    name: "authorized_empty",
    data: { authorization_status: "authorized_empty", exclusions: [], items: [], status: "ok", total: 0, truncated: false },
    expected: { status: "authorized_empty" },
    copy: "No hay elementos de revisión pendientes.",
  },
  {
    name: "authorization_denied",
    data: { authorization_status: null, exclusions: [], items: [], status: "authorization_denied", total: 0, truncated: false },
    expected: { status: "authorization_denied" },
    copy: "No se pudo autorizar la cola de revisión.",
  },
  {
    name: "payload_too_large",
    data: { authorization_status: "authorized", exclusions: [{ reason: "payload_bound" }], items: [], status: "payload_too_large", total: 8675309, truncated: true },
    expected: { status: "payload_too_large" },
    copy: "La respuesta de la cola de revisión supera el límite seguro.",
  },
];

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

  describe.each([
    "2026-02-01 (sensitive-subject-sentinel)",
    "2026-02-30T12:00:00Z",
    "2025-02-29T12:00:00+00:00",
    `2024-02-29T12:00:00.${"1".repeat(40)}+00:00`,
  ])("unsafe timestamp %s", (detected_at) => {
    it("refuses only the altered timestamp through the real facade", async () => {
      await expect(read(ok([{ ...ITEM, detected_at }]))).resolves.toEqual({ status: "unavailable" });
    });

    it("renders a figure-free unavailable page without item disclosure", async () => {
      rpcState.data = ok([{ ...ITEM, detected_at }]);
      const markup = renderToStaticMarkup((await ReviewPage({ searchParams: Promise.resolve({}) })) as ReactElement);

      expect(markup).toContain("La cola de revisión no está disponible por el momento.");
      expect(markup).not.toMatch(/sentinel|<table|<nav|Mostrando|elementos requieren revisión/);
      for (const value of [detected_at, ITEM.id, ITEM.kind]) expect(markup).not.toContain(value);
    });
  });

  it.each([
    "2024-02-29T12:00:00Z",
    "2026-08-27T00:00:01+00:00",
    "2024-02-29T12:00:00.123456-03:00",
    "2024-02-29T12:00:00.1+05:30",
    `2024-02-29T12:00:00.${"1".repeat(38)}+00:00`,
  ])("preserves valid timestamp %s through the facade and page", async (detected_at) => {
    rpcState.data = ok([{ ...ITEM, detected_at }]);
    await expect(read(rpcState.data)).resolves.toEqual({
      items: [{ detectedAt: detected_at, kind: ITEM.kind, severity: ITEM.severity }],
      status: "ok", total: 1, truncated: false,
    });
    const markup = renderToStaticMarkup((await ReviewPage({ searchParams: Promise.resolve({}) })) as ReactElement);

    expect(markup).toContain(detected_at);
    expect(markup).toContain("Mostrando 1 de 1.");
    expect(markup).not.toContain(ITEM.id);
  });

  it("accepts informational severity through the authorized facade", async () => {
    await expect(read(ok([{ ...ITEM, severity: "info" }]))).resolves.toEqual({
      items: [{ detectedAt: ITEM.detected_at, kind: "fetch_failure", severity: "info" }],
      status: "ok",
      total: 1,
      truncated: false,
    });
  });

  it("renders allowed informational evidence without exposing its identifier", async () => {
    rpcState.data = ok([{ ...ITEM, severity: "info" }]);
    const markup = renderToStaticMarkup((await ReviewPage({ searchParams: Promise.resolve({}) })) as ReactElement);

    expect(markup).toContain("Mostrando 1 de 1.");
    expect(markup).toContain('class="table-cell--short">info');
    expect(markup).toContain('class="table-cell--short">fetch_failure');
    expect(markup).toContain(ITEM.detected_at);
    expect(markup).not.toContain("Oculto por alcance");
    expect(markup).not.toContain(ITEM.id);
    expect(markup).not.toContain("La cola de revisión no está disponible");
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
    ["disallowed severity", ok([{ ...ITEM, severity: "debug" }])],
    ["invalid timestamp", ok([{ ...ITEM, detected_at: "not-a-timestamp" }])],
    ["unsafe total", ok([], Number.MAX_SAFE_INTEGER + 1)],
    ["impossible truncation", ok([ITEM], 1, true, [{ reason: "pagination_bound", rows: 0 }])],
  ])("fails closed for %s", async (_name, data) => {
    await expect(read(data)).resolves.toEqual({ status: "unavailable" });
  });

  describe.each(ENVELOPES)("$name envelope", ({ data, expected, copy, name }) => {
    it("accepts the exact baseline before field injection", async () => {
      await expect(read(data)).resolves.toEqual(expected);
    });

    it.each([
      ["unknown field", { future_field: "unknown-field-sentinel" }],
      ["subject", { subject_ref: "sensitive-subject-sentinel" }],
      ["note", { note: "sensitive-note-sentinel" }],
      ["scope", { scope: 8675309 }],
    ])("rejects an injected %s through the real facade", async (_label, injection) => {
      await expect(read({ ...data, ...injection })).resolves.toEqual({ status: "unavailable" });
    });

    it("renders the valid baseline through the real facade", async () => {
      rpcState.data = data;
      const markup = renderToStaticMarkup((await ReviewPage({ searchParams: Promise.resolve({}) })) as ReactElement);

      expect(markup).toContain(copy);
      expect(markup).not.toContain(ITEM.id);
      expect(markup).not.toContain("8675309");
      expect(markup).not.toContain("payload_bound");
      if (name !== "ok") {
        expect(markup).not.toMatch(/<table|<nav|Mostrando|elementos requieren revisión/);
      }
    });

    it.each([
      ["unknown field", { future_field: "unknown-field-sentinel" }],
      ["subject", { subject_ref: "sensitive-subject-sentinel" }],
      ["note", { note: "sensitive-note-sentinel" }],
      ["scope", { scope: 8675309 }],
      ["malformed count", { total: "malformed-count-sentinel" }],
      ["unsafe count", { total: Number.MAX_SAFE_INTEGER + 1 }],
      ["malformed items", { items: "malformed-items-sentinel" }],
      ["malformed exclusions", { exclusions: "malformed-exclusions-sentinel" }],
    ])("keeps %s out of the complete facade-to-page output", async (_label, injection) => {
      rpcState.data = { ...data, ...injection };
      const markup = renderToStaticMarkup((await ReviewPage({ searchParams: Promise.resolve({}) })) as ReactElement);

      expect(markup).toContain("La cola de revisión no está disponible por el momento.");
      expect(markup).not.toMatch(/sentinel|8675309|9007199254740992|<table|<nav|Mostrando|elementos requieren revisión/);
      expect(markup).not.toContain(ITEM.id);
      expect(markup).not.toContain(ITEM.detected_at);
      expect(markup).not.toContain("payload_bound");
    });
  });

  it.each([
    ["subject", { subject_ref: "sensitive-string-sentinel" }],
    ["note", { note: "sensitive-string-sentinel" }],
    ["kind", { kind: "malformed-kind-sentinel" }],
    ["severity", { severity: "malformed-severity-sentinel" }],
    ["timestamp", { detected_at: "malformed-timestamp-sentinel" }],
    ["identifier", { id: "malformed-id-sentinel" }],
  ])("keeps unsafe item %s out of complete page output with valid pagination", async (_label, injection) => {
    rpcState.data = ok([{ ...ITEM, ...injection }]);
    const markup = renderToStaticMarkup((await ReviewPage({ searchParams: Promise.resolve({}) })) as ReactElement);

    expect(markup).toContain("La cola de revisión no está disponible por el momento.");
    expect(markup).not.toMatch(/sentinel|<table|<nav|Mostrando|elementos requieren revisión/);
    expect(markup).not.toContain(ITEM.id);
  });
});
