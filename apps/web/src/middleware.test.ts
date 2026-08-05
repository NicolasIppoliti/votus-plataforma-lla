import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mocks the Supabase SSR client at the module boundary so these unit tests
// exercise only `middleware.ts`'s own session-gating logic, not a real
// network call to Supabase Auth. `createServerClient` is invoked once per
// `middleware()` call with fresh cookie handlers; `auth.getUser()` is the
// single seam this test controls.
const mockGetUser = vi.fn();

vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(() => ({
    auth: { getUser: mockGetUser },
  })),
}));

// Imported after the mock so the module under test picks up the mocked
// `@supabase/ssr` export.
const { middleware } = await import("./middleware");

beforeEach(() => {
  mockGetUser.mockReset();
  process.env["NEXT_PUBLIC_SUPABASE_URL"] = "http://127.0.0.1:54321";
  process.env["NEXT_PUBLIC_SUPABASE_ANON_KEY"] = "test-anon-key";
});

describe("middleware", () => {
  it("test_unauthenticated_request_rejected_without_data", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });

    const request = new NextRequest("http://localhost:3000/dashboard");
    const response = await middleware(request);

    // Rejected: redirected away from the requested route, never a 200 that
    // could carry electoral data.
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("/login");

    // AND no electoral data is present in the response body.
    const body = await response.text();
    expect(body).toBe("");
  });

  it("test_authenticated_request_succeeds", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: "11111111-1111-1111-1111-111111111111" } },
    });

    const request = new NextRequest("http://localhost:3000/dashboard");
    const response = await middleware(request);

    // Allowed through: not redirected, no Location header steering away
    // from the requested in-scope route.
    expect(response.headers.get("location")).toBeNull();
    expect(response.status).toBe(200);
  });

  it("test_two_authenticated_users_get_identical_access", async () => {
    mockGetUser.mockResolvedValueOnce({
      data: { user: { id: "11111111-1111-1111-1111-111111111111" } },
    });
    const requestA = new NextRequest("http://localhost:3000/dashboard");
    const responseA = await middleware(requestA);

    mockGetUser.mockResolvedValueOnce({
      data: { user: { id: "22222222-2222-2222-2222-222222222222" } },
    });
    const requestB = new NextRequest("http://localhost:3000/dashboard");
    const responseB = await middleware(requestB);

    // Same route, two distinct authenticated users, no privilege flag on
    // either — identical outcome for both, per the "Single authenticated
    // role" requirement.
    expect(responseA.status).toBe(responseB.status);
    expect(responseA.status).toBe(200);
    expect(responseA.headers.get("location")).toBe(
      responseB.headers.get("location"),
    );
  });
});
