import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  getClaims: vi.fn(),
  redirect: vi.fn(),
  rpc: vi.fn(),
  schema: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
}));

vi.mock("@/lib/supabase/server-client", () => ({
  createSupabaseServerClient: async () => ({
    auth: {
      getClaims: mocks.getClaims,
      signOut: mocks.signOut,
    },
    schema: mocks.schema,
  }),
}));

import { signOut } from "./sign-out";

describe("signOut", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getClaims.mockResolvedValue({ data: { claims: { sub: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11", session_id: "b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a12", exp: 4_102_444_800 } }, error: null });
    mocks.rpc.mockResolvedValue({ data: { invalidated: false }, error: null });
    mocks.schema.mockReturnValue({ rpc: mocks.rpc });
  });

  it("invalidates this session before local sign-out and redirect", async () => {
    mocks.signOut.mockResolvedValue({ error: null });

    await signOut();

    expect(mocks.getClaims).toHaveBeenCalledOnce();
    expect(mocks.schema).toHaveBeenCalledWith("workspace_api");
    expect(mocks.rpc).toHaveBeenCalledWith("invalidate_workspace_context");
    expect(mocks.signOut).toHaveBeenCalledOnce();
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(mocks.redirect).toHaveBeenCalledOnce();
    expect(mocks.redirect).toHaveBeenCalledWith("/login");
    expect(mocks.getClaims.mock.invocationCallOrder[0]).toBeLessThan(mocks.rpc.mock.invocationCallOrder[0]!);
    expect(mocks.rpc.mock.invocationCallOrder[0]).toBeLessThan(mocks.signOut.mock.invocationCallOrder[0]!);
  });

  it.each([
    ["claims are malformed", () => mocks.getClaims.mockResolvedValue({ data: { claims: { sub: "invalid" } }, error: null })],
    ["context invalidation fails", () => mocks.rpc.mockResolvedValue({ data: null, error: new Error("denied") })],
  ])("does not discard the local session when %s", async (_scenario, arrange) => {
    arrange();
    await signOut();
    expect(mocks.signOut).not.toHaveBeenCalled();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("does not redirect when Supabase rejects sign-out", async () => {
    mocks.signOut.mockResolvedValue({
      error: new Error("sensitive provider detail"),
    });

    await signOut();

    expect(mocks.signOut).toHaveBeenCalledOnce();
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});
