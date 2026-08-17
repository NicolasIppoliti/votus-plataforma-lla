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

    it("redirects to the dashboard only after one successful password sign-in", async () => {
      mocks.signInWithPassword.mockResolvedValue({ error: null });

      await signIn(INITIAL_SIGN_IN_STATE, validCredentials());

      expect(mocks.signInWithPassword).toHaveBeenCalledOnce();
      expect(mocks.redirect).toHaveBeenCalledOnce();
      expect(mocks.redirect).toHaveBeenCalledWith("/dashboard");
      expect(mocks.signInWithPassword.mock.invocationCallOrder[0]).toBeLessThan(
        mocks.redirect.mock.invocationCallOrder[0]!,
      );
    });
  });
});
