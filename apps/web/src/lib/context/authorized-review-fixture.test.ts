import { expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ createClient: vi.fn(), assertEnvironment: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createClient }));
vi.mock("../../../e2e/gate-contract", () => ({ assertE2eEnvironment: mocks.assertEnvironment }));
vi.mock("@playwright/test", () => ({ expect: (value: unknown) => ({
  toBeVisible: async () => expect(value).toBeDefined(),
  toMatchObject: (expected: object) => expect(value).toMatchObject(expected),
}) }));
import { withReviewItem } from "../../../e2e/authorized-review-fixture";
import type { Page } from "@playwright/test";

it.each([false, true])("selects workspace controls in navigation, not duplicated inline controls (mobile=%s)", async mobile => {
  mocks.assertEnvironment.mockReturnValue({ VOTUS_E2E_TEST_USER_EMAIL: "fixture@example.test" });
  mocks.createClient.mockReturnValue({
    from: () => ({ insert: async () => ({ error: null }) }),
    auth: { admin: { listUsers: async () => ({ data: { users: [{ id: "fixture-user", email: "fixture@example.test" }] }, error: null }) } },
    rpc: async (name: string) => ({ error: null, data: name.includes("setup") ? { organization_id: "fixture-org" } : {} }),
  });
  const selectOption = vi.fn();
  const click = vi.fn();
  const navigation = { getByRole: (role: string) => role === "combobox" ? { selectOption } : { click } };
  const getByRole = vi.fn((role: string, options?: { name?: string }) => {
    if (role === "banner" || role === "dialog") return navigation;
    if (role === "button" && options?.name === "Abrir navegación") return { isVisible: async () => mobile, click };
    if (role === "button" && options?.name === "Cerrar navegación") return { click };
    throw new Error("ambiguous unscoped workspace control");
  });
  const page = { goto: vi.fn(), getByRole, waitForResponse: async () => ({ ok: () => true, json: async () => ({ status: "active" }) }) } as unknown as Page;
  const run = vi.fn(async () => "done");
  await expect(withReviewItem(page, run)).resolves.toBe("done");
  expect(selectOption).toHaveBeenCalledWith("fixture-org");
  expect(getByRole).toHaveBeenCalledWith(mobile ? "dialog" : "banner", ...(mobile ? [{ name: "Navegación principal" }] : []));
  expect(run).toHaveBeenCalledOnce();
});
