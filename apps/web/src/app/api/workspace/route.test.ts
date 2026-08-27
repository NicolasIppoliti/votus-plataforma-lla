import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ getClaims: vi.fn(), rpc: vi.fn(), schema: vi.fn() }));
vi.mock("@/lib/supabase/server-client", () => ({ createSupabaseServerClient: async () => ({ auth: { getClaims: mocks.getClaims }, schema: mocks.schema }) }));
import { GET, POST } from "./route";

const claims = { sub: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11", session_id: "b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a12", exp: 4_102_444_800 };
const organizationId = "c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a13";
const organization = (id = organizationId, display_name = "Municipalidad") => ({ id, display_name });
const indexedId = (index: number): string => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
const empty = (status: string, revision: number | null = null) => ({ status, revision, activeOrganizationId: null, organizations: [], total: null, truncated: null });
function observe(available: unknown, current: unknown): void { mocks.rpc.mockResolvedValueOnce({ data: { status: "selection_required", context_revision: 1 }, error: null }).mockResolvedValueOnce({ data: available, error: null }).mockResolvedValueOnce({ data: current, error: null }); }
function request(): Request { return new Request("http://local/api/workspace", { method: "POST", body: JSON.stringify({ organizationId, expectedRevision: 1 }) }); }

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getClaims.mockResolvedValue({ data: { claims }, error: null });
  mocks.schema.mockReturnValue({ rpc: mocks.rpc });
});

describe("workspace browser route", () => {
  it("returns only the private projected workspace selection and list metadata", async () => {
    observe({ status: "ok", organizations: [organization()], total: 1, truncated: false }, { status: "selection_required", context_revision: 1 });
    const response = await GET();
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    await expect(response.json()).resolves.toEqual({ status: "selection_required", revision: 1, activeOrganizationId: null, organizations: [{ id: organizationId, name: "Municipalidad" }], total: 1, truncated: false });
    expect(mocks.rpc.mock.calls).toEqual([["bootstrap_workspace_context"], ["available_organizations"], ["current_workspace"]]);
  });

  it.each([
    ["negative total", { status: "ok", organizations: [], total: -1, truncated: false }],
    ["fractional total", { status: "ok", organizations: [], total: 1.5, truncated: false }],
    ["unsafe total", { status: "ok", organizations: [], total: Number.MAX_SAFE_INTEGER + 1, truncated: true }],
    ["non-boolean truncated", { status: "ok", organizations: [], total: 0, truncated: "false" }],
    ["false truncated above 100", { status: "ok", organizations: [], total: 101, truncated: false }],
    ["true truncated at 100", { status: "ok", organizations: [], total: 100, truncated: true }],
    ["total below list length", { status: "ok", organizations: [organization()], total: 0, truncated: false }],
    ["non-truncated incomplete list", { status: "ok", organizations: [], total: 1, truncated: false }],
    ["over 100 rows", { status: "ok", organizations: Array.from({ length: 101 }, (_, index) => organization(indexedId(index))), total: 101, truncated: true }],
    ["malformed row", { status: "ok", organizations: [organization("caller-input", "Leaked")], total: 1, truncated: false }],
  ])("fails closed for %s", async (_case, available) => {
    observe(available, { status: "selection_required", context_revision: 1 });
    const response = await GET();
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual(empty("unavailable"));
  });

  it("reconciles an active organization with the authorized list", async () => {
    const firstHundred = Array.from({ length: 100 }, (_, index) => organization(indexedId(index), `Organization ${index}`));
    observe({ status: "ok", organizations: firstHundred, total: 101, truncated: true }, { status: "active", context_revision: 7, organization: organization() });
    const response = await GET(); const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toMatchObject({ status: "active", revision: 7, activeOrganizationId: organizationId, total: 101, truncated: true });
    expect(body.organizations).toHaveLength(101);
    expect(body.organizations.at(-1)).toEqual({ id: organizationId, name: "Municipalidad" });
  });

  it.each([
    ["complete list omission", { status: "ok", organizations: [], total: 0, truncated: false }, organization()],
    ["malformed current organization", { status: "ok", organizations: [], total: 101, truncated: true }, organization(organizationId, "")],
  ])("fails closed for active reconciliation with %s", async (_case, available, active) => {
    observe(available, { status: "active", context_revision: 3, organization: active });
    expect((await GET()).status).toBe(503);
  });

  it.each(["stale", "revoked", "expired"] as const)("preserves %s with its revision", async (status) => {
    observe({ status: "ok", organizations: [organization()], total: 1, truncated: false }, { status, context_revision: 6 });
    const response = await GET();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status, revision: 6, activeOrganizationId: null, organizations: [{ id: organizationId, name: "Municipalidad" }], total: 1, truncated: false });
  });

  it("bounds VOT03 as mismatch without PostgREST details", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: "VOT03", message: "private details" } });
    const response = await GET(); const body = await response.json();
    expect(response.status).toBe(409);
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(body).toEqual(empty("mismatch"));
    expect(JSON.stringify(body)).not.toContain("private details");
  });

  it.each(["{", "null", JSON.stringify({ organizationId: "invalid", expectedRevision: 0 })])("rejects invalid input without RPC access", async (body) => {
    const response = await POST(new Request("http://local/api/workspace", { method: "POST", body }));
    expect(response.status).toBe(400); expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("uses the revision as the compare-and-swap token", async () => {
    mocks.rpc.mockResolvedValue({ data: { status: "active", context_revision: 2 }, error: null });
    const response = await POST(request());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ...empty("active", 2), activeOrganizationId: organizationId });
    expect(mocks.rpc).toHaveBeenCalledWith("switch_workspace_context", { p_expected_revision: 1, p_organization_id: organizationId });
  });

  it.each([["conflict", 409], ["denied", 403], ["stale", 409], ["revoked", 409], ["expired", 409]] as const)("keeps %s switch state distinct", async (status, httpStatus) => {
    mocks.rpc.mockResolvedValue({ data: { status, context_revision: 4 }, error: null });
    const response = await POST(request()); const body = await response.json();
    expect(response.status).toBe(httpStatus);
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(body).toEqual(empty(status, 4));
    if (status === "denied") expect(JSON.stringify(body)).not.toContain(organizationId);
  });

  it("keeps a VOT03 switch mismatch private", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "VOT03", message: "private target" } });
    const response = await POST(request()); const body = await response.json();
    expect(response.status).toBe(409); expect(body).toEqual(empty("mismatch"));
    expect(JSON.stringify(body)).not.toContain("private target");
  });
});
