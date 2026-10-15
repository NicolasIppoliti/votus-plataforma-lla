import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  redirect: vi.fn(),
  signInWithPassword: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
}));

vi.mock("@/lib/supabase/server-client", () => ({
  createSupabaseServerClient: async () => ({
    auth: {
      signInWithPassword: mocks.signInWithPassword,
    },
  }),
}));

import { INITIAL_SIGN_IN_STATE } from "./sign-in-state";
import { signIn } from "./sign-in";

const GENERIC_ERROR = "Las credenciales no son válidas.";

function validCredentials(): FormData {
  const formData = new FormData();
  formData.set("email", "operator@example.test");
  formData.set("password", "synthetic-password");
  return formData;
}

describe("signIn server action module", () => {
  it("exports only async functions from the use server module", () => {
    const source = readFileSync(new URL("./sign-in.ts", import.meta.url), "utf8");

    expect(source).toMatch(/^export async function signIn\(/m);
    expect(source).not.toMatch(/^export\s+(?!async\s+function\b)/m);
  });

  describe("signIn", () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it.each([
      ["email", "password-only"],
      ["password", "operator@example.test"],
    ])(
      "rejects a missing %s without calling Supabase",
      async (presentField, value) => {
        const formData = new FormData();
        formData.set(presentField, value);

        const state = await signIn(INITIAL_SIGN_IN_STATE, formData);

        expect(state).toEqual({ error: GENERIC_ERROR });
        expect(mocks.signInWithPassword).not.toHaveBeenCalled();
        expect(mocks.redirect).not.toHaveBeenCalled();
      },
    );

    it("returns only a generic Spanish error and does not redirect when Supabase rejects login", async () => {
      mocks.signInWithPassword.mockResolvedValue({
        error: new Error("sensitive provider detail"),
      });

      const state = await signIn(INITIAL_SIGN_IN_STATE, validCredentials());

      expect(mocks.signInWithPassword).toHaveBeenCalledOnce();
      expect(mocks.signInWithPassword).toHaveBeenCalledWith({
        email: "operator@example.test",
        password: "synthetic-password",
      });
      expect(state).toEqual({ error: GENERIC_ERROR });
      expect(JSON.stringify(state)).not.toContain("synthetic-password");
      expect(JSON.stringify(state)).not.toContain("sensitive provider detail");
      expect(mocks.redirect).not.toHaveBeenCalled();
    });

    it.each(["/drilldown?electionId=2025&distrito=02", "/compare?leftElectionId=2023&rightElectionId=2025", "/simulate?scenario=%7B%22seats%22%3A9%7D"])("resumes %s after successful authentication", async (destination) => {
      mocks.signInWithPassword.mockResolvedValue({ error: null });
      const form = validCredentials();
      form.set("returnTo", destination);
      await signIn(INITIAL_SIGN_IN_STATE, form);
      expect(mocks.redirect).toHaveBeenCalledWith(destination);
    });

    it.each(["https://evil.test/", "//evil.test/", "/\\evil.test", "/login", "/api/session", "/drilldown/../login", "/drilldown?x=%ZZ", "/compare#fragment"])("rejects unsafe destination %s", async (destination) => {
      mocks.signInWithPassword.mockResolvedValue({ error: null });
      const form = validCredentials();
      form.set("returnTo", destination);
      await signIn(INITIAL_SIGN_IN_STATE, form);
      expect(mocks.redirect).toHaveBeenCalledWith("/");
    });

    it.each(["/compare?x=%5C", "/compare?x=%2F%2Fevil.test"])("keeps the actual sign-in redirect same-origin for encoded query data %s", async (destination) => {
      mocks.signInWithPassword.mockResolvedValue({ error: null });
      const form = validCredentials();
      form.set("returnTo", destination);
      await signIn(INITIAL_SIGN_IN_STATE, form);
      const redirected = new URL(mocks.redirect.mock.calls[0]![0] as string, "https://votus.test");
      expect(redirected.origin).toBe("https://votus.test");
      expect(redirected.pathname).toBe("/compare");
      expect(mocks.redirect).toHaveBeenCalledWith(destination);
    });

    it("defaults an oversized destination after real action authentication without truncating it", async () => {
      mocks.signInWithPassword.mockResolvedValue({ error: null });
      const form = validCredentials();
      form.set("returnTo", "/simulate?input=" + "a".repeat(8192));
      await signIn(INITIAL_SIGN_IN_STATE, form);
      expect(mocks.redirect).toHaveBeenCalledWith("/");
    });

    it("redirects to the root operational briefing only after one successful password sign-in", async () => {
      mocks.signInWithPassword.mockResolvedValue({ error: null });

      await signIn(INITIAL_SIGN_IN_STATE, validCredentials());

      expect(mocks.signInWithPassword).toHaveBeenCalledOnce();
      expect(mocks.redirect).toHaveBeenCalledOnce();
      expect(mocks.redirect).toHaveBeenCalledWith("/");
      expect(mocks.signInWithPassword.mock.invocationCallOrder[0]).toBeLessThan(
        mocks.redirect.mock.invocationCallOrder[0]!,
      );
    });
  });
});
