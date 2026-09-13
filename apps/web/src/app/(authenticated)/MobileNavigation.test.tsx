import { afterEach, beforeEach, expect, test, vi } from "vitest";

// Narrow invocation seam, following WorkspaceSelector.test.tsx; not a React scheduler.
const hooks = vi.hoisted(() => {
  const values: unknown[] = [];
  const dependencies: Array<readonly unknown[] | undefined> = [];
  const cleanups: Array<void | (() => void)> = [];
  const effects: Array<() => void> = [];
  let cursor = 0;
  return {
    begin: () => { cursor = 0; },
    reset: () => {
      for (const cleanup of cleanups) if (cleanup) cleanup();
      values.length = dependencies.length = cleanups.length = effects.length = 0;
      cursor = 0;
    },
    useState(initial: boolean) {
      const index = cursor++;
      if (!(index in values)) values[index] = initial;
      return [values[index] as boolean, (value: boolean) => { values[index] = value; }] as const;
    },
    useRef(initial: unknown) {
      const index = cursor++;
      return values[index] ??= { current: initial };
    },
    useEffect(effect: () => void | (() => void), deps: readonly unknown[]) {
      const index = cursor++, previous = dependencies[index];
      if (!previous || previous.length !== deps.length || deps.some((value, i) => !Object.is(value, previous[i]))) {
        effects.push(() => {
          const cleanup = cleanups[index];
          if (cleanup) cleanup();
          cleanups[index] = effect();
        });
      }
      dependencies[index] = deps;
    },
    flush: () => { for (const effect of effects.splice(0)) effect(); },
  };
});
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useState: hooks.useState, useRef: hooks.useRef, useEffect: hooks.useEffect,
}));
const { MobileNavigation } = await import("./MobileNavigation");

function element(node: unknown, className: string): { props: Record<string, unknown> } {
  if (Array.isArray(node)) {
    for (const child of node) {
      try { return element(child, className); } catch { /* inspect the next child */ }
    }
  }
  if (typeof node === "object" && node !== null) {
    const value = node as { props?: Record<string, unknown> };
    if (value.props?.["className"] === className) return { props: value.props };
    if (value.props) return element(value.props["children"], className);
  }
  throw new Error(`Missing ${className}`);
}

beforeEach(() => hooks.reset());
afterEach(() => { hooks.reset(); vi.unstubAllGlobals(); });

test.each([
  { scenario: "cancel preserves focus advanced after native restoration", initiallyOnTrigger: true, advance: true },
  { scenario: "non-focusing activation establishes the opener as return target", initiallyOnTrigger: false, advance: false },
])("$scenario", ({ initiallyOnTrigger, advance }) => {
  let active: unknown;
  let remembered: unknown;
  let tree: unknown;
  const notifications: Array<() => void> = [];
  const trigger = { focus: vi.fn((): void => { active = trigger; }) };
  const close = { focus: vi.fn((): void => { active = close; }) };
  const followingLink = { focus: (): void => { active = followingLink; } };
  const otherControl = {};
  active = initiallyOnTrigger ? trigger : otherControl;
  const body = { style: { overflow: "auto" } };
  vi.stubGlobal("document", { body, get activeElement() { return active; } });
  // Native boundary remembers actual current focus, never a hardcoded invoker.
  const native = {
    open: false,
    showModal() { remembered = active; native.open = true; },
    close() {
      native.open = false;
      active = remembered;
      notifications.push(() => {
        (element(tree, "mobile-navigation__dialog").props["onClose"] as () => void)();
      });
    },
  };
  const render = () => {
    hooks.begin();
    tree = MobileNavigation({ sidebar: null });
    for (const [name, target] of [["trigger", trigger], ["close", close], ["dialog", native]] as const) {
      const ref = element(tree, `mobile-navigation__${name}`).props["ref"] as { current: unknown };
      ref.current = target;
    }
    hooks.flush();
  };
  render();
  // Invoke the real activation callback without inventing browser click-focus behavior.
  (element(tree, "mobile-navigation__trigger").props["onClick"] as () => void)();
  render();
  expect(native.open).toBe(true);
  expect(active).toBe(close);
  expect(body.style.overflow).toBe("hidden");
  if (advance) {
    const preventDefault = vi.fn();
    (element(tree, "mobile-navigation__dialog").props["onCancel"] as (event: { preventDefault(): void }) => void)({ preventDefault });
    expect(preventDefault).toHaveBeenCalledOnce();
  } else {
    (element(tree, "mobile-navigation__close").props["onClick"] as () => void)();
  }
  render();
  expect(native.open).toBe(false);
  expect(body.style.overflow).toBe("auto");
  expect(active).toBe(trigger);
  expect(notifications).toHaveLength(1);
  // Explicit permitted focus advance, not a synthetic Tab with imaginary default action.
  if (advance) followingLink.focus();
  notifications[0]?.();
  render();
  expect(active).toBe(advance ? followingLink : trigger);
  expect(element(tree, "mobile-navigation__trigger").props["aria-expanded"]).toBe(false);
  expect(native.open).toBe(false);
});
