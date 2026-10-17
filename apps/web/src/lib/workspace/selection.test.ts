import { expect, it, vi } from "vitest";
import { loadWorkspaceSelection } from "./selection";
const mocks = vi.hoisted(() => ({ observe: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server-client", () => ({ createSupabaseServerClient: async () => ({}) }));
vi.mock("./context", () => ({ observeWorkspace: mocks.observe, workspaceContextErrorCategory: () => null, WORKSPACE_CONTEXT_ERROR_CATEGORY: { MISMATCH: "mismatch" } }));
it.each([true, false, undefined, "true"])("projects only a verified boolean completion, received %j", async (completed) => {
  const org = { id: "00000000-0000-4000-8000-000000000001", display_name: "Test organization" };
  mocks.observe.mockResolvedValue({ available: { status: "ok", organizations: [org], total: 1, truncated: false }, current: { status: "active", context_revision: 2, organization: org, onboarding_completed: completed } });
  expect(await loadWorkspaceSelection()).toMatchObject({ status: "active", activeOrganizationId: org.id, onboardingCompleted: completed === true });
});
