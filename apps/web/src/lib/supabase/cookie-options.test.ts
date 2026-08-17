import { describe, expect, it } from "vitest";
import {
  resolveSupabaseCookieOptions,
  supabaseCookieOptionsForServerRuntime,
} from "./cookie-options";

const REQUIRED_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax",
  path: "/",
} as const;

describe("resolveSupabaseCookieOptions", () => {
  it("enforces the shared policy without owning Supabase cookie identity or lifetime", () => {
    const options = resolveSupabaseCookieOptions({
      environment: "production",
      hostname: "votus.example",
    });

    expect(options).toEqual({
      ...REQUIRED_COOKIE_OPTIONS,
      secure: true,
    });
    expect(options).not.toHaveProperty("name");
    expect(options).not.toHaveProperty("domain");
    expect(options).not.toHaveProperty("maxAge");
    expect(options).not.toHaveProperty("expires");
  });

  it.each(["localhost", "api.localhost", "127.0.0.1", "::1", "[::1]"])(
    "allows the explicit production HTTP loopback gate for %s",
    (hostname) => {
      expect(
        resolveSupabaseCookieOptions({
          environment: "production",
          hostname,
        }),
      ).toEqual({
        ...REQUIRED_COOKIE_OPTIONS,
        secure: false,
      });
    },
  );

  it("defaults unknown production hostnames to Secure", () => {
    expect(
      resolveSupabaseCookieOptions({
        environment: "production",
        hostname: undefined,
      }).secure,
    ).toBe(true);
  });

  it("keeps development cookies usable over HTTP", () => {
    expect(
      resolveSupabaseCookieOptions({
        environment: "development",
        hostname: "votus.example",
      }),
    ).toEqual({
      ...REQUIRED_COOKIE_OPTIONS,
      secure: false,
    });
  });
});

describe("supabaseCookieOptionsForServerRuntime", () => {
  it("derives the server-action loopback exception only from VOTUS_E2E_BASE_URL", () => {
    expect(
      supabaseCookieOptionsForServerRuntime({
        NODE_ENV: "production",
        VOTUS_E2E_BASE_URL: "http://localhost:3000",
      }).secure,
    ).toBe(false);

    expect(
      supabaseCookieOptionsForServerRuntime({
        NODE_ENV: "production",
        VOTUS_E2E_BASE_URL: "not a URL",
      }).secure,
    ).toBe(true);
  });
});
