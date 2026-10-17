import { expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ createClient: vi.fn(), assertEnvironment: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createClient }));
vi.mock("../../../e2e/gate-contract", () => ({ assertE2eEnvironment: mocks.assertEnvironment }));
vi.mock("@playwright/test", () => ({ expect: (value: unknown) => ({
  toBeVisible: async () => expect(value).toBeDefined(),
  toBe: (expected: unknown) => expect(value).toBe(expected),
  toMatchObject: (expected: object) => expect(value).toMatchObject(expected),
  toHaveURL: async (expected: string) => expect((value as { url: () => string }).url()).toBe(expected),
}) }));
import { withReviewItem } from "../../../e2e/authorized-review-fixture";
import type { Page } from "@playwright/test";

it("selects the fixture organization and completes onboarding through the onboarding forms, not navigation controls", async () => {
  const baseUrl = "http://127.0.0.1:3100";
  mocks.assertEnvironment.mockReturnValue({ VOTUS_E2E_TEST_USER_EMAIL: "fixture@example.test", VOTUS_E2E_BASE_URL: baseUrl });
  mocks.createClient.mockReturnValue({
    from: () => ({ insert: async () => ({ error: null }) }),
    auth: { admin: { listUsers: async () => ({ data: { users: [{ id: "fixture-user", email: "fixture@example.test" }] }, error: null }) } },
    rpc: async (name: string) => ({ error: null, data: name.includes("setup") ? { organization_id: "fixture-org" } : {} }),
  });
  let current = "about:blank";
  const visited: string[] = [];
  const selectOption = vi.fn();
  const clicked: string[] = [];
  const control = (name?: string) => ({ click: async () => { clicked.push(name ?? ""); if (name === "Ingresar a Votus") current = `${baseUrl}/`; } });
  const region = { getByRole: (role: string, options?: { name?: string }) => role === "combobox" ? { selectOption } : control(options?.name) };
  const getByRole = vi.fn((role: string, options?: { name?: string }) => {
    if (role === "region" && options?.name === "Elegí tu organización") return region;
    if (role === "heading" && options?.name === "Tu alcance de trabajo") return {};
    if (role === "button" && options?.name === "Ingresar a Votus") return control(options.name);
    throw new Error(`unexpected control ${role} ${options?.name ?? ""}`);
  });
  const workspace = [{ status: "active", activeOrganizationId: "fixture-org" }, { status: "active", onboardingCompleted: true }];
  const request = { get: vi.fn(async () => { const body = workspace.shift(); return { ok: () => true, json: async () => body }; }) };
  const page = {
    url: () => current,
    goto: vi.fn(async (url: string) => { visited.push(url); current = url; }),
    getByRole,
    request,
  } as unknown as Page;
  const run = vi.fn(async () => "done");
  await expect(withReviewItem(page, run)).resolves.toBe("done");
  expect(visited.map(url => { const parsed = new URL(url); return [parsed.pathname, parsed.searchParams.get("paso"), parsed.searchParams.get("returnTo")]; }))
    .toEqual([["/onboarding", "organizacion", "/"], ["/onboarding", "ingreso", "/"]]);
  expect(selectOption).toHaveBeenCalledWith("fixture-org");
  expect(clicked).toEqual(["Continuar con esta organización", "Ingresar a Votus"]);
  expect(getByRole).not.toHaveBeenCalledWith("banner");
  expect(request.get).toHaveBeenCalledTimes(2);
  expect(run).toHaveBeenCalledOnce();
});
