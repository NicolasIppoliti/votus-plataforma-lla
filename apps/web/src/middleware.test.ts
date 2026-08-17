import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface CookieTuple {
  name: string;
  value: string;
  options: Record<string, unknown>;
}

interface CookieAdapter {
  setAll(cookiesToSet: CookieTuple[]): void;
}

interface CapturedClientOptions {
  cookieOptions?: Record<string, unknown>;
  cookies: CookieAdapter;
}

const mocks = vi.hoisted(() => ({
  createServerClient: vi.fn(),
  getUser: vi.fn(),
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: mocks.createServerClient,
}));

const { middleware } = await import("./middleware");

let capturedClientOptions: CapturedClientOptions | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  capturedClientOptions = undefined;
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "test-anon-key");
  vi.stubEnv("NODE_ENV", "test");
  mocks.createServerClient.mockImplementation((...args: unknown[]) => {
    capturedClientOptions = args[2] as CapturedClientOptions;
    return {
      auth: { getUser: mocks.getUser },
    };
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("middleware", () => {
  it("test_unauthenticated_request_rejected_without_data", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });

    const request = new NextRequest("http://localhost:3000/dashboard");
    const response = await middleware(request);

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("/login");
    expect(await response.text()).toBe("");
  });

  it("test_authenticated_request_succeeds", async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: { id: "11111111-1111-1111-1111-111111111111" } },
    });

    const request = new NextRequest("http://localhost:3000/dashboard");
    const response = await middleware(request);

    expect(response.headers.get("location")).toBeNull();
    expect(response.status).toBe(200);
  });

  it("test_two_authenticated_users_get_identical_access", async () => {
    mocks.getUser.mockResolvedValueOnce({
      data: { user: { id: "11111111-1111-1111-1111-111111111111" } },
    });
    const requestA = new NextRequest("http://localhost:3000/dashboard");
    const responseA = await middleware(requestA);

    mocks.getUser.mockResolvedValueOnce({
      data: { user: { id: "22222222-2222-2222-2222-222222222222" } },
    });
    const requestB = new NextRequest("http://localhost:3000/dashboard");
    const responseB = await middleware(requestB);

    expect(responseA.status).toBe(responseB.status);
    expect(responseA.status).toBe(200);
    expect(responseA.headers.get("location")).toBe(
      responseB.headers.get("location"),
    );
  });

  it.each([
    ["https://votus.example/dashboard", true],
    ["http://api.localhost:3000/dashboard", false],
  ])("applies the central production cookie policy for %s", async (url, secure) => {
    vi.stubEnv("NODE_ENV", "production");
    mocks.getUser.mockResolvedValue({
      data: { user: { id: "11111111-1111-1111-1111-111111111111" } },
    });

    await middleware(new NextRequest(url));

    expect(capturedClientOptions?.cookieOptions).toEqual({
      httpOnly: true,
      secure,
      sameSite: "lax",
      path: "/",
    });
  });

  it("forwards every chunk and deletion tuple without replacing Supabase options", async () => {
    const expires = new Date(0);
    const tuples: CookieTuple[] = [
      {
        name: "sb-test-auth-token.0",
        value: "opaque-chunk-a",
        options: { maxAge: 3600, path: "/chunk" },
      },
      {
        name: "sb-test-auth-token.1",
        value: "opaque-chunk-b",
        options: { maxAge: 0, expires, path: "/deleted" },
      },
    ];
    mocks.getUser.mockImplementation(async () => {
      if (!capturedClientOptions) throw new Error("client options were not captured");
      capturedClientOptions.cookies.setAll(tuples);
      return {
        data: { user: { id: "11111111-1111-1111-1111-111111111111" } },
      };
    });
    const request = new NextRequest("https://votus.example/dashboard");

    const response = await middleware(request);

    expect(request.cookies.get(tuples[0]!.name)?.value).toBe(tuples[0]!.value);
    expect(request.cookies.get(tuples[1]!.name)?.value).toBe(tuples[1]!.value);
    const setCookieHeader = response.headers.get("set-cookie");
    expect(setCookieHeader).toContain("sb-test-auth-token.0=opaque-chunk-a");
    expect(setCookieHeader).toContain("Max-Age=3600");
    expect(setCookieHeader).toContain("Path=/chunk");
    expect(setCookieHeader).toContain("sb-test-auth-token.1=opaque-chunk-b");
    expect(setCookieHeader).toContain("Max-Age=0");
    expect(setCookieHeader).toContain("Path=/deleted");
    expect(setCookieHeader).toContain(expires.toUTCString());
  });
});
