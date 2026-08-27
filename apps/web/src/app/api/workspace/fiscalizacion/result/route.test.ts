import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ createClient: vi.fn(), getClaims: vi.fn(), rpc: vi.fn(), schema: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("../../../../../lib/supabase/server-client", () => ({ createSupabaseServerClient: mocks.createClient }));
const { GET } = await import("./route");

const BASE = "http://localhost/api/workspace/fiscalizacion/result";
const SCOPE = "election_id=50000000-0000-0000-0000-000000000001&category_id=51000000-0000-0000-0000-000000000001&distrito_code=02&seccion_code=027";
const SAFE = { status: "ok", authorization_status: "authorized", source_kind: "fiscalizacion", is_random_sample: false,
  reference: { election_year: 2025, election_round: "legislativas", category_name: "DIPUTADO NACIONAL", distrito_code: "02", seccion_code: "027", denominator_units: 2 },
  rows: { items: [{ list_id: "A", canonical_party_id: "party-a", party_name: "Party A", granularity: "mesa", votes: 10, rows: 1 }], total: 1, truncated: false },
  unmapped: { items: [], total: 0, truncated: false }, exclusions: { items: [], total: 0, truncated: false },
  provenance: { items: [{ id: "fiscal/a", sha256: "a".repeat(64), fetched_at: "2026-01-01T00:00:00Z", status: "ok" }], total: 1, truncated: false }, truncated: false };

beforeEach(() => {
  mocks.getClaims.mockReset().mockResolvedValue({ data: { claims: { sub: "41000000-0000-0000-0000-000000000001", session_id: "42000000-0000-0000-0000-000000000001", exp: Math.floor(Date.now() / 1_000) + 300 } }, error: null });
  mocks.rpc.mockReset().mockResolvedValue({ data: SAFE, error: null });
  mocks.schema.mockReset().mockReturnValue({ rpc: mocks.rpc });
  mocks.createClient.mockReset().mockResolvedValue({ auth: { getClaims: mocks.getClaims }, schema: mocks.schema });
});

describe("workspace fiscalizacion result GET", () => {
  it("uses the verified facade and reconstructs only bounded fiscal evidence", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: { ...SAFE, rows: { ...SAFE.rows, items: [{ ...SAFE.rows.items[0], source_url: "secret", person_name: "hidden" }] }, internal_notes: "hidden" }, error: null });
    const response = await GET(new Request(`${BASE}?${SCOPE}&opt_in=true`));
    expect(response.status).toBe(200);
    expect(mocks.getClaims).toHaveBeenCalledOnce();
    expect(mocks.schema).toHaveBeenCalledWith("workspace_api");
    expect(mocks.rpc).toHaveBeenCalledWith("fiscalizacion_result", { p_category_id: "51000000-0000-0000-0000-000000000001", p_distrito_code: "02", p_election_id: "50000000-0000-0000-0000-000000000001", p_opt_in: true, p_seccion_code: "027" });
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    const body = await response.json(); expect(body).toEqual(SAFE); expect(JSON.stringify(body)).not.toMatch(/source_url|person_name|internal_notes/);
  });

  it("independently rejects widened source, sample, bound, and count claims", async () => {
    const unsafe = [
      { ...SAFE, source_kind: "official" }, { ...SAFE, is_random_sample: true },
      { ...SAFE, rows: { items: Array(101).fill(SAFE.rows.items[0]), total: 101, truncated: true } },
      { ...SAFE, rows: { ...SAFE.rows, total: 2 } }, { ...SAFE, truncated: true },
    ];
    for (const payload of unsafe) { mocks.rpc.mockResolvedValueOnce({ data: payload, error: null }); const response = await GET(new Request(`${BASE}?${SCOPE}&opt_in=true`)); expect(response.status).toBe(403); }
  });

  it("keeps source inconsistency vote-free with reason breakdown and never accepts official no-row substitution", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: { status: "source_inconsistent", rows: { total: 9 }, exclusions: { items: [{ reason: "mixed_granularity", rows: 2, votes: 999 }], total: 1, truncated: false } }, error: null });
    await expect((await GET(new Request(`${BASE}?${SCOPE}&opt_in=true`))).json()).resolves.toEqual({ status: "source_inconsistent", exclusions: { items: [{ reason: "mixed_granularity", rows: 2 }], total: 1, truncated: false } });
    const empty = { items: [], total: 0, truncated: false };
    mocks.rpc.mockResolvedValueOnce({ data: { ...SAFE, status: "no_rows", rows: empty, unmapped: empty, provenance: empty }, error: null });
    await expect((await GET(new Request(`${BASE}?${SCOPE}&opt_in=true`))).json()).resolves.toMatchObject({ status: "no_rows", source_kind: "fiscalizacion" });
    mocks.rpc.mockResolvedValueOnce({ data: { ...SAFE, status: "no_rows", source_kind: "official", rows: empty }, error: null });
    expect((await GET(new Request(`${BASE}?${SCOPE}&opt_in=true`))).status).toBe(403);
  });

  it("passes omitted opt-in as false for the facade refusal", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: { status: "opt_in_required" }, error: null });
    await expect((await GET(new Request(`${BASE}?${SCOPE}`))).json()).resolves.toEqual({ status: "opt_in_required" });
    expect(mocks.rpc).toHaveBeenCalledWith("fiscalizacion_result", expect.objectContaining({ p_opt_in: false }));
  });

  it.each([`${BASE}?${SCOPE}&election_id=50000000-0000-0000-0000-000000000002`, `${BASE}?${SCOPE}&opt_in=yes`, `${BASE}?${SCOPE}&organization_id=40000000-0000-0000-0000-000000000001`, `${BASE}?category_id=51000000-0000-0000-0000-000000000001&distrito_code=02&seccion_code=027`])("rejects duplicate, unknown, malformed, or missing input before client creation", async (url) => {
    const response = await GET(new Request(url)); expect(response.status).toBe(400); expect(mocks.createClient).not.toHaveBeenCalled();
  });
});
