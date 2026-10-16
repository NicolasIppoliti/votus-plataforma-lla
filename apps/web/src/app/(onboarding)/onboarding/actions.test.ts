import { beforeEach, expect, it, vi } from "vitest";
import { chooseOrganization, finishOnboarding } from "./actions";
const mocks = vi.hoisted(() => ({ select: vi.fn(), rpc: vi.fn(), revalidate: vi.fn(), redirect: vi.fn((url: string): never => { throw new Error(`redirect:${url}`); }) }));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/workspace/selection", () => ({ selectWorkspace: mocks.select }));
vi.mock("@/lib/supabase/server-client", () => ({ createSupabaseServerClient: async () => ({ schema: () => ({ rpc: mocks.rpc }) }) }));
beforeEach(() => { vi.clearAllMocks(); mocks.rpc.mockResolvedValue({ data: { status: "ok" }, error: null }); });
const form = (values: Record<string, string>) => { const data = new FormData(); for (const [key, value] of Object.entries(values)) data.set(key, value); return data; };
it("completes through the claims-bound RPC before returning to a safe route", async () => {
  await expect(finishOnboarding(form({ returnTo: "/compare?year=2025" }))).rejects.toThrow("redirect:/compare?year=2025");
  expect(mocks.rpc).toHaveBeenCalledWith("complete_onboarding");
  expect(mocks.revalidate).toHaveBeenCalledWith("/", "layout");
});
it("keeps failed completion in onboarding instead of entering the platform", async () => {
  mocks.rpc.mockResolvedValue({ error: { message: "private detail" }, data: null });
  await expect(finishOnboarding(form({ returnTo: "https://evil.invalid" }))).rejects.toThrow("redirect:/onboarding?");
  expect(mocks.redirect).not.toHaveBeenCalledWith("https://evil.invalid");
});
it("rejects invalid organization input before calling the selection writer", async () => {
  await expect(chooseOrganization(form({ organizationId: "bad", revision: "1" }))).rejects.toThrow("redirect:/onboarding?");
  expect(mocks.select).not.toHaveBeenCalled();
});
it("selects an authorized organization using the submitted context revision", async () => {
  const id = "00000000-0000-4000-8000-000000000001";
  mocks.select.mockResolvedValue({ status: "active" });
  await expect(chooseOrganization(form({ organizationId: id, revision: "2", returnTo: "/compare" }))).rejects.toThrow("paso=alcance");
  expect(mocks.select).toHaveBeenCalledWith(id, 2);
  expect(mocks.revalidate).toHaveBeenCalledWith("/", "layout");
});
