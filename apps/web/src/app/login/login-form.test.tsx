import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  formAction: vi.fn(),
  useActionState: vi.fn(),
}));

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return {
    ...actual,
    useActionState: mocks.useActionState,
  };
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

const { LoginForm } = await import("./login-form");
const { default: LoginPage } = await import("./page");

describe("LoginForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.useActionState.mockReturnValue([
      { error: null },
      mocks.formAction,
      false,
    ]);
  });

  it("carries the requested destination through the rendered login page", async () => {
    // Exercise the server page -> client form seam, not an isolated hidden field.
    const markup = renderToStaticMarkup(await LoginPage({ searchParams: Promise.resolve({ returnTo: "/compare?electionId=2025&sourceKind=official" }) }) as ReactElement);
    expect(markup).toContain('name="returnTo"');
    expect(markup).toContain('value="/compare?electionId=2025&amp;sourceKind=official"');
  });

  it.each([undefined, ["/compare", "//evil.test"], "//evil.test", "/auth/callback", "/compare?bad=%ZZ"])("renders the safe default for an absent or invalid return destination %j", async (returnTo) => {
    const markup = renderToStaticMarkup(await LoginPage({ searchParams: Promise.resolve({ returnTo }) }) as ReactElement);
    expect(markup).toContain('name="returnTo" value="/"');
  });

  it("binds a native form action and keeps credentials in uncontrolled named fields", () => {
    const markup = renderToStaticMarkup(<LoginForm /> as ReactElement);

    expect(mocks.useActionState).toHaveBeenCalledOnce();
    expect(mocks.useActionState.mock.calls[0]?.[1]).toEqual({ error: null });
    expect(markup).toContain("<form");
    expect(markup).not.toContain("onsubmit=");
    expect(markup).toContain('name="email"');
    expect(markup).toContain('type="email"');
    expect(markup).toContain('name="password"');
    expect(markup).toContain('type="password"');
    expect(markup).not.toContain('value="synthetic-password"');
  });

  it("renders action errors and exposes the pending state accessibly", () => {
    mocks.useActionState.mockReturnValue([
      { error: "Las credenciales no son válidas." },
      mocks.formAction,
      true,
    ]);

    const markup = renderToStaticMarkup(<LoginForm /> as ReactElement);

    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain("disabled");
    expect(markup).toContain("Iniciando sesión…");
    expect(markup).toMatch(/<p[^>]*role="alert"/);
    expect(markup).toContain("Las credenciales no son válidas.");
  });
});
