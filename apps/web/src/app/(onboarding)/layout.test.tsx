import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import Layout from "./layout";
const mocks = vi.hoisted(() => ({ getUser: vi.fn(), redirect: vi.fn((to: string): never => { throw new Error(`redirect:${to}`); }) }));
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/supabase/server-client", () => ({ createSupabaseServerClient: async () => ({ auth: { getUser: mocks.getUser } }) }));
vi.mock("@/components/SessionMonitor", () => ({ default: () => null }));
vi.mock("@/components/SignOutForm", () => ({ SignOutForm: () => <button>Cerrar sesión</button> }));
it("authenticates onboarding without invoking the completion-gated shell or duplicating selectors", async () => {
  mocks.getUser.mockResolvedValue({ data: { user: { id: "user" } } });
  const html = renderToStaticMarkup(await Layout({ children: <p>Onboarding step</p> }));
  expect(html).toContain("Onboarding step");
  expect(html).toContain("Cerrar sesión");
  expect(html).not.toContain("Cambiar organización");
  expect(html).not.toContain("<select");
});
it("never renders onboarding content for an anonymous session", async () => {
  mocks.getUser.mockResolvedValue({ data: { user: null } });
  await expect(Layout({ children: <p>private content</p> })).rejects.toThrow("redirect:/login");
});
