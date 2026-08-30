import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceSelection } from "@/lib/workspace/selection";

const hooks = vi.hoisted(() => {
  const state: unknown[] = [], effectDeps: Array<readonly unknown[] | undefined> = [], effects: Array<() => void> = [];
  let cursor = 0;
  return {
    begin: () => { cursor = 0; },
    reset: () => { state.length = 0; effectDeps.length = 0; effects.length = 0; cursor = 0; },
    useState<T>(initial: T) {
      const index = cursor++;
      if (!(index in state)) state[index] = initial;
      const set = (value: T | ((previous: T) => T)) => { state[index] = typeof value === "function" ? (value as (previous: T) => T)(state[index] as T) : value; };
      return [state[index] as T, set] as const;
    },
    useEffect(effect: () => void, deps: readonly unknown[]) {
      const index = cursor++, previous = effectDeps[index];
      if (!previous || previous.length !== deps.length || deps.some((value, depIndex) => value !== previous[depIndex])) effects.push(effect);
      effectDeps[index] = deps;
    },
    useTransition() {
      cursor += 1;
      return [false, (task: () => void | Promise<void>) => { hooks.transition = Promise.resolve(task()); }] as const;
    },
    flushEffects: () => { for (const effect of effects.splice(0)) effect(); },
    transition: Promise.resolve(),
  };
});
const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("react", async (importOriginal) => ({ ...(await importOriginal<typeof import("react")>()), useState: hooks.useState, useEffect: hooks.useEffect, useTransition: hooks.useTransition }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
const { WorkspaceSelector } = await import("./WorkspaceSelector");

const A = "10000000-0000-4000-8000-000000000001", B = "10000000-0000-4000-8000-000000000002";
const organizations = [{ id: A, name: "Organization A" }, { id: B, name: "Organization B" }];
function selection(activeOrganizationId: string, revision: number, status: WorkspaceSelection["status"]): WorkspaceSelection {
  return { status, revision, activeOrganizationId, organizations, total: 2, truncated: false };
}
function render(initialSelection: WorkspaceSelection): unknown {
  hooks.begin();
  return WorkspaceSelector({ initialSelection });
}
function element(node: unknown, type: string): { props: Record<string, unknown> } {
  if (Array.isArray(node)) for (const child of node) { try { return element(child, type); } catch { /* inspect the next child */ } }
  if (typeof node === "object" && node !== null) {
    const value = node as { type?: unknown; props?: Record<string, unknown> };
    if (value.type === type && value.props) return { props: value.props };
    if (value.props && "children" in value.props) return element(value.props["children"], type);
  }
  throw new Error(`missing ${type}`);
}

beforeEach(() => {
  hooks.reset(); router.refresh.mockReset();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({ status: "unavailable" }) }));
});

describe("WorkspaceSelector", () => {
  it("synchronizes selected organization, revision, and message after refreshed props rerender", async () => {
    render(selection(A, 3, "conflict")); hooks.flushEffects();
    render(selection(B, 9, "active")); hooks.flushEffects();
    const refreshed = render(selection(B, 9, "active"));

    expect(element(refreshed, "select").props["value"]).toBe(B);
    expect(JSON.stringify(refreshed)).not.toContain("La organización cambió");
    const submit = element(refreshed, "form").props["onSubmit"] as (event: { preventDefault(): void }) => void;
    submit({ preventDefault: vi.fn() });
    await hooks.transition;
    const request = vi.mocked(fetch).mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(request.body))).toEqual({ organizationId: B, expectedRevision: 9 });
  });
});
