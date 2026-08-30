import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  getClaims: vi.fn(),
  rpc: vi.fn(),
  schema: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("../../../../../lib/supabase/server-client", () => ({
  createSupabaseServerClient: mocks.createClient,
}));
const { GET } = await import("./route");

const BASE = "http://localhost/api/workspace/fiscalizacion/coverage";
const SELECTION = "election_id=50000000-0000-0000-0000-000000000001&category_id=51000000-0000-0000-0000-000000000001&distrito_code=02&seccion_code=027";
const SAFE_PAYLOAD = {
  status: "ok", authorization_status: "authorized", source_kind: "fiscalizacion",
  is_random_sample: false, vote_data: "not_included", observed_units: 0, denominator_units: 2,
  uncovered: { items: [], total: 0, truncated: false },
  exclusions: { items: [], total: 0, truncated: false }, truncated: false,
};

beforeEach(() => {
  mocks.getClaims.mockReset().mockResolvedValue({
    data: {
      claims: {
        sub: "41000000-0000-0000-0000-000000000001",
        session_id: "42000000-0000-0000-0000-000000000001",
        exp: Math.floor(Date.now() / 1_000) + 300,
      },
    },
    error: null,
  });
mocks.rpc.mockReset().mockResolvedValue({ data: SAFE_PAYLOAD, error: null });
  mocks.schema.mockReset().mockReturnValue({ rpc: mocks.rpc });
  mocks.createClient.mockReset().mockResolvedValue({
    auth: { getClaims: mocks.getClaims },
    schema: mocks.schema,
  });
});

describe("workspace fiscalizacion coverage GET", () => {
  it("reaches the verified workspace facade with only section selectors and explicit opt-in", async () => {
    const response = await GET(new Request(`${BASE}?${SELECTION}&opt_in=true`));

    expect(response.status).toBe(200);
    expect(mocks.createClient).toHaveBeenCalledOnce();
    expect(mocks.getClaims).toHaveBeenCalledOnce();
    expect(mocks.schema).toHaveBeenCalledWith("workspace_api");
    expect(mocks.rpc).toHaveBeenCalledWith("fiscalizacion_coverage", {
      p_category_id: "51000000-0000-0000-0000-000000000001",
      p_distrito_code: "02",
      p_election_id: "50000000-0000-0000-0000-000000000001",
      p_opt_in: true,
      p_seccion_code: "027",
    });
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    await expect(response.json()).resolves.toMatchObject({
      status: "ok",
      source_kind: "fiscalizacion",
      is_random_sample: false,
      observed_units: 0,
      denominator_units: 2,
    });
  });

  it("shares administrative normalization semantics with the result route", async () => {
        const response = await GET(new Request(
          `${BASE}?election_id=50000000-0000-0000-0000-000000000001&category_id=51000000-0000-0000-0000-000000000001&distrito_code=%202%20&seccion_code=%2027%20&opt_in=false`,
        ));

        expect(response.status).toBe(200);
        expect(mocks.rpc).toHaveBeenCalledWith("fiscalizacion_coverage", expect.objectContaining({
          p_distrito_code: "02",
          p_opt_in: false,
          p_seccion_code: "027",
        }));
      });

      it("shares malformed administrative-code rejection semantics with the result route", async () => {
        const response = await GET(new Request(
          `${BASE}?election_id=50000000-0000-0000-0000-000000000001&category_id=51000000-0000-0000-0000-000000000001&distrito_code=2A&seccion_code=027&opt_in=true`,
        ));

        expect(response.status).toBe(400);
        expect(mocks.createClient).not.toHaveBeenCalled();
      });

      it("fails closed when the RPC loses its independent source guard", async () => {
      mocks.rpc.mockResolvedValueOnce({ data: { status: "ok", source_kind: "official", is_random_sample: true }, error: null });
      const response = await GET(new Request(`${BASE}?${SELECTION}&opt_in=true`));
      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toEqual({ status: "unavailable" });
    });

    it("fails closed on an unknown success status", async () => {
      mocks.rpc.mockResolvedValueOnce({ data: { ...SAFE_PAYLOAD, status: "unknown" }, error: null });
      const response = await GET(new Request(`${BASE}?${SELECTION}&opt_in=true`));
      expect(response.status).toBe(403);
    });

    it("projects only allowed evidence fields from a wider RPC envelope", async () => {
      const uncovered = { code: 1, circuito_code: "00001", establecimiento_code: "E1", establecimiento_name: "School", votes: 999 };
      mocks.rpc.mockResolvedValueOnce({ data: { ...SAFE_PAYLOAD, uncovered: { items: [uncovered], total: 1, truncated: false }, internal_votes: 999 }, error: null });
      const response = await GET(new Request(`${BASE}?${SELECTION}&opt_in=true`));
      expect(JSON.stringify(await response.json())).not.toContain("votes");
    });

    it("preserves a bounded source-inconsistency breakdown without leaking wider fields", async () => {
      mocks.rpc.mockResolvedValueOnce({
        data: {
          status: "source_inconsistent",
          exclusions: {
            items: [{ reason: "mixed_granularity", rows: 2, votes: 999 }],
            total: 1,
            truncated: false,
          },
          internal_rows: 9,
        },
        error: null,
      });

      const response = await GET(new Request(`${BASE}?${SELECTION}&opt_in=true`));

      await expect(response.json()).resolves.toEqual({
        status: "source_inconsistent",
        exclusions: {
          items: [{ reason: "mixed_granularity", rows: 2 }],
          total: 1,
          truncated: false,
        },
      });
    });

    it("fails closed when source inconsistency omits its breakdown", async () => {
      mocks.rpc.mockResolvedValueOnce({ data: { status: "source_inconsistent" }, error: null });
      const response = await GET(new Request(`${BASE}?${SELECTION}&opt_in=true`));
      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toEqual({ status: "unavailable" });
    });

    it("passes an omitted opt-in as false so the facade owns the distinct refusal", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: { status: "opt_in_required" }, error: null });

    const response = await GET(new Request(`${BASE}?${SELECTION}`));

    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("fiscalizacion_coverage", expect.objectContaining({ p_opt_in: false }));
    await expect(response.json()).resolves.toEqual({ status: "opt_in_required" });
  });

  it.each([
    `${BASE}?${SELECTION}&election_id=50000000-0000-0000-0000-000000000002`,
    `${BASE}?${SELECTION}&opt_in=yes`,
    `${BASE}?category_id=51000000-0000-0000-0000-000000000001&distrito_code=02&seccion_code=027`,
    `${BASE}?${SELECTION}&organization_id=40000000-0000-0000-0000-000000000001`,
  ])("rejects repeated, malformed, missing, or entitlement input before client creation", async (url) => {
    const response = await GET(new Request(url));

    expect(response.status).toBe(400);
    expect(mocks.createClient).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({ status: "invalid_request" });
  });
});
