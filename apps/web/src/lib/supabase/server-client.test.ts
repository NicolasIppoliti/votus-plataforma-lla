import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface CookieTuple {
  name: string;
  value: string;
  options: Record<string, unknown>;
}

interface CookieAdapter {
  getAll(): unknown[];
  setAll(cookiesToSet: CookieTuple[]): void;
}

interface CapturedClientOptions {
  cookieOptions?: Record<string, unknown>;
  cookies: CookieAdapter;
}

const mocks = vi.hoisted(() => ({
  cookieGetAll: vi.fn(),
  cookieSet: vi.fn(),
  cookies: vi.fn(),
  createServerClient: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: mocks.cookies,
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: mocks.createServerClient,
}));

const { createSupabaseServerClient } = await import("./server-client");

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "test-anon-key");
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("VOTUS_E2E_BASE_URL", "http://localhost:3000");
  mocks.cookies.mockResolvedValue({
    getAll: mocks.cookieGetAll,
    set: mocks.cookieSet,
  });
  mocks.createServerClient.mockReturnValue({ client: "server" });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("createSupabaseServerClient", () => {
  it("applies central defaults while preserving every Supabase write tuple", async () => {
    await createSupabaseServerClient();

    const options = mocks.createServerClient.mock.calls[0]?.[2] as
      | CapturedClientOptions
      | undefined;
    expect(options?.cookieOptions).toEqual({
      httpOnly: true,
      secure: false,
      sameSite: "lax",
      path: "/",
    });

    const tuples: CookieTuple[] = [
      {
        name: "sb-test-auth-token.0",
        value: "opaque-chunk-a",
        options: { maxAge: 3600 },
      },
      {
        name: "sb-test-auth-token.1",
        value: "opaque-chunk-b",
        options: { maxAge: 0, expires: new Date(0) },
      },
    ];
    options?.cookies.setAll(tuples);

    expect(mocks.cookieSet).toHaveBeenCalledTimes(2);
    expect(mocks.cookieSet).toHaveBeenNthCalledWith(
      1,
      tuples[0]!.name,
      tuples[0]!.value,
      tuples[0]!.options,
    );
    expect(mocks.cookieSet).toHaveBeenNthCalledWith(
      2,
      tuples[1]!.name,
      tuples[1]!.value,
      tuples[1]!.options,
    );
  });
});
