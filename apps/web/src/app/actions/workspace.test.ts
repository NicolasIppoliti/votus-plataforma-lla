import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ getClaims: vi.fn(), rpc: vi.fn(), schema: vi.fn() }));
vi.mock("../../lib/supabase/server-client", () => ({
  createSupabaseServerClient: async () => ({ auth: { getClaims: mocks.getClaims }, schema: mocks.schema }),
}));
import { GET, POST } from "../api/workspace/route";
import { loadWorkspace, switchWorkspace } from "./workspace";
const claims = { sub: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11", session_id: "b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a12", exp: 4_102_444_800 };
describe("workspace server actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getClaims.mockResolvedValue({ data: { claims }, error: null });
    mocks.schema.mockReturnValue({ rpc: mocks.rpc });
  });
  it("loads the reachable selection state through the claims-bound RPCs", async () => {
    mocks.rpc
      .mockResolvedValueOnce({ data: { status: "selection_required", context_revision: 1 }, error: null })
      .mockResolvedValueOnce({ data: { status: "ok", organizations: [], total: 0, truncated: false }, error: null })
      .mockResolvedValueOnce({ data: { status: "selection_required", context_revision: 1 }, error: null });
    await expect((await GET()).json()).resolves.toEqual({
      bootstrap: { status: "selection_required", context_revision: 1 },
      available: { status: "ok", organizations: [], total: 0, truncated: false },
      current: { status: "selection_required", context_revision: 1 },
    });
    expect(mocks.getClaims).toHaveBeenCalledOnce();
    expect(mocks.schema).toHaveBeenCalledWith("workspace_api");
    expect(mocks.rpc.mock.calls).toEqual([
      ["bootstrap_workspace_context"],
      ["available_organizations"],
      ["current_workspace"],
    ]);
  });
  it.each([
    ["malformed JSON", "{"],
    ["null body", "null"],
    ["invalid selector", JSON.stringify({ organizationId: "invalid", expectedRevision: 0 })],
  ])("returns a bounded invalid request for %s", async (_scenario, body) => {
    const response = await POST(new Request("http://local/api/workspace", { method: "POST", body }));
    expect(response.status).toBe(400); await expect(response.json()).resolves.toEqual({ status: "invalid_request" });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("fails closed before RPC access when trusted claims are malformed", async () => {
    mocks.getClaims.mockResolvedValue({ data: { claims: { sub: "caller-input" } }, error: null });
    await expect(loadWorkspace()).rejects.toThrow("Workspace authentication failed");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("switches by organization selector and expected revision without caller identity", async () => {
    mocks.rpc.mockResolvedValue({ data: { status: "active", context_revision: 2 }, error: null });
    const organizationId = "c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a13";
    await switchWorkspace(organizationId, 1);
    expect(mocks.rpc).toHaveBeenCalledWith("switch_workspace_context", {
      p_expected_revision: 1,
      p_organization_id: organizationId,
    });
    expect(mocks.rpc.mock.calls[0]?.[1]).not.toHaveProperty("user_id");
    expect(mocks.rpc.mock.calls[0]?.[1]).not.toHaveProperty("session_id");
  });
});
